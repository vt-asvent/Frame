#!/usr/bin/env node
// ============================================================
// Prueba de la sincronización entre dispositivos (1.6.8, ampliada en la 1.6.9).
//
//   node scripts/probar-sincronizacion.mjs
//   SEMILLA=7 node scripts/probar-sincronizacion.mjs     (otras latencias)
//
// Cada dispositivo es un contexto aislado de Node (node:vm) que ejecuta el
// motor REAL de src/ empaquetado con esbuild: su almacenamiento, sus
// temporizadores, su canal en vivo y sus prisas. La nube es una fila como la
// de la tabla `backups` (escritura condicionada a `updated_at`, fecha en el
// formato de Postgres) y cada petición y cada mensaje tardan lo que en una
// red de verdad (10 a 50 ms, al azar pero reproducible).
//
// Otros dos tipos de dispositivo ejecutan el motor de la 1.6.8 (móvil 1.1.4)
// y el de la 1.6.7 (móvil 1.1.3), copiados de git: comprueban que las
// versiones conviven mientras cada equipo se actualiza. Y uno escribe en la
// nube una clave «del futuro» que ninguna versión desde la 1.6.9 puede perder.
//
// Desde la 1.6.9 también recorre las imágenes de la galería (con una base de
// imágenes y un lienzo simulados) y el corazón de las canciones.
//
// Desde la 1.7.3, las playlists entre tres dispositivos con música propia
// (--solo=playlists): reordenar canciones y el menú, cambios a la vez, uno sin
// conexión, uno dormido y dos copias con el mismo título y artista.
//
// Desde la 1.9.2, Ajustes → Dispositivos (--solo=dispositivos): la tabla de
// equipos y sus cuatro funciones, con las reglas de las migraciones 0018 y
// 0019; quién está vinculado, quién al día, «Corregir», cerrar sesión (y el
// latido que llega tarde), una sesión cerrada desde fuera, y cuánto late cada
// equipo con la tarjeta abierta y sin nadie mirando.
//
// No usa la red ni la nube real.
// ============================================================

import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'scripts', 'sincronizacion');
const UID = '0c1d2e3f-0000-4000-8000-00000000f4a3';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------
// Azar reproducible (mulberry32)
// ------------------------------------------------------------
let seed = Number(process.env.SEMILLA ?? 168) >>> 0;
function random() {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const latency = () => 10 + Math.floor(random() * 40);
const later = (fn) => setTimeout(fn, latency());

// ------------------------------------------------------------
// Los dos motores, empaquetados una vez
// ------------------------------------------------------------
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function aliases(map) {
  const filter = new RegExp(`^(${Object.keys(map).map(escapeRe).join('|')})$`);
  return {
    name: 'alias-prueba',
    setup(build) {
      build.onResolve({ filter }, (args) => {
        // './client' solo es el cliente de Supabase desde su carpeta (o desde la copia de la 1.6.7).
        if (args.path.startsWith('./') && !/[\\/](supabase|sincronizacion)$/.test(args.resolveDir)) return undefined;
        return { path: map[args.path] };
      });
    },
  };
}

async function compile(entry, extra = {}) {
  const fake = path.join(dir, 'cliente-falso.ts');
  const result = await esbuild.build({
    entryPoints: [path.join(dir, entry)],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
    plugins: [
      aliases({
        '@/lib/supabase/client': fake,
        './client': fake,
        '@/lib/error-report': path.join(dir, 'registro-falso.ts'),
        // El vigía de la sesión (1.9.5) trae consigo auth.ts; aquí no hay sesiones: lo prueba probar-sesion.mjs.
        '@/lib/supabase/session-guard': path.join(dir, 'vigia-falso.ts'),
        ...extra,
      }),
    ],
  });
  return new vm.Script(result.outputFiles[0].text, { filename: entry.replace(/\.ts$/, '.js') });
}

const engines = {
  actual: await compile('dispositivo.ts'),
  '1.6.8': await compile('dispositivo-1.6.8.ts', {
    '@/lib/supabase/sync': path.join(dir, 'sync-1.6.8.ts'),
    '@/lib/storage-snapshot': path.join(dir, 'storage-snapshot-1.6.8.ts'),
    '@/lib/sync-merge': path.join(dir, 'sync-merge-1.6.8.ts'),
    '@/lib/sync-check': path.join(dir, 'sync-check-1.6.8.ts'),
  }),
  '1.6.7': await compile('dispositivo-1.6.7.ts', {
    '@/lib/supabase/sync': path.join(dir, 'sync-1.6.7.ts'),
    '@/lib/storage-snapshot': path.join(dir, 'storage-snapshot-1.6.7.ts'),
    '@/lib/sync-merge': path.join(dir, 'sync-merge-1.6.7.ts'),
  }),
};

// ------------------------------------------------------------
// La nube: una fila por cuenta, como la tabla `backups`
// ------------------------------------------------------------
const cloud = {
  row: null,
  reads: 0,
  probes: 0,
  writes: 0,
  lost: 0,
  down: 0,
  up: 0,
  writers: [],
  // Dispositivos (1.9.2): la tabla `devices`, las sesiones vivas de la cuenta y
  // cada llamada a sus funciones ([equipo, función, llegó]).
  devices: new Map(),
  sessions: new Set(),
  calls: [],
  /** (equipo, función) → ms de más en el viaje de ida (para dejar una llamada «en camino»). */
  delayRpc: null,
  seq: 0,
  /** (equipo) → true: la nube le responde con un error (servicio caído). `failed`: cuántas veces. */
  failing: null,
  failed: 0,
};

/** Postgres devuelve «…+00:00» y sin ceros de más en los milisegundos. */
const pg = (iso) =>
  iso ? iso.replace(/\.(\d*?)0+Z$/, (_, digits) => (digits ? `.${digits}Z` : 'Z')).replace(/Z$/, '+00:00') : iso;
const sameInstant = (a, b) => (a === null || b === null ? a === b : Date.parse(a) === Date.parse(b));

class Query {
  constructor(dev) {
    this.dev = dev;
    this.mode = 'select';
    this.columns = '';
    this.filters = [];
    this.payload = null;
    this.returning = false;
  }
  select(columns) {
    if (this.mode === 'select') this.columns = columns;
    else this.returning = true;
    return this;
  }
  update(payload) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }
  upsert(payload) {
    this.mode = 'upsert';
    this.payload = payload;
    return this;
  }
  eq(column, value) {
    this.filters.push([column, value]);
    return this;
  }
  is(column, value) {
    this.filters.push([column, value]);
    return this;
  }
  maybeSingle() {
    return this;
  }
  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }
  async run() {
    await sleep(latency()); // la petición viaja
    const response = this.dev.offline ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : this.broken() ?? this.execute();
    await sleep(latency()); // y la respuesta vuelve
    return response;
  }
  /** El servicio está caído para este equipo: contesta con un error. */
  broken() {
    if (!cloud.failing?.(this.dev)) return null;
    cloud.failed++;
    return { data: null, error: { message: 'upstream connect error or disconnect/reset before headers (503)' } };
  }
  execute() {
    const row = cloud.row;
    if (this.mode === 'select') {
      if (this.columns === 'updated_at') {
        cloud.probes++;
        return { data: row ? { updated_at: pg(row.updated_at) } : null, error: null };
      }
      cloud.reads++;
      if (!row) return { data: null, error: null };
      const body = JSON.stringify(row.data);
      cloud.down += body.length;
      return { data: { data: JSON.parse(body), updated_at: pg(row.updated_at) }, error: null };
    }
    cloud.onWrite?.(this.dev); // para provocar un cambio justo mientras se sube otro
    const body = JSON.stringify(this.payload.data);
    cloud.up += body.length; // el cuerpo viaja aunque la condición no encaje
    if (this.mode === 'upsert') {
      cloud.writes++;
      cloud.writers.push(this.dev.name);
      cloud.row = { user_id: this.payload.user_id, data: JSON.parse(body), updated_at: this.payload.updated_at };
      return { data: null, error: null };
    }
    const matches =
      row &&
      this.filters.every(([column, value]) => (column === 'updated_at' ? sameInstant(row.updated_at, value) : row[column] === value));
    if (!matches) {
      cloud.lost++;
      return { data: [], error: null };
    }
    cloud.writes++;
    cloud.writers.push(this.dev.name);
    cloud.row = { ...row, data: JSON.parse(body), updated_at: this.payload.updated_at };
    return { data: this.returning ? [{ user_id: row.user_id }] : null, error: null };
  }
}

// ------------------------------------------------------------
// Dispositivos de la cuenta (1.9.2): las cuatro funciones de
// supabase/migrations/0018 y 0019, con sus mismas reglas (comprobadas contra
// el SQL en la base real). Las horas son las del servidor: el reloj de cada
// dispositivo no cuenta.
// ------------------------------------------------------------
const GOODBYE_MS = 120_000;
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const DEVICE_KINDS = new Set(['laptop', 'phone', 'tablet']);
const DEVICE_PLATFORMS = new Set(['windows', 'android', 'ios', 'macos', 'linux', 'web']);
const stamp = (ms) => (ms === null ? null : pg(new Date(ms).toISOString()));

/** La fila como la devuelve el latido (la sesión nunca sale de la base). */
const publicRow = (row) => ({
  device_id: row.device_id,
  kind: row.kind,
  platform: row.platform,
  app_version: row.app_version,
  linked: row.linked,
  first_seen: stamp(row.first_seen),
  last_seen: stamp(row.last_seen),
  unlinked_at: stamp(row.unlinked_at),
  sync: JSON.parse(JSON.stringify(row.sync)),
  resync_at: stamp(row.resync_at),
});

const deviceFunctions = {
  device_heartbeat(dev, args) {
    const id = args.p_device_id;
    if (typeof id !== 'string' || !DEVICE_ID.test(id)) return { data: null, error: { code: '22023', message: 'dispositivo no válido' } };
    const now = Date.now();
    const sid = dev.session ?? null;
    // ¿Sigue existiendo la sesión que late? (su llave vale un rato más que ella)
    const alive = sid === null || cloud.sessions.has(sid);
    const kind = DEVICE_KINDS.has(args.p_kind) ? args.p_kind : 'laptop';
    const platform = DEVICE_PLATFORMS.has(args.p_platform) ? args.p_platform : 'web';
    const app_version = String(args.p_app_version ?? '').slice(0, 20);
    const plain = args.p_sync !== null && typeof args.p_sync === 'object' && !Array.isArray(args.p_sync);
    const sync = plain && JSON.stringify(args.p_sync).length <= 2000 ? JSON.parse(JSON.stringify(args.p_sync)) : {};
    const old = cloud.devices.get(id);
    if (alive) {
      // La despedida manda: esta misma sesión acaba de cerrar aquí (0019).
      const goodbye = !!old && !old.linked && old.unlinked_at !== null && now - old.unlinked_at < GOODBYE_MS && old.session_id === sid;
      cloud.devices.set(id, {
        device_id: id,
        kind,
        platform,
        app_version,
        linked: !goodbye,
        first_seen: old?.first_seen ?? now,
        last_seen: now,
        unlinked_at: goodbye ? old.unlinked_at : null,
        sync,
        resync_at: old?.resync_at ?? null,
        session_id: sid,
        seq: ++cloud.seq,
      });
    } else if (old) {
      // Sesión cerrada desde fuera: se ve, pero no está vinculado. Sin fila, no se crea.
      Object.assign(old, { kind, platform, app_version, last_seen: now, sync, session_id: sid, linked: false, seq: ++cloud.seq });
    }
    // Los equipos cuya sesión ya no existe dejan de estar vinculados (sin hora de despedida).
    for (const row of cloud.devices.values()) {
      if (row.linked && row.session_id !== null && !cloud.sessions.has(row.session_id)) row.linked = false;
    }
    // Tope: 20 por cuenta, los vistos más recientemente.
    const rows = [...cloud.devices.values()].sort((a, b) => b.last_seen - a.last_seen || b.seq - a.seq);
    for (const row of rows.splice(20)) cloud.devices.delete(row.device_id);
    return { data: { cloud_at: cloud.row ? pg(cloud.row.updated_at) : null, now: stamp(now), devices: rows.map(publicRow) }, error: null };
  },
  device_unlink(dev, args) {
    const row = cloud.devices.get(args.p_device_id);
    if (row) Object.assign(row, { linked: false, unlinked_at: Date.now(), session_id: dev.session ?? row.session_id });
    return { data: null, error: null };
  },
  device_forget(_dev, args) {
    cloud.devices.delete(args.p_device_id);
    return { data: null, error: null };
  },
  device_request_resync(_dev, args) {
    for (const row of cloud.devices.values()) if (row.linked && row.device_id !== (args.p_from ?? '')) row.resync_at = Date.now();
    return { data: null, error: null };
  },
};

