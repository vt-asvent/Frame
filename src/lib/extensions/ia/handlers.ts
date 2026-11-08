// ============================================================
// Conexiones con IA (1.7.3): lo que hace cada herramienta del MCP.
//
// Usa SOLO las funciones del contexto que ya usa la interfaz: lo que crea o
// cambia una IA se guarda, se sincroniza y se deshace igual que si lo hubiera
// hecho el usuario. Lo que borra pide antes confirmación en pantalla.
// Las respuestas son para el modelo: JSON compacto, en español.
// ============================================================

import { addDays, format } from 'date-fns';
import type { useCourse } from '@/context/CourseContext';
import type { Course, Habit, HabitPhase, LocalCalendarEvent, LocalEventKind, Note, Song, StudySession, Task, TaskDifficulty, TaskKind, TaskPriority } from '@/types';
import { localDayKey, parseIsoSafe } from '@/lib/dates';
import { isScheduled } from '@/lib/habit-schedule';
import { isSessionEditable } from '@/lib/session-edit';
import { DEFAULT_EVENT_COLOR, EVENT_KIND_META, getEventsForDay, kindLabelOf } from '@/lib/calendar-events';
import { richNoteToPlain } from '@/lib/rich-note';
import { songMatches } from '@/lib/music-search';
import { listeningBetween, periodRange } from '@/lib/listening';
import { buildPerformanceDoc, buildReport, rangeLabel, reportRange, type ReportScope } from '@/lib/performance-report';
import { buildPendingReport, pendingReportFileBase } from '@/lib/pending-report';
import { renderDocMarkdown } from '@/lib/report-doc';
import { exportReport } from '@/lib/report-export';
import { usernameLabel } from '@/lib/enum-labels';
import { tr } from '@/lib/i18n';

export type IaCtx = ReturnType<typeof useCourse>;

export interface IaEnv {
  /** El contexto MÁS RECIENTE: cambia tras cada render. */
  ctx: () => IaCtx;
  /** Espera a que React aplique lo último que se cambió. */
  settle: () => Promise<void>;
  /** Pide confirmación en pantalla; true si el usuario acepta. */
  confirm: (what: string) => Promise<boolean>;
  /** Aviso discreto en Frame de un cambio hecho por la IA. */
  notice: (what: string) => void;
}

export class IaError extends Error {}

function fail(message: string): never {
  throw new IaError(message);
}

type Args = Record<string, unknown>;

const json = (value: unknown) => JSON.stringify(value);
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function str(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') fail(`«${key}» debe ser texto.`);
  return value;
}

function required(args: Args, key: string): string {
  const value = str(args, key)?.trim();
  if (!value) fail(`Falta «${key}».`);
  return value;
}

function num(args: Args, key: string, min: number, max: number): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`«${key}» debe ser un número.`);
  return Math.min(max, Math.max(min, Math.round(value)));
}

function flag(args: Args, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') fail(`«${key}» debe ser true o false.`);
  return value;
}

function choice<T extends string>(args: Args, key: string, values: readonly T[]): T | undefined {
  const value = str(args, key);
  if (value === undefined) return undefined;
  const found = values.find((v) => fold(v) === fold(value));
  if (!found) fail(`«${key}» debe ser uno de: ${values.join(', ')}.`);
  return found;
}

function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function dayArg(args: Args, key: string): string | undefined {
  const value = str(args, key)?.trim();
  if (!value) return undefined;
  if (!isDay(value)) fail(`«${key}» debe ser una fecha AAAA-MM-DD válida.`);
  return value;
}

const dateOfDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Fecha límite: '' la quita; AAAA-MM-DD es ese día; con THH:mm, a esa hora. */
function dueArg(args: Args, key: string): string | null | undefined {
  const value = str(args, key)?.trim();
  if (value === undefined) return undefined;
  if (value === '') return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(value);
  if (!match || !isDay(match[1])) fail(`«${key}» debe ser AAAA-MM-DD o AAAA-MM-DDTHH:mm.`);
  const date = dateOfDay(match[1]);
  if (match[2]) {
    const h = Number(match[2]);
    const mi = Number(match[3]);
    if (h > 23 || mi > 59) fail(`«${key}»: hora no válida.`);
    date.setHours(h, mi);
  }
  return date.toISOString();
}

function timeArg(args: Args, key: string): string | null | undefined {
  const value = str(args, key)?.trim();
  if (value === undefined) return undefined;
  if (value === '') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) fail(`«${key}» debe ser HH:mm.`);
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

/** Vence: «AAAA-MM-DD» o, si tiene hora, «AAAA-MM-DD HH:mm». */
function dueText(iso: string | null | undefined): string | undefined {
  const date = parseIsoSafe(iso);
  if (!date) return undefined;
  return date.getHours() === 0 && date.getMinutes() === 0 ? localDayKey(date) : format(date, 'yyyy-MM-dd HH:mm');
}

const withoutEmpty = (value: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null && v !== ''));

// ------------------------------------------------------------
// Búsquedas por id o por nombre
// ------------------------------------------------------------

function findCourse(courses: Course[], ref: string): Course {
  const byId = courses.find((c) => c.id === ref);
  if (byId) return byId;
  const wanted = fold(ref);
  const exact = courses.filter((c) => fold(c.name) === wanted);
  if (exact.length === 1) return exact[0];
  const partial = courses.filter((c) => fold(c.name).includes(wanted));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) fail(`Varias asignaturas coinciden con «${ref}»: ${partial.map((c) => c.name).join(', ')}.`);
  fail(`No hay ninguna asignatura «${ref}». Hay: ${courses.map((c) => c.name).join(', ') || 'ninguna'}.`);
}

