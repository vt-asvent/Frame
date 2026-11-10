import type { EngineClient, EngineVideo } from '@/lib/extensions/yt-mp3';
import { artistMatches, cleanTitle, firstArtist, tidyArtist, titleMatches } from '@/lib/extensions/yt-mp3-lyrics';

// ============================================================
// Qué vídeo de YouTube es la canción, cómo se llama y cuál es su portada
// oficial (1.8.1). Todo sale por el programa de descargas (/search, /fetch).
// ============================================================

/**
 * Para comparar: minúsculas, sin tildes ni signos, en cualquier alfabeto (un
 * título en japonés, coreano o cirílico se compara igual que uno latino).
 */
export function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’‘`´]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
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

/** Otra versión de la canción (o algo que no es la canción): solo vale si es la que se pide. */
const OTHER_VERSION =
  /(?:^| )(live|en vivo|ao vivo|en directo|cover|remix|sped up|speed up|slowed|reverb|8d|karaoke|instrumental|acoustic|acustico|acustica|reaction|reaccion|loop|1 hour|1 hora|10 hours|mashup|nightcore|tutorial|lesson|歌ってみた|カバー|ライブ|カラオケ|커버|라이브|кавер|караоке)(?= |$)/g;

/** Escrituras sin espacios entre palabras (tras NFKD, el coreano va en jamo). */
const UNSPACED = /[ᄀ-ᇿ぀-ヿ㐀-鿿가-힯]/;

/** ¿Está `phrase` en `text` como palabras enteras? («hello» no está en «othello».) */
function hasPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  if (` ${text} `.includes(` ${phrase} `)) return true;
  return UNSPACED.test(phrase) && text.includes(phrase);
}

/** ¿Están en `text` todas las palabras de `phrase`, en cualquier orden? (Dos o más.) */
function hasWords(text: string, phrase: string): boolean {
  const words = phrase.split(' ').filter(Boolean);
  if (words.length < 2) return false;
  const pool = new Set(text.split(' '));
  return words.every((word) => pool.has(word));
}

/** Cómo puede aparecer el artista: entero, sin paréntesis («BTS (방탄소년단)») y cada uno de varios («KAROL G, Shakira»). */
function artistForms(artist: string): string[] {
  const each = artist
    .split(/\s*(?:,|;|\/|&|\s(?:feat\.?|ft\.?|featuring|with|con|x|y|and)\s)\s*/i)
    .map(normalize)
    .filter((name) => name.length >= 3);
  const forms = [normalize(artist), coreName(artist), normalize(firstArtist(artist))].filter((form) => form.length >= 2);
  return [...new Set([...forms, ...each])];
}

const flat = (text: string) => text.replace(/ /g, '');

/**
 * Puntuación de un resultado, o null si no es la canción.
 *
 * El título tiene que estar: sin él, que dure lo mismo no dice nada (cualquier
 * vídeo «Topic» de tres minutos y medio valdría). Otra versión que no se pidió
 * (directo, cover, remezcla, acelerada…) no vale, y tampoco un audio cuya
 * duración se aleja más de 45 s. Con eso, suman la cercanía de duración, el
 * canal «- Topic» o el audio oficial y que aparezca el artista; resta, y
 * mucho, que el artista no aparezca por ningún lado.
 */
export function scoreCandidate(entry: EngineVideo, song: SongWanted): number | null {
  const title = entry.title ?? '';
  if (!title || !entry.url) return null;
  const nTitle = normalize(title);
  const nChannel = normalize(entry.channel ?? '');
  const nTrackFull = normalize(song.title);
  const nTrack = normalize(cleanTitle(song.title)) || nTrackFull;
  const artists = artistForms(song.artist);
  const duration = typeof entry.duration === 'number' && entry.duration > 0 ? entry.duration : null;
  const diff = duration != null && song.duration > 0 ? Math.abs(duration - song.duration) : null;

  // El artista, en el título o en el canal («ShakiraVEVO», «Bad Bunny - Topic»).
  const inTitle = artists.some((form) => hasPhrase(nTitle, form));
  const inChannel = artists.some((form) => hasPhrase(nChannel, form) || (form.length >= 4 && flat(nChannel).includes(flat(form))));
  const topic = nChannel.endsWith(' topic');

  let score = 0;
  if (diff != null) {
    if (diff <= 3) score += 45;
    else if (diff <= 10) score += 30;
    else if (diff <= 20) score += 10;
    else if (diff <= 45) score -= 15;
    else return null;
  }

  /** Sin el nombre del artista («Cover Drive» no es un cover; «A» no es «Artista - A Sky…»). */
  const withoutArtist = (text: string) => artists.reduce((rest, form) => ` ${rest} `.split(` ${form} `).join(' ').trim(), text);

  if (nTrack) {
    if (hasPhrase(nTitle, nTrackFull) || hasPhrase(nTitle, nTrack)) score += 22;
    else if (hasWords(nTitle, nTrack)) score += 12;
    else return null;
    // Un título de una palabra muy corta («A», «Go», «7») está en medio mundo: hace falta que dure lo mismo.
    if (nTrack.length <= 3 && !UNSPACED.test(nTrack) && !(diff != null && diff <= 10)) return null;
    // El título del vídeo ES el de la canción (sin su artista, sus paréntesis ni
    // su «ft. …»), no solo lo contiene: «Stay», no «Stay With Me Tonight».
    const bare = title.replace(/\s*[([{【［][^)\]}】］]*[)\]}】］]/g, ' ').replace(/\s+(?:feat\.?|ft\.?|featuring)\s+.*$/i, '');
    if (withoutArtist(normalize(bare)) === nTrack) score += 8;
  } else if (!(diff != null && diff <= 3 && (inTitle || inChannel))) {
    // Un título sin letras («÷», «…»): solo con su artista y su duración exacta.
    return null;
  }

  // Otra versión: lo que diga el título del vídeo, fuera del nombre del artista,
  // que no esté en el título pedido.
  const asked = new Set(nTrackFull.match(OTHER_VERSION)?.map((word) => word.trim()) ?? []);
  if ((withoutArtist(nTitle).match(OTHER_VERSION) ?? []).some((word) => !asked.has(word.trim()))) return null;

  if (artists.length > 0) {
    if (inTitle || inChannel) score += 10 + (inChannel ? 12 : 0);
    // Un canal «Artista - Topic» de otro artista es otra canción con el mismo título.
    else if (topic) return null;
    else score -= 45;
  }

  // «Topic» es el audio del disco: si no dura lo mismo, es otra grabación.
  if (topic) score += diff != null && diff > 10 ? -20 : 35;
  if (hasPhrase(nTitle, 'official audio') || hasPhrase(nTitle, 'audio oficial')) score += 15;
  else if (hasPhrase(nTitle, 'official video') || hasPhrase(nTitle, 'video oficial') || hasPhrase(nTitle, 'official music video')) score += 6;
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

/**
 * ¿El resultado es la misma canción del mismo artista? Con las mismas reglas
 * que las letras (yt-mp3-lyrics.ts): el título entero o casi («Help!» no es
 * «With a Little Help from My Friends»), en cualquier alfabeto.
 */
function matches(song: { title: string; artist: string }, candTitle: string, candArtist: string): boolean {
  return titleMatches(song.title, candTitle) && artistMatches(song.artist, candArtist);
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
