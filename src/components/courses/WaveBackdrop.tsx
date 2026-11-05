import { cn } from '@/lib/utils';

// Olas animadas (fondo transparente): varias líneas curvas finas del azul
// primario que se desplazan de lado a lado de forma permanente, con
// desvanecimiento progresivo entre capas. Se usa en las tarjetas de
// asignatura sin imagen, detrás del título en el panel de cada asignatura y
// como fondo a pantalla completa de la pantalla de acceso.

interface WaveBackdropProps {
  /** Multiplicador de opacidad de todas las capas (1 = valores originales). */
  intensity?: number;
  /** Alto de cada onda en píxeles (por defecto 40, el `h-10` original). */
  lineHeight?: number;
  /** Duplica el número de líneas: útil en superficies muy altas
   *  (pantalla de acceso) donde 5 capas quedan demasiado separadas. */
  dense?: boolean;
  /** `fixed inset-0` en lugar de `absolute inset-0`: cubre todo el viewport
   *  sin depender de que el padre sea `relative`. */
  fullscreen?: boolean;
  className?: string;
  /** Multiplicador de velocidad (1 = la de siempre). */
  speed?: number;
  /** Tripleta HSL («H S% L%») en lugar de `--primary`. */
  color?: string | null;
}

const BASE_LAYERS = [
  { top: 12, duration: 9, opacity: 0.5, width: 1.6, reverse: false },
  { top: 30, duration: 13, opacity: 0.35, width: 1.4, reverse: true },
  { top: 48, duration: 11, opacity: 0.24, width: 1.2, reverse: false },
  { top: 64, duration: 16, opacity: 0.15, width: 1.1, reverse: true },
  { top: 80, duration: 20, opacity: 0.08, width: 1.0, reverse: false },
];

export default function WaveBackdrop({
  intensity = 1,
  lineHeight = 40,
  dense = false,
  fullscreen = false,
  className,
  speed = 1,
  color = null,
}: WaveBackdropProps = {}) {
  // En modo denso se intercalan capas a medio camino entre las originales.
  const layers = dense
    ? BASE_LAYERS.flatMap((l, i) => {
        const next = BASE_LAYERS[i + 1];
        if (!next) return [l];
        return [
          l,
          {
            ...l,
            top: (l.top + next.top) / 2,
            duration: (l.duration + next.duration) / 2 + 2,
            opacity: (l.opacity + next.opacity) / 2,
            width: (l.width + next.width) / 2,
            reverse: !l.reverse,
          },
        ];
      })
    : BASE_LAYERS;

  return (
    <div
      className={cn(
        'pointer-events-none overflow-hidden',
        fullscreen ? 'fixed inset-0' : 'absolute inset-0',
        className
      )}
      aria-hidden
    >
      {layers.map((l, i) => (
        <svg
          key={i}
          viewBox="0 0 1200 60"
          preserveAspectRatio="none"
          className="absolute left-0 w-[200%]"
          style={{
            top: `${l.top}%`,
            height: `${lineHeight}px`,
            opacity: Math.min(1, l.opacity * intensity),
            animation: `${l.reverse ? 'frame-wave-reverse' : 'frame-wave'} ${l.duration / speed}s linear infinite`,
          }}
        >
          {/* Onda periódica (periodo 600): el bucle de -50% es continuo. */}
          <path
            d="M0 30 Q150 8 300 30 T600 30 T900 30 T1200 30"
            fill="none"
            stroke={color ? `hsl(${color})` : 'hsl(var(--primary))'}
            strokeWidth={l.width}
            strokeLinecap="round"
          />
        </svg>
      ))}
    </div>
  );
}
