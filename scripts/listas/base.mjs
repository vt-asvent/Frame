// Lo común de la prueba de Música → Añadir (scripts/probar-listas.mjs): el
// código real empaquetado una vez, y para cada caso un contexto aislado de
// Node (node:vm) con su reloj de mentira, su almacenamiento y sus sondas.
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(root, 'scripts', 'listas');

const FAKED = /^(@tauri-apps\/api\/core|react|@\/lib\/(i18n|extensions\/engine-app|music-import|music-db|telemetry|supabase\/client|nube))$/;

const bundle = await esbuild.build({
  entryPoints: [path.join(dir, 'entrada.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
  alias: { '@': path.join(root, 'src') },
  plugins: [
    {
      name: 'frame-falso',
      setup(build) {
        build.onResolve({ filter: FAKED }, () => ({ path: path.join(dir, 'falsos.ts') }));
      },
    },
  ],
});
const engine = new vm.Script(bundle.outputFiles[0].text, { filename: 'listas.js' });

/** Deja correr lo que esté pendiente de una promesa (sin tiempo de por medio). */
export const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((resolve) => setImmediate(resolve));
};

class MemoryStorage {
  #map = new Map();
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
    this.#map.set(String(key), String(value));
  }
  removeItem(key) {
    this.#map.delete(key);
  }
}

/**
 * Un Frame de prueba: `frame` (el código real), `probe` (lo simulado) y un
 * reloj que solo avanza cuando la prueba lo dice (`advance`), con sus
 * temporizadores: los 20 y 90 s que espera un reintento pasan al instante.
 */
export function makeFrame({ lang = 'es' } = {}) {
  const clock = { now: Date.UTC(2026, 10, 9, 15, 0, 0), timers: new Map(), seq: 0, errors: [] };
  const schedule = (fn, ms, every) => {
    clock.seq += 1;
    clock.timers.set(clock.seq, { at: clock.now + Math.max(0, Number(ms) || 0), fn, every });
    return clock.seq;
  };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length > 0) super(...args);
      else super(clock.now);
    }
    static now() {
      return clock.now;
    }
  }
  const probe = {
    page: () => {
      throw new Error('sin página');
    },
    images: new Map(),
    events: [],
    storage: 'ok',
    songs: 0,
    lang,
    session: true,
    nube: async () => new Response('{}', { status: 500 }),
  };
  let ids = 0;
  const sandbox = {
    console,
    __lista: probe,
    Date: FakeDate,
    setTimeout: (fn, ms) => schedule(fn, ms, 0),
    setInterval: (fn, ms) => schedule(fn, ms, Math.max(1, Number(ms) || 1)),
    clearTimeout: (id) => void clock.timers.delete(id),
    clearInterval: (id) => void clock.timers.delete(id),
    localStorage: new MemoryStorage(),
    navigator: { onLine: true },
    crypto: { randomUUID: () => `tarjeta-${++ids}` },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    Response,
    Headers,
    AbortController,
    DOMException,
    atob,
    btoa,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);
  engine.runInContext(context);

  /** Avanza el reloj, disparando por orden lo que venza por el camino. */
  const advance = async (ms) => {
    const end = clock.now + ms;
    for (;;) {
      let next = null;
      for (const [id, timer] of clock.timers) {
        if (timer.at <= end && (!next || timer.at < next.timer.at || (timer.at === next.timer.at && id < next.id))) next = { id, timer };
      }
      if (!next) break;
      clock.now = Math.max(clock.now, next.timer.at);
      if (next.timer.every) next.timer.at += next.timer.every;
      else clock.timers.delete(next.id);
      try {
        next.timer.fn();
      } catch (error) {
        clock.errors.push(error);
      }
      await settle();
    }
    clock.now = end;
    await settle();
  };

  return { frame: sandbox.frame, probe, context: sandbox, clock, advance, seconds: (n) => advance(n * 1000) };
}

// ------------------------------------------------------------
// Comprobaciones
// ------------------------------------------------------------
const results = { passed: 0, failed: [] };
let group = '';

export const section = (name) => {
  group = name;
  console.log(`\n${name}`);
};

/** Una comprobación: lo obtenido y lo esperado se comparan como JSON. */
export function check(label, got, want) {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) {
    results.passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    results.failed.push(`${group} · ${label}`);
    console.log(`  ✗ ${label}\n      obtenido: ${a}\n      esperado: ${b}`);
  }
}

export const ok = (label, condition, detail = '') => {
  if (condition) {
    results.passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    results.failed.push(`${group} · ${label}`);
    console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ''}`);
  }
};

/** El mensaje con que falla una promesa ('' si no falla). */
export const failure = async (promise) => {
  try {
    await promise;
    return '';
  } catch (error) {
    return String(error?.message ?? error);
  }
};

export const summary = () => results;
