import { getSupabase } from '@/lib/supabase/client';
import { CLOUD_APPLIED_EVENT } from '@/lib/supabase/sync';
import { SYNC_NOW_EVENT } from '@/lib/sync-status';
import {
  IMAGE_UPDATED_EVENT,
  deleteImage,
  getImageRecord,
  listImageKeys,
  saveImage,
  type ImageUpdatedDetail,
} from '@/lib/music-db';
import { fingerprint, imageOwnership, isLeakedScheduleImage, scheduleImageKey } from '@/lib/profile-scope';
import { isEntityImageKey, readImageRefs } from '@/lib/image-refs';
import { tr } from '@/lib/i18n';

// ============================================================
// Imágenes que viajan entre dispositivos (1.5.5 escritorio / 1.0.8 Android).
//
// Hasta ahora solo viajaban los DATOS: cambiar la foto de perfil en la laptop
// no llegaba nunca a la tablet. Ahora viajan las imágenes que forman parte de
// la cuenta:
//
//   · foto de perfil          profileAvatar_<uid>
//   · horario de Inicio       scheduleImage (en el equipo, scheduleImage_<uid>)
//   · portada de playlist     playlistImage_<id>
//   · imagen de asignatura    courseImage_<id>
//   · imagen de colección     spaceImage_<id>
//   · horarios por mes        timetableImage_<id> (1.9.0)
//
// SOLO lo del perfil activo (1.6.7, ver profile-scope.ts): en un equipo
// compartido, las imágenes de otro perfil nunca se suben a esta nube, y las
// que se subieron por error hasta la 1.6.6 se retiran de ella sin tocar la
// copia local, que es de su dueño.
//
// Se quedan en cada dispositivo, a propósito, la música, las portadas de las
// canciones, los adjuntos de notas y las letras: pesan demasiado para el plan
// gratuito y no son «la cuenta».
//
// 1.6.8 (Diego): las imágenes de asignaturas, colecciones y playlists ya no
// se suben. Las de la galería viajan como su código y su encuadre, y las
// propias se quedan en su dispositivo (image-refs.ts). Por aquí solo viajan
// la foto de perfil y la del horario; de las demás solo se RESTAURA la copia
// que subió una versión anterior, si aquí falta y nadie eligió otra.
//
// CÓMO:
//   · Los archivos van a Supabase Storage, bucket privado `user-images`, en la
//     carpeta de la cuenta (`<uid>/<clave>.<huella>`); nadie más puede leerla
//     (0007). Cada versión tiene su propio nombre: si dos dispositivos suben a
//     la vez, cada uno baja exactamente la versión que dice el índice.
//   · El ÍNDICE (qué imagen tiene qué huella) va dentro del respaldo normal,
//     clave `syncedImages`: viaja con la sincronización en vivo, así que un
//     cambio avisa a los demás dispositivos en segundos.
//   · Cada dispositivo recuerda en qué estado dejó cada imagen la última vez
//     (`imageSyncBase_<uid>`, no viaja). Con eso distingue «la cambié yo»
//     (subir) de «la cambiaron en otro sitio» (bajar), como un 3-way merge.
//   · Borrar no quita la ficha del índice: la marca `gone`. Así el borrado
//     viaja aunque una versión antigua de Frame reenvíe el respaldo. Y solo
//     cuenta como borrado lo que el usuario borró: si a un dispositivo le
//     faltan imágenes por otra causa, se restauran desde la nube.
//   · Si dos dispositivos traen imágenes distintas (la primera vez, o
//     cambiadas a la vez), gana la más reciente. Las anteriores a esta versión
//     no tienen fecha: entonces gana la de la laptop, que es donde se ponían.
//
// Solo se sube o baja lo que cambió: una imagen se transfiere una vez por
// cambio, no en cada sincronización.
// ============================================================

const BUCKET = 'user-images';
const MANIFEST_KEY = 'syncedImages';
/**
 * Por encima de esto, la imagen se reduce antes de subirla (2000 px, JPEG).
 * Era 3,5 MB: una foto del horario de 3 MB subía entera y con el Storage
 * gratuito (1 GB) cabían unos cientos de cuentas; además cada dispositivo la
 * bajaba entera (1.7.0). El original del equipo no se toca.
 */
