// ============================================================
// Modelo de la cuadrícula del calendario LOCAL.
//
// Módulo puro (sin React): fechas como claves "YYYY-MM-DD", la rejilla del
// mes, el reparto de eventos en carriles (para que un evento de varios días
// sea UNA barra continua) y el plan para vaciar unos días. La vista solo
// pinta lo que sale de aquí, y todo se calcula una vez por mes, no en cada
// render.
//
// Las claves "YYYY-MM-DD" se comparan como texto: el orden lexicográfico ES
// el cronológico, así que un rango se resuelve sin crear fechas.
// ============================================================

import type { CalendarDayColor, LocalCalendarEvent, Task } from '@/types';
import { EVENT_COLOR_ROWS, eventDisplay, normalizeKind } from '@/lib/calendar-events';
import { getLang, intlLocale, lowerFirst, tr, type Lang } from '@/lib/i18n';
import { dayName, fromSunday } from '@/lib/day-names';
import { describeReminder, reminderFromTask } from '@/components/tasks/ReminderEditor';

// ---------------------------------------------------------------------------
// Claves de día
// ---------------------------------------------------------------------------

export const toKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const fromKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** Suma días por calendario (no por milisegundos): inmune al cambio de hora. */
export const addDays = (key: string, days: number): string => {
  const date = fromKey(key);
  return toKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
};

/** Días entre dos claves (b − a). */
export const daysBetween = (a: string, b: string): number =>
  Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);

export interface DayRange {
  start: string;
  end: string;
}

/** El orden en que se arrastró da igual: el rango sale siempre ordenado. */
export const orderRange = (a: string, b: string): DayRange => (a <= b ? { start: a, end: b } : { start: b, end: a });

export const inRange = (key: string, range: DayRange | null | undefined): boolean =>
  !!range && key >= range.start && key <= range.end;

/** Último día de un evento (los guardados con el rango invertido se toleran). */
export const eventEnd = (event: Pick<LocalCalendarEvent, 'date' | 'endDate'>): string =>
  event.endDate && event.endDate > event.date ? event.endDate : event.date;

// ---------------------------------------------------------------------------
// Rejilla del mes (lunes primero)
// ---------------------------------------------------------------------------

export interface MonthCursor {
  year: number;
  /** 0 = enero */
  month: number;
}

export const monthKeyOf = ({ year, month }: MonthCursor): string =>
  `${year}-${String(month + 1).padStart(2, '0')}`;

export const shiftMonth = ({ year, month }: MonthCursor, delta: number): MonthCursor => {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
};

export const cursorOf = (key: string): MonthCursor => {
  const date = fromKey(key);
  return { year: date.getFullYear(), month: date.getMonth() };
};

/** Semanas completas que cubren el mes: 4 a 6 filas de 7 claves. */
export function monthWeeks({ year, month }: MonthCursor): string[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const total = Math.ceil((lead + daysInMonth) / 7) * 7;
  const weeks: string[][] = [];
  for (let i = 0; i < total; i += 7) {
    const week: string[] = [];
    for (let j = 0; j < 7; j++) week.push(toKey(new Date(year, month, 1 - lead + i + j)));
    weeks.push(week);
  }
  return weeks;
}

// Nombres de meses y días por idioma: el español queda exactamente como era
// («12 mar», «martes 12 de marzo») y el inglés lleva su propio orden
// («Mar 12», «Tuesday, March 12»). Los idiomas de 1.7.3 tienen sus tablas
// y su orden («12. Okt», «10月12日»); el día largo lo arma `Intl`, que sabe
// declinar («12 марта»).
const MONTHS: Record<Lang, string[]> = {
  es: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  fr: ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'],
  it: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
  pt: ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};
const MONTHS_SHORT: Record<Lang, string[]> = {
  es: ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  fr: ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'],
  it: ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'],
  pt: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
};

/** «Octubre» / «October». */
export const monthName = (month: number): string => MONTHS[getLang()][month];

/** «oct» / «Oct». */
export const monthShort = (month: number): string => MONTHS_SHORT[getLang()][month];

/** «1 oct» / «Oct 1» / «1. Okt» / «10月1日». */
export const dayMonthShort = (day: number, month: number): string => {
  const lang = getLang();
  if (lang === 'en') return `${monthShort(month)} ${day}`;
  if (lang === 'de') return `${day}. ${monthShort(month)}`;
  if (lang === 'ja') return `${monthShort(month)}${day}日`;
  return `${day} ${monthShort(month)}`;
};

