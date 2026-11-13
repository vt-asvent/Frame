import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, LocateFixed } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import { useCourse } from '@/context/CourseContext';
import { useStoredImage } from '@/hooks/use-stored-image';
import { useCardImageRatio } from '@/lib/card-image-height';
import { linkedCourse, useSubjectLinks } from '@/lib/timetable-links';
import {
  minutesOf,
  minutesOfDay,
  normalize,
  occurrences,
  startOfDay,
  subjectColor,
  timeOf,
  trackPosition,
  useNow,
  type Occurrence,
  type TimetableClass,
} from '@/lib/timetable';
import { dayShort, dayTitle } from '@/lib/day-names';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Horario → la línea del día (1.9.0, Diego).
//
//   ───8:00──────────[9:42]──────12:00──── horas, en gris
//   ░▒ │ Matemática │ │ Historia │ │ Física │ ▒░   tarjetas
//                         ┃ la hora, siempre al medio
//
// Cada tarjeta (1.9.3, Diego) es la de su asignatura: la imagen (sin imagen
// elegida, las olas que tiene en Asignaturas) con la PROPORCIÓN que el usuario
// eligió en Asignaturas, una línea y, debajo, solo el nombre, centrado. Sin
// esquinas redondeadas. El día, si no es hoy, va en una etiqueta sobre la
// imagen. Al tocarla se abre su asignatura (1.9.8); si aún no tiene, se elige
// cuál es (timetable-links.ts). Mide un poco menos de un tercio del ancho: una al medio, una a
// cada lado y, en los bordes, un trozo de la siguiente con degradado. La pista
// se mueve con el reloj: una clase de 8 a 12 queda centrada a las 10, y a las
// 9 la línea cae a un cuarto de su tarjeta. Entre días (y el fin de semana)
// la línea recorre el hueco hasta la primera clase del siguiente.
//
// Se puede mirar atrás y adelante (1.9.9, Diego): con las flechas de los
// extremos o arrastrando (con el dedo en el móvil, con el ratón en la laptop).
// Entonces la línea de la hora se va con su tarjeta y aparece «Ahora», que
// devuelve la hora al medio.
// ============================================================

/** Ancho de la tarjeta y del hueco, en fracción del recuadro. En un teléfono, una tarjeta casi entera. */
const sizes = (width: number) => (width < 640 ? { card: 0.62, gap: 0.04 } : { card: 0.28, gap: 0.02 });
const FADE = 'linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%)';
/** Alto de la franja del nombre, bajo la imagen. */
const NAME_ROW = 30;

function dayLabel(occurrence: Occurrence, today: number): string {
  const days = Math.round((startOfDay(occurrence.start) - today) / 86_400_000);
  if (days === 0) return tr('Hoy');
  if (days === 1) return tr('Mañana');
  if (days === -1) return tr('Ayer');
  return dayTitle(occurrence.item.day - 1);
}

