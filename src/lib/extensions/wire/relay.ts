import { useSyncExternalStore } from 'react';
import { authorizeDrive, refreshGoogleAccess, revokeGoogleToken } from '@/lib/google/auth';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { libraryKeys } from '@/lib/song-keys';
import { getImage, getImageRecord, saveImage } from '@/lib/music-db';
import { entityOfImage, isEntityImageKey, readImageRefs, reconcileImageRefs, type ImageRef } from '@/lib/image-refs';
import { fingerprint } from '@/lib/profile-scope';
import { importLyrics, storedLyrics, type SongLyrics } from '@/lib/lyrics';
import { hasAttachment, readAttachment, storeAttachmentCopy } from '@/lib/file-handles';
import { sendPeerMessage } from '@/lib/sync-peers';
import { SYNC_RECHECK_EVENT } from '@/lib/sync-status';
import { tr } from '@/lib/i18n';
import { UNKNOWN_ARTIST } from '@/lib/enum-labels';
import type { ArchivedNote, ArchivedTask, Note, Song, Task } from '@/types';
import { Drive, DriveError, FOLDER_MIME, type DriveFile } from './drive';
import { audioPresent, deleteSecret, getSecret, readSongFile, setSecret, storeSongFile, thisDeviceName } from './platform';
import { planCycle, WEEK_MS, type DeviceRecord, type ItemKind, type LocalView, type RelayItem } from './plan';
import { forgetAllRemoved, forgetRemovedSongs, removedSongs } from './removed';

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
//
// 1.9.6 (Android 1.3.5): este archivo es el mismo en Windows y en Android; lo
// que cambia de una plataforma a otra está en platform.ts. Y se blinda:
//
//  · «Lo tengo» es tener los BYTES, no la ficha. Una canción cuya ficha quedó
//    sin audio se vuelve a traer y se repara en su sitio.
//  · «Lo rechacé» es algo que pasó, no algo que se deduce de que falte: una
//    canción, porque el usuario la borró aquí (removed.ts); un adjunto, un
//    recurso o una imagen, porque su ficha (que viaja con la cuenta) ya no
//    existe. Perder el almacén de música ya no marca la biblioteca entera como
//    «borrada»: vuelve sola desde los otros equipos.
//  · Cada canción conserva la clave con la que el relevo la vio por primera
//    vez (`ids`): cambiarle el título no la duplica en los demás equipos.
//  · Lo que baja se comprueba (tamaño y huella SHA-256 de Drive) antes de
//    entrar; lo que sube, que Drive lo recibió entero.
//  · La carpeta se busca en cada vuelta: si el usuario la borró, se crea otra;
//    si dos equipos crearon una cada uno, todos acaban en la más antigua.
//  · El tiempo es el de Drive, no el del equipo: un reloj mal puesto no hace
//    que se dé por ausente a nadie.
//  · Sin red no se intenta. Si Google pide ir despacio, se espera cada vez
//    más. Si el Drive se llena, se deja de subir (y se sigue bajando). Si
//    Google retiró el permiso, se deja de insistir y se pide volver a conectar.
//  · El Drive del usuario no se llena: lo que espera en la carpeta tiene tope
//    y siempre se deja espacio libre.
//
// Lo prueba scripts/probar-relevo.mjs: este mismo archivo, con un Drive falso,
// tres equipos y fallos provocados (cortes, 401, 429, 5xx, Drive lleno,
// descargas truncadas, carpeta borrada o repetida, almacén perdido, relojes
// mal puestos, vueltas cortadas a la mitad).
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
/** Hasta este peso, lo que baja se comprueba también con su huella (calcularla lo carga en memoria). */
const VERIFY_HASH_MAX = 64 * 1024 * 1024;
/** Tras un «ve más despacio» o un fallo de Google: 2, 4, 8… minutos, hasta media hora. */
const PAUSE_STEP_MS = 2 * 60_000;
const PAUSE_MAX_MS = 30 * 60_000;
/** Lo que espera en Drive a que lo bajen (sin contar lo que va para siempre) no pasa de aquí. */
const BACKLOG_MAX = 2 * 1024 * 1024 * 1024;
/** Espacio del Drive del usuario que Wire nunca ocupa. */
const DRIVE_RESERVE = 300 * 1024 * 1024;
/** Un objeto que llega mal tres veces seguidas descansa este rato. */
const STUBBORN_REST_MS = 6 * 60 * 60 * 1000;
/** Una ficha de datos sin canción (o repetida) se quita pasado este rato; antes puede ser una subida en curso. */
const ORPHAN_META_MS = 60 * 60 * 1000;
/** Una canción en Drive sin ficha de datos: pasado este rato, quien la tenga se la repone. */
const META_REPAIR_MS = 10 * 60 * 1000;
/** Cortes de red seguidos a partir de los cuales ya se avisa. */
const NETWORK_FAILS_SHOWN = 5;
const HELLO_EVERY_MS = 10 * 60_000;
/**
 * Versión del relevo que escribe cada equipo en su ficha. 1: hasta Frame 1.9.5. 2: desde la
 * 1.9.6 (Android 1.3.5). El de la 1 tenía un fallo al recibir canciones con cola pendiente (las
 * bajaba otra vez, duplicadas): a un equipo así no se le envían canciones hasta que se actualice.
 */
const RELAY_VERSION = 2;

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
  /** Google retiró el permiso (o la llave no se puede leer aquí): hay que volver a conectar Drive. */
  reauth: boolean;
  /** Otro equipo de la cuenta tiene Wire en una cuenta de Drive distinta: no se pasan nada. */
  otherDrive: boolean;
  /** Equipos con una versión de Frame anterior: hasta que se actualicen no se les envían canciones. */
  outdated: string[];
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
  reauth: false,
  otherDrive: false,
  outdated: [],
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
  // El mismo aviso repetido (algo que no sube, vuelta tras vuelta) se anota una vez.
  if (status.log[0]?.kind === kind && status.log[0].text === text) return;
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

/** El relevo está encendido en este equipo (lo dice WireRuntime al montarse y al parar). */
let runtimeOn = false;
export const setWireRuntime = (on: boolean) => {
  runtimeOn = on;
};
/** Este equipo manda y recibe por Wire: encendido, con su Drive conectado y sin que Google haya retirado el permiso. */
export const wireWorking = (): boolean => runtimeOn && !!wireConnection() && !needsReauth;

let access: { token: string; expiresAt: number } | null = null;
/** Google ya no acepta la llave guardada: no se insiste hasta que el usuario vuelva a conectar. */
let needsReauth = false;
/** No se da otra vuelta sola antes de este momento (Google pidió espacio). */
let pausedUntil = 0;
let pauseSteps = 0;
let networkFails = 0;
/** Vueltas seguidas en que algo «ya no estaba» en Drive: dos se reintentan en silencio. */
let vanished = 0;
/** Vueltas seguidas en que Drive no aceptó el acceso: la primera se reintenta en silencio. */
let refused = 0;

const reauthText = () => tr('Google retiró el permiso: vuelve a conectar tu Drive.');

function calm() {
  needsReauth = false;
  pausedUntil = 0;
  pauseSteps = 0;
  networkFails = 0;
  stubborn.clear();
}

