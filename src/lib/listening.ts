import { useEffect, useState } from 'react';
import { addDays, endOfMonth, endOfWeek, endOfYear, format, startOfMonth, startOfWeek, startOfYear } from 'date-fns';
import type { Song } from '@/types';
import { formatHoursMinutes } from '@/lib/duration';
import { intlLocale, tr } from '@/lib/i18n';
import { UNKNOWN_ARTIST } from '@/lib/enum-labels';
import { songTitle } from '@/lib/music-search';
import { songKey } from '@/lib/song-keys';

// ============================================================
// Escucha (1.8.0): cuánto suena de verdad cada canción, playlist y artista.
//
// El reproductor avisa en cada `timeupdate` (unas 4 veces por segundo) y
// aquí se acredita SOLO lo que avanzó la canción en tiempo real:
//   · el salto entre dos avisos se compara con el reloj del sistema; si la
//     canción avanzó más de lo que pasó (el usuario la adelantó) o retrocedió,
//     ese tramo no cuenta;
//   · en pausa no corre nada, y con la ventana oculta (avisos más espaciados)
//     se acredita igual, porque el reloj del sistema sí avanzó.
// Una reproducción cuenta a los 30 s escuchados (a la mitad, si la canción
// dura menos de un minuto) y una sola vez por escucha; repetirla cuenta otra.
//
// Se guarda por perfil y por día LOCAL en una base propia (`frame-escucha`):
// cada día lleva sus canciones (por su clave de título y artista, la misma en
// todos los dispositivos), sus playlists y sus artistas, más un total de
// siempre. Nada sale del equipo: no viaja ni va a la telemetría.
// ============================================================

export const LISTENING_DB_NAME = 'frame-escucha';
const STORE = 'dias';
const TOTAL_DAY = '*';
/** Aviso a las vistas cuando hay datos nuevos guardados. */
export const LISTENING_EVENT = 'frame:listening';
/** Cada cuánto se guarda mientras suena (además de al pausar o cambiar). */
const FLUSH_EVERY_MS = 15_000;
const PLAY_SECONDS = 30;
/** Holgura entre lo que avanzó la canción y lo que pasó en el reloj. */
const SLACK_SECONDS = 1;

export interface SongTally {
  t: string;
  a: string;
  s: number;
  p: number;
}

export interface NamedTally {
  n: string;
  s: number;
  p: number;
}

export interface DayRecord {
  id: string;
  owner: string;
  /** AAAA-MM-DD local, o «*» para el total de siempre. */
  day: string;
  s: number;
  p: number;
  songs: Record<string, SongTally>;
  lists: Record<string, NamedTally>;
  artists: Record<string, NamedTally>;
}

const emptyRecord = (owner: string, day: string): DayRecord => ({ id: `${owner}|${day}`, owner, day, s: 0, p: 0, songs: {}, lists: {}, artists: {} });

export const dayKeyOf = (date: Date): string => format(date, 'yyyy-MM-dd');

// ------------------------------------------------------------
// Artistas
// ------------------------------------------------------------

const ARTIST_SPLIT = /\s*(?:;|\/|,|\s+(?:feat\.?|ft\.?|featuring)\s+|\s+x\s+)\s*/;

/** Los artistas de una canción por su nombre: «A, B feat. C» son tres. */
export function splitArtists(raw: string | null | undefined): string[] {
  const value = (raw ?? '').trim();
  if (!value || value === UNKNOWN_ARTIST) return [];
  const parts = value.split(ARTIST_SPLIT).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    // «Tyler, The Creator»: lo que empieza por «The» tras una coma es del mismo nombre.
    if (out.length && /^the\s/i.test(part) && value.includes(`, ${part}`)) out[out.length - 1] += `, ${part}`;
    else out.push(part);
  }
  return [...new Set(out)];
}

const foldName = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// ------------------------------------------------------------
// Base de datos
// ------------------------------------------------------------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no disponible'));
      return;
    }
    const request = indexedDB.open(LISTENING_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      // Si otra pestaña (o el borrado de la cuenta) pide cerrarla, se cierra.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

/** Para borrar la base entera: sin cerrar la conexión, el borrado se bloquea. */
export function closeListeningDb(): void {
  void dbPromise?.then((db) => db.close()).catch(() => undefined);
  dbPromise = null;
}

async function readRange(owner: string, from: string, to: string): Promise<DayRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).getAll(IDBKeyRange.bound(`${owner}|${from}`, `${owner}|${to}`));
    request.onsuccess = () => resolve((request.result as DayRecord[]).filter((r) => r.day !== TOTAL_DAY));
    request.onerror = () => reject(request.error);
  });
}

