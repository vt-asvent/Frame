#!/usr/bin/env node
// ============================================================
// Prueba del relevo de Wire entre equipos (1.9.6 / Android 1.3.5).
//
//   node scripts/probar-relevo.mjs
//   node scripts/probar-relevo.mjs --solo=azar        (un grupo)
//   SEMILLAS=40 node scripts/probar-relevo.mjs        (más recorridos al azar)
//   node scripts/probar-relevo.mjs --controles        (controles negativos: ver abajo)
//
// Cada equipo es un contexto aislado de Node (node:vm) con el relevo REAL de
// src/lib/extensions/wire/ (relay.ts, drive.ts, plan.ts, removed.ts) y las
// claves de song-keys.ts, empaquetados con esbuild. Lo simulado es la red: un
// Google Drive falso que habla el mismo HTTP que el de verdad (búsquedas,
// subidas multiparte y reanudables, propiedades, papelera, cuota, huellas
// SHA-256, paginación y su retraso al listar lo recién creado) y al que se le
// pueden provocar fallos: cortes, 401, 429, 5xx, Drive lleno, descargas
// truncadas o corruptas, respuestas que se pierden después de hacer efecto.
// Cada equipo tiene además su propio reloj (que puede estar mal), su
// almacenamiento (que puede llenarse) y su almacén de música (que puede
// perderse).
//
// scripts/probar-wire.mjs sigue probando las reglas puras (plan.ts).
// No usa la red ni el Drive real.
// ============================================================

import vm from 'node:vm';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts', 'relevo');
const only = process.argv.find((arg) => arg.startsWith('--solo='))?.slice(7) ?? null;
const verbose = process.argv.includes('--ver');

// ------------------------------------------------------------
// Controles negativos: una prueba que nunca falla no prueba nada. Con
// `--controles`, este mismo guion se ejecuta una vez por cada blindaje QUITADO
// (el cambio se hace al empaquetar; el código en disco no se toca) y se
// comprueba que el grupo que lo vigila falla.
// ------------------------------------------------------------
const CONTROLS = {
  'sin-audio': { group: 'borrado', file: 'relay.ts', from: 'const present = await audioPresent(ctx.songs).catch(() => null);', to: 'const present = null as Set<string> | null;', what: '«lo tengo» vuelve a ser tener la ficha, no el audio' },
  'sin-comprobar': { group: 'integridad', file: 'relay.ts', from: 'if (whole) return blob;', to: 'return blob;', what: 'lo que baja ya no se comprueba' },
  'lista-vieja': { group: 'cola', file: 'relay.ts', from: 'rememberArrived(arrived);', to: '', what: 'la vuelta encadenada usa la biblioteca de antes (el fallo de la 1.9.5)' },
  'carpeta-fija': { group: 'carpeta', file: 'relay.ts', from: 'const isRoot = (f: DriveFile) =>', to: 'if (mine) return mine.id;\n  const isRoot = (f: DriveFile) =>', what: 'la carpeta se da por sabida, como hasta la 1.9.5' },
  'reloj-del-equipo': { group: 'reloj', file: 'relay.ts', from: 'const driveNow = () => Date.now() + (clockOffset ?? 0);', to: 'const driveNow = () => Date.now();', what: 'la hora vuelve a ser la del equipo' },
  'sin-lo-propio': { group: 'borrado', file: 'plan.ts', from: 'if (!local.have.has(item.key) && !local.declined.has(item.key)) download.push(item);', to: 'if (!local.have.has(item.key) && !local.declined.has(item.key) && item.from !== local.deviceId) download.push(item);', what: 'un equipo no puede volver a bajar lo que él subió' },
  'sin-pausa': { group: 'google', file: 'relay.ts', from: '} else if (Date.now() < pausedUntil) return;', to: '}', what: 'tras un «ve más despacio» no se espera' },
  'sin-reserva': { group: 'lleno', file: 'relay.ts', from: 'if (blob.size > budget.room) {', to: 'if (false) {', what: 'se sube aunque el Drive esté casi lleno' },
  'identidad-heredada': { group: 'identidad', file: 'relay.ts', from: "if (!hadKey) for (const name of ['device', 'deviceFile', 'lastRecord']) extWrite(WIRE, name, null);", to: '', what: 'una copia de los datos en otro aparato conserva la identidad del primero' },
  'borrado-sin-anotar': { group: 'borrado', file: 'removed.ts', from: "if (!uid || !id || !key) return;", to: 'return;', what: 'los borrados del usuario no se anotan' },
};
const control = process.argv.find((arg) => arg.startsWith('--control='))?.slice(10) ?? null;
if (control && !CONTROLS[control]) throw new Error(`control desconocido: ${control}`);

