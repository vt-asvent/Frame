import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, FlaskConical, KeyRound, LoaderCircle, Lock, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { addDays, format, isAfter, isBefore, parseISO, startOfDay } from 'date-fns';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
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
  deNivel,
  fileNameOf,
  forgetBibFiles,
  openItem,
  programaDe,
  searchItems,
  setConvocatoria,
  temasDe,
  useBiblioteca,
  useStudy,
  type BibItem,
  type BibModel,
  type BibSubject,
} from '@/lib/extensions/aklore/biblioteca';
import { forgetPdfs } from '@/lib/extensions/aklore/pdf';
import { demoAvailable, fold, setDemo, toggleFavorite, useLoreFavorites, useLoreSource } from '@/lib/extensions/aklore/source';
import { extRead, extWrite } from '@/lib/extensions/store';
import { trackEvent } from '@/lib/telemetry';
import { dateLocale, errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AKLORE } from '@/lib/extensions/aklore/source';

// ============================================================
// Biblioteca (1.9.7): la carpeta «AK Lore» del Drive de Asvent, para
// personas. Inicio: buscador, lo que sirve para tus próximos exámenes (los de
// Tareas), Destacados, Favoritos y las asignaturas por secciones. Asignatura:
// «Guía y programa» arriba y luego Temas, Exámenes y Trabajos. Cada archivo se
// abre en un diálogo con su descripción y su vista previa (BibFileDialog).
// Lo que se sube o se mueve en Drive aparece en unos minutos, sin actualizar.
// ============================================================

type Tab = 'temas' | 'examenes' | 'trabajos' | 'otros';
const TABS: { id: Tab; label: string }[] = [
  { id: 'temas', label: 'Temas' },
  { id: 'examenes', label: 'Exámenes' },
  { id: 'trabajos', label: 'Trabajos' },
  { id: 'otros', label: 'Otros' },
];

const archivos = (n: number) => (n === 1 ? tr('1 archivo') : tr('{n} archivos', { n }));

const byTitle = (a: BibItem, b: BibItem) => a.title.localeCompare(b.title, 'es', { numeric: true });

/** Primero lo que va antes en una serie (`orden`), luego por título. */
const byOrder = (a: BibItem, b: BibItem) => (Number(a.props.orden) || 999) - (Number(b.props.orden) || 999) || byTitle(a, b);

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

