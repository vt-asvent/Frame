import { useMemo, useState } from 'react';
import { isToday, parseISO } from 'date-fns';
import { ArrowLeft, NotebookPen, Play, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Button } from '@/components/ui/button';
import NoteEditor from '@/components/temporizador/NoteEditor';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { SessionSubjectPicker } from '@/components/temporizador/SubjectPickCard';
import SessionNotesList, { SessionNotesHeading } from '@/components/temporizador/SessionNotesList';
import EchoWord from '@/components/shared/EchoWord';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { formatHMS } from '@/lib/duration';
import { isRichNoteEmpty } from '@/lib/rich-note';
import { useRouter } from '@/lib/navigation';
import type { InterruptedSession } from '@/types';
import { tr } from '@/lib/i18n';

// ============================================================
// Rescate de una sesión de estudio que se quedó a medias.
//
// Aparece al abrir Frame cuando la sesión anterior no llegó a registrarse:
// porque se aparcó a propósito, porque la app se cerró de golpe (una
// actualización, un cierre forzado, un corte de luz) o porque quedaron
// anotaciones sin sesión a la que pertenecer.
//
// Tres salidas, siempre: retomarla donde estaba, registrarla, o tirarla.
// Nunca una cuarta puerta cerrada — el fallo que arreglaba esto era
// exactamente ese: anotaciones huérfanas que no se podían ni registrar ni
// borrar, ahí clavadas para siempre.
//
// Descartar ARRASTRA las anotaciones. Antes se quedaban, y al no pertenecer
// ya a ninguna sesión no había manera de deshacerse de ellas.
//
// Registrar es el mismo formulario que «Sesión terminada»
// (finish-session-form.tsx): mismo eco de «SESIÓN», mismo enfoque que arranca
// en 0 y bloquea, mismo editor con formato y el mismo recorrido de tarjetas
// (colecciones → asignaturas → sus tareas), que también hace avanzar las
// tareas marcadas. Registrar una sesión rescatada y una recién terminada son
// el mismo acto. «Atrás» es la flecha de la esquina superior izquierda.
// ============================================================

interface InterruptedSessionManagerProps {
  session: InterruptedSession;
  onDone: () => void;
}

/** Qué se le cuenta al usuario según cómo se perdió la sesión. */
const EXPLANATION: Record<NonNullable<InterruptedSession['origin']> | 'default', string> = {
  get suspend() { return tr('Aparcaste esta sesión al cerrar Frame. Sigue tal cual la dejaste.'); },
  get live() { return tr('Frame se cerró con la sesión en marcha. Este es el tiempo guardado hasta el último segundo.'); },
  get unload() { return tr('La última vez cerraste Frame sin registrar tu sesión de estudio.'); },
  get notes() { return tr('Quedaron anotaciones de una sesión sin registrar. El tiempo sale de la última: duró al menos eso.'); },
  get default() { return tr('La última vez culminaste tu sesión de estudio sin registrarla.'); },
};

