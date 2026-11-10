#!/usr/bin/env node
// ============================================================
// Prueba de la sesión: entrar, salir y no quedarse esperando (1.9.2).
//
//   node scripts/probar-sesion.mjs
//   node scripts/probar-sesion.mjs --solo=arranque     (un solo grupo)
//   VERBOSO=1 node scripts/probar-sesion.mjs           (lo que supabase-js escribe en la consola)
//
// Cada equipo es un contexto aislado de Node (node:vm) con el código REAL de
// src/lib (supabase/auth.ts, supabase/client.ts, capped-fetch.ts) y la biblioteca
// supabase-js de verdad, empaquetados con esbuild. Lo único simulado es la
// red: un `fetch` que contesta como Supabase Auth y al que se le puede pedir
// que tarde, que no conteste nunca o que no haya conexión; como el de verdad,
// una petición sin respuesta solo termina si alguien la cancela.
//
// Es lo que no se puede probar a mano: qué pasa al cerrar sesión o al entrar
// cuando la red se traga los paquetes, y que nada que quedó esperando por
// detrás toque después la sesión de quien entra.
//
// Desde la 1.9.5 también lo que blinda la sesión: qué respuestas de Auth la
// cierran y cuáles no (session-fetch.ts), el reloj del equipo corrido, el
// almacenamiento lleno (session-store.ts), el vigía (session-guard.ts) y lo que
// pide a la nube de Frame (nube.ts).
//
// Los plazos son los de verdad (5 s, 15 s, el medio minuto que supabase-js
// insiste en renovar, el minuto que descansa tras un fallo): los grupos corren
// a la vez y el conjunto tarda lo que el más largo, unos 100 s. No usa la red
// ni la nube real.
// ============================================================

import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts', 'sesion');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const verbose = !!process.env.VERBOSO;

// ------------------------------------------------------------
// El código de la sesión, empaquetado una vez
// ------------------------------------------------------------
const fakes = new Map(['@/lib/devices', '@/lib/image-sync', '@/lib/i18n'].map((id) => [id, path.join(dir, 'frame-falso.ts')]));
const bundle = await esbuild.build({
  entryPoints: [path.join(dir, 'dispositivo.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.VITE_SUPABASE_URL': '"https://frame-prueba.supabase.co"',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '"llave-publica-de-prueba"',
    'import.meta.env.VITE_SITE_URL': '"http://localhost"',
  },
  plugins: [
    {
      name: 'frame-falso',
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/(devices|image-sync|i18n)$/ }, (args) => ({ path: fakes.get(args.path) }));
      },
    },
  ],
});
const engine = new vm.Script(bundle.outputFiles[0].text, { filename: 'sesion.js' });

// ------------------------------------------------------------
// La nube simulada: Supabase Auth, y poco más
// ------------------------------------------------------------
const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const USER = '0c1d2e3f-0000-4000-8000-00000000f4a3';

function makeServer() {
  return {
    /** Cada petición: { route, method, query, bearer, outcome }. */
    log: [],
    /** Cómo responde cada ruta: 'ok', 'hang' (nunca), 'offline', 'stall' (contesta y no termina el cuerpo) o los ms que tarda. */
    modes: {},
    /** Estado HTTP de /logout (204 normal; 401: esa sesión ya no existía). */
    logoutStatus: 204,
    /** Lo que dura la llave de acceso, en segundos. */
    expiresIn: 3600,
    /** Reloj del servidor menos el de este equipo, en segundos (un equipo con la hora mal). */
    clockAhead: 0,
    /** Lo que contesta la nube de Frame a cada petición (por defecto, que sí). */
    nube: () => json({ ok: true }),
    tokens: 0,
    sessions: 0,
  };
}