if (process.argv.includes('--controles')) {
  const { spawnSync } = await import('node:child_process');
  let bad = 0;
  for (const [id, { group, what }] of Object.entries(CONTROLS)) {
    const run = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--control=${id}`, `--solo=${group}`], { encoding: 'utf8', timeout: 180_000 });
    const caught = run.status === 1 && /✗/.test(run.stdout ?? '');
    if (!caught) bad++;
    console.log(`${caught ? '  ✓' : '  ✗'} ${id}: ${what} → ${caught ? `lo detecta «${group}»` : `NO lo detecta «${group}»`}`);
    if (caught && verbose) console.log(run.stdout.split('\n').filter((line) => line.includes('✗')).map((line) => `      ${line.trim()}`).join('\n'));
  }
  console.log(`\n${bad === 0 ? 'Todos los controles detectados' : `${bad} control(es) sin detectar`}`);
  process.exit(bad === 0 ? 0 : 1);
}
const UID = '0c1d2e3f-0000-4000-8000-00000000f4a3';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

// ------------------------------------------------------------
// El relevo, empaquetado una vez
// ------------------------------------------------------------
const FAKES = new Set([
  'react',
  '@/lib/i18n',
  '@/lib/enum-labels',
  '@/lib/capped-fetch',
  '@/lib/extensions/store',
  '@/lib/google/auth',
  '@/lib/music-db',
  '@/lib/image-refs',
  '@/lib/profile-scope',
  '@/lib/lyrics',
  '@/lib/file-handles',
  '@/lib/sync-peers',
  '@/lib/sync-status',
]);
const bundle = await esbuild.build({
  entryPoints: [path.join(dir, 'dispositivo.ts')],
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  logLevel: 'error',
  plugins: [
    {
      name: 'frame-falso',
      setup(build) {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (FAKES.has(args.path)) return { path: path.join(dir, 'falsos.ts') };
          if (args.path === './platform' && /[\\/]wire$/.test(args.resolveDir)) return { path: path.join(dir, 'falsos.ts') };
          return undefined;
        });
        if (!control) return;
        // Control negativo: el archivo se empaqueta con el blindaje quitado.
        const { file, from, to } = CONTROLS[control];
        build.onLoad({ filter: new RegExp(`[\\\\/]wire[\\\\/]${file.replace('.', '\\.')}$`) }, async (args) => {
          const { readFile } = await import('node:fs/promises');
          const source = await readFile(args.path, 'utf8');
          if (source.split(from).length !== 2) throw new Error(`control «${control}»: el texto a cambiar no aparece una sola vez en ${file}`);
          return { contents: source.replace(from, () => to), loader: 'ts' };
        });
      },
    },
  ],
});
const engine = new vm.Script(bundle.outputFiles[0].text, { filename: 'relevo.js' });

// ------------------------------------------------------------
// Azar reproducible (mulberry32)
// ------------------------------------------------------------
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
let checks = 0;
const check = (ok, text) => {
  checks++;
  if (!ok) failures++;
  if (!ok || verbose) console.log(`${ok ? '  ✓' : '  ✗'} ${text}`);
  return ok;
};
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ------------------------------------------------------------
// Un Google Drive falso (por cuenta de Google)
// ------------------------------------------------------------
const FOLDER = 'application/vnd.google-apps.folder';

class FakeDrive {
  constructor(world, email) {
    this.world = world;
    this.email = email;
    this.files = new Map();
    this.seq = 0;
    this.access = new Map(); // token de acceso → hasta cuándo vale (hora del mundo)
    this.refresh = new Set(); // tokens de renovación vigentes
    this.sessions = new Map();
    this.limit = 15 * 1024 * MB;
    this.otherUsage = 0; // lo que el usuario tiene en su Drive aparte de Frame
    this.faults = [];
    this.requests = [];
    this.mutations = 0;
    this.lagMs = 0; // lo recién creado tarda esto en salir en las búsquedas
    this.pageSize = 1000;
    this.tokenFault = null;
  }

  // --- Cuenta de Google ---
  grant(dev) {
    const refreshToken = `rt-${this.email}-${++this.seq}`;
    this.refresh.add(refreshToken);
    return { email: this.email, refreshToken, ...this.issue(dev) };
  }
  issue(dev) {
    const accessToken = `at-${++this.seq}`;
    this.access.set(accessToken, this.world.t + HOUR);
    return { accessToken, expiresAt: dev.now() + HOUR };
  }
  async renew(refreshToken, dev) {
    if (!dev.online || dev.cut || this.tokenFault === 'network') throw new TypeError('Failed to fetch');
    if (!this.refresh.has(refreshToken)) throw new Error('invalid_grant: Token has been expired or revoked.');
    return this.issue(dev);
  }
  revoke() {
    this.refresh.clear();
    this.access.clear();
  }

  // --- Fallos provocados ---
  /** `match(req)` decide; `outcome`: 'network' | { status, reason? } | { truncate } | { corrupt } | { after: 'network' }. */
  fault(match, outcome, times = 1) {
    const entry = { match, outcome, left: times };
    this.faults.push(entry);
    return () => {
      this.faults = this.faults.filter((other) => other !== entry);
    };
  }
  take(req) {
    for (const entry of this.faults) {
      if (entry.left <= 0 || !entry.match(req)) continue;
      entry.left -= 1;
      return entry.outcome;
    }
    return null;
  }

  // --- Consultas para las comprobaciones ---
  get usage() {
    let total = this.otherUsage;
    for (const file of this.files.values()) total += file.content?.length ?? 0;
    return total;
  }
  live(kind) {
    return [...this.files.values()].filter((file) => !file.trashed && (!kind || file.appProperties.frameWire === kind));
  }
  roots() {
    return this.live('root');
  }

  json(file) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.mimeType === FOLDER ? {} : { size: String(file.sizeOverride ?? file.content.length), sha256Checksum: sha(file.content) }),
      appProperties: file.appProperties,
      createdTime: new Date(file.created).toISOString(),
      modifiedTime: new Date(file.modified).toISOString(),
      trashed: file.trashed,
    };
  }

  create({ name, mimeType, parents, appProperties }, content) {
    const id = `f${++this.seq}`;
    const now = this.world.t;
    const file = { id, name: name ?? '', mimeType: mimeType ?? 'application/octet-stream', parents: parents ?? ['root'], appProperties: appProperties ?? {}, content, created: now, modified: now, trashed: false };
    this.files.set(id, file);
    return file;
  }

  remove(id) {
    for (const child of [...this.files.values()]) if (child.parents.includes(id)) this.remove(child.id);
    this.files.delete(id);
  }

  async handle(dev, url, init = {}) {
    const u = new URL(url);
    const method = String(init.method ?? 'GET').toUpperCase();
    this.world.t += 20;
    const parts = u.pathname.split('/').filter(Boolean);
    let op = 'unknown';
    let id = null;
    if (u.pathname === '/drive/v3/about') op = 'about';
    else if (u.pathname === '/drive/v3/files') op = method === 'GET' ? 'list' : 'createFolder';
    else if (u.pathname.startsWith('/drive/v3/files/')) {
      id = parts[3];
      op = method === 'DELETE' ? 'delete' : method === 'PATCH' ? 'patch' : u.searchParams.get('alt') === 'media' ? 'download' : 'get';
    } else if (u.pathname === '/upload/drive/v3/files') op = u.searchParams.get('uploadType') === 'resumable' ? 'uploadStart' : 'upload';
    else if (u.pathname.startsWith('/upload/drive/v3/files/')) {
      id = parts[4];
      op = 'replace';
    } else if (u.pathname.startsWith('/upload-session/')) {
      id = parts[1];
      op = 'uploadPut';
    }
    const body = init.body == null ? null : typeof init.body === 'string' ? Buffer.from(init.body) : Buffer.from(await init.body.arrayBuffer());
    const file = id ? this.files.get(id) : null;
    const req = { who: dev.nombre, op, method, id, file, kind: file?.appProperties.frameWire ?? null, size: body?.length ?? 0, at: this.world.t };
    this.requests.push(req);

    const fault = this.take(req);
    if (fault === 'network') throw new TypeError('fetch failed');
    const fail = (status, reason, message = reason) => new Response(JSON.stringify({ error: { code: status, message, errors: [{ reason }] } }), { status, headers: { 'content-type': 'application/json' } });
    if (fault?.status) return fail(fault.status, fault.reason ?? (fault.status === 429 ? 'rateLimitExceeded' : fault.status === 401 ? 'authError' : 'backendError'), fault.message ?? 'provocado');

    const token = String(init.headers?.Authorization ?? '').replace(/^Bearer /, '');
    if (!this.access.has(token) || this.access.get(token) < this.world.t) return fail(401, 'authError', 'Invalid Credentials');

    const ok = (value) => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    const answer = async () => {
      switch (op) {
        case 'about':
          return ok({ user: { emailAddress: this.email }, storageQuota: { ...(this.limit === null ? {} : { limit: String(this.limit) }), usage: String(this.usage) } });
        case 'list': {
          const q = u.searchParams.get('q') ?? '';
          const parent = /'([^']+)' in parents/.exec(q)?.[1];
          const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
          const props = [...q.matchAll(/appProperties has \{ key='([^']+)' and value='([^']+)' \}/g)].map((m) => [m[1], m[2]]);
          const all = [...this.files.values()]
            .filter((f) => !f.trashed && this.world.t - f.created >= this.lagMs)
            .filter((f) => (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime) && props.every(([k, v]) => f.appProperties[k] === v))
            .sort((a, b) => a.created - b.created);
          const from = Number(u.searchParams.get('pageToken') ?? 0);
          const page = all.slice(from, from + this.pageSize);
          return ok({ files: page.map((f) => this.json(f)), ...(from + this.pageSize < all.length ? { nextPageToken: String(from + this.pageSize) } : {}) });
        }
        case 'get':
          return file ? ok(this.json(file)) : fail(404, 'notFound');
        case 'download': {
          if (!file) return fail(404, 'notFound');
          let bytes = file.content;
          if (fault?.truncate !== undefined) bytes = bytes.subarray(0, Math.max(0, bytes.length - fault.truncate));
          if (fault?.corrupt) {
            bytes = Buffer.from(bytes);
            bytes[bytes.length >> 1] ^= 0xff;
          }
          return new Response(bytes, { status: 200, headers: { 'content-type': file.mimeType } });
        }
        case 'createFolder': {
          const meta = JSON.parse(body.toString('utf8'));
          this.mutations++;
          return ok(this.json(this.create(meta, null)));
        }
        case 'upload': {
          const boundary = /boundary=(.+)$/.exec(init.headers['Content-Type'])[1];
          const delimiter = Buffer.from(`--${boundary}`);
          const metaStart = body.indexOf('\r\n\r\n', body.indexOf(delimiter)) + 4;
          const second = body.indexOf(delimiter, metaStart);
          const meta = JSON.parse(body.subarray(metaStart, second - 2).toString('utf8'));
          const contentStart = body.indexOf('\r\n\r\n', second) + 4;
          const content = Buffer.from(body.subarray(contentStart, body.lastIndexOf(Buffer.from(`\r\n--${boundary}--`))));
          return this.store(meta, content, fail, ok);
        }
        case 'uploadStart': {
          const sid = `s${++this.seq}`;
          this.sessions.set(sid, JSON.parse(body.toString('utf8')));
          return new Response('', { status: 200, headers: { Location: `https://www.googleapis.com/upload-session/${sid}` } });
        }
        case 'uploadPut': {
          const meta = this.sessions.get(id);
          if (!meta) return fail(404, 'notFound');
          this.sessions.delete(id);
          return this.store(meta, Buffer.from(body), fail, ok);
        }
        case 'replace': {
          if (!file) return fail(404, 'notFound');
          if (this.usage - file.content.length + body.length > (this.limit ?? Infinity)) return fail(403, 'storageQuotaExceeded', 'The user has exceeded their Drive storage quota');
          file.content = Buffer.from(body);
          file.modified = this.world.t;
          this.mutations++;
          return ok(this.json(file));
        }
        case 'patch': {
          if (!file) return fail(404, 'notFound');
          const change = JSON.parse(body.toString('utf8'));
          if (change.appProperties) file.appProperties = { ...file.appProperties, ...change.appProperties };
          if (change.trashed) file.trashed = true;
          this.mutations++;
          return ok({ id: file.id });
        }
        case 'delete': {
          if (!file) return fail(404, 'notFound');
          this.remove(id);
          this.mutations++;
          return new Response(null, { status: 204 });
        }
        default:
          return fail(400, 'badRequest', `ruta desconocida: ${method} ${u.pathname}`);
      }
    };
    const response = await answer();
    // La petición hizo efecto, pero la respuesta no llegó.
    if (fault?.after === 'network') throw new TypeError('fetch failed');
    return response;
  }

  store(meta, content, fail, ok) {
    if (meta.parents?.some((parent) => !this.files.has(parent))) return fail(404, 'notFound', 'File not found: parent');
    if (this.usage + content.length > (this.limit ?? Infinity)) return fail(403, 'storageQuotaExceeded', 'The user has exceeded their Drive storage quota');
    this.mutations++;
    return ok(this.json(this.create(meta, content)));
  }
}

// ------------------------------------------------------------
// El mundo y sus equipos
// ------------------------------------------------------------
class MemoryStorage {
  #map = new Map();
  quota = Infinity;
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
    if (this.used - before + key.length + text.length > this.quota) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.#map.set(key, text);
  }
  removeItem(key) {
    this.#map.delete(key);
  }
  entries() {
    return [...this.#map.entries()];
  }
}

class FakeFileReader {
  readAsDataURL(blob) {
    blob.arrayBuffer().then(
      (buffer) => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      },
      (error) => {
        this.error = error;
        this.onerror?.();
      }
    );
  }
}

const silent = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace'].map((name) => [name, () => undefined]));

function makeWorld(seed = 1) {
  const t0 = Date.UTC(2026, 10, 10, 17, 0, 0);
  const world = { t: t0, t0, devices: [], drives: new Map(), random: rng(seed), songSeq: 0 };
  world.advance = (ms) => {
    world.t += ms;
  };
  world.drive = (email = 'persona@gmail.com') => {
    if (!world.drives.has(email)) world.drives.set(email, new FakeDrive(world, email));
    return world.drives.get(email);
  };
  world.bytes = (size) => {
    const buffer = Buffer.alloc(size);
    for (let i = 0; i < size; i++) buffer[i] = Math.floor(world.random() * 256);
    return buffer;
  };
  world.device = (nombre, options = {}) => makeDevice(world, nombre, options);
  return world;
}