const MAX_UPLOAD_BYTES = 500 * 1024;
/** Reintento tras un fallo: 2 min, 4, 8… hasta 1 h (con el Storage lleno no se insiste cada 2 min). */
const RETRY_MS = 2 * 60 * 1000;
const RETRY_MAX_MS = 60 * 60 * 1000;

/** ¿Esta imagen es de las que viajan? (clave lógica, la del índice y la nube) */
function isSyncedImageKey(key: string): boolean {
  return (
    key === 'scheduleImage' ||
    key.startsWith('profileAvatar_') ||
    key.startsWith('playlistImage_') ||
    key.startsWith('courseImage_') ||
    key.startsWith('spaceImage_') ||
    key.startsWith('timetableImage_')
  );
}

/** Clave en el almacén local: la foto del horario lleva el id del perfil; en la nube no hace falta (su carpeta ya es del perfil). */
const localKeyOf = (uid: string, key: string) => (key === 'scheduleImage' ? scheduleImageKey(uid) : key);

/** Clave lógica de una clave local, o null si no es una imagen de este perfil que viaje. */
function logicalKeyOf(uid: string, localKey: string): string | null {
  if (localKey === scheduleImageKey(uid)) return 'scheduleImage';
  if (localKey.startsWith('scheduleImage')) return null; // horario de otro perfil, o sin dueño
  return isSyncedImageKey(localKey) ? localKey : null;
}

/** Ficha del índice compartido (colección `syncedImages`, fusionada por `id`). */
interface ManifestEntry {
  /** Clave de la imagen en el almacén local. */
  id: string;
  /** Huella de lo que hay en la nube. */
  h?: string;
  /** Cuándo se subió (ISO). */
  t: string;
  /** Cuándo cambió la imagen de verdad (ms; 0 = antes de la 1.5.5, desconocido). */
  m?: number;
  /** Tipo de dispositivo donde se cambió. */
  src?: DeviceKind;
  /** Borrada: los demás dispositivos también la quitan. */
  gone?: boolean;
}

type DeviceKind = 'desktop' | 'android';
const DEVICE_KIND: DeviceKind =
  typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';

/** Cómo quedó cada imagen en ESTE dispositivo tras su última sincronización. */
type BaseState = Record<string, { l: string | null; r: string | null }>;

const manifestStorageKey = (uid: string) => `${MANIFEST_KEY}_${uid}`;
const baseStorageKey = (uid: string) => `imageSyncBase_${uid}`;
/** Imágenes que el usuario borró aquí y aún no se avisó a la nube (clave → ms). */
const deletedStorageKey = (uid: string) => `imageSyncDeleted_${uid}`;

/** ¿Gana la versión de este dispositivo frente a la de la nube? */
function localWinsTie(localAt: number, entry: ManifestEntry): boolean {
  const remoteAt = entry.m ?? 0;
  if (localAt !== remoteAt) return localAt > remoteAt;
  // Sin fechas (imágenes de antes de la 1.5.5): manda la laptop.
  return DEVICE_KIND === 'desktop' && entry.src !== 'desktop';
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sin espacio: se reintenta en la próxima vuelta */
  }
}

// Separador «.»: Storage rechaza la «~» con «Invalid key» (400), y por eso
// hasta la 1.5.7 / 1.0.10 ninguna imagen llegó a subirse.
const objectPath = (uid: string, key: string, hash: string) => `${uid}/${encodeURIComponent(key)}.${hash}`;

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  if (!mime.startsWith('image/')) return null;
  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type: mime });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Una foto de móvil puede pesar 6 MB: se reduce a 2000 px en JPEG antes de subirla. */
async function shrinkForUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_BYTES) return blob;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = url;
    });
    const scale = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) return blob;
    // JPEG no tiene transparencia: sin fondo, un PNG transparente salía negro.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    return out && out.size < blob.size ? out : blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Avisos que ya escuchaba la interfaz para algunas imágenes. */
