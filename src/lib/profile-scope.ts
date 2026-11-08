import { forgetLyrics } from '@/lib/lyrics';
import {
  deleteImage,
  deleteSongFileFromDB,
  deleteSongMetadata,
  getAllSongMetadata,
  getImage,
  getImageRecord,
  saveImage,
  saveSongMetadata,
} from '@/lib/music-db';
import type { Song } from '@/types';

// ============================================================
// Lo de cada perfil, solo para ese perfil (1.6.7).
//
// Varias personas pueden usar Frame en el mismo equipo (una familia, un
// laboratorio del colegio). Todo lo de cada una cuelga de su id:
// `courses_<uid>`, `scheduleImage_<uid>`, la música con `owner = uid`…
//
// Hasta la 1.6.6 había tres cosas POR EQUIPO: la música, la foto del horario y
// el lugar del clima. Una cuenta nueva veía las canciones y el horario de otra,
// y la sincronización de imágenes llegaba a subir esas fotos a SU nube. Aquí se
// decide, una sola vez, de quién era todo eso: del perfil con más datos en este
// equipo o, para cada canción, del perfil que la tiene en sus playlists.
// ============================================================

const LEGACY_OWNER_KEY = 'legacyDataOwner';
const MIGRATED_KEY = 'deviceDataScoped';
const IMAGES_MIGRATED_KEY = 'deviceImagesScoped';
const LEGACY_SCHEDULE_HASH_KEY = 'legacyScheduleImageHash';
/** Claves de datos con las que se mide cuánto usó cada perfil este equipo. */
const DATA_KEYS = /^(courses|tasks|archivedTasks|notes|studySessions|dailyPerformances|habits|playlists|localEvents|recordings)_(.+)$/;

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** Un invitado que se vinculó a una cuenta ya no existe: lo suyo es de la cuenta. */
function resolveProfile(uid: string): string {
  return read(`guestLinkedTo_${uid}`) || uid;
}

/**
 * El perfil al que pertenece lo que Frame guardaba por equipo hasta la 1.6.6:
 * el que más datos tiene aquí. Se decide la primera vez y queda fijo, para que
 * una cuenta nueva no pueda quedárselo después.
 */
function legacyOwner(fallback: string): string {
  const saved = read(LEGACY_OWNER_KEY);
  if (saved) return resolveProfile(saved);
  const weight = new Map<string, number>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      if (key.endsWith('__bak')) continue;
      const match = DATA_KEYS.exec(key);
      if (!match) continue;
      const uid = resolveProfile(match[2]);
      weight.set(uid, (weight.get(uid) ?? 0) + (localStorage.getItem(key)?.length ?? 0));
    }
  } catch {
    /* sin almacenamiento: queda el perfil actual */
  }
  let owner = fallback;
  let best = -1;
  for (const [uid, size] of weight) {
    if (size > best) {
      best = size;
      owner = uid;
    }
  }
  try {
    localStorage.setItem(LEGACY_OWNER_KEY, owner);
  } catch {
    /* se recalculará la próxima vez */
  }
  return owner;
}

// ------------------------------------------------------------
// Claves por perfil
// ------------------------------------------------------------

export const scheduleImageKey = (uid: string) => `scheduleImage_${uid}`;
export const weatherPlaceKey = (uid: string) => `weatherPlace_${uid}`;
export const weatherCacheKey = (uid: string) => `weatherCache_${uid}`;
export const weatherImagesKey = (uid: string) => `weatherPlaceImages_${uid}`;

