import { useSyncExternalStore } from 'react';
import {
  COVER_BYTES_GUESS,
  EngineClient,
  EngineTimeout,
  LYRICS_BYTES_GUESS,
  mp3Bytes,
  safeFileName,
  songBytes,
  SOURCE_BYTES_PER_SECOND,
  thumbnailUrl,
  watchUrl,
  youtubeId,
  type CsvSong,
  type EngineJob,
  type EngineVideo,
  type SongOrder,
} from '@/lib/extensions/yt-mp3';
import { MIN_ENGINE, ensureEngine, versionBelow } from '@/lib/extensions/engine-app';
import { cleanTitle, findSongLyrics, firstArtist } from '@/lib/extensions/yt-mp3-lyrics';
import { findOfficialRelease, findSongVideo, songOfVideo, squareFromThumbnail } from '@/lib/extensions/yt-mp3-match';
import { memorySource, planMusicImport, releaseMemorySource, storeImportedSongs } from '@/lib/music-import';
import { getImage, saveImage } from '@/lib/music-db';
import { foldName } from '@/lib/song-names';
import { trackEvent } from '@/lib/telemetry';
import { decimalText, errorText, tr } from '@/lib/i18n';
import type { Playlist, Song } from '@/types';

// ============================================================
// Cola de descargas de Música (1.8.1).
//
// Con una fuente «yt-mp3/1» (un programa de descargas de este equipo), Música
// → «+ Añadir» llena esta cola: vídeos de YouTube añadidos uno a uno o las
// canciones de un CSV. Vive fuera de la ventana: cerrar «+ Añadir» o cambiar
// de interfaz no detiene nada, y lo pendiente sigue al volver a abrir Frame.
//
// Cada canción:
//   1. se prepara aquí: su vídeo (CSV sin enlace), su título y artista, su
//      portada oficial y su letra oficial (sincronizada si la hay);
//   2. se pide al programa en MP3 de 320 kbps con todo eso dentro;
//   3. al terminar, Frame recoge el archivo (/file) y lo importa con la
//      importación de siempre (sin duplicados), y la de un CSV entra en su
//      playlist, en el orden del CSV.
//
// Hasta 4 canciones a la vez entre preparar y bajar (el programa baja dos a
// la vez). Pausar detiene el programa y la preparación; reanudar sigue donde
// iba (el programa continúa el archivo a medias).
//
// Desde la 1.9.2 un enlace mete hasta mil canciones de un clic, así que la
// cola se cuida sola:
//   · la misma canción no entra dos veces, ni se baja a la vez por dos listas;
//   · lo que ya bajó una vez se reconoce aunque el vídeo dure distinto que en
//     la lista (índice de lo descargado, por perfil y en este equipo);
//   · una descarga que falla se reintenta sola dos veces, con espera; lo que
//     no tiene arreglo (vídeo privado o retirado) no se reintenta;
//   · si varias seguidas fallan, o el equipo se queda sin espacio, la cola se
//     pausa y dice por qué, en vez de quemar la lista entera; sin conexión,
//     espera;
//   · una canción cuya preparación no llega a tiempo tres veces se da por
//     fallida: el lote siempre termina;
//   · «Cancelar todo» la vacía de una vez.
//
// La cola es de cada perfil (localStorage `musicDownloads_<uid>`).
// ============================================================

export type DownloadState =
  /** Tarjeta añadida, sin empezar. */
  | 'pending'
  /** Empezada: espera su turno. */
  | 'waiting'
  /** Buscando su vídeo, su portada y su letra. */
  | 'resolving'
  /** Pedida al programa: espera un hueco allí. */
  | 'queued'
  | 'downloading'
  /** A MP3 y con sus etiquetas. */
  | 'converting'
  /** Entrando en la biblioteca. */
  | 'importing'
  | 'done'
  /** Ya estaba en la biblioteca: no se baja. */
  | 'skipped'
  /** CSV: ningún vídeo es una versión fiable. */
  | 'nomatch'
  | 'failed';

export interface DownloadItem {
  id: string;
  /** Extensión (fuente de música) que la descarga. */
  sourceId: string;
  origin: 'video' | 'csv';
  /** Lote en que se empezó (0: sin empezar). */
  batch: number;
  videoId?: string;
  /** Como se ve en YouTube. */
  videoTitle?: string;
  channel?: string;
  /** Imagen de la tarjeta: la miniatura del vídeo o la portada del CSV. */
  image?: string;
  /** Segundos. */
  duration?: number;
  // La canción
  title: string;
  artist: string;
  album?: string;
  albumArtist?: string;
  track?: number;
  year?: number;
  spotifyId?: string;
  /** Portada que trae el CSV. */
  coverUrl?: string;
  /** Playlist a la que va (la del CSV). */
  playlist?: string;
  /** Posición en el CSV. */
  order?: number;
  /** Ya se leyó del programa (título y artista de YouTube Music, duración exacta, peso del audio). */
  probed?: boolean;
  // Pesos
  /** Bytes del audio de origen (lo que se baja). */
  sourceBytes?: number;
  coverBytes?: number;
  lyricsBytes?: number;
  synced?: boolean;
  hasCover?: boolean;
  /** La portada es la del álbum (no la imagen del vídeo). */
  officialCover?: boolean;
  hasLyrics?: boolean;
  /** Lo que ocupa de verdad al terminar (MP3 y .lrc). */
  finalBytes?: number;
  // Avance
  job?: number;
  state: DownloadState;
  /** 0–1 del programa: hasta 0,9 la descarga, luego conversión y etiquetas. */
  progress: number;
  downloaded: number;
  /** Bytes por segundo de esta canción. */
  speed: number;
  fileName?: string;
  /** Id en la biblioteca. */
  songId?: string;
  error?: string;
  /** Veces que el programa falló al bajarla (se reintenta sola hasta `MAX_ATTEMPTS`). */
  attempts?: number;
  /** Veces que prepararla (su vídeo, su portada, su letra) no llegó a tiempo. */
  slow?: number;
  /** No se vuelve a intentar antes de este momento (ms). */
  retryAt?: number;
  addedAt: number;
  /** Cuándo empezó en el programa y cuándo llegó el primer byte (yt-dlp tarda en arrancar). */
  startedAt?: number;
  firstByteAt?: number;
  downloadEndedAt?: number;
  finishedAt?: number;
}

export type DownloadProblem = 'engine' | 'outdated' | 'extension' | 'offline' | null;

/** Por qué se pausó sola: varias descargas seguidas fallaron, o el equipo se quedó sin espacio. */
export type SelfPause = 'failing' | 'storage';

export interface DownloadsSnapshot {
  items: DownloadItem[];
  paused: boolean;
  /** La pausa la puso la propia cola (y su motivo, para decirlo). Se va al reanudar. */
  pausedWhy?: SelfPause;
  pausedDetail?: string;
  /** Velocidad de descarga de todo junto (B/s), suavizada. */
  speed: number;
  /** Algo impide seguir: el programa no responde, es viejo, la extensión está apagada o no hay conexión. */
  problem: DownloadProblem;
  /** Segundos de cada canción aparte de bajar, aprendidos: hasta el primer byte (yt-dlp arrancando) y tras bajar (conversión e importación). */
  startupSeconds: number;
  finishSeconds: number;
  /** El lote en curso (el último empezado). */
  batch: number;
  /** El último lote ya cerrado (avisado). */
  finalized: number;
}

