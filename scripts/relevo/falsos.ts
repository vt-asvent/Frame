// Lo que el relevo de Wire llama de otras partes de Frame, simulado para
// scripts/probar-relevo.mjs. Todo lee del objeto `__equipo` que la prueba pone
// en el contexto de cada equipo: su biblioteca, su audio, sus adjuntos, sus
// imágenes, su llave y su red. El relevo (relay.ts), el cliente de Drive
// (drive.ts), las reglas (plan.ts), los borrados (removed.ts) y las claves de
// las canciones (song-keys.ts) son los de verdad.

interface Equipo {
  nombre: string;
  audio: Map<string, Blob>;
  audioLegible: boolean;
  letras: Map<string, unknown>;
  adjuntos: Map<string, File>;
  imagenes: Map<string, { dataUrl: string; at: number }>;
  refs: { id: string; kind: 'native' | 'own' | 'none'; h?: string; at: number }[];
  llaves: Map<string, string>;
  llaveLegible: boolean;
  google: { renovar: (token: string) => Promise<{ accessToken: string; expiresAt: number }> };
  enviar: (mensaje: Record<string, unknown>) => void;
  fallaGuardar: boolean;
}

const equipo = (): Equipo => (globalThis as unknown as { __equipo: Equipo }).__equipo;

// --- react ---
export const useSyncExternalStore = <T>(_subscribe: unknown, getSnapshot: () => T): T => getSnapshot();

// --- @/lib/i18n ---
export const tr = (text: string, params?: Record<string, unknown>): string => text.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
export const trc = tr;

// --- @/lib/enum-labels ---
export const UNKNOWN_ARTIST = 'Desconocido';

// --- @/lib/capped-fetch ---
export const cappedFetchWith = () => (url: string, init?: RequestInit) => fetch(url, init);

// --- @/lib/extensions/store ---
export const extKey = (id: string, name: string) => `frameExt:${id}:${name}`;
export function extRead<T>(id: string, name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(extKey(id, name));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
export function extWrite(id: string, name: string, value: unknown): void {
  try {
    if (value === undefined || value === null) localStorage.removeItem(extKey(id, name));
    else localStorage.setItem(extKey(id, name), JSON.stringify(value));
  } catch {
    /* lleno o bloqueado */
  }
}
export const onExtensionTeardown = () => undefined;

// --- @/lib/google/auth ---
export async function authorizeDrive(): Promise<{ email: string; accessToken: string; refreshToken: string; expiresAt: number }> {
  throw new Error('la prueba conecta con confirmDriveAccount');
}
export const refreshGoogleAccess = (token: string) => equipo().google.renovar(token);
export const revokeGoogleToken = async () => undefined;

// --- ./platform ---
export const readSongFile = async (song: { id: string }): Promise<Blob | undefined> => equipo().audio.get(song.id);
export async function audioPresent(songs: { id: string }[]): Promise<Set<string>> {
  if (!equipo().audioLegible) throw new Error('almacén sin leer');
  return new Set(songs.filter((song) => equipo().audio.has(song.id)).map((song) => song.id));
}
export async function storeSongFile(song: { id: string }, file: File): Promise<void> {
  if (equipo().fallaGuardar) throw new Error('sin espacio');
  equipo().audio.set(song.id, file);
}
export const thisDeviceName = async () => equipo().nombre;
export const setSecret = async (_ext: string, name: string, value: string) => void equipo().llaves.set(name, value);
export const getSecret = async (_ext: string, name: string) => (equipo().llaveLegible ? (equipo().llaves.get(name) ?? null) : null);
export const deleteSecret = async (_ext: string, name: string) => void equipo().llaves.delete(name);

// --- @/lib/music-db ---
export const getImage = async (key: string): Promise<string | null> => equipo().imagenes.get(key)?.dataUrl ?? null;
export const getImageRecord = async (key: string) => equipo().imagenes.get(key) ?? null;
export const saveImage = async (key: string, dataUrl: string, options: { at?: number } = {}) => void equipo().imagenes.set(key, { dataUrl, at: options.at ?? Date.now() });
export const listRecordingAudioIds = async (): Promise<Set<string>> => new Set(equipo().grabaciones.keys());
export const getRecordingAudio = async (id: string): Promise<Blob | undefined> => equipo().grabaciones.get(id);
export const saveRecordingAudio = async (id: string, blob: Blob) => void equipo().grabaciones.set(id, blob);

// --- @/lib/image-refs ---
export const readImageRefs = () => equipo().refs;
export const isEntityImageKey = (id: string) => /^(courseImage|spaceImage|playlistImage)_/.test(id);
export const entityOfImage = (_uid: string, id: string) => ({ name: id });
export const reconcileImageRefs = async () => undefined;

// --- @/lib/profile-scope ---
export async function fingerprint(dataUrl: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(dataUrl));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

// --- @/lib/lyrics ---
export const storedLyrics = async (songId: string) => equipo().letras.get(songId) ?? null;
export const importLyrics = async (songId: string, lyrics: unknown) => void equipo().letras.set(songId, lyrics);

// --- @/lib/file-handles ---
export const hasAttachment = async (id: string) => equipo().adjuntos.has(id);
export const readAttachment = async (id: string) => {
  const file = equipo().adjuntos.get(id);
  return file ? { file } : null;
};
export const storeAttachmentCopy = async (id: string, file: File) => void equipo().adjuntos.set(id, file);

// --- @/lib/sync-peers ---
export const sendPeerMessage = (message: Record<string, unknown>) => equipo().enviar(message);

// --- @/lib/sync-status ---
export const SYNC_RECHECK_EVENT = 'frame:sync-recheck';
