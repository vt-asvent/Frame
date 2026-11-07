// ============================================================
// Protocolo «yt-mp3/1» de una fuente de música (1.7.6; 1.8.1: cola propia).
//
// Un programa de descargas de ESTE equipo (127.0.0.1) que lo declara en su
// manifiesto deja que Frame le hable directamente, con su propia ventana, en
// lugar de mostrar la página del programa. Frame no descarga nada: le pide
// al programa que baje una canción en MP3 (320 kbps, con portada y letra) y
// después recoge el archivo terminado y lo importa como cualquier otro.
//
// Rutas (POST con JSON; responden JSON, `{ error }` si algo falla):
//   /status                          → { version, busy, music_dir }
//   /search { q, limit }             → [{ id, url, title, channel, duration, thumbnail }]
//   /info   { url }                  → { id, title, channel, duration, artist, track, album, year, thumbnail_max, audio_size }
//   /song   { url, title, artist, album?, track?, year?, album_artist?, cover?, lyrics?, folder?, bitrate?, expected? } → { job }
//   /jobs   { ids? }                 → [{ id, title, status, progress, downloaded, total, speed, eta, size, error }]
//   /pause · /resume · /cancel { id } → { ok }
//   /file   { id }                   → el archivo terminado, tal cual (desde la 1.1.0 del programa)
//   /fetch  { url, method?, headers?, body?, binary? } → { status, text } | { status, mime, base64 } (servicios de letras y portadas)
// ============================================================

export interface EngineVideo {
  id: string;
  url: string;
  title: string;
  channel: string | null;
  /** Segundos. */
  duration: number | null;
  thumbnail: string;
  artist?: string | null;
  track?: string | null;
  album?: string | null;
  year?: number | null;
  /** Bytes del mejor audio de origen (lo que se baja antes de convertir). */
  audioSize?: number | null;
}

export type EngineJobStatus = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface EngineJob {
  id: number;
  title: string;
  status: EngineJobStatus;
  /** 0–1: hasta 0,9 la descarga; luego conversión y etiquetas. */
  progress: number;
  /** Bytes de origen bajados y totales (reales o estimados). */
  downloaded: number;
  total: number | null;
  /** Bytes por segundo del propio trabajo. */
  speed: number;
  /** Lo que ocupa en disco lo terminado (MP3 y .lrc); desde la 1.1.0 del programa. */
  size?: number | null;
  /** Ruta del archivo terminado (solo para su nombre). */
  file?: string | null;
  error?: string | null;
}

export interface SongOrder {
  url: string;
  title: string;
  artist: string;
  album?: string;
  track?: number;
  year?: number;
  album_artist?: string;
  /** Portada como data URL. */
  cover?: string;
  /** LRC (con tiempos) o texto. */
  lyrics?: string;
  /** Subcarpeta (la playlist) dentro de la carpeta de música del programa. */
  folder?: string;
  /** Bytes de origen esperados (para que el avance sea el del archivo entero). */
  expected?: number;
}

export interface EngineStatus {
  version: string;
  busy: number;
}

// ------------------------------------------------------------
// Pesos
// ------------------------------------------------------------

/** Peso de un MP3 de 320 kbps: 40 000 bytes por segundo. */
export const mp3Bytes = (seconds: number) => Math.round(seconds * 40_000);

/** Audio de origen de YouTube (Opus o AAC, ~130 kbps) por segundo, mientras no se sepa el real. */
export const SOURCE_BYTES_PER_SECOND = 16_500;
/** Portada típica (600–1000 px en JPEG) mientras no se tenga. */
export const COVER_BYTES_GUESS = 160_000;
/** Letra típica mientras no se tenga. */
export const LYRICS_BYTES_GUESS = 3_000;
/** Marcos ID3 (título, artista, álbum…) y la cabecera del MP3. */
const TAG_BYTES = 2_048;

/**
 * Lo que ocupará en disco una canción: el MP3 de 320 kbps con su portada, su
 * letra y sus datos dentro, más la letra con tiempos en un .lrc al lado.
 */
