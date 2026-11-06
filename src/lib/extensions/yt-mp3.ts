// ============================================================
// Protocolo «yt-mp3/1» de una fuente de música (1.7.6).
//
// Un programa de descargas de ESTE equipo (127.0.0.1) que lo declara en su
// manifiesto deja que Frame le hable directamente, con su propia ventana, en
// lugar de mostrar la página del programa. Frame no descarga nada: le pide
// al programa que baje una canción en MP3 (320 kbps, con portada y letra) y
// después la trae de su carpeta con la importación de siempre.
//
// Rutas (POST con JSON; responden JSON, `{ error }` si algo falla):
//   /status                          → { version, busy, music_dir }
//   /search { q, limit }             → [{ id, url, title, channel, duration, thumbnail }]
//   /info   { url }                  → { id, title, channel, duration, artist, track, album, year, thumbnail_max }
//   /song   { url, title, artist, album?, track?, cover?, lyrics?, folder?, bitrate? } → { job }
//   /jobs                            → [{ id, title, status, progress, error }]
//   /fetch  { url, binary? }         → { status, text } | { status, mime, base64 } (servicios de letras y portadas)
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
}

export interface EngineJob {
  id: number;
  title: string;
  /** queued · running · paused · done · failed · cancelled */
  status: string;
  progress: number;
  error?: string | null;
}

export interface SongOrder {
  url: string;
  title: string;
  artist: string;
  album?: string;
  track?: number;
  cover?: string;
  lyrics?: string;
  folder?: string;
}

/** Peso de un MP3 de 320 kbps: 40 000 bytes por segundo. */
export const mp3Bytes = (seconds: number) => Math.round(seconds * 40_000);

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

export const embedUrl = (id: string) => `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1`;

export class EngineClient {
  constructor(private readonly page: string) {}

  private async call<T>(path: string, body: unknown = {}, timeoutMs = 60_000): Promise<T> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL(path, this.page).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as T & { error?: string };
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  /** ¿Está abierto y deja hablar a Frame? */
  async alive(): Promise<boolean> {
    try {
      await this.call('/status', {}, 2500);
      return true;
    } catch {
      return false;
    }
  }

  async search(q: string, limit = 6): Promise<EngineVideo[]> {
    const list = await this.call<unknown>('/search', { q, limit });
    return Array.isArray(list) ? (list as EngineVideo[]).filter((v) => v && YT_ID.test(v.id)) : [];
  }

