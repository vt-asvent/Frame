import type { CSSProperties } from 'react';
import { useExtensionOn } from '@/lib/extensions/store';
import { ANIMACIONES, useLook, type ChromeLook } from '@/lib/extensions/animaciones';
import { cn } from '@/lib/utils';

// ============================================================
// «Mosaico de figuras» (1.8.0): figuras de trazo repetidas por todo el fondo,
// como los fondos de los chats, que derivan despacio en diagonal. También
// van, quietas, en la barra lateral y la cabecera si el usuario lo elige.
//
// Es una sola imagen (una baldosa SVG hecha aquí) usada como máscara de una
// capa del color del tema: cambia de color sola con el acento y la mueve la
// tarjeta gráfica (solo `transform`), sin dibujar nada en cada fotograma.
// ============================================================

/** Figuras propias, de trazo, en una caja de 24×24. */
const FIGURES: string[] = [
  // Libro abierto
  "<path d='M3 6.5c2.8-1.4 5.8-1.4 9 .6 3.2-2 6.2-2 9-.6V19c-2.8-1.4-5.8-1.4-9 .6-3.2-2-6.2-2-9-.6z'/><path d='M12 7.1v12.5'/>",
  // Lápiz
  "<path d='M16.5 3.5l4 4L9 19H5v-4z'/><path d='M14 6l4 4'/>",
  // Nota musical
  "<path d='M9 17.5V5.5l10-2v12'/><circle cx='6.6' cy='17.5' r='2.4'/><circle cx='16.6' cy='15.5' r='2.4'/>",
  // Estrella
  "<path d='M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z'/>",
  // Reloj
  "<circle cx='12' cy='12' r='8.5'/><path d='M12 7.5V12l3 2'/>",
  // Bombilla
  "<path d='M9.5 17.5h5M10.5 20.5h3'/><path d='M12 3.5a5.5 5.5 0 0 0-3.3 9.9c.6.5.9 1.2.9 1.9v.7h4.8v-.7c0-.7.3-1.4.9-1.9A5.5 5.5 0 0 0 12 3.5z'/>",
  // Corazón
  "<path d='M12 19.5s-7-4.3-7-9.6A3.9 3.9 0 0 1 12 7.6a3.9 3.9 0 0 1 7 2.3c0 5.3-7 9.6-7 9.6z'/>",
  // Avión de papel
  "<path d='M20.5 3.5L3.5 10l6.5 3 3 6.5z'/><path d='M10 13l10.5-9.5'/>",
  // Átomo
  "<circle cx='12' cy='12' r='1.3'/><ellipse cx='12' cy='12' rx='9' ry='3.5'/><ellipse cx='12' cy='12' rx='9' ry='3.5' transform='rotate(60 12 12)'/><ellipse cx='12' cy='12' rx='9' ry='3.5' transform='rotate(-60 12 12)'/>",
  // Birrete
  "<path d='M2.5 9.5L12 5l9.5 4.5L12 14z'/><path d='M6.5 11.5v4c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4M21.5 9.5v5'/>",
  // Auriculares
  "<path d='M4.5 15.5V12a7.5 7.5 0 0 1 15 0v3.5'/><rect x='3.5' y='13.5' width='4' height='6' rx='1.5'/><rect x='16.5' y='13.5' width='4' height='6' rx='1.5'/>",
  // Taza
  "<path d='M5 8.5h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z'/><path d='M16 10h1.5a2.5 2.5 0 0 1 0 5H16M9 3.5v2M12 3.5v2'/>",
  // Planeta
  "<circle cx='12' cy='12' r='5.5'/><ellipse cx='12' cy='12' rx='10' ry='3' transform='rotate(-22 12 12)'/>",
  // Hoja
  "<path d='M5 19c0-8.5 5-13.5 14.5-14.5C18.5 14 13.5 19 5 19z'/><path d='M5 19l8.5-8.5'/>",
  // Calculadora
  "<rect x='5.5' y='3' width='13' height='18' rx='2'/><path d='M8.5 7h7M9 11h0M12 11h0M15 11h0M9 14.5h0M12 14.5h0M15 14.5h0M9 18h0M12 18h0M15 18h0'/>",
  // Matraz
  "<path d='M9.5 3.5h5M10.5 3.5v5.5L5 18.3a1.6 1.6 0 0 0 1.4 2.2h11.2a1.6 1.6 0 0 0 1.4-2.2L13.5 9V3.5'/><path d='M7.5 15h9'/>",
  // Destello
  "<path d='M12 3.5c.6 4.4 2.6 6.4 7 7-4.4.6-6.4 2.6-7 7-.6-4.4-2.6-6.4-7-7 4.4-.6 6.4-2.6 7-7z'/>",
  // Visto
  "<circle cx='12' cy='12' r='8.5'/><path d='M8.5 12.3l2.4 2.4 4.6-4.9'/>",
  // Globo terráqueo
  "<circle cx='12' cy='12' r='8.5'/><path d='M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z'/>",
  // Cámara
  "<path d='M4.5 8h3l1.5-2.5h6L16.5 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'/><circle cx='12' cy='13' r='3.5'/>",
  // Luna
  "<path d='M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z'/>",
  // Clip
  "<path d='M17 8.5l-6.8 6.8a2.3 2.3 0 0 1-3.3-3.3l7.4-7.4a3.8 3.8 0 0 1 5.4 5.4L12 17.7a5.3 5.3 0 0 1-7.5-7.5L11 3.7'/>",
];

/** Relleno entre figuras: un punto o una cruz pequeña. */
const FILLERS = ["<circle cx='12' cy='12' r='1.6'/>", "<path d='M12 9.5v5M9.5 12h5'/>"];

