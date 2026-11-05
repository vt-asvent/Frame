import { differenceInCalendarDays, parseISO } from 'date-fns';
import { Filter, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TASK_DIFFICULTIES, TASK_KINDS } from '@/components/tasks/task-badges';
import { cn } from '@/lib/utils';
import type { Task, TaskDifficulty, TaskKind, TaskPriority } from '@/types';
import { tr } from '@/lib/i18n';
import { difficultyLabel, priorityLabel, taskKindLabel } from '@/lib/enum-labels';
import { useCourse } from '@/context/CourseContext';

// ============================================================
// Filtros de la galería de tareas.
//
// La galería se ve siempre en TU orden (arrastrando las tarjetas). Los filtros
// deciden CUÁLES se ven: por importancia, por dificultad, por tipo y por
// entrega; dentro de «Entrega», «Por proximidad» las ordena por fecha mientras
// esté activo. Dentro de un grupo las opciones se suman; entre grupos, se cruzan.
// ============================================================

export type DueFilter = 'overdue' | 'today' | 'week' | 'none';

export interface TaskFilterState {
  query: string;
  priorities: TaskPriority[];
  difficulties: (TaskDifficulty | 'unset')[];
  kinds: TaskKind[];
  due: DueFilter | null;
  /** Ordenar por fecha de entrega (la más cercana primero) en vez de por tu orden. */
  byProximity: boolean;
}

export const EMPTY_FILTERS: TaskFilterState = {
  query: '',
  priorities: [],
  difficulties: [],
  kinds: [],
  due: null,
  byProximity: false,
};

export function countActiveFilters(filters: TaskFilterState): number {
  return (
    (filters.query.trim() ? 1 : 0) +
    (filters.priorities.length > 0 ? 1 : 0) +
    (filters.difficulties.length > 0 ? 1 : 0) +
    (filters.kinds.length > 0 ? 1 : 0) +
    (filters.due ? 1 : 0) +
    (filters.byProximity ? 1 : 0)
  );
}

export function applyTaskFilters(tasks: Task[], filters: TaskFilterState): Task[] {
  const needle = filters.query.trim().toLowerCase();
  const today = new Date();
  return tasks.filter((task) => {
    if (needle) {
      const haystack = `${task.name} ${task.description ?? ''} ${task.courseName ?? ''}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    if (filters.priorities.length > 0 && !filters.priorities.includes(task.priority)) return false;
    if (filters.difficulties.length > 0 && !filters.difficulties.includes(task.difficulty ?? 'unset')) return false;
    if (filters.kinds.length > 0 && !filters.kinds.includes(task.kind ?? 'Tarea')) return false;

    if (filters.due) {
      if (filters.due === 'none') return !task.dueDate;
      if (!task.dueDate) return false;
      const days = differenceInCalendarDays(parseISO(task.dueDate), today);
      if (filters.due === 'overdue') return days < 0;
      if (filters.due === 'today') return days === 0;
      if (filters.due === 'week') return days >= 0 && days <= 7;
    }
    return true;
  });
}

const PRIORITIES: TaskPriority[] = ['Alta', 'Media', 'Baja'];

const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'overdue', get label() { return tr('Vencidas'); } },
  { value: 'today', get label() { return tr('Vencen hoy'); } },
  { value: 'week', get label() { return tr('Próximos 7 días'); } },
  { value: 'none', get label() { return tr('Sin fecha'); } },
];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item];
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'h-7 rounded-md border px-2.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-primary bg-primary/15 text-primary'
          : 'border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-semibold text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export default function TaskFilters({
  value,
  onChange,
}: {
  value: TaskFilterState;
  onChange: (next: TaskFilterState) => void;
}) {
  const active = countActiveFilters(value);
  // Importancia y dificultad solo se filtran en modo Avanzado.
  const { advancedMode } = useCourse();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          title={tr('Filtrar tareas')}
          className={cn(
            'relative h-9 w-9 border-primary text-primary hover:bg-primary/30 hover:text-primary',
            active > 0 ? 'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground' : 'bg-primary/20'
          )}
        >
          <Filter className="h-[18px] w-[18px]" />
          {active > 0 && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-background bg-foreground px-1 text-[9px] font-bold leading-none text-background">
              {active}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3.5 p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-primary">{tr('Filtrar tareas')}</p>
          {active > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-destructive"
            >
              <X className="h-3 w-3" />
              {tr('Quitar filtros')}
            </button>
          )}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={value.query}
            onChange={(e) => onChange({ ...value, query: e.target.value })}
            placeholder={tr('Nombre, descripción o asignatura…')}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {advancedMode && (<>
        <Group title={tr('Importancia')}>
          {PRIORITIES.map((priority) => (
            <Pill
              key={priority}
              active={value.priorities.includes(priority)}
              onClick={() => onChange({ ...value, priorities: toggle(value.priorities, priority) })}
            >
              {priorityLabel(priority)}
            </Pill>
          ))}
        </Group>

        <Group title={tr('Dificultad')}>
          {TASK_DIFFICULTIES.map((difficulty) => (
            <Pill
              key={difficulty}
              active={value.difficulties.includes(difficulty)}
              onClick={() => onChange({ ...value, difficulties: toggle(value.difficulties, difficulty) })}
            >
              {difficultyLabel(difficulty)}
            </Pill>
          ))}
          <Pill
            active={value.difficulties.includes('unset')}
            onClick={() => onChange({ ...value, difficulties: toggle(value.difficulties, 'unset' as const) })}
          >
            {tr('Sin definir')}
          </Pill>
        </Group>
        </>)}


        <Group title={tr('Entrega')}>
          <Pill active={value.byProximity} onClick={() => onChange({ ...value, byProximity: !value.byProximity })}>
            {tr('Por proximidad')}
          </Pill>
          {DUE_OPTIONS.map((option) => (
            <Pill
              key={option.value}
              active={value.due === option.value}
              onClick={() => onChange({ ...value, due: value.due === option.value ? null : option.value })}
            >
              {option.label}
            </Pill>
          ))}
        </Group>

        <Group title={tr('Tipo')}>
          {TASK_KINDS.map((kind) => (
            <Pill
              key={kind}
              active={value.kinds.includes(kind)}
              onClick={() => onChange({ ...value, kinds: toggle(value.kinds, kind) })}
            >
              {taskKindLabel(kind)}
            </Pill>
          ))}
        </Group>
      </PopoverContent>
    </Popover>
  );
}
