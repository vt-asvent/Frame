import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Download, Layers, LoaderCircle, Minus, Play, Plus, Sparkles, Star, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Cover, Tag, useVisible } from '@/components/library/BibParts';
import {
  convocatoriaLabel,
  idiomaLabel,
  openItem,
  programaDe,
  temasDe,
  tipoLabel,
  vinculosDe,
  type BibItem,
  type BibSubjectConf,
} from '@/lib/extensions/aklore/biblioteca';
import { openPdf, renderPage } from '@/lib/extensions/aklore/pdf';
import { formatBytes } from '@/lib/music-import';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca 2 (1.9.7): al tocar un archivo. A la izquierda, su título, su
// descripción, a qué se vincula (asignatura, prueba, temas…) y los botones
// (favorito, tarjetas de estudio si tiene, descargar). A la derecha, la vista
// previa: se desliza y, al tocar una página, se agranda.
// ============================================================

interface Props {
  item: BibItem | null;
  color: string;
  conf?: BibSubjectConf;
  convocatoria: string | null;
  favorite: boolean;
  downloading: boolean;
  onClose: () => void;
  onToggleFavorite: () => void;
  onDownload: () => void;
  onCards: () => void;
  /** Abrir otra asignatura (los vínculos que son asignaturas se pueden tocar). */
  onSubject: (name: string) => void;
  isSubject: (name: string) => boolean;
}