export default function BibliotecaPage() {
  const { userProfile, tasks } = useCourse();
  const navigate = useNavigate();
  const access = useAkLoreAccess(userProfile?.id);
  const [activating, setActivating] = useState(false);
  useLoreSource(); // se vuelve a pintar al cambiar los datos de ejemplo
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

  useEffect(
    () => () => {
      forgetBibFiles();
      forgetPdfs();
    },
    []
  );

  const model = bib.model;
  const subject = model && subjectName ? model.subjects.find((s) => s.name === subjectName) ?? null : null;
  const confOf = (item: BibItem) => model?.subjects.find((s) => s.name === item.subject)?.conf;
  const colorOf = (item: BibItem) => subjectColor(item.subject, confOf(item));

  const openSubject = (name: string | null) => {
    setOpened(null);
    setQuery('');
    setParams(name ? { a: name } : {});
    document.querySelector('main')?.scrollTo({ top: 0 });
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
      color={colorOf(item)}
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

  const searching = query.trim().length > 0;
  const found = model && searching ? searchItems(subject ? subject.items : model.items, query) : [];
  const total = model ? (subject ? subject.items.length : model.items.length) : 0;

  return (
    <div className="p-6 pt-4 md:p-8 md:pt-4">
      {/* Buscador (con el total dentro) · convocatoria */}
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        {subject && (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => openSubject(null)}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {tr('Biblioteca')}
          </Button>
        )}
        <label
          htmlFor="library-search"
          className="flex h-10 w-full min-w-0 cursor-text items-center gap-2 rounded-md border border-primary bg-card px-3 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 md:w-auto md:min-w-[16rem] md:max-w-[50%] md:flex-1 md:basis-0"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            id="library-search"
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
            {searching ? tr('{n} de {total}', { n: found.length, total }) : archivos(total)}
          </span>
        </label>
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
        <SubjectView subject={subject} convocatoria={convocatoria ?? null} card={card} shelf={shelf} />
      ) : (
        <HomeView model={model} convocatoria={convocatoria} tasks={tasks} favorites={favorites} shelf={shelf} onSubject={openSubject} />
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
function upcomingExams(model: BibModel, tasks: ExamTask[]): { subject: BibSubject; date: Date; name: string }[] {
  const today = startOfDay(new Date());
  const limit = addDays(today, 22);
  const out: { subject: BibSubject; date: Date; name: string }[] = [];
  for (const t of tasks) {
    if (t.kind !== 'Examen' || !t.dueDate || t.progress >= 100) continue;
    const date = parseISO(t.dueDate);
    if (isBefore(date, today) || isAfter(date, limit)) continue;
    const course = fold(`${t.courseName} ${t.name}`);
    const subject = model.subjects.find((s) => [s.name, ...(s.conf.alias ?? [])].some((a) => a && course.includes(fold(a))));
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
    .slice(0, 12);
}

function HomeView({
  model,
  convocatoria,
  tasks,
  favorites,
  shelf,
  onSubject,
}: {
  model: BibModel;
  convocatoria: string | null | undefined;
  tasks: ExamTask[];
  favorites: ReadonlySet<string>;
  shelf: (label: string, items: BibItem[], showSubject?: boolean) => React.ReactNode;
  onSubject: (name: string) => void;
}) {
  const exams = useMemo(() => upcomingExams(model, tasks), [model, tasks]);
  const favoriteItems = useMemo(() => model.items.filter((it) => favorites.has(it.key)).sort(byTitle), [model, favorites]);
  return (
    <div className="flex flex-col gap-10">
      {convocatoria === undefined && model.config.convocatorias.length > 0 && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-4">
          <ConvocatoriaChoice model={model} value={undefined} />
        </div>
      )}
      {exams.map((e) => {
        const items = prepFor(e.subject, convocatoria ?? null);
        if (!items.length) return null;
        return (
          <section key={e.subject.name}>
            <SectionHeading
              title={tr('Para tu examen de {asignatura}', { asignatura: e.subject.name })}
              hint={`${e.name} · ${format(e.date, "EEEE d 'de' MMMM", { locale: dateLocale() })}`}
              action={
                <Button variant="ghost" size="sm" onClick={() => onSubject(e.subject.name)}>
                  {tr('Ver todo')}
                </Button>
              }
            />
            {shelf(tr('Para tu examen de {asignatura}', { asignatura: e.subject.name }), items, false)}
          </section>
        );
      })}
      {model.featured.length > 0 && (
        <section>
          <SectionHeading title={tr('Destacados')} />
          {shelf(tr('Destacados'), model.featured)}
        </section>
      )}
      {favoriteItems.length > 0 && (
        <section>
          <SectionHeading title={tr('Favoritos')} />
          {shelf(tr('Favoritos'), favoriteItems)}
        </section>
      )}
      {model.sections.map((section) => (
        <section key={section.name}>
          <SectionHeading title={tr(section.name)} />
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3">
            {section.subjects.map((s) => (
              <SubjectTile key={s.name} subject={s} onOpen={() => onSubject(s.name)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SubjectTile({ subject, onOpen }: { subject: BibSubject; onOpen: () => void }) {
  const color = subjectColor(subject.name, subject.conf);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-stretch overflow-hidden rounded-xl border border-border/60 bg-card text-left transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="w-2 shrink-0" style={{ background: color }} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 p-4">
        <span className="truncate text-base font-bold text-foreground">{subject.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {[subject.conf.grupo ? tr(subject.conf.grupo) : null, archivos(subject.items.length)].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
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
  const GUIDE_RANK = ['guia', 'programa', 'cuadernillo'];
  const guideRank = (it: BibItem) => (GUIDE_RANK.includes(it.tipo) ? GUIDE_RANK.indexOf(it.tipo) : GUIDE_RANK.length);
  const guide = items
    .filter((it) => it.apartado === 'guia')
    .sort((a, b) => (b.props.guia ?? '').localeCompare(a.props.guia ?? '') || guideRank(a) - guideRank(b) || byOrder(a, b));
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
          <h3 className="mb-3 text-sm font-semibold text-foreground">
            {g.title} <span className="font-normal text-muted-foreground">· {g.items.length}</span>
          </h3>
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
    const TYPE_RANK = ['examen', 'esquema', 'informe', 'respuesta-calificada'];
    const inside = (a: BibItem, b: BibItem) =>
      (a.props.componente ?? '').localeCompare(b.props.componente ?? '', 'es', { numeric: true }) ||
      TYPE_RANK.indexOf(a.tipo) - TYPE_RANK.indexOf(b.tipo) ||
      (a.props.zona ?? '').localeCompare(b.props.zona ?? '') ||
      byOrder(a, b);
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
    const groups: Group[] = [...byCall].sort((a, b) => b[0].localeCompare(a[0])).map(([call, list]) => ({ title: capitalize(convocatoriaLabel(call)), items: list.sort(inside) }));
    if (school.length) groups.push({ title: tr('Pruebas del colegio'), items: school.sort(byOrder) });
    if (ai.length) groups.push({ title: tr('Simulacros hechos con IA'), hint: tr('Preguntas nuevas al estilo del IB: no son del IB ni anticipan el examen.'), items: ai.sort(byOrder) });
    if (other.length) groups.push({ title: tr('Otros'), items: other.sort(inside) });
    if (old.length) groups.push({ title: tr('Del programa anterior'), hint: tr('Pueden incluir temas o formatos que ya no entran en tus exámenes.'), items: old.sort((a, b) => (b.props.convocatoria ?? '').localeCompare(a.props.convocatoria ?? '') || inside(a, b)) });
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
