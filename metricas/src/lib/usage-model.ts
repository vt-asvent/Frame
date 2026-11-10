// ============================================================
// Modelo del Panel de uso (1.6.9): todo lo que el panel y su reporte calculan
// a partir de la «foto» del servidor (`usage_snapshot`, migración 0012).
//
// La foto trae a cada estudiante con sus días activos, su serie diaria (los
// últimos 400 días) y su perfil; y los eventos de todos por día. Con eso, el
// plazo (de un día a un año, o el que se elija) y la agrupación (día, tres
// días, semana o mes) se calculan aquí, al instante, sin volver a preguntar
// al servidor. Puro: sin React ni Supabase, para poder probarlo y reutilizarlo
// en el reporte.
//
// Los días son números desde el 1-ene-2024, en la hora de Perú (`dn`).
// ============================================================

import { CONTINENT_OF, type Continent } from '@m/lib/world-map';

/** [día, minutos, sesiones, tareas, a tiempo, con plazo, alta prioridad, hábitos hechos, hábitos posibles, enfoque] */
export type DayRow = [number, number, number, number, number, number, number, number, number, number | null];

export interface SnapUser {
  id: string;
  /** Invitado. */
  g: boolean;
  /** Nombre de usuario (solo cuentas). */
  n: string | null;
  cc: string | null;
  co: string | null;
  ci: string | null;
  re: string | null;
  tz: string | null;
  la: string | null;
  lo: string | null;
  dv: string | null;
  pl: string | null;
  ve: string | null;
  fs: string;
  ls: string;
  /** Totales: minutos, sesiones, tareas, canciones, asignaturas, playlists, hábitos. */
  t: (number | null)[];
  f: Record<string, number> | null;
  st: number | null;
  bs: number | null;
  sl: number[] | null;
  fo: number[] | null;
  /** Minutos de estudio por día de la semana × hora local (168), últimos 140 días. */
  mx: number[] | null;
  a: number[];
  d: DayRow[];
  e: Record<string, number>;
  sc: Record<string, number>;
  /** Dispositivos vinculados de la cuenta (1.9.2; los invitados, 0). */
  nd?: number;
}

/** Por evento (o interfaz): [día, veces, estudiantes]. */
export type DaySeries = [number, number, number][];

export interface UsageSnapshot {
  v: 1;
  generated_at: string;
  tz: string;
  epoch: string;
  today: number;
  since: number;
  users: SnapUser[];
  ev: Record<string, DaySeries>;
  sc: Record<string, DaySeries>;
  reports: Record<string, number>;
  /** Aperturas de Frame por día de la semana × hora local de cada estudiante (168). */
  mx_open: number[];
  /** Dispositivos vinculados y abiertos en 30 días, por tipo (1.9.2). */
  devices?: { laptop: number; phone: number; tablet: number; accounts: number };
  errors: {
    open: number;
    fixed: number;
    ignored: number;
    top: { scope: string; name: string; message: string; n: number; users: number; last: string; versions: string[] }[];
  };
}

/** Detalle de un estudiante (`usage_user_detail`). */
export interface UserDetail {
  mx: number[] | null;
  /** [lunes, minutos, sesiones, días activos, tareas, a tiempo, con plazo, enfoque, hábitos %] */
  weeks: [string, number, number, number, number, number, number, number | null, number | null][];
  opens: number[];
  recent: { at: string; e: string; v: string | null; s: string | null; f: string | null; p: string | null; m: string | null }[];
}

// ------------------------------------------------------------
// Días
// ------------------------------------------------------------
const DAY_MS = 86_400_000;
const EPOCH_UTC = Date.UTC(2024, 0, 1);

/** Fecha (UTC a mediodía, para formatear sin saltos de zona) de un día del panel. */
export const dateOfDay = (dn: number): Date => new Date(EPOCH_UTC + dn * DAY_MS + 12 * 3_600_000);
export const isoOfDay = (dn: number): string => dateOfDay(dn).toISOString().slice(0, 10);

const limaDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Día del panel de un instante (en la hora de Perú, como la foto). */
export function dayOfInstant(iso: string): number {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return -1;
  const [y, m, d] = limaDay.format(new Date(time)).split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH_UTC) / DAY_MS);
}

