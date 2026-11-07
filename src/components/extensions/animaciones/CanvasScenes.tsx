import { useLayoutEffect, useRef, type RefObject } from 'react';
import { readTone, useCanvasLoop, type Scene, type Tone } from '@/components/extensions/animaciones/canvas-loop';
import { cn } from '@/lib/utils';

// ============================================================
// Las animaciones de lienzo de 1.8.0 (extensión Animaciones):
//   · Aurora boreal: cortinas de luz con el borde de abajo nítido y rayos
//     verticales que se encienden y se apagan.
//   · Matrix ascendente: columnas de caracteres que suben; la cabeza va más
//     clara y la estela se apaga hacia abajo.
//   · Tipoaurora: una aurora pintada con caracteres; cada letra se ve más o
//     menos según por dónde pasen las cintas de luz.
// Las letras se dibujan una sola vez en una tira («atlas») del color del tema
// y cada fotograma solo las copia: cientos de letras cuestan muy poco. Los
// ajustes (intensidad, velocidad) se leen en cada fotograma, así que mover un
// deslizador no reinicia la animación.
// ============================================================

export interface CanvasSceneProps {
  intensity: number;
  speed: number;
  density: number;
  /** Tripletas HSL de un mod («H S% L%»); null: el acento del tema. */
  color: string | null;
  color2: string | null;
  contained: boolean;
}

type Live = { current: CanvasSceneProps };

const TAU = Math.PI * 2;
const isDark = () => document.documentElement.classList.contains('dark');
const smoothstep = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** El segundo color: el del mod si trae dos; si trae uno, ese mismo más claro; si no, `--primary-2`. */
function secondTone(live: CanvasSceneProps, lift = 0, minSaturation = 0): Tone {
  if (live.color2) return readTone(live.color2, '--primary', lift, minSaturation);
  if (live.color) return readTone(live.color, '--primary', lift + (isDark() ? 16 : -12), minSaturation);
  return readTone(null, '--primary-2', lift, minSaturation);
}

function CanvasLayer({ canvasRef, contained }: { canvasRef: RefObject<HTMLCanvasElement | null>; contained: boolean }) {
  return (
    <div className={cn('pointer-events-none overflow-hidden', contained ? 'absolute inset-0' : 'fixed inset-0 -z-10')} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  );
}

/** Los ajustes del último render, para que la escena los lea sin rehacerse. */
function useLive(props: CanvasSceneProps): Live {
  const live = useRef(props);
  useLayoutEffect(() => {
    live.current = props;
  });
  return live;
}

// ------------------------------------------------------------
// Letras
// ------------------------------------------------------------

/** Katakana de ancho medio, cifras y unos signos. */
const GLYPHS = (() => {
  let text = '';
  for (let code = 0xff66; code <= 0xff9d; code++) text += String.fromCharCode(code);
  return `${text}0123456789:+=*<>|`;
})();

// Fuentes que ya traen Windows y Android; si falta una, el navegador sigue con la siguiente.
const GLYPH_FONT = "'MS Gothic', 'Yu Gothic', 'Noto Sans Mono CJK JP', 'Noto Sans CJK JP', monospace";

