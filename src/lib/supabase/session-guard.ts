// ============================================================
// El vigía de la sesión (1.9.5).
//
// Frame daba por buena la sesión guardada hasta que su llave vencía (una
// hora). Si la nube la había cerrado antes, pasaba ese rato a medias: los datos
// se sincronizaban, pero la Biblioteca decía «tu sesión venció» y Dispositivos,
// «desvinculado». Y al revés: un tropiezo de la red bastaba para mandar al
// usuario a volver a entrar.
//
// Ahora hay una sola forma de saber cómo está la sesión: pedirle a Supabase
// que la renueve (`checkSession`). Lo piden las señales de que algo no cuadra:
//   · la nube de Frame rechazó la llave (nube.ts);
//   · Dispositivos dice que la sesión de este equipo ya no existe (devices.ts);
//   · la API de datos rechazó la llave (session-fetch.ts).
// Y solo hay tres respuestas:
//   · `alive`: renovada, sigue viva. El aviso de «vuelve a conectar», si
//     estaba, se quita.
//   · `ended`: Supabase Auth dice que ya no existe. Se avisa en el acto y el
//     usuario la reconecta sin salir de donde está (ReconnectDialog).
//   · `unknown`: no hubo respuesta que valga. No se toca nada.
//
// Lo prueba scripts/probar-sesion.mjs.
// ============================================================

import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { getSupabase } from './client';
import { rememberSignInMethods, storedAccessToken, storedSessionUserId } from './auth';
import { onTokenRejected } from './session-fetch';
import { SESSION_RESTORED_EVENT, clearSessionLost, getConnectionState, markSessionLost } from '@/lib/connection-status';

export type SessionCheck = 'alive' | 'ended' | 'unknown' | 'none';

/** Entre dos preguntas por la misma llave: lo que ya se sabe vale este rato. */
const MIN_GAP_MS = 20_000;

let running: Promise<SessionCheck> | null = null;
let last: { at: number; token: string; result: SessionCheck } | null = null;

async function ask(): Promise<SessionCheck> {
  const supabase = getSupabase();
  const uid = storedSessionUserId();
  if (!supabase || !uid) return 'none';
  let reply: Awaited<ReturnType<typeof supabase.auth.refreshSession>>;
  try {
    reply = await supabase.auth.refreshSession();
  } catch {
    return 'unknown';
  }
  if (reply.data.session) {
    if (getConnectionState().sessionLostFor === reply.data.session.user.id) clearSessionLost();
    return 'alive';
  }
  const error = reply.error;
  // Solo cuenta el «no» de Supabase Auth, que session-fetch.ts ya filtró: un
  // fallo de red, una espera o una respuesta ilegible no dicen nada de la sesión.
  if (!error || isAuthRetryableFetchError(error) || !isAuthApiError(error)) return 'unknown';
  markSessionLost(uid);
  return 'ended';
}

/**
 * ¿Sigue viva la sesión de este equipo? Se lo pregunta a Supabase renovándola.
 * `rejected`: la llave que alguien acaba de rechazar; si ya no es la de la
 * sesión (se renovó entre tanto), no hace falta preguntar.
 */
export function checkSession(rejected?: string): Promise<SessionCheck> {
  const current = storedAccessToken();
  if (!current) return Promise.resolve('none');
  if (rejected && rejected !== current) return Promise.resolve('alive');
  if (running) return running;
  if (last && last.token === current && Date.now() - last.at < MIN_GAP_MS) return Promise.resolve(last.result);
  const mine = ask()
    .then((result) => {
      last = { at: Date.now(), token: storedAccessToken() ?? '', result };
      return result;
    })
    .finally(() => {
      if (running === mine) running = null;
    });
  running = mine;
  return mine;
}

/** La cuenta se reconectó sin salir de Frame (ReconnectDialog): fuera el aviso, y que todo se ponga al día. */
export function sessionRestored(): void {
  last = null;
  clearSessionLost();
  window.dispatchEvent(new Event(SESSION_RESTORED_EVENT));
}

let started = false;

/** Arranca el vigía, una vez por arranque de Frame (layout.tsx). */
export function startSessionGuard(): void {
  if (started) return;
  started = true;
  // Una petición de datos volvió rechazada con la llave de esta sesión: se renueva ya.
  onTokenRejected((token) => {
    if (token === storedAccessToken()) void checkSession(token);
  });
  getSupabase()?.auth.onAuthStateChange((event, session) => {
    if (!session?.user) return;
    rememberSignInMethods(session.user);
    // Una llave recién emitida para la cuenta que estaba «sin conexión»: ya no lo está.
    // (SIGNED_IN no vale: la biblioteca lo repite con la sesión guardada, viva o no.)
    if (event === 'TOKEN_REFRESHED' && getConnectionState().sessionLostFor === session.user.id) clearSessionLost();
  });
}