/** Lunes de la semana de un día (el 1-ene-2024 fue lunes). */
export const mondayOf = (dn: number): number => dn - (((dn % 7) + 7) % 7);

// ------------------------------------------------------------
// Plazo y agrupación
// ------------------------------------------------------------
export interface Range {
  from: number;
  to: number;
}

export type Preset = '1' | '3' | '7' | '30' | '90' | '365' | 'custom';
export type Grouping = 'day' | '3days' | 'week' | 'month';

export function presetRange(snapshot: UsageSnapshot, preset: Exclude<Preset, 'custom'>): Range {
  const days = Number(preset);
  return { from: Math.max(snapshot.since, snapshot.today - days + 1), to: snapshot.today };
}

export const rangeLength = (range: Range) => range.to - range.from + 1;
export const inRange = (range: Range, dn: number) => dn >= range.from && dn <= range.to;

/** La agrupación que mejor se lee para un plazo (la persona puede cambiarla). */
export function naturalGrouping(range: Range): Grouping {
  const days = rangeLength(range);
  if (days <= 31) return 'day';
  if (days <= 92) return '3days';
  if (days <= 200) return 'week';
  return 'month';
}

export interface Bucket {
  from: number;
  to: number;
}

/** Los tramos de un plazo según la agrupación (el último puede quedar corto). */
export function bucketsOf(range: Range, grouping: Grouping): Bucket[] {
  const out: Bucket[] = [];
  if (grouping === 'month') {
    let start = range.from;
    while (start <= range.to) {
      const date = dateOfDay(start);
      const next = Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - EPOCH_UTC) / DAY_MS);
      out.push({ from: start, to: Math.min(range.to, next - 1) });
      start = next;
    }
    return out;
  }
  const step = grouping === 'day' ? 1 : grouping === '3days' ? 3 : 7;
  // Las semanas empiezan en lunes; los demás tramos, al inicio del plazo.
  let start = grouping === 'week' ? mondayOf(range.from) : range.from;
  while (start <= range.to) {
    out.push({ from: Math.max(start, range.from), to: Math.min(range.to, start + step - 1) });
    start += step;
  }
  return out;
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
export const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** ¿Estuvo activo en el plazo? (búsqueda binaria: los días van ordenados) */
export function activeIn(user: SnapUser, range: Range): boolean {
  const days = user.a;
  let lo = 0;
  let hi = days.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (days[mid] < range.from) lo = mid + 1;
    else if (days[mid] > range.to) hi = mid - 1;
    else return true;
  }
  return false;
}

export const activeDaysIn = (user: SnapUser, range: Range) => user.a.filter((dn) => inRange(range, dn)).length;

/** Primer día del estudiante en Frame (lo primero que se sabe de él). */
export function firstDayOf(user: SnapUser): number {
  const seen = dayOfInstant(user.fs);
  return user.a.length > 0 ? Math.min(user.a[0], seen < 0 ? Infinity : seen) : seen;
}

// Los ids de invitado empiezan por la hora en que se crearon: el final distingue mejor.
export const displayName = (user: SnapUser, guestLabel: string) => user.n?.trim() || `${guestLabel} · ${user.id.slice(-6)}`;

// ------------------------------------------------------------
// Lo que hizo un estudiante en un plazo
// ------------------------------------------------------------
export interface Activity {
  minutes: number;
  sessions: number;
  tasks: number;
  onTime: number;
  withDue: number;
  high: number;
  habitsDone: number;
  habitsPossible: number;
  focusSum: number;
  focusDays: number;
  activeDays: number;
  opens: number;
}

const emptyActivity = (): Activity => ({
  minutes: 0, sessions: 0, tasks: 0, onTime: 0, withDue: 0, high: 0,
  habitsDone: 0, habitsPossible: 0, focusSum: 0, focusDays: 0, activeDays: 0, opens: 0,
});

export function activityOf(user: SnapUser, range: Range): Activity {
  const out = emptyActivity();
  for (const [dn, m, s, t, to, td, th, hd, hp, f] of user.d) {
    if (!inRange(range, dn)) continue;
    out.minutes += m;
    out.sessions += s;
    out.tasks += t;
    out.onTime += to;
    out.withDue += td;
    out.high += th;
    out.habitsDone += hd;
    out.habitsPossible += hp;
    if (f !== null && f !== undefined) {
      out.focusSum += Number(f);
      out.focusDays += 1;
    }
  }
  out.activeDays = activeDaysIn(user, range);
  return out;
}