function announceLegacy(key: string): void {
  if (key === 'scheduleImage') window.dispatchEvent(new Event('scheduleImageUpdated'));
}

// ------------------------------------------------------------
// Reconciliación: compara índice, estado local y base, y sube o baja.
// ------------------------------------------------------------
interface ReconcileResult {
  ok: boolean;
  /** Imágenes cuyo dueño aún no se conoce (la asignatura o la playlist se guarda un instante después). */
  postponed: string[];
}

async function reconcile(uid: string, onlyKeys?: Set<string>): Promise<ReconcileResult> {
  const postponed: string[] = [];
  const supabase = getSupabase();
  if (!supabase) return { ok: true, postponed };
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user?.id !== uid) return { ok: true, postponed }; // sin sesión de esta cuenta no se toca la nube

  const manifestList = readJson<ManifestEntry[]>(manifestStorageKey(uid), []);
  const manifest = new Map(
    (Array.isArray(manifestList) ? manifestList : [])
      .filter((entry) => entry && typeof entry.id === 'string' && isSyncedImageKey(entry.id))
      .map((entry) => [entry.id, entry] as const)
  );
  const base = readJson<BaseState>(baseStorageKey(uid), {});
  const localKeys = (await listImageKeys().catch(() => [] as string[]))
    .map((key) => logicalKeyOf(uid, key))
    .filter((key): key is string => key !== null);

  const keys = new Set<string>(onlyKeys ?? [...manifest.keys(), ...localKeys, ...Object.keys(base)]);
  /** Imágenes con referencia (image-refs.ts): esas no pasan por la nube. */
  const refs = new Set(readImageRefs(uid).map((ref) => ref.id));
  let manifestChanged = false;
  let allOk = true;

  const deleted = readJson<Record<string, number>>(deletedStorageKey(uid), {});

  /** Imagen de otro perfil que llegó a esta nube por error: fuera de ella. La copia local no se toca: es de su dueño. */
  const retract = (key: string, entry: ManifestEntry) => {
    if (entry.h) void dropObject(uid, key, entry.h);
    manifest.set(key, { id: key, t: new Date().toISOString(), m: Date.now(), src: DEVICE_KIND, gone: true });
    base[key] = { l: null, r: null };
    delete deleted[key];
    manifestChanged = true;
  };

  for (const key of keys) {
    if (!isSyncedImageKey(key)) continue;
    const entry = manifest.get(key);
    // Solo lo de este perfil (1.6.7). Lo de otro perfil del equipo, nunca a
    // esta nube; lo que aún no se sabe de quién es, se deja para luego.
    const ownership = imageOwnership(uid, key);
    if (ownership !== 'mine') {
      if (ownership === 'other' && entry && !entry.gone) retract(key, entry);
      else if (ownership === 'unknown' && onlyKeys) postponed.push(key);
      continue;
    }
    if (key === 'scheduleImage' && entry && !entry.gone && isLeakedScheduleImage(uid, entry.h)) {
      retract(key, entry);
      continue;
    }
    const localKey = localKeyOf(uid, key);
    if (isEntityImageKey(key)) {
      if (refs.has(key) || !entry || entry.gone || !entry.h) continue;
      try {
        if (await getImageRecord(localKey).catch(() => null)) continue;
        const { data: blob, error } = await supabase.storage.from(BUCKET).download(objectPath(uid, key, entry.h));
        if (error || !blob) throw new Error(error?.message ?? tr('descarga vacía'));
        const dataUrl = await blobToDataUrl(blob);
        await saveImage(localKey, dataUrl, { fromSync: true, at: entry.m ?? 0 });
        base[key] = { l: await fingerprint(dataUrl), r: entry.h };
      } catch {
        allOk = false;
      }
      continue;
    }
    try {
      const known = base[key];
      const record = await getImageRecord(localKey).catch(() => null);
      const localData = record?.dataUrl ?? null;
      const localHash = localData ? await fingerprint(localData) : null;
      const deletedAt = deleted[key];
      const localAt = localData ? record?.at ?? 0 : deletedAt ?? 0;
      const remoteHash = entry ? (entry.gone ? null : entry.h ?? null) : undefined;

      const pushLocal = async () => {
        if (localData && localHash) {
          const uploaded = await upload(uid, key, localData);
          const previous = entry && !entry.gone ? entry.h : undefined;
          manifest.set(key, { id: key, h: uploaded, t: new Date().toISOString(), m: localAt, src: DEVICE_KIND });
          base[key] = { l: localHash, r: uploaded };
          if (previous && previous !== uploaded) void dropObject(uid, key, previous);
        } else {
          if (remoteHash) void dropObject(uid, key, remoteHash);
          manifest.set(key, { id: key, t: new Date().toISOString(), m: localAt || Date.now(), src: DEVICE_KIND, gone: true });
          base[key] = { l: null, r: null };
        }
        delete deleted[key];
        manifestChanged = true;
      };

      const pullRemote = async () => {
        if (!remoteHash) {
          if (localData) await deleteImage(localKey, { fromSync: true });
          base[key] = { l: null, r: null };
        } else {
          const { data: blob, error } = await supabase.storage.from(BUCKET).download(objectPath(uid, key, remoteHash));
          if (error || !blob) throw new Error(error?.message ?? tr('descarga vacía'));
          const dataUrl = await blobToDataUrl(blob);
          await saveImage(localKey, dataUrl, { fromSync: true, at: entry?.m ?? 0 });
          base[key] = { l: await fingerprint(dataUrl), r: remoteHash };
          announceLegacy(key);
        }
        delete deleted[key];
      };

      // Ya son la misma imagen (p. ej. un dispositivo recién estrenado).
      if (remoteHash && localHash === remoteHash) {
        base[key] = { l: localHash, r: remoteHash };
        delete deleted[key];
        continue;
      }

      // --- En la nube no hay ficha: lo que haya aquí se sube. ---
      if (remoteHash === undefined || !entry) {
        if (localData) await pushLocal();
        else {
          delete base[key];
          delete deleted[key];
        }
        continue;
      }

      // --- Aquí falta y el usuario NO la borró: se restaura desde la nube. ---
      if (!localData && deletedAt === undefined) {
        if (remoteHash) await pullRemote();
        else base[key] = { l: null, r: null };
        continue;
      }

      const localChanged = known ? localHash !== known.l : true;
      const remoteChanged = !known || remoteHash !== known.r;
      if (!localChanged && !remoteChanged) continue;

      const localWins = localChanged && !remoteChanged ? true : !localChanged ? false : localWinsTie(localAt, entry);
      if (localWins) await pushLocal();
      else await pullRemote();
    } catch {
      allOk = false; // sin red o sin permiso: se reintenta más tarde
    }
  }

  writeJson(deletedStorageKey(uid), deleted);
  writeJson(baseStorageKey(uid), base);
  if (manifestChanged) {
    // Escribir el índice dispara la sincronización en vivo (live-sync.ts):
    // en segundos, los demás dispositivos saben qué bajar.
    writeJson(manifestStorageKey(uid), [...manifest.values()]);
  }
  return { ok: allOk, postponed };
}

