import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, ListChecks, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
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
import EchoWord from '@/components/shared/EchoWord';
import { SessionCover, useCourseImages } from '@/components/temporizador/SessionCard';
import { useCardImageStyle } from '@/lib/card-image-height';
import RichNoteView from '@/components/temporizador/RichNoteView';
import SessionNotesList, { SessionNotesHeading } from '@/components/temporizador/SessionNotesList';
import { sessionHasFocus, sessionRange, sessionSubjects } from '@/components/temporizador/session-info';
import { useCourse } from '@/context/CourseContext';
import { formatDurationLabel, sessionSeconds } from '@/lib/duration';
import { isSessionEditable } from '@/lib/session-edit';
import { isRichNoteEmpty } from '@/lib/rich-note';
import { cn } from '@/lib/utils';
import type { DailyPerformance, StudySession } from '@/types';
import { dateLocale, tr } from '@/lib/i18n';
import { sessionTypeLabel } from '@/lib/enum-labels';

// ============================================================
// El detalle de UNA sesión de estudio: lo que la tarjeta resume, entero.
//
// La portada de la asignatura de extremo a extremo (con la proporción elegida
// en Asignaturas) y, debajo, tres tercios exactos separados por líneas finas
// (1.6.7, Diego): la duración (la unidad mayor en grande, el resto debajo) ·
// el rendimiento con su nota a la derecha y su barra, y la nota del día · el
// horario y el tipo de reloj. Las anotaciones, en su propio recuadro, y las
// tareas que avanzó la sesión.
//
// Se usa de dos formas: como ventana propia (Métricas de hoy) y como vista
// dentro del recuadro de un día del calendario, que la muestra en su lugar
// con la flecha de volver arriba a la izquierda: un solo recuadro cada vez.
// En las dos, corregir y eliminar solo existen para las sesiones de hoy
// (session-edit.ts): las de un día pasado no los ofrecen.
// ============================================================

/** La duración con su unidad mayor en grande: «2 h» sobre «15 min 08 s», o «25 min» sobre «40 s». */
function DurationFigure({ seconds }: { seconds: number }) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const big = h > 0 ? `${h} h` : m > 0 ? `${m} min` : `${s} s`;
  const small = h > 0 ? `${m} min ${String(s).padStart(2, '0')} s` : m > 0 ? `${s} s` : null;
  return (
    <div className="leading-none">
      <p className="font-headline text-3xl font-bold tabular-nums text-foreground">{big}</p>
      {small && <p className="mt-1.5 text-sm font-semibold tabular-nums text-muted-foreground">{small}</p>}
    </div>
  );
}

const dayKeyOf = (iso: string): string | null => {
  try {
    return format(parseISO(iso), 'yyyy-MM-dd');
  } catch {
    return null;
  }
};

/** Título de sección, con la forma de «Avances anotados». */
function SectionHeading({ icon: Icon, children }: { icon: typeof NotebookPen; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-primary" />
      {children}
    </p>
  );
}