function makeDevice(world, nombre, { skew = 0, storage = null } = {}) {
  const dev = {
    nombre,
    world,
    uid: UID,
    skew,
    online: true,
    cut: false,
    drive: null,
    songs: [],
    audio: new Map(),
    audioLegible: true,
    letras: new Map(),
    adjuntos: new Map(),
    imagenes: new Map(),
    refs: [],
    llaves: new Map(),
    llaveLegible: true,
    fallaGuardar: false,
    failAddSongs: false,
    tasks: [],
    notes: [],
    timers: new Map(),
    storage: storage ?? new MemoryStorage(),
    heard: [],
    events: [],
  };
  dev.now = () => world.t + dev.skew;
  dev.google = { renovar: (token) => dev.drive.renew(token, dev) };
  dev.enviar = (message) => {
    const copy = JSON.parse(JSON.stringify(message));
    for (const other of world.devices) {
      if (other === dev || !other.online || other.closed) continue;
      other.heard.push(copy);
      other.wire.noteWirePeer(copy);
    }
  };
  dev.fetch = async (url, init) => {
    const text = String(url);
    if (text.startsWith('data:')) return fetch(text);
    if (!dev.online || dev.cut) throw new TypeError('fetch failed');
    return dev.drive.handle(dev, text, init);
  };
  class DeviceDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(dev.now());
      else super(...args);
    }
    static now() {
      return dev.now();
    }
  }
  let timerSeq = 0;
  const target = new EventTarget();
  target.addEventListener('frame:sync-recheck', () => dev.events.push('recheck'));
  const sandbox = {
    console: verbose ? console : silent,
    setTimeout: (fn, ms) => {
      const id = ++timerSeq;
      dev.timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => dev.timers.delete(id),
    queueMicrotask,
    crypto: globalThis.crypto,
    TextEncoder,
    TextDecoder,
    btoa,
    atob,
    Event,
    EventTarget,
    DOMException,
    Blob,
    File,
    FileReader: FakeFileReader,
    Headers,
    Response,
    URL,
    URLSearchParams,
    structuredClone,
    Date: DeviceDate,
    performance: { now: () => world.t - world.t0 },
    localStorage: dev.storage,
    navigator: {
      get onLine() {
        return dev.online;
      },
    },
    fetch: (url, init) => dev.fetch(url, init),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
    __equipo: dev,
  };
  vm.createContext(sandbox);
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', sandbox);
  engine.runInContext(sandbox);
  dev.wire = sandbox.wire;
  dev.status = () => dev.wire.status();

  dev.ctx = () => ({
    uid: dev.uid,
    songs: [...dev.songs],
    addSongs: async (songs) => {
      if (dev.failAddSongs) throw new Error('la biblioteca no guardó');
      dev.songs.push(...songs.map((song) => ({ ...song })));
    },
    tasks: dev.tasks,
    archivedTasks: [],
    incompleteTasks: [],
    notes: dev.notes,
    archivedNotes: [],
  });
  dev.idle = async () => {
    for (let i = 0; i < 200_000; i++) {
      await tick();
      if (dev.status().phase !== 'syncing') return;
    }
    throw new Error(`${nombre}: la vuelta no termina`);
  };
  /** Los temporizadores del relevo (vueltas encadenadas): se disparan como en la app, con la lista que el relevo recuerda. */
  dev.drain = async (max = 60) => {
    for (let i = 0; i < max && dev.timers.size > 0; i++) {
      const pending = [...dev.timers.values()];
      dev.timers.clear();
      for (const timer of pending) timer.fn();
      await dev.idle();
      // Sin esto, un relevo que duplica lo que recibe no acabaría nunca (control «lista-vieja»).
      if (dev.songs.length > 400) throw new Error(`${nombre}: la biblioteca se desbocó (${dev.songs.length} canciones)`);
    }
  };
  /** Una vuelta, como la da WireRuntime (con la biblioteca de ahora), y las que encadene. */
  dev.turn = async ({ forced = false, follow = true } = {}) => {
    if (dev.closed) return;
    await dev.wire.runWireCycle(dev.ctx(), forced);
    if (follow) await dev.drain();
    else dev.timers.clear();
  };
  dev.connect = async (drive = world.drive()) => {
    dev.drive = drive;
    await dev.wire.confirmDriveAccount(drive.grant(dev));
  };

  // --- Lo que hace el usuario ---
  dev.addSong = ({ title, artist = 'Banda', bytes, size = 2400, fileName, favorite = false, lyrics = null } = {}) => {
    const n = ++world.songSeq;
    const content = bytes ?? world.bytes(size);
    const song = {
      id: crypto.randomUUID(),
      title: title ?? `Canción ${n}`,
      artist,
      album: 'Disco',
      picture: `data:image/png;base64,${Buffer.from(`portada ${n}`).toString('base64')}`,
      fileName: fileName ?? `${String(n).padStart(3, '0')} cancion.mp3`,
      duration: 100 + n,
      ...(favorite ? { isFavorite: true } : {}),
      owner: dev.uid,
    };
    dev.songs.push(song);
    dev.audio.set(song.id, new File([content], song.fileName, { type: 'audio/mpeg' }));
    if (lyrics) dev.letras.set(song.id, lyrics);
    return song;
  };
  /** Como CourseContext al confirmar el borrado: fuera ficha y audio, y queda anotado. */
  dev.deleteSong = (id) => {
    const key = dev.wire.libraryKeys(dev.songs)[id];
    dev.songs = dev.songs.filter((song) => song.id !== id);
    dev.audio.delete(id);
    dev.letras.delete(id);
    dev.wire.noteSongRemoved(dev.uid, id, key);
  };
  dev.find = (title) => dev.songs.filter((song) => song.title === title);
  dev.library = async () => {
    const out = [];
    for (const song of dev.songs) {
      const blob = dev.audio.get(song.id);
      out.push(`${song.title}|${song.artist}|${blob ? sha(Buffer.from(await blob.arrayBuffer())) : 'SIN AUDIO'}`);
    }
    return out.sort();
  };
  world.devices.push(dev);
  return dev;
}

/**
 * Vueltas por turnos hasta que nada se mueve; entre ronda y ronda pasa el minuto y medio
 * que tarda la vuelta periódica de la app. Devuelve false si no se estabiliza.
 */
async function settle(devices, { rounds = 40, forced = false, step = 90_000 } = {}) {
  const drives = [...new Set(devices.map((dev) => dev.drive))];
  let calm = 0;
  for (let round = 0; round < rounds; round++) {
    const before = drives.reduce((sum, drive) => sum + drive.mutations, 0);
    const sizes = devices.map((dev) => dev.songs.length + dev.audio.size + dev.adjuntos.size + dev.imagenes.size).join();
    for (const dev of devices) await dev.turn({ forced });
    devices[0].world.advance(step);
    const after = drives.reduce((sum, drive) => sum + drive.mutations, 0);
    const same = sizes === devices.map((dev) => dev.songs.length + dev.audio.size + dev.adjuntos.size + dev.imagenes.size).join();
    calm = before === after && same ? calm + 1 : 0;
    if (calm >= 2) return true;
  }
  return false;
}

const sameLibraries = async (devices) => {
  const first = JSON.stringify(await devices[0].library());
  for (const dev of devices.slice(1)) if (JSON.stringify(await dev.library()) !== first) return false;
  return true;
};
const noDuplicates = (dev) => new Set(dev.songs.map((song) => `${song.title}|${song.artist}`)).size === dev.songs.length;
const errors = (dev) => dev.status().log.filter((entry) => entry.kind === 'error').map((entry) => entry.text);

// ------------------------------------------------------------
// Los grupos
// ------------------------------------------------------------
const groups = [];
const group = (id, title, run) => groups.push({ id, title, run });

group('basico', 'Dos equipos con cosas distintas acaban con lo mismo y Drive queda vacío', async () => {
  const world = makeWorld(1);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const lyrics = { synced: [{ t: 1, text: 'la' }], plain: 'la' };
  a.addSong({ title: 'Uno', lyrics });
  a.addSong({ title: 'Dos' });
  a.addSong({ title: 'Grande', size: 6 * MB }); // subida reanudable
  b.addSong({ title: 'Tres' });
  b.addSong({ title: 'Cuatro' });
  // Un adjunto, un recurso y una imagen propia: sus fichas viajan con la cuenta; los bytes están en la laptop.
  const task = { id: 't1', name: 'Tarea', attachments: [{ id: 'adj1', kind: 'file', label: 'guia.pdf' }] };
  const noteFile = { id: 'n1', kind: 'file', fileName: 'apuntes.pdf' };
  for (const dev of [a, b]) {
    dev.tasks = [task];
    dev.notes = [noteFile];
  }
  a.adjuntos.set('adj1', new File([world.bytes(900)], 'guia.pdf', { type: 'application/pdf' }));
  const noteUrl = `data:application/pdf;base64,${world.bytes(700).toString('base64')}`;
  a.imagenes.set('noteFile_n1', { dataUrl: noteUrl, at: 1 });
  const imageUrl = `data:image/png;base64,${world.bytes(500).toString('base64')}`;
  const h = sha(Buffer.from(imageUrl)).slice(0, 16);
  a.imagenes.set('courseImage_c1', { dataUrl: imageUrl, at: 5 });
  for (const dev of [a, b]) dev.refs = [{ id: 'courseImage_c1', kind: 'own', h, at: 5 }];

  await a.connect();
  await b.connect();
  check(await settle([a, b]), 'se estabiliza');
  check(a.songs.length === 5 && b.songs.length === 5, `cinco canciones en cada uno (${a.songs.length}, ${b.songs.length})`);
  check(await sameLibraries([a, b]), 'las mismas canciones, con los mismos bytes');
  const uno = b.find('Uno')[0];
  check(uno && JSON.stringify(b.letras.get(uno.id)) === JSON.stringify(lyrics), 'la letra viajó con la canción');
  check(uno?.album === 'Disco' && uno?.duration > 0 && uno?.picture.startsWith('data:image/png'), 'álbum, duración y portada llegaron');
  check(b.adjuntos.has('adj1') && Buffer.from(await b.adjuntos.get('adj1').arrayBuffer()).equals(Buffer.from(await a.adjuntos.get('adj1').arrayBuffer())), 'el adjunto llegó entero');
  check(b.imagenes.get('noteFile_n1')?.dataUrl === noteUrl, 'el archivo de recursos llegó entero');
  check(b.imagenes.get('courseImage_c1')?.dataUrl === imageUrl, 'la imagen propia llegó entera');
  check(b.events.includes('recheck'), 'el verificador de sincronización se entera de que el adjunto llegó');
  const drive = world.drive();
  check(drive.live('item').length === 0 && drive.live('meta').length === 0, `Drive queda sin objetos de paso (${drive.live('item').length}, ${drive.live('meta').length})`);
  check(drive.live('device').length === 2 && drive.roots().length === 1, 'una carpeta y una ficha por equipo');
  check(a.status().phase === 'idle' && b.status().phase === 'idle' && errors(a).length + errors(b).length === 0, 'sin avisos de error');
  check(b.status().devices.length === 2 && a.status().pendingUp === 0 && a.status().pendingDown === 0, 'la vista dice dos equipos y nada pendiente');

  const c = world.device('Celular');
  c.tasks = [task];
  c.notes = [noteFile];
  c.refs = a.refs;
  await c.connect();
  check(await settle([a, b, c]), 'con un tercer equipo nuevo se estabiliza');
  check(c.songs.length === 5 && (await sameLibraries([a, b, c])), 'el tercero recibe todo');
  check(c.adjuntos.has('adj1') && c.imagenes.has('courseImage_c1') && c.imagenes.has('noteFile_n1'), 'también adjunto, recurso e imagen');
  check(drive.live('item').length === 0 && drive.live('meta').length === 0, 'y Drive vuelve a vaciarse');
  check([a, b, c].every(noDuplicates), 'nadie tiene canciones repetidas');
});

group('cola', 'Una biblioteca grande pasa en vueltas encadenadas sin duplicar nada', async () => {
  const world = makeWorld(2);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  for (let i = 0; i < 30; i++) a.addSong();
  await a.connect();
  await b.connect();
  check(await settle([a, b]), 'se estabiliza');
  check(b.songs.length === 30, `las 30 canciones llegan (${b.songs.length})`);
  check(noDuplicates(b) && (await sameLibraries([a, b])), 'ninguna repetida (la vuelta encadenada usa la biblioteca al día)');
  check(world.drive().live('item').length === 0, 'Drive queda vacío');
});