/** Sube la imagen y devuelve la huella de lo que quedó en la nube. */
async function upload(uid: string, key: string, dataUrl: string): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error(tr('sin nube'));
  const original = dataUrlToBlob(dataUrl);
  if (!original) throw new Error(tr('imagen ilegible'));
  const blob = await shrinkForUpload(original);
  // La huella de la nube es la de lo que se bajará de allí (reducida o no).
  const hash = blob === original ? await fingerprint(dataUrl) : await fingerprint(await blobToDataUrl(blob));
  const { error } = await supabase.storage.from(BUCKET).upload(objectPath(uid, key, hash), blob, {
    upsert: true,
    contentType: blob.type || 'image/jpeg',
    cacheControl: '31536000', // el nombre cambia con cada versión: se puede guardar en caché
  });
  if (error) throw new Error(error.message);
  return hash;
}

/** La versión anterior ya no la pide nadie: fuera, para no ocupar cuota. */
async function dropObject(uid: string, key: string, hash: string): Promise<void> {
  try {
    await getSupabase()?.storage.from(BUCKET).remove([objectPath(uid, key, hash)]);
  } catch {
    /* quedaría un archivo huérfano; no afecta a nada */
  }
}

// ------------------------------------------------------------
// Arranque: una por sesión, junto a la sincronización en vivo.
// ------------------------------------------------------------
export function startImageSync(uid: string): () => void {
  let stopped = false;
  let running = false;
  let pendingAll = false;
  const pendingKeys = new Set<string>();
  /** Reintentos de las imágenes con dueño aún desconocido (máx. 5, cada 4 s). */
  const postponedTries = new Map<string, number>();
  let timer: number | null = null;
  let retryTimer: number | null = null;
  let failures = 0;

  const run = async () => {
    if (stopped) return;
    if (running) return schedule(500);
    running = true;
    const all = pendingAll;
    const keys = new Set(pendingKeys);
    pendingAll = false;
    pendingKeys.clear();
    try {
      const { ok, postponed } = await reconcile(uid, all ? undefined : keys);
      for (const key of postponed) {
        const tries = (postponedTries.get(key) ?? 0) + 1;
        postponedTries.set(key, tries);
        if (tries <= 5) {
          pendingKeys.add(key);
          schedule(4000);
        }
      }
      failures = ok ? 0 : failures + 1;
      if (!ok && !stopped) {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
        const wait = Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (failures - 1)) * (0.75 + Math.random() * 0.5);
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          pendingAll = true;
          schedule(0);
        }, wait);
      }
    } finally {
      running = false;
    }
  };

  const schedule = (delay: number) => {
    if (stopped) return;
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };

  // Una imagen cambió en este dispositivo (no la trajo la sincronización).
  const onImage = (event: Event) => {
    const detail = (event as CustomEvent<ImageUpdatedDetail>).detail;
    if (!detail || detail.fromSync) return;
    const key = logicalKeyOf(uid, detail.key);
    // Las de asignaturas, colecciones y playlists ya no se suben (1.6.8).
    if (!key || isEntityImageKey(key)) return;
    // Un borrado solo viaja si lo hizo el usuario: se apunta aquí.
    const deleted = readJson<Record<string, number>>(deletedStorageKey(uid), {});
    if (detail.deleted) deleted[key] = Date.now();
    else delete deleted[key];
    writeJson(deletedStorageKey(uid), deleted);
    pendingKeys.add(key);
    schedule(800);
  };
  // Llegaron datos de otro dispositivo: quizá el índice trae imágenes nuevas.
  const onCloud = () => {
    pendingAll = true;
    schedule(300);
  };
  const onOnline = () => {
    pendingAll = true;
    schedule(1000);
  };

  window.addEventListener(IMAGE_UPDATED_EVENT, onImage);
  window.addEventListener(CLOUD_APPLIED_EVENT, onCloud);
  window.addEventListener(SYNC_NOW_EVENT, onCloud);
  window.addEventListener('online', onOnline);

  // Primera vuelta completa: sube lo que este dispositivo tenía antes de la
  // 1.5.5 y baja lo que falte.
  pendingAll = true;
  schedule(3000);

  return () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    if (retryTimer !== null) window.clearTimeout(retryTimer);
    window.removeEventListener(IMAGE_UPDATED_EVENT, onImage);
    window.removeEventListener(CLOUD_APPLIED_EVENT, onCloud);
    window.removeEventListener(SYNC_NOW_EVENT, onCloud);
    window.removeEventListener('online', onOnline);
  };
}

/** Al borrar la cuenta: sus imágenes de la nube también se van. */
export async function removeCloudImages(uid: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  try {
    const { data } = await supabase.storage.from(BUCKET).list(uid, { limit: 1000 });
    const paths = (data ?? []).map((object) => `${uid}/${object.name}`);
    if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  } catch {
    /* el borrado de la cuenta sigue adelante igualmente */
  }
}
