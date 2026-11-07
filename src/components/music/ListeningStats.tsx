import { useMemo, useState } from 'react';
import { addMonths, addWeeks, addYears, format } from 'date-fns';
import { BarChart3, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { dateLocale, intlLocale, tr } from '@/lib/i18n';
import {
  formatListened,
  listeningAllTime,
  listeningBetween,
  periodRange,
  playsText,
  useListening,
  type ListeningPeriod,
  type ListeningSummary,
} from '@/lib/listening';

// ============================================================
// «Tu música en datos» (1.8.0): lo que de verdad sonó, por semana, mes o año.
// Los datos los mide src/lib/listening.ts y no salen del equipo.
// ============================================================

const shift = (period: ListeningPeriod, ref: Date, by: number): Date =>
  period === 'semana' ? addWeeks(ref, by) : period === 'mes' ? addMonths(ref, by) : addYears(ref, by);

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale()) + text.slice(1);

function periodLabel(period: ListeningPeriod, from: Date, to: Date): string {
  const locale = dateLocale();
  if (period === 'semana') return `${format(from, tr('d MMM'), { locale })} – ${format(to, tr('d MMM yyyy'), { locale })}`;
  if (period === 'mes') return capitalize(format(from, tr("MMMM 'de' yyyy"), { locale }));
  return format(from, 'yyyy');
}

interface Bar {
  key: string;
  seconds: number;
  label: string;
  title: string;
}

