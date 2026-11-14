import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  Mic,
  Play,
  Pause,
  Volume2,
  Gauge,
  FolderOpen,
  FileAudio,
  Settings,
  Trash2,
  GraduationCap,
  Clock,
  LoaderCircle,
  ChevronDown,
} from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Card } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import SubjectPicker from '@/components/courses/SubjectPicker';
import { useCourse } from '@/context/CourseContext';
import { getRecordingAudio } from '@/lib/music-db';
import { formatDuration, RECORDING_KIND_LABEL } from '@/lib/recordings';
import { ImportancePicker, KindPicker } from '@/components/recordings/RecordingPickers';
import NoteEditor from '@/components/temporizador/NoteEditor';
import { isRichNoteEmpty, richNoteToLine } from '@/lib/rich-note';
import { useToast } from '@/hooks/use-toast';
import type { Recording, RecordingImportance, RecordingKind } from '@/types';
import { IMPORTANCE_LABEL, IMPORTANCE_STYLE } from '@/lib/recordings';
import { cn } from '@/lib/utils';
import EchoWord from '@/components/shared/EchoWord';


import { dateLocale, errorText, tr } from '@/lib/i18n';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

// Diálogo de detalles: escuchar el audio (volumen y velocidad hasta x2), editar
// sus datos y reasignar la asignatura. Las acciones sobre el ARCHIVO (abrirlo,
// ver dónde está, eliminarlo) viven en la rueda de la esquina superior izquierda.
function RecordingDetailsDialog({
  recording,
  open,
  onOpenChange,
}: {
  recording: Recording;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { courses, updateRecording, deleteRecording } = useCourse();
  const { toast } = useToast();

  const [name, setName] = useState(recording.name);
  const [description, setDescription] = useState(recording.description ?? '');
  const [importance, setImportance] = useState<RecordingImportance>(recording.importance);
  const [kind, setKind] = useState<RecordingKind | undefined>(recording.kind);
  const [courseId, setCourseId] = useState<string>(recording.courseId ?? 'none');
  const [isSaving, setIsSaving] = useState(false);

  // Reproductor
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isAudioLoading, setAudioLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(recording.durationSec);
  const [volume, setVolume] = useState(80);
  const [speed, setSpeed] = useState(1);

  // Carga el audio desde IndexedDB al abrir; libera el objectURL al cerrar.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let url: string | null = null;
    setAudioLoading(true);
    void getRecordingAudio(recording.id)
      .then((blob) => {
        if (!alive) return;
        if (blob) {
          blobRef.current = blob;
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        }
      })
      .finally(() => {
        if (alive) setAudioLoading(false);
      });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
      setIsPlaying(false);
      setCurrentTime(0);
    };
  }, [open, recording.id]);

  // Estado editable sincronizado con la grabación al reabrir.
  useEffect(() => {
    if (open) {
      setName(recording.name);
      setDescription(recording.description ?? '');
      setImportance(recording.importance);
      setKind(recording.kind);
      setCourseId(recording.courseId ?? 'none');
      setDuration(recording.durationSec);
      setSpeed(1);
    }
    // Por id: el objeto se recrea en cada sincronización y pisaba lo que se escribía.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recording.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = volume / 100;
  }, [volume, audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = speed;
  }, [speed, audioUrl]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const handleSeek = useCallback((value: number[]) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value[0];
    setCurrentTime(value[0]);
  }, []);

  const handleOpenFile = useCallback(() => {
    if (!isTauri() || !recording.filePath) return;
    void invoke('open_local_file', { path: recording.filePath }).catch((e) =>
      toast({ variant: 'destructive', title: tr('No se pudo abrir el archivo'), description: errorText(e) })
    );
  }, [recording.filePath, toast]);

  const handleReveal = useCallback(() => {
    if (!isTauri()) return;
    void invoke('reveal_recording', { path: recording.filePath ?? '' }).catch((e) =>
      toast({ variant: 'destructive', title: tr('No se pudo abrir la ubicación'), description: errorText(e) })
    );
  }, [recording.filePath, toast]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    const finalName = name.trim() || recording.name;
    const updates: Partial<Recording> = {
      name: finalName,
      description: isRichNoteEmpty(description) ? undefined : description.trim(),
      importance,
      kind,
      courseId: courseId === 'none' ? null : courseId,
    };
    // Si cambió el nombre, el archivo en disco se renombra igual.
    if (isTauri() && recording.filePath && finalName !== recording.name) {
      try {
        const newPath = await invoke<string>('rename_recording_file', {
          path: recording.filePath,
          newName: finalName,
        });
        updates.filePath = newPath;
      } catch (e) {
        console.error('rename_recording_file failed', e);
      }
    }
    updateRecording(recording.id, updates);
    setIsSaving(false);
    // Dónde quedó, como al guardarla: sin asignatura no se ve en ninguna y
    // conviene decir que está en Inicio.
    const courseName = updates.courseId ? courses.find((c) => c.id === updates.courseId)?.name : null;
    toast({
      title: tr('Grabación actualizada'),
      description: courseName ? tr('"{finalName}" quedó en {courseName}.', { finalName, courseName }) : tr('"{finalName}" quedó en Inicio.', { finalName }),
    });
    onOpenChange(false);
  }, [courseId, courses, description, importance, kind, name, onOpenChange, recording, toast, updateRecording]);

  const handleDelete = useCallback(() => {
    deleteRecording(recording.id);
    toast({ title: tr('Grabación eliminada'), description: tr('"{name}" se eliminó definitivamente.', { name: recording.name }) });
    onOpenChange(false);
  }, [deleteRecording, onOpenChange, recording, toast]);

  const sliderMax = Number.isFinite(duration) && duration > 0 ? duration : recording.durationSec;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const recordedAt = new Date(recording.recordedAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* Rueda de opciones del archivo: simétrica a la X de cierre. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={tr('Opciones de la grabación')}
              title={tr('Opciones de la grabación')}
              className="absolute left-[13px] top-[13px] z-10 h-[22px] w-[22px] rounded-sm text-muted-foreground opacity-70 transition-opacity hover:bg-primary/10 hover:text-primary hover:opacity-100"
            >
              <Settings className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            {isTauri() && (
              <>
                <DropdownMenuItem onSelect={handleOpenFile} disabled={!recording.filePath}>
                  <FileAudio className="mr-2 h-4 w-4 text-primary" />
                  {tr('Abrir archivo')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleReveal}>
                  <FolderOpen className="mr-2 h-4 w-4 text-primary" />
                  {tr('Abrir ubicación del archivo')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem
              className=""
              onSelect={() => setConfirmDelete(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {tr('Eliminar grabación')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* --- Cabecera: qué audio es, de un vistazo --- */}
        <DialogHeader className="relative items-center overflow-hidden space-y-0 bg-gradient-to-b from-primary/10 via-primary/[0.04] to-transparent px-8 pb-5 pt-10 text-center">
          <EchoWord word={tr('Grabación')} />
          <div className="relative flex w-full flex-col items-center">
          <DialogTitle className="sr-only">{tr('Detalles de la grabación')}</DialogTitle>
          <div
            className={cn(
              'mb-3 flex h-14 w-14 items-center justify-center rounded-full border transition-colors',
              IMPORTANCE_STYLE[importance]
            )}
          >
            <Mic className="h-6 w-6" />
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={tr('Nombre de la grabación')}
            title={tr('Haz clic para cambiar el nombre')}
            className="w-full truncate border-b border-transparent bg-transparent pb-0.5 text-center text-xl font-bold text-foreground outline-none transition-colors hover:border-border focus:border-primary/70"
          />
          <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="first-letter:uppercase">{format(recordedAt, tr('EEEE d \'de\' MMMM \'de\' yyyy'), { locale: dateLocale() })}</span>
            <span aria-hidden>·</span>
            <span className="flex items-center gap-1 tabular-nums">
              <Clock className="h-3 w-3 text-primary" />
              {format(recordedAt, 'HH:mm', { locale: dateLocale() })}
            </span>
            <span aria-hidden>·</span>
            <span className="font-semibold tabular-nums text-foreground">{formatDuration(sliderMax)}</span>
          </p>
          </div>
        </DialogHeader>
        {/* Divisoria con aire a ambos lados, no de borde a borde. */}
        <div aria-hidden className="mx-6 h-px bg-border/60" />

        <div className="space-y-5 px-6 py-5">
          {/* --- Reproductor --- */}
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-4">
            {isAudioLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : audioUrl ? (
              <>
                <audio
                  ref={audioRef}
                  src={audioUrl}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onLoadedMetadata={(e) => {
                    const d = e.currentTarget.duration;
                    // Los webm del MediaRecorder reportan Infinity: se usa la
                    // duración medida durante la grabación.
                    if (Number.isFinite(d) && d > 0) setDuration(d);
                  }}
                />
                <Slider
                  value={[Math.min(currentTime, sliderMax)]}
                  min={0}
                  max={sliderMax}
                  step={0.5}
                  onValueChange={handleSeek}
                  aria-label={tr('Posición del audio')}
                />
                <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
                  <span>{formatDuration(currentTime)}</span>
                  <span>{formatDuration(sliderMax)}</span>
                </div>
                <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Volume2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Slider
                      value={[volume]}
                      min={0}
                      max={100}
                      step={1}
                      onValueChange={(v) => setVolume(v[0])}
                      className="max-w-[110px]"
                      aria-label={tr('Volumen')}
                    />
                  </div>
                  <Button
                    size="icon"
                    className="h-12 w-12 rounded-full shadow-[0_0_18px_hsl(var(--primary)/0.35)]"
                    onClick={togglePlay}
                    aria-label={isPlaying ? tr('Pausar') : tr('Reproducir')}
                  >
                    {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 pl-0.5" />}
                  </Button>
                  <div className="flex items-center justify-end gap-2">
                    <Gauge className="h-4 w-4 text-muted-foreground" />
                    {/* Un menú, no un Select de Radix: era su único uso (−20 KB). */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-8 w-[76px] justify-between bg-card px-3 text-xs font-normal" aria-label={tr('Velocidad')}>
                          x{speed}
                          <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[5.5rem]">
                        {SPEEDS.map((s) => (
                          <DropdownMenuCheckboxItem key={s} checked={s === speed} onCheckedChange={() => setSpeed(s)} className="text-xs">
                            x{s}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </>
            ) : (
              <p className="py-5 text-center text-xs text-muted-foreground">
                {tr('El audio de esta grabación no está en este dispositivo. Si la grabaste en otro, llega solo con Wire.')}
              </p>
            )}
          </div>

          {/* --- Datos --- */}
          <div className="space-y-1.5">
            <Label htmlFor="recEditDesc" className="text-[11px] font-semibold text-muted-foreground">
              {tr('Descripción')}
            </Label>
            <NoteEditor
              id="recEditDesc"
              value={description}
              onChange={setDescription}
              placeholder={tr('¿De qué trata este audio?')}
              ariaLabel={tr('Descripción de la grabación')}
              rows={3}
              toolbarSide
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground">
                {tr('Importancia')}
              </Label>
              <ImportancePicker value={importance} onChange={setImportance} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground">
                {tr('Tipo')}
              </Label>
              <KindPicker value={kind} onChange={setKind} />
            </div>
          </div>

          {/* Asignatura: las mismas tarjetas (colecciones → asignaturas) y el
              mismo gesto que al guardarla en RecordingDialog. Sin tarjeta
              «Sin asignatura»: pulsar otra vez la marcada la desmarca, y sin
              ninguna la grabación vuelve a Inicio. */}
          <SubjectPicker
            value={courseId === 'none' ? null : courseId}
            onChange={(id) => setCourseId((prev) => (id === null || id === prev ? 'none' : id))}
          />
        </div>

        {/* Divisoria con aire a ambos lados. */}
        <div aria-hidden className="mx-6 h-px bg-border/60" />
        <div className="px-6 py-4">
          <Button className="w-full" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}
            {tr('Guardar cambios')}
          </Button>
        </div>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{tr('¿Eliminar esta grabación?')}</AlertDialogTitle>
              <AlertDialogDescription>
                {tr('«{name}» se eliminará de Frame y de tu equipo de forma definitiva. No se puede deshacer.', { name: recording.name })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className={buttonVariants({ variant: 'gris' })}>{tr('Cancelar')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={handleDelete}
              >
                {tr('Eliminar')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

// Tarjeta de una grabación: nombre, importancia, fecha/hora, duración y
// asignatura. Al presionarla se abre el diálogo de detalles.
function RecordingCard({ recording, showCourse = true }: { recording: Recording; showCourse?: boolean }) {
  const { courses } = useCourse();
  const [isOpen, setOpen] = useState(false);
  const courseName = recording.courseId ? courses.find((c) => c.id === recording.courseId)?.name : null;

  return (
    <>
      <Card
        className="group cursor-pointer p-4 transition-all hover:border-primary/60 hover:shadow-[0_0_16px_hsl(var(--primary)/0.12)]"
        onClick={() => setOpen(true)}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 border border-primary/30">
            <Mic className="h-[18px] w-[18px] text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-bold text-foreground">{recording.name}</h3>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                  IMPORTANCE_STYLE[recording.importance]
                )}
              >
                {IMPORTANCE_LABEL[recording.importance]}
              </span>
              {recording.kind && (
                <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {RECORDING_KIND_LABEL[recording.kind]}
                </span>
              )}
              {recording.partCount != null && recording.partCount > 1 && (
                <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {tr('Parte')}{' '}{recording.partIndex}/{recording.partCount}
                </span>
              )}
            </div>
            {recording.description && (
              <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{richNoteToLine(recording.description)}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3 text-primary" />
                {format(new Date(recording.recordedAt), tr('d MMM yyyy · HH:mm'), { locale: dateLocale() })}
              </span>
              <span className="tabular-nums">{formatDuration(recording.durationSec)}</span>
              {showCourse && courseName && (
                <span className="flex items-center gap-1 text-primary">
                  <GraduationCap className="h-3 w-3" />
                  {courseName}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
      {isOpen && <RecordingDetailsDialog recording={recording} open={isOpen} onOpenChange={setOpen} />}
    </>
  );
}

/**
 * Sección de grabaciones:
 * - variant "home": las grabaciones SIN asignatura, al final de Inicio con
 *   título centrado (más las recién guardadas con la X rápida).
 * - variant "course": las grabaciones de una asignatura concreta.
 */
export default function RecordingsSection({
  variant,
  courseId,
}: {
  variant: 'home' | 'course';
  courseId?: string;
}) {
  const { recordings } = useCourse();

  const visible = useMemo(() => {
    const filtered =
      variant === 'course'
        ? recordings.filter((r) => r.courseId === courseId)
        : recordings.filter((r) => !r.courseId);

    // Las partes de una grabación segmentada se agrupan y se leen en orden
    // (Parte 1 → Parte N); los grupos van de la sesión más reciente a la más
    // antigua, igual que el resto de Inicio.
    const sessionStart = new Map<string, number>();
    for (const r of filtered) {
      if (!r.sessionId) continue;
      const t = new Date(r.recordedAt).getTime();
      const current = sessionStart.get(r.sessionId);
      if (current === undefined || t < current) sessionStart.set(r.sessionId, t);
    }
    const groupTime = (r: Recording) =>
      (r.sessionId ? sessionStart.get(r.sessionId) : undefined) ?? new Date(r.recordedAt).getTime();

    return [...filtered].sort((a, b) => {
      const byGroup = groupTime(b) - groupTime(a);
      return byGroup !== 0 ? byGroup : (a.partIndex ?? 0) - (b.partIndex ?? 0);
    });
  }, [recordings, variant, courseId]);

  if (visible.length === 0) return null;

  return (
    <div className={variant === 'home' ? 'pt-4' : ''}>
      {variant === 'home' ? (
        <h1 className="pt-8 pb-4 text-center font-headline text-2xl font-bold text-primary">{tr('Grabaciones')}</h1>
      ) : (
        <div className="mb-3 flex items-center gap-2">
          <Mic className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-primary">{tr('Grabaciones')}</h3>
          <span className="text-xs text-muted-foreground">({visible.length})</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((r) => (
          <RecordingCard key={r.id} recording={r} showCourse={variant === 'home'} />
        ))}
      </div>
    </div>
  );
}
