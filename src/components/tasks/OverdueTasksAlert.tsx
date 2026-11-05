import { useEffect, useMemo, useState } from 'react';
import { useTodayKey } from '@/hooks/use-today';
import { AlertTriangle, CalendarClock, CheckCircle2, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useCourse } from '@/context/CourseContext';
import { format, parseISO, startOfDay } from 'date-fns';
import { EchoHeader } from '@/components/shared/EchoWord';
import { dateLocale, tr } from '@/lib/i18n';

// ============================================================
// Alerta de tareas VENCIDAS: cuando una tarea pasó su fecha de entrega, al
// abrir la app se pide decidir qué hacer con cada una:
//   · Reprogramar — nueva fecha límite (calendario emergente).
//   · Culminada  — se completa y pasa a Archivados.
//   · Eliminar   — se descarta SIN archivar (removeTask).
// Se muestra máximo una vez al día (se puede posponer con "Más tarde").
// ============================================================

const SNOOZE_KEY = 'overdueAlertSnoozedOn';

export default function OverdueTasksAlert() {
  const { tasks, userProfile, updateTask, deleteTask, removeTask, advancedMode } = useCourse();
  const [isOpen, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const todayKey = useTodayKey();
  const overdue = useMemo(() => {
    void todayKey; // dependencia: «vencida» se recalcula al cambiar de día
    const today = startOfDay(new Date()).getTime();
    return (tasks ?? [])
      .filter((t) => {
        if (!t.dueDate) return false;
        try {
          return startOfDay(parseISO(t.dueDate)).getTime() < today;
        } catch {
          return false;
        }
      })
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  }, [tasks, todayKey]);

  // Abre una vez al día si hay vencidas (tras cargar los datos del usuario).
  useEffect(() => {
    if (!userProfile || dismissed || overdue.length === 0) return;
    const todayStr = new Date().toDateString();
    if (localStorage.getItem(`${SNOOZE_KEY}_${userProfile.id}`) === todayStr) return;
    const timer = setTimeout(() => setOpen(true), 2500);
    return () => clearTimeout(timer);
  }, [userProfile, overdue.length, dismissed]);

  // Si el usuario resolvió todas, se cierra sola.
  useEffect(() => {
    if (isOpen && overdue.length === 0) setOpen(false);
  }, [isOpen, overdue.length]);

  const snooze = () => {
    if (userProfile) {
      localStorage.setItem(`${SNOOZE_KEY}_${userProfile.id}`, new Date().toDateString());
    }
    setDismissed(true);
    setOpen(false);
  };

  if (overdue.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && snooze()}>
      <DialogContent className="max-w-lg">
        <EchoHeader word={tr('Vencidas')}>
          <DialogHeader>
            <DialogTitle className="flex items-center justify-center gap-2 text-xl font-bold text-primary">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {tr('Tareas vencidas')}
            </DialogTitle>
            <DialogDescription className="text-center text-xs">
              {overdue.length === 1
                ? tr('Una tarea pasó su fecha de entrega. Decide qué hacer con ella:')
                : tr('{length} tareas pasaron su fecha de entrega. Decide qué hacer con cada una:', { length: overdue.length })}
            </DialogDescription>
          </DialogHeader>
        </EchoHeader>

        <ScrollArea className="[&>[data-radix-scroll-area-viewport]]:max-h-[340px]">
          <div className="space-y-3 pr-3">
            {overdue.map((task, i) => (
              <div key={task.id}>
                <div className="rounded-md border border-border/60 p-3">
                  <p className="truncate text-sm font-semibold text-foreground">{task.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {task.courseName ? `${task.courseName} · ` : ''}{tr('vencía el')}{' '}
                    {format(parseISO(task.dueDate!), tr('d \'de\' MMMM'), { locale: dateLocale() })}{advancedMode ? ` · ${task.progress || 0}%` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button size="sm" variant="outline" className="h-7 text-[11px] border-primary bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary">
                          <CalendarClock className="mr-1 h-3 w-3" />{' '}{tr('Reprogramar')}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          selected={undefined}
                          onSelect={(date) => {
                            if (date) updateTask(task.id, { dueDate: (date as Date).toISOString() });
                          }}
                        />
                      </PopoverContent>
                    </Popover>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] text-green-500 hover:text-green-500"
                      onClick={() => deleteTask(task.id)}
                    >
                      <CheckCircle2 className="mr-1 h-3 w-3" />{' '}{tr('Culminada')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px] text-red-400 hover:text-red-400"
                      onClick={() => removeTask(task.id)}
                    >
                      <Trash2 className="mr-1 h-3 w-3" />{' '}{tr('Eliminar')}
                    </Button>
                  </div>
                </div>
                {i < overdue.length - 1 && <Separator className="my-3" />}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={snooze}>
            {tr('Más tarde')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
