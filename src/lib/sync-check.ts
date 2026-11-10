import { useSyncExternalStore } from 'react';
import { format, parseISO } from 'date-fns';
import { collectLocalData } from '@/lib/storage-snapshot';
import { pendingChanges } from '@/lib/sync-merge';
import { SYNC_RECHECK_EVENT, getSyncStatus, subscribeSyncStatus } from '@/lib/sync-status';
import { IMAGE_REFS_EVENT, entityOfImage, imageRefsReport } from '@/lib/image-refs';
import { describeSongKey, isSongKey, libraryIds, subscribeLibrary } from '@/lib/song-keys';
import { hasAttachment } from '@/lib/file-handles';
import { listImageKeys } from '@/lib/music-db';
import { richNoteToLine } from '@/lib/rich-note';
import { monthName } from '@/lib/timetable';
import { CLOUD_APPLIED_EVENT } from '@/lib/supabase/sync';
import { getConnectionState } from '@/lib/connection-status';
import { dateLocale, subscribeLang, tr } from '@/lib/i18n';

// ============================================================
// Verificador de sincronización (1.6.8, Diego).
//
// Cuenta lo que NO está igual en los dispositivos de la cuenta y dice, de
// cada cosa, qué es, en qué interfaz está y por qué:
//
//   · cambios de aquí que aún no llegaron a la nube (sin conexión, o la
//     sincronización falló: entonces también el motivo);
//   · imágenes propias de asignaturas, colecciones o playlists que se
//     eligieron en otro dispositivo (las imágenes propias no viajan);
//   · imágenes de la galería que esta versión de Frame no tiene;
//   · canciones de una playlist que no están en este dispositivo (la música
//     no viaja);
//   · adjuntos de tareas, eventos y recursos que se quedaron en el
//     dispositivo donde se añadieron.
//
// La campana muestra cuántas son; al pulsar, un recuadro las enumera
// (SyncIssuesDialog).
// ============================================================

export interface SyncIssue {
  /** Identidad estable (para no repetir avisos). */
  id: string;
  /** Interfaz donde está. */
  where: string;
  /** Qué es. */
  what: string;
  /** Por qué no está sincronizado. */
  why: string;
  kind: 'pending' | 'error' | 'image' | 'song' | 'attachment';
  route?: string;
}

/** Interfaz y nombre de cada colección sincronizada, para el verificador. */
const WHERE: Record<string, { where: () => string; route: string; label: (row: Record<string, unknown>) => string }> = {
  courses: { where: () => tr('Asignaturas'), route: '/knowledge', label: (row) => String(row.name ?? '') },
  spaces: { where: () => tr('Asignaturas'), route: '/knowledge', label: (row) => String(row.name ?? '') },
  tasks: { where: () => tr('Tareas'), route: '/tareas', label: (row) => String(row.name ?? '') },
  incompleteTasks: { where: () => tr('Tareas'), route: '/tareas', label: (row) => String(row.name ?? '') },
  archivedTasks: { where: () => tr('Tareas'), route: '/tareas', label: (row) => String(row.name ?? '') },
  notes: { where: () => tr('Asignaturas'), route: '/knowledge', label: (row) => richNoteToLine(String(row.content ?? '')) },
  archivedNotes: { where: () => tr('Asignaturas'), route: '/knowledge', label: (row) => richNoteToLine(String(row.content ?? '')) },
  looseNotes: { where: () => tr('Inicio'), route: '/', label: (row) => richNoteToLine(String(row.content ?? row.text ?? '')) },
  timetables: { where: () => tr('Inicio'), route: '/', label: (row) => tr('Horario de {month}', { month: monthName(String(row.month ?? ''), true) }) },
  localEvents: { where: () => tr('Calendario'), route: '/calendario', label: (row) => String(row.title ?? '') },
  dayColors: { where: () => tr('Calendario'), route: '/calendario', label: (row) => tr('Color del {day}', { day: dayLabel(String(row.id ?? '')) }) },
  habits: { where: () => tr('Hábitos'), route: '/habitos', label: (row) => String(row.name ?? '') },
  studySessions: { where: () => tr('Estudio'), route: '/temporizador', label: (row) => tr('Sesión del {day}', { day: dayLabel(String(row.startTime ?? '')) }) },
  dailyPerformances: { where: () => tr('Estudio'), route: '/temporizador', label: (row) => tr('Nota del {day}', { day: dayLabel(String(row.date ?? row.id ?? '')) }) },
  playlists: { where: () => tr('Música'), route: '/music', label: (row) => String(row.name ?? '') },
  studyVideos: { where: () => tr('Estudio'), route: '/temporizador', label: (row) => String(row.title ?? '') },
  loreFavorites: { where: () => tr('Biblioteca'), route: '/biblioteca', label: () => tr('Favoritos') },
  subjectLinks: { where: () => tr('Inicio'), route: '/', label: (row) => tr('Asignatura de «{name}» en el horario', { name: String(row.id ?? '') }) },
  songFavorites: {
    where: () => tr('Música'),
    route: '/music',
    label: (row) => {
      const { title, artist } = describeSongKey(String(row.id ?? ''));
      return tr('Favorito: {song}', { song: artist ? `${title} — ${artist}` : title });
    },
  },
};

