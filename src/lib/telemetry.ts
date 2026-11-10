// ============================================================
// Telemetría de Frame → Supabase.
//
// Dos capas, las dos seudónimas y agregadas (nunca el contenido de nada):
//
//   · INSTANTÁNEA (telemetry_users / telemetry_weekly): totales acumulados
//     por usuario y su HISTORIAL SEMANAL (minutos, días activos, enfoque medio,
//     tareas culminadas, a tiempo e importantes, constancia de hábitos),
//     recalculado desde los datos locales. Es la base de las cifras de
//     impacto: «semana 1 frente a semana 2», retención, etc. Se sube como
//     mucho cada 6 h, a través de la función `telemetry_report`.
//   · PERFIL (1.6.9, telemetry-profile.ts): lugar aproximado (el del clima),
//     zona horaria, idioma, tipo de equipo, en qué horas estudia, rachas y
//     cuántos elementos tiene de cada función. Viaja con la instantánea.
//   · EVENTOS (telemetry_events): hechos con fecha —la app se abrió, se
//     registró una sesión de estudio, se terminó una tarea, se generó un
//     informe, falló una interfaz, se abrió una pantalla—. Son los que
//     permiten saber cuántos estudiantes usan Frame CADA DÍA y qué usan.
//
// Los eventos van a una cola en localStorage y se envían por lotes: sin
// conexión se guardan, con conexión se vacían. Nada de esto interrumpe la
// app: todo falla en silencio y se reintenta.
//
// Seguridad: las tablas tienen RLS de solo escritura para la app; solo la
// cuenta del responsable de Frame puede leerlas (política `is_frame_owner`),
// y lo hace desde el panel de uso de la propia app (interfaz «Uso»).
// ============================================================
import { getSupabase, isSupabaseConfigured } from '@/lib/supabase/client';
import type { ArchivedTask, Habit, StudySession } from '@/types';
// La versión sale de package.json en tiempo de compilación: escrita a mano
// se quedó reportando 1.0.0 durante toda la vida de la app.
import { APP_VERSION } from '@/lib/version';
import { loadWeatherPlace } from '@/lib/weather';
import { buildUsageProfile } from '@/lib/telemetry-profile';

const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 horas entre envíos

interface TelemetrySnapshot {
  userId: string;
  studySessions: StudySession[];
  archivedTasks: ArchivedTask[];
  totalTasksCompleted: number;
  totalSongs: number;
  totalCourses: number;
  totalPlaylists: number;
  totalHabits: number;
  /** Para la constancia semanal (un porcentaje: nunca los nombres). */
  habits?: Habit[];
  isGuest?: boolean;
}

/** País del usuario, tomado de la ubicación del clima de su perfil (Inicio). */
function countryFromWeatherCache(): string | null {
  const place = loadWeatherPlace();
  return typeof place?.country === 'string' && place.country ? place.country : null;
}

/** Fecha LOCAL (YYYY-MM-DD) de un timestamp ISO: evita que lo hecho en la
 *  noche (UTC del día siguiente) se cuente en la semana equivocada. */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Hoy en fecha local, YYYY-MM-DD. */
const todayLocal = () => localDateOf(new Date().toISOString());

/** Lunes de la semana de `date`, como YYYY-MM-DD (fecha local). */
function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // lunes = 0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const platformName = () => (/android/i.test(navigator.userAgent) ? 'android' : 'windows');

/** Línea base semanal de un contador acumulado: se fija la primera vez que
 *  se reporta cada semana y el valor semanal es la diferencia. Es inmune a
 *  purgas del archivo (no depende de recontar elementos). Limpia las claves
 *  de semanas anteriores para no acumular basura en localStorage. */
function weeklyDeltaFromBaseline(prefix: string, userId: string, weekStart: string, currentTotal: number): number {
  const baselineKey = `${prefix}_${userId}_${weekStart}`;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith(`${prefix}_${userId}_`) && key !== baselineKey) {
        localStorage.removeItem(key);
      }
    }
    let baseline = Number(localStorage.getItem(baselineKey));
    if (!localStorage.getItem(baselineKey) || Number.isNaN(baseline)) {
      baseline = currentTotal;
      localStorage.setItem(baselineKey, String(baseline));
    }
    return Math.max(0, currentTotal - baseline);
  } catch {
    return 0;
  }
}

const HISTORY_WEEKS = 16;

interface WeekRow {
  week_start: string;
  sessions: number;
  minutes: number;
  tasks: number;
  songs_added: number;
  active_days: number;
  focus_avg: number | null;
  tasks_high: number;
  tasks_on_time: number;
  tasks_with_due: number;
  habits_rate: number | null;
}