group('corazon', 'Lo que tiene corazón o está fijado se queda en Drive; lo demás, no', async () => {
  const world = makeWorld(3);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const fav = a.addSong({ title: 'Favorita', favorite: true });
  a.addSong({ title: 'Normal' });
  await a.connect();
  await b.connect();
  check(await settle([a, b]), 'se estabiliza');
  const drive = world.drive();
  const items = drive.live('item');
  check(items.length === 1 && items[0].appProperties.permanent === '1' && drive.live('meta').length === 1, 'solo la favorita queda en Drive, marcada para siempre, con su ficha');
  a.songs.find((song) => song.id === fav.id).isFavorite = false;
  b.find('Favorita')[0].isFavorite = false;
  check(await settle([a, b]), 'sin corazón, se estabiliza');
  check(drive.live('item').length === 0 && drive.live('meta').length === 0, 'y sale de Drive');
  // Fijar a mano.
  a.addSong({ title: 'Fijada' });
  await settle([a, b]);
  check(drive.live('item').length === 0, 'la nueva pasa y sale');
  const key = (await (async () => {
    a.addSong({ title: 'Otra' });
    await a.turn();
    return a.status().items[0]?.key;
  })());
  check(!!key, 'mientras espera, se ve en la lista del relevo');
  a.wire.togglePin(key);
  check(await settle([a, b]), 'fijada, se estabiliza');
  check(drive.live('item').length === 1 && drive.live('item')[0].appProperties.permanent === '1', 'lo fijado se queda en Drive');
});

group('borrado', 'Lo que el usuario borra no vuelve; perder el almacén no es borrar', async () => {
  const world = makeWorld(4);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  for (const title of ['Uno', 'Dos', 'Tres', 'Cuatro']) a.addSong({ title });
  await a.connect();
  await b.connect();
  await settle([a, b]);
  const drive = world.drive();

  b.deleteSong(b.find('Dos')[0].id);
  check(await settle([a, b]), 'tras borrar en la tablet, se estabiliza');
  check(b.find('Dos').length === 0 && a.find('Dos').length === 1, 'lo borrado no vuelve a la tablet y sigue en la laptop');
  check(drive.live('item').length === 0, 'y no se queda esperando en Drive');
  check(b.wire.removedSongs(b.uid).length === 0, 'el borrado quedó anotado en el estado del relevo y salió de la lista');

  // La tablet pierde el audio de todo (las fichas siguen): se repara en su sitio.
  const idsBefore = b.songs.map((song) => song.id).sort().join();
  b.audio.clear();
  const heard = a.heard.length;
  await b.turn();
  check(a.heard.length > heard, 'un equipo al que le falta algo se lo dice a los demás en el acto (no esperan a su vuelta periódica)');
  const quiet = a.heard.length;
  await b.turn();
  check(a.heard.length === quiet, 'y sin cambios no vuelve a avisar');
  check(await settle([a, b]), 'tras perder el audio, se estabiliza');
  check(b.songs.map((song) => song.id).sort().join() === idsBefore, 'las mismas fichas (sin canciones nuevas ni repetidas)');
  check(b.songs.every((song) => b.audio.has(song.id)) && (await b.library()).every((line) => !line.includes('SIN AUDIO')), 'cada una recuperó su audio');
  check(b.find('Dos').length === 0, 'lo que había borrado sigue borrado');
  check(JSON.stringify((await b.library())) === JSON.stringify((await a.library()).filter((line) => !line.startsWith('Dos|'))), 'con los bytes correctos');
  check(drive.live('item').length === 0, 'Drive queda vacío');

  // La tablet pierde la biblioteca entera (fichas y audio), sin haber borrado nada.
  b.songs = [];
  b.audio.clear();
  check(await settle([a, b]), 'tras perder la biblioteca, se estabiliza');
  check(b.songs.length === 3 && noDuplicates(b), `vuelven las tres que no había borrado (${b.songs.length})`);
  check(a.songs.length === 4, 'la laptop no pierde nada');

  // No se puede leer el almacén: no se pide nada (ni la laptop sube la biblioteca).
  b.audioLegible = false;
  const uploadsBefore = drive.requests.filter((req) => req.op === 'upload' && req.who === 'Laptop').length;
  await settle([a, b]);
  b.audioLegible = true;
  check(drive.requests.filter((req) => req.op === 'upload' && req.who === 'Laptop').length === uploadsBefore, 'si el almacén no se puede leer, nadie sube nada por ello');

  // La laptop sube una canción y, antes de que nadie la baje, pierde su audio: la recupera de Drive.
  b.online = false;
  const lone = a.addSong({ title: 'Solo en Drive' });
  const loneBytes = Buffer.from(await a.audio.get(lone.id).arrayBuffer());
  await a.turn();
  check(drive.live('item').length === 1, 'la canción nueva espera en Drive');
  a.audio.delete(lone.id);
  await a.turn();
  check(a.audio.has(lone.id) && Buffer.from(await a.audio.get(lone.id).arrayBuffer()).equals(loneBytes), 'un equipo recupera de Drive lo que él mismo subió');
  b.online = true;
  check(await settle([a, b]), 'y después se estabiliza');
  check(b.find('Solo en Drive').length === 1 && drive.live('item').length === 0, 'con la canción en los dos y Drive vacío');

  // Volver a importar lo borrado lo trae de vuelta al relevo.
  const again = b.addSong({ title: 'Dos', bytes: Buffer.from(await a.audio.get(a.find('Dos')[0].id).arrayBuffer()) });
  check(await settle([a, b]), 'tras reimportar, se estabiliza');
  check(b.find('Dos').length === 1 && b.find('Dos')[0].id === again.id && a.find('Dos').length === 1, 'lo reimportado no se duplica en ningún lado');
});

group('nombres', 'Cambiar el título o tener dos con el mismo no duplica', async () => {
  const world = makeWorld(5);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  a.addSong({ title: 'Intro', fileName: '01 intro.mp3' });
  a.addSong({ title: 'Intro', fileName: '07 intro.mp3' });
  a.addSong({ title: 'Mal titulada' });
  await a.connect();
  await b.connect();
  check(await settle([a, b]), 'se estabiliza');
  check(b.find('Intro').length === 2 && new Set((await b.library()).filter((line) => line.startsWith('Intro|'))).size === 2, 'las dos «Intro» llegan, cada una con su audio');
  const drive = world.drive();
  const itemUploads = () => drive.requests.filter((req) => (req.op === 'upload' || req.op === 'uploadPut') && req.size > 2000).length;
  const before = itemUploads();
  a.find('Mal titulada')[0].title = 'Bien titulada';
  check(await settle([a, b]), 'tras cambiar un título, se estabiliza');
  check(itemUploads() === before, 'no se sube nada por el cambio de título');
  check(a.songs.length === 3 && b.songs.length === 3, 'nadie gana canciones');
  // Una tercera «Intro» que entra después: es otra canción.
  a.addSong({ title: 'Intro', fileName: '00 intro.mp3' });
  check(await settle([a, b]), 'con una tercera, se estabiliza');
  check(b.find('Intro').length === 3 && new Set((await b.library()).filter((line) => line.startsWith('Intro|'))).size === 3 && a.find('Intro').length === 3, 'llega una sola vez y no se confunde con las otras');
  // Una canción que los dos importan por separado no se duplica en ninguno.
  const same = world.bytes(3000);
  a.addSong({ title: 'Común', bytes: same });
  b.addSong({ title: 'Común', bytes: same });
  check(await settle([a, b]), 'con una canción que ambos importaron, se estabiliza');
  check(a.find('Común').length === 1 && b.find('Común').length === 1 && drive.live('item').length === 0, 'lo que ambos ya tenían no se duplica ni se queda en Drive');
  // Y si los dos ya lo dijeron en su ficha, ni siquiera viaja.
  const c = world.device('Celular');
  c.addSong({ title: 'Común', bytes: same });
  await c.connect();
  const before2 = drive.requests.filter((req) => req.op === 'download' && req.kind === 'item' && req.who === 'Celular').length;
  check(await settle([a, b, c]), 'con un tercero que ya la tenía, se estabiliza');
  check(c.find('Común').length === 1 && c.songs.length === a.songs.length, 'el tercero no la duplica y recibe lo demás');
  void before2;
});

group('integridad', 'Lo que llega mal no entra; lo que sube mal no se da por subido', async () => {
  const world = makeWorld(6);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const song = a.addSong({ title: 'Delicada' });
  const original = Buffer.from(await a.audio.get(song.id).arrayBuffer());
  await a.connect();
  await b.connect();
  const drive = world.drive();
  await a.turn();
  await b.turn();
  await a.turn(); // la laptop ve la ficha de la tablet y sube
  check(drive.live('item').length === 1, 'la canción espera en Drive');

  drive.fault((req) => req.op === 'download' && req.kind === 'item', { truncate: 100 });
  await b.turn();
  check(b.songs.length === 0 && b.audio.size === 0, 'una descarga truncada no entra en la biblioteca');
  await b.turn();
  check(b.songs.length === 1 && Buffer.from(await b.audio.get(b.songs[0].id).arrayBuffer()).equals(original), 'a la siguiente vuelta llega entera');

  // Corrupta (mismo tamaño, otra huella) tres veces: descansa; el usuario puede forzar.
  const c = world.device('Celular');
  await c.connect();
  check(drive.live('item').length === 1, 'sigue en Drive cuando llega un tercero');
  const stop = drive.fault((req) => req.op === 'download' && req.kind === 'item' && req.who === 'Celular', { corrupt: true }, 99);
  for (let i = 0; i < 5; i++) await c.turn();
  check(c.songs.length === 0, 'una descarga corrupta (huella distinta) no entra');
  const tries = drive.requests.filter((req) => req.op === 'download' && req.kind === 'item' && req.who === 'Celular').length;
  check(tries === 3, `tras tres intentos fallidos deja de insistir un rato (${tries})`);
  stop();
  await c.turn();
  check(c.songs.length === 0, 'y de verdad descansa');
  await c.turn({ forced: true });
  check(c.songs.length === 1, '«Sincronizar ahora» lo vuelve a intentar y llega');

  // Una canción en Drive que se quedó sin su ficha de datos (título, portada, letra).
  b.online = false;
  c.online = false;
  const orphan = a.addSong({ title: 'Sin ficha', lyrics: { synced: [], plain: 'letra' } });
  await a.turn();
  const lost = drive.live('meta').find((file) => file.name.includes('Sin ficha'));
  check(!!lost && drive.live('item').some((file) => file.name.includes('Sin ficha')), 'la canción y su ficha esperan en Drive');
  drive.remove(lost.id);
  b.online = true;
  await b.turn();
  check(b.find('Sin ficha').length === 0, 'sin la ficha, la canción aún no entra');
  world.advance(11 * MIN);
  await a.turn();
  check(drive.live('meta').some((file) => file.name.includes('Sin ficha')), 'quien tiene la canción repone la ficha');
  await b.turn();
  check(b.find('Sin ficha').length === 1 && b.find('Sin ficha')[0].album === 'Disco' && b.letras.get(b.find('Sin ficha')[0].id)?.plain === 'letra', 'y llega con sus datos y su letra');
  // Sin ficha y sin nadie que la tenga ya: la de Drive es la última copia; entra con el nombre del archivo.
  for (const file of drive.live('meta')) if (file.name.includes('Sin ficha')) drive.remove(file.id);
  for (const dev of [a, b]) {
    const song = dev.find('Sin ficha')[0];
    dev.songs = dev.songs.filter((other) => other.id !== song.id);
    dev.audio.delete(song.id);
  }
  check(drive.live('item').some((file) => file.name.includes('Sin ficha')), 'la última copia está en Drive, sin ficha');
  world.advance(61 * MIN);
  c.online = true;
  check(await settle([a, b, c]), 'pasada una hora, se estabiliza');
  check([a, b, c].every((dev) => dev.find('Sin ficha').length === 1 && dev.find('Sin ficha')[0].artist === 'Banda' && dev.audio.has(dev.find('Sin ficha')[0].id)), 'y la canción vuelve a todos con el título y el artista de su nombre de archivo');
  check(drive.live('item').length === 0, 'sin quedarse en Drive');
  void orphan;

  // Una respuesta que se pierde después de subir: no deja copias de más.
  a.addSong({ title: 'Eco' });
  drive.fault((req) => req.op === 'upload' && req.size > 2000 && req.who === 'Laptop', { after: 'network' });
  check(await settle([a, b, c]), 'tras una subida cuya respuesta se pierde, se estabiliza');
  check([a, b, c].every((dev) => dev.find('Eco').length === 1), 'la canción está una vez en cada equipo');
  check(drive.live('item').length === 0 && drive.live('meta').length === 0, 'Drive vacío');
});

