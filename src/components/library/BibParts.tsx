import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, Layers, Sparkles, Star } from 'lucide-react';
import {
  convocatoriaLabel,
  drawnCover,
  programaDe,
  temasDe,
  tipoLabel,
  useCover,
  type BibItem,
  type BibSubjectConf,
} from '@/lib/extensions/aklore/biblioteca';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca 2 (1.9.7): las piezas de la pantalla. Cada archivo es una
// portada (la primera página que copió la nube, una propia o, para exámenes y
// parecidos, una dibujada con el color de su asignatura), su título y debajo
// qué es. Se abre con un clic (BibFileDialog).
// ============================================================

const PALETTE = ['#2563eb', '#0d9488', '#7c3aed', '#c2410c', '#be123c', '#15803d', '#a16207', '#0369a1', '#4338ca', '#334155'];

/** El color de una asignatura: el de su configuración o uno fijo según su nombre. */
export function subjectColor(name: string, conf?: BibSubjectConf): string {
  if (conf?.color) return conf.color;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

/** Visible en pantalla (o a punto): solo entonces se pide su portada o se dibuja su página. */
export function useVisible<T extends Element>(margin = '300px'): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: margin });
    observer.observe(el);
    return () => observer.disconnect();
  }, [margin, visible]);
  return [ref, visible];
}

/** Lo que dice la línea de debajo del título: lo que más ayuda a elegir. */
export function itemDetail(item: BibItem): string {
  const parts: string[] = [tipoLabel(item)];
  if (item.props.convocatoria) parts.push(convocatoriaLabel(item.props.convocatoria));
  else if (item.props.anio && item.tipo !== 'guia') parts.push(item.props.anio);
  if (item.props.zona) parts.push(tr('zona {zona}', { zona: item.props.zona }));
  return parts.join(' · ');
}

export function Cover({ item, color, className }: { item: BibItem; color: string; className?: string }) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  const url = useCover(item, visible);
  const drawn = drawnCover(item) || !url;
  const tema = temasDe(item)[0];
  const sub = [item.props.componente, item.props.convocatoria ? convocatoriaLabel(item.props.convocatoria) : null, !item.props.componente ? tema : null].filter(Boolean).join(' · ');
  return (
    <div ref={ref} className={cn('relative aspect-[3/4] w-full overflow-hidden rounded-lg border border-border/60 bg-muted', className)}>
      {!drawn && url ? (
        <img src={url} alt="" draggable={false} className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3 text-white" style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 55%, black))` }}>
          <span className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{tipoLabel(item)}</span>
          <span className="line-clamp-5 text-sm font-bold leading-snug">{item.props.componente && item.tipo !== 'banco' ? item.props.componente : tema ?? item.title}</span>
          <span className="line-clamp-2 text-[11px] leading-tight opacity-85">{sub || item.subject}</span>
        </div>
      )}
      {item.props.origen === 'IA' && (
        <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          <Sparkles className="h-3 w-3" aria-hidden />
          {tr('Hecho con IA')}
        </span>
      )}
    </div>
  );
}

export function ItemCard({
  item,
  color,
  conf,
  convocatoria,
  favorite,
  showSubject,
  onOpen,
  onToggleFavorite,
}: {
  item: BibItem;
  color: string;
  conf?: BibSubjectConf;
  convocatoria: string | null;
  favorite: boolean;
  showSubject?: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
}) {
  const programa = programaDe(item, conf, convocatoria);
  return (
    <div className="group relative flex min-w-0 flex-col gap-1.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-col gap-1.5 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Cover item={item} color={color} className="transition-transform duration-150 group-hover:-translate-y-0.5 group-hover:shadow-md" />
        <span className="line-clamp-3 text-[13px] font-semibold leading-snug text-foreground">{item.title}</span>
        <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
          {showSubject ? `${item.subject} · ` : ''}
          {itemDetail(item)}
        </span>
        {(programa === 'anterior' || programa === 'siguiente' || item.hasCards) && (
          <span className="flex flex-wrap gap-1">
            {programa === 'anterior' && <Tag tone="warn">{tr('Programa anterior')}</Tag>}
            {programa === 'siguiente' && <Tag tone="info">{tr('Programa nuevo')}</Tag>}
            {item.hasCards && (
              <Tag tone="ok">
                <Layers className="h-3 w-3" aria-hidden />
                {tr('Tarjetas')}
              </Tag>
            )}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={favorite ? tr('Quitar de favoritos') : tr('Añadir a favoritos')}
        className={cn(
          'absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-white transition-opacity hover:bg-black/65',
          favorite ? 'opacity-100' : 'opacity-0 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100'
        )}
      >
        <Star className={cn('h-4 w-4', favorite && 'fill-yellow-400 text-yellow-400')} />
      </button>
    </div>
  );
}

export function Tag({ tone = 'muted', children }: { tone?: 'muted' | 'warn' | 'info' | 'ok'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium',
        tone === 'muted' && 'bg-muted text-muted-foreground',
        tone === 'warn' && 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
        tone === 'info' && 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
        tone === 'ok' && 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      )}
    >
      {children}
    </span>
  );
}

/** Rejilla de portadas: tantas columnas como quepan. */
export function ItemGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-6">{children}</div>;
}

/** Una fila que se desliza, con una flecha en cada extremo (como «Destacados» de la 1.9.4). */
export function Shelf({ label, children, count }: { label: string; children: ReactNode; count: number }) {
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = track.current;
    if (el) setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, count]);
  const move = (direction: 1 | -1) => track.current?.scrollBy({ left: direction * Math.max(200, track.current.clientWidth - 200), behavior: 'smooth' });
  const arrow = 'absolute top-[35%] z-10 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-border/60 bg-card/95 text-foreground shadow-md hover:bg-card md:flex';
  return (
    <div className="relative">
      <div ref={track} onScroll={measure} role="list" aria-label={label} className="flex snap-x gap-4 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {children}
      </div>
      {!edge.start && (
        <button type="button" className={cn(arrow, '-left-3')} onClick={() => move(-1)} aria-label={tr('Anteriores')}>
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {!edge.end && (
        <button type="button" className={cn(arrow, '-right-3')} onClick={() => move(1)} aria-label={tr('Siguientes')}>
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

/** Cada tarjeta de una fila: ancho fijo para que las portadas se vean iguales. */
export function ShelfItem({ children }: { children: ReactNode }) {
  return (
    <div role="listitem" className="w-[9.5rem] shrink-0 snap-start">
      {children}
    </div>
  );
}

export function SectionHeading({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-lg font-bold text-foreground">{title}</h2>
        {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
