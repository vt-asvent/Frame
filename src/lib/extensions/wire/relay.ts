import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { authorizeDrive, refreshGoogleAccess, revokeGoogleToken } from '@/lib/google/auth';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { deleteSecret, getSecret, setSecret } from '@/lib/extensions/native';
import { libraryKeys } from '@/lib/song-keys';
import { addSongFileToDB, getImage, getImageRecord, getSongFileFromDB, saveImage } from '@/lib/music-db';
import { entityOfImage, isEntityImageKey, readImageRefs, reconcileImageRefs, type ImageRef } from '@/lib/image-refs';
import { fingerprint } from '@/lib/profile-scope';
import { importLyrics, storedLyrics, type SongLyrics } from '@/lib/lyrics';
import { hasAttachment, readAttachment, storeAttachmentCopy } from '@/lib/file-handles';
import { sendPeerMessage } from '@/lib/sync-peers';
import { SYNC_RECHECK_EVENT } from '@/lib/sync-status';
import { tr } from '@/lib/i18n';
import { UNKNOWN_ARTIST } from '@/lib/enum-labels';
import type { ArchivedNote, ArchivedTask, Note, Song, Task } from '@/types';
import { Drive, DriveError, type DriveFile } from './drive';
import { planCycle, updateDeclined, WEEK_MS, type DeviceRecord, type ItemKind, type LocalView, type RelayItem } from './plan';

// ============================================================
// Wire: el relevo por Google Drive (1.7.3). Ver plan.ts para las reglas.
//
// En el Drive del usuario, una carpeta «Frame · Wire» por cuenta de Frame
// (marcada con un resumen de su id, no con el id): la ficha de cada equipo
// («Equipo · …json») y lo que está de paso (canciones con su ficha de datos,
// adjuntos de tareas, archivos de recursos y, desde la 1.9.2, las imágenes
// propias de asignaturas, colecciones y playlists). Lo que llega a un equipo
// entra en Frame como si se hubiera importado ahí.
//
// 1.9.2: lo que ya está en todos los equipos se borra de Drive del todo (en
// su papelera seguía ocupando espacio un mes); cuando algo viaja, los demás
// equipos abiertos se enteran al momento por el canal de la cuenta en vez de
// en su vuelta del minuto y medio; y una cola larga no espera entre vueltas.
//
// La cuenta de Drive es de ESTE equipo: el token de renovación lo guarda
// cifrado el núcleo nativo; aquí solo vive en memoria el de acceso.
// ============================================================

export const WIRE = 'frame.wire';
const ROOT_NAME = 'Frame · Wire';
const SECRET = 'drive-refresh';
/** Por vuelta, como mucho: así una biblioteca enorme no bloquea nada. */
const MAX_TRANSFERS = 8;
const MAX_BYTES = 400 * 1024 * 1024;
const MAX_FILE = 300 * 1024 * 1024;
/** La ficha del equipo se reescribe al cambiar, y si no, cada tanto (latido). */
const HEARTBEAT_MS = 20 * 60 * 1000;

export interface WireConnection {
  email: string;
  connectedAt: string;
}

export interface WireItemView {
  id: string;
  key: string;
  kind: ItemKind;
  name: string;
  size: number;
  fromName: string;
  permanent: boolean;
  /** Nombres de los equipos que aún lo esperan. */
  waiting: string[];
  pinned: boolean;
}

export interface WireDeviceView {
  id: string;
  name: string;
  lastSeen: number;
  self: boolean;
  active: boolean;
}

export interface WireActivity {
  at: number;
  kind: 'up' | 'down' | 'remove' | 'info' | 'error';
  text: string;
}

export interface WireStatus {
  phase: 'off' | 'idle' | 'syncing' | 'error';
  account: string | null;
  lastSync: number | null;
  error: string | null;
  shareable: { songs: number; files: number };
  pendingUp: number;
  pendingDown: number;
  items: WireItemView[];
  devices: WireDeviceView[];
  log: WireActivity[];
  transfer: { name: string; direction: 'up' | 'down' } | null;
}

