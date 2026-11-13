// Frame · IA en la nube: MCP remoto para claude.ai (web, escritorio y
// celular) y los demás chats que admiten conectores. Aquí no viven los datos:
// cada llamada pasa, por el relé de la cuenta, a una Frame abierta, y la
// respuesta vuelve igual. También lee la foto de los horarios (horario.ts).
// Ver README.md.
import { readTimetable } from './horario';
import { accessFrom, authorize, metadata, newPairing, ownerStatus, register, revokeOwner, token } from './oauth';
import { translateLyrics } from './letras';
import { bibliotecaArchivo, bibliotecaIndice, bibliotecaTarjetas, bibliotecaVista, sincronizar } from './biblioteca';
import { asegurarAbiertos, loreFile, loreIndex, loreView } from './lore';
import { loreAccess, loreAccessCleanup, loreActivate, loreSendCode } from './lore-acceso';
import { callerFromApp } from './supabase';
import { type Env, json, random, relayOf, signToken, verifyToken } from './util';

export { FrameRelay } from './relay';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, range, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-session-id, content-disposition, content-length, content-range, accept-ranges',
};
const MAX_BODY = 1_000_000;
/** El cron de la Biblioteca (wrangler.toml). */
const CADA_5_MIN = '*/5 * * * *';
/** El pase de la app para abrir su WebSocket: un minuto y un solo uso. */
const PASS_MS = 60_000;

