// AK Lore → Biblioteca: quién puede abrirla (Frame 1.9.3).
//
// La Biblioteca es para estudiantes del colegio, pero casi ninguno entra a
// Frame con su correo institucional. Por eso se activa aparte, en dos pasos:
//   1. POST /app/lore/codigo { email } → si el correo es del colegio, esta nube
//      le envía un código de 6 dígitos (vale 10 minutos);
//   2. POST /app/lore/activar { code } → con el código, la Biblioteca queda
//      activada para ESA cuenta de Frame, entre con el correo que entre.
// GET /app/lore/acceso dice si la cuenta ya la tiene. Una cuenta cuyo propio
// correo, comprobado, es del colegio la tiene sin código (como en la 1.9.2).
//
// El dominio del colegio se compara por su resumen SHA-256 (el código público
// no lo nombra). Del correo institucional solo se guarda una huella con clave
// (no se puede leer ni adivinar probando correos sin la clave de esta nube),
// para contar cuántas cuentas activó: como mucho ACCOUNTS_PER_EMAIL. La
// activación dura un año. Hace falta una cuenta de Frame con correo: un
// invitado no puede activarla.
//
// El código lo envía un Apps Script de la cuenta de Asvent (LORE_MAIL_URL, con
// su clave LORE_MAIL_KEY): solo acepta códigos de 6 dígitos hacia el dominio
// del colegio, y su cuenta gratuita envía 100 correos al día.
//
// Errores: 403 `account` (invitado) · 400 `email` (no es del colegio) · 409
// `taken` (ese correo ya activó sus cuentas) · 429 `wait` (demasiados envíos
// en una hora) o `daily` (tope de correos del día) · 503 `mail-off` (sin
// remitente) o `mail` (no salió) · 400 `code` (código incorrecto, con `left`)
// · 410 `expired` · 429 `attempts`.
import { type AppUser } from './supabase';
import { type Env, json, sha256 } from './util';

/** SHA-256 del dominio del colegio: el mismo que lleva la app (catalog.ts). */
export const SCHOOL_DOMAIN_HASH = '0c072257f310f7ab180aa97e5d30aa09faff66bb44510472c3826a59ebc3c8de';
export const CODE_MINUTES = 10;
export const CODE_ATTEMPTS = 5;
export const SENDS_PER_HOUR = 3;
/** El remitente envía 100 al día: se deja margen. */
export const SENDS_PER_DAY = 90;
export const ACCOUNTS_PER_EMAIL = 2;
export const ACCESS_DAYS = 365;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** ¿Es un correo del colegio? Cuenta lo que sigue a la ÚLTIMA arroba: el dominio que de verdad recibe el correo. */
async function isSchoolEmail(env: Env, email: string): Promise<boolean> {
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
  if (!domain || !email.includes('@')) return false;
  return (await sha256Hex(domain)) === (env.LORE_DOMAIN_HASH || SCHOOL_DOMAIN_HASH);
}

/** La cuenta entra a Frame con su correo del colegio, comprobado. */
export async function isSchoolAccount(env: Env, user: AppUser): Promise<boolean> {
  return !!user.email && user.confirmed && (await isSchoolEmail(env, user.email));
}

/** Hasta cuándo vale la activación por código de esta cuenta, o null. */
async function activatedUntil(env: Env, owner: string): Promise<number | null> {
  const until = await env.DB.prepare('SELECT expires FROM lore_accesos WHERE owner = ?').bind(owner).first<number>('expires');
  return until && until > Date.now() ? until : null;
}

/** ¿Puede esta cuenta abrir la Biblioteca? */
export async function hasLoreAccess(env: Env, user: AppUser): Promise<boolean> {
  return (await isSchoolAccount(env, user)) || (await activatedUntil(env, user.owner)) !== null;
}

export async function loreAccess(env: Env, user: AppUser): Promise<Response> {
  if (await isSchoolAccount(env, user)) return json({ active: true });
  const until = await activatedUntil(env, user.owner);
  return json(until ? { active: true, until } : { active: false });
}

const emailMark = (env: Env, email: string) => sha256(`${env.FRAME_IA_KEY}:lore-correo:${email}`);
const codeMark = (env: Env, owner: string, code: string) => sha256(`${env.FRAME_IA_KEY}:lore-codigo:${owner}:${code}`);

/** Seis dígitos al azar, todos igual de probables. */
function sixDigits(): string {
  const box = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(box);
    // 4 294 000 000 es múltiplo de un millón: lo que cae por encima se repite.
    const value = box[0] ?? 0xffffffff;
    if (value < 4_294_000_000) return String(value % 1_000_000).padStart(6, '0');
  }
}

const takenBy = (env: Env, mark: string, owner: string) =>
  env.DB.prepare('SELECT COUNT(*) AS n FROM lore_accesos WHERE correo = ? AND owner <> ? AND expires > ?').bind(mark, owner, Date.now()).first<number>('n');

const sentIn = (env: Env, key: string, span: string) => env.DB.prepare('SELECT n FROM lore_envios WHERE clave = ? AND tramo = ?').bind(key, span).first<number>('n');
const countSend = (env: Env, key: string, span: string) =>
  env.DB.prepare('INSERT INTO lore_envios (clave, tramo, n) VALUES (?, ?, 1) ON CONFLICT (clave, tramo) DO UPDATE SET n = n + 1').bind(key, span);