async function accessToken(): Promise<string> {
  if (access && access.expiresAt - Date.now() > 60_000) return access.token;
  const refresh = await getSecret(WIRE, SECRET);
  if (!refresh) {
    // No hay llave (o este equipo no puede abrirla): solo se arregla conectando otra vez.
    needsReauth = true;
    throw new DriveError('auth', reauthText());
  }
  try {
    const fresh = await refreshGoogleAccess(refresh);
    access = { token: fresh.accessToken, expiresAt: fresh.expiresAt };
    return fresh.accessToken;
  } catch (error) {
    // invalid_grant: el usuario quitó el permiso en su cuenta de Google (o Google lo caducó).
    if (/invalid_grant|revoked|expired/i.test(String(error instanceof Error ? error.message : error))) {
      needsReauth = true;
      throw new DriveError('auth', reauthText());
    }
    throw new DriveError('network', tr('No se pudo hablar con Google.'));
  }
}

/** Paso 1 al instalar: el usuario elige la cuenta. Aún no se guarda nada. */
export const chooseDriveAccount = (...args: Parameters<typeof authorizeDrive>) => authorizeDrive(...args);

/** Paso 2: el usuario confirmó esa cuenta. También sirve para volver a conectar. */
export async function confirmDriveAccount(grant: Awaited<ReturnType<typeof authorizeDrive>>): Promise<void> {
  const before = wireConnection();
  const sameAccount = !!before && before.email.toLowerCase() === grant.email.toLowerCase();
  // Si aquí no había una llave legible, este equipo es nuevo para el relevo aunque sus datos
  // digan otra cosa (una copia de seguridad restaurada en otro aparato trae la identidad del
  // primero, pero no su llave): identidad nueva, para que dos aparatos nunca compartan una.
  const hadKey = !!(await getSecret(WIRE, SECRET).catch(() => null));
  if (!hadKey) for (const name of ['device', 'deviceFile', 'lastRecord']) extWrite(WIRE, name, null);
  // Otra cuenta de Drive: su carpeta es otra. La de antes no vale aquí.
  if (!sameAccount) for (const name of ['deviceFile', 'root', 'lastRecord']) extWrite(WIRE, name, null);
  // Una conexión nueva empieza de cero: lo borrado antes no es un rechazo. Volver a conectar
  // la misma cuenta (Google retiró el permiso) no lo es: lo borrado mientras tanto sigue borrado.
  if (!(sameAccount && hadKey)) forgetAllRemoved();
  deviceCache.clear();
  recentUploads.clear();
  await setSecret(WIRE, SECRET, grant.refreshToken);
  access = { token: grant.accessToken, expiresAt: grant.expiresAt };
  calm();
  mismatched.clear();
  extWrite(WIRE, 'connection', { email: grant.email, connectedAt: sameAccount && hadKey ? before!.connectedAt : new Date().toISOString() } satisfies WireConnection);
  await device();
  patch({ account: grant.email, phase: 'idle', error: null, reauth: false, otherDrive: false });
  note('info', tr('Conectado a Google Drive ({email}).', { email: grant.email }));
  lastHello = 0;
}

/** Sale del relevo: quita la ficha de este equipo, retira el permiso y borra la llave. */
export async function disconnectWire(): Promise<void> {
  stopped = true;
  try {
    const own = extRead<string | null>(WIRE, 'deviceFile', null);
    if (own && !needsReauth) await new Drive(accessToken).remove(own);
  } catch {
    /* sin red: los demás dejarán de esperarlo en una semana */
  }
  const refresh = await getSecret(WIRE, SECRET).catch(() => null);
  if (refresh) await revokeGoogleToken(refresh).catch(() => undefined);
  await deleteSecret(WIRE, SECRET).catch(() => undefined);
  access = null;
  calm();
  mismatched.clear();
  for (const name of ['connection', 'deviceFile', 'root', 'lastRecord']) extWrite(WIRE, name, null);
  deviceCache.clear();
  recentUploads.clear();
  patch({ phase: 'off', account: null, items: [], devices: [], pendingDown: 0, pendingUp: 0, transfer: null, error: null, reauth: false, otherDrive: false, outdated: [] });
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
  if (saved && typeof saved.id === 'string' && saved.id) return saved;
  const created = { id: crypto.randomUUID(), name: (await thisDeviceName().catch(() => '')) || 'Frame' };
  extWrite(WIRE, 'device', created);
  return created;
}

export function renameDevice(name: string) {
  const current = extRead<DeviceIdentity | null>(WIRE, 'device', null);
  if (current && name.trim()) extWrite(WIRE, 'device', { ...current, name: name.trim().slice(0, 40) });
}

export const deviceName = () => extRead<DeviceIdentity | null>(WIRE, 'device', null)?.name ?? null;

// ------------------------------------------------------------
// El tiempo es el de Drive
// ------------------------------------------------------------

/**
 * Cuánto adelanta Drive al reloj de este equipo. Se mide cada vez que Drive
 * recibe la ficha del equipo (devuelve su hora). null: aún sin medir en esta
 * sesión. No se guarda: el reloj del equipo puede haberse corregido entre medias.
 */
let clockOffset: number | null = null;
const driveNow = () => Date.now() + (clockOffset ?? 0);

/** Si el reloj del equipo dio un salto (lo cambiaron a mano), la medida ya no vale. */
let tick: { wall: number; steady: number } | null = null;
function watchClock() {
  const steady = typeof performance !== 'undefined' ? performance.now() : 0;
  const wall = Date.now();
  if (tick && Math.abs(wall - tick.wall - (steady - tick.steady)) > 60_000) clockOffset = null;
  tick = { wall, steady };
}

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
  if (hashes.size > 20_000) hashes.clear();
  hashes.set(text, hex);
  return hex;
}

