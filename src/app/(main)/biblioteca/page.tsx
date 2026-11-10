import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Check, Download, Eye, FileText, FlaskConical, Library, ListChecks, LoaderCircle, Lock, Search, SlidersHorizontal, Star, TriangleAlert, X } from 'lucide-react';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ToastAction } from '@/components/ui/toast';
import { useCourse } from '@/context/CourseContext';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { useToast } from '@/hooks/use-toast';
import { useAkLoreAccess } from '@/lib/extensions/aklore/access';
import {
  demoAvailable,
  forgetOpenedFiles,
  searchGuides,
  setDemo,
  toggleFavorite,
  useLoreFavorites,
  useLoreIndex,
  useLoreSource,
  type LoreGuide,
  type LoreSource,
} from '@/lib/extensions/aklore/source';
import { blobToBase64, browserDownload, folderOf } from '@/lib/file-save';
import { formatBytes } from '@/lib/music-import';
import { trackEvent } from '@/lib/telemetry';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca (extensión AK Lore, 1.9.2): el material del Programa del
// Diploma en tarjetas, por secciones (grupos del PD) y asignaturas. Buscador
// con el total dentro, filtros, favoritos arriba (de la cuenta: viajan a sus
// otros dispositivos) y «Descarga por colección» (varios archivos a una
// carpeta de Descargas). Los archivos llegan por la nube de Frame; nadie ve
// el Drive de donde salen.
// ============================================================

interface Filters {
  section: string | null;
  subject: string | null;
  kind: string | null;
  lang: string | null;
  year: number | null;
}

const NO_FILTERS: Filters = { section: null, subject: null, kind: null, lang: null, year: null };

const KIND_ORDER = ['Guía', 'Examen', 'Esquema de calificación', 'Informe del examinador', 'Ejemplo calificado', 'Límites de calificación', 'Documento'];
const kindRank = (kind: string) => (KIND_ORDER.includes(kind) ? KIND_ORDER.indexOf(kind) : KIND_ORDER.length);

/** Tronco común, luego Grupo 1…6, luego el resto y «General» al final. */
function sectionRank(section: string): number {
  if (/^tronco/i.test(section)) return 0;
  const group = /^grupo\s+(\d)/i.exec(section);
  if (group) return Number(group[1]);
  return /^general/i.test(section) ? 99 : 50;
}

const byShelf = (a: LoreGuide, b: LoreGuide) =>
  a.subject.localeCompare(b.subject) || kindRank(a.kind) - kindRank(b.kind) || (b.year ?? 0) - (a.year ?? 0) || a.title.localeCompare(b.title, undefined, { numeric: true });

/** Lo que se lee en la tarjeta: las siglas del formato, o qué es si no las tiene. */
const formatLabel = (format: LoreGuide['format']) => (format === 'image' ? tr('Imagen') : format === 'other' ? tr('Archivo') : format.toUpperCase());

/** Fallos seguidos con los que una colección se da por perdida (la Biblioteca no responde). */
const COLLECTION_GIVE_UP = 3;

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'Inglés', 'es-en': 'Español e inglés' };
const langLabel = (lang: string) => (LANG_LABEL[lang] ? tr(LANG_LABEL[lang]) : lang.toUpperCase());

function matches(g: LoreGuide, f: Filters): boolean {
  return (
    (!f.section || g.section === f.section) &&
    (!f.subject || g.subject === f.subject) &&
    (!f.kind || g.kind === f.kind) &&
    (!f.lang || g.lang === f.lang) &&
    (!f.year || g.year === f.year)
  );
}

