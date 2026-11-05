import { addDays, differenceInCalendarDays, format, isValid, parseISO, startOfDay, startOfWeek, subDays } from 'date-fns';
import { GOAL_DAY_KEYS, unassignedSubject } from '@/lib/academic-metrics';
import { sessionSeconds } from '@/lib/duration';
import { isScheduled } from '@/lib/habit-schedule';
import { currentStreak } from '@/lib/streak';
import type { ArchivedTask, Course, DailyPerformance, Habit, StreakGoal, StudyGoals, StudySession, Task } from '@/types';
import { dateLocale, tr } from '@/lib/i18n';

// ============================================================
// Las frases de la barra superior.
//
// Sustituyen a la frase propia (1.6.2): en lugar de un lema que se escribía
// una vez y nadie volvía a leer, la barra cuenta algo de lo que está pasando,
// rellenado con los datos del usuario y siempre de una ventana RECIENTE —hoy,
// ayer, esta semana o la pasada—. Nunca acumulados desde el principio («120
// tareas culminadas») ni ceros desalentadores («0 min estudiados hoy»): cada
// plantilla decide si hoy tiene algo que decir y, si no, se calla.
//
// Capa pura (sin React): la cabecera la llama con los datos del contexto y
// rota entre lo que devuelve. Cada frase lleva un `id` estable por plantilla,
// así la rotación no pierde el sitio cuando una cifra se actualiza.
// ============================================================

export interface HeaderPhrase {
  /** Plantilla de la que sale: estable aunque cambie el texto. */
  id: string;
  text: string;
}

interface PhraseData {
  now: Date;
  /** Nombre para el saludo; vacío en invitados. */
  name?: string;
  tasks: Task[];
  archivedTasks: ArchivedTask[];
  courses: Course[];
  studySessions: StudySession[];
  habits: Habit[];
  studyGoals: StudyGoals | null | undefined;
  dailyPerformances: DailyPerformance[];
  /** Meta de racha de Ajustes: sin ella no hay frase de racha. */
  streakGoal?: StreakGoal | null;
}

/** Marca de tiempo de un ISO, o NaN si viene corrupto de localStorage. */
const timeOf = (iso: string | null | undefined): number => {
  if (!iso) return NaN;
  try {
    const date = parseISO(iso);
    return isValid(date) ? date.getTime() : NaN;
  } catch {
    return NaN;
  }
};

const dayKey = (date: Date): string => format(date, 'yyyy-MM-dd');