group('cortes', 'Cortes de red a mitad de vuelta: nada se pierde ni se duplica', async () => {
  const world = makeWorld(7);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  for (let i = 0; i < 6; i++) a.addSong();
  await a.connect();
  await b.connect();
  const drive = world.drive();
  await a.turn();
  await b.turn();
  await a.turn();
  check(drive.live('item').length === 6, 'seis canciones esperan en Drive');

  // La red se cae en la tercera descarga de audio.
  let seen = 0;
  drive.fault((req) => req.op === 'download' && req.kind === 'item' && ++seen === 3, 'network');
  await b.turn();
  check(b.songs.length === 2 && b.songs.every((song) => b.audio.has(song.id)), `las dos que llegaron enteras quedan en la biblioteca (${b.songs.length})`);
  check(b.status().phase !== 'error' && errors(b).length === 0, 'un corte no se muestra como problema');
  check(await settle([a, b]), 'al volver la red, se estabiliza');
  check(b.songs.length === 6 && noDuplicates(b) && (await sameLibraries([a, b])), 'llegan las seis, sin repetir ninguna');

  // Sin conexión no se intenta nada.
  b.online = false;
  const before = drive.requests.length;
  a.addSong();
  await b.turn();
  await b.turn();
  check(drive.requests.filter((req) => req.who === 'Tablet').length === drive.requests.slice(0, before).filter((req) => req.who === 'Tablet').length, 'sin conexión no sale ninguna petición');
  check(b.status().phase !== 'error', 'ni se muestra como problema');
  b.online = true;

  // La red «está» pero no llega a Google muchas veces seguidas: entonces sí se avisa.
  b.cut = true;
  for (let i = 0; i < 6; i++) await b.turn();
  check(b.status().phase === 'error', 'si los cortes siguen, se avisa');
  b.cut = false;
  check(await settle([a, b]), 'y al volver, se estabiliza');
  check(b.status().phase === 'idle' && b.songs.length === 7, 'con todo al día');

  // Fallo al guardar el audio (sin espacio): no entra a medias ni frena lo demás.
  a.addSong({ title: 'Sin sitio' });
  b.fallaGuardar = true;
  await a.turn();
  await b.turn();
  check(b.find('Sin sitio').length === 0, 'una canción que no se pudo guardar no entra');
  b.fallaGuardar = false;
  check(await settle([a, b]), 'cuando hay sitio, se estabiliza');
  check(b.find('Sin sitio').length === 1, 'y entra');

  // La biblioteca no acepta las canciones (fallo al guardar las fichas): se reintenta sin duplicar.
  a.addSong({ title: 'Ficha rota' });
  b.failAddSongs = true;
  await a.turn();
  await b.turn();
  b.failAddSongs = false;
  check(await settle([a, b]), 'tras un fallo de la biblioteca, se estabiliza');
  check(b.find('Ficha rota').length === 1 && noDuplicates(b), 'la canción queda una vez');
});

group('google', 'Lo que Google puede contestar: 401, permiso retirado, «más despacio», caído', async () => {
  const world = makeWorld(8);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  a.addSong();
  await a.connect();
  await b.connect();
  const drive = world.drive();
  await settle([a, b]);

  // El token de acceso caduca: se pide otro sin molestar.
  world.advance(2 * HOUR);
  a.addSong();
  check(await settle([a, b]), 'tras caducar el token de acceso, se estabiliza');
  check(b.songs.length === 2 && errors(a).length + errors(b).length === 0, 'y todo sigue sin avisos');

  // Drive contesta 401 con un token que el equipo creía bueno: lo descarta y pide otro.
  drive.access.clear();
  a.addSong();
  await a.turn();
  check(a.status().phase === 'idle' && errors(a).length === 0, 'un 401 de Drive se arregla solo: se pide otro acceso y se repite la vuelta');
  check(await settle([a, b]), 'y se estabiliza');
  check(b.songs.length === 3 && a.status().phase === 'idle' && !a.status().reauth, 'sin pedir volver a conectar');
  // Si Drive sigue diciendo 401 con un acceso recién dado, entonces sí se muestra (sin bucle).
  const stop401 = drive.fault((req) => req.who === 'Laptop', { status: 401 }, 99);
  const calls = drive.requests.length;
  await a.turn();
  check(a.status().phase === 'error' && drive.requests.length - calls <= 2, 'un 401 que se repite se muestra y no entra en bucle');
  stop401();
  check(await settle([a, b]), 'y al pasar, se estabiliza');

  // Google retira el permiso (o caduca a los 7 días con la app «en prueba»).
  drive.revoke();
  a.addSong();
  await a.turn();
  check(a.status().reauth === true && a.status().phase === 'error', 'con el permiso retirado se pide volver a conectar');
  const before = drive.requests.length;
  for (let i = 0; i < 5; i++) await a.turn();
  await a.turn({ forced: true });
  check(drive.requests.length === before, 'y deja de insistir contra Google');
  await a.connect();
  check(a.status().reauth === false, 'al volver a conectar se quita el aviso');
  await b.connect();
  check(await settle([a, b]), 'y se estabiliza');
  check(b.songs.length === 4 && drive.live('device').length === 2, 'con lo pendiente entregado y sin fichas de equipo de más');

  // «Ve más despacio»: se espera cada vez más; el usuario puede forzar.
  a.addSong();
  drive.fault((req) => req.who === 'Laptop', { status: 429 }, 1);
  await a.turn();
  check(a.status().phase === 'error', 'un 429 se muestra');
  const quiet = drive.requests.length;
  await a.turn();
  world.advance(MIN);
  await a.turn();
  check(drive.requests.length === quiet, 'y durante la espera no sale ninguna petición');
  world.advance(2 * MIN);
  await a.turn();
  check(drive.requests.length > quiet && a.status().phase === 'idle', 'pasada la espera, sigue');
  drive.fault((req) => req.who === 'Laptop', { status: 503 }, 1);
  await a.turn();
  const quiet2 = drive.requests.length;
  await a.turn();
  check(drive.requests.length === quiet2, 'un 503 también hace esperar');
  await a.turn({ forced: true });
  check(drive.requests.length > quiet2, '«Sincronizar ahora» no espera');
  check(await settle([a, b], { forced: true }), 'y se estabiliza');
  check(b.songs.length === 5, 'con todo entregado');

  // Google caído al renovar el acceso: es un corte, no un permiso retirado.
  world.advance(2 * HOUR);
  drive.tokenFault = 'network';
  await a.turn();
  check(!a.status().reauth, 'un fallo de red al renovar no pide volver a conectar');
  drive.tokenFault = null;
  check(await settle([a, b]), 'y luego sigue');

  // La llave guardada no se puede abrir en este equipo.
  b.llaveLegible = false;
  world.advance(2 * HOUR);
  await b.turn();
  check(b.status().reauth === true, 'si la llave no se puede leer, se pide volver a conectar');
  b.llaveLegible = true;
});

group('lleno', 'El Drive del usuario no se llena', async () => {
  const world = makeWorld(9);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const drive = world.drive();
  await a.connect();
  await b.connect();
  await settle([a, b]);

  // Queda menos espacio libre que la reserva: no se sube, y se dice.
  drive.limit = 1024 * MB;
  drive.otherUsage = 1024 * MB - 200 * MB;
  a.addSong({ title: 'Espera' });
  b.addSong({ title: 'De la tablet' });
  await a.turn();
  check(drive.live('item').length === 0, 'con el Drive casi lleno no se sube nada');
  check(a.status().phase === 'error' && /lleno/.test(a.status().error ?? ''), 'y se avisa de que está casi lleno');
  const requestsBefore = drive.requests.filter((req) => req.who === 'Laptop').length;
  await a.turn();
  check(drive.requests.filter((req) => req.who === 'Laptop').length > requestsBefore, 'pero las vueltas siguen (bajar no ocupa)');

  // Hay sitio otra vez.
  drive.otherUsage = 0;
  check(await settle([a, b]), 'al liberar espacio, se estabiliza');
  check(a.find('De la tablet').length === 1 && b.find('Espera').length === 1 && a.status().phase === 'idle', 'y todo pasa');

  // Drive contesta «lleno» en plena subida (la cuenta la llenó otra cosa entre medias).
  a.addSong({ title: 'Tarde' });
  b.addSong({ title: 'Baja igual' });
  drive.fault((req) => req.op === 'upload' && req.who === 'Laptop' && req.size > 2000, { status: 403, reason: 'storageQuotaExceeded', message: 'The user has exceeded their Drive storage quota' }, 1);
  await b.turn(); // la tablet sube la suya
  await a.turn({ follow: false }); // la laptop baja la de la tablet y su subida choca con el lleno
  check(a.find('Baja igual').length === 1, 'con el Drive lleno, lo que hay que bajar se baja igual');
  check(a.status().phase === 'error' && /lleno/.test(a.status().error ?? ''), 'y se avisa');
  check(await settle([a, b]), 'después se estabiliza');
  check(b.find('Tarde').length === 1, 'y lo que no pudo subir, sube');

  // Lo que espera en Drive tiene tope aunque haya espacio de sobra.
  drive.limit = null;
  const c = world.device('Celular');
  await c.connect();
  await c.turn();
  c.online = false; // el celular existe pero no baja nada
  const item = drive.create({ name: 'relleno', parents: [drive.roots()[0].id], appProperties: { frameWire: 'item', kind: 'song', key: 's:relleno', from: 'otro', permanent: '0', user: drive.roots()[0].appProperties.user } }, Buffer.alloc(10));
  item.sizeOverride = 2 * 1024 * MB; // ya hay 2 GB esperando
  a.addSong({ title: 'Con tope' });
  a.addSong({ title: 'Con corazón', favorite: true });
  await a.turn();
  await b.turn();
  await a.turn();
  check(drive.live('item').filter((file) => file.name.includes('Con tope')).length === 0, 'con 2 GB esperando no se suma más a la cola');
  check(drive.live('item').filter((file) => file.name.includes('Con corazón')).length === 1, 'lo que va para siempre sí sube (no es cola)');
  drive.remove(item.id);
  c.online = true;
  check(await settle([a, b, c]), 'cuando la cola baja, se estabiliza');
  check(b.find('Con tope').length === 1 && c.find('Con tope').length === 1, 'y lo retenido pasa');
});

