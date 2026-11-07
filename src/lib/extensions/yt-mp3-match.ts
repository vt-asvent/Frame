import type { EngineClient, EngineVideo } from '@/lib/extensions/yt-mp3';
import { tidyArtist } from '@/lib/extensions/yt-mp3-lyrics';

// ============================================================
// Qué vídeo de YouTube es la canción, cómo se llama y cuál es su portada
// oficial (1.8.1). Todo sale por el programa de descargas (/search, /fetch).
// ============================================================

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Título sin sufijos de paréntesis/corchetes (feat., remaster, etc.). */
function coreName(name: string): string {
  return normalize(name.replace(/\(.*?\)|\[.*?\]/g, ''));
}

// ------------------------------------------------------------
// El vídeo de una canción de un CSV
// ------------------------------------------------------------

export interface SongWanted {
  title: string;
  artist: string;
  /** Segundos (los del CSV); 0 si no se sabe. */
  duration: number;
}

const BAD_WORDS = [
  'live', 'en vivo', 'cover', 'remix', 'sped up', 'slowed', 'reverb', '8d',
  'karaoke', 'instrumental', 'acoustic', 'acustic', 'reaction', 'loop',
  '1 hour', 'hora', 'mashup', 'nightcore', 'tutorial', 'lesson',
];

/**
 * Puntuación de un resultado: cercanía de duración, canal «- Topic» o audio
 * oficial, título y artista presentes, y castigo a live/cover/remix/sped up…
 * que no estén en el título original.
 */
function scoreCandidate(entry: EngineVideo, song: SongWanted): number | null {
  const title = entry.title ?? '';
  if (!title || !entry.url) return null;
  const nTitle = normalize(title);
  const nChannel = normalize(entry.channel ?? '');
  const nTrack = coreName(song.title);
  const nTrackFull = normalize(song.title);
  const nArtist = normalize(song.artist);
  const duration = typeof entry.duration === 'number' && entry.duration > 0 ? entry.duration : null;

  let score = 0;
  if (duration != null && song.duration > 0) {
    const diff = Math.abs(duration - song.duration);
    if (diff <= 3) score += 45;
    else if (diff <= 10) score += 30;
    else if (diff <= 20) score += 10;
    else if (diff <= 45) score -= 15;
    else score -= 50;
  }
  if (nChannel.endsWith(' topic')) score += 35;
  if (nArtist && nChannel.includes(nArtist)) score += 12;
  if (nTitle.includes('official audio') || nTitle.includes('audio oficial')) score += 15;
  else if (nTitle.includes('official video') || nTitle.includes('video oficial')) score += 6;
  if (nTrack && nTitle.includes(nTrack)) score += 22;
  else if (nTrackFull && nTitle.includes(nTrackFull)) score += 18;
  else score -= 25;
  if (nArtist && (nTitle.includes(nArtist) || nChannel.includes(nArtist))) score += 10;
  for (const bad of BAD_WORDS) {
    if (nTitle.includes(bad) && !nTrackFull.includes(bad)) {
      score -= 35;
      break;
    }
  }
  return score;
}

/** Por debajo no se baja nada: mejor «no encontrada» que otra versión. */
const THRESHOLD = 25;

async function ranked(client: EngineClient, query: string, song: SongWanted) {
  const entries = await client.search(query, 10);
  return entries
    .map((video) => ({ video, score: scoreCandidate(video, song) }))
    .filter((c): c is { video: EngineVideo; score: number } => c.score !== null)
    .sort((a, b) => b.score - a.score);
}

/** El mejor vídeo para la canción (dos búsquedas), o null si ninguno es fiable. */
export async function findSongVideo(client: EngineClient, song: SongWanted): Promise<EngineVideo | null> {
  const primary = await ranked(client, `${song.artist} - ${song.title}`.replace(/^ - /, ''), song);
  if (primary[0] && primary[0].score >= THRESHOLD) return primary[0].video;
  const secondary = await ranked(client, `${song.title} ${song.artist} audio`.trim(), song);
  const best = [...primary, ...secondary].sort((a, b) => b.score - a.score)[0];
  return best && best.score >= THRESHOLD ? best.video : null;
}

// ------------------------------------------------------------
// Título y artista de un vídeo suelto
// ------------------------------------------------------------

/** Quita coletillas del título de un vídeo: «(Official Video)», «[Lyrics]»… */
function cleanVideoTitle(title: string): string {
  return title
    .replace(/\s*[([][^)\]]*(official|oficial|video|audio|lyric|letra|remaster|visualizer|videoclip|hq|hd|4k|mv)[^)\]]*[)\]]/gi, '')
    // «… M/V» u «… Official MV» al final (sin paréntesis).
    .replace(/\s+(official\s+)?(m\/v|mv)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lo que se busca en los catálogos: el título sin paréntesis ni corchetes (feat., versiones, el título en otro idioma…). */
function searchTitle(title: string): string {
  return title.replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\s+/g, ' ').trim() || title;
}

