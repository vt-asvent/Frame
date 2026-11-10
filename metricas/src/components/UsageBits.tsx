import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { dateLocale, getLang, tr } from '@m/lib/i18n';
import { dateOfDay, type FeatureKey, type Level } from '@m/lib/usage-model';
import type { Continent } from '@m/lib/world-map';

// ============================================================
// Piezas del Panel de uso (1.6.9): cifras, listas con barras, repartos en
// anillo, el mapa de calor de la semana y las etiquetas (en los dos idiomas)
// de todo lo que el panel nombra.
// ============================================================

export const tooltipStyle = {
  backgroundColor: 'hsl(var(--background))',
  borderColor: 'hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
};

export const axisTick = { fontSize: 10, fill: 'hsl(var(--muted-foreground))' };

/** Paleta de los repartos: el azul de Frame primero, después los del tema. */
export const PALETTE = [
  'hsl(var(--primary))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-1))',
  'hsl(var(--muted-foreground))',
];

// ------------------------------------------------------------
// Formatos
// ------------------------------------------------------------
/**
 * Miles con punto en español (12.345; hasta 9999 sin separador, como pide la
 * RAE): Frame escribe los decimales con coma, y la agrupación de Perú («2,814»)
 * se leería como dos con algo.
 */
export const numberLabel = (value: number) => Math.round(value).toLocaleString(getLang() === 'en' ? 'en-US' : 'es-ES');

export const minutesLabel = (minutes: number) => {
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  // Con cientos de horas los minutos sobran y rompen la línea del recuadro.
  if (h >= 100) return `${numberLabel(h)} h`;
  return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
};
export const pctLabel = (value: number | null) => (value === null ? '—' : `${value} %`);

/** «1 activo» / «3 activos»: `one` y `many` llevan {n}. */
export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many).replace('{n}', numberLabel(n));

/** Eje en horas para los gráficos de minutos (las cifras de minutos crecen rápido). */
export const hoursTick = (minutes: number) => `${numberLabel(minutes / 60)} h`;

/** Los fallos de red, en palabras del usuario (llegan en inglés y en jerga). */
export const netError = (message: string) =>
  /fetch|network|timed? ?out|ECONN|ENOTFOUND|load failed/i.test(message) ? tr('No se pudo conectar con la nube') : message;

export const dayLabel = (dn: number) => format(dateOfDay(dn), tr('d MMM'), { locale: dateLocale() });
export const longDayLabel = (dn: number) => format(dateOfDay(dn), tr("d 'de' MMMM 'de' yyyy"), { locale: dateLocale() });
export const bucketLabel = (from: number, to: number) => (from === to ? dayLabel(from) : `${dayLabel(from)} – ${dayLabel(to)}`);

let regionNames: { lang: string; names: Intl.DisplayNames | null } | null = null;
/** Nombre del país en el idioma de Frame. */
export function countryName(code: string | null | undefined): string {
  if (!code || code === '?') return tr('Sin ubicación');
  if (code === 'XK') return 'Kosovo';
  const lang = getLang();
  if (regionNames?.lang !== lang) {
    try {
      regionNames = { lang, names: new Intl.DisplayNames([lang], { type: 'region' }) };
    } catch {
      regionNames = { lang, names: null };
    }
  }
  return regionNames.names?.of(code) ?? code;
}

export const CONTINENT_LABEL: Record<Continent | '?', () => string> = {
  AF: () => tr('África'),
  AN: () => tr('Antártida'),
  AS: () => tr('Asia'),
  EU: () => tr('Europa'),
  NA: () => tr('Norteamérica'),
  OC: () => tr('Oceanía'),
  SA: () => tr('Sudamérica'),
  '?': () => tr('Sin ubicación'),
};