function addActivity(into: Activity, part: Activity) {
  for (const key of Object.keys(into) as (keyof Activity)[]) into[key] += part[key];
}

// ------------------------------------------------------------
// Nivel de actividad
// ------------------------------------------------------------
export type Level = 'high' | 'mid' | 'low' | 'none';

/** Muy activo: la mitad de los días o más · Activo: uno de cada cinco · Ocasional: alguno · Inactivo: ninguno. */
export function levelOf(user: SnapUser, range: Range): Level {
  const days = activeDaysIn(user, range);
  if (days === 0) return 'none';
  const share = days / rangeLength(range);
  return share >= 0.5 ? 'high' : share >= 0.2 ? 'mid' : 'low';
}

// ------------------------------------------------------------
// Resumen del plazo
// ------------------------------------------------------------
export interface Summary {
  users: number;
  accounts: number;
  guests: number;
  newUsers: number;
  active: number;
  activeToday: number;
  active7: number;
  active30: number;
  avgDaily: number;
  /** Activos de media al día / activos en 30 días (%). */
  stickiness: number | null;
  activity: Activity;
  onTimePct: number | null;
  habitsPct: number | null;
  focusAvg: number | null;
  minutesPerActive: number | null;
  countries: number;
  cities: number;
  levels: Record<Level, number>;
  studyBuckets: { none: number; lt1h: number; h1_5: number; h5_20: number; h20: number };
}

export function summarize(snapshot: UsageSnapshot, range: Range, users = snapshot.users): Summary {
  const today = snapshot.today;
  const last = (days: number): Range => ({ from: today - days + 1, to: today });
  const activity = emptyActivity();
  const levels: Record<Level, number> = { high: 0, mid: 0, low: 0, none: 0 };
  const studyBuckets = { none: 0, lt1h: 0, h1_5: 0, h5_20: 0, h20: 0 };
  let active = 0;
  let newUsers = 0;
  for (const user of users) {
    addActivity(activity, activityOf(user, range));
    if (activeIn(user, range)) active += 1;
    if (inRange(range, firstDayOf(user))) newUsers += 1;
    levels[levelOf(user, range)] += 1;
    const minutes = user.t[0] ?? 0;
    if (minutes <= 0) studyBuckets.none += 1;
    else if (minutes < 60) studyBuckets.lt1h += 1;
    else if (minutes < 300) studyBuckets.h1_5 += 1;
    else if (minutes < 1200) studyBuckets.h5_20 += 1;
    else studyBuckets.h20 += 1;
  }
  activity.opens = sum((snapshot.ev.app_open ?? []).filter(([dn]) => inRange(range, dn)).map(([, n]) => n));
  // Activos de media al día en el plazo.
  let daily = 0;
  for (let dn = range.from; dn <= range.to; dn++) daily += users.filter((user) => activeIn(user, { from: dn, to: dn })).length;
  const avgDaily = daily / rangeLength(range);
  const active30 = users.filter((user) => activeIn(user, last(30))).length;
  return {
    users: users.length,
    accounts: users.filter((user) => !user.g).length,
    guests: users.filter((user) => user.g).length,
    newUsers,
    active,
    activeToday: users.filter((user) => activeIn(user, last(1))).length,
    active7: users.filter((user) => activeIn(user, last(7))).length,
    active30,
    avgDaily,
    stickiness: active30 > 0 ? Math.round((avgDaily / active30) * 100) : null,
    activity,
    onTimePct: pct(activity.onTime, activity.withDue),
    habitsPct: pct(activity.habitsDone, activity.habitsPossible),
    focusAvg: activity.focusDays > 0 ? Math.round((activity.focusSum / activity.focusDays) * 10) / 10 : null,
    minutesPerActive: active > 0 ? Math.round(activity.minutes / active) : null,
    countries: new Set(users.map((user) => user.cc).filter(Boolean)).size,
    cities: new Set(users.filter((user) => user.ci).map((user) => `${user.cc}|${user.ci}`)).size,
    levels,
    studyBuckets,
  };
}