const dayStamp = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Las últimas semanas del estudiante, recalculadas desde sus datos locales. Al
 * salir de lo guardado en el equipo (y no de lo que se fue enviando), el
 * historial llega completo aunque la app haya estado días sin conexión o el
 * estudiante usara Frame desde antes de existir esta medición.
 */
function buildWeeks(snapshot: TelemetrySnapshot, currentWeek: string, weekTasksFloor: number, weekSongs: number): WeekRow[] {
  const now = new Date();
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - HISTORY_WEEKS * 7);
  const oldestWeek = mondayOf(oldest);

  const rows = new Map<string, WeekRow & { days: Set<string>; focusSum: number; focusN: number }>();
  const rowOf = (week: string) => {
    let row = rows.get(week);
    if (!row) {
      row = {
        week_start: week, sessions: 0, minutes: 0, tasks: 0, songs_added: 0, active_days: 0, focus_avg: null,
        tasks_high: 0, tasks_on_time: 0, tasks_with_due: 0, habits_rate: null,
        days: new Set<string>(), focusSum: 0, focusN: 0,
      };
      rows.set(week, row);
    }
    return row;
  };

  for (const session of snapshot.studySessions ?? []) {
    const start = new Date(session.startTime ?? '');
    if (Number.isNaN(start.getTime())) continue;
    const week = mondayOf(start);
    if (week < oldestWeek) continue;
    const row = rowOf(week);
    row.sessions += 1;
    row.minutes += session.duration || 0;
    row.days.add(localDateOf(session.startTime));
    if (session.mode !== 'tiempo' && (session.perception ?? 0) > 0) {
      row.focusSum += session.perception;
      row.focusN += 1;
    }
  }

  for (const task of snapshot.archivedTasks ?? []) {
    const done = new Date(task.archivedAt ?? '');
    if (Number.isNaN(done.getTime())) continue;
    const week = mondayOf(done);
    if (week < oldestWeek) continue;
    const row = rowOf(week);
    row.tasks += 1;
    if (task.priority === 'Alta') row.tasks_high += 1;
    const due = task.dueDate ? new Date(task.dueDate) : null;
    if (due && !Number.isNaN(due.getTime())) {
      row.tasks_with_due += 1;
      // Por día natural: culminar el mismo día del plazo es llegar a tiempo.
      if (dayStamp(done) <= dayStamp(due)) row.tasks_on_time += 1;
    }
  }

  // Constancia de hábitos por semana: marcas hechas / marcas posibles.
  const habits = (snapshot.habits ?? []).filter((habit) => !habit.isArchived);
  if (habits.length > 0) {
    const today = dayStamp(now);
    for (let back = 0; back < HISTORY_WEEKS; back++) {
      const monday = new Date(now);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) - back * 7);
      let possible = 0;
      let done = 0;
      for (let offset = 0; offset < 7; offset++) {
        const day = new Date(monday);
        day.setDate(day.getDate() + offset);
        if (dayStamp(day) > today) break;
        const key = localDateOf(day.toISOString());
        for (const habit of habits) {
          const since = habit.createdAt ? new Date(habit.createdAt) : null;
          if (since && !Number.isNaN(since.getTime()) && dayStamp(day) < dayStamp(since)) continue;
          possible += 1;
          if ((habit.completedOn ?? []).includes(key)) done += 1;
        }
      }
      if (possible > 0) {
        const week = mondayOf(monday);
        // Solo se informa de semanas con alguna actividad o alguna marca.
        if (done > 0 || rows.has(week)) rowOf(week).habits_rate = Math.round((done / possible) * 100);
      }
    }
  }

  const current = rowOf(currentWeek);
  // El archivo se puede purgar: el contador acumulado es el suelo de la semana.
  current.tasks = Math.max(current.tasks, weekTasksFloor);
  current.songs_added = weekSongs;

  return [...rows.values()]
    .sort((a, b) => a.week_start.localeCompare(b.week_start))
    .map(({ days, focusSum, focusN, ...row }) => ({
      ...row,
      minutes: Math.round(row.minutes),
      active_days: days.size,
      focus_avg: focusN > 0 ? Math.round((focusSum / focusN) * 10) / 10 : null,
    }));
}

const HISTORY_DAYS = 140;

interface DayRow {
  /** Día local, YYYY-MM-DD. */
  d: string;
  /** minutos · sesiones · enfoque medio */
  m: number;
  s: number;
  f: number | null;
  /** tareas culminadas · de prioridad alta · a tiempo · con plazo */
  t: number;
  th: number;
  to: number;
  td: number;
  /** hábitos marcados · hábitos posibles ese día */
  hd: number;
  hp: number;
}

