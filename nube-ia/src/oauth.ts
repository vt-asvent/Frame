// OAuth 2.1 para los chats: registro dinámico, PKCE y un código de
// emparejamiento que muestra Frame (así no hace falta otra cuenta ni otra
// contraseña). Sigue el de la nube de Wire.
import { LOGO } from './logo';
import { type Env, json, random, relayOf, sha256, signToken, verifyToken } from './util';

const ACCESS_SECONDS = 3600;
/** Cada refresco da otra llave con el plazo entero: un chat en uso no caduca. */
const REFRESH_MS = 180 * 86_400_000;
/** Un refresco anterior sigue valiendo un momento: los chats pueden refrescar en paralelo. */
const REFRESH_GRACE_MS = 5 * 60_000;
const CODE_MS = 5 * 60_000;
const PAIR_MS = 10 * 60_000;
/** Fallos que aguantan los códigos vigentes antes de anularse. */
const PAIR_TRIES = 20;
/** Códigos vivos por cuenta: pedir otro anula los más viejos. */
const PAIRS_PER_OWNER = 3;

/** Acceso de un chat: cuenta, chat, su nombre, generación de permisos y caducidad. */
export interface Access {
  p: 'a';
  o: string;
  c: string;
  n: string;
  g: number;
  e: number;
}