// ------------------------------------------------------------
// Serie por tramos (gráficos)
// ------------------------------------------------------------
export interface SeriesPoint extends Bucket {
  active: number;
  newUsers: number;
  minutes: number;
  sessions: number;
  tasks: number;
  opens: number;
  habitsPct: number | null;
  focus: number | null;
}

export function seriesOf(snapshot: UsageSnapshot, range: Range, grouping: Grouping, users = snapshot.users): SeriesPoint[] {
  // Una sola pasada por estudiante (no una por tramo): con miles de
  // estudiantes y un año por días, recorrerlo todo en cada tramo eran decenas
  // de millones de operaciones en cada cambio de plazo.
  const buckets = bucketsOf(range, grouping);
  const slot = new Int32Array(rangeLength(range));
  buckets.forEach((bucket, i) => slot.fill(i, bucket.from - range.from, bucket.to - range.from + 1));
  const parts = buckets.map(() => ({ ...emptyActivity(), active: 0, newUsers: 0 }));
  for (const user of users) {
    for (const [dn, m, s, t, , , , hd, hp, f] of user.d) {
      if (!inRange(range, dn)) continue;
      const part = parts[slot[dn - range.from]];
      part.minutes += m;
      part.sessions += s;
      part.tasks += t;
      part.habitsDone += hd;
      part.habitsPossible += hp;
      if (f !== null && f !== undefined) {
        part.focusSum += Number(f);
        part.focusDays += 1;
      }
    }
    // Los días activos van ordenados: cada tramo se cuenta una vez por estudiante.
    let last = -1;
    for (const dn of user.a) {
      if (!inRange(range, dn)) continue;
      const index = slot[dn - range.from];
      if (index !== last) parts[index].active += 1;
      last = index;
    }
    const first = firstDayOf(user);
    if (inRange(range, first)) parts[slot[first - range.from]].newUsers += 1;
  }
  for (const [dn, n] of snapshot.ev.app_open ?? []) if (inRange(range, dn)) parts[slot[dn - range.from]].opens += n;
  return buckets.map((bucket, i) => {
    const part = parts[i];
    return {
      ...bucket,
      active: part.active,
      newUsers: part.newUsers,
      minutes: Math.round(part.minutes),
      sessions: part.sessions,
      tasks: part.tasks,
      opens: part.opens,
      habitsPct: pct(part.habitsDone, part.habitsPossible),
      focus: part.focusDays > 0 ? Math.round((part.focusSum / part.focusDays) * 10) / 10 : null,
    };
  });
}

/** Activos en 1, 7 y 30 días a cada día del plazo (DAU / WAU / MAU). */
export function stickinessSeries(snapshot: UsageSnapshot, range: Range, users = snapshot.users) {
  // Cada día activo de un estudiante lo hace activo «de 7 días» los 7 días
  // siguientes y «de 30» los 30: se marcan esos tramos (sin repetir) y se suman.
  const days = rangeLength(range);
  const dau = new Int32Array(days);
  const wau = new Int32Array(days + 1);
  const mau = new Int32Array(days + 1);
  for (const user of users) {
    let until7 = -1;
    let until30 = -1;
    for (const dn of user.a) {
      if (dn > range.to) break;
      if (dn >= range.from) dau[dn - range.from] += 1;
      // [dn, dn + 6] y [dn, dn + 29], recortados al plazo y sin solaparse con lo ya marcado.
      const mark = (array: Int32Array, from: number, to: number) => {
        const a = Math.max(from, range.from) - range.from;
        const b = Math.min(to, range.to) - range.from;
        if (a > b) return;
        array[a] += 1;
        array[b + 1] -= 1;
      };
      mark(wau, Math.max(dn, until7 + 1), dn + 6);
      until7 = Math.max(until7, dn + 6);
      mark(mau, Math.max(dn, until30 + 1), dn + 29);
      until30 = Math.max(until30, dn + 29);
    }
  }
  const out: { dn: number; dau: number; wau: number; mau: number }[] = [];
  let week = 0;
  let month = 0;
  for (let i = 0; i < days; i++) {
    week += wau[i];
    month += mau[i];
    out.push({ dn: range.from + i, dau: dau[i], wau: week, mau: month });
  }
  return out;
}

