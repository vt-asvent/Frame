// ============================================================
// Wire: qué hace cada equipo en cada vuelta del relevo (1.7.3).
//
// Lógica pura, sin red ni almacenamiento (la prueba la ejecuta en Node con un
// Drive falso: scripts/probar-wire.mjs). El relevo:
//
// - Cada equipo publica en Drive su ficha: qué tiene (canciones por su clave;
//   adjuntos, archivos de recursos y, desde la 2.0.0, grabaciones por su id), qué rechazó (lo que el
//   usuario borró aquí: no se le vuelve a traer), qué tiene con corazón y qué
//   fijó, y cuándo se le vio por última vez.
// - Se sube lo que algún otro equipo activo no tiene y no rechazó, y lo que
//   tiene corazón o está fijado (eso queda en Drive para siempre).
// - Cada equipo baja lo que le falta.
// - Cuando TODOS los equipos activos lo tienen (o lo rechazaron) y nadie lo
//   quiere para siempre, se quita de Drive: Drive es un relevo, no un almacén.
//   Si sus bytes siguen en algún equipo se BORRA del todo (1.9.2: en la
//   papelera de Drive seguía ocupando espacio 30 días, y una biblioteca entera
//   pasando por ahí lo llenaba). Si ya nadie lo tiene, la de Drive podría ser
//   la última copia: eso va a la papelera.
// - Un equipo que no aparece desde hace más de una semana deja de esperarse:
//   su ficha se quita y ya no frena el borrado de nada.
// - Si dos equipos suben lo mismo a la vez, queda la copia más antigua y cada
//   uno quita la suya si sobra.
// ============================================================

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ItemKind = 'song' | 'attachment' | 'note' | 'image' | 'recording';

export interface DeviceRecord {
  id: string;
  name: string;
  /** Última vez que se vio (ms). */
  lastSeen: number;
  /** Claves de lo que tiene: canciones («s:…») y archivos («a:…», «n:…»). */
  have: string[];
  /** Lo que el usuario borró en ese equipo: no se le vuelve a traer. */
  declined: string[];
  /** Lo que quiere en Drive para siempre (corazón o fijado). */
  keep: string[];
}

export interface RelayItem {
  /** Id del archivo en Drive. */
  id: string;
  key: string;
  kind: ItemKind;
  /** Equipo que lo subió. */
  from: string;
  permanent: boolean;
  /** Cuándo se subió (ms). */
  created: number;
  name: string;
  size: number;
  /** Huella SHA-256 que calculó Drive: lo que baja se comprueba con ella. */
  sha256?: string;
}

export interface LocalView {
  deviceId: string;
  now: number;
  have: Set<string>;
  declined: Set<string>;
  keep: Set<string>;
  /** Lo que este equipo puede subir (tiene los bytes), con su tipo. */
  uploadable: Map<string, ItemKind>;
}

export interface CyclePlan {
  /** Equipos activos además de este. */
  activeOthers: DeviceRecord[];
  /** Fichas de equipos inactivos más de una semana: se quitan. */
  dropDevices: DeviceRecord[];
  download: RelayItem[];
  upload: { key: string; kind: ItemKind; permanent: boolean }[];
  setPermanent: { item: RelayItem; permanent: boolean }[];
  /** Ya lo tienen todos (o es una copia repetida de este equipo). */
  remove: RelayItem[];
  /** De `remove`, lo que se borra del todo; el resto va a la papelera de Drive. */
  purge: RelayItem[];
  /** Para la vista: qué equipos activos esperan aún cada objeto del relevo. */
  waitingFor: Map<string, string[]>;
}

const byAge = (a: RelayItem, b: RelayItem) => a.created - b.created || a.id.localeCompare(b.id);

export function planCycle(local: LocalView, devices: DeviceRecord[], items: RelayItem[]): CyclePlan {
  const others = devices.filter((d) => d.id !== local.deviceId);
  const activeOthers = others.filter((d) => local.now - d.lastSeen <= WEEK_MS);
  const dropDevices = others.filter((d) => local.now - d.lastSeen > WEEK_MS);
  const sets = activeOthers.map((d) => ({ device: d, have: new Set(d.have), declined: new Set(d.declined), keep: new Set(d.keep) }));

  const wantedForever = (key: string) => local.keep.has(key) || sets.some((s) => s.keep.has(key));
  const settled = (s: { have: Set<string>; declined: Set<string> }, key: string) => s.have.has(key) || s.declined.has(key);

  // Una copia por clave: la más antigua. Las demás, las quita quien las subió.
  const canonical = new Map<string, RelayItem>();
  const remove: RelayItem[] = [];
  const purge: RelayItem[] = [];
  for (const item of [...items].sort(byAge)) {
    if (!canonical.has(item.key)) canonical.set(item.key, item);
    else if (item.from === local.deviceId) {
      // Repetida: la otra copia sigue en Drive.
      remove.push(item);
      purge.push(item);
    }
  }

  const download: RelayItem[] = [];
  const setPermanent: CyclePlan['setPermanent'] = [];
  const waitingFor = new Map<string, string[]>();
  for (const item of canonical.values()) {
    const forever = wantedForever(item.key);
    if (item.permanent !== forever) setPermanent.push({ item, permanent: forever });
    // También lo que subió este mismo equipo (1.9.6): si después perdió sus bytes, es de Drive de
    // donde puede recuperarlos. Antes no lo bajaba nunca y el objeto se quedaba esperándole para siempre.
    if (!local.have.has(item.key) && !local.declined.has(item.key)) download.push(item);
    const waiting = sets.filter((s) => !settled(s, item.key)).map((s) => s.device.id);
    if (!local.have.has(item.key) && !local.declined.has(item.key)) waiting.unshift(local.deviceId);
    waitingFor.set(item.id, waiting);
    // Nadie lo espera y nadie lo quiere para siempre: fuera de Drive.
    if (!forever && waiting.length === 0) {
      remove.push(item);
      // Del todo, solo si sus bytes siguen en algún equipo: entonces la de Drive no
      // es la última copia. Si todos la «rechazaron» (la borraron, o perdieron su
      // base de música), a la papelera, por si acaso.
      const held = local.have.has(item.key) || sets.some((s) => s.have.has(item.key));
      if (held) purge.push(item);
    }
  }

  const upload: CyclePlan['upload'] = [];
  for (const [key, kind] of local.uploadable) {
    if (canonical.has(key)) continue;
    const forever = wantedForever(key);
    const someoneNeeds = sets.some((s) => !settled(s, key));
    if (forever || someoneNeeds) upload.push({ key, kind, permanent: forever });
  }

  return { activeOthers, dropDevices, download, upload, setPermanent, remove, purge, waitingFor };
}

/**
 * Lo que el usuario borró aquí desde la vuelta anterior: estaba (`known`) y
 * ya no está. Lo que vuelve a estar deja de estar rechazado.
 */
export function updateDeclined(known: Set<string>, have: Set<string>, declined: Set<string>): Set<string> {
  const next = new Set(declined);
  for (const key of known) if (!have.has(key)) next.add(key);
  for (const key of have) next.delete(key);
  return next;
}
