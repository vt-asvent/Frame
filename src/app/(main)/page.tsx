import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useTodayKey } from '@/hooks/use-today';
import { Upload } from 'lucide-react';
import WeatherCard from '@/components/integrations/WeatherCard';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import { saveImage } from '@/lib/music-db';
import { useStoredImage } from '@/hooks/use-stored-image';
import { currentStreak } from '@/lib/streak';
import RecordingsSection from '@/components/recordings/RecordingsSection';
import InboxTasksSection from '@/components/tasks/InboxTasksSection';
import { ConsistencyCard, TasksDoneCard, useWeekPulse, WeekRhythmCard } from '@/components/dashboard/AcademicPulse';
import { PendingTasks, QuickStudyCard, StreakCard, TopPlaylistCard } from '@/components/dashboard/HomeCards';
import LooseNotesSection from '@/components/dashboard/LooseNotesSection';
import { scheduleImageKey } from '@/lib/profile-scope';
import { tr } from '@/lib/i18n';

// El radar usa la biblioteca de gráficos (la más pesada de la app) y está al
// final de Inicio: se carga aparte para que Inicio aparezca antes.
const CompetencyMatrix = lazy(() => import('@/components/dashboard/CompetencyMatrix'));

/**
 * Alto de la primera fila: el del horario a todo el ancho de su columna,
 * entre estos límites (un horario muy alargado no estira la fila entera ni
 * uno muy apaisado deja sin sitio a las tarjetas de al lado).
 */
const ROW_MIN = 320;
const ROW_MAX = 440;
const ROW_DEFAULT = 340;

// ---------------------------------------------------------------------------
// Inicio (1.8.0, Diego):
//   · fila 1: el horario y, a su derecha, el pomodoro (media altura) y, debajo,
//     la playlist más escuchada (3/4) y la racha (1/4);
//   · fila 2: «Tareas pendientes» (las dos que vencen antes) y, en modo
//     Avanzado, «Tu semana en datos»: ritmo y promedio semanal en una tarjeta,
//     y debajo constancia y tareas culminadas.
// El antiguo recuadro «Rendimiento académico» se repartió así: el promedio
// semanal va con el ritmo, la racha a su tarjeta, la próxima tarea a
// «Tareas pendientes» y lo estudiado ayer al pomodoro.
// ---------------------------------------------------------------------------

export default function HomePage() {
  const todayKey = useTodayKey();
  const { userProfile, dailyPerformances, studySessions, selectionMode, streakGoal, studyGoals, advancedMode } = useCourse();
  const pulse = useWeekPulse();

  // Se relee sola: también cuando el horario llega de otro dispositivo. Es del
  // perfil (1.6.7): otra cuenta de este equipo nunca ve la foto de esta.
  const scheduleKey = scheduleImageKey(userProfile?.id ?? 'sin-perfil');
  const [scheduleImage, setScheduleImage] = useStoredImage(scheduleKey);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scheduleBoxRef = useRef<HTMLDivElement>(null);
  const [scheduleWidth, setScheduleWidth] = useState(0);
  const [imageAspect, setImageAspect] = useState<number | null>(null);

  const [streak, setStreak] = useState(0);

  const { toast } = useToast();

  useEffect(() => {
    if (!userProfile || !dailyPerformances || !studySessions) {
      setStreak(0);
      return;
    }
    // La misma regla que la frase de la barra superior.
    setStreak(streakGoal ? currentStreak({ now: new Date(), streakGoal, studySessions, dailyPerformances, studyGoals }) : 0);
    // `todayKey`: la racha se recalcula al cambiar de día.
  }, [userProfile, dailyPerformances, studySessions, streakGoal, studyGoals, todayKey]);

  // El ancho de la columna del horario decide el alto de la fila.
  useEffect(() => {
    const box = scheduleBoxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setScheduleWidth(entry.contentRect.width));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!scheduleImage) setImageAspect(null);
  }, [scheduleImage]);

  const rowHeight = Math.round(
    Math.min(ROW_MAX, Math.max(ROW_MIN, imageAspect && scheduleWidth ? scheduleWidth / imageAspect : ROW_DEFAULT))
  );

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

  return (
    <div className="space-y-6 p-6 md:p-8">
      <div><WeatherCard /></div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12" style={{ '--home-row': `${rowHeight}px` } as React.CSSProperties}>
        {/* El horario: clic para subir o cambiar la imagen. */}
        <div ref={scheduleBoxRef} className="lg:col-span-6">
          <div
            role="button"
            tabIndex={0}
            aria-label={scheduleImage ? tr('Cambiar la imagen del horario') : tr('Subir una imagen del horario')}
            className="relative flex h-[var(--home-row)] w-full cursor-pointer items-center justify-center overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            <input type="file" ref={fileInputRef} onChange={handleImageUpload} className="hidden" accept="image/*" />
            {scheduleImage ? (
              <img
                src={scheduleImage}
                alt={tr('Horario')}
                className="absolute inset-0 h-full w-full object-contain"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) setImageAspect(naturalWidth / naturalHeight);
                }}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
                <Upload className="h-10 w-10" />
                <h3 className="text-lg font-semibold">{tr('Mi horario')}</h3>
                <p className="text-xs">{tr('Haz clic para subir una imagen de tu horario.')}</p>
              </div>
            )}
          </div>
        </div>

        {/* A la derecha: el pomodoro arriba (media altura) y, abajo, la
            playlist (3/4) y la racha (1/4), de la misma altura. */}
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:col-span-6 lg:h-[var(--home-row)] lg:grid-rows-2">
          <QuickStudyCard className="min-h-[10rem] lg:min-h-0" />
          <div className="grid min-h-[10rem] grid-cols-4 gap-4 lg:min-h-0">
            <TopPlaylistCard className="col-span-3" />
            <StreakCard streak={streak} className="col-span-1" />
          </div>
        </div>
      </div>

      {/* Tareas pendientes y, en modo Avanzado, la semana en datos. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <PendingTasks className={advancedMode ? 'lg:col-span-6' : 'lg:col-span-12'} columns={advancedMode ? 1 : 2} />
        {advancedMode && (
          <section className="min-w-0 space-y-3 lg:col-span-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-headline text-lg font-bold text-primary">{tr('Tu semana en datos')}</h2>
              <p className="text-xs text-muted-foreground">{pulse.rangeLabel}</p>
            </div>
            <WeekRhythmCard pulse={pulse} showScore={selectionMode === 'rendimiento'} />
            <div className="grid grid-cols-2 gap-4">
              <ConsistencyCard pulse={pulse} />
              <TasksDoneCard pulse={pulse} />
            </div>
          </section>
        )}
      </div>

      {/* La matriz de competencias: modo Avanzado (1.7.3). */}
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
