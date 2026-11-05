import { useEffect, useMemo, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import { useCourse } from '@/context/CourseContext';
import { IMAGE_UPDATED_EVENT, getImage, type ImageUpdatedDetail } from '@/lib/music-db';
import { formatDurationLabel, sessionSeconds } from '@/lib/duration';
import { isSessionEditable } from '@/lib/session-edit';
import { cn } from '@/lib/utils';
import { sessionHasFocus, sessionSubjects } from '@/components/temporizador/session-info';
import { useCardImageStyle } from '@/lib/card-image-height';
import type { StudySession } from '@/types';
import { tr } from '@/lib/i18n';

// ============================================================
// Una sesión de estudio como tarjeta.
//
// Arriba, la tarjeta de su asignatura tal cual se ve en Asignaturas: portada
// de extremo a extremo (olas si no tiene imagen) y el nombre centrado en
// azul. Debajo, lo que la sesión dejó: cuánto duró y con qué rendimiento.
//
// Si la sesión tocó varias asignaturas, la portada pasa de una a otra con un
// fundido lento y el nombre que corresponde se ilumina a la vez. Con
// «reducir movimiento» no se alterna nada: las portadas se reparten la
// tarjeta en franjas, todas a la vista.
//
// Pulsar la tarjeta abre su detalle; el lápiz de la esquina, la corrección
// (solo mientras la sesión sea corregible: el mismo día).
// ============================================================

/** Cada cuánto cambia la portada de una sesión con varias asignaturas. */
const ROTATE_MS = 3800;

/** Sigue la preferencia del sistema en vivo, no solo al montar. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return;
    }
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Portadas de varias asignaturas a la vez, al día si cambian (como useStoredImage). */
export function useCourseImages(courseIds: (string | null)[]): (string | null)[] {
  const signature = courseIds.map((id) => id ?? '').join('|');
  const [images, setImages] = useState<Record<string, string | null>>({});

  useEffect(() => {
    const ids = signature.split('|').filter(Boolean);
    if (ids.length === 0) return;
    let alive = true;
    const load = (id: string) => {
      void getImage(`courseImage_${id}`)
        .then((value) => {
          if (alive) setImages((prev) => (prev[id] === value ? prev : { ...prev, [id]: value }));
        })
        .catch(() => undefined);
    };
    ids.forEach(load);
    const onUpdate = (event: Event) => {
      const key = (event as CustomEvent<ImageUpdatedDetail>).detail?.key ?? '';
      const id = key.startsWith('courseImage_') ? key.slice('courseImage_'.length) : '';
      if (id && ids.includes(id)) load(id);
    };
    window.addEventListener(IMAGE_UPDATED_EVENT, onUpdate);
    return () => {
      alive = false;
      window.removeEventListener(IMAGE_UPDATED_EVENT, onUpdate);
    };
  }, [signature]);

  return courseIds.map((id) => (id ? images[id] ?? null : null));
}

/** Desfase estable por tarjeta: las de una misma rejilla no cambian a la vez. */
function staggerOf(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index++) hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  return (hash % 8) * 350;
}

/** Índice de la portada visible; quieto con una sola o con movimiento reducido. */
function useRotatingIndex(count: number, seed: string, paused: boolean): number {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
    if (count < 2 || paused) return;
    let interval: number | undefined;
    const first = window.setTimeout(() => {
      setIndex((current) => (current + 1) % count);
      interval = window.setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    }, ROTATE_MS + staggerOf(seed));
    return () => {
      window.clearTimeout(first);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [count, seed, paused]);

  return index;
}

/**
 * Portada de una o varias asignaturas. `active` es la que se ve; con
 * `split` se muestran todas a la vez, cada una en su franja vertical.
 */
