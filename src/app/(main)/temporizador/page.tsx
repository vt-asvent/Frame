import TimerDisplay from '@/components/temporizador/timer-display';
import { useTodayKey } from '@/hooks/use-today';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { getStudyVideoPlayer } from '@/lib/study-video-player';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StudySession, DailyPerformance, StudyGoals } from '@/types';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import GradesCalendar from '@/components/temporizador/GradesCalendar';
import StudyVideosPanel from '@/components/temporizador/StudyVideosPanel';
import EditSessionDialog from '@/components/temporizador/EditSessionDialog';
import SessionCard from '@/components/temporizador/SessionCard';
import SessionDetailDialog from '@/components/temporizador/SessionDetailDialog';
import SessionNotesList, { SessionNotesHeading } from '@/components/temporizador/SessionNotesList';
import AcademicAnalytics from '@/components/habits/AcademicAnalytics';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useCourse } from '@/context/CourseContext';
import { sessionSeconds, formatHMS } from '@/lib/duration';
import { addDays, isBefore, parseISO, startOfToday, format, isSameDay, isToday } from 'date-fns';


import { tr } from '@/lib/i18n';

const getGradeForScore = (score: number): DailyPerformance['grade'] => {
    if (score >= 18) return 'AD';
    if (score >= 14) return 'A';
    if (score >= 11) return 'B';
    return 'C';
}

const dayKeys: (keyof StudyGoals)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Última altura medida de la pila de la derecha: si se vuelve a Enfoque con un
 *  vídeo puesto, el recuadro de vídeos nace ya con la medida correcta. */
let lastStackHeight: number | null = null;


