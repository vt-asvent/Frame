// ============================================================
// Mandos de un dispositivo simulado: lo que el probador puede hacer en él
// (escribir como lo haría la interfaz, arrancar o parar la sincronización en
// vivo, cortar la red, ocultar la ventana…). Se publica como `frame` en el
// contexto del dispositivo.
// ============================================================

interface Engine {
  version: string;
  startLiveSync: (uid: string) => () => void;
  pushToCloud: (uid: string) => Promise<unknown>;
  collectLocalData: (uid: string) => Record<string, unknown>;
  rememberSongKeys?: (uid: string, songs: { id: string; title: string; artist?: string; fileName: string }[]) => void;
  localizePlaylists?: (uid: string) => boolean;
  /** Mover playlists en el menú, como CourseContext (lib/playlist-order.ts, 1.7.3). */
  reorderPlaylists?: (list: unknown[], orderedIds: string[]) => unknown[];
  /** Imágenes de asignaturas, colecciones y playlists (image-refs.ts). */
  images?: {
    startImageRefs: (uid: string) => () => void;
    setEntityImage: (uid: string, key: string, dataUrl: string | null, source?: { native: string; crop?: number[]; out?: number[] }) => Promise<void>;
    getImageRecord: (key: string) => Promise<{ dataUrl: string; recipe?: string } | null>;
    updatedEvent: string;
  };
}

interface FakeDocument {
  visibilityState: string;
  dispatchEvent(event: Event): boolean;
}

export function expose(engine: Engine) {
  const g = globalThis as unknown as Record<string, unknown>;
  const uid = g.__uid as string;
  const scoped = (name: string) => `${name}_${uid}`;
  let stop: (() => void) | null = null;
  let stopImages: (() => void) | null = null;
  /** Avisos de «cambió una imagen» que vio la interfaz (useStoredImage). */
  const imageEvents: string[] = [];
  if (engine.images) addEventListener(engine.images.updatedEvent, (event) => imageEvents.push((event as CustomEvent<{ key: string }>).detail.key));

  g.frame = {
    version: engine.version,
    start() {
      stop ??= engine.startLiveSync(uid);
      // Como layout.tsx: las referencias de las imágenes, junto a la sincronización.
      if (engine.images) stopImages ??= engine.images.startImageRefs(uid);
    },
    stop() {
      stop?.();
      stop = null;
      stopImages?.();
      stopImages = null;
    },
    /** Elige una imagen como la interfaz (CoursesGrid, colecciones, playlists). */
    setImage: (key: string, dataUrl: string | null, source?: { native: string; crop?: number[]; out?: number[] }) =>
      engine.images?.setEntityImage(uid, key, dataUrl, source),
    image: (key: string) => engine.images?.getImageRecord(key) ?? Promise.resolve(null),
    imageEvents: () => [...imageEvents],
    sync: () => engine.pushToCloud(uid),
    /** Escribe como la interfaz: por localStorage (lo vigila la sincronización en vivo). */
    put(name: string, value: unknown) {
      localStorage.setItem(scoped(name), JSON.stringify(value));
    },
    get(name: string) {
      const raw = localStorage.getItem(scoped(name));
      return raw === null ? undefined : JSON.parse(raw);
    },
    remove(name: string) {
      localStorage.removeItem(scoped(name));
    },
    /** Los datos tal como viajan (las canciones de las playlists, por su clave). */
    cloudForm: () => engine.collectLocalData(uid),
    songs(list: { id: string; title: string; artist?: string; fileName: string }[]) {
      engine.rememberSongKeys?.(uid, list);
    },
    /** Mover playlists en el menú. Sin la función (versiones anteriores), null. */
    reorderPlaylists(list: unknown[], orderedIds: string[]) {
      return engine.reorderPlaylists ? engine.reorderPlaylists(list, orderedIds) : null;
    },
    /** Lo que hace el estado de la música al terminar de cargar (CourseContext). */
    localize: () => engine.localizePlaylists?.(uid) ?? false,
    setOnline(online: boolean) {
      (navigator as unknown as { onLine: boolean }).onLine = online;
      if (online) dispatchEvent(new Event('online'));
    },
    setVisible(visible: boolean) {
      const doc = document as unknown as FakeDocument;
      doc.visibilityState = visible ? 'visible' : 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    },
    reported: () => (g.__reported as unknown[] | undefined) ?? [],
  };
}