// ------------------------------------------------------------
// Estado para la interfaz
// ------------------------------------------------------------

let status: WireStatus = {
  phase: 'off',
  account: extRead<WireConnection | null>(WIRE, 'connection', null)?.email ?? null,
  lastSync: null,
  error: null,
  shareable: { songs: 0, files: 0 },
  pendingUp: 0,
  pendingDown: 0,
  items: [],
  devices: [],
  log: [],
  transfer: null,
};
const listeners = new Set<() => void>();

function patch(next: Partial<WireStatus>) {
  status = { ...status, ...next };
  listeners.forEach((fn) => fn());
}

function note(kind: WireActivity['kind'], text: string) {
  patch({ log: [{ at: Date.now(), kind, text }, ...status.log].slice(0, 60) });
}

export function useWireStatus(): WireStatus {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => status,
    () => status
  );
}

// ------------------------------------------------------------
// Cuenta de Drive
// ------------------------------------------------------------

export const wireConnection = () => extRead<WireConnection | null>(WIRE, 'connection', null);

let access: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (access && access.expiresAt - Date.now() > 60_000) return access.token;
  const refresh = await getSecret(WIRE, SECRET);
  if (!refresh) throw new DriveError('auth', tr('Conecta tu Google Drive.'));
  try {
    const fresh = await refreshGoogleAccess(refresh);
    access = { token: fresh.accessToken, expiresAt: fresh.expiresAt };
    return fresh.accessToken;
  } catch (error) {
    // invalid_grant: el usuario quitó el permiso en su cuenta de Google.
    if (/invalid_grant|revoked|expired/i.test(String(error))) throw new DriveError('auth', tr('Google retiró el permiso: vuelve a conectar tu Drive.'));
    throw new DriveError('network', tr('No se pudo hablar con Google.'));
  }
}

/** Paso 1 al instalar: el usuario elige la cuenta. Aún no se guarda nada. */
export const chooseDriveAccount = () => authorizeDrive();

/** Paso 2: el usuario confirmó esa cuenta. */
export async function confirmDriveAccount(grant: Awaited<ReturnType<typeof authorizeDrive>>): Promise<void> {
  await setSecret(WIRE, SECRET, grant.refreshToken);
  access = { token: grant.accessToken, expiresAt: grant.expiresAt };
  extWrite(WIRE, 'connection', { email: grant.email, connectedAt: new Date().toISOString() } satisfies WireConnection);
  await device();
  patch({ account: grant.email, phase: 'idle', error: null });
  note('info', tr('Conectado a Google Drive ({email}).', { email: grant.email }));
}

/** Sale del relevo: quita la ficha de este equipo, retira el permiso y borra la llave. */
export async function disconnectWire(): Promise<void> {
  stopped = true;
  try {
    const own = extRead<string | null>(WIRE, 'deviceFile', null);
    if (own) await new Drive(accessToken).remove(own);
  } catch {
    /* sin red: los demás dejarán de esperarlo en una semana */
  }
  const refresh = await getSecret(WIRE, SECRET);
  if (refresh) await revokeGoogleToken(refresh);
  await deleteSecret(WIRE, SECRET);
  access = null;
  for (const name of ['connection', 'deviceFile', 'root']) extWrite(WIRE, name, null);
  patch({ phase: 'off', account: null, items: [], devices: [], pendingDown: 0, pendingUp: 0, transfer: null, error: null });
  stopped = false;
}

onExtensionTeardown(WIRE, disconnectWire);

// ------------------------------------------------------------
// Este equipo
// ------------------------------------------------------------

interface DeviceIdentity {
  id: string;
  name: string;
}

async function device(): Promise<DeviceIdentity> {
  const saved = extRead<DeviceIdentity | null>(WIRE, 'device', null);
  if (saved) return saved;
  const name = isTauri() ? await invoke<string>('ext_device_name').catch(() => 'Windows') : 'Navegador';
  const created = { id: crypto.randomUUID(), name };
  extWrite(WIRE, 'device', created);
  return created;
}

