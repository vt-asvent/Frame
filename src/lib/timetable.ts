import { useCallback, useEffect, useMemo, useState } from 'react';
import { deleteImage, saveImage } from '@/lib/music-db';
import { scheduleImageKey } from '@/lib/profile-scope';
import { CLOUD_APPLIED_EVENT, hasTombstone } from '@/lib/sync-merge';
import { intlLocale } from '@/lib/i18n';

// ============================================================
// Horario de Inicio (1.9.0, Diego).
//
// Cada horario es la foto que el usuario sube para un MES («Noviembre»; si
// hay varios en el mismo mes, «Noviembre 1», «Noviembre 2»…) y las clases que
// Frame lee de ella (timetable-read.ts). Viaja entre dispositivos: las fichas
// en el respaldo (`timetables`, colección por id) y la foto con image-sync
// (`timetableImage_<id>`). La foto única de antes (`scheduleImage`) pasa a ser
// el primer horario, sin copiarla: su ficha la nombra.
//
// Qué horario se ve es cosa de cada dispositivo (`timetableSelected_<uid>`).
// ============================================================

export interface TimetableClass {
  /** 1 = lunes … 7 = domingo. */
  day: number;
  /** «HH:MM», 24 h. */
  start: string;
  end: string;
  subject: string;
  room?: string;
  teacher?: string;
}

export type ReadState = 'pending' | 'done' | 'failed';

export interface Timetable {
  id: string;
  /** «YYYY-MM» */
  month: string;
  createdAt: number;
  /** Clave lógica de la foto: 'scheduleImage' (la de antes) o `timetableImage_<id>`. */
  image: string;
  classes: TimetableClass[];
  /** pending: aún sin leer; failed: no se pudo (se puede reintentar). */
  read: ReadState;
  error?: string;
}

export const TIMETABLES_CHANGED = 'frame:timetables-changed';
const LEGACY_ID = 'horario-anterior';
const listKey = (uid: string) => `timetables_${uid}`;
const selectedKey = (uid: string) => `timetableSelected_${uid}`;
export const timetableImageKey = (id: string) => `timetableImage_${id}`;

/** Clave en el almacén local de la foto de un horario. */
export const localImageKey = (uid: string, timetable: Pick<Timetable, 'image'>) =>
  timetable.image === 'scheduleImage' ? scheduleImageKey(uid) : timetable.image;

// ------------------------------------------------------------
// Horas
// ------------------------------------------------------------

const TIME = /^(\d{1,2}):(\d{2})$/;