/** El día de la semana de una fecha (en español, en minúscula). */
export const weekdayName = (key: string): string => dayName(fromSunday(fromKey(key).getDay()));

/** «martes 12 de marzo» / «Tuesday, March 12» (con el año solo si no es el actual). */
export function longDayLabel(key: string, todayKey: string): string {
  const date = fromKey(key);
  const otherYear = date.getFullYear() !== fromKey(todayKey).getFullYear();
  const lang = getLang();
  if (lang !== 'es' && lang !== 'en') {
    return new Intl.DateTimeFormat(intlLocale(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      ...(otherYear ? { year: 'numeric' as const } : {}),
    }).format(date);
  }
  const weekday = weekdayName(key);
  if (lang === 'en') {
    return `${weekday}, ${monthName(date.getMonth())} ${date.getDate()}${otherYear ? `, ${date.getFullYear()}` : ''}`;
  }
  return `${weekday} ${date.getDate()} de ${monthName(date.getMonth()).toLowerCase()}${otherYear ? ` de ${date.getFullYear()}` : ''}`;
}

/** «12 mar» / «Mar 12» */
export const shortDayLabel = (key: string): string => {
  const date = fromKey(key);
  return dayMonthShort(date.getDate(), date.getMonth());
};

/** «12 – 18 mar», «28 feb – 3 mar» o «12 mar» para un solo día (en inglés,
 *  «Mar 12 – 18», «Feb 28 – Mar 3»). */
export function rangeLabel({ start, end }: DayRange): string {
  if (start === end) return shortDayLabel(start);
  const a = fromKey(start);
  const b = fromKey(end);
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) {
    const lang = getLang();
    if (lang === 'en') return `${monthShort(a.getMonth())} ${a.getDate()} – ${b.getDate()}`;
    if (lang === 'de') return `${a.getDate()}. – ${b.getDate()}. ${monthShort(b.getMonth())}`;
    if (lang === 'ja') return `${monthShort(a.getMonth())}${a.getDate()}日 – ${b.getDate()}日`;
    return `${a.getDate()} – ${b.getDate()} ${monthShort(b.getMonth())}`;
  }
  return `${shortDayLabel(start)} – ${shortDayLabel(end)}`;
}

/** «Hoy», «Mañana», «Hace 3 días»… para el subtítulo del día. */
export function relativeDayLabel(key: string, todayKey: string): string {
  const diff = daysBetween(todayKey, key);
  if (diff === 0) return tr('Hoy');
  if (diff === 1) return tr('Mañana');
  if (diff === -1) return tr('Ayer');
  return diff > 0 ? tr('Dentro de {diff} días', { diff }) : tr('Hace {p} días', { p: -diff });
}

export const capitalize = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

// ---------------------------------------------------------------------------
// Paleta de las casillas: los ocho tonos base de los eventos, opacos. La vista
// los mezcla con el fondo según el tema (más presentes en claro, más tenues
// en oscuro), así un mismo dato se lee bien en los dos.
// ---------------------------------------------------------------------------

const COLOR_NAMES = ['azul', 'verde', 'amarillo', 'coral', 'lila', 'celeste', 'rosa', 'arena'];

export const PAINT_COLORS: { hex: string; name: string }[] = EVENT_COLOR_ROWS[0].map((hex, index) => ({
  hex,
  get name() {
    return COLOR_NAMES[index] ? tr(COLOR_NAMES[index]) : hex;
  },
}));

/** Avisos que ofrece el formulario (minutos de antelación). */
export const REMIND_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 0, get label() { return tr('A la hora'); } },
  { minutes: 10, get label() { return tr('10 min antes'); } },
  { minutes: 30, get label() { return tr('30 min antes'); } },
  { minutes: 60, get label() { return tr('1 h antes'); } },
  { minutes: 1440, get label() { return tr('El día antes'); } },
];

/** Lo que avisa un evento, para la cuadrícula y la lista del día (null = nada).
 *  El recordatorio de la 1.6.8 manda; si no, el aviso antiguo («10 min antes»). */
export function eventReminderLabel(event: LocalCalendarEvent): string | null {
  if (event.reminderEnabled && event.reminderTime) return describeReminder(reminderFromTask(event));
  const legacy = event.time ? remindLabel(event.remindBefore) : null;
  return legacy ? tr('Aviso {p}', { p: lowerFirst(legacy) }) : null;
}

export const remindLabel = (minutes: number | undefined): string | null => {
  if (minutes === undefined || minutes === null) return null;
  return REMIND_OPTIONS.find((option) => option.minutes === minutes)?.label ?? tr('{minutes} min antes', { minutes });
};

