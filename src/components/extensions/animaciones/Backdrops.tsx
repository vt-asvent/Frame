import { useEffect, useState } from 'react';
import Constellation from '@/components/extensions/animaciones/Constellation';
import { BorealAurora, MatrixRain, TypeAurora } from '@/components/extensions/animaciones/CanvasScenes';
import { MosaicBackdrop } from '@/components/extensions/animaciones/Mosaic';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import { useContributions, useExtensionOn } from '@/lib/extensions/store';
import {
  ANIMACIONES,
  animationsWith,
  applyModAccent,
  DEFAULT_CORNERS,
  DEFAULT_FOCUS,
  effectiveLook,
  HEADING_FONTS,
  loadOwnBackground,
  pickAnimation,
  placeCover,
  resolveParams,
  useBackgroundVersion,
  useLook,
  type AnimationChoice,
  type BackgroundFocus,
  type LookSettings,
} from '@/lib/extensions/animaciones';
import { cn } from '@/lib/utils';

// ============================================================
// Lo que pinta la extensión Animaciones detrás de la interfaz: la imagen de
// fondo (velada con el color del tema) a -z-20 y la animación a -z-10. Las
// tarjetas son opacas, así que solo asoma por los huecos: la interfaz se lee
// igual que sin ella.
//
// 1.8.0: la imagen ocupa solo el área de contenido (antes iba a toda la
// ventana y la tapaban la barra lateral y la cabecera) y se coloca con el
// encuadre que eligió el usuario. También aplica la tipografía de títulos.
// ============================================================

const BLOBS = [
  { left: '-12%', top: '-18%', size: 62, tone: '--primary', alpha: 0.2, anim: 'a', dur: 26 },
  { left: '48%', top: '6%', size: 52, tone: '--primary-2', alpha: 0.17, anim: 'b', dur: 33 },
  { left: '8%', top: '52%', size: 58, tone: '--primary', alpha: 0.13, anim: 'c', dur: 39 },
];

function Aurora({
  intensity,
  speed,
  color,
  color2,
  contained,
}: {
  intensity: number;
  speed: number;
  color: string | null;
  color2: string | null;
  contained: boolean;
}) {
  return (
    <div className={cn('pointer-events-none overflow-hidden', contained ? 'absolute inset-0' : 'fixed inset-0 -z-10')} aria-hidden>
      {BLOBS.map((b) => {
        const tone = b.tone === '--primary' ? color : (color2 ?? color);
        return (
          <div
            key={b.anim}
            className="frame-aurora-blob absolute rounded-full"
            style={{
              left: b.left,
              top: b.top,
              width: contained ? `${b.size * 1.6}%` : `${b.size}vmax`,
              aspectRatio: '1',
              background: `radial-gradient(circle at center, hsl(${tone ?? `var(${b.tone})`} / ${(b.alpha * intensity * 1.6).toFixed(3)}) 0%, transparent 68%)`,
              animation: `frame-aurora-${b.anim} ${(b.dur / speed).toFixed(1)}s ease-in-out infinite alternate`,
              willChange: 'transform',
            }}
          />
        );
      })}
    </div>
  );
}

/** Una animación con los ajustes del usuario y los parámetros de su mod. */
export function AnimationView({ choice, look, contained = false }: { choice: AnimationChoice; look: LookSettings; contained?: boolean }) {
  const p = resolveParams(choice, look);
  const scene = { intensity: p.intensity, speed: p.speed, density: p.density, color: p.color, color2: p.color2, contained };
  if (choice.base === 'boreal') return <BorealAurora {...scene} />;
  if (choice.base === 'matrix') return <MatrixRain {...scene} />;
  if (choice.base === 'tipoaurora') return <TypeAurora {...scene} />;
  if (choice.base === 'mosaico') return <MosaicBackdrop intensity={p.intensity} speed={p.speed} color={p.color} contained={contained} />;
  if (choice.base === 'constelacion') {
    return <Constellation intensity={p.intensity} speed={p.speed} density={p.density} linkDistance={contained ? p.linkDistance * 0.6 : p.linkDistance} color={p.color} contained={contained} />;
  }
  if (choice.base === 'olas') {
    return (
      <div className={cn('pointer-events-none', contained ? 'absolute inset-0' : 'fixed inset-0 -z-10')} aria-hidden>
        <WaveBackdrop intensity={p.intensity * 1.3} speed={p.speed} dense={!contained} lineHeight={contained ? 24 : 56} color={p.color} />
      </div>
    );
  }
  return <Aurora intensity={p.intensity} speed={p.speed} color={p.color} color2={p.color2} contained={contained} />;
}