/** «8:05» → 485 (minutos desde medianoche), o null. */
export function minutesOf(time: string): number | null {
  const match = TIME.exec(time.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export const timeOf = (minutes: number) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
const padTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

// ------------------------------------------------------------
// Lectura y escritura
// ------------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Una clase válida, con sus horas normalizadas, o null. */
export function cleanClass(raw: unknown): TimetableClass | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const day = Number(value.day);
  const start = minutesOf(String(value.start ?? ''));
  const end = minutesOf(String(value.end ?? ''));
  const subject = text(value.subject, 80);
  if (!Number.isInteger(day) || day < 1 || day > 7 || start == null || end == null || end <= start || !subject) return null;
  const room = text(value.room, 40);
  const teacher = text(value.teacher, 60);
  return { day, start: padTime(start), end: padTime(end), subject, ...(room ? { room } : {}), ...(teacher ? { teacher } : {}) };
}

const sameSubject = (a: string, b: string) => normalize(a) === normalize(b);

/** Normaliza para comparar nombres («Matemática» ≈ «matematica»). */
export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Ordena y une los bloques seguidos de la misma asignatura (cuatro horas de
 * Historia desde las 8 son UNA tarjeta de 8:00 a 12:00). Un hueco de hasta
 * 5 minutos (el cambio de aula) no las separa.
 */
export function tidyClasses(classes: TimetableClass[]): TimetableClass[] {
  const sorted = classes
    .map(cleanClass)
    .filter((item): item is TimetableClass => item !== null)
    .sort((a, b) => a.day - b.day || minutesOf(a.start)! - minutesOf(b.start)!);
  const out: TimetableClass[] = [];
  for (const item of sorted) {
    const last = out[out.length - 1];
    if (
      last &&
      last.day === item.day &&
      sameSubject(last.subject, item.subject) &&
      (last.room ?? '') === (item.room ?? '') &&
      minutesOf(item.start)! - minutesOf(last.end)! <= 5 &&
      minutesOf(item.start)! >= minutesOf(last.start)!
    ) {
      if (minutesOf(item.end)! > minutesOf(last.end)!) last.end = item.end;
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

function sanitize(raw: unknown): Timetable | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const id = text(value.id, 64);
  const month = typeof value.month === 'string' && /^\d{4}-\d{2}$/.test(value.month) ? value.month : '';
  const image = text(value.image, 120);
  if (!id || !month || !image) return null;
  const read: ReadState = value.read === 'done' || value.read === 'failed' ? value.read : 'pending';
  return {
    id,
    month,
    createdAt: Number(value.createdAt) || 0,
    image,
    classes: Array.isArray(value.classes) ? value.classes.map(cleanClass).filter((item): item is TimetableClass => item !== null) : [],
    read,
    ...(read === 'failed' && typeof value.error === 'string' ? { error: value.error.slice(0, 200) } : {}),
  };
}

export function readTimetables(uid: string): Timetable[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(listKey(uid)) ?? '[]');
    return Array.isArray(parsed) ? parsed.map(sanitize).filter((item): item is Timetable => item !== null) : [];
  } catch {
    return [];
  }
}

function writeTimetables(uid: string, list: Timetable[]): void {
  localStorage.setItem(listKey(uid), JSON.stringify(list));
  changed();
}

/** Avisa a Inicio y al vigilante del vistazo del borde izquierdo (layout.tsx). */
function changed(): void {
  window.dispatchEvent(new Event(TIMETABLES_CHANGED));
  window.dispatchEvent(new Event('scheduleImageUpdated'));
}

export function updateTimetable(uid: string, id: string, patch: Partial<Omit<Timetable, 'id'>>): void {
  writeTimetables(
    uid,
    readTimetables(uid).map((item) => {
      if (item.id !== id) return item;
      const next = { ...item, ...patch };
      if (next.read !== 'failed') delete next.error;
      return next;
    })
  );
}

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** Guarda la foto y la ficha de un horario nuevo (sin leer aún). */
export async function addTimetable(uid: string, month: string, dataUrl: string): Promise<Timetable> {
  const id = newId();
  const timetable: Timetable = { id, month, createdAt: Date.now(), image: timetableImageKey(id), classes: [], read: 'pending' };
  // La ficha antes que la foto: image-sync solo sube la foto de un horario que ya es de este perfil.
  writeTimetables(uid, [...readTimetables(uid), timetable]);
  try {
    await saveImage(timetable.image, dataUrl);
  } catch (error) {
    writeTimetables(uid, readTimetables(uid).filter((item) => item.id !== id));
    throw error;
  }
  selectTimetable(uid, id);
  return timetable;
}

export async function removeTimetable(uid: string, id: string): Promise<void> {
  const list = readTimetables(uid);
  const gone = list.find((item) => item.id === id);
  if (!gone) return;
  writeTimetables(
    uid,
    list.filter((item) => item.id !== id)
  );
  // La foto de antes de la 1.9.0 la sigue usando el vistazo del borde
  // izquierdo de Frame con su clave de siempre: se borra igual, es la misma.
  await deleteImage(localImageKey(uid, gone)).catch(() => undefined);
}

export function selectTimetable(uid: string, id: string | null): void {
  try {
    if (id) localStorage.setItem(selectedKey(uid), id);
    else localStorage.removeItem(selectedKey(uid));
  } catch {
    /* sin almacenamiento: se queda el de por defecto */
  }
  changed();
}

/**
 * La foto única de antes (1.6.7–1.8.x) pasa a ser el primer horario, con el
 * mes en que se subió. Id fijo: si dos dispositivos la convierten a la vez,
 * la fusión las junta en una sola ficha.
 */
export function migrateLegacySchedule(uid: string, imageAt: number | null): void {
  const list = readTimetables(uid);
  if (imageAt == null || list.some((item) => item.id === LEGACY_ID || item.image === 'scheduleImage')) return;
  // Quitado en otro dispositivo: su foto aún no se borró aquí, pero no vuelve.
  if (hasTombstone(uid, 'timetables', LEGACY_ID)) return;
  const when = new Date(imageAt > 0 ? imageAt : Date.now());
  writeTimetables(uid, [
    ...list,
    { id: LEGACY_ID, month: monthKey(when), createdAt: imageAt > 0 ? imageAt : Date.now(), image: 'scheduleImage', classes: [], read: 'pending' },
  ]);
}

// ------------------------------------------------------------
// Meses y nombres
// ------------------------------------------------------------

export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export function monthName(month: string, withYear = false): string {
  const [year, number] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat(intlLocale(), withYear ? { month: 'long', year: 'numeric' } : { month: 'long' }).format(new Date(year, number - 1, 1));
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Orden: por mes y, dentro de cada mes, por fecha de subida. */
export const byMonth = (a: Timetable, b: Timetable) => a.month.localeCompare(b.month) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);

/** «Noviembre», o «Noviembre 1», «Noviembre 2»… si el mes tiene varios. Con año si no es el actual. */
export function timetableLabels(list: Timetable[], now = new Date()): Map<string, string> {
  const labels = new Map<string, string>();
  const thisYear = String(now.getFullYear());
  const groups = new Map<string, Timetable[]>();
  for (const item of [...list].sort(byMonth)) groups.set(item.month, [...(groups.get(item.month) ?? []), item]);
  for (const [month, items] of groups) {
    const name = monthName(month, !month.startsWith(thisYear));
    items.forEach((item, index) => labels.set(item.id, items.length > 1 ? `${name} ${index + 1}` : name));
  }
  return labels;
}

/** El que se ve si el usuario no eligió otro: el último del mes en curso, o el del último mes anterior. */
export function defaultTimetable(list: Timetable[], now = new Date()): Timetable | null {
  if (list.length === 0) return null;
  const current = monthKey(now);
  const sorted = [...list].sort(byMonth);
  const upToNow = sorted.filter((item) => item.month <= current);
  return upToNow[upToNow.length - 1] ?? sorted[0];
}

function selectedId(uid: string): string | null {
  try {
    return localStorage.getItem(selectedKey(uid));
  } catch {
    return null;
  }
}

/** La foto del horario que se ve: la del vistazo del borde izquierdo. Sin horarios, la de antes. */
export function currentTimetableImageKey(uid: string): string {
  const list = readTimetables(uid);
  const id = selectedId(uid);
  const chosen = list.find((item) => item.id === id) ?? defaultTimetable(list);
  return chosen ? localImageKey(uid, chosen) : scheduleImageKey(uid);
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useTimetables(uid: string | null) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((value) => value + 1);
    window.addEventListener(TIMETABLES_CHANGED, bump);
    window.addEventListener(CLOUD_APPLIED_EVENT, bump);
    window.addEventListener('storage', bump);
    return () => {
      window.removeEventListener(TIMETABLES_CHANGED, bump);
      window.removeEventListener(CLOUD_APPLIED_EVENT, bump);
      window.removeEventListener('storage', bump);
    };
  }, []);

  const list = useMemo(() => (uid ? readTimetables(uid).sort(byMonth) : []), [uid, version]);
  const chosenId = useMemo(() => (uid ? selectedId(uid) : null), [uid, version]);
  const selected = list.find((item) => item.id === chosenId) ?? defaultTimetable(list);
  const labels = useMemo(() => timetableLabels(list), [list]);
  const select = useCallback((id: string) => uid && selectTimetable(uid, id), [uid]);
  return { list, selected, labels, select };
}

