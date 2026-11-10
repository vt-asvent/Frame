// ============================================================
// El `fetch` del cliente de Supabase (1.9.5): el de los plazos
// (capped-fetch.ts) más tres cuidados con lo que contesta Supabase, para que
// la sesión de este equipo no se pierda por algo que no es un «no».
//
// 1. Renovar la llave. supabase-js borra la sesión guardada ante CUALQUIER
//    respuesta de error que no sea un 5xx: un 429 (demasiadas peticiones), un
//    409 (dos renovaciones a la vez, que pasa con la red lenta), la página de
//    un portal cautivo o de un proxy… Aquí solo pasa como «no» lo que Supabase
//    Auth firma como fin de la sesión. Lo demás sale como un fallo de red, que
//    la biblioteca reintenta sin tocar nada.
// 2. La hora. La caducidad de la llave llega con el reloj del servidor y se
//    compara con el de este equipo. Con el reloj adelantado, cada lectura de
//    la sesión la daba por vencida y la renovaba; atrasado, Frame seguía
//    usando una llave vencida y la nube contestaba «JWT expired» durante
//    horas. La caducidad se guarda con el reloj de aquí: ahora + lo que dura.
// 3. Si la nube rechaza la llave de esta sesión cuando aquí se creía buena
//    (el reloj cambió después), se avisa al vigía (session-guard.ts), que la
//    renueva en el acto.
//
// Sin dependencias de Frame: lo prueba scripts/probar-sesion.mjs.
// ============================================================

import { cappedFetch } from '@/lib/capped-fetch';

const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

// ------------------------------------------------------------
// 1. Qué respuesta a una renovación dice que la sesión terminó
// ------------------------------------------------------------
/** Los `error_code` de Supabase Auth que cierran una sesión (internal/tokens/service.go). */
const ENDED_CODES = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired', 'user_not_found', 'user_banned']);
/** Y su texto, por si un día cambian los códigos: todos empiezan igual. */
const ENDED_TEXT = /invalid refresh token|refresh token (not found|revoked|already used)|session (not found|expired)|user (not found|banned)/i;

/** ¿Esa respuesta a «renueva mi llave» es un «no» de verdad (la sesión ya no existe)? */
export function refreshEnded(status: number, body: unknown): boolean {
  // 408 y 429 son esperas; 409, dos renovaciones que se cruzaron. Ninguna habla de la sesión.
  if (status < 400 || status > 499 || status === 408 || status === 409 || status === 429) return false;
  if (!body || typeof body !== 'object') return false;
  const reply = body as Record<string, unknown>;
  if (typeof reply.error_code === 'string' && ENDED_CODES.has(reply.error_code)) return true;
  // «Refresh token is not valid» (llave mal formada) es un 400 de validación: no es de estos.
  if (reply.error_code === 'validation_failed') return false;
  const text = [reply.msg, reply.error_description, reply.message].find((value): value is string => typeof value === 'string');
  return !!text && ENDED_TEXT.test(text);
}

/** Como un fallo de red: supabase-js lo reintenta y no borra la sesión. */
const transient = (status: number) => new TypeError(`Failed to fetch (renovación sin respuesta válida: HTTP ${status})`);

const isSession = (body: unknown): boolean =>
  !!body && typeof body === 'object' && typeof (body as Record<string, unknown>).access_token === 'string' && typeof (body as Record<string, unknown>).refresh_token === 'string';

async function guardRefresh(response: Response): Promise<Response> {
  let body: unknown = null;
  try {
    body = JSON.parse(await response.clone().text());
  } catch {
    /* no era JSON (un portal, un proxy) o se cortó a media lectura */
  }
  // Un «sí» solo vale si trae la sesión nueva: un 200 de otra cosa (el portal del wifi) tampoco es un «no».
  if (response.ok && isSession(body)) return withLocalExpiry(response);
  if (!response.ok && refreshEnded(response.status, body)) return response;
  void response.body?.cancel().catch(() => undefined);
  throw transient(response.status);
}

// ------------------------------------------------------------
// 2. La caducidad, con el reloj de este equipo
// ------------------------------------------------------------
async function withLocalExpiry(response: Response): Promise<Response> {
  const text = await response.text();
  let out = text;
  try {
    const body: unknown = JSON.parse(text);
    if (body && typeof body === 'object') {
      const session = body as Record<string, unknown>;
      const lasts = session.expires_in;
      if (typeof session.access_token === 'string' && typeof lasts === 'number' && lasts > 0) {
        session.expires_at = Math.floor(Date.now() / 1000) + Math.floor(lasts);
        out = JSON.stringify(session);
      }
    }
  } catch {
    /* no era una sesión: pasa tal cual */
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(out, { status: response.status, statusText: response.statusText, headers });
}

/** Las direcciones de Auth que entregan una sesión nueva. */
const ISSUES_SESSION = /\/auth\/v1\/(token|signup|verify)(\?|$)/;
const REFRESH = /\/auth\/v1\/token\?(.*&)?grant_type=refresh_token(&|$)/;

// ------------------------------------------------------------
// 3. La nube rechazó la llave de esta sesión
// ------------------------------------------------------------
let rejected: ((accessToken: string) => void) | null = null;

/** Quién se entera de que una petición con la llave de la sesión volvió rechazada (el vigía). */
export function onTokenRejected(listener: ((accessToken: string) => void) | null): void {
  rejected = listener;
}

function bearerOf(input: RequestInfo | URL, init?: RequestInit): string | null {
  try {
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined));
    const value = headers.get('authorization') ?? '';
    return /^Bearer\s+\S/i.test(value) ? value.replace(/^Bearer\s+/i, '') : null;
  } catch {
    return null;
  }
}

async function watchData(url: string, input: RequestInfo | URL, init: RequestInit | undefined, response: Response): Promise<Response> {
  if (!rejected) return response;
  // La API de datos contesta 401 a una llave vencida o mal firmada. El almacén de archivos lo dice
  // con un 400 o un 403 y «jwt» en el texto.
  let refused = response.status === 401;
  if (!refused && (response.status === 400 || response.status === 403) && url.includes('/storage/v1/')) {
    try {
      refused = /jwt|jws/i.test(await response.clone().text());
    } catch {
      refused = false;
    }
  }
  if (refused) {
    const token = bearerOf(input, init);
    if (token) rejected(token);
  }
  return response;
}

/** El `fetch` del cliente de Supabase (client.ts). */
export const sessionFetch: typeof fetch = async (input, init) => {
  const url = urlOf(input);
  const response = await cappedFetch(input, init);
  if (!url.includes('/auth/v1/')) return watchData(url, input, init, response);
  if (REFRESH.test(url)) return guardRefresh(response);
  if (response.ok && ISSUES_SESSION.test(url)) return withLocalExpiry(response);
  return response;
};