export function SessionDetailView({
  session,
  dayPerformance,
  onBack,
  onEdit,
  onDelete,
}: {
  session: StudySession;
  /** Calificación del día de la sesión, si la tiene. */
  dayPerformance?: DailyPerformance | null;
  /** Con él aparece la flecha de volver (al recuadro del día). */
  onBack?: () => void;
  onEdit?: (session: StudySession) => void;
  onDelete?: (id: string) => void;
}) {
  const { courses, spaces, tasks, archivedTasks, studySessions, advancedMode } = useCourse();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const seconds = sessionSeconds(session);
  const range = sessionRange(session);
  const hasFocus = advancedMode && sessionHasFocus(session);
  const editable = isSessionEditable(session);

  const subjects = useMemo(() => sessionSubjects(session, courses ?? []), [session, courses]);
  const images = useCourseImages(subjects.map((subject) => subject.course?.id ?? null));
  // La portada guarda la proporción elegida en Asignaturas (1.6.6).
  const imageStyle = useCardImageStyle();

  /** Colección de cada asignatura (la primera en la que aparece). */
  const collectionOf = (courseId: string | undefined): string | null =>
    courseId ? (spaces ?? []).find((space) => space.courseIds.includes(courseId))?.name ?? null : null;

  /** Tareas avanzadas, estén pendientes o ya archivadas. */
  const advanced = useMemo(() => {
    const names = new Map<string, string>();
    for (const task of tasks ?? []) names.set(task.id, task.name);
    for (const task of archivedTasks ?? []) names.set(task.id, task.name);
    return (session.taskIds ?? [])
      .map((id) => names.get(id))
      .filter((name): name is string => Boolean(name));
  }, [session.taskIds, tasks, archivedTasks]);

  /** Lugar de la sesión en su día y lo que la jornada llevaba al cerrarla. */
  const dayContext = useMemo(() => {
    const key = dayKeyOf(session.startTime);
    if (!key) return null;
    const sameDay = (studySessions ?? [])
      .filter((s) => dayKeyOf(s.startTime) === key)
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    const index = sameDay.findIndex((s) => s.id === session.id);
    if (index < 0) return null;
    const running = sameDay.slice(0, index + 1).reduce((acc, s) => acc + sessionSeconds(s), 0);
    return { order: index + 1, total: sameDay.length, running };
  }, [studySessions, session.id, session.startTime]);

  const dateLabel = (() => {
    try {
      // Solo la fecha: el horario va en las cifras, sin repetirlo aquí.
      return format(parseISO(session.startTime), tr('EEEE d \'de\' MMMM'), { locale: dateLocale() });
    } catch {
      return '';
    }
  })();

  const subjectNames = subjects.length > 0 ? subjects.map((subject) => subject.name).join(' · ') : tr('Sin asignatura');
  const collections = [
    ...new Set(subjects.map((subject) => collectionOf(subject.course?.id)).filter((name): name is string => Boolean(name))),
  ].join(' · ');

  // Una anotación con solo una viñeta vacía o marcas sueltas no dice nada.
  const notes = isRichNoteEmpty(session.notes ?? '') ? '' : session.notes ?? '';
  const progress = session.progressNotes ?? [];
  const canEdit = editable && Boolean(onEdit);
  const canDelete = editable && Boolean(onDelete);

  return (
    <>
      {/* ---------- Cabecera: eco, flecha de volver y fecha ---------- */}
      <div className="relative shrink-0 overflow-hidden px-6 pb-4 pt-6">
        <EchoWord word={tr('Sesión')} />
        {onBack && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-2.5 top-2.5 h-7 w-7 text-foreground hover:text-primary"
            onClick={onBack}
            // La tarjeta pulsada desaparece al cambiar de vista: el foco
            // pasa aquí en lugar de perderse.
            autoFocus
            title={tr('Volver al día')}
            aria-label={tr('Volver al día')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <DialogTitle className="relative text-center text-lg font-bold text-primary">{tr('Sesión de estudio')}</DialogTitle>
        <DialogDescription className="relative mt-1 text-center text-xs text-muted-foreground first-letter:uppercase">
          {dateLabel}
        </DialogDescription>
      </div>
      <div className="mx-6 h-px shrink-0 bg-border" />

      {/* ---------- Cuerpo: único carril de scroll ---------- */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* La portada de la asignatura, de extremo a extremo y con la
            proporción elegida en Asignaturas. Se funde hacia abajo con el fondo del
            recuadro; encima, el nombre centrado y su colección. */}
        <div className="relative" style={imageStyle}>
          <SessionCover images={images} active={0} split className="h-full w-full" />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 px-6 pb-2 text-center">
            <p className="truncate font-headline text-lg font-bold text-primary" title={subjectNames}>
              {subjectNames}
            </p>
            {collections && <p className="truncate text-xs text-muted-foreground">{collections}</p>}
          </div>
        </div>

        <div className="space-y-5 px-6 pb-5 pt-4">
          {/* Tres tercios exactos, con una línea fina entre cada uno. */}
          <div className={cn('grid divide-x divide-border', advancedMode ? 'grid-cols-3' : 'grid-cols-2')}>
            <div className="flex min-w-0 flex-col items-center justify-center px-3 text-center">
              <DurationFigure seconds={seconds} />
              <p className="mt-2 text-[11px] text-muted-foreground">
                {dayContext && dayContext.total > 1
                  ? tr('Sesión {order} de {total} del día', { order: dayContext.order, total: dayContext.total })
                  : tr('Duración')}
              </p>
            </div>

            {/* Rendimiento y nota del día: modo Avanzado. */}
            {advancedMode && (
            <div className="flex min-w-0 flex-col justify-center gap-3 px-4">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">{tr('Rendimiento')}</p>
                  {hasFocus ? (
                    <p className="text-sm font-bold tabular-nums text-primary">
                      {session.perception}
                      <span className="text-[10px] font-semibold text-muted-foreground">/20</span>
                    </p>
                  ) : (
                    <p className="text-xs font-semibold text-muted-foreground">{tr('Sin calificar')}</p>
                  )}
                </div>
                {hasFocus && (
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, (session.perception / 20) * 100))}%` }}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">{tr('Nota del día')}</p>
                <p className="text-sm font-bold tabular-nums text-primary">
                  {dayPerformance ? `${dayPerformance.score.toFixed(1)} ${dayPerformance.grade}` : '—'}
                </p>
              </div>
            </div>
            )}

            <dl className="flex min-w-0 flex-col justify-center gap-3 px-4 text-xs">
              <div>
                <dt className="text-[11px] text-muted-foreground">{tr('Horario')}</dt>
                <dd className="text-sm font-semibold tabular-nums text-foreground">
                  {range ? `${format(range.start, 'HH:mm')} – ${format(range.end, 'HH:mm')}` : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">{tr('Reloj')}</dt>
                <dd className="text-sm font-semibold text-foreground">{sessionTypeLabel(session.sessionType)}</dd>
              </div>
            </dl>
          </div>

          {/* Las anotaciones, dentro de su propio recuadro. */}
          <div className="space-y-3 rounded-lg border border-border/70 bg-muted/30 p-3">
            <SectionHeading icon={NotebookPen}>{tr('Anotaciones')}</SectionHeading>
            {notes && <RichNoteView text={notes} className="text-sm leading-relaxed text-foreground" />}
            {/* Lo anotado DURANTE la sesión, con el minuto en que se escribió. */}
            {progress.length > 0 && (
              <div className="space-y-1.5">
                <SessionNotesHeading count={progress.length} />
                <SessionNotesList notes={progress} />
              </div>
            )}
            {!notes && progress.length === 0 && (
              <p className="text-xs text-muted-foreground">{tr('Sin anotaciones en esta sesión.')}</p>
            )}
          </div>

          {advanced.length > 0 && (
            <div className="space-y-1.5">
              <SectionHeading icon={ListChecks}>{tr('Tareas avanzadas')}</SectionHeading>
              <ul className="space-y-1 text-xs text-foreground">
                {advanced.map((name, index) => (
                  <li key={`${name}-${index}`} className="flex items-start gap-2">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                    <span className="min-w-0">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ---------- Pie: solo mientras la sesión es corregible (hoy) ---------- */}
      {(canEdit || canDelete) && (
        <>
          <div className="mx-6 h-px shrink-0 bg-border" />
          <div className={cn('flex shrink-0 items-center gap-3 px-6 py-3', canDelete ? 'justify-between' : 'justify-end')}>
            {canDelete && (
              <Button type="button" variant="gris" size="sm" className="gap-1.5" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-3.5 w-3.5" />
                {tr('Eliminar')}
              </Button>
            )}
            {canEdit && (
              <Button type="button" variant="fantasma" size="sm" className="gap-1.5" onClick={() => onEdit?.(session)}>
                <Pencil className="h-3.5 w-3.5" />
                {tr('Corregir')}
              </Button>
            )}
          </div>
        </>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Eliminar esta sesión de estudio?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {subjects.length > 0
                ? tr('Se borrará la sesión de {duration} en {subjects}. La calificación de ese día se recalculará. Esta acción no se puede deshacer.', { duration: formatDurationLabel(seconds), subjects: subjects.map((subject) => subject.name).join(', ') })
                : tr('Se borrará la sesión de {duration}. La calificación de ese día se recalculará. Esta acción no se puede deshacer.', { duration: formatDurationLabel(seconds) })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                setConfirmDelete(false);
                onDelete?.(session.id);
              }}
            >
              {tr('Eliminar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** La misma vista, como ventana propia. `session = null` la cierra. */
export default function SessionDetailDialog({
  session,
  onClose,
  dayPerformance,
  onEdit,
  onDelete,
}: {
  session: StudySession | null;
  onClose: () => void;
  dayPerformance?: DailyPerformance | null;
  onEdit?: (session: StudySession) => void;
  onDelete?: (id: string) => void;
}) {
  // La última sesión mostrada sigue pintándose mientras la ventana se cierra:
  // sin esto el recuadro se vaciaría en plena animación de salida.
  const [lastShown, setLastShown] = useState<StudySession | null>(session);
  if (session && session !== lastShown) setLastShown(session);
  const shown = session ?? lastShown;

  return (
    <Dialog open={Boolean(session)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        {shown && (
          <SessionDetailView
            session={shown}
            dayPerformance={dayPerformance}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
