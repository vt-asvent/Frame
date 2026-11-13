import { useSyncExternalStore } from 'react';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { NubeAuthError, nubeCall, sessionProblemText } from '@/lib/nube';
import { activeProfileId } from '@/lib/profile-scope';
import { getSupabase } from '@/lib/supabase/client';
import { CLOUD_APPLIED_EVENT } from '@/lib/sync-merge';
import { tr } from '@/lib/i18n';

// ============================================================
// AK Lore → la Biblioteca (1.9.2): el material del Programa del Diploma que
// Asvent guarda en su Drive. La nube de Frame (nube-ia/src/biblioteca.ts) da el
// índice y pasa cada archivo: nadie recibe un enlace de Drive ni entra a ese
// Drive. Solo cuentas que la activaron con su correo institucional (1.9.4:
// la nube envía un código a ese correo; ver access.ts) o que entran a Frame
// con él; lo decide la nube. Aquí está lo común: la llamada a la nube, el
// acceso, los datos de ejemplo y los favoritos, que son de la cuenta y viajan
// con ella (`loreFavorites`, como el corazón de las canciones). El índice y
// los archivos, en biblioteca.ts.
// ============================================================

export const AKLORE = 'frame.aklore';

// ------------------------------------------------------------
// La nube de Frame
// ------------------------------------------------------------

/** `stop`: no tiene sentido seguir con el resto de una colección. */
const fail = (message: string, stop = true) => Object.assign(new Error(message), { stop });
export const offline = () => fail(tr('Sin conexión: vuelve a intentarlo cuando tengas internet.'));

/** La cuenta no pudo atenderse (nube.ts): sin sesión aquí, sesión cerrada en la nube, o no se pudo comprobar ahora. */
const accountProblem = (error: NubeAuthError, signedOut: string) => fail(error.problem === 'signed-out' ? signedOut : sessionProblemText(error.problem));

export async function fromCloud(path: string, signal?: AbortSignal, headers?: Record<string, string>): Promise<Response> {
  if (!getSupabase() || !navigator.onLine) throw offline();
  // Con plazo y con la sesión resuelta (nube.ts). Un corte de red se dice así, no con el error del navegador.
  const resp = await nubeCall(path, { signal, headers }).catch((error: unknown) => {
    if (error instanceof NubeAuthError) throw accountProblem(error, tr('Entra a Frame con tu cuenta para usar la Biblioteca.'));
    throw signal?.aborted ? error : offline();
  });
  if (resp.ok) return resp;
  const body = (await resp.json().catch(() => null)) as { error?: string } | null;
  if (resp.status === 403) {
    // La nube dice que esta cuenta ya no la tiene activada (venció o es otra cuenta): access.ts lo anota.
    window.dispatchEvent(new Event(LORE_LOCKED_EVENT));
    throw fail(tr('Activa la Biblioteca con tu correo institucional.'));
  }
  if (resp.status === 404) throw fail(tr('Ese archivo ya no está en la Biblioteca.'), false);
  // `lleno`: hoy se repartieron muchos paquetes entre todas las cuentas (la nube se cuida de no agotarse).
  if (resp.status === 429) throw fail(body?.error === 'lleno' ? tr('Hoy se bajaron muchos paquetes de la Biblioteca. Mañana puedes seguir.') : tr('Llegaste al tope de descargas de hoy. Mañana puedes seguir.'));
  if (body?.error === 'lore-off') throw fail(tr('La Biblioteca aún se está preparando. Vuelve en un rato.'));
  throw fail(tr('La Biblioteca no respondió ({status}). Inténtalo de nuevo.', { status: resp.status }), false);
}

// ------------------------------------------------------------
// Acceso: se activa con un código que llega al correo institucional (1.9.4)
// ------------------------------------------------------------

/** La nube rechazó a esta cuenta: falta activar la Biblioteca. */
export const LORE_LOCKED_EVENT = 'frame:lore-locked';

export interface LoreAccess {
  active: boolean;
  /** Hasta cuándo vale la activación (sin fecha: la cuenta entra con su correo del colegio). */
  until?: number;
}

const ACCESS_ERRORS: Record<string, (left?: number) => string> = {
  account: () => tr('Entra a Frame con tu cuenta de Google para activar la Biblioteca.'),
  email: () => tr('Escribe tu correo institucional completo, el que te dio tu colegio.'),
  taken: () => tr('Ese correo ya activó la Biblioteca en otras dos cuentas de Frame.'),
  wait: () => tr('Ya se enviaron varios códigos. Espera una hora y vuelve a pedirlo.'),
  daily: () => tr('Hoy ya no se pueden enviar más códigos. Inténtalo mañana.'),
  'mail-off': () => tr('No se pudo enviar el código ahora. Inténtalo en unos minutos.'),
  mail: () => tr('No se pudo enviar el código ahora. Inténtalo en unos minutos.'),
  code: (left) => (left === 1 ? tr('Ese código no es. Te queda 1 intento.') : tr('Ese código no es. Te quedan {left} intentos.', { left: left ?? 0 })),
  expired: () => tr('El código caducó. Pide uno nuevo.'),
  attempts: () => tr('Demasiados intentos. Pide un código nuevo.'),
};

