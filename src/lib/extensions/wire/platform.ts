import { invoke, isTauri } from '@tauri-apps/api/core';
import { addSongFileToDB, getSongFileFromDB, listSongFileIds } from '@/lib/music-db';
import type { Song } from '@/types';

// ============================================================
// Wire: lo que el relevo pide a ESTE equipo (1.9.6).
//
// `relay.ts`, `drive.ts` y `plan.ts` son los mismos en Windows y en Android.
// Lo único que cambia de una plataforma a otra vive aquí: dónde está el audio
// de una canción, cómo se llama el equipo y dónde se guarda cifrada la llave
// de Drive. En Windows: IndexedDB, el nombre del equipo y DPAPI.
// ============================================================

export { deleteSecret, getSecret, setSecret } from '@/lib/extensions/native';

/** El audio de una canción de la biblioteca (undefined: sus bytes no están aquí). */
export const readSongFile = (song: Song): Promise<Blob | undefined> => getSongFileFromDB(song.id);

/** De estas canciones, las que tienen su audio en este equipo (la ficha sola no cuenta). */
export async function audioPresent(songs: Song[]): Promise<Set<string>> {
  const stored = await listSongFileIds();
  return new Set(songs.filter((song) => stored.has(song.id)).map((song) => song.id));
}

/** Guarda el audio de una canción que llegó de otro equipo. Lanza si no cabe. */
export const storeSongFile = (song: Song, file: File): Promise<void> => addSongFileToDB(song.id, file);

/** Cómo se presenta este equipo a los demás la primera vez (el usuario puede cambiarlo). */
export const thisDeviceName = (): Promise<string> =>
  isTauri() ? invoke<string>('ext_device_name').catch(() => 'Windows') : Promise.resolve('Navegador');
