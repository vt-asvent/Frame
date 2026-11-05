import { useEffect, useState } from 'react';
import Constellation from '@/components/extensions/animaciones/Constellation';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import { useContributions, useExtensionOn } from '@/lib/extensions/store';
import {
  ANIMACIONES,
  animationsWith,
  applyModAccent,
  effectiveLook,
  loadOwnBackground,
  pickAnimation,
  resolveParams,
  useBackgroundVersion,
  useLook,
  type AnimationChoice,
  type LookSettings,
} from '@/lib/extensions/animaciones';
import { cn } from '@/lib/utils';

// ============================================================
// Lo que pinta la extensión Animaciones detrás de la interfaz: la imagen de
// fondo (velada con el color del tema) a -z-20 y la animación a -z-10. Las
// tarjetas son opacas, así que solo asoma por los huecos: la interfaz se lee
// igual que sin ella.
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

/** Montado en el diseño principal: no pinta nada si la extensión no está activa. */
export default function AppBackdrop() {
  const on = useExtensionOn(ANIMACIONES);
  const mods = useContributions('appearance');
  const look = effectiveLook(useLook(), mods);
  const image = useBackgroundImage(look, on);

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
      {image && look.background && (
        <div className="pointer-events-none fixed inset-0 -z-20 overflow-hidden" aria-hidden>
          <img src={image} alt="" className={cn('h-full w-full object-cover', look.background.blur && 'scale-110 blur-lg')} />
          <div className="absolute inset-0 bg-background" style={{ opacity: look.background.dim }} />
        </div>
      )}
      {animation && <AnimationView key={animation.id} choice={animation} look={look} />}
    </>
  );
}
