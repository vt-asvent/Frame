import React, { useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  startOfMonth,
  startOfToday,
  startOfWeek,
  subDays,
} from 'date-fns';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Flame,
  Target,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import type { Habit } from '@/types';
import HabitRings from '@/components/habits/HabitRings';
import { isScheduled } from '@/lib/habit-schedule';
import { dateLocale, tr } from '@/lib/i18n';
import { dayInitials, dayName } from '@/lib/day-names';
import { localDayKey } from '@/lib/dates';
import { useTodayKey } from '@/hooks/use-today';

// ============================================================
// Cumplimiento de hábitos.
//
// La cuadrícula de arriba dice QUÉ marcaste. Esto dice CÓMO vas, y lo dice
// con formas antes que con números: un anillo se lee de un vistazo y una
// tabla no.
//
// Cada pieza responde a una pregunta distinta:
//   · el anillo grande   → ¿cómo voy este periodo, mejor o peor que el anterior?
//   · el trazo del ritmo → ¿qué días me caí?
//   · los anillos        → ¿qué hábito sostengo y cuál abandono?
//   · la semana tipo     → ¿qué día de la semana se me atraganta siempre?
//   · el mapa            → ¿cómo se ve mi constancia de lejos?
//
// Todo se dibuja con SVG y variables de tema: se ve igual en claro y oscuro,
// escala sin pixelarse y no arrastra ninguna librería de gráficos.
// ============================================================

type Scope = 'week' | 'month';

const HEATMAP_WEEKS = 12;

/** Cada hábito con sus marcas en un Set y su día de alta, listos para los bucles. */
interface Prepared {
  habit: Habit;
  marks: Set<string>;
  since: string;
}

const prepare = (habits: Habit[]): Prepared[] =>
  habits.map((habit) => ({ habit, marks: new Set(habit.completedOn ?? []), since: habit.createdAt ? localDayKey(habit.createdAt) : '' }));

/**
 * Lo que tocaba un día y lo que se cumplió. Solo cuenta lo programado y desde
 * el alta de cada hábito (como los anillos): antes, crear un hábito hoy volvía
 * fallados todos los días anteriores y hundía la racha y el récord. Una marca
 * en un día programado cuenta siempre, aunque sea anterior al alta.
 */
function tally(prepared: Prepared[], day: Date, key = localDayKey(day)): { due: number; done: number } {
  let due = 0;
  let done = 0;
  for (const { habit, marks, since } of prepared) {
    if (!isScheduled(habit, day)) continue;
    const marked = marks.has(key);
    if (!marked && since && key < since) continue;
    due += 1;
    if (marked) done += 1;
  }
  return { due, done };
}

interface PeriodStats {
  days: Date[];
  compliance: number;
  done: number;
  possible: number;
  perfectDays: number;
  activeDays: number;
  /** Cumplidos por día, en el orden del periodo. */
  series: { date: Date; done: number }[];
}

function computePeriod(prepared: Prepared[], days: Date[]): PeriodStats {
  // Solo cuenta lo que tocaba: un hábito de «solo los sábados» no suma
  // cinco fallos cada semana.
  let possible = 0;
  let done = 0;
  let perfectDays = 0;
  let activeDays = 0;
  const series: { date: Date; done: number }[] = [];

  for (const day of days) {
    const { due, done: dayCount } = tally(prepared, day);
    possible += due;
    done += dayCount;
    if (dayCount > 0) activeDays += 1;
    if (due > 0 && dayCount === due) perfectDays += 1;
    series.push({ date: day, done: dayCount });
  }

  return {
    days,
    done,
    possible,
    compliance: possible > 0 ? (done / possible) * 100 : 0,
    perfectDays,
    activeDays,
    series,
  };
}

function perfectStreaks(prepared: Prepared[], today: Date): { current: number; best: number } {
  if (prepared.length === 0) return { current: 0, best: 0 };
  let firstKey = '';
  for (const { marks } of prepared) for (const d of marks) if (!firstKey || d < firstKey) firstKey = d;
  if (!firstKey) return { current: 0, best: 0 };

  const first = new Date(`${firstKey}T00:00:00`);
  // Un día es perfecto si se cumplió todo lo que tocaba. Un día sin nada
  // programado no es perfecto ni fallido: se salta sin cortar la racha.
  const verdict = (day: Date): 'perfect' | 'broken' | 'skip' => {
    const { due, done } = tally(prepared, day);
    if (due === 0) return 'skip';
    return done === due ? 'perfect' : 'broken';
  };

  let best = 0;
  let run = 0;
  for (const day of eachDayOfInterval({ start: first, end: today })) {
    const v = verdict(day);
    if (v === 'skip') continue;
    if (v === 'perfect') {
      run += 1;
      best = Math.max(best, run);
    } else run = 0;
  }

  let current = 0;
  let cursor = verdict(today) === 'perfect' ? today : subDays(today, 1);
  for (let guard = 0; guard < 3660; guard++) {
    const v = verdict(cursor);
    if (v === 'broken') break;
    if (v === 'perfect') current += 1;
    cursor = subDays(cursor, 1);
    if (cursor < first) break;
  }
  return { current, best };
}

