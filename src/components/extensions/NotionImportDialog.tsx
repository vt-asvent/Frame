import { useMemo, useRef, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, CalendarDays, CheckSquare, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import { EchoHeader } from '@/components/shared/EchoWord';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import {
  NotionImportError,
  notionFingerprint,
  dueIso,
  guessMapping,
  interpretTable,
  readNotionFiles,
  type NotionItem,
  type NotionMapping,
  type NotionTable,
} from '@/lib/extensions/notion-import';
// Solo por su limpieza de lo guardado hasta la 1.6.1.
import { DEFAULT_EVENT_COLOR } from '@/lib/calendar-events';
import { extRead, extWrite } from '@/lib/extensions/store';
import { cn } from '@/lib/utils';
import { dateLocale, tr } from '@/lib/i18n';

// ============================================================
// Importador de Notion: tareas y fechas. Es la extensión Notion: se abre
// desde Ajustes → Extensiones → Notion → «Importar de Notion…».
//
// Sin duplicados al reimportar: cada fila importada deja su huella (título y
// fecha) en los datos de la extensión, por perfil. Una fila no se puede
// volver a marcar si ya está en Frame o si se repite en el mismo archivo; si
// se importó antes y ya no está (se borró), sale desmarcada pero se puede
// traer de nuevo.
// Ver lib/extensions/notion-import.ts para cómo se leen los archivos.
// ============================================================

type ImportAs = 'tasks' | 'events';

const MAPPING_LABEL: Record<keyof NotionMapping, string> = {
  get title() { return tr('Título'); },
  get date() { return tr('Fecha'); },
  get status() { return tr('Estado'); },
  get course() { return tr('Asignatura'); },
  get priority() { return tr('Prioridad'); },
  get kind() { return tr('Tipo'); },
  get description() { return tr('Descripción'); },
};

const dayLabel = (date: string) => {
  try {
    return format(parseISO(date), tr('d \'de\' MMM yyyy'), { locale: dateLocale() });
  } catch {
    return date;
  }
};

const plain = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const NOTION = 'frame.notion';
/** Huellas guardadas, como mucho (las más antiguas salen primero). */
const MAX_REMEMBERED = 20000;

type Duplicate = 'frame' | 'file' | 'before' | null;

/** Recuadro del panel de la extensión Notion (Ajustes → Extensiones). */
export default function NotionImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const { courses, tasks, archivedTasks, localEvents, addTask, addCourse, addLocalEvent, userProfile } = useCourse();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [tables, setTables] = useState<NotionTable[]>([]);
  const [tableIndex, setTableIndex] = useState(0);
  const [mapping, setMapping] = useState<NotionMapping | null>(null);
  /** Lo marcado a mano; null = lo de siempre (sin terminar y sin duplicados). */
  const [picked, setSelected] = useState<Set<string> | null>(null);
  const [includeDone, setIncludeDone] = useState(false);
  const [importAs, setImportAs] = useState<ImportAs>('tasks');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createCourses, setCreateCourses] = useState(true);
  const rememberedKey = `imported:${userProfile?.id ?? 'local'}`;

  const table = tables[tableIndex] ?? null;
  const items = useMemo<NotionItem[]>(
    () => (table && mapping ? interpretTable(table, mapping, courses ?? []) : []),
    [table, mapping, courses]
  );
  const visibleItems = useMemo(
    () => items.filter((i) => (includeDone || !i.done) && (importAs === 'tasks' || i.date)),
    [items, includeDone, importAs]
  );

  /** Huellas de lo que ya está en Frame (tareas, también las archivadas, o fechas). */
  const inFrame = useMemo(() => {
    const set = new Set<string>();
    if (importAs === 'tasks') {
      for (const t of [...(tasks ?? []), ...(archivedTasks ?? [])]) {
        set.add(notionFingerprint('tasks', t.name, t.dueDate ? format(new Date(t.dueDate), 'yyyy-MM-dd') : null));
      }
    } else {
      for (const e of localEvents ?? []) set.add(notionFingerprint('events', e.title, e.endDate ?? e.date));
    }
    return set;
  }, [importAs, tasks, archivedTasks, localEvents]);

  /** Lo que se importó antes con la extensión (aunque luego se borrara). */
  const remembered = useMemo(() => new Set(extRead<string[]>(NOTION, rememberedKey, [])), [rememberedKey, open]);

  /** Por qué no conviene importar una fila: ya está, se repite en el archivo o ya se trajo antes. */
  const duplicates = useMemo(() => {
    const out = new Map<string, Duplicate>();
    const seen = new Set<string>();
    for (const item of items) {
      const print = notionFingerprint(importAs, item.title, item.date);
      out.set(item.key, inFrame.has(print) ? 'frame' : seen.has(print) ? 'file' : remembered.has(print) ? 'before' : null);
      seen.add(print);
    }
    return out;
  }, [items, importAs, inFrame, remembered]);
  const duplicateOf = (item: NotionItem): Duplicate => duplicates.get(item.key) ?? null;
  const selected = useMemo(
    () => picked ?? new Set(items.filter((i) => !i.done && !duplicates.get(i.key)).map((i) => i.key)),
    [picked, items, duplicates]
  );
  /** No se puede marcar: ya está en Frame o se repite en el archivo. */
  const isDuplicate = (item: NotionItem) => {
    const d = duplicateOf(item);
    return d === 'frame' || d === 'file';
  };

  /** Asignaturas de Notion que no existen en Frame (se pueden crear al importar). */
  const missingCourses = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of visibleItems) {
      if (!selected.has(item.key) || item.courseId || !item.courseLabel) continue;
      const label = item.courseLabel.split(',')[0].trim().slice(0, 60);
      if (label) names.set(plain(label), label);
    }
    return [...names.values()];
  }, [visibleItems, selected]);

  const reset = () => {
    setTables([]);
    setTableIndex(0);
    setMapping(null);
    setSelected(null);
    setError(null);
  };

  const choose = (list: NotionItem[]) => setSelected(new Set(list.filter((i) => !duplicateOf(i)).map((i) => i.key)));

  const onFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const found = await readNotionFiles([...files]);
      if (found.length === 0) {
        setError(tr('No encontré ninguna tabla. Elige el .zip que descarga Notion al exportar con «Markdown y CSV», o el .csv de la base de datos.'));
        return;
      }
      setTables(found);
      setTableIndex(0);
      const m = guessMapping(found[0]);
      setMapping(m);
      setSelected(null);
    } catch (e) {
      setError(
        e instanceof NotionImportError
          ? e.message
          : tr('No se pudo leer el archivo ({error}). Vuelve a exportarlo desde Notion con «Markdown y CSV».', { error: e instanceof Error ? e.message : String(e) })
      );
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const switchTable = (index: number) => {
    setTableIndex(index);
    setMapping(guessMapping(tables[index]));
    setSelected(null);
  };

  const runImport = () => {
    if (!userProfile) return;
    const chosen = visibleItems.filter((i) => selected.has(i.key));
    if (chosen.length === 0) return;
    if (importAs === 'tasks') {
      const now = Date.now();
      // Las asignaturas que faltan, una vez cada una (si se pidió).
      const created = new Map<string, NonNullable<ReturnType<typeof addCourse>>>();
      if (createCourses) {
        for (const name of missingCourses) {
          const course = addCourse(name);
          if (course) created.set(plain(name), course);
        }
      }
      chosen.forEach((item, n) => {
        const label = item.courseLabel ? plain(item.courseLabel.split(',')[0].trim().slice(0, 60)) : '';
        const course = (courses ?? []).find((c) => c.id === item.courseId) ?? created.get(label) ?? null;
        const notes = [item.description, item.time ? tr('Hora: {time}', { time: item.time }) : '', !course && item.courseLabel ? tr('Notion: {courseLabel}', { courseLabel: item.courseLabel }) : '']
          .filter(Boolean)
          .join('\n');
        addTask({
          name: item.title,
          description: notes,
          dueDate: item.date ? dueIso(item.date) : null,
          priority: item.priority ?? 'Media',
          ...(item.kind ? { kind: item.kind } : {}),
          progress: item.done ? 100 : 0,
          order: -(now + n),
          courseId: course?.id ?? '',
          courseName: course?.name ?? '',
          uid: userProfile.id,
        });
      });
      toast({
        title: tr('{length} {p} de Notion', { length: chosen.length, p: chosen.length === 1 ? tr('tarea importada') : tr('tareas importadas') }),
        description:
          created.size > 0
            ? tr('Con {count} asignaturas nuevas. Las que no tenían asignatura están al final de Inicio.', { count: created.size })
            : tr('Las que no tenían asignatura están al final de Inicio, para colocarlas.'),
      });
    } else {
      for (const item of chosen) {
        if (!item.date) continue;
        addLocalEvent({
          title: item.title,
          date: item.startDate ?? item.date,
          ...(item.startDate ? { endDate: item.date } : {}),
          kind: item.kind === 'Examen' ? 'examen' : 'personal',
          color: DEFAULT_EVENT_COLOR,
          display: 'actividad',
          ...(item.description ? { description: item.description } : {}),
        });
      }
      toast({
        title: tr('{length} {p} al calendario', { length: chosen.length, p: chosen.length === 1 ? tr('fecha importada') : tr('fechas importadas') }),
        description: tr('Las verás en Calendario.'),
      });
    }
    // Huellas de lo importado: al volver a importar, no se repite.
    const prints = [...remembered, ...chosen.map((item) => notionFingerprint(importAs, item.title, item.date))];
    extWrite(NOTION, rememberedKey, [...new Set(prints)].slice(-MAX_REMEMBERED));
    setOpen(false);
    reset();
  };

  const allChosen = visibleItems.some((i) => !isDuplicate(i)) && visibleItems.every((i) => selected.has(i.key) || isDuplicate(i));
  const chosenCount = visibleItems.filter((i) => selected.has(i.key)).length;

  const close = () => {
    setOpen(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-2xl">
        {/* «Atrás» (a elegir otro archivo): flecha en la esquina superior
            izquierda, frente a la X de cerrar. */}
        {table && (
          <Button
            variant="ghost"
            size="icon"
            onClick={reset}
            title={tr('Elegir otro archivo')}
            aria-label={tr('Atrás: elegir otro archivo')}
            className="absolute left-4 top-4 z-10 h-7 w-7 text-muted-foreground hover:bg-primary/10 hover:text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <EchoHeader word={tr('Notion')} className="mb-0">
          <DialogHeader className="items-center">
            <div className="flex items-center justify-center gap-2.5">
              <ExtensionIcon className="h-8 w-8" />
              <DialogTitle className="text-xl font-bold text-primary">{tr('Importar de Notion')}</DialogTitle>
            </div>
            <DialogDescription className="text-center text-xs">{tr('Tus tareas y fechas, de una base de datos de Notion a Frame.')}</DialogDescription>
          </DialogHeader>
        </EchoHeader>

        {!table ? (
          <div className="space-y-4">
            <ol className="space-y-2 rounded-xl bg-secondary/40 p-4 text-sm text-foreground/90">
              {[
                tr('En Notion, abre la base de datos con tus tareas.'),
                tr('Pulsa ••• (arriba a la derecha) → «Exportar».'),
                tr('Formato: «Markdown y CSV». Pulsa «Exportar» y se descargará un .zip.'),
                tr('Aquí, elige ese .zip (o el .csv de dentro).'),
              ].map((step, i) => (
                <li key={step} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <input ref={fileRef} type="file" accept=".zip,.csv" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
            <Button className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              {tr('Elegir el archivo de Notion')}
            </Button>
            {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
            <p className="text-center text-[11px] text-muted-foreground">{tr('Todo ocurre en tu equipo: Frame no se conecta a tu cuenta de Notion.')}</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {tables.length > 1 && (
                <select
                  value={tableIndex}
                  onChange={(e) => switchTable(Number(e.target.value))}
                  className="rounded-md border border-border bg-background px-2 py-1"
                  aria-label={tr('Base de datos')}
                >
                  {tables.map((t, i) => (
                    <option key={t.name} value={i}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="font-semibold text-foreground">{table.name}</span>
              <span className="text-muted-foreground">· {table.rows.length}{' '}{tr('filas')}</span>
              <div className="ml-auto flex overflow-hidden rounded-full border border-border/70">
                {(['tasks', 'events'] as ImportAs[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setImportAs(value)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1 transition-colors',
                      importAs === value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {value === 'tasks' ? <CheckSquare className="h-3.5 w-3.5" /> : <CalendarDays className="h-3.5 w-3.5" />}
                    {value === 'tasks' ? tr('Como tareas') : tr('Como fechas del calendario')}
                  </button>
                ))}
              </div>
            </div>

            {mapping && (
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {(Object.keys(MAPPING_LABEL) as (keyof NotionMapping)[]).map((key) =>
                  mapping[key] ? (
                    <span key={key} className="rounded-full border border-border/70 px-2 py-0.5 text-muted-foreground">
                      {MAPPING_LABEL[key]}: <span className="text-foreground">{mapping[key]}</span>
                    </span>
                  ) : null
                )}
              </div>
            )}

            <div className="flex items-center justify-between gap-3 text-xs">
              <label className="flex items-center gap-2">
                <Checkbox checked={allChosen} onCheckedChange={(v) => (v ? choose(visibleItems) : setSelected(new Set()))} />
                {tr('Seleccionar todo')}
              </label>
              {mapping?.status && (
                <label className="flex items-center gap-2 text-muted-foreground">
                  {tr('Incluir las ya terminadas')}
                  <Switch checked={includeDone} onCheckedChange={setIncludeDone} />
                </label>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/70">
              {visibleItems.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  {importAs === 'events' ? tr('Ninguna fila tiene fecha.') : tr('No hay filas para importar.')}
                </p>
              ) : (
                visibleItems.map((item) => {
                  const dup = isDuplicate(item);
                  return (
                    <label
                      key={item.key}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-0 hover:bg-secondary/30',
                        dup && 'cursor-default opacity-50'
                      )}
                    >
                      <Checkbox
                        className="mt-0.5"
                        disabled={dup}
                        checked={selected.has(item.key)}
                        onCheckedChange={(v) =>
                          setSelected((prev) => {
                            const next = new Set(prev ?? selected);
                            if (v) next.add(item.key);
                            else next.delete(item.key);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{item.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {item.date ? (item.startDate ? `${dayLabel(item.startDate)} → ${dayLabel(item.date)}` : dayLabel(item.date)) : tr('Sin fecha')}
                          {item.time ? ` · ${item.time}` : ''}
                          {' · '}
                          {item.courseId ? item.courseLabel : item.courseLabel ? tr('{courseLabel} (sin asignatura igual en Frame)', { courseLabel: item.courseLabel }) : tr('Sin asignatura')}
                          {item.done ? tr(' · terminada') : ''}
                          {duplicateOf(item) === 'frame' && tr(' · ya está en Frame')}
                          {duplicateOf(item) === 'file' && tr(' · repetida en el archivo')}
                          {duplicateOf(item) === 'before' && tr(' · importada antes')}
                        </span>
                      </span>
                    </label>
                  );
                })
              )}
            </div>

            {importAs === 'tasks' && missingCourses.length > 0 && (
              <label className="flex items-start gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs text-foreground">
                <Checkbox className="mt-0.5" checked={createCourses} onCheckedChange={(v) => setCreateCourses(!!v)} />
                <span>
                  {tr('Crear las asignaturas que faltan en Frame:')}{' '}
                  <span className="text-muted-foreground">{missingCourses.join(', ')}</span>
                </span>
              </label>
            )}

            <div className="flex items-center justify-end gap-2">
              <Button variant="gris" onClick={close}>
                {tr('Cancelar')}
              </Button>
              <Button onClick={runImport} disabled={chosenCount === 0}>
                {tr('Importar')}{' '}{chosenCount}{' '}
                {importAs === 'tasks' ? (chosenCount === 1 ? tr('tarea') : tr('tareas')) : chosenCount === 1 ? tr('fecha') : tr('fechas')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
