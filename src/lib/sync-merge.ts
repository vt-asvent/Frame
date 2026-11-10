// ============================================================
// Fusión de estado entre dispositivos.
//
// El problema que resuelve: hasta ahora cada dispositivo subía su estado
// COMPLETO cada minuto, así que el último en sincronizar pisaba al otro. Con
// un solo equipo daba igual; con Frame Móvil en paralelo es pérdida de datos.
//
// La solución NO es tocar el modelo de datos (ninguna pantalla escribe fechas
// de modificación) sino llevar una contabilidad aparte:
//
//   · `lastSyncedSnapshot_<uid>` guarda cómo estaban los datos la última vez
//     que se sincronizó.
//   · Al sincronizar se compara el estado actual contra esa foto: lo que
//     cambió recibe marca de modificación; lo que desapareció recibe una
//     LÁPIDA. Sin lápidas, borrar una tarea en el móvil la resucitaría desde
//     el escritorio en la siguiente vuelta.
//   · La fusión decide registro a registro por marca más reciente.
//
// Resultado: dos dispositivos pueden trabajar a la vez y ninguno pisa al otro.
//
// 1.6.8: claves retiradas que ya no viajan (las clases y su horario, la
// bitácora de reproducciones y la frase de la barra: la mitad del respaldo de
// una cuenta con uso), vídeos de estudio e imágenes por referencia como
// colecciones, y una huella CANÓNICA del estado (sin depender del orden de
// claves ni de filas) para no escribir en la nube lo que ya está allí.
// ============================================================

import { KNOWN_KEYS, type LocalSnapshot } from '@/lib/storage-snapshot';

/** Se aplicó algo llegado de la nube (lo emite el layout; ver supabase/sync.ts). Aquí, para no cargar el cliente. */
export const CLOUD_APPLIED_EVENT = 'frame:cloud-applied';

/** Colecciones: arrays de registros identificados por `id`. Se fusionan uno a uno. */
const COLLECTION_KEYS = [
  'courses',
  'tasks',
  'notes',
  'archivedTasks',
  'incompleteTasks',
  'archivedNotes',
  'localEvents',
  // Un registro por casilla pintada (id = el día "YYYY-MM-DD").
  'dayColors',
  'habits',
  'studySessions',
  'dailyPerformances',
  'playlists',
  'spaces',
  // Índice de imágenes sincronizadas (id = clave de la imagen): cada imagen
  // se fusiona por separado, así cambiar dos en dos equipos no choca.
  'syncedImages',
  // Anotaciones sin asignatura (id propio, como las notas).
  'looseNotes',
  // Vídeos de estudio (id = el de YouTube). Viajan desde la 1.6.8: desde que
  // Frame no descarga (1.6.1) ya no llevan rutas de este equipo.
  'studyVideos',
  // Imágenes de asignaturas, colecciones y playlists POR REFERENCIA (1.6.8):
  // la de la galería viaja como su código y su encuadre; la propia, no.
  'imageRefs',
  // Canciones con corazón (1.6.9, id = la clave de la canción): quitar el
  // corazón deja una lápida, así que también viaja.
  'songFavorites',
  // Horarios de Inicio (1.9.0, id propio): uno por foto subida.
  'timetables',
  // Favoritos de la Biblioteca (1.9.2, id = el del archivo): como el corazón
  // de las canciones, quitar uno deja su lápida.
  'loreFavorites',
] as const;

/**
 * Claves retiradas (1.6.8). Un dispositivo con una versión anterior aún las
 * envía; la fusión las descarta y nunca vuelven a la nube desde aquí. La copia
 * de cada equipo se queda donde está (nada se borra del dispositivo):
 *   · classSessions y schedules: las clases y el horario, invisibles desde la 1.6.6;
 *   · playHistory: la bitácora de reproducciones, sin escribirse desde la 1.5.4;
 *   · headerQuote: la frase propia de la barra, retirada en la 1.6.2;
 *   · school: el colegio del perfil de Aether OS;
 *   · competencyCourseIds: las asignaturas de la matriz de competencias, retirada en la 1.9.0.
 */
