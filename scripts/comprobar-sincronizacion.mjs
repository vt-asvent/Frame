// Cobertura de la sincronización (2.0.0, Diego): todo lo que Frame guarda por usuario tiene que estar aquí, con cómo
// llega a los demás dispositivos de la cuenta o por qué se queda en este. Si aparece una clave nueva en el código y
// nadie decide qué pasa con ella, esta comprobación falla: así nada «se queda sin sincronizar» por olvido.
//
//   node scripts/comprobar-sincronizacion.mjs
//
// Qué mira: las claves `nombre_<uid>` que el código escribe en el almacenamiento y la lista de lo que viaja con la
// cuenta (`SCOPED_KEYS`, storage-snapshot.ts) y de lo que se fusiona registro a registro (`COLLECTION_KEYS`).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');

/** Cómo viaja cada clave por usuario, o por qué no viaja. */
const COBERTURA = {
  // --- Con la cuenta (la nube de Frame): están en SCOPED_KEYS ---
  // --- Por Wire (el Drive del usuario): archivos que no caben en la cuenta ---
  noteFile: 'wire · archivo de un recurso (la ficha viaja en `notes`)',
  taskFile: 'wire · adjunto de una tarea o evento (la ficha viaja en `tasks` y `localEvents`)',
  courseImage: 'imágenes · de la galería por su código (`imageRefs`); propia, por Wire',
  spaceImage: 'imágenes · de la galería por su código (`imageRefs`); propia, por Wire',
  playlistImage: 'imágenes · de la galería por su código (`imageRefs`); propia, por Wire',
  profileAvatar: 'imágenes · foto de perfil, por la nube (`syncedImages`, image-sync.ts)',
  timetableImage: 'imágenes · foto del horario, por la nube (`syncedImages`, image-sync.ts)',
  scheduleImage: 'retirada · el horario anterior a la 1.9.0; solo se migra',
  lyrics: 'wire · la letra viaja con su canción la primera vez (ficha de datos del relevo)',
  // --- Contabilidad de la propia sincronización: es de cada equipo por definición ---
  lastSyncedSnapshot: 'equipo · foto de la última sincronización',
  syncCursor: 'equipo · qué versión de la nube vio este equipo',
  syncEdits: 'equipo · cuándo se editó cada registro aquí',
  syncForeign: 'equipo · copia de lo que la nube trae de versiones más nuevas',
  syncMeta: 'equipo · marcas y lápidas ya fusionadas',
  syncStatus: 'equipo · último intento de sincronizar',
  imageSyncBase: 'equipo · qué imágenes se subieron o bajaron aquí',
  imageSyncDeleted: 'equipo · imágenes borradas aquí, hasta avisar a la nube',
  imageRefsNotified: 'equipo · avisos de imágenes ya enseñados',
  songKeys: 'equipo · índice id → clave de las canciones de este equipo',
  songFavoritesSeeded: 'equipo · marca de la migración de corazones de la 1.6.9',
  frameDeviceResync: 'equipo · último «Corregir» atendido',
  // --- Estado de este equipo, que no tiene sentido en otro ---
  activeSession: 'equipo · sesión de estudio en curso (recuperación tras un cierre)',
  interruptedSession: 'equipo · sesión de estudio interrumpida aquí',
  sessionNotes: 'equipo · anotaciones de la sesión en curso; al terminar pasan a `studySessions`, que viaja',
  timetableSelected: 'equipo · qué horario se está mirando',
  recordingSettings: 'equipo · tope de minutos de la grabadora',
  notificationsSeen: 'equipo · avisos ya vistos en esta campana',
  frameNotificationLog: 'equipo · registro de avisos de este equipo',
  frameNotificationCleared: 'equipo · hasta dónde se limpió ese registro',
  taskReminderLastSent: 'equipo · cada equipo da sus propios recordatorios',
  localEventReminderSent: 'equipo · cada equipo da sus propios recordatorios',
  weatherCache: 'equipo · caché del clima',
  weatherPlace: 'cuenta · la ciudad elegida a mano viaja dentro de `appSettings` (account-settings.ts); esta es su copia local',
  weatherPlaceImages: 'equipo · caché de fotos de la ciudad',
  videoThumb: 'equipo · miniaturas de los vídeos de estudio, que se vuelven a bajar de YouTube',
  guestAdoptionAnswered: 'equipo · respuesta a «¿traer lo del invitado?»',
  guestLinkedTo: 'equipo · a qué cuenta se vinculó el invitado de este equipo',
  telemetryBestStreak: 'equipo · métricas de uso',
  telemetryDaily: 'equipo · métricas de uso',
  telemetryLastSync: 'equipo · métricas de uso',
  telemetryQueue: 'equipo · métricas de uso',
  notionImported: 'equipo · qué exportación de Notion ya se trajo aquí, para no repetirla (solo en Frame móvil; en Windows lo guarda la extensión)',
  // --- Retiradas: la fusión las descarta (RETIRED_KEYS) ---
  classSessions: 'retirada · clases, invisibles desde la 1.6.6',
  schedules: 'retirada · horario de clases anterior a la 1.9.0',
};