export default function ScheduleTimeline({ uid, classes, onFix }: { uid: string; classes: TimetableClass[]; onFix: () => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // La misma proporción de imagen que en Asignaturas: la tarjeta crece o encoge con ella.
  const ratio = useCardImageRatio();
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const now = useNow(10_000);
  const today = startOfDay(now);
  // Una semana atrás y dos adelante: siempre hay tarjetas a ambos lados.
  const list = useMemo(() => occurrences(classes, new Date(today - 7 * 86_400_000), 22), [classes, today]);

  const { card: cardShare, gap: gapShare } = sizes(width);
  const card = Math.round(width * cardShare);
  const gap = Math.max(10, Math.round(width * gapShare));
  const step = card + gap;
  const position = trackPosition(list, now, card, gap);
  // Cuánto se apartó el usuario de la hora de ahora, en píxeles de la pista (0: la hora, al medio).
  const [moved, setMoved] = useState(0);
  const end = Math.max(0, list.length * step - gap);
  const shift = Math.min(end - position, Math.max(-position, moved));
  const center = position + shift;
  const offset = width / 2 - center;

  // Arrastrar: con el dedo o con el ratón. Un toque sin moverse sigue siendo un clic en la tarjeta.
  const drag = useRef<{ x: number; from: number; moving: boolean } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: shift, moving: false };
    dragged.current = false;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    if (!d.moving && Math.abs(dx) < 6) return;
    if (!d.moving) {
      d.moving = true;
      dragged.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setMoved(d.from - dx);
  };
  const onPointerEnd = () => {
    drag.current = null;
  };
  const jump = (direction: 1 | -1) => setMoved(shift + direction * step);

  // Solo lo que se ve (y un poco más).
  const first = step > 0 ? Math.max(0, Math.floor((center - width / 2 - card) / step)) : 0;
  const last = step > 0 ? Math.min(list.length - 1, Math.ceil((center + width / 2) / step)) : -1;
  const visible: { occurrence: Occurrence; index: number }[] = [];
  for (let index = first; index <= last; index++) visible.push({ occurrence: list[index], index });
  const height = Math.round(card * ratio) + NAME_ROW;
  const arrow =
    'absolute z-30 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card/95 text-foreground shadow-md transition-opacity hover:bg-card disabled:pointer-events-none disabled:opacity-0 [@media(hover:hover)]:flex';

  return (
    <div
      ref={boxRef}
      className="relative touch-pan-y select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(event) => {
        // El clic que cierra un arrastre no abre la tarjeta que quedó debajo.
        if (!dragged.current) return;
        dragged.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {classes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('Este horario aún no tiene clases. Añádelas en «Semanal».')}</p>
      ) : (
        <>
          <Track uid={uid} list={list} visible={visible} width={width} card={card} height={height} step={step} offset={offset} shift={shift} now={now} today={today} onFix={onFix} />
          <button type="button" className={cn(arrow, 'left-1')} style={{ top: 32 + height / 2 }} disabled={center <= 0} onClick={() => jump(-1)} aria-label={tr('Anteriores')}>
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" className={cn(arrow, 'right-1')} style={{ top: 32 + height / 2 }} disabled={center >= end} onClick={() => jump(1)} aria-label={tr('Siguientes')}>
            <ChevronRight className="h-4 w-4" />
          </button>
          {shift !== 0 && (
            <button
              type="button"
              onClick={() => setMoved(0)}
              className="absolute left-1/2 top-0 z-40 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-md transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <LocateFixed className="h-3 w-3" />
              {tr('Ahora')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface TrackProps {
  uid: string;
  list: Occurrence[];
  visible: { occurrence: Occurrence; index: number }[];
  width: number;
  card: number;
  /** Alto de la tarjeta: su imagen, con la proporción de Asignaturas, y el nombre. */
  height: number;
  step: number;
  offset: number;
  /** Cuánto se apartó el usuario de la hora de ahora (0: la hora, al medio). */
  shift: number;
  now: number;
  today: number;
  onFix: () => void;
}

function Track({ uid, list, visible, width, card, height, step, offset, shift, now, today, onFix }: TrackProps) {
  // La hora de ahora va al medio; si el usuario se desplazó, se va con su tarjeta (y fuera del recuadro no se pinta).
  const nowAt = width / 2 - shift;
  const nowShown = nowAt > 8 && nowAt < width - 8;
  return (
    <>
      {nowShown && (
        <>
          <div aria-hidden className="pointer-events-none absolute bottom-0 top-3 z-20 w-0.5 -translate-x-1/2 rounded-full bg-primary/80" style={{ left: nowAt }} />
          {shift === 0 && (
            <div className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow-sm">
              {timeOf(minutesOfDay(now))}
            </div>
          )}
        </>
      )}

      {width > 0 && (
        <div className="relative overflow-hidden" style={{ WebkitMaskImage: FADE, maskImage: FADE }}>
          <div className="relative" style={{ transform: `translateX(${offset}px)` }}>
            {/* Horas, en gris */}
            <div className="relative h-6 text-[12px] tabular-nums text-muted-foreground">
              {visible.map(({ occurrence, index }) => {
                const next = list[index + 1];
                const previous = list[index - 1];
                const day = startOfDay(occurrence.start);
                const firstOfDay = !previous || startOfDay(previous.start) !== day;
                const left = index * step;
                const startText = `${firstOfDay && day !== today ? `${dayShort(occurrence.item.day - 1)} ` : ''}${timeOf(minutesOf(occurrence.item.start)!)}`;
                // El fin solo si deja un hueco ese mismo día: el de la última clase lo dice su tarjeta.
                const showEnd = !!next && startOfDay(next.start) === day && next.start !== occurrence.end;
                // Las horas se apartan de la etiqueta del medio: la hora de ahora o, desplazado, «Ahora».
                const nearNow = (x: number) => Math.abs(x + offset - width / 2) < 44;
                return (
                  <div key={occurrence.key}>
                    {!nearNow(left + 18) && (
                      <span className="absolute top-1 whitespace-nowrap" style={{ left }}>
                        {startText}
                      </span>
                    )}
                    {showEnd && !nearNow(left + card - 18) && (
                      <span className="absolute top-1 -translate-x-full whitespace-nowrap" style={{ left: left + card }}>
                        {timeOf(minutesOf(occurrence.item.end)!)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Tarjetas */}
            <div className="relative mt-2" style={{ height }}>
              {visible.map(({ occurrence, index }) => (
                <ClassCard key={occurrence.key} uid={uid} occurrence={occurrence} left={index * step} width={card} now={now} today={today} onFix={onFix} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ClassCard({ uid, occurrence, left, width, now, today, onFix }: { uid: string; occurrence: Occurrence; left: number; width: number; now: number; today: number; onFix: () => void }) {
  const { item } = occurrence;
  const navigate = useNavigate();
  const { courses } = useCourse();
  const links = useSubjectLinks(uid);
  const own = courses ?? [];
  // La asignatura de Frame de esta clase: su imagen y su nombre.
  const course = useMemo(() => linkedCourse(courses ?? [], links, item.subject), [courses, links, item.subject]);
  const [image, , imageRead] = useStoredImage(course ? `courseImage_${course.id}` : null);
  // Una imagen guardada que ya no se puede pintar (dañada): como si no la tuviera.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [image]);
  const current = now >= occurrence.start && now < occurrence.end;
  const past = now >= occurrence.end;
  const progress = current ? (now - occurrence.start) / (occurrence.end - occurrence.start) : 0;
  const day = startOfDay(occurrence.start) === today ? null : dayLabel(occurrence, today);
  const teacher = course?.teacherName?.trim() || item.teacher || '';
  const details = [item.subject, `${item.start}–${item.end}`, item.room, teacher].filter(Boolean).join(' · ');
  // «Ninguna», dicho por el usuario: no se le vuelve a ofrecer en la tarjeta.
  const undecided = !course && links.get(normalize(item.subject)) !== '' && own.length > 0;

  const face = (
    <>
      <span className={cn('relative block min-h-0 flex-1 overflow-hidden', course ? 'bg-transparent' : 'bg-muted')}>
        {image && !broken ? (
          <img src={image} alt="" draggable={false} onError={() => setBroken(true)} className="h-full w-full object-cover" />
        ) : !course ? (
          // Ninguna asignatura de Frame es esta clase: sus iniciales y cómo elegirla.
          <span className="flex h-full w-full flex-col items-center justify-center gap-1">
            <span className="font-headline text-xl font-bold leading-none" style={{ color: subjectColor(item.subject) }}>
              {initials(item.subject)}
            </span>
            {undecided && <span className="rounded-full border border-border/70 bg-background/85 px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">{tr('Elegir asignatura')}</span>}
          </span>
        ) : imageRead || broken ? (
          // La asignatura no tiene imagen elegida: lo mismo que enseña en Asignaturas.
          <WaveBackdrop />
        ) : null /* aún leyendo su imagen: nada, para que no parpadee otra cosa antes */}
        {day && <span className="absolute left-2 top-2 max-w-[70%] truncate rounded-full bg-background/85 px-1.5 text-[10px] font-semibold text-foreground shadow-sm">{day}</span>}
        {current && <span className="absolute right-2 top-2 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground shadow-sm">{tr('Ahora')}</span>}
        {current && (
          <span className="absolute inset-x-0 bottom-0 block h-1 bg-black/20">
            <span className="block h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center border-t border-border/60 px-3" style={{ height: NAME_ROW }}>
        <span className="block w-full truncate text-center text-xs font-bold text-primary">{course?.name ?? item.subject}</span>
      </span>
    </>
  );
  const frame = cn('flex h-full w-full flex-col overflow-hidden border bg-card text-left shadow-sm transition-opacity', current && 'ring-2 ring-primary/60', past && 'opacity-55');

  return (
    <div className="absolute inset-y-0" style={{ left, width }}>
      {own.length === 0 ? (
        <div className={frame} title={details}>
          {face}
        </div>
      ) : (
        <button
          type="button"
          className={cn(frame, 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
          title={details}
          onClick={() => (course ? navigate(`/cursos?id=${encodeURIComponent(course.id)}`) : onFix())}
        >
          {face}
        </button>
      )}
    </div>
  );
}

/** Dos letras para la tarjeta sin imagen («Lengua y Literatura» → «LL»). */
function initials(subject: string): string {
  const words = subject.split(/\s+/).filter((word) => word.length > 2 || /^[A-ZÁÉÍÓÚÑ]/.test(word));
  return (words.slice(0, 2).map((word) => word[0]).join('') || subject.slice(0, 2)).toUpperCase();
}