/** Todas las letras, una vez, en una tira del color dado y a la resolución de la pantalla. */
function glyphAtlas(tone: Tone, px: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = px * GLYPHS.length;
  canvas.height = px;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `${Math.round(px * 0.8)}px ${GLYPH_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = tone.css(1);
  for (let i = 0; i < GLYPHS.length; i++) {
    ctx.save();
    ctx.translate(i * px + px / 2, px / 2);
    // La mitad, en espejo: se leen como señales, no como texto.
    if (i % 2 === 1) ctx.scale(-1, 1);
    ctx.fillText(GLYPHS[i], 0, 0);
    ctx.restore();
  }
  return canvas;
}

const randomGlyph = () => (Math.random() * GLYPHS.length) | 0;

// ------------------------------------------------------------
// Matrix ascendente
// ------------------------------------------------------------

function matrixScene(ctx: CanvasRenderingContext2D, live: Live): Scene {
  const cell = live.current.contained ? 12 : 18;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let px = 0;
  let trail: HTMLCanvasElement | null = null;
  let head: HTMLCanvasElement | null = null;
  // Por columna: la fila de la cabeza (baja al subir), su ritmo y el largo de la estela.
  let headRow = new Float32Array(0);
  let rate = new Float32Array(0);
  let length = new Uint8Array(0);
  let grid = new Uint8Array(0);

  const retone = () => {
    px = Math.max(4, Math.round(cell * ctx.getTransform().a));
    trail = glyphAtlas(readTone(live.current.color), px);
    head = glyphAtlas(readTone(live.current.color, '--primary', isDark() ? 30 : -16), px);
  };

  const spawn = (col: number, first: boolean) => {
    const density = live.current.density;
    length[col] = 8 + Math.floor(Math.random() * 22);
    rate[col] = 5 + Math.random() * 9;
    // Al empezar ya hay columnas a medio camino; después cada una vuelve a
    // salir por abajo tras una pausa (más corta cuanto más densa).
    headRow[col] = first
      ? -length[col] + Math.random() * (rows + length[col]) * (1 + 0.5 / density)
      : rows + Math.random() * rows * (0.9 / density);
  };

  return {
    resize(w, h) {
      width = w;
      height = h;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      grid = new Uint8Array(cols * rows);
      for (let i = 0; i < grid.length; i++) grid[i] = randomGlyph();
      headRow = new Float32Array(cols);
      rate = new Float32Array(cols);
      length = new Uint8Array(cols);
      for (let col = 0; col < cols; col++) spawn(col, true);
      retone();
    },
    retone,
    frame(context, dt) {
      context.clearRect(0, 0, width, height);
      if (!trail || !head) return;
      const { intensity, speed } = live.current;
      const amp = 0.3 + 0.7 * intensity;
      // Unas pocas letras cambian solas en cada fotograma.
      for (let i = Math.ceil(grid.length * 0.003); i > 0; i--) grid[(Math.random() * grid.length) | 0] = randomGlyph();
      for (let col = 0; col < cols; col++) {
        const before = Math.floor(headRow[col]);
        headRow[col] -= rate[col] * speed * dt;
        const top = Math.floor(headRow[col]);
        const len = length[col];
        if (top + len < 0) {
          spawn(col, false);
          continue;
        }
        if (top >= rows) continue;
        // La cabeza estrena letra en cada fila nueva.
        if (top !== before && top >= 0) grid[top * cols + col] = randomGlyph();
        const x = col * cell;
        for (let k = Math.max(0, -top); k <= len; k++) {
          const row = top + k;
          if (row >= rows) break;
          context.globalAlpha = k === 0 ? amp : amp * 0.78 * Math.pow(1 - k / (len + 1), 1.5);
          context.drawImage(k === 0 ? head : trail, grid[row * cols + col] * px, 0, px, px, x, row * cell, cell, cell);
        }
      }
      context.globalAlpha = 1;
    },
  };
}

export function MatrixRain(props: CanvasSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useLive(props);
  useCanvasLoop(canvasRef, { contained: props.contained, fps: 30 }, (ctx) => matrixScene(ctx, live), [props.color, props.density]);
  return <CanvasLayer canvasRef={canvasRef} contained={props.contained} />;
}

// ------------------------------------------------------------
// Tipoaurora
// ------------------------------------------------------------

/** Las cintas de luz: altura (fracción del alto), ondulación, deriva (rad/s) y grosor. */
const RIBBONS = [
  { base: 0.3, wave: 0.08, length: 1.3, drift: 0.25, thick: 0.07, second: false, phase: 0.4 },
  { base: 0.47, wave: 0.1, length: 0.85, drift: -0.18, thick: 0.085, second: true, phase: 2.3 },
  { base: 0.64, wave: 0.07, length: 1.7, drift: 0.14, thick: 0.06, second: false, phase: 4.1 },
];

function typeAuroraScene(ctx: CanvasRenderingContext2D, live: Live): Scene {
  const cell = live.current.contained ? 10 : 16;
  // En las vistas previas (cajas bajitas) las cintas van más gruesas: si no, serían una sola fila.
  const thickness = live.current.contained ? 2.2 : 1;
  let width = 0;
  let height = 0;
  let cols = 0;
  let rows = 0;
  let px = 0;
  let first: HTMLCanvasElement | null = null;
  let second: HTMLCanvasElement | null = null;
  let grid = new Uint8Array(0);
  let twinkle = new Float32Array(0);
  let clock = 12;
  const center = new Float32Array(RIBBONS.length);
  const thick = new Float32Array(RIBBONS.length);
  const streak = new Float32Array(RIBBONS.length);

  const retone = () => {
    px = Math.max(4, Math.round(cell * ctx.getTransform().a));
    first = glyphAtlas(readTone(live.current.color), px);
    second = glyphAtlas(secondTone(live.current), px);
  };

  return {
    resize(w, h) {
      width = w;
      height = h;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      grid = new Uint8Array(cols * rows);
      twinkle = new Float32Array(cols * rows);
      for (let i = 0; i < grid.length; i++) {
        grid[i] = randomGlyph();
        twinkle[i] = Math.random() * TAU;
      }
      retone();
    },
    retone,
    frame(context, dt) {
      context.clearRect(0, 0, width, height);
      if (!first || !second) return;
      const { intensity, speed } = live.current;
      const amp = 0.35 + 0.65 * intensity;
      clock += dt * speed;
      for (let i = Math.ceil(grid.length * 0.02); i > 0; i--) grid[(Math.random() * grid.length) | 0] = randomGlyph();

      for (let col = 0; col < cols; col++) {
        const u = (col + 0.5) / cols;
        for (let r = 0; r < RIBBONS.length; r++) {
          const ribbon = RIBBONS[r];
          center[r] = height * (ribbon.base + ribbon.wave * Math.sin((u * TAU) / ribbon.length + clock * ribbon.drift + ribbon.phase) + 0.03 * Math.sin(u * 13 + clock * 0.5 + ribbon.phase));
          thick[r] = height * ribbon.thick * thickness * (0.75 + 0.25 * Math.sin(u * 6.5 - clock * 0.3 + ribbon.phase));
          streak[r] = 0.6 + 0.4 * Math.sin(u * 29 + clock * 0.8 + ribbon.phase * 1.7) * Math.sin(u * 4.9 - clock * 0.23 + ribbon.phase);
        }
        const x = col * cell;
        for (let row = 0; row < rows; row++) {
          const y = (row + 0.5) * cell;
          let lightA = 0;
          let lightB = 0;
          for (let r = 0; r < RIBBONS.length; r++) {
            const d = (y - center[r]) / thick[r];
            // Como una aurora de verdad: el borde de abajo nítido y una cola larga hacia arriba.
            const f = (d > 0 ? Math.exp(-d * d * 2.4) : Math.exp(-d * d * 0.42)) * streak[r];
            if (RIBBONS[r].second) lightB += f;
            else lightA += f;
          }
          const light = Math.min(1, lightA + lightB);
          if (light < 0.08) continue;
          const i = row * cols + col;
          const alpha = amp * 0.9 * smoothstep(0.08, 1, light) * (0.72 + 0.28 * Math.sin(clock * 2.3 + twinkle[i]));
          if (alpha < 0.03) continue;
          context.globalAlpha = alpha;
          context.drawImage(lightB > lightA ? second : first, grid[i] * px, 0, px, px, x, row * cell, cell, cell);
        }
      }
      context.globalAlpha = 1;
    },
  };
}

export function TypeAurora(props: CanvasSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useLive(props);
  useCanvasLoop(canvasRef, { contained: props.contained, fps: 20 }, (ctx) => typeAuroraScene(ctx, live), [props.color, props.color2]);
  return <CanvasLayer canvasRef={canvasRef} contained={props.contained} />;
}

// ------------------------------------------------------------
// Aurora boreal
// ------------------------------------------------------------

/** Las cortinas: dónde cae su borde de abajo, cuánto suben y de qué color son. */
const CURTAINS = [
  { base: 0.4, wave: 0.09, length: 1.25, drift: 0.12, reach: 0.32, tone: 0, phase: 0.3 },
  { base: 0.56, wave: 0.07, length: 0.8, drift: -0.09, reach: 0.26, tone: 1, phase: 2.4 },
  { base: 0.3, wave: 0.06, length: 1.9, drift: 0.07, reach: 0.2, tone: 2, phase: 4.4 },
];

function borealScene(ctx: CanvasRenderingContext2D, live: Live): Scene {
  const ray = live.current.contained ? 3 : 4;
  let width = 0;
  let height = 0;
  let clock = 12;
  let fills: CanvasGradient[] = [];
  let additive = true;

  const retone = () => {
    const { color } = live.current;
    // Con tema oscuro, luz que se suma (como una aurora de verdad); con el
    // claro, colores medios y vivos que tiñen el fondo sin ensuciarlo.
    additive = isDark();
    const tones = additive
      ? [readTone(color, '--primary', -12, 55), secondTone(live.current, -4, 50), readTone(color, '--primary', 8, 45)]
      : [readTone(color, '--primary', 26, 60), secondTone(live.current, -12, 45), readTone(color, '--primary', 40, 55)];
    // Un degradado en una caja de 1×1: cada rayo lo estira a su sitio.
    fills = tones.map((tone) => {
      const fill = ctx.createLinearGradient(0, 0, 0, 1);
      fill.addColorStop(0, tone.css(0));
      fill.addColorStop(0.5, tone.css(0.16));
      fill.addColorStop(0.86, tone.css(0.5));
      fill.addColorStop(0.96, tone.css(0.95));
      fill.addColorStop(1, tone.css(0));
      return fill;
    });
  };
  retone();

  return {
    resize(w, h) {
      width = w;
      height = h;
    },
    retone,
    frame(context, dt) {
      context.clearRect(0, 0, width, height);
      const { intensity, speed } = live.current;
      const amp = 0.22 + 0.6 * intensity;
      clock += dt * speed;
      const base = context.getTransform();
      const scale = base.a;
      context.globalCompositeOperation = additive ? 'lighter' : 'source-over';
      for (const curtain of CURTAINS) {
        context.fillStyle = fills[curtain.tone];
        for (let x = 0; x < width; x += ray) {
          const u = x / width;
          const bottom = height * (curtain.base + curtain.wave * Math.sin((u * TAU) / curtain.length + clock * curtain.drift + curtain.phase) + 0.025 * Math.sin(u * 9.5 - clock * 0.45 + curtain.phase));
          const reach = height * curtain.reach * (0.62 + 0.38 * Math.sin(u * 4.3 + clock * 0.19 + curtain.phase));
          const glow = 0.5 + 0.5 * Math.sin(u * 41 + clock * 1.3 + curtain.phase) * Math.sin(u * 7.7 - clock * 0.33 + curtain.phase * 0.5);
          const alpha = amp * glow;
          if (alpha < 0.02) continue;
          context.globalAlpha = alpha;
          context.setTransform(scale * ray, 0, 0, scale * reach, scale * x, scale * (bottom - reach));
          context.fillRect(0, 0, 1, 1);
        }
      }
      context.setTransform(base);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
    },
  };
}

export function BorealAurora(props: CanvasSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useLive(props);
  // A media resolución: más suave (la luz no tiene bordes) y más barata.
  useCanvasLoop(canvasRef, { contained: props.contained, fps: 30, resolution: 0.5 }, (ctx) => borealScene(ctx, live), [props.color, props.color2]);
  return <CanvasLayer canvasRef={canvasRef} contained={props.contained} />;
}
