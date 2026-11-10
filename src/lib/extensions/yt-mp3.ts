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

/**
 * Nombre válido para un archivo o una carpeta de Windows ('' si no queda
 * nada): sin barras ni signos reservados, sin puntos ni espacios en los
 * extremos (un «..» no sube de carpeta) y de 80 caracteres como mucho.
 */
export function safeFileName(name: string): string {
  const clean = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[. ]+|[. ]+$/g, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean) ? `_${clean}` : clean;
}

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
/** Miniatura 16:9 de 320 px (la de las tarjetas). */
export const thumbnailUrl = (id: string) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

// ------------------------------------------------------------
// Cliente
// ------------------------------------------------------------

/**
 * El programa está, pero no contestó en su plazo (una búsqueda lenta, YouTube
 * que no responde). No es lo mismo que no estar: eso es un `TypeError` de `fetch`.
 */
export class EngineTimeout extends Error {
  constructor() {
    super('timeout');
    this.name = 'EngineTimeout';
  }
}

export class EngineClient {
  constructor(private readonly page: string) {}

  private url(path: string): string {
    return new URL(path, this.page).toString();
  }

  /**
   * Pide algo al programa y lee la respuesta ENTERA dentro del plazo: si se
   * queda a medias (el programa se colgó mientras contestaba), también corta.
   */
  private async post<T>(path: string, body: unknown, timeoutMs: number, read: (response: Response) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(this.url(path), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
      return await read(response);
    } catch (error) {
      if (controller.signal.aborted) throw new EngineTimeout();
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  }

  private call<T>(path: string, body: unknown = {}, timeoutMs = 60_000): Promise<T> {
    return this.post(path, body, timeoutMs, async (response) => {
      // (Si el cuerpo no es JSON, vale el estado; si se cortó a medias, lo dice `post`.)
      const text = await response.text();
      let data = {} as T & { error?: string };
      try {
        data = JSON.parse(text) as T & { error?: string };
      } catch {
        /* sin JSON */
      }
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    });
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
  file(id: number): Promise<ArrayBuffer> {
    return this.post('/file', { id }, 120_000, async (response) => {
      if (response.ok) return response.arrayBuffer();
      let message = '';
      try {
        message = (JSON.parse(await response.text()) as { error?: string })?.error ?? '';
      } catch {
        /* sin JSON */
      }
      throw new Error(message || `HTTP ${response.status}`);
    });
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
  /**
   * De una lista de YouTube (1.9.2): `title` y `artist` son el título del
   * vídeo y su canal; la canción la dice YouTube Music al empezar, como con
   * un vídeo añadido a mano.
   */
  fromYouTube?: boolean;
}

/** Filas de un CSV (comillas, y comas o saltos dentro de comillas; separa con «,», «;» o tabulador). */
function rows(text: string): string[][] {
  const head = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const count = (ch: string) => head.split(ch).length - 1;
  const sep = [';', '\t'].reduce((best, ch) => (count(ch) > count(best) ? ch : best), ',');
  /**
   * Dónde cierra la celda entre comillas que se abre en `from`, o -1. Unas
   * comillas solo abren celda al principio de ella y si después cierran justo
   * antes de un separador, un salto o el final. Si no, son texto: «Song (12"
   * Mix)» o «"Heroes" (Single Version)» en una exportación de iTunes, que no
   * entrecomilla, no se tragan las filas siguientes.
   */
  const closing = (from: number): number => {
    const until = Math.min(text.length, from + 20_000);
    for (let i = from + 1; i < until; i++) {
      if (text[i] !== '"') continue;
      if (text[i + 1] === '"') {
        i++;
        continue;
      }
      let after = i + 1;
      while (text[after] === ' ') after++;
      const next = text[after];
      return next === undefined || next === sep || next === '\n' || next === '\r' ? i : -1;
    }
    return -1;
  };
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim())) out.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && cell.trim() === '') {
      const end = closing(i);
      if (end > 0) {
        cell = text.slice(i + 1, end).replace(/""/g, '"');
        i = end;
        while (text[i + 1] === ' ') i++;
        continue;
      }
    }
    if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  endRow();
  return out;
}

/** Para comparar cabeceras: sin mayúsculas, tildes ni signos, en cualquier alfabeto. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Artistas con coma en el nombre: no son una lista de artistas. */
const COMMA_NAMES = [
  'tyler, the creator',
  'earth, wind & fire',
  'earth, wind and fire',
  'crosby, stills, nash & young',
  'crosby, stills & nash',
  'emerson, lake & palmer',
  'blood, sweat & tears',
  'peter, paul and mary',
  'peter, paul & mary',
  'dave dee, dozy, beaky, mick & tich',
  'now, now',
  'hey, violet',
];

/**
 * El primer artista de «A;B» o «A, B» (como los juntan Exportify y los demás),
 * sin partir un nombre que lleva coma («Tyler, The Creator»).
 */
export function primaryArtist(text: string): string {
  const first = text.split(';')[0].trim();
  const low = first.toLowerCase();
  const whole = COMMA_NAMES.find((name) => low.startsWith(name));
  return (whole ? first.slice(0, whole.length) : first.split(',')[0]).trim();
}

/**
 * Canciones de un CSV. Reconoce las columnas de Exportify (Spotify),
 * TuneMyMusic y Soundiiz (Spotify, Deezer, Apple Music, TIDAL, Amazon…),
 * la exportación de YouTube Music en Google Takeout (también la que solo
 * trae el «Video ID»), la lista exportada de Apple Music / iTunes (texto con
 * tabuladores) y nombres comunes en varios idiomas.
 */
