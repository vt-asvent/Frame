// Quién es la Frame que llama: su sesión de Supabase, comprobada en Supabase
// mismo (vale para cualquier tipo de firma de sesión y respeta los cierres de
// sesión). Un minuto de memoria evita repetir la consulta en cada reconexión.
import { type Env, sha256 } from './util';

/** Quién llama: su id y, para AK Lore, su correo y si está comprobado. */
export interface AppUser {
  owner: string;
  email: string | null;
  confirmed: boolean;
}

const seen = new Map<string, { user: AppUser; until: number }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function userFromApp(env: Env, header: string | null): Promise<AppUser | null> {
  if (!header?.startsWith('Bearer ')) return null;
  const jwt = header.slice(7).trim();
  if (jwt.length < 20 || jwt.length > 8192) return null;
  const key = await sha256(jwt);
  const now = Date.now();
  const hit = seen.get(key);
  if (hit && hit.until > now) return hit.user;
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  if (!r?.ok) return null;
  const raw = (await r.json().catch(() => null)) as { id?: unknown; email?: unknown; email_confirmed_at?: unknown } | null;
  const owner = typeof raw?.id === 'string' && UUID.test(raw.id) ? raw.id.toLowerCase() : null;
  if (!owner) return null;
  const user: AppUser = {
    owner,
    email: typeof raw?.email === 'string' ? raw.email.toLowerCase() : null,
    confirmed: typeof raw?.email_confirmed_at === 'string' && raw.email_confirmed_at.length > 0,
  };
  if (seen.size > 500) seen.clear();
  seen.set(key, { user, until: now + 60_000 });
  return user;
}

export async function ownerFromApp(env: Env, header: string | null): Promise<string | null> {
  return (await userFromApp(env, header))?.owner ?? null;
}