/** Una llamada a función (`supabase.rpc`), con su viaje de ida y vuelta y cancelable como la de verdad. */
class Rpc {
  constructor(dev, name, args) {
    this.dev = dev;
    this.name = name;
    this.args = args ?? {};
    this.signal = null;
  }
  abortSignal(signal) {
    this.signal = signal;
    return this;
  }
  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }
  async run() {
    const cancelled = () => (this.signal?.aborted ? { data: null, error: { message: 'AbortError: The operation was aborted.' } } : null);
    const entry = [this.dev.name, this.name, false];
    cloud.calls.push(entry);
    await sleep(latency() + (cloud.delayRpc?.(this.dev, this.name) ?? 0)); // la petición viaja
    if (cancelled()) return cancelled(); // cancelada antes de salir: el servidor no la ve
    let response;
    if (this.dev.offline) response = { data: null, error: { message: 'TypeError: Failed to fetch' } };
    // Sin llave válida (sesión caducada): la función ni se ejecuta.
    else if (this.dev.jwt === false) response = { data: null, error: { code: '42501', message: `permission denied for function ${this.name}` } };
    else {
      entry[2] = true;
      response = deviceFunctions[this.name]?.(this.dev, this.args) ?? { data: null, error: { code: 'PGRST202', message: `no existe la función ${this.name}` } };
    }
    await sleep(latency()); // y la respuesta vuelve
    return cancelled() ?? response;
  }
}

/** Llamadas de un equipo a una función desde `from`: las que llegaron al servidor, o todas (`tried`). */
const callsOf = (dev, name = 'device_heartbeat', from = 0, tried = false) =>
  cloud.calls.slice(from).filter(([who, what, arrived]) => who === dev.name && what === name && (tried || arrived)).length;

// ------------------------------------------------------------
// El canal en vivo de la cuenta (Realtime Broadcast, `self: false`)
// ------------------------------------------------------------
const bus = {
  channels: new Set(),
  sent: { changed: 0, delta: 0 },
  bytes: 0,
  open(dev, topic) {
    const channel = {
      dev,
      topic,
      joined: false,
      listeners: [],
      status: null,
      on(_type, filter, callback) {
        channel.listeners.push({ event: filter?.event, callback });
        return channel;
      },
      subscribe(callback) {
        channel.status = callback ?? null;
        later(() => {
          if (!bus.channels.has(channel)) return;
          if (dev.offline || dev.asleep) return channel.status?.('CHANNEL_ERROR');
          channel.joined = true;
          channel.status?.('SUBSCRIBED');
        });
        return channel;
      },
      async send(message) {
        if (dev.offline || !channel.joined) return 'error';
        return bus.spread(channel, message.event, message.payload);
      },
      // Difusión por HTTP (1.7.2): llega a los demás aunque este canal esté
      // cerrado; solo hace falta red.
      async httpSend(event, payload) {
        await sleep(latency());
        if (dev.offline) throw new Error('TypeError: Failed to fetch');
        bus.spread(channel, event, payload);
        return { success: true };
      },
    };
    bus.channels.add(channel);
    return channel;
  },
  /** Reparte un mensaje a los demás canales abiertos del mismo tema. */
  spread(channel, event, payload) {
    const text = JSON.stringify(payload ?? null);
    bus.sent[event] = (bus.sent[event] ?? 0) + 1;
    bus.bytes += text.length;
    for (const other of bus.channels) {
      if (other === channel || other.dev === channel.dev || other.topic !== channel.topic || !other.joined) continue;
      later(() => bus.deliver(other, event, JSON.parse(text)));
    }
    return 'ok';
  },
  deliver(channel, event, payload) {
    if (!bus.channels.has(channel) || !channel.joined || channel.dev.offline) return;
    for (const listener of channel.listeners) {
      if (listener.event === event) listener.callback({ type: 'broadcast', event, payload });
    }
  },
  close(channel) {
    channel.joined = false;
    bus.channels.delete(channel);
  },
  of: (dev) => [...bus.channels].filter((channel) => channel.dev === dev),
};

function supabaseFor(dev) {
  return {
    auth: {
      // `sessionDown`: la llave venció y no se pudo renovar (la red no contestó), como lo dice supabase-js.
      getSession: async () =>
        dev.sessionDown
          ? { data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } }
          : { data: { session: { user: { id: UID } } }, error: null },
      onAuthStateChange(callback) {
        dev.authListeners.add(callback);
        return { data: { subscription: { unsubscribe: () => dev.authListeners.delete(callback) } } };
      },
    },
    from: () => new Query(dev),
    rpc: (name, args) => new Rpc(dev, name, args),
    channel: (topic) => bus.open(dev, topic),
    removeChannel: async (channel) => {
      bus.close(channel);
      return 'ok';
    },
  };
}

// ------------------------------------------------------------
// Dispositivos
// ------------------------------------------------------------
const alive = new Set();

/** Un reloj adelantado o atrasado `offset` ms (como el de un equipo sin hora de red). */
function skewedDate(offset) {
  const Real = Date;
  return class SkewedDate extends Real {
    constructor(...args) {
      if (args.length === 0) super(Real.now() + offset);
      else super(...args);
    }
    static now() {
      return Real.now() + offset;
    }
  };
}

function device(name, version = 'actual', { clockOffset = 0 } = {}) {
  // Cada equipo entra con su propia sesión (Dispositivos, 1.9.2); `jwt: false`, su llave ya no vale.
  const dev = { name, version, offline: false, asleep: false, session: crypto.randomUUID(), jwt: true, sessionDown: false, authListeners: new Set() };
  /** Un aviso de supabase-js sobre la sesión (TOKEN_REFRESHED, SIGNED_IN…). */
  dev.authEvent = (event) => dev.authListeners.forEach((listener) => listener(event, null));
  cloud.sessions.add(dev.session);
  const sandbox = {
    ...(clockOffset ? { Date: skewedDate(clockOffset) } : {}),
    console,
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
    AbortController,
    AbortSignal,
    structuredClone,
    URL,
    performance,
    __uid: UID,
    __supabase: supabaseFor(dev),
  };
  vm.createContext(sandbox);
  engines[version].runInContext(sandbox);
  dev.frame = sandbox.frame;
  alive.add(dev);
  return dev;
}

function shutdown() {
  for (const dev of alive) dev.frame.stop();
  alive.clear();
  for (const channel of [...bus.channels]) bus.close(channel);
}

function resetWorld() {
  shutdown();
  Object.assign(cloud, { row: null, reads: 0, probes: 0, writes: 0, lost: 0, down: 0, up: 0, writers: [] });
  Object.assign(cloud, { devices: new Map(), sessions: new Set(), calls: [], delayRpc: null, seq: 0, failing: null, failed: 0 });
  bus.sent = { changed: 0, delta: 0 };
  bus.bytes = 0;
}

/** Sin red: ni nube ni canal (que se cae, como en un equipo de verdad). */
function setOffline(dev, offline) {
  dev.offline = offline;
  for (const channel of bus.of(dev)) {
    if (offline) {
      channel.joined = false;
      channel.status?.('CHANNEL_ERROR');
    } else {
      // Supabase vuelve a unirse solo al recuperar la red.
      later(() => {
        if (!bus.channels.has(channel) || dev.offline) return;
        channel.joined = true;
        channel.status?.('SUBSCRIBED');
      });
    }
  }
  dev.frame.setOnline(!offline);
}

/** Android duerme la app en segundo plano y su canal se cierra. */
function putToSleep(dev) {
  dev.asleep = true;
  dev.frame.setVisible(false);
  for (const channel of bus.of(dev)) {
    channel.joined = false;
    channel.status?.('CLOSED');
  }
}

function wakeUp(dev) {
  dev.asleep = false;
  dev.frame.setVisible(true);
}

// ------------------------------------------------------------
// Medir y comparar
// ------------------------------------------------------------
const RECORD_KEYS = new Set([
  'courses', 'tasks', 'notes', 'archivedTasks', 'incompleteTasks', 'archivedNotes', 'localEvents', 'dayColors', 'habits',
  'studySessions', 'dailyPerformances', 'playlists', 'spaces', 'syncedImages', 'looseNotes', 'studyVideos', 'imageRefs',
  'schedules', 'classSessions', 'songFavorites', 'timetables', 'loreFavorites', 'subjectLinks', 'loreStudy',
]);
// Igual que RETIRED_KEYS de src/lib/sync-merge.ts (competencyCourseIds, desde la 1.9.0).
const RETIRED = new Set(['classSessions', 'schedules', 'playHistory', 'headerQuote', 'school', 'competencyCourseIds']);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const idOf = (record) => String(record?.id ?? record?.month ?? '');
function normalized(data) {
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = RECORD_KEYS.has(key) && Array.isArray(value) ? [...value].sort((a, b) => idOf(a).localeCompare(idOf(b))) : value;
  }
  return out;
}

/** Claves en las que dos dispositivos no coinciden (por defecto, todas las que viajan). */
function differences(a, b, keys) {
  const da = normalized(a.frame.cloudForm());
  const db = normalized(b.frame.cloudForm());
  const all = keys ?? [...new Set([...Object.keys(da), ...Object.keys(db)])].filter((key) => !RETIRED.has(key));
  return all.filter((key) => canonical(da[key]) !== canonical(db[key]));
}

const counters = () => ({
  reads: cloud.reads,
  probes: cloud.probes,
  writes: cloud.writes,
  lost: cloud.lost,
  down: cloud.down,
  up: cloud.up,
  changed: bus.sent.changed ?? 0,
  delta: bus.sent.delta ?? 0,
  writers: cloud.writers.length,
});

function since(before) {
  const now = counters();
  const out = {};
  for (const key of Object.keys(now)) out[key] = now[key] - before[key];
  out.by = cloud.writers.slice(before.writers);
  return out;
}

const activity = () => `${cloud.reads}|${cloud.probes}|${cloud.writes}|${cloud.lost}|${bus.sent.changed}|${bus.sent.delta}`;

/** Espera a que todo quede quieto (1,5 s sin tráfico). false: no se calma (bucle). */
async function settle(limit = 30_000, quiet = 1_500) {
  const start = Date.now();
  let last = activity();
  let calm = Date.now();
  while (Date.now() - start < limit) {
    await sleep(25);
    const now = activity();
    if (now !== last) {
      last = now;
      calm = Date.now();
    } else if (Date.now() - calm >= quiet) {
      return true;
    }
  }
  return false;
}

