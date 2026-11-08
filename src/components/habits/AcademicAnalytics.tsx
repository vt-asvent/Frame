import { useMemo, useState } from 'react';
import {
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfISOWeek,
  format,
  getISOWeek,
  isSameMonth,
  parseISO,
  startOfISOWeek,
} from 'date-fns';
import {
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Gauge,
  ListChecks,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { useCourse } from '@/context/CourseContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { ComboChart, Donut, Ring } from '@/components/shared/Charts';
import { formatMinutes } from '@/lib/duration';
import {
  buildDayIndex,
  computeMetrics,
  dayKey,
  periodRange,
  PRIORITIES,
  shiftRange,
  unassignedSubject,
  type DayIndex,
  type MetricsOptions,
  type PeriodScope,
} from '@/lib/academic-metrics';
import { dateLocale, tr } from '@/lib/i18n';
import { dayInitial, dayInitials, fromSunday } from '@/lib/day-names';
import { priorityLabel } from '@/lib/enum-labels';
import { useTodayKey } from '@/hooks/use-today';

const otherSubjects = () => tr('Otras');
const HEAT_LEVELS = ['bg-muted', 'bg-primary/25', 'bg-primary/45', 'bg-primary/70', 'bg-primary'];
/** Columnas de la rejilla de cifras secundarias según cuántas hay (de 2 a 6):
 *  siempre filas completas. Clases escritas enteras para que Tailwind las vea. */
const SECONDARY_COLUMNS: Record<number, string> = {
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-3',
};

/** Pasos del eje de minutos: de 5 en 5 al principio y luego por horas. */
const MINUTE_STEPS = [5, 10, 15, 30, 60, 120, 180, 240, 300, 600, 900, 1200, 1800, 3000, 6000];
const minuteTick = (v: number) => (v < 60 ? `${v}m` : `${Math.floor(v / 60)}h${v % 60 ? String(v % 60).padStart(2, '0') : ''}`);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const chartColor = (i: number) => `hsl(var(--chart-${(i % 5) + 1}))`;

/** Top `limit` asignaturas por minutos + una serie agregada con el resto.
 *  `othersLabel` se desambigua si el usuario tiene una asignatura llamada "Otras". */
function groupTopSubjects(
  minutesBySubject: Record<string, number>,
  limit: number
): { items: { name: string; value: number }[]; othersLabel: string | null } {
  const sorted = Object.entries(minutesBySubject)
    .filter(([, minutes]) => minutes > 0)
    .sort((a, b) => b[1] - a[1]);
  const toItem = ([name, value]: [string, number]) => ({ name, value });
  if (sorted.length <= limit) return { items: sorted.map(toItem), othersLabel: null };
  const head = sorted.slice(0, limit);
  const othersLabel = head.some(([name]) => name === otherSubjects())
    ? tr('Otras asignaturas')
    : otherSubjects();
  const rest = sorted.slice(limit).reduce((acc, [, minutes]) => acc + minutes, 0);
  return { items: [...head.map(toItem), { name: othersLabel, value: rest }], othersLabel };
}

function Delta({
  now,
  before,
  scopeLabel,
  formatValue,
}: {
  now: number;
  before: number;
  scopeLabel: string;
  formatValue?: (v: number) => string;
}) {
  const diff = now - before;
  if (before === 0 && now === 0) {
    return <span className="text-[11px] text-muted-foreground/70">{tr('Sin datos previos')}</span>;
  }
  if (Math.abs(diff) < 0.5) {
    return <span className="text-[11px] text-muted-foreground/70">{tr('Igual que')}{' '}{scopeLabel}</span>;
  }
  const Icon = diff > 0 ? TrendingUp : TrendingDown;
  const magnitude = formatValue ? formatValue(Math.abs(diff)) : String(Math.round(Math.abs(diff)));
  return (
    <span
      className={cn(
        'flex items-center gap-1 text-[11px] font-medium',
        diff > 0 ? 'text-green-500' : 'text-red-500'
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {diff > 0 ? '+' : '−'}
      {magnitude}{' '}{tr('vs.')}{' '}{scopeLabel}
    </span>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  children,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="bg-card/50">
      <CardContent className="flex h-full flex-col gap-1 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <Icon className="h-4 w-4 shrink-0 text-primary/70" />
        </div>
        <p className="text-2xl font-bold text-foreground">{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        <div className="mt-auto pt-1">{children}</div>
      </CardContent>
    </Card>
  );
}

function MetricBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs font-semibold text-foreground">{Math.round(clamped)}%</span>
      </div>
      <Progress value={clamped} className="h-1.5" />
      {hint && <p className="text-[10px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  className,
  children,
}: {
  title: string;
  subtitle?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('overflow-hidden bg-card/50', className)}>
      <CardContent className="p-4 pt-5">
        <EchoTileHeader word={title.split(' ')[0]} className="-mt-5 mb-4 pt-5 text-center">
          <h4 className="text-sm font-semibold text-primary">{title}</h4>
          {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
        </EchoTileHeader>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyBox({ message }: { message: string }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-1 text-center">
      <ChartColumn className="h-5 w-5 text-muted-foreground/50" />
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}

export default function AcademicAnalytics() {
  const { archivedTasks, studySessions, dailyPerformances, habits, studyGoals } = useCourse();
  const [scope, setScope] = useState<PeriodScope>('week');
  // 0 = periodo actual. Solo se navega hacia atrás: el futuro no tiene datos.
  const [offset, setOffset] = useState(0);

  const scopeLabel = scope === 'week' ? tr('la semana anterior') : tr('el mes anterior');

  const activeHabits = useMemo(() => habits.filter((h) => !h.isArchived), [habits]);

  // Una sola pasada sobre TODO el historial: se reutiliza para el periodo
  // actual, el anterior y la tendencia. No depende del periodo elegido.
  const dayIndex: DayIndex = useMemo(
    () => buildDayIndex(studySessions, archivedTasks, activeHabits),
    [studySessions, archivedTasks, activeHabits]
  );

  const todayKey = useTodayKey();
  const { start, end } = useMemo(() => periodRange(scope, offset), [scope, offset, todayKey]);

  const periodLabel = useMemo(() => {
    if (scope === 'month') return capitalize(format(start, tr('MMMM yyyy'), { locale: dateLocale() }));
    const startMonth = format(start, tr('MMMM'), { locale: dateLocale() });
    const endMonth = format(end, tr('MMMM'), { locale: dateLocale() });
    const range =
      startMonth === endMonth
        ? tr('{p} - {p2} de {startMonth}', { p: format(start, 'd'), p2: format(end, 'd'), startMonth })
        : tr('{p} de {startMonth} - {p2} de {endMonth}', { p: format(start, 'd'), startMonth, p2: format(end, 'd'), endMonth });
    return tr('Semana {iSOWeek} · {range}', { iSOWeek: getISOWeek(start), range });
  }, [scope, start, end]);

  const options: MetricsOptions = useMemo(
    () => ({
      studyGoals,
      activeHabits,
      performances: dailyPerformances,
    }),
    [studyGoals, activeHabits, dailyPerformances]
  );

  const current = useMemo(
    () => computeMetrics(dayIndex, start, end, options),
    [dayIndex, start, end, options]
  );

  const previous = useMemo(() => {
    const range = shiftRange(scope, start, -1);
    return computeMetrics(dayIndex, range.start, range.end, options);
  }, [dayIndex, scope, start, options]);

  const periodDays = useMemo(() => eachDayOfInterval({ start, end }), [start, end]);

  const stacked = useMemo(() => groupTopSubjects(current.minutesBySubject, 4), [current.minutesBySubject]);
  const subjectKeys = useMemo(() => stacked.items.map((s) => s.name), [stacked]);

  const activityData = useMemo(() => {
    const buckets: { name: string; days: Date[] }[] =
      scope === 'week'
        ? periodDays.map((d) => ({ name: dayInitial(fromSunday(d.getDay())), days: [d] }))
        : eachWeekOfInterval({ start, end }, { weekStartsOn: 1 }).map((w) => ({
            name: tr('S{week}', { week: getISOWeek(w) }),
            days: eachDayOfInterval({ start: startOfISOWeek(w), end: endOfISOWeek(w) }).filter(
              (d) => d >= start && d <= end
            ),
          }));

    return buckets.map(({ name, days }) => {
      const row: Record<string, string | number> = { name, Tareas: 0 };
      for (const key of subjectKeys) row[key] = 0;
      for (const d of days) {
        const bucket = dayIndex.get(dayKey(d));
        if (!bucket) continue;
        row.Tareas = (row.Tareas as number) + bucket.tasksDone;
        for (const [subject, minutes] of Object.entries(bucket.minutesBySubject)) {
          const key = subjectKeys.includes(subject) ? subject : stacked.othersLabel;
          if (!key || row[key] === undefined) continue;
          row[key] = Math.round(((row[key] as number) + minutes) * 10) / 10;
        }
      }
      return row;
    });
  }, [scope, periodDays, start, end, subjectKeys, stacked.othersLabel, dayIndex]);

  const trendData = useMemo(() => {
    const count = scope === 'week' ? 8 : 6;
    return Array.from({ length: count }, (_, i) => {
      const range = shiftRange(scope, start, i - (count - 1));
      const metrics = computeMetrics(dayIndex, range.start, range.end, options);
      return {
        name:
          scope === 'week'
            ? tr('S{week}', { week: getISOWeek(range.start) })
            : capitalize(format(range.start, tr('MMM'), { locale: dateLocale() })),
        Horas: Math.round((metrics.minutes / 60) * 10) / 10,
        Efectividad: metrics.effectiveness,
      };
    });
  }, [scope, start, dayIndex, options]);

  const subjectSplit = useMemo(
    () =>
      // 4 + "Otras" = 5 sectores, uno por cada color de la paleta: con 5 el
      // sexto sector repetiría el color del primero.
      groupTopSubjects(current.minutesBySubject, 4)
        .items.map((s) => ({ name: s.name, value: Math.round(s.value) }))
        .filter((s) => s.value > 0),
    [current.minutesBySubject]
  );

  const heatmap = useMemo(() => {
    const days =
      scope === 'week'
        ? periodDays
        : eachDayOfInterval({ start: startOfISOWeek(start), end: endOfISOWeek(end) });
    const max = Math.max(1, ...days.map((d) => dayIndex.get(dayKey(d))?.minutes ?? 0));
    return days.map((date) => {
      const bucket = dayIndex.get(dayKey(date));
      const minutes = bucket?.minutes ?? 0;
      const level =
        minutes === 0
          ? 0
          : minutes <= max * 0.25
            ? 1
            : minutes <= max * 0.5
              ? 2
              : minutes <= max * 0.75
                ? 3
                : 4;
      return {
        date,
        minutes,
        level,
        tasksDone: bucket?.tasksDone ?? 0,
        inPeriod: scope === 'week' || isSameMonth(date, start),
      };
    });
  }, [scope, periodDays, start, end, dayIndex]);

  const secondaryMetrics = useMemo(() => {
    const items: { label: string; value: string; hint?: string }[] = [
      {
        label: tr('Sesiones de estudio'),
        value: String(current.sessions),
        hint:
          current.sessions > 0
            ? tr('Media de {minutes} por sesión', { minutes: formatMinutes(current.avgSessionMinutes) })
            : undefined,
      },
      {
        label: tr('Días con meta cumplida'),
        value: `${current.daysMeetingGoal}/${current.elapsedDays}`,
        hint: tr('Meta acumulada: {minutes}', { minutes: formatMinutes(current.goalMinutes) }),
      },
    ];
    if (current.avgPerception !== null) {
      items.push({
        label: tr('Percepción media'),
        value: `${current.avgPerception.toFixed(1)}/20`,
        hint: tr('Cómo valoraste tus sesiones'),
      });
    }
    if (current.bestDay) {
      items.push({
        label: tr('Mejor día'),
        value: capitalize(format(parseISO(current.bestDay.key), tr('EEE d \'de\' MMM'), { locale: dateLocale() })),
        hint: formatMinutes(current.bestDay.minutes),
      });
    }
    if (current.tasksDone > 0) {
      items.push({
        label: tr('Tiempo por tarea'),
        value: formatMinutes(current.minutes / current.tasksDone),
        hint: tr('Estudio del periodo entre tareas terminadas'),
      });
    }
    if (current.tasksWithDue > 0) {
      items.push({
        label: tr('Entregas a tiempo'),
        value: `${current.tasksOnTime}/${current.tasksWithDue}`,
        hint: tr('Tareas culminadas antes de su fecha límite'),
      });
    }
    return items;
  }, [current]);

  const isEmpty = current.minutes === 0 && current.tasksDone === 0 && current.sessions === 0;

  return (
    <section className="space-y-6">
      <div className="relative flex items-center justify-center">
        <h3 className="text-xl font-semibold text-primary">{tr('Progreso académico')}</h3>
        <div className="absolute right-0">
          <Tabs
            value={scope}
            onValueChange={(value) => {
              setScope(value as PeriodScope);
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
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-foreground"
          onClick={() => setOffset((o) => o - 1)}
          title={tr('Periodo anterior')}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <p className="whitespace-nowrap text-sm font-semibold text-primary">{periodLabel}</p>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-foreground"
          onClick={() => setOffset((o) => Math.min(0, o + 1))}
          disabled={offset >= 0}
          title={tr('Periodo siguiente')}
        >
          <ChevronRight className="h-5 w-5" />
        </Button>
      </div>

      {isEmpty ? (
        <Card className="flex h-44 flex-col items-center justify-center gap-2 border-dashed bg-card/50">
          <ChartColumn className="h-6 w-6 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            {tr('Aún no hay actividad registrada en este periodo.')}
          </p>
          <p className="px-6 text-center text-xs text-muted-foreground/70">
            {tr('Estudia con el reloj de Estudio o culmina tareas y tus métricas aparecerán aquí.')}
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard
              icon={ListChecks}
              label={tr('Tareas culminadas')}
              value={String(current.tasksDone)}
              hint={
                current.tasksWithDue > 0
                  ? tr('{tasksOnTime} de {tasksWithDue} a tiempo', { tasksOnTime: current.tasksOnTime, tasksWithDue: current.tasksWithDue })
                  : tr('Sin fechas límite registradas')
              }
            >
              <Delta now={current.tasksDone} before={previous.tasksDone} scopeLabel={scopeLabel} />
            </KpiCard>

            <KpiCard
              icon={Clock}
              label={tr('Tiempo de estudio')}
              value={formatMinutes(current.minutes)}
              hint={tr('Meta del periodo: {minutes}', { minutes: formatMinutes(current.goalMinutes) })}
            >
              <Delta
                now={current.minutes}
                before={previous.minutes}
                scopeLabel={scopeLabel}
                formatValue={formatMinutes}
              />
            </KpiCard>

            <KpiCard
              icon={Gauge}
              label={tr('Efectividad')}
              value={`${current.effectiveness}%`}
              hint={tr('Meta cumplida al {goalCompliance}%', { goalCompliance: current.goalCompliance })}
            >
              <Delta
                now={current.effectiveness}
                before={previous.effectiveness}
                scopeLabel={scopeLabel}
                formatValue={(v) => `${Math.round(v)}%`}
              />
            </KpiCard>

            <KpiCard
              icon={Flame}
              label={tr('Constancia')}
              value={`${current.activeDays}/${current.totalDays}`}
              hint={tr('Días con estudio registrado')}
            >
              <Delta now={current.activeDays} before={previous.activeDays} scopeLabel={scopeLabel} />
            </KpiCard>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard
              title={tr('Actividad del periodo')}
              subtitle={tr('Minutos de estudio por asignatura y tareas terminadas')}
              className="lg:col-span-2"
            >
              <ComboChart
                height={256}
                data={activityData}
                series={[
                  ...subjectKeys.map((key, i) => ({ key, name: key, color: chartColor(i), type: 'bar' as const })),
                  { key: 'Tareas', name: tr('Tareas'), color: 'hsl(var(--primary))', type: 'line', axis: 'right' },
                ]}
                leftTick={minuteTick}
                leftSteps={MINUTE_STEPS}
                rightInteger
                maxBarSize={scope === 'month' ? 44 : 36}
                format={(value, s) => (s.key === 'Tareas' ? String(value) : formatMinutes(value))}
              />
              {subjectKeys.includes(unassignedSubject()) && (
                <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
                  {tr('Las sesiones sin asignatura elegida se agrupan como «{name}».', { name: unassignedSubject() })}
                </p>
              )}
            </SectionCard>

            <SectionCard title={tr('Efectividad')} subtitle={tr('Meta, puntualidad y constancia combinadas')}>
              <div className="relative">
                <Ring value={current.effectiveness} height={190} />
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <p className="text-4xl font-bold text-primary">{current.effectiveness}%</p>
                  <p className="text-[11px] text-muted-foreground">{tr('efectividad')}</p>
                </div>
              </div>
              <div className="space-y-3 px-1 pb-1 pt-2">
                <MetricBar
                  label={tr('Meta de estudio')}
                  value={current.goalCompliance}
                  hint={tr('{minutes} de {minutes2}', { minutes: formatMinutes(current.minutes), minutes2: formatMinutes(current.goalMinutes) })}
                />
                {current.punctuality !== null && (
                  <MetricBar
                    label={tr('Puntualidad')}
                    value={current.punctuality}
                    hint={tr('{tasksOnTime} de {tasksWithDue} tareas a tiempo', { tasksOnTime: current.tasksOnTime, tasksWithDue: current.tasksWithDue })}
                  />
                )}
                {current.habitConsistency !== null && (
                  <MetricBar
                    label={tr('Constancia de hábitos')}
                    value={current.habitConsistency}
                    hint={`${activeHabits.length} ${activeHabits.length === 1 ? tr('hábito activo') : tr('hábitos activos')}`}
                  />
                )}
              </div>
            </SectionCard>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard
              title={tr('Tendencia')}
              subtitle={scope === 'week' ? tr('Últimas 8 semanas') : tr('Últimos 6 meses')}
              className="lg:col-span-2"
            >
              <ComboChart
                height={226}
                data={trendData}
                series={[
                  { key: 'Horas', name: tr('Horas'), color: 'hsl(var(--chart-2))', type: 'area' },
                  { key: 'Efectividad', name: tr('Efectividad'), color: 'hsl(var(--primary))', type: 'line', axis: 'right' },
                ]}
                leftTick={(v) => `${v}h`}
                rightDomain={[0, 100]}
                format={(value, s) => (s.key === 'Horas' ? `${value} h` : `${value}%`)}
              />
            </SectionCard>

            <SectionCard title={tr('Reparto por asignatura')} subtitle={tr('Minutos de estudio del periodo')}>
              {subjectSplit.length === 0 ? (
                <EmptyBox message={tr('Sin sesiones de estudio en el periodo.')} />
              ) : (
                <Donut
                  height={226}
                  inner={0.58}
                  outer={0.86}
                  data={subjectSplit.map((s, i) => ({ ...s, color: chartColor(i) }))}
                  format={formatMinutes}
                />
              )}
            </SectionCard>
          </div>

          <SectionCard
            title={tr('Mapa de constancia')}
            subtitle={tr('Intensidad de estudio de cada día del periodo')}
          >
            <TooltipProvider delayDuration={200}>
              <div className="mx-auto max-w-xl space-y-2">
                <div className="grid grid-cols-7 gap-1.5">
                  {dayInitials().map((d, index) => (
                    <p key={index} className="text-center text-[10px] font-semibold text-muted-foreground">
                      {d}
                    </p>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {heatmap.map((cell) => (
                    <Tooltip key={cell.date.toISOString()}>
                      <TooltipTrigger asChild>
                        <div
                          className={cn(
                            'aspect-square rounded-sm transition-colors',
                            HEAT_LEVELS[cell.level],
                            !cell.inPeriod && 'opacity-30'
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs font-semibold capitalize">
                          {format(cell.date, tr('EEEE d \'de\' MMMM'), { locale: dateLocale() })}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatMinutes(cell.minutes)}{' '}{tr('de estudio ·')}{' '}
                          {cell.tasksDone === 1 ? tr('1 tarea') : tr('{tasksDone} tareas', { tasksDone: cell.tasksDone })}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
                <div className="flex items-center justify-end gap-1.5 pt-1">
                  <span className="text-[10px] text-muted-foreground">{tr('Menos')}</span>
                  {HEAT_LEVELS.map((level) => (
                    <div key={level} className={cn('h-2.5 w-2.5 rounded-sm', level)} />
                  ))}
                  <span className="text-[10px] text-muted-foreground">{tr('Más')}</span>
                </div>
              </div>
            </TooltipProvider>
          </SectionCard>

          {/* Rejilla sin huecos: las columnas siguen al número de cifras que
              hay (cuatro en una fila; seis, en dos filas de tres). */}
          <div className={cn('grid grid-cols-2 gap-4', SECONDARY_COLUMNS[secondaryMetrics.length] ?? 'md:grid-cols-4')}>
            {secondaryMetrics.map((item) => (
              <Card key={item.label} className="bg-card/50">
                <CardContent className="p-4">
                  <p className="text-[11px] font-medium text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-lg font-bold text-foreground">{item.value}</p>
                  {item.hint && (
                    <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground/80">
                      {item.hint}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {current.tasksDone > 0 && (
            <Card className="bg-card/50">
              <CardContent className="flex flex-wrap items-center justify-center gap-3 p-4">
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <Target className="h-4 w-4 text-primary/70" />
                  {tr('Tareas culminadas por importancia')}
                </div>
                {PRIORITIES.map((priority) => (
                  <Badge key={priority} variant="secondary" className="gap-1.5">
                    {priorityLabel(priority)}
                    <span className="font-bold text-primary">{current.tasksByPriority[priority]}</span>
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </section>
  );
}
