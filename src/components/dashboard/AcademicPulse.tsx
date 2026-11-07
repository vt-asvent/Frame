import { useMemo } from 'react';
import {
  eachDayOfInterval,
  endOfISOWeek,
  format,
  startOfISOWeek,
  startOfToday,
  subWeeks,
} from 'date-fns';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarCheck2,
  CheckCircle2,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { buildDayIndex, dayKey, GOAL_DAY_KEYS, gradeForScore } from '@/lib/academic-metrics';
import { formatMinutes } from '@/lib/duration';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import { dateLocale, decimalText, tr } from '@/lib/i18n';
import { dayInitial, fromSunday } from '@/lib/day-names';
import { useTodayKey } from '@/hooks/use-today';
import type { DailyPerformance } from '@/types';

// ============================================================
// «Tu semana en datos» (modo Avanzado). Desde 1.8.0 son piezas sueltas que
// Inicio coloca junto a «Tareas pendientes»: el ritmo de estudio con el
// promedio semanal (una sola tarjeta), la constancia y las tareas culminadas.
// ============================================================

interface DayColumn {
  key: string;
  label: string;
  minutes: number;
  goal: number;
  /** Nota del día (modo Rendimiento), si la hay. */
  score: number | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekPulse {
  weekStart: Date;
  weekEnd: Date;
  days: DayColumn[];
  elapsedDays: number;
  minutes: number;
  tasksDone: number;
  activeDays: number;
  prevMinutes: number;
  prevTasksDone: number;
  goalWeek: number;
  /** Media de las notas de la semana (lunes a domingo), o null si no hay. */
  averageScore: number | null;
  rangeLabel: string;
}

const GRADE_TONE: Record<DailyPerformance['grade'], string> = {
  AD: 'bg-emerald-500/15 text-emerald-500',
  A: 'bg-primary/15 text-primary',
  B: 'bg-amber-500/15 text-amber-500',
  C: 'bg-red-500/15 text-red-400',
};

export const GradeBadge = ({ grade }: { grade: DailyPerformance['grade'] | null }) => (
  <span className={cn('rounded-md px-1.5 py-0.5 text-xs font-bold', grade ? GRADE_TONE[grade] : 'bg-secondary text-muted-foreground')}>
    {grade ?? '—'}
  </span>
);

function DeltaBadge({ value, unit }: { value: number; unit: string }) {
  const rounded = Math.round(value);
  const Icon = rounded > 0 ? ArrowUpRight : rounded < 0 ? ArrowDownRight : ArrowRight;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
        rounded > 0 && 'bg-green-500/15 text-green-500',
        rounded < 0 && 'bg-red-500/15 text-red-400',
        rounded === 0 && 'bg-secondary text-muted-foreground'
      )}
    >
      <Icon className="h-3 w-3" />
      {rounded === 0 ? tr('igual') : `${Math.abs(rounded)}${unit}`}
    </span>
  );
}