group('carpeta', 'La carpeta del relevo: borrada, repetida o cambiada de sitio', async () => {
  const world = makeWorld(10);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const drive = world.drive();
  a.addSong();
  await a.connect();
  await b.connect();
  await settle([a, b]);

  // El usuario borra la carpeta en su Drive.
  drive.remove(drive.roots()[0].id);
  a.addSong();
  check(await settle([a, b]), 'tras borrar la carpeta, se estabiliza');
  check(drive.roots().length === 1 && drive.live('device').length === 2, 'se creó una carpeta nueva con las dos fichas');
  check(b.songs.length === 2 && noDuplicates(b), 'y lo pendiente llegó');
  check(a.status().log.some((entry) => /se creó de nuevo/.test(entry.text)) || b.status().log.some((entry) => /se creó de nuevo/.test(entry.text)), 'queda anotado para el usuario');

  // La manda a la papelera.
  drive.roots()[0].trashed = true;
  for (const file of drive.files.values()) if (file.parents.includes([...drive.files.values()].find((f) => f.trashed)?.id)) file.trashed = true;
  b.addSong();
  check(await settle([a, b]), 'tras mandarla a la papelera, se estabiliza');
  check(drive.roots().length === 1 && a.songs.length === 3, 'otra carpeta, y sigue pasando todo');

  // Dos equipos conectan a la vez y Drive tarda en enseñar lo recién creado: cada uno crea la suya.
  const world2 = makeWorld(11);
  const x = world2.device('Laptop');
  const y = world2.device('Tablet');
  const z = world2.device('Celular');
  const drive2 = world2.drive();
  drive2.lagMs = 5000;
  x.addSong({ title: 'De la laptop' });
  y.addSong({ title: 'De la tablet' });
  await x.connect();
  await y.connect();
  await x.turn();
  await y.turn();
  check(drive2.roots().length === 2, 'se crean dos carpetas');
  world2.advance(10_000);
  check(await settle([x, y]), 'y aun así se estabiliza');
  check(drive2.roots().length === 1, `queda una sola carpeta (${drive2.roots().length})`);
  check(x.find('De la tablet').length === 1 && y.find('De la laptop').length === 1 && noDuplicates(x) && noDuplicates(y), 'y los dos equipos se pasaron lo suyo');
  check(drive2.live('device').length === 2, 'una ficha por equipo');
  // Con el retraso puesto, un equipo nuevo no crea otra carpeta por no ver la suya.
  await z.connect();
  await z.turn();
  await z.turn();
  check(drive2.roots().length === 1, 'un equipo no crea carpetas de más por el retraso de Drive al listar');
  check(await settle([x, y, z]), 'se estabiliza con el tercero');
  check(z.songs.length === 2, 'que recibe todo');

  // Una carpeta abandonada (de un equipo que no volvió) acaba borrándose.
  const stray = drive2.create({ name: 'Frame · Wire', mimeType: FOLDER, appProperties: { frameWire: 'root', user: drive2.roots()[0].appProperties.user } }, null);
  drive2.create({ name: 'Equipo · Viejo.json', mimeType: 'application/json', parents: [stray.id], appProperties: { frameWire: 'device', device: 'viejo', user: stray.appProperties.user } }, Buffer.from('{}'));
  await settle([x, y, z]);
  check(drive2.roots().length === 2, 'mientras es reciente, se respeta');
  for (let i = 0; i < 18; i++) {
    world2.advance(12 * HOUR);
    for (const dev of [x, y, z]) await dev.turn();
  }
  check(drive2.roots().length === 1 && drive2.live('device').length === 3, 'pasada una semana sin que nadie la toque, se borra');

  // Paginación: una carpeta con más archivos que una página.
  drive2.pageSize = 3;
  for (let i = 0; i < 9; i++) x.addSong();
  check(await settle([x, y, z]), 'con la lista en varias páginas, se estabiliza');
  check(y.songs.length === 11 && z.songs.length === 11 && noDuplicates(y), 'y no se pierde ni se repite nada');
});

group('reloj', 'El tiempo es el de Drive: relojes mal puestos y equipos ausentes', async () => {
  const world = makeWorld(12);
  const a = world.device('Laptop');
  const b = world.device('Tablet', { skew: 40 * DAY }); // adelantada 40 días
  const c = world.device('Celular', { skew: -40 * DAY }); // atrasado 40 días
  const drive = world.drive();
  a.addSong();
  b.addSong();
  c.addSong();
  await a.connect();
  await b.connect();
  await c.connect();
  check(await settle([a, b, c]), 'con relojes dispares, se estabiliza');
  check(a.songs.length === 3 && b.songs.length === 3 && c.songs.length === 3, 'todos reciben todo');
  check(drive.live('device').length === 3 && [a, b, c].every((dev) => dev.status().devices.every((d) => d.active)), 'nadie da por ausente a nadie');
  check(drive.requests.filter((req) => req.op === 'delete' && req.kind === 'device').length === 0, 'ni borra la ficha de otro');
  check([a, b, c].every((dev) => !dev.status().log.some((entry) => /más de una semana/.test(entry.text))), 'ni lo anota');

  // El reloj de un equipo salta a media sesión.
  a.skew = 60 * DAY;
  a.addSong();
  check(await settle([a, b, c]), 'tras un salto de reloj, se estabiliza');
  check(drive.live('device').length === 3 && drive.requests.filter((req) => req.op === 'delete' && req.kind === 'device').length === 0, 'y sigue sin dar por ausente a nadie');
  check(b.songs.length === 4 && c.songs.length === 4, 'con lo nuevo entregado');

  // Un equipo de verdad ausente más de una semana (los otros siguen dando señales).
  c.online = false;
  a.addSong({ title: 'Durante la ausencia' });
  for (let i = 0; i < 17; i++) {
    world.advance(12 * HOUR);
    await a.turn();
    await b.turn();
  }
  check(drive.live('device').length === 2, 'tras más de una semana, su ficha se quita');
  check(drive.live('item').length === 0, 'y lo que solo él esperaba sale de Drive');
  check(a.status().devices.length === 2 && a.status().log.some((entry) => /más de una semana/.test(entry.text)), 'queda anotado');
  c.online = true;
  check(await settle([a, b, c]), 'al volver, se estabiliza');
  check(c.find('Durante la ausencia').length === 1 && c.songs.length === 5 && drive.live('device').length === 3, 'recibe lo nuevo y vuelve a contar');
  check(drive.live('item').length === 0, 'y Drive queda vacío');

  // El latido: sin cambios, la ficha se reescribe cada veinte minutos y no más.
  const writes = () => drive.requests.filter((req) => req.op === 'replace' && req.who === 'Laptop').length;
  const w0 = writes();
  for (let i = 0; i < 5; i++) {
    world.advance(2 * MIN);
    await a.turn();
  }
  check(writes() === w0, 'sin cambios ni tiempo, la ficha no se reescribe');
  world.advance(21 * MIN);
  await a.turn();
  check(writes() === w0 + 1, 'pasados veinte minutos, un latido');
});

group('identidad', 'Cada aparato, su identidad: copias de seguridad, desconectar y volver', async () => {
  const world = makeWorld(13);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const drive = world.drive();
  a.addSong();
  await a.connect();
  await b.connect();
  await settle([a, b]);

  // Los datos de la tablet aparecen en un celular nuevo (copia de seguridad restaurada): trae su
  // identidad de equipo, pero no su llave.
  const copy = new MemoryStorage();
  for (const [key, value] of b.storage.entries()) copy.setItem(key, value);
  const d = world.device('Celular nuevo', { storage: copy });
  d.songs = [];
  await d.turn();
  check(d.status().reauth === true || d.status().phase === 'off' || d.status().phase === 'error', 'sin llave no hace nada hasta que se conecte');
  await d.connect();
  a.addSong({ title: 'Para todos' });
  check(await settle([a, b, d]), 'tras conectar el aparato nuevo, se estabiliza');
  check(drive.live('device').length === 3, `cada aparato tiene su propia ficha (${drive.live('device').length})`);
  check(b.find('Para todos').length === 1 && d.find('Para todos').length === 1 && d.songs.length === 2, 'y los dos reciben lo nuevo');

  // Desconectar quita la ficha; volver a conectar es empezar como equipo nuevo, sin duplicar.
  await b.wire.disconnectWire();
  check(drive.live('device').length === 2 && b.status().phase === 'off', 'al desconectar se quita su ficha');
  a.addSong({ title: 'Mientras no estaba' });
  await settle([a, d]);
  await b.connect();
  check(await settle([a, b, d]), 'al volver a conectar, se estabiliza');
  check(b.find('Mientras no estaba').length === 1 && noDuplicates(b) && b.songs.length === 3, `recibe lo que faltaba sin repetir lo que tenía (${b.songs.length})`);
  check(drive.live('device').length === 3, 'y vuelve a tener una sola ficha');

  // Lo borrado antes de conectar Wire no cuenta como rechazo: un equipo que conecta recibe todo.
  const e = world.device('Otra laptop', { skew: -3 * DAY });
  const old = e.addSong({ title: 'Para todos', bytes: Buffer.from(await a.audio.get(a.find('Para todos')[0].id).arrayBuffer()) });
  e.deleteSong(old.id);
  check(e.wire.removedSongs(e.uid).length === 0, 'sin Wire conectado, un borrado no se anota');
  await e.connect();
  check(await settle([a, b, d, e]), 'con un equipo que borró cosas antes de conectar, se estabiliza');
  check(e.find('Para todos').length === 1, 'lo borrado antes de conectar llega igual');

  // Y lo que borre ya conectado sí cuenta, aunque después le cambien la hora al equipo.
  e.deleteSong(e.find('Para todos')[0].id);
  e.skew = -30 * DAY;
  check(await settle([a, b, d, e]), 'tras borrar y cambiar la hora, se estabiliza');
  check(e.find('Para todos').length === 0, 'lo borrado con Wire conectado no vuelve, diga lo que diga el reloj');

  // Cambiar el nombre del equipo.
  a.wire.renameDevice('Laptop de casa');
  await settle([a, b, d, e]);
  check(b.status().devices.some((dev) => dev.name === 'Laptop de casa'), 'el nombre nuevo llega a los demás');

  // Dos vueltas a la vez en el mismo equipo: la segunda espera.
  a.addSong({ title: 'Doble' });
  const one = a.wire.runWireCycle(a.ctx());
  const two = a.wire.runWireCycle(a.ctx());
  await Promise.all([one, two]);
  await a.drain();
  check(await settle([a, b, d, e]), 'tras dos vueltas a la vez, se estabiliza');
  check([b, d, e].every((dev) => dev.find('Doble').length === 1), 'sin duplicar');
});