const STORAGE_PREFIX = 'musicDownloads_';
const IN_FLIGHT = 4;
const TICK_MS = 1000;
/** Duración supuesta si no se sabe. */
const DEFAULT_SECONDS = 210;
/** Canciones que el programa baja a la vez. */
const ENGINE_LANES = 2;
/** Supuestos hasta aprender los de este equipo (segundos). */
const STARTUP_GUESS = 15;
const FINISH_GUESS = 6;
/** Intentos de bajar una canción (el primero y dos más), y lo que espera cada reintento. */
const MAX_ATTEMPTS = 3;
const RETRY_WAIT_MS = [20_000, 90_000];
/** Veces que la preparación de una canción puede no llegar a tiempo. */
const MAX_SLOW = 3;
/** Descargas seguidas que fallan (sin ninguna bien entre medias) antes de pausarse sola. */
const FAIL_STREAK = 4;
/**
 * Fallos sin arreglo (mensajes de yt-dlp): reintentar no cambia nada, y no
 * dicen nada de la conexión.
 */
const PERMANENT_FAILURE =
  /private video|video unavailable|is unavailable|not available|has been removed|removed by|deleted|terminated|copyright|members[- ]only|join this channel|age[- ]restricted|confirm your age|unsupported url|premieres in|v[ií]deo privado|no est[aá] disponible|eliminado/i;

const ACTIVE: ReadonlySet<DownloadState> = new Set(['waiting', 'resolving', 'queued', 'downloading', 'converting', 'importing']);
const IN_ENGINE: ReadonlySet<DownloadState> = new Set(['queued', 'downloading', 'converting']);

export const isActive = (item: DownloadItem) => ACTIVE.has(item.state);
export const isFinished = (item: DownloadItem) =>
  item.state === 'done' || item.state === 'skipped' || item.state === 'nomatch' || item.state === 'failed';

// ------------------------------------------------------------
// Estado
// ------------------------------------------------------------

const empty = (): DownloadsSnapshot => ({
  items: [],
  paused: false,
  speed: 0,
  problem: null,
  startupSeconds: STARTUP_GUESS,
  finishSeconds: FINISH_GUESS,
  batch: 0,
  finalized: 0,
});

let state: DownloadsSnapshot = empty();
let uid: string | null = null;
const listeners = new Set<() => void>();

function set(next: Partial<DownloadsSnapshot>, persist = true) {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
  if (persist) scheduleSave();
}

function patch(id: string, changes: Partial<DownloadItem>) {
  if (!state.items.some((item) => item.id === id)) return;
  set({ items: state.items.map((item) => (item.id === id ? { ...item, ...changes } : item)) });
}

const find = (id: string) => state.items.find((item) => item.id === id);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useDownloads = (): DownloadsSnapshot => useSyncExternalStore(subscribe, () => state, () => state);


// ------------------------------------------------------------
// Guardado (por perfil)
// ------------------------------------------------------------

let saveTimer = 0;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = window.setTimeout(save, 1500);
}

function save() {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
  if (!uid) return;
  const items = state.items.map((item) => ({ ...item, speed: 0 }));
  try {
    if (items.length === 0) localStorage.removeItem(STORAGE_PREFIX + uid);
    else
      localStorage.setItem(
        STORAGE_PREFIX + uid,
        JSON.stringify({
          items,
          paused: state.paused,
          pausedWhy: state.pausedWhy,
          pausedDetail: state.pausedDetail,
          batch: state.batch,
          finalized: state.finalized,
          startupSeconds: state.startupSeconds,
          finishSeconds: state.finishSeconds,
        })
      );
  } catch {
    /* sin espacio: la cola sigue en memoria */
  }
}

function load(profile: string): DownloadsSnapshot {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_PREFIX + profile) ?? 'null') as Partial<DownloadsSnapshot> | null;
    if (!raw || !Array.isArray(raw.items)) return empty();
    const pausedWhy = raw.paused && (raw.pausedWhy === 'failing' || raw.pausedWhy === 'storage') ? raw.pausedWhy : undefined;
    return {
      ...empty(),
      paused: !!raw.paused,
      ...(pausedWhy ? { pausedWhy, pausedDetail: typeof raw.pausedDetail === 'string' ? raw.pausedDetail : undefined } : {}),
      batch: Number(raw.batch) || 0,
      finalized: Number(raw.finalized) || 0,
      startupSeconds: Number(raw.startupSeconds) || STARTUP_GUESS,
      finishSeconds: Number(raw.finishSeconds) || FINISH_GUESS,
      // Lo que se estaba preparando se vuelve a preparar.
      items: raw.items.map((item) => ({ ...item, speed: 0, state: item.state === 'resolving' ? 'waiting' : item.state })),
    };
  } catch {
    return empty();
  }
}

// ------------------------------------------------------------
// Biblioteca
// ------------------------------------------------------------

// (Una fila de una lista puede venir sin artista, o sin título: nunca `undefined` a `foldName`.)
const songKey = (title: string | undefined) => foldName(cleanTitle(title ?? ''));
const artistKey = (artist: string | undefined) => foldName(firstArtist(artist ?? '') || (artist ?? ''));

/** Lo que identifica una canción pedida. */
export interface WantedSong {
  title: string;
  artist: string;
  /** Segundos, si se sabe. */
  duration?: number;
  videoId?: string;
  spotifyId?: string;
}

const wantedOf = (item: DownloadItem): WantedSong => ({
  title: item.title,
  artist: item.artist,
  duration: item.duration,
  videoId: item.videoId,
  spotifyId: item.spotifyId,
});

/** La duración es la misma (±3 s), o alguna no se sabe. */
const sameLength = (a: number | undefined, b: number | undefined) => !a || !b || Math.abs(a - b) <= 3;

/**
 * Canciones ya vistas: la misma se reconoce por su vídeo, por su id de Spotify
 * o por su título, su primer artista y su duración. Solo con el título no
 * basta («Intro» hay muchas), y con otra duración es otra versión.
 */
class SongSet {
  private readonly videos = new Set<string>();
  private readonly spotify = new Set<string>();
  private readonly named = new Map<string, (number | undefined)[]>();

  private static name(wanted: WantedSong): string | null {
    const title = songKey(wanted.title);
    const artist = artistKey(wanted.artist);
    return title && artist ? `${title}|${artist}` : null;
  }

  has(wanted: WantedSong): boolean {
    if (wanted.videoId && this.videos.has(wanted.videoId)) return true;
    if (wanted.spotifyId && this.spotify.has(wanted.spotifyId)) return true;
    const name = SongSet.name(wanted);
    return !!name && !!this.named.get(name)?.some((duration) => sameLength(duration, wanted.duration));
  }

  add(wanted: WantedSong) {
    if (wanted.videoId) this.videos.add(wanted.videoId);
    if (wanted.spotifyId) this.spotify.add(wanted.spotifyId);
    const name = SongSet.name(wanted);
    if (name) this.named.set(name, [...(this.named.get(name) ?? []), wanted.duration]);
  }
}

// ------------------------------------------------------------
// Lo ya descargado (por perfil, en este equipo)
// ------------------------------------------------------------
// Qué canción de la biblioteca salió de cada pedido. «Ya está en tu
// biblioteca» se decide por título, artista y duración (±3 s), pero el vídeo
// que se baja puede durar distinto que la canción en la lista (un vídeo
// oficial con su introducción): sin este índice, esas se volverían a bajar
// cada vez que se relee la lista. Va con lo demás de Música (IndexedDB), no en
// localStorage, y no viaja: lo descargado es de este equipo.

const INDEX_PREFIX = 'musicDownloaded_';
const INDEX_LIMIT = 9000;
/** Clave del pedido → id de la canción en la biblioteca. */
let downloaded = new Map<string, string>();
let indexTimer = 0;

/** Las claves exactas de un pedido: su vídeo, su id de Spotify, y su título con su artista y su duración. */
function requestKeys(wanted: WantedSong): string[] {
  const keys: string[] = [];
  if (wanted.videoId) keys.push(`v:${wanted.videoId}`);
  if (wanted.spotifyId) keys.push(`s:${wanted.spotifyId}`);
  const title = songKey(wanted.title);
  const artist = artistKey(wanted.artist);
  if (title && artist) keys.push(`t:${title}|${artist}|${Math.round(wanted.duration ?? 0)}`);
  return keys;
}

