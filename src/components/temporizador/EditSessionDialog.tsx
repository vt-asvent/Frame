import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { Clock, Lock, NotebookPen } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import NoteEditor from '@/components/temporizador/NoteEditor';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { SubjectMultiPicker } from '@/components/courses/SubjectPicker';
import EchoWord from '@/components/shared/EchoWord';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { formatHMS, sessionSeconds } from '@/lib/duration';
import { isSessionEditable } from '@/lib/session-edit';
import type { StudySession } from '@/types';
import { dateLocale, tr } from '@/lib/i18n';
import { sessionTypeLabel } from '@/lib/enum-labels';

// ============================================================
// Corregir una sesión YA registrada, el mismo día.
//
// Uno se equivoca al cerrar el reloj: marca el enfoque de memoria, olvida una
// asignatura, escribe la anotación con prisa. Reabrirlo unas horas después,
// con la cabeza fría, es lo que vuelve fiel al registro.
//
// Lo que NO se puede tocar y por qué:
//   · La DURACIÓN la mide el reloj. Es el único dato de la sesión que no
//     depende de la memoria de nadie; si se pudiera escribir a mano, las
//     métricas dejarían de medir y pasarían a ser un deseo.
//   · El AVANCE DE TAREAS que la sesión aplicó ya está sumado en cada tarea,
//     donde se corrige con su propio control. Deshacerlo desde aquí tendría
//     que adivinar qué parte de ese porcentaje vino de esta sesión.
//
// A partir del día siguiente no se abre: ver `isSessionEditable`.
//
// Las asignaturas se marcan con las tarjetas de siempre y el mismo recorrido
// que en el resto de la app: colecciones primero, luego sus asignaturas (o
// la búsqueda directa). Un único carril de scroll, como el cierre de sesión.
// ============================================================