/** Las cifras de la semana ISO en curso (lunes a domingo) y de la anterior. */
export function useWeekPulse(): WeekPulse {
  const { studySessions, archivedTasks, studyGoals, dailyPerformances } = useCourse();
  const todayKey = useTodayKey();

  return useMemo(() => {
    const today = startOfToday();
    const weekStart = startOfISOWeek(today);
    const weekEnd = endOfISOWeek(today);
    const prevStart = startOfISOWeek(subWeeks(today, 1));
    const prevEnd = endOfISOWeek(subWeeks(today, 1));

    // Los hábitos no intervienen en esta franja: se pasa lista vacía.
    const index = buildDayIndex(studySessions ?? [], archivedTasks ?? [], []);
    const scoreByDay = new Map((dailyPerformances ?? []).map((p) => [p.date, p.score]));

    const sumRange = (start: Date, end: Date) => {
      let minutes = 0;
      let tasksDone = 0;
      let activeDays = 0;
      for (const day of eachDayOfInterval({ start, end })) {
        const bucket = index.get(dayKey(day));
        if (!bucket) continue;
        minutes += bucket.minutes;
        tasksDone += bucket.tasksDone;
        if (bucket.minutes > 0) activeDays += 1;
      }
      return { minutes, tasksDone, activeDays };
    };

    const week = sumRange(weekStart, weekEnd);
    const previous = sumRange(prevStart, prevEnd);

    const days: DayColumn[] = eachDayOfInterval({ start: weekStart, end: weekEnd }).map((day) => {
      const key = dayKey(day);
      const score = scoreByDay.get(key);
      return {
        key,
        label: dayInitial(fromSunday(day.getDay())),
        minutes: index.get(key)?.minutes ?? 0,
        goal: studyGoals?.[GOAL_DAY_KEYS[day.getDay()]] ?? 0,
        score: typeof score === 'number' && Number.isFinite(score) ? score : null,
        isToday: key === dayKey(today),
        isFuture: day.getTime() > today.getTime(),
      };
    });

    const scores = days.map((d) => d.score).filter((s): s is number => s !== null);

    // Días ya transcurridos de la semana (hoy incluido): denominador honesto
    // de la constancia — el domingo no cuenta como fallo si es martes.
    const elapsedDays = days.filter((d) => !d.isFuture).length || 1;
    const goalWeek = days.reduce((acc, d) => acc + (d.isFuture ? 0 : d.goal), 0);

    const rangeLabel = `${format(weekStart, tr('d \'de\' MMMM'), { locale: dateLocale() })} — ${format(weekEnd, tr('d \'de\' MMMM'), { locale: dateLocale() })}`;

    return {
      weekStart,
      weekEnd,
      days,
      elapsedDays,
      minutes: week.minutes,
      tasksDone: week.tasksDone,
      activeDays: week.activeDays,
      prevMinutes: previous.minutes,
      prevTasksDone: previous.tasksDone,
      goalWeek,
      averageScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      rangeLabel,
    };
    // `todayKey`: la semana cambia al cambiar de día.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studySessions, archivedTasks, studyGoals, dailyPerformances, todayKey]);
}

/**
 * Ritmo de estudio y promedio semanal en una sola tarjeta (1.8.0): las barras
 * son los minutos de cada día (con su meta punteada) y, en modo Rendimiento,
 * la línea ámbar es la nota de cada día y arriba va su media.
 */
export function WeekRhythmCard({ pulse, showScore, className }: { pulse: WeekPulse; showScore: boolean; className?: string }) {
  const maxColumn = Math.max(1, ...pulse.days.map((d) => Math.max(d.minutes, Math.min(d.goal, 600))));
  const minutesDelta = pulse.minutes - pulse.prevMinutes;
  const goalPercent = pulse.goalWeek > 0 ? Math.min(999, Math.round((pulse.minutes / pulse.goalWeek) * 100)) : null;
  const scored = showScore ? pulse.days.map((d, i) => ({ i, score: d.score })).filter((d): d is { i: number; score: number } => d.score !== null) : [];
  const step = 100 / pulse.days.length;
  const average = pulse.averageScore;

  return (
    <Card className={className}>
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <EchoTileHeader word={tr('Ritmo')}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              <TrendingUp className="h-4 w-4 text-primary" />
              {tr('Ritmo de estudio')}
            </div>
            <DeltaBadge value={minutesDelta} unit=" min" />
          </div>
        </EchoTileHeader>

        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex items-baseline gap-2">
            <p className="font-headline text-3xl font-bold text-primary">{formatMinutes(pulse.minutes)}</p>
            {goalPercent !== null && (
              <span className="text-xs text-muted-foreground">
                {goalPercent}{tr('% de tu meta (')}{formatMinutes(pulse.goalWeek)})
              </span>
            )}
          </div>
          {/* Promedio semanal: la media de las notas de lunes a domingo. */}
          {showScore && (
            <div className="flex items-center gap-1.5" title={tr('Promedio semanal')}>
              <span className="text-[10px] text-muted-foreground">{tr('Promedio semanal')}</span>
              <span className="font-headline text-xl font-bold tabular-nums text-amber-500 dark:text-amber-400">
                {average !== null ? decimalText(average) : '—'}
              </span>
              <GradeBadge grade={average !== null ? gradeForScore(average) : null} />
            </div>
          )}
        </div>

        <TooltipProvider delayDuration={150}>
          <div className="relative flex flex-1 items-end gap-2 pt-1">
            {pulse.days.map((day) => {
              const heightPercent = Math.max(2, Math.round((day.minutes / maxColumn) * 100));
              const goalPercentOfMax = day.goal > 0 ? Math.min(100, Math.round((day.goal / maxColumn) * 100)) : null;
              const metGoal = day.goal > 0 && day.minutes >= day.goal;
              return (
                <Tooltip key={day.key}>
                  <TooltipTrigger asChild>
                    <div className="flex flex-1 cursor-default flex-col items-center gap-1.5">
                      <div className="relative h-20 w-full overflow-hidden rounded-md bg-secondary/60">
                        <div
                          className={cn(
                            'absolute bottom-0 w-full rounded-md transition-all duration-500',
                            metGoal ? 'bg-gradient-to-t from-primary to-primary/60' : 'bg-gradient-to-t from-primary/60 to-primary/25',
                            day.minutes === 0 && 'bg-none bg-transparent'
                          )}
                          style={{ height: day.minutes > 0 ? `${heightPercent}%` : 0 }}
                        />
                        {goalPercentOfMax !== null && (
                          <span className="absolute w-full border-t border-dashed border-primary/50" style={{ bottom: `${goalPercentOfMax}%` }} />
                        )}
                      </div>
                      <span className={cn('text-[10px] font-semibold', day.isToday ? 'text-primary' : 'text-muted-foreground', day.isFuture && 'opacity-40')}>
                        {day.label}
                      </span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="font-semibold capitalize">{format(new Date(`${day.key}T00:00:00`), tr('EEEE d'), { locale: dateLocale() })}</p>
                    <p className="text-muted-foreground">
                      {day.minutes > 0 ? formatMinutes(day.minutes) : tr('Sin estudio')}
                      {day.goal > 0 && tr(' · meta {minutes}', { minutes: formatMinutes(day.goal) })}
                    </p>
                    {showScore && day.score !== null && (
                      <p className="text-muted-foreground">{tr('Nota {score} ({grade})', { score: decimalText(day.score), grade: gradeForScore(day.score) })}</p>
                    )}
                  </TooltipContent>
                </Tooltip>
              );
            })}

            {/* La nota de cada día, sobre las barras (0 abajo, 20 arriba). */}
            {scored.length > 0 && (
              <div className="pointer-events-none absolute inset-x-0 top-1 h-20" aria-hidden>
                {scored.length > 1 && (
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
                    <polyline
                      points={scored.map((d) => `${(d.i + 0.5) * step},${100 - (Math.min(20, Math.max(0, d.score)) / 20) * 100}`).join(' ')}
                      fill="none"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className="stroke-amber-500 dark:stroke-amber-400"
                    />
                  </svg>
                )}
                {scored.map((d) => (
                  <span
                    key={d.i}
                    className="absolute h-2 w-2 -translate-x-1/2 translate-y-1/2 rounded-full bg-amber-500 ring-2 ring-card dark:bg-amber-400"
                    style={{ left: `${(d.i + 0.5) * step}%`, bottom: `${(Math.min(20, Math.max(0, d.score)) / 20) * 100}%` }}
                  />
                ))}
              </div>
            )}
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}

export function ConsistencyCard({ pulse, className }: { pulse: WeekPulse; className?: string }) {
  const consistency = Math.round((pulse.activeDays / pulse.elapsedDays) * 100);
  return (
    <Card className={className}>
      <CardContent className="flex h-full flex-col gap-2 p-4 text-center">
        <EchoTileHeader word={tr('Constancia')}>
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <CalendarCheck2 className="h-4 w-4 text-primary" />
            {tr('Constancia')}
          </div>
        </EchoTileHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <div className="relative flex h-24 w-24 items-center justify-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 h-24 w-24 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-secondary" />
              <circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 15.5}
                strokeDashoffset={2 * Math.PI * 15.5 * (1 - Math.min(1, consistency / 100))}
                className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
              />
            </svg>
            <p className="relative font-headline text-2xl font-bold text-primary tabular-nums">{consistency}%</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {pulse.activeDays}{' '}{tr('de')}{' '}{pulse.elapsedDays}{' '}
            {pulse.elapsedDays === 1 ? tr('día') : tr('días')}{' '}{tr('con estudio')}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function TasksDoneCard({ pulse, className }: { pulse: WeekPulse; className?: string }) {
  return (
    <Card className={className}>
      <CardContent className="flex h-full flex-col gap-2 p-4 text-center">
        <EchoTileHeader word={tr('Tareas')}>
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            {tr('Tareas culminadas')}
          </div>
        </EchoTileHeader>
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <p className="font-headline text-4xl font-bold text-primary tabular-nums">{pulse.tasksDone}</p>
          <DeltaBadge value={pulse.tasksDone - pulse.prevTasksDone} unit="" />
          <p className="text-[11px] text-muted-foreground">{tr('frente a la semana pasada')}</p>
        </div>
      </CardContent>
    </Card>
  );
}