async function loadDownloaded(profile: string) {
  const raw = await getImage(INDEX_PREFIX + profile).catch(() => null);
  if (uid !== profile || !raw) return;
  try {
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    const stored = list.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string');
    // (Lo anotado mientras se leía, encima.)
    downloaded = new Map([...stored, ...downloaded]);
  } catch {
    /* un índice ilegible se rehace solo */
  }
}

function saveDownloaded() {
  window.clearTimeout(indexTimer);
  indexTimer = 0;
  if (uid) void saveImage(INDEX_PREFIX + uid, JSON.stringify([...downloaded])).catch(() => undefined);
}

function rememberDownloaded(wanted: WantedSong, songId: string) {
  for (const key of requestKeys(wanted)) {
    downloaded.delete(key);
    downloaded.set(key, songId);
  }
  for (const key of downloaded.keys()) {
    if (downloaded.size <= INDEX_LIMIT) break;
    downloaded.delete(key);
  }
  indexTimer ||= window.setTimeout(saveDownloaded, 2000);
}

/**
 * Para preguntar muchas veces por la misma biblioteca (el resumen de una lista
 * de mil canciones): ¿ya está esta canción? Primero, lo que ya se descargó
 * para ese mismo pedido; si no, por título y primer artista, y duración
 * (±3 s) si se sabe.
 */
export function libraryMatcher(songs: Song[]): (wanted: WantedSong) => Song | undefined {
  const byId = new Map(songs.map((song) => [song.id, song]));
  const byTitle = new Map<string, Song[]>();
  for (const song of songs) {
    const key = songKey(song.title);
    if (!key) continue;
    const same = byTitle.get(key);
    if (same) same.push(song);
    else byTitle.set(key, [song]);
  }
  return (wanted) => {
    for (const key of requestKeys(wanted)) {
      const song = byId.get(downloaded.get(key) ?? '');
      if (song) return song;
    }
    const title = songKey(wanted.title);
    const artist = artistKey(wanted.artist);
    if (!title || (!artist && !wanted.duration)) return undefined;
    return byTitle.get(title)?.find((song) => (!artist || artistKey(song.artist) === artist) && sameLength(song.duration, wanted.duration));
  };
}

/** La misma canción ya en la biblioteca (ver `libraryMatcher`). */
function findInLibrary(songs: Song[], title: string, artist: string, duration?: number): Song | undefined {
  return libraryMatcher(songs)({ title, artist, duration });
}

// ------------------------------------------------------------
// Lo que Frame le presta a la cola (el contexto de la biblioteca)
// ------------------------------------------------------------

export interface DownloadsHost {
  uid: string;
  /** El programa de una fuente, o null si la extensión ya no está activa. */
  clientFor: (sourceId: string) => EngineClient | null;
  songs: () => Song[];
  addSongs: (songs: Song[]) => Promise<void>;
  mergePlaylistSongs: (name: string, songIds: string[]) => void;
  playlists: () => Playlist[];
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void;
  /** Al cerrar un lote: lo que pasó, para avisar. */
  finished: (summary: { done: number; skipped: number; failed: number }) => void;
}

let host: DownloadsHost | null = null;
let timer = 0;

export function attachDownloads(next: DownloadsHost): () => void {
  if (uid !== next.uid) {
    if (uid) {
      save();
      if (indexTimer) saveDownloaded();
    }
    // (Lo que quedaba por contar era del perfil anterior: no se le apunta a este.)
    uncounted = 0;
    uid = next.uid;
    prepared.clear();
    lastDownloaded.clear();
    failStreak = 0;
    streak.clear();
    downloaded = new Map();
    void loadDownloaded(next.uid);
    state = load(next.uid);
    listeners.forEach((listener) => listener());
  }
  host = next;
  window.clearInterval(timer);
  timer = window.setInterval(() => void tick(), TICK_MS);
  const keep = () => {
    save();
    if (indexTimer) saveDownloaded();
  };
  // Al cerrar Frame, además, lo que quedaba por contar (al cambiar de perfil
  // no: ya no se sabría de quién es).
  const leaving = () => {
    keep();
    flushDownloadCount();
  };
  window.addEventListener('pagehide', leaving);
  return () => {
    if (host === next) host = null;
    window.clearInterval(timer);
    window.removeEventListener('pagehide', leaving);
    keep();
  };
}

// ------------------------------------------------------------
// Acciones de la interfaz
// ------------------------------------------------------------

/** Una tarjeta con el vídeo abierto en YouTube. null si ya estaba en la cola. */
export function addVideoDownload(sourceId: string, videoId: string): DownloadItem | null {
  if (state.items.some((item) => item.videoId === videoId && (item.state === 'pending' || isActive(item)))) return null;
  const item: DownloadItem = {
    id: crypto.randomUUID(),
    sourceId,
    origin: 'video',
    batch: 0,
    videoId,
    image: thumbnailUrl(videoId),
    title: '',
    artist: '',
    state: 'pending',
    progress: 0,
    downloaded: 0,
    speed: 0,
    addedAt: Date.now(),
  };
  set({ items: [...state.items, item] });
  return item;
}

/** Lo que se sabe del vídeo al momento (título, canal, duración). */
export function describeDownload(id: string, info: { videoTitle?: string; channel?: string; duration?: number }) {
  const item = find(id);
  if (!item) return;
  patch(id, {
    ...(info.videoTitle ? { videoTitle: info.videoTitle } : {}),
    ...(info.channel ? { channel: info.channel } : {}),
    ...(info.duration && !item.duration ? { duration: info.duration } : {}),
  });
}

/**
 * Las canciones de un CSV (o de una lista leída de su enlace), ya empezadas.
 * No entran las que ya esperan o bajan para esa misma playlist, ni las
 * repetidas dentro de la propia lista: devuelve cuántas entraron y cuántas no.
 */
export function addCsvDownloads(sourceId: string, songs: CsvSong[], playlist: string): { added: number; repeated: number } {
  const now = Date.now();
  const listKey = playlist.trim().toLowerCase();
  const seen = new SongSet();
  for (const item of state.items) {
    if ((item.state === 'pending' || isActive(item)) && (item.playlist ?? '').trim().toLowerCase() === listKey) seen.add(wantedOf(item));
  }
  const items: DownloadItem[] = [];
  let repeated = 0;
  songs.forEach((song, index) => {
    const videoId = song.url ? youtubeId(song.url) ?? undefined : undefined;
    // De una lista de YouTube: va como un vídeo añadido a mano (la canción,
    // con su título y artista, la dice YouTube Music al empezar).
    const video = !!song.fromYouTube && !!videoId;
    const title = video ? '' : song.title ?? '';
    const artist = video ? '' : song.artist ?? '';
    const wanted: WantedSong = { title, artist, duration: song.duration, videoId, spotifyId: song.spotifyId };
    if (seen.has(wanted)) {
      repeated += 1;
      return;
    }
    seen.add(wanted);
    items.push({
      id: crypto.randomUUID(),
      sourceId,
      origin: video ? 'video' : 'csv',
      batch: 0,
      videoId,
      ...(video ? { videoTitle: song.title ?? '', channel: song.artist ?? '' } : {}),
      image: song.cover ?? (videoId ? thumbnailUrl(videoId) : undefined),
      title,
      artist,
      album: song.album,
      albumArtist: song.albumArtist,
      track: song.track,
      year: song.year,
      spotifyId: song.spotifyId,
      coverUrl: song.cover,
      duration: song.duration,
      playlist,
      // (La posición en la lista, con sus huecos: es el orden de la playlist.)
      order: index,
      state: 'pending',
      progress: 0,
      downloaded: 0,
      speed: 0,
      addedAt: now,
    });
  });
  if (items.length > 0) {
    set({ items: [...state.items, ...items] });
    startDownloads();
  }
  return { added: items.length, repeated };
}

