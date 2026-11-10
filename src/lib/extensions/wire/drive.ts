import { cappedFetchWith } from '@/lib/capped-fetch';
import { tr } from '@/lib/i18n';

// ============================================================
// Wire: cliente mínimo de Google Drive (API v3) para el relevo (1.7.3).
//
// Las mismas convenciones que el motor de Wire (Wire/src-tauri/src/engine/
// drive.rs): ámbito `drive.file` (solo lo que crea Frame), errores
// clasificados (credenciales, límite de peticiones, Drive lleno, no
// encontrado, Google caído) y subida reanudable para lo grande. Aquí va en
// TypeScript porque lo que se releva vive en el IndexedDB de Frame.
// ============================================================

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

// Con plazo (1.9.2): medio minuto para que Google conteste más lo que tarde el
// archivo a 16 KB/s (una canción de 5 MB, unos cinco minutos; por debajo de
// eso la red no sirve para mover música). Sin plazo, una petición colgada
// dejaba el relevo «sincronizando» hasta reiniciar Frame.
const driveFetch = cappedFetchWith(() => ({ answerMs: 30_000, unsizedBodyMs: 300_000, bytesPerMs: 16 }));
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,appProperties,createdTime,modifiedTime';

export type DriveErrorKind = 'auth' | 'rate' | 'quota' | 'notFound' | 'server' | 'network' | 'other';

export class DriveError extends Error {
  constructor(
    readonly kind: DriveErrorKind,
    message: string
  ) {
    super(message);
  }
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  appProperties: Record<string, string>;
  created: number;
  modified: number;
}

type Token = () => Promise<string>;

async function classify(resp: Response): Promise<DriveError> {
  let json: any = null;
  const body = await resp.text().catch(() => '');
  try {
    json = JSON.parse(body);
  } catch {
    /* sin JSON */
  }
  const reasons: string[] = (json?.error?.errors ?? []).map((e: any) => String(e?.reason ?? ''));
  const message = String(json?.error?.message ?? body).slice(0, 200);
  const has = (r: string) => reasons.includes(r);
  if (resp.status === 401) return new DriveError('auth', tr('Google pidió volver a entrar.'));
  if (resp.status === 429 || has('rateLimitExceeded') || has('userRateLimitExceeded')) {
    return new DriveError('rate', tr('Google pidió ir más despacio; sigue en un momento.'));
  }
  if (has('storageQuotaExceeded') || (has('quotaExceeded') && /storage/i.test(message))) {
    return new DriveError('quota', tr('Tu Google Drive está lleno.'));
  }
  if (resp.status === 404 || resp.status === 410 || has('appNotAuthorizedToFile') || has('insufficientFilePermissions')) {
    return new DriveError('notFound', tr('Ese archivo ya no está en Drive.'));
  }
  if (resp.status >= 500) return new DriveError('server', tr('Google Drive no responde ({status}).', { status: resp.status }));
  return new DriveError('other', tr('Google Drive respondió {status}: {message}', { status: resp.status, message }));
}

const toFile = (raw: any): DriveFile => ({
  id: raw.id,
  name: raw.name ?? '',
  mimeType: raw.mimeType ?? '',
  size: Number(raw.size ?? 0),
  appProperties: raw.appProperties ?? {},
  created: Date.parse(raw.createdTime ?? '') || 0,
  modified: Date.parse(raw.modifiedTime ?? '') || 0,
});

