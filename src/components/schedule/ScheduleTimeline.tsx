import { useEffect, useMemo, useRef, useState } from 'react';
import {
  minutesOf,
  minutesOfDay,
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
// Cada tarjeta mide un poco menos de un tercio del ancho: una al medio, una a
// cada lado y, en los bordes, un trozo de la siguiente con degradado. La pista
// se mueve con el reloj: una clase de 8 a 12 queda centrada a las 10, y a las
// 9 la línea cae a un cuarto de su tarjeta. Entre días (y el fin de semana)
// la línea recorre el hueco hasta la primera clase del siguiente.
// ============================================================

/** Ancho de la tarjeta y del hueco, en fracción del recuadro. En un teléfono, una tarjeta casi entera. */
const sizes = (width: number) => (width < 640 ? { card: 0.62, gap: 0.04 } : { card: 0.28, gap: 0.02 });
const FADE = 'linear-gradient(90deg, transparent 0, #000 7%, #000 93%, transparent 100%)';

function dayLabel(occurrence: Occurrence, today: number): string {
  const days = Math.round((startOfDay(occurrence.start) - today) / 86_400_000);
  if (days === 0) return tr('Hoy');
  if (days === 1) return tr('Mañana');
  if (days === -1) return tr('Ayer');
  return dayTitle(occurrence.item.day - 1);
}

export default function ScheduleTimeline({ classes }: { classes: TimetableClass[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
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
  const offset = width / 2 - position;

  // Solo lo que se ve (y un poco más).
  const first = step > 0 ? Math.max(0, Math.floor((position - width / 2 - card) / step)) : 0;
  const last = step > 0 ? Math.min(list.length - 1, Math.ceil((position + width / 2) / step)) : -1;
  const visible: { occurrence: Occurrence; index: number }[] = [];
  for (let index = first; index <= last; index++) visible.push({ occurrence: list[index], index });

  return (
    <div ref={boxRef} className="relative select-none">
      {classes.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{tr('Este horario aún no tiene clases. Añádelas en «Semanal».')}</p>
      ) : (
        <Track list={list} visible={visible} width={width} card={card} step={step} offset={offset} now={now} today={today} />
      )}
    </div>
  );
}

interface TrackProps {
  list: Occurrence[];
  visible: { occurrence: Occurrence; index: number }[];
  width: number;
  card: number;
  step: number;
  offset: number;
  now: number;
  today: number;
}

function Track({ list, visible, width, card, step, offset, now, today }: TrackProps) {
  return (
    <>
      {/* La hora de ahora, siempre al medio */}
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/2 top-3 z-20 w-0.5 -translate-x-1/2 rounded-full bg-primary/80" />
      <div className="pointer-events-none absolute left-1/2 top-0 z-30 -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold tabular-nums text-primary-foreground shadow-sm">
        {timeOf(minutesOfDay(now))}
      </div>

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
            <div className="relative mt-2 h-[8.5rem]">
              {visible.map(({ occurrence, index }) => (
                <ClassCard key={occurrence.key} occurrence={occurrence} left={index * step} width={card} now={now} today={today} />
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ClassCard({ occurrence, left, width, now, today }: { occurrence: Occurrence; left: number; width: number; now: number; today: number }) {
  const { item } = occurrence;
  const color = subjectColor(item.subject);
  const current = now >= occurrence.start && now < occurrence.end;
  const past = now >= occurrence.end;
  const progress = current ? (now - occurrence.start) / (occurrence.end - occurrence.start) : 0;
  const minutes = Math.round((occurrence.end - occurrence.start) / 60_000);
  const detail = [item.room, item.teacher].filter(Boolean).join(' · ') || (minutes >= 60 && minutes % 60 === 0 ? tr('{h} h', { h: minutes / 60 }) : tr('{m} min', { m: minutes }));

  return (
    <div className="absolute inset-y-0" style={{ left, width }}>
      <div
        className={cn(
          'flex h-full flex-col gap-1 overflow-hidden rounded-xl border bg-card p-3 shadow-sm transition-opacity',
          current && 'ring-2 ring-primary/60',
          past && 'opacity-55'
        )}
        style={{ borderColor: `${color}55`, backgroundImage: `linear-gradient(135deg, ${color}2e, transparent 72%)` }}
        title={`${item.subject} · ${item.start}–${item.end}`}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate">
            {dayLabel(occurrence, today)} · {timeOf(minutesOf(item.start)!)}–{timeOf(minutesOf(item.end)!)}
          </span>
          {current && <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{tr('Ahora')}</span>}
        </div>
        <p className="line-clamp-2 font-headline text-lg font-bold leading-tight text-foreground">{item.subject}</p>
        <p className="mt-auto truncate text-xs text-muted-foreground">{detail}</p>
        {current && (
          <div className="h-1 w-full shrink-0 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
