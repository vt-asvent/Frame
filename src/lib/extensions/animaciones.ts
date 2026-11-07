import { useSyncExternalStore } from 'react';
import { extDatabase, extKey, extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import type { AnimationBase, AppearanceContribution } from '@/lib/extensions/manifest';
import { tr } from '@/lib/i18n';

// ============================================================
// Extensión Animaciones (1.7.3): el fondo de la app como un «mod» de
// apariencia, solo en este equipo.
//
//   · Animaciones: las de Frame (Constelación, que vuelve; Olas; Aurora y,
//     desde 1.8.0, Aurora boreal, Matrix ascendente, Tipoaurora y Mosaico) y
//     las variantes que traen los mods. Se eligen una o varias; con varias,
//     se alternan cada día o cada vez que se abre Frame.
//   · Fondo propio: una imagen del usuario (o la de un mod), velada con el
//     color del tema para que todo se siga leyendo. Desde 1.8.0 ocupa solo
//     el área de contenido y el usuario elige qué parte se ve (encuadre).
//   · Barra lateral y cabecera (1.8.0): figuras repetidas, en las dos o en una.
//   · Tipografía (1.8.0): la de los títulos; el resto del texto no cambia.
//   · Color de un mod: se pone ENCIMA del acento elegido en Ajustes (que no
//     se toca ni viaja); al quitar el mod o la extensión, vuelve el de antes.
//
// Todo vive con el prefijo de la extensión (localStorage e IndexedDB), así
// que desinstalarla no deja rastro.
// ============================================================

export const ANIMACIONES = 'frame.animaciones';

export interface AnimationChoice {
  /** El de una animación de Frame ('constelacion', 'matrix'…) o `mod:<id de la extensión>`. */
  id: string;
  name: string;
  base: AnimationBase;
  params: Record<string, number | string>;
  /** La extensión (mod) que la trae; null si es de Frame. */
  from: string | null;
}

export const officialAnimations = (): AnimationChoice[] => [
  { id: 'constelacion', name: tr('Constelación'), base: 'constelacion', params: {}, from: null },
  { id: 'olas', name: tr('Olas'), base: 'olas', params: {}, from: null },
  { id: 'aurora', name: tr('Aurora'), base: 'aurora', params: {}, from: null },
  { id: 'boreal', name: tr('Aurora boreal'), base: 'boreal', params: {}, from: null },
  { id: 'matrix', name: tr('Matrix ascendente'), base: 'matrix', params: {}, from: null },
  { id: 'tipoaurora', name: tr('Tipoaurora'), base: 'tipoaurora', params: {}, from: null },
  { id: 'mosaico', name: tr('Mosaico de figuras'), base: 'mosaico', params: {}, from: null },
];

/** Encuadre de la imagen de fondo: qué parte queda a la vista (0–1) y cuánto se acerca. */
export interface BackgroundFocus {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FOCUS: BackgroundFocus = { x: 0.5, y: 0.5, zoom: 1 };

/** Figuras en la barra lateral y la cabecera. */
export interface ChromeLook {
  pattern: 'none' | 'figuras';
  where: 'ambas' | 'lateral' | 'cabecera';
  /** 0,2–1: cuánto se notan. */
  strength: number;
}

export type HeadingFont = 'poppins' | 'serif' | 'mono' | 'sistema' | 'condensada';

/**
 * Tipografías de los títulos: solo fuentes que ya trae el sistema (Windows y
 * Android), así no hay que descargar nada y, si alguna falta, el navegador
 * pasa a la siguiente de la lista. El texto de la interfaz no cambia.
 */
export const HEADING_FONTS: { id: HeadingFont; stack: string | null }[] = [
  { id: 'poppins', stack: null },
  { id: 'serif', stack: "Georgia, 'Noto Serif', 'Droid Serif', 'Times New Roman', serif" },
  { id: 'sistema', stack: "system-ui, 'Segoe UI', Roboto, 'Noto Sans', sans-serif" },
  { id: 'condensada', stack: "Bahnschrift, 'Roboto Condensed', 'Arial Narrow', sans-serif-condensed, sans-serif" },
  { id: 'mono', stack: "'Cascadia Code', Consolas, 'Roboto Mono', 'Droid Sans Mono', ui-monospace, monospace" },
];

export const headingFontName = (id: HeadingFont): string =>
  id === 'serif' ? tr('Clásica') : id === 'sistema' ? tr('Del sistema') : id === 'condensada' ? tr('Estrecha') : id === 'mono' ? tr('Monoespaciada') : 'Poppins';

export interface LookSettings {
  /** Las animaciones elegidas (vacío: ninguna). */
  chosen: string[];
  /** Con varias elegidas: cuándo se cambia de una a otra. */
  rotate: 'day' | 'open';
  /** 0,2–1: cuánto se nota. */
  intensity: number;
  /** 0,5–1,6: lo deprisa que va. */
  speed: number;
  background: { source: 'own' | string; dim: number; blur: boolean; focus?: BackgroundFocus } | null;
  /** El mod cuyo color se usa (null: el acento de Ajustes). */
  accentFrom: string | null;
  chrome: ChromeLook;
  headingFont: HeadingFont;
}

export const DEFAULT_CHROME: ChromeLook = { pattern: 'none', where: 'ambas', strength: 0.5 };

export const DEFAULT_LOOK: LookSettings = {
  chosen: ['constelacion'],
  rotate: 'day',
  intensity: 0.6,
  speed: 1,
  background: null,
  accentFrom: null,
  chrome: DEFAULT_CHROME,
  headingFont: 'poppins',
};

/** El velo mínimo sobre una imagen de fondo: por debajo, el texto pierde. */
export const MIN_DIM = 0.55;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ------------------------------------------------------------
// Ajustes (con aviso a quien los muestra)
// ------------------------------------------------------------

let cache: LookSettings | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function readLook(): LookSettings {
  if (!cache) {
    const saved = extRead<Partial<LookSettings>>(ANIMACIONES, 'settings', {});
    const look: LookSettings = { ...DEFAULT_LOOK, ...saved, chrome: { ...DEFAULT_CHROME, ...(saved.chrome ?? {}) } };
    if (!HEADING_FONTS.some((f) => f.id === look.headingFont)) look.headingFont = 'poppins';
    cache = look;
  }
  return cache;
}

export function setLook(patch: Partial<LookSettings>): void {
  const next = { ...readLook(), ...patch };
  next.intensity = clamp(next.intensity, 0.2, 1);
  next.speed = clamp(next.speed, 0.5, 1.6);
  if (next.background) {
    const focus = next.background.focus;
    next.background = {
      ...next.background,
      dim: clamp(next.background.dim, MIN_DIM, 0.92),
      ...(focus ? { focus: { x: clamp(focus.x, 0, 1), y: clamp(focus.y, 0, 1), zoom: clamp(focus.zoom, 1, 4) } } : {}),
    };
  }
  next.chrome = { ...DEFAULT_CHROME, ...next.chrome, strength: clamp(next.chrome?.strength ?? DEFAULT_CHROME.strength, 0.2, 1) };
  cache = next;
  extWrite(ANIMACIONES, 'settings', next);
  notify();
}

export function useLook(): LookSettings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      const onStorage = (event: StorageEvent) => {
        if (event.key === extKey(ANIMACIONES, 'settings')) {
          cache = null;
          fn();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(fn);
        window.removeEventListener('storage', onStorage);
      };
    },
    readLook,
    readLook
  );
}