export function songBytes(seconds: number, coverBytes?: number | null, lyricsBytes?: number | null, synced = true): number {
  const lyrics = lyricsBytes ?? LYRICS_BYTES_GUESS;
  return mp3Bytes(seconds) + (coverBytes ?? COVER_BYTES_GUESS) + lyrics * (synced ? 2 : 1) + TAG_BYTES;
}

// ------------------------------------------------------------
// Enlaces
// ------------------------------------------------------------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** Id de un enlace de YouTube (watch, youtu.be, shorts, music, embed) o null. */
export function youtubeId(text: string): string | null {
  const value = text.trim();
  if (YT_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    if (!id && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1] ?? null;
  }
  return id && YT_ID.test(id) ? id : null;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** Miniatura 16:9 de 320 px (la de las tarjetas). */
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// ------------------------------------------------------------
// Cliente
// ------------------------------------------------------------

export class EngineClient {
  constructor(private readonly page: string) {}

  private url(path: string): string {
    return new URL(path, this.page).toString();
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(this.url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timer);
    }
  }

  private async call<T>(path: string, body: unknown = {}, timeoutMs = 60_000): Promise<T> {
    const response = await this.post(path, body, timeoutMs);
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data;
  }

  /** ¿Está abierto y deja hablar a Frame? */
  async alive(): Promise<boolean> {
    try {
      await this.status();
      return true;
    } catch {
      return false;
    }
  }

  async status(): Promise<EngineStatus> {
    const data = await this.call<Record<string, unknown>>('/status', {}, 2500);
    return { version: String(data.version ?? ''), busy: Number(data.busy ?? 0) || 0 };
  }

  async search(q: string, limit = 6): Promise<EngineVideo[]> {
    const list = await this.call<unknown>('/search', { q, limit });
    return Array.isArray(list) ? (list as EngineVideo[]).filter((v) => v && YT_ID.test(v.id)) : [];
  }

  async info(url: string): Promise<EngineVideo> {
    const data = await this.call<Record<string, unknown>>('/info', { url });
    const id = String(data.id ?? '');
    const audio = typeof data.audio_size === 'number' && data.audio_size > 0 ? data.audio_size : null;
    return {
      id,
      url: watchUrl(id),
      title: String(data.title ?? ''),
      channel: typeof data.channel === 'string' ? data.channel : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      thumbnail: typeof data.thumbnail_max === 'string' ? data.thumbnail_max : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      artist: typeof data.artist === 'string' ? data.artist : null,
      track: typeof data.track === 'string' ? data.track : null,
      album: typeof data.album === 'string' ? data.album : null,
      year: typeof data.year === 'number' ? data.year : null,
      audioSize: audio,
    };
  }

  /** Pide la canción en MP3 de 320 kbps. Devuelve el número de trabajo. */
  async song(order: SongOrder): Promise<number> {
    const data = await this.call<{ job: number }>('/song', { ...order, bitrate: 320, dest: 'music' });
    return data.job;
  }

  /** Trabajos del programa (solo esos ids, si se dan). */
  async jobs(ids?: number[]): Promise<EngineJob[]> {
    const list = await this.call<unknown>('/jobs', ids ? { ids } : {}, 8000);
    return Array.isArray(list) ? (list as EngineJob[]) : [];
  }

  pause = (id: number) => this.call('/pause', { id }, 8000);
  resume = (id: number) => this.call('/resume', { id }, 8000);
  cancel = (id: number) => this.call('/cancel', { id }, 8000);

  /** El archivo terminado de un trabajo, tal cual. */
  async file(id: number): Promise<ArrayBuffer> {
    const response = await this.post('/file', { id }, 120_000);
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return response.arrayBuffer();
  }

  /** Texto de un servicio de letras o portadas, a través del programa (sin CORS). */
  async text(url: string, init: { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string } = {}): Promise<string> {
    const res = await this.call<{ status: number; text?: string }>('/fetch', { url, ...init }, 20_000);
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
    return res.text ?? '';
  }

  /** Imagen como data URL, a través del programa (solo servicios de portadas). */
  async image(url: string | null | undefined): Promise<string | undefined> {
    if (!url) return undefined;
    try {
      const res = await this.call<{ status: number; mime?: string; base64?: string }>('/fetch', { url, binary: true }, 20_000);
      if (res.status !== 200 || !res.base64 || !/^image\/(jpeg|png|webp)/.test(res.mime ?? '')) return undefined;
      return `data:${res.mime!.split(';')[0]};base64,${res.base64}`;
    } catch {
      return undefined;
    }
  }
}