/**
 * Lee el vídeo de una tarjeta en el programa (título y artista de YouTube
 * Music, duración exacta y peso del audio): el peso de la tarjeta deja de
 * ser una estimación por la duración. Si el programa no responde, se lee al
 * empezar la descarga.
 */
export async function probeDownload(id: string) {
  const item = find(id);
  const client = item?.videoId ? host?.clientFor(item.sourceId) : null;
  if (!item?.videoId || !client || item.probed) return;
  const info = await client.info(watchUrl(item.videoId)).catch(() => null);
  if (!info || !find(id)) return;
  applyInfo(id, info, true);
}

/** Lo que dice el programa de un vídeo, en su tarjeta. */
function applyInfo(id: string, info: EngineVideo, renameSong: boolean) {
  const item = find(id);
  if (!item) return;
  const named = songOfVideo(info);
  patch(id, {
    probed: true,
    ...(renameSong || !item.title ? { title: named.title || item.title } : {}),
    ...(renameSong || !item.artist ? { artist: named.artist || item.artist || info.channel || '' } : {}),
    ...(!item.album && info.album ? { album: info.album } : {}),
    ...(!item.year && info.year ? { year: info.year } : {}),
    ...(info.audioSize ? { sourceBytes: info.audioSize } : {}),
    ...(info.duration ? { duration: info.duration } : {}),
    ...(!item.videoTitle && info.title ? { videoTitle: info.title } : {}),
    ...(!item.channel && info.channel ? { channel: info.channel } : {}),
  });
}

/** «Iniciar descarga»: empieza todo lo que estaba sin empezar. */
export function startDownloads() {
  const busy = state.items.some(isActive);
  let batch = state.batch;
  let items = state.items;
  if (!busy) {
    // Lote nuevo: lo terminado de los anteriores sale de la cola.
    batch += 1;
    items = items.filter((item) => item.state === 'pending');
  }
  items = items.map((item) => (item.state === 'pending' ? { ...item, state: 'waiting' as const, batch } : item));
  unpause();
  set({ items, batch });
  void tick();
}

/** Fuera la pausa (la del usuario o la que la cola se puso sola), con la cuenta de fallos a cero. */
function unpause() {
  failStreak = 0;
  streak.clear();
  if (state.paused || state.pausedWhy) set({ paused: false, pausedWhy: undefined, pausedDetail: undefined });
}

/** Detiene en el programa lo que esté bajando. */
async function pauseJobs() {
  for (const item of state.items) {
    const client = item.job ? host?.clientFor(item.sourceId) : null;
    if (client && item.job && IN_ENGINE.has(item.state)) await client.pause(item.job).catch(() => undefined);
  }
}

export async function pauseDownloads() {
  set({ paused: true, pausedWhy: undefined, pausedDetail: undefined });
  await pauseJobs();
}

/**
 * La cola se pausa sola y dice por qué. Lo que se dio por fallido en esta
 * racha vuelve a la espera: al reanudar se intenta otra vez, desde cero.
 */
function pauseItself(why: SelfPause, detail: string) {
  // (Ya en pausa: solo se anota el motivo si es la falta de espacio, que además detiene la importación.)
  if (state.paused && (why !== 'storage' || state.pausedWhy === 'storage')) return;
  const again = new Set(streak);
  streak.clear();
  failStreak = 0;
  set({
    paused: true,
    pausedWhy: why,
    pausedDetail: detail.slice(0, 200),
    items: state.items.map((item) =>
      again.has(item.id) && item.state === 'failed'
        ? { ...item, state: 'waiting' as const, job: undefined, attempts: 0, retryAt: undefined, finishedAt: undefined, progress: 0, downloaded: 0, speed: 0 }
        : item
    ),
  });
  void pauseJobs();
}

export async function resumeDownloads() {
  unpause();
  // (Lo que esperaba su reintento ya esperó de sobra.)
  set({ paused: false, items: state.items.map((item) => (item.retryAt ? { ...item, retryAt: undefined } : item)) });
  for (const item of state.items) {
    const client = item.job ? host?.clientFor(item.sourceId) : null;
    if (client && item.job && IN_ENGINE.has(item.state)) await client.resume(item.job).catch(() => undefined);
  }
  void tick();
}

/** Lo de una canción que la cola guarda fuera de su tarjeta. */
function forget(item: DownloadItem) {
  const client = item.job ? host?.clientFor(item.sourceId) : null;
  if (client && item.job && (IN_ENGINE.has(item.state) || item.state === 'importing')) void client.cancel(item.job).catch(() => undefined);
  prepared.delete(item.id);
  lastDownloaded.delete(item.id);
  streak.delete(item.id);
}

/** Quita una tarjeta (y, si estaba bajando, la cancela en el programa). */
export function removeDownload(id: string) {
  const item = find(id);
  if (!item) return;
  forget(item);
  set({ items: state.items.filter((other) => other.id !== id) });
}

/**
 * «Cancelar todo»: fuera de la cola lo que no ha terminado (y cancelado en el
 * programa lo que estuviera bajando). Lo ya descargado se queda en la
 * biblioteca y en la cola, como terminado. Devuelve cuántas se quitaron.
 */
export function cancelDownloads(): number {
  const going = state.items.filter((item) => item.state === 'pending' || isActive(item));
  if (going.length === 0) return 0;
  going.forEach(forget);
  const gone = new Set(going.map((item) => item.id));
  failStreak = 0;
  set({ items: state.items.filter((item) => !gone.has(item.id)), paused: false, pausedWhy: undefined, pausedDetail: undefined, speed: 0 });
  void tick();
  return going.length;
}

/** Las que fallaron (o no se encontraron), otra vez. */
export function retryDownloads(ids?: string[]) {
  const again = (item: DownloadItem) => (item.state === 'failed' || item.state === 'nomatch') && (!ids || ids.includes(item.id));
  if (!state.items.some(again)) return;
  const busy = state.items.some(isActive);
  const batch = busy ? state.batch : state.batch + 1;
  unpause();
  set({
    batch,
    items: state.items.map((item) =>
      again(item)
        ? {
            ...item,
            state: 'waiting' as const,
            batch,
            error: undefined,
            job: undefined,
            attempts: 0,
            slow: 0,
            retryAt: undefined,
            progress: 0,
            downloaded: 0,
            speed: 0,
            startedAt: undefined,
            firstByteAt: undefined,
            downloadEndedAt: undefined,
            finishedAt: undefined,
          }
        : item
    ),
  });
  void tick();
}

/** Fuera de la cola lo terminado (bien o mal). */
export function clearFinishedDownloads() {
  set({ items: state.items.filter((item) => !isFinished(item)) });
}

/** La página de «+ Añadir» de Música (1.9.0; antes, una ventana emergente). */
export const MUSIC_ADD_ROUTE = '/music/anadir';

// ------------------------------------------------------------
// Pesos, avance y tiempo
// ------------------------------------------------------------

/** Lo que ocupará (o ya ocupa) en disco: MP3 de 320 kbps con portada, letra y datos, y su .lrc. */
export function itemBytes(item: DownloadItem): number {
  if (item.finalBytes) return item.finalBytes;
  return songBytes(item.duration ?? DEFAULT_SECONDS, item.coverBytes, item.lyricsBytes, item.lyricsBytes ? !!item.synced : true);
}

/** El peso de una canción por partes (lo que aún no se sabe, estimado). */
export function sizeParts(item: DownloadItem) {
  const seconds = item.duration ?? DEFAULT_SECONDS;
  const lyrics = item.lyricsBytes ?? LYRICS_BYTES_GUESS;
  return {
    audio: mp3Bytes(seconds),
    cover: item.coverBytes ?? COVER_BYTES_GUESS,
    lyrics: lyrics * (item.lyricsBytes != null && !item.synced ? 1 : 2),
    total: itemBytes(item),
    /** Duración, portada y letra ya conocidas (o el archivo terminado). */
    exact: !!item.finalBytes || (!!item.duration && item.coverBytes != null && item.lyricsBytes != null),
    durationKnown: !!item.duration,
  };
}

