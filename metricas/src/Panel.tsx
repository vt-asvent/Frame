import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Flame,
  Globe2,
  LoaderCircle,
  MonitorSmartphone,
  Repeat,
  RefreshCw,
  Sparkles,
  Target,
  Users,
  X,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useExport, type ReportFormat } from '@m/lib/export';
import { supabase } from '@m/lib/supabase';
import { CACHE_KEY } from '@m/lib/cache';
import { dateLocale, decimalText, tr } from '@m/lib/i18n';
import {
  adoptionOf,
  byCity,
  byContinent,
  byCountry,
  cohortsOf,
  continentOf,
  countBy,
  dormant,
  hoursOf,
  isoOfDay,
  isOutdated,
  naturalGrouping,
  newestVersions,
  peakWindow,
  presetRange,
  seriesOf,
  seriesTotals,
  stickinessSeries,
  sum,
  sumMatrices,
  summarize,
  weekdaysOf,
  weekTwoReturn,
  type Grouping,
  type Preset,
  type Range,
  type UserDetail,
  type UsageSnapshot,
} from '@m/lib/usage-model';
import {
  axisTick,
  bucketLabel,
  CONTINENT_LABEL,
  countryName,
  dayLabel,
  DEVICE_LABEL,
  Donut,
  EVENT_LABEL,
  FEATURE_LABEL,
  hourLabel,
  Kpi,
  LANG_LABEL,
  LEVEL_HINT,
  LEVEL_LABEL,
  hoursTick,
  minutesLabel,
  netError,
  plural,
  numberLabel,
  Panel,
  pctLabel,
  PLATFORM_LABEL,
  RankList,
  SCREEN_LABEL,
  tooltipStyle,
  WeekHeat,
  weekdayShort,
} from '@m/components/UsageBits';
import WorldMap from '@m/components/WorldMap';
import StudentsTab from '@m/components/StudentsTab';
import type { Continent } from '@m/lib/world-map';

// ============================================================
// Panel de uso — solo para el responsable de Frame (1.6.9, a fondo; fuera de
// la app desde la 1.7.0: vive en la página de métricas, tras Google y el
// código del autenticador).
//
// Pedido de Diego (13-oct-2026): con un público grande, reunir todo lo útil
// para acreditar que Frame sirve de verdad y su impacto en varias
// dimensiones, sin vulnerar la privacidad de nadie y sin castigar la base de
// datos. Así:
//
//   · El servidor calcula una FOTO del panel como mucho cada 6 h (o 12 o 24,
//     a elegir; o al pulsar «Actualizar ahora»): `usage_snapshot`, migración
//     0012; desde la 0013 se recalcula sola cada 6 h. Esta pestaña guarda la
//     última (en sessionStorage: se borra al cerrarla) y la muestra al
//     instante; al volver a pedirla, el servidor solo la manda si cambió.
//   · El plazo (de un día a un año, o el que se elija) y la agrupación (día,
//     tres días, semana o mes) se calculan aquí, sin volver a preguntar
//     (usage-model.ts). Igual el filtro por continente o país del mapa, que
//     se aplica a todas las pestañas.
//   · Cada estudiante tiene su tarjeta; su ficha (cuándo estudia, sus
//     semanas, su actividad reciente) se pide solo al abrirla.
//   · «Reporte»: todo esto en Word, PDF o Markdown (usage-report.ts).
//
// La cuenta del responsable no cuenta en ninguna cifra. A cualquier otra
// cuenta el servidor le responde «permiso denegado».
// ============================================================

const HOURS_KEY = 'usagePanelHours';
const HOURS_OPTIONS = [6, 12, 24] as const;
type Hours = (typeof HOURS_OPTIONS)[number];

type Tab = 'summary' | 'students' | 'map' | 'when' | 'features' | 'retention' | 'quality';

const PRESET_LABEL: Record<Preset, () => string> = {
  '1': () => tr('Hoy'),
  '3': () => tr('3 días'),
  '7': () => tr('7 días'),
  '30': () => tr('30 días'),
  '90': () => tr('90 días'),
  '365': () => tr('1 año'),
  custom: () => tr('Personalizado'),
};

const GROUPING_LABEL: Record<Grouping, () => string> = {
  day: () => tr('Por día'),
  '3days': () => tr('Cada 3 días'),
  week: () => tr('Por semana'),
  month: () => tr('Por mes'),
};

function readCache(): UsageSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const parsed = raw ? (JSON.parse(raw) as UsageSnapshot) : null;
    return parsed?.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function readHours(): Hours {
  try {
    const value = Number(localStorage.getItem(HOURS_KEY));
    return (HOURS_OPTIONS as readonly number[]).includes(value) ? (value as Hours) : 6;
  } catch {
    return 6;
  }
}

// El servidor sin la migración 0013 no conoce `known`: se pide sin él.
let serverKnowsKnown = true;

const ago = (iso: string) => {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { locale: dateLocale(), addSuffix: true });
  } catch {
    return '—';
  }
};

const dayFromInput = (value: string, snapshot: UsageSnapshot): number | null => {
  const time = Date.parse(`${value}T12:00:00Z`);
  if (Number.isNaN(time)) return null;
  return Math.round((time - Date.parse(`${snapshot.epoch}T12:00:00Z`)) / 86_400_000);
};

