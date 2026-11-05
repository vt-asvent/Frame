import type { Song } from '@/types';
import { UNKNOWN_ARTIST } from '@/lib/enum-labels';
import { songTitle } from '@/lib/music-search';

// ============================================================
// Identidad de una canción entre dispositivos (1.6.8).
//
// La música no viaja: cada dispositivo importa sus archivos y cada canción
// recibe allí un id al azar. Las playlists, en cambio, sí viajan, y guardaban
// esos ids, distintos en cada dispositivo: el orden de una playlist nunca
// podía coincidir (Diego, 1.6.8).
//
// Ahora la playlist viaja con la CLAVE de cada canción, su título y su artista
// plegados («k:titulo␟artista»: sin mayúsculas, tildes ni espacios de más), y
// cada dispositivo la traduce a su propio id al llegar. Lo que aquí no está se
// queda como clave: no se ve, pero conserva su sitio para los demás
// dispositivos (y vuelve a verse si se importa).
//
// Plegada y no tal cual: si un equipo tiene «ALPHA» y otro «Alpha», los dos
// deben escribir la MISMA clave. Con la escrita tal cual, cada uno devolvía la
// suya, la fusión lo tomaba por un cambio y deshacía el orden que el otro
// acababa de dar (lo encontró la prueba de dos dispositivos).
//
// El índice id → clave vive en el dispositivo (`songKeys_<uid>`, no viaja):
// la sincronización lo lee sin esperar a la base de la música.
//
// Copias con el mismo título y artista (1.7.3): un disco doble con dos
// «Intro» de la misma banda, o la misma canción en MP3 y en FLAC. Hasta la
// 1.7.2 las dos tenían la misma clave y, al viajar, la playlist las fundía en
// una (quitaba la repetida): el otro dispositivo veía una canción menos y, al
// reordenarla allí, la copia que faltaba desaparecía también de este. Ahora la
// segunda copia lleva su número («k:intro␟banda␟2»), en el orden de su nombre
// de archivo (igual en todos los dispositivos que tengan los mismos archivos).
// Las versiones anteriores no la reconocen: la conservan como clave, en su
// sitio y sin verla.
// ============================================================

export const SONG_KEY_PREFIX = 'k:';
const SEPARATOR = '\u001f';
const indexKey = (uid: string) => `songKeys_${uid}`;

/** Título y artista comparables: sin mayúsculas, tildes ni espacios de más. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const isSongKey = (entry: string): boolean => entry.startsWith(SONG_KEY_PREFIX);

/** La clave de una canción: lo que ve el usuario, plegado; igual en cualquier dispositivo. */
export function songKey(song: Pick<Song, 'title' | 'artist' | 'fileName'>): string {
  const artist = song.artist && song.artist !== UNKNOWN_ARTIST ? song.artist : '';
  return `${SONG_KEY_PREFIX}${fold(songTitle(song as Song))}${SEPARATOR}${fold(artist)}`;
}

/** Título y artista de una clave, con mayúscula inicial (para el verificador de sincronización). */
export function describeSongKey(key: string): { title: string; artist: string } {
  const [title, artist = ''] = key.slice(SONG_KEY_PREFIX.length).split(SEPARATOR);
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    artist: artist.replace(/(^|\s)(\S)/g, (_, space: string, letter: string) => space + letter.toUpperCase()),
  };
}

const comparable = (key: string) => fold(key.slice(SONG_KEY_PREFIX.length));

let cache: { uid: string; raw: string | null; byId: Map<string, string>; byKey: Map<string, string> } | null = null;

function directory(uid: string) {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(indexKey(uid));
  } catch {
    /* sin almacenamiento: sin traducción */
  }
  if (cache && cache.uid === uid && cache.raw === raw) return cache;
  const byId = new Map<string, string>();
  const byKey = new Map<string, string>();
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    for (const [id, key] of Object.entries(parsed)) {
      if (typeof key !== 'string') continue;
      byId.set(id, key);
      if (!byKey.has(comparable(key))) byKey.set(comparable(key), id);
    }
  } catch {
    /* índice ilegible: se rehace al cargar la música */
  }
  cache = { uid, raw, byId, byKey };
  return cache;
}

/**
 * Clave de cada canción de la biblioteca: la de `songKey` y, si varias la
 * comparten, la segunda en adelante con su número (ver arriba). El orden de
 * las copias es el de su nombre de archivo (y su id, a igualdad).
 */
