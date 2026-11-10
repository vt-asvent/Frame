import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, ImageUp, Loader2, Plus, RotateCw, Sparkles, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import ScheduleLinkDialog from '@/components/schedule/ScheduleLinkDialog';
import ScheduleTimeline from '@/components/schedule/ScheduleTimeline';
import ScheduleWeek from '@/components/schedule/ScheduleWeek';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import { useStoredImage } from '@/hooks/use-stored-image';
import { IMAGE_UPDATED_EVENT, getImageRecord, type ImageUpdatedDetail } from '@/lib/music-db';
import { scheduleImageKey } from '@/lib/profile-scope';
import { readTimetable, useReading } from '@/lib/timetable-read';
import { readSubjectLinks, unlinkedSubjects } from '@/lib/timetable-links';
import {
  addTimetable,
  localImageKey,
  migrateLegacySchedule,
  monthKey,
  monthName,
  readTimetables,
  removeTimetable,
  updateTimetable,
  useTimetables,
  type Timetable,
} from '@/lib/timetable';
import { intlLocale, tr, trc } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Inicio → Horario (1.9.0, Diego).
//
//   Horario                           Noviembre ▾  Semanal  [Ver original]
//   ── la línea del día (ScheduleTimeline), la semana (ScheduleWeek) o la foto
//
// «Mes» elige entre los horarios guardados (uno o varios por mes) y añade o
// quita; al añadir se elige el mes y Frame lee las clases de la foto
// (timetable-read.ts). «Semanal» y «Ver original» se alternan con la línea.
// ============================================================

type View = 'line' | 'week' | 'original';

/** «Mes» y «Semanal»: solo texto gris y pequeño, sin borde ni color (1.9.2, Diego). */
const TEXT_BUTTON =
  'inline-flex items-center gap-1 rounded px-1 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

