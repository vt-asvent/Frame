import type { Song } from '@/types';

const DB_NAME = 'AetherMusicDB';
const METADATA_STORE_NAME = 'song_metadata';
const FILES_STORE_NAME = 'song_files';
const IMAGES_STORE_NAME = 'app_images';
const RECORDINGS_STORE_NAME = 'recording_files';
// Bump the version to trigger the DB schema update.
const DB_VERSION = 4;

let db: IDBDatabase | null = null;

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject('Error opening IndexedDB.');
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    // This is where schema changes are made.
    request.onupgradeneeded = (event) => {
      const dbInstance = (event.target as IDBOpenDBRequest).result;
      
      // Create new metadata store if it doesn't exist
      if (!dbInstance.objectStoreNames.contains(METADATA_STORE_NAME)) {
        dbInstance.createObjectStore(METADATA_STORE_NAME, { keyPath: 'id' });
      }

      // Create new files store if it doesn't exist
      if (!dbInstance.objectStoreNames.contains(FILES_STORE_NAME)) {
        dbInstance.createObjectStore(FILES_STORE_NAME, { keyPath: 'id' });
      }
      
      // Create new images store if it doesn't exist
      if (!dbInstance.objectStoreNames.contains(IMAGES_STORE_NAME)) {
        dbInstance.createObjectStore(IMAGES_STORE_NAME, { keyPath: 'key' });
      }

      // Audios de las grabaciones de voz (separado de song_files para que
      // limpiar la música jamás borre una grabación).
      if (!dbInstance.objectStoreNames.contains(RECORDINGS_STORE_NAME)) {
        dbInstance.createObjectStore(RECORDINGS_STORE_NAME, { keyPath: 'id' });
      }

      // Clean up old 'songs' store from previous versions
      if (dbInstance.objectStoreNames.contains('songs')) {
        dbInstance.deleteObjectStore('songs');
      }
    };
  });
};

/** Cierra la conexión abierta a AetherMusicDB. Imprescindible antes de
 *  `indexedDB.deleteDatabase(MUSIC_DB_NAME)`: si queda abierta, el borrado
 *  se queda bloqueado indefinidamente. */
export const closeMusicDB = (): void => {
  try { db?.close(); } catch { /* ya cerrada */ }
  db = null;
};

/** Nombre de la base de datos, para el borrado total de cuenta. */
export const MUSIC_DB_NAME = DB_NAME;

/** Ids de las canciones cuyo audio está guardado (sin leer los audios). */
export const listSongFileIds = async (): Promise<Set<string>> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(FILES_STORE_NAME, 'readonly').objectStore(FILES_STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve(new Set(request.result.map(String)));
    request.onerror = () => reject(request.error);
  });
};

export const addSongFileToDB = async (id: string, file: File): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FILES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(FILES_STORE_NAME);
    const request = store.put({ id, file });

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Error adding song file to DB: ' + request.error);
  });
};

export const getSongFileFromDB = async (id: string): Promise<File | undefined> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FILES_STORE_NAME, 'readonly');
    const store = transaction.objectStore(FILES_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.file);
      } else {
        resolve(undefined);
      }
    };
    request.onerror = () => reject('Error fetching song file from DB: ' + request.error);
  });
};

export const deleteSongFileFromDB = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(FILES_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(FILES_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject('Error deleting song file from DB: ' + request.error);
    });
};

// --- METADATA OPERATIONS ---

export const saveSongMetadata = async (song: Song): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(METADATA_STORE_NAME);
    const request = store.put(song);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(`Error saving metadata for song ${song.id}: ` + request.error);
  });
};

export const getAllSongMetadata = async (): Promise<Song[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(METADATA_STORE_NAME, 'readonly');
    const store = transaction.objectStore(METADATA_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      resolve(request.result || []);
    };
    request.onerror = () => reject('Error fetching all song metadata: ' + request.error);
  });
};

export const deleteSongMetadata = async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(METADATA_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(METADATA_STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject('Error deleting song metadata from DB: ' + request.error);
    });
};

// --- RECORDING AUDIO OPERATIONS ---

export const saveRecordingAudio = async (id: string, blob: Blob): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const request = store.put({ id, blob });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(`Error saving recording ${id}: ` + request.error);
  });
};

export const getRecordingAudio = async (id: string): Promise<Blob | undefined> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result ? request.result.blob : undefined);
    request.onerror = () => reject(`Error fetching recording ${id}: ` + request.error);
  });
};

