import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { useTodayKey } from '@/hooks/use-today';
import Image from '@/lib/image';
import { useRouter } from '@/lib/navigation';
import type { DailyPerformance, Task, TaskPriority } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Calendar, Clock, Upload, Flame, AlertTriangle } from 'lucide-react';
import WeatherCard from '@/components/integrations/WeatherCard';
import { useCourse } from '@/context/CourseContext';
import {
  format,
  parseISO,
  subDays,
  isWithinInterval,
  startOfWeek,
  endOfWeek,
  differenceInCalendarDays,
  startOfToday,
  addDays,
} from 'date-fns';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { saveImage } from '@/lib/music-db';
import { useStoredImage } from '@/hooks/use-stored-image';
import { sessionSeconds } from '@/lib/duration';
import { GOAL_DAY_KEYS, gradeForScore } from '@/lib/academic-metrics';
import { currentStreak } from '@/lib/streak';
import RecordingsSection from '@/components/recordings/RecordingsSection';
import InboxTasksSection from '@/components/tasks/InboxTasksSection';
import AcademicPulse from '@/components/dashboard/AcademicPulse';
import LooseNotesSection from '@/components/dashboard/LooseNotesSection';
import { DIFFICULTY_META, DifficultyBars } from '@/components/tasks/task-badges';
import { EchoHeader, EchoTileHeader } from '@/components/shared/EchoWord';
import { scheduleImageKey } from '@/lib/profile-scope';
import { dateLocale, lowerFirst, tr } from '@/lib/i18n';
import { difficultyLabel, priorityLabel } from '@/lib/enum-labels';
import { dayInitials } from '@/lib/day-names';

// El radar usa la biblioteca de gráficos (la más pesada de la app) y está al
// final de Inicio: se carga aparte para que Inicio aparezca antes.
const CompetencyMatrix = lazy(() => import('@/components/dashboard/CompetencyMatrix'));

const formatTotalTime = (totalMinutes: number) => {
  if (totalMinutes === undefined || totalMinutes === null) return { hours: 0, minutes: 0 };
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return { hours, minutes };
};

// Un solo criterio de nota en toda la app: aquí «A» empezaba en 15 y en
// Enfoque en 14, así que un 14,5 era A en una tarjeta y B en la de al lado.
const getGrade = gradeForScore;

/** Día LOCAL de un instante ISO. Cortar la cadena ('2026-09-16T01:00Z' → el 16)
 *  da el día en UTC: en Perú, lo estudiado de noche caía en el día siguiente. */