/** Cuándo es el evento, visto desde `today` (el texto de su recordatorio). */
export function eventWhenLabel(event: LocalCalendarEvent, today: string): string {
  const last = eventEnd(event);
  if (last !== event.date) return tr('Del {rangeLabel}', { rangeLabel: rangeLabel({ start: event.date, end: last }) });
  const day = event.date === today ? tr('Hoy') : event.date === addDays(today, 1) ? tr('Mañana') : shortDayLabel(event.date);
  return event.time ? tr('{day} a las {time}', { day, time: event.time }) : day;
}

/**
 * Los avisos del recordatorio de un evento (1.6.8, el mismo de las tareas) en
 * `day`: el primero a su hora y, si se repite, uno cada tantos minutos hasta
 * que acaba el día; el último día del evento, solo hasta su hora. Vacío si ese
 * día no avisa (no es uno de sus días de la semana, el evento ya pasó o, en un
 * «Recordatorio», aún no empezó). Cada aviso lleva su clave (`r#id#día#tramo`)
 * para darse una sola vez; la usan el reloj de la app y, en Android, las
 * alarmas del sistema.
 */
export function eventReminderSlots(event: LocalCalendarEvent, day: string): { mark: string; at: number }[] {
  if (event.reminderEnabled !== true || !event.reminderTime) return [];
  const last = eventEnd(event);
  if (day > last || (normalizeKind(event.kind) === 'recordatorio' && day < event.date)) return [];
  const date = fromKey(day);
  const days = event.reminderDays ?? [];
  if (days.length > 0 && !days.includes(date.getDay())) return [];
  const timeOf = (time: string | undefined): number | null => {
    const [h, m] = (time ?? '').split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m).getTime() : null;
  };
  const start = timeOf(event.reminderTime);
  if (start === null) return [];
  const end = (day === last ? timeOf(event.time) : null) ?? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() - 1;
  const repeat = Math.max(0, event.reminderRepeatMinutes ?? 0) * 60_000;
  const slots: { mark: string; at: number }[] = [];
  for (let slot = 0, at = start; at <= end; slot++, at += repeat) {
    slots.push({ mark: `r#${event.id}#${day}#${slot}`, at });
    if (repeat === 0) break;
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Elementos de la cuadrícula y su reparto en carriles
// ---------------------------------------------------------------------------

export interface GridItem {
  id: string;
  /** Primer y último día (ambos incluidos). */
  start: string;
  end: string;
  label: string;
  /** "HH:mm" delante del título. */
  time?: string;
  /** Tinte del evento; sin él, estilo neutro (tareas y Google). */
  color?: string;
  variant: 'event' | 'task' | 'external';
  /** Ya pasó: se ve, pero atenuado. */
  faded?: boolean;
  /** Lleva aviso nativo. */
  bell?: boolean;
  /** Un clic lo abre directamente (los eventos locales). */
  openable?: boolean;
  /** Texto completo para el globo al pasar el ratón. */
  hint?: string;
}

interface PlacedItem {
  item: GridItem;
  /** Columnas (0 = lunes) que ocupa en ESTA semana. */
  from: number;
  to: number;
  lane: number;
}

interface WeekLayout {
  placed: PlacedItem[];
  /** Elementos por columna (para «+N más» y las etiquetas accesibles). */
  counts: number[];
}

/** Orden de los carriles: lo largo arriba, después lo que empieza antes, y
 *  las tareas al final de cada día. */
const variantRank = { event: 0, external: 0, task: 1 } as const;

export function layoutWeek(week: string[], items: GridItem[]): WeekLayout {
  const first = week[0];
  const last = week[6];
  const candidates: PlacedItem[] = [];
  for (const item of items) {
    if (item.end < first || item.start > last) continue;
    const from = item.start <= first ? 0 : week.indexOf(item.start);
    const to = item.end >= last ? 6 : week.indexOf(item.end);
    if (from < 0 || to < 0) continue;
    candidates.push({ item, from, to, lane: 0 });
  }

  candidates.sort(
    (a, b) =>
      variantRank[a.item.variant] - variantRank[b.item.variant] ||
      a.from - b.from ||
      b.to - b.from - (a.to - a.from) ||
      (a.item.time ?? '').localeCompare(b.item.time ?? '') ||
      a.item.label.localeCompare(b.item.label)
  );

  // Reparto voraz: cada elemento al carril libre más alto en todo su tramo.
  const occupied: boolean[][] = [];
  const counts = Array(7).fill(0) as number[];
  for (const placed of candidates) {
    let lane = 0;
    for (;;) {
      const row = occupied[lane] ?? (occupied[lane] = Array(7).fill(false));
      let free = true;
      for (let c = placed.from; c <= placed.to; c++) {
        if (row[c]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let c = placed.from; c <= placed.to; c++) row[c] = true;
        break;
      }
      lane++;
    }
    placed.lane = lane;
    for (let c = placed.from; c <= placed.to; c++) counts[c]++;
  }
  return { placed: candidates, counts };
}

export interface Segment {
  item: GridItem;
  from: number;
  to: number;
  lane: number;
  /** La barra sigue a la izquierda / a la derecha (esquinas rectas). */
  continuesLeft: boolean;
  continuesRight: boolean;
}

interface WeekView {
  segments: Segment[];
  /** Por columna: cuántos elementos quedan detrás de «+N más» (0 = ninguno)
   *  y en qué carril va ese indicador. */
  more: { count: number; lane: number }[];
}

/**
 * Lo que cabe de una semana con `maxLanes` carriles por casilla.
 *
 * Una casilla que se desborda reserva su último carril para «+N más»; una
 * barra que cruza esa casilla se corta ahí y sigue en las vecinas, así el
 * resto de la semana no pierde nada por culpa de un día lleno.
 */
export function viewWeek(layout: WeekLayout, maxLanes: number, week: string[]): WeekView {
  const top = Array(7).fill(-1) as number[];
  for (const p of layout.placed) for (let c = p.from; c <= p.to; c++) top[c] = Math.max(top[c], p.lane);
  const limit = top.map((lane) => (lane >= maxLanes ? maxLanes - 1 : maxLanes));
  const more = limit.map((lim) => ({ count: 0, lane: lim }));

  const segments: Segment[] = [];
  for (const p of layout.placed) {
    let runStart = -1;
    for (let c = p.from; c <= p.to + 1; c++) {
      const visible = c <= p.to && p.lane < limit[c];
      if (c <= p.to && !visible) more[c].count++;
      if (visible && runStart < 0) runStart = c;
      if (!visible && runStart >= 0) {
        const runEnd = c - 1;
        segments.push({
          item: p.item,
          from: runStart,
          to: runEnd,
          lane: p.lane,
          continuesLeft: runStart > p.from || (runStart === 0 && p.item.start < week[0]),
          continuesRight: runEnd < p.to || (runEnd === 6 && p.item.end > week[6]),
        });
        runStart = -1;
      }
    }
  }
  return { segments, more };
}

// ---------------------------------------------------------------------------
// Tareas con fecha de entrega
// ---------------------------------------------------------------------------

/** Día local de la fecha de entrega de una tarea (null si no tiene o es inválida). */
function taskDay(task: Pick<Task, 'dueDate'>): string | null {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  return Number.isNaN(due.getTime()) ? null : toKey(due);
}

/** Tareas agrupadas por su día de entrega. */
export function groupTasksByDay(tasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of tasks) {
    const day = taskDay(task);
    if (!day) continue;
    const list = map.get(day);
    if (list) list.push(task);
    else map.set(day, [task]);
  }
  return map;
}

