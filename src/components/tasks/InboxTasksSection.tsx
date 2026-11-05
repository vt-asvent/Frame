import { useMemo, useState } from 'react';
import { Inbox, Layers } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import SubjectPicker from '@/components/courses/SubjectPicker';
import { TaskCard } from '@/components/tasks/TaskCard';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import type { Task } from '@/types';
import EchoWord from '@/components/shared/EchoWord';
import { tr } from '@/lib/i18n';

// ============================================================
// Bandeja de tareas sin asignatura (final de Inicio).
//
// Aquí aterriza lo que se apuntó en caliente con el botón «+» de la barra sin
// decidir la asignatura. No es un cajón de sastre: es el precio de que
// apuntar sea instantáneo, y por eso está a la vista al final de Inicio en
// lugar de escondido, con el botón para colocar cada tarea donde toca.
//
// Cuando no queda ninguna, la sección desaparece entera.
// ============================================================

function AssignDialog({
  task,
  onClose,
}: {
  task: Task | null;
  onClose: () => void;
}) {
  const { courses, updateTask } = useCourse();
  const { toast } = useToast();
  const [courseId, setCourseId] = useState<string | null>(null);

  const course = useMemo(() => courses.find((c) => c.id === courseId), [courses, courseId]);

  const assign = () => {
    if (!task || !course) return;
    updateTask(task.id, { courseId: course.id, courseName: course.name });
    toast({
      title: tr('Tarea colocada'),
      description: tr('«{name}» ya pertenece a {name2}.', { name: task.name, name2: course.name }),
    });
    onClose();
  };

  return (
    <Dialog
      open={Boolean(task)}
      onOpenChange={(open) => {
        if (!open) {
          setCourseId(null);
          onClose();
        }
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-6 relative overflow-hidden">
          <EchoWord word={tr('Colocar')} />
          <DialogTitle className="text-center text-lg font-bold text-primary">
            {tr('Colocar en una asignatura')}
          </DialogTitle>
          <DialogDescription className="text-center text-xs">
            {task ? `«${task.name}»` : ''}
          </DialogDescription>
        </DialogHeader>
        <div aria-hidden className="mx-6 h-px shrink-0 bg-border" />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <SubjectPicker value={courseId} onChange={setCourseId} />
        </div>

        <DialogFooter className="shrink-0 border-t px-6 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {tr('Cancelar')}
          </Button>
          <Button size="sm" onClick={assign} disabled={!course}>
            {tr('Colocar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function InboxTasksSection() {
  const { tasks } = useCourse();
  const [assigning, setAssigning] = useState<Task | null>(null);

  const loose = useMemo(
    () => (tasks ?? []).filter((task) => !task.courseId),
    [tasks]
  );

  if (loose.length === 0) return null;

  return (
    <div className="space-y-4">
      <Separator />

      <div className="flex flex-wrap items-center justify-center gap-2 text-center">
        <Inbox className="h-5 w-5 text-primary" />
        <h2 className="font-headline text-lg font-bold text-foreground">{tr('Sin asignatura')}</h2>
        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold text-primary">
          {loose.length}
        </span>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {tr('Apuntadas en caliente desde la barra superior. Edítalas aquí mismo y colócalas en su asignatura cuando sepas cuál es.')}
      </p>

      {/* Cada tarjeta, la mitad del ancho (1.7.3; antes, un tercio). A media
          pantalla, una sola columna: dos quedarían en ~230 px. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loose.map((task) => (
          <div key={task.id} className="space-y-2">
            <TaskCard task={task} isDragDisabled />
            <Button
              variant="outline"
              size="sm"
              className="w-full border-primary/50 text-xs text-primary hover:bg-primary/10 hover:text-primary"
              onClick={() => setAssigning(task)}
            >
              <Layers className="mr-2 h-3.5 w-3.5" />
              {tr('Colocar en una asignatura')}
            </Button>
          </div>
        ))}
      </div>

      <AssignDialog key={assigning?.id ?? 'none'} task={assigning} onClose={() => setAssigning(null)} />
    </div>
  );
}
