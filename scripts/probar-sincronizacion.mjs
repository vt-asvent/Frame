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
    const response = this.dev.offline ? { data: null, error: { message: 'TypeError: Failed to fetch' } } : this.execute();
    await sleep(latency()); // y la respuesta vuelve
    return response;
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
    auth: { getSession: async () => ({ data: { session: { user: { id: UID } } } }) },
    from: () => new Query(dev),
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
  const dev = { name, version, offline: false, asleep: false };
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
  'schedules', 'classSessions',
]);
const RETIRED = new Set(['classSessions', 'schedules', 'playHistory', 'headerQuote', 'school']);

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

const started = Date.now();
// --solo=dos|tres|playlists|relojes|convivencia|anterior|futuro|imagenes|corazon|referencia corre solo ese grupo.
const only = process.argv.find((arg) => arg.startsWith('--solo='))?.slice('--solo='.length);
const groups = { dos: twoDevices, tres: threeDevices, playlists: playlistsAcross, relojes: clockSkew, convivencia: withOldVersion, anterior: withPrevious, futuro: futureKeys, imagenes: images, corazon: favorites, referencia: oldPair };
for (const [name, run] of Object.entries(groups)) {
  if (only ? only === name : name !== 'referencia' || !process.argv.includes('--sin-referencia')) await run();
}

console.log(`\n${failures.length === 0 ? '✓ Todo en orden' : `✗ ${failures.length} comprobaciones fallidas`} · ${((Date.now() - started) / 1000).toFixed(0)} s · semilla ${process.env.SEMILLA ?? 168}`);
for (const failure of failures) console.log(`  ✗ ${failure}`);
process.exit(failures.length === 0 ? 0 : 1);