// ------------------------------------------------------------
// Piezas dibujadas
// ------------------------------------------------------------

/** Anillo de progreso. El arco exterior es el periodo actual; el interior,
 *  tenue, es el anterior: la comparación se ve sin leer ningún número. */
function Gauge({
  value,
  previous,
  size = 168,
}: {
  value: number;
  previous?: number;
  size?: number;
}) {
  const stroke = 12;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const innerRadius = radius - stroke - 4;
  const innerCircumference = 2 * Math.PI * innerRadius;
  const clamped = Math.max(0, Math.min(100, value));
  const prevClamped = Math.max(0, Math.min(100, previous ?? 0));

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <defs>
        <linearGradient id="gaugeFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" />
          <stop offset="100%" stopColor="hsl(var(--chart-2))" />
        </linearGradient>
      </defs>
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#gaugeFill)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
        {previous !== undefined && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={innerRadius}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeOpacity={0.25}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={innerCircumference}
            strokeDashoffset={innerCircumference * (1 - prevClamped / 100)}
          />
        )}
      </g>
      <text
        x="50%"
        y="47%"
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-foreground font-headline"
        style={{ fontSize: size * 0.24, fontWeight: 700 }}
      >
        {Math.round(clamped)}%
      </text>
      <text
        x="50%"
        y="64%"
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: size * 0.075 }}
      >
        {tr('Cumplido')}
      </text>
    </svg>
  );
}

