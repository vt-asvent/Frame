import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FileBarChart2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import { PHASE_ICON } from '@/components/habits/HabitPhases';
import { HABIT_PHASES, phaseStarted } from '@/lib/habit-phases';
import { isScheduled } from '@/lib/habit-schedule';
import { cn } from '@/lib/utils';
import type { Habit, HabitPhase } from '@/types';
import { lowerFirst, tr } from '@/lib/i18n';
import { dayInitial, dayInitials } from '@/lib/day-names';

// ============================================================
// La semana de cada momento del día, en anillos.
//
// Un recuadro por fase —mañana, tarde, noche— con un anillo por hábito (como
// mucho cinco, del exterior hacia dentro). Cada anillo se parte en siete
// tramos, uno por día de la semana empezando por el lunes arriba: un
// trapecio grueso cuyas dos bases son arcos. El tramo se enciende con el
// color del hábito cuando se cumplió; en gris si tocaba y no se hizo; y
// casi transparente si ese día no le tocaba.
//
// El botón de informe de la esquina da la vuelta al recuadro y enseña qué
// hábito es cada color, con sus números de la semana.
// ============================================================

/** Un color por anillo. Distinguibles entre sí en tema claro y oscuro. */
const RING_COLORS = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];

const MAX_RINGS = 5;

// Geometría (en unidades del viewBox de 240 × 240).
const CENTER = 120;
const OUTER = 102;
const INNER = 28;
const RING = (OUTER - INNER) / MAX_RINGS;
const RING_GAP = 2.4;
const SEGMENT = 360 / 7;
const SEGMENT_GAP = 5;

const toXY = (radius: number, degrees: number): [number, number] => {
  const rad = (degrees * Math.PI) / 180;
  return [CENTER + radius * Math.cos(rad), CENTER + radius * Math.sin(rad)];
};

