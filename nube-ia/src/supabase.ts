// Quién es la Frame que llama: su sesión de Supabase, comprobada en Supabase
// mismo (vale para cualquier tipo de firma de sesión y respeta los cierres de
// sesión). Un minuto de memoria evita repetir la consulta en cada reconexión.
import { type Env, sha256 } from './util';

const seen = new Map<string, { owner: string; until: number }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function ownerFromApp(env: Env, header: string | null): Promise<string | null> {
  if (!header?.startsWith('Bearer ')) return null;
  const jwt = header.slice(7).trim();
  if (jwt.length < 20 || jwt.length > 8192) return null;
  const key = await sha256(jwt);
  const now = Date.now();
  const hit = seen.get(key);
  if (hit && hit.until > now) return hit.owner;
  const r = await fetch(`${env.SUPABASE_URL.replace(/\/+$/, '')}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, authorization: `Bearer ${jwt}` },
  }).catch(() => null);
  if (!r?.ok) return null;
  const user = (await r.json().catch(() => null)) as { id?: unknown } | null;
  const owner = typeof user?.id === 'string' && UUID.test(user.id) ? user.id.toLowerCase() : null;
  if (!owner) return null;
  if (seen.size > 500) seen.clear();
  seen.set(key, { owner, until: now + 60_000 });
  return owner;
}
