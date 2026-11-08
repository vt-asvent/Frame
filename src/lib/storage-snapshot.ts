import { toCloudSongIds, toLocalSongIds } from '@/lib/song-keys';

// Claves de estado de negocio sincronizables (sufijo `_<uid>`).
// Excluye música (archivos en IndexedDB) e imágenes; solo se respalda el estado de negocio.
//
// Grabaciones ('recordings'): la ficha es JSON, pero el audio vive en
// IndexedDB igual que la música. Restaurar solo la ficha dejaría tarjetas
// mudas, así que queda fuera a propósito.
//
// Retiradas en la 1.6.8 (ver RETIRED_KEYS en sync-merge.ts): 'classSessions'
// y 'schedules' (invisibles desde la 1.6.6), 'playHistory' (sin escribirse
// desde la 1.5.4) y 'school' (de Aether OS). Eran la mitad del respaldo de
// una cuenta con uso y viajaban en cada sincronización. La copia de cada
// equipo no se toca.
export const SCOPED_KEYS = [
  'courses',
  'tasks',
  'notes',
  // El archivo histórico es dato de usuario irrecuperable: alimenta
  // "Archivados" (Tareas y asignatura) y toda la analítica académica.
  'archivedTasks',
  // Tareas que no se pudieron terminar: fuera de las métricas de culminadas.
  'incompleteTasks',
  'archivedNotes',
  'localEvents',
  // Color propio de cada casilla del calendario local (1.6.2).
  'dayColors',
  'habits',
  'studySessions',
  'dailyPerformances',
  'playlists',
  'spaces',
  'studyGoals',
  'streakGoal',
  'selectionMode',
  // Modo Avanzado elegido a mano (1.7.3): un booleano que sigue a la cuenta.
  // Las versiones anteriores (y Frame móvil) no lo conocen y lo conservan
  // intacto (clave «del futuro», 1.6.9).
  'advancedMode',
  'completedTasks',
  'completedTasksByCourse',
  'taskSortMode',
  'isPlayerVisible',
  // Acumulado real de reproducciones: sin respaldo, al reinstalar se resembraba
  // con la longitud del registro rodante y la cifra del expediente bajaba.
  'playCount',
  // Índice de las imágenes que viajan entre dispositivos por la nube (foto de
  // perfil y horario). Los archivos van a Supabase Storage; aquí solo qué
  // versión tiene cada una (image-sync.ts).
  'syncedImages',
  // Anotaciones sin asignatura del «+» de la barra (src/lib/loose-notes.ts).
  'looseNotes',
  // Vídeos de estudio (1.6.8): solo fichas de YouTube, sin archivos del equipo.
  'studyVideos',
  // Imágenes de asignaturas, colecciones y playlists por referencia (1.6.8,
  // image-refs.ts): las de la galería viajan como su código.
  'imageRefs',
  // Ajustes de la cuenta que siguen al usuario (1.6.8, account-settings.ts):
  // idioma, proporción de las imágenes de las tarjetas, ciudad del clima.
  'appSettings',
  // Clave que cifra los cambios que viajan por el canal en vivo (1.6.8,
  // sync-delta.ts). Solo la leen los dispositivos de la cuenta.
  'syncKey',
  // Canciones con corazón (1.6.9, song-favorites.ts): una ficha por canción,
  // identificada por su clave (título y artista), como en las playlists.
  'songFavorites',
  // Horarios de Inicio (1.9.0): fichas por mes; la foto viaja con image-sync.
  'timetables',
] as const;

/** Las claves que esta versión conoce (lo demás de la nube es de una versión más nueva). */
export const KNOWN_KEYS: ReadonlySet<string> = new Set(SCOPED_KEYS);

export type LocalSnapshot = Record<string, unknown>;

const read = (key: string): unknown => {
  if (typeof window === 'undefined') return undefined;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/** Devuelve false si no se pudo escribir (cuota llena, almacenamiento vetado). */
const write = (key: string, value: unknown): boolean => {
  if (typeof window === 'undefined' || value === undefined) return true;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

/**
 * Forma «de nube» de una clave: lo que viaja. Solo cambia en las playlists,
 * cuyas canciones viajan por su clave (song-keys.ts) y no por el id de este
 * dispositivo.
 */
export function toCloudForm(uid: string, key: string, value: unknown): unknown {
  if (key !== 'playlists' || !Array.isArray(value)) return value;
  return value.map((playlist) =>
    playlist && typeof playlist === 'object' && Array.isArray((playlist as { songIds?: unknown }).songIds)
      ? { ...playlist, songIds: toCloudSongIds(uid, (playlist as { songIds: string[] }).songIds) }
      : playlist
  );
}

/** Forma de este dispositivo de lo que llega de la nube (la inversa de la anterior). */
export function toLocalForm(uid: string, key: string, value: unknown): unknown {
  if (key !== 'playlists' || !Array.isArray(value)) return value;
  return value.map((playlist) =>
    playlist && typeof playlist === 'object' && Array.isArray((playlist as { songIds?: unknown }).songIds)
      ? { ...playlist, songIds: toLocalSongIds(uid, (playlist as { songIds: string[] }).songIds) }
      : playlist
  );
}

/** Una clave del perfil, en forma de nube (undefined si no existe). */
export function readCloudForm(uid: string, key: string): unknown {
  const value = read(`${key}_${uid}`);
  return value === undefined ? undefined : toCloudForm(uid, key, value);
}

export function collectLocalData(uid: string): LocalSnapshot {
  const snapshot: LocalSnapshot = {};
  for (const key of SCOPED_KEYS) {
    const value = readCloudForm(uid, key);
    if (value !== undefined) snapshot[key] = value;
  }
  return snapshot;
}

interface ApplyResult {
  /** Todas las escrituras entraron. Si es false, NO se debe dar por aplicada. */
  ok: boolean;
  /** Alguna clave cambió de verdad respecto a lo que había en disco. */
  changed: boolean;
}

/**
 * Vuelca un estado fusionado en localStorage, tocando SOLO las claves cuyo
 * contenido cambia. Reescribir lo idéntico no es inocuo: cada escritura es un
 * bloqueo del hilo principal y, sobre todo, `changed` es lo que decide si la
 * interfaz viva tiene que recargarse desde disco.
 */
/** Escrituras que llegan de la nube (no son cambios del usuario: no se re-suben). */
let applyingRemote = 0;
export const isApplyingRemote = (): boolean => applyingRemote > 0;

export function applyLocalData(uid: string, snapshot: LocalSnapshot | null | undefined): ApplyResult {
  applyingRemote += 1;
  try {
    return applyLocalDataInner(uid, snapshot);
  } finally {
    applyingRemote -= 1;
  }
}

function applyLocalDataInner(uid: string, snapshot: LocalSnapshot | null | undefined): ApplyResult {
  if (!snapshot || typeof snapshot !== 'object') return { ok: false, changed: false };
  let ok = true;
  let changed = false;

  const put = (storageKey: string, value: unknown) => {
    if (value === undefined) return;
    const next = JSON.stringify(value);
    if (window.localStorage.getItem(storageKey) === next) return;
    changed = true;
    if (!write(storageKey, value)) ok = false;
  };

  // Lo que no esté en SCOPED_KEYS (una clave retirada, o la de una versión
  // más nueva) no se escribe: se ignora.
  for (const key of SCOPED_KEYS) {
    if (key in snapshot) put(`${key}_${uid}`, toLocalForm(uid, key, snapshot[key]));
  }
  return { ok, changed };
}