/**
 * La serie DIARIA del estudiante (solo los días en que hizo algo). Con ella el
 * análisis de impacto mide «la segunda semana frente a la primera» desde el
 * primer día real de cada estudiante, y no por semanas del calendario: quien
 * empieza un jueves tendría una «semana 1» de tres días y cualquier
 * comparación saldría inflada.
 */
function buildDays(snapshot: TelemetrySnapshot): DayRow[] {
  const now = new Date();
  const oldest = new Date(now);
  oldest.setDate(oldest.getDate() - HISTORY_DAYS);
  const oldestKey = localDateOf(oldest.toISOString());

  const rows = new Map<string, DayRow & { focusSum: number; focusN: number }>();
  const rowOf = (day: string) => {
    let row = rows.get(day);
    if (!row) {
      row = { d: day, m: 0, s: 0, f: null, t: 0, th: 0, to: 0, td: 0, hd: 0, hp: 0, focusSum: 0, focusN: 0 };
      rows.set(day, row);
    }
    return row;
  };

  for (const session of snapshot.studySessions ?? []) {
    const day = localDateOf(session.startTime ?? '');
    if (!day || day < oldestKey) continue;
    const row = rowOf(day);
    row.s += 1;
    row.m += session.duration || 0;
    if (session.mode !== 'tiempo' && (session.perception ?? 0) > 0) {
      row.focusSum += session.perception;
      row.focusN += 1;
    }
  }

  for (const task of snapshot.archivedTasks ?? []) {
    const done = new Date(task.archivedAt ?? '');
    if (Number.isNaN(done.getTime())) continue;
    const day = localDateOf(task.archivedAt);
    if (!day || day < oldestKey) continue;
    const row = rowOf(day);
    row.t += 1;
    if (task.priority === 'Alta') row.th += 1;
    const due = task.dueDate ? new Date(task.dueDate) : null;
    if (due && !Number.isNaN(due.getTime())) {
      row.td += 1;
      if (dayStamp(done) <= dayStamp(due)) row.to += 1;
    }
  }

  // Hábitos: solo se anotan en los días que ya tienen fila o alguna marca, para
  // no enviar ciento cuarenta filas vacías de quien solo tiene hábitos creados.
  const habits = (snapshot.habits ?? []).filter((habit) => !habit.isArchived);
  if (habits.length > 0) {
    const marked = new Set<string>();
    for (const habit of habits) for (const day of habit.completedOn ?? []) if (day >= oldestKey) marked.add(day);
    for (const day of new Set([...rows.keys(), ...marked])) {
      const stamp = dayStamp(new Date(`${day}T12:00:00`));
      let possible = 0;
      let done = 0;
      for (const habit of habits) {
        const since = habit.createdAt ? new Date(habit.createdAt) : null;
        if (since && !Number.isNaN(since.getTime()) && stamp < dayStamp(since)) continue;
        possible += 1;
        if ((habit.completedOn ?? []).includes(day)) done += 1;
      }
      if (possible === 0) continue;
      const row = rowOf(day);
      row.hd = done;
      row.hp = possible;
    }
  }

  return [...rows.values()]
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(-180)
    .map(({ focusSum, focusN, ...row }) => ({
      ...row,
      m: Math.round(row.m),
      f: focusN > 0 ? Math.round((focusSum / focusN) * 10) / 10 : null,
    }));
}

/**
 * ¿Toca ya el informe? Se mira ANTES de armar la instantánea: armarla lee y
 * recorre todas las sesiones y tareas, y casi siempre no tocaba (1.7.0).
 */
export function telemetryDue(uid: string): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(`telemetryLastSync_${uid}`) ?? '0') >= SYNC_INTERVAL_MS;
  } catch {
    return false;
  }
}

/**
 * Sincroniza la instantánea del usuario. Devuelve true si el envío ocurrió.
 * Con `force` se salta el acelerador (útil justo tras el registro).
 */