// ------------------------------------------------------------
// CSV de canciones (Exportify / Spotify, o uno propio)
// ------------------------------------------------------------

export interface CsvSong {
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  year?: number;
  /** Segundos, si el CSV la trae. */
  duration?: number;
  url?: string;
  cover?: string;
  /** Id de la canción en Spotify (el «Track URI» de Exportify). */
  spotifyId?: string;
}

/** Filas de un CSV (comillas, comas y saltos dentro de comillas; ; o , como separador). */
function rows(text: string): string[][] {
  const head = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ';' : ',';
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) out.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) out.push(row);
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Canciones de un CSV. Reconoce las columnas de Exportify y nombres comunes en varios idiomas. */
export function parseSongsCsv(text: string, limit = 500): CsvSong[] {
  const table = rows(text.replace(/^﻿/, ''));
  if (table.length < 2) return [];
  const header = table[0].map(norm);
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iTitle = col('track name', 'title', 'titulo', 'name', 'nombre', 'cancion', 'song', 'track');
  const iArtist = col('artist name s', 'artist names', 'artist name', 'artist', 'artists', 'artista', 'artistas');
  const iAlbum = col('album name', 'album');
  const iAlbumArtist = col('album artist name s', 'album artist names', 'album artist', 'artista del album');
  const iNumber = col('track number', 'numero', 'pista', 'n');
  const iMs = col('duration ms', 'track duration ms', 'duracion ms');
  const iSeconds = col('duration', 'duracion', 'seconds', 'segundos');
  const iDate = col('album release date', 'release date', 'fecha de lanzamiento', 'year', 'ano');
  const iUrl = col('url', 'youtube', 'link', 'enlace');
  const iCover = col('album image url', 'cover', 'portada', 'image');
  const iUri = col('track uri', 'spotify uri', 'uri');
  if (iTitle < 0 && iUrl < 0) return [];
  const songs: CsvSong[] = [];
  for (const r of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const title = cell(iTitle);
    const url = cell(iUrl);
    if (!title && !youtubeId(url)) continue;
    const ms = Number(cell(iMs));
    const clock = cell(iSeconds).match(/^(\d{1,2}):(\d{2})$/);
    const seconds = ms > 0 ? ms / 1000 : clock ? Number(clock[1]) * 60 + Number(clock[2]) : Number(cell(iSeconds)) || 0;
    const track = Number(cell(iNumber));
    const year = Number(cell(iDate).slice(0, 4));
    const cover = cell(iCover);
    const spotify = cell(iUri).match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1];
    const albumArtist = cell(iAlbumArtist).split(/[,;]/)[0].trim();
    songs.push({
      title,
      artist: cell(iArtist).split(/[,;]/)[0].trim(),
      ...(cell(iAlbum) ? { album: cell(iAlbum) } : {}),
      ...(albumArtist ? { albumArtist } : {}),
      ...(track > 0 ? { track } : {}),
      ...(year > 1900 && year < 2100 ? { year } : {}),
      ...(seconds > 0 ? { duration: seconds } : {}),
      ...(youtubeId(url) ? { url } : {}),
      ...(/^https:\/\//.test(cover) ? { cover } : {}),
      ...(spotify ? { spotifyId: spotify } : {}),
    });
    if (songs.length >= limit) break;
  }
  return songs;
}