function byId<T extends { id: string }>(list: T[], id: string, what: string): T {
  const found = list.find((item) => item.id === id);
  if (!found) fail(`No hay ${what} con id «${id}». Usa el listado para ver los id.`);
  return found;
}

// ------------------------------------------------------------
// Vistas
// ------------------------------------------------------------

const taskView = (t: Task & { archivedAt?: string }) =>
  withoutEmpty({
    id: t.id,
    nombre: t.name,
    asignatura: t.courseName || undefined,
    vence: dueText(t.dueDate),
    prioridad: t.priority,
    tipo: t.kind ?? 'Tarea',
    dificultad: t.difficulty,
    progreso: t.progress,
    minutos_estimados: t.estimatedMinutes || undefined,
    descripcion: t.description ? clip(t.description.trim(), 300) : undefined,
    archivada: t.archivedAt ? format(new Date(t.archivedAt), 'yyyy-MM-dd HH:mm') : undefined,
  });

const PHASE_NAME: Record<HabitPhase, string> = { morning: 'mañana', afternoon: 'tarde', night: 'noche' };
const PHASE_OF: Record<string, HabitPhase | undefined> = { mañana: 'morning', tarde: 'afternoon', noche: 'night', 'todo el día': undefined };

function habitView(h: Habit, now: Date) {
  const today = localDayKey(now);
  const week = Array.from({ length: 7 }, (_, i) => localDayKey(addDays(now, -i)));
  return withoutEmpty({
    id: h.id,
    nombre: h.name,
    momento: h.phase ? PHASE_NAME[h.phase] : 'todo el día',
    dias: h.days && h.days.length > 0 && h.days.length < 7 ? h.days.map((d) => WEEKDAYS[d]) : 'cada día',
    toca_hoy: isScheduled(h, now),
    hecho_hoy: h.completedOn.includes(today),
    hecho_ultimos_7_dias: week.filter((d) => h.completedOn.includes(d)),
    archivado: h.isArchived || undefined,
  });
}

const eventView = (e: LocalCalendarEvent) =>
  withoutEmpty({
    id: e.id,
    titulo: e.title,
    fecha: e.date,
    fecha_fin: e.endDate,
    hora: e.time,
    tipo: kindLabelOf(e),
    descripcion: e.description ? clip(e.description, 300) : undefined,
  });

const sessionMinutes = (s: StudySession) => (s.durationSec ?? s.duration * 60) / 60;

function sessionView(s: StudySession) {
  const start = parseIsoSafe(s.startTime);
  const end = parseIsoSafe(s.endTime);
  return withoutEmpty({
    id: s.id,
    fecha: start ? localDayKey(start) : undefined,
    inicio: start ? format(start, 'HH:mm') : undefined,
    fin: end ? format(end, 'HH:mm') : undefined,
    minutos: Math.round(sessionMinutes(s)),
    tipo: s.sessionType,
    asignaturas: s.subjects?.length ? s.subjects : undefined,
    percepcion: s.perception,
    notas: s.notes ? clip(richNoteToPlain(s.notes), 400) : undefined,
    editable: isSessionEditable(s),
  });
}

const noteView = (n: Note) =>
  withoutEmpty({
    id: n.id,
    tipo: n.kind === 'url' ? 'enlace' : n.kind === 'file' ? 'archivo' : 'anotación',
    texto: n.content ? clip(richNoteToPlain(n.content), 500) : undefined,
    enlace: n.url,
    archivo: n.fileName,
    creado: n.createdAt ? localDayKey(n.createdAt) : undefined,
  });

const songView = (s: Song) =>
  withoutEmpty({
    id: s.id,
    titulo: s.title,
    artista: s.artist,
    album: s.album,
    favorita: s.isFavorite || undefined,
    duracion: s.duration ? `${Math.floor(s.duration / 60)}:${String(Math.round(s.duration % 60)).padStart(2, '0')}` : undefined,
  });

const pendingSort = (a: Task, b: Task) => {
  const da = parseIsoSafe(a.dueDate)?.getTime() ?? Infinity;
  const db = parseIsoSafe(b.dueDate)?.getTime() ?? Infinity;
  return da - db || (a.order ?? 0) - (b.order ?? 0);
};

const inDayRange = (iso: string | null | undefined, from?: string, to?: string) => {
  if (!from && !to) return true;
  const day = iso ? localDayKey(iso) : '';
  if (!day) return false;
  return (!from || day >= from) && (!to || day <= to);
};

// ------------------------------------------------------------
// Música: sonar sin que nadie haya tocado la ventana
// ------------------------------------------------------------

/** Windows no deja sonar una ventana que nadie ha tocado desde que se abrió. */
const canSound = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;

const WAIT_TOUCH = 'Quedó puesta en Frame, pero sonará cuando el usuario toque Frame una vez: Windows no deja sonar una ventana recién abierta que nadie ha tocado.';

function playQueue(env: IaEnv, song: Song, queue: Song[], context: string, href?: string): string {
  env.ctx().playSong(song, { context, queue, href });
  return canSound() ? `Sonando: ${song.title}${song.artist ? ` — ${song.artist}` : ''}.` : `${song.title}: ${WAIT_TOUCH}`;
}

function bestSong(songs: Song[], query: string): Song | undefined {
  const matches = songs.filter((s) => songMatches(s, query));
  const wanted = fold(query);
  return matches.find((s) => fold(s.title) === wanted) ?? matches.find((s) => fold(`${s.title} ${s.artist}`).includes(wanted)) ?? matches[0];
}

// ------------------------------------------------------------
// Informes
// ------------------------------------------------------------

