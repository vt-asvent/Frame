// AK Lore → Biblioteca (Frame 1.9.2): el índice del material y sus descargas.
//
// Los archivos viven en el Drive de Asvent, en carpetas que creó Frame (ámbito
// `drive.file`: esta nube no ve nada más de ese Drive). Nadie recibe un enlace
// a Drive: la app pide el índice y cada archivo aquí, con su sesión de Frame,
// y esta nube los trae de Drive y se los pasa tal cual, sin guardarlos.
//
// Solo para cuentas que pueden abrirla (lore-acceso.ts): las que entran con su
// correo del colegio, comprobado, o las que la activaron con el código que
// llega a ese correo (1.9.3).
// Cada cuenta tiene un tope diario de archivos y de bytes (`lore_descargas`):
// holgado para bajar «Tu paquete» (Frame 1.9.9: varias asignaturas enteras, un
// millar de archivos) y seguir usando la Biblioteca ese día.
//
// Rutas: GET /app/lore → { format: 1, guides: [...] }
//        GET /app/lore/archivo/<id> → el archivo (attachment)
//        GET /app/lore/vista/<id> → la vista previa de un destacado (1.9.4):
//        la primera página en una imagen pequeña, guardada en D1 (`lore_vistas`)
//        al subir el archivo. No cuenta para el tope de descargas.
// Errores: 403 `school` (sin activar) · 404 · 429 `quota` · 503 `lore-off`
// (sin Drive conectado) o `drive` (Drive no respondió).
import { hasLoreAccess } from './lore-acceso';
import { type AppUser } from './supabase';
import { type Env, json } from './util';

export const DAILY_FILES = 2000;
export const DAILY_BYTES = 5_000_000_000;
/**
 * Archivos que se reparten al día en paquetes, entre todas las cuentas. Cada uno es una petición a esta nube, y el
 * plan gratis da 100 000 al día para todo Frame: un día de muchos paquetes no puede dejar sin nube a los demás.
 */
export const LOTE_DIA = 40_000;

const ID = /^[a-z0-9][a-z0-9-]{2,79}$/;

interface LoreRow {
  id: string;
  drive_id: string;
  title: string;
  subject: string;
  section: string;
  kind: string;
  component: string | null;
  lang: string | null;
  year: number | null;
  size: number;
  pages: number | null;
  summary: string | null;
  format: string;
  updated: string;
}

/** Todo el índice (unos cientos de filas: cabe en una respuesta). */
export async function loreIndex(env: Env, user: AppUser): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  const { results } = await env.DB.prepare(
    'SELECT id, title, subject, section, kind, component, lang, year, size, pages, summary, format, updated, EXISTS (SELECT 1 FROM lore_vistas v WHERE v.id = lore.id) AS preview FROM lore ORDER BY section, subject, kind, title',
  ).all<Omit<LoreRow, 'drive_id'> & { preview: number }>();
  const guides = results.map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    section: r.section,
    kind: r.kind,
    ...(r.component ? { component: r.component } : {}),
    ...(r.lang ? { lang: r.lang } : {}),
    ...(r.year ? { year: r.year } : {}),
    ...(r.pages ? { pages: r.pages } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(r.preview ? { preview: true } : {}),
    size: r.size,
    format: r.format,
    updated: r.updated,
  }));
  // Sin caché: la del navegador no distingue sesiones y, tras cambiar de cuenta
  // en el mismo equipo, serviría el índice sin pasar por la comprobación de
  // arriba. La app guarda su propia copia para buscar sin conexión.
  return json({ format: 1, guides }, 200, { 'cache-control': 'private, no-store' });
}

// ------------------------------------------------------------
// Drive: un token de acceso a partir del de renovación de Asvent
// ------------------------------------------------------------

let access: { token: string; until: number } | null = null;

export function resetDriveAccess(): void {
  access = null;
}

export async function driveToken(env: Env): Promise<string | null> {
  if (access && access.until > Date.now()) return access.token;
  if (!env.LORE_DRIVE_REFRESH || !env.LORE_GOOGLE_ID || !env.LORE_GOOGLE_SECRET) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.LORE_DRIVE_REFRESH,
      client_id: env.LORE_GOOGLE_ID,
      client_secret: env.LORE_GOOGLE_SECRET,
    }),
  }).catch(() => null);
  if (!r?.ok) {
    console.error('lore token', r?.status ?? 'red');
    return null;
  }
  const out = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!out?.access_token) return null;
  access = { token: out.access_token, until: Date.now() + Math.max(60, (out.expires_in ?? 3600) - 300) * 1000 };
  return access.token;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** La vista previa de un destacado. La portada de un documento público: el equipo puede guardarla una semana. */
export async function loreView(env: Env, user: AppUser, id: string): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  const row = ID.test(id) ? await env.DB.prepare('SELECT mime, datos FROM lore_vistas WHERE id = ?').bind(id).first<{ mime: string; datos: ArrayBuffer | number[] }>() : null;
  if (!row) return json({ error: 'not_found' }, 404);
  const bytes = row.datos instanceof ArrayBuffer ? new Uint8Array(row.datos) : Uint8Array.from(row.datos);
  return new Response(bytes, { status: 200, headers: { 'content-type': /^image\/(jpeg|png|webp)$/.test(row.mime) ? row.mime : 'application/octet-stream', 'cache-control': 'private, max-age=604800' } });
}