function countBy<T extends string | number>(guides: LoreGuide[], pick: (g: LoreGuide) => T | undefined): [T, number][] {
  const counts = new Map<T, number>();
  for (const g of guides) {
    const v = pick(g);
    if (v !== undefined && v !== '') counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts];
}

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
  const { userProfile } = useCourse();
  const navigate = useNavigate();
  const access = useAkLoreAccess(userProfile?.email);
  const source = useLoreSource();
  const index = useLoreIndex(access === 'allowed' ? source : null);
  const favorites = useLoreFavorites();
  const saveCopy = useSaveCopy();
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [viewing, setViewing] = useState<LoreGuide | null>(null);
  /** Colección en marcha: qué archivo va (`done`, de 1 a `total`). */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  /** Archivos sueltos que están bajando: su botón espera, no abre otra descarga. */
  const [downloading, setDownloading] = useState<ReadonlySet<string>>(new Set());
  const cancel = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      cancel.current?.abort();
      forgetOpenedFiles();
    },
    []
  );

  const found = useMemo(() => searchGuides(index.guides, query), [index.guides, query]);
  const visible = useMemo(
    () => found.filter((g) => matches(g, filters) && (!onlyFavorites || favorites.has(g.id))),
    [found, filters, onlyFavorites, favorites]
  );
  const favoriteGuides = useMemo(() => visible.filter((g) => favorites.has(g.id)).sort(byShelf), [visible, favorites]);
  /** Los favoritos que siguen en la Biblioteca (un archivo retirado no cuenta). */
  const favoriteCount = useMemo(() => index.guides.filter((g) => favorites.has(g.id)).length, [index.guides, favorites]);
  /** Lo que se filtra: lo encontrado y, con «Favoritos», solo esos. Cada grupo de filtros cuenta sobre esto. */
  const filterable = useMemo(() => (onlyFavorites ? found.filter((g) => favorites.has(g.id)) : found), [found, onlyFavorites, favorites]);
  const searching = query.trim().length > 0;
  const activeFilters = Object.values(filters).filter((v) => v !== null).length;

  /** Sin búsqueda: secciones → asignaturas. Con búsqueda: por relevancia. */
  const sections = useMemo(() => {
    if (searching || onlyFavorites) return [];
    const group = (list: LoreGuide[], keyOf: (g: LoreGuide) => string) => {
      const out = new Map<string, LoreGuide[]>();
      for (const g of list) {
        const bucket = out.get(keyOf(g));
        if (bucket) bucket.push(g);
        else out.set(keyOf(g), [g]);
      }
      return out;
    };
    return [...group(visible, (g) => g.section)]
      .sort((a, b) => sectionRank(a[0]) - sectionRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([section, guides]) => ({ section, count: guides.length, subjects: [...group([...guides].sort(byShelf), (g) => g.subject)] }));
  }, [visible, searching, onlyFavorites]);

  const selectedGuides = useMemo(() => index.guides.filter((g) => selected.has(g.id)), [index.guides, selected]);
  const selectedBytes = selectedGuides.reduce((sum, g) => sum + (g.size ?? 0), 0);

  const toggleSelected = (ids: string[], on?: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const add = on ?? !ids.every((id) => prev.has(id));
      ids.forEach((id) => (add ? next.add(id) : next.delete(id)));
      return next;
    });

  const downloadOne = async (guide: LoreGuide) => {
    if (downloading.has(guide.id)) return;
    const mark = (on: boolean) =>
      setDownloading((prev) => {
        const next = new Set(prev);
        if (on) next.add(guide.id);
        else next.delete(guide.id);
        return next;
      });
    mark(true);
    try {
      const { blob, fileName } = await source.open(guide);
      // Solo cuenta lo que de verdad quedó guardado.
      if ((await saveCopy(blob, fileName)) && source.id !== 'demo') trackEvent('library_download', { n: 1 });
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo descargar el archivo'), description: errorText(error).slice(0, 200) });
    } finally {
      mark(false);
    }
  };

  /**
   * «Descarga por colección»: uno tras otro, a «Descargas › Biblioteca AAAA-MM-DD».
   * Lo que no llegó a bajar se queda seleccionado, para seguir con un clic.
   */
  const downloadCollection = async () => {
    const guides = selectedGuides;
    if (guides.length === 0 || progress) return;
    const controller = new AbortController();
    cancel.current = controller;
    const folder = `${tr('Biblioteca')} ${format(new Date(), 'yyyy-MM-dd')}`;
    const saved = new Set<string>();
    let lastPath: string | null = null;
    let counted = 0;
    let stopped: string | null = null;
    let firstError: string | null = null;
    let failedInARow = 0;
    const failed: string[] = [];
    /** Se cuenta por tandas: si Frame se cierra a media colección, lo ya guardado queda contado. */
    const count = (all = false) => {
      const pending = saved.size - counted;
      if (source.id === 'demo' || pending === 0 || (!all && pending < 10)) return;
      trackEvent('library_download', { n: pending, collection: true });
      counted = saved.size;
    };
    for (const [i, guide] of guides.entries()) {
      if (controller.signal.aborted) break;
      setProgress({ done: i + 1, total: guides.length });
      try {
        const { blob, fileName } = await source.open(guide, controller.signal);
        if (isTauri()) lastPath = await invoke<string>('save_file_in_folder', { folder, fileName, dataBase64: await blobToBase64(blob) });
        else browserDownload(blob, fileName);
        saved.add(guide.id);
        failedInARow = 0;
        count();
      } catch (error) {
        if (controller.signal.aborted) break;
        if ((error as { stop?: boolean }).stop) {
          stopped = errorText(error);
          break;
        }
        failed.push(guide.title);
        firstError ??= errorText(error).slice(0, 160);
        failedInARow += 1;
        // La Biblioteca no responde (o el equipo no deja guardar): insistir con el resto solo gasta el tope del día.
        if (failedInARow >= COLLECTION_GIVE_UP) {
          stopped = firstError;
          break;
        }
      }
    }
    cancel.current = null;
    setProgress(null);
    count(true);
    const done = saved.size;
    setSelected((prev) => new Set([...prev].filter((id) => !saved.has(id))));
    if (done === guides.length) setSelecting(false);
    const path = lastPath;
    toast({
      variant: done === 0 ? 'destructive' : 'default',
      title: done === guides.length ? tr('Colección descargada') : tr('{done} de {total} archivos descargados', { done, total: guides.length }),
      description:
        stopped ??
        (failed.length
          ? `${tr('No se pudieron bajar: {names}', { names: failed.slice(0, 3).join(' · ') + (failed.length > 3 ? '…' : '') })}${firstError ? ` (${firstError})` : ''}`
          : path
            ? tr('Guardados en {folder}', { folder: folderOf(path) })
            : undefined),
      duration: 10000,
      action: path ? (
        <ToastAction altText={tr('Mostrar en su carpeta')} onClick={() => void invoke('reveal_recording', { path }).catch(() => undefined)}>
          {tr('Mostrar')}
        </ToastAction>
      ) : undefined,
    });
  };

  const favoriteFailed = () =>
    toast({ variant: 'destructive', title: tr('No se pudo guardar el favorito'), description: tr('No hay espacio en el equipo para guardarlo.') });

  if (access === 'checking') {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }
  if (access !== 'allowed') {
    return (
      <Notice icon={Lock} title={tr('La Biblioteca es para cuentas del colegio')}>
        <p className="text-sm text-muted-foreground">
          {access === 'off'
            ? tr('Activa la extensión AK Lore en Extensiones (búscala por su nombre), con la cuenta del colegio.')
            : tr('Entra con tu cuenta del colegio para buscar y descargar el material.')}
        </p>
        <Button variant="outline" onClick={() => navigate('/extensiones?ext=frame.aklore')}>
          {tr('Ir a Extensiones')}
        </Button>
      </Notice>
    );
  }

  const card = (g: LoreGuide) => (
    <GuideCard
      key={g.id}
      guide={g}
      favorite={favorites.has(g.id)}
      selecting={selecting}
      selected={selected.has(g.id)}
      onSelect={() => toggleSelected([g.id])}
      downloading={downloading.has(g.id)}
      onView={() => setViewing(g)}
      onDownload={() => void downloadOne(g)}
      onFavoriteFailed={favoriteFailed}
    />
  );
  // A un tercio del ancho disponible; solo en ventanas muy estrechas, a la mitad o entera.
  const grid = (guides: LoreGuide[]) => <ul className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2 min-[900px]:grid-cols-3">{guides.map(card)}</ul>;

  return (
    <div className="p-6 pt-4 md:p-8 md:pt-4">
      {/* Buscador (con el total dentro, como en Música) · Filtros · Favoritos · Colección */}
      <div className="mt-2 mb-6 flex flex-wrap items-center gap-3">
        <label
          htmlFor="library-search"
          // Hasta la mitad del ancho, como en Música; cede lo justo para que los tres botones queden en su misma fila.
          className="flex h-10 w-full min-w-0 cursor-text items-center gap-2 rounded-md border border-primary bg-card px-3 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 md:w-auto md:min-w-[16rem] md:max-w-[50%] md:flex-1 md:basis-0"
        >
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <input
            id="library-search"
            type="text"
            placeholder={tr('Buscar guías, exámenes, asignaturas…')}
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
            <span className="font-semibold text-foreground/70">
              {visible.length === index.guides.length ? index.guides.length : tr('{shown} de {total}', { shown: visible.length, total: index.guides.length })}
            </span>{' '}
            {index.guides.length === 1 ? tr('archivo') : tr('archivos')}
          </span>
        </label>

        <FiltersButton guides={filterable} filters={filters} active={activeFilters} onChange={setFilters} />

        <Button
          variant={onlyFavorites ? 'default' : 'outline'}
          className="gap-2"
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites((v) => !v)}
          title={tr('Ver solo tus favoritos')}
        >
          <Star className={cn('h-4 w-4', onlyFavorites && 'fill-current')} />
          {tr('Favoritos')}
          {favoriteCount > 0 && <span className="text-xs tabular-nums opacity-80">{favoriteCount}</span>}
        </Button>

        <Button
          variant={selecting ? 'default' : 'outline'}
          className="gap-2"
          aria-pressed={selecting}
          disabled={!!progress}
          onClick={() => {
            setSelecting((v) => !v);
            setSelected(new Set());
          }}
        >
          <ListChecks className="h-4 w-4" />
          {tr('Descarga por colección')}
        </Button>

        {source.id === 'demo' && (
          <Button size="sm" variant="ghost" className="ml-auto text-xs" onClick={() => setDemo(false)}>
            {tr('Salir del ejemplo')}
          </Button>
        )}
      </div>

      {index.error && (
        <p className="mb-5 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">
            {index.guides.length > 0 ? tr('No se pudo actualizar; se muestra la copia guardada en este equipo.') : tr('No se pudo cargar la Biblioteca.')} {index.error}
          </span>
          <button type="button" className="font-semibold underline" onClick={index.reload}>
            {tr('Reintentar')}
          </button>
        </p>
      )}

      {index.loading && index.guides.length === 0 ? (
        <div className="flex h-40 items-center justify-center">
          <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : index.guides.length === 0 ? (
        !index.error && (
          <Notice icon={Library} title={tr('La Biblioteca se está llenando')}>
            <p className="text-sm text-muted-foreground">{tr('El material del Programa del Diploma está llegando. Vuelve en un rato: aparecerá aquí sin que hagas nada.')}</p>
            {demoAvailable && (
              <Button variant="outline" onClick={() => setDemo(true)}>
                <FlaskConical className="mr-2 h-4 w-4" />
                {tr('Probar con datos de ejemplo (desarrollo)')}
              </Button>
            )}
          </Notice>
        )
      ) : visible.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {onlyFavorites && favoriteCount === 0
            ? tr('Aún no tienes favoritos: toca la estrella de un archivo para guardarlo aquí.')
            : activeFilters > 0 || !searching
              ? tr('Ningún archivo cumple esos filtros.')
              : tr('Nada coincide con «{query}».', { query })}
        </p>
      ) : (
        <div className="space-y-10">
          {favoriteGuides.length > 0 && !onlyFavorites && (
            <section aria-labelledby="library-favorites">
              <SectionTitle id="library-favorites" icon={<Star className="h-4 w-4 fill-amber-400 text-amber-400" />} title={tr('Favoritos')} count={favoriteGuides.length} />
              {grid(favoriteGuides)}
            </section>
          )}

          {searching || onlyFavorites ? (
            <section aria-labelledby="library-results">
              <SectionTitle
                id="library-results"
                title={onlyFavorites ? tr('Tus favoritos') : tr('Resultados')}
                count={visible.length}
                onSelectAll={selecting ? () => toggleSelected(visible.map((g) => g.id)) : undefined}
              />
              {grid(onlyFavorites && !searching ? [...visible].sort(byShelf) : visible)}
            </section>
          ) : (
            sections.map(({ section, count, subjects }) => (
              <section key={section} aria-label={section}>
                <SectionTitle
                  title={section}
                  count={count}
                  onSelectAll={selecting ? () => toggleSelected(subjects.flatMap(([, guides]) => guides.map((g) => g.id))) : undefined}
                />
                <div className="space-y-6">
                  {subjects.map(([subject, guides]) => (
                    <div key={subject}>
                      <h3 className="mb-2 text-sm font-semibold text-foreground/80">
                        {subject} <span className="font-normal text-muted-foreground">· {guides.length}</span>
                      </h3>
                      {grid(guides)}
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}

          <p className="text-center text-[11px] text-muted-foreground">{tr('El material es de sus autores (IB) y está aquí solo para que estudies con él.')}</p>
        </div>
      )}

      {selecting && (
        <div className="sticky bottom-4 z-20 mx-auto mt-6 flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur">
          <span className="text-sm font-semibold text-foreground">
            {progress
              ? tr('Descargando {done} de {total}…', progress)
              : selected.size === 0
                ? tr('Toca los archivos que quieras bajar juntos')
                : `${selected.size === 1 ? tr('1 seleccionado') : tr('{count} seleccionados', { count: selected.size })} · ${formatBytes(selectedBytes)}`}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {progress ? (
              <Button size="sm" variant="ghost" onClick={() => cancel.current?.abort()}>
                {tr('Detener')}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={() => toggleSelected(visible.map((g) => g.id), true)}>
                  {tr('Seleccionar lo visible')}
                </Button>
                {selected.size > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    {tr('Vaciar')}
                  </Button>
                )}
              </>
            )}
            <Button size="sm" disabled={selected.size === 0 || !!progress} onClick={() => void downloadCollection()}>
              {progress ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {tr('Descargar ({count})', { count: selected.size })}
            </Button>
          </div>
        </div>
      )}

      <GuideViewer guide={viewing} source={source} downloading={!!viewing && downloading.has(viewing.id)} onClose={() => setViewing(null)} onDownload={downloadOne} />
    </div>
  );
}

function SectionTitle({ id, icon, title, count, onSelectAll }: { id?: string; icon?: React.ReactNode; title: string; count: number; onSelectAll?: () => void }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-border/60 pb-2">
      {icon}
      <h2 id={id} className="font-headline text-lg font-bold text-primary">
        {title}
      </h2>
      <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      {onSelectAll && (
        <button type="button" onClick={onSelectAll} className="ml-auto text-xs font-semibold text-primary hover:underline">
          {tr('Seleccionar sección')}
        </button>
      )}
    </div>
  );
}

function FiltersButton({ guides, filters, active, onChange }: { guides: LoreGuide[]; filters: Filters; active: number; onChange: (f: Filters) => void }) {
  /**
   * Los valores de un grupo, contados con los DEMÁS filtros puestos: lo que se
   * ofrece es lo que de verdad saldría al pulsarlo. El valor activo está
   * siempre (aunque quede en 0), para poder quitarlo.
   */
  function valuesOf<T extends string | number>(key: keyof Filters, pick: (g: LoreGuide) => T | undefined, order: (a: [T, number], b: [T, number]) => number): [string | number, number][] {
    const others = guides.filter((g) => matches(g, { ...filters, [key]: null }));
    const values = countBy(others, pick);
    const on = filters[key] as T | null;
    if (on !== null && !values.some(([value]) => value === on)) values.push([on, 0]);
    return values.sort(order);
  }
  const groups: { key: keyof Filters; label: string; values: [string | number, number][]; show: (v: string | number) => string }[] = [
    { key: 'section', label: tr('Sección'), values: valuesOf('section', (g) => g.section, (a, b) => sectionRank(a[0]) - sectionRank(b[0])), show: String },
    { key: 'subject', label: tr('Asignatura'), values: valuesOf('subject', (g) => g.subject, (a, b) => a[0].localeCompare(b[0])), show: String },
    { key: 'kind', label: tr('Tipo'), values: valuesOf('kind', (g) => g.kind, (a, b) => kindRank(a[0]) - kindRank(b[0])), show: (v) => tr(String(v)) },
    { key: 'lang', label: tr('Idioma'), values: valuesOf('lang', (g) => g.lang, (a, b) => a[0].localeCompare(b[0])), show: (v) => langLabel(String(v)) },
    { key: 'year', label: tr('Año'), values: valuesOf('year', (g) => g.year, (a, b) => b[0] - a[0]), show: String },
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={active ? 'default' : 'outline'} className="gap-2">
          <SlidersHorizontal className="h-4 w-4" />
          {tr('Filtros')}
          {active > 0 && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{active}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70vh] w-[min(26rem,90vw)] space-y-4 overflow-y-auto">
        {groups.map(({ key, label, values, show }) =>
          values.length < 2 && filters[key] === null ? null : (
            <div key={key}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
              <div className="flex flex-wrap gap-1.5">
                {values.map(([value, count]) => {
                  const on = filters[key] === value;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={on}
                      onClick={() => onChange({ ...filters, [key]: on ? null : value })}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 text-foreground/80 hover:border-primary/50'
                      )}
                    >
                      {show(value)} <span className={cn('text-[10px]', on ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )}
        {active > 0 && (
          <Button size="sm" variant="ghost" className="w-full" onClick={() => onChange(NO_FILTERS)}>
            {tr('Quitar filtros')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function GuideCard({
  guide: g,
  favorite,
  selecting,
  selected,
  downloading,
  onSelect,
  onView,
  onDownload,
  onFavoriteFailed,
}: {
  guide: LoreGuide;
  favorite: boolean;
  selecting: boolean;
  selected: boolean;
  downloading: boolean;
  onSelect: () => void;
  onView: () => void;
  onDownload: () => void;
  onFavoriteFailed: () => void;
}) {
  const details = [g.subject, g.component, g.year].filter(Boolean).join(' · ');
  const facts = [formatLabel(g.format), g.size ? formatBytes(g.size) : null, g.pages ? tr('{count} págs.', { count: g.pages }) : null, g.lang?.toUpperCase().replace('-', '/')]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      className={cn(
        'relative flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-colors',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border/60 hover:border-primary/40',
        selecting && 'cursor-pointer'
      )}
      onClick={selecting ? onSelect : undefined}
    >
      <div className="flex items-start gap-3">
        {selecting ? (
          <span
            role="checkbox"
            aria-checked={selected}
            aria-label={g.title}
            tabIndex={0}
            onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && (e.preventDefault(), onSelect())}
            className={cn(
              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card',
              selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50'
            )}
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-primary">{tr(g.kind)}</p>
          <h3 className="line-clamp-2 text-sm font-semibold text-foreground" title={g.title}>
            {g.title}
          </h3>
          {details && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{details}</p>}
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (!toggleFavorite(g.id)) onFavoriteFailed();
          }}
          aria-pressed={favorite}
          aria-label={favorite ? tr('Quitar de favoritos') : tr('Añadir a favoritos')}
          title={favorite ? tr('Quitar de favoritos') : tr('Añadir a favoritos')}
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Star className={cn('h-4 w-4', favorite && 'fill-amber-400 text-amber-400')} />
        </button>
      </div>
      {g.summary && <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{g.summary}</p>}
      {/* Los datos en su línea y los botones debajo: a un tercio del ancho no caben juntos (y en alemán, menos). */}
      <div className="mt-auto pt-3">
        <p className="truncate text-[11px] text-muted-foreground" title={facts}>
          {facts}
        </p>
        {!selecting && (
          <div className="mt-2 flex flex-wrap justify-end gap-1.5">
            {g.format === 'pdf' && (
              <Button size="sm" variant="ghost" className="h-7 min-w-0 px-2 text-xs" onClick={onView}>
                <Eye className="mr-1 h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{tr('Ver')}</span>
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 min-w-0 px-2 text-xs" onClick={onDownload} disabled={downloading} aria-busy={downloading}>
              {downloading ? <LoaderCircle className="mr-1 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{tr('Descargar')}</span>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

/** Solo se muestra lo que de verdad es PDF (por sus primeros bytes). */
const isPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d;

function GuideViewer({
  guide,
  source,
  downloading,
  onClose,
  onDownload,
}: {
  guide: LoreGuide | null;
  source: LoreSource;
  downloading: boolean;
  onClose: () => void;
  onDownload: (guide: LoreGuide) => Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unviewable'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setUrl(null);
    setState('loading');
    setError(null);
    if (!guide) return;
    // Lo que no es PDF no se puede ver aquí: bajarlo entero para decirlo gastaba del tope del día.
    if (guide.format !== 'pdf') {
      setState('unviewable');
      return;
    }
    const controller = new AbortController();
    let made: string | null = null;
    source
      .open(guide, controller.signal)
      .then(async ({ blob }) => {
        const pdf = guide.format === 'pdf' && isPdf(new Uint8Array(await blob.slice(0, 8).arrayBuffer()));
        if (controller.signal.aborted) return;
        // Un blob: tiene el origen de Frame: con el tipo forzado a PDF, un
        // HTML disfrazado no se ejecuta aquí.
        made = pdf ? URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })) : null;
        setUrl(made);
        setState(made ? 'ready' : 'unviewable');
      })
      .catch((e) => !controller.signal.aborted && setError(errorText(e)));
    return () => {
      controller.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [guide, source]);

  return (
    <Dialog open={!!guide} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        {guide && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{guide.title}</DialogTitle>
              <DialogDescription>{[guide.subject, tr(guide.kind), guide.component, guide.year].filter(Boolean).join(' · ')}</DialogDescription>
            </DialogHeader>
            <div className="min-h-[16rem] flex-1 overflow-auto rounded-lg border border-border/60 bg-background">
              {error ? (
                <p className="p-6 text-sm text-destructive">{error}</p>
              ) : state === 'loading' ? (
                <div className="flex h-64 items-center justify-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : url ? (
                <iframe src={url} title={guide.title} className="h-[65vh] w-full" />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">{tr('Este archivo no se puede ver aquí: descárgalo para abrirlo con su programa.')}</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void onDownload(guide)} disabled={downloading} aria-busy={downloading}>
                {downloading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                {tr('Descargar')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