/** La huella SHA-256 de un archivo, como la da Drive. */
async function sha256Of(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Archivos de recursos que ya se vio que están aquí (leerlos para saberlo cuesta). */
const noteFilesHere = new Set<string>();
/** Imágenes propias (clave con su huella) que ya se vio que están aquí. */
const imagesHere = new Set<string>();

/** «i:<clave de la imagen>:<huella>»: si la imagen cambia, es otra. */
const imageItemKey = (ref: ImageRef) => `i:${ref.id}:${ref.h}`;
const parseImageKey = (key: string) => /^i:(.+):([^:]+)$/.exec(key);

const SONG = 's:';
/** El separador de song-keys.ts: título, artista y, en las copias, su número. */
const PART = '\u001f';
const isSongItem = (key: string) => key.startsWith(SONG);

interface Inventory {
  view: LocalView;
  songsByKey: Map<string, Song>;
  /** Canciones cuya ficha está aquí pero su audio no: si llega, se repara en su sitio. */
  silent: Map<string, Song>;
  /** La clave con la que viaja cada canción de aquí. */
  ids: Record<string, string>;
  attachments: Map<string, { taskName: string }>;
  noteFiles: Map<string, Note>;
  images: Map<string, ImageRef>;
  /** Borrados del usuario ya recogidos en `view.declined`. */
  consumed: Set<string>;
  uid: string;
}

async function inventory(ctx: WireContext, deviceId: string, state: RelayState): Promise<Inventory> {
  const have = new Set<string>();
  const keep = new Set<string>(state.pins);
  const uploadable = new Map<string, ItemKind>();
  const songsByKey = new Map<string, Song>();
  const silent = new Map<string, Song>();
  const ids: Record<string, string> = {};
  const natural = libraryKeys(ctx.songs);
  // Qué canciones tienen su audio aquí. Si no se puede saber, se dan todas por completas:
  // antes no pedir nada que pedir la biblioteca entera por un fallo de lectura.
  const present = await audioPresent(ctx.songs).catch(() => null);

  // La clave de cada canción. 1.º, la que ya tenía: no cambia aunque cambie su título.
  const taken = new Set<string>();
  for (const song of ctx.songs) {
    const sticky = state.ids[song.id];
    if (!sticky || taken.has(sticky)) continue;
    ids[song.id] = sticky;
    taken.add(sticky);
  }
  // 2.º, las nuevas: la de su título y artista (song-keys.ts), si está libre.
  const crowded: Song[] = [];
  for (const song of ctx.songs) {
    if (ids[song.id]) continue;
    const key = `${SONG}${await hash(natural[song.id] ?? song.id)}`;
    if (taken.has(key)) {
      crowded.push(song);
      continue;
    }
    ids[song.id] = key;
    taken.add(key);
  }
  // 3.º, si otra canción de aquí ya lleva esa: la primera copia libre.
  for (const song of crowded) {
    const base = (natural[song.id] ?? song.id).split(PART).slice(0, 2).join(PART);
    for (let n = 1; n <= 40 && !ids[song.id]; n++) {
      const key = `${SONG}${await hash(n === 1 ? base : `${base}${PART}${n}`)}`;
      if (taken.has(key)) continue;
      ids[song.id] = key;
      taken.add(key);
    }
  }
  for (const song of ctx.songs) {
    const key = ids[song.id];
    if (!key) continue;
    if (song.isFavorite) keep.add(key);
    if (present && !present.has(song.id)) {
      silent.set(key, song);
      continue;
    }
    have.add(key);
    uploadable.set(key, 'song');
    songsByKey.set(key, song);
  }

  const attachments = new Map<string, { taskName: string }>();
  for (const task of [...ctx.tasks, ...ctx.archivedTasks, ...ctx.incompleteTasks]) {
    for (const a of task.attachments ?? []) {
      if (a.kind !== 'file') continue;
      const key = `a:${a.id}`;
      attachments.set(key, { taskName: task.name });
      if (await hasAttachment(a.id).catch(() => false)) {
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
    if (!noteFilesHere.has(n.id) && (await getImage(`noteFile_${n.id}`).catch(() => null))) noteFilesHere.add(n.id);
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

  // Lo rechazado: solo lo que consta.
  const recordHere = (key: string) =>
    key.startsWith('a:') ? attachments.has(key) : key.startsWith('n:') ? noteFiles.has(key) : key.startsWith('i:') ? images.has(key) : true;
  const declined = new Set(state.declined);
  // Canciones: las que el usuario borró aquí con Wire conectado (removed.ts).
  const here = new Set(ctx.songs.map((song) => song.id));
  const consumed = new Set<string>();
  for (const entry of removedSongs(ctx.uid)) {
    consumed.add(entry.id);
    if (here.has(entry.id)) continue;
    declined.add(state.ids[entry.id] ?? `${SONG}${await hash(entry.key)}`);
  }
  // Una sola vez, al llegar de una versión que aún deducía los borrados: lo que estaba y ya no está.
  if (state.legacy) for (const key of state.known) if (isSongItem(key) && !taken.has(key)) declined.add(key);
  // Adjuntos, recursos e imágenes: su ficha viaja con la cuenta; si ya no existe, no se esperan.
  for (const key of state.known) if (!isSongItem(key) && !recordHere(key)) declined.add(key);
  // Y lo que vuelve a estar (o vuelve a tener ficha) deja de estar rechazado.
  for (const key of [...declined]) {
    if (isSongItem(key) ? taken.has(key) : have.has(key) || recordHere(key)) declined.delete(key);
  }

  return {
    view: { deviceId, now: driveNow(), have, declined, keep, uploadable },
    songsByKey,
    silent,
    ids,
    attachments,
    noteFiles,
    images,
    consumed,
    uid: ctx.uid,
  };
}

// ------------------------------------------------------------
// Estado del relevo en este equipo (por cuenta de Frame)
// ------------------------------------------------------------

interface SavedState {
  /** De lo que no es canción, lo que había aquí al terminar la vuelta anterior. */
  known: string[];
  declined: string[];
  /** Fijados a mano para que queden en Drive. */
  pins: string[];
  /** Id de canción de aquí → la clave con la que viaja. */
  ids: Record<string, string>;
}

interface RelayState extends SavedState {
  /** El estado lo escribió una versión anterior a la 1.9.6 (deducía los borrados). */
  legacy: boolean;
}

const stateName = (userTag: string) => `state:${userTag}`;
/** La marca de la cuenta de Frame en la carpeta y en el estado (un resumen de su id, no el id). */
const userTagOf = async (uid: string) => (await hash(`frame-user:${uid}`)).slice(0, 16);

function readState(userTag: string): RelayState {
  const raw = extRead<Partial<SavedState> | null>(WIRE, stateName(userTag), null);
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
  const ids: Record<string, string> = {};
  const savedIds = raw && typeof raw === 'object' ? raw.ids : undefined;
  if (savedIds && typeof savedIds === 'object') {
    for (const [id, key] of Object.entries(savedIds)) if (typeof key === 'string') ids[id] = key;
  }
  return {
    known: strings(raw?.known),
    declined: strings(raw?.declined),
    pins: strings(raw?.pins),
    ids,
    legacy: !!raw && typeof raw === 'object' && savedIds === undefined,
  };
}

/** Guarda el estado. false si el almacenamiento no lo aceptó (lleno): nada debe darse por anotado. */
function writeState(userTag: string, next: SavedState): boolean {
  const text = JSON.stringify(next);
  extWrite(WIRE, stateName(userTag), next);
  return JSON.stringify(extRead<unknown>(WIRE, stateName(userTag), null)) === text;
}

let currentUserTag: string | null = null;

/**
 * De estas canciones (por la clave que dejan en una playlist, song-keys.ts), las que el usuario BORRÓ en este
 * equipo. Para el verificador de sincronización (1.9.9): no le «faltan», las quitó él, y el relevo no se las
 * vuelve a traer. Hasta la 1.9.8 contaban como pendientes para siempre y «Corregir» no podía arreglarlo.
 */
export async function songsDeclinedHere(uid: string, keys: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  if (keys.length === 0 || !wireConnection()) return out;
  // Lo recién borrado (aún sin recoger por el relevo) y lo que su estado ya tiene por rechazado.
  const fresh = new Set(removedSongs(uid).map((entry) => entry.key));
  const declined = new Set(readState(await userTagOf(uid)).declined);
  for (const key of keys) if (fresh.has(key) || declined.has(`${SONG}${await hash(key)}`)) out.add(key);
  return out;
}

/** Fija (o suelta) un objeto del relevo: fijado, queda en Drive para siempre. */
export function togglePin(key: string) {
  if (!currentUserTag) return;
  const { legacy: _legacy, ...state } = readState(currentUserTag);
  const pins = new Set(state.pins);
  if (pins.has(key)) pins.delete(key);
  else pins.add(key);
  // Un estado antiguo sigue siéndolo hasta su primera vuelta: sin `ids` mientras tanto.
  extWrite(WIRE, stateName(currentUserTag), _legacy ? { known: state.known, declined: state.declined, pins: [...pins] } : { ...state, pins: [...pins] });
  patch({ items: status.items.map((i) => (i.key === key ? { ...i, pinned: pins.has(key) } : i)) });
  requestWireCycle();
}

// ------------------------------------------------------------
// Drive: carpeta, fichas y objetos
// ------------------------------------------------------------

interface SavedRoot {
  id: string;
  user: string;
}

/** Los fallos que no son de un objeto sino de la conexión: cortan la vuelta. */
const breaksCycle = (error: unknown) => error instanceof DriveError && (error.kind === 'auth' || error.kind === 'rate' || error.kind === 'network' || error.kind === 'server');

/**
 * La carpeta del relevo de esta cuenta de Frame en este Drive. Se busca en cada
 * vuelta, no se da por sabida: el usuario pudo borrarla, y dos equipos que
 * conectaron a la vez pudieron crear una cada uno. Manda la más antigua.
 */
async function resolveRoot(drive: Drive, userTag: string, deviceId: string): Promise<string> {
  const saved = extRead<SavedRoot | null>(WIRE, 'root', null);
  const mine = saved && saved.user === userTag && typeof saved.id === 'string' ? saved : null;
  const isRoot = (f: DriveFile) => f.mimeType === FOLDER_MIME && f.appProperties.frameWire === 'root' && f.appProperties.user === userTag;
  const found = (
    await drive.list(`mimeType = '${FOLDER_MIME}' and appProperties has { key='frameWire' and value='root' } and appProperties has { key='user' and value='${userTag}' }`)
  ).filter(isRoot);
  // La que este equipo ya usaba puede no salir aún en la búsqueda (Drive tarda con lo recién
  // creado): se pregunta por ella directamente antes de darla por perdida.
  if (mine && !found.some((f) => f.id === mine.id)) {
    const still = await drive.get(mine.id);
    if (still && isRoot(still)) found.push(still);
  }
  found.sort((a, b) => a.created - b.created || a.id.localeCompare(b.id));
  let root = found[0];
  if (!root) {
    root = await drive.createFolder(ROOT_NAME, { frameWire: 'root', user: userTag });
    if (mine) note('info', tr('La carpeta «Frame · Wire» ya no estaba en tu Drive: se creó de nuevo.'));
  }
  if (mine?.id !== root.id) {
    extWrite(WIRE, 'root', { id: root.id, user: userTag } satisfies SavedRoot);
    extWrite(WIRE, 'lastRecord', null);
    extWrite(WIRE, 'deviceFile', null);
    deviceCache.clear();
    recentUploads.clear();
  }
  // Carpetas de más: de cada una, este equipo retira lo suyo; vacía (o abandonada), se borra.
  for (const stray of found.slice(1)) {
    await leaveStrayRoot(drive, stray.id, deviceId).catch((error) => {
      if (breaksCycle(error)) throw error;
    });
  }
  return root.id;
}

async function leaveStrayRoot(drive: Drive, strayId: string, deviceId: string): Promise<void> {
  const children = await drive.list(`'${strayId}' in parents`);
  const latest = children.reduce((max, f) => Math.max(max, f.created, f.modified), 0);
  // Nadie la toca desde hace más de una semana: lo que quede ya no lo espera nadie.
  if (children.length === 0 || (clockOffset !== null && driveNow() - latest > WEEK_MS)) {
    await drive.remove(strayId);
    return;
  }
  const ownItems = children.filter((f) => f.appProperties.frameWire === 'item' && f.appProperties.from === deviceId);
  const usedByOthers = new Set(children.filter((f) => f.appProperties.frameWire === 'item' && f.appProperties.from !== deviceId).map((f) => f.appProperties.key));
  const ownKeys = new Set(ownItems.map((f) => f.appProperties.key));
  // Lo de este equipo, y las fichas de datos que ya no acompañan a ninguna canción de otro: las
  // suyas, y las que dejó una subida cortada (estas, solo si ya son viejas: una reciente puede
  // ser de una canción que otro equipo está subiendo y que la lista aún no enseña).
  const stale = (f: DriveFile) => clockOffset !== null && driveNow() - f.created > ORPHAN_META_MS;
  const doomed = children.filter(
    (f) =>
      ownItems.includes(f) ||
      (f.appProperties.frameWire === 'device' && f.appProperties.device === deviceId) ||
      (f.appProperties.frameWire === 'meta' && !usedByOthers.has(f.appProperties.key) && (ownKeys.has(f.appProperties.key) || stale(f)))
  );
  for (const file of doomed) await drive.remove(file.id);
  if (doomed.length === children.length) await drive.remove(strayId);
}

const deviceCache = new Map<string, { modified: number; record: DeviceRecord; version: number }>();

async function readDevices(drive: Drive, files: DriveFile[]): Promise<{ records: DeviceRecord[]; fileOf: Map<string, string>; versions: Map<string, number> }> {
  const records: DeviceRecord[] = [];
  const fileOf = new Map<string, string>();
  const versions = new Map<string, number>();
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
  for (const file of files) {
    const cached = deviceCache.get(file.id);
    let record = cached && cached.modified === file.modified ? cached.record : null;
    let version = cached?.version ?? 1;
    if (!record) {
      try {
        const parsed = JSON.parse(await (await drive.download(file.id)).text());
        if (parsed && typeof parsed.id === 'string' && Array.isArray(parsed.have)) {
          record = {
            id: parsed.id,
            name: String(parsed.name ?? ''),
            // Cuándo lo dice Drive (su hora), no el reloj de aquel equipo.
            lastSeen: file.modified || Number(parsed.lastSeen) || 0,
            have: strings(parsed.have),
            declined: strings(parsed.declined),
            keep: strings(parsed.keep),
          };
          version = Number(parsed.version) || 1;
          deviceCache.set(file.id, { modified: file.modified, record, version });
        }
      } catch (error) {
        // Sin conexión no se decide nada con la mitad de las fichas: la vuelta se corta.
        if (breaksCycle(error)) throw error;
        /* ficha ilegible o a medio escribir: se lee en la próxima vuelta */
      }
    }
    if (!record) continue;
    // Dos fichas del mismo equipo (una subida que se repitió): vale la más reciente.
    const twin = records.findIndex((other) => other.id === record.id);
    if (twin >= 0) {
      if (records[twin].lastSeen >= record.lastSeen) continue;
      records.splice(twin, 1);
    }
    records.push(record);
    fileOf.set(record.id, file.id);
    versions.set(record.id, version);
  }
  return { records, fileOf, versions };
}

const toItem = (file: DriveFile): RelayItem | null => {
  const p = file.appProperties;
  if (p.frameWire !== 'item' || !p.key || !p.from) return null;
  const kind = p.kind === 'song' || p.kind === 'attachment' || p.kind === 'note' || p.kind === 'image' ? p.kind : null;
  if (!kind) return null;
  return {
    id: file.id,
    key: p.key,
    kind,
    from: p.from,
    permanent: p.permanent === '1',
    created: file.created,
    name: file.name,
    size: file.size,
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
  };
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

/** Cómo se llama en Drive el audio de una canción. */
const songDriveName = (song: Song) => safeName(`${song.artist && song.artist !== UNKNOWN_ARTIST ? `${song.artist} - ` : ''}${song.title}`) + extOf(song.fileName);

/** Sube la ficha de datos de una canción (lo que el audio no dice: portada, letra, nombre de archivo…). */
async function uploadSongMeta(drive: Drive, root: string, userTag: string, key: string, song: Song): Promise<DriveFile> {
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
  return drive.upload(
    { name: `${songDriveName(song)}.frame.json`, parents: [root], mimeType: 'application/json', appProperties: { frameWire: 'meta', key, user: userTag } },
    new Blob([JSON.stringify(meta)], { type: 'application/json' })
  );
}

/** Sin ficha de datos y sin nadie que la reponga: lo que se sabe de la canción es el nombre de su archivo en Drive. */
function metaFromName(name: string): Partial<SongMeta> {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, '');
  const cut = base.indexOf(' - ');
  return cut > 0 ? { artist: base.slice(0, cut), title: base.slice(cut + 3), fileName: name } : { title: base, fileName: name };
}

// ------------------------------------------------------------
// Equipos de la misma cuenta con Drive distinto
// ------------------------------------------------------------

/** Resumen de la cuenta de Drive de este equipo (no dice cuál es). */
let driveTag: string | null = null;
let selfId: string | null = null;
let lastHello = 0;
/** Equipos de la cuenta que dijeron tener Wire en otro Drive. */
const mismatched = new Set<string>();

function hello(now = false) {
  if (!driveTag || !selfId) return;
  if (!now && Math.abs(Date.now() - lastHello) < HELLO_EVERY_MS) return;
  lastHello = Date.now();
  sendPeerMessage({ t: 'wire', d: driveTag, from: selfId });
}

/**
 * Otro equipo de la cuenta dio señales de Wire (WireRuntime lo pasa aquí). Si
 * su Drive es otro, nunca se van a pasar nada, y sin este aviso nadie lo sabría.
 */
export function noteWirePeer(message: Record<string, unknown>) {
  const { d, from } = message;
  if (typeof d !== 'string' || typeof from !== 'string' || !driveTag || from === selfId) return;
  if (d === driveTag) mismatched.delete(from);
  else if (!mismatched.has(from)) {
    mismatched.add(from);
    note('error', tr('Otro de tus equipos tiene Wire en una cuenta de Google Drive distinta: conecta la misma en todos.'));
    // Que el otro también lo sepa.
    hello(true);
  }
  if (status.otherDrive !== mismatched.size > 0) patch({ otherDrive: mismatched.size > 0 });
}

// ------------------------------------------------------------
// La vuelta
// ------------------------------------------------------------

let running = false;
let again = false;
let againForced = false;
let stopped = false;
let latest: WireContext | null = null;
let timer: number | undefined;
let timerForced = false;
/** En esta vuelta, la ficha de este equipo se escribió con otro contenido (no un simple latido). */
let recordChanged = false;
/** Objetos que llegaron mal (por id de Drive): cuántas veces seguidas y hasta cuándo descansan. */
const stubborn = new Map<string, { fails: number; until: number }>();
/**
 * Lo que este equipo acaba de subir (por id de Drive). El buscador de Drive puede tardar en
 * enseñar lo recién creado: durante un rato se da por presente aunque la lista no lo traiga,
 * para no subirlo dos veces.
 */
const recentUploads = new Map<string, { item: RelayItem; at: number }>();
const RECENT_UPLOAD_MS = 60_000;
/** Un reloj que no salta aunque cambien la hora del equipo. */
const steady = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Pide una vuelta pronto (al cambiar la biblioteca, al fijar algo…). Con 0 la
 * pidió el usuario («Sincronizar ahora»): se da aunque se estuviera esperando.
 */
export function requestWireCycle(delay = 1500) {
  if (!latest) return;
  timerForced = timerForced || delay === 0;
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const forced = timerForced;
    timerForced = false;
    if (latest) void runWireCycle(latest, forced);
  }, delay);
}

export async function runWireCycle(ctx: WireContext, forced = false): Promise<void> {
  latest = ctx;
  if (!wireConnection() || stopped) {
    patch({ phase: 'off' });
    return;
  }
  if (running) {
    again = true;
    againForced = againForced || forced;
    return;
  }
  // Google ya dijo que no a la llave: insistir no la cambia. Solo el usuario lo arregla.
  if (needsReauth) {
    patch({ phase: 'error', reauth: true, error: reauthText(), transfer: null });
    return;
  }
  // Sin red no se intenta (ni se cuenta como fallo): la siguiente vuelta llega sola.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  // Un reloj que retrocede no puede alargar la espera.
  if (pausedUntil - Date.now() > PAUSE_MAX_MS) pausedUntil = 0;
  if (forced) {
    pausedUntil = 0;
    stubborn.clear();
  } else if (Date.now() < pausedUntil) return;

  running = true;
  patch({ phase: 'syncing', error: null });
  try {
    watchClock();
    recordChanged = false;
    const { moved, pending, warning } = await cycle(ctx);
    pausedUntil = 0;
    pauseSteps = 0;
    networkFails = 0;
    vanished = 0;
    refused = 0;
    patch({ phase: warning ? 'error' : 'idle', error: warning, lastSync: Date.now(), transfer: null, reauth: false });
    // Algo viajó, o cambió lo que este equipo dice tener o necesitar: que los otros equipos
    // abiertos den su vuelta ya (uno baja lo que este subió, otro sube lo que a este le falta;
    // el que lo subió lo quita de Drive cuando todos lo tienen). Si no, un saludo de vez en cuando.
    hello(moved > 0 || recordChanged);
    // Y si quedó cola (el tope por vuelta), se sigue enseguida.
    if (moved > 0 && pending > 0) requestWireCycle(2000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const kind = error instanceof DriveError ? error.kind : 'other';
    if (kind === 'auth') access = null; // la de acceso ya no vale: la siguiente vuelta pide otra
    if (needsReauth) {
      patch({ phase: 'error', error: reauthText(), transfer: null, reauth: true });
      note('error', reauthText());
    } else if (kind === 'network') {
      // Un corte a media vuelta no es un problema que contar: se reintenta sola. Si no pasa, sí.
      networkFails += 1;
      patch(networkFails >= NETWORK_FAILS_SHOWN ? { phase: 'error', error: message, transfer: null } : { phase: 'idle', transfer: null });
    } else if (kind === 'auth' && refused < 1) {
      // Drive no aceptó un acceso que aquí se creía bueno: se pide otro y se repite, sin aviso.
      // Si la llave tampoco vale, esa vuelta lo dirá (`needsReauth`).
      refused += 1;
      patch({ phase: 'idle', transfer: null });
      again = true;
    } else if (kind === 'notFound' && vanished < 2) {
      // Algo desapareció de Drive a media vuelta (la carpeta, una ficha): la siguiente lo rehace.
      vanished += 1;
      patch({ phase: 'idle', transfer: null });
      again = true;
    } else {
      if (kind === 'rate' || kind === 'server') {
        pauseSteps += 1;
        pausedUntil = Date.now() + Math.min(PAUSE_MAX_MS, PAUSE_STEP_MS * 2 ** (pauseSteps - 1));
      }
      patch({ phase: 'error', error: message, transfer: null });
      note('error', message);
    }
  } finally {
    running = false;
    if (again) {
      const forcedAgain = againForced;
      again = false;
      againForced = false;
      requestWireCycle(forcedAgain ? 0 : 3000);
    }
  }
}

/**
 * Las canciones que acaban de llegar pasan a la biblioteca que conoce el relevo.
 * Hasta la 1.9.5 no: la vuelta que sigue enseguida (cuando queda cola) usaba la
 * lista de antes, no las veía y las bajaba otra vez, duplicadas.
 */
function rememberArrived(arrived: Song[]) {
  if (!latest) return;
  const known = new Set(latest.songs.map((song) => song.id));
  const fresh = arrived.filter((song) => !known.has(song.id));
  if (fresh.length > 0) latest = { ...latest, songs: [...latest.songs, ...fresh] };
}

interface UploadBudget {
  /** Lo que aún cabe en el Drive del usuario dejando su reserva. */
  room: number;
  /** Lo que ya espera en la carpeta sin ser para siempre. */
  backlog: number;
  /** El Drive está (casi) lleno: no se sube más por ahora. */
  full: boolean;
}

/** Una vuelta. Devuelve cuánto viajó, cuánto queda en cola y, si lo hay, un aviso que no la impidió. */
async function cycle(ctx: WireContext): Promise<{ moved: number; pending: number; warning: string | null }> {
  const drive = new Drive(accessToken);
  const me = await device();
  const userTag = await userTagOf(ctx.uid);
  currentUserTag = userTag;
  selfId = me.id;
  driveTag = (await hash(`frame-drive:${ctx.uid}:${(wireConnection()?.email ?? '').toLowerCase()}`)).slice(0, 12);
  const state = readState(userTag);
  const root = await resolveRoot(drive, userTag, me.id);
  const files = await drive.list(`'${root}' in parents`);
  const deviceFiles = files.filter((f) => f.appProperties.frameWire === 'device');
  const items = files.map(toItem).filter((i): i is RelayItem => !!i);
  // Lo que este equipo subió hace un momento y la lista aún no trae: está.
  const listed = new Set(files.map((f) => f.id));
  for (const [id, recent] of recentUploads) {
    if (listed.has(id) || steady() - recent.at > RECENT_UPLOAD_MS || steady() < recent.at) recentUploads.delete(id);
    else items.push(recent.item);
  }

  // Fichas de este equipo: una. Si hay más (una subida que se dio por perdida y llegó), queda la más reciente.
  const ownFiles = deviceFiles.filter((f) => f.appProperties.device === me.id).sort((a, b) => b.modified - a.modified);
  for (const extra of ownFiles.slice(1)) await drive.remove(extra.id);
  let ownFile: DriveFile | undefined = ownFiles[0];
  if (!ownFile) {
    // La lista no la trae: antes de poner otra, se pregunta por la que este equipo escribió.
    const savedId = extRead<string | null>(WIRE, 'deviceFile', null);
    const still = typeof savedId === 'string' && savedId ? await drive.get(savedId) : null;
    if (still && still.appProperties.frameWire === 'device' && still.appProperties.device === me.id && still.appProperties.user === userTag) ownFile = still;
  }

  const inv = await inventory(ctx, me.id, state);
  // Lo anotado (claves y borrados) se guarda ya: si la vuelta se corta más abajo, no se pierde.
  // Los borrados del usuario solo salen de su lista cuando consta que quedaron guardados.
  const early: SavedState = { known: state.known, declined: [...inv.view.declined], pins: state.pins, ids: inv.ids };
  if (writeState(userTag, early)) forgetRemovedSongs(ctx.uid, inv.consumed);

  const ownRecord = (): DeviceRecord => ({
    id: me.id,
    name: me.name,
    lastSeen: driveNow(),
    have: [...inv.view.have].sort(),
    declined: [...inv.view.declined].sort(),
    keep: [...inv.view.keep].sort(),
  });
  // Antes de decidir nada con fechas hay que saber la hora de Drive: se la da al recibir la ficha.
  if (clockOffset === null) ownFile = await writeOwnRecord(drive, root, userTag, ownRecord(), ownFile, true);
  inv.view.now = driveNow();

  // Fichas de datos de canciones: una por clave (la más nueva). Las que se
  // quedaron sin canción (una subida que se cortó) o repetidas, fuera tras una hora.
  const metas = new Map<string, DriveFile>();
  const metaFiles = files.filter((f) => f.appProperties.frameWire === 'meta').sort((a, b) => b.created - a.created);
  for (const meta of metaFiles) {
    const key = meta.appProperties.key;
    const orphan = metas.has(key) || !items.some((i) => i.key === key);
    if (!orphan) metas.set(key, meta);
    else if (driveNow() - meta.created > ORPHAN_META_MS) await drive.remove(meta.id);
  }
  // Y al revés: una canción en Drive sin su ficha de datos no la puede recibir nadie como es
  // debido. Si este equipo la tiene, se la repone (pasado un rato: recién subida, puede que la
  // lista de Drive aún no enseñe la ficha).
  for (const item of items) {
    if (item.kind !== 'song' || metas.has(item.key) || driveNow() - item.created < META_REPAIR_MS) continue;
    const song = inv.songsByKey.get(item.key);
    if (song) metas.set(item.key, await uploadSongMeta(drive, root, userTag, item.key, song));
  }
  const { records, fileOf, versions } = await readDevices(drive, deviceFiles.filter((f) => f.appProperties.device !== me.id));

  for (const item of items) {
    if (inv.view.have.has(item.key)) continue;
    // Una imagen que ya cambió (o se quitó) no se baja: cuenta como «la tengo»
    // para que salga de Drive en cuanto todos digan lo mismo.
    if (item.kind === 'image' && !inv.images.has(item.key)) inv.view.have.add(item.key);
    // Un adjunto o un recurso cuya ficha no está aquí (se borró, o aún no llegó con la
    // cuenta) no se espera. Si la ficha llega, vuelve a pedirse (ver `inventory`).
    else if (item.kind === 'attachment' && !inv.attachments.has(item.key)) inv.view.declined.add(item.key);
    else if (item.kind === 'note' && !inv.noteFiles.has(item.key)) inv.view.declined.add(item.key);
    // Lo que pesa más de lo que este equipo acepta: que los demás no lo guarden en Drive por él.
    else if (item.size > MAX_FILE) inv.view.declined.add(item.key);
  }
  const plan = planCycle(inv.view, records, items);
  const names = new Map(records.map((r) => [r.id, r.name]));
  names.set(me.id, me.name);
  // Equipos activos con un relevo anterior (ver RELAY_VERSION): una canción que alguno de ellos
  // aún no tiene no se sube; la bajaría duplicada. Lo demás (adjuntos, imágenes) sí: eso lo recibía bien.
  const old = plan.activeOthers.filter((r) => (versions.get(r.id) ?? 1) < RELAY_VERSION);
  if (old.length > 0) {
    const wouldReach = (key: string) => old.some((r) => !r.have.includes(key) && !r.declined.includes(key));
    plan.upload = plan.upload.filter((job) => job.kind !== 'song' || !wouldReach(job.key));
  }
  const outdated = old.map((r) => r.name);
  if (outdated.join('\u0000') !== status.outdated.join('\u0000')) patch({ outdated });

  // 1. Equipos que llevan más de una semana sin aparecer: dejan de esperarse.
  for (const gone of plan.dropDevices) {
    const id = fileOf.get(gone.id);
    if (id) await drive.remove(id);
    note('info', tr('«{name}» lleva más de una semana sin conectarse: ya no se le espera.', { name: gone.name }));
  }

  // 2. Para siempre (corazón o fijado), o ya no.
  for (const { item, permanent } of plan.setPermanent) {
    try {
      await drive.setProperties(item.id, { permanent: permanent ? '1' : '0' });
      item.permanent = permanent;
    } catch (error) {
      // Otro equipo lo quitó entre medias: nada que marcar.
      if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
    }
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
    recentUploads.delete(item.id);
    note('remove', tr('«{name}» ya está en todos tus equipos: salió de Drive.', { name: item.name }));
  }

  // 4. Bajar lo que falta aquí.
  let transfers = 0;
  let bytes = 0;
  let moved = 0;
  const arrived: Song[] = [];
  try {
    for (const item of plan.download) {
      if (transfers >= MAX_TRANSFERS || bytes + item.size > MAX_BYTES) break;
      if (item.size > MAX_FILE) continue;
      const rest = stubborn.get(item.id);
      if (rest && rest.until > Date.now() && rest.until - Date.now() <= STUBBORN_REST_MS) continue;
      patch({ transfer: { name: item.name, direction: 'down' } });
      const ok = await receive(drive, item, metas, inv, ctx, arrived);
      if (ok) {
        stubborn.delete(item.id);
        inv.view.have.add(item.key);
        inv.view.declined.delete(item.key);
        transfers++;
        bytes += item.size;
        note('down', tr('«{name}» llegó de {device}.', { name: item.name, device: names.get(item.from) ?? tr('otro equipo') }));
      }
    }
  } finally {
    // Pase lo que pase con la vuelta, lo que ya entró entero queda en la biblioteca con su clave.
    if (arrived.length > 0) {
      const added = await ctx.addSongs(arrived).then(
        () => true,
        () => false
      );
      if (added) {
        writeState(userTag, { ...early, ids: inv.ids });
        rememberArrived(arrived);
      }
    }
  }
  moved += transfers;
  // Que el verificador y los avisos dejen de decir que la imagen es de otro equipo.
  if (plan.download.some((i) => i.kind === 'image' && inv.view.have.has(i.key))) await reconcileImageRefs(ctx.uid).catch(() => undefined);
  // Un adjunto o un archivo de recurso que llegó ya no falta: que el verificador lo vea ahora.
  if (plan.download.some((i) => (i.kind === 'attachment' || i.kind === 'note') && inv.view.have.has(i.key))) window.dispatchEvent(new Event(SYNC_RECHECK_EVENT));

  // 5. Subir lo que otro equipo no tiene (o lo que va para siempre), sin llenar el Drive.
  transfers = 0;
  bytes = 0;
  let warning: string | null = null;
  const uploaded: RelayItem[] = [];
  if (plan.upload.length > 0) {
    const budget: UploadBudget = {
      room: Number.POSITIVE_INFINITY,
      backlog: items.filter((i) => !removed.has(i.id) && !i.permanent).reduce((sum, i) => sum + i.size, 0),
      full: false,
    };
    const about = await drive.about().catch((error) => {
      if (breaksCycle(error)) throw error;
      return null;
    });
    if (about?.limit) budget.room = about.limit - about.usage - DRIVE_RESERVE;
    try {
      for (const job of plan.upload) {
        if (transfers >= MAX_TRANSFERS || bytes >= MAX_BYTES || budget.full) break;
        const sent = await send(drive, root, userTag, me.id, job, inv, budget);
        if (sent) {
          uploaded.push(sent);
          recentUploads.set(sent.id, { item: sent, at: steady() });
          transfers++;
          bytes += sent.size;
          note('up', tr('«{name}» subió a Drive.', { name: sent.name }));
        }
      }
    } catch (error) {
      // Drive lleno: se deja de subir, pero la vuelta sigue (bajar y dar parte no ocupa).
      if (!(error instanceof DriveError && error.kind === 'quota')) throw error;
      budget.full = true;
    }
    if (budget.full) {
      warning = tr('Tu Google Drive está casi lleno: Wire espera a que haya espacio para seguir subiendo.');
      note('error', warning);
    }
  }
  moved += uploaded.length;

  // 6. La ficha de este equipo.
  const record = ownRecord();
  try {
    await writeOwnRecord(drive, root, userTag, record, ownFile);
  } catch (error) {
    // Con el Drive lleno puede no caber ni la ficha: se reintenta en la próxima vuelta.
    if (!(error instanceof DriveError && error.kind === 'quota')) throw error;
    warning = warning ?? error.message;
  }
  // Las claves, solo de canciones que siguen aquí (o acaban de llegar).
  const alive = new Set([...ctx.songs, ...arrived].map((song) => song.id));
  writeState(userTag, {
    known: record.have.filter((key) => !isSongItem(key)),
    declined: record.declined,
    pins: readState(userTag).pins,
    ids: Object.fromEntries(Object.entries(inv.ids).filter(([id]) => alive.has(id))),
  });

  // 7. La vista.
  const live = [...items.filter((i) => !removed.has(i.id)), ...uploaded];
  const after = planCycle(inv.view, records, live);
  const pins = new Set(readState(userTag).pins);
  const toLocal = (driveTime: number) => driveTime - (clockOffset ?? 0);
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
      ...records.map((r) => ({ id: r.id, name: r.name, lastSeen: toLocal(r.lastSeen), self: false, active: inv.view.now - r.lastSeen <= WEEK_MS })),
    ],
  });
  return { moved, pending: after.upload.length + after.download.length, warning };
}