/** Las tareas que vencen entre `first` y `last`, como elementos de la cuadrícula. */
export function buildTaskItems(tasks: Task[], first: string, last: string): GridItem[] {
  const items: GridItem[] = [];
  for (const task of tasks) {
    const day = taskDay(task);
    if (!day || day < first || day > last) continue;
    items.push({
      id: `task:${task.id}`,
      start: day,
      end: day,
      label: task.name,
      variant: 'task',
      hint: `${task.name} · ${task.courseName || tr('Sin asignatura')}`,
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Casillas pintadas
// ---------------------------------------------------------------------------

/**
 * Color de fondo de cada día visible: primero los eventos con «Pintar las
 * casillas» (el primero gana, como siempre), y encima el color propio de
 * cada casilla, que manda. Un color propio vacío deja la casilla sin pintar.
 */
export function buildFills(
  events: LocalCalendarEvent[],
  dayColors: CalendarDayColor[],
  first: string,
  last: string
): Map<string, string> {
  const fills = new Map<string, string>();
  for (const event of events) {
    if (eventDisplay(event) !== 'casilla') continue;
    const end = eventEnd(event);
    if (end < first || event.date > last) continue;
    let day = event.date < first ? first : event.date;
    const stop = end > last ? last : end;
    while (day <= stop) {
      if (!fills.has(day)) fills.set(day, event.color);
      day = addDays(day, 1);
    }
  }
  for (const { id, color } of dayColors) {
    if (id < first || id > last) continue;
    if (color) fills.set(id, color);
    else fills.delete(id);
  }
  return fills;
}

/** ¿Algún evento con «Pintar las casillas» cubre este día? */
export const paintedByEvent = (events: LocalCalendarEvent[], day: string): boolean =>
  events.some((event) => eventDisplay(event) === 'casilla' && day >= event.date && day <= eventEnd(event));

/**
 * Qué escribir para dejar unos días SIN color: los que pinta un evento
 * necesitan la marca vacía; el resto basta con olvidarlos.
 */
export function planUnpaint(
  events: LocalCalendarEvent[],
  days: string[]
): { forget: string[]; blank: string[] } {
  const forget: string[] = [];
  const blank: string[] = [];
  for (const day of days) (paintedByEvent(events, day) ? blank : forget).push(day);
  return { forget, blank };
}

/** Todas las claves de un rango, en orden. */
export function daysOf({ start, end }: DayRange): string[] {
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

// ---------------------------------------------------------------------------
// Vaciar unos días (tecla Supr o la papelera de la selección)
// ---------------------------------------------------------------------------

export interface ClearPlan {
  remove: string[];
  update: { id: string; changes: Partial<Omit<LocalCalendarEvent, 'id'>> }[];
  add: Omit<LocalCalendarEvent, 'id'>[];
  /** Días con color propio que se olvidan. */
  colorDays: string[];
  /** Eventos tocados: borrados (`remove`) más recortados o partidos (`update`). */
  eventCount: number;
}

/**
 * Quita de un rango todo lo que es del calendario —eventos y colores—, sin
 * tocar nada fuera de él: un evento que asoma por un lado se recorta, y uno
 * que cubre el rango por los dos lados se parte en dos. Las tareas no son del
 * calendario y no se tocan.
 *
 * `todayKey` decide qué parte de un evento partido conserva su id: la que
 * tiene los avisos de hoy y mañana, porque la marca de «aviso ya dado» va por
 * id y una copia con id nuevo lo repetiría.
 */
export function planClear(
  events: LocalCalendarEvent[],
  dayColors: CalendarDayColor[],
  range: DayRange,
  todayKey?: string,
  /** Solo estos eventos y, con `colors: false`, sin tocar los colores (1.6.7: lista de marcar). */
  only?: { eventIds: Set<string>; colors: boolean }
): ClearPlan {
  const { start: s, end: e } = range;
  const plan: ClearPlan = { remove: [], update: [], add: [], colorDays: [], eventCount: 0 };
  const single = (from: string, to: string) => (to > from ? to : undefined);

  for (const event of events) {
    if (only && !only.eventIds.has(event.id)) continue;
    const a = event.date;
    const b = eventEnd(event);
    if (b < s || a > e) continue;
    plan.eventCount++;
    if (s <= a && b <= e) {
      plan.remove.push(event.id);
    } else if (a < s && b <= e) {
      plan.update.push({ id: event.id, changes: { endDate: single(a, addDays(s, -1)) } });
    } else if (s <= a && e < b) {
      const from = addDays(e, 1);
      plan.update.push({ id: event.id, changes: { date: from, endDate: single(from, b) } });
    } else {
      // Cubre el rango por los dos lados: una parte se queda con el evento y
      // la otra nace como copia. Normalmente se queda la de antes; si la de
      // después empieza mañana o antes, la de antes ya pasó y se queda esa.
      const from = addDays(e, 1);
      const before = { endDate: single(a, addDays(s, -1)) };
      const after = { date: from, endDate: single(from, b) };
      const keepAfter = !!todayKey && from <= addDays(todayKey, 1);
      const { id: _id, ...rest } = event;
      plan.update.push({ id: event.id, changes: keepAfter ? after : before });
      plan.add.push({ ...rest, ...(keepAfter ? before : after) });
    }
  }
  // Con la lista de marcar solo se olvidan los colores visibles: las marcas
  // «sin color» que tapan a un evento que se queda deben seguir tapándolo.
  for (const { id, color } of dayColors) {
    if (id >= s && id <= e && (!only || (only.colors && color))) plan.colorDays.push(id);
  }
  return plan;
}

/** Eventos que tocan algún día del rango. */
export const eventsInRange = (events: LocalCalendarEvent[], { start, end }: DayRange): LocalCalendarEvent[] =>
  events.filter((event) => eventEnd(event) >= start && event.date <= end);