/** Valores sueltos: dónde se ven y cómo se llaman. */
const SCALARS: Record<string, { where: () => string; what: () => string; route: string }> = {
  studyGoals: { where: () => tr('Ajustes'), what: () => tr('Metas diarias de estudio'), route: '/settings' },
  streakGoal: { where: () => tr('Ajustes'), what: () => tr('Meta de racha'), route: '/settings' },
  selectionMode: { where: () => tr('Estudio'), what: () => tr('Modo del temporizador'), route: '/temporizador' },
  completedTasks: { where: () => tr('Tareas'), what: () => tr('Tareas culminadas'), route: '/tareas' },
  completedTasksByCourse: { where: () => tr('Tareas'), what: () => tr('Tareas culminadas'), route: '/tareas' },
  taskSortMode: { where: () => tr('Tareas'), what: () => tr('Orden de las tareas'), route: '/tareas' },
  isPlayerVisible: { where: () => tr('Música'), what: () => tr('Reproductor'), route: '/music' },
  playCount: { where: () => tr('Música'), what: () => tr('Reproducciones'), route: '/music' },
  appSettings: { where: () => tr('Ajustes'), what: () => tr('Idioma y preferencias'), route: '/settings' },
};

function dayLabel(iso: string): string {
  try {
    return format(parseISO(iso), tr("d 'de' MMMM"), { locale: dateLocale() });
  } catch {
    return iso;
  }
}

const short = (text: string) => (text.length > 60 ? `${text.slice(0, 59).trimEnd()}…` : text) || tr('(sin título)');

/** El motivo de un fallo en palabras del usuario: los de la red llegan en inglés y en jerga. */
function humanError(message: string): string {
  // La nube cerró la sesión de este equipo: lo mismo que dice la campana, que es desde donde se arregla.
  if (getConnectionState().sessionLostFor) return tr('La sesión se cerró: vuelve a conectar tu cuenta');
  if (/fetch|network|timed? ?out|abort|ECONN|ENOTFOUND|load failed/i.test(message)) return tr('No se pudo conectar con la nube');
  if (/JWT|token|refresh/i.test(message)) return tr('La sesión se cerró: vuelve a conectar tu cuenta');
  return message.replace(/\.$/, '');
}

