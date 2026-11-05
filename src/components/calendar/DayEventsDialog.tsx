import { useMemo, useRef, useState } from 'react';
import {
  BellPlus,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  ClipboardList,
  ListTodo,
  Pencil,
  Trash2,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useRouter } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import type { LocalCalendarEvent, Task } from '@/types';
import { getEventsForDay, kindLabelOf } from '@/lib/calendar-events';
import LocalEventForm, { type EventPreset } from './LocalEventDialog';
import {
  EVENT_TINT,
  NoColorSwatch,
  PanelHeader,
  SectionLabel,
  Swatch,
  eventInk,
  tintVar,
} from './CalendarBits';
import {
  PAINT_COLORS,
  capitalize,
  eventEnd,
  longDayLabel,
  rangeLabel,
  relativeDayLabel,
  eventReminderLabel,
  weekdayName,
  type DayRange,
} from './calendar-model';
import { lowerFirst, tr } from '@/lib/i18n';
import { priorityLabel } from '@/lib/enum-labels';

// ============================================================
// EL recuadro del calendario LOCAL. Uno solo, con dos caras:
//
//   · el DÍA: lo que hay (eventos y tareas que vencen), su color y los dos
//     botones para crear ahí un evento o un recordatorio;
//   · el FORMULARIO de un evento (alta o edición).
//
// Del día se pasa al formulario y la flecha de arriba a la izquierda vuelve;
// nunca hay un recuadro encima de otro. Borrar se confirma en la misma fila,
// sin abrir otra ventana.
// ============================================================

export type CalendarPanel =
  | { view: 'day'; day: string }
  | {
      view: 'form';
      /** Evento a editar; ausente = alta. */
      event?: LocalCalendarEvent;
      range: DayRange;
      preset?: EventPreset;
      /** Día al que vuelve la flecha (si se llegó desde él). */
      back?: string;
    };

const byTime = (a: LocalCalendarEvent, b: LocalCalendarEvent) =>
  (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title);