export function renameDevice(name: string) {
  const current = extRead<DeviceIdentity | null>(WIRE, 'device', null);
  if (current && name.trim()) extWrite(WIRE, 'device', { ...current, name: name.trim().slice(0, 40) });
}

export const deviceName = () => extRead<DeviceIdentity | null>(WIRE, 'device', null)?.name ?? null;

// ------------------------------------------------------------
// Lo que hay en este equipo
// ------------------------------------------------------------

export interface WireContext {
  uid: string;
  songs: Song[];
  addSongs: (songs: Song[]) => Promise<void>;
  tasks: Task[];
  archivedTasks: ArchivedTask[];
  incompleteTasks: ArchivedTask[];
  notes: Note[];
  archivedNotes: ArchivedNote[];
}

const hashes = new Map<string, string>();
async function hash(text: string): Promise<string> {
  const known = hashes.get(text);
  if (known) return known;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
  hashes.set(text, hex);
  return hex;
}

/** Archivos de recursos que ya se vio que están aquí (leerlos para saberlo cuesta). */
const noteFilesHere = new Set<string>();
/** Imágenes propias (clave con su huella) que ya se vio que están aquí. */
const imagesHere = new Set<string>();

/** «i:<clave de la imagen>:<huella>»: si la imagen cambia, es otra. */
const imageItemKey = (ref: ImageRef) => `i:${ref.id}:${ref.h}`;
const parseImageKey = (key: string) => /^i:(.+):([^:]+)$/.exec(key);

interface Inventory {
  view: LocalView;
  songsByKey: Map<string, Song>;
  attachments: Map<string, { taskName: string }>;
  noteFiles: Map<string, Note>;
  images: Map<string, ImageRef>;
  uid: string;
}

async function inventory(ctx: WireContext, deviceId: string, state: RelayState): Promise<Inventory> {
  const have = new Set<string>();
  const keep = new Set<string>(state.pins);
  const uploadable = new Map<string, ItemKind>();
  const songsByKey = new Map<string, Song>();
  const keys = libraryKeys(ctx.songs);
  for (const song of ctx.songs) {
    const key = `s:${await hash(keys[song.id])}`;
    have.add(key);
    uploadable.set(key, 'song');
    songsByKey.set(key, song);
    if (song.isFavorite) keep.add(key);
  }
  const attachments = new Map<string, { taskName: string }>();
  for (const task of [...ctx.tasks, ...ctx.archivedTasks, ...ctx.incompleteTasks]) {
    for (const a of task.attachments ?? []) {
      if (a.kind !== 'file') continue;
      const key = `a:${a.id}`;
      attachments.set(key, { taskName: task.name });
      if (await hasAttachment(a.id)) {
        have.add(key);
        uploadable.set(key, 'attachment');
      }
    }
  }
  const noteFiles = new Map<string, Note>();
  for (const n of [...ctx.notes, ...ctx.archivedNotes]) {
    if (n.kind !== 'file') continue;
    const key = `n:${n.id}`;
    noteFiles.set(key, n);
    if (!noteFilesHere.has(n.id) && (await getImage(`noteFile_${n.id}`))) noteFilesHere.add(n.id);
    if (noteFilesHere.has(n.id)) {
      have.add(key);
      uploadable.set(key, 'note');
    }
  }
  // Imágenes propias (1.9.2): la referencia viaja con la cuenta; la imagen, por aquí.
  const images = new Map<string, ImageRef>();
  for (const ref of readImageRefs(ctx.uid)) {
    if (ref.kind !== 'own' || !ref.h || !isEntityImageKey(ref.id)) continue;
    const key = imageItemKey(ref);
    images.set(key, ref);
    if (!imagesHere.has(key)) {
      const local = await getImageRecord(ref.id).catch(() => null);
      if (local && (await fingerprint(local.dataUrl)) === ref.h) imagesHere.add(key);
    }
    if (imagesHere.has(key)) {
      have.add(key);
      uploadable.set(key, 'image');
    }
  }
  const declined = updateDeclined(new Set(state.known), have, new Set(state.declined));
  return {
    view: { deviceId, now: Date.now(), have, declined, keep, uploadable },
    songsByKey,
    attachments,
    noteFiles,
    images,
    uid: ctx.uid,
  };
}