/** Todo lo que no está sincronizado ahora mismo. */
export async function computeSyncIssues(uid: string): Promise<SyncIssue[]> {
  const issues: SyncIssue[] = [];
  const status = getSyncStatus();

  // --- 1. La sincronización misma ---
  if (status.phase === 'error' && status.lastError) {
    issues.push({
      id: 'error',
      kind: 'error',
      where: tr('Sincronización'),
      what: tr('La última sincronización falló'),
      why: tr('{error}. Frame lo reintenta solo.', { error: humanError(status.lastError) }),
    });
  }

  // --- 2. Cambios de aquí que aún no están en la nube ---
  const data = collectLocalData(uid);
  if (status.phase === 'offline' || status.phase === 'error') {
    const why =
      status.phase === 'offline'
        ? tr('Sin conexión: se subirá en cuanto vuelva internet.')
        : tr('Aún no se pudo subir: se reintenta solo.');
    for (const change of pendingChanges(uid, data)) {
      if (change.key === 'syncKey' || change.key === 'syncedImages' || change.key === 'imageRefs') continue;
      const place = WHERE[change.key];
      if (place) {
        issues.push({
          id: `pending:${change.key}:${change.id}`,
          kind: 'pending',
          where: place.where(),
          what: change.deleted ? tr('Algo que se borró aquí') : short(place.label(change.record ?? {})),
          why,
          route: place.route,
        });
        continue;
      }
      const scalar = SCALARS[change.key];
      if (scalar) issues.push({ id: `pending:${change.key}`, kind: 'pending', where: scalar.where(), what: scalar.what(), why, route: scalar.route });
    }
  }

  // --- 3. Imágenes que no viajan ---
  const report = imageRefsReport();
  for (const ref of report.ownElsewhere) {
    const entity = entityOfImage(uid, ref.id);
    if (!entity) continue;
    issues.push({
      id: `image:${ref.id}:${ref.h}`,
      kind: 'image',
      where: entity.where,
      what: tr('Imagen de «{name}»', { name: entity.name }),
      why: tr('Es una imagen propia elegida en otro dispositivo: viaja con la extensión Wire. Sin Wire, elige una de la galería de Frame para verla en todos tus dispositivos.'),
      route: entity.route,
    });
  }
  for (const ref of report.missing) {
    const entity = entityOfImage(uid, ref.id);
    if (!entity) continue;
    issues.push({
      id: `image-missing:${ref.id}`,
      kind: 'image',
      where: entity.where,
      what: tr('Imagen de «{name}»', { name: entity.name }),
      why: tr('Es de la galería de una versión más nueva de Frame: actualiza este dispositivo para verla.'),
      route: entity.route,
    });
  }

  // --- 4. Canciones de las playlists que no están aquí ---
  const library = libraryIds();
  if (library) {
    const playlists = Array.isArray(data.playlists) ? (data.playlists as { id?: string; name?: string; songIds?: unknown }[]) : [];
    const localPlaylists = (() => {
      try {
        return JSON.parse(localStorage.getItem(`playlists_${uid}`) ?? '[]') as { id?: string; songIds?: unknown }[];
      } catch {
        return [];
      }
    })();
    for (const playlist of playlists) {
      const local = localPlaylists.find((item) => item?.id === playlist.id);
      const entries = Array.isArray(local?.songIds) ? (local!.songIds as unknown[]).filter((id): id is string => typeof id === 'string') : [];
      const where = tr('Música · {name}', { name: playlist.name ?? '' });
      const route = playlist.id ? `/playlists?id=${encodeURIComponent(playlist.id)}` : '/music';
      let foreign = 0;
      for (const entry of entries) {
        if (library.has(entry)) continue;
        if (!isSongKey(entry)) {
          foreign += 1;
          continue;
        }
        const { title, artist } = describeSongKey(entry);
        issues.push({
          id: `song:${playlist.id}:${entry}`,
          kind: 'song',
          where,
          what: artist ? `${title} — ${artist}` : title,
          why: tr('La música viaja entre dispositivos con la extensión Wire. Sin Wire, importa esta canción aquí para que aparezca en la playlist.'),
          route,
        });
      }
      if (foreign > 0) {
        issues.push({
          id: `song-foreign:${playlist.id}`,
          kind: 'song',
          where,
          what: foreign === 1 ? tr('1 canción de otro dispositivo') : tr('{n} canciones de otro dispositivo', { n: foreign }),
          why: tr('Se añadieron con una versión anterior de Frame: aparecerán con su nombre cuando ese dispositivo se actualice.'),
          route,
        });
      }
    }
  }

  // --- 5. Adjuntos que se quedaron en otro dispositivo ---
  const withFiles: { rows: unknown; where: (row: Record<string, unknown>) => string; route: string }[] = [
    { rows: data.tasks, where: (row) => tr('Tareas · {name}', { name: String(row.name ?? '') }), route: '/tareas' },
    { rows: data.localEvents, where: (row) => tr('Calendario · {name}', { name: String(row.title ?? '') }), route: '/calendario' },
  ];
  for (const group of withFiles) {
    for (const row of Array.isArray(group.rows) ? (group.rows as Record<string, unknown>[]) : []) {
      const attachments = Array.isArray(row.attachments) ? (row.attachments as { id?: string; kind?: string; label?: string }[]) : [];
      for (const attachment of attachments) {
        if (attachment.kind !== 'file' || !attachment.id || (await hasAttachment(attachment.id))) continue;
        issues.push({
          id: `file:${attachment.id}`,
          kind: 'attachment',
          where: group.where(row),
          what: attachment.label || tr('Archivo adjunto'),
          why: tr('Los archivos adjuntos viajan con la extensión Wire; sin ella, se quedan en el dispositivo donde se añadieron.'),
          route: group.route,
        });
      }
    }
  }
  const imageKeys = new Set(await listImageKeys().catch(() => [] as string[]));
  const courses = Array.isArray(data.courses) ? (data.courses as { id?: string; name?: string }[]) : [];
  for (const note of Array.isArray(data.notes) ? (data.notes as Record<string, unknown>[]) : []) {
    if (note.kind !== 'file' || imageKeys.has(`noteFile_${note.id}`)) continue;
    const course = courses.find((item) => item.id === note.courseId);
    issues.push({
      id: `note-file:${note.id}`,
      kind: 'attachment',
      where: tr('Asignaturas · {name}', { name: course?.name ?? '' }),
      what: short(String(note.fileName ?? richNoteToLine(String(note.content ?? '')))),
      why: tr('Los archivos adjuntos viajan con la extensión Wire; sin ella, se quedan en el dispositivo donde se añadieron.'),
      route: '/knowledge',
    });
  }

  return issues;
}

