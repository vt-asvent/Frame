// ============================================================
// Adjuntos de archivo de las tareas.
//
// La gracia está en NO copiar el documento: se guarda un *manejador* al
// archivo real del disco (File System Access API). Así, cuando el usuario
// sigue trabajando en su Word y lo guarda, Frame lee la versión nueva —el
// avance se ve reflejado sin volver a adjuntar nada—.
//
// Cuando el navegador no ofrece esa API se cae a una COPIA congelada, que se
// puede ver pero no se actualiza sola; la interfaz lo dice con todas las letras.
//
// Base de datos propia y minúscula, aparte de AetherMusicDB: subir la versión
// de aquella podría quedarse bloqueada mientras la ventana flotante del
// temporizador la tiene abierta.
// ============================================================

const DB_NAME = 'FrameFileHandles';
/** Nombre de la base, para que el borrado de cuenta pueda eliminarla. */
export const FILE_HANDLES_DB_NAME = DB_NAME;
const DB_VERSION = 1;
const STORE = 'handles';

type StoredEntry =
  | { key: string; kind: 'handle'; handle: FileSystemFileHandle }
  | { key: string; kind: 'copy'; blob: Blob; fileName: string; lastModified: number };

const openDB = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const put = async (entry: StoredEntry): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
};

const get = async (key: string): Promise<StoredEntry | undefined> => {
  const db = await openDB();
  const entry = await new Promise<StoredEntry | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result as StoredEntry | undefined);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return entry;
};

const attachmentKey = (attachmentId: string) => `taskFile_${attachmentId}`;

/** ¿Puede el sistema quedarse con un enlace vivo al archivo del disco? */
const supportsLiveFiles = (): boolean =>
  typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export interface PickedFile {
  fileName: string;
  mime: string;
  /** true si quedó enlazado al archivo real (se actualizará solo). */
  live: boolean;
}

/** Guarda un manejador vivo ya obtenido (selector múltiple o arrastre). */
async function storeHandle(attachmentId: string, handle: FileSystemFileHandle): Promise<PickedFile> {
  const file = await handle.getFile();
  await put({ key: attachmentKey(attachmentId), kind: 'handle', handle });
  return { fileName: file.name, mime: file.type, live: true };
}

/** Guarda una copia congelada del archivo (cuando no hay manejador vivo). */
async function storeCopy(attachmentId: string, file: File): Promise<PickedFile> {
  await put({
    key: attachmentKey(attachmentId),
    kind: 'copy',
    blob: file,
    fileName: file.name,
    lastModified: file.lastModified,
  });
  return { fileName: file.name, mime: file.type, live: false };
}

/** Guarda como copia un adjunto que llegó de otro equipo (extensión Wire, 1.7.3). */
export async function storeAttachmentCopy(attachmentId: string, file: File): Promise<void> {
  await storeCopy(attachmentId, file);
}

export interface StoredPick {
  id: string;
  picked: PickedFile;
}

/**
 * Elige UNO O VARIOS archivos (1.6.5) y deja cada uno asociado a un id nuevo.
 * Lista vacía si el usuario cerró el selector.
 */
export async function pickAndStoreFiles(): Promise<StoredPick[]> {
  if (supportsLiveFiles()) {
    try {
      const handles: FileSystemFileHandle[] = await (window as any).showOpenFilePicker({ multiple: true });
      const out: StoredPick[] = [];
      for (const handle of handles) {
        const id = crypto.randomUUID();
        out.push({ id, picked: await storeHandle(id, handle) });
      }
      return out;
    } catch (error: any) {
      if (error?.name === 'AbortError') return [];
      // Cualquier otro tropiezo cae al camino de la copia.
    }
  }
  const files = await new Promise<File[]>((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (value: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    input.onchange = () => finish(Array.from(input.files ?? []));
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener(
      'focus',
      () => setTimeout(() => { if (!input.files?.length) finish([]); }, 800),
      { once: true }
    );
    input.click();
  });
  const out: StoredPick[] = [];
  for (const file of files) {
    const id = crypto.randomUUID();
    try {
      out.push({ id, picked: await storeCopy(id, file) });
    } catch {
      /* sin espacio para la copia: se omite ese archivo */
    }
  }
  return out;
}

/**
 * Archivos SOLTADOS sobre la zona de adjuntar. Hay que leer el
 * `DataTransfer` durante el propio evento (después se vacía), así que esta
 * función toma lo necesario en el acto y devuelve una promesa con el resto.
 * Con manejador vivo, el adjunto queda enlazado al archivo real.
 */
export function storeDroppedFiles(transfer: DataTransfer): Promise<StoredPick[]> {
  const items = Array.from(transfer.items ?? []).filter((item) => item.kind === 'file');
  const pending = items.map((item) => ({
    handle: typeof (item as any).getAsFileSystemHandle === 'function' ? ((item as any).getAsFileSystemHandle() as Promise<any>) : null,
    file: item.getAsFile(),
  }));
  return (async () => {
    const out: StoredPick[] = [];
    for (const { handle, file } of pending) {
      const id = crypto.randomUUID();
      try {
        const resolved = handle ? await handle.catch(() => null) : null;
        if (resolved && resolved.kind === 'file') {
          out.push({ id, picked: await storeHandle(id, resolved as FileSystemFileHandle) });
        } else if (file) {
          out.push({ id, picked: await storeCopy(id, file) });
        }
      } catch {
        /* un archivo que no se pudo guardar no impide los demás */
      }
    }
    return out;
  })();
}

interface ResolvedFile {
  file: File;
  live: boolean;
}

/**
 * Lee el archivo adjunto AHORA MISMO. Con manejador vivo devuelve el contenido
 * actual del disco; con copia, la que se guardó. `null` si el permiso se
 * revocó, el archivo se movió o nunca existió.
 */
export async function readAttachment(attachmentId: string): Promise<ResolvedFile | null> {
  const entry = await get(attachmentKey(attachmentId)).catch(() => undefined);
  if (!entry) return null;

  if (entry.kind === 'copy') {
    return {
      file: new File([entry.blob], entry.fileName, { lastModified: entry.lastModified }),
      live: false,
    };
  }

  try {
    const handle: any = entry.handle;
    // El permiso sobrevive a la sesión, pero hay que volver a pedirlo tras
    // reiniciar la app; se hace en silencio y solo si hace falta.
    if (typeof handle.queryPermission === 'function') {
      const status = await handle.queryPermission({ mode: 'read' });
      if (status !== 'granted') {
        const asked = await handle.requestPermission({ mode: 'read' });
        if (asked !== 'granted') return null;
      }
    }
    return { file: await handle.getFile(), live: true };
  } catch {
    return null;
  }
}

/** ¿Está este adjunto en este dispositivo? Sin pedir permisos (verificador de sincronización). */
export async function hasAttachment(attachmentId: string): Promise<boolean> {
  return Boolean(await get(attachmentKey(attachmentId)).catch(() => undefined));
}

/** Olvida el archivo asociado. No borra nada del disco del usuario. */
export async function deleteAttachment(attachmentId: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(attachmentKey(attachmentId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    /* si no se puede borrar el rastro, tampoco pasa nada grave */
  }
}