/** Milisegundos hasta que se cumple `condition` (null si no llega). */
async function until(condition, limit = 15_000) {
  const start = performance.now();
  while (performance.now() - start < limit) {
    if (condition()) return Math.round(performance.now() - start);
    await sleep(4);
  }
  return null;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const failures = [];
const timings = [];

function check(ok, text) {
  console.log(`  ${ok ? '✓' : '✗'} ${text}`);
  if (!ok) failures.push(text);
}

function traffic(label, m) {
  const by = Object.entries(m.by.reduce((acc, name) => ({ ...acc, [name]: (acc[name] ?? 0) + 1 }), {}))
    .map(([name, count]) => `${name} ${count}`)
    .join(', ');
  console.log(
    `    ${label}: ${m.writes} escrituras${by ? ` (${by})` : ''}, ${kb(m.up)} subidos · ${m.reads} lecturas completas, ${kb(m.down)} bajados · ${m.probes} sondas · ${m.lost} rechazadas · canal: ${m.delta} cambios cifrados, ${m.changed} avisos`
  );
}

function timing(what, ms) {
  timings.push([what, ms]);
  console.log(`    ${what}: ${ms === null ? 'NO LLEGÓ' : `${ms} ms`}`);
}

const find = (dev, key, id) => (dev.frame.get(key) ?? []).find((record) => record?.id === id);

// ------------------------------------------------------------
// Datos de partida (los de una cuenta con uso)
// ------------------------------------------------------------
function fixture() {
  return {
    courses: [
      { id: 'c1', name: 'Matemática', color: '#2563eb' },
      { id: 'c2', name: 'Historia', color: '#16a34a' },
    ],
    spaces: [{ id: 'sp1', name: 'Proyectos' }],
    tasks: [
      { id: 't1', title: 'Resolver la guía 3', courseId: 'c1', dueDate: '2026-10-20' },
      { id: 't2', title: 'Leer el capítulo 4', courseId: 'c2', dueDate: '2026-10-22' },
      { id: 't3', title: 'Ensayo', courseId: 'c2' },
    ],
    habits: [
      { id: 'h1', name: 'Leer 20 minutos', log: ['2026-10-12'] },
      { id: 'h2', name: 'Tomar agua', log: [] },
    ],
    studySessions: [{ id: 's1', courseId: 'c1', start: '2026-10-12T15:00:00.000Z', minutes: 50 }],
    localEvents: [{ id: 'e1', title: 'Examen parcial', start: '2026-10-21', allDay: true }],
    dailyPerformances: [{ id: '2026-10-12', score: 4 }],
    studyVideos: [{ id: 'yt-derivadas', title: 'Derivadas en 10 minutos', courseId: 'c1' }],
    imageRefs: [{ id: 'courseImage_c1', kind: 'native', src: '/native_pictures/montana.jpg', crop: [0, 0.1, 1, 0.8], out: [800, 450], at: 1760300000000 }],
    competencyCourseIds: ['c1', 'c2'],
    streakGoal: 5,
    appSettings: { lang: 'es', cardRatio: 1.7778 },
    playlists: [],
    // Retiradas en la 1.6.8: siguen en el equipo, ya no viajan.
    classSessions: [{ id: 'cs1', courseId: 'c1', start: '2026-10-13T13:00:00.000Z' }],
    schedules: [{ month: '2026-10', days: {} }],
    playHistory: [{ songId: 'x', at: '2026-10-12T20:00:00.000Z' }],
  };
}

function load(dev, data) {
  for (const [key, value] of Object.entries(data)) dev.frame.put(key, value);
}

const edit = (dev, key, id, changes) =>
  dev.frame.put(key, (dev.frame.get(key) ?? []).map((record) => (record.id === id ? { ...record, ...changes } : record)));
const add = (dev, key, record) => dev.frame.put(key, [...(dev.frame.get(key) ?? []), record]);
const drop = (dev, key, id) => dev.frame.put(key, (dev.frame.get(key) ?? []).filter((record) => record.id !== id));

// ============================================================
// Escenarios
// ============================================================

async function twoDevices() {
  console.log('\n▶ Dos dispositivos con la 1.6.9 (laptop y tablet)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  load(laptop, fixture());

  // --- 1. Primer encuentro: la tablet entra a la cuenta sin nada ---
  console.log('\n 1. Primer encuentro');
  let before = counters();
  laptop.frame.start();
  await sleep(120);
  tablet.frame.start();
  check(await settle(), 'se calma (sin escrituras de ida y vuelta)');
  let m = since(before);
  traffic('tráfico', m);
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo ${JSON.stringify(differences(laptop, tablet))}`);
  const remote = cloud.row?.data?.data ?? {};
  check(![...RETIRED].some((key) => key in remote), 'la nube no lleva las claves retiradas (clases, horario, bitácora)');
  check(Array.isArray(laptop.frame.get('classSessions')), 'la laptop conserva su copia local de lo retirado');
  const key = laptop.frame.get('syncKey');
  check(typeof key === 'string' && key.length >= 40 && key === tablet.frame.get('syncKey'), 'los dos comparten la clave del canal cifrado');
  check(m.writes <= 4, `pocas escrituras para el primer encuentro (${m.writes})`);

  // --- 2. Un cambio, al instante ---
  console.log('\n 2. Una tarea nueva en la laptop');
  before = counters();
  add(laptop, 'tasks', { id: 't4', title: 'Practicar integrales', courseId: 'c1' });
  timing('tarea nueva → tablet', await until(() => !!find(tablet, 'tasks', 't4')));
  check(await settle(), 'se calma');
  m = since(before);
  traffic('tráfico', m);
  check(m.by.every((name) => name === 'laptop') && m.writes === 1, `una sola escritura y de quien hizo el cambio (${m.by.join(', ') || 'ninguna'})`);
  check(m.reads === 0, `la tablet no baja el respaldo: ya lo tenía todo por el canal (${m.reads} lecturas)`);
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 2b. Un cambio justo mientras se sube el anterior ---
  console.log('\n 2b. Un cambio llega justo mientras se sube el anterior');
  before = counters();
  let provoked = false;
  cloud.onWrite = (dev) => {
    if (dev !== laptop || provoked) return;
    provoked = true;
    edit(laptop, 'tasks', 't2', { title: 'Cambiado durante la subida' });
  };
  edit(laptop, 'tasks', 't3', { title: 'Ensayo (antes de la subida)' });
  check(await settle(), 'se calma');
  cloud.onWrite = null;
  const inCloud = (cloud.row?.data?.data?.tasks ?? []).find((task) => task.id === 't2')?.title;
  check(provoked && inCloud === 'Cambiado durante la subida', `la nube también recibe el segundo cambio (${inCloud})`);
  check(find(tablet, 'tasks', 't2')?.title === 'Cambiado durante la subida', 'y la tablet lo tiene');
  traffic('tráfico', since(before));

  // --- 2c. La interfaz reescribe una lista igual, en otro orden ---
  console.log('\n 2c. La interfaz reescribe las tareas en otro orden (sin cambiar ninguna)');
  before = counters();
  laptop.frame.put('tasks', [...laptop.frame.get('tasks')].reverse());
  check(await settle(), 'se calma');
  m = since(before);
  traffic('tráfico', m);
  check(m.writes === 0 && m.delta === 0, `nada que subir ni que anunciar (${m.writes} escrituras, ${m.delta} mensajes)`);

  // --- 3. Ráfaga: 25 cambios en 3 s ---
  console.log('\n 3. Ráfaga de 25 cambios en 3 segundos');
  before = counters();
  // Cada 20 ms se mira qué paso ve la tablet: el mayor retraso es lo que el
  // usuario notaría mirando las dos pantallas mientras escribe.
  const stepOf = (dev) => Number(/paso (\d+)/.exec(find(dev, 'tasks', 't1')?.title ?? '')?.[1] ?? 0);
  const editedAt = [];
  let worstLag = 0;
  const watcher = setInterval(() => {
    const seen = stepOf(tablet);
    const pending = editedAt.findIndex((at, index) => index + 1 > seen);
    if (pending >= 0) worstLag = Math.max(worstLag, Math.round(performance.now() - editedAt[pending]));
  }, 20);
  for (let i = 1; i <= 25; i++) {
    edit(laptop, 'tasks', 't1', { title: `Resolver la guía 3 (paso ${i})` });
    editedAt.push(performance.now());
    await sleep(120);
  }
  timing('último cambio de la ráfaga → tablet', await until(() => stepOf(tablet) === 25));
  clearInterval(watcher);
  timing('mayor retraso de la tablet durante la ráfaga', worstLag);
  check(await settle(), 'se calma');
  m = since(before);
  traffic('tráfico', m);
  check(m.writes <= 4, `la nube recibe pocas escrituras (${m.writes}), no una por cambio`);
  check(worstLag <= 800, `durante la ráfaga la tablet nunca va más de 0,8 s por detrás (${worstLag} ms)`);
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 4. Registros distintos a la vez ---
  console.log('\n 4. Cada uno cambia una tarea distinta, a la vez');
  before = counters();
  edit(laptop, 'tasks', 't2', { title: 'Leer el capítulo 4 y resumir' });
  edit(tablet, 'tasks', 't3', { title: 'Ensayo (borrador)' });
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(find(laptop, 'tasks', 't3')?.title === 'Ensayo (borrador)' && find(tablet, 'tasks', 't2')?.title === 'Leer el capítulo 4 y resumir', 'se conservan los dos cambios');
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 5. El mismo registro casi a la vez ---
  console.log('\n 5. Los dos cambian la MISMA tarea casi a la vez');
  before = counters();
  edit(laptop, 'tasks', 't1', { title: 'Versión de la laptop' });
  await sleep(80);
  edit(tablet, 'tasks', 't1', { title: 'Versión de la tablet' });
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  const winner = find(laptop, 'tasks', 't1')?.title;
  check(winner === find(tablet, 'tasks', 't1')?.title, `terminan iguales: «${winner}»`);
  check(winner === 'Versión de la tablet', 'gana el cambio más reciente');

  // --- 6. Borrar ---
  console.log('\n 6. La tablet borra un hábito');
  before = counters();
  drop(tablet, 'habits', 'h2');
  timing('hábito borrado → laptop', await until(() => !find(laptop, 'habits', 'h2')));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(!find(laptop, 'habits', 'h2') && !find(tablet, 'habits', 'h2'), 'desaparece en los dos');
  check(cloud.row?.data?.meta?.collections?.habits?.h2?.d !== undefined, 'la nube guarda la lápida (no resucita desde un equipo rezagado)');

  // --- 7. Sin conexión ---
  console.log('\n 7. La tablet trabaja sin conexión');
  setOffline(tablet, true);
  await sleep(200);
  before = counters();
  add(tablet, 'studySessions', { id: 's2', courseId: 'c2', start: '2026-10-13T16:00:00.000Z', minutes: 25 });
  edit(tablet, 'localEvents', 'e1', { title: 'Examen parcial (aula 204)' });
  await sleep(300);
  drop(laptop, 'tasks', 't2');
  add(laptop, 'tasks', { id: 't5', title: 'Mapa conceptual', courseId: 'c2' });
  edit(laptop, 'courses', 'c2', { name: 'Historia del Perú' });
  await settle();
  check(!find(tablet, 'tasks', 't5'), 'sin conexión, la tablet no recibe nada (y no falla)');
  setOffline(tablet, false);
  timing('reconexión → tablet al día', await until(() => !!find(tablet, 'tasks', 't5') && !!find(laptop, 'studySessions', 's2')));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(!!find(laptop, 'studySessions', 's2') && find(laptop, 'localEvents', 'e1')?.title === 'Examen parcial (aula 204)', 'lo hecho sin conexión llega a la laptop');
  check(!find(tablet, 'tasks', 't2') && find(tablet, 'courses', 'c2')?.name === 'Historia del Perú', 'lo hecho en la laptop llega a la tablet');
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo ${JSON.stringify(differences(laptop, tablet))}`);

  // --- 8. Playlists con bibliotecas distintas ---
  console.log('\n 8. Playlists: cada dispositivo con su propia música');
  laptop.frame.songs([
    { id: 'L1', title: 'Alpha', artist: 'Ana', fileName: 'alpha.mp3' },
    { id: 'L2', title: 'Beta', artist: 'Bruno', fileName: 'beta.mp3' },
    { id: 'L3', title: 'Gamma', artist: 'Gala', fileName: 'gamma.mp3' },
  ]);
  tablet.frame.songs([
    { id: 'T9', title: 'ALPHA', artist: 'ana', fileName: 'Alpha (1).mp3' },
    { id: 'T8', title: 'Beta', artist: 'Bruno', fileName: 'beta.m4a' },
    { id: 'T7', title: 'Delta', artist: 'Dora', fileName: 'delta.mp3' },
  ]);
  before = counters();
  laptop.frame.put('playlists', [
    { id: 'p1', name: 'Estudio', songIds: ['L1', 'L2', 'L3'], order: 0 },
    { id: 'p2', name: 'Gimnasio', songIds: ['L2'], order: 1 },
  ]);
  timing('playlist nueva → tablet', await until(() => !!find(tablet, 'playlists', 'p1')));
  check(await settle(), 'se calma');
  const p1 = find(tablet, 'playlists', 'p1');
  check(canonical(p1?.songIds) === canonical(['T9', 'T8', 'k:gamma\u001fgala']), `la tablet la ve con SUS canciones (${JSON.stringify(p1?.songIds)})`);
  tablet.frame.put('playlists', [
    { id: 'p1', name: 'Estudio', songIds: ['T8', 'k:gamma\u001fgala', 'T9', 'T7'], order: 1 },
    { id: 'p2', name: 'Gimnasio', songIds: ['T8'], order: 0 },
  ]);
  timing('orden nuevo → laptop', await until(() => find(laptop, 'playlists', 'p1')?.order === 1));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  const back = find(laptop, 'playlists', 'p1');
  check(canonical(back?.songIds) === canonical(['L2', 'L3', 'L1', 'k:delta\u001fdora']), `la laptop recibe el orden con las suyas (${JSON.stringify(back?.songIds)})`);
  check(find(laptop, 'playlists', 'p2')?.order === 0, 'el orden de las playlists también viaja');
  check(differences(laptop, tablet).length === 0, 'los dos tienen lo mismo (en la forma que viaja)');

  console.log('\n 8b. La tablet importa después una canción que ya estaba en la playlist');
  before = counters();
  tablet.frame.songs([
    { id: 'T9', title: 'ALPHA', artist: 'ana', fileName: 'Alpha (1).mp3' },
    { id: 'T8', title: 'Beta', artist: 'Bruno', fileName: 'beta.m4a' },
    { id: 'T7', title: 'Delta', artist: 'Dora', fileName: 'delta.mp3' },
    { id: 'T6', title: 'Gamma', artist: 'Gala', fileName: 'gamma.flac' },
  ]);
  check(tablet.frame.localize(), 'la clave pasa al id de la canción de aquí');
  check(canonical(find(tablet, 'playlists', 'p1')?.songIds) === canonical(['T8', 'T6', 'T9', 'T7']), `y aparece en su sitio (${JSON.stringify(find(tablet, 'playlists', 'p1')?.songIds)})`);
  check(await settle(), 'se calma');
  m = since(before);
  traffic('tráfico', m);
  check(m.writes === 0 && m.delta === 0, `lo que viaja no cambia: nada que subir (${m.writes} escrituras, ${m.delta} mensajes)`);

  // --- 9. Ajustes de la cuenta ---
  console.log('\n 9. Idioma y proporción de las imágenes');
  before = counters();
  tablet.frame.put('appSettings', { lang: 'en', cardRatio: 1.3333 });
  timing('ajustes → laptop', await until(() => laptop.frame.get('appSettings')?.lang === 'en'));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 9b. Favoritos de la Biblioteca (1.9.2) ---
  console.log('\n 9b. Favoritos de la Biblioteca: marcar en la laptop, quitar en la tablet');
  before = counters();
  const starred = (dev) => (dev.frame.get('loreFavorites') ?? []).map((entry) => entry.id).sort().join(',');
  laptop.frame.put('loreFavorites', [{ id: 'ib-0a1b2c3d4e5f' }, { id: 'ib-112233445566' }]);
  timing('favoritos → tablet', await until(() => starred(tablet) === 'ib-0a1b2c3d4e5f,ib-112233445566'));
  check(await settle(), 'se calma');
  tablet.frame.put('loreFavorites', [{ id: 'ib-112233445566' }]);
  timing('favorito quitado → laptop', await until(() => starred(laptop) === 'ib-112233445566'));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(starred(laptop) === 'ib-112233445566' && starred(tablet) === 'ib-112233445566', 'los dos acaban con el mismo favorito');
  check(cloud.row?.data?.meta?.collections?.loreFavorites?.['ib-0a1b2c3d4e5f']?.d !== undefined, 'y la nube guarda la lápida del que se quitó');
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 10. Mensaje ajeno en el canal ---
  console.log('\n10. Un mensaje que no es de la cuenta llega al canal');
  before = counters();
  for (const channel of bus.of(tablet)) bus.deliver(channel, 'delta', { v: 1, from: 'intruso', iv: 'AAAAAAAAAAAAAAAA', c: 'SG9sYQ==' });
  check(await settle(), 'se calma');
  check(differences(laptop, tablet).length === 0, 'se ignora: nada cambia');
  add(laptop, 'tasks', { id: 't6', title: 'Después del intruso', courseId: 'c1' });
  timing('cambio siguiente → tablet', await until(() => !!find(tablet, 'tasks', 't6')));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));

  // --- 11. Android duerme la app ---
  console.log('\n11. La tablet pasa a segundo plano (Android cierra el canal)');
  putToSleep(tablet);
  await sleep(300);
  before = counters();
  edit(laptop, 'habits', 'h1', { log: ['2026-10-12', '2026-10-13'] });
  await settle();
  check(find(tablet, 'habits', 'h1')?.log?.length === 1, 'dormida, no recibe');
  wakeUp(tablet);
  timing('al volver al frente → tablet al día', await until(() => find(tablet, 'habits', 'h1')?.log?.length === 2));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  // --- 12. Quietos: nada viaja ---
  console.log('\n12. Diez segundos sin tocar nada');
  before = counters();
  await sleep(10_000);
  m = since(before);
  traffic('tráfico', m);
  check(m.writes === 0 && m.reads === 0, 'sin cambios no se sube ni se baja nada');

  check(laptop.frame.reported().length === 0 && tablet.frame.reported().length === 0, 'ningún fallo anotado en el registro de errores');
  shutdown();
}