  async info(url: string): Promise<EngineVideo> {
    const data = await this.call<Record<string, unknown>>('/info', { url });
    const id = String(data.id ?? '');
    return {
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: String(data.title ?? ''),
      channel: typeof data.channel === 'string' ? data.channel : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      thumbnail: typeof data.thumbnail_max === 'string' ? data.thumbnail_max : `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      artist: typeof data.artist === 'string' ? data.artist : null,
      track: typeof data.track === 'string' ? data.track : null,
      album: typeof data.album === 'string' ? data.album : null,
      year: typeof data.year === 'number' ? data.year : null,
    };
  }

  async song(order: SongOrder): Promise<number> {
    const data = await this.call<{ job: number }>('/song', { ...order, bitrate: 320, dest: 'music' });
    return data.job;
  }

  async jobs(): Promise<EngineJob[]> {
    const list = await this.call<unknown>('/jobs', {}, 5000);
    return Array.isArray(list) ? (list as EngineJob[]) : [];
  }

  /** Letra de LRCLIB (sincronizada si la hay), a través del programa. */
  async lyrics(artist: string, title: string, seconds?: number | null): Promise<string | undefined> {
    const params = new URLSearchParams({ artist_name: artist, track_name: title });
    if (seconds) params.set('duration', String(Math.round(seconds)));
    try {
      const res = await this.call<{ status: number; text?: string }>('/fetch', { url: `https://lrclib.net/api/get?${params}` }, 20_000);
      if (res.status !== 200 || !res.text) return undefined;
      const data = JSON.parse(res.text) as { syncedLyrics?: string | null; plainLyrics?: string | null };
      return (data.syncedLyrics || data.plainLyrics || undefined) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Imagen como data URL, a través del programa (solo servicios de portadas). */
  async image(url: string): Promise<string | undefined> {
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
// Título y artista de un vídeo suelto
// ------------------------------------------------------------

const NOISE = /\s*[([](official|oficial|video|vídeo|audio|lyrics?|letra|visualizer|hd|4k|mv|m\/v)[^)\]]*[)\]]/gi;

/** «Artista - Canción (Official Video)» → { artist, title }. */
export function songOf(video: EngineVideo): { artist: string; title: string } {
  if (video.artist && video.track) return { artist: video.artist.split(',')[0].trim(), title: video.track };
  const clean = video.title.replace(NOISE, '').trim();
  const split = clean.split(/\s+[-–—|]\s+/);
  if (split.length >= 2) return { artist: split[0].trim(), title: split.slice(1).join(' - ').trim() };
  const channel = (video.channel ?? '').replace(/\s*-\s*Topic$|VEVO$/i, '').trim();
  return { artist: channel || '—', title: clean || video.title };
}

// ------------------------------------------------------------
// CSV de canciones (Exportify / Spotify, o uno propio)
// ------------------------------------------------------------

export interface CsvSong {
  title: string;
  artist: string;
  album?: string;
  track?: number;
  /** Segundos, si el CSV la trae. */
  duration?: number;
  url?: string;
  cover?: string;
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
  const iNumber = col('track number', 'numero', 'pista', 'n');
  const iMs = col('duration ms', 'track duration ms', 'duracion ms');
  const iUrl = col('url', 'youtube', 'link', 'enlace');
  const iCover = col('album image url', 'cover', 'portada', 'image');
  if (iTitle < 0 && iUrl < 0) return [];
  const songs: CsvSong[] = [];
  for (const r of table.slice(1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const title = cell(iTitle);
    const url = cell(iUrl);
    if (!title && !youtubeId(url)) continue;
    const ms = Number(cell(iMs));
    const track = Number(cell(iNumber));
    const cover = cell(iCover);
    songs.push({
      title,
      artist: cell(iArtist).split(/[,;]/)[0].trim(),
      ...(cell(iAlbum) ? { album: cell(iAlbum) } : {}),
      ...(track > 0 ? { track } : {}),
      ...(ms > 0 ? { duration: ms / 1000 } : {}),
      ...(youtubeId(url) ? { url } : {}),
      ...(/^https:\/\//.test(cover) ? { cover } : {}),
    });
    if (songs.length >= limit) break;
  }
  return songs;
}

const AVOID = /\b(live|en vivo|cover|karaoke|instrumental|remix|sped up|slowed|8d|nightcore|reaction|tutorial|lesson)\b/;

/**
 * El mejor resultado de YouTube para una canción, o null si ninguno es fiable
 * (mejor no bajar nada que bajar otra versión).
 */
export function bestMatch(song: CsvSong, results: EngineVideo[]): EngineVideo | null {
  const want = norm(song.title);
  const wantArtist = norm(song.artist);
  let best: { video: EngineVideo; score: number } | null = null;
  for (const video of results) {
    const title = norm(video.title);
    const channel = norm(video.channel ?? '');
    let score = 0;
    if (want && title.includes(want)) score += 4;
    else if (want && want.split(' ').filter((w) => w.length > 2 && title.includes(w)).length >= Math.ceil(want.split(' ').length / 2)) score += 2;
    else continue;
    if (wantArtist && (title.includes(wantArtist) || channel.includes(wantArtist))) score += 3;
    if (/ topic$/.test(channel) || /official audio|audio oficial/.test(title)) score += 2;
    const extra = title.match(AVOID);
    if (extra && !want.includes(extra[0])) score -= 5;
    if (song.duration && video.duration) {
      const diff = Math.abs(song.duration - video.duration);
      if (diff > 20) continue;
      score += diff <= 3 ? 3 : diff <= 8 ? 1 : 0;
    }
    if (!best || score > best.score) best = { video, score };
  }
  return best && best.score >= 4 ? best.video : null;
}