// ------------------------------------------------------------
// Estado compartido y arranque
// ------------------------------------------------------------

let issues: SyncIssue[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const getIssues = () => issues;

/** Para quien no es un componente (Dispositivos). */
export const currentSyncIssues = getIssues;
export const subscribeSyncIssues = subscribe;

export function useSyncIssues(): SyncIssue[] {
  return useSyncExternalStore(subscribe, getIssues, getIssues);
}

/** Pide al recuadro del verificador que se abra (desde la campana). */
export const OPEN_SYNC_ISSUES_EVENT = 'frame:open-sync-issues';
export const openSyncIssues = () => window.dispatchEvent(new Event(OPEN_SYNC_ISSUES_EVENT));

/** Para la cuenta que sincroniza: recalcula al llegar datos, al cambiar el estado y cada 2 min. */
export function startSyncCheck(uid: string): () => void {
  let timer: number | null = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      const next = await computeSyncIssues(uid);
      if (JSON.stringify(next) !== JSON.stringify(issues)) {
        issues = next;
        emit();
      }
    } catch {
      /* el siguiente aviso lo recalcula */
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(500);
      }
    }
  };
  const schedule = (delay = 1500) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };
  const onEvent = () => schedule();
  window.addEventListener(CLOUD_APPLIED_EVENT, onEvent);
  window.addEventListener(IMAGE_REFS_EVENT, onEvent);
  window.addEventListener(SYNC_RECHECK_EVENT, onEvent);
  const stopStatus = subscribeSyncStatus(onEvent);
  const stopLang = subscribeLang(onEvent);
  // Una canción que llega (Wire, una importación) deja de faltar en sus playlists.
  const stopLibrary = subscribeLibrary(onEvent);
  const interval = window.setInterval(onEvent, 120_000);
  schedule(4000);
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    window.clearInterval(interval);
    window.removeEventListener(CLOUD_APPLIED_EVENT, onEvent);
    window.removeEventListener(IMAGE_REFS_EVENT, onEvent);
    window.removeEventListener(SYNC_RECHECK_EVENT, onEvent);
    stopStatus();
    stopLang();
    stopLibrary();
    issues = [];
    emit();
  };
}

/** Vuelve a calcular ya (tras «Sincronizar ahora» o una imagen nueva). */
export { SYNC_NOW_EVENT } from '@/lib/sync-status';