async function threeDevices() {
  console.log('\n▶ Tres dispositivos (laptop, tablet y celular)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  const phone = device('celular');
  load(laptop, fixture());
  laptop.frame.start();
  await sleep(100);
  tablet.frame.start();
  phone.frame.start();
  check(await settle(), 'se calma');
  check(differences(laptop, tablet).length === 0 && differences(laptop, phone).length === 0, 'los tres tienen lo mismo');

  console.log('\n 1. Un cambio llega a los otros dos');
  let before = counters();
  add(laptop, 'localEvents', { id: 'e2', title: 'Feria de ciencias', start: '2026-10-30', allDay: true });
  timing('evento nuevo → tablet', await until(() => !!find(tablet, 'localEvents', 'e2')));
  timing('evento nuevo → celular', await until(() => !!find(phone, 'localEvents', 'e2')));
  check(await settle(), 'se calma');
  const m = since(before);
  traffic('tráfico', m);
  check(m.writes === 1 && m.reads === 0, `una escritura y nadie baja el respaldo (${m.writes} escrituras, ${m.reads} lecturas)`);
  check(differences(laptop, tablet).length === 0 && differences(laptop, phone).length === 0, 'los tres tienen lo mismo');

  console.log('\n 2. El celular, sin conexión, edita una tarea que luego se borra en la laptop');
  setOffline(phone, true);
  await sleep(200);
  before = counters();
  edit(phone, 'tasks', 't3', { title: 'Ensayo (editado sin conexión)' });
  await sleep(500);
  drop(laptop, 'tasks', 't3');
  drop(tablet, 'habits', 'h1');
  await settle();
  setOffline(phone, false);
  timing('reconexión → celular al día', await until(() => !find(phone, 'habits', 'h1') && !find(phone, 'tasks', 't3')));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(
    [laptop, tablet, phone].every((dev) => !find(dev, 'tasks', 't3')),
    'gana el borrado, que fue posterior a la edición (la marca es la hora de la edición, no la de la reconexión)'
  );
  check(differences(laptop, tablet).length === 0 && differences(laptop, phone).length === 0, `los tres tienen lo mismo ${JSON.stringify(differences(laptop, phone))}`);
  shutdown();
}

async function clockSkew() {
  console.log('\n▶ Relojes distintos: la tablet va dos minutos atrasada');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet', 'actual', { clockOffset: -120_000 });
  load(laptop, fixture());
  laptop.frame.start();
  await sleep(100);
  tablet.frame.start();
  check(await settle(), 'se calma');

  console.log('\n 1. La tablet edita lo último que llegó de la laptop');
  const before = counters();
  edit(laptop, 'tasks', 't1', { title: 'Primero en la laptop' });
  await until(() => find(tablet, 'tasks', 't1')?.title === 'Primero en la laptop');
  await settle();
  edit(tablet, 'tasks', 't1', { title: 'Después en la tablet' });
  timing('edición de la tablet → laptop', await until(() => find(laptop, 'tasks', 't1')?.title === 'Después en la tablet'));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(
    [laptop, tablet].every((dev) => find(dev, 'tasks', 't1')?.title === 'Después en la tablet'),
    'gana la edición de la tablet aunque su reloj la haga «anterior» (la editó después de verla)'
  );
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);
  shutdown();
}

async function withOldVersion() {
  console.log('\n▶ Convivencia: laptop con la 1.6.9 y tablet aún con la 1.6.7 (móvil 1.1.3)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet-1.6.7', '1.6.7');
  load(laptop, fixture());
  // La tablet ya sincronizaba con la 1.6.7: tiene lo mismo (sin lo nuevo de la 1.6.8).
  const old = fixture();
  delete old.studyVideos;
  delete old.imageRefs;
  delete old.appSettings;
  load(tablet, old);
  laptop.frame.songs([{ id: 'L1', title: 'Alpha', artist: 'Ana', fileName: 'alpha.mp3' }]);
  laptop.frame.put('playlists', [{ id: 'p1', name: 'Estudio', songIds: ['L1'], order: 0 }]);

  console.log('\n 1. Arrancan los dos');
  let before = counters();
  tablet.frame.start();
  await sleep(300);
  laptop.frame.start();
  const calm = await settle(20_000);
  check(calm, 'se calma (sin escrituras de ida y vuelta entre versiones)');
  let m = since(before);
  traffic('tráfico', m);
  const shared = Object.keys(tablet.frame.cloudForm()).filter((key) => !RETIRED.has(key));
  check(differences(laptop, tablet, shared).length === 0, `los dos tienen lo mismo ${JSON.stringify(differences(laptop, tablet, shared))}`);

  console.log('\n 2. Cambios en cada uno');
  before = counters();
  add(laptop, 'tasks', { id: 't9', title: 'Desde la 1.6.9', courseId: 'c1' });
  timing('1.6.9 → 1.6.7', await until(() => !!find(tablet, 'tasks', 't9')));
  await settle(20_000);
  edit(tablet, 'tasks', 't1', { title: 'Desde la 1.6.7' });
  timing('1.6.7 → 1.6.9', await until(() => find(laptop, 'tasks', 't1')?.title === 'Desde la 1.6.7'));
  check(await settle(20_000), 'se calma');
  m = since(before);
  traffic('tráfico', m);
  check(differences(laptop, tablet, shared).length === 0, 'los dos tienen lo mismo');
  const data = cloud.row?.data?.data ?? {};
  check(Array.isArray(data.studyVideos) && Array.isArray(data.imageRefs) && !!data.appSettings && !!data.syncKey, 'lo nuevo de la 1.6.8 sobrevive a las escrituras de la 1.6.7');
  check(canonical(find(tablet, 'playlists', 'p1')?.songIds) === canonical(['k:alpha\u001fana']), 'la playlist llega a la 1.6.7 con la clave de la canción, intacta');
  check(Array.isArray(tablet.frame.get('classSessions')), 'la 1.6.7 conserva lo suyo retirado');

  console.log('\n 3. Diez segundos sin tocar nada');
  before = counters();
  await sleep(10_000);
  m = since(before);
  traffic('tráfico', m);
  check(m.writes === 0, 'nadie escribe sin cambios');
  shutdown();
}

async function oldPair() {
  console.log('\n▶ Referencia: dos dispositivos con la 1.6.7 (lo que Diego vio)');
  resetWorld();
  const laptop = device('laptop-1.6.7', '1.6.7');
  const tablet = device('tablet-1.6.7', '1.6.7');
  const data = fixture();
  delete data.studyVideos;
  delete data.imageRefs;
  delete data.appSettings;
  load(laptop, data);
  laptop.frame.start();
  tablet.frame.start();
  await settle(8_000);
  const before = counters();
  add(laptop, 'tasks', { id: 't4', title: 'Practicar integrales', courseId: 'c1' });
  timing('1.6.7: tarea nueva → tablet', await until(() => !!find(tablet, 'tasks', 't4')));
  await sleep(8_000);
  const m = since(before);
  traffic('tráfico en 8 s tras UN cambio', m);
  console.log(`    (${m.writes > 4 ? 'se reenvían el respaldo sin parar' : 'se calma'})`);
  shutdown();
}

