import { useState } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { setSubjectLinks } from '@/lib/timetable-links';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Horario → «¿De qué asignatura son estas clases?» (1.9.3, Diego).
//
// Solo aparece al terminar de leer una foto, y solo con los nombres que ni el
// parecido ni la IA supieron vincular con una asignatura de Frame. Una fila por
// nombre: a la izquierda como viene en el horario, a la derecha la asignatura.
// Lo que se deja en «Ninguna» no se vuelve a preguntar (se cambia tocando su
// tarjeta en el Horario).
// ============================================================

interface Props {
  uid: string;
  /** Los nombres del horario sin asignatura, como están escritos. */
  subjects: string[];
  courses: readonly { id: string; name: string }[];
  onClose: () => void;
}

export default function ScheduleLinkDialog({ uid, subjects, courses, onClose }: Props) {
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const save = () => {
    setSubjectLinks(uid, subjects.map((subject) => [subject, chosen[subject] || null] as const));
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr('¿De qué asignatura son estas clases?')}</DialogTitle>
          <DialogDescription>{tr('Frame no reconoció estos nombres de tu horario. Elige su asignatura y verás su imagen en el Horario.')}</DialogDescription>
        </DialogHeader>
        <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {subjects.map((subject) => {
            const course = courses.find((item) => item.id === chosen[subject]);
            return (
              <li key={subject} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                <span className="truncate text-sm font-medium" title={subject}>
                  {subject}
                </span>
                <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        course ? 'border-primary/50 text-foreground' : 'border-border text-muted-foreground'
                      )}
                    >
                      <span className="truncate">{course?.name ?? tr('Ninguna')}</span>
                      <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-72 min-w-[13rem] max-w-[18rem] overflow-y-auto">
                    {courses.map((option) => (
                      <DropdownMenuItem key={option.id} onSelect={() => setChosen((current) => ({ ...current, [subject]: option.id }))}>
                        <Check className={cn('mr-2 h-4 w-4 shrink-0', option.id === course?.id ? 'opacity-100' : 'opacity-0')} />
                        <span className="truncate">{option.name}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setChosen((current) => ({ ...current, [subject]: '' }))}>
                      <Check className={cn('mr-2 h-4 w-4 shrink-0', course ? 'opacity-0' : 'opacity-100')} />
                      {tr('Ninguna')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </li>
            );
          })}
        </ul>
        <DialogFooter className="gap-2">
          <Button variant="gris" onClick={onClose}>
            {tr('Ahora no')}
          </Button>
          <Button onClick={save}>{tr('Guardar')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
