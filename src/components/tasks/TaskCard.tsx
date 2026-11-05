import React, { useState, useEffect, useRef } from 'react';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import {
  Bell,
  BellOff,
  Calendar as CalendarIcon,
  Check,
  CircleSlash,
  RotateCcw,
  Clock,
  MoreVertical,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DifficultyBars,
  TASK_DIFFICULTIES,
  TASK_KINDS,
  TASK_KIND_META,
} from '@/components/tasks/task-badges';
import type { Task, TaskDifficulty, TaskKind, TaskPriority } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import TaskAttachments, { AttachmentChips } from '@/components/tasks/TaskAttachments';
import { deleteAttachment } from '@/lib/file-handles';
import ReminderEditor, {
  describeReminder,
  reminderFromTask,
  reminderToTask,
  type ReminderConfig,
} from '@/components/tasks/ReminderEditor';
import EstimateEditor, { formatEstimate } from '@/components/tasks/EstimateEditor';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useCourse } from '@/context/CourseContext';
import { dateLocale, lowerFirst, tr } from '@/lib/i18n';
import { difficultyLabel, priorityLabel, taskKindLabel } from '@/lib/enum-labels';
import { parseIsoSafe } from '@/lib/dates';

// ============================================================
// Tarjeta de pendiente.
//
// Criterio de diseño: la tarjeta no compite consigo misma. UN solo acento de
// color por tarjeta —la importancia, en el filo izquierdo— y todo lo demás en
// gris, ordenado por jerarquía tipográfica: asignatura arriba en versalitas,
// título con peso, descripción tenue, y una única regla fina que separa el
// contenido de sus datos.
//
// EDITAR NO CAMBIA LA TARJETA. Con el lápiz activo la tarjeta conserva su
// aspecto: cada dato se edita tocándolo —el título y la descripción se
// escriben en su sitio; la importancia, el tipo, la fecha… abren su pequeño
// selector—. Lo único que delata el modo edición es el visto y la X de arriba
// a la derecha (y un contorno fino), que confirman o descartan los cambios.
// ============================================================

const PRIORITY_META: Record<TaskPriority, { spine: string; dot: string; text: string }> = {
  'Baja': { spine: 'bg-emerald-400', dot: 'bg-emerald-400', text: 'text-emerald-500 dark:text-emerald-400' },
  'Media': { spine: 'bg-amber-400', dot: 'bg-amber-400', text: 'text-amber-500 dark:text-amber-400' },
  'Alta': { spine: 'bg-rose-400', dot: 'bg-rose-400', text: 'text-rose-500 dark:text-rose-400' },
};

/**
 * Fecha en su forma más útil: cuando está cerca importa CUÁNTO FALTA, no el
 * día del mes; cuando está lejos, al revés. La fecha exacta siempre queda en
 * el título emergente.
 */
function describeDueDate(due: Date): { label: string; tone: string } {
  const days = differenceInCalendarDays(due, new Date());
  const year = due.getFullYear() === new Date().getFullYear() ? '' : ' yy';
  const exact = format(due, `d MMM${year}`, { locale: dateLocale() });

  if (days < 0) {
    return {
      label: days === -1 ? tr('Venció ayer') : tr('Venció hace {p} días', { p: Math.abs(days) }),
      tone: 'text-rose-500 dark:text-rose-400 font-semibold',
    };
  }
  if (days === 0) return { label: tr('Vence hoy'), tone: 'text-rose-500 dark:text-rose-400 font-semibold' };
  if (days === 1) return { label: tr('Vence mañana'), tone: 'text-amber-500 dark:text-amber-400 font-medium' };
  if (days <= 7) return { label: tr('En {days} días', { days }), tone: 'text-amber-500 dark:text-amber-400' };
  return { label: exact, tone: '' };
}

/** Un dato de la fila inferior. En edición es un botón; si no, texto. */
const chip = 'inline-flex items-center gap-1.5 rounded';
const chipEditable =
  '-mx-1 cursor-pointer px-1 outline-none transition-colors hover:bg-primary/10 focus-visible:bg-primary/10 data-[state=open]:bg-primary/10';
