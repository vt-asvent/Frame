import { useCourse } from '@/context/CourseContext';
import { useState, useRef, useEffect, useMemo, useLayoutEffect, Fragment } from 'react';
import type { Habit, HabitPhase } from '@/types';
import { PHASE_ICON, PhaseMenu } from '@/components/habits/HabitPhases';
import ScheduleMenu from '@/components/habits/ScheduleMenu';
import NewHabitDialog, { MAX_HABITS_PER_PHASE } from '@/components/habits/NewHabitDialog';
import { isScheduled } from '@/lib/habit-schedule';
import { HABIT_PHASES, phaseLabel, phaseRank, phaseStarted, usesPhases } from '@/lib/habit-phases';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Plus, Trash2, Pencil, Archive, RefreshCcw, ArchiveRestore } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  addWeeks,
  startOfWeek,
  isAfter,
  isBefore,
  parseISO,
  startOfToday,
  addDays,
  format
} from 'date-fns';
import { useTodayKey } from '@/hooks/use-today';
import HabitsInsights from '@/components/habits/HabitsInsights';
import { tr } from '@/lib/i18n';
import { dayInitials } from '@/lib/day-names';

/** Un hábito puede llamarse con una frase entera: si no cabe, se desplaza solo. */
const HABIT_NAME_MAX = 140;


// #region Helper Components
// ======================================================================================