/** Lado de la baldosa en píxeles: se repite sin costuras en las dos direcciones. */
export const MOSAIC_TILE = 240;

/** Azar con semilla: la baldosa sale igual cada vez. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTile(seed: number): string {
  const rand = seeded(seed);
  const slots = 6;
  const step = MOSAIC_TILE / slots;
  const deck = FIGURES.map((_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const parts: string[] = [];
  // Una figura cerca de un borde se dibuja también al otro lado: al repetir
  // la baldosa, las dos mitades se juntan y no se ve el corte.
  const place = (markup: string, cx: number, cy: number, scale: number, angle: number, reach: number) => {
    const xs = [cx, ...(cx - reach < 0 ? [cx + MOSAIC_TILE] : []), ...(cx + reach > MOSAIC_TILE ? [cx - MOSAIC_TILE] : [])];
    const ys = [cy, ...(cy - reach < 0 ? [cy + MOSAIC_TILE] : []), ...(cy + reach > MOSAIC_TILE ? [cy - MOSAIC_TILE] : [])];
    for (const x of xs) {
      for (const y of ys) {
        parts.push(`<g transform='translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle.toFixed(0)}) scale(${scale.toFixed(2)}) translate(-12 -12)'>${markup}</g>`);
      }
    }
  };
  let next = 0;
  for (let row = 0; row < slots; row++) {
    for (let col = 0; col < slots; col++) {
      // Filas alternas desplazadas media casilla, y un poco de desorden.
      const cx = (col + 0.5 + (row % 2) * 0.5) * step + (rand() - 0.5) * 10;
      const cy = (row + 0.5) * step + (rand() - 0.5) * 10;
      const scale = 0.74 + rand() * 0.2;
      place(FIGURES[deck[next++ % deck.length]], ((cx % MOSAIC_TILE) + MOSAIC_TILE) % MOSAIC_TILE, cy, scale, (rand() - 0.5) * 56, 17 * scale + 2);
      // En el hueco entre esta figura, la de su derecha y la de debajo, a
      // veces, un punto o una cruz.
      if (rand() < 0.45) {
        const fx = (col + 1 + (row % 2) * 0.5) * step + (rand() - 0.5) * 6;
        const fy = (row + 0.83) * step + (rand() - 0.5) * 6;
        place(FILLERS[rand() < 0.6 ? 0 : 1], ((fx % MOSAIC_TILE) + MOSAIC_TILE) % MOSAIC_TILE, ((fy % MOSAIC_TILE) + MOSAIC_TILE) % MOSAIC_TILE, 1, 0, 5);
      }
    }
  }
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${MOSAIC_TILE}' height='${MOSAIC_TILE}' viewBox='0 0 ${MOSAIC_TILE} ${MOSAIC_TILE}'><g fill='none' stroke='#000' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'>${parts.join('')}</g></svg>`;
}

let tileUrl: string | null = null;
/** La baldosa como `url(...)` para una máscara (se hace una vez, al primer uso). */
const mosaicUrl = () => (tileUrl ??= `url("data:image/svg+xml,${encodeURIComponent(buildTile(7))}")`);

/** Una capa del color dado, recortada con las figuras. */
function maskedLayer(size: number, alpha: number, color: string | null): CSSProperties {
  const url = mosaicUrl();
  return {
    backgroundColor: `hsl(${color ?? 'var(--primary)'} / ${alpha.toFixed(3)})`,
    WebkitMaskImage: url,
    maskImage: url,
    WebkitMaskSize: `${size}px ${size}px`,
    maskSize: `${size}px ${size}px`,
    WebkitMaskRepeat: 'repeat',
    maskRepeat: 'repeat',
  };
}

/** El fondo «Mosaico de figuras». */
export function MosaicBackdrop({ intensity, speed, color, contained }: { intensity: number; speed: number; color: string | null; contained: boolean }) {
  const size = contained ? 150 : MOSAIC_TILE;
  return (
    <div className={cn('pointer-events-none overflow-hidden', contained ? 'absolute inset-0' : 'fixed inset-0 -z-10')} aria-hidden>
      {/* Sobra una baldosa por cada lado: al moverse una baldosa entera el
          dibujo vuelve a ser el mismo y el bucle no tiene costura. */}
      <div
        className="frame-mosaic absolute"
        style={
          {
            ...maskedLayer(size, 0.06 + 0.24 * intensity, color),
            inset: `-${size}px`,
            '--tile': `${size}px`,
            animation: `frame-mosaic-drift ${(70 / speed).toFixed(1)}s linear infinite`,
          } as CSSProperties
        }
      />
    </div>
  );
}

export type ChromeArea = 'lateral' | 'cabecera';

/** Las figuras de la barra lateral o de la cabecera, si tocan aquí (extensión activa y elegidas). */
export function useChromePattern(area: ChromeArea): ChromeLook | null {
  const on = useExtensionOn(ANIMACIONES);
  const { chrome } = useLook();
  if (!on || chrome.pattern === 'none') return null;
  if (chrome.where !== 'ambas' && chrome.where !== area) return null;
  return chrome;
}

/**
 * Las figuras, quietas, detrás del contenido de su contenedor (que necesita
 * `relative isolate`): por encima de su color de fondo y por debajo de todo
 * lo demás, así que nada deja de leerse ni de responder.
 */
export function ChromePattern({ chrome, size = 200 }: { chrome: ChromeLook; size?: number }) {
  return <div className="pointer-events-none absolute inset-0 -z-10" style={maskedLayer(size, 0.04 + 0.16 * chrome.strength, null)} aria-hidden />;
}
