import React, { createContext, useContext, useState, ReactNode, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePathname } from '@/lib/navigation';
import type {
  Course,
  Task,
  Note,
  NoteKind,
  ArchivedTask,
  ArchivedNote,
  LocalCalendarEvent,
  CalendarDayColor,
  Recording,
  UserProfile,
  StudySession,
  SessionNote,
  DailyPerformance,
  Song,
  Playlist,
  StudyGoals,
  Space,
  StreakGoal,
  InterruptedSession,
  RepeatMode,
  Habit,
  HabitPhase,
} from '@/types';
import {
  deleteSongFileFromDB,
  getAllSongMetadata,
  saveSongMetadata,
  deleteSongMetadata, saveImage,
  deleteImage,
  deleteRecordingAudio
} from '@/lib/music-db';
import { toast } from '@/hooks/use-toast';
import { syncTelemetry, telemetryDue, trackEvent } from '@/lib/telemetry';
import { CLOUD_APPLIED_EVENT } from '@/lib/supabase/sync';
import { timerClock, useTimerTime } from '@/lib/timer-clock';
import { COVER_HEAVY_CHARS, idle, shrinkCover } from '@/lib/cover-shrink';
import { notify } from '@/lib/notify';
import { useLocalEventReminders } from '@/components/calendar/useEventReminders';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { deleteAttachment } from '@/lib/file-handles';
import { forgetLyrics } from '@/lib/lyrics';
import { UNKNOWN_ARTIST } from '@/lib/enum-labels';
import { reviewStoredSong } from '@/lib/music-review';
import { foldName, isJunkTag } from '@/lib/song-names';
import { activeProfileId, ownerForUnownedSongs } from '@/lib/profile-scope';
import { songTitle } from '@/lib/music-search';
import { localizePlaylists, rememberSongKeys, setLibraryIds, songKeyIn } from '@/lib/song-keys';
import { reorderPlaylists as reorderPlaylistsMinimal } from '@/lib/playlist-order';
import { favoritesToApply, setSongFavorite } from '@/lib/song-favorites';
import { emit as tauriEmit, listen as tauriListen } from '@tauri-apps/api/event';
import { format, parseISO } from 'date-fns';
import { isSessionEditable } from '@/lib/session-edit';
import { activeSessionKey, clearRecoverableSession } from '@/lib/session-recovery';
import { safeRead, safeReadArray, safeWrite } from '@/lib/safe-storage';


import { tr } from '@/lib/i18n';

type TimerMode = 'focus' | 'stopwatch';
type SelectionMode = 'rendimiento' | 'tiempo';
type MiniTimerView = 'hidden' | 'full' | 'compact';

/**
 * Lecturas y escrituras del almacén local, todas a través de `safe-storage`:
 * cada clave lleva al lado una copia de su última versión buena, y una
 * escritura truncada se detecta al releerla en lugar de descubrirse meses
 * después. Ver src/lib/safe-storage.ts.
 */
const getFromLocalStorage = <T,>(key: string, defaultValue: T): T => safeRead(key, defaultValue);

/** Lectura de una COLECCIÓN: siempre un array de objetos, con respaldo. */
const getArrayFromLocalStorage = <T,>(key: string): T[] => safeReadArray<T>(key);

const setInLocalStorage = <T,>(key: string, value: T) => {
  safeWrite(key, value);
};

const defaultStudyGoals: StudyGoals = {
  monday: 240,
  tuesday: 90,
  wednesday: 240,
  thursday: 90,
  friday: 240,
  saturday: 120,
  sunday: 360,
};

const defaultStreakGoal: StreakGoal = { mode: 'rendimiento', grade: 'A', minutes: 60 };

/** Toda sesión vive en SEGUNDOS (`durationSec`); `duration` queda como
 *  minutos DERIVADOS con decimales para no romper a ningún consumidor
 *  histórico. Las sesiones antiguas (solo minutos) se completan aquí. */
const normalizeStudySession = (s: StudySession): StudySession | null => {
  // Sin marca de tiempo la sesión no sirve para NADA: toda la analítica
  // (Inicio, Enfoque, Calendario, Hábitos) agrupa por día leyendo
  // `startTime`. Conservarla no la hace aparecer en ningún sitio; solo hace
  // reventar al primero que la lea. Se descarta, y el propio guardado de
  // abajo deja el almacén ya limpio.
  if (typeof s.startTime !== 'string' || !s.startTime) return null;
  const durationSec =
    typeof s.durationSec === 'number' && Number.isFinite(s.durationSec)
      ? Math.max(0, Math.round(s.durationSec))
      : Math.max(0, Math.round((s.duration || 0) * 60));
  return { ...s, durationSec, duration: durationSec / 60 };
};


/**
 * DESHACER SIN PISAR. Antes cada «deshacer» restauraba la FOTO completa de la
 * colección tomada al borrar, así que todo lo creado o editado en los siete
 * segundos siguientes desaparecía del estado —y del disco en el guardado
 * siguiente—. Estas dos funciones devuelven solo lo borrado a su sitio:
 * respetan el orden original, conservan las ediciones hechas a lo que seguía
 * vivo y dejan al final lo que se creó después.
 */
function restoreRecords<T extends { id: string }>(current: T[], original: T[], removed: T[]): T[] {
  const removedById = new Map(removed.map((item) => [item.id, item]));
  const liveById = new Map(current.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const item of original) {
    const live = liveById.get(item.id);
    if (live) out.push(live);
    else if (removedById.has(item.id)) out.push(item);
  }
  const placed = new Set(out.map((item) => item.id));
  for (const item of current) if (!placed.has(item.id)) out.push(item);
  return out;
}

/** Lo mismo para listas de ids (las canciones de una playlist). */
/** Pide al reloj de la sesión que se ponga en hora YA (ver el efecto del reloj). */
const CLOCK_SYNC_EVENT = 'frame:clock-sync';

/**
 * Tareas eliminadas DEFINITIVAMENTE: sus archivos adjuntos (guardados en
 * IndexedDB) se borran con ellas. Lo descartado no deja restos en el equipo.
 */
function purgeTaskFiles(gone: Array<{ attachments?: { id: string; kind: string }[] }>): void {
  for (const task of gone) {
    for (const attachment of task.attachments ?? []) {
      if (attachment.kind === 'file') void deleteAttachment(attachment.id).catch(() => undefined);
    }
  }
}

/** Las playlists en el orden que eligió el usuario (1.6.8: el orden es un
 *  campo que viaja); las que no lo tienen, detrás y en su orden de siempre. */
function byOrder(list: Playlist[]): Playlist[] {
  return list
    .map((playlist, index) => ({ playlist, index }))
    .sort((a, b) => (a.playlist.order ?? Infinity) - (b.playlist.order ?? Infinity) || a.index - b.index)
    .map(({ playlist }) => playlist);
}

/** El sitio de una playlist nueva: al final. */
const nextOrder = (list: Playlist[]): number => list.reduce((max, p) => Math.max(max, (p.order ?? -1) + 1), list.length);

function restoreIds(current: string[], original: string[], removed: string[]): string[] {
  const removedSet = new Set(removed);
  const liveSet = new Set(current);
  const out = original.filter((id) => liveSet.has(id) || removedSet.has(id));
  const placed = new Set(out);
  for (const id of current) if (!placed.has(id)) out.push(id);
  return out;
}

interface CourseContextType {
  userProfile: UserProfile | null;
  isCreateCourseOpen: boolean;
  setCreateCourseOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newCourseName: string;
  setNewCourseName: React.Dispatch<React.SetStateAction<string>>;
  newTeacherName: string;
  setNewTeacherName: React.Dispatch<React.SetStateAction<string>>;
  showAlert: boolean;
  
  // Timer State
  setTimerTime: React.Dispatch<React.SetStateAction<number>>;
  isTimerActive: boolean;
  setIsTimerActive: React.Dispatch<React.SetStateAction<boolean>>;
  sessionStartTime: number;
  setSessionStartTime: React.Dispatch<React.SetStateAction<number>>;
  timerMode: TimerMode;
  setTimerMode: React.Dispatch<React.SetStateAction<TimerMode>>;
  resetTimerState: () => void;
  /** Segundos estudiados en la sesión en curso; 0 si no hay ninguna. */
  /** Aparca la sesión en curso para retomarla al reabrir Frame. */
  suspendActiveSession: () => boolean;
  /** Restaura el reloj de una sesión aparcada y borra el registro. */
  resumeInterruptedSession: (session: InterruptedSession) => void;

  // Local Data State and methods
  courses: Course[];
  tasks: Task[];
  notes: Note[];
  /** Tareas culminadas y recursos eliminados: quedan archivados por
   *  asignatura (con fecha/hora), sin opción de desarchivar. */
  archivedTasks: ArchivedTask[];
  /** Tareas que no se pudieron terminar (no cuentan como culminadas). */
  incompleteTasks: ArchivedTask[];
  /** Retira la tarea de pendientes como «incompleta» (Ctrl+Z la devuelve). */
  markTaskIncomplete: (id: string) => void;
  /** Devuelve a pendientes una tarea marcada como incompleta. */
  restoreIncompleteTask: (id: string) => void;
  /** Borra definitivamente una tarea incompleta (y sus adjuntos). */
  deleteIncompleteTask: (id: string) => void;
  /** Corrige una tarea incompleta sin sacarla del archivo. */
  updateIncompleteTask: (id: string, updates: Partial<Task>) => void;
  archivedNotes: ArchivedNote[];
  /** Elimina PERMANENTEMENTE todo el archivo de una asignatura
   *  (incluidos los adjuntos de IndexedDB de los recursos). */
  /** Elimina una tarea SIN archivarla (para tareas vencidas descartadas). */
  removeTask: (id: string) => void;
  /** Reparte los minutos de una sesión entre las tareas avanzadas: el %
   *  de progreso sube en proporción a su tiempo estimado. */
  applySessionProgressToTasks: (taskIds: string[], minutes: number) => void;
  /** Eventos del calendario local (día libre, institucional, personal). */
  localEvents: LocalCalendarEvent[];
  addLocalEvent: (event: Omit<LocalCalendarEvent, 'id'>) => void;
  updateLocalEvent: (id: string, updates: Partial<Omit<LocalCalendarEvent, 'id'>>) => void;
  deleteLocalEvent: (id: string) => void;
  /** Color de fondo propio de cada casilla del calendario local. */
  dayColors: CalendarDayColor[];
  /** Pinta unos días con `color`; `null` les quita el color propio y `''`
   *  los deja sin color aunque un evento los pinte. */
  setDayColors: (days: string[], color: string | null) => void;
  /** Grabaciones de voz: sueltas (Inicio) o asignadas a una asignatura. */
  recordings: Recording[];
  addRecording: (recording: Recording) => void;
  updateRecording: (id: string, updates: Partial<Recording>) => void;
  /** Borra la grabación, su audio en IndexedDB y su archivo en disco. */
  deleteRecording: (id: string) => void;
  habits: Habit[];
  studySessions: StudySession[];
  dailyPerformances: DailyPerformance[];
  studyGoals: StudyGoals;
  /** Meta de racha EFECTIVA: sin modo Avanzado, siempre por minutos (la
   *  guardada no cambia y vuelve al activarlo). */
  streakGoal: StreakGoal;
  /** La guardada, para el editor de Ajustes. */
  storedStreakGoal: StreakGoal;
  completedTasksByCourse: Record<string, number>;
  /** Modo Avanzado (1.7.3): con él se ven el rendimiento, las metas, los
   *  informes y los campos finos de las tareas. Ver `advancedMode` abajo. */
  advancedMode: boolean;
  /** true si el usuario lo eligió a mano (viaja con la cuenta); false si se
   *  dedujo de su uso. */
  advancedModeChosen: boolean;
  setAdvancedMode: (on: boolean) => void;


  addCourse: (name: string, teacherName?: string) => void;
  updateCourse: (id: string, updates: Partial<Course>) => void;
  deleteCourse: (id: string) => void;

  /** `id` es opcional: con uno propio y estable, la misma tarea no se
   *  duplica aunque se intente crear dos veces. */
  addTask: (taskData: Omit<Task, 'id'> & { id?: string }) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  updateTasksOrder: (orderedTasks: Task[]) => void;
  
  addNote: (
    courseId: string,
    content: string,
    extra?: { kind?: NoteKind; url?: string; fileName?: string; fileMime?: string; fileDataUrl?: string }
  ) => void;
  updateNote: (id: string, updates: string | Partial<Pick<Note, 'content' | 'url' | 'fileName' | 'fileMime'>>) => void;
  deleteNote: (id: string) => void;
  updateNotesOrder: (orderedNotes: Note[]) => void;

  addHabit: (name: string, phase?: HabitPhase, days?: number[]) => void;
  updateHabit: (id: string, updates: Partial<Habit>) => void;
  deleteHabit: (id: string) => void;

  // --- Avances anotados durante la sesión en curso ---
  /** Anotaciones de la sesión que está corriendo ahora mismo. */
  sessionNotes: SessionNote[];
  addSessionNote: (note: Omit<SessionNote, 'id' | 'at'>) => void;
  deleteSessionNote: (id: string) => void;
  clearSessionNotes: () => void;
  addStudySession: (
    sessionData: Omit<StudySession, 'id' | 'startTime' | 'endTime' | 'duration' | 'durationSec'> & {
      durationSec: number;
      /** Cuándo TERMINÓ de verdad (ISO). Solo lo pasan las sesiones rescatadas,
       *  que se registran horas o días después de haber ocurrido. */
      endedAt?: string;
    }
  ) => void;
  /** Elimina una sesión de estudio. Además invalida la calificación
   *  guardada de ese día para que Enfoque la recalcule. */
  /** Corrige una sesión YA REGISTRADA. Solo el mismo día: a partir del día
   *  siguiente el registro queda cerrado (ver `isSessionEditable`).
   *  Devuelve false si se rechazó por antigüedad. */
  updateStudySession: (
    id: string,
    updates: Pick<StudySession, 'perception' | 'subjects' | 'subjectIds' | 'notes'>
  ) => boolean;
  deleteStudySession: (id: string) => void;
  updateDailyPerformance: (performanceData: DailyPerformance) => void;
  updateStudyGoals: (newGoals: StudyGoals) => void;
  updateStreakGoal: (updates: Partial<StreakGoal>) => void;

  getTasksForCourse: (courseId: string) => Task[];
  getNotesForCourse: (courseId: string) => Note[];
  
  // Playlist State and methods
  playlists: Playlist[];
  /** Fusiona canciones en la playlist con ese nombre (la crea si no existe). */
  mergePlaylistSongs: (name: string, songIds: string[]) => void;
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void;
  deletePlaylist: (id: string) => void;
  /** Fija el orden de las playlists (las que falten en la lista van al final). */
  reorderPlaylists: (orderedIds: string[]) => void;
  isCreatePlaylistOpen: boolean;
  setCreatePlaylistOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newPlaylistName: string;
  setNewPlaylistName: React.Dispatch<React.SetStateAction<string>>;
  