function reportDoc(ctx: IaCtx, args: Args) {
  const kind = choice(args, 'tipo', ['rendimiento', 'pendientes'] as const) ?? fail('Falta «tipo».');
  const scope = (choice(args, 'periodo', ['semana', 'mes', 'anio'] as const) ?? 'mes') as ReportScope;
  const day = dayArg(args, 'fecha');
  const reference = day ? dateOfDay(day) : new Date();
  const studentName = ctx.userProfile?.username ? usernameLabel(ctx.userProfile.username) : tr('Estudiante');
  const { start, end } = reportRange(scope, reference);
  const label = rangeLabel(scope, start, end);
  const doc =
    kind === 'rendimiento'
      ? buildPerformanceDoc(
          buildReport({
            scope,
            reference,
            studentName,
            sessions: ctx.studySessions ?? [],
            tasks: ctx.tasks ?? [],
            archivedTasks: ctx.archivedTasks ?? [],
            courses: ctx.courses ?? [],
            spaces: ctx.spaces ?? [],
            performances: ctx.dailyPerformances ?? [],
            studyGoals: ctx.studyGoals,
          })
        )
      : buildPendingReport({ studentName, tasks: ctx.tasks ?? [], courses: ctx.courses ?? [], spaces: ctx.spaces ?? [], range: { start, end, label } });
  const stamp = scope === 'anio' ? format(start, 'yyyy') : scope === 'mes' ? format(start, 'yyyy-MM') : format(start, "RRRR-'S'II");
  const fileBase = kind === 'rendimiento' ? tr('Frame-Rendimiento-{p}', { p: `${scope}-${stamp}` }) : pendingReportFileBase(new Date(), `${scope}-${stamp}`);
  return { doc, fileBase, label };
}

// ------------------------------------------------------------
// Las herramientas
// ------------------------------------------------------------

type Handler = (args: Args, env: IaEnv) => Promise<string> | string;

const TASK_PRIORITIES: readonly TaskPriority[] = ['Baja', 'Media', 'Alta'];
const TASK_KINDS: readonly TaskKind[] = ['Tarea', 'Examen', 'Proyecto', 'Actividad', 'Personal'];
const TASK_DIFFICULTIES: readonly TaskDifficulty[] = ['Fácil', 'Media', 'Difícil'];
const EVENT_KINDS = Object.keys(EVENT_KIND_META) as LocalEventKind[];

function colorArg(args: Args): string | undefined {
  const color = str(args, 'color')?.trim();
  if (!color) return undefined;
  if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)) fail('«color» debe ser #RRGGBB o #RRGGBBAA.');
  return color.toUpperCase();
}

function daysArg(args: Args): number[] | null | undefined {
  const value = args.dias;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) fail('«dias» debe ser una lista de números del 0 (domingo) al 6 (sábado).');
  const days = [...new Set(value as number[])].sort();
  return days.length === 0 || days.length === 7 ? null : days;
}

