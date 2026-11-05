import { useEffect, useMemo, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileSpreadsheet,
  FileText,
  FlaskConical,
  Library,
  Link2,
  LoaderCircle,
  Lock,
  Presentation,
  RefreshCw,
  Search,
  TriangleAlert,
  Unplug,
  X,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCourse } from '@/context/CourseContext';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { useAkLoreAccess } from '@/lib/extensions/aklore/access';
import {
  demoAvailable,
  searchGuides,
  setDemo,
  useLoreIndex,
  useLoreSource,
  type LoreContent,
  type LoreGuide,
  type LoreSource,
} from '@/lib/extensions/aklore/source';
import { formatBytes } from '@/lib/music-import';
import { dateLocale, errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// AK Lore (extensión, 1.7.3): buscar, ver y descargar las guías del
// material recopilado del colegio. Solo para cuentas del colegio. Mientras
// no haya fuente conectada, la pantalla lo dice (la elige Diego).
// ============================================================

const FORMAT_ICON: Record<LoreGuide['format'], typeof FileText> = {
  pdf: FileText,
  docx: FileText,
  pptx: Presentation,
  xlsx: FileSpreadsheet,
  md: FileText,
  txt: FileText,
  image: FileImage,
  link: Link2,
  other: FileText,
};

const FORMAT_LABEL: Record<LoreGuide['format'], string> = {
  pdf: 'PDF',
  docx: 'Word',
  pptx: 'PowerPoint',
  xlsx: 'Excel',
  md: 'Texto',
  txt: 'Texto',
  image: 'Imagen',
  link: 'Enlace',
  other: 'Archivo',
};

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

function Chips({ label, values, active, onPick }: { label: string; values: [string, number][]; active: string | null; onPick: (v: string | null) => void }) {
  if (values.length < 2) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-bold text-muted-foreground">{label}</span>
      {values.map(([value, count]) => (
        <button
          key={value}
          type="button"
          onClick={() => onPick(active === value ? null : value)}
          aria-pressed={active === value}
          className={cn(
            'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
            active === value ? 'border-primary bg-primary text-primary-foreground' : 'border-border/70 text-foreground/80 hover:border-primary/50'
          )}
        >
          {value} <span className={cn('text-[10px]', active === value ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{count}</span>
        </button>
      ))}
    </div>
  );
}

const countBy = (guides: LoreGuide[], pick: (g: LoreGuide) => string | undefined): [string, number][] => {
  const counts = new Map<string, number>();
  for (const g of guides) {
    const v = pick(g);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
};

export default function AkLorePage() {
  const { userProfile } = useCourse();
  const navigate = useNavigate();
  const access = useAkLoreAccess(userProfile?.email);
  const source = useLoreSource();
  const index = useLoreIndex(access === 'allowed' ? source : null);
  const [query, setQuery] = useState('');
  const [subject, setSubject] = useState<string | null>(null);
  const [kind, setKind] = useState<string | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [viewing, setViewing] = useState<LoreGuide | null>(null);
  const saveCopy = useSaveCopy();
  const { toast } = useToast();

  const found = useMemo(() => searchGuides(index.guides, query), [index.guides, query]);
  const results = found.filter((g) => (!subject || g.subject === subject) && (!kind || g.kind === kind) && (!grade || g.grade === grade));
  const filtered = !!(subject || kind || grade);

  const download = async (guide: LoreGuide) => {
    if (!source) return;
    try {
      const content = await source.open(guide);
      if (content.kind === 'link') await openLink(content.url);
      else await saveCopy(content.blob, content.fileName);
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo descargar la guía'), description: errorText(error).slice(0, 200) });
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
      <Notice icon={Lock} title={tr('AK Lore es para cuentas del colegio')}>
        <p className="text-sm text-muted-foreground">
          {access === 'off'
            ? tr('Instala o activa la extensión AK Lore en Ajustes › Extensiones, con la cuenta del colegio.')
            : tr('Entra con tu cuenta del colegio para buscar y descargar las guías.')}
        </p>
        <Button variant="outline" onClick={() => navigate('/settings#extensiones')}>
          {tr('Ir a Extensiones')}
        </Button>
      </Notice>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-10">
      <header className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-card p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <Library className="h-6 w-6 text-primary" />
        </span>
        <div className="min-w-[16rem] flex-1">
          <h1 className="font-headline text-2xl font-bold text-primary">AK Lore</h1>
          <p className="text-sm text-muted-foreground">{tr('Guías del material recopilado del colegio: búscalas, míralas y descárgalas.')}</p>
        </div>
        <SourceBadge source={source} at={index.at} loading={index.loading} onReload={index.reload} />
      </header>

      {!source ? (
        <Notice icon={Unplug} title={tr('El material aún no está conectado')}>
          <p className="text-sm text-muted-foreground">
            {tr('AK Lore ya está lista: en cuanto el material recopilado tenga su sitio, las guías aparecerán aquí sin que tengas que hacer nada.')}
          </p>
          {demoAvailable && (
            <Button variant="outline" onClick={() => setDemo(true)}>
              <FlaskConical className="mr-2 h-4 w-4" />
              {tr('Probar con datos de ejemplo (desarrollo)')}
            </Button>
          )}
        </Notice>
      ) : (
        <>
          <div className="space-y-3 rounded-xl border border-border/60 bg-card p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('Busca por tema, asignatura o palabra clave…')}
                className="h-11 pl-9 pr-9 text-sm"
                aria-label={tr('Buscar guías')}
                autoFocus
              />
              {query && (
                <button type="button" onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label={tr('Borrar la búsqueda')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Chips label={tr('Asignatura')} values={countBy(found, (g) => g.subject)} active={subject} onPick={setSubject} />
            <Chips label={tr('Tipo')} values={countBy(found, (g) => g.kind)} active={kind} onPick={setKind} />
            <Chips label={tr('Grado')} values={countBy(found, (g) => g.grade)} active={grade} onPick={setGrade} />
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{tr('{count} guías', { count: results.length })}</span>
              {filtered && (
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setSubject(null);
                    setKind(null);
                    setGrade(null);
                  }}
                >
                  {tr('Quitar filtros')}
                </button>
              )}
            </div>
          </div>

          {index.error && (
            <p className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">
                {index.guides.length > 0 ? tr('No se pudo actualizar; se muestra la copia guardada en este equipo.') : tr('No se pudo cargar el material.')} {index.error}
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
          ) : results.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {query ? tr('Nada coincide con «{query}».', { query }) : tr('Aún no hay guías.')}
            </p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {results.map((g) => {
                const Icon = FORMAT_ICON[g.format];
                return (
                  <li key={g.id} className="flex flex-col rounded-xl border border-border/60 bg-card p-4 transition-colors hover:border-primary/40">
                    <div className="flex items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Icon className="h-5 w-5 text-primary" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-sm font-semibold text-foreground">{g.title}</h3>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{[g.subject, g.kind, g.grade].filter(Boolean).join(' · ')}</p>
                      </div>
                    </div>
                    {g.summary && <p className="mt-2 line-clamp-2 text-xs text-foreground/80">{g.summary}</p>}
                    <div className="mt-auto flex items-center gap-2 pt-3 text-[11px] text-muted-foreground">
                      <span className="min-w-0 flex-1 truncate">
                        {tr(FORMAT_LABEL[g.format])}
                        {g.size ? ` · ${formatBytes(g.size)}` : ''}
                        {' · '}
                        {new Date(g.updated).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                      </span>
                      {g.format !== 'link' && (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setViewing(g)}>
                          <Eye className="mr-1 h-3.5 w-3.5" />
                          {tr('Ver')}
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => void download(g)}>
                        {g.format === 'link' ? <ExternalLink className="mr-1 h-3.5 w-3.5" /> : <Download className="mr-1 h-3.5 w-3.5" />}
                        {g.format === 'link' ? tr('Abrir') : tr('Descargar')}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <GuideViewer guide={viewing} source={source} onClose={() => setViewing(null)} onDownload={download} />
    </div>
  );
}

async function openLink(url: string) {
  if (isTauri()) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

function SourceBadge({ source, at, loading, onReload }: { source: LoreSource | null; at: number | null; loading: boolean; onReload: () => void }) {
  if (!source) {
    return (
      <span className="flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        <Unplug className="h-3.5 w-3.5" />
        {tr('Sin material conectado')}
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="rounded-full bg-primary/10 px-3 py-1 font-semibold text-primary">{source.name}</span>
      {at && <span>{tr('actualizado {when}', { when: formatDistanceToNow(at, { addSuffix: true, locale: dateLocale() }) })}</span>}
      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onReload} disabled={loading} aria-label={tr('Actualizar')} title={tr('Actualizar')}>
        <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
      </Button>
      {source.id === 'demo' && (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDemo(false)}>
          {tr('Salir del ejemplo')}
        </Button>
      )}
    </div>
  );
}

function GuideViewer({
  guide,
  source,
  onClose,
  onDownload,
}: {
  guide: LoreGuide | null;
  source: LoreSource | null;
  onClose: () => void;
  onDownload: (guide: LoreGuide) => Promise<void>;
}) {
  const [content, setContent] = useState<{ data: LoreContent; url: string | null; text: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setError(null);
    if (!guide || !source) return;
    const controller = new AbortController();
    let url: string | null = null;
    source
      .open(guide, controller.signal)
      .then(async (data) => {
        if (controller.signal.aborted) return;
        if (data.kind === 'link') return setContent({ data, url: null, text: null });
        const textual = guide.format === 'md' || guide.format === 'txt';
        url = textual ? null : URL.createObjectURL(data.blob);
        setContent({ data, url, text: textual ? (await data.blob.text()).slice(0, 200_000) : null });
      })
      .catch((e) => !controller.signal.aborted && setError(errorText(e)));
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [guide, source]);

  return (
    <Dialog open={!!guide} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        {guide && (
          <>
            <DialogHeader>
              <DialogTitle className="pr-6">{guide.title}</DialogTitle>
              <DialogDescription>{[guide.subject, guide.kind, guide.grade, guide.author].filter(Boolean).join(' · ')}</DialogDescription>
            </DialogHeader>
            <div className="min-h-[16rem] flex-1 overflow-auto rounded-lg border border-border/60 bg-background">
              {error ? (
                <p className="p-6 text-sm text-destructive">{error}</p>
              ) : !content ? (
                <div className="flex h-64 items-center justify-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : content.text !== null ? (
                <pre className="whitespace-pre-wrap break-words p-5 font-body text-sm leading-relaxed text-foreground">{content.text}</pre>
              ) : guide.format === 'pdf' && content.url ? (
                <iframe src={content.url} title={guide.title} className="h-[65vh] w-full" />
              ) : guide.format === 'image' && content.url ? (
                <img src={content.url} alt={guide.title} className="mx-auto max-h-[65vh] object-contain" />
              ) : (
                <p className="p-6 text-sm text-muted-foreground">{tr('Esta guía no se puede ver aquí: descárgala para abrirla con su programa.')}</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void onDownload(guide)}>
                <Download className="mr-2 h-4 w-4" />
                {tr('Descargar')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