  // Space State and methods
  spaces: Space[];
  addSpace: (name: string, courseIds: string[]) => void;
  updateSpace: (id: string, updates: Partial<Space>) => void;

  // Music State and methods
  songs: Song[];
  areSongsLoading: boolean;
  addSongs: (newSongs: Song[]) => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
  toggleSongFavorite: (id: string) => Promise<void>;
  currentSong: Song | null;
  playSong: (song: Song, options?: { context?: string; queue?: Song[]; href?: string }) => void;
  togglePlay: () => void;
  isPlaying: boolean;
  playNext: () => void;
  playPrevious: () => void;
  repeatMode: RepeatMode;
  setRepeatMode: React.Dispatch<React.SetStateAction<RepeatMode>>;
  isShuffle: boolean;
  toggleShuffle: () => void;
  playingContext: string;
  /** Ruta del origen de la cola: la barra la usa para volver a la playlist. */
  playingContextHref: string;
  playbackHistory: Song[];

  // Selection Mode: el EFECTIVO (sin modo Avanzado, siempre 'tiempo') y el
  // guardado (lo que el usuario eligió; vuelve al activar el modo Avanzado).
  selectionMode: SelectionMode;
  storedSelectionMode: SelectionMode;
  setSelectionMode: (mode: SelectionMode) => void;
  hasInteracted: boolean;
  isPlayerVisible: boolean;
  setPlayerVisible: (isVisible: boolean) => void;

  // Mini temporizador flotante (visible en toda la app)
  miniTimerView: MiniTimerView;
  setMiniTimerView: (view: MiniTimerView) => void;
  /** Último tamaño elegido para la vista flotante ('full' = mediana, 'compact' = pequeña). */
  miniTimerSize: Exclude<MiniTimerView, 'hidden'>;
  autoFinishPending: boolean;
  clearAutoFinish: () => void;
  finishRequested: boolean;
  requestFinish: () => void;
  clearFinishRequest: () => void;

  // Sidebar colapsable
  isSidebarCollapsed: boolean;
  toggleSidebarCollapsed: () => void;
}

const CourseContext = createContext<CourseContextType | undefined>(undefined);

const MIN_TIME = 0; // 0 minutes
const UNDO_TIMEOUT = 7000; // 7 seconds

/** Orden de la biblioteca: por llegada y, a igualdad, por nombre de archivo
 *  (desempate estable para las canciones que compartan `seq`). */
const compareSongs = (a: Song, b: Song): number =>
  (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER) ||
  a.fileName.localeCompare(b.fileName, 'es');