export default function ScheduleBoard({ uid }: { uid: string }) {
  const { list, selected, labels, select } = useTimetables(uid);
  const [view, setView] = useState<View>('line');
  const [picked, setPicked] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Timetable | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const reading = useReading(selected?.id);
  const { courses } = useCourse();
  // Los nombres del horario recién leído que nadie supo vincular: se preguntan una vez.
  const [unlinked, setUnlinked] = useState<string[]>([]);

  /** Lee la foto y, si algún nombre quedó sin asignatura, lo pregunta. */
  const read = (id: string) => {
    const own = courses ?? [];
    void readTimetable(uid, id, own).then((done) => {
      if (!done || own.length === 0) return;
      const classes = readTimetables(uid).find((item) => item.id === id)?.classes ?? [];
      setUnlinked(unlinkedSubjects(classes, own, readSubjectLinks(uid)));
    });
  };

  // La foto única de antes (hasta la 1.8.x) pasa a ser el primer horario,
  // también si llega de otro dispositivo después de abrir Inicio.
  useEffect(() => {
    const legacyKey = scheduleImageKey(uid);
    const check = () => {
      void getImageRecord(legacyKey)
        .then((record) => record && migrateLegacySchedule(uid, record.at || 0))
        .catch(() => undefined);
    };
    check();
    const onImage = (event: Event) => {
      if ((event as CustomEvent<ImageUpdatedDetail>).detail?.key === legacyKey) check();
    };
    window.addEventListener(IMAGE_UPDATED_EVENT, onImage);
    return () => window.removeEventListener(IMAGE_UPDATED_EVENT, onImage);
  }, [uid]);

  // Sin horario no hay semana ni foto que ver.
  useEffect(() => {
    if (!selected) setView('line');
  }, [selected]);

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPicked(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const save = async (month: string) => {
    if (!picked) return;
    try {
      const timetable = await addTimetable(uid, month, picked);
      setPicked(null);
      setView('line');
      read(timetable.id);
    } catch (error) {
      const quota = error instanceof Error && error.name === 'QuotaExceededError';
      toast({
        variant: 'destructive',
        title: quota ? tr('Imagen Demasiado Grande') : tr('Error al Guardar'),
        description: quota ? tr('La imagen es demasiado grande. Por favor, elige un archivo más pequeño.') : tr('Ocurrió un error inesperado al guardar la imagen.'),
      });
    }
  };

  const toggle = (next: View) => setView((current) => (current === next ? 'line' : next));
  const label = selected ? labels.get(selected.id) ?? monthName(selected.month) : monthName(monthKey(new Date()));

  return (
    <Card className="min-w-0 p-4 sm:p-5">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-bold text-primary">{tr('Horario')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={TEXT_BUTTON}>
                {label}
                <ChevronDown className="h-3 w-3 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[13rem]">
              {list.map((item) => (
                <DropdownMenuItem key={item.id} onSelect={() => select(item.id)}>
                  <Check className={cn('mr-2 h-4 w-4', item.id === selected?.id ? 'opacity-100' : 'opacity-0')} />
                  {labels.get(item.id)}
                </DropdownMenuItem>
              ))}
              {list.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => fileRef.current?.click()}>
                <Plus className="mr-2 h-4 w-4" />
                {tr('Añadir horario…')}
              </DropdownMenuItem>
              {selected && (
                <DropdownMenuItem disabled={reading} onSelect={() => read(selected.id)}>
                  <RotateCw className="mr-2 h-4 w-4" />
                  {tr('Volver a leer la foto')}
                </DropdownMenuItem>
              )}
              {selected && (
                <DropdownMenuItem onSelect={() => setRemoving(selected)}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tr('Quitar este horario')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={cn(TEXT_BUTTON, view === 'week' && 'font-semibold text-foreground')} disabled={!selected} aria-pressed={view === 'week'} onClick={() => toggle('week')}>
            {trc('vista del horario', 'Semanal')}
          </button>
          <Button
            variant={view === 'original' ? 'default' : 'fantasma'}
            size="sm"
            disabled={!selected}
            aria-pressed={view === 'original'}
            onClick={() => toggle('original')}
          >
            {tr('Ver original')}
          </Button>
        </div>
      </div>

      <div className="mt-4">
        {!selected ? (
          <EmptyState onPick={() => fileRef.current?.click()} />
        ) : view === 'original' ? (
          <Original uid={uid} timetable={selected} />
        ) : view === 'week' ? (
          <ScheduleWeek classes={selected.classes} onChange={(classes) => updateTimetable(uid, selected.id, { classes, read: 'done' })} />
        ) : (
          <Line uid={uid} timetable={selected} reading={reading} onRead={() => read(selected.id)} onManual={() => setView('week')} />
        )}
      </div>

      {picked && <AddDialog image={picked} onCancel={() => setPicked(null)} onSave={save} existing={list} />}
      {unlinked.length > 0 && <ScheduleLinkDialog uid={uid} subjects={unlinked} courses={courses ?? []} onClose={() => setUnlinked([])} />}

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Quitar el horario «{name}»?', { name: removing ? labels.get(removing.id) ?? '' : '' })}</AlertDialogTitle>
            <AlertDialogDescription>{tr('Se borran la foto y sus clases en todos tus dispositivos. No se puede deshacer.')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (removing) void removeTimetable(uid, removing.id);
                setRemoving(null);
              }}
            >
              {tr('Quitar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function EmptyState({ onPick }: { onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-10 text-center text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ImageUp className="h-9 w-9 text-primary" />
      <span className="font-headline text-base font-semibold text-foreground">{tr('Sube la foto de tu horario')}</span>
      <span className="max-w-md text-xs">{tr('Frame leerá tus clases y te mostrará cada día cuál toca ahora y cuál sigue.')}</span>
    </button>
  );
}

/** La línea del día, o en qué va la lectura de la foto. */
function Line({ uid, timetable, reading, onRead, onManual }: { uid: string; timetable: Timetable; reading: boolean; onRead: () => void; onManual: () => void }) {
  if (reading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center" role="status">
        <Loader2 className="h-7 w-7 animate-spin text-primary" />
        <p className="text-sm font-medium">{tr('Leyendo las clases de tu horario…')}</p>
        <p className="text-xs text-muted-foreground">{tr('Suele tardar unos segundos.')}</p>
      </div>
    );
  }
  if (timetable.classes.length > 0) {
    return (
      <>
        <ScheduleTimeline uid={uid} classes={timetable.classes} />
        {timetable.read === 'failed' && timetable.error && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {timetable.error}{' '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={onRead}>
              {tr('Reintentar')}
            </button>
          </p>
        )}
      </>
    );
  }
  const failed = timetable.read === 'failed';
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      {failed ? <p className="max-w-lg text-sm text-muted-foreground">{timetable.error}</p> : <Sparkles className="h-7 w-7 text-primary" />}
      {!failed && (
        <p className="max-w-lg text-sm text-muted-foreground">{tr('Frame puede leer las clases de esta foto con IA abierta en Cloudflare, que no la guarda.')}</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" className="rounded-full" onClick={onRead}>
          {failed ? <RotateCw /> : <Sparkles />}
          {failed ? tr('Reintentar') : tr('Leer las clases')}
        </Button>
        <Button size="sm" variant="gris" className="rounded-full" onClick={onManual}>
          {tr('Añadirlas a mano')}
        </Button>
      </div>
    </div>
  );
}

function Original({ uid, timetable }: { uid: string; timetable: Timetable }) {
  const [image, , loaded] = useStoredImage(localImageKey(uid, timetable));
  if (!loaded) return <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-muted-foreground" />;
  if (!image) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{tr('La foto de este horario aún no llega a este dispositivo.')}</p>;
  }
  return <img src={image} alt={tr('Horario')} className="mx-auto max-h-[75vh] w-auto max-w-full rounded-lg object-contain" />;
}

/** Elegir el mes del horario nuevo: el actual por defecto. */
function AddDialog({ image, existing, onCancel, onSave }: { image: string; existing: Timetable[]; onCancel: () => void; onSave: (month: string) => Promise<void> }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(monthKey(now));
  const [saving, setSaving] = useState(false);
  const shortMonth = new Intl.DateTimeFormat(intlLocale(), { month: 'short' });
  const already = existing.filter((item) => item.month === month).length;
  const name = `${monthName(month, !month.startsWith(String(now.getFullYear())))}${already > 0 ? ` ${already + 1}` : ''}`;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr('Nuevo horario')}</DialogTitle>
          <DialogDescription>{tr('¿De qué mes es este horario?')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <img src={image} alt="" className="max-h-48 w-full rounded-md border object-contain sm:max-h-56" />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear((value) => value - 1)} aria-label={tr('Año anterior')}>
                <ChevronLeft />
              </Button>
              <span className="text-sm font-semibold tabular-nums">{year}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setYear((value) => value + 1)} aria-label={tr('Año siguiente')}>
                <ChevronRight />
              </Button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {Array.from({ length: 12 }, (_, index) => {
                const key = `${year}-${String(index + 1).padStart(2, '0')}`;
                const text = shortMonth.format(new Date(year, index, 1)).replace('.', '');
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setMonth(key)}
                    aria-pressed={month === key}
                    className={cn(
                      'h-9 rounded-md border text-xs font-medium capitalize transition-colors',
                      month === key ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
                      key === monthKey(now) && month !== key && 'border-primary/50'
                    )}
                  >
                    {text}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{tr('Se llamará «{name}».', { name })}</p>
          </div>
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">{tr('Frame leerá las clases con IA abierta en Cloudflare, que no guarda la foto. Puedes corregir lo leído en «Semanal».')}</p>
        <DialogFooter className="gap-2">
          <Button variant="gris" onClick={onCancel} disabled={saving}>
            {tr('Cancelar')}
          </Button>
          <Button
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              await onSave(month);
              setSaving(false);
            }}
          >
            {saving ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {tr('Guardar y leer las clases')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