// ------------------------------------------------------------
// Geografía
// ------------------------------------------------------------
export const continentOf = (code: string | null | undefined): Continent | null => (code ? CONTINENT_OF[code] ?? null : null);

export interface PlaceGroup {
  key: string;
  users: number;
  active: number;
  minutes: number;
  members: SnapUser[];
}

function groupBy(users: SnapUser[], range: Range, keyOf: (user: SnapUser) => string): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const user of users) {
    const key = keyOf(user);
    const group = groups.get(key) ?? { key, users: 0, active: 0, minutes: 0, members: [] };
    group.users += 1;
    if (activeIn(user, range)) group.active += 1;
    group.minutes += activityOf(user, range).minutes;
    group.members.push(user);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.users - a.users || b.active - a.active || a.key.localeCompare(b.key));
}

export const UNKNOWN = '?';
export const byContinent = (users: SnapUser[], range: Range) => groupBy(users, range, (user) => continentOf(user.cc) ?? UNKNOWN);
export const byCountry = (users: SnapUser[], range: Range) => groupBy(users, range, (user) => user.cc ?? UNKNOWN);
export const byCity = (users: SnapUser[], range: Range) => groupBy(users, range, (user) => user.ci?.trim() || UNKNOWN);

// ------------------------------------------------------------
// Repartos (sectores)
// ------------------------------------------------------------
export function countBy<T extends string>(users: SnapUser[], keyOf: (user: SnapUser) => T | null | undefined): { key: T | typeof UNKNOWN; value: number }[] {
  const counts = new Map<string, number>();
  for (const user of users) {
    const key = keyOf(user) ?? UNKNOWN;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, value]) => ({ key: key as T, value })).sort((a, b) => b.value - a.value);
}

// ------------------------------------------------------------
// Cuándo estudian
// ------------------------------------------------------------
export function sumMatrices(matrices: (number[] | null | undefined)[], size: number): number[] {
  const out = new Array<number>(size).fill(0);
  for (const matrix of matrices) if (matrix && matrix.length === size) for (let i = 0; i < size; i++) out[i] += matrix[i] || 0;
  return out;
}

/** Por hora del día (24) y por día de la semana (7, lunes primero). */
export function hoursOf(matrix: number[]): number[] {
  return Array.from({ length: 24 }, (_, hour) => sum(Array.from({ length: 7 }, (_, day) => matrix[day * 24 + hour] ?? 0)));
}
export function weekdaysOf(matrix: number[]): number[] {
  return Array.from({ length: 7 }, (_, day) => sum(matrix.slice(day * 24, day * 24 + 24)));
}

/** La franja con más estudio: «19:00–22:00» (tres horas seguidas). */
export function peakWindow(matrix: number[]): { start: number; share: number } | null {
  const hours = hoursOf(matrix);
  const total = sum(hours);
  if (total <= 0) return null;
  let best = 0;
  let start = 0;
  for (let hour = 0; hour < 24; hour++) {
    const window = hours[hour] + hours[(hour + 1) % 24] + hours[(hour + 2) % 24];
    if (window > best) {
      best = window;
      start = hour;
    }
  }
  return { start, share: Math.round((best / total) * 100) };
}

// ------------------------------------------------------------
// Retención por cohortes semanales
// ------------------------------------------------------------
export interface Cohort {
  monday: number;
  size: number;
  /** Porcentaje de la cohorte activo en la semana 0, 1, 2… (null: aún no llega). */
  weeks: (number | null)[];
}

export function cohortsOf(snapshot: UsageSnapshot, weeks = 12, users = snapshot.users): Cohort[] {
  const thisMonday = mondayOf(snapshot.today);
  const out: Cohort[] = [];
  for (let back = weeks - 1; back >= 0; back--) {
    const monday = thisMonday - back * 7;
    const members = users.filter((user) => {
      const first = firstDayOf(user);
      return first >= monday && first <= monday + 6;
    });
    const row: (number | null)[] = [];
    for (let week = 0; week < weeks; week++) {
      const start = monday + week * 7;
      if (start > snapshot.today) {
        row.push(null);
        continue;
      }
      const active = members.filter((user) => activeIn(user, { from: start, to: start + 6 })).length;
      row.push(members.length > 0 ? Math.round((active / members.length) * 100) : null);
    }
    out.push({ monday, size: members.length, weeks: row });
  }
  return out;
}

