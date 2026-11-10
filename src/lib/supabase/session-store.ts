// ============================================================
// Dónde guarda supabase-js la sesión de este equipo (1.9.5).
//
// Es localStorage, como siempre y con la misma clave. Lo que cambia es qué
// pasa cuando el equipo se queda sin sitio. Cada hora Supabase cambia la llave
// de renovación por una nueva; si la nueva no se pudo guardar, la biblioteca
// lanzaba un error en cada lectura de la sesión y, al reabrir Frame, se
// presentaba una llave ya gastada: la nube la toma por un robo y cierra la
// sesión. El usuario solo veía que «se desvinculó» sola.
//
//   · Una reserva de unos pocos KB vive junto a la sesión. Si guardarla falla,
//     se suelta la reserva y se reintenta: la sesión cabe siempre.
//   · Si ni así (almacenamiento vetado o roto), la sesión sigue en memoria
//     mientras Frame esté abierta y se reintenta guardarla cada medio minuto.
//
// Sin dependencias: lo prueba scripts/probar-sesion.mjs.
// ============================================================

/** La clave de la sesión (`storageKey` del cliente de Supabase). */
export const SESSION_KEY = 'aether-auth';
const RESERVE_KEY = 'aether-auth-reserva';
/** Varias veces lo que ocupa una sesión con su usuario. */
const RESERVE = '0'.repeat(16_384);
const RETRY_MS = 30_000;

/** Lo que aún no cupo en el equipo: manda sobre lo guardado. */
const held = new Map<string, string>();
let retry: ReturnType<typeof setTimeout> | null = null;

function put(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* almacenamiento vetado: nada que quitar */
  }
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Deja la reserva puesta para la próxima vez (si no cabe ahora, se intentará en la siguiente escritura). */
function reserve(): void {
  if (read(RESERVE_KEY) === null) put(RESERVE_KEY, RESERVE);
}

function persistHeld(): void {
  retry = null;
  for (const [key, value] of held) {
    if (put(key, value)) held.delete(key);
  }
  if (held.size > 0) retry = setTimeout(persistHeld, RETRY_MS);
}

/** El almacén que usa el cliente de Supabase (`auth.storage`). */
export const sessionStore = {
  getItem(key: string): string | null {
    const waiting = held.get(key);
    return waiting !== undefined ? waiting : read(key);
  },
  setItem(key: string, value: string): void {
    if (put(key, value)) {
      held.delete(key);
      reserve();
      return;
    }
    // Sin sitio: para esto está la reserva.
    drop(RESERVE_KEY);
    if (put(key, value)) {
      held.delete(key);
      return;
    }
    held.set(key, value);
    if (retry === null) retry = setTimeout(persistHeld, RETRY_MS);
  },
  removeItem(key: string): void {
    held.delete(key);
    drop(key);
  },
};

/** ¿Hay algo de la sesión que solo vive en memoria (el equipo no deja guardarlo)? */
export const sessionOnlyInMemory = (): boolean => held.size > 0;

/** La sesión guardada, tal cual (o null). Para quien necesita leerla sin esperar a supabase-js. */
export function readStoredSession(): Record<string, unknown> | null {
  const raw = sessionStore.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Quien ya tiene sesión de una versión anterior estrena la reserva al abrir.
if (typeof localStorage !== 'undefined' && read(SESSION_KEY) !== null) reserve();