async function readOne(owner: string, day: string): Promise<DayRecord | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(`${owner}|${day}`);
    request.onsuccess = () => resolve((request.result as DayRecord | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Borra la escucha de un perfil (al eliminar su cuenta en un equipo compartido). */
export async function deleteListening(owner: string): Promise<void> {
  pending.delete(owner);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(IDBKeyRange.bound(`${owner}|`, `${owner}|\uffff`));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event(LISTENING_EVENT));
}

/** Un invitado pasa a su cuenta: su escucha se suma a la de la cuenta. */
export async function moveListening(fromOwner: string, toOwner: string): Promise<void> {
  if (!fromOwner || !toOwner || fromOwner === toOwner) return;
  await flushListening();
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const range = IDBKeyRange.bound(`${fromOwner}|`, `${fromOwner}|\uffff`);
    const request = store.getAll(range);
    request.onsuccess = () => {
      for (const record of request.result as DayRecord[]) {
        const target = store.get(`${toOwner}|${record.day}`);
        target.onsuccess = () => {
          const merged = (target.result as DayRecord | undefined) ?? emptyRecord(toOwner, record.day);
          addInto(merged, record);
          store.put(merged);
        };
      }
      store.delete(range);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new Event(LISTENING_EVENT));
}

// ------------------------------------------------------------
// Lo pendiente de guardar (por perfil y día)
// ------------------------------------------------------------

const pending = new Map<string, Map<string, DayRecord>>();

function bucket(owner: string, day: string): DayRecord {
  let days = pending.get(owner);
  if (!days) {
    days = new Map();
    pending.set(owner, days);
  }
  let record = days.get(day);
  if (!record) {
    record = emptyRecord(owner, day);
    days.set(day, record);
  }
  return record;
}

function addInto(target: DayRecord, delta: DayRecord): void {
  target.s += delta.s;
  target.p += delta.p;
  for (const [key, v] of Object.entries(delta.songs)) {
    const cur = target.songs[key] ?? (target.songs[key] = { t: v.t, a: v.a, s: 0, p: 0 });
    cur.t = v.t || cur.t;
    cur.a = v.a || cur.a;
    cur.s += v.s;
    cur.p += v.p;
  }
  for (const field of ['lists', 'artists'] as const) {
    for (const [key, v] of Object.entries(delta[field])) {
      const cur = target[field][key] ?? (target[field][key] = { n: v.n, s: 0, p: 0 });
      cur.n = v.n || cur.n;
      cur.s += v.s;
      cur.p += v.p;
    }
  }
}

let flushing: Promise<void> = Promise.resolve();

/** Guarda lo pendiente (día a día y en el total). Las llamadas van en fila. */
export function flushListening(): Promise<void> {
  flushing = flushing.then(async () => {
    if (pending.size === 0) return;
    const batch = [...pending.entries()];
    pending.clear();
    let db: IDBDatabase;
    try {
      db = await openDb();
    } catch {
      return; // sin base (navegador sin IndexedDB): no hay dónde guardar
    }
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      for (const [owner, days] of batch) {
        const total = emptyRecord(owner, TOTAL_DAY);
        for (const [day, delta] of days) {
          addInto(total, delta);
          const request = store.get(`${owner}|${day}`);
          request.onsuccess = () => {
            const current = (request.result as DayRecord | undefined) ?? emptyRecord(owner, day);
            addInto(current, delta);
            store.put(current);
          };
        }
        const request = store.get(`${owner}|${TOTAL_DAY}`);
        request.onsuccess = () => {
          const current = (request.result as DayRecord | undefined) ?? emptyRecord(owner, TOTAL_DAY);
          addInto(current, total);
          store.put(current);
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    window.dispatchEvent(new Event(LISTENING_EVENT));
  });
  return flushing;
}

// ------------------------------------------------------------
// El seguimiento de lo que suena
// ------------------------------------------------------------

export interface PlaybackSample {
  owner: string | null | undefined;
  song: Pick<Song, 'id' | 'title' | 'artist' | 'fileName'>;
  /** Playlist desde la que suena, si es una. */
  list: { id: string; name: string } | null;
  time: number;
  duration: number;
  rate?: number;
}

interface Listen {
  owner: string;
  songId: string;
  key: string;
  title: string;
  artists: { key: string; name: string }[];
  artistLabel: string;
  list: { id: string; name: string } | null;
  listened: number;
  counted: boolean;
  lastMedia: number;
  /** Reloj del sistema en el último aviso; null tras una pausa. */
  lastWall: number | null;
}

let current: Listen | null = null;
let lastFlush = 0;

function startListen(sample: PlaybackSample & { owner: string }): Listen {
  const artists = splitArtists(sample.song.artist).map((name) => ({ key: foldName(name), name }));
  return {
    owner: sample.owner,
    songId: sample.song.id,
    key: songKey(sample.song),
    title: songTitle(sample.song as Song),
    artists,
    artistLabel: sample.song.artist && sample.song.artist !== UNKNOWN_ARTIST ? sample.song.artist : '',
    list: sample.list,
    listened: 0,
    counted: false,
    lastMedia: sample.time,
    lastWall: null,
  };
}

function credit(listen: Listen, seconds: number, plays: number): void {
  const record = bucket(listen.owner, dayKeyOf(new Date()));
  record.s += seconds;
  record.p += plays;
  const song = record.songs[listen.key] ?? (record.songs[listen.key] = { t: listen.title, a: listen.artistLabel, s: 0, p: 0 });
  song.s += seconds;
  song.p += plays;
  if (listen.list) {
    const list = record.lists[listen.list.id] ?? (record.lists[listen.list.id] = { n: listen.list.name, s: 0, p: 0 });
    list.n = listen.list.name || list.n;
    list.s += seconds;
    list.p += plays;
  }
  for (const artist of listen.artists) {
    const tally = record.artists[artist.key] ?? (record.artists[artist.key] = { n: artist.name, s: 0, p: 0 });
    tally.s += seconds;
    tally.p += plays;
  }
}

/** Umbral de una reproducción: 30 s, o la mitad de una canción de menos de un minuto. */
export const playThreshold = (duration: number): number => (duration > 0 && duration < 60 ? Math.max(1, duration / 2) : PLAY_SECONDS);

export const listening = {
  /** En cada `timeupdate` del reproductor mientras suena. */
  tick(sample: PlaybackSample): void {
    const owner = sample.owner;
    if (!owner || !Number.isFinite(sample.time)) return;
    const now = performance.now();
    if (!current || current.songId !== sample.song.id || current.owner !== owner) {
      if (current) void flushListening();
      current = startListen({ ...sample, owner });
    }
    if (sample.list?.id !== current.list?.id) current.list = sample.list;
    const listen = current;
    if (listen.lastWall !== null) {
      const media = sample.time - listen.lastMedia;
      const wall = ((now - listen.lastWall) / 1000) * Math.max(0.25, sample.rate ?? 1);
      // Hacia atrás o más rápido que el reloj: el usuario movió la barra.
      if (media > 0 && media <= wall + SLACK_SECONDS) {
        listen.listened += media;
        let plays = 0;
        if (!listen.counted && listen.listened >= playThreshold(sample.duration)) {
          listen.counted = true;
          plays = 1;
        }
        credit(listen, media, plays);
      }
    }
    listen.lastMedia = sample.time;
    listen.lastWall = now;
    if (Date.now() - lastFlush > FLUSH_EVERY_MS) {
      lastFlush = Date.now();
      void flushListening();
    }
  },

  /** Pausa (o el audio se detuvo): lo que pase hasta reanudar no cuenta. */
  pause(): void {
    if (current) current.lastWall = null;
    void flushListening();
  },

  /** La canción terminó: la próxima vez que suene (aunque sea ella) es otra escucha. */
  ended(): void {
    current = null;
    void flushListening();
  },
};

let guardsInstalled = false;
/** Guarda al ocultarse o cerrarse la ventana. */
export function installListeningGuards(): void {
  if (guardsInstalled || typeof window === 'undefined') return;
  guardsInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushListening();
  });
  window.addEventListener('pagehide', () => void flushListening());
}

// ------------------------------------------------------------
// Lectura: periodos y resúmenes
// ------------------------------------------------------------

export type ListeningPeriod = 'semana' | 'mes' | 'anio';

export function periodRange(period: ListeningPeriod, ref: Date): { from: Date; to: Date } {
  if (period === 'semana') return { from: startOfWeek(ref, { weekStartsOn: 1 }), to: endOfWeek(ref, { weekStartsOn: 1 }) };
  if (period === 'mes') return { from: startOfMonth(ref), to: endOfMonth(ref) };
  return { from: startOfYear(ref), to: endOfYear(ref) };
}

export interface RankedSong {
  key: string;
  title: string;
  artist: string;
  seconds: number;
  plays: number;
}

export interface RankedName {
  id: string;
  name: string;
  seconds: number;
  plays: number;
}

export interface ListeningSummary {
  seconds: number;
  plays: number;
  songs: RankedSong[];
  artists: RankedName[];
  lists: RankedName[];
  /** Por día (AAAA-MM-DD → segundos), con los días sin escucha incluidos. */
  days: { day: string; seconds: number; plays: number }[];
}

const bySeconds = <T extends { seconds: number; plays: number }>(a: T, b: T) => b.seconds - a.seconds || b.plays - a.plays;

export function summarizeRecords(records: DayRecord[], from?: Date, to?: Date): ListeningSummary {
  const merged = emptyRecord('', '');
  for (const record of records) addInto(merged, record);
  const days: ListeningSummary['days'] = [];
  if (from && to) {
    const byDay = new Map(records.map((r) => [r.day, r]));
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const key = dayKeyOf(d);
      const record = byDay.get(key);
      days.push({ day: key, seconds: record?.s ?? 0, plays: record?.p ?? 0 });
    }
  }
  return {
    seconds: merged.s,
    plays: merged.p,
    songs: Object.entries(merged.songs).map(([key, v]) => ({ key, title: v.t, artist: v.a, seconds: v.s, plays: v.p })).sort(bySeconds),
    artists: Object.entries(merged.artists).map(([id, v]) => ({ id, name: v.n, seconds: v.s, plays: v.p })).sort(bySeconds),
    lists: Object.entries(merged.lists).map(([id, v]) => ({ id, name: v.n, seconds: v.s, plays: v.p })).sort(bySeconds),
    days,
  };
}