/** Vuelven a la semana siguiente a su primera semana (de quienes ya la cumplieron). */
export function weekTwoReturn(snapshot: UsageSnapshot, users = snapshot.users): { eligible: number; returned: number; pct: number | null } {
  let eligible = 0;
  let returned = 0;
  for (const user of users) {
    const first = firstDayOf(user);
    if (first < 0 || first + 13 > snapshot.today) continue;
    eligible += 1;
    if (activeIn(user, { from: first + 7, to: first + 13 })) returned += 1;
  }
  return { eligible, returned, pct: pct(returned, eligible) };
}

/** Quienes llevan un tiempo sin abrir Frame (de los que alguna vez lo usaron). */
export function dormant(snapshot: UsageSnapshot, users = snapshot.users) {
  const lastDay = (user: SnapUser) => (user.a.length > 0 ? user.a[user.a.length - 1] : dayOfInstant(user.ls));
  return {
    d14: users.filter((user) => snapshot.today - lastDay(user) >= 14).length,
    d30: users.filter((user) => snapshot.today - lastDay(user) >= 30).length,
  };
}

// ------------------------------------------------------------
// Funciones
// ------------------------------------------------------------
/** Las funciones de Frame que el panel cuenta: clave del perfil → total del estudiante. */
export const FEATURE_KEYS = [
  'courses', 'pending_tasks', 'notes', 'loose_notes', 'events', 'painted_days', 'collections', 'videos', 'recordings',
  'active_habits', 'playlists', 'songs', 'favorites', 'gallery_images', 'own_images', 'day_grades', 'competencies',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export function featureValue(user: SnapUser, key: FeatureKey): number {
  if (key === 'courses') return user.t[4] ?? 0;
  if (key === 'playlists') return user.t[5] ?? 0;
  if (key === 'songs') return user.t[3] ?? 0;
  return user.f?.[key] ?? 0;
}

export interface Adoption {
  key: FeatureKey;
  users: number;
  pct: number;
  total: number;
}

/** Cuántos estudiantes usan cada función (de los que ya mandaron su perfil). */
export function adoptionOf(users: SnapUser[]): Adoption[] {
  // Las tres primeras van en los totales de siempre; las demás, en el perfil
  // (1.6.9): quien aún no lo mandó no cuenta ni a favor ni en contra.
  const withProfile = users.filter((user) => user.f !== null);
  return FEATURE_KEYS.map((key) => {
    const pool = key === 'courses' || key === 'playlists' || key === 'songs' ? users : withProfile;
    const using = pool.filter((user) => featureValue(user, key) > 0);
    return { key, users: using.length, pct: pool.length > 0 ? Math.round((using.length / pool.length) * 100) : 0, total: sum(pool.map((user) => featureValue(user, key))) };
  }).sort((a, b) => b.pct - a.pct || b.total - a.total);
}

/** Veces en el plazo de cada interfaz (o evento) y en cuántos días se usó. */
export function seriesTotals(series: Record<string, DaySeries>, range: Range): { key: string; count: number; days: number }[] {
  return Object.entries(series)
    .map(([key, days]) => {
      const inside = days.filter(([dn]) => inRange(range, dn));
      return { key, count: sum(inside.map(([, n]) => n)), days: inside.length };
    })
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------
// Versiones
// ------------------------------------------------------------
export const compareVersions = (a: string, b: string) => {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** La versión más nueva vista en cada sistema. */
export function newestVersions(users: SnapUser[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const user of users) {
    if (!user.pl || !user.ve) continue;
    if (!out[user.pl] || compareVersions(user.ve, out[user.pl]) > 0) out[user.pl] = user.ve;
  }
  return out;
}

export const isOutdated = (user: SnapUser, newest: Record<string, string>) =>
  !!(user.ve && user.pl && newest[user.pl] && compareVersions(user.ve, newest[user.pl]) < 0);