function linkArg(args: Args): string | undefined {
  const link = str(args, 'enlace')?.trim();
  if (!link) return undefined;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    fail('«enlace» no es una URL válida.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail('«enlace» debe empezar por http:// o https://.');
  return url.toString();
}

const HANDLERS: Record<string, Handler> = {
  resumen_de_hoy: (_args, env) => {
    const ctx = env.ctx();
    const now = new Date();
    const today = localDayKey(now);
    const week = localDayKey(addDays(now, 7));
    const pending = [...ctx.tasks].sort(pendingSort);
    const dueDay = (t: Task) => (t.dueDate ? localDayKey(t.dueDate) : '');
    const studied = ctx.studySessions.filter((s) => localDayKey(s.startTime) === today).reduce((sum, s) => sum + sessionMinutes(s), 0);
    return json(
      withoutEmpty({
        ahora: `${WEEKDAYS[now.getDay()]} ${format(now, 'yyyy-MM-dd HH:mm')}`,
        usuario: ctx.userProfile?.username ? usernameLabel(ctx.userProfile.username) : undefined,
        vencidas: pending.filter((t) => dueDay(t) && dueDay(t) < today).map(taskView),
        vencen_hoy: pending.filter((t) => dueDay(t) === today).map(taskView),
        proximos_7_dias: pending.filter((t) => dueDay(t) > today && dueDay(t) <= week).map(taskView),
        sin_fecha: pending.filter((t) => !t.dueDate).length,
        eventos_de_hoy: getEventsForDay(ctx.localEvents, today).map(eventView),
        habitos_de_hoy: ctx.habits.filter((h) => !h.isArchived && isScheduled(h, now)).map((h) => ({ id: h.id, nombre: h.name, hecho: h.completedOn.includes(today) })),
        minutos_estudiados_hoy: Math.round(studied),
        sesion_en_curso: ctx.isTimerActive,
        musica: ctx.currentSong ? { titulo: ctx.currentSong.title, artista: ctx.currentSong.artist, sonando: ctx.isPlaying } : undefined,
      })
    );
  },

  // --- Tareas ---
  listar_tareas: (args, env) => {
    const ctx = env.ctx();
    const estado = choice(args, 'estado', ['pendientes', 'culminadas', 'incompletas'] as const) ?? 'pendientes';
    const courseRef = str(args, 'asignatura')?.trim();
    const course = courseRef ? findCourse(ctx.courses, courseRef) : null;
    const query = str(args, 'buscar')?.trim();
    const from = dayArg(args, 'desde');
    const to = dayArg(args, 'hasta');
    const limit = num(args, 'limite', 1, 200) ?? 50;
    let list: (Task & { archivedAt?: string })[] =
      estado === 'pendientes'
        ? [...ctx.tasks].sort(pendingSort)
        : [...(estado === 'culminadas' ? ctx.archivedTasks : ctx.incompleteTasks)].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
    if (course) list = list.filter((t) => t.courseId === course.id);
    if (query) list = list.filter((t) => fold(`${t.name} ${t.description ?? ''}`).includes(fold(query)));
    list = list.filter((t) => inDayRange(t.dueDate, from, to));
    return json({ total: list.length, tareas: list.slice(0, limit).map(taskView) });
  },

  crear_tarea: (args, env) => {
    const ctx = env.ctx();
    if (!ctx.userProfile) fail('No hay ninguna sesión abierta en Frame.');
    const name = required(args, 'nombre');
    const courseRef = str(args, 'asignatura')?.trim();
    const course = courseRef ? findCourse(ctx.courses, courseRef) : null;
    const minutes = num(args, 'minutos_estimados', 0, 6000);
    const id = crypto.randomUUID();
    ctx.addTask({
      id,
      name: clip(name, 300),
      description: str(args, 'descripcion')?.trim() ?? '',
      dueDate: dueArg(args, 'fecha_limite') ?? null,
      priority: choice(args, 'prioridad', TASK_PRIORITIES) ?? 'Media',
      kind: choice(args, 'tipo', TASK_KINDS) ?? 'Tarea',
      difficulty: choice(args, 'dificultad', TASK_DIFFICULTIES) ?? 'Media',
      progress: 0,
      order: -Date.now(),
      courseId: course?.id ?? '',
      courseName: course?.name ?? '',
      uid: ctx.userProfile.id,
      ...(minutes ? { estimatedMinutes: minutes } : {}),
    });
    env.notice(tr('creó la tarea «{name}»', { name }));
    return json({ creada: true, id, asignatura: course?.name ?? 'sin asignatura (Inicio)' });
  },

  editar_tarea: (args, env) => {
    const ctx = env.ctx();
    const task = byId(ctx.tasks, required(args, 'id'), 'ninguna tarea pendiente');
    const updates: Partial<Task> = {};
    const name = str(args, 'nombre')?.trim();
    if (name) updates.name = clip(name, 300);
    const description = str(args, 'descripcion');
    if (description !== undefined) updates.description = description.trim();
    const due = dueArg(args, 'fecha_limite');
    if (due !== undefined) updates.dueDate = due;
    const priority = choice(args, 'prioridad', TASK_PRIORITIES);
    if (priority) updates.priority = priority;
    const kind = choice(args, 'tipo', TASK_KINDS);
    if (kind) updates.kind = kind;
    const difficulty = choice(args, 'dificultad', TASK_DIFFICULTIES);
    if (difficulty) updates.difficulty = difficulty;
    const progress = num(args, 'progreso', 0, 100);
    if (progress !== undefined) updates.progress = progress;
    const minutes = num(args, 'minutos_estimados', 0, 6000);
    if (minutes !== undefined) updates.estimatedMinutes = minutes > 0 ? minutes : undefined;
    const courseRef = str(args, 'asignatura');
    if (courseRef !== undefined) {
      const course = courseRef.trim() ? findCourse(ctx.courses, courseRef.trim()) : null;
      updates.courseId = course?.id ?? '';
      updates.courseName = course?.name ?? '';
    }
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    ctx.updateTask(task.id, updates);
    env.notice(tr('editó la tarea «{name}»', { name: updates.name ?? task.name }));
    return json({ editada: true, tarea: taskView({ ...task, ...updates }) });
  },

  culminar_tarea: (args, env) => {
    const ctx = env.ctx();
    const task = byId(ctx.tasks, required(args, 'id'), 'ninguna tarea pendiente');
    ctx.deleteTask(task.id);
    env.notice(tr('culminó la tarea «{name}»', { name: task.name }));
    return 'Culminada: quedó en el archivo de su asignatura (Ctrl+Z en Frame la devuelve durante unos segundos).';
  },

  marcar_tarea_incompleta: (args, env) => {
    const ctx = env.ctx();
    const task = byId(ctx.tasks, required(args, 'id'), 'ninguna tarea pendiente');
    ctx.markTaskIncomplete(task.id);
    env.notice(tr('marcó como incompleta «{name}»', { name: task.name }));
    return 'Marcada como incompleta.';
  },

  borrar_tarea: async (args, env) => {
    const task = byId(env.ctx().tasks, required(args, 'id'), 'ninguna tarea pendiente');
    if (!(await env.confirm(tr('la tarea «{name}»', { name: task.name })))) fail('El usuario no lo permitió.');
    env.ctx().removeTask(task.id);
    return 'Borrada.';
  },

  // --- Asignaturas y colecciones ---
  listar_asignaturas: (_args, env) => {
    const ctx = env.ctx();
    return json({
      asignaturas: ctx.courses.map((c) =>
        withoutEmpty({
          id: c.id,
          nombre: c.name,
          profesor: c.teacherName,
          coleccion: ctx.spaces.find((s) => s.courseIds.includes(c.id))?.name,
          pendientes: ctx.tasks.filter((t) => t.courseId === c.id).length,
        })
      ),
      tareas_sueltas: ctx.tasks.filter((t) => !t.courseId).length,
    });
  },

  crear_asignatura: (args, env) => {
    const name = clip(required(args, 'nombre'), 120);
    const course = env.ctx().addCourse(name, str(args, 'profesor')?.trim() || undefined);
    if (!course) fail(`Ya hay una asignatura «${name}».`);
    env.notice(tr('creó la asignatura «{name}»', { name }));
    return json({ creada: true, id: course.id });
  },

  editar_asignatura: (args, env) => {
    const ctx = env.ctx();
    const course = findCourse(ctx.courses, required(args, 'asignatura'));
    const updates: Partial<Course> = {};
    const name = str(args, 'nombre')?.trim();
    if (name) {
      if (ctx.courses.some((c) => c.id !== course.id && fold(c.name) === fold(name))) fail(`Ya hay otra asignatura «${name}».`);
      updates.name = clip(name, 120);
    }
    const teacher = str(args, 'profesor');
    if (teacher !== undefined) updates.teacherName = teacher.trim();
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    ctx.updateCourse(course.id, updates);
    env.notice(tr('editó la asignatura «{name}»', { name: updates.name ?? course.name }));
    return 'Editada.';
  },

  borrar_asignatura: async (args, env) => {
    const ctx = env.ctx();
    const course = findCourse(ctx.courses, required(args, 'asignatura'));
    const pending = ctx.tasks.filter((t) => t.courseId === course.id).length;
    const detail = tr('la asignatura «{name}» con sus recursos y su archivo (tareas pendientes: {n})', { name: course.name, n: pending });
    if (!(await env.confirm(detail))) fail('El usuario no lo permitió.');
    env.ctx().deleteCourse(course.id);
    return 'Borrada. Durante unos segundos se puede deshacer con Ctrl+Z en Frame.';
  },

  listar_colecciones: (_args, env) => {
    const ctx = env.ctx();
    const nameOf = (id: string) => ctx.courses.find((c) => c.id === id)?.name;
    return json({ colecciones: ctx.spaces.map((s) => ({ id: s.id, nombre: s.name, asignaturas: s.courseIds.map(nameOf).filter(Boolean) })) });
  },

  crear_coleccion: async (args, env) => {
    const ctx = env.ctx();
    const name = clip(required(args, 'nombre'), 120);
    if (ctx.spaces.some((s) => fold(s.name) === fold(name))) fail(`Ya hay una colección «${name}».`);
    const refs = Array.isArray(args.asignaturas) ? (args.asignaturas as unknown[]).filter((r): r is string => typeof r === 'string') : [];
    const ids = [...new Set(refs.map((r) => findCourse(ctx.courses, r).id))];
    ctx.addSpace(name, ids);
    await env.settle();
    const created = env.ctx().spaces.find((s) => s.name === name.trim());
    env.notice(tr('creó la colección «{name}»', { name }));
    return json({ creada: true, id: created?.id });
  },

  editar_coleccion: (args, env) => {
    const ctx = env.ctx();
    const space = byId(ctx.spaces, required(args, 'id'), 'ninguna colección');
    const updates: { name?: string; courseIds?: string[] } = {};
    const name = str(args, 'nombre')?.trim();
    if (name) {
      if (ctx.spaces.some((s) => s.id !== space.id && fold(s.name) === fold(name))) fail(`Ya hay otra colección «${name}».`);
      updates.name = clip(name, 120);
    }
    if (Array.isArray(args.asignaturas)) {
      const refs = (args.asignaturas as unknown[]).filter((r): r is string => typeof r === 'string');
      updates.courseIds = [...new Set(refs.map((r) => findCourse(ctx.courses, r).id))];
    }
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    // Cada asignatura vive en una sola colección: sale de la que tuviera,
    // como al moverla desde la interfaz.
    if (updates.courseIds) {
      const moving = new Set(updates.courseIds);
      for (const other of ctx.spaces) {
        if (other.id !== space.id && other.courseIds.some((id) => moving.has(id))) {
          ctx.updateSpace(other.id, { courseIds: other.courseIds.filter((id) => !moving.has(id)) });
        }
      }
    }
    ctx.updateSpace(space.id, updates);
    env.notice(tr('editó la colección «{name}»', { name: updates.name ?? space.name }));
    return 'Editada.';
  },

  // --- Hábitos ---
  listar_habitos: (args, env) => {
    const now = new Date();
    const all = flag(args, 'incluir_archivados') ?? false;
    const habits = [...env.ctx().habits].filter((h) => all || !h.isArchived).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return json({ habitos: habits.map((h) => habitView(h, now)) });
  },

  crear_habito: async (args, env) => {
    const name = clip(required(args, 'nombre'), 120);
    const phaseName = choice(args, 'momento', ['mañana', 'tarde', 'noche', 'todo el día'] as const);
    const days = daysArg(args);
    env.ctx().addHabit(name, phaseName ? PHASE_OF[phaseName] : undefined, days ?? undefined);
    await env.settle();
    const created = env
      .ctx()
      .habits.filter((h) => h.name === name)
      .sort((a, b) => (b.order ?? 0) - (a.order ?? 0))[0];
    env.notice(tr('creó el hábito «{name}»', { name }));
    return json({ creado: true, id: created?.id });
  },

  editar_habito: (args, env) => {
    const ctx = env.ctx();
    const habit = byId(ctx.habits, required(args, 'id'), 'ningún hábito');
    const updates: Partial<Habit> = {};
    const name = str(args, 'nombre')?.trim();
    if (name) updates.name = clip(name, 120);
    const phaseName = choice(args, 'momento', ['mañana', 'tarde', 'noche', 'todo el día'] as const);
    if (phaseName) updates.phase = PHASE_OF[phaseName];
    const days = daysArg(args);
    if (days !== undefined) updates.days = days ?? undefined;
    const archived = flag(args, 'archivado');
    if (archived !== undefined) updates.isArchived = archived;
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    ctx.updateHabit(habit.id, updates);
    env.notice(tr('editó el hábito «{name}»', { name: updates.name ?? habit.name }));
    return json({ editado: true, habito: habitView({ ...habit, ...updates }, new Date()) });
  },

  marcar_habito: (args, env) => {
    const ctx = env.ctx();
    const habit = byId(ctx.habits, required(args, 'id'), 'ningún hábito');
    const day = dayArg(args, 'fecha') ?? localDayKey(new Date());
    if (day > localDayKey(new Date())) fail('No se puede marcar un día que aún no llega.');
    const done = flag(args, 'hecho') ?? true;
    const has = habit.completedOn.includes(day);
    if (done !== has) {
      ctx.updateHabit(habit.id, { completedOn: done ? [...habit.completedOn, day] : habit.completedOn.filter((d) => d !== day) });
      env.notice(done ? tr('marcó «{name}» como hecho', { name: habit.name }) : tr('quitó la marca de «{name}»', { name: habit.name }));
    }
    return `${habit.name}: ${done ? 'hecho' : 'sin marcar'} el ${day}.`;
  },

  borrar_habito: async (args, env) => {
    const habit = byId(env.ctx().habits, required(args, 'id'), 'ningún hábito');
    if (!(await env.confirm(tr('el hábito «{name}» con todo su historial', { name: habit.name })))) fail('El usuario no lo permitió.');
    env.ctx().deleteHabit(habit.id);
    return 'Borrado.';
  },

  // --- Calendario ---
  listar_eventos: (args, env) => {
    const ctx = env.ctx();
    const from = dayArg(args, 'desde') ?? localDayKey(new Date());
    const to = dayArg(args, 'hasta') ?? localDayKey(addDays(dateOfDay(from), 30));
    if (to < from) fail('«hasta» es anterior a «desde».');
    const events = ctx.localEvents
      .filter((e) => e.date <= to && (e.endDate ?? e.date) >= from)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''));
    const tasks = flag(args, 'incluir_tareas') ? [...ctx.tasks].filter((t) => t.dueDate && inDayRange(t.dueDate, from, to)).sort(pendingSort).map(taskView) : undefined;
    return json(withoutEmpty({ desde: from, hasta: to, eventos: events.map(eventView), tareas: tasks }));
  },

  crear_evento: async (args, env) => {
    const title = clip(required(args, 'titulo'), 200);
    const date = dayArg(args, 'fecha') ?? fail('Falta «fecha».');
    const endDate = dayArg(args, 'fecha_fin');
    if (endDate && endDate < date) fail('«fecha_fin» es anterior a «fecha».');
    const time = timeArg(args, 'hora');
    const kind = choice(args, 'tipo', EVENT_KINDS) ?? 'evento';
    const kindLabel = kind === 'otro' ? str(args, 'nombre_tipo')?.trim() : undefined;
    const description = str(args, 'descripcion')?.trim();
    const event: Omit<LocalCalendarEvent, 'id'> = {
      title,
      date,
      kind,
      color: colorArg(args) ?? DEFAULT_EVENT_COLOR,
      ...(endDate && endDate !== date ? { endDate } : {}),
      ...(time ? { time } : {}),
      ...(kindLabel ? { kindLabel } : {}),
      ...(description ? { description } : {}),
    };
    env.ctx().addLocalEvent(event);
    await env.settle();
    const created = [...env.ctx().localEvents].reverse().find((e) => e.title === title && e.date === date);
    env.notice(tr('creó el evento «{name}»', { name: title }));
    return json({ creado: true, id: created?.id });
  },

  editar_evento: (args, env) => {
    const ctx = env.ctx();
    const event = byId(ctx.localEvents, required(args, 'id'), 'ningún evento');
    const updates: Partial<Omit<LocalCalendarEvent, 'id'>> = {};
    const title = str(args, 'titulo')?.trim();
    if (title) updates.title = clip(title, 200);
    const date = dayArg(args, 'fecha');
    if (date) updates.date = date;
    const endRaw = str(args, 'fecha_fin');
    if (endRaw !== undefined) {
      const end = endRaw.trim();
      if (end && !isDay(end)) fail('«fecha_fin» debe ser AAAA-MM-DD o cadena vacía.');
      updates.endDate = end || undefined;
    }
    const finalStart = updates.date ?? event.date;
    const finalEnd = 'endDate' in updates ? updates.endDate : event.endDate;
    if (finalEnd && finalEnd < finalStart) fail('El evento terminaría antes de empezar.');
    if (finalEnd === finalStart) updates.endDate = undefined;
    const time = timeArg(args, 'hora');
    if (time !== undefined) updates.time = time ?? undefined;
    const kind = choice(args, 'tipo', EVENT_KINDS);
    if (kind) updates.kind = kind;
    const kindLabel = str(args, 'nombre_tipo')?.trim();
    if (kindLabel !== undefined) updates.kindLabel = kindLabel || undefined;
    const description = str(args, 'descripcion');
    if (description !== undefined) updates.description = description.trim() || undefined;
    const color = colorArg(args);
    if (color) updates.color = color;
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    ctx.updateLocalEvent(event.id, updates);
    env.notice(tr('editó el evento «{name}»', { name: updates.title ?? event.title }));
    return json({ editado: true, evento: eventView({ ...event, ...updates }) });
  },

  borrar_evento: async (args, env) => {
    const event = byId(env.ctx().localEvents, required(args, 'id'), 'ningún evento');
    if (!(await env.confirm(tr('el evento «{name}» del {date}', { name: event.title, date: event.date })))) fail('El usuario no lo permitió.');
    env.ctx().deleteLocalEvent(event.id);
    return 'Borrado.';
  },

  // --- Sesiones ---
  listar_sesiones: (args, env) => {
    const ctx = env.ctx();
    const from = dayArg(args, 'desde');
    const to = dayArg(args, 'hasta');
    const limit = num(args, 'limite', 1, 200) ?? 20;
    const list = [...ctx.studySessions].filter((s) => inDayRange(s.startTime, from, to)).sort((a, b) => b.startTime.localeCompare(a.startTime));
    return json({
      sesion_en_curso: ctx.isTimerActive,
      total: list.length,
      minutos_en_total: Math.round(list.reduce((sum, s) => sum + sessionMinutes(s), 0)),
      sesiones: list.slice(0, limit).map(sessionView),
    });
  },

  editar_sesion: (args, env) => {
    const ctx = env.ctx();
    const session = byId(ctx.studySessions, required(args, 'id'), 'ninguna sesión');
    if (!isSessionEditable(session)) fail('Solo se pueden corregir las sesiones de hoy.');
    const perception = num(args, 'percepcion', 1, 20);
    const notes = str(args, 'notas');
    if (perception === undefined && notes === undefined) fail('No se indicó nada que cambiar.');
    const ok = ctx.updateStudySession(session.id, {
      perception: perception ?? session.perception,
      subjects: session.subjects,
      subjectIds: session.subjectIds,
      notes: notes !== undefined ? notes.trim() : session.notes,
    });
    if (!ok) fail('Frame no dejó corregirla (ya está cerrada).');
    env.notice(tr('corrigió una sesión de estudio'));
    return 'Corregida.';
  },

  borrar_sesion: async (args, env) => {
    const session = byId(env.ctx().studySessions, required(args, 'id'), 'ninguna sesión');
    if (!isSessionEditable(session)) fail('Solo se pueden borrar las sesiones de hoy.');
    const start = parseIsoSafe(session.startTime);
    const what = tr('la sesión de {min} min de las {time}', { min: Math.round(sessionMinutes(session)), time: start ? format(start, 'HH:mm') : '—' });
    if (!(await env.confirm(what))) fail('El usuario no lo permitió.');
    env.ctx().deleteStudySession(session.id);
    return 'Borrada.';
  },

  // --- Recursos ---
  listar_recursos: (args, env) => {
    const ctx = env.ctx();
    const course = findCourse(ctx.courses, required(args, 'asignatura'));
    const query = str(args, 'buscar')?.trim();
    let notes = ctx.notes.filter((n) => n.courseId === course.id).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (query) notes = notes.filter((n) => fold(`${richNoteToPlain(n.content ?? '')} ${n.url ?? ''} ${n.fileName ?? ''}`).includes(fold(query)));
    return json({ asignatura: course.name, recursos: notes.map(noteView) });
  },

  crear_recurso: async (args, env) => {
    const ctx = env.ctx();
    const course = findCourse(ctx.courses, required(args, 'asignatura'));
    const link = linkArg(args);
    const content = str(args, 'texto')?.trim();
    if (!link && !content) fail('Indica «texto», «enlace» o ambos.');
    const body = clip(content || link!, 20000);
    ctx.addNote(course.id, body, link ? { kind: 'url', url: link } : { kind: 'text' });
    await env.settle();
    const created = [...env.ctx().notes].reverse().find((n) => n.courseId === course.id && n.content === body);
    env.notice(tr('añadió un recurso a «{name}»', { name: course.name }));
    return json({ creado: true, id: created?.id });
  },

  editar_recurso: (args, env) => {
    const ctx = env.ctx();
    const note = byId(ctx.notes, required(args, 'id'), 'ningún recurso');
    if (note.kind === 'file' && args.enlace !== undefined) fail('Un archivo no tiene enlace.');
    const updates: Partial<Pick<Note, 'content' | 'url'>> = {};
    const content = str(args, 'texto');
    if (content !== undefined && content.trim()) updates.content = clip(content.trim(), 20000);
    const link = linkArg(args);
    if (link) {
      if (note.kind !== 'url') fail('Solo los enlaces tienen URL.');
      updates.url = link;
    }
    if (Object.keys(updates).length === 0) fail('No se indicó nada que cambiar.');
    ctx.updateNote(note.id, updates);
    env.notice(tr('editó un recurso'));
    return 'Editado.';
  },

  borrar_recurso: async (args, env) => {
    const ctx = env.ctx();
    const note = byId(ctx.notes, required(args, 'id'), 'ningún recurso');
    const label = clip(note.fileName || note.url || richNoteToPlain(note.content ?? '') || tr('sin texto'), 80);
    const course = ctx.courses.find((c) => c.id === note.courseId)?.name ?? '';
    if (!(await env.confirm(tr('el recurso «{name}» de {course}', { name: label, course })))) fail('El usuario no lo permitió.');
    env.ctx().deleteNote(note.id);
    return 'Quitado: queda en el archivo de la asignatura.';
  },

  // --- Música ---
  buscar_canciones: (args, env) => {
    const ctx = env.ctx();
    if (ctx.areSongsLoading) fail('Frame aún está cargando la biblioteca; prueba en unos segundos.');
    const query = str(args, 'buscar')?.trim();
    const limit = num(args, 'limite', 1, 200) ?? 25;
    let list = ctx.songs;
    if (flag(args, 'solo_favoritas')) list = list.filter((s) => s.isFavorite);
    if (query) list = list.filter((s) => songMatches(s, query));
    return json({ total: list.length, canciones: list.slice(0, limit).map(songView) });
  },

  reproducir_cancion: (args, env) => {
    const ctx = env.ctx();
    if (ctx.areSongsLoading) fail('Frame aún está cargando la biblioteca; prueba en unos segundos.');
    const id = str(args, 'id')?.trim();
    const query = str(args, 'buscar')?.trim();
    if (!id && !query) fail('Indica «id» o «buscar».');
    const song = id ? byId(ctx.songs, id, 'ninguna canción') : bestSong(ctx.songs, query!);
    if (!song) fail(`No hay ninguna canción que coincida con «${query}».`);
    return playQueue(env, song, ctx.songs, 'Música');
  },

  controlar_musica: (args, env) => {
    const ctx = env.ctx();
    const action = choice(args, 'accion', ['estado', 'pausar', 'reanudar', 'siguiente', 'anterior', 'aleatorio_si', 'aleatorio_no'] as const) ?? fail('Falta «accion».');
    const status = () => {
      const now = env.ctx();
      return json(
        withoutEmpty({
          cancion: now.currentSong ? `${now.currentSong.title}${now.currentSong.artist ? ` — ${now.currentSong.artist}` : ''}` : 'ninguna',
          sonando: now.isPlaying,
          desde: now.currentSong ? now.playingContext : undefined,
          aleatorio: now.isShuffle,
          aviso: now.isPlaying && !canSound() ? WAIT_TOUCH : undefined,
        })
      );
    };
    if (action === 'estado') return status();
    if (action === 'aleatorio_si' || action === 'aleatorio_no') {
      if (ctx.isShuffle !== (action === 'aleatorio_si')) ctx.toggleShuffle();
      return action === 'aleatorio_si' ? 'Aleatorio activado.' : 'Aleatorio desactivado.';
    }
    if (!ctx.currentSong) fail('No hay ninguna canción puesta. Usa reproducir_cancion o reproducir_playlist.');
    if (action === 'pausar') {
      if (ctx.isPlaying) ctx.togglePlay();
      return 'En pausa.';
    }
    if (action === 'reanudar') {
      if (!ctx.isPlaying) ctx.togglePlay();
      return canSound() ? 'Sonando.' : WAIT_TOUCH;
    }
    if (action === 'siguiente') ctx.playNext();
    else ctx.playPrevious();
    return env.settle().then(status);
  },

  listar_playlists: (_args, env) => {
    const ctx = env.ctx();
    const ids = new Set(ctx.songs.map((s) => s.id));
    return json({
      playlists: [...ctx.playlists]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((p) => ({ id: p.id, nombre: p.name, canciones_en_este_equipo: p.songIds.filter((id) => ids.has(id)).length })),
    });
  },

  estadisticas_de_musica: async (args, env) => {
    const owner = env.ctx().userProfile?.id;
    if (!owner) fail('No hay ninguna sesión abierta en Frame.');
    const scope = choice(args, 'periodo', ['semana', 'mes', 'anio'] as const) ?? 'semana';
    const day = dayArg(args, 'fecha');
    const limit = num(args, 'limite', 1, 50) ?? 10;
    const { from, to } = periodRange(scope, day ? dateOfDay(day) : new Date());
    const stats = await listeningBetween(owner, from, to);
    const minutes = (seconds: number) => Math.round((seconds / 60) * 10) / 10;
    return json({
      periodo: { desde: format(from, 'yyyy-MM-dd'), hasta: format(to, 'yyyy-MM-dd') },
      minutos_escuchados: minutes(stats.seconds),
      reproducciones: stats.plays,
      canciones_distintas: stats.songs.length,
      artistas_distintos: stats.artists.length,
      canciones: stats.songs.slice(0, limit).map((x) => ({ titulo: x.title, artista: x.artist || null, minutos: minutes(x.seconds), reproducciones: x.plays })),
      artistas: stats.artists.slice(0, limit).map((x) => ({ nombre: x.name, horas: Math.round((x.seconds / 3600) * 100) / 100, reproducciones: x.plays })),
      playlists: stats.lists.slice(0, limit).map((x) => ({ id: x.id, nombre: x.name, minutos: minutes(x.seconds), reproducciones: x.plays })),
      nota: 'Una reproducción cuenta a los 30 s escuchados (a la mitad si la canción dura menos de un minuto).',
    });
  },

  reproducir_playlist: (args, env) => {
    const ctx = env.ctx();
    if (ctx.areSongsLoading) fail('Frame aún está cargando la biblioteca; prueba en unos segundos.');
    const ref = required(args, 'playlist');
    const playlist = ctx.playlists.find((p) => p.id === ref) ?? ctx.playlists.find((p) => fold(p.name) === fold(ref)) ?? ctx.playlists.find((p) => fold(p.name).includes(fold(ref)));
    if (!playlist) fail(`No hay ninguna playlist «${ref}». Hay: ${ctx.playlists.map((p) => p.name).join(', ') || 'ninguna'}.`);
    const queue = playlist.songIds.map((id) => ctx.songs.find((s) => s.id === id)).filter((s): s is Song => !!s);
    if (queue.length === 0) fail(`«${playlist.name}» no tiene canciones en este equipo.`);
    const shuffle = flag(args, 'aleatorio') ?? false;
    if (ctx.isShuffle !== shuffle) ctx.toggleShuffle();
    const first = shuffle ? queue[Math.floor(Math.random() * queue.length)] : queue[0];
    return playQueue(env, first, queue, playlist.name, `/playlists?id=${encodeURIComponent(playlist.id)}`);
  },

  // --- Informes ---
  ver_informe: (args, env) => {
    const { doc, label } = reportDoc(env.ctx(), args);
    return `${label}\n\n${renderDocMarkdown(doc)}`;
  },

  crear_informe: async (args, env) => {
    const { doc, fileBase } = reportDoc(env.ctx(), args);
    const formatName = choice(args, 'formato', ['docx', 'md'] as const) ?? 'docx';
    const result = await exportReport(doc, fileBase, formatName);
    env.notice(tr('creó el informe {file}', { file: result.fileName }));
    return result.path ? `Guardado en: ${result.path}` : `Se descargó como ${result.fileName}.`;
  },
};

/** Ejecuta una herramienta; los errores esperados vuelven como texto para la IA. */
export async function runIaTool(name: string, args: unknown, env: IaEnv): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const handler = HANDLERS[name];
  if (!handler) return { ok: false, error: `Frame no tiene la herramienta «${name}».` };
  if (!env.ctx().userProfile) return { ok: false, error: 'No hay ninguna sesión abierta en Frame.' };
  try {
    const text = await handler(args && typeof args === 'object' && !Array.isArray(args) ? (args as Args) : {}, env);
    return { ok: true, text };
  } catch (error) {
    if (error instanceof IaError) return { ok: false, error: error.message };
    console.error('[frame.ia]', name, error);
    return { ok: false, error: `Frame no pudo hacerlo: ${error instanceof Error ? error.message : String(error)}` };
  }
}