async function writeOwnRecord(drive: Drive, root: string, userTag: string, record: DeviceRecord, existing: DriveFile | undefined, force = false): Promise<DriveFile | undefined> {
  if (stopped || !wireConnection()) return existing;
  const digest = await hash(JSON.stringify({ ...record, lastSeen: 0 }));
  const lastWritten = extRead<{ digest: string; at: number } | null>(WIRE, 'lastRecord', null);
  const age = lastWritten ? Date.now() - lastWritten.at : -1;
  // Igual que la última y reciente: no hace falta. (Una edad negativa es un reloj que retrocedió: se escribe.)
  if (!force && existing && lastWritten?.digest === digest && age >= 0 && age < HEARTBEAT_MS) return existing;
  const body = new Blob([JSON.stringify({ ...record, version: RELAY_VERSION })], { type: 'application/json' });
  const create = () =>
    drive.upload(
      { name: `Equipo · ${safeName(record.name)}.json`, parents: [root], mimeType: 'application/json', appProperties: { frameWire: 'device', device: record.id, user: userTag } },
      body
    );
  let file: DriveFile;
  if (!existing) file = await create();
  else {
    try {
      file = await drive.replace(existing.id, body, 'application/json');
    } catch (error) {
      // Otro equipo la quitó entre medias (creyó a este ausente): se pone otra.
      if (!(error instanceof DriveError && error.kind === 'notFound')) throw error;
      file = await create();
    }
  }
  if (file.modified > 0) clockOffset = file.modified - Date.now();
  if (lastWritten?.digest !== digest) recordChanged = true;
  extWrite(WIRE, 'deviceFile', file.id);
  extWrite(WIRE, 'lastRecord', { digest, at: Date.now() });
  return file;
}

