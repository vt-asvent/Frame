import { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ArrowDownUp, LoaderCircle, MapPin, Monitor, Search, Smartphone, Tablet } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EchoHeader } from '@/components/shared/EchoWord';
import { cn } from '@/lib/utils';
import { dateLocale, decimalText, tr } from '@m/lib/i18n';
import {
  activityOf,
  continentOf,
  dayOfInstant,
  displayName,
  FEATURE_KEYS,
  featureValue,
  firstDayOf,
  isOutdated,
  levelOf,
  type Activity,
  type Level,
  type Range,
  type SnapUser,
  type UserDetail,
  type UsageSnapshot,
} from '@m/lib/usage-model';
import {
  axisTick,
  CONTINENT_LABEL,
  countryName,
  dayLabel,
  DEVICE_LABEL,
  EVENT_LABEL,
  FEATURE_LABEL,
  LANG_LABEL,
  LEVEL_DOT,
  LEVEL_LABEL,
  longDayLabel,
  minutesLabel,
  netError,
  numberLabel,
  pctLabel,
  PLATFORM_LABEL,
  RankList,
  SCREEN_LABEL,
  tooltipStyle,
  WeekHeat,
} from '@m/components/UsageBits';

// ============================================================
// Estudiantes (Panel de uso, 1.6.9): una tarjeta por estudiante, con
// búsqueda, filtros y orden; al pulsarla, su ficha completa (dentro de lo que
// la Política de Privacidad permite ver: nunca el contenido de nada).
// ============================================================

type Kind = 'all' | 'account' | 'guest';
type SortKey = 'last' | 'minutes' | 'days' | 'tasks' | 'first' | 'streak';

const SORT_LABEL: Record<SortKey, () => string> = {
  last: () => tr('Última vez'),
  minutes: () => tr('Estudio en el plazo'),
  days: () => tr('Días activos en el plazo'),
  tasks: () => tr('Tareas en el plazo'),
  first: () => tr('Más recientes'),
  streak: () => tr('Racha'),
};

const PAGE = 24;

const ago = (iso: string) => {
  try {
    return formatDistanceToNowStrict(parseISO(iso), { locale: dateLocale(), addSuffix: true });
  } catch {
    return '—';
  }
};

const DeviceIcon = ({ user, className }: { user: SnapUser; className?: string }) => {
  const Icon = user.dv === 'phone' ? Smartphone : user.dv === 'tablet' ? Tablet : user.pl === 'android' ? Smartphone : Monitor;
  return <Icon className={className} aria-label={DEVICE_LABEL[user.dv ?? '']?.() ?? PLATFORM_LABEL[user.pl ?? ''] ?? tr('Sistema')} />;
};

const placeOf = (user: SnapUser) => [user.ci, user.cc ? countryName(user.cc) : user.co].filter(Boolean).join(', ') || tr('Sin ubicación');

/** Los últimos 30 días del plazo, en barritas. */
function Spark({ user, range }: { user: SnapUser; range: Range }) {
  const from = Math.max(range.from, range.to - 29);
  const minutes = new Map(user.d.map((row) => [row[0], row[1]]));
  const active = new Set(user.a);
  const days = Array.from({ length: range.to - from + 1 }, (_, i) => from + i);
  const max = Math.max(1, ...days.map((dn) => minutes.get(dn) ?? 0));
  return (
    <div className="flex h-6 items-end gap-px" aria-hidden>
      {days.map((dn) => {
        const value = minutes.get(dn) ?? 0;
        return (
          <span
            key={dn}
            className={cn('flex-1 rounded-[1px]', value > 0 ? 'bg-primary/80' : active.has(dn) ? 'bg-primary/30' : 'bg-secondary')}
            style={{ height: value > 0 ? `${20 + (value / max) * 80}%` : active.has(dn) ? '20%' : '12%' }}
          />
        );
      })}
    </div>
  );
}

