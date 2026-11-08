import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { dayShort, dayTitle, fromSunday } from '@/lib/day-names';
import { tr } from '@/lib/i18n';
import { minutesOf, minutesOfDay, subjectColor, tidyClasses, timeOf, useNow, weekDays, type TimetableClass } from '@/lib/timetable';
import { cn } from '@/lib/utils';

// ============================================================
// Horario → «Semanal» (1.9.0): la semana como un calendario. Una columna por
// día (de lunes al último con clase, al menos hasta el viernes), las horas a
// la izquierda y cada clase como un bloque de su color. Clic en un bloque
// para corregirlo; clic en un hueco para añadir una clase a esa hora.
// ============================================================

const HOUR = 52; // px por hora

interface Placed {
  item: TimetableClass;
  index: number;
  lane: number;
  lanes: number;
}

/** Clases que se pisan, una al lado de la otra. */
function placeDay(classes: { item: TimetableClass; index: number }[]): Placed[] {
  const sorted = [...classes].sort((a, b) => minutesOf(a.item.start)! - minutesOf(b.item.start)!);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const placed of group) placed.lanes = ends.length;
    out.push(...group);
    group = [];
    ends = [];
  };
  for (const entry of sorted) {
    const start = minutesOf(entry.item.start)!;
    const end = minutesOf(entry.item.end)!;
    if (start >= groupEnd) close();
    let lane = ends.findIndex((laneEnd) => laneEnd <= start);
    if (lane < 0) lane = ends.push(end) - 1;
    else ends[lane] = end;
    group.push({ ...entry, lane, lanes: 1 });
    groupEnd = Math.max(groupEnd, end);
  }
  close();
  return out;
}

type Editing = { index: number | null; draft: TimetableClass };