function sessionBody(server, sessionId) {
  const now = Math.floor(Date.now() / 1000) + (server.clockAhead ?? 0);
  server.tokens += 1;
  const payload = { sub: USER, exp: now + server.expiresIn, session_id: sessionId, n: server.tokens };
  return {
    access_token: `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.firma`,
    token_type: 'bearer',
    expires_in: server.expiresIn,
    expires_at: now + server.expiresIn,
    refresh_token: `renovar-${sessionId}-${server.tokens}`,
    user: {
      id: USER,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'diego@prueba.test',
      app_metadata: { provider: 'email' },
      user_metadata: { username: 'diego', ...(server.padding ? { pad: server.padding } : {}) },
      identities: [{ id: '1', provider: 'email' }],
      created_at: '2026-10-01T00:00:00.000Z',
    },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function routeOf(url) {
  if (url.hostname === 'frame-ia.vtasvent.workers.dev') return 'nube';
  if (url.pathname === '/auth/v1/token') return { password: 'password', id_token: 'id_token', refresh_token: 'refresh' }[url.searchParams.get('grant_type')] ?? 'token';
  if (url.pathname === '/auth/v1/logout') return 'logout';
  if (url.pathname === '/auth/v1/user') return 'user';
  return 'other';
}

/** Los «no» de Supabase Auth y lo que se le parece sin serlo. */
const AUTH = {
  notFound: { status: 400, body: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' } },
  alreadyUsed: { status: 400, body: { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' } },
  legacy: { status: 400, body: { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' } },
  rateLimit: { status: 429, body: { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } },
  conflict: { status: 409, body: { code: 409, error_code: 'conflict', msg: 'Too many concurrent token refresh requests on the same session or refresh token' } },
  portal: { status: 200, raw: '<html><body>Inicie sesión en la red del colegio</body></html>', type: 'text/html' },
  portal511: { status: 511, raw: 'Network Authentication Required', type: 'text/plain' },
  emptyOk: { status: 200, body: {} },
  gateway: { status: 401, body: { message: 'Invalid API key' } },
  proxy403: { status: 403, raw: '<html>Forbidden</html>', type: 'text/html' },
  badRequest: { status: 400, body: { code: 400, error_code: 'validation_failed', msg: 'Refresh token is not valid' } },
};

function answer(server, route, init, entry) {
  const mode = server.modes[route];
  // Una respuesta a medida: { status, body } (JSON) o { status, raw, type }.
  if (mode && typeof mode === 'object') {
    entry.status = mode.status;
    return mode.raw !== undefined ? new Response(mode.raw, { status: mode.status, headers: { 'content-type': mode.type ?? 'text/plain' } }) : json(mode.body, mode.status);
  }
  if (route === 'nube') return server.nube(entry.bearer, entry);
  if (route === 'password' || route === 'id_token') {
    server.sessions += 1;
    return json(sessionBody(server, `sesion-${server.sessions}`));
  }
  if (route === 'refresh') {
    const sent = String(JSON.parse(String(init.body ?? '{}')).refresh_token ?? '');
    const sessionId = /^renovar-(.+)-\d+$/.exec(sent)?.[1] ?? 'sesion-desconocida';
    return json(sessionBody(server, sessionId));
  }
  if (route === 'logout') {
    entry.scope = new URLSearchParams(entry.query).get('scope');
    return server.logoutStatus === 204 ? new Response(null, { status: 204 }) : json({ code: server.logoutStatus, msg: 'no existe esa sesión' }, server.logoutStatus);
  }
  if (route === 'user') return json(sessionBody(server, 'x').user);
  return json({});
}

/** El `fetch` de un equipo. Como el de verdad: sin respuesta, solo termina si se cancela. */
const fetchFor = (server) => (input, init = {}) =>
  new Promise((resolve, reject) => {
    const url = new URL(typeof input === 'string' ? input : (input.href ?? input.url));
    const signal = init.signal ?? null;
    const route = routeOf(url);
    const bearer = new Headers(init.headers ?? {}).get('authorization')?.replace(/^Bearer /, '') ?? null;
    const entry = { at: Date.now(), route, method: String(init.method ?? 'GET').toUpperCase(), path: url.pathname, query: url.search, bearer, outcome: 'pending' };
    server.log.push(entry);
    const cancelled = () => signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    if (signal?.aborted) {
      entry.outcome = 'never-sent';
      reject(cancelled());
      return;
    }
    const mode = typeof server.modes[route] === 'object' ? 'ok' : (server.modes[route] ?? 'ok');
    if (mode === 'offline') {
      entry.outcome = 'offline';
      reject(new TypeError('Failed to fetch'));
      return;
    }
    let body = null;
    signal?.addEventListener(
      'abort',
      () => {
        if (entry.outcome === 'pending' || entry.outcome === 'stalled') entry.outcome = 'aborted';
        reject(cancelled());
        try {
          body?.error(cancelled());
        } catch {
          /* el cuerpo ya se había cerrado */
        }
      },
      { once: true }
    );
    if (mode === 'hang') return;
    setTimeout(
      () => {
        if (signal?.aborted) return;
        if (mode === 'stall') {
          // Llegan las cabeceras; el cuerpo, nunca.
          entry.outcome = 'stalled';
          resolve(new Response(new ReadableStream({ start: (controller) => void (body = controller) }), { status: 200 }));
          return;
        }
        entry.outcome = 'answered';
        resolve(answer(server, route, init, entry));
      },
      typeof mode === 'number' ? mode : 15
    );
  });

// ------------------------------------------------------------
// Equipos
// ------------------------------------------------------------
class MemoryStorage {
  #map = new Map();
  /** Tope de caracteres (claves + valores), como el de localStorage; `vetoed`: no deja escribir nada. */
  quota = Infinity;
  vetoed = false;
  get used() {
    let total = 0;
    for (const [key, value] of this.#map) total += key.length + value.length;
    return total;
  }
  get length() {
    return this.#map.size;
  }
  key(index) {
    return [...this.#map.keys()][index] ?? null;
  }
  getItem(key) {
    return this.#map.has(key) ? this.#map.get(key) : null;
  }
  setItem(key, value) {
    const text = String(value);
    const before = this.#map.has(key) ? key.length + this.#map.get(key).length : 0;
    if (this.vetoed || this.used - before + key.length + text.length > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.#map.set(key, text);
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  clear() {
    this.#map.clear();
  }
}

const silent = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace'].map((name) => [name, () => undefined]));

/** `seed`: lo que había guardado en el equipo antes de abrir Frame. `quota`: lo que cabe en su almacenamiento. */
function device({ seed = {}, quota = Infinity } = {}) {
  const server = makeServer();
  const storage = new MemoryStorage();
  for (const [key, value] of Object.entries(seed)) storage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  storage.quota = quota;
  const events = new EventTarget();
  const probe = { unlinks: 0, unlinkDelay: 0 };
  const sandbox = {
    console: verbose ? console : silent,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    Event,
    EventTarget,
    CustomEvent,
    DOMException,
    AbortController,
    AbortSignal,
    Headers,
    Request,
    Response,
    ReadableStream,
    Blob,
    FormData,
    URL,
    URLSearchParams,
    structuredClone,
    performance,
    WebSocket: globalThis.WebSocket,
    fetch: fetchFor(server),
    localStorage: storage,
    navigator: { onLine: true, language: 'es-PE', userAgent: 'frame-prueba' },
    location: { href: 'http://localhost/', origin: 'http://localhost', hash: '', search: '' },
    document: { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    __probe: probe,
  };
  vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', sandbox);
  engine.runInContext(sandbox);
  const frame = sandbox.frame;
  const dev = { frame, server, storage, probe, authEvents: [], opened: [] };
  events.addEventListener(frame.SESSION_OPENED_EVENT, (event) => dev.opened.push(event.detail));
  /** Como layout.tsx: escucha los avisos de supabase-js (y con ello arranca el cliente). */
  dev.listen = () =>
    frame.onAuthChange((event, session) => dev.authEvents.push({ event, token: session?.access_token ?? null, stored: frame.hasStoredSession(), at: Date.now() }));
  dev.storedToken = () => {
    try {
      return JSON.parse(storage.getItem('aether-auth') ?? 'null')?.access_token ?? null;
    } catch {
      return null;
    }
  };
  dev.calls = (route, outcome) => server.log.filter((entry) => entry.route === route && (!outcome || entry.outcome === outcome));
  return dev;
}

// ------------------------------------------------------------
// Medir
// ------------------------------------------------------------
const failures = [];

function report() {
  const lines = [];
  return {
    lines,
    say: (text) => lines.push(text),
    check(ok, text) {
      lines.push(`  ${ok ? '✓' : '✗'} ${text}`);
      if (!ok) failures.push(text);
    },
  };
}

/** Lo que tarda `task` (ms) y lo que devuelve; `limit`: si no termina, se da por colgada. */
async function timed(task, limit = 60_000) {
  const start = performance.now();
  let hung = false;
  const value = await Promise.race([task().catch((error) => ({ thrown: error })), sleep(limit).then(() => ((hung = true), undefined))]);
  return { ms: Math.round(performance.now() - start), value, hung };
}

const until = async (condition, limit = 10_000) => {
  const start = performance.now();
  while (performance.now() - start < limit) {
    if (condition()) return true;
    await sleep(10);
  }
  return false;
};

const between = (ms, low, high) => ms >= low && ms <= high;

// ============================================================
// Grupos
// ============================================================

async function normal() {
  const { lines, say, check } = report();
  say('\n▶ Entrar y cerrar sesión, con la red bien');
  const dev = device();
  dev.listen();
  const entered = await timed(() => dev.frame.signInWithEmail('diego@prueba.test', 'clave'));
  check(!entered.value?.error && !!entered.value?.session, `entra (${entered.ms} ms)`);
  const token = dev.storedToken();
  check(!!token && dev.frame.storedSessionUserId() === USER, 'la sesión queda guardada en el equipo');
  check(dev.opened.length === 1 && dev.opened[0]?.access_token === token, 'y se anuncia con la sesión en la mano, una vez');
  check(dev.authEvents.filter((e) => e.event === 'SIGNED_IN').length === 1, 'supabase-js también avisa (SIGNED_IN)');

  const left = await timed(() => dev.frame.signOut());
  check(left.ms < 400 && left.value?.error === null, `cerrar sesión no espera a la nube (${left.ms} ms)`);
  check(!dev.frame.hasStoredSession() && dev.frame.storedSessionUserId() === null, 'aquí ya no hay sesión');
  check(dev.probe.unlinks === 1, 'se despidió en Dispositivos antes de salir');
  check(dev.authEvents.filter((e) => e.event === 'SIGNED_OUT').length === 1, 'un solo aviso de cierre (SIGNED_OUT)');
  await until(() => dev.calls('logout', 'answered').length === 1, 3_000);
  const logout = dev.calls('logout')[0];
  check(dev.calls('logout').length === 1 && logout?.bearer === token && logout?.scope === 'local', `la nube se entera por detrás: esa sesión, solo la de este equipo (${logout?.scope})`);
  check(dev.frame.consumeIntentionalSignOut() === true && dev.frame.consumeIntentionalSignOut() === false, 'queda dicho que lo pidió el usuario (una sola vez)');

  say('\n  Cerrar la de todos los equipos (al borrar la cuenta)');
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const second = dev.storedToken();
  const everywhere = await timed(() => dev.frame.signOut({ everywhere: true }));
  const global = dev.calls('logout')[1];
  check(everywhere.value?.error === null && global?.scope === 'global' && global?.bearer === second && global?.outcome === 'answered', `espera a la nube y cierra todas (${everywhere.ms} ms)`);
  check(!dev.frame.hasStoredSession(), 'aquí ya no hay sesión');

  say('\n  La cuenta ya no existe en la nube (401)');
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  dev.server.logoutStatus = 401;
  const gone = await timed(() => dev.frame.signOut({ everywhere: true }));
  check(gone.value?.error === null && !dev.frame.hasStoredSession(), 'no es un fallo: era lo que se quería');
  return lines;
}

async function hungLogout() {
  const { lines, say, check } = report();
  say('\n▶ Cerrar sesión con la red colgada, y volver a entrar enseguida');
  const dev = device();
  dev.listen();
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const first = dev.storedToken();
  dev.server.modes.logout = 'hang';
  const left = await timed(() => dev.frame.signOut());
  check(left.ms < 400 && !left.hung, `cerrar sesión vuelve al momento (${left.ms} ms)`);
  check(!dev.frame.hasStoredSession(), 'aquí ya no hay sesión');
  check(dev.calls('logout', 'pending').length === 1, 'el aviso a la nube sigue en camino, sin respuesta');

  const again = await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const second = dev.storedToken();
  check(!again.error && !!second && second !== first, 'vuelve a entrar: sesión nueva guardada');
  const outsBefore = dev.authEvents.filter((e) => e.event === 'SIGNED_OUT').length;
  await sleep(7_000);
  check(dev.calls('logout', 'aborted').length === 1 && dev.calls('logout', 'pending').length === 0, 'a los 5 s el aviso colgado se cancela solo');
  check(dev.storedToken() === second, 'y la sesión nueva sigue intacta: nada de lo que quedó por detrás la tocó');
  check(dev.authEvents.filter((e) => e.event === 'SIGNED_OUT').length === outsBefore, 'sin ningún aviso de cierre de más');
  const session = await dev.frame.getActiveSession();
  check(session?.access_token === second, 'supabase-js la da por buena');

  say('\n  «Cerrar en todos los equipos» con la red colgada');
  const everywhere = await timed(() => dev.frame.signOut({ everywhere: true }), 20_000);
  check(!everywhere.hung && between(everywhere.ms, 4_500, 7_500), `espera su plazo y sigue, no para siempre (${everywhere.ms} ms)`);
  check(typeof everywhere.value?.error === 'string' && !dev.frame.hasStoredSession(), `dice que la nube no contestó (${everywhere.value?.error}) y aquí ya no hay sesión`);

  say('\n  Dispositivos tarda en contestar');
  dev.server.modes.logout = 'ok';
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  dev.probe.unlinkDelay = 10_000;
  const slow = await timed(() => dev.frame.signOut(), 20_000);
  check(between(slow.ms, 2_800, 3_600), `la despedida no retiene el cierre más de 3 s (${slow.ms} ms)`);
  check(!dev.frame.hasStoredSession(), 'aquí ya no hay sesión');
  return lines;
}

async function offline() {
  const { lines, say, check } = report();
  say('\n▶ Sin conexión');
  const dev = device();
  dev.listen();
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  for (const route of ['password', 'refresh', 'logout', 'user', 'other']) dev.server.modes[route] = 'offline';
  const left = await timed(() => dev.frame.signOut());
  check(left.ms < 400 && left.value?.error === null && !dev.frame.hasStoredSession(), `cerrar sesión funciona igual (${left.ms} ms)`);
  const entered = await timed(() => dev.frame.signInWithEmail('diego@prueba.test', 'clave'));
  const text = dev.frame.describeAuthError(entered.value?.error);
  check(!!entered.value?.error && entered.ms < 2_000, `entrar falla enseguida (${entered.ms} ms)`);
  check(/No se pudo contactar con el servidor/.test(text), `y lo dice en cristiano («${text.slice(0, 44)}…»)`);
  check(dev.opened.length === 1 && !dev.frame.hasStoredSession(), 'sin anunciar ni guardar ninguna sesión nueva');
  return lines;
}

async function hungLogin() {
  const { lines, say, check } = report();
  say('\n▶ Entrar con la red colgada (el servidor no contesta)');
  const dev = device();
  dev.listen();
  dev.server.modes.password = 'hang';
  const entered = await timed(() => dev.frame.signInWithEmail('diego@prueba.test', 'clave'), 40_000);
  check(!entered.hung && between(entered.ms, 14_000, 17_000), `el botón no gira para siempre: a los 15 s hay respuesta (${entered.ms} ms)`);
  const text = dev.frame.describeAuthError(entered.value?.error);
  check(/No se pudo contactar con el servidor/.test(text), `con un mensaje que se entiende («${text.slice(0, 44)}…»)`);
  check(!dev.frame.hasStoredSession() && dev.opened.length === 0, 'sin sesión a medias');

  say('\n  Con Google (reintenta, pero no más de medio minuto)');
  dev.server.modes.id_token = 'hang';
  const google = await timed(() => dev.frame.signInWithGoogleIdToken('id-token-de-google'), 80_000);
  check(!google.hung && between(google.ms, 29_000, 34_000), `dos intentos y lo dice (${google.ms} ms; antes, minuto y medio)`);
  check(dev.calls('id_token').length === 2 && !!google.value?.error, `(${dev.calls('id_token').length} peticiones)`);
  dev.server.modes.id_token = 'ok';
  const ok = await dev.frame.signInWithGoogleIdToken('id-token-de-google');
  check(!ok.error && dev.frame.hasStoredSession() && dev.opened.length === 1, 'con la red de vuelta, entra');
  return lines;
}

async function startup() {
  const { lines, say, check } = report();
  say('\n▶ Frame arranca con la sesión vencida y la red colgada; el usuario cierra sesión y vuelve a entrar');
  const seedServer = makeServer();
  const expired = { ...sessionBody(seedServer, 'sesion-vieja'), expires_at: Math.floor(Date.now() / 1000) - 3600 };
  const dev = device({ seed: { 'aether-auth': expired } });
  dev.server.modes.refresh = 'hang';
  dev.listen();
  await sleep(100);
  check(dev.calls('refresh', 'pending').length === 1, 'supabase-js arranca renovando la sesión anterior: sin respuesta');
  const active = timed(() => dev.frame.getActiveSession(), 60_000);

  const left = await timed(() => dev.frame.signOut());
  check(left.ms < 400 && !dev.frame.hasStoredSession(), `cerrar sesión no espera a ese arranque (${left.ms} ms)`);
  const entered = await timed(() => dev.frame.signInWithEmail('diego@prueba.test', 'clave'));
  const fresh = dev.storedToken();
  check(!entered.value?.error && !!fresh && fresh !== expired.access_token, `entrar tampoco (${entered.ms} ms)`);
  check(dev.opened.length === 1 && dev.opened[0]?.access_token === fresh, 'la sesión nueva se anuncia al momento: la app puede abrirla ya');
  check(dev.authEvents.every((e) => e.event !== 'SIGNED_IN' && e.event !== 'SIGNED_OUT'), 'los avisos de supabase-js siguen en cola (por eso no se depende de ellos)');

  const booted = await active;
  check(!booted.hung && between(booted.ms, 28_000, 36_000), `el arranque de supabase-js termina, no se queda colgado (${booted.ms} ms)`);
  await sleep(300);
  const out = dev.authEvents.findIndex((e) => e.event === 'SIGNED_OUT');
  const into = dev.authEvents.findIndex((e) => e.event === 'SIGNED_IN');
  check(out >= 0 && into > out, `sus avisos llegan entonces, en orden: cierre y entrada (${dev.authEvents.map((e) => e.event).join(', ')})`);
  check(dev.authEvents[out]?.stored === true, 'el de cierre llega con una sesión ya guardada: la app sabe que es viejo y no echa a nadie');
  check(dev.storedToken() === fresh && booted.value?.access_token === fresh, 'la sesión nueva sigue intacta');
  check(dev.calls('refresh').every((entry) => entry.outcome === 'aborted'), `las renovaciones colgadas se cancelaron (${dev.calls('refresh').length})`);

  say('\n  Lo mismo, pero la renovación vieja contesta TARDE (cuando ya entró otra sesión)');
  const late = device({ seed: { 'aether-auth': { ...sessionBody(seedServer, 'sesion-vieja'), expires_at: Math.floor(Date.now() / 1000) - 3600 } } });
  late.server.modes.refresh = 3_000;
  late.listen();
  await sleep(100);
  await late.frame.signOut();
  await late.frame.signInWithEmail('diego@prueba.test', 'clave');
  const kept = late.storedToken();
  await sleep(4_000);
  check(late.calls('refresh', 'answered').length === 1, 'la renovación de la sesión vieja llega 3 s después');
  check(late.storedToken() === kept, 'y se descarta: no pisa la sesión de quien entró');
  return lines;
}

async function midSession() {
  const { lines, say, check } = report();
  say('\n▶ A media sesión, la renovación de la llave no contesta');
  const dev = device();
  dev.listen();
  dev.server.expiresIn = 60; // dentro del margen de supabase-js: cada lectura de la sesión intenta renovarla
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const token = dev.storedToken();
  dev.server.modes.refresh = 'hang';
  const read = await timed(() => dev.frame.getActiveSession(), 60_000);
  check(!read.hung, `leer la sesión termina (${read.ms} ms): antes se quedaba esperando para siempre, y con ella toda la sincronización`);
  check(between(read.ms, 28_000, 36_000), 'tras los reintentos de supabase-js, cada uno con su plazo');
  check(read.value?.access_token === token, 'y devuelve la sesión que hay, que aún vale');
  check(dev.storedToken() === token && dev.authEvents.every((e) => e.event !== 'SIGNED_OUT'), 'sin cerrar la sesión por un fallo de red');
  return lines;
}

async function caps() {
  const { lines, say, check } = report();
  say('\n▶ Los plazos de cada petición (capped-fetch.ts)');
  const dev = device();
  const { cappedFetch, isFetchTimeout } = dev.frame;
  const base = 'https://frame-prueba.supabase.co';

  const ok = await timed(() => cappedFetch(`${base}/rest/v1/backups?select=updated_at`).then((res) => res.json()));
  check(!ok.value?.thrown && ok.ms < 300, `una petición normal pasa sin más (${ok.ms} ms)`);

  dev.server.modes.logout = 'hang';
  const hung = await timed(() => cappedFetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST' }), 20_000);
  check(!hung.hung && between(hung.ms, 4_800, 5_600), `una que no contesta se cancela a su plazo (${hung.ms} ms)`);
  check(isFetchTimeout(hung.value?.thrown) && /failed to fetch/i.test(hung.value?.thrown?.message ?? ''), `y falla como un fallo de red («${hung.value?.thrown?.message}»)`);

  dev.server.modes.other = 'hang';
  const cancel = new AbortController();
  setTimeout(() => cancel.abort(), 100);
  const cancelled = await timed(() => cappedFetch(`${base}/rest/v1/rpc/device_unlink`, { method: 'POST', signal: cancel.signal }), 10_000);
  check(between(cancelled.ms, 80, 400) && !!cancelled.value?.thrown && !isFetchTimeout(cancelled.value.thrown), `quien llama puede cancelarla antes (${cancelled.ms} ms)`);

  const before = dev.server.log.length;
  const dead = new AbortController();
  dead.abort();
  const never = await timed(() => cappedFetch(`${base}/rest/v1/rpc/device_unlink`, { method: 'POST', signal: dead.signal }));
  check(never.ms < 50 && !!never.value?.thrown && dev.server.log.slice(before).every((entry) => entry.outcome === 'never-sent'), 'y una ya cancelada ni sale');

  dev.server.modes.logout = 'stall';
  const stalled = await timed(() => cappedFetch(`${base}/auth/v1/logout?scope=local`, { method: 'POST' }).then((res) => res.text()), 20_000);
  check(!stalled.hung && between(stalled.ms, 4_800, 5_800) && !!stalled.value?.thrown, `una respuesta que se queda a medias también se corta (${stalled.ms} ms)`);
  return lines;
}

// ============================================================
// 1.9.5 · Lo que blinda la sesión
// ============================================================

const SOFT = {
  rateLimit: 'un 429 (demasiadas peticiones)',
  conflict: 'un 409 (dos renovaciones a la vez)',
  portal: 'la página del portal del wifi (200, HTML)',
  portal511: 'un 511 del portal',
  emptyOk: 'un 200 que no trae sesión',
  gateway: 'un 401 de la pasarela, no de Auth',
  proxy403: 'un 403 de un proxy',
  badRequest: 'un 400 de validación',
};
const HARD = {
  notFound: 'la llave de renovación ya no existe',
  alreadyUsed: 'la llave ya se usó (familia revocada)',
  legacy: 'el «invalid_grant» de versiones viejas de Auth',
};

async function answers() {
  const { lines, say, check } = report();
  say('\n▶ Renovar la llave: qué respuesta cierra la sesión y cuál no (session-fetch.ts)');
  const seedServer = makeServer();
  const expired = () => ({ ...sessionBody(seedServer, 'sesion-vieja'), expires_at: Math.floor(Date.now() / 1000) - 3600 });

  say('  Con la llave de acceso ya vencida, lo que NO es un «no» de Supabase Auth:');
  const kept = await Promise.all(
    Object.keys(SOFT).map(async (name) => {
      const dev = device({ seed: { 'aether-auth': expired() } });
      dev.server.modes.refresh = AUTH[name];
      dev.listen();
      const read = await timed(() => dev.frame.getActiveSession(), 70_000);
      await sleep(200);
      return { name, dev, read };
    })
  );
  for (const { name, dev, read } of kept) {
    const out = dev.authEvents.some((e) => e.event === 'SIGNED_OUT');
    check(
      !read.hung && !read.value?.thrown && dev.frame.hasStoredSession() && !out,
      `${SOFT[name]}: la sesión sigue guardada, sin aviso de cierre (${read.ms} ms, ${dev.calls('refresh').length} intentos)`
    );
  }
  const limited = kept.find((entry) => entry.name === 'rateLimit').dev;
  const before = limited.storedToken();
  limited.server.modes.refresh = 'ok';
  // supabase-js descansa un minuto tras un fallo antes de volver a pedirla.
  await sleep(62_000);
  const back = await timed(() => limited.frame.getActiveSession(), 40_000);
  check(!!back.value?.access_token && back.value.access_token !== before && limited.storedToken() === back.value.access_token, 'y cuando el servidor vuelve a contestar bien, la misma sesión se renueva sola');
  check(limited.authEvents.every((e) => e.event !== 'SIGNED_OUT'), 'sin haber pasado por «sesión cerrada»');

  say('  Y lo que SÍ lo es:');
  for (const name of Object.keys(HARD)) {
    const dev = device({ seed: { 'aether-auth': expired() } });
    dev.server.modes.refresh = AUTH[name];
    dev.listen();
    const read = await timed(() => dev.frame.getActiveSession(), 20_000);
    await sleep(200);
    const outs = dev.authEvents.filter((e) => e.event === 'SIGNED_OUT').length;
    check(read.ms < 4_000 && read.value === null && !dev.frame.hasStoredSession() && outs === 1, `${HARD[name]}: la sesión se cierra aquí, con un aviso (${read.ms} ms)`);
    check(dev.calls('refresh').length === 1, 'sin insistir');
  }

  const { refreshEnded } = device().frame;
  const table = [
    [400, { error_code: 'session_expired', msg: 'Invalid Refresh Token: Session Expired (Inactivity)' }, true],
    [400, { error_code: 'session_not_found', msg: 'Invalid Refresh Token: No Valid Session Found' }, true],
    [400, { error_code: 'user_banned', msg: 'Invalid Refresh Token: User Banned' }, true],
    [400, { error_code: 'codigo_nuevo', msg: 'Invalid Refresh Token: Session Expired (Revoked by Newer Login)' }, true],
    [429, { error_code: 'over_request_rate_limit', msg: 'Invalid Refresh Token: no debería contar' }, false],
    [500, { error_code: 'unexpected_failure', msg: 'Invalid Refresh Token' }, false],
    [400, { error_code: 'validation_failed', msg: 'Refresh token is not valid' }, false],
    [400, null, false],
    [403, 'Forbidden', false],
  ];
  check(table.every(([status, body, expected]) => refreshEnded(status, body) === expected), 'la tabla de respuestas de Auth (códigos y textos) se clasifica como se espera');
  return lines;
}

async function guard() {
  const { lines, say, check } = report();
  say('\n▶ El vigía de la sesión (session-guard.ts)');
  const signIn = async (dev) => {
    dev.listen();
    dev.frame.startSessionGuard();
    await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
    return dev.storedToken();
  };
  const lost = (dev) => dev.frame.getConnectionState().sessionLostFor;

  say('  La sesión vive');
  const dev = device();
  const token = await signIn(dev);
  const alive = await timed(() => dev.frame.checkSession());
  const rotated = dev.storedToken();
  check(alive.value === 'alive' && rotated !== token && dev.calls('refresh').length === 1, `se lo pregunta a Supabase renovándola (${alive.ms} ms)`);
  check((await dev.frame.checkSession()) === 'alive' && dev.calls('refresh').length === 1, 'y no vuelve a preguntar enseguida por la misma llave');
  check((await dev.frame.checkSession(token)) === 'alive' && dev.calls('refresh').length === 1, 'una llave rechazada que ya no es la de la sesión no gasta otra pregunta');
  const methods = dev.frame.signInMethodsOf(USER);
  check(methods?.password === true && methods?.google === false, 'queda anotado cómo entra esta cuenta (para ofrecer solo eso al reconectar)');

  say('  La nube cerró la sesión y la llave de acceso aún no vence');
  const zombie = device();
  const held = await signIn(zombie);
  zombie.server.modes.refresh = AUTH.notFound;
  const ended = await timed(() => zombie.frame.checkSession());
  check(ended.value === 'ended' && ended.ms < 3_000, `lo sabe en el acto (${ended.ms} ms; antes, hasta una hora después)`);
  check(lost(zombie) === USER, 'y queda dicho: «Sin conexión con tu cuenta»');
  check(zombie.storedToken() === held && zombie.authEvents.every((e) => e.event !== 'SIGNED_OUT'), 'la llave que aún sirve para los datos no se tira');
  zombie.server.modes.refresh = 'ok';
  const again = await zombie.frame.signInWithEmail('diego@prueba.test', 'clave');
  zombie.frame.sessionRestored();
  check(!again.error && zombie.storedToken() !== held && lost(zombie) === null, 'volver a conectar la misma cuenta quita el aviso, sin salir de la app');
  check((await zombie.frame.checkSession()) === 'alive', 'y la sesión nueva responde');

  say('  La API de datos rechaza la llave (el reloj del equipo cambió)');
  const skew = device();
  const stale = await signIn(skew);
  skew.server.modes.other = { status: 401, body: { code: 'PGRST303', details: null, hint: null, message: 'JWT expired' } };
  await skew.frame.getSupabase().from('backups').select('updated_at').limit(1);
  const renewed = await until(() => skew.calls('refresh').length === 1 && skew.storedToken() !== stale, 5_000);
  check(renewed && lost(skew) === null, 'la llave se renueva sola al primer rechazo (antes: «JWT expired» hasta que venciera aquí)');

  say('  Sin respuesta de la red');
  const dark = device();
  const kept = await signIn(dark);
  dark.server.modes.refresh = 'offline';
  const unknown = await timed(() => dark.frame.checkSession(), 60_000);
  check(unknown.value === 'unknown' && dark.storedToken() === kept && lost(dark) === null, `no se sabe: no se toca nada ni se avisa de nada (${unknown.ms} ms)`);
  return lines;
}

async function clock() {
  const { lines, say, check } = report();
  say('\n▶ El reloj del equipo va mal (session-fetch.ts)');
  const local = () => Math.floor(Date.now() / 1000);
  const storedExpiry = (dev) => JSON.parse(dev.storage.getItem('aether-auth') ?? '{}').expires_at;

  const ahead = device();
  ahead.server.clockAhead = -7200; // el equipo va dos horas ADELANTADO
  ahead.listen();
  await ahead.frame.signInWithEmail('diego@prueba.test', 'clave');
  check(Math.abs(storedExpiry(ahead) - (local() + 3600)) <= 3, 'adelantado 2 h: la caducidad se guarda con el reloj de aquí (ahora + 1 h)');
  for (let i = 0; i < 6; i++) await ahead.frame.getActiveSession();
  check(ahead.calls('refresh').length === 0, 'leer la sesión ya no la renueva en cada lectura (antes: una renovación por lectura, hasta chocar con el tope)');

  const behind = device();
  behind.server.clockAhead = 7200; // el equipo va dos horas ATRASADO
  behind.listen();
  await behind.frame.signInWithEmail('diego@prueba.test', 'clave');
  check(Math.abs(storedExpiry(behind) - (local() + 3600)) <= 3, 'atrasado 2 h: lo mismo (antes creía la llave buena dos horas de más)');
  await behind.frame.checkSession();
  check(behind.calls('refresh').length === 1 && Math.abs(storedExpiry(behind) - (local() + 3600)) <= 3, 'y al renovarla, también');
  return lines;
}

async function storageFull() {
  const { lines, say, check } = report();
  say('\n▶ El equipo se queda sin sitio para guardar (session-store.ts)');
  const dev = device({ quota: 200_000 });
  dev.listen();
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const first = dev.storedToken();
  check(!!first && (dev.storage.getItem('aether-auth-reserva')?.length ?? 0) > 8_000, 'junto a la sesión queda una reserva');
  dev.storage.setItem('relleno', 'x'.repeat(dev.storage.quota - dev.storage.used - 'relleno'.length - 5));
  let full = false;
  try {
    dev.storage.setItem('otra', 'y'.repeat(100));
  } catch {
    full = true;
  }
  check(full, 'el almacenamiento se llena hasta el borde');
  dev.server.padding = 'p'.repeat(600); // la sesión renovada ocupa más que la anterior
  const state = await dev.frame.checkSession();
  check(state === 'alive' && dev.storedToken() !== first && !dev.frame.sessionOnlyInMemory(), 'la llave nueva se guarda igual (antes: error en cada lectura y sesión perdida al reabrir)');
  check(dev.storage.getItem('aether-auth-reserva') === null, 'gastando la reserva, que para eso está');

  const locked = device();
  locked.listen();
  await locked.frame.signInWithEmail('diego@prueba.test', 'clave');
  const onDisk = locked.storedToken();
  locked.storage.vetoed = true;
  const still = await locked.frame.checkSession();
  const session = await locked.frame.getActiveSession();
  check(still === 'alive' && locked.frame.sessionOnlyInMemory(), 'si el equipo no deja escribir nada, la sesión sigue en memoria');
  check(!!session?.access_token && session.access_token !== onDisk && session.access_token === locked.frame.storedAccessToken(), 'y Frame usa la nueva, no la que quedó en el disco');
  return lines;
}

async function cloud() {
  const { lines, say, check } = report();
  say('\n▶ Lo que se pide a la nube de Frame con la sesión (nube.ts)');
  const problem = (run) => run.value?.thrown?.problem ?? null;
  const lost = (dev) => dev.frame.getConnectionState().sessionLostFor;
  const start = async (dev) => {
    dev.listen();
    dev.frame.startSessionGuard();
    await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
    return dev.storedToken();
  };

  const dev = device();
  dev.listen();
  dev.frame.startSessionGuard();
  const none = await timed(() => dev.frame.nubeCall('/app/status'));
  check(none.value?.thrown instanceof dev.frame.NubeAuthError && problem(none) === 'signed-out' && dev.calls('nube').length === 0, 'sin sesión en el equipo: lo dice sin llamar');
  await dev.frame.signInWithEmail('diego@prueba.test', 'clave');
  const t1 = dev.storedToken();
  const ok = await dev.frame.nubeCall('/app/status');
  check(ok.status === 200 && dev.calls('nube')[0]?.bearer === t1, 'con sesión: va con su llave');

  say('  La nube rechaza la llave, pero la sesión vive');
  dev.server.nube = (bearer) => (bearer === t1 ? json({ error: 'unauthorized' }, 401) : json({ ok: true }));
  const healed = await timed(() => dev.frame.nubeCall('/app/lore/codigo', { body: JSON.stringify({ email: 'a@b.c' }) }));
  const t2 = dev.storedToken();
  const lastTwo = dev.calls('nube').slice(-2);
  check(healed.value?.status === 200 && t2 !== t1 && dev.calls('refresh').length === 1, `se renueva y se repite sola: quien llamó ni se entera (${healed.ms} ms; antes: «Tu sesión venció»)`);
  check(lastTwo[0]?.bearer === t1 && lastTwo[1]?.bearer === t2 && lastTwo[1]?.method === 'POST' && lost(dev) === null, 'la repetición va con la llave nueva y sin avisos');

  say('  La nube rechaza la llave y Supabase confirma que la sesión terminó');
  const gone = device();
  await start(gone);
  gone.server.nube = () => json({ error: 'unauthorized' }, 401);
  gone.server.modes.refresh = AUTH.notFound;
  const ended = await timed(() => gone.frame.nubeCall('/app/lore'));
  check(problem(ended) === 'ended' && lost(gone) === USER && gone.calls('nube').length === 1, 'dice «tu sesión se cerró» y deja el aviso para reconectar');
  await gone.frame.signOut();
  const after = await timed(() => gone.frame.nubeCall('/app/lore'));
  check(problem(after) === 'ended' && gone.calls('nube').length === 1, 'y con la sesión ya fuera sigue diciendo lo mismo (no «entra con tu cuenta»)');

  say('  La nube no pudo comprobar la llave (503)');
  const busy = device();
  await start(busy);
  let n = 0;
  busy.server.nube = () => (++n === 1 ? json({ error: 'auth-unavailable' }, 503) : json({ ok: true }));
  const once = await timed(() => busy.frame.nubeCall('/app/status'));
  check(once.value?.status === 200 && n === 2 && between(once.ms, 1_400, 3_000), `un tropiezo suelto se repite solo (${once.ms} ms)`);
  busy.server.nube = () => json({ error: 'auth-unavailable' }, 503);
  const twice = await timed(() => busy.frame.nubeCall('/app/status'));
  check(problem(twice) === 'unverified' && busy.frame.hasStoredSession() && lost(busy) === null && busy.calls('refresh').length === 0, 'si sigue igual: «inténtalo en un momento», sin tocar la sesión');
  busy.server.nube = () => json({ error: 'server' }, 500);
  check((await busy.frame.nubeCall('/app/status')).status === 500, 'otro error del servidor llega tal cual a quien llamó');
  busy.server.modes.nube = 'offline';
  const cut = await timed(() => busy.frame.nubeCall('/app/status'));
  check(!!cut.value?.thrown && !(cut.value.thrown instanceof busy.frame.NubeAuthError), 'y un corte de red sale como corte de red');

  say('  La nube rechaza la llave y Supabase no contesta');
  const dark = device();
  const kept = await start(dark);
  dark.server.nube = () => json({ error: 'unauthorized' }, 401);
  dark.server.modes.refresh = 'offline';
  const unsure = await timed(() => dark.frame.nubeCall('/app/lore'), 60_000);
  check(problem(unsure) === 'unverified' && dark.storedToken() === kept && lost(dark) === null, `no se sabe: «inténtalo en un momento», la sesión intacta (${unsure.ms} ms)`);
  return lines;
}

// ------------------------------------------------------------
const started = Date.now();
// --solo=normal|colgada|sinred|entrar|arranque|renovacion|plazos|respuestas|vigia|reloj|almacen|nube corre solo ese grupo.
const only = process.argv.find((arg) => arg.startsWith('--solo='))?.slice('--solo='.length);
const groups = {
  normal,
  colgada: hungLogout,
  sinred: offline,
  entrar: hungLogin,
  arranque: startup,
  renovacion: midSession,
  plazos: caps,
  respuestas: answers,
  vigia: guard,
  reloj: clock,
  almacen: storageFull,
  nube: cloud,
};
const selected = Object.entries(groups).filter(([name]) => !only || only === name);
const outputs = await Promise.all(
  selected.map(([name, run]) =>
    run().catch((error) => {
      failures.push(`el grupo «${name}» se rompió: ${error?.message ?? error}`);
      return [`\n✗ El grupo «${name}» se rompió:\n${error?.stack ?? error}`];
    })
  )
);
for (const lines of outputs) console.log(lines.join('\n'));

console.log(`\n${failures.length === 0 ? '✓ Todo en orden' : `✗ ${failures.length} comprobaciones fallidas`} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
