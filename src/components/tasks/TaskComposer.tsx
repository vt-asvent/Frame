import { useEffect, useRef, useState } from 'react';
import { getDate } from 'date-fns';
import { Bell, CalendarIcon, Flag, Hourglass, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import TaskAttachments, { AttachmentChips } from '@/components/tasks/TaskAttachments';
import ReminderEditor, {
  DEFAULT_REMINDER,
  describeReminder,
  reminderToTask,
  type ReminderConfig,
} from '@/components/tasks/ReminderEditor';
import EstimateEditor, { formatEstimate } from '@/components/tasks/EstimateEditor';
import {
  DIFFICULTY_META,
  DifficultyBars,
  TASK_DIFFICULTIES,
  TASK_KIND_META,
  TASK_KINDS,
} from '@/components/tasks/task-badges';
import { cn } from '@/lib/utils';
import type { Task, TaskAttachment, TaskDifficulty, TaskKind, TaskPriority } from '@/types';
import { tr } from '@/lib/i18n';
import { difficultyLabel, priorityLabel, taskKindLabel } from '@/lib/enum-labels';
import { useCourse } from '@/context/CourseContext';

// ============================================================
// La tarjeta de crear tarea.
//
// Vive aquí, y no dentro de la pantalla de la asignatura, porque ahora se usa
// en DOS sitios: en cada asignatura y en la creación rápida de la barra
// superior. Duplicarla habría garantizado que en unas semanas fueran dos
// tarjetas distintas con el mismo nombre.
//
// El formulario guarda su propio estado y solo entrega el resultado
// (`onCreate`). Quien la use decide a qué asignatura pertenece la tarea, que
// es lo único que cambia entre los dos sitios.
// ============================================================

export interface TaskDraft {
  name: string;
  description: string;
  dueDate: string | null;
  priority: TaskPriority;
  kind: TaskKind;
  difficulty: TaskDifficulty;
  reminderEnabled: boolean;
  reminderTime?: string;
  reminderDays?: number[];
  reminderRepeatMinutes?: number;
  estimatedMinutes?: number;
  attachments?: TaskAttachment[];
}

const priorityStyles: Record<TaskPriority, { text: string; badge: string; dropdownItem: string }> = {
  Baja: {
    text: 'text-foreground',
    badge: 'bg-green-500/20',
    dropdownItem: 'text-foreground bg-green-500/20 focus:text-foreground focus:bg-green-500/30',
  },
  Media: {
    text: 'text-foreground',
    badge: 'bg-yellow-500/20',
    dropdownItem: 'text-foreground bg-yellow-500/20 focus:text-foreground focus:bg-yellow-500/30',
  },
  Alta: {
    text: 'text-foreground',
    badge: 'bg-red-500/20',
    dropdownItem: 'text-foreground bg-red-500/20 focus:text-foreground focus:bg-red-500/30',
  },
};



export default function TaskComposer({
  onCreate,
  className,
  /** Se desactiva el botón mientras falte algo fuera del formulario. */
  disabled = false,
  disabledReason,
  submitLabel = tr('Añadir Tarea'),
}: {
  onCreate: (draft: TaskDraft) => void;
  className?: string;
  disabled?: boolean;
  disabledReason?: string;
  submitLabel?: string;
}) {
  // Sin modo Avanzado, el redactor pide solo tipo, fecha y recordatorio; la
  // tarea nace con importancia y dificultad «Media» y sin tiempo estimado,
  // igual que si se dejaran sin tocar.
  const { advancedMode } = useCourse();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [priority, setPriority] = useState<Task['priority'] | null>(null);
  const [kind, setKind] = useState<TaskKind | null>(null);
  const [difficulty, setDifficulty] = useState<TaskDifficulty | null>(null);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  // El recordatorio nace APAGADO: se enciende solo en lo que no se puede olvidar.
  const [reminder, setReminder] = useState<ReminderConfig>(DEFAULT_REMINDER);
  const [estimate, setEstimate] = useState(0);
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);

  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  // La descripción crece con lo escrito: un textarea de una línea con scroll
  // interno esconde justo lo que se acaba de teclear.
  useEffect(() => {
    const textarea = descriptionRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [description]);

  const submit = () => {
    if (!name.trim() || disabled) return;
    onCreate({
      name: name.trim(),
      description,
      dueDate: dueDate ? dueDate.toISOString() : null,
      priority: priority || 'Media',
      kind: kind ?? 'Tarea',
      difficulty: difficulty ?? 'Media',
      ...reminderToTask(reminder),
      estimatedMinutes: estimate > 0 ? estimate : undefined,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    setName('');
    setDescription('');
    setDueDate(undefined);
    setPriority(null);
    setKind(null);
    setDifficulty(null);
    setReminder(DEFAULT_REMINDER);
    setEstimate(0);
    setAttachments([]);
  };

  return (
    <Card className={className}>
      <CardContent className="pt-4">
        <div>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tr('Nombre')}
            className="border-0 rounded-b-none h-auto font-semibold text-sm bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="px-4">
            <Separator />
          </div>
          <Textarea
            ref={descriptionRef}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={tr('Descripción')}
            className="border-0 rounded-t-none text-xs text-muted-foreground bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 resize-none overflow-hidden text-justify"
            rows={1}
          />
        </div>

        <div className="flex items-center gap-2 pt-6">
          <div className="flex items-center gap-2">
            {/* Orden (1.6.5): fecha, tipo, importancia, dificultad, tiempo
                estimado, recordatorio, documentos y enlaces. */}
            <Popover open={isCalendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="w-10 h-10" title={tr('Fecha de entrega')}>
                  {dueDate ? (
                    <span className="text-sm font-bold text-primary">{getDate(dueDate)}</span>
                  ) : (
                    <CalendarIcon className="h-4 w-4" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  selected={dueDate}
                  onSelect={(date) => {
                    setDueDate(date as Date | undefined);
                    setCalendarOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>

            {/* Tipo de pendiente: el icono cambia según lo elegido, así
                se reconoce de un vistazo sin abrir el menú. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title={kind ? tr('Tipo: {kind}', { kind: taskKindLabel(kind) }) : tr('Tipo de pendiente')}
                  className={cn('h-10 w-10 transition-colors', kind && 'border-primary bg-primary/15 text-primary')}
                >
                  {(() => {
                    const KindIcon = TASK_KIND_META[kind ?? 'Tarea'].icon;
                    return <KindIcon className="h-4 w-4" />;
                  })()}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {TASK_KINDS.map((option) => {
                  const KindIcon = TASK_KIND_META[option].icon;
                  return (
                    <DropdownMenuItem key={option} onSelect={() => setKind(option)}>
                      <KindIcon className="mr-2 h-4 w-4 text-primary" />
                      <span className="font-semibold">{taskKindLabel(option)}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>

            {advancedMode && (<>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title={priority ? tr('Importancia: {priority}', { priority: priorityLabel(priority) }) : tr('Importancia')}
                  className={cn('w-10 h-10 transition-colors', priority && priorityStyles[priority].badge)}
                >
                  <Flag className={cn('h-4 w-4', !priority && 'text-foreground')} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem
                  onSelect={() => setPriority('Alta')}
                  className={cn('font-semibold', priorityStyles['Alta'].dropdownItem)}
                >
                  {priorityLabel('Alta')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setPriority('Media')}
                  className={cn('font-semibold', priorityStyles['Media'].dropdownItem)}
                >
                  {priorityLabel('Media')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => setPriority('Baja')}
                  className={cn('font-semibold', priorityStyles['Baja'].dropdownItem)}
                >
                  {priorityLabel('Baja')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Dificultad: tres barras que se llenan según el nivel. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title={difficulty ? tr('Dificultad: {difficulty}', { difficulty: difficultyLabel(difficulty) }) : tr('Dificultad')}
                  className={cn('h-10 w-10 transition-colors', difficulty && DIFFICULTY_META[difficulty].badge)}
                >
                  <DifficultyBars level={difficulty} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {TASK_DIFFICULTIES.map((level) => (
                  <DropdownMenuItem key={level} onSelect={() => setDifficulty(level)}>
                    <DifficultyBars level={level} className="mr-2" />
                    <span className={cn('font-semibold', DIFFICULTY_META[level].text)}>{difficultyLabel(level)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tiempo estimado: define el % de avance por sesión de estudio */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title={estimate > 0 ? tr('Tiempo estimado: {estimate}', { estimate: formatEstimate(estimate) }) : tr('Tiempo estimado para culminar')}
                  className={cn(
                    'w-10 h-10 transition-colors',
                    estimate > 0 && 'bg-primary/20 text-primary border-primary'
                  )}
                >
                  {estimate > 0 ? (
                    <span className="text-[10px] font-bold leading-none">
                      {Math.floor(estimate / 60) > 0 ? `${Math.floor(estimate / 60)}h` : ''}
                      {estimate % 60 > 0 ? `${estimate % 60}m` : ''}
                    </span>
                  ) : (
                    <Hourglass className="h-4 w-4" />
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <EstimateEditor minutes={estimate} onChange={setEstimate} />
              </PopoverContent>
            </Popover>
            </>)}

            {/* Recordatorio: botón discreto → mini recuadro con reloj */}
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  title={describeReminder(reminder)}
                  className={cn(
                    'w-10 h-10 transition-colors',
                    reminder.enabled && 'bg-primary/20 text-primary border-primary'
                  )}
                >
                  <Bell className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-3" align="start">
                <ReminderEditor value={reminder} onChange={setReminder} />
              </PopoverContent>
            </Popover>

            {/* Documentos y enlaces: adjuntar YA, sin tener que crear la
                tarea primero y volver a entrar a editarla. */}
            <TaskAttachments variant="toolbar" attachments={attachments} onChange={setAttachments} />
          </div>
          <div className="flex-grow" />
          <Button
            onClick={submit}
            disabled={!name.trim() || disabled}
            title={disabled ? disabledReason : undefined}
            className={cn((!name.trim() || disabled) && 'bg-primary/20 text-primary border border-primary')}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            {submitLabel}
          </Button>
        </div>

        {disabled && disabledReason && (
          <p className="pt-2 text-center text-[11px] text-muted-foreground">{disabledReason}</p>
        )}

        <AttachmentChips
          attachments={attachments}
          onRemove={(attachment) => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
        />
      </CardContent>
    </Card>
  );
}