/**
 * Título y artista de la canción de un vídeo: los de YouTube Music si los
 * hay; si no, «Artista - Título» del vídeo, o el canal como artista.
 */
export function songOfVideo(video: Pick<EngineVideo, 'title' | 'channel' | 'artist' | 'track'>): { artist: string; title: string } {
  if (video.artist && video.track) return { artist: video.artist.split(',')[0].trim(), title: video.track.trim() };
  const clean = cleanVideoTitle(video.title);
  const dash = clean.split(/\s+[-–—|]\s+/);
  if (dash.length >= 2) return { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() };
  return { artist: tidyArtist(video.channel ?? ''), title: clean || video.title };
}

// ------------------------------------------------------------
// Portada oficial del álbum (y, de esa edición, álbum, año y pista)
// ------------------------------------------------------------
//   1. La del CSV (Spotify) o, con el id exacto de Spotify, su oEmbed.
//   2. iTunes Search (1000 px) con verificación: trae también el álbum, la
//      fecha de publicación y el número de pista.
//   3. Búsqueda pública de Deezer (cover_xl, 1000 px), misma verificación.
// Sin una coincidencia fiable: undefined (y se usa la imagen del vídeo).

/** La edición oficial de la canción. */
export interface OfficialRelease {
  /** Portada como data URL. */
  cover: string;
  /** El título en el catálogo: «See You Again (feat. Charlie Puth)». */
  title?: string;
  album?: string;
  albumArtist?: string;
  year?: number;
  track?: number;
}

const validYear = (value: unknown): number | undefined => {
  const year = Number(String(value ?? '').slice(0, 4));
  return year > 1900 && year < 2100 ? year : undefined;
};

/** ¿El resultado es la misma canción del mismo artista? */
function matches(song: { title: string; artist: string }, candTitle: string, candArtist: string): boolean {
  const wantTitle = coreName(song.title);
  const gotTitle = coreName(candTitle);
  if (!wantTitle || !gotTitle) return false;
  if (!(gotTitle.includes(wantTitle) || wantTitle.includes(gotTitle))) return false;
  const wantArtist = normalize(song.artist);
  if (!wantArtist) return true;
  const gotArtist = normalize(candArtist);
  return !!gotArtist && (gotArtist.includes(wantArtist) || wantArtist.includes(gotArtist));
}

/** Palabras que distinguen otra versión de la misma canción: directo, remezcla, acústica… */
const VARIANT_WORDS =
  /\b(remix(?:ed)?|mix|version|versao|live|en vivo|ao vivo|en directo|acoustic|acustic[oa]|instrumental|edit|karaoke|demo|sped up|slowed|reverb|cover|extended|club|dub|rework|bootleg|mashup|urban[oa]|unplugged|orchestral|piano|pianoforte|reprise|a ?cappella|nightcore)\b/g;

const variantOf = (title: string) => new Set(normalize(title).match(VARIANT_WORDS) ?? []);

/** ¿La misma versión? Un directo solo con un directo; la de estudio, sin remezclas ni «Versión Urbana». */
function sameVersion(want: Set<string>, title: string): boolean {
  const got = variantOf(title);
  return got.size === want.size && [...got].every((word) => want.has(word));
}

/** Los resultados que son la canción (y la misma versión); primero los de título idéntico. */
function bestMatches<T>(song: { title: string; artist: string }, rows: T[], titleOf: (row: T) => string, artistOf: (row: T) => string): T[] {
  // «ft.», «feat.» y «featuring» cuentan igual al comparar.
  const key = (title: string) => normalize(title).replace(/\b(ft|featuring)\b/g, 'feat');
  const want = key(song.title);
  const version = variantOf(song.title);
  const found = rows.filter((row) => matches(song, titleOf(row), artistOf(row)) && sameVersion(version, titleOf(row)));
  const exact = (row: T) => key(titleOf(row)) === want;
  return [...found.filter(exact), ...found.filter((row) => !exact(row))];
}