export async function syncTelemetry(
  snapshot: TelemetrySnapshot,
  opts: { force?: boolean } = {}
): Promise<boolean> {
  try {
    if (!isSupabaseConfigured || !navigator.onLine) return false;
    const supabase = getSupabase();
    if (!supabase) return false;

    const throttleKey = `telemetryLastSync_${snapshot.userId}`;
    const last = Number(localStorage.getItem(throttleKey) ?? '0');
    if (!opts.force && Date.now() - last < SYNC_INTERVAL_MS) return false;

    const sessions = snapshot.studySessions ?? [];
    // Las sesiones guardan segundos exactos y `duration` son minutos con
    // decimales: las columnas de telemetría son enteras.
    const totalMinutes = Math.round(sessions.reduce((acc, s) => acc + (s.duration || 0), 0));

    // --- Semana actual (lunes → hoy), comparando en fecha LOCAL ---
    const weekStart = mondayOf(new Date());

    // Tareas y canciones de la semana por LÍNEA BASE de los contadores
    // acumulados: inmune a purgas del archivo y sin claves huérfanas.
    const weekTasks = weeklyDeltaFromBaseline(
      'telemetryTasksBaseline', snapshot.userId, weekStart, snapshot.totalTasksCompleted
    );
    const weekSongsAdded = weeklyDeltaFromBaseline(
      'telemetrySongsBaseline', snapshot.userId, weekStart, snapshot.totalSongs
    );

    // Una sola llamada a la función del servidor. El upsert directo que había
    // aquí NUNCA llegó a guardar nada: con RLS, «INSERT … ON CONFLICT DO
    // UPDATE» exige además permiso de lectura, que solo tiene el responsable,
    // y el fallo se tragaba en silencio.
    const { error } = await supabase.rpc('telemetry_report', {
      p: {
        user_id: snapshot.userId,
        app_version: APP_VERSION,
        platform: platformName(),
        country: countryFromWeatherCache(),
        is_guest: snapshot.isGuest === true,
        totals: {
          minutes: totalMinutes,
          sessions: sessions.length,
          tasks: snapshot.totalTasksCompleted,
          songs: snapshot.totalSongs,
          courses: snapshot.totalCourses,
          playlists: snapshot.totalPlaylists,
          habits: snapshot.totalHabits,
        },
        weeks: buildWeeks(snapshot, weekStart, weekTasks, weekSongsAdded),
        days: buildDays(snapshot),
        // Lugar aproximado, cuándo estudia y cuánto usa cada función (1.6.9).
        profile: buildUsageProfile(snapshot.userId, sessions),
      },
    });
    if (error) return false;

    localStorage.setItem(throttleKey, String(Date.now()));
    return true;
  } catch {
    // La telemetría jamás interrumpe la app.
    return false;
  }
}

// ============================================================
// Eventos
// ============================================================

type TelemetryEventName =
  | 'app_open'
  | 'screen_view'
  | 'study_session_end'
  | 'task_completed'
  | 'task_incomplete'
  | 'task_created'
  | 'habit_checked'
  | 'report_generated'
  | 'account_signed_in'
  // Invitados: entrar sin cuenta y, después, vincular Google.
  | 'guest_started'
  | 'guest_linked'
  // Preguntas a la ayuda: qué respuesta se dio (o ninguna), nunca el texto.
  // Hasta la 1.6.6; la ayuda se quitó en la 1.6.7 y ya no se envía.
  | 'help_asked'
  // Recorrido «Descubrir» de una respuesta (hasta la 1.6.4; ya no se envía).
  | 'help_tour'
  // 1.9.2: archivos descargados (`n`: cuántos; el panel los cuenta por archivo).
  | 'library_download'
  | 'song_download'
  | 'error';

interface QueuedEvent {
  user_id: string;
  event: TelemetryEventName;
  props: Record<string, unknown>;
  app_version: string;
  platform: string;
  created_at: string;
}

/** Tope de la cola: más de esto y algo va mal; se descarta lo más viejo. */
const QUEUE_LIMIT = 300;
/** Eventos por lote. */
const BATCH_SIZE = 50;
/** Espacio mínimo entre vaciados de la cola. */
const FLUSH_GAP_MS = 15_000;
/** Errores reportados como mucho por arranque: un bucle de fallos no debe
 *  convertirse en un bucle de envíos. */
const ERROR_BUDGET = 8;

const queueKey = (uid: string) => `telemetryQueue_${uid}`;

let flushTimer: number | null = null;
let lastFlushAt = 0;
/** Fallos seguidos al enviar: la espera crece (15 s, 30 s, 1 min… hasta 30 min). */
let flushFailures = 0;
let flushing = false;
let errorsSent = 0;