export class Drive {
  constructor(private readonly token: Token) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    let resp: Response;
    try {
      resp = await driveFetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${await this.token()}` } });
    } catch {
      throw new DriveError('network', tr('Sin conexión con Google Drive.'));
    }
    if (!resp.ok) throw await classify(resp);
    return resp;
  }

  private async json(url: string, init: RequestInit = {}): Promise<any> {
    const resp = await this.call(url, init);
    if (resp.status === 204) return null;
    try {
      return await resp.json();
    } catch {
      // La respuesta se cortó a medias (o se le cumplió el plazo).
      throw new DriveError('network', tr('Sin conexión con Google Drive.'));
    }
  }

  /** Todo lo que cumple la consulta (sin la papelera), página a página. */
  async list(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let page: string | undefined;
    do {
      const params = new URLSearchParams({ q: `${q} and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, pageSize: '1000', spaces: 'drive' });
      if (page) params.set('pageToken', page);
      const json = await this.json(`${API}/files?${params}`);
      out.push(...(json.files ?? []).map(toFile));
      page = json.nextPageToken;
    } while (page);
    return out;
  }

  async createFolder(name: string, appProperties: Record<string, string>): Promise<DriveFile> {
    const json = await this.json(`${API}/files?fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, appProperties }),
    });
    return toFile(json);
  }

  /**
   * Sube un archivo. Hasta 5 MB en una petición; más grande, con sesión
   * reanudable (lo que recomienda Google y lo que usa Wire).
   */
  async upload(meta: { name: string; parents: string[]; mimeType: string; appProperties: Record<string, string> }, blob: Blob): Promise<DriveFile> {
    if (blob.size <= 5 * 1024 * 1024) {
      const boundary = `frame${Math.random().toString(36).slice(2)}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
        `--${boundary}\r\nContent-Type: ${meta.mimeType}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ]);
      const json = await this.json(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      });
      return toFile(json);
    }
    const start = await this.call(`${UPLOAD}/files?uploadType=resumable&fields=${FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': meta.mimeType, 'X-Upload-Content-Length': String(blob.size) },
      body: JSON.stringify(meta),
    });
    const session = start.headers.get('Location');
    if (!session) throw new DriveError('other', tr('Google no abrió la subida.'));
    const json = await this.json(session, { method: 'PUT', headers: { 'Content-Type': meta.mimeType }, body: blob });
    return toFile(json);
  }

  /** Reemplaza el contenido (la ficha del equipo). */
  async replace(id: string, blob: Blob, mimeType: string): Promise<DriveFile> {
    const json = await this.json(`${UPLOAD}/files/${id}?uploadType=media&fields=${FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
    return toFile(json);
  }

  async download(id: string): Promise<Blob> {
    const resp = await this.call(`${API}/files/${id}?alt=media`);
    try {
      return await resp.blob();
    } catch {
      // La descarga se cortó a medias (o se le cumplió el plazo).
      throw new DriveError('network', tr('Sin conexión con Google Drive.'));
    }
  }

  async setProperties(id: string, appProperties: Record<string, string>): Promise<void> {
    await this.json(`${API}/files/${id}?fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties }),
    });
  }

  /**
   * Borrado definitivo: deja de ocupar el Drive del usuario en el acto. Para
   * las copias de paso que ya están en los equipos (relay.ts decide cuáles).
   */
  async remove(id: string): Promise<void> {
    try {
      await this.call(`${API}/files/${id}`, { method: 'DELETE' });
    } catch (error) {
      if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
    }
  }

  /**
   * A la papelera de Drive, no borrado definitivo: el usuario lo recupera
   * durante 30 días (Drive la vacía solo). Para lo que podría ser la última
   * copia. Ojo: mientras está en la papelera sigue contando como espacio usado.
   */
  async trash(id: string): Promise<void> {
    try {
      await this.json(`${API}/files/${id}?fields=id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      });
    } catch (error) {
      if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
    }
  }

  async about(): Promise<{ email: string; limit: number | null; usage: number }> {
    const json = await this.json(`${API}/about?fields=user(emailAddress),storageQuota(limit,usage)`);
    return {
      email: json?.user?.emailAddress ?? '',
      limit: json?.storageQuota?.limit ? Number(json.storageQuota.limit) : null,
      usage: Number(json?.storageQuota?.usage ?? 0),
    };
  }
}