async function jsonOf(client: EngineClient, url: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await client.text(url)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function fromSpotify(client: EngineClient, spotifyId: string): Promise<string | undefined> {
  const data = await jsonOf(client, `https://open.spotify.com/oembed?url=${encodeURIComponent(`https://open.spotify.com/track/${spotifyId}`)}`);
  const thumb = typeof data?.thumbnail_url === 'string' ? data.thumbnail_url : '';
  // Códigos de tamaño del CDN de Spotify: 00001e02 = 300 px, 0000b273 = 640 px.
  return thumb ? client.image(thumb.replace('ab67616d00001e02', 'ab67616d0000b273')) : undefined;
}

interface ItunesRow {
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  collectionArtistName?: string;
  releaseDate?: string;
  trackNumber?: number;
  artworkUrl100?: string;
}

async function fromItunes(client: EngineClient, song: { title: string; artist: string }): Promise<OfficialRelease | undefined> {
  const term = `${song.artist} ${searchTitle(song.title)}`.trim();
  const data = await jsonOf(client, `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&media=music&limit=10`);
  const results = Array.isArray(data?.results) ? (data.results as ItunesRow[]) : [];
  for (const row of bestMatches(song, results, (r) => r.trackName ?? '', (r) => r.artistName ?? '')) {
    const art = row.artworkUrl100;
    if (!art) continue;
    // El servidor de Apple la da al tamaño pedido (nunca mayor que la original).
    const cover = (await client.image(art.replace('100x100bb', '1000x1000bb'))) ?? (await client.image(art.replace('100x100bb', '600x600bb')));
    if (!cover) continue;
    return {
      cover,
      ...(row.trackName ? { title: row.trackName } : {}),
      ...(row.collectionName ? { album: row.collectionName } : {}),
      ...(row.collectionArtistName || row.artistName ? { albumArtist: row.collectionArtistName || row.artistName } : {}),
      ...(validYear(row.releaseDate) ? { year: validYear(row.releaseDate) } : {}),
      ...(row.trackNumber && row.trackNumber > 0 ? { track: row.trackNumber } : {}),
    };
  }
  return undefined;
}

interface DeezerRow {
  title?: string;
  artist?: { name?: string };
  album?: { id?: number; title?: string; cover_xl?: string; cover_big?: string; cover?: string };
}

async function fromDeezer(client: EngineClient, song: { title: string; artist: string }): Promise<OfficialRelease | undefined> {
  // Búsqueda sencilla (el filtro artist:"…" de Deezer no devuelve nada desde
  // nov-2026); el artista y el título se comprueban aquí.
  const q = `${song.artist} ${searchTitle(song.title)}`.trim();
  const data = await jsonOf(client, `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`);
  const results = Array.isArray(data?.data) ? (data.data as DeezerRow[]) : [];
  for (const row of bestMatches(song, results, (r) => r.title ?? '', (r) => r.artist?.name ?? '')) {
    const cover = await client.image(row.album?.cover_xl || row.album?.cover_big || row.album?.cover);
    if (!cover) continue;
    // La fecha está en el álbum (la búsqueda no la trae).
    const album = row.album?.id ? await jsonOf(client, `https://api.deezer.com/album/${row.album.id}`) : null;
    const year = validYear(album?.release_date);
    const albumArtist = (album?.artist as { name?: string } | undefined)?.name || row.artist?.name;
    return {
      cover,
      ...(row.title ? { title: row.title } : {}),
      ...(row.album?.title ? { album: row.album.title } : {}),
      ...(albumArtist ? { albumArtist } : {}),
      ...(year ? { year } : {}),
    };
  }
  return undefined;
}

/** La edición oficial de la canción (su portada, como data URL), o undefined si no hay una fiable. */
export async function findOfficialRelease(
  client: EngineClient,
  song: { title: string; artist: string; coverUrl?: string; spotifyId?: string }
): Promise<OfficialRelease | undefined> {
  if (song.coverUrl) {
    const given = await client.image(song.coverUrl);
    if (given) return { cover: given };
  }
  if (song.spotifyId) {
    const exact = await fromSpotify(client, song.spotifyId);
    if (exact) return { cover: exact };
  }
  return (await fromItunes(client, song)) ?? (await fromDeezer(client, song));
}

/**
 * Sin portada oficial: el centro cuadrado de la imagen del vídeo (las
 * miniaturas de YouTube son 16:9 y una portada es cuadrada).
 */
export async function squareFromThumbnail(client: EngineClient, videoId: string): Promise<string | undefined> {
  const source =
    (await client.image(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)) ??
    (await client.image(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`));
  if (!source) return undefined;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('imagen'));
      image.src = source;
    });
    // hqdefault trae franjas negras arriba y abajo (4:3 con vídeo 16:9): se
    // recorta el cuadrado central de la parte con imagen.
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const contentH = Math.abs(w / h - 4 / 3) < 0.01 ? Math.round((w * 9) / 16) : h;
    const side = Math.min(w, contentH);
    const out = Math.min(720, side);
    const canvas = document.createElement('canvas');
    canvas.width = out;
    canvas.height = out;
    const ctx = canvas.getContext('2d');
    if (!ctx) return source;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
    return canvas.toDataURL('image/jpeg', 0.9);
  } catch {
    return source;
  }
}