/** Peso legible con un decimal (8,6 MB; 1,24 GB). */
export function preciseBytes(value: number): string {
  if (value >= 1024 ** 3) return `${decimalText(value / 1024 ** 3, 2)} GB`;
  if (value >= 1024 ** 2) return `${decimalText(value / 1024 ** 2, 1)} MB`;
  return `${value > 0 ? Math.max(1, Math.round(value / 1024)) : 0} KB`;
}

/** Tiempo que falta, corto: «45 s», «3 min 20 s», «1 h 5 min». */
export function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return tr('{s} s', { s });
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return s % 60 && minutes < 10 ? tr('{m} min {s} s', { m: minutes, s: s % 60 }) : tr('{m} min', { m: minutes });
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? tr('{h} h {m} min', { h: hours, m: minutes % 60 }) : tr('{h} h', { h: hours });
}

/** Bytes de origen que faltan por bajar. */
function sourceLeft(item: DownloadItem): number {
  const total = item.sourceBytes ?? Math.round((item.duration ?? DEFAULT_SECONDS) * SOURCE_BYTES_PER_SECOND);
  return Math.max(0, total - (item.downloaded || 0));
}

/** Segundos fijos que le quedan a una canción aparte de bajar: arrancar yt-dlp, convertir e importar. */
function overheadLeft(item: DownloadItem, snapshot: DownloadsSnapshot, now: number): number {
  const { startupSeconds: startup, finishSeconds: finish } = snapshot;
  switch (item.state) {
    case 'downloading':
      return (item.firstByteAt ? 0 : Math.max(1, startup - (now - (item.startedAt ?? now)) / 1000)) + finish;
    case 'converting':
      return Math.max(1, finish - (now - (item.downloadEndedAt ?? now)) / 1000);
    case 'importing':
      return 1;
    default:
      return startup + finish;
  }
}

/** Avance de una canción, 0–1 (descargar es el 90 %; convertir e importar, el resto). */
export function itemProgress(item: DownloadItem): number {
  switch (item.state) {
    case 'done':
    case 'skipped':
      return 1;
    case 'importing':
      return 0.97;
    case 'converting':
      return 0.92;
    case 'downloading':
    case 'queued': {
      const total = item.sourceBytes ?? 0;
      if (total > 0) return 0.9 * Math.min(1, item.downloaded / total);
      return Math.min(0.9, item.progress);
    }
    default:
      return 0;
  }
}

export interface DownloadSummary {
  /** Canciones del lote en curso. */
  total: number;
  done: number;
  skipped: number;
  failed: number;
  nomatch: number;
  remaining: number;
  active: boolean;
  /** 0–1, por peso. */
  progress: number;
  /** Lo que pesarán todas las que se bajan (las ya terminadas, su peso real). */
  totalBytes: number;
  doneBytes: number;
  /** Algún peso es todavía una estimación. */
  estimated: boolean;
  /** Segundos que faltan; null mientras no hay velocidad medida. */
  eta: number | null;
  /** La que más avanza ahora. */
  current: DownloadItem | null;
  items: DownloadItem[];
}

export function summarizeDownloads(snapshot: DownloadsSnapshot): DownloadSummary {
  const items = snapshot.items.filter((item) => item.batch === snapshot.batch && item.batch > 0);
  const count = (stateName: DownloadState) => items.filter((item) => item.state === stateName).length;
  const remainingItems = items.filter(isActive);
  // Lo que se descarga: ni lo que ya estaba, ni lo que no se encontró o falló.
  const weighed = items.filter((item) => item.state !== 'skipped' && item.state !== 'nomatch' && item.state !== 'failed');
  let totalBytes = 0;
  let doneBytes = 0;
  let estimated = false;
  for (const item of weighed) {
    const bytes = itemBytes(item);
    totalBytes += bytes;
    doneBytes += bytes * itemProgress(item);
    if (!item.finalBytes) estimated = true;
  }
  const bytesLeft = remainingItems.filter((item) => item.state !== 'converting' && item.state !== 'importing').reduce((sum, item) => sum + sourceLeft(item), 0);
  // Lo que falta = lo que queda por bajar a la velocidad medida + lo fijo de
  // cada canción (arrancar yt-dlp, convertir, importar), repartido entre las
  // que el programa baja a la vez.
  const now = Date.now();
  const overhead = remainingItems.reduce((sum, item) => sum + overheadLeft(item, snapshot, now), 0);
  const eta =
    remainingItems.length === 0
      ? 0
      : snapshot.speed > 1
        ? bytesLeft / snapshot.speed + overhead / Math.min(ENGINE_LANES, remainingItems.length)
        : null;
  const current =
    [...remainingItems].filter((item) => item.state === 'downloading' || item.state === 'converting').sort((a, b) => itemProgress(b) - itemProgress(a))[0] ??
    remainingItems[0] ??
    null;
  return {
    total: items.length,
    done: count('done'),
    skipped: count('skipped'),
    failed: count('failed'),
    nomatch: count('nomatch'),
    remaining: remainingItems.length,
    active: remainingItems.length > 0,
    progress: totalBytes > 0 ? doneBytes / totalBytes : 0,
    totalBytes,
    doneBytes,
    estimated,
    eta,
    current,
    items,
  };
}

export type SpeedQuality = 'excelente' | 'muy-buena' | 'buena' | 'regular' | 'lenta' | 'muy-lenta';

/** Qué tal va la conexión, por los megabits por segundo. */
export function speedQuality(bytesPerSecond: number): SpeedQuality {
  const mbps = (bytesPerSecond * 8) / 1_000_000;
  if (mbps >= 100) return 'excelente';
  if (mbps >= 25) return 'muy-buena';
  if (mbps >= 10) return 'buena';
  if (mbps >= 3) return 'regular';
  if (mbps >= 1) return 'lenta';
  return 'muy-lenta';
}

// ------------------------------------------------------------
// El motor de la cola
// ------------------------------------------------------------

/** Lo preparado de cada canción (con su portada y su letra): sirve para repetir el pedido. */
const prepared = new Map<string, SongOrder>();
const preparing = new Set<string>();
let importing = false;
let ticking = false;
let lastSyncAt = 0;
/** Desde cuándo no llega nada mientras se baja (0: llega). */
let stalledSince = 0;
const lastDownloaded = new Map<string, number>();
let engineCheckedAt = 0;
/** Descargas que han fallado seguidas, sin ninguna bien entre medias, y cuáles se dieron por fallidas en esa racha. */
let failStreak = 0;
const streak = new Set<string>();
/** Canciones bajadas que aún no se han contado en las métricas (van de varias en varias), y desde cuándo. */
let uncounted = 0;
let uncountedSince = 0;

/** El programa no está (cerrado, o reiniciándose): `fetch` no llegó a hablar con él. */
const isNetworkError = (error: unknown) => error instanceof TypeError;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

/** Las descargas de la sesión, a las métricas: un evento con cuántas, no uno por canción (hay un tope diario de eventos). */
function flushDownloadCount() {
  if (uncounted <= 0) return;
  trackEvent('song_download', { n: uncounted });
  uncounted = 0;
}

/**
 * ¿Se puede hablar con el programa de esta fuente? Bien, se vuelve a mirar
 * cada 15 s; mal (cerrado o viejo), cada 4 s, para seguir en cuanto vuelva.
 * Mal, además, Frame lo abre, lo instala o lo pone al día solo (engine-app.ts).
 */
