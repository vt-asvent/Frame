import { useRef, useState } from 'react';
import { Check, ImageOff, ImagePlus, LoaderCircle, Palette, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { AnimationView, useBackgroundImage } from '@/components/extensions/animaciones/Backdrops';
import { useToast } from '@/hooks/use-toast';
import { accentById, getAccent } from '@/lib/accent';
import { useContributions } from '@/lib/extensions/store';
import {
  animationsWith,
  deleteOwnBackground,
  effectiveLook,
  MIN_DIM,
  pickAnimation,
  saveOwnBackground,
  setLook,
  useLook,
  type LookSettings,
} from '@/lib/extensions/animaciones';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Panel de la extensión Animaciones (en su tarjeta de Extensiones) y el
// diálogo «Personalizar apariencia»: animaciones, fondo propio y colores de
// los mods. Todo se aplica al momento y solo en este equipo.
// ============================================================

export function AnimacionesPanel() {
  const mods = useContributions('appearance');
  const look = effectiveLook(useLook(), mods);
  const [open, setOpen] = useState(false);
  const active = pickAnimation(animationsWith(mods), look);
  const parts = [active ? tr('Ahora: {name}', { name: active.name }) : tr('Sin animación')];
  if (look.chosen.length > 1) parts.push(look.rotate === 'day' ? tr('cambia cada día') : tr('cambia al abrir Frame'));
  if (look.background) parts.push(tr('con imagen de fondo'));
  if (look.accentFrom) parts.push(tr('color de un mod'));

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Palette className="mr-2 h-4 w-4" />
        {tr('Personalizar apariencia…')}
      </Button>
      <span className="text-muted-foreground">{parts.join(' · ')}</span>
      <LookDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
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

function LookDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const mods = useContributions('appearance');
  const saved = useLook();
  const look = effectiveLook(saved, mods);
  const all = animationsWith(mods);
  const active = pickAnimation(all, look);
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  // La imagen propia guardada (aunque ahora no esté puesta), para mostrarla.
  const ownImage = useBackgroundImage({ ...look, background: { source: 'own', dim: 0.6, blur: false } }, open);
  const current = useBackgroundImage(look, open);
  const modName = (id: string | null) => mods.find((m) => m.id === id)?.manifest.name ?? id ?? '';

  const toggle = (id: string) => setLook({ chosen: look.chosen.includes(id) ? saved.chosen.filter((c) => c !== id) : [...saved.chosen.filter((c) => c !== id), id] });

  const chooseBackground = (source: string | null, dim?: number) =>
    setLook({ background: source ? { source, dim: Math.max(MIN_DIM, dim ?? look.background?.dim ?? 0.72), blur: look.background?.blur ?? false } : null });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setSaving(true);
    try {
      await saveOwnBackground(file);
      chooseBackground('own');
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

  const settingsAccent = accentById(getAccent());
  const accentMods = mods.filter((m) => m.value.accent);
  const backgroundMods = mods.filter((m) => m.value.background);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {tr('Personalizar apariencia')}
          </DialogTitle>
          <DialogDescription>
            {tr('Todo va detrás de la interfaz: las tarjetas y el texto se leen igual. Solo en este equipo.')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-7">
          <Section title={tr('Animaciones')} hint={tr('Elige las que quieras. Con varias, Frame las va alternando.')}>
            <div className="grid gap-3 sm:grid-cols-3">
              {all.map((a) => {
                const on = look.chosen.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggle(a.id)}
                    aria-pressed={on}
                    className={cn(
                      'overflow-hidden rounded-lg border text-left transition-colors',
                      on ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50'
                    )}
                  >
                    <div className="relative h-24 overflow-hidden bg-background">{open && <AnimationView choice={a} look={look} contained />}</div>
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
                  <Button key={value} size="sm" variant={look.rotate === value ? 'default' : 'outline'} className="h-7 text-xs" onClick={() => setLook({ rotate: value })}>
                    {label}
                  </Button>
                ))}
              </div>
            )}
            {look.chosen.length === 0 && <p className="text-xs text-muted-foreground">{tr('Sin animación: el fondo queda liso (o con tu imagen).')}</p>}
            <div className="space-y-2 rounded-lg bg-muted/40 p-3">
              <RangeRow label={tr('Intensidad')} left={tr('Sutil')} right={tr('Viva')} value={look.intensity} min={0.2} max={1} step={0.05} onChange={(v) => setLook({ intensity: v })} />
              <RangeRow label={tr('Velocidad')} left={tr('Lenta')} right={tr('Rápida')} value={look.speed} min={0.5} max={1.6} step={0.05} onChange={(v) => setLook({ speed: v })} />
            </div>
          </Section>

          <Section title={tr('Fondo')} hint={tr('Una imagen detrás de todo, velada con el color del tema para que el texto se siga leyendo.')}>
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
                  onClick={() => chooseBackground(m.id, m.value.background!.dim)}
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
            {look.background && (
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_14rem]">
                <div className="space-y-2 rounded-lg bg-muted/40 p-3">
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
                {/* Vista previa: la imagen con su velo y una tarjeta encima. */}
                <div className="relative h-28 overflow-hidden rounded-lg border border-border/70 bg-background">
                  {current && <img src={current} alt="" className={cn('absolute inset-0 h-full w-full object-cover', look.background.blur && 'scale-110 blur-md')} />}
                  <div className="absolute inset-0 bg-background" style={{ opacity: look.background.dim }} />
                  <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 rounded-md border border-border/60 bg-card p-2 shadow-sm">
                    <p className="text-xs font-semibold text-foreground">{tr('Así se lee una tarjeta')}</p>
                    <p className="text-[10px] text-muted-foreground">{tr('y el texto de los huecos')}</p>
                  </div>
                </div>
              </div>
            )}
          </Section>

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
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BackgroundOption({ label, sub, selected, onClick, children }: { label: string; sub?: string; selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected} className="w-28 text-left">
      <span
        className={cn(
          'flex h-16 items-center justify-center overflow-hidden rounded-lg border bg-muted/40',
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

function ColorOption({ label, sub, light, dark, selected, onClick }: { label: string; sub: string; light: string; dark: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-left', selected ? 'border-primary ring-2 ring-primary/25' : 'border-border/70 hover:border-primary/50')}
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