export const RETIRED_KEYS: ReadonlySet<string> = new Set(['classSessions', 'schedules', 'playHistory', 'headerQuote', 'school', 'competencyCourseIds']);

/**
 * Colecciones que una versión anterior no conoce como tales (`studyVideos` e
 * `imageRefs`: la 1.6.7 / móvil 1.1.3; `songFavorites`: también la 1.6.8 /
 * 1.1.4): al escribir, conserva sus registros pero pierde sus marcas (y les
 * pone una suelta). La huella del estado no cuenta esas marcas; sus
 * registros, sí. Si las contara, la versión nueva las restituiría tras cada
 * escritura de la anterior y la anterior las volvería a quitar: un reenvío
 * sin fin entre las dos (lo encontró la prueba de dos dispositivos,
 * scripts/probar-sincronizacion.mjs). Desde la 1.6.9 una versión conserva
 * intacto lo que no conoce (ver `isForeign`): esta lista ya no crece.
 */
const MARKS_LOST_BY_OLD = new Set(['studyVideos', 'imageRefs', 'songFavorites']);

/**
 * Clave de la nube que esta versión no conoce: la añadió una versión más
 * nueva. Desde la 1.6.9 viaja intacta (datos y marcas) aunque aquí no se use.
 * Hasta la 1.6.8 el camino «solo subir» la borraba de la nube y la fusión le
 * quitaba las marcas.
 */
const isForeign = (key: string): boolean => !KNOWN_KEYS.has(key) && !RETIRED_KEYS.has(key);
const foreignKey = (uid: string) => `syncForeign_${uid}`;

/**
 * El estado con lo que este dispositivo guarda de la nube sin conocerlo. Sus
 * marcas ya están en la contabilidad (la guarda `commitState`); aquí se
 * añaden los datos.
 */
export function withForeign(uid: string, state: SyncState): SyncState {
  const stored = readJson<LocalSnapshot | null>(foreignKey(uid), null);
  if (!stored || typeof stored !== 'object') return state;
  const data: LocalSnapshot = { ...state.data };
  for (const [key, value] of Object.entries(stored)) if (isForeign(key) && !(key in data)) data[key] = value;
  return { ...state, data };
}

/** Las lápidas se conservan dos meses: tiempo de sobra para que un
 *  dispositivo apagado se entere del borrado sin engordar el respaldo. */
const TOMBSTONE_TTL_MS = 60 * 24 * 60 * 60 * 1000;

type Iso = string;

export interface SyncMeta {
  /** clave de colección → id de registro → marca */
  collections: Record<string, Record<string, { u?: Iso; d?: Iso }>>;
  /** clave suelta → marca de última modificación */
  scalars: Record<string, Iso>;
}

export interface SyncState {
  data: LocalSnapshot;
  meta: SyncMeta;
  /** versión del formato; 2 = con fusión por registro */
  v: 2;
}

const isCollection = (key: string): boolean =>
  (COLLECTION_KEYS as readonly string[]).includes(key);

const emptyMeta = (): SyncMeta => ({ collections: {}, scalars: {} });

const asArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

const recordId = (record: Record<string, unknown>): string | null => {
  // Un horario mensual no tiene `id`: lo identifica su mes ("yyyy-MM").
  const id = record?.id ?? record?.month;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : null;
};

const stable = (value: unknown): string => JSON.stringify(value ?? null);

/** JSON con las claves de cada objeto en orden: dos estados iguales dan el mismo texto. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Huella de 53 bits (cyrb53) de un texto. Se usa para saber si un registro
 * cambió desde la última sincronización SIN guardar una copia entera de él:
 * la foto de referencia pesaba lo mismo que todos los datos del usuario y
 * duplicaba el espacio ocupado en localStorage.
 */