export const LEVEL_LABEL: Record<Level, () => string> = {
  high: () => tr('Muy activos'),
  mid: () => tr('Activos'),
  low: () => tr('Ocasionales'),
  none: () => tr('Inactivos'),
};
export const LEVEL_HINT: Record<Level, () => string> = {
  high: () => tr('La mitad de los días del plazo o más'),
  mid: () => tr('Al menos uno de cada cinco días'),
  low: () => tr('Algún día del plazo'),
  none: () => tr('Ningún día del plazo'),
};
export const LEVEL_DOT: Record<Level, string> = {
  high: 'bg-emerald-500',
  mid: 'bg-primary',
  low: 'bg-amber-500',
  none: 'bg-muted-foreground/50',
};

export const DEVICE_LABEL: Record<string, () => string> = {
  desktop: () => tr('Computadora'),
  tablet: () => tr('Tableta'),
  phone: () => tr('Celular'),
};
export const PLATFORM_LABEL: Record<string, string> = { windows: 'Windows', android: 'Android' };
export const LANG_LABEL: Record<string, () => string> = { es: () => tr('Español'), en: () => tr('Inglés') };

export const FEATURE_LABEL: Record<FeatureKey, () => string> = {
  courses: () => tr('Asignaturas'),
  pending_tasks: () => tr('Tareas pendientes'),
  notes: () => tr('Notas de asignaturas'),
  loose_notes: () => tr('Anotaciones sueltas'),
  events: () => tr('Eventos del calendario'),
  painted_days: () => tr('Días pintados del calendario'),
  collections: () => tr('Colecciones'),
  videos: () => tr('Vídeos de estudio'),
  recordings: () => tr('Grabaciones de voz'),
  active_habits: () => tr('Hábitos'),
  playlists: () => tr('Playlists'),
  songs: () => tr('Canciones importadas'),
  favorites: () => tr('Canciones favoritas'),
  gallery_images: () => tr('Imágenes de la galería'),
  own_images: () => tr('Imágenes propias'),
  day_grades: () => tr('Días con nota de rendimiento'),
  competencies: () => tr('Matriz de competencias'),
};

export const SCREEN_LABEL: Record<string, () => string> = {
  '/': () => tr('Inicio'),
  '/temporizador': () => tr('Estudio'),
  '/tareas': () => tr('Tareas'),
  '/habitos': () => tr('Hábitos'),
  '/cursos': () => tr('Asignatura (detalle)'),
  '/knowledge': () => tr('Asignaturas'),
  '/calendario': () => tr('Calendario'),
  '/biblioteca': () => tr('Biblioteca'),
  '/gmail': () => 'Gmail',
  '/youtube': () => 'YouTube',
  '/drive': () => 'Drive',
  '/classroom': () => 'Classroom',
  '/music': () => tr('Música'),
  '/playlists': () => tr('Playlists'),
  '/settings': () => tr('Ajustes'),
  '/presentacion': () => tr('Presentación'),
};

export const EVENT_LABEL: Record<string, () => string> = {
  app_open: () => tr('Aperturas de la app'),
  screen_view: () => tr('Interfaces abiertas'),
  study_session_end: () => tr('Sesiones de estudio'),
  task_created: () => tr('Tareas creadas'),
  task_completed: () => tr('Tareas culminadas'),
  task_incomplete: () => tr('Tareas no culminadas'),
  habit_checked: () => tr('Hábitos marcados'),
  report_generated: () => tr('Informes generados'),
  account_signed_in: () => tr('Inicios de sesión'),
  guest_started: () => tr('Entradas como invitado'),
  guest_linked: () => tr('Invitados que vincularon Google'),
  library_download: () => tr('Archivos descargados de la Biblioteca'),
  song_download: () => tr('Canciones descargadas'),
};