/** Trazo del ritmo: área con degradado y un punto por día. */
function RhythmChart({
  series,
  total,
  height = 150,
}: {
  series: { date: Date; done: number }[];
  total: number;
  height?: number;
}) {
  if (series.length === 0 || total === 0) return null;
  const width = 100;
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  const y = (done: number) => 100 - (done / total) * 100;
  const points = series.map((d, i) => ({ x: i * step, y: y(d.done), ...d }));
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const area = `${line} L${width},100 L0,100 Z`;

  return (
    <TooltipProvider delayDuration={100}>
      <div className="relative" style={{ height }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-full w-full overflow-visible"
        >
          <defs>
            <linearGradient id="rhythmArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
            </linearGradient>
          </defs>
          {/* Referencias: todo cumplido y la mitad. */}
          <line x1="0" y1="0" x2="100" y2="0" stroke="hsl(var(--border))" strokeWidth="0.4" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <line x1="0" y1="50" x2="100" y2="50" stroke="hsl(var(--border))" strokeWidth="0.4" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          <path d={area} fill="url(#rhythmArea)" />
          <path
            d={line}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Puntos y etiquetas por encima, en píxeles: así no se deforman. */}
        <div className="absolute inset-0 flex items-stretch">
          {points.map((p, i) => (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div className="relative flex-1 cursor-default">
                  <span
                    className={cn(
                      'absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background transition-transform hover:scale-150',
                      p.done === total ? 'bg-emerald-500' : p.done === 0 ? 'bg-muted-foreground/50' : 'bg-primary'
                    )}
                    style={{ left: `${points.length === 1 ? 50 : (i / (points.length - 1)) * 100}%`, top: `${p.y}%` }}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="text-xs">
                  {format(p.date, tr('d \'de\' MMMM'), { locale: dateLocale() })} — {p.done}{' '}{tr('de')}{' '}{total}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}

function Delta({ now, before, suffix = '' }: { now: number; before: number; suffix?: string }) {
  const diff = Math.round(now - before);
  if (before === 0 && now === 0) {
    return <span className="text-[11px] text-muted-foreground/70">{tr('Sin datos previos')}</span>;
  }
  const Icon = diff > 0 ? ArrowUpRight : diff < 0 ? ArrowDownRight : ArrowRight;
  const tone = diff > 0 ? 'text-emerald-500' : diff < 0 ? 'text-red-400' : 'text-muted-foreground';
  return (
    <span className={cn('flex items-center gap-1 text-[11px] font-semibold', tone)}>
      <Icon className="h-3.5 w-3.5" />
      {diff > 0 ? '+' : ''}
      {diff}
      {suffix}
    </span>
  );
}

function Panel({
  title,
  subtitle,
  className,
  children,
}: {
  title?: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        'overflow-hidden border-border/60 bg-gradient-to-br from-card via-card to-secondary/25 transition-shadow hover:shadow-[0_0_24px_hsl(var(--primary)/0.10)]',
        className
      )}
    >
      <CardContent className="p-4 pt-5">
        {title && (
          <EchoTileHeader word={title.split(' ')[0]} className="-mt-5 mb-4 pt-5 text-center">
            <h4 className="text-sm font-semibold text-primary">{title}</h4>
            {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
          </EchoTileHeader>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

/** Cifra suelta dentro de un panel, con su tinte. */
function Stat({
  icon: Icon,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-background/40 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight text-foreground">{value}</p>
        {hint && <p className="truncate text-[10px] text-muted-foreground/80">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

function heatTone(ratio: number): string {
  if (ratio <= 0) return 'bg-secondary';
  if (ratio < 0.34) return 'bg-primary/25';
  if (ratio < 0.67) return 'bg-primary/50';
  if (ratio < 1) return 'bg-primary/75';
  return 'bg-primary';
}

// ------------------------------------------------------------

export default function HabitsInsights({ weekOffset = 0 }: { weekOffset?: number }) {
  const { habits } = useCourse();
  const [scope, setScope] = useState<Scope>('week');
  const [offset, setOffset] = useState(0);

  // Una fecha estable mientras no cambie el día: con `startOfToday()` en cada
  // pintado ningún cálculo de abajo se reutilizaba (≈25 ms por pintado).
  const todayKey = useTodayKey();
  const today = useMemo(() => startOfToday(), [todayKey]);
  const activeHabits = useMemo(() => (habits ?? []).filter((h) => !h.isArchived), [habits]);
  const active = useMemo(() => prepare(activeHabits), [activeHabits]);

  const buildDays = useMemo(
    () =>
      (shift: number): Date[] => {
        const ref = scope === 'week' ? addWeeks(today, shift) : addMonths(today, shift);
        const start = scope === 'week' ? startOfWeek(ref, { weekStartsOn: 1 }) : startOfMonth(ref);
        const end = scope === 'week' ? endOfWeek(ref, { weekStartsOn: 1 }) : endOfMonth(ref);
        const capped = isAfter(end, today) ? today : end;
        if (isAfter(start, capped)) return [];
        return eachDayOfInterval({ start, end: capped });
      },
    [scope, today]
  );

  const current = useMemo(() => computePeriod(active, buildDays(offset)), [active, buildDays, offset]);
  const previous = useMemo(() => computePeriod(active, buildDays(offset - 1)), [active, buildDays, offset]);

  const periodLabel = useMemo(() => {
    const ref = scope === 'week' ? addWeeks(today, offset) : addMonths(today, offset);
    if (scope === 'month') {
      const label = format(ref, tr('MMMM \'de\' yyyy'), { locale: dateLocale() });
      return label.charAt(0).toUpperCase() + label.slice(1);
    }
    const start = startOfWeek(ref, { weekStartsOn: 1 });
    const end = endOfWeek(ref, { weekStartsOn: 1 });
    return `${format(start, tr('d MMM'), { locale: dateLocale() })} — ${format(end, tr('d MMM'), { locale: dateLocale() })}`;
  }, [scope, offset, today]);

  const weekdayProfile = useMemo(() => {
    if (active.length === 0) return [];
    const done = Array(7).fill(0);
    const possible = Array(7).fill(0);
    for (const day of current.days) {
      const index = (day.getDay() + 6) % 7;
      const counts = tally(active, day);
      possible[index] += counts.due;
      done[index] += counts.done;
    }
    return dayInitials().map((initial, index) => ({
      initial,
      name: dayName(index),
      ratio: possible[index] > 0 ? done[index] / possible[index] : 0,
      counted: possible[index] > 0,
    }));
  }, [active, current.days]);

  const bestWeekday = useMemo(() => {
    const counted = weekdayProfile.filter((d) => d.counted);
    if (counted.length === 0) return null;
    return counted.reduce((a, b) => (a.ratio >= b.ratio ? a : b));
  }, [weekdayProfile]);
  const worstWeekday = useMemo(() => {
    const counted = weekdayProfile.filter((d) => d.counted);
    if (counted.length === 0) return null;
    return counted.reduce((a, b) => (a.ratio <= b.ratio ? a : b));
  }, [weekdayProfile]);

  const heatmap = useMemo(() => {
    if (active.length === 0) return [];
    const end = endOfWeek(today, { weekStartsOn: 1 });
    const start = startOfWeek(subDays(end, HEATMAP_WEEKS * 7 - 1), { weekStartsOn: 1 });
    const weeks: { date: Date; ratio: number; future: boolean; done: number; due: number; isToday: boolean }[][] = [];
    let cursor = start;
    while (!isAfter(cursor, end)) {
      const week = Array.from({ length: 7 }, (_, i) => {
        const day = addDays(cursor, i);
        const key = localDayKey(day);
        const { due, done } = tally(active, day, key);
        return {
          date: day,
          done,
          due,
          ratio: due > 0 ? done / due : 0,
          future: isAfter(day, today),
          isToday: key === todayKey,
        };
      });
      weeks.push(week);
      cursor = addDays(cursor, 7);
    }
    return weeks;
  }, [active, today, todayKey]);

  const streaks = useMemo(() => perfectStreaks(active, today), [active, today]);

  // La semana de los anillos es la que se navega arriba, junto a la tabla.
  // Memorizada (y antes de la salida temprana): un arreglo nuevo en cada
  // pintado anulaba la memoria de los anillos.
  const ringWeek = useMemo(() => {
    const monday = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [today, weekOffset]);

  if (active.length === 0) {
    return (
      <section className="space-y-4">
        <h3 className="text-center text-xl font-semibold text-primary">{tr('Cumplimiento')}</h3>
        <Card className="flex h-40 flex-col items-center justify-center gap-2 border-dashed bg-card/50">
          <Target className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">{tr('Todavía no hay hábitos activos.')}</p>
          <p className="px-6 text-center text-xs text-muted-foreground/70">
            {tr('Crea uno arriba y aquí aparecerá cómo lo vas sosteniendo.')}
          </p>
        </Card>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="relative flex items-center justify-center">
        <h3 className="text-xl font-semibold text-primary">{tr('Cumplimiento')}</h3>
        <div className="absolute right-0">
          <Tabs
            value={scope}
            onValueChange={(value) => {
              setScope(value as Scope);
              setOffset(0);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="week">{tr('Semana')}</TabsTrigger>
              <TabsTrigger value="month">{tr('Mes')}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffset((o) => o - 1)} title={tr('Periodo anterior')}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <p className="whitespace-nowrap text-sm font-semibold text-primary">{periodLabel}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset >= 0}
          title={tr('Periodo siguiente')}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {/* ---------- Cabecera: anillo + cifras + ritmo ---------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" aria-hidden />
              <Gauge value={current.compliance} previous={previous.compliance} />
            </div>
            <div className="flex items-center gap-2">
              <Delta now={current.compliance} before={previous.compliance} suffix=" pts" />
              <span className="text-[11px] text-muted-foreground">
                {tr('vs')}{' '}{scope === 'week' ? tr('la semana anterior') : tr('el mes anterior')}
              </span>
            </div>
            {/* El embudo del periodo, en una línea. */}
            <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-border/50 bg-background/40 px-3 py-2 text-center">
              <span className="text-sm font-bold tabular-nums text-muted-foreground">{current.possible}</span>
              <span className="text-[10px] text-muted-foreground">{tr('posibles')}</span>
              <ArrowRight className="h-3.5 w-3.5 text-primary/60" />
              <span className="text-sm font-bold tabular-nums text-primary">{current.done}</span>
              <span className="text-[10px] text-muted-foreground">{tr('cumplidas')}</span>
            </div>
          </div>
        </Panel>

        <Panel
          title={tr('Ritmo del periodo')}
          subtitle={tr('Hábitos cumplidos cada día, sobre {length}', { length: active.length })}
          className="lg:col-span-2"
        >
          <RhythmChart series={current.series} total={active.length} />
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Stat
              icon={CalendarCheck2}
              label={tr('Días perfectos')}
              value={`${current.perfectDays}/${current.days.length}`}
            />
            <Stat
              icon={Flame}
              label={tr('Racha perfecta')}
              value={String(streaks.current)}
              hint={streaks.best > 0 ? tr('récord: {best}', { best: streaks.best }) : tr('sin récord aún')}
            />
            <Stat
              icon={Target}
              label={tr('Días activos')}
              value={`${current.activeDays}/${current.days.length}`}
            />
          </div>
        </Panel>
      </div>

      {/* ---------- Mañana, tarde y noche: la semana en anillos ---------- */}
      <HabitRings habits={activeHabits} weekDates={ringWeek} />

      {/* ---------- Semana tipo y mapa de constancia, a medias ---------- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title={tr('Tu semana tipo')} subtitle={tr('Dónde se sostiene y dónde se cae')}>
          <TooltipProvider delayDuration={150}>
            <div className="flex h-[180px] items-end justify-between gap-2">
              {weekdayProfile.map((day) => {
                const isBest = bestWeekday?.name === day.name && day.ratio > 0;
                const isWorst = worstWeekday?.name === day.name && day.counted && !isBest;
                return (
                  <Tooltip key={day.name}>
                    <TooltipTrigger asChild>
                      <div className="flex h-full flex-1 cursor-default flex-col items-center justify-end gap-1.5">
                        <span
                          className={cn(
                            'text-[10px] font-bold tabular-nums',
                            isBest ? 'text-emerald-500' : isWorst ? 'text-amber-500' : 'text-muted-foreground'
                          )}
                        >
                          {day.counted ? `${Math.round(day.ratio * 100)}%` : '—'}
                        </span>
                        <div className="flex w-full flex-1 items-end">
                          <div
                            className={cn(
                              'w-full rounded-t-md transition-all duration-500',
                              !day.counted && 'bg-secondary',
                              day.counted && isBest && 'bg-gradient-to-t from-emerald-500/40 to-emerald-500',
                              day.counted && isWorst && 'bg-gradient-to-t from-amber-500/40 to-amber-500',
                              day.counted && !isBest && !isWorst && 'bg-gradient-to-t from-primary/30 to-primary'
                            )}
                            style={{ height: `${Math.max(day.counted ? 4 : 2, day.ratio * 100)}%` }}
                          />
                        </div>
                        <span
                          className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                            isBest
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : isWorst
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'text-muted-foreground'
                          )}
                        >
                          {day.initial}
                        </span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <p className="text-xs capitalize">
                        {day.name}: {day.counted ? tr('{p} % cumplido', { p: Math.round(day.ratio * 100) }) : tr('sin días aún')}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
          {bestWeekday && worstWeekday && bestWeekday.name !== worstWeekday.name && (
            <p className="mt-3 text-center text-[11px] text-muted-foreground">
              {tr('Tu mejor día es el')}{' '}<span className="font-semibold capitalize text-emerald-500">{bestWeekday.name}</span>{' '}{tr('y el que peor te sale, el')}{' '}<span className="font-semibold capitalize text-amber-500">{worstWeekday.name}</span>.
            </p>
          )}
        </Panel>

        <Panel
          title={tr('Mapa de constancia')}
          subtitle={tr('Las últimas 12 semanas: cuanto más intenso, más hábitos cumplidos ese día')}
        >
        <TooltipProvider delayDuration={100}>
          <div className="flex justify-center gap-1 overflow-x-auto pb-1">
            <div className="mr-1 flex flex-col gap-1 pt-[1px]">
              {dayInitials().map((initial, index) => (
                <span key={index} className="flex h-3.5 items-center text-[9px] leading-none text-muted-foreground/70">
                  {initial}
                </span>
              ))}
            </div>
            {heatmap.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((day) => (
                  <Tooltip key={localDayKey(day.date)}>
                    <TooltipTrigger asChild>
                      <div
                        className={cn(
                          'h-3.5 w-3.5 rounded-[3px] transition-transform hover:scale-125',
                          day.future ? 'bg-transparent' : heatTone(day.ratio),
                          day.isToday && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                        )}
                      />
                    </TooltipTrigger>
                    {!day.future && (
                      <TooltipContent side="top">
                        <p className="text-xs">
                          {format(day.date, tr('d \'de\' MMMM'), { locale: dateLocale() })} —{' '}
                          {day.due > 0 ? tr('{done} de {due}', { done: day.done, due: day.due }) : tr('sin hábitos ese día')}
                        </p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                ))}
              </div>
            ))}
          </div>
        </TooltipProvider>
        <div className="mt-3 flex items-center justify-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">{tr('Menos')}</span>
          {[0, 0.3, 0.6, 0.9, 1].map((ratio) => (
            <span key={ratio} className={cn('h-3 w-3 rounded-[3px]', heatTone(ratio))} />
          ))}
          <span className="text-[10px] text-muted-foreground">{tr('Más')}</span>
        </div>
        <p className="mt-3 text-center text-[10px] text-muted-foreground/80">
          {tr('El cumplimiento cuenta solo los días ya vividos del periodo, no los que faltan.')}
        </p>
        </Panel>
      </div>
    </section>
  );
}