/** Lo escuchado entre dos fechas (ambas incluidas), con lo pendiente ya guardado. */
export async function listeningBetween(owner: string, from: Date, to: Date): Promise<ListeningSummary> {
  await flushListening();
  const records = await readRange(owner, dayKeyOf(from), dayKeyOf(to)).catch(() => [] as DayRecord[]);
  return summarizeRecords(records, from, to);
}

/** Desde que Frame lo mide (1.8.0). */
export async function listeningAllTime(owner: string): Promise<ListeningSummary> {
  await flushListening();
  const record = await readOne(owner, TOTAL_DAY).catch(() => null);
  return summarizeRecords(record ? [record] : []);
}

/**
 * Vuelve a leer cuando se guarda algo nuevo (con un respiro para no leer en
 * ráfaga). Sin perfil (p. ej. una ventana cerrada que pasa `null`) no lee ni
 * escucha, y conserva lo último para que el cierre no parpadee.
 */
export function useListening<T>(owner: string | null | undefined, read: (owner: string) => Promise<T>, deps: unknown[]): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    if (!owner) return;
    let alive = true;
    let timer: number | undefined;
    const load = () => {
      void read(owner)
        .then((v) => alive && setValue(v))
        .catch(() => undefined);
    };
    const onChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 400);
    };
    load();
    window.addEventListener(LISTENING_EVENT, onChange);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.removeEventListener(LISTENING_EVENT, onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, ...deps]);
  return value;
}

/** La playlist más escuchada de los últimos `days` días (hoy incluido). */
export async function topPlaylist(owner: string, days = 7): Promise<RankedName | null> {
  const to = new Date();
  const summary = await listeningBetween(owner, addDays(to, -(days - 1)), to);
  return summary.lists[0] ?? null;
}

/** Id de la playlist de una ruta de reproducción («/playlists?id=…»). */
export function playlistIdFromHref(href: string | null | undefined): string | null {
  if (!href || !href.startsWith('/playlists')) return null;
  const query = href.split('?')[1] ?? '';
  return new URLSearchParams(query).get('id');
}

/** «1 reproducción», «12 reproducciones». */
export const playsText = (n: number): string => (n === 1 ? tr('1 reproducción') : tr('{n} reproducciones', { n: n.toLocaleString(intlLocale()) }));

/** «1 h 5 min», «12 min», «< 1 min» (el mismo formato que la duración de las playlists). */
export function formatListened(seconds: number): string {
  if (seconds > 0 && seconds < 60) return '< 1 min';
  return formatHoursMinutes(seconds / 60);
}