function withCors(r: Response): Response {
  // Las redirecciones de Response.redirect son inmutables.
  const out = new Response(r.body, r);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

async function mcp(req: Request, env: Env, origin: string): Promise<Response> {
  const denied = () => json({ error: 'unauthorized' }, 401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
  const access = await accessFrom(env, req.headers.get('authorization'));
  if (!access) return denied();
  if (req.method === 'GET') return new Response(null, { status: 405, headers: { allow: 'POST' } });
  if (req.method === 'DELETE') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response(null, { status: 405 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }, 413);
  const out = await relayOf(env, access.o).mcp(raw, { gen: access.g, client: access.n });
  if (out.status === 401) return denied();
  if (out.body === undefined) return new Response(null, { status: out.status });
  return new Response(out.body, { status: out.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

/** Lo que pide la app, con su sesión de Frame. */
async function app(req: Request, env: Env, path: string, url: URL): Promise<Response> {
  const caller = await callerFromApp(env, req.headers.get('authorization'));
  // 401 solo si Supabase dijo que esa sesión no vale. Si no se le pudo preguntar, la sesión
  // puede estar intacta: 503, y la app reintenta en vez de mandar al usuario a entrar de nuevo.
  if (!caller.user) return caller.why === 'unavailable' ? json({ error: 'auth-unavailable' }, 503, { 'retry-after': '5' }) : json({ error: 'unauthorized' }, 401);
  const user = caller.user;
  const owner = user.owner;
  if (req.method === 'GET' && path.startsWith('/app/lore/archivo/')) return loreFile(env, user, path.slice('/app/lore/archivo/'.length));
  if (req.method === 'GET' && path.startsWith('/app/lore/vista/')) return loreView(env, user, path.slice('/app/lore/vista/'.length));
  if (req.method === 'GET' && path.startsWith('/app/biblioteca/archivo/')) return bibliotecaArchivo(req, env, user, path.slice('/app/biblioteca/archivo/'.length));
  if (req.method === 'GET' && path.startsWith('/app/biblioteca/vista/')) return bibliotecaVista(env, user, path.slice('/app/biblioteca/vista/'.length));
  if (req.method === 'GET' && path.startsWith('/app/biblioteca/tarjetas/')) return bibliotecaTarjetas(env, user, path.slice('/app/biblioteca/tarjetas/'.length));
  switch (`${req.method} ${path}`) {
    case 'POST /app/pair':
      return json(await newPairing(env, owner));
    case 'POST /app/ticket':
      return json({ ticket: await signToken(env, { p: 'w', o: owner, n: random(12), e: Date.now() + PASS_MS }) });
    case 'GET /app/status':
      return json(await ownerStatus(env, owner));
    case 'POST /app/revoke':
      await revokeOwner(env, owner);
      return json({ ok: true });
    case 'POST /app/horario':
      return readTimetable(req, env, owner);
    case 'POST /app/traducir':
      return translateLyrics(req, env, owner);
    case 'GET /app/lore':
      return loreIndex(env, user);
    case 'GET /app/biblioteca':
      return bibliotecaIndice(env, user, url);
    case 'GET /app/lore/acceso':
      return loreAccess(env, user);
    case 'POST /app/lore/codigo':
      return loreSendCode(req, env, user);
    case 'POST /app/lore/activar':
      return loreActivate(req, env, user);
    default:
      return json({ error: 'not_found' }, 404);
  }
}

/** WebSocket de una Frame: va directo al relé de su cuenta (sin CORS: no es fetch). */
async function socket(req: Request, env: Env): Promise<Response> {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'upgrade_required' }, 426);
  const ticket = new URL(req.url).searchParams.get('ticket') ?? '';
  const pass = await verifyToken<{ p: 'w'; o: string; n: string; e: number }>(env, ticket, 'w');
  if (!pass?.n) return json({ error: 'unauthorized' }, 401);
  const headers = new Headers(req.headers);
  headers.set('x-frame-pase', pass.n);
  headers.set('x-frame-caduca', String(pass.e));
  return relayOf(env, pass.o).fetch(new Request(req.url, { headers }));
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const meta = metadata(url.origin);
  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') return json(meta.resource);
  if (path === '/.well-known/oauth-authorization-server' || path === '/.well-known/oauth-authorization-server/mcp') return json(meta.server);
  if (path === '/.well-known/openid-configuration') return json(meta.server);
  if (path === '/register' && req.method === 'POST') return register(req, env);
  if (path === '/authorize') return authorize(req, env);
  if (path === '/token' && req.method === 'POST') return token(req, env);
  if (path === '/mcp') return mcp(req, env, url.origin);
  if (path.startsWith('/app/')) return app(req, env, path, url);
  if (path === '/') return json({ name: 'Frame', mcp: `${url.origin}/mcp` });
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      if (new URL(req.url).pathname === '/app/socket') return await socket(req, env);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      return withCors(await route(req, env));
    } catch (e) {
      // Nunca argumentos ni respuestas en el registro: solo qué falló.
      console.error('fetch', String(e).slice(0, 200));
      return withCors(json({ error: 'server' }, 500));
    }
  },

  /**
   * Cada 5 minutos: la Biblioteca lee la carpeta «AK Lore» de Drive (biblioteca.ts).
   * Cada día: fuera lo caducado, los registros de chats que nunca se conectaron y las cuentas de lecturas, traducciones, neuronas y descargas de días pasados.
   */
  async scheduled(event: ScheduledController, env: Env, wait: ExecutionContext): Promise<void> {
    if (event.cron === CADA_5_MIN) {
      const v = await sincronizar(env).catch((e) => ({ error: String(e).slice(0, 200) }));
      if ('error' in v && v.error) console.error('biblioteca', v.error);
      else console.log('biblioteca', JSON.stringify(v));
      return;
    }
    const now = Date.now();
    wait.waitUntil(
      env.DB.batch([
        env.DB.prepare('DELETE FROM pairings WHERE expires<?').bind(now),
        env.DB.prepare('DELETE FROM grants WHERE expires<?').bind(now),
        env.DB.prepare('DELETE FROM sessions WHERE expires<?').bind(now),
        env.DB.prepare('DELETE FROM clients WHERE used=0 AND created<?').bind(now - 86_400_000),
        env.DB.prepare('DELETE FROM lecturas WHERE day<?').bind(new Date(now).toISOString().slice(0, 10)),
        env.DB.prepare('DELETE FROM traducciones WHERE day<?').bind(new Date(now).toISOString().slice(0, 10)),
        env.DB.prepare('DELETE FROM neuronas WHERE day<?').bind(new Date(now).toISOString().slice(0, 10)),
        env.DB.prepare('DELETE FROM lore_descargas WHERE day<?').bind(new Date(now).toISOString().slice(0, 10)),
        env.DB.prepare("DELETE FROM lore_estado WHERE k LIKE 'lote:%' AND k<?").bind(`lote:${new Date(now).toISOString().slice(0, 10)}`),
        ...loreAccessCleanup(env, now),
      ]).then(() => undefined),
    );
    // Aparte del lote: si esta tabla faltara, no debe llevarse por delante el resto de la limpieza.
    wait.waitUntil(
      asegurarAbiertos(env).then(() =>
        env.DB.prepare('DELETE FROM lore_abiertos WHERE day<?')
          .bind(new Date(now).toISOString().slice(0, 10))
          .run()
          .then(
            () => undefined,
            () => undefined,
          ),
      ),
    );
  },
};
