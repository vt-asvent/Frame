import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import {
  CheckCircle2,
  Clock,
  Flame,
  Target,
  Timer,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import { cn } from '@/lib/utils';
import { useCourse } from '@/context/CourseContext';
import { sessionSeconds, formatMinutes, formatDurationLabel } from '@/lib/duration';
import type { TaskDifficulty } from '@/types';
import { tr } from '@/lib/i18n';
import { dayInitial, fromSunday } from '@/lib/day-names';
import { localDayKey } from '@/lib/dates';
import { difficultyLabel } from '@/lib/enum-labels';
import { useTodayKey } from '@/hooks/use-today';

// ============================================================
// Expediente del usuario, en collage: las piezas NO miden todas lo mismo —
// el dato que más pesa ocupa más sitio. Todo sale de lo que Frame ya guarda
// (sesiones, archivo de tareas, calificaciones, reproducciones, grabaciones);
// nada se estima, y lo que aún no existe lo dice en lugar de fingir un cero.
// ============================================================

const DIFFICULTY_ORDER: TaskDifficulty[] = ['Fácil', 'Media', 'Difícil'];
const DIFFICULTY_HEX: Record<TaskDifficulty, string> = {
  'Fácil': 'hsl(160 84% 39%)',
  'Media': 'hsl(38 92% 50%)',
  'Difícil': 'hsl(0 72% 60%)',
};

/** Cifra suelta, para la retícula de datos secundarios. El tinte baja de
 *  arriba hacia abajo (vertical y sutil, como el resto de degradados). */
const Metric = ({
  icon: Icon,
  label,
  value,
  hint,
  accent,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
  accent?: string;
}) => (
  <div
    className={cn(
      // Degradado de abajo hacia arriba y suave (1.6.6).
      'flex flex-col justify-center gap-1 rounded-xl border border-border/60 bg-gradient-to-t to-transparent p-3',
      accent ?? 'from-primary/[0.045]'
    )}
  >
    <div className="flex items-center gap-1.5">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate text-[10px] font-semibold text-muted-foreground">
        {label}
      </span>
    </div>
    <p className="font-headline text-xl font-bold leading-none text-primary tabular-nums">{value}</p>
    {hint && <p className="text-[10px] leading-snug text-muted-foreground">{hint}</p>}
  </div>
);

const SectionTitle = ({
  icon: Icon,
  children,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
}) => (
  <EchoTileHeader word={String(children).split(' ')[0]} className="mb-3">
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-primary" />
      <h3 className="text-xs font-bold text-primary">{children}</h3>
    </div>
  </EchoTileHeader>
);

export default function ProfileStats() {
  const { studySessions, archivedTasks, advancedMode } = useCourse();
  const todayKey = useTodayKey();

  const stats = useMemo(() => {
    const sessions = studySessions ?? [];
    const archived = archivedTasks ?? [];

    const totalSeconds = sessions.reduce((acc, s) => acc + sessionSeconds(s), 0);
    const longest = sessions.reduce((acc, s) => Math.max(acc, sessionSeconds(s)), 0);
    const avgSeconds = sessions.length > 0 ? totalSeconds / sessions.length : 0;

    // Minutos por día, para la tira de los últimos 21 días.
    const minutesByDay = new Map<string, number>();
    for (const session of sessions) {
      // Día LOCAL: cortar la cadena ISO da el día en UTC y en Perú lo estudiado
      // de noche caía en el día siguiente (la barra de hoy salía vacía).
      const key = localDayKey(session.startTime);
      if (!key) continue;
      minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + sessionSeconds(session) / 60);
    }

    const today = new Date();
    const strip = Array.from({ length: 21 }, (_, index) => {
      const day = new Date(today);
      day.setDate(day.getDate() - (20 - index));
      const key = localDayKey(day);
      return {
        key,
        minutes: minutesByDay.get(key) ?? 0,
        initial: dayInitial(fromSunday(day.getDay())),
        isToday: index === 20,
      };
    });

    // Minutos por asignatura: el tiempo se reparte entre las declaradas.
    const minutesBySubject = new Map<string, number>();
    for (const session of sessions) {
      const subjects = session.subjects?.length ? session.subjects : [tr('Sin asignatura')];
      const share = sessionSeconds(session) / 60 / subjects.length;
      for (const subject of subjects) {
        minutesBySubject.set(subject, (minutesBySubject.get(subject) ?? 0) + share);
      }
    }


    // Tareas terminadas: complejidad y puntualidad.
    const byDifficulty = new Map<TaskDifficulty, number>();
    let withDue = 0;
    let onTime = 0;

    for (const task of archived) {
      const difficulty = DIFFICULTY_ORDER.includes(task.difficulty as TaskDifficulty)
        ? (task.difficulty as TaskDifficulty)
        : 'Media';
      byDifficulty.set(difficulty, (byDifficulty.get(difficulty) ?? 0) + 1);


      if (task.dueDate) {
        const due = Date.parse(task.dueDate);
        const done = Date.parse(task.archivedAt);
        if (Number.isFinite(due) && Number.isFinite(done)) {
          withDue += 1;
          // Por día natural: el plazo es la medianoche del día límite, y quien
          // culmina ese mismo día ha llegado a tiempo.
          const dueDay = new Date(due);
          const doneDay = new Date(done);
          dueDay.setHours(0, 0, 0, 0);
          doneDay.setHours(0, 0, 0, 0);
          if (doneDay.getTime() <= dueDay.getTime()) {
            onTime += 1;
          }
        }
      }
    }

    // Racha histórica más larga (días consecutivos con estudio).
    const sortedDays = [...minutesByDay.keys()].sort();
    let longestStreak = 0;
    let run = 0;
    let previous: number | null = null;
    for (const day of sortedDays) {
      const time = Date.parse(`${day}T00:00:00`);
      run = previous !== null && time - previous === 86400000 ? run + 1 : 1;
      longestStreak = Math.max(longestStreak, run);
      previous = time;
    }

    return {
      totalSeconds,
      longest,
      avgSeconds,
      sessionCount: sessions.length,
      strip,
      activeDays: minutesByDay.size,
      longestStreak,
      subjectRows: [...minutesBySubject.entries()]
        .map(([label, value]) => ({ key: label, label, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 5),
      tasksDone: archived.length,
      byDifficulty,
      punctuality: withDue > 0 ? onTime / withDue : null,
    };
  }, [studySessions, archivedTasks, todayKey]);

  const stripMax = Math.max(30, ...stats.strip.map((d) => d.minutes));
  const difficultyData = DIFFICULTY_ORDER.map((level) => ({
    name: level,
    value: stats.byDifficulty.get(level) ?? 0,
  })).filter((row) => row.value > 0);
  const difficultyTotal = difficultyData.reduce((acc, row) => acc + row.value, 0);
  const subjectMax = stats.subjectRows.reduce((acc, row) => Math.max(acc, row.value), 0);

  return (
    <div className="space-y-4">
      <h2 className="text-center text-xl font-semibold leading-none tracking-tight text-primary">
        {tr('Tu expediente')}
      </h2>

      {/* ---------- Franja principal: el dato que más pesa, más grande ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        <Card className="overflow-hidden lg:col-span-4">
          <CardContent className="relative p-5">
            {/* Halo de marca: da profundidad sin ensuciar los datos. */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'radial-gradient(60% 90% at 85% 10%, hsl(var(--primary) / 0.14), transparent 70%)',
              }}
            />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-[10px] font-semibold text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  {tr('Tiempo de estudio acumulado')}
                </p>
                <p className="font-headline text-5xl font-bold leading-none text-primary tabular-nums">
                  {formatMinutes(stats.totalSeconds / 60)}
                </p>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {stats.sessionCount} {stats.sessionCount === 1 ? tr('sesión') : tr('sesiones')} ·{' '}
                  {stats.activeDays} {stats.activeDays === 1 ? tr('día') : tr('días')}{' '}{tr('activos · media de')}{' '}
                  {stats.avgSeconds > 0 ? formatDurationLabel(Math.round(stats.avgSeconds)) : '—'}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-semibold text-muted-foreground">
                  {tr('Últimas 3 semanas')}
                </p>
              </div>
            </div>

            {/* Tira de 21 días: el pulso real, no un promedio. */}
            <div className="relative mt-4 flex h-16 items-end gap-[3px]">
              {stats.strip.map((day) => (
                <div
                  key={day.key}
                  className="group relative flex-1"
                  title={`${day.key}: ${day.minutes > 0 ? formatMinutes(day.minutes) : tr('sin estudio')}`}
                >
                  <div
                    className={cn(
                      'w-full rounded-sm transition-all duration-500',
                      day.minutes > 0
                        ? 'bg-gradient-to-t from-primary/50 to-primary'
                        : 'bg-secondary',
                      day.isToday && 'ring-1 ring-primary ring-offset-1 ring-offset-background'
                    )}
                    style={{
                      height: day.minutes > 0 ? `${Math.max(8, (day.minutes / stripMax) * 64)}px` : '3px',
                    }}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Retícula de cifras: cuatro datos de un vistazo */}
        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          <Metric
            icon={CheckCircle2}
            label={tr('Tareas')}
            value={String(stats.tasksDone)}
            hint={tr('terminadas')}
            accent="from-emerald-500/[0.06]"
          />
          <Metric
            icon={Target}
            label={tr('A tiempo')}
            value={stats.punctuality !== null ? `${Math.round(stats.punctuality * 100)}%` : '—'}
            hint={stats.punctuality !== null ? tr('de las que tenían fecha') : tr('sin fechas que medir')}
            accent="from-amber-500/[0.06]"
          />
          <Metric
            icon={Flame}
            label={tr('Mejor racha')}
            value={stats.longestStreak > 0 ? `${stats.longestStreak} d` : '—'}
            hint={tr('días seguidos')}
            accent="from-orange-500/[0.06]"
          />
          <Metric
            icon={Timer}
            label={tr('Más larga')}
            value={stats.longest > 0 ? formatDurationLabel(stats.longest) : '—'}
            hint={tr('una sola sesión')}
          />
        </div>
      </div>

      {/* ---------- Collage: piezas de distinto tamaño ---------- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
        {/* Rosco de complejidad: modo Avanzado (sin él, la dificultad no se
            pide y el reparto no diría nada). */}
        {advancedMode && (
        <Card className="lg:col-span-2">
          <CardContent className="p-4">
            <SectionTitle icon={Target}>{tr('Dificultad')}</SectionTitle>
            {difficultyTotal > 0 ? (
              <>
                <div className="relative h-[130px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={difficultyData}
                        dataKey="value"
                        innerRadius="62%"
                        outerRadius="92%"
                        paddingAngle={2}
                        stroke="none"
                        // Sin animación de entrada A PROPÓSITO: recharts crea
                        // los sectores DENTRO de esa animación, así que si el
                        // navegador congela los fotogramas (ventana oculta,
                        // equipo cargado) el rosco se queda vacío.
                        isAnimationActive={false}
                      >
                        {difficultyData.map((row) => (
                          <Cell key={row.name} fill={DIFFICULTY_HEX[row.name as TaskDifficulty]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-headline text-2xl font-bold leading-none text-foreground tabular-nums">
                      {difficultyTotal}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {tr('tareas')}
                    </span>
                  </div>
                </div>
                <ul className="mt-2 space-y-1">
                  {DIFFICULTY_ORDER.map((level) => (
                    <li key={level} className="flex items-center gap-2 text-[11px]">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: DIFFICULTY_HEX[level] }}
                      />
                      <span className="flex-1 text-muted-foreground">{difficultyLabel(level)}</span>
                      <span className="font-semibold tabular-nums text-foreground">
                        {stats.byDifficulty.get(level) ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-10 text-center text-xs text-muted-foreground">
                {tr('Culmina tareas para ver su reparto.')}
              </p>
            )}
          </CardContent>
        </Card>
        )}

        {/* Tiempo por asignatura */}
        <Card className={advancedMode ? 'lg:col-span-4' : 'lg:col-span-6'}>
          <CardContent className="p-4">
            <SectionTitle icon={TrendingUp}>{tr('Dónde va tu tiempo')}</SectionTitle>
            {stats.subjectRows.length > 0 ? (
              <ul className="space-y-2.5">
                {stats.subjectRows.map((row, index) => (
                  <li key={row.key} className="space-y-1">
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-foreground" title={row.label}>
                        <span className="mr-1.5 font-bold text-primary tabular-nums">
                          {index + 1}
                        </span>
                        {row.label}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-muted-foreground">
                        {formatMinutes(row.value)}
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/40 to-primary transition-all duration-700"
                        style={{ width: `${subjectMax > 0 ? (row.value / subjectMax) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-10 text-center text-xs text-muted-foreground">
                {tr('Aún no hay tiempo de estudio repartido por asignatura.')}
              </p>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
