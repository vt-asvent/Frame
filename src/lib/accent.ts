// ============================================================
// Color de acento de Frame (Ajustes → Tema), desde la 1.7.3.
//
// Fuente de verdad única de los tokens de color que dependen del acento:
// `--primary`, `--primary-foreground`, `--ring` y `--primary-2` (el segundo
// tono, para degradados y animaciones). La interfaz solo usa esas variables
// (vía Tailwind: `bg-primary`, `text-primary`, `ring`…), así que cambiar de
// acento repinta toda la app sin tocar componentes. La extensión Animaciones
// lee estos mismos tokens con `readAccentTokens()`.
//
// - Cada acento tiene su versión clara y oscura (el oscuro, más luminoso y
//   con texto oscuro encima, para que conserve el contraste).
// - El de marca, azul marino, es el valor por defecto (4-nov-2026).
// - La preferencia es del dispositivo, como el tema claro/oscuro.
// - index.html aplica la hoja guardada (`frameAccentCss`) antes del primer
//   pintado: sin destello del color anterior.
// ============================================================

export type AccentId =
  | 'marino'
  | 'esmeralda'
  | 'clasico'
  | 'violeta'
  | 'rosa'
  | 'coral'
  | 'ambar'
  | 'grafito';

/** Valores HSL sin `hsl()`, como los usa globals.css («H S% L%»). */
interface AccentTone {
  primary: string;
  foreground: string;
  /** Segundo tono del acento: degradados, animaciones, gráficos. */
  second: string;
}

export interface AccentDef {
  id: AccentId;
  /** Nombre en español; la interfaz lo pasa por `tr`. */
  name: string;
  light: AccentTone;
  dark: AccentTone;
}

const NAVY_TEXT = '217 79% 12%';
const WHITE = '0 0% 100%';

export const ACCENTS: readonly AccentDef[] = [
  {
    // Marca: azul marino #0B2A5B (claro) y azul bebé #A7C7F2 (oscuro), con
    // el esmeralda de la flecha del logo como segundo tono.
    id: 'marino',
    name: 'Azul marino',
    light: { primary: '217 79% 20%', foreground: WHITE, second: '158 21% 52%' },
    dark: { primary: '214 74% 80%', foreground: NAVY_TEXT, second: '158 24% 69%' },
  },
  {
    // Esmeralda de marca: #3D7064 en claro (el #6A9E8B no llega al contraste
    // con texto blanco) y #9CC2B4 en oscuro.
    id: 'esmeralda',
    name: 'Esmeralda',
    light: { primary: '165 30% 34%', foreground: WHITE, second: '217 79% 20%' },
    dark: { primary: '158 24% 69%', foreground: NAVY_TEXT, second: '214 74% 80%' },
  },
  {
    // El azul de Frame hasta la 1.7.2, para quien lo prefiera.
    id: 'clasico',
    name: 'Azul clásico',
    light: { primary: '228 88% 62%', foreground: WHITE, second: '197 71% 52%' },
    dark: { primary: '228 100% 73%', foreground: WHITE, second: '197 71% 73%' },
  },
  {
    id: 'violeta',
    name: 'Violeta',
    light: { primary: '262 52% 47%', foreground: WHITE, second: '300 45% 55%' },
    dark: { primary: '262 75% 80%', foreground: '262 50% 14%', second: '300 55% 78%' },
  },
  {
    id: 'rosa',
    name: 'Rosa',
    light: { primary: '336 62% 44%', foreground: WHITE, second: '14 75% 58%' },
    dark: { primary: '336 80% 80%', foreground: '336 60% 14%', second: '14 85% 76%' },
  },
  {
    id: 'coral',
    name: 'Coral',
    light: { primary: '8 66% 46%', foreground: WHITE, second: '35 85% 50%' },
    dark: { primary: '8 85% 75%', foreground: '8 60% 14%', second: '35 90% 70%' },
  },
  {
    id: 'ambar',
    name: 'Ámbar',
    light: { primary: '30 85% 34%', foreground: WHITE, second: '45 90% 45%' },
    dark: { primary: '40 92% 66%', foreground: '30 60% 12%', second: '20 90% 68%' },
  },
  {
    id: 'grafito',
    name: 'Grafito',
    light: { primary: '220 12% 24%', foreground: WHITE, second: '220 10% 50%' },
    dark: { primary: '220 14% 84%', foreground: '220 15% 12%', second: '220 10% 60%' },
  },
];

export const DEFAULT_ACCENT: AccentId = 'marino';
const STORAGE_KEY = 'frameAccent';
/** Hoja ya armada, para que index.html la aplique antes del primer pintado. */
const CSS_KEY = 'frameAccentCss';
const STYLE_ID = 'frame-accent';
const ACCENT_EVENT = 'frame-accent-changed';
/** Aviso dentro de la ventana: la extensión Animaciones repinta con el color nuevo. */
export const ACCENT_CHANGED_EVENT = 'frame:accent-changed';

export function accentById(id: string | null | undefined): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

export function getAccent(): AccentId {
  try {
    return accentById(localStorage.getItem(STORAGE_KEY)).id;
  } catch {
    return DEFAULT_ACCENT;
  }
}

function toneVars(t: AccentTone): string {
  return `--primary:${t.primary};--primary-foreground:${t.foreground};--ring:${t.primary};--primary-2:${t.second};`;
}

/** Hoja de estilo del acento. Los selectores llevan `[data-accent]` para
 *  ganar a `:root` y `.dark` de globals.css, carguen antes o después. */
export function accentCss(id: AccentId): string {
  const a = accentById(id);
  return `html[data-accent]{${toneVars(a.light)}}html.dark[data-accent]{${toneVars(a.dark)}}`;
}

function applyAccent(id: AccentId = getAccent()): void {
  const css = accentCss(id);
  const root = document.documentElement;
  root.dataset.accent = id;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
  try {
    localStorage.setItem(CSS_KEY, css);
  } catch {
    /* sin caché: el primer pintado usará el azul marino de globals.css */
  }
  window.dispatchEvent(new CustomEvent(ACCENT_CHANGED_EVENT, { detail: id }));
}

export function setAccent(id: AccentId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* se aplica igual en esta sesión */
  }
  applyAccent(id);
  void (async () => {
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(ACCENT_EVENT, id);
    } catch {
      /* fuera de Tauri basta con el evento 'storage' */
    }
  })();
}

/** Valores efectivos ahora mismo (según claro/oscuro), como `hsl(...)`.
 *  Para lienzos y animaciones que no pueden usar variables CSS. */
export function readAccentTokens(): { primary: string; foreground: string; second: string } {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => `hsl(${css.getPropertyValue(name).trim()})`;
  return { primary: v('--primary'), foreground: v('--primary-foreground'), second: v('--primary-2') };
}

/** Una vez al arrancar EN CADA VENTANA (lo llama `initTheme`). */
export function initAccent(): void {
  applyAccent();
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyAccent();
  });
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<string>(ACCENT_EVENT, (event) => applyAccent(accentById(event.payload).id));
    } catch {
      /* fuera de Tauri no hay ventanas hermanas */
    }
  })();
}