/** Id del perfil activo (lo comparten todas las ventanas de Frame). */
export function activeProfileId(): string | null {
  try {
    const id = (JSON.parse(read('userProfile') ?? 'null') as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

/** Ids de una colección del perfil (`courses`, `playlists`, `spaces`…). */
function idsOf(collection: string, uid: string): Set<string> {
  try {
    const list = JSON.parse(read(`${collection}_${uid}`) ?? '[]') as { id?: unknown }[];
    return new Set(Array.isArray(list) ? list.map((row) => String(row?.id ?? '')).filter(Boolean) : []);
  } catch {
    return new Set();
  }
}

/** Perfiles con datos en este equipo, sin contar invitados ya vinculados. */
function profilesOnDevice(): Set<string> {
  const uids = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const match = DATA_KEYS.exec(localStorage.key(i) ?? '');
      if (match && !read(`guestLinkedTo_${match[2]}`)) uids.add(match[2]);
    }
  } catch {
    /* sin almacenamiento */
  }
  return uids;
}

/** SHA-256 recortado de una imagen guardada (la misma huella que usa la nube). */
export async function fingerprint(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------
// Imágenes que viajan: ¿de quién es cada una?
// ------------------------------------------------------------

const ENTITY_IMAGES: [prefix: string, collection: string][] = [
  ['courseImage_', 'courses'],
  ['playlistImage_', 'playlists'],
  ['spaceImage_', 'spaces'],
  ['timetableImage_', 'timetables'],
];

/**
 * 'mine': del perfil `uid`. 'other': de otro perfil de este equipo (nunca se
 * sube a la nube de `uid`). 'unknown': aún no se sabe (p. ej. la asignatura
 * no ha llegado de la nube): no se toca hasta saberlo.
 */
export function imageOwnership(uid: string, key: string): 'mine' | 'other' | 'unknown' {
  if (key === 'scheduleImage') return 'mine'; // clave lógica: siempre la del perfil
  if (key.startsWith('profileAvatar_')) return key === `profileAvatar_${uid}` ? 'mine' : 'other';
  for (const [prefix, collection] of ENTITY_IMAGES) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    if (idsOf(collection, uid).has(id)) return 'mine';
    for (const other of profilesOnDevice()) {
      if (other !== uid && idsOf(collection, other).has(id)) return 'other';
    }
    return 'unknown';
  }
  return 'unknown';
}

/**
 * ¿Es esta foto del horario la que antes era del equipo y otra cuenta subió
 * por error a su nube? Solo puede serlo en un perfil que no es su dueño.
 */
export function isLeakedScheduleImage(uid: string, cloudHash: string | null | undefined): boolean {
  if (!cloudHash) return false;
  const leaked = read(LEGACY_SCHEDULE_HASH_KEY);
  const owner = read(LEGACY_OWNER_KEY);
  return !!leaked && leaked === cloudHash && !!owner && resolveProfile(owner) !== uid;
}

// ------------------------------------------------------------
// Migración única: lo que era del equipo pasa a su dueño
// ------------------------------------------------------------

/** Canciones sin dueño (hasta la 1.6.6): el perfil que las tiene en sus playlists o el dueño del equipo. */
export function ownerForUnownedSongs(fallback: string): (song: Song) => string {
  const byPlaylist = new Map<string, string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      const match = /^playlists_(.+)$/.exec(key);
      if (!match || key.endsWith('__bak')) continue;
      const uid = resolveProfile(match[1]);
      const playlists = JSON.parse(localStorage.getItem(key) ?? '[]') as { songIds?: unknown }[];
      for (const playlist of Array.isArray(playlists) ? playlists : []) {
        for (const id of Array.isArray(playlist?.songIds) ? playlist.songIds : []) {
          if (typeof id === 'string' && !byPlaylist.has(id)) byPlaylist.set(id, uid);
        }
      }
    }
  } catch {
    /* sin playlists legibles: todas al dueño del equipo */
  }
  const owner = legacyOwner(fallback);
  return (song) => byPlaylist.get(song.id) ?? owner;
}

/** Al vincular un invitado, su música pasa a la cuenta (que hereda todo lo suyo). */
export async function reassignSongs(fromUid: string, toUid: string): Promise<number> {
  let moved = 0;
  for (const song of await getAllSongMetadata().catch(() => [] as Song[])) {
    if (song.owner !== fromUid) continue;
    await saveSongMetadata({ ...song, owner: toUid });
    moved++;
  }
  return moved;
}