function DayView({
  day,
  todayKey,
  events,
  tasks,
  fill,
  onEdit,
  onDelete,
  onCreate,
  onPaint,
  onNavigate,
}: {
  day: string;
  todayKey: string;
  events: LocalCalendarEvent[];
  tasks: Task[];
  fill: string;
  onEdit: (event: LocalCalendarEvent) => void;
  onDelete: (event: LocalCalendarEvent) => void;
  onCreate: (preset: EventPreset) => void;
  onPaint: (color: string | null) => void;
  onNavigate: (href: string) => void;
}) {
  const [confirming, setConfirming] = useState<string | null>(null);
  const dayEvents = useMemo(() => [...getEventsForDay(events, day)].sort(byTime), [events, day]);
  const empty = dayEvents.length === 0 && tasks.length === 0;

  return (
    <>
      <PanelHeader
        word={weekdayName(day)}
        title={capitalize(longDayLabel(day, todayKey))}
        subtitle={relativeDayLabel(day, todayKey)}
      />

      <div className="space-y-5">
        {empty && (
          <div className="flex flex-col items-center gap-2 py-3 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary">
              <CalendarDays className="h-5 w-5" />
            </span>
            <p className="text-sm text-muted-foreground">{tr('Nada para este día.')}</p>
          </div>
        )}

        {dayEvents.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>{tr('Eventos')}</SectionLabel>
            <ul className="space-y-1.5">
              {dayEvents.map((event) => {
                const end = eventEnd(event);
                const multi = end !== event.date;
                const past = end < todayKey;
                const remind = eventReminderLabel(event);
                const details = [
                  kindLabelOf(event),
                  event.time ?? tr('Todo el día'),
                  multi ? rangeLabel({ start: event.date, end }) : '',
                  remind ?? '',
                  past ? tr('Pasado') : '',
                ]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <li key={event.id}>
                    {confirming === event.id ? (
                      <div className="flex items-center gap-2 rounded-lg border border-destructive/60 bg-destructive/10 px-3 py-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
                          {multi ? tr('¿Eliminar «{title}» en todos sus días?', { title: event.title }) : tr('¿Eliminar «{title}»?', { title: event.title })}
                        </p>
                        <Button
                          size="sm"
                          variant="fantasma"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => setConfirming(null)}
                          autoFocus
                        >
                          {tr('No')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => {
                            onDelete(event);
                            setConfirming(null);
                          }}
                        >
                          {tr('Eliminar')}
                        </Button>
                      </div>
                    ) : (
                      <div className="group flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(event)}
                          className={cn(
                            'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-left transition-[filter] duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:shadow-[inset_3px_0_0_var(--tint)] dark:hover:brightness-125 motion-reduce:transition-none',
                            EVENT_TINT,
                            eventInk(event.color),
                            past && 'opacity-55 saturate-50'
                          )}
                          style={tintVar(event.color)}
                          title={tr('Editar')}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold">{event.title}</span>
                            <span className="block truncate text-[11px] opacity-75">{details}</span>
                          </span>
                          <Pencil className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60" />
                        </button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={tr('Eliminar «{title}»', { title: event.title })}
                          title={tr('Eliminar')}
                          onClick={() => setConfirming(event.id)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {tasks.length > 0 && (
          <section className="space-y-2">
            <SectionLabel>{tr('Tareas que vencen')}</SectionLabel>
            <ul className="space-y-1.5">
              {tasks.map((task) => (
                <li
                  key={task.id}
                  className="flex items-center gap-3 rounded-lg border border-border/70 bg-card px-3 py-2"
                >
                  <ClipboardList className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {task.courseName || tr('Sin asignatura')}{' · '}{tr('Importancia {level}', { level: lowerFirst(priorityLabel(task.priority)) })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                    aria-label={tr('Ver «{name}» en Tareas', { name: task.name })}
                    title={tr('Ver en Tareas')}
                    onClick={() => onNavigate(`/tareas?highlightTaskId=${task.id}`)}
                  >
                    <ListTodo />
                  </Button>
                  {task.courseId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                      aria-label={tr('Ir a la asignatura de «{name}»', { name: task.name })}
                      title={tr('Ir a la asignatura')}
                      onClick={() => onNavigate(`/cursos/?id=${task.courseId}&highlightTaskId=${task.id}`)}
                    >
                      <BookOpen />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="space-y-2.5">
          <SectionLabel>{tr('Color de la casilla')}</SectionLabel>
          <div className="flex flex-wrap items-center gap-2.5" role="group" aria-label={tr('Color de la casilla')}>
            {PAINT_COLORS.map(({ hex, name }) => (
              <Swatch key={hex} color={hex} name={name} active={fill === hex} onClick={() => onPaint(hex)} />
            ))}
            <NoColorSwatch active={!fill} onClick={() => onPaint(null)} />
          </div>
        </section>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="fantasma" onClick={() => onCreate('evento')}>
            <CalendarPlus />
            {tr('Evento')}
          </Button>
          <Button variant="fantasma" onClick={() => onCreate('recordatorio')}>
            <BellPlus />
            {tr('Recordatorio')}
          </Button>
        </div>
      </div>
    </>
  );
}

export default function DayEventsDialog({
  panel,
  onPanelChange,
  todayKey,
  events,
  tasksOfDay,
  fillOf,
  onSave,
  onDelete,
  onPaint,
}: {
  panel: CalendarPanel | null;
  onPanelChange: (panel: CalendarPanel | null) => void;
  todayKey: string;
  events: LocalCalendarEvent[];
  tasksOfDay: (day: string) => Task[];
  /** Color con que se ve la casilla ('' = ninguno). */
  fillOf: (day: string) => string;
  onSave: (payload: Omit<LocalCalendarEvent, 'id'>, existing?: LocalCalendarEvent) => void;
  onDelete: (event: LocalCalendarEvent) => void;
  onPaint: (days: string[], color: string | null) => void;
}) {
  const router = useRouter();
  // Mientras el recuadro se desvanece al cerrar, sigue mostrando lo último.
  const lastPanel = useRef(panel);
  if (panel) lastPanel.current = panel;
  const shown = panel ?? lastPanel.current;

  const backTo = (day?: string): CalendarPanel | null => (day ? { view: 'day', day } : null);

  return (
    <Dialog open={!!panel} onOpenChange={(open) => !open && onPanelChange(null)}>
      <DialogContent
        className={cn('max-h-[88vh] overflow-y-auto', shown?.view === 'form' ? 'max-w-lg' : 'max-w-md')}
        {...(shown?.view === 'form' ? { 'aria-describedby': undefined } : {})}
      >
        {shown?.view === 'day' && (
          <DayView
            key={shown.day}
            day={shown.day}
            todayKey={todayKey}
            events={events}
            tasks={tasksOfDay(shown.day)}
            fill={fillOf(shown.day)}
            onEdit={(event) =>
              onPanelChange({
                view: 'form',
                event,
                range: { start: event.date, end: eventEnd(event) },
                back: shown.day,
              })
            }
            onDelete={onDelete}
            onCreate={(preset) =>
              onPanelChange({ view: 'form', range: { start: shown.day, end: shown.day }, preset, back: shown.day })
            }
            onPaint={(color) => onPaint([shown.day], color)}
            onNavigate={(href) => {
              onPanelChange(null);
              router.push(href);
            }}
          />
        )}

        {shown?.view === 'form' && (
          <LocalEventForm
            key={shown.event?.id ?? `${shown.range.start}_${shown.range.end}_${shown.preset ?? 'evento'}`}
            event={shown.event}
            range={shown.range}
            preset={shown.preset}
            todayKey={todayKey}
            onBack={shown.back ? () => onPanelChange(backTo(shown.back)) : undefined}
            onCancel={() => onPanelChange(backTo(shown.back))}
            onSubmit={(payload) => {
              onSave(payload, shown.event);
              onPanelChange(backTo(shown.back));
            }}
            onDelete={
              shown.event
                ? () => {
                    onDelete(shown.event!);
                    onPanelChange(backTo(shown.back));
                  }
                : undefined
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
