import { useMemo, useState } from 'react';
import { CircleSlash } from 'lucide-react';
import { DndContext } from '@dnd-kit/core';
import { dndAccessibility } from '@/lib/dnd-a11y';
import { SortableContext } from '@dnd-kit/sortable';
import { TaskCard } from '@/components/tasks/TaskCard';
import {
  differenceInCalendarDays,
  endOfISOWeek,
  format,
  isSameMonth,
  parseISO,
  startOfISOWeek,
} from 'date-fns';
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Search,
  Timer,
  TrendingUp,
} from 'lucide-react';
import type { ArchivedTask, StudySession } from '@/types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { sessionSeconds, formatMinutes } from '@/lib/duration';
import { DIFFICULTY_META, DifficultyBars, TASK_KIND_META } from '@/components/tasks/task-badges';
import { dateLocale, tr } from '@/lib/i18n';
import { difficultyLabel, priorityLabel, taskKindLabel } from '@/lib/enum-labels';
import { parseIsoSafe } from '@/lib/dates';

// ============================================================
// Registro de tareas culminadas.
//
// No es una galería decorativa: es el documento que responde a "¿cuántas
// tareas hiciste cada semana de julio y cuánto tiempo les dedicaste?".
// Por eso se navega MES A MES y dentro del mes las tareas se agrupan por
// semana, cada grupo con su recuento y su tiempo.
// ============================================================

/** Minutos de estudio imputados a cada tarea. Una sesión reparte su duración
 *  a partes iguales entre las tareas que declaró — exactamente la misma regla
 *  con la que Frame calcula el avance, así que las dos cifras concuerdan. */
export function minutesByTask(sessions: StudySession[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const session of sessions ?? []) {
    const ids = session.taskIds ?? [];
    if (ids.length === 0) continue;
    const share = sessionSeconds(session) / 60 / ids.length;
    for (const id of ids) map.set(id, (map.get(id) ?? 0) + share);
  }
  return map;
}