/** Claves que solo existen en una de las dos apps (este archivo es el mismo en las dos). */
const SOLO_EN_UNA = new Set(['notionImported']);
/** Lo que el buscador toma por clave y no lo es (un nombre de registro de Google en google/auth.ts). */
const NO_SON_CLAVES = new Set(['http']);

// ---------------------------------------------------------------------------
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.tsx?$/.test(name) && !/^i18n-/.test(name) && !full.includes(`${path.sep}legal${path.sep}`)) files.push(full);
  }
})(src);

const found = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/[`'"]([A-Za-z][A-Za-z0-9]*)_(?:\$\{|[`'"]\s*\+)/g)) {
    const list = found.get(match[1]) ?? [];
    list.push(path.relative(root, file).replace(/\\/g, '/'));
    found.set(match[1], list);
  }
}

const listOf = (file, name) => {
  const text = readFileSync(path.join(src, file), 'utf8');
  const body = new RegExp(`const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(text)?.[1] ?? '';
  return [...body.matchAll(/^\s*'([A-Za-z]+)',/gm)].map((m) => m[1]);
};
const scoped = listOf('lib/storage-snapshot.ts', 'SCOPED_KEYS');
const collections = new Set(listOf('lib/sync-merge.ts', 'COLLECTION_KEYS'));
/** Lo que viaja con la cuenta sin ser una lista de fichas: un valor entero, el más reciente gana. */
const SCALARS = new Set(['studyGoals', 'streakGoal', 'selectionMode', 'advancedMode', 'completedTasks', 'completedTasksByCourse', 'taskSortMode', 'isPlayerVisible', 'playCount', 'appSettings', 'syncKey']);

const errors = [];
for (const key of scoped) {
  if (key in COBERTURA) errors.push(`«${key}» viaja con la cuenta: sobra en COBERTURA`);
  if (!collections.has(key) && !SCALARS.has(key)) errors.push(`«${key}» viaja con la cuenta pero no es ni colección (COLLECTION_KEYS) ni valor suelto conocido: decide cómo se fusiona`);
}
for (const key of collections) if (!scoped.includes(key)) errors.push(`«${key}» se fusiona como colección pero no está en SCOPED_KEYS: nunca viajaría`);
for (const [key, where] of found) {
  if (scoped.includes(key) || key in COBERTURA || NO_SON_CLAVES.has(key)) continue;
  errors.push(`«${key}_<uid>» (${[...new Set(where)].slice(0, 2).join(', ')}) no está clasificada: ¿viaja con la cuenta, por Wire o es de este equipo?`);
}
for (const key of Object.keys(COBERTURA)) if (!found.has(key) && !SOLO_EN_UNA.has(key)) errors.push(`«${key}» está en COBERTURA pero el código ya no la usa: quítala`);

const count = (prefix) => Object.values(COBERTURA).filter((why) => why.startsWith(prefix)).length;
console.log(`Con la cuenta: ${scoped.length} claves (${collections.size} colecciones) · por Wire o imágenes: ${count('wire') + count('imágenes')} · de cada equipo: ${count('equipo')} · retiradas: ${count('retirada')}`);
if (errors.length) {
  for (const error of errors) console.log(`  ✗ ${error}`);
  console.log(`\n${errors.length} sin resolver.`);
  process.exit(1);
}
console.log('✓ Todo lo que Frame guarda por usuario está clasificado.');