// ------------------------------------------------------------
// Qué animación toca ahora
// ------------------------------------------------------------

/** Una por apertura de Frame (cambia al volver a abrir). */
const openSeed = Math.floor(Math.random() * 10_000);

export function pickAnimation(available: AnimationChoice[], look: LookSettings, now = new Date()): AnimationChoice | null {
  const chosen = look.chosen.map((id) => available.find((a) => a.id === id)).filter((a): a is AnimationChoice => !!a);
  if (chosen.length === 0) return null;
  if (chosen.length === 1) return chosen[0];
  const day = Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);
  return chosen[(look.rotate === 'day' ? day : openSeed) % chosen.length];
}

/** Las animaciones de los mods activos, junto a las de Frame. */
export function animationsWith(mods: { id: string; value: AppearanceContribution }[]): AnimationChoice[] {
  const fromMods = mods
    .filter((m) => m.value.animation)
    .map((m) => ({ id: `mod:${m.id}`, name: m.value.animation!.name, base: m.value.animation!.base, params: m.value.animation!.params, from: m.id }));
  return [...officialAnimations(), ...fromMods];
}

/**
 * Lo que de verdad se ve: si un mod elegido está apagado o ya no está, sus
 * elecciones no cuentan (pero se guardan: al volver el mod, vuelven).
 */