// ------------------------------------------------------------
// Estado del relevo en este equipo (por cuenta de Frame)
// ------------------------------------------------------------

interface RelayState {
  /** Lo que había aquí al terminar la vuelta anterior. */
  known: string[];
  declined: string[];
  /** Fijados a mano para que queden en Drive. */
  pins: string[];
}

const stateName = (userTag: string) => `state:${userTag}`;
const readState = (userTag: string) => extRead<RelayState>(WIRE, stateName(userTag), { known: [], declined: [], pins: [] });

let currentUserTag: string | null = null;

/** Fija (o suelta) un objeto del relevo: fijado, queda en Drive para siempre. */
export function togglePin(key: string) {
  if (!currentUserTag) return;
  const state = readState(currentUserTag);
  const pins = new Set(state.pins);
  if (pins.has(key)) pins.delete(key);
  else pins.add(key);
  extWrite(WIRE, stateName(currentUserTag), { ...state, pins: [...pins] });
  patch({ items: status.items.map((i) => (i.key === key ? { ...i, pinned: pins.has(key) } : i)) });
  requestWireCycle();
}

// ------------------------------------------------------------
// Drive: carpeta, fichas y objetos
// ------------------------------------------------------------

async function ensureRoot(drive: Drive, userTag: string): Promise<string> {
  const saved = extRead<{ id: string; user: string } | null>(WIRE, 'root', null);
  if (saved?.user === userTag) return saved.id;
  const found = await drive.list(`mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='frameWire' and value='root' } and appProperties has { key='user' and value='${userTag}' }`);
  const root = found.sort((a, b) => a.created - b.created)[0] ?? (await drive.createFolder(ROOT_NAME, { frameWire: 'root', user: userTag }));
  extWrite(WIRE, 'root', { id: root.id, user: userTag });
  return root.id;
}

const deviceCache = new Map<string, { modified: number; record: DeviceRecord }>();

async function readDevices(drive: Drive, files: DriveFile[]): Promise<{ records: DeviceRecord[]; fileOf: Map<string, string> }> {
  const records: DeviceRecord[] = [];
  const fileOf = new Map<string, string>();
  for (const file of files) {
    const cached = deviceCache.get(file.id);
    let record = cached && cached.modified === file.modified ? cached.record : null;
    if (!record) {
      try {
        const parsed = JSON.parse(await (await drive.download(file.id)).text());
        if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.have)) {
          record = {
            id: parsed.id,
            name: String(parsed.name ?? ''),
            lastSeen: Number(parsed.lastSeen) || file.modified,
            have: parsed.have,
            declined: Array.isArray(parsed.declined) ? parsed.declined : [],
            keep: Array.isArray(parsed.keep) ? parsed.keep : [],
          };
          deviceCache.set(file.id, { modified: file.modified, record });
        }
      } catch {
        /* ficha ilegible o a medio escribir: se lee en la próxima vuelta */
      }
    }
    if (record) {
      records.push(record);
      fileOf.set(record.id, file.id);
    }
  }
  return { records, fileOf };
}

const toItem = (file: DriveFile): RelayItem | null => {
  const p = file.appProperties;
  if (p.frameWire !== 'item' || !p.key || !p.from) return null;
  const kind = p.kind === 'song' || p.kind === 'attachment' || p.kind === 'note' || p.kind === 'image' ? p.kind : null;
  if (!kind) return null;
  return { id: file.id, key: p.key, kind, from: p.from, permanent: p.permanent === '1', created: file.created, name: file.name, size: file.size };
};