function UsagePanel() {
  const { toast } = useToast();
  const { run, busy } = useExport();
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(readCache);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState<Hours>(readHours);
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [grouping, setGrouping] = useState<Grouping | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  const [continent, setContinent] = useState<Continent | '?' | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const details = useRef(new Map<string, UserDetail>());

  const load = useCallback(async (force: boolean, maxAge: Hours) => {
    setLoading(true);
    setError(null);
    const known = !force && serverKnowsKnown ? readCache()?.generated_at ?? null : null;
    let { data, error: rpcError } = await supabase.rpc('usage_snapshot', known ? { max_age_hours: maxAge, force, known } : { max_age_hours: maxAge, force });
    if (rpcError?.code === 'PGRST202' && known) {
      serverKnowsKnown = false;
      ({ data, error: rpcError } = await supabase.rpc('usage_snapshot', { max_age_hours: maxAge, force }));
    }
    setLoading(false);
    if (rpcError) {
      setError(
        rpcError.code === '42501'
          ? tr('Esta cuenta no puede ver las métricas de Frame.')
          : netError(rpcError.message)
      );
      return;
    }
    // La misma foto que ya está en pantalla: nada que bajar ni repintar.
    if ((data as { same?: boolean } | null)?.same) return;
    const next = data as UsageSnapshot;
    setSnapshot(next);
    if (force) details.current.clear();
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(next));
    } catch {
      /* sin espacio: se volverá a pedir entera la próxima vez */
    }
  }, []);

  // Al abrir: lo guardado se ve ya, y el servidor dice si hay algo más nuevo
  // (si su foto tiene menos de las horas elegidas, la devuelve sin recalcular).
  useEffect(() => {
    void load(false, hours);
    const timer = window.setInterval(() => void load(false, hours), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [load, hours]);

  const range: Range | null = useMemo(() => {
    if (!snapshot) return null;
    if (preset !== 'custom' || !custom) return presetRange(snapshot, preset === 'custom' ? '30' : preset);
    const from = dayFromInput(custom.from, snapshot);
    const to = dayFromInput(custom.to, snapshot);
    if (from === null || to === null) return presetRange(snapshot, '30');
    const lo = Math.max(snapshot.since, Math.min(from, to));
    const hi = Math.min(snapshot.today, Math.max(from, to));
    return { from: lo, to: Math.max(lo, hi) };
  }, [snapshot, preset, custom]);

  const groupingNow: Grouping = grouping ?? (range ? naturalGrouping(range) : 'day');

  // El filtro del mapa vale para todas las pestañas.
  const users = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.users.filter(
      (user) => (!country || (user.cc ?? '?') === country) && (!continent || (continentOf(user.cc) ?? '?') === continent)
    );
  }, [snapshot, country, continent]);

  const loadDetail = useCallback(async (id: string): Promise<UserDetail> => {
    const cached = details.current.get(id);
    if (cached) return cached;
    const { data, error: rpcError } = await supabase.rpc('usage_user_detail', { targets: [id] });
    if (rpcError) throw new Error(rpcError.message);
    const detail = (data as Record<string, UserDetail>)[id];
    if (!detail) throw new Error(tr('No hay detalle de este estudiante.'));
    details.current.set(id, detail);
    return detail;
  }, []);

  /** El Reporte: pide el detalle de todos (por tandas de 200) y arma el documento. */
  const downloadReport = async (format: ReportFormat) => {
    if (!snapshot || !range) return;
    setPreparing(true);
    try {
      const missing = users.map((user) => user.id).filter((id) => !details.current.has(id));
      for (let i = 0; i < missing.length; i += 200) {
        const { data, error: rpcError } = await supabase.rpc('usage_user_detail', { targets: missing.slice(i, i + 200) });
        if (rpcError) throw new Error(rpcError.message);
        for (const [id, detail] of Object.entries(data as Record<string, UserDetail>)) details.current.set(id, detail);
      }
      const { data: impact } = await supabase.rpc('impact_overview');
      const { buildUsageReport } = await import('@m/lib/usage-report');
      const scope = country ? countryName(country) : continent ? CONTINENT_LABEL[continent]() : null;
      await run(
        () => buildUsageReport({ snapshot, users, range, grouping: groupingNow, details: details.current, impact: impact ?? null, scope }),
        tr('Frame - Reporte de uso - {today}', { today: isoOfDay(snapshot.today) }),
        format
      );
    } catch (reason) {
      toast({ variant: 'destructive', title: tr('No se pudo preparar el reporte'), description: netError(reason instanceof Error ? reason.message : String(reason)) });
    } finally {
      setPreparing(false);
    }
  };

  const reportBusy = preparing || busy !== null;

  return (
    <div className="flex flex-col gap-5 p-6 md:p-8">
      {/* --- Encabezado --- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-headline text-2xl font-bold text-foreground">{tr('Panel de uso')}</h1>
          <p className="text-sm text-muted-foreground">
            {tr('Cómo se usa Frame en el mundo · datos seudónimos, calculados en el servidor y sin contar tu propia cuenta')}
          </p>
          {snapshot && (
            <p className="mt-1 text-[11px] text-muted-foreground/70">
              {tr('Calculado {when} · se recalcula como mucho cada {hours} h', { when: ago(snapshot.generated_at), hours })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 gap-2" disabled={reportBusy || !snapshot}>
                {reportBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {tr('Reporte')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                {tr('Todo lo que recoge el panel, con el plazo y el filtro elegidos')}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void downloadReport('docx')}>
                <FileText className="mr-2 h-4 w-4" /> {tr('Word (.docx)')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadReport('pdf')}>
                <FileText className="mr-2 h-4 w-4" /> {tr('PDF')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void downloadReport('md')}>
                <FileText className="mr-2 h-4 w-4" /> {tr('Markdown (.md)')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
                <Clock3 className="h-3.5 w-3.5" /> {tr('Cada {hours} h', { hours })}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-xs">{tr('Recalcular el panel como mucho')}</DropdownMenuLabel>
              {HOURS_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option}
                  className={cn('text-xs', option === hours && 'text-primary')}
                  onSelect={() => {
                    setHours(option);
                    try {
                      localStorage.setItem(HOURS_KEY, String(option));
                    } catch {
                      /* vale para esta visita */
                    }
                  }}
                >
                  {tr('Cada {hours} horas', { hours: option })}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => void load(true, hours)} disabled={loading} title={tr('Actualizar ahora')}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && snapshot && (
        <p className="-mt-3 flex items-center gap-1.5 text-[11px] text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {tr('{error}: se muestra lo último calculado ({when}).', { error, when: ago(snapshot.generated_at) })}
        </p>
      )}
      {error && !snapshot && (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
            <span>{error}</span>
          </CardContent>
        </Card>
      )}

      {!snapshot && loading && (
        <div className="flex h-40 items-center justify-center">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      )}

      {snapshot && snapshot.users.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            {tr('Todavía no hay datos. Aparecen en cuanto un estudiante abra Frame con conexión: primero la apertura del día, y después cada sesión de estudio, tarea culminada e informe generado.')}
          </CardContent>
        </Card>
      )}

      {snapshot && range && snapshot.users.length > 0 && (
        <>
          {/* --- Plazo, agrupación y filtro --- */}
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={preset} onValueChange={(value) => {
              setPreset(value as Preset);
              setGrouping(null);
              if (value === 'custom' && !custom) setCustom({ from: isoOfDay(range.from), to: isoOfDay(range.to) });
            }}>
              <TabsList className="h-9 flex-wrap">
                {(Object.keys(PRESET_LABEL) as Preset[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="px-2.5 text-xs">
                    {PRESET_LABEL[key]()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {preset === 'custom' && custom && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Input type="date" className="h-9 w-[9.5rem] text-xs" value={custom.from} min={isoOfDay(snapshot.since)} max={isoOfDay(snapshot.today)} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label={tr('Desde')} />
                <span>–</span>
                <Input type="date" className="h-9 w-[9.5rem] text-xs" value={custom.to} min={isoOfDay(snapshot.since)} max={isoOfDay(snapshot.today)} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label={tr('Hasta')} />
              </div>
            )}
            <Tabs value={groupingNow} onValueChange={(value) => setGrouping(value as Grouping)}>
              <TabsList className="h-9">
                {(Object.keys(GROUPING_LABEL) as Grouping[]).map((key) => (
                  <TabsTrigger key={key} value={key} className="px-2.5 text-xs">
                    {GROUPING_LABEL[key]()}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {(country || continent) && (
              <Button variant="fantasma" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => { setCountry(null); setContinent(null); }}>
                <Globe2 className="h-3.5 w-3.5" />
                {country ? countryName(country) : CONTINENT_LABEL[continent!]()}
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">{bucketLabel(range.from, range.to)}</span>
          </div>

          <Tabs value={tab} onValueChange={(value) => setTab(value as Tab)} className="space-y-4">
            <TabsList className="h-auto flex-wrap">
              <TabsTrigger value="summary">{tr('Resumen')}</TabsTrigger>
              <TabsTrigger value="students">{tr('Estudiantes')}</TabsTrigger>
              <TabsTrigger value="map">{tr('Mapa')}</TabsTrigger>
              <TabsTrigger value="when">{tr('Cuándo')}</TabsTrigger>
              <TabsTrigger value="features">{tr('Funciones')}</TabsTrigger>
              <TabsTrigger value="retention">{tr('Retención')}</TabsTrigger>
              <TabsTrigger value="quality">{tr('Versiones y errores')}</TabsTrigger>
            </TabsList>

            <TabsContent value="summary">
              <SummaryTab snapshot={snapshot} users={users} range={range} grouping={groupingNow} filtered={!!(country || continent)} />
            </TabsContent>
            <TabsContent value="students">
              <StudentsTab snapshot={snapshot} users={users} range={range} newest={newestVersions(snapshot.users)} loadDetail={loadDetail} />
            </TabsContent>
            <TabsContent value="map">
              <MapTab
                snapshot={snapshot}
                range={range}
                continent={continent}
                country={country}
                onContinent={(value) => {
                  setContinent(value);
                  setCountry(null);
                }}
                onCountry={(code) => {
                  setCountry(code);
                  if (code) setContinent(null);
                }}
              />
            </TabsContent>
            <TabsContent value="when">
              <WhenTab snapshot={snapshot} users={users} filtered={!!(country || continent)} />
            </TabsContent>
            <TabsContent value="features">
              <FeaturesTab snapshot={snapshot} users={users} range={range} filtered={!!(country || continent)} />
            </TabsContent>
            <TabsContent value="retention">
              <RetentionTab snapshot={snapshot} users={users} range={range} />
            </TabsContent>
            <TabsContent value="quality">
              <QualityTab snapshot={snapshot} users={users} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------
// Resumen
// ------------------------------------------------------------
function SummaryTab({ snapshot, users, range, grouping, filtered }: { snapshot: UsageSnapshot; users: UsageSnapshot['users']; range: Range; grouping: Grouping; filtered: boolean }) {
  const summary = useMemo(() => summarize(snapshot, range, users), [snapshot, range, users]);
  const series = useMemo(
    () => seriesOf(snapshot, range, grouping, users).map((point) => ({ ...point, label: bucketLabel(point.from, point.to) })),
    [snapshot, range, grouping, users]
  );
  const a = summary.activity;
  // Descargas (1.9.2). La cifra grande es la del plazo y sale de la serie por día, que es de
  // todos (no se separa por lugar); quiénes y cuánto cada uno sale de lo que la foto guarda de
  // cada estudiante, que son 400 días y sí sigue el filtro. La pista dice cuál es cuál.
  const downloads = (() => {
    const totals = new Map(seriesTotals(snapshot.ev, range).map((row) => [row.key, row.count]));
    const of = (event: string) => {
      const who = users.filter((user) => (user.e[event] ?? 0) > 0);
      const all = who.reduce((n, user) => n + (user.e[event] ?? 0), 0);
      const values = { all: numberLabel(all), users: who.length, per: who.length ? decimalText(Math.round((all / who.length) * 10) / 10) : '—' };
      return {
        inRange: totals.get(event) ?? 0,
        hint: filtered
          ? tr('en el plazo, de todos los lugares · aquí, en 400 días: {all} entre {users} estudiantes', values)
          : tr('en el plazo · en 400 días: {all} entre {users} estudiantes ({per} de media)', values),
      };
    };
    return { library: of('library_download'), songs: of('song_download') };
  })();
  // Dispositivos (1.9.2): los de cada cuenta siguen el filtro; el reparto por tipo es de todos.
  const linked = (() => {
    const counts = users.map((user) => user.nd ?? 0);
    const kinds = { laptop: snapshot.devices?.laptop ?? 0, phone: snapshot.devices?.phone ?? 0, tablet: snapshot.devices?.tablet ?? 0 };
    return {
      total: filtered ? counts.reduce((n, count) => n + count, 0) : kinds.laptop + kinds.phone + kinds.tablet,
      kinds,
      accounts: counts.filter((count) => count >= 1).length,
      several: counts.filter((count) => count >= 2).length,
    };
  })();
  const levels = (Object.keys(summary.levels) as (keyof typeof summary.levels)[]).map((key) => ({ label: LEVEL_LABEL[key](), value: summary.levels[key], hint: LEVEL_HINT[key]() }));
  const devices = countBy(users, (user) => (user.dv ? `${user.dv}` : user.pl === 'android' ? 'phone' : user.pl ? 'desktop' : null)).map((row) => ({
    label: DEVICE_LABEL[row.key]?.() ?? tr('Sin dato'),
    value: row.value,
  }));
  const langs = countBy(users, (user) => user.la).map((row) => ({ label: LANG_LABEL[row.key]?.() ?? tr('Sin dato'), value: row.value }));
  const studyBuckets = summary.studyBuckets;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Users} label={tr('Estudiantes')} value={numberLabel(summary.users)} hint={tr('{accounts} con cuenta · {guests} invitados · {fresh} nuevos en el plazo', { accounts: summary.accounts, guests: summary.guests, fresh: summary.newUsers })} />
        <Kpi icon={Activity} label={tr('Activos en el plazo')} value={numberLabel(summary.active)} hint={tr('{today} hoy · {d7} en 7 días · {d30} en 30 días', { today: summary.activeToday, d7: summary.active7, d30: summary.active30 })} />
        <Kpi icon={Repeat} label={tr('Uso diario')} value={decimalText(Math.round(summary.avgDaily * 10) / 10)} hint={tr('activos de media al día · {pct} de los activos del mes', { pct: pctLabel(summary.stickiness) })} />
        <Kpi icon={Clock3} label={tr('Estudio en el plazo')} value={minutesLabel(a.minutes)} hint={tr('{sessions} sesiones · {per} por estudiante activo', { sessions: numberLabel(a.sessions), per: summary.minutesPerActive === null ? '—' : minutesLabel(summary.minutesPerActive) })} />
        <Kpi icon={CheckCircle2} label={tr('Tareas culminadas')} value={numberLabel(a.tasks)} hint={tr('{pct} a tiempo · {high} de importancia alta', { pct: pctLabel(summary.onTimePct), high: a.high })} />
        <Kpi icon={Target} label={tr('Constancia de hábitos')} value={pctLabel(summary.habitsPct)} hint={tr('{done} de {possible} marcas posibles', { done: a.habitsDone, possible: a.habitsPossible })} />
        <Kpi icon={Sparkles} label={tr('Enfoque medio')} value={summary.focusAvg === null ? '—' : `${decimalText(summary.focusAvg)} / 20`} hint={tr('el que declaran al terminar una sesión')} />
        <Kpi icon={Globe2} label={tr('Alcance')} value={tr('{n} países', { n: summary.countries })} hint={tr('{cities} ciudades · {opens} aperturas en el plazo', { cities: summary.cities, opens: numberLabel(a.opens) })} />
        <Kpi icon={Download} label={tr('Archivos de la Biblioteca')} value={numberLabel(downloads.library.inRange)} hint={downloads.library.hint} />
        <Kpi icon={Download} label={tr('Canciones descargadas')} value={numberLabel(downloads.songs.inRange)} hint={downloads.songs.hint} />
        <Kpi
          icon={MonitorSmartphone}
          label={tr('Dispositivos vinculados')}
          value={numberLabel(linked.total)}
          hint={
            filtered
              ? tr('abiertos en 30 días, de {n} cuentas de este lugar', { n: linked.accounts })
              : tr('{laptop} laptops · {phone} celulares · {tablet} tablets (abiertos en 30 días)', linked.kinds)
          }
        />
        <Kpi
          icon={Repeat}
          label={tr('Cuentas en varios dispositivos')}
          value={numberLabel(linked.several)}
          hint={tr('de {n} cuentas con algún dispositivo vinculado (30 días)', { n: linked.accounts })}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={tr('Estudiantes activos y nuevos')} bodyClassName="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="usoActivos" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="active" name={tr('Activos')} stroke="hsl(var(--primary))" fill="url(#usoActivos)" strokeWidth={2} />
              <Area type="monotone" dataKey="newUsers" name={tr('Nuevos')} stroke="hsl(var(--chart-2))" fill="hsl(var(--chart-2))" fillOpacity={0.15} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={tr('Minutos de estudio y sesiones')} bodyClassName="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis yAxisId="min" tick={axisTick} tickFormatter={hoursTick} />
              <YAxis yAxisId="ses" orientation="right" allowDecimals={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="min" dataKey="minutes" name={tr('Minutos')} fill="hsl(var(--primary))" fillOpacity={0.75} radius={[3, 3, 0, 0]} />
              <Line yAxisId="ses" type="monotone" dataKey="sessions" name={tr('Sesiones')} stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={tr('Tareas culminadas y aperturas de Frame')} bodyClassName="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="tasks" name={tr('Tareas')} fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
              <Bar dataKey="opens" name={tr('Aperturas')} fill="hsl(var(--chart-4))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={tr('Constancia de hábitos y enfoque')} bodyClassName="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
              <YAxis yAxisId="pct" domain={[0, 100]} tick={axisTick} />
              <YAxis yAxisId="focus" orientation="right" domain={[0, 20]} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line yAxisId="pct" type="monotone" dataKey="habitsPct" name={tr('Hábitos (%)')} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="focus" type="monotone" dataKey="focus" name={tr('Enfoque (1–20)')} stroke="hsl(var(--chart-5))" strokeWidth={2} dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Panel title={tr('Nivel de actividad en el plazo')}>
          <Donut rows={levels} empty={tr('Sin estudiantes')} center={String(summary.active)} />
        </Panel>
        <Panel title={tr('Cuentas e invitados')}>
          <Donut rows={[{ label: tr('Con cuenta'), value: summary.accounts }, { label: tr('Invitados'), value: summary.guests }]} empty={tr('Sin estudiantes')} />
        </Panel>
        <Panel title={tr('Equipo')}>
          <Donut rows={devices} empty={tr('Sin estudiantes')} />
        </Panel>
        <Panel title={tr('Idioma de Frame')}>
          <Donut rows={langs} empty={tr('Sin estudiantes')} />
        </Panel>
      </div>

      <Panel title={tr('Estudio acumulado por estudiante (desde el inicio)')}>
        <RankList
          rows={[
            { label: tr('Sin estudio'), value: studyBuckets.none, muted: true },
            { label: tr('Menos de 1 h'), value: studyBuckets.lt1h },
            { label: tr('De 1 a 5 h'), value: studyBuckets.h1_5 },
            { label: tr('De 5 a 20 h'), value: studyBuckets.h5_20 },
            { label: tr('20 h o más'), value: studyBuckets.h20 },
          ]}
          empty={tr('Sin estudiantes')}
        />
        <p className="mt-3 text-[11px] text-muted-foreground">
          {tr('Entre todos: {minutes} de estudio en {sessions} sesiones y {tasks} tareas culminadas desde que usan Frame.', {
            minutes: minutesLabel(sum(users.map((user) => user.t[0] ?? 0))),
            sessions: numberLabel(sum(users.map((user) => user.t[1] ?? 0))),
            tasks: numberLabel(sum(users.map((user) => user.t[2] ?? 0))),
          })}
        </p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------
// Mapa
// ------------------------------------------------------------
function MapTab({
  snapshot,
  range,
  continent,
  country,
  onContinent,
  onCountry,
}: {
  snapshot: UsageSnapshot;
  range: Range;
  continent: Continent | '?' | null;
  country: string | null;
  onContinent: (value: Continent | '?' | null) => void;
  onCountry: (value: string | null) => void;
}) {
  const all = snapshot.users;
  const countries = useMemo(() => byCountry(all, range), [all, range]);
  const values = useMemo(() => Object.fromEntries(countries.filter((group) => group.key !== '?').map((group) => [group.key, { users: group.users, active: group.active }])), [countries]);
  const continents = useMemo(() => byContinent(all, range), [all, range]);
  const inContinent = continent ? countries.filter((group) => (continentOf(group.key === '?' ? null : group.key) ?? '?') === continent) : countries;
  const cityUsers = all.filter((user) => (!country || (user.cc ?? '?') === country) && (!continent || (continentOf(user.cc) ?? '?') === continent));
  const cities = useMemo(() => byCity(cityUsers, range), [cityUsers, range]);

  return (
    <div className="space-y-4">
      <Panel title={tr('Estudiantes por país')} note={tr('Según la ciudad del clima de Inicio de cada estudiante (aproximada; nunca su posición exacta).')}>
        <WorldMap values={values} selected={country} onSelect={onCountry} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title={tr('Continentes')}>
          <RankList
            rows={continents.map((group) => ({ id: group.key, label: CONTINENT_LABEL[group.key as Continent | '?'](), value: group.users, extra: plural(group.active, tr('{n} activo'), tr('{n} activos')), muted: group.key === '?' }))}
            empty={tr('Sin estudiantes')}
            limit={8}
            onSelect={(id) => onContinent(continent === id ? null : (id as Continent | '?'))}
          />
        </Panel>
        <Panel title={continent ? tr('Países de {place}', { place: CONTINENT_LABEL[continent]() }) : tr('Países')}>
          <RankList
            rows={inContinent.map((group) => ({ id: group.key, label: countryName(group.key), value: group.users, extra: plural(group.active, tr('{n} activo'), tr('{n} activos')), muted: group.key === '?' }))}
            empty={tr('Sin estudiantes')}
            limit={25}
            onSelect={(id) => onCountry(country === id ? null : id)}
          />
        </Panel>
        <Panel title={country ? tr('Ciudades de {place}', { place: countryName(country) }) : tr('Ciudades')}>
          <RankList
            rows={cities.map((group) => ({ label: group.key === '?' ? tr('Sin ciudad') : group.key, value: group.users, extra: plural(group.active, tr('{n} activo'), tr('{n} activos')), muted: group.key === '?' }))}
            empty={tr('Sin estudiantes')}
            limit={25}
          />
        </Panel>
      </div>
      <Panel title={tr('Por país, en el plazo')} bodyClassName="p-0 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] text-muted-foreground">
              <tr className="border-y border-border/60 bg-secondary/30">
                <th className="px-4 py-2 text-left font-bold">{tr('País')}</th>
                <th className="px-2 py-2 text-left font-bold">{tr('Continente')}</th>
                <th className="px-2 py-2 text-right font-bold">{tr('Estudiantes')}</th>
                <th className="px-2 py-2 text-right font-bold">{tr('Activos')}</th>
                <th className="px-4 py-2 text-right font-bold">{tr('Estudio')}</th>
              </tr>
            </thead>
            <tbody>
              {countries.map((group) => (
                <tr key={group.key} className="border-b border-border/40 last:border-0 hover:bg-secondary/20">
                  <td className="px-4 py-1.5">{countryName(group.key)}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{CONTINENT_LABEL[(continentOf(group.key === '?' ? null : group.key) ?? '?') as Continent | '?']()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{group.users}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{group.active}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{minutesLabel(group.minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------
// Cuándo
// ------------------------------------------------------------
function WhenTab({ snapshot, users, filtered }: { snapshot: UsageSnapshot; users: UsageSnapshot['users']; filtered: boolean }) {
  const study = useMemo(() => sumMatrices(users.map((user) => user.mx), 168), [users]);
  const hours = hoursOf(study);
  const weekdays = weekdaysOf(study);
  const days = weekdayShort();
  const peak = peakWindow(study);
  const slen = sumMatrices(users.map((user) => user.sl), 5);
  const focus = sumMatrices(users.map((user) => user.fo), 5);
  const withProfile = users.filter((user) => user.mx).length;

  return (
    <div className="space-y-4">
      {peak && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4 text-sm">
            <Flame className="h-5 w-5 shrink-0 text-primary" />
            <span>
              {tr('La franja con más estudio es de {from} a {to}: {share} % de todo el tiempo de estudio.', {
                from: hourLabel(peak.start),
                to: hourLabel((peak.start + 3) % 24),
                share: peak.share,
              })}
            </span>
          </CardContent>
        </Card>
      )}
      <Panel title={tr('Cuándo estudian (minutos, hora local de cada estudiante)')} note={tr('Últimos 140 días · {n} estudiantes con la 1.6.9 o posterior', { n: withProfile })}>
        <WeekHeat matrix={study} unit={minutesLabel} empty={tr('Aún nadie mandó estos datos (llegan con la 1.6.9)')} />
      </Panel>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={tr('Por hora del día')} bodyClassName="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hours.map((value, hour) => ({ label: hourLabel(hour), value: Math.round(value) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} interval={2} />
              <YAxis tick={axisTick} tickFormatter={hoursTick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [minutesLabel(value), tr('Estudio')]} />
              <Bar dataKey="value" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={tr('Por día de la semana')} bodyClassName="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weekdays.map((value, day) => ({ label: days[day], value: Math.round(value) }))} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
              <XAxis dataKey="label" tick={axisTick} />
              <YAxis tick={axisTick} tickFormatter={hoursTick} />
              <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [minutesLabel(value), tr('Estudio')]} />
              <Bar dataKey="value" fill="hsl(var(--chart-2))" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={tr('Duración de las sesiones')}>
          <RankList rows={[tr('< 15 min'), tr('15–30 min'), tr('30–60 min'), tr('1–2 h'), tr('2 h o más')].map((label, i) => ({ label, value: slen[i] }))} empty={tr('Sin sesiones registradas')} limit={5} />
        </Panel>
        <Panel title={tr('Enfoque que declaran (1–20)')}>
          <RankList rows={['1–4', '5–8', '9–12', '13–16', '17–20'].map((label, i) => ({ label, value: focus[i] }))} empty={tr('Sin sesiones de rendimiento')} limit={5} />
        </Panel>
      </div>
      <Panel title={tr('Cuándo abren Frame (aperturas del día, hora local)')} note={filtered ? tr('De todos los estudiantes: este dato no se separa por lugar') : tr('Últimos 400 días')}>
        <WeekHeat matrix={snapshot.mx_open} unit={(n) => tr('{n} aperturas', { n })} empty={tr('Sin aperturas registradas')} />
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------
// Funciones
// ------------------------------------------------------------
function FeaturesTab({ snapshot, users, range, filtered }: { snapshot: UsageSnapshot; users: UsageSnapshot['users']; range: Range; filtered: boolean }) {
  const adoption = useMemo(() => adoptionOf(users), [users]);
  const screens = seriesTotals(snapshot.sc, range).filter((row) => row.key in SCREEN_LABEL);
  const screenUsers = (screen: string) => users.filter((user) => (user.sc[screen] ?? 0) > 0).length;
  const events = seriesTotals(snapshot.ev, range).filter((row) => row.key in EVENT_LABEL);
  const reports = Object.entries(snapshot.reports).sort((a, b) => b[1] - a[1]);
  const started = sum((snapshot.ev.guest_started ?? []).filter(([dn]) => dn >= range.from && dn <= range.to).map(([, n]) => n));
  const linked = sum((snapshot.ev.guest_linked ?? []).filter(([dn]) => dn >= range.from && dn <= range.to).map(([, n]) => n));
  const embeds = ['/gmail', '/classroom', '/youtube', '/drive'].map((screen) => ({ label: SCREEN_LABEL[screen](), value: screenUsers(screen) }));

  return (
    <div className="space-y-4">
      <Panel title={tr('Qué usan: estudiantes con al menos uno')} note={tr('Porcentaje de los estudiantes que ya mandaron su perfil (1.6.9 o posterior) · entre paréntesis, el total de elementos')}>
        <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
          <RankList rows={adoption.slice(0, Math.ceil(adoption.length / 2)).map((row) => ({ label: FEATURE_LABEL[row.key](), value: row.pct, display: `${row.pct} %`, extra: `${row.users} (${numberLabel(row.total)})` }))} empty={tr('Sin datos todavía')} limit={20} />
          <RankList rows={adoption.slice(Math.ceil(adoption.length / 2)).map((row) => ({ label: FEATURE_LABEL[row.key](), value: row.pct, display: `${row.pct} %`, extra: `${row.users} (${numberLabel(row.total)})` }))} empty="" limit={20} />
        </div>
      </Panel>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title={tr('Interfaces más abiertas en el plazo')} note={filtered ? tr('Las veces son de todos; los estudiantes, del filtro') : tr('Veces (una por estudiante y día) · estudiantes que la usan')}>
          <RankList rows={screens.map((row) => ({ label: SCREEN_LABEL[row.key](), value: row.count, extra: tr('{n} est.', { n: screenUsers(row.key) }) }))} empty={tr('Sin interfaces registradas en el plazo')} limit={15} />
        </Panel>
        <Panel title={tr('Actividad en el plazo')}>
          <RankList rows={events.map((row) => ({ label: EVENT_LABEL[row.key](), value: row.count, extra: plural(row.days, tr('{n} día'), tr('{n} días')) }))} empty={tr('Sin actividad en el plazo')} limit={12} />
        </Panel>
        <div className="space-y-4">
          <Panel title={tr('Google dentro de Frame')} note={tr('Estudiantes que lo abrieron alguna vez')}>
            <RankList rows={embeds} empty={tr('Nadie todavía')} limit={4} />
          </Panel>
          <Panel title={tr('Informes generados (400 días)')}>
            <RankList rows={reports.map(([format, count]) => ({ label: format.toUpperCase(), value: count }))} empty={tr('Ninguno todavía')} limit={4} />
          </Panel>
          <Panel title={tr('Invitados en el plazo')}>
            <RankList
              rows={[
                { label: tr('Entraron como invitado'), value: started },
                { label: tr('Vincularon Google'), value: linked, extra: started > 0 ? `${Math.round((linked / started) * 100)} %` : undefined },
              ]}
              empty=""
              limit={2}
            />
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// Retención
// ------------------------------------------------------------
function RetentionTab({ snapshot, users, range }: { snapshot: UsageSnapshot; users: UsageSnapshot['users']; range: Range }) {
  const cohorts = useMemo(() => cohortsOf(snapshot, 12, users), [snapshot, users]);
  const back = weekTwoReturn(snapshot, users);
  const sleeping = dormant(snapshot, users);
  const summary = useMemo(() => summarize(snapshot, range, users), [snapshot, range, users]);
  const daily = useMemo(() => {
    const from = Math.max(range.from, range.to - 364);
    return stickinessSeries(snapshot, { from, to: range.to }, users).map((point) => ({ ...point, label: dayLabel(point.dn) }));
  }, [snapshot, range, users]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Repeat} label={tr('Vuelven la segunda semana')} value={pctLabel(back.pct)} hint={tr('{n} de {total} que ya cumplieron dos semanas', { n: back.returned, total: back.eligible })} />
        <Kpi icon={Activity} label={tr('Uso diario sobre el mensual')} value={pctLabel(summary.stickiness)} hint={tr('activos de media al día / activos en 30 días')} />
        <Kpi icon={CalendarDays} label={tr('Sin abrir Frame 14 días')} value={numberLabel(sleeping.d14)} hint={tr('{n} llevan 30 días o más', { n: sleeping.d30 })} />
        <Kpi icon={Users} label={tr('Activos en 30 días')} value={numberLabel(summary.active30)} hint={tr('{n} en los últimos 7', { n: summary.active7 })} />
      </div>
      <Panel title={tr('Activos al día, en la semana y en el mes')} bodyClassName="h-60">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={daily} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
            <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tick={axisTick} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Line type="monotone" dataKey="dau" name={tr('Del día')} stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="wau" name={tr('De 7 días')} stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="mau" name={tr('De 30 días')} stroke="hsl(var(--chart-4))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title={tr('Cohortes: de quienes empezaron cada semana, qué parte siguió activa')} note={tr('Fila: la semana en que empezaron (y cuántos eran) · columna: semanas después')} bodyClassName="p-0 pt-3">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-[10px] text-muted-foreground">
              <tr className="border-y border-border/60 bg-secondary/30">
                <th className="px-3 py-1.5 text-left font-bold">{tr('Semana del')}</th>
                <th className="px-2 py-1.5 text-right font-bold">{tr('Nuevos')}</th>
                {cohorts[0]?.weeks.map((_, week) => (
                  <th key={week} className="px-1 py-1.5 text-center font-bold tabular-nums">{week}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((cohort) => (
                <tr key={cohort.monday} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-1">{dayLabel(cohort.monday)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{cohort.size}</td>
                  {cohort.weeks.map((value, week) => (
                    <td key={week} className="px-0.5 py-0.5">
                      {value !== null && cohort.size > 0 ? (
                        <span className="flex h-6 items-center justify-center rounded-[3px] tabular-nums" style={{ backgroundColor: `hsl(var(--primary) / ${0.08 + (value / 100) * 0.8})`, color: value > 55 ? 'hsl(var(--primary-foreground))' : undefined }}>
                          {value}
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------
// Versiones y errores
// ------------------------------------------------------------
function QualityTab({ snapshot, users }: { snapshot: UsageSnapshot; users: UsageSnapshot['users'] }) {
  const newest = newestVersions(snapshot.users);
  const versions = useMemo(() => {
    const counts = new Map<string, { platform: string; version: string; users: number }>();
    for (const user of users) {
      const key = `${user.pl}|${user.ve}`;
      const row = counts.get(key) ?? { platform: user.pl ?? '?', version: user.ve ?? '?', users: 0 };
      row.users += 1;
      counts.set(key, row);
    }
    return [...counts.values()].sort((a, b) => a.platform.localeCompare(b.platform) || b.users - a.users);
  }, [users]);
  const outdated = users.filter((user) => isOutdated(user, newest)).length;
  const errors = snapshot.errors;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={CheckCircle2} label={tr('Con la versión más nueva')} value={pctLabel(users.length > 0 ? Math.round(((users.length - outdated) / users.length) * 100) : null)} hint={plural(outdated, tr('{n} con una versión anterior'), tr('{n} con una versión anterior'))} />
        <Kpi icon={AlertTriangle} label={tr('Errores abiertos')} value={numberLabel(errors.open)} hint={`${plural(errors.fixed, tr('{n} corregido'), tr('{n} corregidos'))} · ${plural(errors.ignored, tr('{n} ignorado'), tr('{n} ignorados'))}`} />
        <Kpi icon={Users} label="Windows" value={numberLabel(users.filter((user) => user.pl === 'windows').length)} hint={newest.windows ? tr('la más nueva: {v}', { v: newest.windows }) : undefined} />
        <Kpi icon={Users} label="Android" value={numberLabel(users.filter((user) => user.pl === 'android').length)} hint={newest.android ? tr('la más nueva: {v}', { v: newest.android }) : undefined} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title={tr('Versiones instaladas')}>
          <RankList
            rows={versions.map((row) => ({
              label: `${PLATFORM_LABEL[row.platform] ?? row.platform} ${row.version}${row.version === newest[row.platform] ? tr(' · la más nueva') : ''}`,
              value: row.users,
              extra: row.users === 1 ? tr('estudiante') : tr('estudiantes'),
              muted: row.version !== newest[row.platform],
            }))}
            empty={tr('Sin instalaciones registradas')}
            limit={20}
          />
        </Panel>
        <Panel title={tr('Errores abiertos más repetidos')} note={tr('Se agrupan solos en el registro de errores; se corrigen desde el código')}>
          {errors.top.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">{tr('Ningún error abierto')}</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {errors.top.map((item, index) => (
                <li key={index} className="rounded-md border border-border/60 p-2">
                  <p className="font-medium text-foreground">{item.scope} · {item.name}</p>
                  <p className="break-words text-muted-foreground">{item.message}</p>
                  <p className="mt-1 text-[10px] text-muted-foreground/80">
                    {tr('{n} veces · {users} estudiantes · {versions} · {when}', { n: item.n, users: item.users, versions: (item.versions ?? []).join(', '), when: ago(item.last) })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default UsagePanel;