/** De los tramos pequeños de un archivo ya abierto se anota, en promedio, una vez cada tantos bytes (y de golpe). */
export const UNIDAD_DE_TRAMOS = 4 * 1_048_576;

/**
 * Los bytes que se anotan por una petición. Exactos si abre el archivo, si lo pide entero o si el tramo es grande.
 * Un tramo pequeño (hojear un PDF son decenas, de 256 KB) se anota por muestreo: con probabilidad `bytes / UNIDAD`
 * se anota una UNIDAD entera. En promedio es lo mismo que anotarlos todos, sin una escritura por tramo, y nadie puede
 * esquivarlo partiendo la descarga en trozos. `azar`: un número en [0, 1).
 */
export function bytesACobrar(bytes: number, exacto: boolean, azar: number): number {
  if (exacto || bytes >= UNIDAD_DE_TRAMOS) return bytes;
  return azar < bytes / UNIDAD_DE_TRAMOS ? UNIDAD_DE_TRAMOS : 0;
}

const azar = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

/**
 * Con qué probabilidad se anota un archivo de un paquete: una de cada 16 veces como poco, más cuanto más pesa y
 * siempre desde 64 MiB. Al anotarlo cuenta por 1/p archivos y bytes/p bytes: en promedio, lo mismo que anotarlos
 * todos, con una escritura cada muchos archivos y sin que una sola anotación pese más de 64 MiB.
 */
export const probabilidadDeLote = (bytes: number): number => Math.min(1, Math.max(1 / 16, bytes / (64 * 1_048_576)));

type Cuenta = { cabe: boolean; lleno?: boolean; devolver: () => Promise<void> };
const nada = async () => undefined;

/** Un archivo de un paquete: se mira lo que llevan la cuenta y el día, y se anota por muestreo. */
async function contarLote(env: Env, owner: string, day: string, tamano: number): Promise<Cuenta> {
  const k = `lote:${day}`;
  const [cuenta, total] = await env.DB.batch<{ n: number; bytes: number }>([
    env.DB.prepare('SELECT n, bytes FROM lore_descargas WHERE owner = ?1 AND day = ?2').bind(owner, day),
    env.DB.prepare('SELECT CAST(v AS REAL) AS n, 0 AS bytes FROM lore_estado WHERE k = ?1').bind(k),
  ]);
  const lleva = cuenta?.results[0];
  if (lleva && (lleva.n > DAILY_FILES || lleva.bytes > DAILY_BYTES)) return { cabe: false, devolver: nada };
  if ((total?.results[0]?.n ?? 0) > LOTE_DIA) return { cabe: false, lleno: true, devolver: nada };
  const p = probabilidadDeLote(tamano);
  if (azar() >= p) return { cabe: true, devolver: nada };
  const n = 1 / p;
  const bytes = Math.round(tamano / p);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO lore_descargas (owner, day, n, bytes) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (owner, day) DO UPDATE SET n = n + excluded.n, bytes = bytes + excluded.bytes').bind(owner, day, n, bytes),
    env.DB.prepare('INSERT INTO lore_estado (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = CAST(v AS REAL) + CAST(excluded.v AS REAL)').bind(k, String(n)),
  ]);
  const devolver = () =>
    env.DB.batch([
      env.DB.prepare('UPDATE lore_descargas SET n = n - ?, bytes = bytes - ? WHERE owner = ? AND day = ?').bind(n, bytes, owner, day),
      env.DB.prepare('UPDATE lore_estado SET v = CAST(v AS REAL) - ? WHERE k = ?').bind(n, k),
    ]).then(nada, nada);
  return { cabe: true, devolver };
}

/**
 * La lista de archivos abiertos hoy (la misma tabla que la migración 0010). Esa migración no pudo aplicarse el día
 * que hizo falta, con las escrituras de la base cortadas; por eso la nube la crea sola, en cuanto la base la deja,
 * la primera vez que la echa en falta.
 */
export const asegurarAbiertos = (env: Env): Promise<void> =>
  env.DB.prepare('CREATE TABLE IF NOT EXISTS lore_abiertos (owner TEXT NOT NULL, day TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY (owner, day, id)) WITHOUT ROWID')
    .run()
    .then(
      () => undefined,
      () => undefined,
    );

/**
 * Anota una petición en la cuenta del día de `owner` y dice si cabe en el tope.
 *
 * - Con `id` (Biblioteca 2): el archivo cuenta una vez al día por cuenta, en su primera petición, empiece por el byte
 *   que empiece (`lore_abiertos`): pedirlo sin su primer tramo no lo deja fuera de la cuenta de archivos.
 * - Sin `id` (la Biblioteca de las apps 1.9.2 a 1.9.6, que siempre baja el archivo entero): cada descarga cuenta.
 * - `lote` (un archivo entero de «Tu paquete»): por muestreo y con el tope del día de todas las cuentas
 *   (`contarLote`); `lleno` dice que fue ese tope, no el de la cuenta.
 *
 * Nunca impide servir un archivo por un fallo propio: si la base no deja anotar (el plan gratis corta las escrituras
 * de toda la cuenta al llegar a su tope diario, y eso dejó la Biblioteca sin descargas el 13-nov-2026) o no responde,
 * se sirve igual y queda dicho en el registro.
 */