/**
 * Al eliminar una cuenta en un equipo con más perfiles: fuera su música (con
 * sus letras) y sus imágenes. Lo que otro perfil también usa (una asignatura
 * que un invitado pasó a su cuenta) se queda. Llamar ANTES de borrar sus
 * claves: de ellas salen los ids.
 */
export async function wipeProfileMedia(uid: string): Promise<void> {
  const others = [...profilesOnDevice()].filter((other) => other !== uid);
  const usedElsewhere = (collection: string, id: string) => others.some((other) => idsOf(collection, other).has(id));
  const keys = [scheduleImageKey(uid), `profileAvatar_${uid}`];
  for (const [prefix, collection] of ENTITY_IMAGES) {
    for (const id of idsOf(collection, uid)) if (!usedElsewhere(collection, id)) keys.push(prefix + id);
  }
  for (const collection of ['notes', 'archivedNotes']) {
    for (const id of idsOf(collection, uid)) if (!usedElsewhere(collection, id)) keys.push(`noteFile_${id}`);
  }
  for (const key of keys) await deleteImage(key, { fromSync: true }).catch(() => undefined);
  for (const song of await getAllSongMetadata().catch(() => [] as Song[])) {
    if (song.owner !== uid) continue;
    await deleteSongMetadata(song.id).catch(() => undefined);
    await deleteSongFileFromDB(song.id).catch(() => undefined);
    await forgetLyrics(song.id);
  }
}

/**
 * Prepara el perfil que se activa: lo que era del equipo pasa a su dueño. Lo
 * del almacenamiento local (el clima) se hace en el acto, antes de pintar nada;
 * la foto del horario, en segundo plano (Inicio la recoge sola al llegar).
 * Una vez por equipo; idempotente si se corta a mitad.
 */
export function prepareProfile(uid: string): void {
  migrateDeviceStorage(uid);
  void migrateDeviceImages(uid);
}

function migrateDeviceStorage(currentUid: string): void {
  if (read(MIGRATED_KEY) === '1') return;
  const owner = legacyOwner(currentUid);
  try {
    for (const [legacyKey, scoped] of [
      ['weatherPlace', weatherPlaceKey(owner)],
      ['weatherCache', weatherCacheKey(owner)],
      ['weatherPlaceImages', weatherImagesKey(owner)],
    ] as const) {
      const value = localStorage.getItem(legacyKey);
      if (value === null) continue;
      if (localStorage.getItem(scoped) === null) localStorage.setItem(scoped, value);
      localStorage.removeItem(legacyKey);
    }
    localStorage.setItem(MIGRATED_KEY, '1');
  } catch {
    /* se reintenta en el próximo arranque */
  }
}

let imagesMigration: Promise<void> | null = null;

function migrateDeviceImages(currentUid: string): Promise<void> {
  if (read(IMAGES_MIGRATED_KEY) === '1') return Promise.resolve();
  imagesMigration ??= (async () => {
    const owner = legacyOwner(currentUid);
    const legacy = await getImageRecord('scheduleImage').catch(() => null);
    if (legacy?.dataUrl) {
      try {
        localStorage.setItem(LEGACY_SCHEDULE_HASH_KEY, await fingerprint(legacy.dataUrl));
      } catch {
        /* sin la huella solo no se reconocería una copia filtrada */
      }
      if (!(await getImage(scheduleImageKey(owner)).catch(() => null))) {
        await saveImage(scheduleImageKey(owner), legacy.dataUrl, { fromSync: true, at: legacy.at });
      }
      await deleteImage('scheduleImage', { fromSync: true });
    }
    try {
      localStorage.setItem(IMAGES_MIGRATED_KEY, '1');
    } catch {
      /* se reintenta en el próximo arranque */
    }
  })().finally(() => {
    imagesMigration = null;
  });
  return imagesMigration;
}
