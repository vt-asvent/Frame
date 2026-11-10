import { useMemo } from 'react';
import { parseISO, startOfToday, subDays } from 'date-fns';
import { ArrowUpRight, CheckCircle2, Flame, Hourglass, ListMusic, Pause, Play, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EchoTileHeader } from '@/components/shared/EchoWord';
import MarqueeText from '@/components/ui/marquee-text';
import { TaskCard } from '@/components/tasks/TaskCard';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import { useCourse } from '@/context/CourseContext';
import { useRouter } from '@/lib/navigation';
import { useStoredImage } from '@/hooks/use-stored-image';
import { useTodayKey } from '@/hooks/use-today';
import { useTimerTime } from '@/lib/timer-clock';
import { formatHMS, formatMinutes, sessionSeconds } from '@/lib/duration';
import { localDayKey } from '@/lib/dates';
import { easedMask } from '@/lib/eased-fade';
import { formatListened, topPlaylist, useListening } from '@/lib/listening';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Song, Task } from '@/types';

// ============================================================
// Inicio (1.8.0): las piezas que van junto al horario y debajo de él.
// ============================================================

// ------------------------------------------------------------
// Pomodoro: la invitación a empezar. Usa el temporizador de Estudio (el
// mismo motor global), así que la sesión sigue al navegar y, al terminar,
// se registra en Estudio como cualquier otra «Sesión de estudio».
// ------------------------------------------------------------

const POMODORO_MINUTES = 25;

