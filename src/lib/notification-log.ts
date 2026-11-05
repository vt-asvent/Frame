import { useSyncExternalStore } from 'react';
import { pickLang, type Lang } from '@/lib/i18n';

// ============================================================
// Registro de notificaciones (la campana, desde la 1.6.4).
//
// Antes la campana solo calculaba lo vigente (tareas por vencer, versión
// nueva, conexión) y no guardaba nada: lo que ya había pasado desaparecía.
// Ahora cada notificación queda ANOTADA con la hora en que apareció —las
// calculadas y también las que llegan al sistema (recordatorios, fin de la
// sesión de estudio)— y se puede repasar todo el historial.
//
// Preferencias (por dispositivo): sonido sí/no y notificaciones sí/no.
// Registro (por perfil): hasta MAX entradas, de la más reciente a la más
// antigua. «Borrar todas» vacía el registro y recuerda qué notificaciones
// vigentes se borraron, para que no reaparezcan al instante.
// ============================================================

export type LogKind =
  | 'vencida'
  | 'hoy'
  | 'proxima'
  | 'actualizacion'
  | 'conexion'
  | 'recordatorio'
  | 'sesion'
  | 'aviso'
  // Verificador de sincronización (1.6.8): cuántas cosas no están sincronizadas.
  | 'sincronizacion';

export interface LogEntry {
  id: string;
  kind: LogKind;
  title: string;
  detail: string;
  /** epoch ms en que apareció. */
  at: number;
  read: boolean;
  taskId?: string;
  courseId?: string;
  /** Interfaz a la que lleva al pulsarla. */
  route?: string;
  /** El texto en varios idiomas (1.6.7; 1.7.3, también el actual): un aviso guardado se lee en el
   *  idioma de la interfaz de hoy, no en el del día en que llegó. */
  texts?: Partial<Record<Lang, EntryText>>;
}

export interface EntryText {
  title: string;
  detail: string;
}

/** Título y detalle en el idioma actual (los avisos de antes de la 1.6.7
 *  solo tienen el texto con el que llegaron). */
export const entryText = (entry: Pick<LogEntry, 'title' | 'detail' | 'texts'>): EntryText =>
  pickLang(entry.texts) ?? { title: entry.title, detail: entry.detail };

interface NotificationPrefs {
  sound: boolean;
  enabled: boolean;
}

const MAX = 200;
const PREFS_KEY = 'frameNotificationPrefs';
const logKey = (uid: string) => `frameNotificationLog_${uid}`;
const clearedKey = (uid: string) => `frameNotificationCleared_${uid}`;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento lleno: vale para esta sesión */
  }
}

// ---------------- Preferencias ----------------

let prefs: NotificationPrefs = { sound: true, enabled: true, ...readJson<Partial<NotificationPrefs>>(PREFS_KEY, {}) };

export function getNotificationPrefs(): NotificationPrefs {
  return prefs;
}

export function setNotificationPrefs(next: Partial<NotificationPrefs>) {
  prefs = { ...prefs, ...next };
  writeJson(PREFS_KEY, prefs);
  emit();
}

export function useNotificationPrefs(): NotificationPrefs {
  return useSyncExternalStore(subscribe, getNotificationPrefs, getNotificationPrefs);
}

// ---------------- Registro ----------------

/** Perfil activo: lo fija la campana al montarse (notify no lo conoce). */
let currentUser: string | null = null;
let entries: LogEntry[] = [];
let cleared = new Set<string>();

export function setNotificationUser(uid: string | null) {
  if (uid === currentUser) return;
  currentUser = uid;
  entries = uid ? readJson<LogEntry[]>(logKey(uid), []).filter((e) => e && typeof e.id === 'string') : [];
  cleared = new Set(uid ? readJson<string[]>(clearedKey(uid), []) : []);
  emit();
}

function persist() {
  if (!currentUser) return;
  entries = entries.slice(0, MAX);
  writeJson(logKey(currentUser), entries);
  writeJson(clearedKey(currentUser), [...cleared].slice(-MAX));
  emit();
}

const getEntries = () => entries;

export function useNotificationLog(): LogEntry[] {
  return useSyncExternalStore(subscribe, getEntries, getEntries);
}

/**
 * Anota las notificaciones vigentes que aún no estaban (y no se borraron).
 * `readIds`: las que ya se habían visto con el sistema anterior.
 */
export function syncCurrent(current: Omit<LogEntry, 'at' | 'read'>[], readIds?: Set<string>) {
  if (!currentUser) return;
  const known = new Set(entries.map((e) => e.id));
  const fresh = current.filter((n) => !known.has(n.id) && !cleared.has(n.id));
  // Las que siguen vigentes estrenan texto si cambió (otro idioma, otra fecha).
  const byId = new Map(current.map((n) => [n.id, n]));
  let refreshed = false;
  entries = entries.map((entry) => {
    const now = byId.get(entry.id);
    if (!now || JSON.stringify([now.title, now.detail, now.texts]) === JSON.stringify([entry.title, entry.detail, entry.texts])) return entry;
    refreshed = true;
    return { ...entry, title: now.title, detail: now.detail, texts: now.texts };
  });
  if (fresh.length === 0 && !refreshed) return;
  const at = Date.now();
  entries = [...fresh.map((n) => ({ ...n, at, read: readIds?.has(n.id) ?? false })), ...entries];
  persist();
}

/** Una notificación que llega al sistema (recordatorio, fin de sesión…). */
export function logNotification(entry: Omit<LogEntry, 'id' | 'at' | 'read'> & { id?: string }) {
  if (!currentUser) return;
  const at = Date.now();
  entries = [{ ...entry, id: entry.id ?? `${entry.kind}-${at}`, at, read: false }, ...entries];
  persist();
}

export function markRead(id: string) {
  entries = entries.map((e) => (e.id === id ? { ...e, read: true } : e));
  persist();
}

export function markAllRead() {
  entries = entries.map((e) => (e.read ? e : { ...e, read: true }));
  persist();
}

export function clearLog() {
  entries.forEach((e) => cleared.add(e.id));
  entries = [];
  persist();
}
