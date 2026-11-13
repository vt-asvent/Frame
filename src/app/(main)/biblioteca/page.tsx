import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, Check, ChevronDown, FlaskConical, KeyRound, LoaderCircle, Lock, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { addDays, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import LibraryActivateDialog from '@/components/extensions/LibraryActivateDialog';
import BibFileDialog from '@/components/library/BibFileDialog';
import { ItemCard, ItemGrid, SectionHeading, Shelf, ShelfItem, subjectColor } from '@/components/library/BibParts';
import StudyCardsDialog from '@/components/library/StudyCardsDialog';
import { useCourse } from '@/context/CourseContext';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { useToast } from '@/hooks/use-toast';
import { useAkLoreAccess } from '@/lib/extensions/aklore/access';
import {
  convocatoriaLabel,
  convocatoriaOf,
  deComponente,
  deNivel,
  fileNameOf,
  forgetBibFiles,
  openItem,
  programaDe,
  searchItems,
  setConvocatoria,
  subjectsIn,
  temasDe,
  useBiblioteca,
  useStudy,
  type BibItem,
  type BibModel,
  type BibSubject,
} from '@/lib/extensions/aklore/biblioteca';
import { forgetPdfs } from '@/lib/extensions/aklore/pdf';
import { AKLORE, demoAvailable, fold, setDemo, toggleFavorite, useDemo, useLoreFavorites } from '@/lib/extensions/aklore/source';
import { extRead, extWrite } from '@/lib/extensions/store';
import { trackEvent } from '@/lib/telemetry';
import { dateLocale, errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca (1.9.7; 1.9.8): la carpeta «AK Lore» del Drive de Asvent, para
// personas.
//
//   [ 🔍 Buscar…              1 204 archivos · IB ▾ ]  [ Nivel ▾ ]  [ Prueba ▾ ]
//   Destacados  ▸ ▸ ▸ ▸ ▸ ▹        (un carrusel: cinco tarjetas y asoma la sexta)
//   Física · 249                                              Ver todo
//   ▸ ▸ ▸ ▸ ▸ ▹
//
// Los tres filtros salen de la configuración de la carpeta (1.9.8, Diego): el
// programa (IB o CNEB: con uno no se ve nada del otro), sus grupos de
// asignaturas (Core, NM, NS; o cada curso) y sus pruebas (Prueba 1, 2, 3, IA).
// Inicio: Destacados, lo que sirve para tus próximos exámenes (los de Tareas),
// Favoritos y una fila por asignatura. Asignatura: «Guía y programa» arriba y
// luego Temas, Exámenes y Trabajos. Cada archivo se abre en un diálogo con su
// descripción y su vista previa (BibFileDialog). Lo que se sube o se mueve en
// Drive aparece en unos minutos, sin actualizar.
// ============================================================

type Tab = 'temas' | 'examenes' | 'trabajos' | 'otros';
const TABS: { id: Tab; label: string }[] = [
  { id: 'temas', label: 'Temas' },
  { id: 'examenes', label: 'Exámenes' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'otros', label: 'Otros' },
];

/** Cuántas tarjetas lleva la fila de una asignatura en Inicio: el resto, en «Ver todo». */
const ROW = 12;

const archivos = (n: number) => (n === 1 ? tr('1 archivo') : tr('{n} archivos', { n }));

const byTitle = (a: BibItem, b: BibItem) => a.title.localeCompare(b.title, 'es', { numeric: true });

/** Primero lo que va antes en una serie (`orden`), luego por título. */
const byOrder = (a: BibItem, b: BibItem) => (Number(a.props.orden) || 999) - (Number(b.props.orden) || 999) || byTitle(a, b);

const GUIDE_RANK = ['guia', 'programa', 'cuadernillo'];
const guideRank = (it: BibItem) => (GUIDE_RANK.includes(it.tipo) ? GUIDE_RANK.indexOf(it.tipo) : GUIDE_RANK.length);
const EXAM_RANK = ['examen', 'esquema', 'informe', 'respuesta-calificada'];
/** Dentro de una convocatoria: por prueba y zona, y cada examen antes que su esquema. */
const byExam = (a: BibItem, b: BibItem) =>
  (a.props.componente ?? '').localeCompare(b.props.componente ?? '', 'es', { numeric: true }) ||
  (a.props.zona ?? '').localeCompare(b.props.zona ?? '') ||
  EXAM_RANK.indexOf(a.tipo) - EXAM_RANK.indexOf(b.tipo) ||
  byOrder(a, b);

/** La guía más nueva primero; luego el programa, el cuadernillo y lo demás. */
const byGuide = (a: BibItem, b: BibItem) => (b.props.guia ?? '').localeCompare(a.props.guia ?? '') || guideRank(a) - guideRank(b) || byOrder(a, b);

function Notice({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children?: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 flex max-w-lg flex-col items-center gap-3 rounded-xl border border-border/60 bg-card p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-6 w-6 text-primary" />
      </span>
      <h2 className="text-lg font-bold text-foreground">{title}</h2>
      {children}
    </div>
  );
}

/** Un botón que despliega opciones de las que se elige una (`null`: sin filtro). */
function Choice({ label, value, options, all, onChoose, className }: { label: string; value: string | null; options: string[]; all?: string; onChoose: (value: string | null) => void; className?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={label} className={className}>
          <span className="truncate">{value ?? label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 min-w-[10rem] max-w-[20rem] overflow-y-auto">
        {all && (
          <>
            <DropdownMenuItem onSelect={() => onChoose(null)}>
              <Check className={cn('mr-2 h-4 w-4 shrink-0', value === null ? 'opacity-100' : 'opacity-0')} />
              {all}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {options.map((option) => (
          <DropdownMenuItem key={option} onSelect={() => onChoose(option)}>
            <Check className={cn('mr-2 h-4 w-4 shrink-0', value === option ? 'opacity-100' : 'opacity-0')} />
            <span className="truncate">{option}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FILTER_BUTTON =
  'inline-flex h-10 max-w-[14rem] items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function BibliotecaPage() {
  const { userProfile, tasks } = useCourse();
  const navigate = useNavigate();
  const access = useAkLoreAccess(userProfile?.id);
  const [activating, setActivating] = useState(false);
  useDemo(); // se vuelve a pintar al cambiar los datos de ejemplo
  const bib = useBiblioteca(access === 'allowed');
  const favorites = useLoreFavorites();
  const study = useStudy();
  const convocatoria = convocatoriaOf(study);
  const saveCopy = useSaveCopy();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const subjectName = params.get('a');
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<BibItem | null>(null);
  const [cardsOf, setCardsOf] = useState<BibItem | null>(null);
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
  // Los filtros: el programa y su grupo se recuerdan en este equipo; la prueba, no.
  const [chosen, setChosen] = useState(() => extRead<{ programa: string | null; grupo: string | null }>(AKLORE, 'filtro', { programa: null, grupo: null }));
  const [pruebaName, setPruebaName] = useState<string | null>(null);

  useEffect(
    () => () => {
      forgetBibFiles();
      forgetPdfs();
    },
    []
  );

  const model = bib.model;
  const programas = model?.config.programas ?? [];
  const programa = programas.find((p) => p.nombre === chosen.programa) ?? programas[0] ?? null;
  const grupo = programa?.grupos.find((g) => g.nombre === chosen.grupo) ?? null;
  const prueba = programa?.componentes.find((c) => c.nombre === pruebaName) ?? null;

  /** Las asignaturas que deja ver el filtro, cada una con los archivos de la prueba elegida. */
  const shown = useMemo(() => {
    if (!model) return [];
    return subjectsIn(model, programa, grupo?.nombre ?? null)
      .map((s) => (prueba ? { ...s, items: s.items.filter((it) => deComponente(it, prueba)) } : s))
      .filter((s) => s.items.length > 0);
  }, [model, programa, grupo, prueba]);
  /** Lo destacado del programa (no depende del grupo ni de la prueba). */
  const featured = useMemo(() => {
    if (!model || prueba) return [];
    const names = new Set(subjectsIn(model, programa, null).map((s) => s.name));
    return model.featured.filter((it) => names.has(it.subject));
  }, [model, programa, prueba]);

  // La asignatura abierta: la del enlace (aunque sea de otro grupo) o la única del grupo elegido (un curso).
  const linked = model && subjectName ? model.subjects.find((s) => s.name === subjectName) ?? null : null;
  const subject = linked ? { ...linked, items: linked.items.filter((it) => deComponente(it, prueba)) } : grupo && shown.length === 1 ? shown[0]! : null;

  const confOf = (item: BibItem) => model?.subjects.find((s) => s.name === item.subject)?.conf;
  const colorOf = (item: BibItem) => subjectColor(item.subject, confOf(item));

  const openSubject = (name: string | null) => {
    setOpened(null);
    setQuery('');
    setParams(name ? { a: name } : {});
    document.querySelector('main')?.scrollTo({ top: 0 });
  };
  const choose = (next: { programa: string | null; grupo: string | null }) => {
    setChosen(next);
    extWrite(AKLORE, 'filtro', next);
    if (next.programa !== programa?.nombre) setPruebaName(null);
    openSubject(null);
  };

  const favoriteFailed = () => toast({ variant: 'destructive', title: tr('No se pudo guardar el favorito'), description: tr('No hay espacio en el equipo para guardarlo.') });
  const toggleFav = (item: BibItem) => !toggleFavorite(item.key) && favoriteFailed();

  const download = async (item: BibItem) => {
    if (downloading.has(item.id)) return;
    const mark = (on: boolean) =>
      setDownloading((prev) => {
        const next = new Set(prev);
        if (on) next.add(item.id);
        else next.delete(item.id);
        return next;
      });
    mark(true);
    try {
      const blob = await openItem(item);
      if ((await saveCopy(blob, fileNameOf(item))) && extRead<boolean>(AKLORE, 'demo', false) !== true) trackEvent('library_download', { n: 1 });
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo descargar el archivo'), description: errorText(error).slice(0, 200) });
    } finally {
      mark(false);
    }
  };

  if (access === 'checking') {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (access !== 'allowed') {
    return (
      <Notice icon={Lock} title={tr('Activa la Biblioteca')}>
        <p className="text-sm text-muted-foreground">
          {userProfile?.email && !userProfile.isGuest
            ? tr('Es para estudiantes del colegio: se activa una vez, con un código que llega a tu correo institucional.')
            : tr('Entra a Frame con tu cuenta de Google para activar la Biblioteca.')}
        </p>
        {userProfile?.email && !userProfile.isGuest ? (
          <Button onClick={() => setActivating(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            {tr('Activar con mi correo institucional')}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => navigate('/settings')}>
            {tr('Ir a Ajustes')}
          </Button>
        )}
        <LibraryActivateDialog uid={userProfile?.id} open={activating} onClose={() => setActivating(false)} />
      </Notice>
    );
  }

  const card = (item: BibItem, showSubject = false) => (
    <ItemCard
      item={item}
      conf={confOf(item)}
      convocatoria={convocatoria ?? null}
      favorite={favorites.has(item.key)}
      showSubject={showSubject}
      onOpen={() => setOpened(item)}
      onToggleFavorite={() => toggleFav(item)}
    />
  );
  const shelf = (label: string, items: BibItem[], showSubject = true) => (
    <Shelf label={label} count={items.length}>
      {items.map((it) => (
        <ShelfItem key={it.id}>{card(it, showSubject)}</ShelfItem>
      ))}
    </Shelf>
  );

  const scope = subject ? subject.items : shown.flatMap((s) => s.items);
  const searching = query.trim().length > 0;
  const found = searching ? searchItems(scope, query) : [];

  return (
    <div className="p-6 pt-4 md:p-8 md:pt-4">
      {/* Buscador (con el total y el programa dentro) · grupo · prueba · convocatoria */}
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        {linked && (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => openSubject(null)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {tr('Biblioteca')}
          </Button>
        )}
        <div className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border border-primary bg-card pl-3 pr-1 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 md:w-auto md:min-w-[18rem] md:flex-1 md:basis-0">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            type="text"
            placeholder={subject ? tr('Buscar en {asignatura}…', { asignatura: subject.name }) : tr('Buscar exámenes, guías, temas…')}
            aria-label={tr('Buscar en la Biblioteca')}
            autoComplete="off"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground" aria-label={tr('Borrar la búsqueda')}>
              <X className="h-4 w-4" />
            </button>
          )}
          <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {searching ? tr('{n} de {total}', { n: found.length, total: scope.length }) : archivos(scope.length)}
          </span>
          {programas.length > 1 && programa && (
            <Choice
              label={tr('Programa')}
              value={programa.nombre}
              options={programas.map((p) => p.nombre)}
              onChoose={(name) => choose({ programa: name, grupo: null })}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded bg-primary/10 px-2.5 text-xs font-bold text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          )}
        </div>
        {programa && programa.grupos.length > 1 && (
          <Choice
            label={tr(programa.etiqueta ?? 'Asignaturas')}
            value={grupo?.nombre ?? null}
            options={programa.grupos.map((g) => g.nombre)}
            all={tr('Todo')}
            onChoose={(name) => choose({ programa: programa.nombre, grupo: name })}
            className={FILTER_BUTTON}
          />
        )}
        {programa && programa.componentes.length > 0 && (
          <Choice label={tr('Prueba')} value={prueba?.nombre ?? null} options={programa.componentes.map((c) => c.nombre)} all={tr('Todo')} onChoose={setPruebaName} className={FILTER_BUTTON} />
        )}
        {model && model.config.convocatorias.length > 0 && convocatoria !== undefined && <ConvocatoriaChip model={model} value={convocatoria} />}
        {demoAvailable && (
          <Button variant="ghost" size="sm" onClick={() => setDemo(extRead<boolean>(AKLORE, 'demo', false) !== true)}>
            <FlaskConical className="mr-1.5 h-4 w-4" />
            {tr('Datos de ejemplo')}
          </Button>
        )}
      </div>

      {bib.error && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
          <span className="min-w-0 flex-1">{model ? tr('No se pudo actualizar la Biblioteca: ves la copia de este equipo.') : bib.error}</span>
          <Button size="sm" variant="outline" onClick={bib.reload}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {tr('Reintentar')}
          </Button>
        </div>
      )}

      {!model ? (
        bib.loading ? (
          <div className="flex h-64 items-center justify-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : null
      ) : model.items.length === 0 ? (
        <Notice icon={Lock} title={tr('La Biblioteca está vacía')}>
          <p className="text-sm text-muted-foreground">{tr('Pronto llegará el material. No hace falta actualizar Frame: aparecerá aquí.')}</p>
        </Notice>
      ) : searching ? (
        found.length ? (
          <ItemGrid>
            {found.slice(0, 200).map((it) => (
              <div key={it.id}>{card(it, !subject)}</div>
            ))}
          </ItemGrid>
        ) : (
          <p className="py-16 text-center text-sm text-muted-foreground">{tr('No hay nada con «{q}».', { q: query.trim() })}</p>
        )
      ) : subject ? (
        <SubjectView key={subject.name} subject={subject} convocatoria={convocatoria ?? null} card={card} shelf={shelf} />
      ) : (
        <HomeView model={model} subjects={shown} featured={featured} convocatoria={convocatoria} tasks={tasks} favorites={favorites} shelf={shelf} onSubject={openSubject} />
      )}

      {opened && (
        <BibFileDialog
          item={opened}
          color={colorOf(opened)}
          conf={confOf(opened)}
          convocatoria={convocatoria ?? null}
          favorite={favorites.has(opened.key)}
          downloading={downloading.has(opened.id)}
          onClose={() => setOpened(null)}
          onToggleFavorite={() => toggleFav(opened)}
          onDownload={() => void download(opened)}
          onCards={() => setCardsOf(opened)}
          onSubject={(name) => openSubject(name)}
          isSubject={(name) => !!model?.subjects.some((s) => s.name === name)}
        />
      )}
      {cardsOf && <StudyCardsDialog item={cardsOf} color={colorOf(cardsOf)} onClose={() => setCardsOf(null)} />}
    </div>
  );
}

// ------------------------------------------------------------
// Convocatoria: de ella depende qué programa es el vigente
// ------------------------------------------------------------

function ConvocatoriaChip({ model, value }: { model: BibModel; value: string | null }) {
  const [open, setOpen] = useState(false);
  const name = model.config.convocatorias.find((c) => c.id === value)?.nombre;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-10">
          <CalendarClock className="mr-1.5 h-4 w-4" />
          {name ? tr('Exámenes: {cuando}', { cuando: tr(name) }) : tr('¿Cuándo das los exámenes?')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <ConvocatoriaChoice model={model} value={value} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

function ConvocatoriaChoice({ model, value, onDone }: { model: BibModel; value: string | null | undefined; onDone?: () => void }) {
  const choose = (v: string | null) => {
    setConvocatoria(v);
    onDone?.();
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{tr('¿Cuándo das los exámenes del IB?')}</p>
      <p className="text-xs text-muted-foreground">{tr('Así la Biblioteca te avisa cuando algo es de un programa que ya no es el tuyo.')}</p>
      <div className="flex flex-wrap gap-2">
        {model.config.convocatorias.map((c) => (
          <Button key={c.id} size="sm" variant={value === c.id ? 'default' : 'outline'} onClick={() => choose(c.id)}>
            {tr(c.nombre)}
          </Button>
        ))}
        <Button size="sm" variant={value === null ? 'default' : 'ghost'} onClick={() => choose(null)}>
          {tr('Aún no lo sé')}
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Inicio
// ------------------------------------------------------------

interface ExamTask {
  name: string;
  dueDate: string | null;
  kind?: string;
  courseName: string;
  progress: number;
}

/** Los exámenes de Tareas de las próximas tres semanas, con la asignatura de la Biblioteca que les toca. */
function upcomingExams(subjects: BibSubject[], tasks: ExamTask[]): { subject: BibSubject; date: Date; name: string }[] {
  const today = startOfDay(new Date());
  const limit = addDays(today, 22);
  const out: { subject: BibSubject; date: Date; name: string }[] = [];
  for (const t of tasks) {
    if (t.kind !== 'Examen' || !t.dueDate || t.progress >= 100) continue;
    const date = parseISO(t.dueDate);
    if (isBefore(date, today) || isAfter(date, limit)) continue;
    const course = fold(`${t.courseName} ${t.name}`);
    const subject = subjects.find((s) => [s.name, ...(s.conf.alias ?? [])].some((a) => a && course.includes(fold(a))));
    if (subject && !out.some((o) => o.subject === subject)) out.push({ subject, date, name: t.name });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 3);
}

/** Para repasar antes de un examen: preguntas por tema, simulacros y exámenes del programa vigente. */
const PREP_ORDER = ['banco', 'simulacro', 'examen', 'esquema', 'prueba-colegio', 'informe', 'guia', 'cuadernillo'];
function prepFor(subject: BibSubject, convocatoria: string | null): BibItem[] {
  return subject.items
    .filter((it) => PREP_ORDER.includes(it.tipo) && programaDe(it, subject.conf, convocatoria) !== 'anterior')
    .sort((a, b) => PREP_ORDER.indexOf(a.tipo) - PREP_ORDER.indexOf(b.tipo) || (b.props.convocatoria ?? '').localeCompare(a.props.convocatoria ?? '') || byOrder(a, b))
    .slice(0, ROW);
}

/** La fila de una asignatura en Inicio: su guía, sus exámenes más recientes y luego lo demás; lo del programa anterior, al final. */
const APARTADO_RANK = ['guia', 'examenes', 'temas', 'trabajos', 'otros'];
function rowFor(subject: BibSubject, convocatoria: string | null): BibItem[] {
  const old = (it: BibItem) => (programaDe(it, subject.conf, convocatoria) === 'anterior' ? 1 : 0);
  return [...subject.items]
    .sort(
      (a, b) =>
        old(a) - old(b) ||
        APARTADO_RANK.indexOf(a.apartado) - APARTADO_RANK.indexOf(b.apartado) ||
        (a.apartado === 'guia' ? byGuide(a, b) : (b.props.convocatoria ?? '').localeCompare(a.props.convocatoria ?? '') || byExam(a, b))
    )
    .slice(0, ROW);
}

function HomeView({
  model,
  subjects,
  featured,
  convocatoria,
  tasks,
  favorites,
  shelf,
  onSubject,
}: {
  model: BibModel;
  subjects: BibSubject[];
  featured: BibItem[];
  convocatoria: string | null | undefined;
  tasks: ExamTask[];
  favorites: ReadonlySet<string>;
  shelf: (label: string, items: BibItem[], showSubject?: boolean) => React.ReactNode;
  onSubject: (name: string) => void;
}) {
  const exams = useMemo(() => upcomingExams(subjects, tasks), [subjects, tasks]);
  const favoriteItems = useMemo(() => subjects.flatMap((s) => s.items.filter((it) => favorites.has(it.key))).sort(byTitle), [subjects, favorites]);
  const seeAll = (name: string) => (
    <Button variant="ghost" size="sm" onClick={() => onSubject(name)}>
      {tr('Ver todo')}
    </Button>
  );
  if (subjects.length === 0) return <p className="py-16 text-center text-sm text-muted-foreground">{tr('No hay archivos con ese filtro.')}</p>;
  return (
    <div className="flex flex-col gap-10">
      {featured.length > 0 && (
        <section>
          <SectionHeading title={tr('Destacados')} />
          {shelf(tr('Destacados'), featured)}
        </section>
      )}
      {convocatoria === undefined && model.config.convocatorias.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <ConvocatoriaChoice model={model} value={undefined} />
        </div>
      )}
      {exams.map((e) => {
        const items = prepFor(e.subject, convocatoria ?? null);
        if (!items.length) return null;
        const title = tr('Para tu examen de {asignatura}', { asignatura: e.subject.name });
        return (
          <section key={`examen:${e.subject.name}`}>
            <SectionHeading title={title} hint={`${e.name} · ${format(e.date, "EEEE d 'de' MMMM", { locale: dateLocale() })}`} action={seeAll(e.subject.name)} />
            {shelf(title, items, false)}
          </section>
        );
      })}
      {favoriteItems.length > 0 && (
        <section>
          <SectionHeading title={tr('Favoritos')} />
          {shelf(tr('Favoritos'), favoriteItems)}
        </section>
      )}
      {subjects.map((s) => (
        <section key={s.name}>
          <SectionHeading title={s.name} hint={archivos(s.items.length)} action={seeAll(s.name)} />
          {shelf(s.name, rowFor(s, convocatoria ?? null), false)}
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------
// Asignatura
// ------------------------------------------------------------

type Nivel = 'NM' | 'NS' | null;

function SubjectView({
  subject,
  convocatoria,
  card,
  shelf,
}: {
  subject: BibSubject;
  convocatoria: string | null;
  card: (item: BibItem, showSubject?: boolean) => React.ReactNode;
  shelf: (label: string, items: BibItem[], showSubject?: boolean) => React.ReactNode;
}) {
  const color = subjectColor(subject.name, subject.conf);
  const levels = (subject.conf.niveles ?? []).filter((n): n is 'NM' | 'NS' => n === 'NM' || n === 'NS');
  const nivelKey = `nivel:${subject.name}`;
  const [nivel, setNivelState] = useState<Nivel>(() => (levels.length > 1 ? extRead<Nivel>(AKLORE, nivelKey, null) : null));
  const setNivel = (n: Nivel) => {
    setNivelState(n);
    extWrite(AKLORE, nivelKey, n);
  };
  const items = subject.items.filter((it) => deNivel(it, nivel));
  const guide = items.filter((it) => it.apartado === 'guia').sort(byGuide);
  const present = TABS.filter((t) => items.some((it) => it.apartado === t.id));
  const [tab, setTab] = useState<Tab | null>(null);
  const current = present.find((t) => t.id === tab) ?? present[0];
  const vigente = convocatoria ? subject.conf.programa?.[convocatoria] : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3 border-l-4 pl-4" style={{ borderColor: color }}>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{subject.name}</h1>
          <p className="text-sm text-muted-foreground">
            {[subject.conf.grupo ? tr(subject.conf.grupo) : null, vigente ? tr('Tu programa: guía de {anio}', { anio: vigente }) : null].filter(Boolean).join(' · ')}
          </p>
        </div>
        {levels.length > 1 && (
          <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label={tr('Nivel')}>
            {([null, 'NM', 'NS'] as Nivel[]).map((n) => (
              <button
                key={n ?? 'todos'}
                type="button"
                onClick={() => setNivel(n)}
                aria-pressed={nivel === n}
                className={cn('rounded-md px-3 py-1 text-sm', nivel === n ? 'bg-card font-semibold text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
              >
                {n === null ? tr('Los dos niveles') : n === 'NM' ? tr('Nivel Medio') : tr('Nivel Superior')}
              </button>
            ))}
          </div>
        )}
      </header>

      {guide.length > 0 && (
        <section>
          <SectionHeading title={tr('Guía y programa')} />
          {shelf(tr('Guía y programa'), guide, false)}
        </section>
      )}

      {current && (
        <section>
          {present.length > 1 && (
            <div className="mb-5 flex gap-1 border-b border-border/60" role="tablist">
              {present.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={current.id === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn('-mb-px border-b-2 px-4 py-2 text-sm font-medium', current.id === t.id ? 'text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
                  style={current.id === t.id ? { borderColor: color } : undefined}
                >
                  {tr(t.label)} <span className="text-xs text-muted-foreground">{items.filter((it) => it.apartado === t.id).length}</span>
                </button>
              ))}
            </div>
          )}
          <Groups groups={groupsFor(current.id, items, subject, convocatoria)} card={card} />
        </section>
      )}
    </div>
  );
}

interface Group {
  title: string;
  hint?: string;
  items: BibItem[];
}

function Groups({ groups, card }: { groups: Group[]; card: (item: BibItem) => React.ReactNode }) {
  return (
    <div className="flex flex-col gap-8">
      {groups.map((g) => (
        <div key={g.title}>
          {/* Un solo grupo no necesita título: la pestaña ya dice qué es y cuántos son. */}
          {(groups.length > 1 || g.hint) && (
            <h3 className="mb-3 text-sm font-semibold text-foreground">
              {g.title} <span className="font-normal text-muted-foreground">· {g.items.length}</span>
            </h3>
          )}
          {g.hint && <p className="-mt-2 mb-3 text-xs text-muted-foreground">{g.hint}</p>}
          <ItemGrid>
            {g.items.map((it) => (
              <div key={it.id}>{card(it)}</div>
            ))}
          </ItemGrid>
        </div>
      ))}
    </div>
  );
}

function groupsFor(tab: Tab, all: BibItem[], subject: BibSubject, convocatoria: string | null): Group[] {
  const items = all.filter((it) => it.apartado === tab);
  const push = (map: Map<string, BibItem[]>, key: string, it: BibItem) => map.set(key, [...(map.get(key) ?? []), it]);

  if (tab === 'temas') {
    const order = subject.conf.temas ?? [];
    const map = new Map<string, BibItem[]>();
    for (const it of items) {
      const temas = temasDe(it);
      if (temas.length === 0) push(map, tr('Varios temas'), it);
      for (const t of temas) push(map, t, it);
    }
    const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length);
    return [...map].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'es', { numeric: true })).map(([title, list]) => ({ title, items: list.sort(byOrder) }));
  }

  if (tab === 'examenes') {
    const old = items.filter((it) => programaDe(it, subject.conf, convocatoria) === 'anterior');
    const byCall = new Map<string, BibItem[]>();
    const school: BibItem[] = [];
    const ai: BibItem[] = [];
    const other: BibItem[] = [];
    for (const it of items) {
      if (old.includes(it)) continue;
      if (it.tipo === 'simulacro') ai.push(it);
      else if (it.tipo === 'prueba-colegio') school.push(it);
      else if (it.props.convocatoria) push(byCall, it.props.convocatoria, it);
      else other.push(it);
    }
    // Las convocatorias, de la más reciente; luego el colegio, los simulacros y el resto.
    const groups: Group[] = [...byCall].sort((a, b) => b[0].localeCompare(a[0])).map(([call, list]) => ({ title: capitalize(convocatoriaLabel(call)), items: list.sort(byExam) }));
    if (school.length) groups.push({ title: tr('Pruebas del colegio'), items: school.sort(byOrder) });
    if (ai.length) groups.push({ title: tr('Simulacros hechos con IA'), hint: tr('Preguntas nuevas al estilo del IB: no son del IB ni anticipan el examen.'), items: ai.sort(byOrder) });
    if (other.length) groups.push({ title: tr('Otros'), items: other.sort(byExam) });
    if (old.length) groups.push({ title: tr('Del programa anterior'), hint: tr('Pueden incluir temas o formatos que ya no entran en tus exámenes.'), items: old.sort((a, b) => (b.props.convocatoria ?? '').localeCompare(a.props.convocatoria ?? '') || byExam(a, b)) });
    return groups;
  }

  if (tab === 'trabajos') {
    const order = subject.conf.componentes ?? [];
    const map = new Map<string, BibItem[]>();
    for (const it of items) push(map, it.props.componente || tr('Para tus trabajos'), it);
    const rank = (t: string) => (order.includes(t) ? order.indexOf(t) : order.length);
    return [...map].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], 'es')).map(([title, list]) => ({ title, items: list.sort(byOrder) }));
  }

  return [{ title: tr('Otros archivos'), items: items.sort(byTitle) }];
}

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