export function libraryKeys(songs: Pick<Song, 'id' | 'title' | 'artist' | 'fileName'>[]): Record<string, string> {
  const groups = new Map<string, Pick<Song, 'id' | 'title' | 'artist' | 'fileName'>[]>();
  for (const song of songs) {
    const key = songKey(song);
    const group = groups.get(key);
    if (group) group.push(song);
    else groups.set(key, [song]);
  }
  const out: Record<string, string> = {};
  for (const [key, group] of groups) {
    if (group.length === 1) {
      out[group[0].id] = key;
      continue;
    }
    const sorted = [...group].sort(
      (a, b) => fold(a.fileName ?? '').localeCompare(fold(b.fileName ?? '')) || a.id.localeCompare(b.id)
    );
    sorted.forEach((song, index) => {
      out[song.id] = index === 0 ? key : `${key}${SEPARATOR}${index + 1}`;
    });
  }
  return out;
}

/** La clave con la que viaja esta canción (la del índice; si no está, la de `songKey`). */
export function songKeyIn(uid: string, song: Pick<Song, 'id' | 'title' | 'artist' | 'fileName'>): string {
  return directory(uid).byId.get(song.id) ?? songKey(song);
}

/**
 * Guarda el índice id → clave de la música del perfil (solo si cambió). Un id
 * que ya no está en la biblioteca pero sigue en una playlist conserva su
 * clave: así viaja por ella y no como un id que nadie más conoce.
 */
export function rememberSongKeys(uid: string, songs: Song[]): void {
  const next: Record<string, string> = libraryKeys(songs);
  try {
    const previous = directory(uid).byId;
    const playlists = JSON.parse(localStorage.getItem(`playlists_${uid}`) ?? '[]') as { songIds?: unknown }[];
    for (const playlist of Array.isArray(playlists) ? playlists : []) {
      for (const id of Array.isArray(playlist?.songIds) ? playlist.songIds : []) {
        if (typeof id === 'string' && !next[id] && previous.has(id)) next[id] = previous.get(id)!;
      }
    }
  } catch {
    /* playlists ilegibles: solo la biblioteca */
  }
  const text = JSON.stringify(next);
  try {
    if (localStorage.getItem(indexKey(uid)) !== text) localStorage.setItem(indexKey(uid), text);
  } catch {
    /* sin espacio: las playlists viajan con los ids, como antes */
  }
}

const unique = (entries: string[]) => [...new Set(entries)];

/** Hacia la nube: cada canción de aquí, por su clave. Lo demás, tal cual. */
export function toCloudSongIds(uid: string, ids: string[]): string[] {
  const { byId } = directory(uid);
  return unique(ids.map((id) => byId.get(id) ?? id));
}

/** Desde la nube: cada clave, por el id de la canción de aquí (si está). */
export function toLocalSongIds(uid: string, ids: string[]): string[] {
  const { byKey } = directory(uid);
  return unique(ids.map((entry) => (isSongKey(entry) ? byKey.get(comparable(entry)) ?? entry : entry)));
}

/**
 * Las playlists guardadas con la clave de una canción que este dispositivo SÍ
 * tiene (llegó antes de que su música terminara de cargar, o en la primera
 * apertura de la 1.6.8, aún sin índice): cada clave pasa a su id, y la canción
 * se ve. Lo que viaja no cambia (ese id vuelve a ser la misma clave). Devuelve
 * true si reescribió algo.
 */
export function localizePlaylists(uid: string): boolean {
  const storageKey = `playlists_${uid}`;
  try {
    const playlists = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { songIds?: unknown }[] | null;
    if (!Array.isArray(playlists)) return false;
    let changed = false;
    const next = playlists.map((playlist) => {
      const ids = playlist?.songIds;
      if (!Array.isArray(ids) || !ids.some((id) => typeof id === 'string' && isSongKey(id))) return playlist;
      const songIds = toLocalSongIds(uid, ids as string[]);
      if (songIds.length === ids.length && songIds.every((id, index) => id === ids[index])) return playlist;
      changed = true;
      return { ...playlist, songIds };
    });
    if (changed) localStorage.setItem(storageKey, JSON.stringify(next));
    return changed;
  } catch {
    return false;
  }
}

/** Ids de la biblioteca de este dispositivo (los publica el estado de la música). */
let library: Set<string> | null = null;
export const setLibraryIds = (ids: string[]) => {
  library = new Set(ids);
};
/** null mientras la música aún se carga. */
export const libraryIds = (): ReadonlySet<string> | null => library;
