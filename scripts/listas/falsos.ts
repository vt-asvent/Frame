// Lo que el código de Música → Añadir usa del resto de Frame, reducido a lo
// que su prueba necesita simular u observar (scripts/probar-listas.mjs).
// Sustituye a @tauri-apps/api/core, react, lib/i18n, lib/extensions/engine-app,
// lib/music-import, lib/music-db, lib/telemetry, lib/supabase/client y lib/nube.

interface Probe {
  /** Lo que contesta el núcleo nativo a `playlist_page`. */
  page: (url: string, body: string | null) => { url: string; status: number; body: string };
  /** Lo guardado en IndexedDB (traducciones, índice de lo descargado). */
  images: Map<string, string>;
  /** Eventos de las métricas. */
  events: { event: string; props: Record<string, unknown> }[];
  /** ¿Queda sitio en el equipo para guardar canciones? */
  storage: 'ok' | 'full';
  songs: number;
  lang: string;
  /** La sesión de Supabase: true, false (sin entrar) o null (sin nube). */
  session: boolean | null;
  /** La nube de Frame (traducción de letras). */
  nube: (url: string, init: RequestInit) => Promise<Response>;
}

const probe = (globalThis as unknown as { __lista: Probe }).__lista;

// ---------- @tauri-apps/api/core ----------
export const isTauri = () => true;

export async function invoke<T>(command: string, args: { url: string; body?: string | null }): Promise<T> {
  if (command === 'playlist_page') return probe.page(args.url, args.body ?? null) as T;
  throw new Error(`comando sin simular: ${command}`);
}

// ---------- lib/i18n ----------
/** El texto en español es la clave: se devuelve con sus variables puestas. */
export const tr = (text: string, vars?: Record<string, unknown>): string =>
  vars ? text.replace(/\{(\w+)\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole)) : text;
export const getLang = (): string => probe.lang;
export const useLang = getLang;
export const decimalText = (value: number, digits = 1): string => value.toFixed(digits).replace('.', ',');
export const errorText = (error: unknown): string => String((error as { message?: unknown } | null)?.message ?? error ?? '');

// ---------- react ----------
// (La cola se lee con `useDownloads()`: aquí devuelve el estado del momento.)
export const useSyncExternalStore = <T>(_subscribe: unknown, get: () => T): T => get();
export const useEffect = (): void => undefined;
export const useMemo = <T>(make: () => T): T => make();
export const useState = <T>(initial: T | (() => T)): [T, () => void] => [typeof initial === 'function' ? (initial as () => T)() : initial, () => undefined];

// ---------- lib/extensions/engine-app ----------
export const MIN_ENGINE = '1.0.0';
export const versionBelow = () => false;
export const ensureEngine = async () => 'up';

// ---------- lib/music-db ----------
export const getImage = async (key: string): Promise<string | null> => probe.images.get(key) ?? null;
export const saveImage = async (key: string, value: string): Promise<void> => void probe.images.set(key, value);
export const deleteImage = async (key: string): Promise<void> => void probe.images.delete(key);

// ---------- lib/telemetry ----------
export const trackEvent = (event: string, props: Record<string, unknown> = {}): void => void probe.events.push({ event, props });

// ---------- lib/music-import ----------
// El «archivo» que entrega el programa de mentira es un JSON con el título, el
// artista y la duración de la canción: con eso entra en la biblioteca.
interface FakeSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  fileName: string;
}
interface FakePlan {
  entries: { name: string; bytes: ArrayBuffer }[];
  existing: Map<string, string>;
}

export const memorySource = (folder: string, files: { name: string; bytes: ArrayBuffer }[]) => ({ folder, files });
export const releaseMemorySource = (): void => undefined;

export async function planMusicImport(source: { files: { name: string; bytes: ArrayBuffer }[] }, library: FakeSong[]): Promise<FakePlan> {
  const existing = new Map<string, string>();
  const entries: FakePlan['entries'] = [];
  for (const file of source.files) {
    const had = library.find((song) => song.fileName === file.name);
    if (had) existing.set(file.name, had.id);
    else entries.push(file);
  }
  return { entries, existing };
}

export async function storeImportedSongs(
  plan: FakePlan,
  _library: FakeSong[],
  _progress: () => void,
  add: (songs: FakeSong[]) => Promise<void>,
  cancelled: () => boolean
) {
  const outcome: { imported: number; lyrics: number; covers: number; cancelled: boolean; skipped: { name: string; reason: string }[]; stoppedFor?: string } = {
    imported: 0,
    lyrics: 0,
    covers: 0,
    cancelled: false,
    skipped: [],
  };
  for (const entry of plan.entries) {
    if (cancelled()) break;
    if (probe.storage === 'full') {
      outcome.stoppedFor = 'el disco del equipo se quedó sin espacio';
      break;
    }
    const meta = JSON.parse(new TextDecoder().decode(entry.bytes)) as { title: string; artist: string; duration: number };
    probe.songs += 1;
    await add([{ id: `cancion-${probe.songs}`, title: meta.title, artist: meta.artist, duration: meta.duration, fileName: entry.name }]);
    outcome.imported += 1;
  }
  return outcome;
}

// ---------- lib/supabase/client ----------
export const isSupabaseConfigured = true;
export const getSupabase = () =>
  probe.session === null ? null : { auth: { getSession: async () => ({ data: { session: probe.session ? { access_token: 'llave-de-prueba' } : null } }) } };

// ---------- lib/nube ----------
export const NUBE = 'https://nube.prueba';
export const nubeFetch = (url: string, init: RequestInit): Promise<Response> => probe.nube(url, init);