export default function TimerPage() {
  const {
    userProfile,
    studySessions,
    addStudySession,
    deleteStudySession,
    applySessionProgressToTasks,
    dailyPerformances,
    updateDailyPerformance,
    studyGoals,
    selectionMode,
    advancedMode,
    sessionNotes,
    deleteSessionNote,
  } = useCourse();

  const [dailyStudySeconds, setDailyStudySeconds] = useState(0);
  /** Alto de una tarjeta de «Métricas de hoy» (su imagen guarda la proporción
   *  elegida en Asignaturas): el recuadro se ajusta para que una fila quepa
   *  entera. */
  const metricsGridRef = useRef<HTMLDivElement>(null);
  const [metricsRowHeight, setMetricsRowHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const grid = metricsGridRef.current;
    const first = grid?.firstElementChild as HTMLElement | null;
    if (!first || typeof ResizeObserver === 'undefined') {
      setMetricsRowHeight(null);
      return;
    }
    const observer = new ResizeObserver(() => setMetricsRowHeight(Math.round(first.getBoundingClientRect().height)));
    observer.observe(first);
    return () => observer.disconnect();
  });
  const [recentSessions, setRecentSessions] = useState<StudySession[]>([]);
  const [todayPerformance, setTodayPerformance] = useState<DailyPerformance | null>(null);
  /** Cara visible de la tarjeta: las métricas del día o los vídeos de estudio.
   *  Son dos, así que ambas flechas alternan. */
  // Si al volver a Enfoque hay un vídeo puesto, se entra directamente a él.
  const [cardFace, setCardFace] = useState<'metricas' | 'videos'>(() =>
    getStudyVideoPlayer().video ? 'videos' : 'metricas'
  );
  /** Alto de la pila «Tiempo de estudio» + «Métricas de hoy»: el recuadro de
   *  vídeos lo hereda al píxel. Se mide mientras la pila está a la vista. */
  const stackRef = useRef<HTMLDivElement>(null);
  const [stackHeight, setStackHeight] = useState<number | null>(lastStackHeight);
  useLayoutEffect(() => {
    const stack = stackRef.current;
    if (!stack) return;
    const measure = () => {
      lastStackHeight = Math.round(stack.getBoundingClientRect().height);
      setStackHeight(lastStackHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stack);
    return () => observer.disconnect();
  }, [cardFace]);
  const toggleFace = () => setCardFace((face) => (face === 'metricas' ? 'videos' : 'metricas'));
  const faceArrows = (
    <div className="flex shrink-0 items-center">
      {[ChevronLeft, ChevronRight].map((Icon, index) => (
        <Button
          key={index}
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-primary"
          onClick={toggleFace}
          title={cardFace === 'metricas' ? tr('Vídeos de estudio') : tr('Tiempo de estudio y métricas de hoy')}
          aria-label={cardFace === 'metricas' ? tr('Ver los vídeos de estudio') : tr('Volver a las métricas de hoy')}
        >
          <Icon className="h-4 w-4" />
        </Button>
      ))}
    </div>
  );
  /** Ventana de búsqueda de YouTube, abierta desde la cabecera. */
  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  /** Sesión que se está corrigiendo. Solo puede ser una de HOY: esta lista
   *  no muestra ninguna otra. */
  const [editingSession, setEditingSession] = useState<StudySession | null>(null);
  /** Sesión cuyo detalle está abierto. Se guarda el id y se busca en vivo:
   *  tras corregirla, el detalle enseña ya lo corregido. */
  const [openSessionId, setOpenSessionId] = useState<string | null>(null);
  const openSession = useMemo(
    () => (openSessionId ? (studySessions ?? []).find((s) => s.id === openSessionId) ?? null : null),
    [openSessionId, studySessions]
  );

  // Día vivo: con la app abierta de noche, la barra seguía sumando a la meta de
  // ayer y la nota en vivo se publicaba con la fecha anterior.
  const today = useTodayKey();
  const dayOfWeek = new Date().getDay(); // 0:Sun, 1:Mon, ..., 6:Sat

  const totalGoalMinutes = useMemo(() => {
    const todayKey = dayKeys[dayOfWeek];
    return studyGoals[todayKey] || 0;
  }, [dayOfWeek, studyGoals]);


  const calculateAndSaveDailyPerformance = useCallback(async () => {
    if (selectionMode !== 'rendimiento' || !userProfile || !studySessions || studySessions.length === 0 || !dailyPerformances) return;

    // Find the earliest date a study session was recorded to set a sensible floor.
    const sortedSessions = [...studySessions].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    // Se recorre desde la PRIMERA sesión (no desde el último registro) para
    // rellenar también los huecos: al eliminar una sesión se invalida la
    // calificación de ese día y hay que recalcularla aunque sea antigua.
    // Los días que ya tienen registro se saltan, así que es idempotente.
    let dayToCalculate = parseISO(sortedSessions[0].startTime);

    // Loop through each day from the start date up to yesterday.
    while (isBefore(dayToCalculate, startOfToday())) {
      const dateStr = format(dayToCalculate, 'yyyy-MM-dd');

      // Check if performance for this day is already calculated (safety check)
      const perfExists = dailyPerformances.find(p => p.id === dateStr);
      if (perfExists) {
        dayToCalculate = addDays(dayToCalculate, 1);
        continue;
      }

      // Filter sessions for the current day in the loop
      const sessionsForDay = studySessions.filter(s => {
        // Solo las sesiones con enfoque puntúan, igual que en el cálculo de hoy:
        // las del modo «tiempo» guardan enfoque 0 y hundían la nota del día.
        if (s.mode === 'tiempo' || !(s.perception > 0)) return false;
        try {
            return isSameDay(parseISO(s.startTime), dayToCalculate);
        } catch {
            return false;
        }
      });

      if (sessionsForDay.length > 0) {
        let totalMinutes = 0;
        let totalPerception = 0;
        const uniqueSubjects = new Set<string>();

        sessionsForDay.forEach(session => {
           totalMinutes += sessionSeconds(session) / 60;
           totalPerception += session.perception;
           session.subjects?.forEach(sub => uniqueSubjects.add(sub));
        });

        const pAvg = totalPerception / sessionsForDay.length;

        const dayOfWeek = dayToCalculate.getDay();
        const dayKey = dayKeys[dayOfWeek];
        const tObj = studyGoals[dayKey] || 0;

        if (tObj > 0) { // Only calculate if a goal was set for that day
            const rDiarioRaw = pAvg * (totalMinutes / tObj);
            const rDiario = Math.min(20, rDiarioRaw);
            const grade = getGradeForScore(rDiario);

            const performanceData: DailyPerformance = {
              id: dateStr,
              date: dateStr,
              score: rDiario,
              grade,
              subjects: Array.from(uniqueSubjects),
            };

            updateDailyPerformance(performanceData);
        }
      }
      dayToCalculate = addDays(dayToCalculate, 1);
    }
  }, [userProfile, studySessions, dailyPerformances, updateDailyPerformance, studyGoals, selectionMode]);

  useEffect(() => {
    // Run once on mount to check if past performance needs calculation
    calculateAndSaveDailyPerformance();
  }, [calculateAndSaveDailyPerformance]);


  useEffect(() => {
    if (!userProfile || !studySessions) return;

    const todaysSessionsAll = studySessions
      .filter(s => {
          try {
              return isToday(parseISO(s.startTime));
          } catch {
              return false;
          }
      })
      .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());

    // If in 'rendimiento' mode, only show sessions created in that mode.
    const sessionsForDisplay = selectionMode === 'rendimiento'
        ? todaysSessionsAll.filter(s => s.mode === 'rendimiento')
        : todaysSessionsAll;

    setRecentSessions(sessionsForDisplay);
    setDailyStudySeconds(sessionsForDisplay.reduce((acc, session) => acc + sessionSeconds(session), 0));

  }, [userProfile, studySessions, today, selectionMode]);

  // La calificación de HOY se calcula en vivo: el registro persistido solo
  // cubre días ya cerrados (updateDailyPerformance ignora el día en curso).
  useEffect(() => {
    if (selectionMode !== 'rendimiento' || recentSessions.length === 0 || totalGoalMinutes === 0) {
      setTodayPerformance(null);
      return;
    }
    const totalMinutes = recentSessions.reduce((acc, s) => acc + sessionSeconds(s) / 60, 0);
    const pAvg = recentSessions.reduce((acc, s) => acc + s.perception, 0) / recentSessions.length;
    const score = Math.min(20, pAvg * (totalMinutes / totalGoalMinutes));
    setTodayPerformance({
      id: today,
      date: today,
      score,
      grade: getGradeForScore(score),
      subjects: [...new Set(recentSessions.flatMap(s => s.subjects ?? []))],
    });
  }, [recentSessions, totalGoalMinutes, today, selectionMode]);

  const allPerformances = useMemo(() => {
    const map = new Map<string, DailyPerformance>();
    (dailyPerformances ?? []).forEach(p => map.set(p.id, p));
    if (todayPerformance) map.set(todayPerformance.id, todayPerformance);
    return Array.from(map.values());
  }, [dailyPerformances, todayPerformance]);


  const handleSessionComplete = async (
    sessionData: Omit<StudySession, 'id' | 'startTime' | 'endTime' | 'duration' | 'durationSec'> & { durationSec: number }
  ) => {
    if (!userProfile || sessionData.durationSec <= 0) return;
    addStudySession(sessionData);
    // El avance de las tareas seleccionadas sube en proporción directa
    // duración de la sesión / tiempo estimado de cada tarea.
    applySessionProgressToTasks(sessionData.taskIds ?? [], sessionData.durationSec / 60);
  };

  const totalGoalSeconds = totalGoalMinutes * 60;
  const minutesProgress = totalGoalSeconds > 0 ? Math.min(100, (dailyStudySeconds / totalGoalSeconds) * 100) : 0;


  return (
    <div className="flex flex-col gap-8 p-6 md:p-8">
      <div className="grid grid-cols-1 lg:grid-cols-5 lg:items-stretch gap-8">
        {/* Centrado en vertical sobre la altura de la columna derecha (de la
            cabecera de «Tiempo de estudio» al pie de «Métricas de hoy»). */}
        <div className="lg:col-span-2 flex flex-col items-center lg:justify-center">
          <TimerDisplay onSessionComplete={handleSessionComplete} disabled={!userProfile} />
        </div>
        {cardFace === 'videos' ? (
        <div className="lg:col-span-3">
          {/* Un único recuadro, EXACTAMENTE tan alto como la pila que sustituye
              (de la cabecera de «Tiempo de estudio» al pie de «Métricas de hoy»). */}
          <Card className="flex w-full flex-col" style={{ height: stackHeight ?? 440 }}>
            <CardHeader className="pb-3 pt-4" echo={tr('Vídeos')}>
              <div className="flex items-center justify-between gap-2">
                <Button
                  size="sm"
                  variant="fantasma"
                  className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px]"
                  onClick={() => setVideoPickerOpen(true)}
                  title={tr('Buscar en YouTube sin salir de Estudio')}
                >
                  <Plus className="h-3.5 w-3.5" />
                  {tr('Añadir')}
                </Button>
                <CardTitle className="text-center font-headline text-sm tracking-wider text-muted-foreground">
                  {tr('Vídeos de estudio')}
                </CardTitle>
                {faceArrows}
              </div>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col pt-3">
              <StudyVideosPanel pickerOpen={videoPickerOpen} onPickerOpenChange={setVideoPickerOpen} />
            </CardContent>
          </Card>
        </div>
        ) : (
        <div ref={stackRef} className="lg:col-span-3 flex flex-col gap-6 self-start">
          <Card className="w-full">
            <CardHeader className="relative pt-4 pb-3">
              <CardTitle className="text-center font-headline tracking-wider text-muted-foreground text-sm">
                {tr('Tiempo de estudio')}
              </CardTitle>
              <div className="absolute right-3 top-2.5">{faceArrows}</div>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="p-4 rounded-lg border-2 border-primary/50 bg-primary/10">
                <div className="space-y-2">
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-lg font-bold font-headline text-primary">{formatHMS(dailyStudySeconds)} / {formatHMS(totalGoalSeconds)}</span>
                      <span className="text-xs text-primary">{tr('Tiempo')}</span>
                    </div>
                    <Progress value={minutesProgress} className="h-2" indicatorClassName="bg-primary" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Avances anotados mientras la sesión corre. Aparece solo cuando
              hay alguno: en una sesión sin anotar no ocupa sitio. */}
          {sessionNotes.length > 0 && (
            <Card className="w-full">
              <CardContent className="space-y-2 p-4">
                <SessionNotesHeading count={sessionNotes.length} />
                <SessionNotesList notes={sessionNotes} onDelete={deleteSessionNote} />
              </CardContent>
            </Card>
          )}

          {/* Cada sesión de hoy, como tarjeta: la de su asignatura arriba y lo
              que dejó (tiempo y rendimiento) debajo. Dos por fila, cada una la
              mitad del recuadro; si no caben, el recuadro desplaza. Su alto
              es el de una fila de tarjetas (más cabecera y márgenes): sigue al
              tamaño de imagen que elija el usuario (1.6.6). */}
          <Card
            className="w-full flex flex-col"
            style={{ height: metricsRowHeight ? metricsRowHeight + 104 : 292 }}
          >
            <CardHeader className="pb-3 pt-4">
              <CardTitle className="text-center text-sm font-headline text-muted-foreground">
                {tr('Métricas de hoy')}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 pb-4 pt-3">
              {recentSessions.length > 0 ? (
                <ScrollArea className="-mr-3 flex-1 pr-3">
                  {/* p-px: el realce de la tarjeta al pasar el ratón no se recorta. */}
                  <div ref={metricsGridRef} className="grid grid-cols-2 gap-3 p-px pb-1">
                    {recentSessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        onOpen={() => setOpenSessionId(session.id)}
                        // Solo hay lápiz aquí porque esta lista es la de HOY:
                        // pasada la medianoche el registro queda cerrado.
                        onEdit={() => setEditingSession(session)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-xs text-muted-foreground text-center pt-2">{tr('Hoy todavía no registras sesiones.')}</p>
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </div>

      {/* Calendario de calificaciones y progreso académico: modo Avanzado
          (1.7.3). Las notas y sesiones siguen guardándose igual. */}
      {advancedMode && (<>
      <Separator className="my-4" />

      {/* Calificación diaria: este calendario es exclusivo de Enfoque
          (el de la interfaz Calendario muestra tareas y eventos).
          Cada casilla abre las sesiones de estudio de ese día. */}
      <GradesCalendar
        performances={allPerformances}
        studySessions={studySessions}
        selectionMode={selectionMode}
        onDeleteSession={deleteStudySession}
        onEditSession={setEditingSession}
      />

      {/* Analítica académica: vive aquí, bajo el calendario, porque habla de
          estudio y no de hábitos. Es autónoma (tiene su propio periodo). */}
      <AcademicAnalytics />
      </>)}

      {/* Detalle de una sesión de hoy. Corregir abre su diálogo encima y,
          al guardar, el detalle ya enseña lo corregido. */}
      <SessionDetailDialog
        session={openSession}
        onClose={() => setOpenSessionId(null)}
        dayPerformance={todayPerformance}
        onEdit={setEditingSession}
        onDelete={(id) => {
          setOpenSessionId(null);
          deleteStudySession(id);
        }}
      />

      <EditSessionDialog session={editingSession} onClose={() => setEditingSession(null)} />
    </div>
  );
}
