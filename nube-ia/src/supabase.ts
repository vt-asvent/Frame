// Quién es la Frame que llama: su sesión de Supabase, comprobada en Supabase
// mismo (vale para cualquier tipo de firma de sesión y respeta los cierres de
// sesión). Un minuto de memoria evita repetir la consulta en cada reconexión.
//
// «Esa sesión no vale» y «no se pudo comprobar» son respuestas distintas
// (10-nov-2026). Antes cualquier tropiezo al preguntar —la red entre
// Cloudflare y Supabase, un 429, un 5xx— salía como 401, y Frame le decía a
// quien tenía la sesión intacta «Tu sesión venció: vuelve a entrar». Ahora solo
// es «no vale» cuando Supabase Auth lo dice; lo demás es «no disponible» (503
// en index.ts) y la app reintenta sin tocar la sesión.
import { type Env, sha256 } from './util';

/** Quién llama: su id y, para AK Lore, su correo y si está comprobado. */
export interface AppUser {
  owner: string;
  email: string | null;
  confirmed: boolean;
}

/** `invalid`: Supabase dice que esa sesión no vale. `unavailable`: no se pudo preguntar. */
export type AppCaller = { user: AppUser } | { user: null; why: 'invalid' | 'unavailable' };

const seen = new Map<string, { user: AppUser; until: number }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Cada pregunta a Supabase, como mucho esto; y una segunda si la primera no llegó. */
const ASK_MS = 6000;
const RETRY_AFTER_MS = 250;

const INVALID: AppCaller = { user: null, why: 'invalid' };
const UNAVAILABLE: AppCaller = { user: null, why: 'unavailable' };

/**
 * Un «no» de Supabase a `/auth/v1/user`. Es de la sesión solo si lo firma
 * Auth (401 o 403 con su `error_code` o su `msg`; 404 si la cuenta ya no
 * existe). La pasarela de delante contesta de otra forma (`message`) cuando el
 * fallo es suyo, y un 429 o un 5xx no dicen nada de la sesión.
 */
function refusal(status: number, body: unknown): 'invalid' | 'unavailable' {
  if (status !== 401 && status !== 403 && status !== 404) return 'unavailable';
  if (!body || typeof body !== 'object') return 'unavailable';
  const reply = body as { error_code?: unknown; msg?: unknown };
  if (status === 404) return reply.error_code === 'user_not_found' ? 'invalid' : 'unavailable';
  return typeof reply.error_code === 'string' || typeof reply.msg === 'string' ? 'invalid' : 'unavailable';
}

async function ask(env: Env, jwt: string): Promise<AppCaller> {
  let r: Response;
  try {
    r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(ASK_MS),
    });
  } catch {
    return UNAVAILABLE;
  }
  const raw = (await r.json().catch(() => null)) as { id?: unknown; email?: unknown; email_confirmed_at?: unknown } | null;
  if (!r.ok) return { user: null, why: refusal(r.status, raw) };
  // Contestó que sí, pero no se pudo leer: no es un «no».
  if (!raw || typeof raw !== 'object') return UNAVAILABLE;
  const owner = typeof raw.id === 'string' && UUID.test(raw.id) ? raw.id.toLowerCase() : null;
  if (!owner) return INVALID;
  return {
    user: {
      owner,
      email: typeof raw.email === 'string' ? raw.email.toLowerCase() : null,
      confirmed: typeof raw.email_confirmed_at === 'string' && raw.email_confirmed_at.length > 0,
    },
  };
}

export async function callerFromApp(env: Env, header: string | null): Promise<AppCaller> {
  if (!header?.startsWith('Bearer ')) return INVALID;
  const jwt = header.slice(7).trim();
  if (jwt.length < 20 || jwt.length > 8192) return INVALID;
  const key = await sha256(jwt);
  const now = Date.now();
  const hit = seen.get(key);
  if (hit && hit.until > now) return { user: hit.user };
  let caller = await ask(env, jwt);
  if (!caller.user && caller.why === 'unavailable') {
    // Un tropiezo de red suelto no debe llegar al usuario: una segunda pregunta, y ya.
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
    caller = await ask(env, jwt);
  }
  if (!caller.user) return caller;
  if (seen.size > 500) seen.clear();
  seen.set(key, { user: caller.user, until: now + 60_000 });
  return caller;
}
