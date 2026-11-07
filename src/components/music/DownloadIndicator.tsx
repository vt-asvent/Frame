import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ListMusic, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useContributions } from '@/lib/extensions/store';
import {
  clearFinishedDownloads,
  formatEta,
  itemProgress,
  pauseDownloads,
  preciseBytes,
  requestDownloadsDialog,
  resumeDownloads,
  retryDownloads,
  speedQuality,
  summarizeDownloads,
  useDownloads,
  type SpeedQuality,
} from '@/lib/extensions/yt-mp3-downloads';
import { decimalText, tr, trc } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Indicador de descargas de Música (1.8.1), a la izquierda de «Aleatorio».
//
// Aparece mientras hay una descarga en curso (o terminó con errores): un
// círculo que se llena con el avance y una flecha en medio. Al pulsarlo,
// el resumen al detalle: listas, faltantes y con errores; velocidad y qué
// tal es; lo que pesará todo y lo ya bajado; el tiempo que falta; pausa.
// ============================================================

// Qué tal es la conexión («Lenta» también es una velocidad de animación: de ahí el contexto).
const QUALITY: Record<SpeedQuality, { label: () => string; hint: () => string; tone: string }> = {
  excelente: { label: () => trc('conexión', 'Excelente'), hint: () => tr('Más de 100 Mbps'), tone: 'bg-emerald-500' },
  'muy-buena': { label: () => trc('conexión', 'Muy buena'), hint: () => tr('Entre 25 y 100 Mbps'), tone: 'bg-emerald-500' },
  buena: { label: () => trc('conexión', 'Buena'), hint: () => tr('Entre 10 y 25 Mbps'), tone: 'bg-lime-500' },
  regular: { label: () => trc('conexión', 'Regular'), hint: () => tr('Entre 3 y 10 Mbps'), tone: 'bg-amber-500' },
  lenta: { label: () => trc('conexión', 'Lenta'), hint: () => tr('Entre 1 y 3 Mbps'), tone: 'bg-orange-500' },
  'muy-lenta': { label: () => trc('conexión', 'Muy lenta'), hint: () => tr('Menos de 1 Mbps'), tone: 'bg-red-500' },
};

const RADIUS = 17;
const CIRCLE = 2 * Math.PI * RADIUS;

