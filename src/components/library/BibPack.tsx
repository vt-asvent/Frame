import { useMemo, useState } from 'react';
import { Check, Download, Lock, Sparkles, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SQUARE_BUTTON } from '@/components/library/BibFilters';
import { subjectsIn, type BibModel, type BibPrograma } from '@/lib/extensions/aklore/biblioteca';
import { CARPETA, packExtras, packItems, packPending, resetPack, setPackExtras, startPack, stopPack, usePack } from '@/lib/extensions/aklore/paquete';
import { formatBytes } from '@/lib/music-import';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca → «Tu paquete» (1.9.9, Diego): el botón de la estrella. Las
// asignaturas que la configuración da por fijas vienen marcadas; el alumno
// elige las que faltan y Frame le baja todos sus archivos a Descargas, cada
// asignatura en su carpeta. La descarga sigue con el recuadro cerrado.
// ============================================================

export default function PackButton({ model, programa }: { model: BibModel; programa: BibPrograma }) {
  const [open, setOpen] = useState(false);
  const pack = usePack();
  const running = pack.status === 'running';
  const paquete = programa.paquete;
  const present = useMemo(() => subjectsIn(model, programa, null), [model, programa]);
  const fixed = useMemo(() => present.filter((s) => paquete?.fijas.includes(s.name)), [present, paquete]);
  const options = useMemo(() => present.filter((s) => !paquete?.fijas.includes(s.name)), [present, paquete]);
  const pick = Math.min(paquete?.elegir ?? 0, options.length);
  const [extras, setExtras] = useState<string[]>(() => packExtras().filter((name) => options.some((s) => s.name === name)).slice(0, pick));
  const items = useMemo(() => packItems(model, programa, extras), [model, programa, extras]);
  // Lo pendiente se vuelve a contar cuando la descarga avanza o termina.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const pending = useMemo(() => packPending(items), [items, pack.status, open]);
  if (!paquete || fixed.length === 0) return null;

  const choose = (name: string) => {
    const next = extras.includes(name) ? extras.filter((n) => n !== name) : extras.length < pick ? [...extras, name] : extras;
    setExtras(next);
    setPackExtras(next);
  };
  const ready = extras.length === pick;
  const bytes = pending.reduce((sum, it) => sum + it.size, 0);
  const percent = pack.total > 0 ? Math.round((pack.done / pack.total) * 100) : 0;

  return (
    <>
      <button
        type="button"
        className={SQUARE_BUTTON}
        aria-pressed={running}
        aria-label={tr('Tu paquete')}
        title={running ? tr('Tu paquete: {done} de {total}', { done: pack.done, total: pack.total }) : tr('Tu paquete')}
        onClick={() => {
          if (pack.status === 'done') resetPack();
          setOpen(true);
        }}
      >
        <Sparkles className={cn('h-4 w-4', running && 'animate-pulse')} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tr('Tu paquete')}</DialogTitle>
            <DialogDescription>
              {pick > 0
                ? tr('Estas asignaturas van siempre. Elige {n} más y Frame baja todos sus archivos a Descargas.', { n: pick })
                : tr('Frame baja todos los archivos de estas asignaturas a Descargas.')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-1.5">
            {fixed.map((s) => (
              <span key={s.name} className="inline-flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
                <Lock className="h-3 w-3" aria-hidden />
                {s.name}
              </span>
            ))}
          </div>
          {pick > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">{tr('Elige {n} más ({m} de {n})', { n: pick, m: extras.length })}</p>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {options.map((s) => {
                  const on = extras.includes(s.name);
                  return (
                    <button
                      key={s.name}
                      type="button"
                      aria-pressed={on}
                      disabled={running || (!on && ready)}
                      onClick={() => choose(s.name)}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'
                      )}
                    >
                      {on && <Check className="h-3 w-3" aria-hidden />}
                      {s.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {running ? (
            <div role="status" className="space-y-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {tr('{done} de {total} archivos · {size}', { done: pack.done, total: pack.total, size: formatBytes(pack.bytes) })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {pending.length === 0 && ready
                ? tr('Ya tienes los {n} archivos en Descargas, en «{carpeta}».', { n: items.length, carpeta: CARPETA })
                : pending.length < items.length
                  ? tr('{n} archivos · faltan {m} ({size})', { n: items.length, m: pending.length, size: formatBytes(bytes) })
                  : tr('{n} archivos · {size}', { n: items.length, size: formatBytes(bytes) })}
            </p>
          )}
          {pack.message && !running && <p className="text-sm text-destructive">{pack.message}</p>}
          {pack.status === 'done' && pack.done > 0 && <p className="text-sm font-medium text-primary">{tr('Listo: quedó en Descargas, en «{carpeta}».', { carpeta: CARPETA })}</p>}

          <DialogFooter className="gap-2">
            <Button variant="gris" onClick={() => setOpen(false)}>
              {running ? tr('Seguir en segundo plano') : tr('Cerrar')}
            </Button>
            {running ? (
              <Button variant="outline" onClick={stopPack}>
                <Square className="mr-2 h-3.5 w-3.5" />
                {tr('Detener')}
              </Button>
            ) : (
              <Button disabled={!ready || pending.length === 0} onClick={() => startPack(items)}>
                <Download className="mr-2 h-4 w-4" />
                {tr('Descargar {n} archivos', { n: pending.length })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
