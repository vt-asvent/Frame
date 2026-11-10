import { deleteImage, getImageRecord, saveImage } from '@/lib/music-db';
import { fingerprint } from '@/lib/profile-scope';
import { nativePictureToDataUrl } from '@/lib/native-pictures';
import { CLOUD_APPLIED_EVENT } from '@/lib/supabase/sync';
import { logNotification } from '@/lib/notification-log';
import { inBothLangs, tr } from '@/lib/i18n';

// ============================================================
// Imágenes de asignaturas, colecciones y playlists entre dispositivos (1.6.8).
//
// Pedido de Diego: que viaje un CÓDIGO y no la imagen entera, y que las
// imágenes propias no se actualicen en el otro dispositivo (con un aviso que
// explique por qué). Así:
//
//   · De la galería de Frame: viaja su ruta y el encuadre elegido (en
//     fracciones de la imagen) y el tamaño del resultado. El otro dispositivo
//     la recorta igual a partir de su propia copia de la galería. Pesa unos
//     cien bytes en lugar de cientos de kilobytes.
//   · Propia (subida por el usuario): se queda en su dispositivo. Viaja solo
//     una huella, para que el otro sepa que allí hay otra imagen y lo diga
//     (aviso en la campana y verificador de sincronización).
//   · Quitada: se quita también en los demás.
//
// Las referencias viven en `imageRefs_<uid>` (una colección: cada imagen se
// fusiona por separado). La foto de perfil y la del horario siguen viajando
// enteras por la nube privada de la cuenta (image-sync.ts).
// ============================================================

export interface ImageSource {
  /** Ruta de la imagen de la galería («/native_pictures/…»). */
  native: string;
  /** Encuadre en fracciones de la imagen: x, y, ancho y alto. */
  crop?: [number, number, number, number];
  /** Tamaño del resultado en píxeles. */
  out?: [number, number];
}

export interface ImageRef {
  /** Clave de la imagen: courseImage_<id>, spaceImage_<id> o playlistImage_<id>. */
  id: string;
  kind: 'native' | 'own' | 'none';
  src?: string;
  crop?: [number, number, number, number];
  out?: [number, number];
  /** Huella de la imagen propia (no viaja la imagen). */
  h?: string;
  /** Cuándo se eligió (ms). */
  at: number;
}

const ENTITY_IMAGES: [prefix: string, collection: string][] = [
  ['courseImage_', 'courses'],
  ['spaceImage_', 'spaces'],
  ['playlistImage_', 'playlists'],
];

export const isEntityImageKey = (key: string) => ENTITY_IMAGES.some(([prefix]) => key.startsWith(prefix));

const refsKey = (uid: string) => `imageRefs_${uid}`;
const notifiedKey = (uid: string) => `imageRefsNotified_${uid}`;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function readImageRefs(uid: string): ImageRef[] {
  const list = readJson<unknown>(refsKey(uid), []);
  return Array.isArray(list) ? list.filter((ref): ref is ImageRef => !!ref && typeof (ref as ImageRef).id === 'string') : [];
}

function writeRef(uid: string, ref: ImageRef): void {
  const refs = readImageRefs(uid).filter((other) => other.id !== ref.id);
  try {
    localStorage.setItem(refsKey(uid), JSON.stringify([...refs, ref]));
  } catch {
    /* sin espacio: la imagen vale en este dispositivo */
  }
}

/** La receta de una imagen de la galería: se guarda junto a la imagen. */
const recipeOf = (ref: Pick<ImageRef, 'src' | 'crop' | 'out'>) =>
  JSON.stringify({ src: ref.src ?? null, crop: ref.crop ?? null, out: ref.out ?? null });

/**
 * Guarda la imagen de una asignatura, colección o playlist y anota su
 * referencia para los demás dispositivos. `source`: de la galería de Frame
 * (con su encuadre); sin él, la imagen es propia. `null` la quita.
 */
export async function setEntityImage(uid: string | null | undefined, key: string, dataUrl: string | null, source?: ImageSource): Promise<void> {
  const ref: Omit<ImageRef, 'kind'> = { id: key, at: Date.now() };
  if (!dataUrl) {
    await deleteImage(key);
    if (uid && isEntityImageKey(key)) writeRef(uid, { ...ref, kind: 'none' });
    return;
  }
  if (source) {
    const native: ImageRef = { ...ref, kind: 'native', src: source.native, crop: source.crop, out: source.out };
    await saveImage(key, dataUrl, { recipe: recipeOf(native) });
    if (uid && isEntityImageKey(key)) writeRef(uid, native);
    return;
  }
  await saveImage(key, dataUrl);
  if (uid && isEntityImageKey(key)) writeRef(uid, { ...ref, kind: 'own', h: await fingerprint(dataUrl) });
}