/** Un día por barra (semana y mes) o un mes por barra (año). */
function barsOf(period: ListeningPeriod, summary: ListeningSummary): Bar[] {
  const locale = dateLocale();
  if (period !== 'anio') {
    return summary.days.map((d) => {
      const date = new Date(`${d.day}T00:00:00`);
      const n = date.getDate();
      return {
        key: d.day,
        seconds: d.seconds,
        label: period === 'semana' ? capitalize(format(date, tr('EEE'), { locale })) : n === 1 || n % 5 === 0 ? String(n) : '',
        title: capitalize(format(date, tr("EEEE d 'de' MMMM"), { locale })),
      };
    });
  }
  const months = new Map<string, Bar>();
  for (const d of summary.days) {
    const key = d.day.slice(0, 7);
    const date = new Date(`${key}-01T00:00:00`);
    const bar = months.get(key) ?? { key, seconds: 0, label: capitalize(format(date, tr('MMM'), { locale })), title: capitalize(format(date, tr("MMMM 'de' yyyy"), { locale })) };
    bar.seconds += d.seconds;
    months.set(key, bar);
  }
  return [...months.values()];
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card/60 px-4 py-3">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

interface RankRow {
  id: string;
  name: string;
  detail?: string;
  seconds: number;
  plays: number;
}

function Ranking({ title, rows, empty }: { title: string; rows: RankRow[]; empty: string }) {
  const top = rows[0]?.seconds || 1;
  return (
    <section className="min-w-0 rounded-lg border bg-card/60 p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, i) => (
            <li key={row.id} className="min-w-0">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-medium" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatListened(row.seconds)}</span>
              </div>
              {row.detail && <p className="ml-6 truncate text-xs text-muted-foreground">{row.detail}</p>}
              <div className="ml-6 mt-1 flex items-center gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(3, (row.seconds / top) * 100)}%` }} />
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{playsText(row.plays)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ListeningStatsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { userProfile } = useCourse();
  const owner = open ? userProfile?.id : null;
  const [period, setPeriod] = useState<ListeningPeriod>('semana');
  const [offset, setOffset] = useState(0);
  const { from, to } = useMemo(() => periodRange(period, shift(period, new Date(), offset)), [period, offset]);
  const summary = useListening(owner, (o) => listeningBetween(o, from, to), [from.getTime(), to.getTime()]);
  const allTime = useListening(owner, listeningAllTime, []);
  const bars = useMemo(() => (summary ? barsOf(period, summary) : []), [period, summary]);
  const maxBar = Math.max(1, ...bars.map((b) => b.seconds));
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  const choose = (next: ListeningPeriod) => {
    setPeriod(next);
    setOffset(0);
  };

  const periods: { id: ListeningPeriod; label: string }[] = [
    { id: 'semana', label: tr('Semana') },
    { id: 'mes', label: tr('Mes') },
    { id: 'anio', label: tr('Año') },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            {tr('Tu música en datos')}
          </DialogTitle>
          <DialogDescription>{tr('Lo que de verdad sonó: se cuenta solo lo escuchado, sin saltos ni pausas. Se queda en este equipo.')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-full border bg-card p-1" role="tablist">
            {periods.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={period === p.id}
                onClick={() => choose(p.id)}
                className={cn(
                  'rounded-full px-4 py-1 text-sm transition-colors',
                  period === p.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setOffset((o) => o - 1)} aria-label={tr('Periodo anterior')}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[11rem] text-center text-sm font-medium tabular-nums">{periodLabel(period, from, to)}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 disabled:opacity-30"
              onClick={() => setOffset((o) => Math.min(0, o + 1))}
              disabled={offset >= 0}
              aria-label={tr('Periodo siguiente')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={tr('Tiempo escuchado')} value={summary ? formatListened(summary.seconds) : '—'} />
          <Tile label={tr('Reproducciones')} value={summary ? summary.plays.toLocaleString(intlLocale()) : '—'} />
          <Tile label={tr('Canciones distintas')} value={summary ? summary.songs.length.toLocaleString(intlLocale()) : '—'} />
          <Tile label={tr('Artistas')} value={summary ? summary.artists.length.toLocaleString(intlLocale()) : '—'} />
        </div>

        <section className="rounded-lg border bg-card/60 p-4" aria-label={tr('Escucha por día')}>
          <div className="flex h-32 items-end gap-[3px]">
            {bars.map((bar) => (
              <div key={bar.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${bar.title} · ${formatListened(bar.seconds)}`}>
                <div
                  className={cn('w-full max-w-[2.5rem] rounded-t-sm transition-[height] duration-300', bar.key === todayKey ? 'bg-primary' : 'bg-primary/55')}
                  style={{ height: bar.seconds > 0 ? `${Math.max(3, (bar.seconds / maxBar) * 100)}%` : '2px', opacity: bar.seconds > 0 ? 1 : 0.35 }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1.5 flex gap-[3px]">
            {bars.map((bar) => (
              <span key={bar.key} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">
                {bar.label}
              </span>
            ))}
          </div>
        </section>

        {summary && summary.seconds === 0 ? (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {tr('Sin escucha en este periodo. Frame la registra desde la versión 1.8.0, mientras suena una canción.')}
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <Ranking
              title={tr('Canciones más escuchadas')}
              empty={tr('Aún nada.')}
              rows={(summary?.songs ?? []).slice(0, 8).map((s) => ({ id: s.key, name: s.title, detail: s.artist, seconds: s.seconds, plays: s.plays }))}
            />
            <Ranking title={tr('Artistas con más horas')} empty={tr('Aún nada.')} rows={(summary?.artists ?? []).slice(0, 8)} />
            <Ranking title={tr('Playlists más escuchadas')} empty={tr('Ninguna playlist sonó en este periodo.')} rows={(summary?.lists ?? []).slice(0, 8)} />
          </div>
        )}

        {allTime && allTime.seconds > 0 && (
          <p className="text-xs text-muted-foreground">
            {tr('Desde que Frame lo mide: {time} y {plays}.', { time: formatListened(allTime.seconds), plays: playsText(allTime.plays) })}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** El botón de la barra de Música que abre «Tu música en datos». */
export default function ListeningStatsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="fantasma" size="icon" onClick={() => setOpen(true)} title={tr('Tu música en datos')} aria-label={tr('Tu música en datos')}>
        <BarChart3 className="h-5 w-5" />
      </Button>
      <ListeningStatsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