const localDayKey = (iso: string): string => {
  try {
    return format(parseISO(iso), 'yyyy-MM-dd');
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------------------
// Piezas del resumen "Rendimiento académico". Un solo molde para las cuatro
// casillas: mismo aire, mismo peso tipográfico y un tinte propio por dato.
// ---------------------------------------------------------------------------

const GRADE_TONE: Record<DailyPerformance['grade'], string> = {
  AD: 'bg-emerald-500/15 text-emerald-500',
  A: 'bg-primary/15 text-primary',
  B: 'bg-amber-500/15 text-amber-500',
  C: 'bg-red-500/15 text-red-400',
};

/** Color de la aguja del medidor, por grado. Mismo criterio que la insignia. */
const GRADE_HSL: Record<DailyPerformance['grade'], string> = {
  AD: 'hsl(160 84% 39%)',
  A: 'hsl(var(--primary))',
  B: 'hsl(38 92% 50%)',
  C: 'hsl(0 72% 60%)',
};

const GradeBadge = ({ grade }: { grade: DailyPerformance['grade'] | null }) => (
  <span
    className={cn(
      'rounded-md px-1.5 py-0.5 text-xs font-bold',
      grade ? GRADE_TONE[grade] : 'bg-secondary text-muted-foreground'
    )}
  >
    {grade ?? '—'}
  </span>
);

/**
 * Semicírculo graduado. Es la pieza que convierte "17.4" en algo que se lee de
 * un vistazo: la aguja recorre 180° y el color sigue al grado.
 */
const ArcGauge = ({
  value,
  max,
  label,
  sub,
  tone = 'hsl(var(--primary))',
}: {
  value: number;
  max: number;
  label: string;
  sub?: string;
  tone?: string;
}) => {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  // Arco de 180° con radio 34 sobre un lienzo de 80x46.
  const LENGTH = Math.PI * 34;
  return (
    <div className="relative flex flex-col items-center">
      <svg viewBox="0 0 80 46" className="h-[46px] w-20 overflow-visible">
        <path
          d="M6 40 A34 34 0 0 1 74 40"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          className="stroke-secondary"
        />
        <path
          d="M6 40 A34 34 0 0 1 74 40"
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          stroke={tone}
          strokeDasharray={LENGTH}
          strokeDashoffset={LENGTH * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1)' }}
        />
      </svg>
      <div className="-mt-4 flex flex-col items-center">
        <span className="font-headline text-2xl font-bold leading-none tabular-nums" style={{ color: tone }}>
          {label}
        </span>
        {sub && <span className="mt-0.5 text-[10px] text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
};

/**
 * Silueta de la semana: siete puntos unidos, con área rellena y el día de hoy
 * marcado. Muestra la TENDENCIA, que es lo que un promedio solo esconde.
 */
const Sparkline = ({ series, max }: { series: number[]; max: number }) => {
  const W = 100;
  const H = 30;
  const step = series.length > 1 ? W / (series.length - 1) : W;
  const y = (v: number) => H - 3 - (max > 0 ? Math.min(1, v / max) : 0) * (H - 7);
  const points = series.map((v, i) => `${i * step},${y(v)}`).join(' ');
  const hasData = series.some((v) => v > 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[30px] w-full overflow-visible" preserveAspectRatio="none">
      {hasData && (
        <>
          <polygon
            points={`0,${H} ${points} ${W},${H}`}
            fill="hsl(var(--primary))"
            fillOpacity={0.16}
          />
          <polyline
            points={points}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
      {series.map((v, i) => (
        <circle
          key={i}
          cx={i * step}
          cy={y(v)}
          r={i === series.length - 1 ? 2.4 : 1.4}
          fill={i === series.length - 1 ? 'hsl(var(--primary))' : 'hsl(var(--primary))'}
          fillOpacity={v > 0 ? 1 : 0.3}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
};

/**
 * Cuenta atrás compacta: cuanto menos queda, más lleno el anillo y más rojo.
 * Cabe en una línea de texto, así el cuerpo de «Próxima tarea» queda casi
 * entero para la tarea (antes el anillo grande se comía un tercio del ancho).
 */
const CountdownChip = ({
  days,
  label,
  urgent,
  title,
}: {
  days: number;
  label: string;
  urgent: boolean;
  title?: string;
}) => {
  const HORIZON = 7; // más de una semana ya no aprieta
  const filled = 1 - Math.min(1, Math.max(0, days) / HORIZON);
  const R = 13;
  const C = 2 * Math.PI * R;
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full pl-0.5 pr-1.5 text-[10px] font-semibold leading-4 tabular-nums',
        urgent ? 'bg-red-500/15 text-red-400' : 'bg-primary/15 text-primary'
      )}
    >
      <svg viewBox="0 0 36 36" className="h-3 w-3 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="6" className="stroke-current opacity-25" />
        <circle
          cx="18"
          cy="18"
          r={R}
          fill="none"
          strokeWidth="6"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - filled)}
          className="stroke-current transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      {label}
    </span>
  );
};

/** Importancia de la tarea con los mismos colores que su tarjeta en Tareas. */
const PRIORITY_TONE: Record<TaskPriority, { dot: string; text: string }> = {
  Baja: { dot: 'bg-emerald-400', text: 'text-emerald-500 dark:text-emerald-400' },
  Media: { dot: 'bg-amber-400', text: 'text-amber-500 dark:text-amber-400' },
  Alta: { dot: 'bg-rose-400', text: 'text-rose-500 dark:text-rose-400' },
};

/**
 * Texto que ocupa justo el alto que le sobra a la casilla: tantas líneas
 * enteras como quepan y puntos suspensivos en la última. Va en posición
 * absoluta para no empujar la casilla: su alto lo deciden las de al lado.
 */
const FitText = ({ children, className }: { children: React.ReactNode; className?: string }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(0);

  // Antes de pintar: así no asoma un renglón de más mientras se mide.
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const LINE = 16; // `leading-4`
    const measure = () => setLines(Math.floor(box.clientHeight / LINE));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative min-h-0 flex-1">
      {/* Si no cabe ni un renglón entero, mejor nada que medio. */}
      {lines > 0 && (
        <p
          className={cn('absolute inset-x-0 top-0 overflow-hidden break-words text-[11px] leading-4', className)}
          style={{ display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lines }}
        >
          {children}
        </p>
      )}
    </div>
  );
};

const StatTile = ({
  icon: Icon,
  label,
  accent,
  interactive,
  className,
  children,
}: {
  icon: React.ElementType;
  label: string;
  /** Clase `from-*` del degradado de fondo: identifica el dato de un vistazo. */
  accent: string;
  interactive?: boolean;
  className?: string;
  children: React.ReactNode;
}) => (
  <div
    className={cn(
      // Degradado vertical y suave, de abajo hacia arriba: tiñe el pie de la
      // casilla y se desvanece hacia la cabecera.
      'flex flex-1 flex-col gap-2 rounded-xl border border-border/60 bg-gradient-to-t to-transparent p-3.5 transition-all',
      accent,
      interactive && 'hover:border-primary/50 hover:shadow-[0_0_16px_hsl(var(--primary)/0.15)]',
      className
    )}
  >
    <EchoTileHeader word={label.split(/[ ,]/)[0]} pad="3.5" className="pb-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-background/60 p-1">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="truncate text-xs font-semibold text-muted-foreground">{label}</span>
      </div>
    </EchoTileHeader>
    {children}
  </div>
);


export default function HomePage() {
  const todayKey = useTodayKey();
  const { tasks, courses, userProfile, dailyPerformances, studySessions, selectionMode, streakGoal, studyGoals, advancedMode } = useCourse();
  const router = useRouter();

  const [yesterdayPerformance, setYesterdayPerformance] = useState<DailyPerformance | null>(null);
  const [yesterdayStudyTime, setYesterdayStudyTime] = useState(0);
  const [weeklyStudyTime, setWeeklyStudyTime] = useState(0);
  const [weeklyAverageScore, setWeeklyAverageScore] = useState<number | null>(null);
  // Se relee sola: también cuando el horario llega de otro dispositivo. Es del
  // perfil (1.6.7): otra cuenta de este equipo nunca ve la foto de esta.
  const scheduleKey = scheduleImageKey(userProfile?.id ?? 'sin-perfil');
  const [scheduleImage, setScheduleImage] = useStoredImage(scheduleKey);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [streak, setStreak] = useState(0);
  const [criticalTask, setCriticalTask] = useState<Task | null>(null);

  const studyHoursCardRef = useRef<HTMLDivElement>(null);
  const scheduleCardRef = useRef<HTMLDivElement>(null);
  const [scheduleHeight, setScheduleHeight] = useState<number | undefined>(undefined);
  
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayFormatted = format(yesterday, tr('d MMM'), { locale: dateLocale() });

  const { toast } = useToast();

  useEffect(() => {
    if (!userProfile) return;

    // --- Calculate and set performance data ---
    if (dailyPerformances && studySessions) {
      const now = new Date();

      // 1. Yesterday's data
      const yesterdayDate = subDays(now, 1);
      const yesterdayStr = format(yesterdayDate, 'yyyy-MM-dd');
      const yesterdayPerf = dailyPerformances.find(p => p.id === yesterdayStr) || null;
      setYesterdayPerformance(yesterdayPerf);

      const yesterdaySess = studySessions.filter(s => localDayKey(s.startTime) === yesterdayStr);
      const yesterdayTime = yesterdaySess.reduce((total, session) => total + session.duration, 0);
      setYesterdayStudyTime(yesterdayTime);

      // 2. Weekly data
      const startOfThisWeek = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      const endOfThisWeek = endOfWeek(now, { weekStartsOn: 1 });
      
      const weeklySess = studySessions.filter(s => {
          try {
              return isWithinInterval(parseISO(s.startTime), { start: startOfThisWeek, end: endOfThisWeek });
          } catch {
              return false;
          }
      });
      const weeklyTime = weeklySess.reduce((total, session) => total + session.duration, 0);
      setWeeklyStudyTime(weeklyTime);

      const weeklyPerformances = dailyPerformances.filter(p => {
        try {
          return isWithinInterval(parseISO(p.date), { start: startOfThisWeek, end: endOfThisWeek });
        } catch {
          return false;
        }
      });

      if (weeklyPerformances.length > 0) {
          const totalScore = weeklyPerformances.reduce((acc, p) => acc + p.score, 0);
          setWeeklyAverageScore(totalScore / weeklyPerformances.length);
      } else {
          setWeeklyAverageScore(null);
      }

      // 3. Streak (la misma regla que la frase de la barra superior)
      setStreak(streakGoal ? currentStreak({ now, streakGoal, studySessions, dailyPerformances, studyGoals }) : 0);
    } else {
      setYesterdayPerformance(null);
      setYesterdayStudyTime(0);
      setWeeklyStudyTime(0);
      setWeeklyAverageScore(null);
      setStreak(0);
    }

    // --- Fetch Critical Task from local data in CourseContext ---
    const findValidCriticalTask = () => {
      if (!tasks || tasks.length === 0 || !courses || courses.length === 0) {
        setCriticalTask(null);
        return;
      }

      const courseIds = new Set(courses.map(c => c.id));
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Start of today

      const upcomingTasks = tasks
        .filter(t => {
          if (!t.dueDate || !courseIds.has(t.courseId) || (t.progress ?? 0) >= 100) return false;
          try {
            const taskDate = parseISO(t.dueDate);
            return taskDate >= today;
          } catch (e) {
            return false;
          }
        })
        .map(t => ({ ...t, date: parseISO(t.dueDate!) }))
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      if (upcomingTasks.length > 0) {
        setCriticalTask(upcomingTasks[0]);
      } else {
        setCriticalTask(null);
      }
    };
    
    findValidCriticalTask();
    // `todayKey`: «ayer», la semana y la racha se recalculan al cambiar de día.
  }, [userProfile, tasks, courses, dailyPerformances, studySessions, streakGoal, studyGoals, todayKey]);

   useEffect(() => {
    const studyCard = studyHoursCardRef.current;
    if (!studyCard) return;

    const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
            setScheduleHeight(entry.contentRect.height);
        }
    });

    resizeObserver.observe(studyCard);
    
    setScheduleHeight(studyCard.offsetHeight);

    return () => resizeObserver.disconnect();
  }, []); 

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const result = reader.result as string;
        try {
          setScheduleImage(result);
          await saveImage(scheduleKey, result);
          // Enciende el vistazo del borde izquierdo: hasta ahora no había
          // ninguna imagen que enseñar y el vigilante estaba apagado.
          window.dispatchEvent(new Event('scheduleImageUpdated'));
        } catch (e: any) {
          console.error("Failed to save schedule image:", e);
          const isQuotaError = e.name === 'QuotaExceededError';
          toast({
            variant: "destructive",
            title: isQuotaError ? tr('Imagen Demasiado Grande') : tr('Error al Guardar'),
            description: isQuotaError 
              ? tr('La imagen es demasiado grande. Por favor, elige un archivo más pequeño.')
              : tr('Ocurrió un error inesperado al guardar la imagen.'),
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleCardClick = () => {
    fileInputRef.current?.click();
  };

  const weeklyScoreGrade = weeklyAverageScore ? getGrade(weeklyAverageScore) : null;
  const { hours: yesterdayHours, minutes: yesterdayMinutes } = formatTotalTime(yesterdayStudyTime);
  const { hours: weeklyHours, minutes: weeklyMinutes } = formatTotalTime(weeklyStudyTime);

  // Serie de los 7 días de la semana en curso para la silueta de tendencia:
  // nota diaria en modo rendimiento, minutos estudiados en modo tiempo.
  const weekSeries = useMemo(() => {
    const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
    const scoreByDay = new Map((dailyPerformances ?? []).map((p) => [p.date, p.score]));
    const minutesByDay = new Map<string, number>();
    (studySessions ?? []).forEach((session) => {
      const key = localDayKey(session.startTime);
      minutesByDay.set(key, (minutesByDay.get(key) ?? 0) + sessionSeconds(session) / 60);
    });

    return Array.from({ length: 7 }, (_, index) => {
      const key = format(addDays(monday, index), 'yyyy-MM-dd');
      return selectionMode === 'rendimiento'
        ? (scoreByDay.get(key) ?? 0)
        : (minutesByDay.get(key) ?? 0);
    });
  }, [dailyPerformances, studySessions, selectionMode]);

  const seriesMax = selectionMode === 'rendimiento' ? 20 : Math.max(60, ...weekSeries);

  // Meta de AYER (la casilla habla de ayer, no de hoy): referencia del medidor
  // cuando el usuario trabaja en modo "tiempo" y no hay nota que mostrar.
  const dailyGoalMinutes = studyGoals?.[GOAL_DAY_KEYS[subDays(new Date(), 1).getDay()]] ?? 0;

  // Cuenta atrás de la tarea crítica: "hoy" / "mañana" / "en N días".
  const criticalTaskCountdown = (() => {
    if (!criticalTask?.dueDate) return null;
    try {
      const days = differenceInCalendarDays(parseISO(criticalTask.dueDate), startOfToday());
      if (days < 0) return { days: 0, label: tr('vencida'), urgent: true };
      if (days === 0) return { days: 0, label: tr('vence hoy'), urgent: true };
      if (days === 1) return { days: 1, label: tr('vence mañana'), urgent: true };
      return { days, label: tr('en {days} días', { days }), urgent: days <= 3 };
    } catch {
      return null;
    }
  })();

  // Fecha de entrega exacta («vie 17 oct»): la cuenta atrás dice cuánto
  // falta; esto, qué día es. El año solo si no es el actual.
  const criticalTaskDue = (() => {
    if (!criticalTask?.dueDate) return null;
    try {
      const due = parseISO(criticalTask.dueDate);
      const sameYear = due.getFullYear() === new Date().getFullYear();
      return {
        short: format(due, sameYear ? tr('EEE d MMM') : tr('d MMM yy'), { locale: dateLocale() }),
        long: format(due, tr('EEEE d \'de\' MMMM \'de\' yyyy'), { locale: dateLocale() }),
      };
    } catch {
      return null;
    }
  })();

  // Descripción en una sola tira: los saltos de línea de la tarea no caben en
  // una casilla de cuatro renglones.
  const criticalTaskDescription = criticalTask?.description?.replace(/\s+/g, ' ').trim() ?? '';
  const criticalTaskProgress = Math.min(100, Math.max(0, Math.round(criticalTask?.progress ?? 0)));
  // Tareas antiguas sin importancia válida se leen como «Media», igual que en Tareas.
  const criticalTaskPriority: TaskPriority =
    criticalTask && PRIORITY_TONE[criticalTask.priority] ? criticalTask.priority : 'Media';


  return (
    <div className="space-y-6 p-6 md:p-8">
       <div><WeatherCard /></div>
       <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-6">
             <div 
                className="h-full flex items-center justify-center cursor-pointer transition-colors bg-transparent"
                onClick={handleCardClick}
                ref={scheduleCardRef}
              >
              <div className="p-0 pt-0 text-center w-full h-full">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageUpload}
                  className="hidden"
                  accept="image/*"
                />
                <div 
                  className="relative flex items-center justify-center w-full overflow-hidden"
                  style={{ height: scheduleHeight ? `${scheduleHeight}px` : 'auto', minHeight: '280px' }}
                >
                  {scheduleImage ? (
                      <Image src={scheduleImage} alt={tr('Horario')} layout="fill" objectFit="contain" />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-4 text-muted-foreground h-full">
                      <Upload className="h-10 w-10" />
                      <h3 className="font-semibold text-lg">{tr('Mi horario')}</h3>
                      <p className="text-xs">
                        {tr('Haz clic para subir una imagen de tu horario.')}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <div ref={studyHoursCardRef} className="lg:col-span-6">
            <Card className="h-full">
                <CardHeader className="pb-4">
                    <CardTitle className="text-lg font-headline text-center">{advancedMode ? tr('Rendimiento académico') : tr('Tu estudio')}</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-4">
                      <StatTile
                        icon={Clock}
                        label={tr('Ayer, {yesterdayFormatted}', { yesterdayFormatted })}
                        accent="from-primary/[0.06]"
                      >
                        {/* Aguja sobre 20 (o sobre la meta diaria en modo
                            tiempo): el número solo no dice si 14 es mucho. */}
                        <div className="grid flex-1 grid-cols-2 items-center gap-2">
                          <div className="flex justify-center">
                          {selectionMode === 'rendimiento' ? (
                            <ArcGauge
                              value={yesterdayPerformance?.score ?? 0}
                              max={20}
                              label={yesterdayPerformance ? yesterdayPerformance.score.toFixed(1) : '0.0'}
                              sub={tr('de 20')}
                              tone={GRADE_HSL[yesterdayPerformance?.grade ?? 'C']}
                            />
                          ) : (
                            <ArcGauge
                              value={yesterdayStudyTime}
                              max={Math.max(60, dailyGoalMinutes)}
                              label={`${yesterdayHours}h`}
                              sub={`${yesterdayMinutes}m`}
                            />
                          )}
                          </div>
                          <div className="flex flex-col items-center gap-1.5 text-center">
                            {selectionMode === 'rendimiento' && (
                              <GradeBadge grade={yesterdayPerformance?.grade ?? null} />
                            )}
                            <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                              {yesterdayHours}h {yesterdayMinutes}m
                            </span>
                            <span className="text-[10px] text-muted-foreground">{tr('estudiados')}</span>
                          </div>
                        </div>
                      </StatTile>

                      {/* Promedio semanal: del modo Avanzado (1.7.3). */}
                      {advancedMode && (
                      <StatTile
                        icon={Calendar}
                        label={tr('Promedio semanal')}
                        accent="from-chart-2/[0.09]"
                      >
                        {/* Silueta de los 7 días: la tendencia importa más que
                            el promedio, que oculta si vas subiendo o cayendo. */}
                        <div className="flex items-end justify-center gap-3">
                          <div className="flex items-baseline gap-1.5">
                            <span className="font-headline text-3xl font-bold text-primary tabular-nums">
                              {selectionMode === 'rendimiento'
                                ? (weeklyAverageScore ? weeklyAverageScore.toFixed(1) : '0.0')
                                : `${weeklyHours}h`}
                            </span>
                            {selectionMode === 'rendimiento' ? (
                              <GradeBadge grade={weeklyScoreGrade} />
                            ) : (
                              <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                                {weeklyMinutes}m
                              </span>
                            )}
                          </div>
                          <span className="pb-1 text-[10px] text-muted-foreground">
                            {selectionMode === 'rendimiento' ? tr('media · L a D') : tr('esta semana')}
                          </span>
                        </div>
                        <Sparkline series={weekSeries} max={seriesMax} />
                        <div className="flex justify-between px-0.5 text-[9px] font-semibold text-muted-foreground">
                          {dayInitials().map((day, index) => (
                            <span key={index}>{day}</span>
                          ))}
                        </div>
                      </StatTile>
                      )}
                    </div>

                    {/* Columna derecha: «Próxima tarea» arriba y «Días de racha»
                        abajo. Los dos huecos miden lo mismo (`flex-1` en ambos);
                        la tarea va arriba con el cuerpo entero para su ficha. */}
                    <div className="relative min-h-0">
                    {/* La columna no empuja la fila: toma el alto que marca la
                        izquierda y lo reparte a partes iguales. */}
                    {/* Sin modo Avanzado la izquierda solo tiene «Ayer»: aquí
                        manda la derecha y la izquierda se estira a su alto. */}
                    <div className={advancedMode ? 'absolute inset-0 flex flex-col gap-4' : 'flex h-full min-h-[17rem] flex-col gap-4'}>
                      {criticalTask ? (
                          <Dialog>
                            <DialogTrigger asChild>
                              {/* Envoltorio flexible: la casilla llena su hueco
                                  entero, igual que la de racha. */}
                              <div
                                role="button"
                                tabIndex={0}
                                aria-label={tr('Próxima tarea: {name}', { name: criticalTask.name })}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault();
                                    event.currentTarget.click();
                                  }
                                }}
                                className="flex min-h-0 flex-[3] basis-0 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <StatTile
                                  icon={AlertTriangle}
                                  label={tr('Próxima tarea')}
                                  accent="from-amber-500/[0.09]"
                                  interactive
                                  className="min-h-0 min-w-0 overflow-hidden"
                                >
                                  <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden">
                                    {/* Título de la tarea (hasta dos líneas) y,
                                        debajo, su asignatura. */}
                                    <p
                                      className="line-clamp-2 shrink-0 break-words font-headline text-sm font-bold leading-snug text-foreground"
                                      title={criticalTask.name}
                                    >
                                      {criticalTask.name}
                                    </p>
                                    <p className="shrink-0 truncate text-[11px] font-semibold text-muted-foreground">
                                      {criticalTask.courseName}
                                    </p>

                                    {/* Una línea de datos: cuánto falta, fecha,
                                        importancia y dificultad. */}
                                    <div className="mt-0.5 flex h-4 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden text-[11px] leading-4 text-muted-foreground">
                                      {criticalTaskCountdown && (
                                        <CountdownChip
                                          days={criticalTaskCountdown.days}
                                          label={criticalTaskCountdown.label}
                                          urgent={criticalTaskCountdown.urgent}
                                          title={criticalTaskDue ? tr('Fecha de entrega: {long}', { long: criticalTaskDue.long }) : undefined}
                                        />
                                      )}
                                      {criticalTaskDue && (
                                        <span
                                          className="shrink-0"
                                          title={tr('Fecha de entrega: {long}', { long: criticalTaskDue.long })}
                                        >
                                          {criticalTaskDue.short}
                                        </span>
                                      )}
                                      <span
                                        className={cn(
                                          'inline-flex shrink-0 items-center gap-1 font-medium',
                                          PRIORITY_TONE[criticalTaskPriority].text
                                        )}
                                        title={tr('Importancia {p}', { p: lowerFirst(priorityLabel(criticalTaskPriority)) })}
                                      >
                                        <span
                                          className={cn('h-1.5 w-1.5 rounded-full', PRIORITY_TONE[criticalTaskPriority].dot)}
                                        />
                                        {priorityLabel(criticalTaskPriority)}
                                      </span>
                                      {criticalTask.difficulty && DIFFICULTY_META[criticalTask.difficulty] && (
                                        <span
                                          className={cn('flex shrink-0', DIFFICULTY_META[criticalTask.difficulty].text)}
                                          title={tr('Dificultad {p}', { p: lowerFirst(difficultyLabel(criticalTask.difficulty)) })}
                                        >
                                          <DifficultyBars level={criticalTask.difficulty} />
                                        </span>
                                      )}
                                    </div>

                                    {/* Inicio de la descripción: ocupa lo que sobra
                                        de la casilla, sin estirarla. */}
                                    <FitText
                                      className={
                                        criticalTaskDescription
                                          ? 'text-muted-foreground'
                                          : 'italic text-muted-foreground/60'
                                      }
                                    >
                                      {criticalTaskDescription || tr('Sin descripción.')}
                                    </FitText>

                                    {/* El avance, abajo del todo y a lo ancho. */}
                                    <div
                                      className="flex shrink-0 items-center gap-2"
                                      title={tr('Avance: {criticalTaskProgress}%', { criticalTaskProgress })}
                                    >
                                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                                        <span
                                          className="block h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
                                          style={{ width: `${criticalTaskProgress}%` }}
                                        />
                                      </span>
                                      <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">
                                        {criticalTaskProgress}%
                                      </span>
                                    </div>
                                  </div>
                                </StatTile>
                              </div>
                            </DialogTrigger>
                            <DialogContent>
                                <EchoHeader word={tr('Interfaz')}>
                                  <DialogHeader>
                                      <DialogTitle className="text-primary text-xl font-bold text-center">{tr('Interfaz')}</DialogTitle>
                                  </DialogHeader>
                                </EchoHeader>
                                <div className="grid grid-cols-2 gap-4 pt-4">
                                    <Button
                                      variant="fantasma"
                                      onClick={() => router.push(`/tareas?highlightTaskId=${criticalTask.id}`, { scroll: false })}>
                                      {tr('Galería de tareas')}
                                    </Button>
                                    <Button
                                      variant="fantasma"
                                      onClick={() => router.push(`/cursos/?id=${criticalTask.courseId}&highlightTaskId=${criticalTask.id}`, { scroll: false })}>
                                      {tr('Ver asignatura')}
                                    </Button>
                                </div>
                            </DialogContent>
                          </Dialog>
                        ) : (
                          <div className="flex min-h-0 flex-[3] basis-0">
                            <StatTile icon={AlertTriangle} label={tr('Próxima tarea')} accent="from-amber-500/[0.09]">
                              <p className="font-headline text-lg font-bold text-foreground">{tr('Todo en orden')}</p>
                              <p className="text-xs text-muted-foreground">{tr('No tienes tareas pendientes con fecha.')}</p>
                            </StatTile>
                          </div>
                        )}

                      <StatTile icon={Flame} label={tr('Días de racha')} accent="from-orange-500/[0.09]" className="min-h-0 flex-[2] basis-0 overflow-hidden">
                        {/* La llama crece con la racha y el anillo mide cuánto
                            falta para el siguiente hito de 7 días. */}
                        <div className="flex flex-1 items-center justify-center gap-3">
                          <div className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center">
                            <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
                              <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-secondary" />
                              <circle
                                cx="18"
                                cy="18"
                                r="15.5"
                                fill="none"
                                strokeWidth="3"
                                strokeLinecap="round"
                                strokeDasharray={2 * Math.PI * 15.5}
                                strokeDashoffset={2 * Math.PI * 15.5 * (1 - (streak % 7) / 7)}
                                className="stroke-orange-400"
                                style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1)' }}
                              />
                            </svg>
                            <Flame
                              className={cn(
                                'relative text-orange-400 transition-all duration-500',
                                streak === 0 ? 'h-5 w-5 opacity-40' : streak < 7 ? 'h-6 w-6' : 'h-7 w-7 drop-shadow-[0_0_6px_rgba(251,146,60,0.6)]'
                              )}
                              fill={streak >= 7 ? 'currentColor' : 'none'}
                            />
                          </div>
                          <div className="flex min-w-0 flex-col items-center text-center">
                            <p className="font-headline text-3xl font-bold leading-none text-primary tabular-nums">
                              {streak}
                            </p>
                            <p className="mt-1 text-[11px] text-muted-foreground">
                              {streak === 0
                                ? tr('empieza hoy')
                                : streak === 1
                                  ? tr('día seguido')
                                  : tr('días seguidos')}
                            </p>
                            {streak > 0 && (
                              <p className="text-[10px] text-orange-400">
                                {7 - (streak % 7) === 7
                                  ? tr('¡semana completa!')
                                  : tr('{p} para la semana', { p: 7 - (streak % 7) })}
                              </p>
                            )}
                          </div>
                        </div>
                      </StatTile>
                    </div>
                    </div>
                  </div>
                </CardContent>
            </Card>
          </div>
       </div>

      {/* «Tu semana en datos» y la matriz de competencias: modo Avanzado (1.7.3). */}
      {advancedMode && <AcademicPulse />}

      {advancedMode && <div><Suspense fallback={null}><CompetencyMatrix /></Suspense></div>}

      {/* Tareas apuntadas sin asignatura desde el botón «+» de la barra. */}
      <InboxTasksSection />

      {/* Grabaciones de voz sin asignatura: al final de todo, con título centrado */}
      <RecordingsSection variant="home" />

      {/* Anotaciones sin asignatura, junto a las grabaciones sueltas: lo
          apuntado en caliente con el «+» que aún no tiene sitio. */}
      <LooseNotesSection />
    </div>
  );
}