export function CourseProvider({ children, userProfile }: { children: ReactNode, userProfile: UserProfile | null }) {
  const pathname = usePathname();
  const [isCreateCourseOpen, setCreateCourseOpen] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newTeacherName, setNewTeacherName] = useState('');
  
  // Global Timer State
  // El segundero NO es estado de React: vive en `timerClock` para que su tic
  // no vuelva a renderizar toda la app (ver src/lib/timer-clock.ts). El
  // proveedor lo gobierna con este setter, que conserva la firma de siempre.
  const setTimerTime = useCallback<React.Dispatch<React.SetStateAction<number>>>((next) => {
    timerClock.set(typeof next === 'function' ? next(timerClock.get()) : next);
  }, []);
  // Valor de partida al montar el proveedor (equivale al antiguo useState).
  useState(() => {
    timerClock.set(MIN_TIME);
    return null;
  });
  const [isTimerActive, setIsTimerActive] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState(0);
  const [timerMode, setTimerMode] = useState<TimerMode>('focus');

  const [showAlert, setShowAlert] = useState(false);

  // --- Local Data State ---
  const [courses, setCourses] = useState<Course[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTask[]>([]);
  const [incompleteTasks, setIncompleteTasks] = useState<ArchivedTask[]>([]);
  const [archivedNotes, setArchivedNotes] = useState<ArchivedNote[]>([]);
  const [localEvents, setLocalEvents] = useState<LocalCalendarEvent[]>([]);
  const [dayColors, setDayColorsState] = useState<CalendarDayColor[]>([]);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [dailyPerformances, setDailyPerformances] = useState<DailyPerformance[]>([]);
  /**
   * Avances de la sesión EN CURSO. Se guardan en disco porque una sesión de
   * dos horas no puede perder lo anotado si la app se cierra por sorpresa;
   * al guardar la sesión pasan a formar parte de ella y esto queda vacío.
   */
  const [sessionNotes, setSessionNotes] = useState<SessionNote[]>([]);

  const [songs, setSongs] = useState<Song[]>([]);
  /**
   * Espejo SIEMPRE fresco de `songs`.
   *
   * `addSongs` viaja fuera de React: una importación larga captura la función
   * UNA vez al empezar y la usa por tandas hasta terminar. Con el
   * cierre de `songs` esa copia se congelaba en la biblioteca de aquel
   * instante, así que cada canción del lote se numeraba con el MISMO orden
   * (y la deduplicación no veía lo ya descargado). El ref no envejece.
   */
  const songsRef = React.useRef<Song[]>([]);
  useEffect(() => { songsRef.current = songs; }, [songs]);
  /**
   * Siguiente número de orden libre. Va aparte de `songsRef` a propósito: ese
   * ref se re-sincroniza tras cada pintado y puede llegar con un instante de
   * retraso, lo que bastaba para que dos canciones seguidas de una misma
   * descarga recibieran el MISMO número. Este contador solo sube, así que dos
   * canciones nunca comparten sitio ni aunque lleguen pegadas.
   */
  const nextSeqRef = React.useRef(0);
  const [areSongsLoading, setAreSongsLoading] = useState(true);

  /** Pone el corazón de cada canción como dice la lista de favoritos (y lo guarda). */
  const applyFavorites = useCallback((uid: string) => {
    const changed = favoritesToApply(uid, songsRef.current);
    if (changed.length === 0) return;
    const favorite = new Map(changed.map((song) => [song.id, Boolean(song.isFavorite)]));
    const patch = <T extends Song>(song: T): T => (favorite.has(song.id) ? { ...song, isFavorite: favorite.get(song.id) } : song);
    songsRef.current = songsRef.current.map(patch);
    setSongs(prev => prev.map(patch));
    setPlaybackQueue(prev => prev.map(patch));
    setCurrentSong(prev => (prev ? patch(prev) : prev));
    for (const song of changed) void saveSongMetadata(song).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Índice id → clave de cada canción (song-keys.ts): las playlists viajan por
  // la clave, igual en todos los dispositivos, y cada uno la traduce a su id.
  useEffect(() => {
    if (!userProfile || areSongsLoading) return;
    rememberSongKeys(userProfile.id, songs);
    setLibraryIds(songs.map(song => song.id));
    // Claves que llegaron antes de conocer esta música: pasan a su id y se ven.
    if (localizePlaylists(userProfile.id)) {
      setPlaylists(byOrder(getArrayFromLocalStorage<Playlist>(`playlists_${userProfile.id}`)));
    }
    // El corazón de cada canción, al día con la lista que viaja (song-favorites.ts).
    applyFavorites(userProfile.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, songs, areSongsLoading]);
  // Y cada vez que llega algo de otro dispositivo.
  useEffect(() => {
    if (!userProfile || areSongsLoading) return;
    const uid = userProfile.id;
    const onCloud = () => applyFavorites(uid);
    window.addEventListener(CLOUD_APPLIED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_APPLIED_EVENT, onCloud);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id, areSongsLoading]);
  const [studyGoals, setStudyGoals] = useState<StudyGoals>(defaultStudyGoals);
  const [storedStreakGoal, setStreakGoal] = useState<StreakGoal>(defaultStreakGoal);
  const [storedSelectionMode, setSelectionModeState] = useState<SelectionMode>('rendimiento');
  /** Elección a mano del modo Avanzado (null: nunca se eligió). */
  const [advancedChoice, setAdvancedChoice] = useState<boolean | null>(null);
  // Modo Avanzado (1.7.3). Si el usuario nunca lo eligió, se deduce de su
  // uso: quien ya tiene sesiones en modo Rendimiento, notas diarias o tareas
  // con dificultad, importancia o tiempo estimado propios lo tiene activado
  // y no pierde nada de vista. Se deduce de los datos (que viajan), así que
  // da lo mismo en todos sus equipos sin escribir nada; al elegirlo a mano,
  // la elección viaja con la cuenta (`advancedMode_<uid>`).
  const derivedAdvanced = useMemo(
    () =>
      studySessions.some((s) => s.mode === 'rendimiento') ||
      dailyPerformances.length > 0 ||
      [...tasks, ...archivedTasks].some(
        (t) => (t.estimatedMinutes ?? 0) > 0 || (t.difficulty && t.difficulty !== 'Media') || (t.priority && t.priority !== 'Media')
      ),
    [studySessions, dailyPerformances, tasks, archivedTasks]
  );
  const advancedMode = advancedChoice ?? derivedAdvanced;
  // Sin modo Avanzado la app trabaja en modo Tiempo: la sesión se cierra con
  // una nota simple (sin enfoque obligatorio) y la racha cuenta minutos. Lo
  // guardado no se toca: al activarlo, todo vuelve como estaba.
  const selectionMode: SelectionMode = advancedMode ? storedSelectionMode : 'tiempo';
  const streakGoal = useMemo<StreakGoal>(
    () => (advancedMode ? storedStreakGoal : { ...storedStreakGoal, mode: 'tiempo' }),
    [advancedMode, storedStreakGoal]
  );
  const [completedTasksCount, setCompletedTasksCount] = useState(0);
  const [completedTasksByCourse, setCompletedTasksByCourse] = useState<Record<string, number>>({});

  const [hasInteracted, setHasInteracted] = useState(false);
  const [isPlayerVisible, setPlayerVisibleState] = useState(true);

  // Mini temporizador flotante
  const [miniTimerView, setMiniTimerViewState] = useState<MiniTimerView>('hidden');
  // Último tamaño elegido (se recuerda entre sesiones; la visibilidad no).
  const [miniTimerSize, setMiniTimerSize] = useState<Exclude<MiniTimerView, 'hidden'>>(
    () => (typeof window !== 'undefined' && window.localStorage.getItem('miniTimerSize') === 'compact' ? 'compact' : 'full')
  );
  const setMiniTimerView = useCallback((view: MiniTimerView) => {
    if (view !== 'hidden') {
      window.localStorage.setItem('miniTimerSize', view);
      setMiniTimerSize(view);
    }
    setMiniTimerViewState(view);
  }, []);
  const [autoFinishPending, setAutoFinishPending] = useState(false);
  const [finishRequested, setFinishRequested] = useState(false);

  // Sidebar colapsable (preferencia global de la máquina)
  const [isSidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => typeof window !== 'undefined' && window.localStorage.getItem('sidebarCollapsed') === '1'
  );
  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      window.localStorage.setItem('sidebarCollapsed', next ? '1' : '0');
      return next;
    });
  }, []);

  // Playlist State
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [isCreatePlaylistOpen, setCreatePlaylistOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  
  // Space State
  const [spaces, setSpaces] = useState<Space[]>([]);

  // Music Player State
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>({ mode: 'off' });
  const [isShuffle, setIsShuffle] = useState(false);
  const [playingContext, setPlayingContext] = useState('Música');
  const [playingContextHref, setPlayingContextHref] = useState('/music');
  const [playbackQueue, setPlaybackQueue] = useState<Song[]>([]);
  const [playbackHistory, setPlaybackHistory] = useState<Song[]>([]);

  // --- Undo State ---
  const [lastUndoableAction, setLastUndoableAction] = useState<{ undo: () => void; commit: () => void; } | null>(null);
  // La misma acción, legible fuera de React (al llegar cambios de la nube).
  const pendingActionRef = useRef<{ undo: () => void; commit: () => void } | null>(null);

  // Registra una acción deshacible confirmando ANTES la anterior pendiente.
  // Sin esto, encadenar borrados (p. ej. varias canciones seguidas) cancelaba
  // el commit del anterior: la canción nunca se borraba de IndexedDB y
  // "resucitaba" al reabrir la app. Fuera del actualizador de estado: React
  // puede repetirlo, y el commit sumaba dos veces la tarea culminada.
  const pushUndoableAction = useCallback(
    (action: { undo: () => void; commit: () => void }) => {
      const prev = pendingActionRef.current;
      if (prev) {
        try { prev.commit(); } catch (e) { console.error('commit of pending action failed', e); }
      }
      pendingActionRef.current = action;
      setLastUndoableAction(action);
    },
    []
  );

  const clearUndoableAction = useCallback(() => {
    pendingActionRef.current = null;
    setLastUndoableAction(null);
  }, []);

  
  const storageKeys = useMemo(() => {
    if (!userProfile) return null;
    const uid = userProfile.id;
    return {
        courses: `courses_${uid}`,
        tasks: `tasks_${uid}`,
        notes: `notes_${uid}`,
        archivedTasks: `archivedTasks_${uid}`,
        incompleteTasks: `incompleteTasks_${uid}`,
        archivedNotes: `archivedNotes_${uid}`,
        localEvents: `localEvents_${uid}`,
        dayColors: `dayColors_${uid}`,
        schedules: `schedules_${uid}`,
        classSessions: `classSessions_${uid}`,
        recordings: `recordings_${uid}`,
        habits: `habits_${uid}`,
        studySessions: `studySessions_${uid}`,
        dailyPerformances: `dailyPerformances_${uid}`,
        playlists: `playlists_${uid}`,
        spaces: `spaces_${uid}`,
        studyGoals: `studyGoals_${uid}`,
        streakGoal: `streakGoal_${uid}`,
        selectionMode: `selectionMode_${uid}`,
        advancedMode: `advancedMode_${uid}`,
        completedTasks: `completedTasks_${uid}`,
        completedTasksByCourse: `completedTasksByCourse_${uid}`,
        interruptedSession: `interruptedSession_${uid}`,
        sessionNotes: `sessionNotes_${uid}`,
        taskSortMode: `taskSortMode_${uid}`,
        isPlayerVisible: `isPlayerVisible_${uid}`,
    };
    // Por ID, no por objeto: editar el nombre o el avatar crea un perfil nuevo
    // con el mismo id, y eso recargaba TODO el estado desde disco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile?.id]);

  useEffect(() => {
    const handleInteraction = () => {
      if (!hasInteracted) {
        setHasInteracted(true);
        // Clean up listeners once interaction has occurred
        window.removeEventListener('click', handleInteraction);
        window.removeEventListener('keydown', handleInteraction);
        window.removeEventListener('touchstart', handleInteraction);
      }
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [hasInteracted]);

  /**
   * Estado de negocio leído de localStorage. Es una función aparte porque se
   * ejecuta en dos momentos: al montar, y cuando la sincronización trae
   * cambios de otro dispositivo (CLOUD_APPLIED_EVENT). En ese segundo caso
   * la interfaz viva TIENE que releer el disco: si siguiera con su copia en
   * memoria, su próximo guardado pisaría lo que acaba de llegar y el ciclo
   * siguiente lo daría por borrado en todos los dispositivos.
   *
   * No toca ni la música (IndexedDB) ni el reloj de estudio.
   */
  const loadBusinessState = useCallback(() => {
    if (!storageKeys) return;
    setCourses(getArrayFromLocalStorage(storageKeys.courses));
    setTasks(getArrayFromLocalStorage(storageKeys.tasks));
    setNotes(getArrayFromLocalStorage(storageKeys.notes));

    // --- Habit Migration Logic ---
    const rawHabits = getArrayFromLocalStorage(storageKeys.habits);
    const migratedHabits = rawHabits.map((original: any, index: number) => {
        // Copia: si se mutara el original, la comparación de abajo daría
        // siempre "sin cambios" y la migración nunca llegaría al disco.
        const habit = { ...original };
        // If a habit has the old `completedDays` and not the new `completedOn`, migrate it.
        if (habit.completedDays && !habit.completedOn) {
            habit.completedOn = [];
            delete habit.completedDays;
        }
        // Ensure even new/correctly structured habits have the array if it's missing.
        if (!habit.completedOn) {
            habit.completedOn = [];
        }
        // Add new properties if they don't exist for backward compatibility.
        if (habit.isArchived === undefined) {
            habit.isArchived = false;
        }
        if (habit.order === undefined) {
            habit.order = index; // Use original array index as a stable initial order.
        }
        return habit;
    });
    setHabits(migratedHabits);
    // Persist the migrated data back to localStorage immediately if anything changed
    if (JSON.stringify(rawHabits) !== JSON.stringify(migratedHabits)) {
        setInLocalStorage(storageKeys.habits, migratedHabits);
    }
    // --- End Habit Migration ---

    // --- Migración de sesiones a segundos exactos (Fase 19) ---
    const rawSessions = getArrayFromLocalStorage<StudySession>(storageKeys.studySessions);
    const migratedSessions = rawSessions
        .map(normalizeStudySession)
        .filter((s): s is StudySession => s !== null);
    setStudySessions(migratedSessions);
    if (JSON.stringify(rawSessions) !== JSON.stringify(migratedSessions)) {
        setInLocalStorage(storageKeys.studySessions, migratedSessions);
    }

    setDailyPerformances(getArrayFromLocalStorage(storageKeys.dailyPerformances));
    setPlaylists(byOrder(getArrayFromLocalStorage<Playlist>(storageKeys.playlists)));
    setSpaces(getArrayFromLocalStorage(storageKeys.spaces));
    setStudyGoals(getFromLocalStorage(storageKeys.studyGoals, defaultStudyGoals));
    const storedStreakGoal = getFromLocalStorage(storageKeys.streakGoal, defaultStreakGoal);
    setStreakGoal({ ...defaultStreakGoal, ...storedStreakGoal });
    setSelectionModeState(getFromLocalStorage(storageKeys.selectionMode, 'rendimiento'));
    {
      const chosen = getFromLocalStorage<unknown>(storageKeys.advancedMode, null);
      setAdvancedChoice(typeof chosen === 'boolean' ? chosen : null);
    }
    setCompletedTasksCount(getFromLocalStorage(storageKeys.completedTasks, 0));
    setCompletedTasksByCourse(getFromLocalStorage(storageKeys.completedTasksByCourse, {}));
    setArchivedTasks(getArrayFromLocalStorage(storageKeys.archivedTasks));
    setIncompleteTasks(getArrayFromLocalStorage(storageKeys.incompleteTasks));
    setArchivedNotes(getArrayFromLocalStorage(storageKeys.archivedNotes));
    setLocalEvents(getArrayFromLocalStorage(storageKeys.localEvents));
    setDayColorsState(getArrayFromLocalStorage(storageKeys.dayColors));
    setRecordings(getArrayFromLocalStorage(storageKeys.recordings));
    setSessionNotes(getArrayFromLocalStorage(storageKeys.sessionNotes));
    setPlayerVisibleState(getFromLocalStorage(storageKeys.isPlayerVisible, true));
  }, [storageKeys]);

  useEffect(() => {
    // Un borrado aún deshacible (7 s) solo está en memoria: se confirma antes
    // de releer el disco, o lo releído lo resucitaba y el siguiente guardado
    // lo devolvía a la nube (y una tarea culminada quedaba duplicada).
    const onCloud = () => {
      const pending = pendingActionRef.current;
      if (pending) {
        try { pending.commit(); } catch (e) { console.error('commit of pending action failed', e); }
        clearUndoableAction();
      }
      loadBusinessState();
    };
    window.addEventListener(CLOUD_APPLIED_EVENT, onCloud);
    return () => window.removeEventListener(CLOUD_APPLIED_EVENT, onCloud);
  }, [loadBusinessState, clearUndoableAction]);

  /**
   * Reduce las portadas que se guardaron a tamaño completo (ver
   * src/lib/cover-shrink.ts). Trabaja en los ratos libres del hilo, guarda cada
   * canción leyendo su versión MÁS RECIENTE (para no pisar un favorito marcado
   * entretanto) y vuelca el resultado al estado por tandas.
   */
  const shrinkRunRef = React.useRef(0);
  const shrinkHeavyCovers = useCallback(async (library: Song[]) => {
    const run = ++shrinkRunRef.current;
    const heavy = library.filter(s => (s.picture?.length ?? 0) >= COVER_HEAVY_CHARS);
    if (heavy.length === 0) return;

    let batch = new Map<string, string>();
    const flush = () => {
      if (batch.size === 0) return;
      const done = batch;
      batch = new Map();
      setSongs(prev => prev.map(s => (done.has(s.id) ? { ...s, picture: done.get(s.id)! } : s)));
      setPlaybackQueue(prev => prev.map(s => (done.has(s.id) ? { ...s, picture: done.get(s.id)! } : s)));
      setCurrentSong(prev => (prev && done.has(prev.id) ? { ...prev, picture: done.get(prev.id)! } : prev));
    };

    for (const song of heavy) {
      await idle();
      if (shrinkRunRef.current !== run) return; // otra carga tomó el relevo
      const live = songsRef.current.find(s => s.id === song.id);
      if (!live || live.picture !== song.picture) continue; // borrada o ya cambiada
      const small = await shrinkCover(live.picture);
      if (small === live.picture) continue;
      try {
        await saveSongMetadata({ ...live, picture: small });
        songsRef.current = songsRef.current.map(s => (s.id === live.id ? { ...s, picture: small } : s));
        batch.set(live.id, small);
        if (batch.size >= 25) flush();
      } catch (e) {
        console.error('No se pudo reducir la portada de', live.fileName, e);
      }
    }
    flush();
  }, []);

  /**
   * Repaso único de las canciones anteriores a la 1.6.7 (ver
   * src/lib/music-review.ts): su duración y, si faltan, portada, artista y
   * letra de sus propias etiquetas. Mismas reglas que la reducción de
   * portadas: a ratos, leyendo la versión más reciente y por tandas.
   */
  const reviewRunRef = React.useRef(0);
  const reviewOldSongs = useCallback(async (library: Song[]) => {
    const run = ++reviewRunRef.current;
    const pending = library.filter(s => typeof s.duration !== 'number');
    if (pending.length === 0) return;
    const knownArtists = new Set(
      library.map(s => s.artist).filter(a => a && a !== UNKNOWN_ARTIST).map(foldName)
    );

    let batch = new Map<string, Partial<Song>>();
    const flush = () => {
      if (batch.size === 0) return;
      const done = batch;
      batch = new Map();
      const apply = (s: Song) => (done.has(s.id) ? { ...s, ...done.get(s.id)! } : s);
      setSongs(prev => prev.map(apply));
      setPlaybackQueue(prev => prev.map(apply));
      setCurrentSong(prev => (prev ? apply(prev) : prev));
    };

    for (const song of pending) {
      await idle();
      if (reviewRunRef.current !== run) return; // otra carga tomó el relevo
      if (!songsRef.current.some(s => s.id === song.id)) continue; // borrada
      try {
        const updates = await reviewStoredSong(song, knownArtists);
        const live = songsRef.current.find(s => s.id === song.id);
        if (!live) continue;
        // Lo que el usuario cambió mientras tanto manda.
        if (live.picture) delete updates.picture;
        if (live.artist && live.artist !== UNKNOWN_ARTIST) delete updates.artist;
        if (!isJunkTag(live.title)) delete updates.title;
        const updated = { ...live, ...updates };
        await saveSongMetadata(updated);
        songsRef.current = songsRef.current.map(s => (s.id === live.id ? updated : s));
        if (updates.artist) knownArtists.add(foldName(updates.artist));
        batch.set(live.id, updates);
        if (batch.size >= 25) flush();
      } catch (e) {
        console.error('No se pudo repasar', song.fileName, e);
      }
    }
    flush();
  }, []);

  // Load all data on mount
  useEffect(() => {
    // Load songs async from IndexedDB
    const loadSongs = async () => {
      setAreSongsLoading(true);
      try {
        const uid = userProfile!.id;
        const allSongs = await getAllSongMetadata();

        // De quién es cada canción (1.6.7). Hasta la 1.6.6 la música era del
        // EQUIPO y otra cuenta la veía entera: las que no tienen dueño se
        // asignan una sola vez, y cada perfil ve solo la suya.
        const unowned = allSongs.filter(s => !s.owner);
        if (unowned.length > 0) {
          const ownerOf = ownerForUnownedSongs(uid);
          for (const song of unowned) {
            song.owner = ownerOf(song);
            try {
              await saveSongMetadata(song);
            } catch (e) {
              console.error('No se pudo asignar el dueño de', song.fileName, e);
            }
          }
        }
        const songsFromDB = allSongs.filter(s => s.owner === uid);

        // Saneo de duplicados históricos (mismo archivo con IDs distintos,
        // producto del viejo bug de borrado): se conserva la primera copia
        // y las demás se eliminan definitivamente de IndexedDB. Solo dentro
        // de este perfil: el mismo archivo en otra cuenta es de otra persona.
        const seen = new Map<string, Song>();
        const duplicates: Song[] = [];
        for (const song of songsFromDB) {
          if (seen.has(song.fileName)) duplicates.push(song);
          else seen.set(song.fileName, song);
        }
        if (duplicates.length > 0) {
          console.warn(`Removing ${duplicates.length} duplicated song(s) from library`);
          for (const dup of duplicates) {
            try {
              await deleteSongMetadata(dup.id);
              await deleteSongFileFromDB(dup.id);
            } catch (e) {
              console.error('Failed to purge duplicated song', dup.id, e);
            }
          }
        }

        // ORDEN DE LA BIBLIOTECA. IndexedDB devuelve por clave, y la clave es
        // un UUID: sin `seq` la biblioteca salía recolocada al azar en cada
        // arranque. A las canciones que aún no lo tienen se les asigna aquí,
        // respetando el orden en que vinieron, y se persiste: a partir de ese
        // momento la biblioteca deja de moverse y cada descarga va al final.
        const cleanSongs = [...seen.values()];
        const pending = cleanSongs.filter(s => typeof s.seq !== 'number');
        if (pending.length > 0) {
          let next = cleanSongs.reduce((max, s) => Math.max(max, s.seq ?? -1), -1) + 1;
          for (const song of pending) {
            song.seq = next++;
            try {
              await saveSongMetadata(song);
            } catch (e) {
              console.error('No se pudo fijar el orden de', song.fileName, e);
            }
          }
        }
        cleanSongs.sort(compareSongs);
        nextSeqRef.current = cleanSongs.reduce((max, s) => Math.max(max, s.seq ?? -1), -1) + 1;

        setSongs(cleanSongs);
        setPlaybackQueue(cleanSongs); // Initialize queue with all songs

        // Portadas pesadas de versiones anteriores: se reducen en segundo plano,
        // a ratos y una sola vez (las ya reducidas no vuelven a entrar aquí).
        // Después, el repaso de las canciones sin duración (1.6.7). En serie:
        // así nunca guardan los dos la misma canción a la vez.
        void shrinkHeavyCovers(cleanSongs).then(() => reviewOldSongs(cleanSongs));
      } catch (e) {
        console.error("Failed to load songs from IndexedDB", e);
        setSongs([]);
      } finally {
        setAreSongsLoading(false);
      }
    };
    
    if (userProfile) {
      loadSongs();
    } else {
      setSongs([]);
      setAreSongsLoading(false);
    }

    // El resto del estado vive en localStorage y se carga de una vez.
    loadBusinessState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKeys, userProfile?.id, loadBusinessState]);

  // ============================================================
  // EL LATIDO de la sesión en curso.
  //
  // Mientras haya sesión, su estado completo se escribe en disco en cada
  // segundo. No se depende de ningún aviso de cierre: el aviso no llega
  // cuando la app se reinicia por una actualización, cuando se la mata a la
  // fuerza o cuando se va la luz, y hasta ahora eso significaba perder el
  // tiempo estudiado y dejar las anotaciones huérfanas.
  //
  // Escribir un objeto diminuto una vez por segundo es barato; perder una
  // sesión de dos horas, no.
  //
  // Se borra en cuanto la sesión termina (sessionStartTime vuelve a 0), así
  // que su sola presencia al arrancar YA significa "esto se quedó a medias".
  // ============================================================
  //
  // Solo borra el latido que ESTA ejecución escribió. Al arrancar, el reloj
  // está a cero y el latido de la sesión perdida sigue en disco esperando a
  // que el usuario decida en el recuadro de rescate: borrarlo ahí (como se
  // hacía) dejaba la sesión a merced de un segundo cierre — si Frame volvía a
  // cerrarse con el recuadro abierto, la sesión se perdía para siempre.
  const beatWrittenRef = React.useRef(false);

  useEffect(() => {
    if (!userProfile) return;
    const key = activeSessionKey(userProfile.id);

    if (sessionStartTime <= 0) {
      if (beatWrittenRef.current) {
        beatWrittenRef.current = false;
        try { localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
      }
      return;
    }

    const writeBeat = () => {
    const timerTime = timerClock.get();
    const duration = timerMode === 'focus' ? sessionStartTime - timerTime : timerTime;
    if (duration <= 0) return;

    const beat: InterruptedSession = {
      duration,
      selectionMode,
      timerMode,
      timerTime,
      sessionStartTime,
      origin: 'live',
      updatedAt: new Date().toISOString(),
      wasRunning: isTimerActive,
    };
    try {
      localStorage.setItem(key, JSON.stringify(beat));
      beatWrittenRef.current = true;
    } catch {
      /* sin almacenamiento */
    }
    };

    writeBeat();
    return timerClock.subscribe(writeBeat);
  }, [userProfile, sessionStartTime, timerMode, isTimerActive, selectionMode]);

  // Save interrupted session on unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      const timerTime = timerClock.get();
      // A session is in progress if it has been started (sessionStartTime > 0)
      if (sessionStartTime > 0) {
        let sessionDuration = 0;
        if (timerMode === 'focus' && sessionStartTime > 0) {
          sessionDuration = sessionStartTime - timerTime;
        } else if (timerMode === 'stopwatch' && timerTime > 0) {
          sessionDuration = timerTime;
        }

        if (sessionDuration > 0 && storageKeys) {
          // Si el usuario ya aparcó la sesión a propósito (Suspender y cerrar),
          // ese registro es MEJOR que este: trae el reloj y permite retomarla.
          // Pisarlo aquí dejaría la sesión sin opción de retomar.
          const existing = localStorage.getItem(storageKeys.interruptedSession);
          if (existing) {
            try {
              if ((JSON.parse(existing) as InterruptedSession)?.suspendedAt) return;
            } catch {
              /* registro corrupto: se sobrescribe sin miramientos */
            }
          }

          const sessionToSave: InterruptedSession = {
            duration: sessionDuration,
            selectionMode: selectionMode,
            timerMode: timerMode
          };
          localStorage.setItem(storageKeys.interruptedSession, JSON.stringify(sessionToSave));
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [sessionStartTime, timerMode, selectionMode, storageKeys]);

  /**
   * Aparca la sesión en curso ANTES de cerrar la app, con el reloj y el
   * objetivo intactos para poder retomarla. A diferencia del guardado de
   * `beforeunload` (que es una red de seguridad ante un cierre brusco), esta
   * es una decisión deliberada del usuario y por eso lleva `suspendedAt`.
   * Devuelve false si no había nada que aparcar.
   */
  const suspendActiveSession = useCallback((): boolean => {
    if (!storageKeys || sessionStartTime <= 0) return false;
    const timerTime = timerClock.get();
    const duration = timerMode === 'focus' ? sessionStartTime - timerTime : timerTime;
    if (duration <= 0) return false;

    const payload: InterruptedSession = {
      duration,
      selectionMode,
      timerMode,
      suspendedAt: new Date().toISOString(),
      timerTime,
      sessionStartTime,
    };
    // Con la cuota llena `setItem` LANZA: «Suspender y cerrar» reventaba y la
    // sesión ni se aparcaba ni se cerraba la app. Se informa con el resultado
    // (el latido de la sesión sigue en disco y sirve de rescate igualmente).
    try {
      localStorage.setItem(storageKeys.interruptedSession, JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }, [storageKeys, sessionStartTime, timerMode, selectionMode]);

  /** Devuelve el reloj al punto exacto en que se aparcó, en pausa. */
  const resumeInterruptedSession = useCallback((session: InterruptedSession) => {
    setTimerMode(session.timerMode);
    setTimerTime(session.timerTime ?? 0);
    setSessionStartTime(session.sessionStartTime ?? 0);
    setIsTimerActive(false);
    // Se retomó: ninguna huella debe sobrevivir, o al siguiente arranque
    // volvería a ofrecerse rescatar una sesión que ya está en el reloj.
    if (userProfile) clearRecoverableSession(userProfile.id);
  }, [userProfile]);


  // --- Undo Logic ---
  useEffect(() => {
    const handleUndo = (e: KeyboardEvent) => {
      // Dentro de un campo de texto, Ctrl+Z es del CAMPO (deshacer tipeo),
      // no de la app: no se secuestra el atajo nativo.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (lastUndoableAction) {
          lastUndoableAction.undo();
          clearUndoableAction(); // Prevent re-undoing and committing
        }
      }
    };
    window.addEventListener('keydown', handleUndo);
    return () => window.removeEventListener('keydown', handleUndo);
  }, [lastUndoableAction, clearUndoableAction]);

  useEffect(() => {
    if (lastUndoableAction) {
      const timer = setTimeout(() => {
        lastUndoableAction.commit();
        clearUndoableAction();
      }, UNDO_TIMEOUT);
      return () => clearTimeout(timer);
    }
  }, [lastUndoableAction, clearUndoableAction]);

  // Si la app se cierra dentro de la ventana de deshacer, el borrado
  // pendiente se confirma igual (si no, la canción "resucitaría" al reabrir).
  useEffect(() => {
    if (!lastUndoableAction) return;
    const commitOnExit = () => lastUndoableAction.commit();
    window.addEventListener('beforeunload', commitOnExit);
    return () => window.removeEventListener('beforeunload', commitOnExit);
  }, [lastUndoableAction]);

  // --- Telemetría profesional (Supabase): desde el registro, cada usuario
  // reporta indicadores agregados y anónimos (ID, país, sesiones/tareas
  // semanales, canciones, etc.). El acelerador interno (6 h) evita envíos
  // repetidos; se reintenta cada hora y al recuperar conexión.
  useEffect(() => {
    if (!userProfile || !storageKeys || areSongsLoading) {
      return;
    }

    const sync = () => {
      if (!telemetryDue(userProfile.id)) return;
      void syncTelemetry({
        userId: userProfile.id,
        studySessions: getArrayFromLocalStorage<StudySession>(storageKeys.studySessions),
        archivedTasks: getArrayFromLocalStorage<ArchivedTask>(storageKeys.archivedTasks),
        totalTasksCompleted: getFromLocalStorage<number>(storageKeys.completedTasks, 0),
        totalSongs: songs.length,
        totalCourses: courses.length,
        totalPlaylists: playlists.length,
        totalHabits: habits.length,
        habits,
        isGuest: userProfile.isGuest === true,
      });
    };

    const timer = setTimeout(sync, 10_000);
    const interval = setInterval(sync, 60 * 60 * 1000);
    window.addEventListener('online', sync);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', sync);
    };
  }, [userProfile, storageKeys, areSongsLoading, completedTasksCount, studySessions, songs.length, courses.length, playlists.length, habits.length]);


  const resetTimerState = useCallback(() => {
    setIsTimerActive(false);
    setSessionStartTime(0);
    setTimerTime(timerMode === 'focus' ? MIN_TIME : 0);
    setAutoFinishPending(false);
    setFinishRequested(false);
  }, [timerMode]);

  useEffect(() => {
    // PRECISIÓN: Normalizamos la ruta para Electron (ignora barras finales o index.html)
    const normalizedPath = pathname.replace(/\/index\.html$/, '').replace(/\/$/, '') || '/';
    const isOnTimerPage = normalizedPath === '/temporizador';
    
    const isSessionInProgress = sessionStartTime > 0;
    setShowAlert(isSessionInProgress && !isOnTimerPage);
  }, [pathname, sessionStartTime]);

  // Motor global del temporizador: vive en el contexto para que la sesión
  // siga corriendo al navegar por toda la app. Pausar o finalizar es SIEMPRE
  // una decisión del usuario (se eliminó la pausa automática al cambiar de
  // interfaz que existía en Aether OS).
  //
  // EL RELOJ MIDE TIEMPO, NO TICKS. Antes cada disparo del intervalo sumaba o
  // restaba un segundo, y un intervalo no recupera los disparos que se pierde:
  // Chromium estrangula los temporizadores de una ventana minimizada u oculta
  // (tras cinco minutos, a UN disparo por minuto), y tampoco dispara mientras
  // el hilo está ocupado, el diálogo de imprimir un informe está abierto o el
  // equipo duerme. Estudiar una hora con Frame minimizado registraba una
  // fracción de esa hora. Ahora se ancla al reloj del sistema al arrancar o
  // reanudar, y cada disparo CALCULA lo transcurrido: si se pierden disparos
  // el reloj salta al valor correcto en el siguiente, y al volver a la ventana
  // se recalcula en el acto.
  useEffect(() => {
    if (!isTimerActive) return;

    const anchorAt = Date.now();
    const base = timerClock.get();
    let finished = false;

    const sync = () => {
      const elapsed = Math.floor((Date.now() - anchorAt) / 1000);
      if (timerMode !== 'focus') {
        setTimerTime(base + elapsed);
        return;
      }
      const remaining = Math.max(0, base - elapsed);
      setTimerTime(remaining);
      // El fin de sesión va FUERA del actualizador de estado: dentro podía
      // ejecutarse dos veces y duplicar el aviso.
      if (remaining === 0 && !finished) {
        finished = true;
        setIsTimerActive(false);
        setAutoFinishPending(true);
        void notify({ text: () => ({ title: tr('Sesión terminada'), body: tr('Tu sesión de estudio ha terminado.') }), kind: 'sesion', route: '/temporizador' });
        // Con la vista flotante, Frame suele estar detrás de otras apps: al
        // terminar la sesión se pone delante para registrarla.
        if (isTauri() && miniStateRef.current.miniTimerView !== 'hidden') {
          void invoke('focus_main_window').catch(() => {});
        }
      }
    };

    const interval = setInterval(sync, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', sync);
    // Con la ventana oculta Chromium estrangula los temporizadores (hasta un
    // disparo por minuto): el fin del temporizador llegaría tarde. Un mensaje
    // del lado nativo NO se estrangula, así que Rust despierta al reloj justo
    // cuando toca terminar; la ventana flotante hace lo mismo si llega antes.
    window.addEventListener(CLOCK_SYNC_EVENT, sync);
    if (isTauri() && timerMode === 'focus' && base > 0) {
      void invoke('schedule_wake', { ms: base * 1000 + 250 }).catch(() => {});
    }
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', sync);
      window.removeEventListener(CLOCK_SYNC_EVENT, sync);
    };
  }, [isTimerActive, timerMode]);

  const clearAutoFinish = useCallback(() => setAutoFinishPending(false), []);
  const requestFinish = useCallback(() => setFinishRequested(true), []);
  const clearFinishRequest = useCallback(() => setFinishRequested(false), []);

  // ============================================================
  // Ventana flotante NATIVA de Enfoque (app de escritorio): una ventana
  // pequeña siempre-encima-de-todo que sigue visible aunque la ventana
  // principal se cierre a la bandeja. El motor del temporizador vive aquí
  // (ventana principal); la flotante solo pinta el estado que recibe por
  // eventos y devuelve órdenes (iniciar/pausar, finalizar, cerrar).
  // ============================================================

  // Espejo con los últimos valores para el listener de comandos (se
  // suscribe una sola vez).
  const miniStateRef = React.useRef({ timerMode, isTimerActive, sessionStartTime, miniTimerView });
  // Espejo del alta de anotaciones: el listener de la ventana flotante se
  // suscribe UNA sola vez y no puede arrastrar una versión vieja.
  const addSessionNoteRef = React.useRef<(note: Omit<SessionNote, 'id' | 'at'>) => void>(() => {});
  miniStateRef.current = { timerMode, isTimerActive, sessionStartTime, miniTimerView };

  // Abrir/cerrar la ventana nativa según el estado de la vista flotante.
  useEffect(() => {
    if (!isTauri()) return;
    if (miniTimerView === 'hidden') {
      void invoke('close_mini_timer').catch(() => {});
    } else {
      void invoke('open_mini_timer', { compact: miniTimerView === 'compact' }).catch(() => {});
    }
  }, [miniTimerView]);

  // El despertador nativo (`schedule_wake`) llega como evento de Tauri.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = tauriListen('frame-wake', () => window.dispatchEvent(new Event(CLOCK_SYNC_EVENT)));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  // Estado → ventana flotante, en cada tick. `anchorAt` dice CUÁNDO era exacto
  // ese tiempo: la flotante lleva su propio segundero a partir de ahí.
  useEffect(() => {
    if (!isTauri() || miniTimerView === 'hidden') return;
    const emitState = () => {
      void tauriEmit('mini-timer-state', {
        time: timerClock.get(),
        mode: timerMode,
        active: isTimerActive,
        sessionStartTime,
        view: miniTimerView,
        anchorAt: Date.now(),
      }).catch(() => {});
    };
    emitState();
    return timerClock.subscribe(emitState);
  }, [timerMode, isTimerActive, sessionStartTime, miniTimerView]);

  // Órdenes desde la ventana flotante.
  useEffect(() => {
    if (!isTauri()) return;
    const unlisten = tauriListen<{ action: string; size?: MiniTimerView; text?: string }>('mini-timer-cmd', (event) => {
      const s = miniStateRef.current;
      switch (event.payload.action) {
        case 'note': {
          // La flotante solo manda el texto: el minuto de sesión lo sabe esta
          // ventana, que es donde vive el reloj.
          const text = (event.payload.text ?? '').trim();
          if (!text || s.sessionStartTime === 0) return;
          const elapsed =
            s.timerMode === 'focus' ? s.sessionStartTime - timerClock.get() : timerClock.get();
          addSessionNoteRef.current({ text, elapsedSec: Math.max(0, Math.round(elapsed)) });
          break;
        }
        case 'toggle': {
          if (s.timerMode === 'focus' && timerClock.get() === 0) return;
          const next = !s.isTimerActive;
          setIsTimerActive(next);
          if (next && s.sessionStartTime === 0) {
            setSessionStartTime(s.timerMode === 'focus' ? timerClock.get() : 1);
          }
          break;
        }
        case 'finish': {
          if (s.sessionStartTime === 0) return;
          setFinishRequested(true);
          window.location.hash = '#/temporizador';
          void invoke('focus_main_window').catch(() => {});
          break;
        }
        case 'close': {
          if (s.isTimerActive) {
            setIsTimerActive(false);
          }
          setMiniTimerView('hidden');
          break;
        }
        case 'size': {
          const next = event.payload.size;
          if (next === 'full' || next === 'compact') setMiniTimerView(next);
          break;
        }
        case 'mode': {
          // Temporizador ↔ cronómetro: solo entre sesiones, como en Enfoque.
          if (s.sessionStartTime !== 0) return;
          const nextMode: TimerMode = s.timerMode === 'focus' ? 'stopwatch' : 'focus';
          setTimerMode(nextMode);
          setIsTimerActive(false);
          setTimerTime(0);
          break;
        }
        case 'sync': {
          // La ventana flotante acaba de montarse y pide el estado (la primera
          // emisión se perdió porque el webview aún no existía), o su segundero
          // llegó a cero antes que el de aquí: se pone el reloj en hora.
          window.dispatchEvent(new Event(CLOCK_SYNC_EVENT));
          if (s.miniTimerView === 'hidden') return;
          void tauriEmit('mini-timer-state', {
            time: timerClock.get(),
            mode: s.timerMode,
            active: s.isTimerActive,
            sessionStartTime: s.sessionStartTime,
            view: s.miniTimerView,
            anchorAt: Date.now(),
          }).catch(() => {});
          break;
        }
      }
    });
    return () => {
      void unlisten.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recordatorios de tareas: notificación nativa (con sonido). Cada tarea lleva
  // el SUYO y nace desactivado: días de la semana, hora y, para lo muy
  // importante, cada cuántos minutos reaparece ese día. Sigue funcionando con
  // la ventana oculta en la bandeja.
  //
  // El día se parte en «tramos»: el tramo 0 empieza a la hora elegida y, si hay
  // repetición, cada tramo dura ese intervalo. Se avisa UNA vez por tramo, así
  // que abrir Frame tarde da el aviso pendiente una sola vez y no una ráfaga.
  useEffect(() => {
    if (!storageKeys) return;

    const checkReminders = () => {
      const armed = tasks.filter(
        (task) => task.reminderEnabled === true && !!task.reminderTime && (task.progress ?? 0) < 100
      );
      if (armed.length === 0) return;

      const lastSentKey = `taskReminderLastSent_${storageKeys.tasks}`;
      const lastSent: Record<string, string | number> = getFromLocalStorage(lastSentKey, {});
      const now = new Date();
      const dayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      let changed = false;

      for (const task of armed) {
        const days = task.reminderDays ?? [];
        if (days.length > 0 && !days.includes(now.getDay())) continue;
        const [h, m] = (task.reminderTime ?? '').split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) continue;

        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m).getTime();
        if (now.getTime() < start) continue;
        const repeat = Math.max(0, task.reminderRepeatMinutes ?? 0);
        const slot = repeat > 0 ? Math.floor((now.getTime() - start) / (repeat * 60_000)) : 0;
        const slotKey = `${dayKey}#${slot}`;
        if (lastSent[task.id] === slotKey) continue;

        let diff: number | null = null;
        if (task.dueDate) {
          const due = new Date(task.dueDate);
          diff = Math.round(
            (new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() -
              new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) /
              86_400_000
          );
        }
        const when = () =>
          diff === null ? '' : diff < 0 ? tr(' · vencida') : diff === 0 ? tr(' · vence hoy') : diff === 1 ? tr(' · vence mañana') : tr(' · en {diff} días', { diff });
        void notify({
          text: () => ({
            title: tr('Recordatorio de tarea'),
            body: `${task.name}${task.courseName ? ` — ${task.courseName}` : ''}${when()}`,
          }),
          kind: 'recordatorio',
          route: '/tareas',
        });
        lastSent[task.id] = slotKey;
        changed = true;
      }

      if (changed) {
        // De paso se olvidan las marcas de tareas que ya no existen.
        const alive = new Set(tasks.map((task) => task.id));
        for (const id of Object.keys(lastSent)) if (!alive.has(id)) delete lastSent[id];
        setInLocalStorage(lastSentKey, lastSent);
      }
    };

    const initial = setTimeout(checkReminders, 12_000);
    const interval = setInterval(checkReminders, 60_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [storageKeys, tasks]);


  // --- Data Manipulation Methods ---

  const addCourse = useCallback((name: string, teacherName?: string) => {
    if (!storageKeys) return;
    const trimmedName = name.trim();
    if (courses.some(course => course.name.toLowerCase() === trimmedName.toLowerCase())) {
      toast({
        variant: "destructive",
        title: tr('Asignatura duplicada'),
        description: tr('Ya existe una asignatura con este nombre.'),
      });
      return;
    }
    const newCourse: Course = { id: crypto.randomUUID(), name: trimmedName, teacherName: teacherName || undefined };
    setCourses(prev => {
        const updated = [...prev, newCourse];
        setInLocalStorage(storageKeys.courses, updated);
        return updated;
    });
  }, [storageKeys, courses]);

  const updateCourse = useCallback((id: string, updates: Partial<Course>) => {
    if (!storageKeys) return;
    if (updates.name) {
      const newName = updates.name.trim().toLowerCase();
      if (newName && courses.some(course => course.id !== id && course.name.toLowerCase() === newName)) {
        toast({
          variant: "destructive",
          title: tr('Nombre duplicado'),
          description: tr('Ya existe otra asignatura con este nombre.'),
        });
        return;
      }
      updates.name = updates.name.trim();
    }
    const oldName = courses.find(course => course.id === id)?.name;
    const newName = updates.name;
    setCourses(prev => {
        const updated = prev.map(c => c.id === id ? { ...c, ...updates } : c);
        setInLocalStorage(storageKeys.courses, updated);
        return updated;
    });

    if (oldName && newName && oldName !== newName) {
      setTasks(prev => {
        if (!prev.some(t => t.courseId === id)) return prev;
        const updated = prev.map(t => (t.courseId === id ? { ...t, courseName: newName } : t));
        setInLocalStorage(storageKeys.tasks, updated);
        return updated;
      });
      setArchivedTasks(prev => {
        if (!prev.some(t => t.courseId === id)) return prev;
        const updated = prev.map(t => (t.courseId === id ? { ...t, courseName: newName } : t));
        setInLocalStorage(storageKeys.archivedTasks, updated);
        return updated;
      });
      // Una sesión es de esta asignatura si lo dice su id o, en las antiguas sin
      // ids, si lleva su nombre.
      const rename = (names: string[] | undefined) => (names ?? []).map(n => (n === oldName ? newName : n));
      setStudySessions(prev => {
        let touched = false;
        const updated = prev.map(s => {
          const mine = s.subjectIds?.length ? s.subjectIds.includes(id) : (s.subjects ?? []).includes(oldName);
          if (!mine || !(s.subjects ?? []).includes(oldName)) return s;
          touched = true;
          return { ...s, subjects: rename(s.subjects) };
        });
        if (!touched) return prev;
        setInLocalStorage(storageKeys.studySessions, updated);
        return updated;
      });
      setDailyPerformances(prev => {
        if (!prev.some(p => (p.subjects ?? []).includes(oldName))) return prev;
        const updated = prev.map(p => ((p.subjects ?? []).includes(oldName) ? { ...p, subjects: rename(p.subjects) } : p));
        setInLocalStorage(storageKeys.dailyPerformances, updated);
        return updated;
      });
    }
  }, [storageKeys, courses]);

  const deleteCourse = useCallback((id: string) => {
    if (!storageKeys) return;

    const originalCourses = courses;
    const originalTasks = tasks;
    const originalNotes = notes;
    const courseName = originalCourses.find(c => c.id === id)?.name || tr('Asignatura');

    // Optimistic UI update
    setCourses(prev => prev.filter(c => c.id !== id));
    setTasks(prev => prev.filter(t => t.courseId !== id));
    setNotes(prev => prev.filter(n => n.courseId !== id));

    const undo = () => {
      setCourses(prev => restoreRecords(prev, originalCourses, originalCourses.filter(c => c.id === id)));
      setTasks(prev => restoreRecords(prev, originalTasks, originalTasks.filter(t => t.courseId === id)));
      setNotes(prev => restoreRecords(prev, originalNotes, originalNotes.filter(n => n.courseId === id)));
      toast({ title: tr('Acción deshecha'), description: tr('La asignatura "{courseName}" ha sido restaurada.', { courseName }) });
    };

    const commit = () => {
      // Estado persistido más reciente + limpieza PROFUNDA: adjuntos de los
      // recursos vivos, archivo completo de la asignatura (queda inaccesible
      // al desaparecer el curso) con sus adjuntos, y la imagen de portada.
      const latestCourses = getFromLocalStorage<Course[]>(storageKeys.courses, originalCourses);
      const latestTasks = getFromLocalStorage<Task[]>(storageKeys.tasks, originalTasks);
      const latestNotes = getFromLocalStorage<Note[]>(storageKeys.notes, originalNotes);
      setInLocalStorage(storageKeys.courses, latestCourses.filter(c => c.id !== id));
      setInLocalStorage(storageKeys.tasks, latestTasks.filter(t => t.courseId !== id));
      setInLocalStorage(storageKeys.notes, latestNotes.filter(n => n.courseId !== id));
      purgeTaskFiles(latestTasks.filter(t => t.courseId === id));
      latestNotes
        .filter(n => n.courseId === id && n.kind === 'file')
        .forEach(n => { void deleteImage(`noteFile_${n.id}`); });

      const latestArchTasks = getArrayFromLocalStorage<ArchivedTask>(storageKeys.archivedTasks);
      const latestArchNotes = getArrayFromLocalStorage<ArchivedNote>(storageKeys.archivedNotes);
      latestArchNotes
        .filter(n => n.courseId === id && n.kind === 'file')
        .forEach(n => { void deleteImage(`noteFile_${n.id}`); });
      purgeTaskFiles(latestArchTasks.filter(t => t.courseId === id));
      setInLocalStorage(storageKeys.archivedTasks, latestArchTasks.filter(t => t.courseId !== id));
      setInLocalStorage(storageKeys.archivedNotes, latestArchNotes.filter(n => n.courseId !== id));
      setArchivedTasks(prev => prev.filter(t => t.courseId !== id));
      setArchivedNotes(prev => prev.filter(n => n.courseId !== id));
      void deleteImage(`courseImage_${id}`);

      // Colecciones: sin esto seguían contando una asignatura que ya no existe.
      const latestSpaces = getArrayFromLocalStorage<Space>(storageKeys.spaces);
      if (latestSpaces.some(space => space.courseIds.includes(id))) {
        const kept = latestSpaces.map(space => ({ ...space, courseIds: space.courseIds.filter(c => c !== id) }));
        setInLocalStorage(storageKeys.spaces, kept);
        setSpaces(kept);
      }

      // Las grabaciones de la asignatura NO se destruyen: quedan sueltas
      // (vuelven a la sección Grabaciones de Inicio).
      const latestRecordings = getArrayFromLocalStorage<Recording>(storageKeys.recordings);
      const orphaned = latestRecordings.map(r => (r.courseId === id ? { ...r, courseId: null } : r));
      setInLocalStorage(storageKeys.recordings, orphaned);
      setRecordings(prev => prev.map(r => (r.courseId === id ? { ...r, courseId: null } : r)));
    };

    pushUndoableAction({ undo, commit });
    toast({ title: tr('Asignatura eliminada'), description: tr('Presiona Ctrl+Z para deshacer.') });

  }, [storageKeys, courses, tasks, notes]);


  const addTask = useCallback((taskData: Omit<Task, 'id'> & { id?: string }) => {
    if (!storageKeys) return;
    const newTask: Task = {
      ...taskData,
      id: taskData.id ?? crypto.randomUUID(),
    };
    let created = false;
    setTasks(prev => {
        // Con id propio la misma tarea puede intentar entrar dos veces: la
        // segunda no hace nada.
        if (prev.some(t => t.id === newTask.id)) return prev;
        created = true;
        const updated = [...prev, newTask];
        setInLocalStorage(storageKeys.tasks, updated);
        return updated;
    });
    // Sin contenido: solo la forma de la tarea, para saber qué se planifica.
    queueMicrotask(() => {
      if (!created) return;
      trackEvent('task_created', {
        priority: newTask.priority,
        kind: newTask.kind ?? 'Tarea',
        hasDue: Boolean(newTask.dueDate),
        hasEstimate: (newTask.estimatedMinutes ?? 0) > 0,
      });
    });
  }, [storageKeys]);

  const updateTask = useCallback((id: string, updates: Partial<Task>) => {
    if (!storageKeys) return;
    setTasks(prev => {
        const updated = prev.map(t => t.id === id ? { ...t, ...updates } : t);
        setInLocalStorage(storageKeys.tasks, updated);
        return updated;
    });
  }, [storageKeys]);

  const deleteTask = useCallback((id: string) => {
    if (!storageKeys) return;

    const originalTasks = tasks;
    const originalCount = completedTasksCount; // Capture original count
    const originalByCourse = completedTasksByCourse;
    const originalArchived = archivedTasks;
    const taskToDelete = originalTasks.find(t => t.id === id);
    if (!taskToDelete) return; // Safety check
    const taskName = taskToDelete.name || tr('Tarea');
    const courseId = taskToDelete.courseId;
    const newByCourse = { ...originalByCourse, [courseId]: (originalByCourse[courseId] || 0) + 1 };
    // La tarea culminada NO desaparece: pasa al archivo con fecha/hora.
    const archivedEntry: ArchivedTask = { ...taskToDelete, archivedAt: new Date().toISOString() };
    const newArchived = [archivedEntry, ...originalArchived];

    // Optimistic UI update
    setTasks(prev => prev.filter(t => t.id !== id));
    setCompletedTasksCount(prev => prev + 1);
    setCompletedTasksByCourse(newByCourse);
    setArchivedTasks(newArchived);

    const undo = () => {
        setTasks(prev => restoreRecords(prev, originalTasks, [taskToDelete]));
        setCompletedTasksCount(prev => Math.max(0, prev - 1));
        setCompletedTasksByCourse(prev => ({ ...prev, [courseId]: Math.max(0, (prev[courseId] || 0) - 1) }));
        setArchivedTasks(prev => prev.filter(a => !(a.id === archivedEntry.id && a.archivedAt === archivedEntry.archivedAt)));
        toast({ title: tr('Acción deshecha'), description: tr('Tarea "{taskName}" restaurada.', { taskName }) });
    };

    const commit = () => {
        // Se parte del estado PERSISTIDO más reciente (no de la instantánea
        // capturada al borrar): así una tarea creada durante la ventana de
        // deshacer no se pierde, y una purga del archivo no se revierte.
        const latestTasks = getFromLocalStorage<Task[]>(storageKeys.tasks, originalTasks);
        setInLocalStorage(storageKeys.tasks, latestTasks.filter(t => t.id !== id));
        // Contadores desde lo PERSISTIDO, no desde la foto: dos tareas culminadas
        // seguidas partían del mismo número y la segunda pisaba a la primera.
        const latestCount = getFromLocalStorage<number>(storageKeys.completedTasks, originalCount);
        setInLocalStorage(storageKeys.completedTasks, latestCount + 1);
        // Se cuenta al CONFIRMAR, no al pulsar: una tarea deshecha con Ctrl+Z
        // no fue una tarea terminada.
        const dueAt = taskToDelete.dueDate ? new Date(taskToDelete.dueDate) : null;
        const hasDue = dueAt !== null && !Number.isNaN(dueAt.getTime());
        // Por día natural: culminar el mismo día del plazo es llegar a tiempo.
        const dayDiff = hasDue
          ? Math.round(
              (new Date(dueAt!.getFullYear(), dueAt!.getMonth(), dueAt!.getDate()).getTime() -
                new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime()) /
                86_400_000
            )
          : null;
        trackEvent('task_completed', {
          priority: taskToDelete.priority,
          kind: taskToDelete.kind ?? 'Tarea',
          difficulty: taskToDelete.difficulty ?? null,
          hasDue,
          onTime: dayDiff === null ? null : dayDiff >= 0,
          daysEarly: dayDiff,
          estimate: taskToDelete.estimatedMinutes ?? null,
        });
        const latestByCourse = getFromLocalStorage<Record<string, number>>(storageKeys.completedTasksByCourse, originalByCourse);
        setInLocalStorage(storageKeys.completedTasksByCourse, { ...latestByCourse, [courseId]: (latestByCourse[courseId] || 0) + 1 });
        const latestArchived = getArrayFromLocalStorage<ArchivedTask>(storageKeys.archivedTasks);
        setInLocalStorage(storageKeys.archivedTasks, [archivedEntry, ...latestArchived.filter(a => a.id !== archivedEntry.id)]);
    };

    pushUndoableAction({ undo, commit });
    toast({ title: tr('Tarea culminada'), description: tr('Queda en tus tareas culminadas. Ctrl+Z para deshacer.') });
  }, [storageKeys, tasks, completedTasksCount, completedTasksByCourse, archivedTasks]);
  
  // «No se pudo completar»: la tarea sale de pendientes SIN contar como
  // culminada. Va a su propia colección para no contaminar ninguna métrica
  // (tareas culminadas, puntualidad, informes, indicadores de uso).
  const markTaskIncomplete = useCallback((id: string) => {
    if (!storageKeys) return;
    const originalTasks = tasks;
    const target = originalTasks.find(t => t.id === id);
    if (!target) return;
    const entry: ArchivedTask = { ...target, archivedAt: new Date().toISOString(), outcome: 'incomplete' };

    setTasks(prev => prev.filter(t => t.id !== id));
    setIncompleteTasks(prev => [entry, ...prev.filter(t => t.id !== id)]);

    const undo = () => {
      setTasks(prev => restoreRecords(prev, originalTasks, [target]));
      setIncompleteTasks(prev => prev.filter(t => t.id !== id));
      toast({ title: tr('Acción deshecha'), description: tr('Tarea "{name}" devuelta a pendientes.', { name: target.name }) });
    };
    const commit = () => {
      const latestTasks = getFromLocalStorage<Task[]>(storageKeys.tasks, originalTasks);
      setInLocalStorage(storageKeys.tasks, latestTasks.filter(t => t.id !== id));
      const latest = getArrayFromLocalStorage<ArchivedTask>(storageKeys.incompleteTasks);
      setInLocalStorage(storageKeys.incompleteTasks, [entry, ...latest.filter(t => t.id !== id)]);
      trackEvent('task_incomplete', {
        priority: target.priority,
        kind: target.kind ?? 'Tarea',
        progress: Math.round(target.progress ?? 0),
        hasDue: !!target.dueDate,
      });
    };
    pushUndoableAction({ undo, commit });
    toast({ title: tr('Marcada como incompleta'), description: tr('La encuentras en Tareas → Archivadas. Ctrl+Z para deshacer.') });
  }, [storageKeys, tasks, pushUndoableAction]);

  const restoreIncompleteTask = useCallback((id: string) => {
    if (!storageKeys) return;
    const entry = incompleteTasks.find(t => t.id === id);
    if (!entry) return;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { archivedAt: _archivedAt, outcome: _outcome, ...task } = entry;
    setIncompleteTasks(prev => {
      const updated = prev.filter(t => t.id !== id);
      setInLocalStorage(storageKeys.incompleteTasks, updated);
      return updated;
    });
    setTasks(prev => {
      if (prev.some(t => t.id === id)) return prev;
      const updated = [{ ...task, order: -Date.now() }, ...prev];
      setInLocalStorage(storageKeys.tasks, updated);
      return updated;
    });
    toast({ title: tr('Tarea retomada'), description: tr('"{name}" vuelve a tus pendientes.', { name: entry.name }) });
  }, [storageKeys, incompleteTasks]);

  const deleteIncompleteTask = useCallback((id: string) => {
    if (!storageKeys) return;
    setIncompleteTasks(prev => {
      const gone = prev.find(t => t.id === id);
      if (!gone) return prev;
      purgeTaskFiles([gone]);
      const updated = prev.filter(t => t.id !== id);
      setInLocalStorage(storageKeys.incompleteTasks, updated);
      return updated;
    });
  }, [storageKeys]);

  const updateIncompleteTask = useCallback((id: string, updates: Partial<Task>) => {
    if (!storageKeys) return;
    setIncompleteTasks(prev => {
      const updated = prev.map(t => (t.id === id ? { ...t, ...updates } : t));
      setInLocalStorage(storageKeys.incompleteTasks, updated);
      return updated;
    });
  }, [storageKeys]);

  const updateTasksOrder = useCallback((orderedTasks: Task[]) => {
    if (!storageKeys) return;
     const newOrderedTasks = orderedTasks.map((task, index) => ({
      ...task,
      order: Date.now() + index, // Ensure order is unique and reflects new position
    }));
    setTasks(newOrderedTasks);
    setInLocalStorage(storageKeys.tasks, newOrderedTasks);
  }, [storageKeys]);

  const addNote = useCallback((
    courseId: string,
    content: string,
    extra?: { kind?: NoteKind; url?: string; fileName?: string; fileMime?: string; fileDataUrl?: string }
  ) => {
    if (!storageKeys) return;
    const newNote: Note = {
      id: crypto.randomUUID(),
      courseId,
      content,
      createdAt: new Date().toISOString(),
      order: -Date.now(), // Use negative timestamp for order to place it on top
      kind: extra?.kind ?? 'text',
      url: extra?.url,
      fileName: extra?.fileName,
      fileMime: extra?.fileMime,
    };
    if (extra?.fileDataUrl) {
      void saveImage(`noteFile_${newNote.id}`, extra.fileDataUrl);
    }
    setNotes(prev => {
        const updated = [...prev, newNote];
        setInLocalStorage(storageKeys.notes, updated);
        return updated;
    });
  }, [storageKeys]);

  const updateNote = useCallback((
    id: string,
    updates: string | Partial<Pick<Note, 'content' | 'url' | 'fileName' | 'fileMime'>>
  ) => {
    if (!storageKeys) return;
    const patch = typeof updates === 'string' ? { content: updates } : updates;
    setNotes(prev => {
        const updated = prev.map(n => (n.id === id ? { ...n, ...patch } : n));
        setInLocalStorage(storageKeys.notes, updated);
        return updated;
    });
  }, [storageKeys]);

  const deleteNote = useCallback((id: string) => {
    if (!storageKeys) return;

    const originalNotes = notes;
    const originalArchived = archivedNotes;
    const noteToDelete = originalNotes.find(n => n.id === id);
    if (!noteToDelete) return;
    // El recurso NO se destruye: pasa al archivo de la asignatura. Su
    // adjunto de IndexedDB se conserva hasta purgar el archivo.
    const archivedEntry: ArchivedNote = { ...noteToDelete, archivedAt: new Date().toISOString() };
    const newArchived = [archivedEntry, ...originalArchived];

    // Optimistic UI update
    setNotes(prev => prev.filter(n => n.id !== id));
    setArchivedNotes(newArchived);

    const undo = () => {
        setNotes(prev => restoreRecords(prev, originalNotes, [noteToDelete]));
        setArchivedNotes(prev => prev.filter(a => !(a.id === archivedEntry.id && a.archivedAt === archivedEntry.archivedAt)));
        toast({ title: tr('Acción deshecha'), description: tr('Recurso restaurado.') });
    };

    const commit = () => {
        // Estado persistido más reciente: no pisa recursos creados durante
        // la ventana de deshacer ni resucita un archivo recién purgado.
        const latestNotes = getFromLocalStorage<Note[]>(storageKeys.notes, originalNotes);
        setInLocalStorage(storageKeys.notes, latestNotes.filter(n => n.id !== id));
        const latestArchived = getArrayFromLocalStorage<ArchivedNote>(storageKeys.archivedNotes);
        setInLocalStorage(storageKeys.archivedNotes, [archivedEntry, ...latestArchived.filter(a => a.id !== archivedEntry.id)]);
    };

    pushUndoableAction({ undo, commit });
    toast({ title: tr('Recurso archivado'), description: tr('Presiona Ctrl+Z para deshacer.') });
  }, [storageKeys, notes, archivedNotes]);

  // Elimina una tarea SIN archivarla: para descartar tareas (p. ej. vencidas
  // que ya no se harán) sin que cuenten como completadas ni queden en el
  // archivo de la asignatura.
  const removeTask = useCallback((id: string) => {
    if (!storageKeys) return;
    const originalTasks = tasks;
    const taskToRemove = originalTasks.find(t => t.id === id);
    if (!taskToRemove) return;

    setTasks(prev => prev.filter(t => t.id !== id));

    const undo = () => {
      setTasks(prev => restoreRecords(prev, originalTasks, [taskToRemove]));
      toast({ title: tr('Acción deshecha'), description: tr('Tarea "{name}" restaurada.', { name: taskToRemove.name }) });
    };
    const commit = () => {
      const latestTasks = getFromLocalStorage<Task[]>(storageKeys.tasks, originalTasks);
      setInLocalStorage(storageKeys.tasks, latestTasks.filter(t => t.id !== id));
      // Eliminada de verdad (ya no cabe el Ctrl+Z): sus archivos adjuntos también.
      purgeTaskFiles([taskToRemove]);
    };
    pushUndoableAction({ undo, commit });
    toast({ title: tr('Tarea eliminada'), description: tr('No se archivó. Ctrl+Z para deshacer.') });
  }, [storageKeys, tasks]);

  // Reparte los minutos de una sesión de estudio entre las tareas avanzadas:
  // 60 min sobre una tarea estimada en 120 min ⇒ +50% de progreso.
  const applySessionProgressToTasks = useCallback((taskIds: string[], minutes: number) => {
    if (!storageKeys || taskIds.length === 0 || minutes <= 0) return;
    const share = minutes / taskIds.length;
    setTasks(prev => {
      const updated = prev.map(t => {
        if (!taskIds.includes(t.id)) return t;
        const est = t.estimatedMinutes ?? 0;
        if (est <= 0) return t;
        const delta = (share / est) * 100;
        return { ...t, progress: Math.min(100, Math.round((t.progress || 0) + delta)) };
      });
      setInLocalStorage(storageKeys.tasks, updated);
      return updated;
    });
  }, [storageKeys]);

  // --- Horario del colegio ---
  // --- Eventos del calendario LOCAL ---
  const addLocalEvent = useCallback((event: Omit<LocalCalendarEvent, 'id'>) => {
    if (!storageKeys) return;
    const newEvent: LocalCalendarEvent = { ...event, id: crypto.randomUUID() };
    setLocalEvents(prev => {
      const updated = [...prev, newEvent];
      setInLocalStorage(storageKeys.localEvents, updated);
      return updated;
    });
  }, [storageKeys]);

  const updateLocalEvent = useCallback((id: string, updates: Partial<Omit<LocalCalendarEvent, 'id'>>) => {
    if (!storageKeys) return;
    setLocalEvents(prev => {
      const updated = prev.map(e => (e.id === id ? { ...e, ...updates, id: e.id } : e));
      setInLocalStorage(storageKeys.localEvents, updated);
      return updated;
    });
  }, [storageKeys]);

  const deleteLocalEvent = useCallback((id: string) => {
    if (!storageKeys) return;
    setLocalEvents(prev => {
      const updated = prev.filter(e => e.id !== id);
      setInLocalStorage(storageKeys.localEvents, updated);
      return updated;
    });
  }, [storageKeys]);

  // Colores propios de las casillas: un registro por día (su id ES el día),
  // así la sincronización los fusiona uno a uno y pintar en dos equipos no choca.
  const setDayColors = useCallback((days: string[], color: string | null) => {
    if (!storageKeys || days.length === 0) return;
    const touched = new Set(days);
    setDayColorsState(prev => {
      const kept = prev.filter(c => !touched.has(c.id));
      const updated = color === null ? kept : [...kept, ...days.map(id => ({ id, color }))];
      setInLocalStorage(storageKeys.dayColors, updated);
      return updated;
    });
  }, [storageKeys]);

  // Avisos nativos de los eventos con hora (ver useEventReminders).
  useLocalEventReminders(localEvents, storageKeys?.localEvents ?? null);

  // --- Grabaciones de voz ---
  const addRecording = useCallback((recording: Recording) => {
    if (!storageKeys) return;
    setRecordings(prev => {
      const updated = [...prev, recording];
      setInLocalStorage(storageKeys.recordings, updated);
      return updated;
    });
  }, [storageKeys]);

  const updateRecording = useCallback((id: string, updates: Partial<Recording>) => {
    if (!storageKeys) return;
    setRecordings(prev => {
      const updated = prev.map(r => (r.id === id ? { ...r, ...updates } : r));
      setInLocalStorage(storageKeys.recordings, updated);
      return updated;
    });
  }, [storageKeys]);

  const deleteRecording = useCallback((id: string) => {
    if (!storageKeys) return;
    const rec = getArrayFromLocalStorage<Recording>(storageKeys.recordings).find(r => r.id === id);
    setRecordings(prev => {
      const updated = prev.filter(r => r.id !== id);
      setInLocalStorage(storageKeys.recordings, updated);
      return updated;
    });
    // Limpieza profunda: audio de IndexedDB + archivo permanente en disco.
    void deleteRecordingAudio(id).catch(e => console.error('deleteRecordingAudio failed', e));
    if (rec?.filePath && isTauri()) {
      void invoke('delete_recording_file', { path: rec.filePath }).catch(() => {});
    }
  }, [storageKeys]);

  const updateNotesOrder = useCallback((orderedNotes: Note[]) => {
    if (!storageKeys) return;
     const newOrderedNotes = orderedNotes.map((note, index) => ({
      ...note,
      order: Date.now() + index, 
    }));
    setNotes(newOrderedNotes);
    setInLocalStorage(storageKeys.notes, newOrderedNotes);
  }, [storageKeys]);

  const addHabit = useCallback((name: string, phase?: HabitPhase, days?: number[]) => {
    if (!storageKeys) return;
    const newHabit: Habit = {
      id: crypto.randomUUID(),
      name,
      ...(phase ? { phase } : {}),
      // Solo se guardan los días si de verdad son unos pocos: los siete
      // equivalen a «cada día».
      ...(days && days.length > 0 && days.length < 7 ? { days: [...days].sort() } : {}),
      completedOn: [],
      isArchived: false,
      order: Date.now(),
      // Los informes no cuentan como fallados los días anteriores al alta.
      createdAt: new Date().toISOString(),
    };
    setHabits(prev => {
      const updated = [...prev, newHabit];
      setInLocalStorage(storageKeys.habits, updated);
      return updated;
    });
  }, [storageKeys]);

  const updateHabit = useCallback((id: string, updates: Partial<Habit>) => {
    if (!storageKeys) return;
    setHabits(prev => {
      const updated = prev.map(h => (h.id === id ? { ...h, ...updates } : h));
      setInLocalStorage(storageKeys.habits, updated);
      return updated;
    });
  }, [storageKeys]);

  const deleteHabit = useCallback((id: string) => {
    if (!storageKeys) return;
    setHabits(prev => {
      const updated = prev.filter(h => h.id !== id);
      setInLocalStorage(storageKeys.habits, updated);
      return updated;
    });
  }, [storageKeys]);
  
  // --- Avances de la sesión en curso ---
  const addSessionNote = useCallback((note: Omit<SessionNote, 'id' | 'at'>) => {
    if (!storageKeys) return;
    const entry: SessionNote = { ...note, id: crypto.randomUUID(), at: new Date().toISOString() };
    setSessionNotes(prev => {
      const updated = [...prev, entry];
      setInLocalStorage(storageKeys.sessionNotes, updated);
      return updated;
    });
  }, [storageKeys]);

  const deleteSessionNote = useCallback((id: string) => {
    if (!storageKeys) return;
    setSessionNotes(prev => {
      const updated = prev.filter(n => n.id !== id);
      setInLocalStorage(storageKeys.sessionNotes, updated);
      return updated;
    });
  }, [storageKeys]);

  const clearSessionNotes = useCallback(() => {
    if (!storageKeys) return;
    setSessionNotes([]);
    setInLocalStorage(storageKeys.sessionNotes, []);
  }, [storageKeys]);

  addSessionNoteRef.current = addSessionNote;

  const addStudySession = useCallback((
    sessionData: Omit<StudySession, 'id' | 'startTime' | 'endTime' | 'duration' | 'durationSec'> & {
      durationSec: number;
      endedAt?: string;
    }
  ) => {
    if (!storageKeys) return;
    const { endedAt, ...rest } = sessionData;
    const durationSec = Math.max(0, Math.round(rest.durationSec));

    // LA SESIÓN PERTENECE AL DÍA EN QUE SE ESTUDIÓ. Antes inicio y fin valían
    // los dos "el instante en que se pulsó Registrar", y toda la analítica
    // agrupa por `startTime`: estudiar de 23:00 a 00:30 dejaba el lunes a cero
    // (racha rota, calificación C) y le regalaba 90 minutos al martes; y una
    // sesión rescatada a la mañana siguiente contaba como estudiada hoy.
    // Ahora el fin es el real y el inicio se deduce restando lo estudiado
    // (las pausas lo alargarían, así que es el inicio más tardío posible: nunca
    // inventa tiempo).
    const endMs = (() => {
      const parsed = endedAt ? Date.parse(endedAt) : NaN;
      const nowMs = Date.now();
      return Number.isNaN(parsed) || parsed > nowMs ? nowMs : parsed;
    })();
    const endIso = new Date(endMs).toISOString();
    const startIso = new Date(endMs - durationSec * 1000).toISOString();

    const newSession: StudySession = {
        ...rest,
        durationSec,
        duration: durationSec / 60, // minutos derivados, sin redondear
        id: crypto.randomUUID(),
        startTime: startIso,
        endTime: endIso,
        // Lo anotado durante la sesión pasa a formar parte de ella: es el
        // relato de cómo se avanzó, no una nota suelta.
        progressNotes: sessionNotes.length > 0 ? sessionNotes : undefined,
    };
    trackEvent('study_session_end', {
      minutes: Math.round(durationSec / 60),
      focus: newSession.mode === 'tiempo' ? null : (newSession.perception ?? null),
      hour: new Date(newSession.startTime).getHours(),
      mode: newSession.mode ?? 'tiempo',
      type: newSession.sessionType,
      subjects: newSession.subjects?.length ?? 0,
      tasks: newSession.taskIds?.length ?? 0,
      notes: (newSession.progressNotes?.length ?? 0) + (newSession.notes ? 1 : 0),
    });
    setStudySessions(prev => {
        const updated = [...prev, newSession];
        setInLocalStorage(storageKeys.studySessions, updated);
        return updated;
    });
    if (sessionNotes.length > 0) {
      setSessionNotes([]);
      setInLocalStorage(storageKeys.sessionNotes, []);
    }

    // Si la sesión cae en un día YA CERRADO (cruzó la medianoche o se rescató
    // después), la calificación guardada de ese día quedó vieja: se borra para
    // que Enfoque la recalcule, igual que al eliminar una sesión.
    try {
      const dayId = format(parseISO(startIso), 'yyyy-MM-dd');
      if (dayId !== format(new Date(), 'yyyy-MM-dd')) {
        setDailyPerformances(prev => {
          const next = prev.filter(p => p.id !== dayId);
          if (next.length === prev.length) return prev;
          setInLocalStorage(storageKeys.dailyPerformances, next);
          return next;
        });
      }
    } catch {
      /* fecha ilegible: no hay calificación que invalidar */
    }
  }, [storageKeys, sessionNotes]);

  /**
   * Corrige una sesión ya registrada: enfoque, asignaturas y anotación.
   *
   * La duración NO se toca a propósito: la mide el reloj y es el único dato
   * que no depende de la memoria de nadie. Poder editarla convertiría las
   * métricas en un deseo en vez de en una medición.
   *
   * El candado del mismo día se comprueba AQUÍ además de en la interfaz: el
   * botón se puede esconder, pero el almacén tiene que sostener la regla.
   */
  const updateStudySession = useCallback((
    id: string,
    updates: Pick<StudySession, 'perception' | 'subjects' | 'subjectIds' | 'notes'>
  ): boolean => {
    if (!storageKeys) return false;
    const target = studySessions.find(s => s.id === id);
    if (!target) return false;
    if (!isSessionEditable(target)) {
      toast({
        variant: 'destructive',
        title: tr('Esta sesión ya no se puede editar'),
        description: tr('Las sesiones solo se corrigen el mismo día en que se registraron.'),
      });
      return false;
    }
    const updated = studySessions.map(s =>
      s.id === id
        ? {
            ...s,
            perception: updates.perception,
            subjects: updates.subjects,
            subjectIds: updates.subjectIds,
            notes: updates.notes?.trim() ? updates.notes.trim() : undefined,
          }
        : s
    );
    setStudySessions(updated);
    setInLocalStorage(storageKeys.studySessions, updated);
    // La calificación de hoy se recalcula en vivo en Enfoque, así que no hay
    // nada que invalidar: updateDailyPerformance ignora el día en curso.
    toast({ title: tr('Sesión actualizada'), description: tr('Los cambios ya cuentan en tus métricas de hoy.') });
    return true;
  }, [storageKeys, studySessions]);

  const deleteStudySession = useCallback((id: string) => {
    if (!storageKeys) return;
    const target = studySessions.find(s => s.id === id);
    if (!target) return;
    // Mismo candado que la edición: el registro de días cerrados no se borra.
    if (!isSessionEditable(target)) {
      toast({
        variant: 'destructive',
        title: tr('Esta sesión ya no se puede eliminar'),
        description: tr('Las sesiones de días anteriores forman parte de tu registro.'),
      });
      return;
    }
    const updated = studySessions.filter(s => s.id !== id);
    setStudySessions(updated);
    setInLocalStorage(storageKeys.studySessions, updated);
    // La calificación de ese día queda obsoleta: se borra para que
    // calculateAndSaveDailyPerformance (Enfoque) la vuelva a calcular.
    // El id de DailyPerformance se construye con la fecha LOCAL, no con la
    // UTC del ISO: cortar la cadena apuntaría al día siguiente en las
    // sesiones nocturnas de husos negativos.
    let dayId: string;
    try {
      dayId = format(parseISO(target.startTime), 'yyyy-MM-dd');
    } catch {
      return;
    }
    setDailyPerformances(prev => {
        const next = prev.filter(p => p.id !== dayId);
        if (next.length === prev.length) return prev;
        setInLocalStorage(storageKeys.dailyPerformances, next);
        return next;
    });
    toast({ title: tr('Sesión eliminada'), description: tr('La sesión de estudio se quitó del historial.') });
  }, [storageKeys, studySessions]);

  const updateDailyPerformance = useCallback((performanceData: DailyPerformance) => {
    if (!storageKeys) return;

    const today = format(new Date(), 'yyyy-MM-dd');
    if (performanceData.id === today) {
        return;
    }

    setDailyPerformances(prev => {
        const existing = prev.find(p => p.id === performanceData.id);
        let updated;
        if (existing) {
            if (existing.score !== performanceData.score) {
                 updated = prev.map(p => p.id === performanceData.id ? performanceData : p);
            } else {
                updated = prev;
            }
        } else {
            updated = [...prev, performanceData];
        }
        
        if (updated !== prev) {
            setInLocalStorage(storageKeys.dailyPerformances, updated);
        }
        return updated;
    });
  }, [storageKeys]);

  const updateStudyGoals = useCallback((newGoals: StudyGoals) => {
    if (!storageKeys) return;
    setStudyGoals(newGoals);
    setInLocalStorage(storageKeys.studyGoals, newGoals);
  }, [storageKeys]);
  
  const updateStreakGoal = useCallback((updates: Partial<StreakGoal>) => {
    if (!storageKeys) return;
    setStreakGoal(prev => {
        const newGoal = { ...prev, ...updates };
        setInLocalStorage(storageKeys.streakGoal, newGoal);
        return newGoal;
    });
  }, [storageKeys]);

  const setAdvancedMode = useCallback((on: boolean) => {
    if (!storageKeys) return;
    setAdvancedChoice(on);
    setInLocalStorage(storageKeys.advancedMode, on);
  }, [storageKeys]);

  const setSelectionMode = useCallback((mode: SelectionMode) => {
    if (!storageKeys) return;
    setSelectionModeState(mode);
    setInLocalStorage(storageKeys.selectionMode, mode);
    updateStreakGoal({ mode });
  }, [storageKeys, updateStreakGoal]);
  
  const setPlayerVisible = useCallback((isVisible: boolean) => {
    if (!storageKeys) return;
    setPlayerVisibleState(isVisible);
    setInLocalStorage(storageKeys.isPlayerVisible, isVisible);
  }, [storageKeys]);

  // --- Playlist Methods ---
  /** Fusiona canciones en la playlist con ese nombre (la crea si no existe):
   *  lo usa «Importar» al traer las playlists de una carpeta exportada. */
  const mergePlaylistSongs = useCallback((name: string, songIds: string[]) => {
    if (!storageKeys || songIds.length === 0) return;
    const key = name.trim().toLowerCase();
    setPlaylists(prev => {
      const idx = prev.findIndex(p => p.name.trim().toLowerCase() === key);
      let updated: Playlist[];
      if (idx === -1) {
        updated = [...prev, { id: crypto.randomUUID(), name: name.trim(), songIds, order: nextOrder(prev) }];
      } else {
        const existing = prev[idx];
        const merged = [...existing.songIds, ...songIds.filter(id => !existing.songIds.includes(id))];
        if (merged.length === existing.songIds.length) return prev;
        updated = prev.map((p, i) => (i === idx ? { ...p, songIds: merged } : p));
      }
      setInLocalStorage(storageKeys.playlists, updated);
      return updated;
    });
  }, [storageKeys]);

  const updatePlaylist = useCallback((id: string, updates: Partial<Playlist>) => {
    if (!storageKeys) return;
    if (updates.name) {
      const newName = updates.name.trim().toLowerCase();
      if (newName && playlists.some(playlist => playlist.id !== id && playlist.name.toLowerCase() === newName)) {
        toast({
          variant: "destructive",
          title: tr('Nombre duplicado'),
          description: tr('Ya existe otra playlist con este nombre.'),
        });
        return;
      }
      updates.name = updates.name.trim();
    }

    setPlaylists(prevPlaylists => {
        const originalPlaylists = prevPlaylists;
        const wasSongRemoval = !!updates.songIds && (originalPlaylists.find(p => p.id === id)?.songIds.length ?? 0) > (updates.songIds?.length || 0);
        
        const updatedPlaylists = originalPlaylists.map(p => p.id === id ? { ...p, ...updates } : p);

        if (wasSongRemoval) {
            // Defer side-effects to after the render phase to avoid state update during render errors.
            setTimeout(() => {
                const originalIds = originalPlaylists.find(p => p.id === id)?.songIds ?? [];
                const keptIds = new Set(updates.songIds ?? []);
                const removedIds = originalIds.filter(songId => !keptIds.has(songId));

                const undo = () => {
                    setPlaylists(prev => prev.map(p =>
                      p.id === id ? { ...p, songIds: restoreIds(p.songIds, originalIds, removedIds) } : p
                    ));
                    toast({ title: tr('Acción deshecha'), description: tr('Canción restaurada a la playlist.') });
                };

                // Se parte de lo PERSISTIDO: guardar la foto de hace siete segundos
                // pisaba las playlists creadas o fusionadas entretanto (una
                // importación añade canciones a playlists mientras avanza).
                const commit = () => {
                    const removedSet = new Set(removedIds);
                    const latest = getArrayFromLocalStorage<Playlist>(storageKeys.playlists);
                    setInLocalStorage(storageKeys.playlists, latest.map(p =>
                      p.id === id ? { ...p, songIds: p.songIds.filter(songId => !removedSet.has(songId)) } : p
                    ));
                };
        
                pushUndoableAction({ undo, commit });
                toast({ title: tr('Canción eliminada'), description: tr('Presiona Ctrl+Z para deshacer.') });
            }, 0);
        } else {
          setInLocalStorage(storageKeys.playlists, updatedPlaylists);
        }

        return updatedPlaylists;
    });
  }, [storageKeys, playlists]);

  const reorderPlaylists = useCallback((orderedIds: string[]) => {
    setPlaylists(prev => {
      // El orden va en cada playlist (1.6.8): solo así viaja a los demás
      // dispositivos. Desde la 1.7.3 se reescriben SOLO las que cambian de
      // sitio (lib/playlist-order.ts): renumerarlas todas pisaba, en los
      // demás dispositivos, el orden de canciones que otro acababa de dar.
      // Lo que no venía en la lista (creado mientras se arrastraba) no se pierde.
      const next = reorderPlaylistsMinimal(prev, orderedIds);
      const unchanged = next.length === prev.length && next.every((p, i) => p === prev[i]);
      if (unchanged) return prev;
      if (storageKeys) setInLocalStorage(storageKeys.playlists, next);
      return next;
    });
  }, [storageKeys]);

  const deletePlaylist = useCallback((id: string) => {
    if (!storageKeys) return;

    const originalPlaylists = playlists;
    const playlistName = originalPlaylists.find(p => p.id === id)?.name || tr('Playlist');

    setPlaylists(prev => prev.filter(p => p.id !== id));

    const undo = () => {
      setPlaylists(prev => restoreRecords(prev, originalPlaylists, originalPlaylists.filter(p => p.id === id)));
      toast({ title: tr('Acción deshecha'), description: tr('Playlist "{playlistName}" restaurada.', { playlistName }) });
    };

    const commit = () => {
      // Desde lo persistido: la foto de hace siete segundos no conoce las
      // playlists creadas después.
      const latest = getArrayFromLocalStorage<Playlist>(storageKeys.playlists);
      setInLocalStorage(storageKeys.playlists, latest.filter(p => p.id !== id));
      // La imagen de cabecera de la playlist no debe quedar huérfana en el equipo.
      void deleteImage(`playlistImage_${id}`);
    };

    pushUndoableAction({ undo, commit });
    toast({ title: tr('Playlist eliminada'), description: tr('Presiona Ctrl+Z para deshacer.') });

  }, [storageKeys, playlists]);
  
  // --- Space Methods ---
  const addSpace = useCallback((name: string, courseIds: string[]) => {
    if (!storageKeys) return;
    const trimmedName = name.trim();
    if (spaces.some(space => space.name.toLowerCase() === trimmedName.toLowerCase())) {
      toast({
        variant: "destructive",
        title: tr('Colección duplicada'),
        description: tr('Ya existe una colección con este nombre.'),
      });
      return;
    }
    const newSpace: Space = { id: crypto.randomUUID(), name: trimmedName, courseIds };
    const courseIdsToMove = new Set(courseIds);

    setSpaces(prevSpaces => {
        // Remove the moved courses from their original spaces
        const updatedOldSpaces = prevSpaces.map(space => {
            const newCourseIds = space.courseIds.filter(id => !courseIdsToMove.has(id));
            // Only create a new object if the courseIds have actually changed
            if (newCourseIds.length !== space.courseIds.length) {
                return { ...space, courseIds: newCourseIds };
            }
            return space;
        });

        // Add the new space to the list of updated spaces
        const finalSpaces = [...updatedOldSpaces, newSpace];
        setInLocalStorage(storageKeys.spaces, finalSpaces);
        return finalSpaces;
    });
  }, [storageKeys, spaces]);

  const updateSpace = useCallback((id: string, updates: Partial<Space>) => {
    if (!storageKeys) return;
    if (updates.name) {
      const newName = updates.name.trim().toLowerCase();
      if (newName && spaces.some(space => space.id !== id && space.name.toLowerCase() === newName)) {
        toast({
          variant: "destructive",
          title: tr('Nombre duplicado'),
          description: tr('Ya existe otra colección con este nombre.'),
        });
        return;
      }
      updates.name = updates.name.trim();
    }
    setSpaces(prev => {
        const updated = prev.map(s => s.id === id ? { ...s, ...updates } : s);
        setInLocalStorage(storageKeys.spaces, updated);
        return updated;
    });
  }, [storageKeys, spaces]);

  const addSongs = useCallback(async (newSongs: Song[]) => {
    if (newSongs.length === 0) return;

    // La biblioteca REAL de este instante (ver songsRef): una descarga larga
    // llama aquí muchas veces y cada llamada tiene que ver lo que dejó la
    // anterior.
    const current = songsRef.current;

    // Deduplicación contra la biblioteca actual: re-importar una carpeta (o
    // los mismos archivos) no debe crear copias con IDs nuevos.
    const existingIds = new Set(current.map(s => s.id));
    const existingFiles = new Set(current.map(s => s.fileName));
    const unique = newSongs.filter(s => !existingIds.has(s.id) && !existingFiles.has(s.fileName));
    const skipped = newSongs.length - unique.length;
    if (skipped > 0) {
      toast({ title: tr('Canciones omitidas'), description: tr('{skipped} ya estaban en tu biblioteca.', { skipped }) });
    }
    if (unique.length === 0) return;

    // Cada canción nueva se numera por detrás de la última: lo recién
    // descargado aparece al final, hoy y en el próximo arranque.
    let next = Math.max(
      nextSeqRef.current,
      current.reduce((max, s) => Math.max(max, s.seq ?? -1), -1) + 1
    );
    // Cada canción nueva es del perfil que la trae (1.6.7).
    const owner = activeProfileId() ?? undefined;
    const numbered = unique.map(song => ({ ...song, seq: song.seq ?? next++, owner: song.owner ?? owner }));
    nextSeqRef.current = next;

    // El ref se adelanta al render: si la siguiente canción del lote llega
    // antes de que React repinte, ya ve estas y sigue numerando bien.
    songsRef.current = [...current, ...numbered].sort(compareSongs);

    for (const song of numbered) {
      await saveSongMetadata(song);
    }

    setSongs(prev => {
      const updatedSongs = [...prev, ...numbered].sort(compareSongs);
      // If the playback queue is the global list, update it too
      if (playingContext === 'Música') {
        setPlaybackQueue(updatedSongs);
      }
      return updatedSongs;
    });
  }, [playingContext]);

  const deleteSong = useCallback(async (id: string) => {
    if (!storageKeys) return;

    if (currentSong?.id === id) {
      setCurrentSong(null);
      setIsPlaying(false);
    }

    const originalSongs = songs;
    const originalPlaylists = playlists;
    const songToDelete = originalSongs.find(s => s.id === id);
    if (!songToDelete) return;

    // Optimistic UI update. En las playlists la canción deja su CLAVE (1.6.8):
    // aquí ya no se ve, pero los demás dispositivos la conservan en su sitio
    // (la música no viaja: borrarla aquí no la borra allí).
    // La clave de ESTA copia (con su número si hay dos con el mismo título y
    // artista, 1.7.3), no la de la primera.
    const keyOfDeleted = userProfile ? songKeyIn(userProfile.id, songToDelete) : songToDelete.id;
    const keepKey = (ids: string[]) => [...new Set(ids.map(songId => (songId === id ? keyOfDeleted : songId)))];
    setSongs(prev => prev.filter(s => s.id !== id));
    setPlaylists(prev => prev.map(p => (p.songIds.includes(id) ? { ...p, songIds: keepKey(p.songIds) } : p)));
    // La cola y el historial también la sueltan: si no, «siguiente» o «anterior»
    // acababan intentando reproducir un archivo que ya no existe.
    setPlaybackQueue(prev => prev.filter(s => s.id !== id));
    setPlaybackHistory(prev => prev.filter(s => s.id !== id));

    const undo = () => {
      setSongs(prev => restoreRecords(prev, originalSongs, [songToDelete]));
      setPlaylists(prev => prev.map(p => {
        const before = originalPlaylists.find(o => o.id === p.id);
        if (!before || !before.songIds.includes(id) || p.songIds.includes(id)) return p;
        return { ...p, songIds: restoreIds(p.songIds.filter(songId => songId !== keyOfDeleted), before.songIds, [id]) };
      }));
      setPlaybackQueue(prev => (prev.some(s => s.id === id) ? prev : [...prev, songToDelete]));
      toast({ title: tr('Acción deshecha'), description: tr('Canción "{songTitle}" restaurada.', { songTitle: songTitle(songToDelete) }) });
    };

    const commit = async () => {
      try {
        await deleteSongFileFromDB(id);
        await deleteSongMetadata(id);
        void forgetLyrics(id);
        // Desde lo persistido (ver deletePlaylist): no pisa playlists nuevas.
        const latest = getArrayFromLocalStorage<Playlist>(storageKeys.playlists);
        setInLocalStorage(storageKeys.playlists, latest.map(p => (p.songIds.includes(id) ? { ...p, songIds: keepKey(p.songIds) } : p)));
      } catch (e) {
        console.error("Failed to commit song deletion:", e);
        undo(); // Revert if commit fails
      }
    };
    
    pushUndoableAction({ undo, commit });
    toast({ title: tr('Canción "{songTitle}" eliminada', { songTitle: songTitle(songToDelete) }), description: tr('Presiona Ctrl+Z para deshacer.') });

  }, [currentSong, storageKeys, songs, playlists, userProfile]);
  
  const toggleSongFavorite = useCallback(async (id: string) => {
      const base = songsRef.current.find(s => s.id === id);
      if (!base) return;
      const isFavorite = !base.isFavorite;
      const updatedSong: Song = { ...base, isFavorite };
      // Primero la lista que viaja: así el corazón llega a los demás dispositivos.
      const uid = userProfile?.id;
      if (uid) setSongFavorite(uid, base, isFavorite);
      songsRef.current = songsRef.current.map(s => (s.id === id ? updatedSong : s));

      setSongs(prev => prev.map(s => (s.id === id ? { ...s, isFavorite } : s)));
      setPlaybackQueue(prev => prev.map(s => (s.id === id ? { ...s, isFavorite } : s)));
      setCurrentSong(prev => (prev?.id === id ? { ...prev, isFavorite } : prev));

      try {
        await saveSongMetadata(updatedSong);
      } catch (e) {
        // Sin guardado no hay favorito: se devuelve el corazón a como estaba
        // en vez de dejar en pantalla algo que no sobrevivirá al reinicio.
        console.error('No se pudo guardar el favorito', id, e);
        if (uid) setSongFavorite(uid, base, !isFavorite);
        setSongs(prev => prev.map(s => (s.id === id ? { ...s, isFavorite: !isFavorite } : s)));
        setCurrentSong(prev => (prev?.id === id ? { ...prev, isFavorite: !isFavorite } : prev));
      }
  }, [userProfile?.id]);

  const playSong = useCallback((song: Song, options?: { context?: string, queue?: Song[], href?: string }) => {
      const newQueue = options?.queue || songs;
      const newContext = options?.context || 'Música';

      setPlaybackQueue(newQueue);
      setPlayingContext(newContext);
      // Sin origen explícito la cola sale de la biblioteca central: sólo las
      // playlists tienen una ruta propia a la que volver.
      setPlayingContextHref(options?.href || '/music');
      setCurrentSong(song);
      setIsPlaying(true);
      setPlaybackHistory([]); // Clear history on manual play
  }, [songs, userProfile]);

  const togglePlay = () => {
      if(currentSong) {
          setIsPlaying(prev => !prev);
      }
  };

  const toggleShuffle = () => setIsShuffle(prev => !prev);
  
  const playNext = useCallback(() => {
    if (!currentSong) return;

    // Candidatos REALES de la cola: excluye la canción en curso. Una cola de
    // un solo elemento (p. ej. una búsqueda con UN resultado) no tiene
    // siguiente y antes dejaba el reproductor atascado al terminar.
    const candidates = playbackQueue.filter(s => s.id !== currentSong.id);
    let nextSong: Song | null = null;

    if (candidates.length > 0) {
      if (isShuffle) {
        nextSong = candidates[Math.floor(Math.random() * candidates.length)];
      } else {
        const currentIndex = playbackQueue.findIndex(s => s.id === currentSong.id);
        const len = playbackQueue.length;
        for (let step = 1; step <= len; step++) {
          const cand = playbackQueue[(currentIndex + step) % len];
          if (cand.id !== currentSong.id) { nextSong = cand; break; }
        }
      }
    }

    if (!nextSong) {
      // Cola agotada → aleatoria de la BIBLIOTECA CENTRAL, distinta a la
      // actual, y la cola pasa a ser la biblioteca completa.
      const pool = songs.filter(s => s.id !== currentSong.id);
      if (pool.length === 0) { setIsPlaying(false); return; } // biblioteca de 1 canción
      nextSong = pool[Math.floor(Math.random() * pool.length)];
      setPlaybackQueue(songs);
      setPlayingContext('Música');
      setPlayingContextHref('/music');
    }

    setPlaybackHistory(prev => [...prev, currentSong]);
    setCurrentSong(nextSong);
    setIsPlaying(true);
  }, [currentSong, playbackQueue, isShuffle, songs, userProfile]);


  const playPrevious = useCallback(() => {
    if (!currentSong || playbackQueue.length === 0) return;
    
    if (isShuffle) {
        if (playbackHistory.length > 0) {
            const lastSong = playbackHistory[playbackHistory.length - 1];
            setPlaybackHistory(prev => prev.slice(0, -1));
            setCurrentSong(lastSong);
            setIsPlaying(true);
        }
    } else {
        const currentIndex = playbackQueue.findIndex(s => s.id === currentSong.id);
        const prevIndex = (currentIndex - 1 + playbackQueue.length) % playbackQueue.length;
        setCurrentSong(playbackQueue[prevIndex]);
        setIsPlaying(true);
    }
  }, [currentSong, playbackQueue, isShuffle, playbackHistory]);


  // --- Data Getter Methods ---

  const getTasksForCourse = useCallback((courseId: string) => {
    return tasks.filter(task => task.courseId === courseId).sort((a,b) => (a.order || 0) - (b.order || 0));
  }, [tasks]);
  
  const getNotesForCourse = useCallback((courseId: string) => {
    return notes.filter(note => note.courseId === courseId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [notes]);
 
  const value: CourseContextType = {
    userProfile,
    isCreateCourseOpen,
    setCreateCourseOpen,
    newCourseName,
    setNewCourseName,
    newTeacherName,
    setNewTeacherName,
    showAlert,
    setTimerTime,
    isTimerActive,
    setIsTimerActive,
    sessionStartTime,
    setSessionStartTime,
    timerMode,
    setTimerMode,
    resetTimerState,
    suspendActiveSession,
    resumeInterruptedSession,
    courses,
    tasks,
    notes,
    habits,
    studySessions,
    dailyPerformances,
    studyGoals,
    streakGoal,
    storedStreakGoal,
    advancedMode,
    advancedModeChosen: advancedChoice !== null,
    setAdvancedMode,
    completedTasksByCourse,
    archivedTasks,
    incompleteTasks,
    markTaskIncomplete,
    restoreIncompleteTask,
    deleteIncompleteTask,
    updateIncompleteTask,
    archivedNotes,
    removeTask,
    applySessionProgressToTasks,
    localEvents,
    addLocalEvent,
    updateLocalEvent,
    deleteLocalEvent,
    dayColors,
    setDayColors,
    recordings,
    addRecording,
    updateRecording,
    deleteRecording,
    addCourse,
    updateCourse,
    deleteCourse,
    addTask,
    updateTask,
    deleteTask,
    updateTasksOrder,
    addNote,
    updateNote,
    deleteNote,
    updateNotesOrder,
    addHabit,
    updateHabit,
    deleteHabit,
    addStudySession,
    sessionNotes,
    addSessionNote,
    deleteSessionNote,
    clearSessionNotes,
    updateStudySession,
    deleteStudySession,
    updateDailyPerformance,
    updateStudyGoals,
    updateStreakGoal,
    getTasksForCourse,
    getNotesForCourse,
    // Playlists
    playlists,
    mergePlaylistSongs,
    updatePlaylist,
    deletePlaylist,
    reorderPlaylists,
    isCreatePlaylistOpen,
    setCreatePlaylistOpen,
    newPlaylistName,
    setNewPlaylistName,
    // Spaces
    spaces,
    addSpace,
    updateSpace,
    // Music
    songs,
    areSongsLoading,
    addSongs,
    deleteSong,
    toggleSongFavorite,
    currentSong,
    playSong,
    togglePlay,
    isPlaying,
    playNext,
    playPrevious,
    repeatMode,
    setRepeatMode,
    isShuffle,
    toggleShuffle,
    playingContext,
    playingContextHref,
    playbackHistory,
    selectionMode,
    storedSelectionMode,
    setSelectionMode,
    hasInteracted,
    isPlayerVisible,
    setPlayerVisible,
    // Mini temporizador flotante
    miniTimerView,
    setMiniTimerView,
    miniTimerSize,
    autoFinishPending,
    clearAutoFinish,
    finishRequested,
    requestFinish,
    clearFinishRequest,
    // Sidebar colapsable
    isSidebarCollapsed,
    toggleSidebarCollapsed,
  };
 
  return (
    <CourseContext.Provider value={value}>
      {children}
    </CourseContext.Provider>
  );
}

/** Segundos ya estudiados en la sesión en curso (0 si no hay ninguna). Se
 *  suscribe al segundero: úsalo solo donde de verdad se pinta ese número. */
export function useActiveSessionSeconds(): number {
  const { sessionStartTime, timerMode } = useCourse();
  const timerTime = useTimerTime();
  if (sessionStartTime <= 0) return 0;
  return Math.max(0, timerMode === 'focus' ? sessionStartTime - timerTime : timerTime);
}

export function useCourse() {
  const context = useContext(CourseContext);
  if (context === undefined) {
    throw new Error(tr('useCourse must be used within a CourseProvider'));
  }
  return context;
}