async function engineReady(client: EngineClient, sourceId: string): Promise<boolean> {
  const now = Date.now();
  const bad = state.problem === 'engine' || state.problem === 'outdated';
  if (!bad && state.problem !== 'extension' && now - engineCheckedAt < 15_000) return true;
  if (bad && now - engineCheckedAt < 4_000) return false;
  engineCheckedAt = now;
  try {
    const status = await client.status();
    if (versionBelow(status.version, MIN_ENGINE)) {
      if (state.problem !== 'outdated') set({ problem: 'outdated' }, false);
      void ensureEngine(sourceId, client);
      return false;
    }
    if (bad || state.problem === 'extension') set({ problem: null }, false);
    return true;
  } catch {
    if (state.problem !== 'engine') set({ problem: 'engine' }, false);
    void ensureEngine(sourceId, client);
    return false;
  }
}

async function tick() {
  if (!host || ticking) return;
  ticking = true;
  try {
    const active = state.items.filter(isActive);
    if (active.length === 0) {
      finalizeBatch();
      if (state.speed !== 0 || state.problem === 'offline') set({ speed: 0, ...(state.problem === 'offline' ? { problem: null } : {}) }, false);
      return;
    }
    // Una sola fuente en la práctica: la de la primera canción pendiente.
    const client = host.clientFor(active[0].sourceId);
    if (!client) {
      if (state.problem !== 'extension') set({ problem: 'extension' }, false);
      return;
    }
    if (!(await engineReady(client, active[0].sourceId))) return;

    await syncJobs(client);
    // Sin conexión no se empieza nada (fallaría una tras otra): la cola espera a que vuelva.
    const offline = isOffline();
    if (offline && state.problem === null) set({ problem: 'offline' }, false);
    else if (!offline && state.problem === 'offline') set({ problem: null }, false);
    if (!state.paused && !offline) dispatch(client);
    // (Sin espacio en el equipo no se importa: se reintenta al reanudar.)
    if (!importing && state.pausedWhy !== 'storage') {
      const next = state.items.find((item) => item.state === 'importing');
      if (next) void importItem(client, next);
    }
  } finally {
    ticking = false;
  }
}

/** Lo que dice el programa de cada trabajo: avance, velocidad, fin o error. */
async function syncJobs(client: EngineClient) {
  const tracked = state.items.filter((item) => item.job && IN_ENGINE.has(item.state));
  if (tracked.length === 0) {
    lastSyncAt = 0;
    return;
  }
  const asked = new Set(tracked.map((item) => item.job!));
  let jobs: EngineJob[];
  try {
    jobs = await client.jobs([...asked]);
  } catch {
    set({ problem: 'engine' }, false);
    engineCheckedAt = 0;
    return;
  }
  const byId = new Map(jobs.map((job) => [job.id, job]));
  let gained = 0;
  let transferring = false;
  const startupSamples: number[] = [];
  /** Lo que falló en esta vuelta (por si es una racha) y cuántas bajaron bien. */
  const failures: { id: string; error: string; final: boolean }[] = [];
  let succeeded = 0;
  const offline = isOffline();
  const now = Date.now();
  const elapsed = lastSyncAt ? (now - lastSyncAt) / 1000 : 0;
  lastSyncAt = now;
  const before = state.items;
  const items = before.map((item) => {
    // Lo pedido mientras se esperaba la respuesta se mira en la siguiente vuelta.
    if (!item.job || !IN_ENGINE.has(item.state) || !asked.has(item.job)) return item;
    const job = byId.get(item.job);
    if (!job) {
      // El programa se reinició: la canción se vuelve a pedir (lo preparado se reutiliza).
      lastDownloaded.delete(item.id);
      return {
        ...item,
        job: undefined,
        state: 'waiting' as const,
        progress: 0,
        downloaded: 0,
        speed: 0,
        startedAt: undefined,
        firstByteAt: undefined,
        downloadEndedAt: undefined,
      };
    }
    const seen = lastDownloaded.get(item.id) ?? item.downloaded;
    // Lo primero que llega no cuenta para la velocidad: al empezar, el tramo
    // medido incluye el arranque, y al reanudar, yt-dlp suma de golpe lo que ya
    // estaba en disco.
    const firstSeen = job.status === 'running' && !item.firstByteAt;
    if (job.downloaded > seen && !firstSeen) gained += job.downloaded - seen;
    lastDownloaded.set(item.id, job.downloaded);
    const next: DownloadItem = {
      ...item,
      progress: job.progress,
      downloaded: job.downloaded || item.downloaded,
      speed: job.speed || 0,
      ...(job.total && job.total > 0 ? { sourceBytes: job.total } : {}),
    };
    switch (job.status) {
      case 'queued':
        // (También al reanudar: el programa vuelve a arrancar yt-dlp.)
        return { ...next, state: 'queued' as const, startedAt: undefined, firstByteAt: undefined };
      case 'running': {
        const startedAt = item.startedAt ?? now;
        const flowing = job.downloaded > 0 || job.progress > 0;
        const firstByteAt = item.firstByteAt ?? (flowing ? now : undefined);
        // Lo que tardó yt-dlp en empezar a bajar (si se vio arrancar).
        if (firstByteAt && !item.firstByteAt && item.startedAt) startupSamples.push((firstByteAt - item.startedAt) / 1000);
        if (job.progress >= 0.899) {
          return { ...next, startedAt, firstByteAt: firstByteAt ?? now, state: 'converting' as const, speed: 0, downloadEndedAt: item.downloadEndedAt ?? now };
        }
        if (flowing) transferring = true;
        return { ...next, startedAt, firstByteAt, state: 'downloading' as const };
      }
      case 'paused':
        // Pausada en el programa sin que Frame lo pidiera (o al reanudar Frame): se reanuda.
        if (!state.paused) void client.resume(item.job).catch(() => undefined);
        return { ...next, speed: 0 };
      case 'done':
        lastDownloaded.delete(item.id);
        succeeded += 1;
        return {
          ...next,
          state: 'importing' as const,
          speed: 0,
          progress: 1,
          downloadEndedAt: item.downloadEndedAt ?? now,
          ...(job.size ? { finalBytes: job.size } : {}),
          ...(job.file ? { fileName: job.file.split(/[\\/]/).pop() } : {}),
        };
      case 'failed': {
        lastDownloaded.delete(item.id);
        const error = job.error || tr('La descarga falló.');
        if (PERMANENT_FAILURE.test(error)) return { ...next, state: 'failed' as const, speed: 0, error, finishedAt: now };
        // Sin conexión no cuenta como intento: no fue culpa de la canción.
        const attempts = (item.attempts ?? 0) + (offline ? 0 : 1);
        const final = attempts >= MAX_ATTEMPTS;
        if (!offline) failures.push({ id: item.id, error, final });
        if (final) return { ...next, state: 'failed' as const, speed: 0, error, attempts, finishedAt: now };
        // Se reintenta sola, tras una espera (lo preparado se reutiliza).
        return {
          ...next,
          state: 'waiting' as const,
          job: undefined,
          attempts,
          retryAt: now + (RETRY_WAIT_MS[attempts - 1] ?? RETRY_WAIT_MS[0]),
          error,
          progress: 0,
          downloaded: 0,
          speed: 0,
          startedAt: undefined,
          firstByteAt: undefined,
          downloadEndedAt: undefined,
        };
      }
      case 'cancelled':
        lastDownloaded.delete(item.id);
        return { ...next, state: 'failed' as const, speed: 0, error: tr('Se canceló en el programa de descargas.'), finishedAt: now };
      default:
        return next;
    }
  });
  // Velocidad de todo junto: media móvil de lo bajado en cada vuelta. Mientras
  // yt-dlp arranca, convierte o espera turno se queda la última medida; si lo
  // que baja se detiene más de 5 s, va cayendo.
  let speed = state.speed;
  if (gained > 0 && elapsed > 0) {
    const instant = gained / elapsed;
    speed = speed > 0 ? speed * 0.6 + instant * 0.4 : instant;
    stalledSince = 0;
  } else if (transferring) {
    stalledSince ||= now;
    if (now - stalledSince >= 5000) speed *= 0.6;
  } else {
    stalledSince = 0;
  }
  const startupSeconds = startupSamples.reduce((average, sample) => Math.min(120, Math.max(1, average * 0.7 + sample * 0.3)), state.startupSeconds);
  // Solo se guarda si algo cambió de estado (el avance se vuelve a leer del programa).
  const changed = items.some((item, index) => item !== before[index] && (item.state !== before[index].state || item.job !== before[index].job));
  // (El programa contestó: si el problema era él, ya no lo hay.)
  const problem = state.problem === 'engine' || state.problem === 'outdated' ? null : state.problem;
  set({ items, speed, problem, startupSeconds }, changed);

  // Una racha de fallos (YouTube frenando, la red a medias…): con una sola que
  // baje bien se olvida; si no, la cola se pausa en vez de quemar la lista.
  if (succeeded > 0) {
    failStreak = 0;
    streak.clear();
  }
  for (const failure of failures) {
    failStreak += 1;
    if (failure.final) streak.add(failure.id);
  }
  if (failStreak >= FAIL_STREAK && failures.length > 0) pauseItself('failing', failures[failures.length - 1].error);
}