/** Puntualidad de la entrega comparando la fecha límite con el archivado. */
function punctuality(task: ArchivedTask): { label: string; tone: string } | null {
  const done = parseIsoSafe(task.archivedAt);
  const due = parseIsoSafe(task.dueDate);
  if (!done || !due) return null;
  {
    const days = differenceInCalendarDays(done, due);
    if (days <= 0) {
      const early = Math.abs(days);
      return {
        label:
          days === 0
            ? tr('Entregada el mismo día')
            : early === 1
              ? tr('1 día de antelación')
              : tr('{early} días de antelación', { early }),
        tone: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
      };
    }
    return {
      label: days === 1 ? tr('1 día de retraso') : tr('{days} días de retraso', { days }),
      tone: 'border-rose-500/50 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    };
  }
}

export function CompletedTaskCard({ task, studiedMinutes }: { task: ArchivedTask; studiedMinutes: number }) {
  const { advancedMode } = useCourse();
  const kind = task.kind ?? 'Tarea';
  const KindIcon = TASK_KIND_META[kind]?.icon ?? TASK_KIND_META.Tarea.icon;
  const onTime = punctuality(task);
  const archived = parseIsoSafe(task.archivedAt);
  const dueDate = parseIsoSafe(task.dueDate);

  return (
    <Card className="group relative overflow-hidden border-border/70 bg-card/70 p-3.5 shadow-sm transition-colors hover:border-primary/40">
      {/* Filo verde: el mismo lenguaje que la tarjeta de tarea pendiente,
          aquí siempre en "hecho". */}
      <span className="absolute inset-y-0 left-0 w-[3px] bg-emerald-500/80" />

      <div className="flex items-start justify-between gap-3 pl-1.5">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-semibold text-muted-foreground">
            {task.courseName}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
        </div>
        {onTime && (
          <span
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
              onTime.tone
            )}
          >
            {onTime.label}
          </span>
        )}
      </div>

      {task.description && (
        <p className="mt-1.5 line-clamp-2 pl-1.5 text-justify text-xs text-muted-foreground">
          {task.description}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pl-1.5 pt-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1" title={tr('Tipo: {kind}', { kind: taskKindLabel(kind) })}>
          <KindIcon className="h-3.5 w-3.5 text-muted-foreground/80" />
          {taskKindLabel(kind)}
        </span>

        {advancedMode && task.difficulty && (
          <span
            className={cn('flex items-center gap-1', DIFFICULTY_META[task.difficulty].text)}
            title={tr('Dificultad: {difficulty}', { difficulty: difficultyLabel(task.difficulty) })}
          >
            <DifficultyBars level={task.difficulty} />
            {difficultyLabel(task.difficulty)}
          </span>
        )}

        {advancedMode && (
        <span className="flex items-center gap-1" title={tr('Importancia')}>
          <span
            className={cn(
              'h-1.5 w-1.5 rounded-full',
              task.priority === 'Alta'
                ? 'bg-rose-400'
                : task.priority === 'Media'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
            )}
          />
          {priorityLabel(task.priority)}
        </span>
        )}

        <span className="ml-auto flex items-center gap-1 font-medium text-foreground" title={tr('Tiempo de estudio dedicado a esta tarea')}>
          <Timer className="h-3.5 w-3.5 text-primary" />
          {studiedMinutes > 0 ? formatMinutes(Math.round(studiedMinutes)) : tr('sin sesiones')}
          {advancedMode && task.estimatedMinutes ? (
            <span className="font-normal text-muted-foreground">
              {' '}/ {formatMinutes(task.estimatedMinutes)}{' '}{tr('est.')}
            </span>
          ) : null}
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 pl-1.5 text-[10px] text-muted-foreground/90">
        <span className="flex items-center gap-1">
          <CalendarCheck2 className="h-3 w-3 text-emerald-500" />
          {tr('Culminada el')}{' '}
          {archived ? format(archived, tr('d \'de\' MMMM yyyy, h:mm a'), { locale: dateLocale() }) : '—'}
        </span>
        {dueDate && (
          <span className="flex items-center gap-1">
            <Clock3 className="h-3 w-3" />
            {tr('Fecha de entrega:')}{' '}{format(dueDate, tr('d \'de\' MMMM yyyy'), { locale: dateLocale() })}
          </span>
        )}
      </div>
    </Card>
  );
}

/**
 * Tareas que no se pudieron terminar. No son culminadas —no suman en ninguna
 * métrica— pero tampoco se borran: se pueden retomar o eliminar del todo.
 */
/**
 * Las tareas que no se pudieron terminar. Se ven con la MISMA tarjeta que en
 * pendientes —mismos datos, misma edición en el sitio—, con una franja ámbar
 * encima y, en lugar de culminar, un botón para retomarla.
 */
function IncompleteTasksSection() {
  const { incompleteTasks } = useCourse();
  const [open, setOpen] = useState(true);
  if (!incompleteTasks || incompleteTasks.length === 0) return null;

  return (
    <section className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
          <CircleSlash className="h-4 w-4" />
          {tr('Tareas incompletas ·')}{' '}{incompleteTasks.length}
        </span>
        <span className="text-[11px] text-muted-foreground">{open ? tr('Ocultar') : tr('Mostrar')}</span>
      </button>
      {open && (
        // La tarjeta es ordenable en pendientes; aquí no se ordena, pero
        // necesita su contexto para montarse igual.
        <DndContext accessibility={dndAccessibility()}>
          <SortableContext items={incompleteTasks.map((task) => task.id)}>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {incompleteTasks.map((task) => (
                <TaskCard key={task.id} task={task} showCourseName variant="incomplete" isDragDisabled />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

export default function CompletedTasksView() {
  const { archivedTasks, studySessions } = useCourse();
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [query, setQuery] = useState('');

  const studied = useMemo(() => minutesByTask(studySessions ?? []), [studySessions]);

  /** Meses que tienen al menos una tarea culminada, del más reciente al más
   *  antiguo: la navegación nunca lleva a un mes vacío por error. */
  const monthsWithData = useMemo(() => {
    const keys = new Set<string>();
    for (const t of archivedTasks ?? []) {
      try {
        keys.add(format(parseISO(t.archivedAt), 'yyyy-MM'));
      } catch {
        /* fecha corrupta: se ignora */
      }
    }
    return [...keys].sort().reverse();
  }, [archivedTasks]);

  const monthTasks = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (archivedTasks ?? [])
      .filter((t) => {
        try {
          if (!isSameMonth(parseISO(t.archivedAt), monthCursor)) return false;
        } catch {
          return false;
        }
        if (!search) return true;
        return (
          t.name.toLowerCase().includes(search) ||
          t.courseName.toLowerCase().includes(search) ||
          (t.description ?? '').toLowerCase().includes(search)
        );
      })
      .sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }, [archivedTasks, monthCursor, query]);

  /** Agrupación por semana ISO, de la más reciente a la más antigua. */
  const weeks = useMemo(() => {
    const map = new Map<string, { start: Date; end: Date; tasks: ArchivedTask[] }>();
    for (const task of monthTasks) {
      const date = parseISO(task.archivedAt);
      const start = startOfISOWeek(date);
      const key = format(start, 'yyyy-MM-dd');
      const group = map.get(key);
      if (group) group.tasks.push(task);
      else map.set(key, { start, end: endOfISOWeek(date), tasks: [task] });
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([, v]) => v);
  }, [monthTasks]);

  const totals = useMemo(() => {
    let minutes = 0;
    let onTime = 0;
    let withDeadline = 0;
    for (const t of monthTasks) {
      minutes += studied.get(t.id) ?? 0;
      if (!t.dueDate) continue;
      withDeadline += 1;
      try {
        if (differenceInCalendarDays(parseISO(t.archivedAt), parseISO(t.dueDate)) <= 0) onTime += 1;
      } catch {
        /* fecha corrupta: no puntúa */
      }
    }
    return { minutes, onTime, withDeadline };
  }, [monthTasks, studied]);

  const monthLabel = format(monthCursor, tr('MMMM \'de\' yyyy'), { locale: dateLocale() });
  const hasAnyArchived = (archivedTasks ?? []).length > 0;

  const shiftMonth = (delta: number) =>
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));

  if (!hasAnyArchived) {
    return (
      <div className="space-y-5 pb-6">
        <IncompleteTasksSection />
        <Card className="flex h-32 items-center justify-center border-dashed">
          <p className="text-sm text-muted-foreground">
            {tr('Aún no hay tareas culminadas. Cuando completes una, quedará guardada aquí.')}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-6">
      <IncompleteTasksSection />
      {/* ---------- Navegación por mes + búsqueda ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(-1)} title={tr('Mes anterior')}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center font-headline text-sm font-bold text-primary">
            {monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => shiftMonth(1)} title={tr('Mes siguiente')}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={tr('Tarea, asignatura o detalle…')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 border-primary/60 bg-card pl-8 text-xs"
          />
        </div>
      </div>

      {/* ---------- Resumen del mes: la cifra que pide la auxiliar ---------- */}
      <Card className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
        <div>
          <p className="text-[10px] text-muted-foreground">{tr('Tareas culminadas')}</p>
          <p className="font-headline text-2xl font-bold tabular-nums text-primary">
            {monthTasks.length}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">{tr('Tiempo dedicado')}</p>
          <p className="font-headline text-2xl font-bold tabular-nums text-foreground">
            {totals.minutes > 0 ? formatMinutes(Math.round(totals.minutes)) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">{tr('Entregadas a tiempo')}</p>
          <p className="font-headline text-2xl font-bold tabular-nums text-foreground">
            {totals.withDeadline > 0 ? `${totals.onTime}/${totals.withDeadline}` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground">{tr('Semanas con entregas')}</p>
          <p className="font-headline text-2xl font-bold tabular-nums text-foreground">
            {weeks.length}
          </p>
        </div>
      </Card>

      {/* ---------- Semanas del mes ---------- */}
      {monthTasks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-2 border-dashed py-12 text-center">
          <TrendingUp className="h-7 w-7 text-muted-foreground/60" />
          <p className="text-sm font-semibold text-foreground">
            {query ? tr('Ninguna tarea coincide con la búsqueda') : tr('Sin tareas culminadas en {monthLabel}', { monthLabel })}
          </p>
          {monthsWithData.length > 0 && !query && (
            <p className="text-xs text-muted-foreground">
              {tr('Con registro en:')}{' '}{monthsWithData
                .slice(0, 6)
                .map((k) => format(parseISO(`${k}-01`), tr('MMM yyyy'), { locale: dateLocale() }))
                .join(' · ')}
            </p>
          )}
        </Card>
      ) : (
        weeks.map((week) => {
          const weekMinutes = week.tasks.reduce((acc, t) => acc + (studied.get(t.id) ?? 0), 0);
          return (
            <section key={week.start.toISOString()} className="space-y-2.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-xs font-bold text-foreground">
                  {/* La semana ISO puede empezar en el mes anterior: en ese
                      caso se nombra también el mes de partida. */}
                  {tr('Semana del')}{' '}
                  {format(
                    week.start,
                    week.start.getMonth() === week.end.getMonth() ? 'd' : tr('d \'de\' MMMM'),
                    { locale: dateLocale() }
                  )}{' '}
                  {tr('al')}{' '}{format(week.end, tr('d \'de\' MMMM'), { locale: dateLocale() })}
                </h3>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold text-primary">
                  {week.tasks.length} {week.tasks.length === 1 ? tr('tarea') : tr('tareas')}
                </span>
                {weekMinutes > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatMinutes(Math.round(weekMinutes))}{' '}{tr('de estudio')}
                  </span>
                )}
                <span className="h-px flex-1 bg-border" />
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {week.tasks.map((task) => (
                  <CompletedTaskCard
                    key={task.id}
                    task={task}
                    studiedMinutes={studied.get(task.id) ?? 0}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
