import { useSyncExternalStore } from 'react';
import { CLOUD_APPLIED_EVENT } from '@/lib/sync-merge';
import { courseForSubject, normalize, type TimetableClass } from '@/lib/timetable';

// ============================================================
// Qué asignatura de Frame es cada nombre del horario (1.9.3, Diego).
//
// El horario dice «Mat. AyE» y la asignatura de Frame se llama «Matemática»:
// comparar los nombres no basta. Cada nombre del horario guarda aquí su
// asignatura (por su id: cambiarle el nombre no rompe el vínculo), y vale para
// todos los horarios de la cuenta, también el del mes que viene.
//
// El vínculo lo pone, por este orden: el propio usuario (toca la tarjeta y
// elige), el nombre idéntico, la IA que leyó la foto (nube-ia/horario.ts, que
// recibe los nombres de las asignaturas) y el parecido de siempre
// (`courseForSubject`). Lo que nadie supo vincular se pregunta una sola vez,
// al terminar de leer la foto.
//
// Viaja con la cuenta: colección `subjectLinks`, una ficha por nombre
// (id = el nombre normalizado). `courseId` vacío = «ninguna», dicho por el
// usuario. Sin ficha, decide el parecido.
// ============================================================

export interface SubjectLink {
  id: string;
  courseId: string;
}

const linksKey = (uid: string) => `subjectLinks_${uid}`;
const EMPTY: ReadonlyMap<string, string> = new Map();
const listeners = new Set<() => void>();
let cache: { key: string; raw: string | null; map: ReadonlyMap<string, string> } | null = null;

function read(uid: string | null | undefined): ReadonlyMap<string, string> {
  if (!uid) return EMPTY;
  const key = linksKey(uid);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* sin almacenamiento: sin vínculos guardados */
  }
  if (cache && cache.key === key && cache.raw === raw) return cache.map;
  const map = new Map<string, string>();
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      for (const entry of list) {
        const value = entry as { id?: unknown; courseId?: unknown } | null;
        if (typeof value?.id === 'string' && value.id && typeof value.courseId === 'string') map.set(value.id, value.courseId);
      }
    }
  } catch {
    /* ilegible: como si no hubiera */
  }
  cache = { key, raw, map };
  return map;
}

function write(uid: string, map: ReadonlyMap<string, string>): void {
  try {
    // Ordenadas: el mismo conjunto se escribe igual en todos los dispositivos.
    const list: SubjectLink[] = [...map].sort(([a], [b]) => a.localeCompare(b)).map(([id, courseId]) => ({ id, courseId }));
    localStorage.setItem(linksKey(uid), JSON.stringify(list));
  } catch {
    /* el equipo sin espacio: el vínculo vale hasta cerrar */
  }
  listeners.forEach((fn) => fn());
}

/** Los vínculos de la cuenta: nombre del horario (normalizado) → id de la asignatura ('' = ninguna). */
export function useSubjectLinks(uid: string | null | undefined): ReadonlyMap<string, string> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      window.addEventListener(CLOUD_APPLIED_EVENT, fn);
      return () => {
        listeners.delete(fn);
        window.removeEventListener(CLOUD_APPLIED_EVENT, fn);
      };
    },
    () => read(uid),
    () => read(uid)
  );
}

export const readSubjectLinks = (uid: string): ReadonlyMap<string, string> => read(uid);

/** Vincula un nombre del horario con una asignatura; `null` = «ninguna». */
export function setSubjectLink(uid: string, subject: string, courseId: string | null): void {
  const id = normalize(subject);
  if (!id) return;
  const next = new Map(read(uid));
  next.set(id, courseId ?? '');
  write(uid, next);
}

/** Varios a la vez (lo que resolvió la lectura de la foto): una sola escritura. */
export function setSubjectLinks(uid: string, entries: readonly (readonly [subject: string, courseId: string | null])[]): void {
  if (entries.length === 0) return;
  const next = new Map(read(uid));
  for (const [subject, courseId] of entries) {
    const id = normalize(subject);
    if (id) next.set(id, courseId ?? '');
  }
  write(uid, next);
}

/**
 * La asignatura de Frame de una clase del horario: la vinculada (si sigue
 * existiendo) y, sin vínculo, la que se llama igual o casi igual.
 */
export function linkedCourse<T extends { id: string; name: string }>(courses: readonly T[], links: ReadonlyMap<string, string>, subject: string): T | null {
  const linked = links.get(normalize(subject));
  if (linked === '') return null;
  if (linked) {
    const course = courses.find((item) => item.id === linked);
    if (course) return course;
    // La asignatura vinculada se borró: decide el parecido, como si no hubiera vínculo.
  }
  return courseForSubject(courses, subject);
}

/** Los nombres distintos de un horario, en su orden y como están escritos. */
export function subjectsOf(classes: readonly TimetableClass[]): string[] {
  const seen = new Map<string, string>();
  for (const item of classes) {
    const id = normalize(item.subject);
    if (id && !seen.has(id)) seen.set(id, item.subject);
  }
  return [...seen.values()];
}

/** Los nombres del horario que siguen sin asignatura y sobre los que el usuario aún no decidió. */
export function unlinkedSubjects<T extends { id: string; name: string }>(classes: readonly TimetableClass[], courses: readonly T[], links: ReadonlyMap<string, string>): string[] {
  return subjectsOf(classes).filter((subject) => links.get(normalize(subject)) !== '' && !linkedCourse(courses, links, subject));
}

/**
 * Tras leer la foto: guarda el vínculo de cada nombre nuevo. Manda lo que el
 * usuario ya decidió; después el nombre idéntico, lo que propuso la IA (por el
 * nombre exacto de una asignatura) y, por último, el parecido.
 */
export function linkAfterReading<T extends { id: string; name: string }>(
  uid: string,
  classes: readonly TimetableClass[],
  courses: readonly T[],
  proposed: Readonly<Record<string, string>>
): void {
  const links = read(uid);
  const byName = new Map(courses.map((course) => [normalize(course.name), course] as const));
  const proposals = new Map(Object.entries(proposed).map(([subject, name]) => [normalize(subject), normalize(name)] as const));
  const found: [string, string][] = [];
  for (const subject of subjectsOf(classes)) {
    const id = normalize(subject);
    const current = links.get(id);
    // Decidido antes (por el usuario o por una lectura anterior) y la asignatura sigue ahí.
    if (current === '' || (current && courses.some((course) => course.id === current))) continue;
    const course = byName.get(id) ?? byName.get(proposals.get(id) ?? '') ?? courseForSubject(courses, subject);
    if (course) found.push([subject, course.id]);
  }
  setSubjectLinks(uid, found);
}