/** Trapecio curvo: dos arcos concéntricos unidos por sus extremos. */
function sectorPath(outer: number, inner: number, from: number, to: number): string {
  const [x1, y1] = toXY(outer, from);
  const [x2, y2] = toXY(outer, to);
  const [x3, y3] = toXY(inner, to);
  const [x4, y4] = toXY(inner, from);
  return [
    `M ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    `A ${outer} ${outer} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`,
    `L ${x3.toFixed(2)} ${y3.toFixed(2)}`,
    `A ${inner} ${inner} 0 0 0 ${x4.toFixed(2)} ${y4.toFixed(2)}`,
    'Z',
  ].join(' ');
}

type DayState = 'done' | 'missed' | 'pending' | 'off';

interface HabitWeek {
  habit: Habit;
  color: string;
  states: DayState[];
  done: number;
  expected: number;
}

const dayKey = (date: Date) => format(date, 'yyyy-MM-dd');

function weekOf(habit: Habit, color: string, weekDates: Date[], todayKey: string): HabitWeek {
  const marks = new Set(habit.completedOn ?? []);
  let since = '';
  try {
    since = habit.createdAt ? dayKey(new Date(habit.createdAt)) : '';
  } catch {
    since = '';
  }
  let done = 0;
  let expected = 0;
  const states = weekDates.map((date): DayState => {
    const key = dayKey(date);
    if (marks.has(key)) {
      done += 1;
      expected += 1;
      return 'done';
    }
    if (!isScheduled(habit, date) || (since && key < since)) return 'off';
    if (key > todayKey) return 'pending';
    // Hoy, antes de que empiece su fase, todavía no es un fallo.
    if (key === todayKey && !phaseStarted(habit.phase)) return 'pending';
    expected += 1;
    return 'missed';
  });
  return { habit, color, states, done, expected };
}

const STATE_FILL: Record<Exclude<DayState, 'done'>, string> = {
  missed: 'hsl(var(--muted-foreground) / 0.32)',
  pending: 'hsl(var(--muted-foreground) / 0.16)',
  off: 'hsl(var(--muted-foreground) / 0.05)',
};

function PhaseRings({
  phase,
  habits,
  weekDates,
}: {
  phase: HabitPhase;
  habits: Habit[];
  weekDates: Date[];
}) {
  const [showData, setShowData] = useState(false);
  const info = HABIT_PHASES.find((p) => p.id === phase)!;
  const Icon = PHASE_ICON[phase];
  const todayKey = dayKey(new Date());
  const todayIndex = weekDates.findIndex((date) => dayKey(date) === todayKey);

  const rows = useMemo(
    () => habits.slice(0, MAX_RINGS).map((habit, index) => weekOf(habit, RING_COLORS[index], weekDates, todayKey)),
    [habits, weekDates, todayKey]
  );
  const hidden = Math.max(0, habits.length - MAX_RINGS);
  const totalDone = rows.reduce((sum, row) => sum + row.done, 0);
  const totalExpected = rows.reduce((sum, row) => sum + row.expected, 0);
  const rate = totalExpected > 0 ? Math.round((totalDone / totalExpected) * 100) : null;

  return (
    <Card className="relative flex min-h-[330px] flex-col overflow-hidden bg-card/60 p-4">
      {/* Cabecera: la fase y el botón que da la vuelta al recuadro. */}
      <EchoTileHeader word={info.label}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-foreground">{info.label}</p>
            <p className="text-[10px] text-muted-foreground">{info.range}</p>
          </div>
        </div>
        {rows.length > 0 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className={cn('h-8 w-8', showData ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-primary')}
            onClick={() => setShowData((value) => !value)}
            title={showData ? tr('Volver al gráfico') : tr('Qué es cada color')}
            aria-pressed={showData}
          >
            {showData ? <X className="h-4 w-4" /> : <FileBarChart2 className="h-4 w-4" />}
          </Button>
        )}
      </div>
      </EchoTileHeader>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 text-center">
          <Icon className="h-7 w-7 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">{tr('Sin hábitos de {phase}.', { phase: lowerFirst(info.label, true) })}</p>
          <p className="px-4 text-[10px] text-muted-foreground/70">{tr('Añade uno y elige «{phase}» como momento.', { phase: info.label })}</p>
        </div>
      ) : showData ? (
        // Cara de datos: qué hábito es cada color y cómo va en la semana.
        <div className="mt-3 flex flex-1 flex-col gap-2 animate-in fade-in-0">
          {rows.map((row) => {
            const rowRate = row.expected > 0 ? Math.round((row.done / row.expected) * 100) : 0;
            return (
              <div key={row.habit.id} className="rounded-lg border border-border/60 bg-background/40 p-2">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: row.color }} />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground" title={row.habit.name}>
                    {row.habit.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-foreground">
                    {row.done}/{row.expected || 0}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full transition-all" style={{ width: `${rowRate}%`, backgroundColor: row.color }} />
                </div>
              </div>
            );
          })}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATE_FILL.missed }} />{' '}{tr('Tocaba y no se hizo')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: STATE_FILL.pending }} />{' '}{tr('Aún no toca')}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-sm border border-border" style={{ backgroundColor: STATE_FILL.off }} />{' '}{tr('No es su día')}
            </span>
          </div>
        </div>
      ) : (
        // Cara del gráfico.
        <div className="relative mx-auto mt-2 w-full max-w-[290px] flex-1 animate-in fade-in-0">
          <svg viewBox="0 0 240 240" className="h-full w-full" role="img" aria-label={tr('Semana de {p}', { p: lowerFirst(info.label, true) })}>
            {/* Iniciales de los días, fuera del anillo exterior. */}
            {dayInitials().map((initial, index) => {
              const mid = -90 + index * SEGMENT + SEGMENT / 2;
              const [x, y] = toXY(OUTER + 11, mid);
              return (
                <text
                  key={index}
                  x={x}
                  y={y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={cn(
                    'text-[10px] font-bold',
                    index === todayIndex ? 'fill-primary' : 'fill-muted-foreground'
                  )}
                >
                  {initial}
                </text>
              );
            })}

            {rows.map((row, ringIndex) => {
              const outer = OUTER - ringIndex * RING;
              const inner = outer - RING + RING_GAP;
              return row.states.map((state, dayIndex) => {
                const from = -90 + dayIndex * SEGMENT + SEGMENT_GAP / 2;
                const to = -90 + (dayIndex + 1) * SEGMENT - SEGMENT_GAP / 2;
                const label =
                  state === 'done'
                    ? tr('cumplido')
                    : state === 'missed'
                      ? tr('no cumplido')
                      : state === 'pending'
                        ? tr('aún no toca')
                        : tr('no es su día');
                return (
                  <path
                    key={`${row.habit.id}-${dayIndex}`}
                    d={sectorPath(outer, inner, from, to)}
                    fill={state === 'done' ? row.color : STATE_FILL[state]}
                    className="transition-[fill] duration-500"
                  >
                    <title>{`${row.habit.name} · ${dayInitial(dayIndex)} · ${label}`}</title>
                  </path>
                );
              });
            })}

            {/* Centro: el cumplimiento de la fase en la semana. */}
            <text x={CENTER} y={CENTER - 4} textAnchor="middle" className="fill-foreground text-[22px] font-bold">
              {rate === null ? '—' : `${rate}%`}
            </text>
            <text x={CENTER} y={CENTER + 13} textAnchor="middle" className="fill-muted-foreground text-[8px] font-semibold">
              {tr('Semana')}
            </text>
          </svg>
          {hidden > 0 && (
            <p className="text-center text-[10px] text-muted-foreground">
              +{hidden} {hidden === 1 ? tr('hábito no cabe') : tr('hábitos no caben')}{' '}{tr('en el gráfico')}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** Los tres recuadros, uno por momento del día. */
export default function HabitRings({ habits, weekDates }: { habits: Habit[]; weekDates: Date[] }) {
  const byPhase = useMemo(() => {
    const groups: Record<HabitPhase, Habit[]> = { morning: [], afternoon: [], night: [] };
    for (const habit of habits) if (habit.phase) groups[habit.phase].push(habit);
    for (const list of Object.values(groups)) list.sort((a, b) => (a.order || 0) - (b.order || 0));
    return groups;
  }, [habits]);
  const withoutPhase = habits.filter((habit) => !habit.phase).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {HABIT_PHASES.map((info) => (
          <PhaseRings key={info.id} phase={info.id} habits={byPhase[info.id]} weekDates={weekDates} />
        ))}
      </div>
      {withoutPhase > 0 && (
        <p className="text-center text-[11px] text-muted-foreground">
          {withoutPhase === 1
            ? tr('Un hábito no tiene momento del día y no aparece aquí: asígnale mañana, tarde o noche con el lápiz de la tabla.')
            : tr('{count} hábitos no tienen momento del día y no aparecen aquí: asígnales mañana, tarde o noche con el lápiz de la tabla.', { count: withoutPhase })}
        </p>
      )}
    </div>
  );
}