// ------------------------------------------------------------
// La línea de tiempo de Inicio
// ------------------------------------------------------------

/** La hora, al día cada `stepMs`. */
export function useNow(stepMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), stepMs);
    return () => window.clearInterval(timer);
  }, [stepMs]);
  return now;
}

export const startOfDay = (ms: number) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

export const minutesOfDay = (ms: number) => {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
};

export interface Occurrence {
  key: string;
  item: TimetableClass;
  /** Inicio y fin, en ms. */
  start: number;
  end: number;
}

/** Las clases de `days` días seguidos desde `from` (a medianoche), en orden. */
export function occurrences(classes: TimetableClass[], from: Date, days: number): Occurrence[] {
  const out: Occurrence[] = [];
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let offset = 0; offset < days; offset++) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const weekday = ((date.getDay() + 6) % 7) + 1;
    for (const item of classes) {
      if (item.day !== weekday) continue;
      const start = minutesOf(item.start)!;
      const end = minutesOf(item.end)!;
      out.push({
        key: `${date.toDateString()}-${item.start}-${item.subject}`,
        item,
        start: date.getTime() + start * 60_000,
        end: date.getTime() + end * 60_000,
      });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.end - b.end);
}

/**
 * Dónde cae `now` en una pista de tarjetas de ancho `card` separadas por
 * `gap`: dentro de una clase, en proporción a lo que va de ella (a las 9, en
 * una de 8 a 12, a un cuarto de la tarjeta); en un descanso, en proporción
 * dentro del hueco.
 */
export function trackPosition(list: Occurrence[], now: number, card: number, gap: number): number {
  if (list.length === 0) return 0;
  const step = card + gap;
  if (now <= list[0].start) return 0;
  for (let i = 0; i < list.length; i++) {
    const current = list[i];
    const next = list[i + 1];
    const left = i * step;
    if (now < current.end && (!next || now < next.start)) {
      const span = Math.max(1, current.end - current.start);
      return left + card * Math.min(1, Math.max(0, (now - current.start) / span));
    }
    if (!next) return left + card;
    if (now < next.start) {
      const span = Math.max(1, next.start - current.end);
      return left + card + gap * Math.min(1, Math.max(0, (now - current.end) / span));
    }
  }
  return (list.length - 1) * step + card;
}

/** Días de la semana que muestra la vista semanal: de lunes al último con clase (al menos hasta el viernes). */
export function weekDays(classes: TimetableClass[]): number[] {
  const last = Math.max(5, ...classes.map((item) => item.day));
  return Array.from({ length: last }, (_, index) => index + 1);
}

/** Color estable de una asignatura (misma asignatura, mismo color en todo Frame). */
const PALETTE = ['#4F7DF3', '#E5735B', '#3BAA7E', '#B562D6', '#E3A33B', '#2FA6B8', '#D9578A', '#7C8C3A', '#6C6FE0', '#C7743C'];
export function subjectColor(subject: string): string {
  let hash = 0;
  for (const char of normalize(subject)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}