export function metadata(origin: string) {
  return {
    resource: {
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['frame'],
      resource_name: 'Frame',
    },
    server: {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      registration_endpoint: `${origin}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: ['frame'],
    },
  };
}

/** Los chats que pueden recibir el acceso; más las herramientas locales (localhost). */
const CHAT_HOSTS = ['claude.ai', 'claude.com', 'chatgpt.com', 'chat.openai.com'];

export function allowedRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return CHAT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function register(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown } | null;
  const redirects = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (!redirects.length || redirects.length > 10 || !redirects.every(allowedRedirect)) return json({ error: 'invalid_redirect_uri' }, 400);
  const name = typeof body?.client_name === 'string' ? body.client_name.trim().slice(0, 80) : '';
  const asked = body?.token_endpoint_auth_method;
  const method = asked === 'client_secret_post' || asked === 'client_secret_basic' ? asked : 'none';
  const id = random(16);
  const secret = method === 'none' ? null : random(32);
  await env.DB.prepare('INSERT INTO clients(id, name, redirects, secret, created) VALUES(?,?,?,?,?)')
    .bind(id, name, JSON.stringify(redirects), secret ? await sha256(secret) : null, Date.now())
    .run();
  return json(
    {
      client_id: id,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: name,
      redirect_uris: redirects,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
    },
    201,
  );
}

const TEXTS = {
  es: {
    title: 'Conectar con Frame',
    lead: 'quiere usar tu Frame: leer y cambiar tus tareas, asignaturas, hábitos, calendario, sesiones de estudio, recursos y música.',
    hint: 'Abre Frame en tu equipo, ve a Extensiones › Conexiones con IA y escribe aquí el código que aparece.',
    warn: 'Escribe el código solo si tú mismo estás conectando Frame a este chat. Al autorizar volverás a',
    code: 'Código de Frame',
    go: 'Autorizar',
    wrong: 'Ese código no es válido o ya caducó. Pide uno nuevo en Frame.',
  },
  en: {
    title: 'Connect to Frame',
    lead: 'wants to use your Frame: reading and changing your tasks, subjects, habits, calendar, study sessions, resources and music.',
    hint: 'Open Frame on your computer, go to Extensions › AI connections and enter the code shown there.',
    warn: 'Only enter the code if you are connecting Frame to this chat yourself. After authorizing you will return to',
    code: 'Frame code',
    go: 'Authorize',
    wrong: 'That code is invalid or has expired. Get a new one in Frame.',
  },
};

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const FORM_ACTION =
  "'self' https://claude.ai https://*.claude.ai https://claude.com https://*.claude.com https://chatgpt.com https://*.chatgpt.com https://chat.openai.com http://localhost:* http://127.0.0.1:* http://[::1]:*";

function page(req: Request, name: string, fields: Record<string, string>, error: boolean): Response {
  const lang = (req.headers.get('accept-language') ?? 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
  const t = TEXTS[lang];
  let host = '';
  try {
    host = new URL(fields.redirect_uri ?? '').host;
  } catch {
    /* ya validada al registrar */
  }
  const hidden = Object.entries(fields)
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('');
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${t.title}</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:#0f1420;color:#f4f6fb;font:15px/1.5 system-ui,'Segoe UI',sans-serif}
main{width:100%;max-width:400px;background:#171e2e;border:1px solid #263049;border-radius:16px;padding:28px}img{display:block;margin:0 auto 14px}h1{margin:0 0 12px;font-size:20px;text-align:center}
p{margin:0 0 14px;color:#a7b0c4;font-size:14px}p b{color:#f4f6fb}.w{font-size:13px;padding:10px 12px;border-radius:10px;background:#1f2a40;color:#c9d2e6}
label{display:block;margin:0 0 6px;font-size:13px;color:#a7b0c4}
input[name=code]{width:100%;height:48px;padding:0 12px;border-radius:10px;border:1px solid #33405e;background:#0f1420;color:#f4f6fb;font-size:21px;letter-spacing:.16em;text-align:center;text-transform:uppercase}
input[name=code]:focus{outline:2px solid #3fd2c7;outline-offset:1px}button{width:100%;height:46px;margin-top:14px;border:0;border-radius:10px;background:linear-gradient(90deg,#2f7cf6,#3fd2c7);color:#06101c;font-weight:650;font-size:15px;cursor:pointer}
.e{color:#ff9b8f}</style></head><body><main><img src="${LOGO}" width="56" height="56" alt=""><h1>${t.title}</h1>
<p><b>${escape(name || 'Un chat')}</b> ${t.lead}</p><p>${t.hint}</p><p class="w">${t.warn} <b>${escape(host)}</b>.</p>${error ? `<p class="e" role="alert">${t.wrong}</p>` : ''}
<form method="post" action="/authorize">${hidden}<label for="c">${t.code}</label><input id="c" name="code" required autofocus autocomplete="one-time-code" maxlength="12" spellcheck="false"><button>${t.go}</button></form></main></body></html>`;
  return new Response(html, {
    status: error ? 400 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; frame-ancestors 'none'; form-action ${FORM_ACTION}`,
    },
  });
}

const FIELDS = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource', 'response_type'];

async function checkClient(env: Env, id: string, redirect: string) {
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(id).first<{ id: string; name: string; redirects: string; secret: string | null }>();
  if (!client || !(JSON.parse(client.redirects) as string[]).includes(redirect)) return null;
  return client;
}

export async function authorize(req: Request, env: Env): Promise<Response> {
  const fields: Record<string, string> = {};
  let code = '';
  if (req.method === 'POST') {
    const form = await req.formData();
    for (const k of FIELDS) fields[k] = String(form.get(k) ?? '');
    code = String(form.get('code') ?? '');
  } else {
    const q = new URL(req.url).searchParams;
    for (const k of FIELDS) fields[k] = q.get(k) ?? '';
  }
  const client = await checkClient(env, fields.client_id ?? '', fields.redirect_uri ?? '');
  if (!client) return json({ error: 'invalid_client' }, 400);
  if (fields.response_type !== 'code' || fields.code_challenge_method !== 'S256' || !fields.code_challenge) {
    return json({ error: 'invalid_request', error_description: 'PKCE S256 is required.' }, 400);
  }
  if (req.method !== 'POST') return page(req, client.name, fields, false);

  const owner = await spendPairing(env, code);
  if (!owner) return page(req, client.name, fields, true);
  const grant = random(32);
  await env.DB.prepare('INSERT INTO grants(code, client, owner, challenge, redirect, expires) VALUES(?,?,?,?,?,?)')
    .bind(await sha256(grant), client.id, owner, fields.code_challenge, fields.redirect_uri, Date.now() + CODE_MS)
    .run();
  const back = new URL(fields.redirect_uri ?? '');
  back.searchParams.set('code', grant);
  if (fields.state) back.searchParams.set('state', fields.state);
  return Response.redirect(back.toString(), 302);
}

/** El código se normaliza: da igual mayúsculas o guiones. */
export const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Gasta el código de una vez. Un código ajeno no se puede identificar sin
 *  acertarlo, así que cada fallo cuenta contra todos los vigentes: por muchas
 *  direcciones que use quien pruebe, solo tiene PAIR_TRIES intentos por código. */
export async function spendPairing(env: Env, code: string): Promise<string | null> {
  const now = Date.now();
  const hash = await sha256(normalizeCode(code));
  const row = await env.DB.prepare('DELETE FROM pairings WHERE code=?1 AND expires>=?2 RETURNING owner').bind(hash, now).first<{ owner: string }>();
  if (row) return row.owner;
  await env.DB.batch([
    env.DB.prepare('UPDATE pairings SET tries=tries+1'),
    env.DB.prepare('DELETE FROM pairings WHERE tries>=?1 OR expires<?2').bind(PAIR_TRIES, now),
  ]);
  return null;
}

/** Acceso nuevo. Si los permisos se retiraron mientras tanto, no vale. */
async function issue(env: Env, client: { id: string; name: string }, owner: string, since: number): Promise<Response> {
  const relay = relayOf(env, owner);
  const g = await relay.generation();
  const refresh = random(32);
  const hash = await sha256(refresh);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(token, client, owner, expires, since) VALUES(?,?,?,?,?)').bind(hash, client.id, owner, now + REFRESH_MS, since),
    env.DB.prepare('UPDATE clients SET used=1 WHERE id=? AND used=0').bind(client.id),
  ]);
  if ((await relay.generation()) !== g) {
    await env.DB.prepare('DELETE FROM sessions WHERE token=?').bind(hash).run();
    return json({ error: 'invalid_grant' }, 400);
  }
  const access = await signToken(env, { p: 'a', o: owner, c: client.id, n: client.name.slice(0, 40), g, e: now + ACCESS_SECONDS * 1000 });
  return json({ access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: 'frame' });
}

export async function token(req: Request, env: Env): Promise<Response> {
  const form = new URLSearchParams(await req.text());
  let clientId = form.get('client_id') ?? '';
  let secret = form.get('client_secret') ?? '';
  const basic = req.headers.get('authorization');
  if (basic?.startsWith('Basic ')) {
    try {
      const [id, pass] = atob(basic.slice(6)).split(':');
      clientId = decodeURIComponent(id ?? '');
      secret = decodeURIComponent(pass ?? '');
    } catch {
      return json({ error: 'invalid_client' }, 401);
    }
  }
  const client = await env.DB.prepare('SELECT * FROM clients WHERE id=?').bind(clientId).first<{ id: string; name: string; secret: string | null }>();
  if (!client) return json({ error: 'invalid_client' }, 401);
  if (client.secret && client.secret !== (await sha256(secret))) return json({ error: 'invalid_client' }, 401);

  const type = form.get('grant_type');
  if (type === 'authorization_code') {
    const hash = await sha256(form.get('code') ?? '');
    const grant = await env.DB.prepare('DELETE FROM grants WHERE code=? RETURNING *').bind(hash).first<{ client: string; owner: string; challenge: string; redirect: string; expires: number }>();
    if (!grant || grant.expires < Date.now() || grant.client !== client.id || grant.redirect !== form.get('redirect_uri')) return json({ error: 'invalid_grant' }, 400);
    if ((await sha256(form.get('code_verifier') ?? '')) !== grant.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE failed.' }, 400);
    return issue(env, client, grant.owner, Date.now());
  }
  if (type === 'refresh_token') {
    const hash = await sha256(form.get('refresh_token') ?? '');
    const session = await env.DB.prepare('SELECT * FROM sessions WHERE token=?').bind(hash).first<{ client: string; owner: string; expires: number; since: number }>();
    if (!session || session.expires < Date.now() || session.client !== client.id) return json({ error: 'invalid_grant' }, 400);
    await env.DB.prepare('UPDATE sessions SET expires=MIN(expires, ?) WHERE token=?').bind(Date.now() + REFRESH_GRACE_MS, hash).run();
    return issue(env, client, session.owner, session.since);
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

/** El acceso con el que un chat llama a /mcp. */
export async function accessFrom(env: Env, header: string | null): Promise<Access | null> {
  if (!header?.startsWith('Bearer ')) return null;
  return verifyToken<Access>(env, header.slice(7).trim(), 'a');
}

/** Código de 8 letras y cifras sin las que se confunden. */
export function newPairingCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = crypto.getRandomValues(new Uint8Array(8));
  let out = '';
  for (let i = 0; i < 8; i++) out += alphabet[(pick[i] ?? 0) % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Código nuevo para la cuenta; los más viejos dejan de valer. */
export async function newPairing(env: Env, owner: string): Promise<{ code: string; expires: number }> {
  const code = newPairingCode();
  const expires = Date.now() + PAIR_MS;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM pairings WHERE owner=?1 AND code NOT IN (SELECT code FROM pairings WHERE owner=?1 ORDER BY expires DESC LIMIT ?2)').bind(owner, PAIRS_PER_OWNER - 1),
    env.DB.prepare('INSERT INTO pairings(code, owner, expires, tries) VALUES(?,?,?,0)').bind(await sha256(normalizeCode(code)), owner, expires),
  ]);
  return { code, expires };
}

/** Los chats con permiso vigente (por nombre: desde cuándo y su última
 *  autorización) y las Frame abiertas ahora. */
export async function ownerStatus(env: Env, owner: string) {
  const { results } = await env.DB.prepare(
    'SELECT c.name AS name, MIN(s.since) AS since, MAX(s.since) AS latest FROM sessions s JOIN clients c ON c.id = s.client WHERE s.owner=? AND s.expires>? GROUP BY c.name ORDER BY since',
  )
    .bind(owner, Date.now())
    .all<{ name: string; since: number; latest: number }>();
  return { chats: results, devices: await relayOf(env, owner).devices() };
}

/** Retira el permiso a todos los chats de la cuenta, también a los accesos vivos. */
export async function revokeOwner(env: Env, owner: string): Promise<void> {
  await relayOf(env, owner).revoke();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE owner=?').bind(owner),
    env.DB.prepare('DELETE FROM grants WHERE owner=?').bind(owner),
    env.DB.prepare('DELETE FROM pairings WHERE owner=?').bind(owner),
  ]);
}