/** Id del perfil activo (invitado o cuenta), o null si no hay nadie. */
function currentUserId(): string | null {
  try {
    const raw = localStorage.getItem('userProfile');
    if (!raw) return null;
    const id = JSON.parse(raw)?.id;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}

function readQueue(uid: string): QueuedEvent[] {
  try {
    const raw = localStorage.getItem(queueKey(uid));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeQueue(uid: string, list: QueuedEvent[]) {
  try {
    if (list.length === 0) localStorage.removeItem(queueKey(uid));
    else localStorage.setItem(queueKey(uid), JSON.stringify(list.slice(-QUEUE_LIMIT)));
  } catch {
    /* sin espacio: se pierde telemetría, nunca la app */
  }
}

/** Recorta los props a valores planos y cortos: nada de objetos anidados ni
 *  textos largos (ahí podría colarse contenido del usuario). */
function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    // La pila de un error solo lleva «función (archivo:línea:col)» (ver
    // error-report.ts): necesita más sitio y no puede contener datos.
    else if (typeof value === 'string') out[key] = value.slice(0, key === 'stack' ? 1400 : 240);
  }
  return out;
}

/**
 * Registra un evento de uso. Se puede llamar desde cualquier sitio: si no hay
 * perfil o no hay Supabase, no hace nada. Nunca lanza.
 */
export function trackEvent(event: TelemetryEventName, props: Record<string, unknown> = {}): void {
  try {
    if (!isSupabaseConfigured) return;
    const uid = currentUserId();
    if (!uid) return;

    if (event === 'error') {
      if (errorsSent >= ERROR_BUDGET) return;
      errorsSent += 1;
    }

    const queue = readQueue(uid);
    queue.push({
      user_id: uid,
      event,
      props: sanitizeProps(props),
      app_version: APP_VERSION,
      platform: platformName(),
      created_at: new Date().toISOString(),
    });
    writeQueue(uid, queue);
    scheduleFlush();
  } catch {
    /* la telemetría jamás interrumpe la app */
  }
}

/**
 * Eventos que solo tienen sentido UNA vez al día por usuario (abrir la app,
 * abrir una pantalla): sin esto, cada montaje del componente contaría.
 */
export function trackDaily(event: TelemetryEventName, dedupeKey: string, props: Record<string, unknown> = {}) {
  try {
    const uid = currentUserId();
    if (!uid) return;
    const stamp = `telemetryDaily_${uid}_${event}_${dedupeKey}`;
    const today = todayLocal();
    if (localStorage.getItem(stamp) === today) return;
    localStorage.setItem(stamp, today);
    trackEvent(event, props);
  } catch {
    /* nada */
  }
}

/** Limpia las marcas diarias de días anteriores (se llama al arrancar). */
export function pruneTelemetryStamps() {
  try {
    const today = todayLocal();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('telemetryDaily_') && localStorage.getItem(key) !== today) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    /* nada */
  }
}

function scheduleFlush() {
  if (flushTimer !== null) return;
  // Con fallos seguidos (base en solo lectura, sin red real…) no se insiste
  // cada 15 s desde miles de equipos a la vez: se espera cada vez más.
  const wait =
    flushFailures > 0
      ? Math.min(30 * 60_000, FLUSH_GAP_MS * 2 ** (flushFailures - 1)) * (0.75 + Math.random() * 0.5)
      : Math.max(1_000, FLUSH_GAP_MS - (Date.now() - lastFlushAt));
  flushTimer = window.setTimeout(() => {
    flushTimer = null;
    void flushEvents();
  }, wait);
}

/** Envía la cola por lotes. Devuelve cuántos eventos salieron. */
export async function flushEvents(): Promise<number> {
  if (flushing) return 0;
  const uid = currentUserId();
  if (!uid || !isSupabaseConfigured || !navigator.onLine) return 0;
  const supabase = getSupabase();
  if (!supabase) return 0;

  flushing = true;
  let sent = 0;
  try {
    let queue = readQueue(uid);
    while (queue.length > 0) {
      const batch = queue.slice(0, BATCH_SIZE);
      const { error, status } = await supabase.from('telemetry_events').insert(batch);
      if (error) {
        // Un lote que el servidor rechaza por su contenido no se arregla
        // reintentando: se descarta para no bloquear la cola para siempre.
        if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
          queue = queue.slice(batch.length);
          writeQueue(uid, queue);
          continue;
        }
        flushFailures += 1;
        break;
      }
      flushFailures = 0;
      sent += batch.length;
      queue = queue.slice(batch.length);
      writeQueue(uid, queue);
    }
    lastFlushAt = Date.now();
    // Quedó algo (fallo a mitad): se reintenta más tarde.
    if (queue.length > 0) scheduleFlush();
  } catch {
    flushFailures += 1;
    scheduleFlush();
  } finally {
    flushing = false;
  }
  return sent;
}

/** Al recuperar la conexión se vacía lo acumulado. Idempotente. */
let onlineHooked = false;
export function hookTelemetryFlushOnOnline() {
  if (onlineHooked) return;
  onlineHooked = true;
  window.addEventListener('online', () => {
    void flushEvents();
  });
}