export default function InterruptedSessionManager({ session, onDone }: InterruptedSessionManagerProps) {
  const {
    addStudySession,
    applySessionProgressToTasks,
    clearSessionNotes,
    courses,
    sessionNotes,
    resumeInterruptedSession,
    advancedMode,
  } = useCourse();
  const router = useRouter();

  const [view, setView] = useState<'initial' | 'registering'>('initial');
  const [isDialogOpen, setIsDialogOpen] = useState(true);
  const [showConfirmDiscard, setShowConfirmDiscard] = useState(false);

  const [perception, setPerception] = useState(0);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  /** `InterruptedSession.duration` ya viene en segundos. */
  const studiedSeconds = Math.max(0, Math.round(session.duration));
  // Sin modo Avanzado (1.7.3), siempre como modo Tiempo: sin enfoque.
  const isRendimiento = advancedMode && session.selectionMode === 'rendimiento';
  const origin = session.origin ?? 'default';

  // Retomar exige tres cosas: que haya reloj guardado, que la sesión no sea
  // un puñado de anotaciones sueltas y que siga siendo el MISMO día. Una
  // sesión de ayer ya no es la misma jornada de estudio.
  const canResume = useMemo(() => {
    if (origin === 'notes' || session.timerTime === undefined) return false;
    const stamp = session.suspendedAt ?? session.updatedAt;
    if (!stamp) return false;
    try {
      const when = parseISO(stamp);
      return !Number.isNaN(when.getTime()) && isToday(when);
    } catch {
      return false;
    }
  }, [origin, session]);

  const needsFocus = isRendimiento && perception === 0;
  // Sin asignaturas creadas no hay nada que marcar: no se bloquea el registro.
  const needsSubject = (courses?.length ?? 0) > 0 && selectedSubjectIds.length === 0;

  const close = () => {
    setIsDialogOpen(false);
    onDone();
  };

  const handleResume = () => {
    resumeInterruptedSession(session);
    close();
    router.push('/temporizador');
  };

  /** Tirar la sesión se lleva también sus anotaciones: si se quedaran, no
   *  pertenecerían ya a nada y no habría forma de quitarlas. */
  const handleConfirmDiscard = () => {
    setShowConfirmDiscard(false);
    clearSessionNotes();
    close();
  };

  const handleSubmit = () => {
    if (needsSubject || needsFocus) return;
    const picked = courses.filter((c) => selectedSubjectIds.includes(c.id));
    // `addStudySession` se lleva consigo las anotaciones de la sesión: es
    // justamente lo que rescata el caso de las anotaciones huérfanas.
    addStudySession({
      durationSec: studiedSeconds,
      sessionType: session.timerMode === 'focus' ? 'Temporizador' : 'Cronómetro',
      perception: isRendimiento ? perception : 0,
      subjects: picked.map((c) => c.name),
      subjectIds: picked.map((c) => c.id),
      taskIds: selectedTaskIds,
      mode: isRendimiento ? 'rendimiento' : 'tiempo',
      notes: isRichNoteEmpty(notes) ? undefined : notes.trim(),
      // Cuándo ocurrió de verdad, no cuándo se rescata: así cuenta para el día
      // en que se estudió y no para hoy.
      endedAt: session.suspendedAt ?? session.updatedAt,
    });
    // Igual que al cerrar una sesión en Estudio: las tareas marcadas suben en
    // proporción duración de la sesión / tiempo estimado de cada una.
    applySessionProgressToTasks(selectedTaskIds, studiedSeconds / 60);
    close();
  };

  if (!isDialogOpen) return null;

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && setShowConfirmDiscard(true)}>
        <DialogContent
          className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"
          hideCloseButton
        >
          {/* «Atrás» (a las tres salidas): flecha en la esquina superior
              izquierda, nunca en el pie. */}
          {view === 'registering' && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setView('initial')}
              title={tr('Atrás')}
              aria-label={tr('Atrás: volver a las opciones')}
              className="absolute left-4 top-4 z-10 h-7 w-7 text-muted-foreground hover:bg-primary/10 hover:text-primary"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}

          {/* ---------- Cabecera fija ---------- */}
          <DialogHeader className="shrink-0 space-y-0 text-left sm:text-left">
            {/* Título y datos de la sesión, con «SESIÓN» a la deriva detrás. */}
            <div className="relative overflow-hidden px-6 pb-3 pt-5">
              <EchoWord word={tr('Sesión')} />
              <DialogTitle className="relative text-center text-lg font-bold tracking-wider text-primary">
                {canResume ? tr('Tu sesión sigue en pie') : tr('Una sesión sin registrar')}
              </DialogTitle>
              <DialogDescription className="relative pt-1 text-center text-xs leading-relaxed">
                {EXPLANATION[origin]}
              </DialogDescription>

              <div
                className={cn(
                  'relative grid items-center gap-4 pt-2',
                  view === 'registering' && isRendimiento ? 'sm:grid-cols-2' : 'grid-cols-1'
                )}
              >
                <div className="space-y-0.5 text-center">
                  <p className="text-[10px] text-muted-foreground">
                    {origin === 'notes' ? tr('Al menos') : tr('Tiempo estudiado')}
                  </p>
                  <p className="font-headline text-2xl font-bold tabular-nums text-primary">
                    {formatHMS(studiedSeconds)}
                  </p>
                </div>

                {view === 'registering' && isRendimiento && (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="recovered-perception"
                        className="text-[10px] text-muted-foreground"
                      >
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
                      id="recovered-perception"
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
                      {tr('Mueve la barra: sin enfoque no se puede registrar.')}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {(sessionNotes.length > 0 || view === 'registering') && (
              <div className="space-y-3 px-6 pb-4">
                {/* Lo que se anotó durante la sesión perdida. Es lo que
                    devuelve la memoria de qué se estaba haciendo. */}
                {sessionNotes.length > 0 && (
                  <div className="space-y-1.5">
                    <SessionNotesHeading count={sessionNotes.length} />
                    <div className="max-h-24 overflow-y-auto pr-1">
                      <SessionNotesList notes={sessionNotes} />
                    </div>
                  </div>
                )}

                {view === 'registering' && (
                  <div className="space-y-1">
                    <Label
                      id="recovered-notes-label"
                      htmlFor="recovered-notes"
                      onClick={() => document.getElementById('recovered-notes')?.focus()}
                      className="flex items-center gap-1.5 text-[10px] text-muted-foreground"
                    >
                      <NotebookPen className="h-3.5 w-3.5 text-primary" />
                      {tr('¿Qué hiciste?')}
                      <span className="text-muted-foreground/70">{tr('(opcional)')}</span>
                    </Label>
                    {/* Texto con formato y listas, como un Word en pequeño. */}
                    <NoteEditor
                      id="recovered-notes"
                      ariaLabelledBy="recovered-notes-label"
                      value={notes}
                      onChange={setNotes}
                      placeholder={tr('Resolví los ejercicios 12 al 20; me atasqué en la derivada de la cadena…')}
                      rows={3}
                      dense
                    />
                  </div>
                )}
              </div>
            )}
          </DialogHeader>

          {/* Divisoria con aire a ambos lados. */}
          <div aria-hidden className="mx-6 h-px shrink-0 bg-border" />

          {/* ---------- Cuerpo ---------- */}
          {view === 'initial' ? (
            <div className="flex flex-col gap-2 px-6 py-5">
              {canResume && (
                <Button onClick={handleResume}>
                  <Play className="h-4 w-4 fill-current" />
                  {tr('Retomar donde la dejaste')}
                </Button>
              )}
              {/* Con «Retomar» delante, registrar pasa a ser la secundaria. */}
              <Button variant={canResume ? 'fantasma' : 'default'} onClick={() => setView('registering')}>
                {canResume ? tr('Finalizarla y registrarla') : tr('Registrar esta sesión')}
              </Button>
              <Button variant="gris" onClick={() => setShowConfirmDiscard(true)}>
                <Trash2 className="h-4 w-4" />
                {tr('Descartarla')}
              </Button>
            </div>
          ) : (
            <>
              {/* ÚNICO carril de scroll: cabecera y pie quedan fijos. */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
                <SessionSubjectPicker
                  subjectIds={selectedSubjectIds}
                  taskIds={selectedTaskIds}
                  onChange={({ subjectIds, taskIds }) => {
                    setSelectedSubjectIds(subjectIds);
                    setSelectedTaskIds(taskIds);
                  }}
                />
              </div>

              {/* ---------- Pie fijo ---------- */}
              <div aria-hidden className="mx-6 h-px shrink-0 bg-border" />
              <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-3">
                <Button
                  type="button"
                  variant="gris"
                  size="sm"
                  className="text-xs"
                  onClick={() => setShowConfirmDiscard(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  {tr('Descartar')}
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
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={needsSubject || needsFocus}
                    className="min-w-[9rem]"
                  >
                    {tr('Registrar sesión')}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={showConfirmDiscard} onOpenChange={setShowConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Descartar esta sesión?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {sessionNotes.length === 0
                ? tr('Se tirarán los {time}. No contarán en tu tiempo de estudio ni en la calificación del día. Esta acción no se puede deshacer.', { time: formatHMS(studiedSeconds) })
                : sessionNotes.length === 1
                  ? tr('Se tirarán los {time} y la anotación que dejaste. No contarán en tu tiempo de estudio ni en la calificación del día. Esta acción no se puede deshacer.', { time: formatHMS(studiedSeconds) })
                  : tr('Se tirarán los {time} y las {length} anotaciones que dejaste. No contarán en tu tiempo de estudio ni en la calificación del día. Esta acción no se puede deshacer.', { time: formatHMS(studiedSeconds), length: sessionNotes.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Volver')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDiscard}
            >
              {tr('Descartar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