/** «2 h 15 min», «3 h», «45 min». Por debajo del minuto no hay frase. */
function spanLabel(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** «hoy», «mañana», «el jueves» o «el 24 de octubre». */
function whenLabel(due: Date, today: Date): string {
  const diff = differenceInCalendarDays(due, today);
  if (diff === 0) return tr('hoy');
  if (diff === 1) return tr('mañana');
  if (diff < 7) return tr('el {p}', { p: format(due, tr('EEEE'), { locale: dateLocale() }) });
  return tr('el {p}', { p: format(due, tr('d \'de\' MMMM'), { locale: dateLocale() }) });
}

/** Saludo según la hora: la frase neutra cuando aún no hay nada que contar. */
export function greetingPhrase(now: Date, name?: string): HeaderPhrase {
  const hour = now.getHours();
  const salute = hour >= 5 && hour < 12 ? tr('Buenos días') : hour >= 12 && hour < 20 ? tr('Buenas tardes') : tr('Buenas noches');
  const first = name?.trim().split(/\s+/)[0];
  return { id: 'saludo', text: first ? `${salute}, ${first}` : tr('{salute}, te damos la bienvenida a Frame', { salute }) };
}

/**
 * Las frases con algo que decir ahora mismo, en orden de interés: primero lo
 * de hoy y lo que viene, luego la semana, al final la semana pasada. Si no
 * queda ninguna, el saludo.
 */
export function buildHeaderPhrases(data: PhraseData): HeaderPhrase[] {
  const { now } = data;
  const today = startOfDay(now);
  const todayStart = today.getTime();
  const tomorrowStart = addDays(today, 1).getTime();
  const yesterdayStart = subDays(today, 1).getTime();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 }).getTime();
  const lastWeekStart = subDays(new Date(weekStart), 7).getTime();

  const inRange = (t: number, from: number, to: number) => Number.isFinite(t) && t >= from && t < to;

  // --- Estudio: minutos por ventana y por asignatura en la semana ---
  let todayMin = 0;
  let yesterdayMin = 0;
  let weekMin = 0;
  let lastWeekMin = 0;
  const weekBySubject = new Map<string, number>();

  for (const session of data.studySessions ?? []) {
    const t = timeOf(session.startTime);
    if (!Number.isFinite(t)) continue;
    const minutes = sessionSeconds(session) / 60;
    if (minutes <= 0) continue;
    if (inRange(t, todayStart, tomorrowStart)) todayMin += minutes;
    if (inRange(t, yesterdayStart, todayStart)) yesterdayMin += minutes;
    if (inRange(t, lastWeekStart, weekStart)) lastWeekMin += minutes;
    if (inRange(t, weekStart, tomorrowStart)) {
      weekMin += minutes;
      // El tiempo se reparte a partes iguales entre las asignaturas de la sesión.
      const subjects = session.subjects?.length ? session.subjects : [unassignedSubject()];
      for (const subject of subjects) {
        weekBySubject.set(subject, (weekBySubject.get(subject) ?? 0) + minutes / subjects.length);
      }
    }
  }

  // --- Tareas culminadas (el archivo, no las incompletas) ---
  let doneToday = 0;
  let doneWeek = 0;
  let doneLastWeek = 0;
  for (const task of data.archivedTasks ?? []) {
    if (task.outcome === 'incomplete') continue;
    const t = timeOf(task.archivedAt);
    if (inRange(t, todayStart, tomorrowStart)) doneToday += 1;
    if (inRange(t, weekStart, tomorrowStart)) doneWeek += 1;
    if (inRange(t, lastWeekStart, weekStart)) doneLastWeek += 1;
  }

  // --- Entregas pendientes: desde hoy (las vencidas no: serían reproche) ---
  const endOfWeekStart = addDays(new Date(weekStart), 7).getTime();
  const upcoming = (data.tasks ?? [])
    .filter((task) => task.dueDate && (task.progress ?? 0) < 100)
    .map((task) => ({ task, due: startOfDay(new Date(timeOf(task.dueDate))) }))
    .filter(({ due }) => Number.isFinite(due.getTime()) && due.getTime() >= todayStart)
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  const dueThisWeek = upcoming.filter(({ due }) => due.getTime() < endOfWeekStart).length;

  // --- Hábitos ---
  const todayKey = dayKey(today);
  const activeHabits = (data.habits ?? []).filter((habit) => !habit.isArchived);
  const habitsToday = activeHabits.filter((habit) => isScheduled(habit, today));
  const habitsDoneToday = habitsToday.filter((habit) => habit.completedOn?.includes(todayKey)).length;
  const weekStartKey = dayKey(new Date(weekStart));
  let habitChecksWeek = 0;
  for (const habit of activeHabits) {
    for (const key of habit.completedOn ?? []) {
      if (key >= weekStartKey && key <= todayKey) habitChecksWeek += 1;
    }
  }

  // --- Racha: la misma regla que «Días de racha» de Inicio (meta de racha) ---
  const streak = data.streakGoal
    ? currentStreak({
        now,
        streakGoal: data.streakGoal,
        studySessions: data.studySessions ?? [],
        dailyPerformances: data.dailyPerformances ?? [],
        studyGoals: data.studyGoals,
      })
    : 0;

  const phrases: HeaderPhrase[] = [];
  const push = (id: string, text: string | false | null | undefined) => {
    if (text) phrases.push({ id, text });
  };

  // 1. Lo próximo que vence.
  const next = upcoming[0];
  if (next && differenceInCalendarDays(next.due, today) <= 14) {
    const course = data.courses?.find((c) => c.id === next.task.courseId);
    push('entrega-proxima', tr('Tu próxima entrega: {p}, {whenLabel}', { p: course?.name ?? next.task.name, whenLabel: whenLabel(next.due, today) }));
  }
  push('entregas-semana', dueThisWeek >= 2 && tr('Esta semana te esperan {dueThisWeek} entregas', { dueThisWeek }));

  // 2. Hoy.
  push('estudio-hoy', todayMin >= 1 && tr('Hoy llevas {spanLabel} de estudio', { spanLabel: spanLabel(todayMin) }));
  const goal = data.studyGoals?.[GOAL_DAY_KEYS[now.getDay()]] ?? 0;
  // Sin nada estudiado hoy, la meta no es un dato: acompaña a las demás frases
  // en este puesto, pero sola no tapa el saludo (las metas vienen puestas).
  const bareGoalAt = goal > 0 && todayMin < 1 ? phrases.length : -1;
  if (goal > 0) {
    if (todayMin >= goal) push('meta-hoy', tr('Meta de hoy cumplida: {spanLabel}', { spanLabel: spanLabel(goal) }));
    else if (todayMin >= 1) push('meta-hoy', tr('Te faltan {spanLabel} para tu meta de hoy', { spanLabel: spanLabel(Math.max(1, goal - todayMin)) }));
  }
  push(
    'tareas-hoy',
    doneToday >= 1 && tr('{doneToday} {plural} hoy', { doneToday, plural: plural(doneToday, tr('tarea culminada'), tr('tareas culminadas')) })
  );
  if (habitsToday.length > 0 && habitsDoneToday > 0) {
    push(
      'habitos-hoy',
      habitsDoneToday >= habitsToday.length
        ? habitsToday.length === 1
          ? tr('Tu hábito de hoy, hecho')
          : tr('Los {length} hábitos de hoy, hechos', { length: habitsToday.length })
        : tr('{habitsDoneToday} de {length} hábitos de hoy hechos', { habitsDoneToday, length: habitsToday.length })
    );
  }
  push('racha', streak >= 2 && tr('Llevas {streak} días de racha', { streak }));

  // 3. Esta semana (sin repetir lo que ya dijo «hoy», p. ej. un lunes).
  push('estudio-semana', weekMin - todayMin >= 1 && tr('Esta semana llevas {spanLabel} de estudio', { spanLabel: spanLabel(weekMin) }));
  push(
    'tareas-semana',
    doneWeek > doneToday && tr('{doneWeek} {plural} esta semana', { doneWeek, plural: plural(doneWeek, tr('tarea culminada'), tr('tareas culminadas')) })
  );
  // Cuenta marcas (un hábito marcado cinco días son cinco), no hábitos.
  push(
    'habitos-semana',
    habitChecksWeek > habitsDoneToday &&
      (habitChecksWeek === 1
        ? tr('Esta semana ya marcaste un hábito')
        : tr('Esta semana marcaste tus hábitos {habitChecksWeek} veces', { habitChecksWeek }))
  );
  const [topSubject, topMinutes] =
    [...weekBySubject.entries()]
      .filter(([subject]) => subject !== unassignedSubject())
      .sort((a, b) => b[1] - a[1])[0] ?? [];
  push('asignatura-semana', topSubject && (topMinutes ?? 0) >= 30 && tr('Tu asignatura de la semana: {topSubject}', { topSubject }));
  push(
    'supera-semana',
    lastWeekMin >= 1 && weekMin > lastWeekMin && tr('Ya superas tu estudio de la semana pasada')
  );

  // 4. Ayer y la semana pasada.
  push('estudio-ayer', yesterdayMin >= 1 && tr('Ayer estudiaste {spanLabel}', { spanLabel: spanLabel(yesterdayMin) }));
  const yesterdayPerf = (data.dailyPerformances ?? []).find((p) => p.date === dayKey(new Date(yesterdayStart)));
  push(
    'nota-ayer',
    yesterdayPerf && (yesterdayPerf.grade === 'A' || yesterdayPerf.grade === 'AD') && tr('Ayer cerraste el día con {grade}', { grade: yesterdayPerf.grade })
  );
  push('estudio-semana-pasada', lastWeekMin >= 1 && tr('La semana pasada estudiaste {spanLabel}', { spanLabel: spanLabel(lastWeekMin) }));
  push(
    'tareas-semana-pasada',
    doneLastWeek >= 1 &&
      tr('La semana pasada culminaste {doneLastWeek} {plural}', { doneLastWeek, plural: plural(doneLastWeek, tr('tarea'), tr('tareas')) })
  );

  if (phrases.length === 0) return [greetingPhrase(now, data.name)];
  if (bareGoalAt >= 0) phrases.splice(bareGoalAt, 0, { id: 'meta-hoy', text: tr('Tu meta de hoy: {spanLabel} de estudio', { spanLabel: spanLabel(goal) }) });
  return phrases;
}