export function QuickStudyCard({ className }: { className?: string }) {
  const {
    timerMode,
    setTimerMode,
    setTimerTime,
    isTimerActive,
    setIsTimerActive,
    sessionStartTime,
    setSessionStartTime,
    autoFinishPending,
    requestFinish,
    userProfile,
    studySessions,
  } = useCourse();
  const time = useTimerTime();
  const router = useRouter();
  const todayKey = useTodayKey();

  const inProgress = sessionStartTime > 0;
  const focus = timerMode === 'focus';

  // Lo estudiado hoy y ayer.
  const studied = useMemo(() => {
    const yesterdayKey = localDayKey(subDays(new Date(), 1));
    let today = 0;
    let yesterday = 0;
    for (const session of studySessions ?? []) {
      const key = localDayKey(session.startTime);
      if (key === todayKey) today += sessionSeconds(session) / 60;
      else if (key === yesterdayKey) yesterday += sessionSeconds(session) / 60;
    }
    return { today, yesterday };
  }, [studySessions, todayKey]);

  /** El temporizador de 25 minutos o el cronómetro, con el mismo motor de Estudio. */
  const start = (mode: 'focus' | 'stopwatch') => {
    if (!userProfile || inProgress) return;
    const seconds = mode === 'focus' ? POMODORO_MINUTES * 60 : 0;
    setTimerMode(mode);
    setTimerTime(seconds);
    // El cronómetro marca su comienzo con 1 (como en Estudio).
    setSessionStartTime(mode === 'focus' ? seconds : 1);
    setIsTimerActive(true);
  };

  /** Terminar: Estudio abre el registro de la sesión (como su botón «Finalizar»). */
  const finish = () => {
    requestFinish();
    router.push('/temporizador');
  };

  const openStudy = () => router.push('/temporizador');

  const focusRunning = (inProgress && focus) || autoFinishPending;
  const watchRunning = inProgress && !focus;
  const focusClock = autoFinishPending ? formatHMS(0) : focusRunning ? formatHMS(time) : formatHMS(POMODORO_MINUTES * 60);
  const watchClock = watchRunning ? formatHMS(time) : formatHMS(0);
  // Lo que falta del pomodoro; el cronómetro da una vuelta por minuto.
  const focusRing = focusRunning && !autoFinishPending && sessionStartTime > 0 ? Math.min(1, Math.max(0, time / sessionStartTime)) : 0;
  const watchRing = watchRunning ? (time % 60) / 60 : 0;

  const controls = (mode: 'focus' | 'stopwatch') => {
    const running = mode === 'focus' ? focusRunning : watchRunning;
    // Los botones no pasan de su mitad: el texto se recorta antes de pisar la línea o la otra mitad.
    if (mode === 'focus' && autoFinishPending) {
      return (
        <Button size="sm" onClick={openStudy} className="h-8 max-w-full shrink-0 rounded-full px-3" title={tr('Registrar la sesión')}>
          <CheckCircle2 className="mr-1.5 h-4 w-4 shrink-0" />
          <span className="truncate">{tr('Registrar la sesión')}</span>
        </Button>
      );
    }
    if (running) {
      // Un pomodoro que ya llegó a 00:00 (su registro se dejó para luego): reanudarlo lo daría por terminado otra vez.
      const spent = mode === 'focus' && time === 0;
      return (
        <div className="flex max-w-full shrink-0 items-center gap-2">
          <Button
            variant="fantasma"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={() => setIsTimerActive(!isTimerActive)}
            disabled={spent}
            aria-label={isTimerActive ? tr('Pausar') : tr('Reanudar')}
            title={isTimerActive ? tr('Pausar') : tr('Reanudar')}
          >
            {isTimerActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" className="h-8 min-w-0 rounded-full px-3" onClick={finish} title={tr('Terminar y registrar la sesión en Estudio')}>
            <Square className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{tr('Terminar')}</span>
          </Button>
        </div>
      );
    }
    return (
      <Button size="sm" onClick={() => start(mode)} disabled={!userProfile || inProgress || autoFinishPending} className="h-8 max-w-full shrink-0 rounded-full px-4">
        <Play className="mr-1.5 h-4 w-4 shrink-0" />
        <span className="truncate">{tr('Empezar')}</span>
      </Button>
    );
  };

  return (
    <Card className={cn('relative flex min-h-0 flex-col overflow-hidden p-4', className)}>
      <EchoTileHeader word={tr('Pomodoro')}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Timer className="h-4 w-4 shrink-0 text-primary" />
            <span className="shrink-0">{tr('Pomodoro')}</span>
            {/* Lo estudiado hoy y ayer, en la cabecera: abajo le quitaba alto a las circunferencias. */}
            <span className="truncate text-[11px] font-normal tabular-nums">
              {tr('Hoy {today} · ayer {yesterday}', { today: formatMinutes(studied.today), yesterday: formatMinutes(studied.yesterday) })}
            </span>
          </div>
          <button
            type="button"
            onClick={openStudy}
            className="inline-flex shrink-0 items-center gap-0.5 rounded text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tr('Abrir Estudio')}
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </EchoTileHeader>

      {/* Dos mitades con una línea fina entre ellas: el temporizador y el cronómetro,
          cada uno con su circunferencia (del alto que quede) y, debajo, su botón. */}
      <div className="grid min-h-0 flex-1 grid-cols-2 pt-2">
        <div className="flex min-h-0 min-w-0 flex-col items-center gap-2 pr-3">
          <ClockRing value={focusRing} clock={focusClock} label={tr('Temporizador')} icon={Hourglass} active={focusRunning} />
          {controls('focus')}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col items-center gap-2 border-l border-muted-foreground/20 pl-3">
          <ClockRing value={watchRing} clock={watchClock} label={tr('Cronómetro')} icon={Timer} active={watchRunning} />
          {controls('stopwatch')}
        </div>
      </div>
    </Card>
  );
}

/**
 * Una circunferencia con la hora dentro; `value` (0–1) es el arco lleno. Ocupa
 * el alto que le deja la tarjeta y el círculo es lo que quepa (el SVG se
 * ajusta solo); el reloj se escala con él, y con horas («01:00:00») va más
 * pequeño para no tocar el trazo. Qué es cada una lo dice su icono: el nombre
 * escrito no cabía dentro en todos los idiomas.
 */
function ClockRing({ value, clock, label, icon: Icon, active }: { value: number; clock: string; label: string; icon: typeof Timer; active: boolean }) {
  const R = 46;
  const length = 2 * Math.PI * R;
  const share = clock.length > 5 ? 15 : 22;
  return (
    <div className="relative min-h-[4.25rem] w-full flex-1" style={{ containerType: 'size' }} role="img" aria-label={`${label}: ${clock}`} title={label}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={R} fill="none" strokeWidth="3" className="stroke-muted-foreground/25" />
        {active && value > 0 && (
          <circle
            cx="50"
            cy="50"
            r={R}
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
            strokeDasharray={length}
            strokeDashoffset={length * (1 - value)}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-[3cqmin]" aria-hidden>
        <Icon className="text-muted-foreground" style={{ width: 'max(11px, 11cqmin)', height: 'max(11px, 11cqmin)' }} />
        <span className={cn('font-headline text-xl font-bold leading-none tabular-nums', active ? 'text-primary' : 'text-foreground')} style={{ fontSize: `${share}cqmin` }}>
          {clock}
        </span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// La playlist más escuchada de los últimos 7 días (sin escucha aún: la
// primera playlist con canciones en este equipo).
// ------------------------------------------------------------

const PLAYLIST_IMAGE_MASK = easedMask('to right');

export function TopPlaylistCard({ className }: { className?: string }) {
  const { userProfile, playlists, songs, playSong, isPlaying, togglePlay, playingContextHref } = useCourse();
  const router = useRouter();
  const top = useListening(userProfile?.id, (owner) => topPlaylist(owner, 7), []);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);

  const resolved = useMemo(() => {
    const sorted = [...playlists].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const listened = top ? playlists.find((p) => p.id === top.id) : undefined;
    const playlist = listened ?? sorted.find((p) => p.songIds.some((id) => songById.has(id))) ?? sorted[0];
    return playlist ? { playlist, listened: listened ? top : null } : null;
  }, [playlists, top, songById]);

  const playlist = resolved?.playlist ?? null;
  const queue = useMemo(
    () => (playlist ? playlist.songIds.map((id) => songById.get(id)).filter((song): song is Song => !!song) : []),
    [playlist, songById]
  );
  const [customImage] = useStoredImage(playlist ? `playlistImage_${playlist.id}` : null);
  const image = customImage ?? queue.find((song) => song.picture)?.picture ?? null;
  const href = playlist ? `/playlists?id=${encodeURIComponent(playlist.id)}` : '/music';
  const playingHere = !!playlist && playingContextHref === href;

  const play = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!playlist || queue.length === 0) return;
    if (playingHere) {
      togglePlay();
      return;
    }
    const song = queue[Math.floor(Math.random() * queue.length)];
    playSong(song, { context: playlist.name, queue, href });
  };

  if (!playlist) {
    return (
      <Card className={cn('flex min-h-0 flex-col items-start justify-center gap-2 border-dashed p-4', className)}>
        <ListMusic className="h-5 w-5 text-primary" />
        <p className="text-sm font-semibold">{tr('Aún no tienes playlists')}</p>
        <Button variant="fantasma" size="sm" onClick={() => router.push('/music')}>
          {tr('Ir a Música')}
        </Button>
      </Card>
    );
  }

  const subtitle = resolved?.listened
    ? tr('{time} en los últimos 7 días', { time: formatListened(resolved.listened.seconds) })
    : queue.length === 1
      ? tr('1 canción')
      : tr('{n} canciones', { n: queue.length });

  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={() => router.push(href)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') router.push(href);
      }}
      className={cn(
        'group relative flex min-h-0 cursor-pointer items-center overflow-hidden transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        className
      )}
      aria-label={tr('Abrir la playlist {name}', { name: playlist.name })}
    >
      {/* La imagen, a lo alto, se funde hacia la izquierda con el color de la tarjeta. */}
      <div className="absolute inset-y-0 right-0 w-[72%]" style={{ WebkitMaskImage: PLAYLIST_IMAGE_MASK, maskImage: PLAYLIST_IMAGE_MASK }} aria-hidden>
        {image ? (
          <img src={image} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
        ) : (
          <WaveBackdrop />
        )}
      </div>

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col gap-1 p-4 pr-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {resolved?.listened ? tr('Tu playlist más escuchada') : tr('Tu playlist')}
        </p>
        <MarqueeText text={playlist.name} align="left" className="max-w-[min(100%,22rem)] font-headline text-xl font-bold text-primary" />
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <Button
        size="icon"
        onClick={play}
        disabled={queue.length === 0}
        className="relative z-[1] mr-4 h-11 w-11 shrink-0 rounded-full shadow-lg transition-transform hover:scale-105"
        title={queue.length === 0 ? tr('Sin canciones en este equipo') : playingHere && isPlaying ? tr('Pausar') : tr('Reproducir una canción al azar')}
        aria-label={playingHere && isPlaying ? tr('Pausar') : tr('Reproducir una canción al azar')}
      >
        {playingHere && isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
      </Button>
    </Card>
  );
}

// ------------------------------------------------------------
// Racha de estudio (la misma regla que la frase de la barra superior).
// ------------------------------------------------------------

export function StreakCard({ streak, className }: { streak: number; className?: string }) {
  const left = 7 - (streak % 7);
  const ring = 2 * Math.PI * 15.5;
  const label = streak === 0 ? tr('empieza hoy') : streak === 1 ? tr('día seguido') : tr('días seguidos');
  const hint = streak > 0 ? (left === 7 ? tr('¡semana completa!') : tr('{p} para la semana', { p: left })) : undefined;
  return (
    <Card className={cn('flex min-h-0 flex-col items-center justify-center gap-1 overflow-hidden bg-gradient-to-t from-orange-500/[0.09] to-card p-3 text-center [background-color:hsl(var(--card))]', className)} title={hint}>
      <div className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden>
          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-secondary" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={ring}
            strokeDashoffset={ring * (1 - (streak % 7) / 7)}
            className="stroke-orange-400"
            style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.22,1,0.36,1)' }}
          />
        </svg>
        <Flame
          className={cn(
            'relative text-orange-400 transition-all duration-500',
            streak === 0 ? 'h-5 w-5 opacity-40' : streak < 7 ? 'h-6 w-6' : 'h-6 w-6 drop-shadow-[0_0_6px_rgba(251,146,60,0.6)]'
          )}
          fill={streak >= 7 ? 'currentColor' : 'none'}
        />
      </div>
      <p className="font-headline text-3xl font-bold leading-none text-primary tabular-nums">{streak}</p>
      <p className="line-clamp-2 text-[11px] leading-tight text-muted-foreground">{label}</p>
      {hint && <p className="hidden text-[10px] leading-tight text-orange-400 xl:block">{hint}</p>}
    </Card>
  );
}