export function fingerprint(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const printOf = (value: unknown): string => fingerprint(stable(value));

const newer = (a: Iso | undefined, b: Iso | undefined): boolean => {
  if (!a) return false;
  if (!b) return true;
  return a > b; // ISO 8601 en UTC: el orden lexicográfico ES el cronológico
};

/** Un milisegundo después de `iso`. */
const justAfter = (iso: Iso): Iso => new Date(Date.parse(iso) + 1).toISOString();

/**
 * La marca de un cambio de este dispositivo: el instante de la edición, pero
 * nunca anterior a la marca que el registro ya tenía. Quien edita algo que
 * llegó de otro dispositivo lo editó DESPUÉS de verlo, aunque el reloj de este
 * equipo vaya atrasado: sin esto, una tablet con el reloj dos minutos atrás
 * perdía cada edición hecha sobre lo último de la laptop.
 */
const causalStamp = (at: Iso, previous: Iso | undefined): Iso => (previous && previous >= at ? justAfter(previous) : at);

// ---------------------------------------------------------------------------
// Contabilidad local
// ---------------------------------------------------------------------------

const metaKey = (uid: string) => `syncMeta_${uid}`;
const baseKey = (uid: string) => `lastSyncedSnapshot_${uid}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** ¿Este registro tiene lápida (se borró en algún dispositivo)? Para no resucitar lo que se creó con id fijo. */
export function hasTombstone(uid: string, key: string, id: string): boolean {
  const mark = readJson<SyncMeta>(metaKey(uid), emptyMeta()).collections?.[key]?.[id];
  return !!mark?.d && (!mark.u || mark.d >= mark.u);
}

/**
 * Foto de referencia de la última sincronización, en formato compacto: por
 * cada registro solo su huella. Basta para las dos preguntas que se le hacen
 * (¿existía este id?, ¿cambió?) y ocupa una fracción de la copia completa que
 * se guardaba antes.
 */
interface SyncBase {
  v: 3;
  collections: Record<string, Record<string, string>>;
  scalars: Record<string, string>;
}

function compactBase(data: LocalSnapshot): SyncBase {
  const base: SyncBase = { v: 3, collections: {}, scalars: {} };
  for (const key of Object.keys(data)) {
    if (RETIRED_KEYS.has(key)) continue;
    if (isCollection(key)) {
      if (!Array.isArray(data[key])) continue;
      const prints: Record<string, string> = {};
      for (const record of asArray(data[key])) {
        const id = recordId(record);
        if (id) prints[id] = printOf(record);
      }
      base.collections[key] = prints;
    } else {
      base.scalars[key] = printOf(data[key]);
    }
  }
  return base;
}

/** Lee la foto de referencia; convierte al vuelo la del formato antiguo. */
function readBase(uid: string): SyncBase | null {
  const raw = readJson<unknown>(baseKey(uid), null);
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SyncBase>;
  if (candidate.v === 3 && candidate.collections && candidate.scalars) return candidate as SyncBase;
  // Formato anterior: la copia completa de los datos.
  return compactBase(raw as LocalSnapshot);
}

// ---------------------------------------------------------------------------
// Cuándo se hizo cada cambio (1.6.8)
//
// Hasta la 1.6.7 un cambio recibía como marca el instante de la sincronización
// que lo subía, no el de la edición: ganaba quien sincronizaba último aunque
// hubiera editado antes. Ahora la sincronización en vivo anota cuándo vio cada
// cambio (con la huella del registro en ese momento) y esa es su marca si,
// al sincronizar, el registro sigue igual. Es la misma marca que viaja con el
// cambio por el canal, así que los dos dispositivos quedan con la misma.
// ---------------------------------------------------------------------------

interface LocalEdits {
  /** clave de colección → id → [instante, huella del registro; null si se borró] */
  c: Record<string, Record<string, [Iso, string | null]>>;
  /** clave suelta → [instante, huella del valor] */
  s: Record<string, [Iso, string]>;
}

const editsKey = (uid: string) => `syncEdits_${uid}`;

/** Lo mínimo de un cambio para anotarlo (sync-delta.ts lo cumple). */
interface EditedChange {
  key: string;
  id?: string;
  record?: unknown;
  value?: unknown;
  deleted?: boolean;
  at: Iso;
}

/**
 * Anota los cambios de este dispositivo y les pone su marca definitiva
 * (`at`, nunca anterior a la que el registro ya tenía). Devuelve los mismos
 * cambios, listos para viajar.
 */
export function noteLocalEdits<T extends EditedChange>(uid: string, changes: T[]): T[] {
  if (changes.length === 0) return changes;
  const meta = readJson<SyncMeta>(metaKey(uid), emptyMeta());
  const edits = readJson<LocalEdits>(editsKey(uid), { c: {}, s: {} });
  edits.c = edits.c ?? {};
  edits.s = edits.s ?? {};
  for (const change of changes) {
    if (change.id === undefined) {
      change.at = causalStamp(change.at, meta.scalars?.[change.key]);
      edits.s[change.key] = [change.at, printOf(change.value)];
    } else {
      const previous = meta.collections?.[change.key]?.[change.id];
      change.at = causalStamp(change.at, previous?.d ?? previous?.u);
      (edits.c[change.key] = edits.c[change.key] ?? {})[change.id] = [change.at, change.deleted ? null : printOf(change.record)];
    }
  }
  try {
    localStorage.setItem(editsKey(uid), JSON.stringify(edits));
  } catch {
    /* sin espacio: la marca será la de la sincronización, como antes */
  }
  return changes;
}

/**
 * Compara el estado actual con la foto de la última sincronización y actualiza
 * las marcas. Devuelve el estado listo para fusionar.
 *
 * `now` se pasa como parámetro para que las pruebas y las llamadas encadenadas
 * usen exactamente el mismo instante.
 */
export function buildLocalState(uid: string, data: LocalSnapshot, now: Iso): SyncState {
  const meta = readJson<SyncMeta>(metaKey(uid), emptyMeta());
  meta.collections = meta.collections ?? {};
  meta.scalars = meta.scalars ?? {};

  const base = readBase(uid);
  // Primera vez: no hay con qué comparar, así que todo lo presente se marca
  // como recién modificado. Es deliberado — ver la nota de migración del README.
  const first = base === null;
  const edits = first ? null : readJson<Partial<LocalEdits> | null>(editsKey(uid), null);
  /** Marca de un cambio: cuándo se editó (si sigue como se editó) o ahora. */
  const stamp = (edit: [Iso, string | null] | undefined, print: string | null, previous: Iso | undefined): Iso =>
    causalStamp(edit && edit[1] === print && edit[0] <= now ? edit[0] : now, previous);

  for (const key of Object.keys(data)) {
    if (RETIRED_KEYS.has(key)) continue;
    if (isCollection(key)) {
      // Una colección que no es una lista está CORRUPTA (escritura truncada,
      // JSON ilegible leído como texto). Tratarla como "lista vacía" lapidaría
      // todos sus registros en la nube y en los demás dispositivos: se la
      // considera ausente, y la fusión traerá la copia buena de la nube.
      if (!Array.isArray(data[key])) {
        delete data[key];
        continue;
      }

      const marks = (meta.collections[key] = meta.collections[key] ?? {});
      const current = asArray(data[key]);
      const previous = base?.collections[key] ?? {};
      const edited = edits?.c?.[key];

      const seen = new Set<string>();
      for (const record of current) {
        const id = recordId(record);
        if (!id) continue;
        seen.add(id);
        const before = previous[id];
        const print = printOf(record);
        if (first || before === undefined || before !== print) {
          marks[id] = { u: stamp(edited?.[id], print, marks[id]?.d ?? marks[id]?.u) };
        } else if (!marks[id]) {
          marks[id] = { u: now };
        }
      }

      // Lo que estaba y ya no está: lápida.
      for (const id of Object.keys(previous)) {
        if (!seen.has(id)) marks[id] = { d: stamp(edited?.[id], null, marks[id]?.d ?? marks[id]?.u) };
      }
    } else if (first || base?.scalars[key] !== printOf(data[key]) || !meta.scalars[key]) {
      meta.scalars[key] = stamp(edits?.s?.[key], printOf(data[key]), meta.scalars[key]);
    }
  }

  return { data, meta, v: 2 };
}

// ---------------------------------------------------------------------------
// Fusión
// ---------------------------------------------------------------------------

/** Normaliza un estado remoto: acepta el formato antiguo (snapshot pelado). */
export function normalizeRemote(raw: unknown, rowUpdatedAt: Iso | null): SyncState | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<SyncState> & LocalSnapshot;

  if (candidate.v === 2 && candidate.data && candidate.meta) {
    return {
      data: candidate.data,
      meta: {
        collections: candidate.meta.collections ?? {},
        scalars: candidate.meta.scalars ?? {},
      },
      v: 2,
    };
  }

  // Formato 1: el respaldo era el snapshot tal cual, sin marcas. Se le asigna
  // como marca la fecha de la fila, que es lo más cercano a la verdad.
  const stamp = rowUpdatedAt ?? new Date(0).toISOString();
  const meta = emptyMeta();
  const data = raw as LocalSnapshot;
  for (const key of Object.keys(data)) {
    if (isCollection(key)) {
      const marks: Record<string, { u?: Iso; d?: Iso }> = {};
      for (const record of asArray(data[key])) {
        const id = recordId(record);
        if (id) marks[id] = { u: stamp };
      }
      meta.collections[key] = marks;
    } else {
      meta.scalars[key] = stamp;
    }
  }
  return { data, meta, v: 2 };
}

/**
 * Fusiona dos estados registro a registro. Gana siempre la marca más reciente,
 * y una lápida gana a una modificación anterior (borrar es una decisión tan
 * válida como editar, y si no, lo borrado reaparecería para siempre).
 */
export function mergeStates(local: SyncState, remote: SyncState, now: Iso): SyncState {
  const merged: LocalSnapshot = {};
  const meta = emptyMeta();
  const cutoff = new Date(Date.parse(now) - TOMBSTONE_TTL_MS).toISOString();

  const keys = new Set([...Object.keys(local.data), ...Object.keys(remote.data)]);

  for (const key of keys) {
    if (RETIRED_KEYS.has(key)) continue;

    // De una versión más nueva: tal cual la tiene la nube (datos y marcas). Lo
    // de aquí es la copia de la última vez; solo cuenta si la nube la perdió
    // (la borró al subir un dispositivo con la 1.6.8 o anterior).
    if (isForeign(key)) {
      const source = key in remote.data ? remote : local;
      merged[key] = source.data[key];
      if (source.meta.collections[key]) meta.collections[key] = source.meta.collections[key];
      if (source.meta.scalars[key]) meta.scalars[key] = source.meta.scalars[key];
      continue;
    }

    if (!isCollection(key)) {
      const localAt = local.meta.scalars[key];
      const remoteAt = remote.meta.scalars[key];
      const takeLocal = key in local.data && (!(key in remote.data) || !newer(remoteAt, localAt));
      merged[key] = takeLocal ? local.data[key] : remote.data[key];
      meta.scalars[key] = (takeLocal ? localAt : remoteAt) ?? now;
      continue;
    }

    const localMarks = local.meta.collections[key] ?? {};
    const remoteMarks = remote.meta.collections[key] ?? {};
    const byId = new Map<string, Record<string, unknown>>();
    const order: string[] = [];

    const index = (records: Record<string, unknown>[], into: Map<string, Record<string, unknown>>) => {
      for (const record of records) {
        const id = recordId(record);
        if (id) into.set(id, record);
      }
    };
    const localById = new Map<string, Record<string, unknown>>();
    const remoteById = new Map<string, Record<string, unknown>>();
    index(asArray(local.data[key]), localById);
    index(asArray(remote.data[key]), remoteById);

    // El orden lo marca el local (es el que el usuario está viendo); lo que
    // solo existe en remoto se añade al final.
    for (const record of asArray(local.data[key])) {
      const id = recordId(record);
      if (id) order.push(id);
    }
    for (const id of remoteById.keys()) {
      if (!localById.has(id)) order.push(id);
    }

    const marks: Record<string, { u?: Iso; d?: Iso }> = {};
    for (const id of new Set(order)) {
      const lm = localMarks[id];
      const rm = remoteMarks[id];
      const localStamp = lm?.d ?? lm?.u;
      const remoteStamp = rm?.d ?? rm?.u;
      const winner = newer(remoteStamp, localStamp) ? 'remote' : 'local';
      const mark = winner === 'remote' ? rm : lm;

      if (mark?.d) {
        // Lápida vigente: el registro no viaja, pero la marca sí (para que el
        // otro dispositivo también lo borre). Las viejas se descartan.
        if (mark.d > cutoff) marks[id] = { d: mark.d };
        continue;
      }

      // Si el lado que gana no tiene el registro (y no hay lápida que lo
      // explique), se toma el del otro: sin una lápida explícita NUNCA se
      // pierde un dato. Pasa, por ejemplo, cuando la colección local estaba
      // corrupta y se descartó: quedan sus marcas pero no sus registros.
      const record =
        (winner === 'remote' ? remoteById.get(id) : localById.get(id)) ??
        remoteById.get(id) ??
        localById.get(id);
      if (!record) continue;
      byId.set(id, record);
      marks[id] = { u: mark?.u ?? now };
    }

    // LÁPIDAS SIN REGISTRO. El bucle de arriba solo recorre ids que siguen
    // presentes en algún lado. En cuanto un borrado se propagaba a la nube, el
    // id dejaba de estar en ambos y su lápida se perdía en la sincronización
    // siguiente: un dispositivo rezagado (apagado unos días) llegaba después
    // con el registro intacto y LO RESUCITABA en todos. La lápida tiene que
    // vivir sus dos meses completos, exista o no el registro.
    const resolved = new Set(order);
    for (const id of new Set([...Object.keys(localMarks), ...Object.keys(remoteMarks)])) {
      if (resolved.has(id)) continue;
      const localD = localMarks[id]?.d;
      const remoteD = remoteMarks[id]?.d;
      const d = newer(localD, remoteD) ? localD : remoteD ?? localD;
      if (d && d > cutoff) marks[id] = { d };
    }

    merged[key] = [...new Set(order)].map((id) => byId.get(id)).filter(Boolean);
    meta.collections[key] = marks;
  }

  return { data: merged, meta, v: 2 };
}

/**
 * Huella de un estado que no depende del orden de las claves ni del de las
 * filas de cada colección (se ordenan por id). Sirve para saber si lo
 * fusionado ya es lo que hay en la nube: si lo es, no se escribe. Sin esto, dos
 * dispositivos se reenviaban sin fin el mismo estado (cada escritura avisaba
 * al otro, que volvía a escribir).
 */
export function statePrint(state: SyncState): string {
  const data: LocalSnapshot = {};
  for (const [key, value] of Object.entries(state.data)) {
    if (RETIRED_KEYS.has(key)) continue;
    data[key] =
      isCollection(key) && Array.isArray(value)
        ? [...asArray(value)].sort((a, b) => String(recordId(a)).localeCompare(String(recordId(b))))
        : value;
  }
  const collections: SyncMeta['collections'] = {};
  for (const [key, marks] of Object.entries(state.meta.collections ?? {})) {
    if (!RETIRED_KEYS.has(key) && !MARKS_LOST_BY_OLD.has(key)) collections[key] = marks;
  }
  // Una marca suelta de una colección solo la pone la 1.6.7 (ver MARKS_LOST_BY_OLD).
  const scalars: SyncMeta['scalars'] = {};
  for (const [key, at] of Object.entries(state.meta.scalars ?? {})) {
    if (!RETIRED_KEYS.has(key) && !isCollection(key)) scalars[key] = at;
  }
  return fingerprint(canonical({ data, meta: { collections, scalars } }));
}

/** Huella del estado de ESTE dispositivo (sus datos en forma de nube y su contabilidad). */
export function localStatePrint(uid: string, data: LocalSnapshot): string {
  return statePrint(withForeign(uid, { data, meta: readJson<SyncMeta>(metaKey(uid), emptyMeta()), v: 2 }));
}

/** Un cambio de este dispositivo que aún no está en la nube (para el verificador). */
export interface PendingChange {
  key: string;
  /** Registro cambiado o nuevo; ausente si se borró o si es un valor suelto. */
  record?: Record<string, unknown>;
  id?: string;
  deleted?: boolean;
}

/**
 * Lo que cambió aquí desde la última sincronización, sin tocar la contabilidad
 * (mismo criterio que buildLocalState). Sin foto de referencia no se sabe
 * nada: devuelve una lista vacía.
 */
export function pendingChanges(uid: string, data: LocalSnapshot): PendingChange[] {
  const base = readBase(uid);
  if (!base) return [];
  const out: PendingChange[] = [];
  for (const key of Object.keys(data)) {
    if (RETIRED_KEYS.has(key)) continue;
    if (isCollection(key)) {
      if (!Array.isArray(data[key])) continue;
      const previous = base.collections[key] ?? {};
      const seen = new Set<string>();
      for (const record of asArray(data[key])) {
        const id = recordId(record);
        if (!id) continue;
        seen.add(id);
        if (previous[id] !== printOf(record)) out.push({ key, id, record });
      }
      for (const id of Object.keys(previous)) if (!seen.has(id)) out.push({ key, id, deleted: true });
    } else if (base.scalars[key] !== printOf(data[key])) {
      out.push({ key });
    }
  }
  return out;
}

/** Huellas de la última sincronización (para calcular qué cambió desde entonces). */
export function syncedPrints(uid: string): SyncBase | null {
  return readBase(uid);
}

/** Huella de un registro o valor, la misma que usa la foto de referencia. */
export const recordPrint = printOf;
export { recordId, isCollection };

/**
 * Anota en la contabilidad lo que llegó por el canal en vivo (sync-delta.ts):
 * su marca y su huella, como si hubiera llegado en una sincronización. Así el
 * ciclo siguiente no lo toma por un cambio de este dispositivo.
 */
export function noteRemoteChanges(
  uid: string,
  changes: { key: string; id?: string; record?: unknown; value?: unknown; deleted?: boolean; at: Iso }[]
): void {
  if (changes.length === 0) return;
  const meta = readJson<SyncMeta>(metaKey(uid), emptyMeta());
  meta.collections = meta.collections ?? {};
  meta.scalars = meta.scalars ?? {};
  const base = readBase(uid) ?? { v: 3 as const, collections: {}, scalars: {} };
  for (const change of changes) {
    if (change.id !== undefined) {
      const marks = (meta.collections[change.key] = meta.collections[change.key] ?? {});
      const prints = (base.collections[change.key] = base.collections[change.key] ?? {});
      if (change.deleted) {
        marks[change.id] = { d: change.at };
        delete prints[change.id];
      } else {
        marks[change.id] = { u: change.at };
        prints[change.id] = printOf(change.record);
      }
    } else {
      meta.scalars[change.key] = change.at;
      base.scalars[change.key] = printOf(change.value);
    }
  }
  try {
    localStorage.setItem(metaKey(uid), JSON.stringify(meta));
    localStorage.setItem(baseKey(uid), JSON.stringify(base));
  } catch {
    /* sin espacio: el ciclo completo siguiente lo reconcilia igual */
  }
}

/** Guarda el resultado como nueva foto de referencia y contabilidad. */
export function commitState(uid: string, state: SyncState): void {
  // La contabilidad primero: es lo pequeño y lo que guarda las lápidas.
  try {
    localStorage.setItem(metaKey(uid), JSON.stringify(state.meta));
    // Lo anotado ya tiene su marca en la contabilidad.
    localStorage.removeItem(editsKey(uid));
  } catch {
    /* sin espacio: se reintentará en el próximo ciclo */
  }
  // Lo que esta versión no conoce se guarda aparte para no quitárselo a la
  // nube al subir sin bajar (withForeign).
  try {
    const foreign = Object.fromEntries(Object.entries(state.data).filter(([key]) => isForeign(key)));
    if (Object.keys(foreign).length > 0) localStorage.setItem(foreignKey(uid), JSON.stringify(foreign));
    else localStorage.removeItem(foreignKey(uid));
  } catch {
    /* sin espacio: la nube lo conserva igual; solo se perdería al subir sin bajar */
  }
  try {
    localStorage.setItem(baseKey(uid), JSON.stringify(compactBase(state.data)));
  } catch {
    // Si ni la foto compacta cabe se conserva la anterior: comparar contra una
    // foto vieja solo re-marca cambios; quedarse SIN foto haría que cada ciclo
    // fuese "la primera vez" y que nada de lo borrado llegara a lapidarse.
  }
}