export default function DownloadIndicator() {
  const downloads = useDownloads();
  const summary = useMemo(() => summarizeDownloads(downloads), [downloads]);
  const sources = useContributions('musicSource');
  const [errorsOpen, setErrorsOpen] = useState(false);

  const errors = summary.failed + summary.nomatch;
  if (summary.total === 0 || (!summary.active && errors === 0)) return null;

  const percent = Math.floor(summary.progress * 100);
  const engineName = sources.find((s) => s.id === summary.items[0]?.sourceId)?.manifest.name ?? tr('El programa de descargas');
  const quality = downloads.speed > 0 ? speedQuality(downloads.speed) : null;
  const mbps = (downloads.speed * 8) / 1_000_000;
  const failedItems = summary.items.filter((item) => item.state === 'failed' || item.state === 'nomatch');
  const ringTone = !summary.active ? 'text-destructive' : downloads.paused || downloads.problem ? 'text-muted-foreground' : 'text-primary';
  const current = summary.current;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="fantasma"
          size="icon"
          className="relative rounded-full border-transparent"
          title={
            summary.active
              ? tr('Descargando: {done} de {total} · {percent} %', { done: summary.done + summary.skipped, total: summary.total, percent })
              : tr('Descarga terminada con errores')
          }
          aria-label={tr('Resumen de la descarga')}
        >
          <svg viewBox="0 0 40 40" className={cn('pointer-events-none absolute inset-0 h-full w-full -rotate-90', ringTone)} aria-hidden>
            <circle cx="20" cy="20" r={RADIUS} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={3} />
            <circle
              cx="20"
              cy="20"
              r={RADIUS}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={CIRCLE}
              strokeDashoffset={CIRCLE * (1 - summary.progress)}
              className="transition-[stroke-dashoffset] duration-700"
            />
          </svg>
          <ArrowDown className={cn('relative h-4 w-4', ringTone)} />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-80 space-y-3 p-4 text-xs">
        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-bold text-primary">
              {!summary.active
                ? tr('Descarga terminada')
                : downloads.paused
                  ? tr('Descarga en pausa')
                  : tr('Descargando música')}
            </p>
            <span className="text-sm font-semibold tabular-nums text-foreground">{percent} %</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${summary.progress * 100}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 text-center">
          <Count value={summary.done + summary.skipped} label={tr('descargadas')} />
          <Count value={summary.remaining} label={tr('faltan')} />
          <Count value={errors} label={tr('con errores')} tone={errors > 0 ? 'text-destructive' : undefined} />
        </div>
        {summary.skipped > 0 && (
          <p className="-mt-1.5 text-center text-[11px] text-muted-foreground">
            {summary.skipped === 1
              ? tr('(1 ya estaba en tu biblioteca y no se volvió a bajar)')
              : tr('({count} ya estaban en tu biblioteca y no se volvieron a bajar)', { count: summary.skipped })}
          </p>
        )}

        <dl className="space-y-1.5">
          <Row label={tr('Velocidad')}>
            {downloads.paused ? (
              <span className="text-muted-foreground">{tr('En pausa')}</span>
            ) : quality ? (
              <span className="flex flex-col items-end">
                <span className="tabular-nums">
                  {preciseBytes(downloads.speed)}/s · {decimalText(mbps, mbps < 10 ? 1 : 0)} Mbps
                </span>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={QUALITY[quality].hint()}>
                  <span className={cn('h-1.5 w-1.5 rounded-full', QUALITY[quality].tone)} />
                  {QUALITY[quality].label()}
                </span>
              </span>
            ) : summary.active ? (
              <span className="text-muted-foreground">{tr('midiendo…')}</span>
            ) : (
              '—'
            )}
          </Row>
          <Row label={tr('Tamaño total')} hint={tr('MP3 de 320 kbps con portada, letra y metadatos, y su letra sincronizada aparte')}>
            <span className="tabular-nums">
              {summary.estimated ? '≈ ' : ''}
              {preciseBytes(summary.totalBytes)}
            </span>
          </Row>
          <Row label={tr('Ya descargado')}>
            <span className="tabular-nums">{preciseBytes(summary.doneBytes)}</span>
          </Row>
          <Row label={tr('Tiempo restante')}>
            <span className="tabular-nums">
              {!summary.active
                ? '—'
                : downloads.paused
                  ? tr('en pausa')
                  : summary.eta != null
                    ? `≈ ${formatEta(summary.eta)}`
                    : tr('calculando…')}
            </span>
          </Row>
        </dl>

        {current && summary.active && (
          <p className="truncate rounded-md bg-muted/50 px-2 py-1 text-[11px] text-muted-foreground" title={`${current.title} — ${current.artist}`}>
            <span className="text-foreground">{tr('Ahora:')}</span> {current.title || current.videoTitle || '…'}
            {current.artist ? ` — ${current.artist}` : ''}
            {current.state === 'downloading' && ` · ${Math.floor((itemProgress(current) / 0.9) * 100)} %`}
            {current.state === 'converting' && ` · ${tr('convirtiendo')}`}
          </p>
        )}

        {downloads.problem && summary.active && (
          <p className="rounded-md border border-dashed border-border px-2 py-1.5 text-[11px] text-muted-foreground">
            {downloads.problem === 'engine'
              ? tr('{name} no responde. La descarga sigue en cuanto vuelva a abrirse.', { name: engineName })
              : downloads.problem === 'outdated'
                ? tr('Esta versión de {name} no puede entregar las canciones a Frame: instala la última para seguir.', { name: engineName })
                : tr('La extensión de {name} está desactivada: actívala en Extensiones para seguir.', { name: engineName })}
          </p>
        )}

        {errors > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-semibold text-destructive"
                onClick={() => setErrorsOpen((value) => !value)}
                aria-expanded={errorsOpen}
              >
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', !errorsOpen && '-rotate-90')} />
                {errors === 1 ? tr('Ver la que falló') : tr('Ver las {count} que fallaron', { count: errors })}
              </button>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => retryDownloads()}>
                <RotateCcw className="mr-1 h-3 w-3" />
                {tr('Reintentar')}
              </Button>
            </div>
            {errorsOpen && (
              <ul className="max-h-32 space-y-1 overflow-y-auto pl-4 text-[11px] text-muted-foreground">
                {failedItems.map((item) => (
                  <li key={item.id} className="truncate" title={item.error}>
                    <span className="text-foreground">{item.title || item.videoTitle || item.videoId}</span>
                    {' — '}
                    {item.state === 'nomatch' ? tr('No se encontró una versión fiable en YouTube') : item.error || tr('La descarga falló.')}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {summary.active ? (
            <Button size="sm" variant={downloads.paused ? 'default' : 'gris'} className="flex-1" onClick={() => void (downloads.paused ? resumeDownloads() : pauseDownloads())}>
              {downloads.paused ? <Play className="mr-1.5 h-4 w-4" /> : <Pause className="mr-1.5 h-4 w-4" />}
              {downloads.paused ? tr('Reanudar') : tr('Pausar')}
            </Button>
          ) : (
            <Button size="sm" variant="gris" className="flex-1" onClick={clearFinishedDownloads}>
              {tr('Descartar')}
            </Button>
          )}
          <Button size="sm" variant="outline" className="flex-1" onClick={requestDownloadsDialog}>
            <ListMusic className="mr-1.5 h-4 w-4" />
            {tr('Ver la cola')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone?: string }) {
  return (
    <div className="rounded-md bg-muted/50 px-1 py-1.5">
      <p className={cn('text-base font-bold tabular-nums text-foreground', tone)}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground" title={hint}>
        {label}
      </dt>
      <dd className="min-w-0 text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}
