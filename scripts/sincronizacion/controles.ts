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
  /** Cómo va la sincronización (sync-status.ts): lo que enseña el verificador. */
  getSyncStatus?: () => { phase: string; lastError: string | null; failures: number };
  /** Mover playlists en el menú, como CourseContext (lib/playlist-order.ts, 1.7.3). */
  reorderPlaylists?: (list: unknown[], orderedIds: string[]) => unknown[];
  /** Imágenes de asignaturas, colecciones y playlists (image-refs.ts). */
  images?: {
    startImageRefs: (uid: string) => () => void;
    setEntityImage: (uid: string, key: string, dataUrl: string | null, source?: { native: string; crop?: number[]; out?: number[] }) => Promise<void>;
    getImageRecord: (key: string) => Promise<{ dataUrl: string; recipe?: string } | null>;
    updatedEvent: string;
  };
  /** Ajustes → Dispositivos (devices.ts, 1.9.2) y el verificador que le da «lo que falta». */
  devices?: {
    startDevices: (uid: string) => () => void;
    startSyncCheck: (uid: string) => () => void;
    getDevices: () => { rows: { device_id: string }[] | null; failed: boolean; cloudAt: string | null; skew: number };
    stateOf: (row: never, known: never, self?: string) => string;
    agoMs: (iso: string | null | undefined, skew: number) => number;
    setDevicesOpen: (open: boolean) => void;
    repairAllDevices: () => Promise<boolean>;
    markDeviceUnlinked: () => Promise<void>;
    forgetDevice: (id: string) => Promise<boolean>;
    deviceId: () => string;
    /** Las canciones que este equipo tiene (lo publica el estado de la música, CourseContext). */
    setLibraryIds: (ids: string[]) => void;
    syncNowEvent: string;
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
  let stopDevices: (() => void) | null = null;
  let stopCheck: (() => void) | null = null;
  /** Veces que este equipo recibió «sincroniza todo ya» (el botón, «Corregir» o el empujón de devices.ts). */
  let syncNows = 0;
  if (engine.devices) addEventListener(engine.devices.syncNowEvent, () => (syncNows += 1));

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
      stopDevices?.();
      stopDevices = null;
      stopCheck?.();
      stopCheck = null;
    },
    /** Ajustes → Dispositivos. Sin el módulo (versiones anteriores), null. */
    devices: engine.devices
      ? {
          /** Como layout.tsx: el verificador y los latidos, junto a la sincronización. */
          start() {
            stopCheck ??= engine.devices!.startSyncCheck(uid);
            stopDevices ??= engine.devices!.startDevices(uid);
          },
          stop() {
            stopDevices?.();
            stopDevices = null;
            stopCheck?.();
            stopCheck = null;
          },
          id: () => engine.devices!.deviceId(),
          /** La tarjeta de Ajustes entra o sale de la pantalla. */
          open: (open: boolean) => engine.devices!.setDevicesOpen(open),
          /** Lo que pintaría la tarjeta: cada fila con su estado y hace cuánto se la vio. */
          view() {
            const known = engine.devices!.getDevices();
            const self = engine.devices!.deviceId();
            return {
              failed: known.failed,
              cloudAt: known.cloudAt,
              skew: known.skew,
              rows:
                known.rows?.map((row) => ({
                  ...row,
                  self: row.device_id === self,
                  state: engine.devices!.stateOf(row as never, known as never, self),
                  seenAgo: engine.devices!.agoMs((row as { last_seen?: string }).last_seen, known.skew),
                })) ?? null,
            };
          },
          repair: () => engine.devices!.repairAllDevices(),
          unlink: () => engine.devices!.markDeviceUnlinked(),
          forget: (id: string) => engine.devices!.forgetDevice(id),
          /** La música terminó de cargar con estas canciones (sin llamarlo, «aún cargando»). */
          library: (ids: string[]) => engine.devices!.setLibraryIds(ids),
          syncNows: () => syncNows,
        }
      : null,
    /** Qué equipo es: el navegador se presenta así y la pantalla mide esto. */
    identify(userAgent: string, screen?: [number, number]) {
      (navigator as unknown as { userAgent: string }).userAgent = userAgent;
      if (screen) g.screen = { width: screen[0], height: screen[1] };
    },
    /** Elige una imagen como la interfaz (CoursesGrid, colecciones, playlists). */
    setImage: (key: string, dataUrl: string | null, source?: { native: string; crop?: number[]; out?: number[] }) =>
      engine.images?.setEntityImage(uid, key, dataUrl, source),
    image: (key: string) => engine.images?.getImageRecord(key) ?? Promise.resolve(null),
    imageEvents: () => [...imageEvents],
    sync: () => engine.pushToCloud(uid),
    /** Fase y motivo del último fallo. Sin el módulo (versiones anteriores), null. */
    status: () => engine.getSyncStatus?.() ?? null,
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