export function effectiveLook(look: LookSettings, mods: { id: string; value: AppearanceContribution }[]): LookSettings {
  const has = (id: string, key: keyof AppearanceContribution) => mods.some((m) => m.id === id && m.value[key]);
  return {
    ...look,
    chosen: look.chosen.filter((id) => !id.startsWith('mod:') || has(id.slice(4), 'animation')),
    background: look.background && (look.background.source === 'own' || has(look.background.source, 'background')) ? look.background : null,
    accentFrom: look.accentFrom && has(look.accentFrom, 'accent') ? look.accentFrom : null,
  };
}

/** Parámetros que entiende cada base; lo demás se ignora y todo se acota. */
export interface AnimationParams {
  intensity: number;
  speed: number;
  density: number;
  linkDistance: number;
  /** Tripleta HSL («H S% L%») que sustituye al acento, si el mod la trae. */
  color: string | null;
  color2: string | null;
}

export function resolveParams(choice: AnimationChoice, look: LookSettings): AnimationParams {
  const num = (key: string, fallback: number, min: number, max: number) => {
    const raw = choice.params[key];
    return typeof raw === 'number' ? clamp(raw, min, max) : fallback;
  };
  const col = (key: string) => {
    const raw = choice.params[key];
    return typeof raw === 'string' ? hexToHsl(raw) : null;
  };
  return {
    intensity: clamp(look.intensity * num('intensity', 1, 0.1, 1.5), 0.1, 1),
    speed: clamp(look.speed * num('speed', 1, 0.2, 3), 0.15, 4),
    density: num('density', 1, 0.3, 2),
    linkDistance: num('linkDistance', 150, 60, 260),
    color: col('color'),
    color2: col('color2'),
  };
}

/**
 * Dónde va una imagen que cubre una caja con su encuadre: cubre siempre la
 * caja entera (como `object-fit: cover`), acercada `zoom` veces, y `x`/`y`
 * dicen qué parte queda a la vista (0 = el borde izquierdo o el de arriba,
 * 1 = el derecho o el de abajo). El mismo cálculo sirve para el fondo real y
 * para el encuadre del panel: lo que se elige es lo que se ve.
 */
export function placeCover(natW: number, natH: number, boxW: number, boxH: number, focus: BackgroundFocus = DEFAULT_FOCUS) {
  if (natW <= 0 || natH <= 0 || boxW <= 0 || boxH <= 0) return { left: 0, top: 0, width: boxW, height: boxH };
  const scale = Math.max(boxW / natW, boxH / natH) * clamp(focus.zoom, 1, 4);
  const width = natW * scale;
  const height = natH * scale;
  return { left: (boxW - width) * clamp(focus.x, 0, 1), top: (boxH - height) * clamp(focus.y, 0, 1), width, height };
}

// ------------------------------------------------------------
// Colores
// ------------------------------------------------------------

/** «#RRGGBB» → «H S% L%» (como las variables de globals.css). */
export function hexToHsl(hex: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Luminancia relativa (WCAG) de un «#RRGGBB». */
function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
}

const WHITE = '0 0% 100%';
const NAVY_TEXT = '217 79% 12%';

