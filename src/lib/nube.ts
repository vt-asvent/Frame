import { cappedFetchWith } from '@/lib/capped-fetch';
import { getConnectionState } from '@/lib/connection-status';
import { hasStoredSession } from '@/lib/supabase/auth';
import { getSupabase } from '@/lib/supabase/client';
import { checkSession } from '@/lib/supabase/session-guard';
import { tr } from '@/lib/i18n';

// El Worker de Frame en Cloudflare (nube-ia/): el relé de los chats con IA, el
// lector de horarios, la traducción de letras y la Biblioteca. Ninguno guarda
// lo que pasa por él.
export const NUBE = 'https://frame-ia.vtasvent.workers.dev';

/**
 * `fetch` hacia esa nube, con plazo (ver capped-fetch.ts): sin él, una red que
 * se traga los paquetes dejaba la pantalla girando para siempre. Lo que pasa
 * por la IA (leer un horario, traducir una letra) puede tardar; lo demás
 * contesta enseguida y, si es un archivo, tiene lo que tarde en bajar.
 */
export const nubeFetch = cappedFetchWith((url) =>
  /\/app\/(horario|traducir)(\?|$)/.test(url)
    ? { answerMs: 150_000, unsizedBodyMs: 30_000, bytesPerMs: 4 }
    : { answerMs: 30_000, unsizedBodyMs: 300_000, bytesPerMs: 4 }
);

// ------------------------------------------------------------
// Lo que la nube pide con la sesión de la cuenta (1.9.5)
//
// Antes cada sitio leía la sesión, llamaba y, ante un 401, decía «tu sesión
// venció: vuelve a entrar». Pero un 401 puede ser solo una llave que acaba de
// caducar, y «no hay sesión» puede ser solo que la red no dejó renovarla. Aquí
// se resuelve en un solo sitio:
//   · 401 → se le pregunta a Supabase renovando la llave (session-guard.ts).
//     Si la sesión vive, la petición se repite con la llave nueva y el usuario
//     no se entera. Solo si Supabase dice que terminó se le pide reconectar.
//   · 503 «auth-unavailable» → la nube no pudo comprobar la llave: se repite
//     una vez y, si sigue igual, se dice que se intente luego.
// ------------------------------------------------------------

/**
 * Por qué la nube no pudo atender a esta cuenta:
 *   · `signed-out`: en este equipo no hay ninguna sesión.
 *   · `ended`: la sesión se cerró en la nube; la campana ofrece volver a conectar.
 *   · `unverified`: no se pudo comprobar ahora (la red, el servidor): la sesión sigue ahí.
 */
export type NubeAuthProblem = 'signed-out' | 'ended' | 'unverified';

export class NubeAuthError extends Error {
  constructor(public readonly problem: NubeAuthProblem) {
    super(problem);
    this.name = 'NubeAuthError';
  }
}

/** Lo que se le dice al usuario en los dos casos que no dependen de dónde esté. */
export function sessionProblemText(problem: 'ended' | 'unverified'): string {
  return problem === 'ended'
    ? tr('Tu sesión se cerró. Vuelve a conectar tu cuenta desde la campana.')
    : tr('No se pudo comprobar tu sesión ahora. Inténtalo de nuevo en un momento.');
}

interface NubeCallInit {
  method?: string;
  /** JSON ya escrito: se manda tal cual (y puede repetirse). */
  body?: string;
  signal?: AbortSignal;
  /** Cabeceras de más (la Biblioteca pide tramos de un archivo con `range`). */
  headers?: Record<string, string>;
}

const AUTH_RETRY_MS = 1500;

async function authUnavailable(response: Response): Promise<boolean> {
  if (response.status !== 503) return false;
  const body = (await response.clone().json().catch(() => null)) as { error?: unknown } | null;
  return body?.error === 'auth-unavailable';
}

/**
 * Una petición a la nube de Frame con la sesión de esta cuenta. Devuelve la
 * respuesta (nunca un 401). Lanza `NubeAuthError` si la cuenta no puede
 * atenderse, y el error del `fetch` si falla la red.
 */
export async function nubeCall(path: string, init: NubeCallInit = {}): Promise<Response> {
  const supabase = getSupabase();
  if (!supabase) throw new NubeAuthError('signed-out');

  const send = async (): Promise<{ response: Response; token: string }> => {
    let token: string | null = null;
    let failed = false;
    try {
      const { data, error } = await supabase.auth.getSession();
      token = data.session?.access_token ?? null;
      failed = !!error;
    } catch {
      failed = true;
    }
    if (!token) {
      // Sin sesión porque se cerró en la nube, porque no se pudo renovar ahora, o porque no hay cuenta.
      if (getConnectionState().sessionLostFor) throw new NubeAuthError('ended');
      throw new NubeAuthError(failed && hasStoredSession() ? 'unverified' : 'signed-out');
    }
    const response = await nubeFetch(`${NUBE}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...init.headers, authorization: `Bearer ${token}`, ...(init.body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    return { response, token };
  };

  let { response, token } = await send();
  if (await authUnavailable(response)) {
    await new Promise((resolve) => setTimeout(resolve, AUTH_RETRY_MS));
    ({ response, token } = await send());
    if (await authUnavailable(response)) throw new NubeAuthError('unverified');
  }
  if (response.status !== 401) return response;

  // La nube dice que esa llave no vale: se le pregunta a Supabase, renovándola.
  const state = await checkSession(token);
  if (state === 'ended') throw new NubeAuthError('ended');
  if (state === 'none') throw new NubeAuthError(getConnectionState().sessionLostFor ? 'ended' : 'signed-out');
  if (state === 'unknown') throw new NubeAuthError('unverified');
  // Sigue viva y con llave nueva: otra vez, y solo una.
  ({ response } = await send());
  if (response.status === 401 || (await authUnavailable(response))) throw new NubeAuthError('unverified');
  return response;
}