export function parseSongsCsv(text: string, limit = 500): CsvSong[] {
  let table = rows(text.replace(/^﻿/, ''));
  // El Takeout antiguo de YouTube trae, antes de la tabla de vídeos, un bloque
  // con los datos de la playlist (con su propia columna «Title»): la tabla es
  // la que empieza en «Video Id».
  const videoTable = table.findIndex((r, i) => i > 0 && i < 12 && r.some((c) => ['video id', 'youtube id'].includes(norm(c))));
  if (videoTable > 0) table = table.slice(videoTable);
  if (table.length < 2) return [];
  const header = table[0].map(norm);
  const col = (...names: string[]) => {
    const wanted = new Set(names.map(norm));
    return header.findIndex((h) => wanted.has(h));
  };
  // Los nombres de Exportify, TuneMyMusic, Soundiiz y Takeout, los de la lista
  // exportada de Apple Music / iTunes en cada idioma, y los más comunes.
  const iTitle = col(
    ...['track name', 'song title', 'song name', 'track title', 'title', 'name', 'song', 'track'],
    ...['título', 'nombre', 'canción', 'tema', 'música', 'faixa', 'nome', 'titre', 'nom', 'morceau', 'chanson'],
    ...['titel', 'lied', 'songtitel', 'titolo', 'brano', 'canzone', 'название', 'трек', 'песня', 'композиция', 'タイトル', '曲名', '名前', 'トラック名']
  );
  const iArtist = col(
    ...['artist name(s)', 'artist names', 'artist name', 'artist name 1', 'artist', 'artists', 'artist 1', 'performer'],
    ...['artista', 'artistas', 'intérprete', 'artiste', 'artistes', 'künstler', 'interpret', 'исполнитель', 'артист', 'アーティスト', 'アーティスト名']
  );
  const iAlbum = col('album name', 'album title', 'album', 'álbum', 'disco', 'альбом', 'アルバム', 'アルバム名');
  const iAlbumArtist = col(
    ...['album artist name(s)', 'album artist names', 'album artist', 'artista del álbum', 'artista do álbum', 'artista dell’album', "artista dell'album"],
    ...['artiste de l’album', "artiste de l'album", 'albumkünstler', 'album-interpret', 'исполнитель альбома', 'артист альбома', 'アルバムアーティスト']
  );
  const iNumber = col(
    ...['track number', 'número', 'pista', 'n', 'nº', 'número de pista', 'número da faixa', 'numéro de piste', 'titelnummer', 'numero traccia'],
    ...['номер трека', 'トラック番号']
  );
  const iMs = col('duration (ms)', 'track duration (ms)', 'duración (ms)');
  const iSeconds = col(
    ...['duration', 'seconds', 'time', 'length', 'duración', 'segundos', 'tiempo', 'duração', 'durée', 'dauer', 'durata', 'длительность', '時間']
  );
  const iDate = col('album release date', 'release date', 'fecha de lanzamiento', 'year', 'año', 'ano', 'année', 'jahr', 'anno', 'год', '年');
  const iUrl = col('url', 'youtube', 'youtube url', 'video url', 'link', 'enlace', 'video id', 'youtube id');
  const iCover = col('album image url', 'cover', 'portada', 'image');
  const iUri = col('track uri', 'spotify uri', 'uri', 'spotify id', 'spotify track id', 'spotify - id');
  // Las de «Guardar CSV» de Frame (playlist-link.ts): con ellas, el CSV es el
  // suyo, y su columna de artista trae ya uno solo, entero.
  const iVideoTitle = col('video title');
  const iChannel = col('channel');
  const own = iVideoTitle >= 0 && iChannel >= 0;
  if (iTitle < 0 && iUrl < 0) return [];
  const songs: CsvSong[] = [];
  for (const r of table.slice(1)) {
    // (Sin el apóstrofo con que «Guardar CSV» protege lo que una hoja de cálculo tomaría por fórmula.)
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim().replace(/^'(?=[=+\-@])/, '') : '');
    const url = cell(iUrl);
    // Sin título, pero con el del vídeo: como en la lista de YouTube de la que salió.
    const fromYouTube = !cell(iTitle) && !!cell(iVideoTitle) && !!youtubeId(url);
    const title = fromYouTube ? cell(iVideoTitle) : cell(iTitle);
    if (!title && !youtubeId(url)) continue;
    const ms = Number(cell(iMs));
    const clock = cell(iSeconds).match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/);
    const seconds =
      ms > 0 ? ms / 1000 : clock ? Number(clock[1] ?? 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3]) : Number(cell(iSeconds)) || 0;
    const track = Number(cell(iNumber));
    const year = Number(cell(iDate).slice(0, 4));
    const cover = cell(iCover);
    // «spotify:track:…», el enlace de la canción o el id solo.
    const spotify = cell(iUri).match(/(?:^|track[:/])([A-Za-z0-9]{22})(?:$|[?#])/)?.[1];
    const artistOf = (value: string) => (own ? value : primaryArtist(value));
    const albumArtist = artistOf(cell(iAlbumArtist));
    songs.push({
      title,
      artist: fromYouTube ? cell(iChannel) : artistOf(cell(iArtist)),
      ...(cell(iAlbum) ? { album: cell(iAlbum) } : {}),
      ...(albumArtist ? { albumArtist } : {}),
      ...(track > 0 ? { track } : {}),
      ...(year > 1900 && year < 2100 ? { year } : {}),
      ...(seconds > 0 ? { duration: seconds } : {}),
      ...(youtubeId(url) ? { url } : {}),
      ...(/^https:\/\//.test(cover) ? { cover } : {}),
      ...(spotify ? { spotifyId: spotify } : {}),
      ...(fromYouTube ? { fromYouTube } : {}),
    });
    if (songs.length >= limit) break;
  }
  return songs;
}