group('fichas', 'Adjuntos, recursos e imágenes: mandan sus fichas', async () => {
  const world = makeWorld(14);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const drive = world.drive();
  await a.connect();
  await b.connect();
  await settle([a, b]);

  // La ficha de la tarea aún no llegó a la tablet: no baja el adjunto a ciegas; cuando llega, sí.
  const task = { id: 't1', name: 'Tarea', attachments: [{ id: 'adj1', kind: 'file', label: 'guia.pdf' }] };
  a.tasks = [task];
  a.adjuntos.set('adj1', new File([world.bytes(900)], 'guia.pdf', { type: 'application/pdf' }));
  await a.turn();
  await b.turn();
  await a.turn();
  check(!b.adjuntos.has('adj1'), 'sin la ficha de la tarea, el adjunto no se baja');
  b.tasks = [task];
  check(await settle([a, b]), 'cuando la ficha llega, se estabiliza');
  check(b.adjuntos.has('adj1'), 'y el adjunto llega');
  check(drive.live('item').length === 0, 'Drive queda vacío');

  // La tablet pierde los bytes del adjunto (la tarea sigue): vuelve.
  b.adjuntos.delete('adj1');
  check(await settle([a, b]), 'tras perder el adjunto, se estabiliza');
  check(b.adjuntos.has('adj1'), 'el adjunto vuelve desde la laptop');

  // La tarea se borra (en todos, por la cuenta): nada queda esperando.
  const task2 = { id: 't2', name: 'Otra', attachments: [{ id: 'adj2', kind: 'file', label: 'b.pdf' }] };
  a.tasks = [task, task2];
  a.adjuntos.set('adj2', new File([world.bytes(800)], 'b.pdf', { type: 'application/pdf' }));
  await a.turn(); // sube adj2 (la tablet aún no tiene la ficha)
  a.tasks = [task];
  b.tasks = [task];
  check(await settle([a, b]), 'tras borrar la tarea, se estabiliza');
  check(drive.live('item').length === 0 && !b.adjuntos.has('adj2'), 'su adjunto sale de Drive y no llega a nadie');

  // Imagen propia que cambia mientras la vieja espera en Drive.
  const url1 = `data:image/png;base64,${world.bytes(400).toString('base64')}`;
  const url2 = `data:image/png;base64,${world.bytes(420).toString('base64')}`;
  const h1 = sha(Buffer.from(url1)).slice(0, 16);
  const h2 = sha(Buffer.from(url2)).slice(0, 16);
  a.imagenes.set('courseImage_c1', { dataUrl: url1, at: 1 });
  a.refs = [{ id: 'courseImage_c1', kind: 'own', h: h1, at: 1 }];
  b.refs = a.refs;
  b.online = false;
  await a.turn();
  check(drive.live('item').length === 1, 'la imagen espera en Drive');
  a.imagenes.set('courseImage_c1', { dataUrl: url2, at: 2 });
  a.refs = [{ id: 'courseImage_c1', kind: 'own', h: h2, at: 2 }];
  b.refs = a.refs;
  b.online = true;
  check(await settle([a, b]), 'tras cambiar la imagen, se estabiliza');
  check(b.imagenes.get('courseImage_c1')?.dataUrl === url2, 'la tablet recibe la nueva, no la vieja');
  check(drive.live('item').length === 0, 'y ninguna se queda en Drive');
});

group('versiones', 'Convive con el estado de la 1.9.5 y con un almacenamiento lleno', async () => {
  const world = makeWorld(15);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  const drive = world.drive();
  for (const title of ['Uno', 'Dos', 'Tres']) a.addSong({ title });
  await a.connect();
  await b.connect();
  await settle([a, b]);

  // El estado como lo dejaba la 1.9.5: sin `ids`, con todo lo que había en `known`.
  const stateKey = b.storage.entries().find(([key]) => key.startsWith('frameExt:frame.wire:state:'))[0];
  const state = JSON.parse(b.storage.getItem(stateKey));
  const songKeys = Object.values(state.ids);
  b.storage.setItem(stateKey, JSON.stringify({ known: [...state.known, ...songKeys], declined: [], pins: [] }));
  // Con la 1.9.5 puesta, el usuario borró «Dos» (no había lista de borrados).
  const gone = b.find('Dos')[0];
  b.songs = b.songs.filter((song) => song.id !== gone.id);
  b.audio.delete(gone.id);
  check(await settle([a, b]), 'al actualizar, se estabiliza');
  check(b.find('Dos').length === 0 && b.songs.length === 2, 'lo que se borró con la versión anterior sigue borrado');
  check(JSON.parse(b.storage.getItem(stateKey)).ids !== undefined, 'y el estado pasa al formato nuevo');
  // A partir de ahí, perder la biblioteca ya no es «borrar».
  b.songs = [];
  b.audio.clear();
  check(await settle([a, b]), 'después, tras perder la biblioteca, se estabiliza');
  check(b.songs.length === 2 && b.find('Dos').length === 0, 'vuelve todo menos lo borrado');

  // Almacenamiento lleno: el borrado no se pierde aunque el estado no se pueda guardar.
  b.deleteSong(b.find('Uno')[0].id); // la lista de borrados aún cabe
  for (let i = 0; i < 4; i++) b.addSong(); // el estado tendrá que crecer…
  b.storage.quota = b.storage.used; // …y ya no cabe nada más
  await b.turn();
  await a.turn();
  await b.turn();
  check(b.find('Uno').length === 0, 'con el almacenamiento lleno, lo borrado no vuelve');
  check(b.wire.removedSongs(b.uid).length === 1, 'y sigue en la lista de borrados (no se dio por anotado sin estarlo)');
  // Ni siquiera cabe la lista de borrados: vive en memoria mientras Frame siga abierto.
  b.deleteSong(b.find('Tres')[0].id);
  await b.turn();
  await a.turn();
  await b.turn();
  check(b.find('Tres').length === 0, 'un borrado que no cupo en el almacenamiento tampoco vuelve');
  b.storage.quota = Infinity;
  check(await settle([a, b]), 'cuando hay sitio, se estabiliza');
  check(b.find('Uno').length === 0 && b.find('Tres').length === 0 && b.wire.removedSongs(b.uid).length === 0, 'y los borrados quedan anotados donde deben');
  check(a.find('Uno').length === 1 && a.find('Tres').length === 1 && a.songs.length === 7, 'la laptop conserva lo suyo y recibe lo nuevo');
  check(drive.live('item').length === 0, 'Drive vacío');

  // Estado ilegible o con formas raras: no rompe nada.
  b.storage.setItem(stateKey, '{"known":"x","declined":[1,null,"s:abc"],"pins":{},"ids":[1,2]}');
  check(await settle([a, b]), 'con un estado dañado, se estabiliza');
  check(b.status().phase === 'idle', 'sin errores');
  // Una ficha de equipo dañada en Drive.
  drive.create({ name: 'Equipo · Roto.json', mimeType: 'application/json', parents: [drive.roots()[0].id], appProperties: { frameWire: 'device', device: 'roto', user: drive.roots()[0].appProperties.user } }, Buffer.from('{ esto no es json'));
  drive.create({ name: 'suelto.txt', mimeType: 'text/plain', parents: [drive.roots()[0].id], appProperties: {} }, Buffer.from('algo que puso el usuario'));
  a.addSong({ title: 'Con basura' });
  check(await settle([a, b]), 'con una ficha rota y un archivo ajeno en la carpeta, se estabiliza');
  check(b.find('Con basura').length === 1 && a.status().phase === 'idle', 'y lo demás sigue pasando');
  check(drive.live().some((file) => file.name === 'suelto.txt'), 'el archivo del usuario no se toca');
});