export default function BibFileDialog({ item, color, conf, convocatoria, favorite, downloading, onClose, onToggleFavorite, onDownload, onCards, onSubject, isSubject }: Props) {
  const [enlarged, setEnlarged] = useState<number | null>(null);
  useEffect(() => setEnlarged(null), [item]);
  if (!item) return null;

  const programa = programaDe(item, conf, convocatoria);
  const links: { label: string; subject?: string }[] = [{ label: item.subject, subject: item.subject }];
  if (item.props.componente) links.push({ label: item.props.componente });
  for (const t of temasDe(item)) links.push({ label: t });
  for (const v of vinculosDe(item)) if (!links.some((l) => l.label === v)) links.push({ label: v, subject: isSubject(v) ? v : undefined });
  const facts = [
    item.props.convocatoria && convocatoriaLabel(item.props.convocatoria),
    item.props.zona && tr('Zona horaria {zona}', { zona: item.props.zona }),
    item.props.nivel && nivelLabel(item.props.nivel),
    item.props.guia && tr('Guía de {anio}', { anio: item.props.guia }),
    item.props.puntos,
    item.props.paginas && tr('{n} páginas', { n: item.props.paginas }),
    idiomaLabel(item.props.idioma),
    item.size > 0 && formatBytes(item.size),
  ].filter((x): x is string => typeof x === 'string' && x.length > 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        // Con una página agrandada, el diálogo ocupa toda la ventana y la vista grande lo cubre.
        className={cn(
          'flex h-[min(46rem,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-5xl flex-col gap-0 overflow-hidden p-0 md:flex-row',
          enlarged !== null && 'left-0 top-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 sm:rounded-none'
        )}
        onEscapeKeyDown={(e) => {
          if (enlarged === null) return;
          e.preventDefault();
          setEnlarged(null);
        }}
      >
        {/* Izquierda: qué es y qué hacer con él */}
        <div className="flex max-h-[45%] min-h-0 shrink-0 flex-col gap-4 overflow-y-auto border-b border-border/60 p-5 md:max-h-none md:w-[22rem] md:border-b-0 md:border-r">
          <div className="flex flex-col gap-1.5 pr-6">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
              {tipoLabel(item)}
            </span>
            <DialogTitle className="text-lg leading-snug">{item.title}</DialogTitle>
          </div>
          <DialogDescription className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{item.description || tr('Sin descripción.')}</DialogDescription>
          {(item.props.origen === 'IA' || programa === 'anterior' || programa === 'siguiente') && (
            <div className="flex flex-col gap-1.5">
              {item.props.origen === 'IA' && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  {tr('Hecho con IA a partir de material oficial: revísalo con tu guía y tus apuntes.')}
                </p>
              )}
              {programa === 'anterior' && <Tag tone="warn">{tr('Es del programa anterior: puede incluir temas que ya no entran.')}</Tag>}
              {programa === 'siguiente' && <Tag tone="info">{tr('Es de un programa más nuevo que el de tus exámenes.')}</Tag>}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {links.map((l) =>
              l.subject ? (
                <button
                  key={`s:${l.label}`}
                  type="button"
                  onClick={() => onSubject(l.subject!)}
                  className="rounded-full border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted"
                  style={{ borderColor: color, color }}
                >
                  {l.label}
                </button>
              ) : (
                <span key={`l:${l.label}`} className="rounded-full bg-muted px-2.5 py-1 text-xs text-foreground/80">
                  {l.label}
                </span>
              )
            )}
          </div>
          {facts.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">{facts.join(' · ')}</p>}
          <div className="mt-auto flex flex-wrap gap-2 pt-1">
            <Button onClick={onDownload} disabled={downloading} aria-busy={downloading}>
              {downloading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {tr('Descargar')}
            </Button>
            {item.hasCards && (
              <Button variant="outline" onClick={onCards}>
                <Layers className="mr-2 h-4 w-4" />
                {tr('Tarjetas de estudio')}
              </Button>
            )}
            <Button variant="outline" onClick={onToggleFavorite} aria-pressed={favorite}>
              <Star className={cn('mr-2 h-4 w-4', favorite && 'fill-yellow-400 text-yellow-400')} />
              {favorite ? tr('En favoritos') : tr('Favorito')}
            </Button>
          </div>
        </div>
        {/* Derecha: la vista previa */}
        <div className="min-h-0 flex-1 overflow-hidden bg-muted/40">
          <Preview item={item} color={color} onEnlarge={setEnlarged} />
        </div>
        {enlarged !== null && <PdfFullView item={item} startPage={enlarged} onClose={() => setEnlarged(null)} />}
      </DialogContent>
    </Dialog>
  );
}

const nivelLabel = (nivel: string) =>
  /NM/.test(nivel) && /NS/.test(nivel) ? tr('Nivel Medio y Superior') : /NS/.test(nivel) ? tr('Nivel Superior') : /NM/.test(nivel) ? tr('Nivel Medio') : nivel;

function Preview({ item, color, onEnlarge }: { item: BibItem; color: string; onEnlarge: (page: number) => void }) {
  if (item.ext === 'pdf') return <PdfPreview item={item} color={color} onEnlarge={onEnlarge} />;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(item.ext)) return <BlobPreview item={item} kind="image" />;
  if (['mp3', 'm4a'].includes(item.ext)) return <BlobPreview item={item} kind="audio" color={color} />;
  if (item.ext === 'mp4') return <BlobPreview item={item} kind="video" color={color} />;
  return <NoPreview item={item} color={color} text={tr('Este archivo se abre con su programa: descárgalo para verlo.')} />;
}

function NoPreview({ item, color, text, children }: { item: BibItem; color: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="w-40">
        <Cover item={item} color={color} />
      </div>
      {text && <p className="max-w-xs text-sm text-muted-foreground">{text}</p>}
      {children}
    </div>
  );
}

/** Imágenes, audio y vídeo: el archivo entero (el audio y el vídeo, solo si se pide). */
function BlobPreview({ item, kind, color = '#334155' }: { item: BibItem; kind: 'image' | 'audio' | 'video'; color?: string }) {
  const [wanted, setWanted] = useState(kind === 'image');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let made: string | null = null;
    let alive = true;
    openItem(item)
      .then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [item, wanted]);
  if (error) return <NoPreview item={item} color={color} text={error} />;
  if (!wanted)
    return (
      <NoPreview item={item} color={color}>
        <Button variant="outline" onClick={() => setWanted(true)}>
          <Play className="mr-2 h-4 w-4" />
          {kind === 'audio' ? tr('Escuchar') : tr('Ver el vídeo')}
          {item.size > 0 && <span className="ml-1 text-muted-foreground">({formatBytes(item.size)})</span>}
        </Button>
      </NoPreview>
    );
  if (!url) return <Spinner />;
  if (kind === 'image') return <img src={url} alt={item.title} className="h-full w-full object-contain p-4" />;
  if (kind === 'audio')
    return (
      <NoPreview item={item} color={color}>
        <audio src={url} controls autoPlay className="w-full max-w-sm" />
      </NoPreview>
    );
  return <video src={url} controls autoPlay className="h-full w-full bg-black object-contain" />;
}

const Spinner = () => (
  <div className="flex h-full min-h-[12rem] items-center justify-center">
    <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
  </div>
);

/** El PDF abierto (o el error), compartido por la vista previa y la vista grande. */
function usePdf(item: BibItem): { doc: PDFDocumentProxy | null; error: string | null } {
  const [state, setState] = useState<{ doc: PDFDocumentProxy | null; error: string | null }>({ doc: null, error: null });
  useEffect(() => {
    let alive = true;
    setState({ doc: null, error: null });
    openPdf(item)
      .then((doc) => alive && setState({ doc, error: null }))
      .catch((e) => alive && setState({ doc: null, error: errorText(e) }));
    return () => {
      alive = false;
    };
  }, [item]);
  return state;
}

function PdfPreview({ item, color, onEnlarge }: { item: BibItem; color: string; onEnlarge: (page: number) => void }) {
  const { doc, error } = usePdf(item);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, Math.min(760, el.clientWidth - 32))));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  if (error) return <NoPreview item={item} color={color} text={tr('No se pudo mostrar la vista previa: descárgalo para verlo.')} />;
  return (
    <div ref={box} className="h-full overflow-y-auto overscroll-contain">
      {!doc || width === 0 ? (
        <Spinner />
      ) : (
        <div className="flex flex-col items-center gap-3 p-4">
          {Array.from({ length: doc.numPages }, (_, i) => (
            <PdfPage key={i} doc={doc} page={i + 1} width={width} onClick={() => onEnlarge(i + 1)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Una página: se dibuja solo cuando está a la vista (o cerca). */
function PdfPage({ doc, page, width, onClick, scrollInto }: { doc: PDFDocumentProxy; page: number; width: number; onClick?: () => void; scrollInto?: boolean }) {
  const [ref, visible] = useVisible<HTMLButtonElement>('600px');
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (scrollInto) ref.current?.scrollIntoView({ block: 'start' });
    // Solo al abrir: la vista grande empieza en la página que se tocó.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!visible || !canvas.current) return;
    setFailed(false);
    const job = renderPage(doc, page, canvas.current, width);
    job.done.then(() => setReady(true)).catch(() => setFailed(true));
    return () => job.cancel();
  }, [doc, page, width, visible]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={tr('Página {n}', { n: page })}
      className={cn('relative block shrink-0 overflow-hidden rounded-sm bg-white shadow-sm', onClick && 'cursor-zoom-in')}
      style={{ width }}
    >
      <canvas ref={canvas} className={cn('block w-full', !ready && 'aspect-[1/1.414]')} />
      {!ready && !failed && <LoaderCircle className="absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {failed && <span className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">{tr('Esta página no se pudo mostrar.')}</span>}
    </button>
  );
}

/** La vista grande: las páginas a casi todo el ancho, con zoom. Esc o la X la cierran (y vuelve al diálogo). */
function PdfFullView({ item, startPage, onClose }: { item: BibItem; startPage: number; onClose: () => void }) {
  const { doc, error } = usePdf(item);
  const [zoom, setZoom] = useState(1);
  const width = Math.round(Math.min(window.innerWidth - 32, 900) * zoom);
  return (
    <div className="absolute inset-0 z-[60] flex flex-col bg-neutral-950" role="region" aria-label={item.title}>
      <div className="flex shrink-0 items-center gap-2 px-4 py-2 text-white">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title}</span>
        <button type="button" className="rounded-full p-2 hover:bg-white/15 disabled:opacity-40" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))} disabled={zoom <= 0.5} aria-label={tr('Alejar')}>
          <Minus className="h-5 w-5" />
        </button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)} %</span>
        <button type="button" className="rounded-full p-2 hover:bg-white/15 disabled:opacity-40" onClick={() => setZoom((z) => Math.min(3, z + 0.25))} disabled={zoom >= 3} aria-label={tr('Acercar')}>
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" className="rounded-full p-2 hover:bg-white/15" onClick={onClose} aria-label={tr('Cerrar')}>
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {error ? (
          <p className="p-6 text-center text-sm text-white/80">{error}</p>
        ) : !doc ? (
          <Spinner />
        ) : (
          <div className="mx-auto flex w-max flex-col items-center gap-4 px-4 pb-8">
            {Array.from({ length: doc.numPages }, (_, i) => (
              <PdfPage key={i} doc={doc} page={i + 1} width={width} scrollInto={i + 1 === startPage} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