export const deleteRecordingAudio = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(RECORDINGS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(RECORDINGS_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Error deleting recording audio: ' + request.error);
  });
};

// --- GENERAL IMAGE STORAGE OPERATIONS ---

/**
 * Aviso de que cambió una imagen guardada. La interfaz la relee
 * (`useStoredImage`) y `image-sync.ts` sube las que viajan entre
 * dispositivos. `fromSync`: la trajo la sincronización (no se vuelve a subir).
 */
export const IMAGE_UPDATED_EVENT = 'frame:image-updated';
export interface ImageUpdatedDetail {
  key: string;
  deleted: boolean;
  fromSync: boolean;
}
interface ImageWriteOptions {
  fromSync?: boolean;
  /** Cuándo se hizo el cambio (ms). Por defecto, ahora; la sincronización
   *  conserva la fecha del dispositivo donde se cambió. */
  at?: number;
  /** Imagen de la galería de Frame: su receta (ruta y encuadre), con la que
   *  otro dispositivo la rehace sin que viaje la imagen (image-refs.ts). */
  recipe?: string;
}

const announceImage = (detail: ImageUpdatedDetail) => {
  try {
    window.dispatchEvent(new CustomEvent<ImageUpdatedDetail>(IMAGE_UPDATED_EVENT, { detail }));
  } catch {
    /* fuera del navegador no hay a quién avisar */
  }
};

export const saveImage = async (key: string, dataUrl: string, options: ImageWriteOptions = {}): Promise<void> => {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(IMAGES_STORE_NAME);
    // `at`: cuándo cambió la imagen. Las guardadas antes de la 1.5.5 no lo
    // tienen (y así se sabe que su fecha es desconocida).
    const request = store.put({ key, dataUrl, at: options.at ?? Date.now(), ...(options.recipe ? { recipe: options.recipe } : {}) });

    request.onsuccess = () => resolve();
    request.onerror = () => reject(`Error saving image ${key}: ` + request.error);
  });
  announceImage({ key, deleted: false, fromSync: Boolean(options.fromSync) });
};

/** La imagen con su fecha de cambio (`at` = 0 si es anterior a la 1.5.5) y su receta, si es de la galería. */
export const getImageRecord = async (key: string): Promise<{ dataUrl: string; at: number; recipe?: string } | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(IMAGES_STORE_NAME, 'readonly').objectStore(IMAGES_STORE_NAME).get(key);
    request.onsuccess = () => {
      const row = request.result as { dataUrl?: string; at?: number; recipe?: string } | undefined;
      resolve(
        row?.dataUrl
          ? { dataUrl: row.dataUrl, at: typeof row.at === 'number' ? row.at : 0, ...(typeof row.recipe === 'string' ? { recipe: row.recipe } : {}) }
          : null
      );
    };
    request.onerror = () => reject(`Error fetching image ${key}: ` + request.error);
  });
};

/** Claves de todas las imágenes guardadas, sin cargar las imágenes. */
export const listImageKeys = async (): Promise<string[]> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE_NAME, 'readonly');
    const request = transaction.objectStore(IMAGES_STORE_NAME).getAllKeys();
    request.onsuccess = () => resolve((request.result ?? []).map(String));
    request.onerror = () => reject('Error listing images: ' + request.error);
  });
};

export const getImage = async (key: string): Promise<string | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(IMAGES_STORE_NAME, 'readonly');
    const store = transaction.objectStore(IMAGES_STORE_NAME);
    const request = store.get(key);

    request.onsuccess = () => {
      if (request.result) {
        resolve(request.result.dataUrl);
      } else {
        resolve(null);
      }
    };
    request.onerror = () => reject(`Error fetching image ${key}: ` + request.error);
  });
};

export const deleteImage = async (key: string, options: ImageWriteOptions = {}): Promise<void> => {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(IMAGES_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(IMAGES_STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = () => reject('Error deleting image from DB: ' + request.error);
    });
    announceImage({ key, deleted: true, fromSync: Boolean(options.fromSync) });
};

export const getAllImages = async (): Promise<{key: string, dataUrl: string}[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(IMAGES_STORE_NAME, 'readonly');
        const store = transaction.objectStore(IMAGES_STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result || []);
        };
        request.onerror = () => reject('Error fetching all images: ' + request.error);
    });
};