/** Baja un objeto y comprueba que llegó entero. null: llegó mal (se reintenta en otra vuelta). */
async function fetchVerified(drive: Drive, item: RelayItem): Promise<Blob | null> {
  const blob = await drive.download(item.id);
  const whole = (item.size <= 0 || blob.size === item.size) && (!item.sha256 || blob.size > VERIFY_HASH_MAX || (await sha256Of(blob)) === item.sha256);
  if (whole) return blob;
  const fails = (stubborn.get(item.id)?.fails ?? 0) + 1;
  stubborn.set(item.id, { fails, until: fails >= 3 ? Date.now() + STUBBORN_REST_MS : 0 });
  note('error', tr('«{name}» llegó incompleto: se vuelve a intentar.', { name: item.name }));
  return null;
}

/** Trae un objeto del relevo y lo mete en Frame. false si aún no se puede. */
async function receive(drive: Drive, item: RelayItem, metas: Map<string, DriveFile>, inv: Inventory, ctx: WireContext, arrived: Song[]): Promise<boolean> {
  try {
    if (item.kind === 'song') {
      const metaFile = metas.get(item.key);
      // Sin ficha de datos se espera: quien tenga la canción se la repone. Si pasa una hora y nadie
      // lo hizo, es que ya nadie la tiene: la de Drive es la última copia y entra con lo que se sabe.
      if (!metaFile && driveNow() - item.created < ORPHAN_META_MS) return false;
      const meta = metaFile ? (JSON.parse(await (await drive.download(metaFile.id)).text()) as Partial<SongMeta> | null) : metaFromName(item.name);
      if (!meta || typeof meta !== 'object') return false;
      const blob = await fetchVerified(drive, item);
      if (!blob || blob.size === 0) return false;
      // Su ficha ya estaba aquí sin audio (el equipo perdió el almacén): se repara en su sitio.
      const hollow = inv.silent.get(item.key);
      if (hollow) {
        await storeSongFile(hollow, new File([blob], hollow.fileName || item.name, { type: blob.type || 'audio/mpeg' }));
        inv.silent.delete(item.key);
        inv.songsByKey.set(item.key, hollow);
        inv.view.uploadable.set(item.key, 'song');
        return true;
      }
      const taken = new Set([...ctx.songs, ...arrived].map((s) => s.fileName.toLowerCase()));
      const original = typeof meta.fileName === 'string' && meta.fileName ? meta.fileName : item.name;
      let fileName = original;
      for (let n = 2; taken.has(fileName.toLowerCase()); n++) fileName = original.replace(/(\.[^.]+)?$/, ` (${n})$1`);
      const song: Song = {
        id: crypto.randomUUID(),
        title: typeof meta.title === 'string' && meta.title ? meta.title : item.name,
        artist: typeof meta.artist === 'string' ? meta.artist : '',
        album: typeof meta.album === 'string' ? meta.album : '',
        picture: typeof meta.picture === 'string' ? meta.picture : '',
        fileName,
        ...(typeof meta.duration === 'number' && meta.duration > 0 ? { duration: meta.duration } : {}),
        ...(meta.isFavorite ? { isFavorite: true } : {}),
        owner: ctx.uid,
      };
      await storeSongFile(song, new File([blob], fileName, { type: blob.type || 'audio/mpeg' }));
      if (meta.lyrics) await importLyrics(song.id, meta.lyrics).catch(() => undefined);
      inv.ids[song.id] = item.key;
      arrived.push(song);
      return true;
    }
    if (item.kind === 'image') {
      const [, imageKey, h] = parseImageKey(item.key) ?? [];
      const current = imageKey ? readImageRefs(ctx.uid).find((r) => r.id === imageKey) : undefined;
      if (!imageKey || current?.kind !== 'own' || current.h !== h) return false;
      const dataUrl = await blobToDataUrl(await drive.download(item.id));
      // La huella de la imagen ya dice si llegó entera.
      if ((await fingerprint(dataUrl)) !== h) return false;
      await saveImage(imageKey, dataUrl, { fromSync: true, at: current.at });
      imagesHere.add(item.key);
      return true;
    }
    const blob = await fetchVerified(drive, item);
    if (!blob) return false;
    if (item.kind === 'attachment') {
      await storeAttachmentCopy(item.key.slice(2), new File([blob], item.name, { type: blob.type }));
      return true;
    }
    await saveImage(`noteFile_${item.key.slice(2)}`, await blobToDataUrl(blob));
    noteFilesHere.add(item.key.slice(2));
    return true;
  } catch (error) {
    if (breaksCycle(error)) throw error;
    // Otro equipo lo quitó entre la lista y la bajada: nada que contar.
    if (!(error instanceof DriveError && error.kind === 'notFound')) note('error', tr('No se pudo traer «{name}».', { name: item.name }));
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

/** Sube un objeto. null si no se pudo leer aquí, o si por ahora no debe subir. */
async function send(
  drive: Drive,
  root: string,
  userTag: string,
  deviceId: string,
  job: { key: string; kind: ItemKind; permanent: boolean },
  inv: Inventory,
  budget: UploadBudget
): Promise<RelayItem | null> {
  const props = { frameWire: 'item', kind: job.kind, key: job.key, from: deviceId, permanent: job.permanent ? '1' : '0', user: userTag };
  let blob: Blob | null = null;
  let name = '';
  let song: Song | undefined;
  if (job.kind === 'song') {
    song = inv.songsByKey.get(job.key);
    if (!song) return null;
    const file = await readSongFile(song).catch(() => undefined);
    if (!file || file.size === 0 || file.size > MAX_FILE) return null;
    blob = file;
    name = songDriveName(song);
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
    const dataUrl = n ? await getImage(`noteFile_${n.id}`).catch(() => null) : null;
    if (!n || !dataUrl) return null;
    blob = await (await fetch(dataUrl)).blob();
    name = safeName(n.fileName ?? 'archivo');
  }
  // El Drive del usuario no se llena: ni por falta de espacio…
  if (blob.size > budget.room) {
    budget.full = true;
    return null;
  }
  // …ni porque un equipo tarde en bajar lo suyo (lo que va para siempre no cuenta).
  if (!job.permanent && budget.backlog + blob.size > BACKLOG_MAX) return null;

  patch({ transfer: { name, direction: 'up' } });
  if (song) await uploadSongMeta(drive, root, userTag, job.key, song);
  const file = await drive.upload({ name, parents: [root], mimeType: blob.type || 'application/octet-stream', appProperties: props }, blob);
  // Drive dice cuánto recibió: si no es todo, esa copia no le sirve a nadie.
  if (file.size > 0 && file.size !== blob.size) {
    await drive.remove(file.id).catch(() => undefined);
    note('error', tr('«{name}» no subió entero: se vuelve a intentar.', { name }));
    return null;
  }
  budget.room -= blob.size;
  if (!job.permanent) budget.backlog += blob.size;
  return {
    id: file.id,
    key: job.key,
    kind: job.kind,
    from: deviceId,
    permanent: job.permanent,
    created: file.created || driveNow(),
    name: file.name,
    size: file.size || blob.size,
    ...(file.sha256 ? { sha256: file.sha256 } : {}),
  };
}