export default function ScheduleWeek({ classes, onChange }: { classes: TimetableClass[]; onChange: (classes: TimetableClass[]) => void }) {
  const now = useNow(60_000);
  const [editing, setEditing] = useState<Editing | null>(null);
  const days = weekDays(classes);
  const today = fromSunday(new Date(now).getDay()) + 1;

  const { from, to } = useMemo(() => {
    if (classes.length === 0) return { from: 7 * 60, to: 14 * 60 };
    return {
      from: Math.floor(Math.min(...classes.map((item) => minutesOf(item.start)!)) / 60) * 60,
      to: Math.ceil(Math.max(...classes.map((item) => minutesOf(item.end)!)) / 60) * 60,
    };
  }, [classes]);
  const hours = Array.from({ length: (to - from) / 60 + 1 }, (_, index) => from + index * 60);
  const height = ((to - from) / 60) * HOUR;
  const nowMinutes = minutesOfDay(now);
  const y = (minutes: number) => ((minutes - from) / 60) * HOUR;

  const byDay = useMemo(() => {
    const map = new Map<number, Placed[]>();
    for (const day of weekDays(classes)) {
      map.set(
        day,
        placeDay(classes.map((item, index) => ({ item, index })).filter(({ item }) => item.day === day))
      );
    }
    return map;
  }, [classes]);

  const save = (draft: TimetableClass, index: number | null) => {
    const next = index == null ? [...classes, draft] : classes.map((item, position) => (position === index ? draft : item));
    onChange(tidyClasses(next));
    setEditing(null);
  };
  const remove = (index: number) => {
    onChange(classes.filter((_, position) => position !== index));
    setEditing(null);
  };
  const addAt = (day: number, minutes: number) => {
    const start = Math.max(0, Math.min(23 * 60, Math.floor(minutes / 30) * 30));
    setEditing({ index: null, draft: { day, start: timeOf(start).padStart(5, '0'), end: timeOf(start + 60).padStart(5, '0'), subject: '' } });
  };

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div className="min-w-[36rem]" style={{ display: 'grid', gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          {/* Encabezado: los días */}
          <div />
          {days.map((day) => (
            <div key={day} className="flex items-center justify-center pb-2">
              <span
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  day === today ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'
                )}
                title={dayTitle(day - 1)}
              >
                {dayShort(day - 1)}
              </span>
            </div>
          ))}

          {/* Horas */}
          <div className="relative" style={{ height }}>
            {hours.map((minutes) => (
              <span key={minutes} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground" style={{ top: y(minutes) }}>
                {timeOf(minutes)}
              </span>
            ))}
          </div>

          {/* Un día por columna */}
          {days.map((day) => (
            <div
              key={day}
              className={cn('relative cursor-copy border-l border-border/60', day === today && 'bg-primary/[0.04]')}
              style={{ height }}
              onClick={(event) => {
                if (event.target !== event.currentTarget) return;
                const box = event.currentTarget.getBoundingClientRect();
                addAt(day, from + ((event.clientY - box.top) / HOUR) * 60);
              }}
              title={tr('Clic en un hueco para añadir una clase')}
            >
              {hours.map((minutes) => (
                <div key={minutes} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border/50" style={{ top: y(minutes) }} />
              ))}
              {(byDay.get(day) ?? []).map(({ item, index, lane, lanes }) => {
                const start = minutesOf(item.start)!;
                const end = minutesOf(item.end)!;
                const color = subjectColor(item.subject);
                return (
                  <button
                    key={`${index}-${item.start}`}
                    type="button"
                    onClick={() => setEditing({ index, draft: { ...item } })}
                    className="absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{
                      top: y(start) + 1,
                      height: Math.max(18, y(end) - y(start) - 2),
                      left: `calc(${(lane / lanes) * 100}% + 2px)`,
                      width: `calc(${100 / lanes}% - 4px)`,
                      borderLeftColor: color,
                      background: `${color}2b`,
                    }}
                    title={`${item.subject} · ${timeOf(start)}–${timeOf(end)}${item.room ? ` · ${item.room}` : ''}${item.teacher ? ` · ${item.teacher}` : ''}`}
                  >
                    <p className="truncate text-xs font-semibold leading-tight text-foreground">{item.subject}</p>
                    {end - start >= 40 && (
                      <p className="truncate text-[10px] leading-tight text-muted-foreground">
                        {timeOf(start)}–{timeOf(end)}
                        {item.room ? ` · ${item.room}` : ''}
                      </p>
                    )}
                  </button>
                );
              })}
              {day === today && nowMinutes >= from && nowMinutes <= to && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-primary" style={{ top: y(nowMinutes) }}>
                  <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-primary" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted-foreground">{tr('Clic en una clase para corregirla, o en un hueco para añadir otra.')}</p>
        <Button variant="fantasma" size="sm" onClick={() => addAt(days.includes(today) ? today : 1, Math.max(from, 8 * 60))}>
          <Plus />
          {tr('Añadir clase')}
        </Button>
      </div>

      {editing && <ClassDialog editing={editing} onClose={() => setEditing(null)} onSave={save} onRemove={remove} />}
    </div>
  );
}

function ClassDialog({
  editing,
  onClose,
  onSave,
  onRemove,
}: {
  editing: Editing;
  onClose: () => void;
  onSave: (draft: TimetableClass, index: number | null) => void;
  onRemove: (index: number) => void;
}) {
  const [draft, setDraft] = useState<TimetableClass>(editing.draft);
  const [confirming, setConfirming] = useState(false);
  const start = minutesOf(draft.start);
  const end = minutesOf(draft.end);
  const problem = !draft.subject.trim()
    ? tr('Escribe la asignatura.')
    : start == null || end == null || end <= start
      ? tr('La clase debe terminar después de empezar.')
      : '';
  const set = (patch: Partial<TimetableClass>) => setDraft((value) => ({ ...value, ...patch }));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{editing.index == null ? tr('Añadir clase') : tr('Editar clase')}</DialogTitle>
          <DialogDescription>{tr('Los cambios se guardan en este horario y llegan a tus otros dispositivos.')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!problem) onSave({ ...draft, subject: draft.subject.trim(), room: draft.room?.trim() || undefined, teacher: draft.teacher?.trim() || undefined }, editing.index);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="clase-asignatura">{tr('Asignatura')}</Label>
            <Input id="clase-asignatura" autoFocus value={draft.subject} maxLength={80} onChange={(event) => set({ subject: event.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label>{tr('Día')}</Label>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => set({ day })}
                  className={cn(
                    'h-8 min-w-[2.75rem] rounded-full border px-2 text-xs font-medium transition-colors',
                    draft.day === day ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted'
                  )}
                  aria-pressed={draft.day === day}
                  title={dayTitle(day - 1)}
                >
                  {dayShort(day - 1)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clase-inicio">{tr('Empieza')}</Label>
              <Input id="clase-inicio" type="time" step={300} value={draft.start} onChange={(event) => set({ start: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clase-fin">{tr('Termina')}</Label>
              <Input id="clase-fin" type="time" step={300} value={draft.end} onChange={(event) => set({ end: event.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="clase-aula">{tr('Aula')}</Label>
              <Input id="clase-aula" value={draft.room ?? ''} maxLength={40} placeholder={tr('Opcional')} onChange={(event) => set({ room: event.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clase-docente">{tr('Docente')}</Label>
              <Input id="clase-docente" value={draft.teacher ?? ''} maxLength={60} placeholder={tr('Opcional')} onChange={(event) => set({ teacher: event.target.value })} />
            </div>
          </div>
          {problem && draft.subject && <p className="text-xs text-destructive">{problem}</p>}
          <DialogFooter className="gap-2 sm:justify-between">
            {editing.index != null ? (
              confirming ? (
                <Button type="button" variant="destructive" onClick={() => onRemove(editing.index!)}>
                  {tr('Sí, quitar la clase')}
                </Button>
              ) : (
                <Button type="button" variant="gris" onClick={() => setConfirming(true)}>
                  {tr('Quitar')}
                </Button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button type="button" variant="gris" onClick={onClose}>
                {tr('Cancelar')}
              </Button>
              <Button type="submit" disabled={!!problem}>
                {tr('Guardar')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