/** Vuelve a hacer el encuadre de una imagen de la galería a partir de la copia de este dispositivo. */
async function renderRecipe(ref: ImageRef): Promise<string | null> {
  if (!ref.src || !ref.src.startsWith('/native_pictures/')) return null;
  if (!ref.crop || !ref.out) return nativePictureToDataUrl(ref.src).catch(() => null);
  const image = await new Promise<HTMLImageElement | null>((resolve) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => resolve(null);
    element.src = ref.src!;
  });
  if (!image) return null;
  const [x, y, w, h] = ref.crop;
  const [outW, outH] = ref.out;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(outW));
  canvas.height = Math.max(1, Math.round(outH));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingQuality = 'high';
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  ctx.drawImage(image, x * iw, y * ih, w * iw, h * ih, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Nombre de la asignatura, colección o playlist de una imagen (para los avisos). */
export function entityOfImage(uid: string, key: string): { name: string; where: string; route: string } | null {
  for (const [prefix, collection] of ENTITY_IMAGES) {
    if (!key.startsWith(prefix)) continue;
    const id = key.slice(prefix.length);
    const rows = readJson<{ id?: string; name?: string }[]>(`${collection}_${uid}`, []);
    const row = Array.isArray(rows) ? rows.find((item) => item?.id === id) : undefined;
    if (!row?.name) return null;
    if (collection === 'playlists') return { name: row.name, where: tr('Música'), route: `/playlists?id=${encodeURIComponent(id)}` };
    // Las colecciones viven en la interfaz de Asignaturas.
    return { name: row.name, where: tr('Asignaturas'), route: '/knowledge' };
  }
  return null;
}

export interface ImageRefsReport {
  /** Imágenes propias de otro dispositivo, distintas de la de aquí. */
  ownElsewhere: ImageRef[];
  /** De la galería, pero esta versión no la tiene (una más nueva de Frame). */
  missing: ImageRef[];
}

let lastReport: ImageRefsReport = { ownElsewhere: [], missing: [] };
export const imageRefsReport = () => lastReport;
/** Cambió lo que el verificador de sincronización dice de las imágenes. */
export const IMAGE_REFS_EVENT = 'frame:image-refs';

/** Pone las imágenes de aquí al día con las referencias que llegaron. */
export async function reconcileImageRefs(uid: string): Promise<ImageRefsReport> {
  const report: ImageRefsReport = { ownElsewhere: [], missing: [] };
  const notified = new Set(readJson<string[]>(notifiedKey(uid), []));
  let notifiedChanged = false;
  for (const ref of readImageRefs(uid)) {
    if (!isEntityImageKey(ref.id)) continue;
    const local = await getImageRecord(ref.id).catch(() => null);
    if (ref.kind === 'none') {
      if (local) await deleteImage(ref.id, { fromSync: true }).catch(() => undefined);
      continue;
    }
    if (ref.kind === 'native') {
      if (local?.recipe === recipeOf(ref)) continue;
      const dataUrl = await renderRecipe(ref);
      if (dataUrl) await saveImage(ref.id, dataUrl, { fromSync: true, at: ref.at, recipe: recipeOf(ref) }).catch(() => undefined);
      else report.missing.push(ref);
      continue;
    }
    // Propia: no viaja. Si aquí hay otra (o ninguna), se dice una vez y queda en el verificador.
    const here = local ? await fingerprint(local.dataUrl) : null;
    if (here === ref.h) continue;
    report.ownElsewhere.push(ref);
    const mark = `${ref.id}#${ref.h}`;
    const entity = entityOfImage(uid, ref.id);
    if (!notified.has(mark) && entity) {
      notified.add(mark);
      notifiedChanged = true;
      const texts = inBothLangs(() => ({
        title: tr('Imagen propia en otro dispositivo'),
        detail: tr('«{name}»: las imágenes que subes viajan con la extensión Wire. Sin Wire, elige una de la galería de Frame para verla en todos.', { name: entity.name }),
      }));
      const shown = texts.es ?? { title: '', detail: '' };
      logNotification({ id: `imagen-propia-${mark}`, kind: 'aviso', title: shown.title, detail: shown.detail, texts, route: entity.route });
    }
  }
  if (notifiedChanged) {
    try {
      localStorage.setItem(notifiedKey(uid), JSON.stringify([...notified].slice(-200)));
    } catch {
      /* se volvería a avisar: mejor que no avisar */
    }
  }
  const changed = JSON.stringify(report) !== JSON.stringify(lastReport);
  lastReport = report;
  // El verificador se recalcula al momento, no en su vuelta de cada 2 min.
  if (changed) window.dispatchEvent(new Event(IMAGE_REFS_EVENT));
  return report;
}

/** Para la cuenta que sincroniza: aplica las referencias al arrancar y cada vez que llegan. */
export function startImageRefs(uid: string, onReport?: (report: ImageRefsReport) => void): () => void {
  let timer: number | null = null;
  let running = false;
  let again = false;
  const run = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      // En dos pasos a propósito: `onReport?.(await …)` no evalúa su argumento
      // si no hay `onReport`, y así (sin él, como lo llama layout.tsx) la 1.6.8
      // nunca rehacía las imágenes que llegaban (Diego, 13-oct-2026).
      const report = await reconcileImageRefs(uid);
      onReport?.(report);
    } catch {
      /* el siguiente aviso lo reintenta */
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(300);
      }
    }
  };
  const schedule = (delay: number) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };
  // Lo que llega se rehace en cuanto llega (varios avisos seguidos: una sola vuelta).
  const onCloud = () => schedule(60);
  window.addEventListener(CLOUD_APPLIED_EVENT, onCloud);
  schedule(1500);
  return () => {
    if (timer !== null) window.clearTimeout(timer);
    window.removeEventListener(CLOUD_APPLIED_EVENT, onCloud);
  };
}