/** Lunes primero. */
export const weekdayShort = () => Array.from({ length: 7 }, (_, i) => format(new Date(2024, 0, 1 + i), 'EEE', { locale: dateLocale() }).replace('.', ''));
export const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`;

// ------------------------------------------------------------
// Piezas
// ------------------------------------------------------------
export function Kpi({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="border-border/70">
      <CardContent className="flex items-start gap-3 p-4">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
          <p className="whitespace-nowrap font-headline text-2xl font-bold tabular-nums text-foreground">{value}</p>
          {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

/** Recuadro con título y su línea, como todos los de la app. */
export function Panel({
  title,
  note,
  className,
  bodyClassName,
  actions,
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  bodyClassName?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn('border-border/70', className)}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-sm font-headline text-muted-foreground">{title}</CardTitle>
          {actions}
        </div>
        {note && <p className="text-[11px] text-muted-foreground/80">{note}</p>}
      </CardHeader>
      <CardContent className={cn('pt-3', bodyClassName)}>{children}</CardContent>
    </Card>
  );
}

/** Lista con barras proporcionales. */
export function RankList({
  rows,
  empty,
  limit = 8,
  onSelect,
}: {
  rows: { id?: string; label: string; value: number; display?: string; extra?: string; muted?: boolean }[];
  empty: string;
  limit?: number;
  onSelect?: (id: string) => void;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="space-y-2">
      {rows.slice(0, limit).map((r) => {
        const Tag = onSelect && r.id ? 'button' : 'div';
        return (
          <Tag
            key={r.id ?? r.label}
            type={Tag === 'button' ? 'button' : undefined}
            onClick={onSelect && r.id ? () => onSelect(r.id!) : undefined}
            className={cn('block w-full space-y-0.5 text-left', onSelect && r.id && 'rounded-sm hover:bg-secondary/40')}
          >
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className={cn('truncate', r.muted ? 'text-muted-foreground' : 'text-foreground')}>{r.label}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {r.display ?? numberLabel(r.value)}
                {r.extra && <span className="text-muted-foreground/70"> · {r.extra}</span>}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
              <div className={cn('h-full rounded-full', r.muted ? 'bg-muted-foreground/40' : 'bg-primary/70')} style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

/** Reparto en anillo con su leyenda al lado. */
export function Donut({ rows, empty, center }: { rows: { label: string; value: number; hint?: string }[]; empty: string; center?: string }) {
  const total = rows.reduce((acc, row) => acc + row.value, 0);
  if (total === 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative h-32 w-32 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="100%" paddingAngle={rows.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
              {rows.map((row, index) => (
                <Cell key={row.label} fill={PALETTE[index % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} formatter={(value: number) => [`${value} · ${Math.round((value / total) * 100)} %`]} />
          </PieChart>
        </ResponsiveContainer>
        {center && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center font-headline text-lg font-bold tabular-nums">{center}</span>
        )}
      </div>
      <ul className="w-full min-w-0 space-y-1.5 text-xs">
        {rows.map((row, index) => (
          <li key={row.label} className="flex items-center gap-2" title={row.hint}>
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PALETTE[index % PALETTE.length] }} />
            <span className="min-w-0 truncate text-foreground">{row.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {row.value} · {Math.round((row.value / total) * 100)} %
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** La semana hora a hora (lunes arriba): cuanto más intenso, más uso. */
export function WeekHeat({ matrix, unit, empty }: { matrix: number[]; unit: (value: number) => string; empty: string }) {
  const max = Math.max(0, ...matrix);
  if (max <= 0) return <p className="py-6 text-center text-xs text-muted-foreground">{empty}</p>;
  const days = weekdayShort();
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="grid grid-cols-[2.5rem_repeat(24,minmax(0,1fr))] gap-[2px]">
          <span />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="text-center text-[9px] tabular-nums text-muted-foreground">
              {hour % 3 === 0 ? hour : ''}
            </span>
          ))}
          {days.map((day, row) => (
            <div key={day} className="contents">
              <span className="pr-1 text-right text-[10px] capitalize leading-4 text-muted-foreground">{day}</span>
              {Array.from({ length: 24 }, (_, hour) => {
                const value = matrix[row * 24 + hour] ?? 0;
                const level = value / max;
                return (
                  <span
                    key={hour}
                    title={`${day} ${hourLabel(hour)} · ${unit(value)}`}
                    className="h-4 rounded-[3px]"
                    style={{ backgroundColor: value > 0 ? `hsl(var(--primary) / ${0.12 + level * 0.88})` : 'hsl(var(--secondary))' }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