export default function EditSessionDialog({
  session,
  onClose,
}: {
  /** Sesión a corregir; `null` cierra el diálogo. */
  session: StudySession | null;
  onClose: () => void;
}) {
  const { courses, updateStudySession, advancedMode } = useCourse();

  const [perception, setPerception] = useState(0);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Sin modo Avanzado el enfoque no se pide ni se ve; el guardado de la
  // sesión no se toca (se reenvía el mismo valor).
  const isRendimiento = advancedMode && session?.mode === 'rendimiento';

  // Cada apertura parte de lo que la sesión tiene guardado, no de un
  // formulario en blanco: corregir es retocar, no volver a rellenar.
  useEffect(() => {
    if (!session) return;
    setPerception(session.perception ?? 0);
    setNotes(session.notes ?? '');
    // Las sesiones antiguas guardaban solo los NOMBRES de las asignaturas; se
    // reconstruyen los ids por nombre para que también se puedan corregir.
    const ids = session.subjectIds?.length
      ? session.subjectIds
      : (session.subjects ?? [])
          .map((name) => courses.find((c) => c.name === name)?.id)
          .filter((id): id is string => Boolean(id));
    // Una asignatura ya borrada no se puede volver a marcar: no se cuenta.
    setSelectedSubjectIds(ids.filter((id) => courses.some((c) => c.id === id)));
    // Solo al cambiar de sesión: `courses` se recrea en cada sincronización.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  if (!session) return null;

  // Cinturón y tirantes: si el diálogo se quedó abierto al cruzar la
  // medianoche, deja de poder guardar.
  const editable = isSessionEditable(session);
  const needsFocus = isRendimiento && perception === 0;
  // Sin asignaturas creadas no hay nada que marcar: no se bloquea el registro.
  const needsSubject = (courses?.length ?? 0) > 0 && selectedSubjectIds.length === 0;
  const blocked = !editable || needsFocus || needsSubject;

  const save = () => {
    if (blocked) return;
    const picked = courses.filter((c) => selectedSubjectIds.includes(c.id));
    const ok = updateStudySession(session.id, {
      perception,
      subjects: picked.map((c) => c.name),
      subjectIds: picked.map((c) => c.id),
      notes,
    });
    if (ok) onClose();
  };

  const started = (() => {
    try {
      return format(parseISO(session.startTime), 'HH:mm', { locale: dateLocale() });
    } catch {
      return null;
    }
  })();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button]:h-5 [&>button]:w-5 [&>button]:text-foreground">
        {/* ---------- Cabecera fija ---------- */}
        <DialogHeader className="shrink-0 space-y-0 px-5 pb-3 pt-5">
          {/* «CORREGIR», a la deriva detrás del título. */}
          <div className="relative -mx-5 -mt-5 overflow-hidden px-5 pb-2 pt-5">
            <EchoWord word={tr('Corregir')} />
            <DialogTitle className="relative text-center text-lg font-bold tracking-wider text-primary">
              {tr('Corregir sesión')}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {tr('Corrige el enfoque, las asignaturas y la anotación de una sesión de hoy.')}
            </DialogDescription>
          </div>

          <div className={cn('grid items-center gap-4 pt-2', isRendimiento ? 'sm:grid-cols-2' : 'grid-cols-1')}>
            <div className="space-y-0.5 text-center">
              <p
                className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground"
                title={tr('Lo mide el reloj: no se edita')}
              >
                {tr('Tiempo estudiado')}
                <Lock className="h-3 w-3" />
              </p>
              <p className="font-headline text-2xl font-bold tabular-nums text-primary">
                {formatHMS(sessionSeconds(session))}
              </p>
              {started && (
                <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {sessionTypeLabel(session.sessionType)} · {started}
                </p>
              )}
            </div>

            {isRendimiento && (
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="edit-perception" className="text-[10px] text-muted-foreground">
                    {tr('Nivel de enfoque')}
                  </Label>
                  <span
                    className={cn(
                      'w-8 rounded-md text-center text-xs font-semibold tabular-nums transition-colors',
                      needsFocus
                        ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                        : 'bg-primary/20 text-primary'
                    )}
                  >
                    {perception}
                  </span>
                </div>
                <Slider
                  id="edit-perception"
                  min={0}
                  max={20}
                  step={1}
                  value={[perception]}
                  onValueChange={(value) => setPerception(value[0])}
                  className="mt-2"
                />
                <p
                  className={cn(
                    'mt-1.5 text-[10px] leading-tight transition-colors',
                    needsFocus ? 'text-amber-600 dark:text-amber-400' : 'text-transparent'
                  )}
                >
                  {tr('Mueve la barra: sin enfoque no se puede guardar.')}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1 pt-3 text-left">
            {/* El editor es un `contentEditable`: el `htmlFor` no lo enfoca solo. */}
            <Label
              id="edit-session-notes-label"
              htmlFor="edit-session-notes"
              onClick={() => document.getElementById('edit-session-notes')?.focus()}
              className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
            >
              <NotebookPen className="h-3.5 w-3.5 text-primary" />
              {tr('¿Qué hiciste?')}
              <span className="text-muted-foreground/70">{tr('(opcional)')}</span>
            </Label>
            {/* El mismo editor con formato del cierre de sesión. */}
            <NoteEditor
              id="edit-session-notes"
              ariaLabelledBy="edit-session-notes-label"
              value={notes}
              onChange={setNotes}
              placeholder={tr('Resolví los ejercicios 12 al 20; me atasqué en la derivada de la cadena…')}
              rows={3}
              dense
            />
          </div>
        </DialogHeader>
        <div className="mx-5 h-px shrink-0 bg-border" />

        {/* ---------- Cuerpo: ÚNICO carril de scroll ---------- */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Tarjetas: colecciones primero, luego sus asignaturas. */}
          <SubjectMultiPicker
            values={selectedSubjectIds}
            onChange={setSelectedSubjectIds}
            title={tr('¿Qué estudiaste?')}
          />
        </div>

        {/* ---------- Pie fijo ---------- */}
        <div className="mx-5 h-px shrink-0 bg-border" />
        <div className="flex shrink-0 items-center justify-between gap-3 px-5 py-3">
          <Button type="button" variant="gris" size="sm" className="text-xs" onClick={onClose}>
            {tr('Cancelar')}
          </Button>

          <div className="flex items-center gap-3">
            {(needsFocus || needsSubject) && (
              <span className="text-right text-[10px] leading-tight text-amber-600 dark:text-amber-400">
                {needsFocus && needsSubject
                  ? tr('Falta el enfoque y la asignatura')
                  : needsFocus
                    ? tr('Falta marcar tu enfoque')
                    : tr('Falta marcar la asignatura')}
              </span>
            )}
            <Button type="button" size="sm" onClick={save} disabled={blocked} className="min-w-[9rem]">
              {tr('Guardar cambios')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