export async function contarDescarga(
  env: Env,
  owner: string,
  pedido: { id?: string; bytes: number; entero: boolean; lote?: boolean },
): Promise<Cuenta> {
  const day = new Date().toISOString().slice(0, 10);
  try {
    if (pedido.lote) return await contarLote(env, owner, day, pedido.bytes);
    let abre = !pedido.id;
    let lleva: { n: number; bytes: number } | undefined;
    if (pedido.id) {
      const [abierto, cuenta] = await env.DB.batch<{ n: number; bytes: number }>([
        env.DB.prepare('SELECT 1 AS n, 0 AS bytes FROM lore_abiertos WHERE owner = ?1 AND day = ?2 AND id = ?3').bind(owner, day, pedido.id),
        env.DB.prepare('SELECT n, bytes FROM lore_descargas WHERE owner = ?1 AND day = ?2').bind(owner, day),
      ]);
      lleva = cuenta?.results[0];
      // La primera petición de este archivo hoy lo abre. Si llegan dos a la vez, solo una lo cuenta.
      if (!abierto?.results.length) {
        abre = !!(await env.DB.prepare('INSERT OR IGNORE INTO lore_abiertos (owner, day, id) VALUES (?1, ?2, ?3) RETURNING id').bind(owner, day, pedido.id).first());
      }
    }
    const bytes = bytesACobrar(pedido.bytes, abre || pedido.entero, azar());
    // Nada que anotar esta vez: basta con mirar lo que lleva.
    if (!abre && !bytes) return { cabe: !lleva || (lleva.n <= DAILY_FILES && lleva.bytes <= DAILY_BYTES), devolver: nada };

    const archivos = abre ? 1 : 0;
    const used = await env.DB.prepare(
      'INSERT INTO lore_descargas (owner, day, n, bytes) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (owner, day) DO UPDATE SET n = n + excluded.n, bytes = bytes + excluded.bytes RETURNING n, bytes',
    )
      .bind(owner, day, archivos, bytes)
      .first<{ n: number; bytes: number }>();
    const devolver = () =>
      env.DB.batch([
        env.DB.prepare('UPDATE lore_descargas SET n = n - ?, bytes = bytes - ? WHERE owner = ? AND day = ?').bind(archivos, bytes, owner, day),
        // Si el archivo no llegó a servirse, tampoco quedó abierto: el siguiente intento vuelve a contarlo.
        ...(abre && pedido.id ? [env.DB.prepare('DELETE FROM lore_abiertos WHERE owner = ? AND day = ? AND id = ?').bind(owner, day, pedido.id)] : []),
      ]).then(nada, nada);
    if (used && (used.n > DAILY_FILES || used.bytes > DAILY_BYTES)) {
      await devolver();
      return { cabe: false, devolver: nada };
    }
    return { cabe: true, devolver };
  } catch (e) {
    console.error('biblioteca: la descarga se sirve sin anotar', String(e).slice(0, 160));
    if (/no such table: lore_abiertos/i.test(String(e))) await asegurarAbiertos(env);
    return { cabe: true, devolver: nada };
  }
}

/** Un archivo: se cuenta, se trae de Drive y se pasa sin guardarlo. */
export async function loreFile(env: Env, user: AppUser, id: string): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  if (!ID.test(id)) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare('SELECT id, drive_id, title, size, format FROM lore WHERE id = ?').bind(id).first<Pick<LoreRow, 'id' | 'drive_id' | 'title' | 'size' | 'format'>>();
  if (!row) return json({ error: 'not_found' }, 404);

  const cuenta = await contarDescarga(env, user.owner, { bytes: row.size, entero: true });
  if (!cuenta.cabe) return json({ error: 'quota', files: DAILY_FILES }, 429);
  const refund = cuenta.devolver;

  const token = await driveToken(env);
  if (!token) {
    await refund();
    return json({ error: env.LORE_DRIVE_REFRESH ? 'drive' : 'lore-off' }, 503);
  }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.drive_id)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r?.ok || !r.body) {
    if (r?.status === 401) resetDriveAccess();
    console.error('lore drive', r?.status ?? 'red');
    await refund();
    return json({ error: r?.status === 404 ? 'not_found' : 'drive' }, r?.status === 404 ? 404 : 503);
  }
  const name = `${row.title}.${row.format}`.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, ' ').trim();
  return new Response(r.body, {
    status: 200,
    headers: {
      'content-type': MIME[row.format] ?? 'application/octet-stream',
      ...(r.headers.get('content-length') ? { 'content-length': r.headers.get('content-length')! } : {}),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
}