// This component renders the CELLS for a single habit row
function HabitRowCells({ habit, isEditing, index, weekDates, weekOffset, isStreakView, isArchiveMode, showArchived }: { 
    habit: Habit; 
    isEditing: boolean; 
    index: number; 
    weekDates: Date[]; 
    weekOffset: number; 
    isStreakView: boolean;
    isArchiveMode: boolean;
    showArchived: boolean;
}) {
  const { habits, updateHabit, deleteHabit } = useCourse();
  const [name, setName] = useState(habit.name);
  // Los anillos admiten cinco hábitos por fase: una fase llena no acepta más.
  const fullPhases = useMemo(
    () =>
      HABIT_PHASES.map((p) => p.id).filter(
        (id) => habits.filter((h) => !h.isArchived && h.phase === id).length >= MAX_HABITS_PER_PHASE
      ),
    [habits]
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // Marquee logic
  const nameContainerRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const today = startOfToday();

  // Effect to check for text overflow
  useLayoutEffect(() => {
    const container = nameContainerRef.current;
    if (isEditing || !container) {
      setIsOverflowing(false);
      return;
    }
    const checkOverflow = () => {
      const hasOverflow = container.scrollWidth > container.clientWidth;
      if (hasOverflow !== isOverflowing) {
        setIsOverflowing(hasOverflow);
      }
    };
    const resizeObserver = new ResizeObserver(checkOverflow);
    if(container) {
      resizeObserver.observe(container);
    }
    checkOverflow();
    return () => resizeObserver.disconnect();
  }, [habit.name, isEditing, isOverflowing]);


  useEffect(() => {
    if (!isEditing) {
      setName(habit.name);
    }
  }, [isEditing, habit.name]);

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setName(e.target.value);
  };

  const handleNameBlur = () => {
    if (name.trim() === '') {
      setName(habit.name);
    } else if (name.trim() !== habit.name) {
      updateHabit(habit.id, { name: name.trim() });
    }
  };

  const handleCheckboxChange = (dayIndex: number) => {
    const dateToToggle = weekDates[dayIndex];
    const dateString = format(dateToToggle, 'yyyy-MM-dd');

    const newCompletedOn = habit.completedOn.includes(dateString)
      ? habit.completedOn.filter(d => d !== dateString)
      : [...habit.completedOn, dateString];
      
    updateHabit(habit.id, { completedOn: newCompletedOn });
  };
  
  const handleArchive = () => {
    updateHabit(habit.id, { isArchived: true });
  }

  const handleUnarchive = () => {
    updateHabit(habit.id, { isArchived: false, order: Date.now() });
  }
  
  const successRate = useMemo(() => {
      // Solo cuentan los días ya vividos y posteriores al alta del hábito: dividir
      // siempre entre 7 daba «14 %» el lunes con todo cumplido, y un hábito creado
      // el jueves no podía pasar del 57 %.
      const todayKey = format(new Date(), 'yyyy-MM-dd');
      let sinceKey = '';
      try {
        sinceKey = habit.createdAt ? format(parseISO(habit.createdAt), 'yyyy-MM-dd') : '';
      } catch {
        sinceKey = '';
      }
      const done = new Set(habit.completedOn);
      let possible = 0;
      let hit = 0;
      for (const date of weekDates) {
        const key = format(date, 'yyyy-MM-dd');
        if (key > todayKey) continue;
        // Los días que no le tocan no cuentan: ni suman ni restan.
        if (!isScheduled(habit, date) && !done.has(key)) continue;
        if (done.has(key)) {
          possible += 1;
          hit += 1;
        } else if (key === todayKey && !phaseStarted(habit.phase)) {
          // Hoy todavía no le toca (su fase del día no ha empezado): no es un fallo.
          continue;
        } else if (!sinceKey || key >= sinceKey) {
          possible += 1;
        }
      }
      return possible > 0 ? Math.round((hit / possible) * 100) : 0;
  }, [habit, weekDates]);

  const streak = useMemo(() => {
    if (!isStreakView || habit.completedOn.length === 0) return 0;

    const completedOnSet = new Set(habit.completedOn);
    let longestStreak = 0;
    let currentStreak = 0;

    for (const date of weekDates) {
      const key = format(date, 'yyyy-MM-dd');
      if (completedOnSet.has(key)) {
        currentStreak++;
      } else if (!isScheduled(habit, date)) {
        // Un día que no le toca no corta la racha.
        continue;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 0;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak); // Check streak at the end of the week

    return longestStreak;
  }, [habit, isStreakView, weekDates]);


  return (
    <Fragment>
      {/* Index Cell */}
      <div className="h-[52px] border-r border-b flex items-center justify-center text-sm text-muted-foreground">
        {showArchived ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={handleUnarchive}>
            <ArchiveRestore className="h-4 w-4" />
          </Button>
        ) : isArchiveMode ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={handleArchive}>
            <Archive className="h-4 w-4" />
          </Button>
        ) : isEditing ? (
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => deleteHabit(habit.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : (
          index + 1
        )}
      </div>

      {/* Name Cell */}
      <div className="h-[52px] border-r border-b flex items-center min-w-0 px-4">
        {isEditing && !showArchived ? (
          <div className="flex items-center gap-2 w-full">
            <Input
              ref={inputRef}
              value={name}
              onChange={handleNameChange}
              onBlur={handleNameBlur}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              className="bg-transparent border-none focus-visible:ring-1 focus-visible:ring-primary h-8 flex-grow text-sm p-1"
              placeholder={tr('Nombre del hábito')}
              maxLength={HABIT_NAME_MAX}
            />
            <PhaseMenu value={habit.phase} fullPhases={fullPhases} onChange={(phase) => updateHabit(habit.id, { phase })} />
            <ScheduleMenu value={habit.days} onChange={(days) => updateHabit(habit.id, { days })} />
          </div>
        ) : (
          <TooltipProvider delayDuration={300}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div ref={nameContainerRef} className={cn("w-full overflow-hidden whitespace-nowrap cursor-default py-1", showArchived && "opacity-50")}>
                  <p className={cn("text-sm", isOverflowing && "inline-block animate-marquee")}>
                    {habit.name}
                    {isOverflowing && <span className="inline-block w-8" />}
                    {isOverflowing && habit.name}
                  </p>
                </div>
              </TooltipTrigger>
              <TooltipContent>
                <p>{habit.name}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Checkbox Cells */}
      {weekDates.map((date, dayIndex) => {
        const dateString = format(date, 'yyyy-MM-dd');
        const isChecked = habit.completedOn.includes(dateString);
        
        const isPastDayOfCurrentWeek = weekOffset === 0 && isBefore(date, today);
        const isPastWeek = weekOffset < 0;
        
        let isDisabled = false;
        if (showArchived || isAfter(date, today)) { // archivados y días futuros: un hábito no se cumple por adelantado
            isDisabled = true;
        } else if (isPastWeek) {
          isDisabled = true;
        } else if (isPastDayOfCurrentWeek) {
          isDisabled = !isEditing;
        }

        // «Cada cierto tiempo»: los días que no le tocan no tienen casilla.
        // (Si ya hay una marca ese día —de antes de cambiar la frecuencia—,
        // se conserva visible para poder quitarla.)
        if (!isScheduled(habit, date) && !isChecked) {
          return (
            <div
              key={dayIndex}
              className="flex h-[52px] items-center justify-center border-b"
              title={tr('Este día no le toca')}
            >
              <span className="h-1 w-1 rounded-full bg-muted-foreground/25" />
            </div>
          );
        }

        return (
            <div key={dayIndex} className="h-[52px] border-b flex items-center justify-center">
                <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => handleCheckboxChange(dayIndex)}
                    disabled={isDisabled}
                />
            </div>
        );
      })}
      
      {/* Streak / Success Rate Cell */}
      <div className={cn("h-[52px] border-l border-b flex items-center justify-center text-sm font-semibold", showArchived && "opacity-50")}>
        {isStreakView ? (
          <span className="text-primary">{streak}</span>
        ) : (
          <span className="text-muted-foreground">{`${successRate}%`}</span>
        )}
      </div>
    </Fragment>
  );
}

// #endregion

export default function HabitsView({ weekOffset }: { weekOffset: number }) {
  const { habits, addHabit } = useCourse();
  const [isEditing, setIsEditing] = useState(false);
  const [isStreakView, setIsStreakView] = useState(false);
  const [isArchiveMode, setIsArchiveMode] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  
  /** El recuadro de alta: nombre, momento del día y frecuencia. */
  const [isAdding, setIsAdding] = useState(false);

  // Repinta al cambiar de fecha: con la app abierta toda la noche, las marcas
  // del lunes se guardaban en el lunes de la semana anterior.
  useTodayKey();
  const today = startOfToday();
  const weekStart = startOfWeek(addWeeks(today, weekOffset), { weekStartsOn: 1 });
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  // Agrupados por fase del día (mañana, tarde, noche, todo el día) y, dentro de
  // cada una, en el orden propio del usuario.
  const byPhaseThenOrder = (a: Habit, b: Habit) =>
    phaseRank(a.phase) - phaseRank(b.phase) || (a.order || 0) - (b.order || 0);
  const activeHabits = useMemo(() => habits.filter(h => !h.isArchived).sort(byPhaseThenOrder), [habits]);
  const archivedHabits = useMemo(() => habits.filter(h => h.isArchived).sort(byPhaseThenOrder), [habits]);
  const groupedByPhase = usesPhases(activeHabits);
  const habitsToDisplay = showArchived ? archivedHabits : activeHabits;
  const isLimitReached = activeHabits.length >= 99;

  useEffect(() => {
    if (showArchived) {
        setIsEditing(false);
        setIsArchiveMode(false);
    }
    if (isArchiveMode && !showArchived) {
        setShowArchived(false);
    }
  }, [showArchived, isArchiveMode]);

  useEffect(() => {
    if (isEditing) setIsAdding(false);
  }, [isEditing]);

  const handleCreate = (name: string, phase: HabitPhase, days: number[] | undefined) => {
    if (!isLimitReached) addHabit(name, phase, days);
  };

  const weeklyDailySuccessRates = useMemo(() => {
    if (activeHabits.length === 0) {
      return Array(7).fill(0);
    }
    const todayString = format(new Date(), 'yyyy-MM-dd');
    return weekDates.map((date) => {
      const dateString = format(date, 'yyyy-MM-dd');
      // Solo los hábitos que tocan ese día (más los que se hicieron igual).
      const due = activeHabits.filter(
        habit => isScheduled(habit, date) || habit.completedOn.includes(dateString)
      );
      const done = due.filter(habit => habit.completedOn.includes(dateString)).length;
      // HOY se mide contra lo que ya tocaba (fases empezadas) más lo ya hecho:
      // a las nueve de la mañana, los hábitos de la noche no son un fallo.
      const expected = dateString === todayString
        ? due.filter(habit => phaseStarted(habit.phase) || habit.completedOn.includes(dateString)).length
        : due.length;
      return expected > 0 ? Math.round((done / expected) * 100) : 0;
    });
  }, [activeHabits, weekDates]);
  

  const finalAverageSuccessRate = useMemo(() => {
    if (activeHabits.length === 0) {
      return 0;
    }
    // Solo los días ya vividos de la semana: los futuros no son fallos.
    const todayKeyLocal = format(new Date(), 'yyyy-MM-dd');
    const livedDates = weekDates.filter(d => format(d, 'yyyy-MM-dd') <= todayKeyLocal);
    const livedCount = Math.max(1, livedDates.length);
    const avgDailyRate = weeklyDailySuccessRates.slice(0, livedDates.length).reduce((sum, rate) => sum + rate, 0) / livedCount;

    const weekDateStrings = new Set(livedDates.map(d => format(d, 'yyyy-MM-dd')));
    const habitSuccessRates = activeHabits.map(habit => {
        const completedThisPeriod = habit.completedOn.filter(d => weekDateStrings.has(d));
        // Cada hábito se mide contra SUS días: el de «solo sábados» tiene uno.
        const dueDays = Math.max(1, livedDates.filter(d => isScheduled(habit, d)).length);
        return Math.min(100, (completedThisPeriod.length / dueDays) * 100);
    });
    const avgHabitRate = habitSuccessRates.reduce((sum, rate) => sum + rate, 0) / activeHabits.length;

    const finalAvg = (avgDailyRate * 0.75) + (avgHabitRate * 0.25);
    return Math.round(finalAvg);
  }, [activeHabits, weeklyDailySuccessRates, weekDates]);

  return (
    <div className="px-6 pb-8 md:px-8 space-y-16">
        <div 
          className="grid border"
          style={{ gridTemplateColumns: '42px minmax(0, 1fr) repeat(7, 68px) 70px' }}
        >
            {/* Header Row */}
            <div className="group col-span-2 border-r border-b bg-card/50 flex items-center justify-center p-2 relative min-h-[48px]">
              <div className="absolute left-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <TooltipProvider><Tooltip><TooltipTrigger asChild>
                    <Button variant={showArchived ? "secondary" : "ghost"} size="icon" className="text-muted-foreground h-7 w-7" onClick={() => setShowArchived(prev => !prev)}>
                      <RefreshCcw className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger><TooltipContent><p>{tr('Ver archivados')}</p></TooltipContent></Tooltip></TooltipProvider>
                  <TooltipProvider><Tooltip><TooltipTrigger asChild>
                    <Button variant={isArchiveMode ? "secondary" : "ghost"} size="icon" className="text-muted-foreground h-7 w-7" onClick={() => setIsArchiveMode(prev => !prev)} disabled={showArchived}>
                      <Archive className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger><TooltipContent><p>{tr('Archivar hábitos')}</p></TooltipContent></Tooltip></TooltipProvider>
              </div>
              <div className="flex-1">
                  <h3 className="text-base font-semibold text-foreground text-center">
                    {showArchived ? tr('Hábitos Archivados') : tr('Hábitos')}
                  </h3>
              </div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <TooltipProvider><Tooltip><TooltipTrigger asChild>
                     <Button 
                        variant="ghost" 
                        size="icon" 
                        onClick={() => setIsEditing(!isEditing)}
                        className={cn(
                            'h-7 w-7', 
                            isEditing ? 'bg-accent text-primary' : 'text-muted-foreground',
                            (showArchived || isArchiveMode) && "hidden"
                        )}
                        disabled={showArchived || isArchiveMode}
                     >
                         <Pencil className="h-4 w-4"/>
                     </Button>
                  </TooltipTrigger><TooltipContent><p>{tr('Editar nombres')}</p></TooltipContent></Tooltip></TooltipProvider>
              </div>
            </div>
            {dayInitials().map((day, index) => (
                <div key={index} className={cn(
                  "border-b border-r bg-card/50 flex items-center justify-center text-xs font-bold text-muted-foreground p-2 min-h-[48px]",
                )}>
                  {day}
                </div>
            ))}
            <button 
              onClick={() => setIsStreakView(prev => !prev)}
              className="border-l border-b bg-card/50 flex items-center justify-center text-xs font-bold text-muted-foreground p-2 min-h-[48px] text-center hover:bg-accent transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {isStreakView ? tr('Racha') : tr('% Éxito')}
            </button>
            
            {/* Habit Rows (con una franja por fase del día, si se usan fases) */}
            {habitsToDisplay.map((habit, index) => {
              const startsGroup =
                groupedByPhase && !showArchived && (index === 0 || habitsToDisplay[index - 1].phase !== habit.phase);
              const PhaseIcon = PHASE_ICON[habit.phase ?? 'all'];
              return (
                <Fragment key={habit.id}>
                  {startsGroup && (
                    <div className="col-span-full flex items-center gap-2 border-b bg-primary/5 px-4 py-1.5 text-[10px] font-bold text-primary">
                      <PhaseIcon className="h-3.5 w-3.5" />
                      {phaseLabel(habit.phase)}
                    </div>
                  )}
                  <HabitRowCells
                    habit={habit}
                    isEditing={isEditing}
                    index={index}
                    weekDates={weekDates}
                    weekOffset={weekOffset}
                    isStreakView={isStreakView}
                    isArchiveMode={isArchiveMode}
                    showArchived={showArchived}
                  />
                </Fragment>
              );
            })}



            {/* Footer Row */}
            <div className="col-span-2 border-r border-b flex items-center justify-center min-w-0 min-h-[48px]">
                {!isEditing && !showArchived && !isArchiveMode && (
                     <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="w-full h-full">
                                    <Button
                                        variant="ghost"
                                        onClick={() => { if (!isLimitReached) setIsAdding(true); }}
                                        className="w-full h-full justify-center whitespace-normal leading-tight text-muted-foreground hover:text-foreground px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                        disabled={isLimitReached}
                                    >
                                        <Plus className="mr-2 h-4 w-4 text-primary" />
                                        {tr('Añadir un hábito')}
                                    </Button>
                                </div>
                            </TooltipTrigger>
                            {isLimitReached && (
                                <TooltipContent>
                                    <p>{tr('Límite de 99 hábitos alcanzado.')}</p>
                                </TooltipContent>
                            )}
                        </Tooltip>
                    </TooltipProvider>
                )}
                 {(isEditing || showArchived || isArchiveMode) && <div className="h-full p-2">&nbsp;</div>}
            </div>
            {weeklyDailySuccessRates.map((rate, index) => (
                <div key={index} className={cn(
                  "border-b border-r flex items-center justify-center text-sm font-semibold text-muted-foreground min-h-[48px]",
                  )}>
                    {`${rate}%`}
                </div>
            ))}
            <div className="border-l border-b flex items-center justify-center min-h-[48px] text-sm font-semibold">
              {isStreakView ? (
                  <span className="text-muted-foreground">-</span>
              ) : (
                  <span className="text-primary font-semibold">{`${finalAverageSuccessRate}%`}</span>
              )}
            </div>
        </div>


        {/* Lectura seria del tracker: cumplimiento, rachas, perfil semanal y
            qué hábito se está apagando. Autónoma (tiene su propio periodo). */}
        {!showArchived && <div className="mt-16"><HabitsInsights weekOffset={weekOffset} /></div>}

        <NewHabitDialog
          open={isAdding}
          onOpenChange={setIsAdding}
          habits={activeHabits}
          onCreate={handleCreate}
        />
    </div>
  );
}