/** Dato aún sin valor: solo se ve al editar, para poder añadirlo. */
const chipGhost = 'text-muted-foreground/60 underline decoration-dashed underline-offset-2';

type PendingConfirm = 'complete' | 'incomplete' | 'delete' | 'retry' | 'purge' | null;

export const TaskCard = ({
  task,
  showCourseName,
  isHighlighted,
  isDragDisabled = false,
  variant = 'active',
}: {
  task: Task;
  showCourseName?: boolean;
  isHighlighted?: boolean;
  isDragDisabled?: boolean;
  /**
   * 'incomplete': la misma tarjeta, para una tarea archivada como incompleta.
   * Lleva una franja ámbar arriba, el botón de culminar pasa a ser
   * «reintentar» y los cambios se guardan en su archivo, no en pendientes.
   */
  variant?: 'active' | 'incomplete';
}) => {
  const {
    updateTask: updateActiveTask,
    deleteTask,
    removeTask,
    markTaskIncomplete,
    updateIncompleteTask,
    restoreIncompleteTask,
    deleteIncompleteTask,
    advancedMode,
  } = useCourse();
  const isIncomplete = variant === 'incomplete';
  // Cada tarea se corrige donde vive: la incompleta, en su archivo.
  const updateTask = isIncomplete ? updateIncompleteTask : updateActiveTask;
  const [progress, setProgress] = useState(task.progress);
  const [confirm, setConfirm] = useState<PendingConfirm>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(task.name);
  const [editedDescription, setEditedDescription] = useState(task.description);
  const [editedDueDate, setEditedDueDate] = useState<Date | undefined>(
    task.dueDate ? parseISO(task.dueDate) : undefined
  );
  const [editedPriority, setEditedPriority] = useState<TaskPriority>(task.priority || 'Media');
  const [editedKind, setEditedKind] = useState<TaskKind>(task.kind ?? 'Tarea');
  const [editedDifficulty, setEditedDifficulty] = useState<TaskDifficulty | undefined>(task.difficulty);
  const [editedEstimate, setEditedEstimate] = useState<number>(task.estimatedMinutes ?? 0);
  const [editedReminder, setEditedReminder] = useState<ReminderConfig>(() => reminderFromTask(task));
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const nameTextareaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: isEditing || isDragDisabled,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 'auto',
  };

  const resetStateToTask = () => {
    setEditedName(task.name);
    setEditedDescription(task.description || '');
    setEditedDueDate(task.dueDate ? parseISO(task.dueDate) : undefined);
    setEditedPriority(task.priority || 'Media');
    setEditedKind(task.kind ?? 'Tarea');
    setEditedDifficulty(task.difficulty);
    setEditedEstimate(task.estimatedMinutes ?? 0);
    setEditedReminder(reminderFromTask(task));
  };

  useEffect(() => {
    setProgress(task.progress);
    if (!isEditing) resetStateToTask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task, isEditing]);

  // Los campos de texto crecen con lo escrito, como el texto que sustituyen.
  useEffect(() => {
    if (!isEditing) return;
    for (const ref of [nameTextareaRef, descriptionTextareaRef]) {
      const el = ref.current;
      if (el) {
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }
    }
  }, [editedName, editedDescription, isEditing]);

  const handleProgressChange = (value: number[]) => {
    const newProgress = value[0];
    setProgress(newProgress);
    updateTask(task.id, { progress: newProgress });
  };

  const handleSaveEdit = () => {
    if (editedName.trim() === '') return;
    updateTask(task.id, {
      name: editedName.trim(),
      description: editedDescription ? editedDescription.trim() : '',
      dueDate: editedDueDate ? editedDueDate.toISOString() : null,
      priority: editedPriority,
      kind: editedKind,
      difficulty: editedDifficulty,
      estimatedMinutes: editedEstimate > 0 ? editedEstimate : undefined,
      ...reminderToTask(editedReminder),
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    resetStateToTask();
  };

  const handleEditKeys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      handleCancelEdit();
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSaveEdit();
    }
  };

  // Lo que se PINTA: en edición, el borrador; si no, la tarea.
  const shownPriority: TaskPriority = isEditing
    ? editedPriority
    : PRIORITY_META[task.priority]
      ? task.priority
      : 'Media';
  const priorityMeta = PRIORITY_META[shownPriority];
  const shownKind: TaskKind = isEditing ? editedKind : task.kind && TASK_KIND_META[task.kind] ? task.kind : 'Tarea';
  const KindIcon = TASK_KIND_META[shownKind].icon;
  const shownDifficulty = isEditing ? editedDifficulty : task.difficulty;
  const shownEstimate = isEditing ? editedEstimate : (task.estimatedMinutes ?? 0);
  const shownDue = isEditing ? (editedDueDate ?? null) : parseIsoSafe(task.dueDate);
  const due = shownDue ? describeDueDate(shownDue) : null;
  const shownReminder = isEditing ? editedReminder : reminderFromTask(task);

  // El asa de arrastre es la cabecera cuando hay asignatura, y el título
  // cuando no la hay: siempre existe una zona amplia de la que tirar.
  const dragProps = !isDragDisabled && !isEditing ? { ...attributes, ...listeners } : {};

  const confirmCopy: Record<Exclude<PendingConfirm, null>, { title: string; text: string; action: string; run: () => void; danger?: boolean }> = {
    complete: {
      title: tr('¿Culminar la tarea?'),
      text: tr('Pasará a tus tareas culminadas. Puedes deshacerlo unos segundos con Ctrl+Z.'),
      action: tr('Culminar'),
      run: () => deleteTask(task.id),
    },
    incomplete: {
      title: tr('¿Marcar como incompleta?'),
      text: tr('Úsalo cuando la tarea ya no se pudo terminar. Saldrá de tus pendientes sin contar como culminada, y podrás retomarla desde Tareas → Archivadas.'),
      action: tr('Marcar como incompleta'),
      run: () => markTaskIncomplete(task.id),
    },
    delete: {
      title: tr('¿Eliminar la tarea?'),
      text: tr('«{name}» se eliminará con sus archivos adjuntos y no quedará en tu historial. Puedes deshacerlo unos segundos con Ctrl+Z.', { name: task.name }),
      action: tr('Eliminar'),
      run: () => removeTask(task.id),
      danger: true,
    },
    retry: {
      title: tr('¿Retomar la tarea?'),
      text: tr('«{name}» vuelve a tus tareas pendientes con el avance que tenía, para intentarlo de nuevo.', { name: task.name }),
      action: tr('Retomar'),
      run: () => restoreIncompleteTask(task.id),
    },
    purge: {
      title: tr('¿Eliminar definitivamente?'),
      text: tr('«{name}» se eliminará con sus archivos adjuntos. No se puede deshacer.', { name: task.name }),
      action: tr('Eliminar'),
      run: () => deleteIncompleteTask(task.id),
      danger: true,
    },
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      id={`task-card-${task.id}`}
      onKeyDown={isEditing ? handleEditKeys : undefined}
      className={cn(
        'group relative overflow-hidden border-border/70 bg-card/70 shadow-sm transition-all',
        'hover:border-border hover:shadow-md',
        isEditing && 'border-primary/50 ring-1 ring-primary/40 hover:border-primary/50',
        isDragging && 'opacity-75 shadow-lg',
        isHighlighted && 'animate-pulse-border'
      )}
    >
      {/* Filo de importancia: el único acento permanente de la tarjeta.
          Sin modo Avanzado no se pinta: la importancia sigue guardada. */}
      {advancedMode && (
        <span
          aria-hidden
          title={tr('Importancia {p}', { p: lowerFirst(priorityLabel(shownPriority)) })}
          className={cn('absolute inset-y-0 left-0 w-[3px] transition-colors', priorityMeta.spine)}
        />
      )}

      {/* Tarea incompleta: una franja ámbar la distingue de un vistazo. */}
      {isIncomplete && (
        <div className="flex items-center justify-center gap-1.5 border-b border-amber-500/30 bg-amber-500/15 py-1 text-[10px] font-bold text-amber-600 dark:text-amber-400">
          <CircleSlash className="h-3 w-3" />
          {tr('Tarea incompleta')}
        </div>
      )}

      <CardContent className="space-y-2.5 py-3.5 pl-5 pr-3.5">
        {/* ---- Cabecera: asignatura y acciones ---- */}
        <div className="flex items-start justify-between gap-2">
          <div
            {...(showCourseName ? dragProps : {})}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1.5',
              showCourseName && !isDragDisabled && !isEditing && 'cursor-grab active:cursor-grabbing'
            )}
          >
            {showCourseName && (
              <p className="truncate text-[10px] font-semibold text-primary/80">
                {task.courseName}
              </p>
            )}
          </div>

          <div className="flex flex-shrink-0 items-center gap-1.5">
            {isEditing ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleSaveEdit}
                  disabled={editedName.trim() === ''}
                  title={tr('Guardar cambios (Ctrl+Enter)')}
                  className="h-6 w-6 text-emerald-500 hover:text-emerald-600"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleCancelEdit}
                  title={tr('Descartar cambios (Esc)')}
                  className="h-6 w-6 text-rose-500 hover:text-rose-600"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  title={tr('Editar')}
                  className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      title={tr('Más opciones')}
                      className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    {isIncomplete ? (
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onSelect={() => setConfirm('purge')}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tr('Eliminar definitivamente')}
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem onSelect={() => setConfirm('incomplete')}>
                          <CircleSlash className="mr-2 h-4 w-4 text-amber-500" />
                          {tr('Marcar como incompleta')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                          onSelect={() => setConfirm('delete')}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {tr('Eliminar tarea')}
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
                {isIncomplete ? (
                  <Button
                    size="icon"
                    variant="outline"
                    title={tr('Retomar la tarea')}
                    onClick={() => setConfirm('retry')}
                    className="h-6 w-6 rounded-full border-2 border-amber-500 text-amber-500 hover:bg-amber-500/10 hover:text-amber-500"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    variant="outline"
                    title={tr('Culminar la tarea')}
                    onClick={() => setConfirm('complete')}
                    className="group/check h-5 w-5 rounded-full border-2 border-primary text-primary hover:bg-primary/10"
                  >
                    <Check className="h-3.5 w-3.5 text-primary opacity-0 transition-opacity group-hover/check:opacity-100" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* ---- Título y descripción: se escriben en su sitio ---- */}
        {isEditing ? (
          <div>
            <textarea
              ref={nameTextareaRef}
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              aria-label={tr('Nombre de la tarea')}
              placeholder={tr('Nombre de la tarea')}
              rows={1}
              autoFocus
              className="block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 text-sm font-semibold leading-snug text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-primary/5 focus:bg-primary/5"
            />
            <textarea
              ref={descriptionTextareaRef}
              value={editedDescription}
              onChange={(e) => setEditedDescription(e.target.value)}
              aria-label={tr('Descripción')}
              placeholder={tr('Añadir una descripción…')}
              rows={1}
              className="mt-1 block w-full resize-none overflow-hidden rounded-sm border-0 bg-transparent p-0 text-xs leading-relaxed text-muted-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:bg-primary/5 focus:bg-primary/5"
            />
          </div>
        ) : (
          <div
            {...(!showCourseName ? dragProps : {})}
            className={cn(
              !showCourseName && !isDragDisabled && 'cursor-grab active:cursor-grabbing'
            )}
          >
            <h4 className="break-words text-sm font-semibold leading-snug">{task.name}</h4>
            {task.description ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                {task.description}
              </p>
            ) : null}
          </div>
        )}

        {/* ---- Datos: la misma fila en lectura y en edición ----
            Orden (1.6.5): fecha, tipo, importancia, dificultad, tiempo
            estimado, recordatorio, documentos y enlaces. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2.5 text-[11px] text-muted-foreground">
          {/* Fecha de entrega */}
          {isEditing ? (
            <Popover open={isCalendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <button type="button" title={tr('Cambiar la fecha de entrega')} className={cn(chip, chipEditable, 'gap-1', due ? due.tone : chipGhost)}>
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {due ? due.label : tr('Sin fecha')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  selected={editedDueDate}
                  onSelect={(date) => {
                    setEditedDueDate(date instanceof Date ? date : undefined);
                    setCalendarOpen(false);
                  }}
                />
                {editedDueDate && (
                  <div className="border-t p-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs text-muted-foreground"
                      onClick={() => {
                        setEditedDueDate(undefined);
                        setCalendarOpen(false);
                      }}
                    >
                      {tr('Quitar fecha')}
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          ) : (
            due &&
            shownDue && (
              <span className={cn(chip, 'gap-1', due.tone)} title={format(shownDue, tr('d \'de\' MMMM \'de\' yyyy'), { locale: dateLocale() })}>
                <CalendarIcon className="h-3.5 w-3.5" />
                {due.label}
              </span>
            )
          )}

          {/* Tipo */}
          {isEditing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title={tr('Cambiar el tipo')} className={cn(chip, chipEditable)}>
                  <KindIcon className="h-3.5 w-3.5" />
                  {taskKindLabel(shownKind)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[9rem]">
                {TASK_KINDS.map((k) => {
                  const Icon = TASK_KIND_META[k].icon;
                  return (
                    <DropdownMenuItem key={k} onSelect={() => setEditedKind(k)} className="text-xs">
                      <Icon className="mr-2 h-3.5 w-3.5 text-primary" />
                      {taskKindLabel(k)}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className={chip} title={tr('Tipo: {kind}', { kind: taskKindLabel(shownKind) })}>
              <KindIcon className="h-3.5 w-3.5" />
              {taskKindLabel(shownKind)}
            </span>
          )}

          {/* Importancia, dificultad y tiempo estimado: modo Avanzado (1.7.3).
              Sin él no se ven ni se editan, pero siguen guardados y vuelven
              al activarlo. */}
          {advancedMode && (<>
          {/* Importancia */}
          {isEditing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title={tr('Cambiar la importancia')} className={cn(chip, chipEditable, 'font-medium', priorityMeta.text)}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', priorityMeta.dot)} />
                  {priorityLabel(shownPriority)}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[8rem]">
                {(['Alta', 'Media', 'Baja'] as TaskPriority[]).map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => setEditedPriority(p)} className="text-xs">
                    <span className={cn('mr-2 h-1.5 w-1.5 rounded-full', PRIORITY_META[p].dot)} />
                    {priorityLabel(p)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className={cn(chip, 'font-medium', priorityMeta.text)} title={tr('Importancia {p}', { p: lowerFirst(priorityLabel(shownPriority)) })}>
              <span className={cn('h-1.5 w-1.5 rounded-full', priorityMeta.dot)} />
              {priorityLabel(shownPriority)}
            </span>
          )}

          {/* Dificultad */}
          {isEditing ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" title={tr('Cambiar la dificultad')} className={cn(chip, chipEditable, !shownDifficulty && chipGhost)}>
                  {shownDifficulty ? <DifficultyBars level={shownDifficulty} /> : null}
                  {shownDifficulty ? difficultyLabel(shownDifficulty) : tr('Dificultad')}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[9rem]">
                {TASK_DIFFICULTIES.map((d) => (
                  <DropdownMenuItem key={d} onSelect={() => setEditedDifficulty(d)} className="text-xs">
                    <DifficultyBars level={d} className="mr-2 text-muted-foreground" />
                    {difficultyLabel(d)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setEditedDifficulty(undefined)} className="text-xs text-muted-foreground">
                  {tr('Sin definir')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            shownDifficulty && (
              <span className={chip} title={tr('Dificultad: {difficulty}', { difficulty: difficultyLabel(shownDifficulty) })}>
                <DifficultyBars level={shownDifficulty} />
                {difficultyLabel(shownDifficulty)}
              </span>
            )
          )}

          {/* Tiempo estimado, en horas y minutos */}
          {isEditing ? (
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" title={tr('Cambiar el tiempo estimado')} className={cn(chip, chipEditable, 'gap-1', shownEstimate <= 0 && chipGhost)}>
                  <Clock className="h-3.5 w-3.5" />
                  {shownEstimate > 0 ? formatEstimate(shownEstimate) : tr('Estimar')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <EstimateEditor minutes={editedEstimate} onChange={setEditedEstimate} />
              </PopoverContent>
            </Popover>
          ) : (
            shownEstimate > 0 && (
              <span className={cn(chip, 'gap-1')} title={tr('Tiempo estimado: el avance sube con tus sesiones de estudio')}>
                <Clock className="h-3.5 w-3.5" />
                {formatEstimate(shownEstimate)}
              </span>
            )
          )}
          </>)}

          {/* Recordatorio: apagado por defecto */}
          {isEditing ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  title={describeReminder(shownReminder)}
                  className={cn(chip, chipEditable, 'gap-1', shownReminder.enabled ? 'text-primary' : chipGhost)}
                >
                  {shownReminder.enabled ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
                  {shownReminder.enabled ? shownReminder.time : tr('Recordar')}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <ReminderEditor value={editedReminder} onChange={setEditedReminder} />
              </PopoverContent>
            </Popover>
          ) : (
            shownReminder.enabled && (
              <span className={cn(chip, 'gap-1 text-primary')} title={describeReminder(shownReminder)}>
                <Bell className="h-3 w-3" />
                {shownReminder.time}
              </span>
            )
          )}
          {/* Documentos y enlaces: se guardan AL INSTANTE, no al pulsar el
              visto: el archivo ya quedó enlazado y descartar la edición no
              debería deshacer ese enlace. */}
          {isEditing && (
            <TaskAttachments
              variant="chips"
              chipClassName={cn(chip, chipEditable, chipGhost)}
              attachments={task.attachments ?? []}
              onChange={(next) => updateTask(task.id, { attachments: next })}
            />
          )}
        </div>

        {/* ---- Adjuntos ---- */}
        {(task.attachments ?? []).length > 0 && (
          <AttachmentChips
            attachments={task.attachments ?? []}
            onRemove={
              isEditing
                ? (attachment) => {
                    if (attachment.kind === 'file') void deleteAttachment(attachment.id);
                    updateTask(task.id, { attachments: (task.attachments ?? []).filter((a) => a.id !== attachment.id) });
                  }
                : undefined
            }
          />
        )}

        {/* ---- Avance ----
            Un hilo, no una barra: informa de un vistazo sin pesar en la
            composición, y sigue siendo arrastrable. */}
        {advancedMode && (
        <div className="flex items-center gap-3 pt-0.5">
          <Slider
            min={0}
            max={100}
            step={1}
            value={[progress]}
            onValueChange={(value) => setProgress(value[0])}
            onValueCommit={handleProgressChange}
            title={tr('Avance: {p}%', { p: Math.round(progress) })}
            className="flex-grow [&_[data-orientation=horizontal]]:h-1 [&>span]:h-1"
          />
          <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-primary">
            {Math.round(progress)}%
          </span>
        </div>
        )}
      </CardContent>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        {confirm && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmCopy[confirm].title}</AlertDialogTitle>
              <AlertDialogDescription>{confirmCopy[confirm].text}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const run = confirmCopy[confirm].run;
                  setConfirm(null);
                  run();
                }}
                className={
                  confirmCopy[confirm].danger
                    ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                    : 'border border-primary bg-primary/20 text-primary hover:bg-primary/30'
                }
              >
                {confirmCopy[confirm].action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </Card>
  );
};
