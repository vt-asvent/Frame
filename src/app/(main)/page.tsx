import { useEffect, useState } from 'react';
import { useTodayKey } from '@/hooks/use-today';
import WeatherCard from '@/components/integrations/WeatherCard';
import { useCourse } from '@/context/CourseContext';
import { currentStreak } from '@/lib/streak';
import RecordingsSection from '@/components/recordings/RecordingsSection';
import InboxTasksSection from '@/components/tasks/InboxTasksSection';
import { ConsistencyCard, TasksDoneCard, useWeekPulse, WeekRhythmCard } from '@/components/dashboard/AcademicPulse';
import { PendingTasks, QuickStudyCard, StreakCard, TopPlaylistCard } from '@/components/dashboard/HomeCards';
import LooseNotesSection from '@/components/dashboard/LooseNotesSection';
import ScheduleBoard from '@/components/schedule/ScheduleBoard';
import { tr } from '@/lib/i18n';

// ---------------------------------------------------------------------------
// Inicio (1.9.0, Diego), de arriba abajo:
//   · el horario, a todo el ancho (ScheduleBoard);
//   · el clima;
//   · «Tareas pendientes» y, a su derecha, el pomodoro (4/7 del alto, con el
//     temporizador y el cronómetro) y debajo la playlist más escuchada (3/4)
//     y la racha (1/4);
//   · en modo Avanzado, «Tu semana en datos»: el ritmo en la mitad izquierda y
//     la constancia y las tareas culminadas, un cuarto cada una (1.9.2).
// La matriz de competencias se retiró en la 1.9.0.
// ---------------------------------------------------------------------------

export default function HomePage() {
  const todayKey = useTodayKey();
  const { userProfile, dailyPerformances, studySessions, selectionMode, streakGoal, studyGoals, advancedMode } = useCourse();
  const pulse = useWeekPulse();
  const [streak, setStreak] = useState(0);

  useEffect(() => {
    if (!userProfile || !dailyPerformances || !studySessions) {
      setStreak(0);
      return;
    }
    // La misma regla que la frase de la barra superior.
    setStreak(streakGoal ? currentStreak({ now: new Date(), streakGoal, studySessions, dailyPerformances, studyGoals }) : 0);
    // `todayKey`: la racha se recalcula al cambiar de día.
  }, [userProfile, dailyPerformances, studySessions, streakGoal, studyGoals, todayKey]);

  return (
    <div className="space-y-6 p-6 md:p-8">
      {/* El horario es del perfil (1.6.7): otra cuenta de este equipo nunca ve el de esta. */}
      <ScheduleBoard uid={userProfile?.id ?? 'sin-perfil'} />

      <WeatherCard />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PendingTasks columns={1} />
        {/* El pomodoro ocupa 4/7 del alto; la playlist y la racha, el resto (1.9.2).
            La columna mide lo de antes (o lo que mida «Tareas pendientes»): al crecer
            el pomodoro, la fila de abajo se reduce. Los mínimos guardan la proporción 4:3. */}
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-rows-[minmax(0,4fr)_minmax(0,3fr)]">
          <QuickStudyCard className="min-h-[13rem] lg:min-h-[11.5rem]" />
          <div className="grid min-h-[9rem] grid-cols-4 gap-4 lg:min-h-[8.5rem]">
            <TopPlaylistCard className="col-span-3" />
            <StreakCard streak={streak} className="col-span-1" />
          </div>
        </div>
      </div>

      {advancedMode && (
        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-headline text-lg font-bold text-primary">{tr('Tu semana en datos')}</h2>
            <p className="text-xs text-muted-foreground">{pulse.rangeLabel}</p>
          </div>
          {/* El ritmo en la mitad; la constancia y las tareas culminadas, un cuarto cada una (1.9.2). */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <WeekRhythmCard pulse={pulse} showScore={selectionMode === 'rendimiento'} className="sm:col-span-2" />
            <ConsistencyCard pulse={pulse} />
            <TasksDoneCard pulse={pulse} />
          </div>
        </section>
      )}

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
