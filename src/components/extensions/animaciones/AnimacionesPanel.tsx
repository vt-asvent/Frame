import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, Crosshair, ImageOff, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AnimationView, useBackgroundImage, useContentRect } from '@/components/extensions/animaciones/Backdrops';
import { ChromePattern } from '@/components/extensions/animaciones/Mosaic';
import { useToast } from '@/hooks/use-toast';
import { accentById, getAccent } from '@/lib/accent';
import { useContributions } from '@/lib/extensions/store';
import {
  animationsWith,
  DEFAULT_CORNERS,
  DEFAULT_FOCUS,
  deleteOwnBackground,
  effectiveLook,
  HEADING_FONTS,
  headingFontName,
  MAX_CORNERS,
  MIN_DIM,
  pickAnimation,
  placeCover,
  saveOwnBackground,
  setLook,
  useLook,
  type BackgroundFocus,
  type ChromeLook,
  type LookSettings,
} from '@/lib/extensions/animaciones';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Panel de la extensión Animaciones, en su propia interfaz de Extensiones
// (1.8.0): los estilos ordenados por categorías (fondo, barra lateral y
// cabecera, títulos y color). Todo se aplica al momento y solo en este equipo.
// Las opciones van sobre fondos opacos: detrás puede estar la animación.
// ============================================================