function StudentCard({ user, range, activity, newest, onOpen }: { user: SnapUser; range: Range; activity: Activity; newest: Record<string, string>; onOpen: () => void }) {
  const level = levelOf(user, range);
  const name = displayName(user, tr('Invitado'));
  const outdated = isOutdated(user, newest);
  return (
    <Card role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen()} className="cursor-pointer border-border/70 transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start gap-3">
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-headline text-sm font-bold', user.g ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/15 text-primary')}>
            {(name.trim()[0] ?? '?').toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', LEVEL_DOT[level])} title={LEVEL_LABEL[level]()} />
              <p className="truncate text-sm font-semibold text-foreground">{name}</p>
            </div>
            <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{placeOf(user)}</span>
            </p>
          </div>
          <span className={cn('shrink-0 rounded px-1.5 py-px text-[9px] font-bold', user.g ? 'bg-amber-500/15 text-amber-500' : 'bg-primary/15 text-primary')}>
            {user.g ? tr('Invitado') : tr('Cuenta')}
          </span>
        </div>
        <Spark user={user} range={range} />
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="font-headline text-sm font-bold tabular-nums">{minutesLabel(activity.minutes)}</p>
            <p className="text-[10px] text-muted-foreground">{tr('estudio')}</p>
          </div>
          <div>
            <p className="font-headline text-sm font-bold tabular-nums">{activity.activeDays}</p>
            <p className="text-[10px] text-muted-foreground">{tr('días activos')}</p>
          </div>
          <div>
            <p className="font-headline text-sm font-bold tabular-nums">{activity.tasks}</p>
            <p className="text-[10px] text-muted-foreground">{tr('tareas')}</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <DeviceIcon user={user} className="h-3 w-3" />
            <span className={cn('tabular-nums', outdated && 'text-amber-500')} title={outdated ? tr('Hay una más nueva: {p}', { p: newest[user.pl ?? ''] }) : undefined}>
              {user.ve ?? '—'}
              {outdated && ' ↑'}
            </span>
          </span>
          <span>{ago(user.ls)}</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------
// Ficha del estudiante
// ------------------------------------------------------------
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="truncate text-xs font-medium text-foreground">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-[11px] font-bold text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

const SLEN_LABELS = () => [tr('< 15 min'), tr('15–30 min'), tr('30–60 min'), tr('1–2 h'), tr('2 h o más')];
const FOCUS_LABELS = ['1–4', '5–8', '9–12', '13–16', '17–20'];

function StudentDialog({
  user,
  range,
  detail,
  loading,
  error,
  onClose,
}: {
  user: SnapUser | null;
  range: Range;
  detail: UserDetail | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  const series = useMemo(() => {
    if (!user) return [];
    const minutes = new Map(user.d.map((row) => [row[0], row]));
    const from = Math.max(range.from, range.to - 179);
    return Array.from({ length: range.to - from + 1 }, (_, i) => {
      const dn = from + i;
      const row = minutes.get(dn);
      return { label: dayLabel(dn), minutes: row ? Math.round(row[1]) : 0, tasks: row ? row[3] : 0 };
    });
  }, [user, range]);

  if (!user) return null;
  const activity = activityOf(user, range);
  const name = displayName(user, tr('Invitado'));
  const continent = continentOf(user.cc);
  const features = FEATURE_KEYS.map((key) => ({ key, value: featureValue(user, key) })).filter((row) => row.value > 0);
  const screens = Object.entries(user.sc)
    .filter(([screen, days]) => screen in SCREEN_LABEL && days > 0)
    .map(([screen, value]) => ({ id: screen, label: SCREEN_LABEL[screen](), value }))
    .sort((a, b) => b.value - a.value);
  const events = Object.entries(user.e)
    .filter(([event]) => event in EVENT_LABEL && event !== 'screen_view')
    .map(([event, value]) => ({ id: event, label: EVENT_LABEL[event](), value }))
    .sort((a, b) => b.value - a.value);
  const slen = user.sl ?? [0, 0, 0, 0, 0];
  const focus = user.fo ?? [0, 0, 0, 0, 0];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <EchoHeader word={tr('Estudiante')}>
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-bold text-primary">{name}</DialogTitle>
            <DialogDescription className="text-center text-xs">
              {user.g ? tr('Invitado') : tr('Cuenta')}
              {' · '}
              {placeOf(user)}
              {' · '}
              {tr('desde el {day}', { day: longDayLabel(firstDayOf(user)) })}
            </DialogDescription>
          </DialogHeader>
        </EchoHeader>

        <div className="space-y-5">
          <Section title={tr('Perfil')}>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-4">
              <Fact label={tr('Ciudad y región')} value={[user.ci, user.re].filter(Boolean).join(', ') || '—'} />
              <Fact label={tr('País y continente')} value={`${user.cc ? countryName(user.cc) : user.co ?? '—'}${continent ? ` · ${CONTINENT_LABEL[continent]()}` : ''}`} />
              <Fact label={tr('Zona horaria')} value={user.tz ?? '—'} />
              <Fact label={tr('Idioma de Frame · del sistema')} value={`${user.la ? LANG_LABEL[user.la]?.() ?? user.la : '—'} · ${user.lo ?? '—'}`} />
              <Fact label={tr('Equipo')} value={`${user.dv ? DEVICE_LABEL[user.dv]?.() ?? user.dv : '—'} · ${PLATFORM_LABEL[user.pl ?? ''] ?? user.pl ?? '—'} ${user.ve ?? ''}`} />
              <Fact label={tr('Última vez')} value={ago(user.ls)} />
              <Fact label={tr('Días activos (400 días)')} value={numberLabel(user.a.length)} />
              <Fact label={tr('Racha actual · mejor')} value={`${user.st ?? '—'} · ${user.bs ?? '—'}`} />
              <Fact label={tr('Dispositivos vinculados (30 días)')} value={user.g ? '—' : numberLabel(user.nd ?? 0)} />
              <Fact label={tr('Archivos de la Biblioteca (400 días)')} value={numberLabel(user.e.library_download ?? 0)} />
              <Fact label={tr('Canciones descargadas (400 días)')} value={numberLabel(user.e.song_download ?? 0)} />
            </div>
          </Section>

          <Section title={tr('En el plazo elegido')}>
            <div className="grid grid-cols-2 gap-3 rounded-md border border-border/60 p-3 sm:grid-cols-5">
              <Fact label={tr('Estudio')} value={minutesLabel(activity.minutes)} />
              <Fact label={tr('Sesiones')} value={numberLabel(activity.sessions)} />
              <Fact label={tr('Tareas culminadas')} value={`${activity.tasks} · ${pctLabel(activity.withDue > 0 ? Math.round((activity.onTime / activity.withDue) * 100) : null)} ${tr('a tiempo')}`} />
              <Fact label={tr('Constancia de hábitos')} value={pctLabel(activity.habitsPossible > 0 ? Math.round((activity.habitsDone / activity.habitsPossible) * 100) : null)} />
              <Fact label={tr('Enfoque medio (1–20)')} value={activity.focusDays > 0 ? decimalText(activity.focusSum / activity.focusDays) : '—'} />
            </div>
            <div className="h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fichaMinutos" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="hsl(var(--foreground))" strokeDasharray="3 3" strokeOpacity={0.12} />
                  <XAxis dataKey="label" tick={axisTick} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [minutesLabel(value), tr('Estudio')]} />
                  <Area type="monotone" dataKey="minutes" stroke="hsl(var(--primary))" fill="url(#fichaMinutos)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Section>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
              <LoaderCircle className="h-4 w-4 animate-spin" /> {tr('Cargando su detalle…')}
            </div>
          )}
          {error && <p className="text-center text-xs text-destructive">{error}</p>}
          {detail && (
            <>
              <div className="grid gap-5 md:grid-cols-2">
                <Section title={tr('Cuándo estudia (últimos 140 días)')}>
                  <WeekHeat matrix={detail.mx ?? []} unit={minutesLabel} empty={tr('Sin sesiones registradas con esta versión')} />
                </Section>
                <Section title={tr('Cuándo abre Frame')}>
                  <WeekHeat matrix={detail.opens} unit={(n) => tr('{n} aperturas', { n })} empty={tr('Sin aperturas registradas')} />
                </Section>
              </div>
              {detail.weeks.length > 0 && (
                <Section title={tr('Sus semanas')}>
                  <div className="overflow-x-auto rounded-md border border-border/60">
                    <table className="w-full text-[11px]">
                      <thead className="bg-secondary/30 text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-bold">{tr('Semana del')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('Estudio')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('Días')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('Tareas')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('A tiempo')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('Enfoque')}</th>
                          <th className="px-2 py-1.5 text-right font-bold">{tr('Hábitos')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.weeks.slice(-10).reverse().map(([monday, minutes, , days, tasks, onTime, withDue, focusAvg, habits]) => (
                          <tr key={monday} className="border-t border-border/40">
                            <td className="px-2 py-1">{dayLabel(dayOfInstant(`${monday}T17:00:00Z`))}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{minutesLabel(minutes)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{days}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{tasks}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{pctLabel(withDue > 0 ? Math.round((onTime / withDue) * 100) : null)}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{focusAvg ?? '—'}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{pctLabel(habits)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              )}
            </>
          )}

          <div className="grid gap-5 md:grid-cols-2">
            <Section title={tr('Cómo estudia: duración de las sesiones')}>
              <RankList rows={SLEN_LABELS().map((label, i) => ({ label, value: slen[i] }))} empty={tr('Sin sesiones registradas con esta versión')} limit={5} />
            </Section>
            <Section title={tr('Enfoque que declara (1–20)')}>
              <RankList rows={FOCUS_LABELS.map((label, i) => ({ label, value: focus[i] }))} empty={tr('Sin sesiones de rendimiento')} limit={5} />
            </Section>
            <Section title={tr('Funciones que usa')}>
              <RankList rows={features.map((row) => ({ label: FEATURE_LABEL[row.key](), value: row.value }))} empty={tr('Aún no mandó su perfil (versión anterior a la 1.6.9)')} limit={17} />
            </Section>
            <Section title={tr('Interfaces que abre (días distintos)')}>
              <RankList rows={screens} empty={tr('Sin interfaces registradas')} limit={15} />
            </Section>
          </div>

          {events.length > 0 && (
            <Section title={tr('Lo que hace en Frame (400 días)')}>
              <RankList rows={events} empty="" limit={12} />
            </Section>
          )}

          {detail && detail.recent.length > 0 && (
            <Section title={tr('Actividad reciente')}>
              <ul className="divide-y divide-border/40 rounded-md border border-border/60 text-[11px]">
                {detail.recent.slice(0, 25).map((event, index) => (
                  <li key={`${event.at}-${index}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <span className="truncate">
                      {EVENT_LABEL[event.e]?.() ?? event.e}
                      {event.s && event.s in SCREEN_LABEL ? ` · ${SCREEN_LABEL[event.s]()}` : ''}
                      {event.f ? ` · ${event.f.toUpperCase()}` : ''}
                      {event.m ? ` · ${minutesLabel(Number(event.m) || 0)}` : ''}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{ago(event.at)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="flex justify-end">
            <Button variant="gris" onClick={onClose}>
              {tr('Cerrar')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------
// La pestaña
// ------------------------------------------------------------
export default function StudentsTab({
  snapshot,
  users,
  range,
  newest,
  loadDetail,
}: {
  snapshot: UsageSnapshot;
  users: SnapUser[];
  range: Range;
  newest: Record<string, string>;
  loadDetail: (id: string) => Promise<UserDetail>;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [level, setLevel] = useState<Level | 'all'>('all');
  const [sort, setSort] = useState<SortKey>('last');
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<SnapUser | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Lo de cada estudiante en el plazo, una vez (ordenar lo pedía en cada comparación).
  const activity = useMemo(() => new Map(users.map((user) => [user.id, activityOf(user, range)])), [users, range]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = users.filter((user) => {
      if (kind !== 'all' && (kind === 'guest') !== user.g) return false;
      if (level !== 'all' && levelOf(user, range) !== level) return false;
      if (!needle) return true;
      return [user.n, user.ci, user.re, user.cc ? countryName(user.cc) : user.co, user.id].some((text) => text?.toLowerCase().includes(needle));
    });
    const value = (user: SnapUser): number => {
      switch (sort) {
        case 'minutes':
          return activity.get(user.id)?.minutes ?? 0;
        case 'days':
          return activity.get(user.id)?.activeDays ?? 0;
        case 'tasks':
          return activity.get(user.id)?.tasks ?? 0;
        case 'first':
          return firstDayOf(user);
        case 'streak':
          return user.st ?? 0;
        default:
          return Date.parse(user.ls) || 0;
      }
    };
    return [...filtered].sort((a, b) => value(b) - value(a));
  }, [users, query, kind, level, sort, range, activity]);

  useEffect(() => setShown(PAGE), [query, kind, level, sort, users]);

  const openUser = (user: SnapUser) => {
    setOpen(user);
    setDetail(null);
    setError(null);
    setLoading(true);
    loadDetail(user.id)
      .then((value) => setDetail(value))
      .catch((reason: unknown) => setError(netError(reason instanceof Error ? reason.message : String(reason))))
      .finally(() => setLoading(false));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('Buscar por nombre, ciudad o país')} className="h-9 pl-8 text-xs" />
        </div>
        <Tabs value={kind} onValueChange={(value) => setKind(value as Kind)}>
          <TabsList className="h-9">
            <TabsTrigger value="all" className="px-2.5 text-xs">{tr('Todos')}{' '}{users.length}</TabsTrigger>
            <TabsTrigger value="account" className="px-2.5 text-xs">{tr('Cuentas')}{' '}{users.filter((u) => !u.g).length}</TabsTrigger>
            <TabsTrigger value="guest" className="px-2.5 text-xs">{tr('Invitados')}{' '}{users.filter((u) => u.g).length}</TabsTrigger>
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
              <span className={cn('h-2 w-2 rounded-full', level === 'all' ? 'bg-muted-foreground/40' : LEVEL_DOT[level])} />
              {level === 'all' ? tr('Toda actividad') : LEVEL_LABEL[level]()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">{tr('Actividad en el plazo')}</DropdownMenuLabel>
            <DropdownMenuItem className="text-xs" onSelect={() => setLevel('all')}>{tr('Toda actividad')}</DropdownMenuItem>
            {(Object.keys(LEVEL_LABEL) as Level[]).map((key) => (
              <DropdownMenuItem key={key} className="flex-col items-start text-xs" onSelect={() => setLevel(key)}>
                <span className="flex items-center gap-1.5"><span className={cn('h-2 w-2 rounded-full', LEVEL_DOT[key])} />{LEVEL_LABEL[key]()}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs">
              <ArrowDownUp className="h-3.5 w-3.5" /> {SORT_LABEL[sort]()}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">{tr('Ordenar por')}</DropdownMenuLabel>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((key) => (
              <DropdownMenuItem key={key} onSelect={() => setSort(key)} className={cn('text-xs', sort === key && 'text-primary')}>
                {SORT_LABEL[key]()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center text-xs text-muted-foreground">{tr('Nadie en este grupo')}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {rows.slice(0, shown).map((user) => (
            <StudentCard key={user.id} user={user} range={range} activity={activity.get(user.id) ?? activityOf(user, range)} newest={newest} onOpen={() => openUser(user)} />
          ))}
        </div>
      )}
      {rows.length > shown && (
        <div className="flex justify-center">
          <Button variant="fantasma" size="sm" onClick={() => setShown((value) => value + PAGE)}>
            {tr('Ver {n} más', { n: Math.min(PAGE, rows.length - shown) })}
          </Button>
        </div>
      )}
      <p className="text-center text-[10px] text-muted-foreground/70">
        {tr('{n} de {total} estudiantes · actualizado {when}', { n: Math.min(shown, rows.length), total: rows.length, when: ago(snapshot.generated_at) })}
      </p>

      {open && <StudentDialog user={open} range={range} detail={detail} loading={loading} error={error} onClose={() => setOpen(null)} />}
    </div>
  );
}
