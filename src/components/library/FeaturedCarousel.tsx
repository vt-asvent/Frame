import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { useLorePreview, type LoreGuide, type LoreSource } from '@/lib/extensions/aklore/source';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca → «Destacados» (1.9.4, Diego): las guías de cada asignatura, en
// un carrusel al principio de la Biblioteca, con una flecha en cada extremo.
// Cada tarjeta enseña la vista previa del documento (su primera página, que
// llega de la nube en una imagen pequeña) y, debajo, la asignatura. Al tocarla
// se abre el documento.
// ============================================================

interface Props {
  guides: LoreGuide[];
  source: LoreSource;
  onOpen: (guide: LoreGuide) => void;
}

export default function FeaturedCarousel({ guides, source, onOpen }: Props) {
  const track = useRef<HTMLDivElement>(null);
  /** En qué extremo está: ahí su flecha sobra. */
  const [edge, setEdge] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, guides.length]);

  /** Avanza casi una pantalla de tarjetas: la última visible pasa a ser la primera. */
  const move = (direction: 1 | -1) => {
    const el = track.current;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(220, el.clientWidth - 220), behavior: 'smooth' });
  };

  return (
    <div className="relative">
      <div
        ref={track}
        onScroll={measure}
        role="list"
        aria-label={tr('Documentos destacados')}
        className="flex snap-x gap-3 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {guides.map((guide) => (
          <FeaturedCard key={guide.id} guide={guide} source={source} onOpen={() => onOpen(guide)} />
        ))}
      </div>
      <Arrow side="left" hidden={edge.start} onClick={() => move(-1)} />
      <Arrow side="right" hidden={edge.end} onClick={() => move(1)} />
    </div>
  );
}

function Arrow({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden}
      aria-label={side === 'left' ? tr('Anteriores') : tr('Siguientes')}
      className={cn(
        'absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md transition-opacity hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        side === 'left' ? 'left-1' : 'right-1',
        hidden && 'pointer-events-none opacity-0'
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function FeaturedCard({ guide, source, onOpen }: { guide: LoreGuide; source: LoreSource; onOpen: () => void }) {
  const preview = useLorePreview(guide, source);
  // Una vista que ya no se puede pintar: la portada de siempre.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [preview]);
  return (
    <div role="listitem" className="w-44 shrink-0 snap-start sm:w-52">
      <button
        type="button"
        onClick={onOpen}
        title={guide.title}
        className="group block w-full overflow-hidden rounded-lg border border-border/70 bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative block aspect-[4/5] overflow-hidden bg-muted">
          {preview && !broken ? (
            <img src={preview} alt="" draggable={false} onError={() => setBroken(true)} className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.03]" />
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-3 text-center text-muted-foreground">
              <FileText className="h-8 w-8 text-primary/70" aria-hidden />
              <span className="line-clamp-3 text-[11px] leading-snug">{guide.title}</span>
            </span>
          )}
        </span>
        <span className="block border-t border-border/60 px-3 py-1.5">
          <span className="block truncate text-center text-xs font-bold text-primary">{guide.subject}</span>
          <span className="block truncate text-center text-[10px] text-muted-foreground">{guide.title}</span>
        </span>
      </button>
    </div>
  );
}
