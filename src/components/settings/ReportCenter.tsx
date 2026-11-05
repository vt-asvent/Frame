import { useMemo, useState } from 'react';
import {
  addMonths,
  addWeeks,
  addYears,
  format,
  isSameMonth,
  isSameYear,
  isSameISOWeek,
} from 'date-fns';
import { Check, ChevronDown, FileText, LoaderCircle, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import ReportPreview from '@/components/settings/ReportPreview';
import { useCourse } from '@/context/CourseContext';
import { useReportExport } from '@/hooks/use-report-export';
import {
  buildPerformanceDoc,
  buildReport,
  hm,
  rangeLabel,
  reportRange,
  type ReportScope,
} from '@/lib/performance-report';
import { buildPendingReport, pendingReportFileBase, pendingSummary } from '@/lib/pending-report';
import type { ReportFormat } from '@/lib/report-export';
import { cn } from '@/lib/utils';
import type { UserProfile } from '@/types';
import { dateLocale, getLang, tr, trc } from '@/lib/i18n';
import { usernameLabel } from '@/lib/enum-labels';

// ============================================================
// Informes (Ajustes).
//
// Dos informes —rendimiento y pendientes— con la misma forma: tres selectores
// en fila (qué informe, de qué tamaño de periodo y cuál de esos periodos), un
// resumen de cuatro cifras, la vista previa REAL del documento y los dos
// formatos. Lo que se ve en la vista previa es exactamente lo que sale.
// ============================================================

type ReportKind = 'performance' | 'pending';

const KINDS: { key: ReportKind; label: string }[] = [
  { key: 'performance', get label() { return tr('Rendimiento'); } },
  { key: 'pending', get label() { return tr('Pendientes'); } },
];

const SCOPES: { key: ReportScope; label: string }[] = [
  { key: 'semana', get label() { return tr('Semanal'); } },
  { key: 'mes', get label() { return tr('Mensual'); } },
  { key: 'anio', get label() { return tr('Anual'); } },
];

const STEP: Record<ReportScope, (date: Date, amount: number) => Date> = {
  semana: addWeeks,
  mes: addMonths,
  anio: addYears,
};

/** Cuántos periodos se ofrecen hacia atrás. Pendientes mira también hacia
 *  delante: lo que vence la semana o el mes que viene. */
const BACK: Record<ReportScope, number> = { semana: 26, mes: 12, anio: 3 };
const AHEAD: Record<ReportScope, number> = { semana: 8, mes: 6, anio: 1 };

const FORMATS: { format: ReportFormat; label: string; icon: typeof FileText; title: string }[] = [
  { format: 'pdf', label: 'PDF', icon: Printer, get title() { return tr('Imprimir o guardar como PDF'); } },
  { format: 'docx', label: 'Word', icon: FileText, get title() { return tr('Documento de Word, editable'); } },
];

/** Botón rectangular que despliega sus opciones. Neutro desde la 1.6.8
 *  (Diego): el azul se reserva para la acción principal del recuadro. */
function Selector<T extends string | number>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
  className?: string;
}) {
  const current = options.find((option) => option.key === value);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className={cn('h-9 justify-between gap-2 px-3 text-xs font-medium text-foreground', className)}>
          <span className="truncate first-letter:uppercase">{current?.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem key={String(option.key)} onSelect={() => onChange(option.key)} className="gap-2 text-xs">
            <Check className={cn('h-3.5 w-3.5', option.key === value ? 'text-primary' : 'invisible')} />
            <span className="first-letter:uppercase">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[9px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-bold tabular-nums', strong ? 'text-primary' : 'text-foreground')}>{value}</p>
    </div>
  );
}

export default function ReportCenter({ userProfile }: { userProfile: UserProfile | null }) {
  const { studySessions, tasks, archivedTasks, courses, spaces, dailyPerformances, studyGoals } = useCourse();
  const { run, busy } = useReportExport();

  const [kind, setKind] = useState<ReportKind>('performance');
  const [scope, setScope] = useState<ReportScope>('mes');
  /** Desplazamiento respecto del periodo actual (negativo = pasado). */
  const [offset, setOffset] = useState(0);

  const studentName = userProfile?.username ? usernameLabel(userProfile.username) : tr('Estudiante');
  const reference = useMemo(() => STEP[scope](new Date(), offset), [scope, offset]);
  const { start, end } = reportRange(scope, reference);
  const label = rangeLabel(scope, start, end);

  // Los periodos del tercer selector, del más reciente al más antiguo.
  const periods = useMemo(() => {
    const now = new Date();
    const ahead = kind === 'pending' ? AHEAD[scope] : 0;
    const list: { key: number; label: string }[] = [];
    for (let step = ahead; step >= -BACK[scope]; step--) {
      const date = STEP[scope](now, step);
      const range = reportRange(scope, date);
      const same =
        scope === 'semana' ? isSameISOWeek(date, now) : scope === 'mes' ? isSameMonth(date, now) : isSameYear(date, now);
      const text =
        scope === 'semana'
          ? `${format(range.start, tr('d MMM'), { locale: dateLocale() })} – ${format(range.end, tr('d MMM yyyy'), { locale: dateLocale() })}`
          : rangeLabel(scope, range.start, range.end);
      list.push({ key: step, label: same ? tr('{text} (actual)', { text }) : text });
    }
    return list;
  }, [kind, scope]);

  const performance = useMemo(
    () =>
      kind === 'performance'
        ? buildReport({
            scope,
            reference,
            studentName,
            sessions: studySessions ?? [],
            tasks: tasks ?? [],
            archivedTasks: archivedTasks ?? [],
            courses: courses ?? [],
            spaces: spaces ?? [],
            performances: dailyPerformances ?? [],
            studyGoals,
          })
        : null,
    [kind, scope, reference, studentName, studySessions, tasks, archivedTasks, courses, spaces, dailyPerformances, studyGoals]
  );

  const pendingInput = useMemo(
    () => ({
      studentName,
      tasks: tasks ?? [],
      courses: courses ?? [],
      spaces: spaces ?? [],
      range: { start, end, label },
    }),
    // `start`/`end` cambian con `reference`; `label` con ellos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [studentName, tasks, courses, spaces, reference, scope]
  );
  const pending = useMemo(() => (kind === 'pending' ? pendingSummary(pendingInput) : null), [kind, pendingInput]);

  const doc = useMemo(
    () => (performance ? buildPerformanceDoc(performance) : kind === 'pending' ? buildPendingReport(pendingInput) : null),
    [performance, kind, pendingInput]
  );

  // El nombre del archivo, en el idioma de Frame; la telemetría recibe
  // siempre el español, para que las cifras no se partan por idioma.
  const spanish = getLang() === 'es';
  const stampOf = (week: string) =>
    scope === 'anio' ? format(start, 'yyyy') : scope === 'mes' ? format(start, 'yyyy-MM') : format(start, `RRRR-'${week}'II`);
  const period = spanish ? scope : { semana: trc('archivo', 'semana'), mes: trc('archivo', 'mes'), anio: trc('archivo', 'año') }[scope];
  const fileBase =
    kind === 'performance'
      ? tr('Frame-Rendimiento-{p}', { p: `${period}-${stampOf(spanish ? 'S' : 'W')}` })
      : pendingReportFileBase(new Date(), `${period}-${stampOf(spanish ? 'S' : 'W')}`);
  const reportId = `Frame-${kind === 'performance' ? 'Rendimiento' : 'Pendientes'}-${scope}-${stampOf('S')}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* Qué informe · tamaño del periodo · cuál. */}
      <div className="flex flex-wrap items-center gap-2">
        <Selector
          value={kind}
          options={KINDS}
          onChange={(next) => {
            setKind(next);
            if (next === 'performance' && offset > 0) setOffset(0);
          }}
          className="w-36"
        />
        <Selector
          value={scope}
          options={SCOPES}
          onChange={(next) => {
            setScope(next);
            setOffset(0);
          }}
          className="w-32"
        />
        <Selector value={offset} options={periods} onChange={setOffset} className="min-w-[11rem] flex-1" />
      </div>

      {/* Resumen: las cifras que contará el documento. */}
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-primary bg-primary/10 p-3 text-center sm:grid-cols-4">
        {performance ? (
          <>
            <Stat label={tr('Estudio')} value={hm(performance.totalMinutes)} strong />
            <Stat label={tr('Sesiones')} value={String(performance.sessionCount)} />
            <Stat label={tr('Tareas culminadas')} value={String(performance.tasksDone)} />
            <Stat
              label={tr('Calificación media')}
              value={performance.gradeAverage !== null ? performance.gradeAverage.toFixed(1) : '—'}
            />
          </>
        ) : pending ? (
          <>
            <Stat label={tr('Pendientes')} value={String(pending.pending)} strong />
            <Stat label={tr('Vencidas')} value={String(pending.overdue)} />
            <Stat label={tr('Asignaturas')} value={String(pending.subjects)} />
            <Stat label={tr('Tiempo estimado')} value={pending.estimatedMinutes > 0 ? hm(pending.estimatedMinutes) : '—'} />
          </>
        ) : null}
      </div>

      <ReportPreview doc={doc} fill />

      <div className="grid grid-cols-2 gap-2">
        {FORMATS.map(({ format: fmt, label: name, icon: Icon, title }) => (
          <Button
            key={fmt}
            // PDF en gris y Word en fantasma (1.6.8, Diego).
            variant={fmt === 'docx' ? 'fantasma' : 'gris'}
            disabled={busy !== null || !doc}
            onClick={() => doc && void run(() => doc, fileBase, fmt, reportId)}
            title={title}
          >
            {busy === fmt ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Icon className="mr-2 h-4 w-4" />}
            {name}
          </Button>
        ))}
      </div>
    </div>
  );
}