/** Las variables del acento para un color de mod: el texto encima, el que más contrasta. */
function toneOf(hex: string): string {
  const primary = hexToHsl(hex) ?? '217 79% 20%';
  const [h, s, l] = primary.split(' ').map((v) => parseFloat(v));
  const lum = luminance(hex);
  // Contraste con blanco frente a contraste con el azul casi negro.
  const withWhite = 1.05 / (lum + 0.05);
  const withNavy = (lum + 0.05) / (0.0105 + 0.05);
  const foreground = withWhite >= withNavy ? WHITE : NAVY_TEXT;
  const second = `${Math.round((h + 40) % 360)} ${Math.round(s * 0.55)}% ${Math.round(clamp(l < 50 ? l + 28 : l - 12, 30, 75))}%`;
  return `--primary:${primary};--primary-foreground:${foreground};--ring:${primary};--primary-2:${second};`;
}

const ACCENT_STYLE = 'frame-accent-mod';
/** Hoja ya armada, para que index.html la aplique antes del primer pintado. */
const ACCENT_CACHE = extKey(ANIMACIONES, 'accentCss');

/**
 * Pone (o quita) el color de un mod encima del acento de Ajustes. Los
 * selectores repiten el atributo para ganar a los de lib/accent.ts sin
 * depender del orden de las hojas.
 */
export function applyModAccent(accent: AppearanceContribution['accent'] | null): void {
  const root = document.documentElement;
  let style = document.getElementById(ACCENT_STYLE) as HTMLStyleElement | null;
  if (!accent) {
    style?.remove();
    delete root.dataset.accentMod;
    try {
      localStorage.removeItem(ACCENT_CACHE);
    } catch {
      /* nada guardado */
    }
    window.dispatchEvent(new CustomEvent('frame:accent-changed'));
    return;
  }
  const css = `html[data-accent-mod][data-accent-mod]{${toneOf(accent.light)}}html.dark[data-accent-mod][data-accent-mod]{${toneOf(accent.dark)}}`;
  if (!style) {
    style = document.createElement('style');
    style.id = ACCENT_STYLE;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  root.dataset.accentMod = '1';
  try {
    localStorage.setItem(ACCENT_CACHE, css);
  } catch {
    /* sin caché: el primer pintado usará el acento de Ajustes */
  }
  window.dispatchEvent(new CustomEvent('frame:accent-changed'));
}

// ------------------------------------------------------------
// Imagen de fondo propia (IndexedDB de la extensión)
// ------------------------------------------------------------

const STORE = 'files';
const BACKGROUND = 'background';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(extDatabase(ANIMACIONES), 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const request = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Sube cada vez que cambia la imagen propia (para recargarla). */
let backgroundVersion = 0;
const backgroundListeners = new Set<() => void>();

export function useBackgroundVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      backgroundListeners.add(fn);
      return () => backgroundListeners.delete(fn);
    },
    () => backgroundVersion,
    () => backgroundVersion
  );
}

const bumpBackground = () => {
  backgroundVersion++;
  backgroundListeners.forEach((fn) => fn());
};

export const loadOwnBackground = (): Promise<Blob | null> =>
  withStore<Blob | undefined>('readonly', (s) => s.get(BACKGROUND))
    .then((blob) => blob ?? null)
    .catch(() => null);

const MAX_INPUT = 30 * 1024 * 1024;
const MAX_SIDE = 2560;

/**
 * Guarda una imagen como fondo: a lo sumo 2560 px de lado y en WebP, para
 * que no pese ni frene el arranque.
 */
export async function saveOwnBackground(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) throw new Error(tr('Elige una imagen (JPG, PNG o WebP).'));
  if (file.size > MAX_INPUT) throw new Error(tr('La imagen pesa demasiado (máximo 30 MB).'));
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(tr('No se pudo leer esa imagen.'));
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
  if (!blob) throw new Error(tr('No se pudo preparar la imagen.'));
  await withStore('readwrite', (s) => s.put(blob, BACKGROUND));
  bumpBackground();
}

export async function deleteOwnBackground(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(BACKGROUND)).catch(() => undefined);
  bumpBackground();
}

// Al desinstalar: fuera el color del mod (la caché y la imagen ya las borra
// el borrado de la extensión) y los ajustes vuelven a los de fábrica.
onExtensionTeardown(ANIMACIONES, () => {
  applyModAccent(null);
  cache = { ...DEFAULT_LOOK };
  notify();
  bumpBackground();
});