/** Nombre legible para Drive (sin caracteres que Windows no admite). */
const safeName = (text: string) => text.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'archivo';
const extOf = (fileName: string) => (/\.[a-z0-9]{1,5}$/i.exec(fileName)?.[0] ?? '').toLowerCase();

interface SongMeta {
  format: 1;
  title: string;
  artist: string;
  album: string;
  picture: string;
  fileName: string;
  duration?: number;
  isFavorite?: boolean;
  lyrics?: SongLyrics | null;
}

// ------------------------------------------------------------
// La vuelta
// ------------------------------------------------------------

let running = false;
let again = false;
let stopped = false;
let latest: WireContext | null = null;
let timer: number | undefined;

/** Pide una vuelta pronto (al cambiar la biblioteca, al fijar algo…). */
export function requestWireCycle(delay = 1500) {
  if (!latest) return;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void runWireCycle(latest!), delay);
}

export async function runWireCycle(ctx: WireContext): Promise<void> {
  latest = ctx;
  if (!wireConnection() || stopped) {
    patch({ phase: 'off' });
    return;
  }
  if (running) {
    again = true;
    return;
  }
  running = true;
  patch({ phase: 'syncing', error: null });
  try {
    const { moved, pending } = await cycle(ctx);
    patch({ phase: 'idle', lastSync: Date.now(), transfer: null });
    if (moved > 0) {
      // Algo viajó: que los otros equipos abiertos den su vuelta ya (uno baja lo
      // que este subió; el que lo subió lo quita de Drive cuando todos lo tienen).
      sendPeerMessage({ t: 'wire' });
      // Y si quedó cola (el tope por vuelta), se sigue enseguida.
      if (pending > 0) requestWireCycle(2000);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    patch({ phase: 'error', error: message, transfer: null });
    note('error', message);
  } finally {
    running = false;
    if (again) {
      again = false;
      requestWireCycle(500);
    }
  }
}

/** Una vuelta. Devuelve cuánto viajó (subidas y bajadas) y cuánto queda en cola. */
async function cycle(ctx: WireContext): Promise<{ moved: number; pending: number }> {
  const drive = new Drive(accessToken);
  const me = await device();
  const userTag = (await hash(`frame-user:${ctx.uid}`)).slice(0, 16);
  currentUserTag = userTag;
  const state = readState(userTag);
  const root = await ensureRoot(drive, userTag);
  const files = await drive.list(`'${root}' in parents`);
  const deviceFiles = files.filter((f) => f.appProperties.frameWire === 'device');
  const items = files.map(toItem).filter((i): i is RelayItem => !!i);
  // Fichas de datos de canciones: una por clave (la más nueva). Las que se
  // quedaron sin canción (una subida que se cortó) o repetidas, fuera tras una hora.
  const metas = new Map<string, DriveFile>();
  const metaFiles = files.filter((f) => f.appProperties.frameWire === 'meta').sort((a, b) => b.created - a.created);
  for (const meta of metaFiles) {
    const key = meta.appProperties.key;
    const orphan = metas.has(key) || !items.some((i) => i.key === key);
    if (!orphan) metas.set(key, meta);
    else if (Date.now() - meta.created > 60 * 60 * 1000) await drive.remove(meta.id);
  }
  const { records, fileOf } = await readDevices(drive, deviceFiles.filter((f) => f.appProperties.device !== me.id));
  const inv = await inventory(ctx, me.id, state);
  // Una imagen que ya cambió (o se quitó) no se baja: cuenta como «la tengo»
  // para que salga de Drive en cuanto todos digan lo mismo.
  for (const item of items) if (item.kind === 'image' && !inv.images.has(item.key)) inv.view.have.add(item.key);
  const plan = planCycle(inv.view, records, items);
  const names = new Map(records.map((r) => [r.id, r.name]));
  names.set(me.id, me.name);

  // 1. Equipos que llevan más de una semana sin aparecer: dejan de esperarse.
  for (const gone of plan.dropDevices) {
    const id = fileOf.get(gone.id);
    if (id) await drive.remove(id);
    note('info', tr('«{name}» lleva más de una semana sin conectarse: ya no se le espera.', { name: gone.name }));
  }

  // 2. Para siempre (corazón o fijado), o ya no.
  for (const { item, permanent } of plan.setPermanent) {
    await drive.setProperties(item.id, { permanent: permanent ? '1' : '0' });
    item.permanent = permanent;
  }

  // 3. Lo que ya tienen todos sale de Drive: del todo si sus bytes siguen en
  //    algún equipo (así deja de ocupar espacio en el acto); a la papelera de
  //    Drive si ya nadie lo tiene (ver plan.ts).
  const removed = new Set<string>();
  const forGood = new Set(plan.purge.map((item) => item.id));
  for (const item of plan.remove) {
    const drop = (id: string) => (forGood.has(item.id) ? drive.remove(id) : drive.trash(id));
    await drop(item.id);
    const meta = metas.get(item.key);
    if (meta && !items.some((other) => other.key === item.key && other.id !== item.id && !plan.remove.includes(other))) await drop(meta.id);
    removed.add(item.id);
    note('remove', tr('«{name}» ya está en todos tus equipos: salió de Drive.', { name: item.name }));
  }

  // 4. Bajar lo que falta aquí.
  let transfers = 0;
  let bytes = 0;
  let moved = 0;
  const arrived: Song[] = [];
  for (const item of plan.download) {
    if (transfers >= MAX_TRANSFERS || bytes + item.size > MAX_BYTES) break;
    if (item.size > MAX_FILE) continue;
    patch({ transfer: { name: item.name, direction: 'down' } });
    const ok = await receive(drive, item, metas, inv, ctx, arrived);
    if (ok) {
      inv.view.have.add(item.key);
      transfers++;
      bytes += item.size;
      note('down', tr('«{name}» llegó de {device}.', { name: item.name, device: names.get(item.from) ?? tr('otro equipo') }));
    }
  }
  moved += transfers;
  if (arrived.length > 0) await ctx.addSongs(arrived);
  // Que el verificador y los avisos dejen de decir que la imagen es de otro equipo.
  if (plan.download.some((i) => i.kind === 'image' && inv.view.have.has(i.key))) await reconcileImageRefs(ctx.uid).catch(() => undefined);
  // Un adjunto o un archivo de recurso que llegó ya no falta: que el verificador lo vea ahora.
  if (plan.download.some((i) => (i.kind === 'attachment' || i.kind === 'note') && inv.view.have.has(i.key))) window.dispatchEvent(new Event(SYNC_RECHECK_EVENT));

  // 5. Subir lo que otro equipo no tiene (o lo que va para siempre).
  transfers = 0;
  bytes = 0;
  const uploaded: RelayItem[] = [];
  for (const job of plan.upload) {
    if (transfers >= MAX_TRANSFERS || bytes >= MAX_BYTES) break;
    const sent = await send(drive, root, userTag, me.id, job, inv);
    if (sent) {
      uploaded.push(sent);
      transfers++;
      bytes += sent.size;
      note('up', tr('«{name}» subió a Drive.', { name: sent.name }));
    }
  }
  moved += uploaded.length;

  // 6. La ficha de este equipo.
  const have = [...inv.view.have].sort();
  const record: DeviceRecord = {
    id: me.id,
    name: me.name,
    lastSeen: Date.now(),
    have,
    declined: [...inv.view.declined].sort(),
    keep: [...inv.view.keep].sort(),
  };
  await writeOwnRecord(drive, root, userTag, record, deviceFiles.find((f) => f.appProperties.device === me.id));
  extWrite(WIRE, stateName(userTag), { known: have, declined: record.declined, pins: state.pins } satisfies RelayState);

  // 7. La vista.
  const live = [...items.filter((i) => !removed.has(i.id)), ...uploaded];
  const after = planCycle(inv.view, records, live);
  const pins = new Set(state.pins);
  patch({
    shareable: {
      songs: inv.songsByKey.size,
      files: [...inv.view.uploadable.values()].filter((k) => k !== 'song').length,
    },
    pendingUp: after.upload.length,
    pendingDown: after.download.length,
    items: live
      .sort((a, b) => b.created - a.created)
      .map((i) => ({
        id: i.id,
        key: i.key,
        kind: i.kind,
        name: i.name,
        size: i.size,
        fromName: names.get(i.from) ?? tr('otro equipo'),
        permanent: after.setPermanent.find((s) => s.item.id === i.id)?.permanent ?? i.permanent,
        waiting: (after.waitingFor.get(i.id) ?? []).map((id) => names.get(id) ?? id),
        pinned: pins.has(i.key),
      })),
    devices: [
      { id: me.id, name: me.name, lastSeen: Date.now(), self: true, active: true },
      ...records.map((r) => ({ id: r.id, name: r.name, lastSeen: r.lastSeen, self: false, active: Date.now() - r.lastSeen <= WEEK_MS })),
    ],
  });
  return { moved, pending: after.upload.length + after.download.length };
}

async function writeOwnRecord(drive: Drive, root: string, userTag: string, record: DeviceRecord, existing: DriveFile | undefined) {
  if (stopped || !wireConnection()) return;
  const body = new Blob([JSON.stringify({ ...record, version: 1 })], { type: 'application/json' });
  const lastWritten = extRead<{ digest: string; at: number } | null>(WIRE, 'lastRecord', null);
  const digest = await hash(JSON.stringify({ ...record, lastSeen: 0 }));
  const fresh = existing && lastWritten?.digest === digest && Date.now() - lastWritten.at < HEARTBEAT_MS;
  if (fresh) return;
  const file = existing
    ? await drive.replace(existing.id, body, 'application/json')
    : await drive.upload(
        { name: `Equipo · ${safeName(record.name)}.json`, parents: [root], mimeType: 'application/json', appProperties: { frameWire: 'device', device: record.id, user: userTag } },
        body
      );
  extWrite(WIRE, 'deviceFile', file.id);
  extWrite(WIRE, 'lastRecord', { digest, at: Date.now() });
}

/** Trae un objeto del relevo y lo mete en Frame. false si aún no se puede. */
async function receive(drive: Drive, item: RelayItem, metas: Map<string, DriveFile>, inv: Inventory, ctx: WireContext, arrived: Song[]): Promise<boolean> {
  try {
    if (item.kind === 'song') {
      const metaFile = metas.get(item.key);
      if (!metaFile) return false;
      const meta = JSON.parse(await (await drive.download(metaFile.id)).text()) as SongMeta;
      const blob = await drive.download(item.id);
      const taken = new Set([...ctx.songs, ...arrived].map((s) => s.fileName.toLowerCase()));
      let fileName = meta.fileName || item.name;
      for (let n = 2; taken.has(fileName.toLowerCase()); n++) fileName = `${meta.fileName.replace(/(\.[^.]+)?$/, ` (${n})$1`)}`;
      const song: Song = {
        id: crypto.randomUUID(),
        title: meta.title,
        artist: meta.artist,
        album: meta.album ?? '',
        picture: meta.picture ?? '',
        fileName,
        ...(meta.duration ? { duration: meta.duration } : {}),
        ...(meta.isFavorite ? { isFavorite: true } : {}),
        owner: ctx.uid,
      };
      await addSongFileToDB(song.id, new File([blob], fileName, { type: blob.type || 'audio/mpeg' }));
      if (meta.lyrics) await importLyrics(song.id, meta.lyrics).catch(() => undefined);
      arrived.push(song);
      return true;
    }
    if (item.kind === 'image') {
      const [, imageKey, h] = parseImageKey(item.key) ?? [];
      const current = imageKey ? readImageRefs(ctx.uid).find((r) => r.id === imageKey) : undefined;
      if (!imageKey || current?.kind !== 'own' || current.h !== h) return false;
      const dataUrl = await blobToDataUrl(await drive.download(item.id));
      if ((await fingerprint(dataUrl)) !== h) return false;
      await saveImage(imageKey, dataUrl, { fromSync: true, at: current.at });
      imagesHere.add(item.key);
      return true;
    }
    const blob = await drive.download(item.id);
    if (item.kind === 'attachment') {
      await storeAttachmentCopy(item.key.slice(2), new File([blob], item.name, { type: blob.type }));
      return true;
    }
    await saveImage(`noteFile_${item.key.slice(2)}`, await blobToDataUrl(blob));
    noteFilesHere.add(item.key.slice(2));
    return true;
  } catch (error) {
    if (error instanceof DriveError && (error.kind === 'auth' || error.kind === 'rate' || error.kind === 'network')) throw error;
    note('error', tr('No se pudo traer «{name}».', { name: item.name }));
    return false;
  }
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Sube un objeto. null si no se pudo leer aquí. */
async function send(
  drive: Drive,
  root: string,
  userTag: string,
  deviceId: string,
  job: { key: string; kind: ItemKind; permanent: boolean },
  inv: Inventory
): Promise<RelayItem | null> {
  const props = { frameWire: 'item', kind: job.kind, key: job.key, from: deviceId, permanent: job.permanent ? '1' : '0', user: userTag };
  let blob: Blob | null = null;
  let name = '';
  if (job.kind === 'song') {
    const song = inv.songsByKey.get(job.key);
    if (!song) return null;
    const file = await getSongFileFromDB(song.id);
    if (!file || file.size > MAX_FILE) return null;
    blob = file;
    name = safeName(`${song.artist && song.artist !== UNKNOWN_ARTIST ? `${song.artist} - ` : ''}${song.title}`) + extOf(song.fileName);
    const meta: SongMeta = {
      format: 1,
      title: song.title,
      artist: song.artist,
      album: song.album,
      picture: song.picture,
      fileName: song.fileName,
      ...(song.duration ? { duration: song.duration } : {}),
      ...(song.isFavorite ? { isFavorite: true } : {}),
      lyrics: await storedLyrics(song.id).catch(() => null),
    };
    patch({ transfer: { name, direction: 'up' } });
    await drive.upload(
      { name: `${name}.frame.json`, parents: [root], mimeType: 'application/json', appProperties: { frameWire: 'meta', key: job.key, user: userTag } },
      new Blob([JSON.stringify(meta)], { type: 'application/json' })
    );
  } else if (job.kind === 'attachment') {
    const resolved = await readAttachment(job.key.slice(2)).catch(() => null);
    if (!resolved || resolved.file.size > MAX_FILE) return null;
    blob = resolved.file;
    name = safeName(resolved.file.name);
  } else if (job.kind === 'image') {
    const ref = inv.images.get(job.key);
    const local = ref ? await getImageRecord(ref.id).catch(() => null) : null;
    if (!ref || !local) return null;
    blob = await (await fetch(local.dataUrl)).blob();
    const entity = entityOfImage(inv.uid, ref.id);
    name = safeName(`${tr('Imagen')} · ${entity?.name ?? ref.id}`) + (blob.type === 'image/png' ? '.png' : blob.type === 'image/webp' ? '.webp' : '.jpg');
  } else {
    const n = inv.noteFiles.get(job.key);
    const dataUrl = n ? await getImage(`noteFile_${n.id}`) : null;
    if (!n || !dataUrl) return null;
    blob = await (await fetch(dataUrl)).blob();
    name = safeName(n.fileName ?? 'archivo');
  }
  patch({ transfer: { name, direction: 'up' } });
  const file = await drive.upload({ name, parents: [root], mimeType: blob.type || 'application/octet-stream', appProperties: props }, blob);
  return { id: file.id, key: job.key, kind: job.kind, from: deviceId, permanent: job.permanent, created: file.created || Date.now(), name: file.name, size: file.size || blob.size };
}