async function accessCall(path: string, body?: unknown): Promise<Record<string, unknown>> {
  if (!getSupabase() || !navigator.onLine) throw offline();
  const resp = await nubeCall(path, body === undefined ? {} : { body: JSON.stringify(body) }).catch((error: unknown) => {
    if (error instanceof NubeAuthError) throw accountProblem(error, ACCESS_ERRORS.account());
    throw offline();
  });
  const out = ((await resp.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (resp.ok) return out;
  const known = typeof out.error === 'string' ? ACCESS_ERRORS[out.error] : undefined;
  throw fail(known ? known(typeof out.left === 'number' ? out.left : undefined) : tr('La Biblioteca no respondió ({status}). Inténtalo de nuevo.', { status: resp.status }));
}

const accessOf = (out: Record<string, unknown>): LoreAccess => ({ active: out.active === true, ...(typeof out.until === 'number' ? { until: out.until } : {}) });

/** ¿Tiene esta cuenta la Biblioteca activada? */
export const fetchLoreAccess = async (): Promise<LoreAccess> => accessOf(await accessCall('/app/lore/acceso'));

/** Pide que la nube envíe el código al correo institucional. Devuelve cuántos minutos vale. */
export async function requestLoreCode(email: string): Promise<number> {
  const out = await accessCall('/app/lore/codigo', { email });
  return typeof out.minutes === 'number' ? out.minutes : 10;
}

/** Activa la Biblioteca con el código recibido. */
export const activateLore = async (code: string): Promise<LoreAccess> => accessOf(await accessCall('/app/lore/activar', { code }));

// ------------------------------------------------------------
// Datos de ejemplo (solo en desarrollo: probar la pantalla sin la nube)
// ------------------------------------------------------------

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Solo en desarrollo: probar la pantalla con datos de ejemplo. */
export const demoAvailable = import.meta.env.DEV;

export function setDemo(on: boolean): void {
  extWrite(AKLORE, 'demo', on || null);
  notify();
}

export const demoOn = () => demoAvailable && extRead<boolean>(AKLORE, 'demo', false) === true;

/** Para volver a pintar al encender o apagar los datos de ejemplo. */
export function useDemo(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    demoOn,
    demoOn
  );
}

// ------------------------------------------------------------
// Favoritos: de la cuenta. Viajan con ella (colección `loreFavorites`, una
// ficha por archivo, como el corazón de las canciones): los marcados en la
// laptop aparecen en el celular, y dos personas en un mismo equipo no ven los
// del otro. Quitar uno borra su ficha y la lápida lleva el borrado.
// ------------------------------------------------------------

const favoritesKey = (uid: string) => `loreFavorites_${uid}`;
const NONE: ReadonlySet<string> = new Set();
const favoriteListeners = new Set<() => void>();
/** Lo leído, con el texto del que salió: no se vuelve a armar si no cambió. */
let favoriteCache: { key: string; raw: string | null; ids: ReadonlySet<string> } | null = null;

function readFavorites(): ReadonlySet<string> {
  const uid = activeProfileId();
  if (!uid) return NONE;
  const key = favoritesKey(uid);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* sin almacenamiento: sin favoritos */
  }
  if (favoriteCache && favoriteCache.key === key && favoriteCache.raw === raw) return favoriteCache.ids;
  let ids: ReadonlySet<string> = NONE;
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) ids = new Set(list.map((entry) => (entry as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string'));
  } catch {
    /* ilegible: como si no hubiera */
  }
  favoriteCache = { key, raw, ids };
  return ids;
}

const favoritesChanged = () => favoriteListeners.forEach((fn) => fn());

export function useLoreFavorites(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      favoriteListeners.add(fn);
      // Lo que llega de otro dispositivo de la cuenta (o al cambiar de perfil).
      window.addEventListener(CLOUD_APPLIED_EVENT, fn);
      window.addEventListener('profileUpdated', fn);
      return () => {
        favoriteListeners.delete(fn);
        window.removeEventListener(CLOUD_APPLIED_EVENT, fn);
        window.removeEventListener('profileUpdated', fn);
      };
    },
    readFavorites,
    readFavorites
  );
}

/** Marca o quita un favorito. False: no se pudo guardar (el equipo sin espacio). */
export function toggleFavorite(id: string): boolean {
  const uid = activeProfileId();
  if (!uid) return false;
  const next = new Set(readFavorites());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  try {
    // Ordenados: el mismo conjunto se escribe igual en todos los dispositivos.
    localStorage.setItem(favoritesKey(uid), JSON.stringify([...next].sort().map((entry) => ({ id: entry }))));
  } catch {
    return false;
  }
  favoritesChanged();
  return true;
}

// ------------------------------------------------------------
// Búsqueda (sin tildes ni mayúsculas)
// ------------------------------------------------------------

export const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// Al desinstalar, el modo de ejemplo se borra con el resto de sus datos. Los
// favoritos son de la cuenta: se quedan, por si vuelve a activarla.
onExtensionTeardown(AKLORE, notify);