/** Pide al remitente que envíe el código. True si salió. */
async function sendCode(env: Env, to: string, code: string): Promise<boolean> {
  const r = await fetch(env.LORE_MAIL_URL!, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: env.LORE_MAIL_KEY, to, code, minutes: CODE_MINUTES }),
  }).catch(() => null);
  const out = r?.ok ? ((await r.json().catch(() => null)) as { ok?: unknown; error?: unknown } | null) : null;
  // Nunca el correo ni el código en el registro: solo qué falló.
  if (out?.ok !== true) console.error('lore correo', r?.status ?? 'red', typeof out?.error === 'string' ? out.error.slice(0, 80) : '');
  return out?.ok === true;
}

export async function loreSendCode(req: Request, env: Env, user: AppUser): Promise<Response> {
  if (!user.email || !user.confirmed) return json({ error: 'account' }, 403);
  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email.length > 120 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email) || !(await isSchoolEmail(env, email))) return json({ error: 'email' }, 400);
  if (!env.LORE_MAIL_URL || !env.LORE_MAIL_KEY) return json({ error: 'mail-off' }, 503);

  const mark = await emailMark(env, email);
  if (((await takenBy(env, mark, user.owner)) ?? 0) >= ACCOUNTS_PER_EMAIL) return json({ error: 'taken' }, 409);

  const now = Date.now();
  const hour = new Date(now).toISOString().slice(0, 13);
  const day = hour.slice(0, 10);
  const [mine, theirs, all] = await Promise.all([sentIn(env, `o:${user.owner}`, hour), sentIn(env, `c:${mark}`, hour), sentIn(env, 'todos', day)]);
  if ((mine ?? 0) >= SENDS_PER_HOUR || (theirs ?? 0) >= SENDS_PER_HOUR) return json({ error: 'wait' }, 429);
  if ((all ?? 0) >= SENDS_PER_DAY) return json({ error: 'daily' }, 429);

  const code = sixDigits();
  await env.DB.prepare(
    'INSERT INTO lore_codigos (owner, correo, codigo, expires, intentos) VALUES (?, ?, ?, ?, 0) ON CONFLICT (owner) DO UPDATE SET correo = excluded.correo, codigo = excluded.codigo, expires = excluded.expires, intentos = 0',
  )
    .bind(user.owner, mark, await codeMark(env, user.owner, code), now + CODE_MINUTES * 60_000)
    .run();
  if (!(await sendCode(env, email, code))) {
    await env.DB.prepare('DELETE FROM lore_codigos WHERE owner = ?').bind(user.owner).run();
    return json({ error: 'mail' }, 503);
  }
  await env.DB.batch([countSend(env, `o:${user.owner}`, hour), countSend(env, `c:${mark}`, hour), countSend(env, 'todos', day)]);
  return json({ ok: true, minutes: CODE_MINUTES });
}

export async function loreActivate(req: Request, env: Env, user: AppUser): Promise<Response> {
  if (!user.email || !user.confirmed) return json({ error: 'account' }, 403);
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const given = (typeof body?.code === 'string' || typeof body?.code === 'number' ? String(body.code) : '').replace(/\D/g, '').slice(0, 12);
  const row = await env.DB.prepare('SELECT correo, codigo, expires, intentos FROM lore_codigos WHERE owner = ?')
    .bind(user.owner)
    .first<{ correo: string; codigo: string; expires: number; intentos: number }>();
  const now = Date.now();
  if (!row || row.expires <= now) {
    if (row) await env.DB.prepare('DELETE FROM lore_codigos WHERE owner = ?').bind(user.owner).run();
    return json({ error: 'expired' }, 410);
  }
  if (row.intentos >= CODE_ATTEMPTS) return json({ error: 'attempts' }, 429);
  if (given.length !== 6 || (await codeMark(env, user.owner, given)) !== row.codigo) {
    await env.DB.prepare('UPDATE lore_codigos SET intentos = intentos + 1 WHERE owner = ?').bind(user.owner).run();
    const left = CODE_ATTEMPTS - row.intentos - 1;
    return left > 0 ? json({ error: 'code', left }, 400) : json({ error: 'attempts' }, 429);
  }
  // Otra cuenta pudo activarse con este mismo correo mientras llegaba el código.
  if (((await takenBy(env, row.correo, user.owner)) ?? 0) >= ACCOUNTS_PER_EMAIL) return json({ error: 'taken' }, 409);
  const until = now + ACCESS_DAYS * 86_400_000;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO lore_accesos (owner, correo, since, expires) VALUES (?, ?, ?, ?) ON CONFLICT (owner) DO UPDATE SET correo = excluded.correo, since = excluded.since, expires = excluded.expires').bind(
      user.owner,
      row.correo,
      now,
      until,
    ),
    env.DB.prepare('DELETE FROM lore_codigos WHERE owner = ?').bind(user.owner),
  ]);
  return json({ active: true, until });
}

/** Limpieza diaria: códigos y activaciones caducados, y los envíos de días pasados. */
export const loreAccessCleanup = (env: Env, now: number) => [
  env.DB.prepare('DELETE FROM lore_codigos WHERE expires<?').bind(now),
  env.DB.prepare('DELETE FROM lore_accesos WHERE expires<?').bind(now),
  env.DB.prepare('DELETE FROM lore_envios WHERE tramo<?').bind(new Date(now).toISOString().slice(0, 10)),
];