/** Empieza (prepara y pide) las siguientes, hasta 4 a la vez. */
function dispatch(client: EngineClient) {
  // Lo que ya está en marcha: la misma canción (pedida por otra lista) no se
  // baja a la vez; espera, y al llegar su turno ya la encuentra en la biblioteca.
  const flying = new SongSet();
  let inFlight = 0;
  for (const item of state.items) {
    const busy = IN_ENGINE.has(item.state) || preparing.has(item.id);
    if (busy) inFlight += 1;
    if (busy || item.state === 'importing' || item.state === 'resolving') flying.add(wantedOf(item));
  }
  let free = IN_FLIGHT - inFlight;
  const now = Date.now();
  for (const item of state.items) {
    if (free <= 0) break;
    if (item.state !== 'waiting' || preparing.has(item.id)) continue;
    if (item.retryAt && item.retryAt > now) continue;
    const wanted = wantedOf(item);
    if (flying.has(wanted)) continue;
    flying.add(wanted);
    free -= 1;
    void prepare(client, item);
  }
}

/** Busca lo que falta de la canción y la pide al programa. */
async function prepare(client: EngineClient, start: DownloadItem) {
  const id = start.id;
  preparing.add(id);
  try {
    let order = prepared.get(id);
    if (!order) {
      patch(id, { state: 'resolving', error: undefined });
      const built = await buildOrder(client, start);
      if (!built) return;
      order = built;
      prepared.set(id, order);
    }
    if (!find(id)) return;
    if (state.paused) {
      patch(id, { state: 'waiting' });
      return;
    }
    const job = await client.song(order);
    if (!find(id)) {
      void client.cancel(job).catch(() => undefined);
      return;
    }
    patch(id, { job, state: 'queued', progress: 0, downloaded: 0, retryAt: undefined });
  } catch (error) {
    if (isNetworkError(error)) {
      set({ problem: 'engine' }, false);
      engineCheckedAt = 0;
      // Si el programa se cayó mientras se buscaban la portada y la letra,
      // el pedido pudo quedar sin ellas: se vuelve a preparar entero.
      prepared.delete(id);
      patch(id, { state: 'waiting' });
    } else if (error instanceof EngineTimeout) {
      // El programa está, pero no contestó a tiempo (YouTube lento, la red a
      // medias). Se intenta otra vez tras una espera, y a la tercera se deja:
      // sin tope, la canción volvería a la espera para siempre y el lote no cerraría.
      prepared.delete(id);
      const slow = (find(id)?.slow ?? 0) + (isOffline() ? 0 : 1);
      if (slow >= MAX_SLOW) patch(id, { state: 'failed', slow, error: tr('El programa de descargas tardó demasiado en responder.'), finishedAt: Date.now() });
      else patch(id, { state: 'waiting', slow, retryAt: Date.now() + 15_000 });
    } else {
      patch(id, { state: 'failed', error: errorText(error).slice(0, 200), finishedAt: Date.now() });
    }
  } finally {
    preparing.delete(id);
  }
}

/**
 * El pedido completo: vídeo, título y artista, portada oficial y letra
 * oficial. null si la canción no se baja (no se encontró o ya estaba).
 */
async function buildOrder(client: EngineClient, start: DownloadItem): Promise<SongOrder | null> {
  const id = start.id;
  const current = () => find(id) ?? start;

  // 1. Lo que ya está en la biblioteca no se busca ni se baja: una canción del
  //    CSV, por su título y artista; cualquiera, si ya se bajó por este mismo
  //    vídeo o esta misma canción de Spotify.
  if (((start.origin === 'csv' && start.title) || start.videoId || start.spotifyId) && alreadyHave(start, start.title, start.artist, start.duration)) {
    return null;
  }

  // 2. El vídeo de una canción del CSV sin enlace.
  /** La duración del audio que se baja (la de YouTube): la letra se ajusta a ella. */
  let audioSeconds: number | undefined;
  if (!start.videoId) {
    const found = await findSongVideo(client, { title: start.title, artist: start.artist, duration: start.duration ?? 0 });
    if (!found) {
      patch(id, { state: 'nomatch', finishedAt: Date.now() });
      return null;
    }
    audioSeconds = found.duration ?? undefined;
    patch(id, {
      videoId: found.id,
      videoTitle: found.title,
      channel: found.channel ?? undefined,
      image: start.image ?? thumbnailUrl(found.id),
      ...(!start.duration && found.duration ? { duration: found.duration } : {}),
    });
  }

  // 3. Un vídeo suelto (o una fila sin título o artista): lo que sabe YouTube
  //    Music de la canción, su duración exacta y el peso del audio.
  let item = current();
  if (!item.probed && (item.origin === 'video' || !item.title || !item.artist)) {
    const info = await client.info(watchUrl(item.videoId!)).catch(() => null);
    if (info) applyInfo(id, info, item.origin === 'video');
    else if (item.origin === 'video') {
      const named = songOfVideo({ title: item.videoTitle ?? '', channel: item.channel ?? null });
      patch(id, { title: named.title || item.title, artist: named.artist || item.artist });
    }
    item = current();
  }
  if (item.origin === 'video' && item.probed) audioSeconds = item.duration;
  const videoId = item.videoId!;
  const title = item.title || item.videoTitle || videoId;
  const artist = item.artist || item.channel || '';
  if (title !== item.title || artist !== item.artist) patch(id, { title, artist });

  // 4. ¿Ya está en la biblioteca? Entonces no se baja (y entra en su playlist).
  if (item.origin === 'video' && alreadyHave(item, title, artist, item.duration)) return null;

  // 5. Portada y letra oficiales, a la vez.
  const [release, lyrics] = await Promise.all([
    findOfficialRelease(client, { title, artist, coverUrl: item.coverUrl, spotifyId: item.spotifyId }).catch(() => undefined),
    findSongLyrics(client, { title, artist, album: item.album, duration: audioSeconds ?? item.duration ?? 0, videoId }).catch(() => null),
  ]);
  const official = release?.cover;
  const cover = official ?? (await squareFromThumbnail(client, videoId).catch(() => undefined));
  // Sin álbum (un vídeo suelto, sin datos de YouTube Music): los de la edición
  // oficial de la portada. Su año es el de la canción, no el de subida del
  // vídeo, y el título de un vídeo («… ft. … Furious 7 Soundtrack»), el del catálogo.
  const edition =
    !item.album && release?.album
      ? {
          title: item.origin === 'video' && release.title ? release.title : title,
          album: release.album,
          year: release.year ?? item.year,
          track: release.track,
          albumArtist: release.albumArtist ?? item.albumArtist,
        }
      : { title, album: item.album, year: item.year, track: item.track, albumArtist: item.albumArtist };
  const coverBytes = cover ? Math.round((cover.length - cover.indexOf(',') - 1) * 0.75) : 0;
  const lyricsBytes = lyrics ? new TextEncoder().encode(lyrics.text).length : 0;
  patch(id, {
    hasCover: !!cover,
    officialCover: !!official,
    coverBytes,
    hasLyrics: !!lyrics,
    synced: !!lyrics?.synced,
    lyricsBytes,
    // (Con el título con que entrará en la biblioteca.)
    ...(edition.title !== title ? { title: edition.title } : {}),
  });

  const sourceBytes = current().sourceBytes;
  // La carpeta es el nombre de la playlist, que ahora puede venir de un
  // servicio («Rock 80's/90's», «..\x»): solo lo que vale como nombre de carpeta.
  const folder = item.playlist ? safeFileName(item.playlist) : '';
  return {
    url: watchUrl(videoId),
    title: edition.title,
    artist,
    ...(edition.album ? { album: edition.album } : {}),
    ...(edition.track ? { track: edition.track } : {}),
    ...(edition.year ? { year: edition.year } : {}),
    ...(edition.albumArtist ? { album_artist: edition.albumArtist } : {}),
    ...(cover ? { cover } : {}),
    ...(lyrics ? { lyrics: lyrics.text } : {}),
    ...(folder ? { folder } : {}),
    ...(sourceBytes ? { expected: sourceBytes } : {}),
  };
}

