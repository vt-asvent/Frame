import { invoke, isTauri } from '@tauri-apps/api/core';
import type { PickedSource } from '@/lib/music-import';
import type { FolderHint } from './manifest';

// ============================================================
// Lo que las extensiones piden al núcleo nativo (src-tauri/src/extensions.rs):
// la carpeta de una fuente de música y las llaves cifradas con DPAPI. Todo
// queda en la carpeta de la extensión y `ext_forget` lo borra al desinstalar.
// ============================================================

/** Elige la carpeta de descargas de una fuente; devuelve su nombre (null si se canceló). */
export const pickSourceFolder = (ext: string, hint?: FolderHint): Promise<string | null> =>
  invoke<string | null>('ext_music_folder_pick', { ext, hintBase: hint?.base ?? null, hintPath: hint?.path ?? null });

/** Nombre de la carpeta elegida (null: aún no hay o ya no existe). */
export const sourceFolder = (ext: string): Promise<string | null> =>
  isTauri() ? invoke<string | null>('ext_music_folder', { ext }).catch(() => null) : Promise.resolve(null);

/** Lo que hay ahora en esa carpeta, listo para importarlo. */
export const scanSourceFolder = (ext: string): Promise<PickedSource | null> => invoke<PickedSource | null>('ext_music_folder_scan', { ext });

export const setSecret = (ext: string, name: string, value: string): Promise<void> => invoke('ext_secret_set', { ext, name, value });

export const getSecret = (ext: string, name: string): Promise<string | null> =>
  isTauri() ? invoke<string | null>('ext_secret_get', { ext, name }).catch(() => null) : Promise.resolve(null);

export const deleteSecret = (ext: string, name: string): Promise<void> =>
  isTauri() ? invoke<void>('ext_secret_delete', { ext, name }).catch(() => undefined) : Promise.resolve();