type Category = 'fondo' | 'marco' | 'recuadros' | 'titulos' | 'color';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function AnimacionesPanel() {
  const mods = useContributions('appearance');
  const look = effectiveLook(useLook(), mods);
  const active = pickAnimation(animationsWith(mods), look);
  const [category, setCategory] = useState<Category>('fondo');

  const parts = [active ? tr('Ahora: {name}', { name: active.name }) : tr('Sin animación')];
  if (look.chosen.length > 1) parts.push(look.rotate === 'day' ? tr('cambia cada día') : tr('cambia al abrir Frame'));
  if (look.background) parts.push(tr('con imagen de fondo'));
  if (look.chrome.pattern !== 'none') {
    parts.push(
      look.chrome.where === 'ambas'
        ? tr('figuras en la barra lateral y la cabecera')
        : look.chrome.where === 'lateral'
          ? tr('figuras en la barra lateral')
          : tr('figuras en la cabecera')
    );
  }
  if (look.corners !== DEFAULT_CORNERS) parts.push(look.corners === 0 ? tr('esquinas rectas') : tr('esquinas de {n} px', { n: look.corners }));
  if (look.headingFont !== 'poppins') parts.push(tr('títulos en {font}', { font: headingFontName(look.headingFont) }));
  if (look.accentFrom) parts.push(tr('color de un mod'));

  const categories: [Category, string][] = [
    ['fondo', tr('Fondo')],
    ['marco', tr('Barra lateral y cabecera')],
    ['recuadros', tr('Recuadros')],
    ['titulos', tr('Títulos')],
    ['color', tr('Color')],
  ];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{parts.join(' · ')}</p>
      <Tabs value={category} onValueChange={(value) => setCategory(value as Category)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-full bg-muted p-1">
          {categories.map(([value, label]) => (
            <TabsTrigger key={value} value={value} className="rounded-full border border-transparent">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="fondo" className="mt-5">
          <BackgroundCategory />
        </TabsContent>
        <TabsContent value="marco" className="mt-5">
          <ChromeCategory />
        </TabsContent>
        <TabsContent value="recuadros" className="mt-5">
          <CornersCategory />
        </TabsContent>
        <TabsContent value="titulos" className="mt-5">
          <TitlesCategory />
        </TabsContent>
        <TabsContent value="color" className="mt-5">
          <ColorCategory />
        </TabsContent>
      </Tabs>
      <p className="border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        {tr('Todo va detrás de la interfaz: las tarjetas y el texto se leen igual. Solo en este equipo.')}
      </p>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40')}>
      {on && <Check className="h-3 w-3" />}
    </span>
  );
}

function RangeRow({ label, left, right, value, min, max, step, onChange }: { label: string; left: string; right: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-3 text-xs">
      <span className="font-semibold text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <span className="w-12 text-right text-[11px] text-muted-foreground">{left}</span>
        <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} className="flex-1" />
        <span className="w-12 text-[11px] text-muted-foreground">{right}</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Fondo: la animación y la imagen
// ------------------------------------------------------------

function BackgroundCategory() {
  const { toast } = useToast();
  const mods = useContributions('appearance');
  const saved = useLook();
  const look = effectiveLook(saved, mods);
  const all = animationsWith(mods);
  const active = pickAnimation(all, look);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // La imagen propia guardada (aunque ahora no esté puesta), para mostrarla.
  const ownImage = useBackgroundImage({ ...look, background: { source: 'own', dim: 0.6, blur: false } }, true);
  const current = useBackgroundImage(look, true);
  const modName = (id: string | null) => mods.find((m) => m.id === id)?.manifest.name ?? id ?? '';

  const toggle = (id: string) => setLook({ chosen: look.chosen.includes(id) ? saved.chosen.filter((c) => c !== id) : [...saved.chosen.filter((c) => c !== id), id] });

  /** Poner (o quitar) una imagen. El encuadre se conserva si es la misma; una imagen nueva empieza centrada. */
  const chooseBackground = (source: string | null, options: { dim?: number; fresh?: boolean } = {}) => {
    if (!source) {
      setLook({ background: null });
      return;
    }
    const keepFocus = !options.fresh && look.background?.source === source ? look.background.focus : undefined;
    setLook({
      background: {
        source,
        dim: Math.max(MIN_DIM, options.dim ?? look.background?.dim ?? 0.72),
        blur: look.background?.blur ?? false,
        ...(keepFocus ? { focus: keepFocus } : {}),
      },
    });
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    try {
      await saveOwnBackground(file);
      chooseBackground('own', { fresh: true });
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo poner esa imagen'), description: errorText(error).slice(0, 200) });
    } finally {
      setSaving(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeOwn = async () => {
    await deleteOwnBackground();
    if (look.background?.source === 'own') setLook({ background: null });
  };

  const backgroundMods = mods.filter((m) => m.value.background);

  return (
    <div className="space-y-8">
      <Section title={tr('Animaciones')} hint={tr('Elige las que quieras. Con varias, Frame las va alternando.')}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-4">
          {all.map((a) => {
            const on = look.chosen.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggle(a.id)}
                aria-pressed={on}
                className={cn(
                  'overflow-hidden rounded-lg border bg-card text-left transition-colors',
                  on ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50'
                )}
              >
                <div className="relative h-24 overflow-hidden bg-background">
                  <AnimationView choice={a} look={look} contained />
                </div>
                <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
                  <Tick on={on} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{a.from ? tr('Mod: {name}', { name: modName(a.from) }) : 'Frame'}</span>
                  </span>
                  {active?.id === a.id && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">{tr('Ahora')}</span>}
                </div>
              </button>
            );
          })}
        </div>
        {look.chosen.length > 1 && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-muted-foreground">{tr('Cambiar de animación')}</span>
            {(
              [
                ['day', tr('Cada día')],
                ['open', tr('Cada vez que abres Frame')],
              ] as [LookSettings['rotate'], string][]
            ).map(([value, label]) => (
              <Button key={value} size="sm" variant={look.rotate === value ? 'default' : 'outline'} className="h-7 rounded-full text-xs" onClick={() => setLook({ rotate: value })}>
                {label}
              </Button>
            ))}
          </div>
        )}
        {look.chosen.length === 0 && <p className="text-xs text-muted-foreground">{tr('Sin animación: el fondo queda liso (o con tu imagen).')}</p>}
        <div className="max-w-xl space-y-2 rounded-lg border border-border/60 bg-card p-3">
          <RangeRow label={tr('Intensidad')} left={tr('Sutil')} right={tr('Viva')} value={look.intensity} min={0.2} max={1} step={0.05} onChange={(v) => setLook({ intensity: v })} />
          <RangeRow label={tr('Velocidad')} left={tr('Lenta')} right={tr('Rápida')} value={look.speed} min={0.5} max={1.6} step={0.05} onChange={(v) => setLook({ speed: v })} />
        </div>
      </Section>

      <Section title={tr('Imagen de fondo')} hint={tr('Detrás del contenido, velada con el color del tema para que el texto se siga leyendo. Tú eliges qué parte se ve.')}>
        <div className="flex flex-wrap gap-3">
          <BackgroundOption label={tr('Sin imagen')} selected={!look.background} onClick={() => chooseBackground(null)}>
            <ImageOff className="h-5 w-5 text-muted-foreground" />
          </BackgroundOption>
          {ownImage && (
            <BackgroundOption label={tr('Tu imagen')} selected={look.background?.source === 'own'} onClick={() => chooseBackground('own')}>
              <img src={ownImage} alt="" className="h-full w-full object-cover" />
            </BackgroundOption>
          )}
          {backgroundMods.map((m) => (
            <BackgroundOption
              key={m.id}
              label={m.value.background!.name}
              sub={tr('Mod: {name}', { name: m.manifest.name })}
              selected={look.background?.source === m.id}
              onClick={() => chooseBackground(m.id, { dim: m.value.background!.dim })}
            >
              <img src={m.value.background!.image} alt="" className="h-full w-full object-cover" />
            </BackgroundOption>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={saving}>
            {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
            {ownImage ? tr('Cambiar tu imagen…') : tr('Elegir una imagen…')}
          </Button>
          {ownImage && (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void removeOwn()}>
              <Trash2 className="mr-2 h-4 w-4" />
              {tr('Quitar tu imagen')}
            </Button>
          )}
        </div>
        {look.background && current && (
          <div className="space-y-3">
            <FramingEditor src={current} background={look.background} />
            <div className="max-w-xl space-y-2 rounded-lg border border-border/60 bg-card p-3">
              <RangeRow
                label={tr('Velo')}
                left={tr('Imagen')}
                right={tr('Claridad')}
                value={look.background.dim}
                min={MIN_DIM}
                max={0.92}
                step={0.01}
                onChange={(v) => setLook({ background: { ...look.background!, dim: v } })}
              />
              <label className="flex items-center justify-between gap-3 text-xs">
                <span className="font-semibold text-muted-foreground">{tr('Desenfocar la imagen')}</span>
                <Switch checked={look.background.blur} onCheckedChange={(blur) => setLook({ background: { ...look.background!, blur } })} />
              </label>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

/**
 * El encuadre: la imagen en una caja con la forma real del área de contenido;
 * se arrastra (o se mueve con las flechas) para elegir qué parte se ve y se
 * acerca con el deslizador. Usa el mismo cálculo que el fondo de verdad, así
 * que lo que se ve aquí es lo que se verá detrás del contenido.
 */
function FramingEditor({ src, background }: { src: string; background: NonNullable<LookSettings['background']> }) {
  const rect = useContentRect(true);
  const aspect = rect && rect.width > 0 && rect.height > 0 ? rect.width / rect.height : 16 / 10;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);
  const [draft, setDraft] = useState<BackgroundFocus | null>(null);
  const drag = useRef<{ x: number; y: number; focus: BackgroundFocus; pointer: number } | null>(null);
  const focus = draft ?? background.focus ?? DEFAULT_FOCUS;
  const size = natural?.src === src ? natural : null;

  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (live) setNatural({ src, width: image.naturalWidth, height: image.naturalHeight });
    };
    image.src = src;
    return () => {
      live = false;
    };
  }, [src]);

  const place = size && box.width > 0 ? placeCover(size.width, size.height, box.width, box.height, focus) : null;
  // Lo que sobra de la imagen a cada lado: lo que se puede desplazar.
  const spareX = place ? place.width - box.width : 0;
  const spareY = place ? place.height - box.height : 0;

  const commit = (next: BackgroundFocus) => setLook({ background: { ...background, focus: next } });

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!place || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, focus, pointer: event.pointerId };
    setDraft(focus);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    // Arrastrar a la derecha mueve la imagen a la derecha: se ve más de su lado izquierdo.
    setDraft({
      ...start.focus,
      x: spareX > 0.5 ? clamp01(start.focus.x - (event.clientX - start.x) / spareX) : start.focus.x,
      y: spareY > 0.5 ? clamp01(start.focus.y - (event.clientY - start.y) / spareY) : start.focus.y,
    });
  };
  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.pointer !== event.pointerId) return;
    drag.current = null;
    if (draft) commit(draft);
    setDraft(null);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.2 : 0.05;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    commit({ ...focus, x: clamp01(focus.x + move[0]), y: clamp01(focus.y + move[1]) });
  };

  const centered = Math.abs(focus.x - 0.5) < 0.005 && Math.abs(focus.y - 0.5) < 0.005;

  return (
    <div className="max-w-xl space-y-2">
      <div
        ref={boxRef}
        role="group"
        tabIndex={0}
        aria-label={tr('Encuadre de la imagen de fondo')}
        aria-description={tr('Arrastra la imagen o usa las flechas para elegir qué parte se ve.')}
        className={cn(
          'relative w-full touch-none select-none overflow-hidden rounded-lg border border-border/70 bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          place && (draft ? 'cursor-grabbing' : 'cursor-grab')
        )}
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      >
        <div className={cn('absolute inset-0', background.blur && 'scale-110 blur-sm')}>
          <img
            src={src}
            alt=""
            draggable={false}
            className={cn('pointer-events-none absolute max-w-none', !place && 'inset-0 h-full w-full object-cover')}
            style={place ? { left: place.left, top: place.top, width: place.width, height: place.height } : undefined}
          />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-background" style={{ opacity: background.dim }} />
        {/* Una tarjeta de muestra: así se lee lo que va encima. */}
        <div className="pointer-events-none absolute left-3 top-3 max-w-[55%] rounded-md border border-border/60 bg-card px-2.5 py-1.5 shadow-sm">
          <p className="truncate text-xs font-semibold text-foreground">{tr('Así se lee una tarjeta')}</p>
          <p className="truncate text-[10px] text-muted-foreground">{tr('y el texto de los huecos')}</p>
        </div>
        <span className="pointer-events-none absolute bottom-2 left-1/2 max-w-[90%] -translate-x-1/2 truncate rounded-full bg-background/85 px-2.5 py-1 text-[10px] font-medium text-muted-foreground shadow-sm">
          {tr('Arrastra para elegir qué parte se ve')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[16rem] flex-1">
          <RangeRow label={tr('Acercar')} left="1×" right="3×" value={Math.min(3, focus.zoom)} min={1} max={3} step={0.05} onChange={(zoom) => commit({ ...focus, zoom })} />
        </div>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => commit({ ...focus, x: 0.5, y: 0.5 })} disabled={centered}>
          <Crosshair className="mr-2 h-4 w-4" />
          {tr('Centrar')}
        </Button>
      </div>
    </div>
  );
}

function BackgroundOption({ label, sub, selected, onClick, children }: { label: string; sub?: string; selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="w-28 text-left">
      <span
        className={cn(
          'flex h-16 items-center justify-center overflow-hidden rounded-lg border bg-muted',
          selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50'
        )}
      >
        {children}
      </span>
      <span className="mt-1 block truncate text-xs font-medium">{label}</span>
      {sub && <span className="block truncate text-[10px] text-muted-foreground">{sub}</span>}
    </button>
  );
}

// ------------------------------------------------------------
// Barra lateral y cabecera
// ------------------------------------------------------------

/** Una miniatura de la app (menú, cabecera y contenido) con las figuras donde van. */
function ChromeMock({ chrome }: { chrome: ChromeLook }) {
  const side = chrome.pattern !== 'none' && chrome.where !== 'cabecera';
  const top = chrome.pattern !== 'none' && chrome.where !== 'lateral';
  return (
    <span className="flex h-full w-full overflow-hidden rounded-md border border-border/60 bg-background" aria-hidden>
      <span className={cn('flex w-1/4 flex-col gap-1.5 border-r border-border/60 bg-card p-2', side && 'relative isolate')}>
        {side && <ChromePattern chrome={chrome} size={110} />}
        {[80, 65, 72, 55].map((width) => (
          <span key={width} className="h-1.5 rounded-full bg-muted-foreground/25" style={{ width: `${width}%` }} />
        ))}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('flex h-5 shrink-0 items-center border-b border-border/60 bg-background px-2', top && 'relative isolate')}>
          {top && <ChromePattern chrome={chrome} size={110} />}
          <span className="mx-auto h-1.5 w-1/3 rounded-full bg-muted-foreground/25" />
        </span>
        <span className="grid flex-1 grid-cols-2 gap-1.5 p-2">
          <span className="rounded bg-card" />
          <span className="rounded bg-card" />
        </span>
      </span>
    </span>
  );
}

function ChromeCategory() {
  const { chrome } = useLook();
  const set = (patch: Partial<ChromeLook>) => setLook({ chrome: { ...chrome, ...patch } });
  const places: [ChromeLook['where'], string][] = [
    ['ambas', tr('En las dos')],
    ['lateral', tr('Solo la barra lateral')],
    ['cabecera', tr('Solo la cabecera')],
  ];
  const options: [ChromeLook['pattern'], string][] = [
    ['none', tr('Lisas')],
    ['figuras', tr('Figuras')],
  ];

  return (
    <Section title={tr('Barra lateral y cabecera')} hint={tr('Figuras repetidas detrás del menú y de la cabecera, quietas y tenues: nada deja de leerse.')}>
      <div className="flex flex-wrap gap-3">
        {options.map(([pattern, label]) => {
          const on = chrome.pattern === pattern;
          return (
            <button key={pattern} type="button" onClick={() => set({ pattern })} aria-pressed={on} className="w-52 text-left">
              <span className={cn('block h-28 overflow-hidden rounded-lg border p-1.5', on ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50')}>
                <ChromeMock chrome={{ ...chrome, pattern }} />
              </span>
              <span className="mt-1.5 flex items-center gap-2 text-xs font-medium">
                <Tick on={on} />
                {label}
              </span>
            </button>
          );
        })}
      </div>
      {chrome.pattern !== 'none' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold text-muted-foreground">{tr('Dónde')}</span>
            {places.map(([where, label]) => (
              <Button key={where} size="sm" variant={chrome.where === where ? 'default' : 'outline'} className="h-7 rounded-full text-xs" onClick={() => set({ where })}>
                {label}
              </Button>
            ))}
          </div>
          <div className="max-w-xl rounded-lg border border-border/60 bg-card p-3">
            <RangeRow label={tr('Intensidad')} left={tr('Sutil')} right={tr('Viva')} value={chrome.strength} min={0.2} max={1} step={0.05} onChange={(strength) => set({ strength })} />
          </div>
        </>
      )}
    </Section>
  );
}

// ------------------------------------------------------------
// Recuadros: qué tan redondeadas son las esquinas (1.9.8, Diego)
// ------------------------------------------------------------

function CornersCategory() {
  const { corners } = useLook();
  return (
    <Section title={tr('Esquinas de los recuadros')} hint={tr('Qué tan redondeadas son en toda la app.')}>
      <div className="max-w-xl space-y-3 rounded-lg border border-border/60 bg-card p-3">
        <RangeRow label={tr('Redondeo')} left={tr('Rectas')} right={tr('Curvas')} value={corners} min={0} max={MAX_CORNERS} step={1} onChange={(value) => setLook({ corners: value })} />
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums">{corners === DEFAULT_CORNERS ? tr('{n} px (el de Frame)', { n: corners }) : tr('{n} px', { n: corners })}</span>
          <Button size="sm" variant="outline" className="h-7 rounded-full text-xs" disabled={corners === DEFAULT_CORNERS} onClick={() => setLook({ corners: DEFAULT_CORNERS })}>
            {tr('Restablecer')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ------------------------------------------------------------
// Títulos
// ------------------------------------------------------------

function TitlesCategory() {
  const { headingFont } = useLook();
  return (
    <Section title={tr('Títulos')} hint={tr('La letra de los títulos de toda la app. El resto del texto no cambia.')}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {HEADING_FONTS.map((font) => {
          const on = headingFont === font.id;
          return (
            <button
              key={font.id}
              type="button"
              onClick={() => setLook({ headingFont: font.id })}
              aria-pressed={on}
              className={cn('rounded-lg border bg-card p-3 text-left transition-colors', on ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50')}
            >
              <span className="block truncate text-lg font-bold text-primary" style={{ fontFamily: font.stack ?? "Poppins, 'Segoe UI', sans-serif" }}>
                {tr('Tu semana en datos')}
              </span>
              <span className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Tick on={on} />
                {headingFontName(font.id)}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

// ------------------------------------------------------------
// Color
// ------------------------------------------------------------

function ColorCategory() {
  const mods = useContributions('appearance');
  const look = effectiveLook(useLook(), mods);
  const settingsAccent = accentById(getAccent());
  const accentMods = mods.filter((m) => m.value.accent);

  return (
    <Section title={tr('Color')} hint={tr('El color de un mod va encima del de Ajustes, que se queda guardado debajo.')}>
      <div className="flex flex-wrap gap-2">
        <ColorOption
          label={tr('El de Ajustes')}
          sub={tr(settingsAccent.name)}
          light={`hsl(${settingsAccent.light.primary})`}
          dark={`hsl(${settingsAccent.dark.primary})`}
          selected={!look.accentFrom}
          onClick={() => setLook({ accentFrom: null })}
        />
        {accentMods.map((m) => (
          <ColorOption
            key={m.id}
            label={m.value.accent!.name}
            sub={tr('Mod: {name}', { name: m.manifest.name })}
            light={m.value.accent!.light}
            dark={m.value.accent!.dark}
            selected={look.accentFrom === m.id}
            onClick={() => setLook({ accentFrom: m.id })}
          />
        ))}
      </div>
      {mods.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {tr('Los mods de apariencia traen colores, fondos y variantes de las animaciones. Son solo datos (nunca código) y se instalan con «Instalar desde archivo…» en Extensiones.')}
        </p>
      )}
    </Section>
  );
}

function ColorOption({ label, sub, light, dark, selected, onClick }: { label: string; sub: string; light: string; dark: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn('flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-left', selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50')}
    >
      <span className="flex h-6 w-6 overflow-hidden rounded-full border border-border/60" aria-hidden>
        <span className="h-full w-1/2" style={{ background: light }} />
        <span className="h-full w-1/2" style={{ background: dark }} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}