export function SessionCover({
  images,
  active,
  split = false,
  className,
}: {
  /** Una entrada por asignatura: su imagen, o null para las olas. */
  images: (string | null)[];
  active: number;
  split?: boolean;
  className?: string;
}) {
  const slides = images.length > 0 ? images : [null];

  if (split || slides.length === 1) {
    return (
      <span className={cn('relative flex overflow-hidden bg-accent', className)}>
        {slides.map((image, index) => (
          <span
            key={index}
            className={cn('relative block h-full min-w-0 flex-1', index > 0 && 'border-l border-background/70')}
          >
            {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <WaveBackdrop />}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span className={cn('relative block overflow-hidden bg-accent', className)}>
      {slides.map((image, index) => (
        <span
          key={index}
          aria-hidden={index !== active}
          className={cn(
            'absolute inset-0 transition-opacity duration-1000 ease-in-out',
            index === active ? 'opacity-100' : 'opacity-0'
          )}
        >
          {image ? <img src={image} alt="" className="h-full w-full object-cover" /> : <WaveBackdrop />}
        </span>
      ))}
    </span>
  );
}

export default function SessionCard({
  session,
  onOpen,
  onEdit,
  className,
}: {
  session: StudySession;
  onOpen: () => void;
  /** Sin él no hay lápiz. Tampoco lo hay si la sesión ya no es corregible. */
  onEdit?: () => void;
  className?: string;
}) {
  // La portada guarda la proporción elegida en Asignaturas (1.6.6).
  const imageStyle = useCardImageStyle();
  const { courses, advancedMode } = useCourse();
  const reducedMotion = usePrefersReducedMotion();

  const subjects = useMemo(() => sessionSubjects(session, courses ?? []), [session, courses]);
  const images = useCourseImages(subjects.map((subject) => subject.course?.id ?? null));
  const rotating = useRotatingIndex(subjects.length, session.id, reducedMotion);
  // Tras corregir la sesión puede haber menos asignaturas que el índice.
  const active = subjects.length > 0 ? rotating % subjects.length : 0;
  const multiple = subjects.length > 1;

  const seconds = sessionSeconds(session);
  // El enfoque (1-20) es del modo Avanzado: sin él no se pinta, aunque
  // siga guardado en la sesión.
  const hasFocus = advancedMode && sessionHasFocus(session);
  const canEdit = Boolean(onEdit) && isSessionEditable(session);
  const names = subjects.map((subject) => subject.name);
  const label = names.length > 0 ? names.join(' · ') : tr('Sin asignatura');

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-lg border border-border/70 bg-card transition-[border-color,box-shadow] duration-200 hover:border-primary/50 hover:shadow-[0_0_0_1px_hsl(var(--primary)/0.2)]',
        className
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        title={tr('Ver el detalle de la sesión')}
        aria-label={tr('Ver la sesión de {label}, {durationLabel}', { label, durationLabel: formatDurationLabel(seconds) })}
        className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {/* --- Tarjeta de la asignatura: portada y nombre --- */}
        <span className="relative block" style={imageStyle}>
          <SessionCover images={images} active={active} split={reducedMotion} className="h-full w-full" />

          {/* Qué portada se ve, cuando se alternan. */}
          {multiple && !reducedMotion && (
            <span className="absolute bottom-1.5 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-background/75 px-1.5 py-1 backdrop-blur-sm">
              {subjects.map((subject, index) => (
                <span
                  key={subject.key}
                  className={cn(
                    'block h-1 rounded-full transition-all duration-500',
                    index === active ? 'w-3 bg-primary' : 'w-1 bg-foreground/35'
                  )}
                />
              ))}
            </span>
          )}
        </span>

        <span className="block border-t border-border/60 px-3 py-1.5" title={label}>
          {names.length === 0 ? (
            <span className="block truncate text-center text-sm font-bold text-muted-foreground">
              {tr('Sin asignatura')}
            </span>
          ) : (
            <span className="block truncate text-center text-sm font-bold">
              {names.map((name, index) => (
                <span key={subjects[index].key}>
                  {index > 0 && <span className="text-muted-foreground/60"> · </span>}
                  <span
                    className={cn(
                      'transition-colors duration-700',
                      !multiple || reducedMotion || index === active ? 'text-primary' : 'text-primary/45'
                    )}
                  >
                    {name}
                  </span>
                </span>
              ))}
            </span>
          )}
        </span>

        {/* --- Lo que dejó la sesión --- */}
        <span className="mx-3 block h-px bg-border/60" />
        <span
          className={cn(
            'grid items-center px-2 py-1.5',
            hasFocus ? 'grid-cols-[1fr_auto_1fr]' : 'grid-cols-1'
          )}
        >
          <span className="block text-center">
            <span className="block text-xs font-bold tabular-nums leading-tight text-foreground">
              {formatDurationLabel(seconds)}
            </span>
            <span className="block text-[9px] leading-tight text-muted-foreground">{tr('Tiempo')}</span>
          </span>
          {hasFocus && (
            <>
              <span className="h-7 w-px bg-border/70" />
              <span className="block text-center">
                <span className="block text-xs font-bold tabular-nums leading-tight text-primary">
                  {session.perception}
                  <span className="text-[10px] font-semibold text-muted-foreground">/20</span>
                </span>
                <span className="block text-[9px] leading-tight text-muted-foreground">{tr('Rendimiento')}</span>
              </span>
            </>
          )}
        </span>
      </button>

      {/* Corregir: esquina superior derecha, fuera del botón de la tarjeta
          (un botón no puede ir dentro de otro). El fondo opaco lo separa de
          la portada sin cambiar el aspecto fantasma. */}
      {canEdit && (
        <span
          className="absolute right-1.5 top-1.5 rounded-md bg-background/85 backdrop-blur-sm"
        >
          <Button
            type="button"
            variant="fantasma"
            size="icon"
            className="h-6 w-6 [&_svg]:size-3.5"
            onClick={onEdit}
            title={tr('Corregir esta sesión')}
            aria-label={tr('Corregir esta sesión')}
          >
            <Pencil />
          </Button>
        </span>
      )}
    </div>
  );
}