// ------------------------------------------------------------
// Tareas pendientes: las dos que vencen antes, con su tarjeta de siempre.
// ------------------------------------------------------------

export function PendingTasks({ className, columns }: { className?: string; columns: 1 | 2 }) {
  const { tasks, courses } = useCourse();
  const router = useRouter();
  const todayKey = useTodayKey();

  const { next, total } = useMemo(() => {
    const courseIds = new Set(courses.map((c) => c.id));
    const today = startOfToday();
    const pending = tasks.filter((t) => courseIds.has(t.courseId) && (t.progress ?? 0) < 100);
    const dated: { task: Task; at: number }[] = [];
    for (const task of pending) {
      if (!task.dueDate) continue;
      try {
        const at = parseISO(task.dueDate).getTime();
        if (Number.isFinite(at) && at >= today.getTime()) dated.push({ task, at });
      } catch {
        // fecha ilegible: no entra
      }
    }
    dated.sort((a, b) => a.at - b.at);
    return { next: dated.slice(0, 2).map((d) => d.task), total: pending.length };
    // `todayKey`: lo que vence «desde hoy» cambia al cambiar de día.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, courses, todayKey]);

  return (
    <section className={cn('min-w-0 space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-headline text-lg font-bold text-primary">{tr('Tareas pendientes')}</h2>
        <button
          type="button"
          onClick={() => router.push('/tareas')}
          className="inline-flex items-center gap-0.5 rounded text-xs text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {total === 1 ? tr('Ver la pendiente') : tr('Ver las {n} pendientes', { n: total })}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
      {next.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-1 border-dashed p-8 text-center">
          <p className="font-headline text-lg font-bold text-foreground">{tr('Todo en orden')}</p>
          <p className="text-xs text-muted-foreground">{tr('No tienes tareas pendientes con fecha.')}</p>
        </Card>
      ) : (
        <div className={cn('grid grid-cols-1 gap-4', columns === 2 && 'lg:grid-cols-2')}>
          {next.map((task) => (
            <TaskCard key={task.id} task={task} showCourseName isDragDisabled />
          ))}
        </div>
      )}
    </section>
  );
}