/** Si la canción ya está en la biblioteca: la tarjeta lo dice y entra en su playlist. */
function alreadyHave(item: DownloadItem, title: string, artist: string, duration?: number): boolean {
  // Una tarjeta quitada (o de otro perfil, si se cambió a mitad) no toca la biblioteca.
  if (!find(item.id)) return true;
  const existing = libraryMatcher(host?.songs() ?? [])({ title, artist, duration, videoId: item.videoId, spotifyId: item.spotifyId });
  if (!existing) return false;
  if (item.playlist) host?.mergePlaylistSongs(item.playlist, [existing.id]);
  patch(item.id, { state: 'skipped', songId: existing.id, finishedAt: Date.now() });
  return true;
}

/** Recoge el archivo terminado y lo importa a la biblioteca. Una a la vez. */
async function importItem(client: EngineClient, item: DownloadItem) {
  const owner = host;
  const profile = uid;
  if (!owner) return;
  if (!item.job) {
    patch(item.id, { state: 'waiting', progress: 0, downloaded: 0 });
    return;
  }
  importing = true;
  try {
    let bytes: ArrayBuffer;
    try {
      bytes = await client.file(item.job);
    } catch (error) {
      if (isNetworkError(error) || error instanceof EngineTimeout) {
        // El programa no está o se quedó a medias: se vuelve a pedir el archivo cuando conteste.
        set({ problem: 'engine' }, false);
        engineCheckedAt = 0;
      } else {
        // El programa ya no tiene el trabajo (se reinició): se vuelve a pedir.
        patch(item.id, { state: 'waiting', job: undefined, progress: 0, downloaded: 0 });
      }
      return;
    }
    const name = item.fileName || `${item.artist} - ${item.title}.mp3`.replace(/[\\/:*?"<>|]+/g, ' ');
    const source = memorySource(item.playlist || tr('Descargas'), [{ name, bytes }]);
    try {
      const library = owner.songs();
      const plan = await planMusicImport(source, library);
      let songId: string | undefined = [...plan.existing.values()][0];
      let reason: string | undefined;
      let stoppedFor: string | undefined;
      if (plan.entries.length > 0) {
        const outcome = await storeImportedSongs(
          plan,
          library,
          () => undefined,
          async (songs) => {
            // Se cambió de perfil a mitad: la canción no entra en la biblioteca de otro.
            if (uid !== profile) throw new Error(tr('No se pudo añadir a tu biblioteca.'));
            songId = songs[0]?.id ?? songId;
            await owner.addSongs(songs);
          },
          () => uid !== profile
        );
        stoppedFor = outcome.stoppedFor;
        reason = outcome.skipped[0]?.reason ?? outcome.stoppedFor;
      }
      if (uid !== profile || !find(item.id)) return;
      // La misma canción con otro nombre de archivo: la que ya estaba.
      songId ??= findInLibrary(owner.songs(), item.title, item.artist, item.duration)?.id;
      if (!songId && stoppedFor) {
        // Sin espacio en el equipo: las siguientes fallarían igual después de
        // bajar. La cola se pausa y esta se queda lista para entrar al reanudar
        // (el archivo sigue en el programa).
        pauseItself('storage', stoppedFor);
        return;
      }
      if (!songId) {
        patch(item.id, { state: 'failed', error: reason ?? tr('No se pudo añadir a tu biblioteca.'), finishedAt: Date.now() });
        return;
      }
      if (item.playlist) owner.mergePlaylistSongs(item.playlist, [songId]);
      const finishedAt = Date.now();
      const current = find(item.id);
      if (current?.downloadEndedAt) {
        const sample = (finishedAt - current.downloadEndedAt) / 1000;
        set({ finishSeconds: Math.min(120, Math.max(1, state.finishSeconds * 0.7 + sample * 0.3)) });
      }
      prepared.delete(item.id);
      rememberDownloaded(wantedOf(current ?? item), songId);
      // A las métricas, de veinte en veinte o cada diez minutos (y al cerrar el lote).
      if (uncounted === 0) uncountedSince = finishedAt;
      uncounted += 1;
      if (uncounted >= 20 || finishedAt - uncountedSince >= 600_000) flushDownloadCount();
      patch(item.id, { state: 'done', songId, finishedAt, error: undefined, attempts: undefined, slow: undefined, retryAt: undefined });
    } finally {
      releaseMemorySource(source);
    }
  } catch (error) {
    patch(item.id, { state: 'failed', error: errorText(error).slice(0, 200), finishedAt: Date.now() });
  } finally {
    importing = false;
  }
}

/** Al terminar un lote: las playlists de los CSV en su orden, y el aviso. */
function finalizeBatch() {
  if (!host || state.batch === 0 || state.finalized === state.batch) return;
  const items = state.items.filter((item) => item.batch === state.batch);
  set({ finalized: state.batch });
  flushDownloadCount();
  if (items.length === 0) return;
  const lists = new Map<string, DownloadItem[]>();
  for (const item of items) {
    if (item.playlist && item.songId) lists.set(item.playlist, [...(lists.get(item.playlist) ?? []), item]);
  }
  for (const [name, members] of lists) {
    const ordered = [...new Set([...members].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((item) => item.songId!))];
    reorderPlaylist(name, ordered);
  }
  host.finished({
    done: items.filter((item) => item.state === 'done').length,
    skipped: items.filter((item) => item.state === 'skipped').length,
    failed: items.filter((item) => item.state === 'failed' || item.state === 'nomatch').length,
  });
}

/** Las canciones del lote, en el orden del CSV, en los mismos huecos que ocupan. */
function reorderPlaylist(name: string, ordered: string[]) {
  if (!host) return;
  const key = name.trim().toLowerCase();
  const list = host.playlists().find((playlist) => playlist.name.trim().toLowerCase() === key);
  if (!list) return;
  const wanted = new Set(ordered);
  const slots = list.songIds.map((id, index) => (wanted.has(id) ? index : -1)).filter((index) => index >= 0);
  const present = ordered.filter((id) => list.songIds.includes(id));
  if (slots.length !== present.length) return;
  const next = [...list.songIds];
  slots.forEach((slot, k) => {
    next[slot] = present[k];
  });
  if (next.some((id, index) => id !== list.songIds[index])) host.updatePlaylist(list.id, { songIds: next });
}