group('antiguos', 'Un equipo con una Frame anterior no recibe canciones hasta actualizarse', async () => {
  const world = makeWorld(17);
  const a = world.device('Tablet');
  const b = world.device('Celular');
  const drive = world.drive();
  a.addSong({ title: 'De la tablet' });
  a.tasks = [{ id: 't1', name: 'Tarea', attachments: [{ id: 'adj1', kind: 'file', label: 'guia.pdf' }] }];
  a.adjuntos.set('adj1', new File([world.bytes(900)], 'guia.pdf', { type: 'application/pdf' }));
  await a.connect();
  await b.connect();
  await a.turn();
  // La laptop sigue en la 1.9.5: su ficha dice versión 1 (y allí hay una canción que subió para los demás).
  const root = drive.roots()[0];
  const user = root.appProperties.user;
  const record = (version, have = []) => Buffer.from(JSON.stringify({ id: 'laptop-vieja', name: 'Laptop', lastSeen: world.t, have, declined: [], keep: [], version }));
  const laptop = drive.create({ name: 'Equipo · Laptop.json', mimeType: 'application/json', parents: [root.id], appProperties: { frameWire: 'device', device: 'laptop-vieja', user } }, record(1));
  const audio = world.bytes(2600);
  drive.create({ name: 'Banda - De la laptop.mp3.frame.json', mimeType: 'application/json', parents: [root.id], appProperties: { frameWire: 'meta', key: 's:delalaptop', user } }, Buffer.from(JSON.stringify({ format: 1, title: 'De la laptop', artist: 'Banda', album: '', picture: '', fileName: 'de la laptop.mp3' })));
  drive.create({ name: 'Banda - De la laptop.mp3', mimeType: 'audio/mpeg', parents: [root.id], appProperties: { frameWire: 'item', kind: 'song', key: 's:delalaptop', from: 'laptop-vieja', permanent: '0', user } }, audio);
  check(await settle([a, b]), 'con un equipo antiguo en el relevo, se estabiliza');
  check(a.find('De la laptop').length === 1 && b.find('De la laptop').length === 1, 'lo que el equipo antiguo subió llega a los nuevos');
  check(b.find('De la tablet').length === 0 && !drive.live('item').some((file) => file.name.includes('De la tablet')), 'pero ninguna canción se sube mientras el antiguo la bajaría (ni para los nuevos)');
  check(drive.live('item').some((file) => file.appProperties.key === 'a:adj1'), 'los adjuntos sí se le envían (eso lo recibía bien)');
  check(a.status().outdated.join() === 'Laptop' && b.status().outdated.join() === 'Laptop', 'y se dice qué equipo hay que actualizar');
  // La laptop se actualiza: su ficha pasa a la versión nueva.
  world.advance(MIN);
  laptop.content = record(2, ['s:delalaptop']);
  laptop.modified = world.t;
  await a.turn();
  check(a.status().outdated.length === 0, 'al actualizarse, el aviso se quita');
  check(drive.live('item').some((file) => file.name.includes('De la tablet')), 'y la música empieza a subir para él');
  check(JSON.parse(drive.live('device').find((file) => file.appProperties.device !== 'laptop-vieja').content.toString()).version === 2, 'los equipos nuevos se anuncian con la versión nueva');
});

group('cuentas', 'Dos equipos con Drive distinto: se avisa', async () => {
  const world = makeWorld(16);
  const a = world.device('Laptop');
  const b = world.device('Tablet');
  a.addSong();
  await a.connect(world.drive('una@gmail.com'));
  await b.connect(world.drive('otra@gmail.com'));
  await a.turn();
  await b.turn();
  await a.turn();
  check(a.status().otherDrive === true && b.status().otherDrive === true, 'los dos equipos lo saben');
  check(errors(a).some((text) => /distinta/.test(text)), 'y queda dicho');
  check(JSON.stringify(a.heard.concat(b.heard)).includes('gmail') === false, 'sin que la cuenta de Google salga del equipo');
  await b.connect(world.drive('una@gmail.com'));
  check(b.status().otherDrive === false, 'al conectar la misma, el aviso se quita aquí');
  check(await settle([a, b]), 'y se estabiliza');
  check(a.status().otherDrive === false && b.songs.length === 1, 'también en el otro, y la música pasa');
});

group('azar', 'Recorridos al azar con fallos: al final todo cuadra', async () => {
  const seeds = Number(process.env.SEMILLAS ?? 12);
  const single = Number(process.env.SEMILLA ?? 0); // SEMILLA=60: solo ese recorrido
  for (let seed = single || 1; seed <= (single || seeds); seed++) {
    const world = makeWorld(1000 + seed);
    const random = world.random;
    const pick = (list) => list[Math.floor(random() * list.length)];
    const devices = [world.device('Laptop'), world.device('Tablet', { skew: (random() - 0.5) * 20 * DAY }), world.device('Celular', { skew: (random() - 0.5) * 20 * DAY })];
    const drive = world.drive();
    drive.lagMs = random() < 0.5 ? 0 : 1500;
    drive.pageSize = random() < 0.5 ? 1000 : 5;
    const deletedOn = new Map(devices.map((dev) => [dev, new Set()]));
    const contents = new Map(); // título → sha de su audio
    let titles = 0;
    for (const dev of devices) await dev.connect();

    for (let step = 0; step < 220; step++) {
      const dev = pick(devices);
      const roll = random();
      if (roll < 0.14) {
        const title = `T${++titles}`;
        const song = dev.addSong({ title, size: 800 + Math.floor(random() * 3000), favorite: random() < 0.15 });
        contents.set(title, sha(Buffer.from(await dev.audio.get(song.id).arrayBuffer())));
      } else if (roll < 0.19 && dev.songs.length > 0) {
        const song = pick(dev.songs);
        dev.deleteSong(song.id);
        deletedOn.get(dev).add(song.title);
      } else if (roll < 0.23 && dev.songs.length > 0) {
        const song = pick(dev.songs);
        song.isFavorite = !song.isFavorite;
      } else if (roll < 0.26 && dev.songs.length > 0) {
        dev.audio.delete(pick(dev.songs).id); // pierde el audio de una
      } else if (roll < 0.275) {
        dev.songs = []; // pierde la biblioteca entera
        dev.audio.clear();
      } else if (roll < 0.33) {
        dev.online = !dev.online;
      } else if (roll < 0.43) {
        const outcome = pick(['network', 'network', { status: 429 }, { status: 500 }, { status: 401 }, { truncate: 7 }, { corrupt: true }, { after: 'network' }, { status: 403, reason: 'storageQuotaExceeded' }]);
        const skip = Math.floor(random() * 6);
        let n = 0;
        drive.fault(() => n++ >= skip, outcome, 1 + Math.floor(random() * 2));
      } else if (roll < 0.5) {
        world.advance(Math.floor(random() * 50 * MIN));
      } else if (roll < 0.52) {
        dev.skew += (random() - 0.5) * 10 * DAY; // le cambian la hora
      } else if (roll < 0.53) {
        drive.access.clear();
      } else if (roll < 0.535 && drive.roots().length > 0) {
        drive.remove(drive.roots()[0].id); // el usuario borra la carpeta
      } else if (roll < 0.55) {
        dev.fallaGuardar = !dev.fallaGuardar;
      } else {
        await dev.turn({ forced: random() < 0.2, follow: random() < 0.8 });
      }
    }

    // Se acaba el mal tiempo.
    drive.faults = [];
    for (const dev of devices) {
      dev.online = true;
      dev.cut = false;
      dev.fallaGuardar = false;
    }
    const stable = await settle(devices, { forced: true, rounds: 80 });
    world.advance(61 * MIN);
    const stable2 = await settle(devices, { forced: true, rounds: 40 });
    let ok = stable && stable2;
    const problems = [];
    if (!ok) problems.push('no se estabiliza');

    for (const dev of devices) {
      if (!noDuplicates(dev)) problems.push(`${dev.nombre}: canciones repetidas`);
      if (dev.status().phase !== 'idle') problems.push(`${dev.nombre}: termina en «${dev.status().phase}» (${dev.status().error})`);
    }
    for (const [title, hash] of contents) {
      const holders = [];
      for (const dev of devices) {
        const song = dev.find(title)[0];
        const blob = song ? dev.audio.get(song.id) : null;
        if (blob && sha(Buffer.from(await blob.arrayBuffer())) === hash) holders.push(dev);
        else if (blob) problems.push(`${dev.nombre}: «${title}» con otros bytes`);
      }
      const inDrive = drive.live('item').some((file) => sha(file.content) === hash);
      for (const dev of devices) {
        const has = holders.includes(dev);
        const deleted = deletedOn.get(dev).has(title);
        if (deleted && dev.find(title).length > 0) problems.push(`${dev.nombre}: «${title}» volvió después de borrarla`);
        if (!deleted && !has && (holders.length > 0 || inDrive)) problems.push(`${dev.nombre}: le falta «${title}» (la tienen ${holders.map((d) => d.nombre).join(', ') || 'solo Drive'})`);
      }
    }
    const favorites = new Set();
    for (const dev of devices) for (const song of dev.songs) if (song.isFavorite) favorites.add(song.title);
    for (const file of drive.live('item')) {
      if (file.appProperties.permanent !== '1') problems.push(`en Drive quedó «${file.name}» sin ser para siempre`);
    }
    const itemKeys = new Set(drive.live('item').map((file) => file.appProperties.key));
    for (const meta of drive.live('meta')) if (!itemKeys.has(meta.appProperties.key)) problems.push(`en Drive quedó la ficha suelta «${meta.name}»`);
    if (drive.roots().length !== 1) problems.push(`${drive.roots().length} carpetas`);
    if (drive.live('device').length !== 3) problems.push(`${drive.live('device').length} fichas de equipo`);
    ok = problems.length === 0;
    if (!ok && process.env.DEPURAR) {
      // Para entender un recorrido que no cuadra: qué hay en Drive y qué cree cada equipo.
      console.log('  Drive:');
      for (const file of drive.live()) console.log(`    ${file.id} ${file.appProperties.frameWire ?? '-'} «${file.name}» key=${file.appProperties.key ?? ''} from=${file.appProperties.from ?? file.appProperties.device ?? ''} perm=${file.appProperties.permanent ?? ''} en=${file.parents}`);
      for (const dev of devices) {
        const stateEntry = dev.storage.entries().find(([key]) => key.startsWith('frameExt:frame.wire:state:'));
        const state = stateEntry ? JSON.parse(stateEntry[1]) : {};
        console.log(`  ${dev.nombre} (${dev.storage.getItem('frameExt:frame.wire:device')}): fase ${dev.status().phase}, sube ${dev.status().pendingUp}, baja ${dev.status().pendingDown}`);
        console.log(`    canciones: ${dev.songs.map((song) => `${song.title}${dev.audio.has(song.id) ? '' : '(sin audio)'}=${state.ids?.[song.id] ?? '?'}`).join(' ')}`);
        console.log(`    rechazado: ${(state.declined ?? []).join(' ')}`);
        console.log(`    borró: ${[...deletedOn.get(dev)].join(' ')}`);
        for (const entry of dev.status().log.slice(0, 8)) console.log(`    · [${entry.kind}] ${entry.text}`);
      }
    }
    check(ok, `semilla ${seed}: ${titles} canciones, ${drive.requests.length} peticiones${ok ? '' : ` → ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? ` (+${problems.length - 6})` : ''}`}`);
  }
});

// ------------------------------------------------------------
const started = Date.now();
for (const { id, title, run } of groups) {
  if (only && only !== id) continue;
  const before = failures;
  console.log(`\n${title}`);
  try {
    await run();
  } catch (error) {
    failures++;
    console.log(`  ✗ se interrumpió: ${error?.stack ?? error}`);
  }
  if (failures === before && !verbose) console.log('  ✓ todo en orden');
}
console.log(`\n${failures === 0 ? 'Todo en orden' : `${failures} fallo(s)`} · ${checks} comprobaciones · ${Math.round((Date.now() - started) / 1000)} s`);
process.exit(failures === 0 ? 0 : 1);