async function favorites() {
  console.log('\n▶ El corazón de las canciones (1.6.9)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  load(laptop, fixture());
  laptop.frame.start();
  await sleep(120);
  tablet.frame.start();
  check(await settle(), 'primer encuentro: se calma');

  const alpha = 'k:alpha\u001fana';
  const beta = 'k:beta\u001fbruno';
  const has = (dev, key) => (dev.frame.get('songFavorites') ?? []).some((entry) => entry.id === key);

  console.log('\n 1. Corazón en la laptop');
  let before = counters();
  laptop.frame.put('songFavorites', [{ id: alpha }]);
  timing('corazón → tablet', await until(() => has(tablet, alpha)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));

  console.log('\n 2. Otro en la tablet y quitar el primero en la laptop');
  before = counters();
  tablet.frame.put('songFavorites', [...(tablet.frame.get('songFavorites') ?? []), { id: beta }]);
  timing('corazón de la tablet → laptop', await until(() => has(laptop, beta)));
  laptop.frame.put('songFavorites', (laptop.frame.get('songFavorites') ?? []).filter((entry) => entry.id !== alpha));
  timing('corazón quitado → tablet', await until(() => !has(tablet, alpha)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);
  if (differences(laptop, tablet).length > 0) {
    const show = (dev) => `${dev.name}: ${JSON.stringify(dev.frame.get('songFavorites'))} marcas ${JSON.stringify(dev.frame.get('syncMeta')?.collections?.songFavorites ?? null)} base ${JSON.stringify(dev.frame.get('lastSyncedSnapshot')?.collections?.songFavorites ?? null)}`;
    console.log(`    ${show(laptop)}\n    ${show(tablet)}\n    nube: ${JSON.stringify(cloud.row?.data?.data?.songFavorites)} marcas ${JSON.stringify(cloud.row?.data?.meta?.collections?.songFavorites)}`);
  }
  check(has(tablet, beta) && !has(tablet, alpha), 'la tablet tiene el corazón nuevo y no el quitado');

  // Lo que Diego vio el 13-oct (1.7.1): a veces el corazón puesto en la
  // laptop no llegaba al celular, o al revés. Toques seguidos, relojes
  // distintos, los dos a la vez y el celular dormido.
  const toggle = (dev, key, on) =>
    dev.frame.put(
      'songFavorites',
      on
        ? [...(dev.frame.get('songFavorites') ?? []).filter((entry) => entry.id !== key), { id: key }]
        : (dev.frame.get('songFavorites') ?? []).filter((entry) => entry.id !== key)
    );
  const same = (key, on) => [laptop, tablet].every((dev) => has(dev, key) === on);

  console.log('\n 3. Tres toques seguidos en la laptop (poner, quitar, poner) en medio segundo');
  const gamma = 'k:gamma\u001fgaby';
  before = counters();
  toggle(laptop, gamma, true);
  await sleep(150);
  toggle(laptop, gamma, false);
  await sleep(150);
  toggle(laptop, gamma, true);
  timing('corazón → tablet', await until(() => has(tablet, gamma)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(same(gamma, true), 'los dos acaban con el corazón puesto');
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  console.log('\n 4. Poner, quitar y poner en la laptop, esperando a que cada toque llegue');
  before = counters();
  toggle(laptop, gamma, false);
  timing('quitado → tablet', await until(() => !has(tablet, gamma)));
  toggle(laptop, gamma, true);
  timing('puesto otra vez → tablet', await until(() => has(tablet, gamma)));
  toggle(laptop, gamma, false);
  timing('quitado otra vez → tablet', await until(() => !has(tablet, gamma)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(same(gamma, false), `los dos acaban sin el corazón (laptop ${has(laptop, gamma)}, tablet ${has(tablet, gamma)})`);

  console.log('\n 5. La tablet lo quita y la laptop lo vuelve a poner en el acto');
  const delta = 'k:delta\u001fdiego';
  toggle(laptop, delta, true);
  await until(() => has(tablet, delta));
  check(await settle(), 'se calma');
  before = counters();
  toggle(tablet, delta, false);
  await until(() => !has(laptop, delta));
  toggle(laptop, delta, true);
  timing('puesto de nuevo → tablet', await until(() => has(tablet, delta)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(same(delta, true), 'manda el último toque: los dos con el corazón');

  console.log('\n 6. Los dos tocan el mismo corazón a la vez');
  const epsilon = 'k:epsilon\u001felena';
  toggle(laptop, epsilon, true);
  await until(() => has(tablet, epsilon));
  check(await settle(), 'se calma');
  before = counters();
  toggle(tablet, epsilon, false);
  toggle(laptop, epsilon, false);
  toggle(laptop, epsilon, true);
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(has(laptop, epsilon) === has(tablet, epsilon), `los dos acaban igual (${has(laptop, epsilon) ? 'con' : 'sin'} corazón)`);
  check(differences(laptop, tablet).length === 0, `los dos tienen lo mismo${differences(laptop, tablet).length ? ` (difieren: ${differences(laptop, tablet).join(', ')})` : ''}`);

  console.log('\n 7. Un celular con el reloj dos minutos atrasado quita lo que la laptop acaba de poner');
  const phone = device('celular', 'actual', { clockOffset: -120_000 });
  phone.frame.start();
  check(await settle(), 'el celular entra y se calma');
  const zeta = 'k:zeta\u001fzoe';
  before = counters();
  toggle(laptop, zeta, true);
  await until(() => has(phone, zeta));
  toggle(phone, zeta, false);
  timing('quitado desde el celular → laptop', await until(() => !has(laptop, zeta)));
  timing('… y → tablet', await until(() => !has(tablet, zeta)));
  toggle(laptop, zeta, true);
  timing('puesto de nuevo en la laptop → celular', await until(() => has(phone, zeta)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check([laptop, tablet, phone].every((dev) => has(dev, zeta)), 'los tres acaban con el corazón');
  check(differences(laptop, phone).length === 0 && differences(laptop, tablet).length === 0, 'los tres tienen lo mismo');

  console.log('\n 8. El celular dormido mientras la laptop pone y quita');
  const eta = 'k:eta\u001feva';
  before = counters();
  putToSleep(phone);
  toggle(laptop, eta, true);
  await until(() => has(tablet, eta));
  toggle(laptop, zeta, false);
  await until(() => !has(tablet, zeta));
  check(await settle(), 'se calma sin el celular');
  wakeUp(phone);
  timing('al despertar, el corazón nuevo llega', await until(() => has(phone, eta)));
  timing('… y el quitado se quita', await until(() => !has(phone, zeta)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(differences(laptop, phone).length === 0, 'laptop y celular tienen lo mismo');

  console.log('\n 9. El celular toca y se duerme en el acto');
  const theta = 'k:theta\u001ftomas';
  before = counters();
  toggle(phone, theta, true);
  putToSleep(phone);
  timing('el corazón del celular llega a la laptop', await until(() => has(laptop, theta), 20_000));
  wakeUp(phone);
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check([laptop, tablet, phone].every((dev) => has(dev, theta)), 'los tres acaban con el corazón');
  shutdown();
}

async function withPrevious() {
  console.log('\n▶ Convivencia: laptop con la 1.6.9 y tablet aún con la 1.6.8 (móvil 1.1.4)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet-1.6.8', '1.6.8');
  load(laptop, fixture());
  load(tablet, fixture());
  const alpha = 'k:alpha\u001fana';

  console.log('\n 1. Arrancan los dos');
  let before = counters();
  tablet.frame.start();
  await sleep(300);
  laptop.frame.start();
  check(await settle(20_000), 'se calma (sin escrituras de ida y vuelta entre versiones)');
  traffic('tráfico', since(before));

  console.log('\n 2. Corazón en la 1.6.9; la 1.6.8 sigue editando');
  before = counters();
  laptop.frame.put('songFavorites', [{ id: alpha }]);
  check(await settle(20_000), 'se calma');
  for (let i = 1; i <= 3; i++) {
    edit(tablet, 'tasks', 't1', { title: `Desde la 1.6.8 (${i})` });
    timing(`edición ${i} de la 1.6.8 → 1.6.9`, await until(() => find(laptop, 'tasks', 't1')?.title === `Desde la 1.6.8 (${i})`));
    check(await settle(20_000), 'se calma');
  }
  const m = since(before);
  traffic('tráfico', m);
  const cloudFavorites = cloud.row?.data?.data?.songFavorites ?? [];
  check(cloudFavorites.some((entry) => entry.id === alpha), 'el corazón sigue en la nube aunque la 1.6.8 suba sin conocerlo');
  check((laptop.frame.get('songFavorites') ?? []).some((entry) => entry.id === alpha), 'y en la laptop');
  // Por cada edición de la 1.6.8: ella sube sin el corazón, la 1.6.9 lo repone
  // y la 1.6.8 vuelve a escribir para aplanar sus marcas (3 en vez de 1). El
  // corazón nuevo: 2. Acotado, y se acaba en cuanto la tablet se actualiza.
  check(m.writes <= 2 + 3 * 3, `escrituras acotadas (${m.writes} de 11 como mucho)`);

  console.log('\n 3. Diez segundos sin tocar nada');
  before = counters();
  await sleep(10_000);
  const quiet = since(before);
  traffic('tráfico', quiet);
  check(quiet.writes === 0, 'nadie escribe sin cambios');
  shutdown();
}

async function futureKeys() {
  console.log('\n▶ Una clave de una versión más nueva (desde la 1.6.9 nadie la pierde)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  load(laptop, fixture());
  laptop.frame.start();
  await sleep(120);
  tablet.frame.start();
  check(await settle(), 'primer encuentro: se calma');

  // Otro dispositivo, con una versión futura, escribió una colección nueva.
  const row = cloud.row;
  const at = new Date().toISOString();
  row.data.data.futureThing = [{ id: 'f1', v: 1 }];
  row.data.meta.collections.futureThing = { f1: { u: at }, f0: { d: at } };
  row.updated_at = at;
  laptop.frame.setVisible(false);
  laptop.frame.setVisible(true); // al volver al frente, sonda: la nube cambió
  check(await settle(), 'se calma');

  const before = counters();
  edit(laptop, 'tasks', 't1', { title: 'Subida sin bajar' });
  check(await settle(), 'se calma');
  edit(tablet, 'tasks', 't2', { title: 'Y otra desde la tablet' });
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  const after = cloud.row?.data;
  check(canonical(after?.data?.futureThing) === canonical([{ id: 'f1', v: 1 }]), 'sus datos siguen en la nube');
  check(canonical(after?.meta?.collections?.futureThing) === canonical({ f1: { u: at }, f0: { d: at } }), 'con sus marcas y su lápida intactas');
  shutdown();
}

async function images() {
  console.log('\n▶ Imágenes de la galería entre dos dispositivos (asignaturas, colecciones y playlists)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  const data = fixture();
  delete data.imageRefs;
  load(laptop, data);
  laptop.frame.start();
  await sleep(120);
  tablet.frame.start();
  check(await settle(), 'primer encuentro: se calma');

  const picture = '/native_pictures/ciudades/central-park.webp';
  const crop = [0, 0.126, 1, 0.748];
  const out = [1280, 494];
  const sides = [
    [laptop, tablet, 'courseImage_c1', 'asignatura'],
    [tablet, laptop, 'spaceImage_sp1', 'colección'],
    [laptop, tablet, 'playlistImage_p1', 'playlist'],
  ];
  for (const [from, to, key, what] of sides) {
    console.log(`\n Imagen de ${what}: ${from.name} → ${to.name}`);
    const before = counters();
    await from.frame.setImage(key, 'data:image/jpeg;base64,ZWxlZ2lkYQ==', { native: picture, crop, out });
    const ms = await until(() => to.frame.imageEvents().includes(key));
    timing(`imagen de ${what} → ${to.name}`, ms);
    const record = await to.frame.image(key);
    const drawn = record ? JSON.parse(atob(record.dataUrl.split(',')[1])) : null;
    check(!!record && JSON.stringify(drawn?.box) === JSON.stringify([0, 83, 1280, 494, 0, 0, 1280, 494]), `${to.name} rehace el mismo encuadre (${JSON.stringify(drawn)})`);
    check(await settle(), 'se calma');
    traffic('tráfico', since(before));
  }

  console.log('\n Quitar la imagen de la asignatura en la tablet');
  await tablet.frame.setImage('courseImage_c1', null);
  const gone = await until(() => laptop.frame.imageEvents().filter((key) => key === 'courseImage_c1').length >= 2);
  timing('quitar imagen → laptop', gone);
  check((await laptop.frame.image('courseImage_c1')) === null, 'la laptop también la quita');
  check(await settle(), 'se calma');
  shutdown();
}

// ------------------------------------------------------------
// Playlists entre tres dispositivos (1.7.3): lo que hace la interfaz
// ------------------------------------------------------------
// Cada dispositivo tiene SU música (ids distintos; en la laptop y el celular,
// dos copias de «Intro» de la misma banda, como un disco doble). Los mandos de
// abajo hacen lo mismo que la interfaz: `persistOrder` de
// PlaylistDetailsClient y `reorderPlaylists` de CourseContext.

function setLibrary(dev, list) {
  dev.library = Object.fromEntries(list.map((song) => [song.id, song]));
  dev.frame.songs(list);
  dev.frame.localize();
}

/** Como `byOrder` de CourseContext: por `order` y, a igualdad, como vienen. */
const byOrder = (list) =>
  list
    .map((playlist, index) => ({ playlist, index }))
    .sort((a, b) => (a.playlist.order ?? Infinity) - (b.playlist.order ?? Infinity) || a.index - b.index)
    .map(({ playlist }) => playlist);

/** Arrastrar canciones en una playlist: se reordenan los huecos de las que se ven. */
function reorderSongs(dev, playlistId, visibleOrder) {
  const lists = dev.frame.get('playlists') ?? [];
  const playlist = lists.find((p) => p.id === playlistId);
  let next = 0;
  const songIds = playlist.songIds.map((id) => (dev.library?.[id] ? visibleOrder[next++] ?? id : id));
  dev.frame.put('playlists', lists.map((p) => (p.id === playlistId ? { ...p, songIds } : p)));
}

/** Arrastrar playlists en el menú: lo de la interfaz (solo cambian las que se mueven). */
function reorderPlaylistsAs(dev, orderedIds) {
  const lists = byOrder(dev.frame.get('playlists') ?? []);
  const minimal = dev.frame.reorderPlaylists(lists, orderedIds);
  if (minimal) return dev.frame.put('playlists', minimal);
  // Hasta la 1.7.2: se renumeraban todas.
  const byId = new Map(lists.map((p) => [p.id, p]));
  const next = orderedIds.map((id) => byId.get(id)).filter(Boolean);
  for (const p of lists) if (!orderedIds.includes(p.id)) next.push(p);
  dev.frame.put('playlists', next.map((p, order) => (p.order === order ? p : { ...p, order })));
}

const titlesIn = (dev, playlistId) =>
  (find(dev, 'playlists', playlistId)?.songIds ?? [])
    .filter((id) => dev.library?.[id])
    .map((id) => dev.library[id].title + (dev.library[id].disc ?? ''));
const playlistOrder = (dev) => byOrder(dev.frame.get('playlists') ?? []).map((p) => p.id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function playlistsAcross() {
  console.log('\n▶ Playlists entre tres dispositivos (laptop, tablet y celular)');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  const phone = device('celular');
  const devices = [laptop, tablet, phone];
  setLibrary(laptop, [
    { id: 'L1', title: 'Alpha', artist: 'Ana', fileName: 'alpha.mp3' },
    { id: 'L2', title: 'Beta', artist: 'Bruno', fileName: 'beta.mp3' },
    { id: 'L3', title: 'Gamma', artist: 'Gala', fileName: 'gamma.mp3' },
    { id: 'L4', title: 'Delta', artist: 'Dora', fileName: 'delta.mp3' },
    { id: 'L5', title: 'Intro', artist: 'Banda', fileName: 'CD1/01 - Intro.mp3', disc: ' (CD1)' },
    { id: 'L6', title: 'Intro', artist: 'Banda', fileName: 'CD2/01 - Intro.mp3', disc: ' (CD2)' },
  ]);
  setLibrary(tablet, [
    { id: 'T1', title: 'Alpha', artist: 'Ana', fileName: 'alpha.m4a' },
    { id: 'T2', title: 'Beta', artist: 'Bruno', fileName: 'beta.m4a' },
    { id: 'T3', title: 'Gamma', artist: 'Gala', fileName: 'gamma.m4a' },
    { id: 'T4', title: 'Delta', artist: 'Dora', fileName: 'delta.m4a' },
  ]);
  setLibrary(phone, [
    { id: 'P1', title: 'Alpha', artist: 'Ana', fileName: 'Alpha.mp3' },
    { id: 'P2', title: 'Beta', artist: 'Bruno', fileName: 'Beta.mp3' },
    { id: 'P3', title: 'Gamma', artist: 'Gala', fileName: 'Gamma.mp3' },
    { id: 'P4', title: 'Delta', artist: 'Dora', fileName: 'Delta.mp3' },
    { id: 'P5', title: 'Intro', artist: 'Banda', fileName: 'CD1/01 - Intro.mp3', disc: ' (CD1)' },
    { id: 'P6', title: 'Intro', artist: 'Banda', fileName: 'CD2/01 - Intro.mp3', disc: ' (CD2)' },
  ]);
  load(laptop, {
    ...fixture(),
    playlists: [
      { id: 'p1', name: 'Estudio', songIds: ['L1', 'L2', 'L3', 'L4'], order: 0 },
      { id: 'p2', name: 'Gimnasio', songIds: ['L2', 'L4'], order: 1 },
      { id: 'p3', name: 'Viaje', songIds: ['L3'], order: 2 },
    ],
  });
  laptop.frame.start();
  await sleep(100);
  tablet.frame.start();
  phone.frame.start();
  check(await settle(), 'se calma');
  const allEqual = () => differences(laptop, tablet).length === 0 && differences(laptop, phone).length === 0;
  check(allEqual(), 'los tres tienen lo mismo');
  check(same(titlesIn(phone, 'p1'), ['Alpha', 'Beta', 'Gamma', 'Delta']), `el celular ve la playlist con SUS canciones (${titlesIn(phone, 'p1')})`);

  console.log('\n 1. La laptop reordena las canciones de una playlist');
  let before = counters();
  reorderSongs(laptop, 'p1', ['L4', 'L1', 'L3', 'L2']);
  const wanted = ['Delta', 'Alpha', 'Gamma', 'Beta'];
  timing('orden de canciones → celular', await until(() => same(titlesIn(phone, 'p1'), wanted)));
  timing('orden de canciones → tablet', await until(() => same(titlesIn(tablet, 'p1'), wanted)));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(devices.every((dev) => same(titlesIn(dev, 'p1'), wanted)), 'los tres ven el orden nuevo');
  check(allEqual(), 'los tres tienen lo mismo');

  console.log('\n 2. La laptop reordena las playlists del menú');
  before = counters();
  reorderPlaylistsAs(laptop, ['p3', 'p1', 'p2']);
  timing('orden de playlists → celular', await until(() => same(playlistOrder(phone), ['p3', 'p1', 'p2'])));
  timing('orden de playlists → tablet', await until(() => same(playlistOrder(tablet), ['p3', 'p1', 'p2'])));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(devices.every((dev) => same(playlistOrder(dev), ['p3', 'p1', 'p2'])), 'los tres ven el menú en el orden nuevo');
  check(allEqual(), 'los tres tienen lo mismo');

  console.log('\n 3. A la vez: el celular reordena una playlist y la tablet mueve otra en el menú');
  before = counters();
  reorderSongs(phone, 'p2', ['P4', 'P2']);
  reorderPlaylistsAs(tablet, ['p1', 'p2', 'p3']);
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(devices.every((dev) => same(titlesIn(dev, 'p2'), ['Delta', 'Beta'])), `el orden del celular llega a todos (${devices.map((d) => titlesIn(d, 'p2')).join(' | ')})`);
  check(devices.every((dev) => same(playlistOrder(dev), ['p1', 'p2', 'p3'])), `el menú de la tablet llega a todos (${devices.map(playlistOrder).join(' | ')})`);
  check(allEqual(), 'los tres tienen lo mismo');

  console.log('\n 4. A la vez: la laptop y el celular reordenan la MISMA playlist');
  before = counters();
  reorderSongs(laptop, 'p1', ['L2', 'L3', 'L1', 'L4']);
  await sleep(15);
  reorderSongs(phone, 'p1', ['P1', 'P2', 'P3', 'P4']);
  check(await settle(), 'se calma (sin ida y vuelta)');
  traffic('tráfico', since(before));
  const finalOrder = titlesIn(laptop, 'p1');
  check(same(finalOrder, ['Alpha', 'Beta', 'Gamma', 'Delta']), `gana el último que la tocó, el celular (${finalOrder})`);
  check(devices.every((dev) => same(titlesIn(dev, 'p1'), finalOrder)), 'los tres acaban igual');
  check(allEqual(), 'los tres tienen lo mismo');

  console.log('\n 5. El celular sin conexión reordena; mientras, la laptop reordena otra y la tablet añade una canción');
  setOffline(phone, true);
  await sleep(200);
  before = counters();
  reorderSongs(phone, 'p1', ['P4', 'P3', 'P2', 'P1']);
  await sleep(300);
  reorderSongs(laptop, 'p2', ['L2', 'L4']);
  edit(tablet, 'playlists', 'p3', { songIds: ['T3', 'T1'] });
  check(await settle(), 'se calma sin el celular');
  setOffline(phone, false);
  timing(
    'reconexión → celular al día',
    await until(() => same(titlesIn(phone, 'p2'), ['Beta', 'Delta']) && same(titlesIn(phone, 'p3'), ['Gamma', 'Alpha']))
  );
  timing('… y su orden llega a la laptop', await until(() => same(titlesIn(laptop, 'p1'), ['Delta', 'Gamma', 'Beta', 'Alpha'])));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(devices.every((dev) => same(titlesIn(dev, 'p1'), ['Delta', 'Gamma', 'Beta', 'Alpha'])), 'el orden hecho sin conexión llega a todos');
  check(devices.every((dev) => same(titlesIn(dev, 'p2'), ['Beta', 'Delta'])), 'y el de la laptop también');
  check(devices.every((dev) => same(titlesIn(dev, 'p3'), ['Gamma', 'Alpha'])), 'y la canción que añadió la tablet');
  check(allEqual(), `los tres tienen lo mismo ${JSON.stringify(differences(laptop, phone))}`);

  console.log('\n 6. El celular dormido mientras la laptop reordena');
  putToSleep(phone);
  await sleep(200);
  before = counters();
  reorderSongs(laptop, 'p1', ['L1', 'L4', 'L2', 'L3']);
  reorderPlaylistsAs(laptop, ['p1', 'p2', 'p3']);
  check(await settle(), 'se calma sin el celular');
  wakeUp(phone);
  timing(
    'al despertar, el orden llega',
    await until(() => same(titlesIn(phone, 'p1'), ['Alpha', 'Delta', 'Beta', 'Gamma']) && same(playlistOrder(phone), ['p1', 'p2', 'p3']))
  );
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(allEqual(), 'los tres tienen lo mismo');

  console.log('\n 7. Dos canciones con el mismo título y artista (disco doble)');
  before = counters();
  add(laptop, 'playlists', { id: 'p4', name: 'Disco doble', songIds: ['L5', 'L1', 'L6'], order: 3 });
  timing('playlist → celular', await until(() => !!find(phone, 'playlists', 'p4')));
  check(await settle(), 'se calma');
  check(titlesIn(phone, 'p4').length === 3, `el celular ve las tres (${titlesIn(phone, 'p4')})`);
  const shown = (find(phone, 'playlists', 'p4')?.songIds ?? []).filter((id) => phone.library[id]);
  reorderSongs(phone, 'p4', ['P1', ...shown.filter((id) => id !== 'P1')]);
  timing('orden del celular → laptop', await until(() => (find(laptop, 'playlists', 'p4')?.songIds ?? [])[0] === 'L1'));
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  const p4 = find(laptop, 'playlists', 'p4')?.songIds ?? [];
  check(p4.length === 3 && p4.includes('L5') && p4.includes('L6'), `la laptop conserva las dos copias (${JSON.stringify(p4)})`);
  check(find(tablet, 'playlists', 'p4')?.songIds.length === 3, `la tablet, sin esas canciones, les guarda el sitio (${JSON.stringify(find(tablet, 'playlists', 'p4')?.songIds)})`);
  check(allEqual(), `los tres tienen lo mismo ${JSON.stringify(differences(laptop, phone))}`);

  console.log('\n 8. Los tres cambian cosas distintas en el mismo instante');
  before = counters();
  add(laptop, 'tasks', { id: 't-laptop', title: 'Tarea de la laptop', courseId: 'c1' });
  add(tablet, 'tasks', { id: 't-tablet', title: 'Tarea de la tablet', courseId: 'c2' });
  add(phone, 'tasks', { id: 't-celular', title: 'Tarea del celular', courseId: 'c1' });
  reorderSongs(laptop, 'p1', ['L3', 'L2', 'L4', 'L1']);
  edit(tablet, 'playlists', 'p3', { name: 'Viaje largo' });
  reorderSongs(phone, 'p2', ['P4', 'P2']);
  check(await settle(), 'se calma');
  traffic('tráfico', since(before));
  check(
    devices.every((dev) => ['t-laptop', 't-tablet', 't-celular'].every((id) => !!find(dev, 'tasks', id))),
    'las tres tareas nuevas están en los tres'
  );
  check(devices.every((dev) => same(titlesIn(dev, 'p1'), ['Gamma', 'Beta', 'Delta', 'Alpha'])), 'el orden de la laptop llega a todos');
  check(devices.every((dev) => find(dev, 'playlists', 'p3')?.name === 'Viaje largo'), 'el nombre de la tablet llega a todos');
  check(devices.every((dev) => same(titlesIn(dev, 'p2'), ['Delta', 'Beta'])), 'el orden del celular llega a todos');
  check(allEqual(), `los tres tienen lo mismo ${JSON.stringify(differences(laptop, phone))}`);
  shutdown();
}

// ------------------------------------------------------------
// Fallos que pasan solos (1.9.2): la sincronización no espera a la sonda
// ------------------------------------------------------------
async function recovery() {
  console.log('\n▶ La nube falla un rato, o la sesión no se puede renovar: la sincronización se recupera sola');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet');
  load(laptop, fixture());
  laptop.frame.start();
  await sleep(120);
  tablet.frame.start();
  check(await settle(), 'se calma');
  const inCloud = (id) => (cloud.row?.data?.data?.tasks ?? []).some((task) => task.id === id);

  console.log('\n 1. El servicio responde con errores a la laptop durante 8 s, justo cuando cambia algo');
  cloud.failing = (dev) => dev === laptop;
  add(laptop, 'tasks', { id: 'r1', title: 'Durante la caída', courseId: 'c1' });
  timing('el cambio llega igual a la tablet, por el canal', await until(() => !!find(tablet, 'tasks', 'r1'), 5_000));
  await sleep(8_000);
  check(!inCloud('r1') && laptop.frame.status()?.phase === 'error', 'la nube aún no lo tiene, y el verificador lo sabe');
  const tries = cloud.failed;
  cloud.failing = null;
  const back = await until(() => inCloud('r1'), 40_000);
  timing('vuelve el servicio → el cambio sube solo', back);
  check(back !== null && back <= 12_000, `sin esperar a la sonda del minuto (${back} ms)`);
  check(tries <= 3, `y sin insistir durante la caída (${tries} peticiones en 8 s)`);
  check(await settle(), 'se calma');
  check(laptop.frame.status()?.phase === 'idle' && differences(laptop, tablet).length === 0, 'todo en orden otra vez, los dos con lo mismo');

  console.log('\n 2. La laptop vuelve de un rato sin red con la llave vencida: no se puede renovar todavía');
  laptop.sessionDown = true;
  add(laptop, 'tasks', { id: 'r2', title: 'Con la llave vencida', courseId: 'c1' });
  await sleep(2_000);
  const status = laptop.frame.status();
  check(status?.phase === 'error' && /fetch/i.test(status?.lastError ?? ''), `cuenta como fallo de red, no como «sesión inválida» (${status?.lastError})`);
  await sleep(38_000); // pasan los tres reintentos cortos (5, 10 y 20 s)
  check(!inCloud('r2'), 'mientras no hay llave, no sube');
  laptop.sessionDown = false;
  laptop.authEvent('TOKEN_REFRESHED');
  const renewed = await until(() => inCloud('r2'), 20_000);
  timing('la llave se renueva → sube al momento', renewed);
  check(renewed !== null && renewed <= 2_000, `sin esperar a la sonda, que ya iba espaciada a minutos (${renewed} ms)`);
  check(await settle(), 'se calma');
  check(differences(laptop, tablet).length === 0, 'los dos tienen lo mismo');
  check(laptop.frame.reported().length === 0, 'y unos fallos de red seguidos no se anotan como error de Frame (solo si duran un cuarto de hora)');
  shutdown();
}

// ------------------------------------------------------------
// Ajustes → Dispositivos (1.9.2): lo que ve la tarjeta y lo que cuesta
// ------------------------------------------------------------
async function devicesAcross() {
  console.log('\n▶ Dispositivos de la cuenta: laptop, tablet (reloj dos horas adelantado) y celular');
  resetWorld();
  const laptop = device('laptop');
  const tablet = device('tablet', 'actual', { clockOffset: 2 * 3_600_000 });
  const phone = device('celular');
  const all = [laptop, tablet, phone];
  laptop.frame.identify('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36');
  tablet.frame.identify('Mozilla/5.0 (Linux; Android 14; SM-X210) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36', [800, 1280]);
  phone.frame.identify('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36', [412, 915]);
  load(laptop, { ...fixture(), imageRefs: [] });

  /** Como layout.tsx: la sincronización, el verificador y los latidos arrancan juntos. */
  const startAll = (dev) => {
    dev.frame.start();
    dev.frame.devices.start();
  };
  const idOf = (dev) => dev.frame.devices.id();
  const rowIn = (viewer, dev) => viewer.frame.devices.view().rows?.find((row) => row.device_id === idOf(dev));
  const stateIn = (viewer, dev) => rowIn(viewer, dev)?.state;
  const inCloud = (dev) => cloud.devices.get(idOf(dev));
  const beats = (from) => all.map((dev) => callsOf(dev, 'device_heartbeat', from));
  const told = () => bus.sent.devices ?? 0;
  /** La tarjeta de `viewer` enseña a estos equipos vinculados y al día. */
  const allSynced = (viewer, devs) => devs.every((dev) => rowIn(viewer, dev)?.linked === true && stateIn(viewer, dev) === 'synced');
  /** Vuelve a mirar ya (lo que hace la tarjeta al abrirse). */
  const look = (dev) => {
    dev.frame.devices.open(false);
    dev.frame.devices.open(true);
  };

  // --- 0. Arranque, sin nadie mirando ---
  console.log('\n 0. Arrancan los tres; nadie tiene la tarjeta abierta');
  startAll(laptop);
  await sleep(120);
  startAll(tablet);
  startAll(phone);
  check(await settle(), 'se calma');
  await sleep(7_000);
  let n = beats(0);
  check(n.every((count) => count >= 1 && count <= 4), `cada equipo se presenta con pocos latidos (${n.join(', ')})`);
  check(cloud.devices.size === 3 && [...cloud.devices.values()].every((row) => row.linked), 'la nube tiene los tres, vinculados');
  let mark = cloud.calls.length;
  await sleep(13_000);
  check(cloud.calls.length === mark, `después, sin cambios, nadie late (${cloud.calls.length - mark} llamadas en 13 s)`);

  console.log('\n 0b. Un cambio sin nadie mirando: se cuenta sin prisa');
  mark = cloud.calls.length;
  add(laptop, 'tasks', { id: 'd0', title: 'Sin nadie mirando', courseId: 'c1' });
  await until(() => !!find(phone, 'tasks', 'd0') && !!find(tablet, 'tasks', 'd0'));
  await sleep(10_000);
  check(cloud.calls.length === mark, `a los 10 s nadie ha latido por ello (${cloud.calls.length - mark})`);
  timing('cambio → los tres lo cuentan a la nube', await until(() => beats(mark).every((count) => count >= 1), 30_000));
  await sleep(1_500);
  n = beats(mark);
  check(n.every((count) => count === 1), `un solo latido por equipo, al medio minuto (${n.join(', ')})`);

  // --- 1. La tarjeta ---
  console.log('\n 1. La laptop abre Ajustes → Dispositivos');
  laptop.frame.devices.open(true);
  timing('abrir la tarjeta → los tres, vinculados y al día', await until(() => allSynced(laptop, all), 8_000));
  let rows = laptop.frame.devices.view().rows ?? [];
  const shape = (dev) => `${rowIn(laptop, dev)?.kind}/${rowIn(laptop, dev)?.platform}`;
  check(rows.length === 3, `ve tres equipos (${rows.length})`);
  check(shape(laptop) === 'laptop/windows' && shape(tablet) === 'tablet/android' && shape(phone) === 'phone/android', `sabe qué es cada uno (${all.map(shape).join(', ')})`);
  check(rows.filter((row) => row.self).length === 1 && rowIn(laptop, laptop)?.self === true, 'y cuál es este');
  check(rows.every((row) => row.seenAgo < 20_000), `«visto hace» sale del reloj del servidor (${rows.map((row) => Math.round(row.seenAgo / 1000)).join(' s, ')} s)`);
  const tabletView = tablet.frame.devices.view();
  check(Math.abs(tabletView.skew - 2 * 3_600_000) < 5_000, `la tablet sabe que su reloj va dos horas adelantado (${Math.round(tabletView.skew / 60_000)} min)`);
  check((tabletView.rows ?? []).every((row) => row.seenAgo < 60_000), 'y aun así no ve a nadie «hace dos horas»');

  // --- 2. Un cambio con la tarjeta abierta ---
  console.log('\n 2. Un cambio en la laptop con la tarjeta abierta');
  const seen = new Set();
  const watcher = setInterval(() => {
    for (const row of laptop.frame.devices.view().rows ?? []) seen.add(row.state);
  }, 20);
  let version = laptop.frame.devices.view().cloudAt;
  add(laptop, 'tasks', { id: 'd1', title: 'Con la tarjeta abierta', courseId: 'c1' });
  await until(() => laptop.frame.devices.view().cloudAt !== version, 5_000);
  timing('la copia de la nube cambia → otra vez los tres al día', await until(() => allSynced(laptop, all), 10_000));

  // --- 3. Versiones selladas por relojes distintos ---
  console.log('\n 3. La tablet (reloj adelantado) cambia algo, y luego la laptop');
  version = laptop.frame.devices.view().cloudAt;
  edit(tablet, 'tasks', 't1', { title: 'Desde la tablet' });
  await until(() => laptop.frame.devices.view().cloudAt !== version, 8_000);
  timing('cambio de la tablet → los tres al día', await until(() => allSynced(laptop, all), 10_000));
  version = laptop.frame.devices.view().cloudAt;
  edit(laptop, 'tasks', 't2', { title: 'Y después desde la laptop' });
  await until(() => laptop.frame.devices.view().cloudAt !== version, 8_000);
  timing('cambio de la laptop (su versión es «anterior» a la de la tablet) → los tres al día', await until(() => allSynced(laptop, all), 10_000));
  clearInterval(watcher);
  check(!seen.has('behind') && !seen.has('unlinked') && !seen.has('inactive'), `en todo ese rato nadie apareció con problemas (${[...seen].join(', ')})`);

  // --- 4. Sin conexión ---
  console.log('\n 4. El celular se queda sin conexión y la laptop cambia algo');
  setOffline(phone, true);
  await sleep(200);
  version = laptop.frame.devices.view().cloudAt;
  add(laptop, 'tasks', { id: 'd2', title: 'Mientras el celular no tiene red', courseId: 'c2' });
  await until(() => laptop.frame.devices.view().cloudAt !== version, 5_000);
  await until(() => allSynced(laptop, [laptop, tablet]), 10_000);
  check(allSynced(laptop, [laptop, tablet]), 'la laptop y la tablet, al día');
  check(stateIn(laptop, phone) === 'waiting', `el celular queda «por ponerse al día», no «con problemas» (${stateIn(laptop, phone)})`);
  setOffline(phone, false);
  timing('vuelve la red → el celular al día en la tarjeta', await until(() => allSynced(laptop, all), 15_000));

  // --- 5. Lo que a un equipo le falta ---
  console.log('\n 5. Una playlist con canciones que la tablet no tiene');
  const songs = [
    { id: 'L1', title: 'Alpha', artist: 'Ana', fileName: 'alpha.mp3' },
    { id: 'L2', title: 'Beta', artist: 'Bruno', fileName: 'beta.mp3' },
    { id: 'L3', title: 'Gamma', artist: 'Gala', fileName: 'gamma.mp3' },
  ];
  setLibrary(laptop, songs);
  laptop.frame.devices.library(songs.map((song) => song.id));
  const phoneSongs = songs.map((song, index) => ({ ...song, id: `P${index + 1}` }));
  setLibrary(phone, phoneSongs);
  phone.frame.devices.library(phoneSongs.map((song) => song.id));
  tablet.frame.devices.library([]);
  add(laptop, 'playlists', { id: 'pd', name: 'Para estudiar', songIds: ['L1', 'L2', 'L3'], order: 0 });
  timing('playlist nueva → la tablet aparece con lo que le falta', await until(() => stateIn(laptop, tablet) === 'behind', 15_000));
  check(rowIn(laptop, tablet)?.sync?.issues?.song === 3, `le faltan 3 canciones (${JSON.stringify(rowIn(laptop, tablet)?.sync?.issues)})`);
  await until(() => allSynced(laptop, [laptop, phone]), 10_000);
  check(allSynced(laptop, [laptop, phone]), 'los que sí las tienen, al día');
  // Llegan a la tablet (por Wire, o importándolas): deja de faltarle nada, sin esperar a la ronda de 2 min.
  const tabletSongs = songs.map((song, index) => ({ ...song, id: `T${index + 1}` }));
  setLibrary(tablet, tabletSongs);
  tablet.frame.devices.library(tabletSongs.map((song) => song.id));
  timing('las canciones llegan a la tablet → al día', await until(() => allSynced(laptop, all), 15_000));
  // Y una que solo tiene la laptop, para lo que sigue.
  setLibrary(laptop, [...songs, { id: 'L4', title: 'Delta', artist: 'Dora', fileName: 'delta.mp3' }]);
  laptop.frame.devices.library(['L1', 'L2', 'L3', 'L4']);
  edit(laptop, 'playlists', 'pd', { songIds: ['L1', 'L2', 'L3', 'L4'] });
  await until(() => stateIn(laptop, tablet) === 'behind' && stateIn(laptop, phone) === 'behind', 15_000);
  check(stateIn(laptop, tablet) === 'behind' && stateIn(laptop, phone) === 'behind', 'una canción que solo tiene la laptop: a los otros dos les falta');
  await sleep(3_000);

  // --- 6. Lo que cuesta mirar ---
  console.log('\n 6. Treinta y cinco segundos con la tarjeta de la laptop abierta, sin tocar nada');
  mark = cloud.calls.length;
  let messages = told();
  await sleep(35_000);
  n = beats(mark);
  check(n.every((count) => count <= 2), `como mucho un latido por equipo cada 30 s (${n.join(', ')})`);
  check(told() - messages <= 2, `y un aviso por ronda (${told() - messages})`);

  console.log('\n 6b. Otros treinta y cinco con la tarjeta abierta también en la tablet');
  tablet.frame.devices.open(true);
  await sleep(3_000);
  mark = cloud.calls.length;
  messages = told();
  await sleep(35_000);
  n = beats(mark);
  check(n.every((count) => count <= 4), `los latidos no se multiplican (${n.join(', ')})`);
  check(told() - messages <= 6, `ni los avisos: nadie contesta a un aviso con otro (${told() - messages})`);
  tablet.frame.devices.open(false);

  // --- 7. «Corregir» ---
  console.log('\n 7. «Corregir» desde la laptop');
  let nows = all.map((dev) => dev.frame.devices.syncNows());
  check((await laptop.frame.devices.repair()) === true, 'el pedido queda guardado en la nube');
  timing('«Corregir» → la tablet y el celular sincronizan todo', await until(() => tablet.frame.devices.syncNows() > nows[1] && phone.frame.devices.syncNows() > nows[2], 10_000));
  await sleep(7_000);
  let after = all.map((dev) => dev.frame.devices.syncNows());
  check(after.every((count, index) => count === nows[index] + 1), `cada equipo lo hace UNA vez, aunque siga latiendo (${after.map((count, index) => count - nows[index]).join(', ')})`);
  mark = cloud.calls.length;
  tablet.frame.devices.stop();
  tablet.frame.devices.start();
  tablet.frame.devices.library(tabletSongs.map((song) => song.id));
  await until(() => callsOf(tablet, 'device_heartbeat', mark) >= 1, 12_000);
  await sleep(500);
  check(tablet.frame.devices.syncNows() === after[1], 'al reabrir Frame no repite un pedido que ya atendió');
  nows = all.map((dev) => dev.frame.devices.syncNows());
  check((await laptop.frame.devices.repair()) === true, 'un segundo pedido');
  timing('segundo «Corregir» → los otros dos, otra vez', await until(() => tablet.frame.devices.syncNows() > nows[1] && phone.frame.devices.syncNows() > nows[2], 10_000));
  await sleep(6_000);

  // --- 8. Cerrar sesión ---
  console.log('\n 8. El celular cierra sesión');
  await phone.frame.devices.unlink();
  cloud.sessions.delete(phone.session);
  phone.frame.stop();
  timing('cerrar sesión → la laptop lo ve desvinculado', await until(() => stateIn(laptop, phone) === 'unlinked', 8_000));
  check(!!rowIn(laptop, phone)?.unlinked_at, 'con la hora en que cerró');

  console.log('\n 8b. Vuelve a entrar (sesión nueva)');
  phone.session = crypto.randomUUID();
  cloud.sessions.add(phone.session);
  startAll(phone);
  phone.frame.devices.library(phoneSongs.map((song) => song.id));
  timing('entrar de nuevo → vinculado otra vez', await until(() => rowIn(laptop, phone)?.linked === true, 15_000));
  check(rowIn(laptop, phone)?.unlinked_at === null, 'sin esperar a que pase el margen de la despedida (es otra sesión)');

  console.log('\n 8c. Un latido que salió antes de «Cerrar sesión» llega después');
  await sleep(2_500);
  cloud.delayRpc = (dev, name) => (dev === phone && name === 'device_heartbeat' ? 1_500 : 0);
  mark = cloud.calls.length;
  look(phone);
  await until(() => callsOf(phone, 'device_heartbeat', mark, true) >= 1, 5_000);
  check(callsOf(phone, 'device_heartbeat', mark, true) === 1 && callsOf(phone, 'device_heartbeat', mark) === 0, 'hay un latido en camino');
  await phone.frame.devices.unlink();
  phone.frame.devices.open(false);
  await until(() => callsOf(phone, 'device_heartbeat', mark) >= 1, 5_000);
  cloud.delayRpc = null;
  check(inCloud(phone)?.linked === false && inCloud(phone)?.unlinked_at !== null, 'llegó después y no lo revivió: la despedida manda');
  await until(() => stateIn(laptop, phone) === 'unlinked', 8_000);
  check(stateIn(laptop, phone) === 'unlinked' && !!rowIn(laptop, phone)?.unlinked_at, 'la laptop lo ve desvinculado, con su hora');

  console.log('\n 8d. Frame se cerró a media salida: la sesión siguió viva y el equipo vuelve a abrirse');
  laptop.frame.devices.open(false);
  await sleep(1_000);
  // Como si la despedida fuera de hace 108 s: a su margen le quedan 12.
  inCloud(phone).unlinked_at = Date.now() - 108_000;
  mark = cloud.calls.length;
  phone.frame.devices.stop();
  phone.frame.devices.start();
  phone.frame.devices.library(phoneSongs.map((song) => song.id));
  await until(() => callsOf(phone, 'device_heartbeat', mark) >= 1, 10_000);
  await sleep(300);
  check(inCloud(phone)?.linked === false, 'dentro del margen, la nube aún lo da por despedido');
  check(rowIn(phone, phone)?.linked === true, 'pero el propio equipo, que tiene sesión, no se ve «desvinculado»');
  timing('pasa el margen → se vincula solo, sin que nadie pregunte', await until(() => inCloud(phone)?.linked === true, 25_000));
  check(inCloud(phone)?.linked === true && inCloud(phone)?.unlinked_at === null, 'vinculado otra vez');
  n = callsOf(phone, 'device_heartbeat', mark);
  check(n <= 3, `con un par de latidos, no insistiendo (${n})`);

  // --- 9. Una sesión cerrada desde fuera ---
  console.log('\n 9. La sesión de la tablet se cierra desde fuera; la tablet sigue abierta');
  laptop.frame.devices.open(true);
  await until(() => allSynced(laptop, [laptop]) && rowIn(laptop, tablet)?.linked === true, 8_000);
  cloud.sessions.delete(tablet.session);
  look(laptop);
  timing('→ la laptop la ve desvinculada', await until(() => stateIn(laptop, tablet) === 'unlinked', 8_000));
  check(rowIn(laptop, tablet)?.unlinked_at === null, 'sin hora de despedida: no llegó a avisar');
  const flicker = new Set();
  const flickerWatch = setInterval(() => flicker.add(stateIn(laptop, tablet)), 20);
  mark = cloud.calls.length;
  look(laptop);
  await until(() => callsOf(tablet, 'device_heartbeat', mark) >= 1, 8_000);
  await sleep(6_000);
  look(laptop);
  await sleep(3_000);
  clearInterval(flickerWatch);
  check(callsOf(tablet, 'device_heartbeat', mark) >= 2, `la tablet siguió latiendo con su llave aún válida (${callsOf(tablet, 'device_heartbeat', mark)})`);
  check(flicker.size === 1 && flicker.has('unlinked'), `y no parpadea entre vinculada y desvinculada (${[...flicker].join(', ')})`);
  check(stateIn(tablet, tablet) === 'unlinked', 'ella misma se ve desvinculada');

  console.log('\n 9b. La laptop la quita de la lista');
  check((await laptop.frame.devices.forget(idOf(tablet))) === true, 'se quita');
  check(!rowIn(laptop, tablet) && !inCloud(tablet), 'desaparece de la tarjeta y de la nube');
  mark = cloud.calls.length;
  look(laptop);
  await until(() => callsOf(tablet, 'device_heartbeat', mark) >= 1, 8_000);
  await sleep(1_500);
  check(!inCloud(tablet) && !rowIn(laptop, tablet), 'y no reaparece aunque siga latiendo con la sesión cerrada');
  laptop.frame.devices.open(false);

  // --- 10. La llave caduca: los latidos fallan ---
  console.log('\n10. La llave de la tablet caduca (sesión perdida): sus latidos fallan');
  tablet.jwt = false;
  mark = cloud.calls.length;
  look(tablet);
  tablet.frame.devices.open(false);
  await until(() => tablet.frame.devices.view().failed === true, 8_000);
  check(tablet.frame.devices.view().failed === true, 'la tarjeta lo dice');
  await sleep(20_000);
  n = callsOf(tablet, 'device_heartbeat', mark, true);
  check(n === 2, `reintenta sola y espaciado: 2 intentos en 20 s, no uno tras otro (${n})`);
  // Vuelve a entrar: el siguiente reintento ya llega.
  tablet.session = crypto.randomUUID();
  cloud.sessions.add(tablet.session);
  tablet.jwt = true;
  timing('con la sesión de vuelta → el reintento llega solo', await until(() => tablet.frame.devices.view().failed === false && rowIn(tablet, tablet)?.linked === true, 35_000));
  check(inCloud(tablet)?.linked === true, 'y vuelve a estar en la lista, vinculada');

  check(all.every((dev) => dev.frame.reported().length === 0), 'ningún fallo anotado en el registro de errores');
  shutdown();
}

const started = Date.now();
// --solo=dos|tres|playlists|relojes|convivencia|anterior|futuro|imagenes|corazon|recuperacion|dispositivos|referencia corre solo ese grupo.
const only = process.argv.find((arg) => arg.startsWith('--solo='))?.slice('--solo='.length);
const groups = { dos: twoDevices, tres: threeDevices, playlists: playlistsAcross, relojes: clockSkew, convivencia: withOldVersion, anterior: withPrevious, futuro: futureKeys, imagenes: images, corazon: favorites, recuperacion: recovery, dispositivos: devicesAcross, referencia: oldPair };
for (const [name, run] of Object.entries(groups)) {
  if (only ? only === name : name !== 'referencia' || !process.argv.includes('--sin-referencia')) await run();
}

console.log(`\n${failures.length === 0 ? '✓ Todo en orden' : `✗ ${failures.length} comprobaciones fallidas`} · ${((Date.now() - started) / 1000).toFixed(0)} s · semilla ${process.env.SEMILLA ?? 168}`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