/** La imagen de fondo elegida (la propia, de IndexedDB, o la de un mod). */
export function useBackgroundImage(look: LookSettings, enabled: boolean): string | null {
  const mods = useContributions('appearance');
  const version = useBackgroundVersion();
  const [ownUrl, setOwnUrl] = useState<string | null>(null);
  const source = enabled ? (look.background?.source ?? null) : null;

  useEffect(() => {
    if (source !== 'own') {
      setOwnUrl(null);
      return;
    }
    let url: string | null = null;
    let live = true;
    void loadOwnBackground().then((blob) => {
      if (!live) return;
      url = blob ? URL.createObjectURL(blob) : null;
      setOwnUrl(url);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, version]);

  if (!source) return null;
  if (source === 'own') return ownUrl;
  return mods.find((m) => m.id === source)?.value.background?.image ?? null;
}

export interface ContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Dónde está el área de contenido de la app (lo que queda a la derecha de la
 * barra lateral, bajo la cabecera y sobre el reproductor): la marca
 * `data-frame-content` del diseño principal. Se sigue al cambiar de tamaño.
 */
export function useContentRect(enabled: boolean): ContentRect | null {
  const [rect, setRect] = useState<ContentRect | null>(null);
  useEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }
    let watched: Element | null = null;
    const measure = () => {
      const element = document.querySelector('[data-frame-content]');
      if (!element) return;
      if (element !== watched) {
        if (watched) observer.unobserve(watched);
        observer.observe(element);
        watched = element;
      }
      const box = element.getBoundingClientRect();
      const next = { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) };
      setRect((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    const observer = new ResizeObserver(measure);
    measure();
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [enabled]);
  return rect;
}

/**
 * La imagen colocada en su caja con el encuadre elegido (lo mismo que se ve
 * en el panel de Animaciones). Hasta saber su tamaño, cubre la caja centrada.
 */
export function FramedImage({ src, width, height, focus, blur }: { src: string; width: number; height: number; focus?: BackgroundFocus; blur: boolean }) {
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);
  const size = natural?.src === src ? natural : null;
  const place = size ? placeCover(size.width, size.height, width, height, focus ?? DEFAULT_FOCUS) : null;
  return (
    <div className={cn('absolute inset-0', blur && 'scale-110 blur-lg')}>
      <img
        key={src}
        src={src}
        alt=""
        draggable={false}
        onLoad={(event) => setNatural({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        className={cn('absolute max-w-none select-none', !place && 'inset-0 h-full w-full object-cover')}
        style={place ? { left: place.left, top: place.top, width: place.width, height: place.height } : undefined}
      />
    </div>
  );
}

/** Montado en el diseño principal: no pinta nada si la extensión no está activa. */
export default function AppBackdrop() {
  const on = useExtensionOn(ANIMACIONES);
  const mods = useContributions('appearance');
  const look = effectiveLook(useLook(), mods);
  const image = useBackgroundImage(look, on);
  const rect = useContentRect(on && !!image);

  // La tipografía de los títulos (1.8.0): una variable que lee `font-headline`.
  const headingFont = on ? (HEADING_FONTS.find((f) => f.id === look.headingFont)?.stack ?? null) : null;
  useEffect(() => {
    if (!headingFont) return;
    const root = document.documentElement.style;
    root.setProperty('--font-headline', headingFont);
    return () => {
      root.removeProperty('--font-headline');
    };
  }, [headingFont]);

  // Las esquinas de los recuadros (1.9.8): `--radius`, de la que salen todos los redondeos.
  const corners = on && look.corners !== DEFAULT_CORNERS ? look.corners : null;
  useEffect(() => {
    if (corners === null) return;
    const root = document.documentElement.style;
    root.setProperty('--radius', `${corners / 16}rem`);
    return () => {
      root.removeProperty('--radius');
    };
  }, [corners]);

  // El color de un mod va encima del acento de Ajustes; sin el mod, sin la
  // extensión o apagada, se quita y vuelve el de antes.
  const accent = on && look.accentFrom ? (mods.find((m) => m.id === look.accentFrom)?.value.accent ?? null) : null;
  const accentKey = accent ? `${accent.light}|${accent.dark}` : '';
  useEffect(() => {
    applyModAccent(accent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentKey]);

  if (!on) return null;
  const animation = pickAnimation(animationsWith(mods), look);
  return (
    <>
      {image && look.background && rect && (
        <div className="pointer-events-none fixed -z-20 overflow-hidden" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }} aria-hidden>
          <FramedImage src={image} width={rect.width} height={rect.height} focus={look.background.focus} blur={look.background.blur} />
          <div className="absolute inset-0 bg-background" style={{ opacity: look.background.dim }} />
        </div>
      )}
      {animation && <AnimationView key={animation.id} choice={animation} look={look} />}
    </>
  );
}
