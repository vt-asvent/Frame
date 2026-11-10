import { useEffect, useSyncExternalStore } from 'react';
import { extRead, extWrite, useExtensionOn } from '@/lib/extensions/store';
import { AKLORE, demoOn, fetchLoreAccess, LORE_LOCKED_EVENT, type LoreAccess } from '@/lib/extensions/aklore/source';
import { activeProfileId } from '@/lib/profile-scope';

// ============================================================
// ¿Puede esta cuenta usar la Biblioteca ahora? (1.9.4)
//
// Lo decide la nube de Frame: la cuenta la activó con el código que llega a
// su correo institucional, o entra a Frame con ese correo. Aquí se guarda la
// última respuesta por cuenta (en este equipo), para que la Biblioteca abra al
// instante y sin conexión; se vuelve a preguntar al abrir Frame y al cambiar
// de cuenta.
//
//   off      la extensión no está instalada o está apagada
//   checking aún no se sabe (primera vez, esperando a la nube)
//   allowed  activada
//   locked   falta activarla (o venció: dura un año)
// ============================================================

export type LoreAccessState = 'off' | 'checking' | 'allowed' | 'locked';

interface Remembered {
  /** Hasta cuándo vale; null: sin fecha (la cuenta es del colegio). */
  until: number | null;
}

const name = (uid: string) => `access:${uid}`;
const listeners = new Set<() => void>();
/** Lo que respondió la nube en esta sesión de Frame, por cuenta. */
const answered = new Map<string, { state: 'allowed' | 'locked'; at: number }>();
const asking = new Set<string>();
/** Tras un fallo de red no se insiste en cada pintado. */
const RETRY_MS = 30_000;

const notify = () => listeners.forEach((fn) => fn());

function remembered(uid: string): boolean {
  const saved = extRead<Remembered | null>(AKLORE, name(uid), null);
  return !!saved && (saved.until === null || (typeof saved.until === 'number' && saved.until > Date.now()));
}

/** Guarda lo que dijo la nube (también tras activar con el código). */
export function rememberLoreAccess(uid: string, access: LoreAccess): void {
  extWrite(AKLORE, name(uid), access.active ? ({ until: access.until ?? null } satisfies Remembered) : null);
  answered.set(uid, { state: access.active ? 'allowed' : 'locked', at: Date.now() });
  notify();
}

async function ask(uid: string): Promise<void> {
  const last = answered.get(uid);
  if (asking.has(uid) || (last && (last.state === 'allowed' || Date.now() - last.at < RETRY_MS))) return;
  asking.add(uid);
  try {
    rememberLoreAccess(uid, await fetchLoreAccess());
  } catch {
    // Sin conexión: vale lo recordado; sin nada recordado, queda por activar (y se reintenta).
    if (!remembered(uid)) answered.set(uid, { state: 'locked', at: Date.now() });
    notify();
  } finally {
    asking.delete(uid);
  }
}

// La nube rechazó a la cuenta activa al pedir el índice o un archivo: ya no la tiene.
if (typeof window !== 'undefined') {
  window.addEventListener(LORE_LOCKED_EVENT, () => {
    const uid = activeProfileId();
    if (uid) rememberLoreAccess(uid, { active: false });
  });
}

const stateOf = (uid: string): 'checking' | 'allowed' | 'locked' => answered.get(uid)?.state ?? (remembered(uid) ? 'allowed' : 'checking');

export function useAkLoreAccess(uid: string | null | undefined): LoreAccessState {
  const on = useExtensionOn(AKLORE);
  const state = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => (uid ? stateOf(uid) : 'locked'),
    () => (uid ? stateOf(uid) : 'locked')
  );

  useEffect(() => {
    if (!on || !uid || demoOn()) return;
    void ask(uid);
    const again = () => void ask(uid);
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [on, uid]);

  if (!on) return 'off';
  // Solo en desarrollo: los datos de ejemplo se ven con cualquier cuenta.
  if (demoOn()) return 'allowed';
  return state;
}
