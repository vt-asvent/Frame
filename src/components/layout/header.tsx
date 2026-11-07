import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Mic } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import NotificationCenter from '@/components/layout/NotificationCenter';
import RecordingDialog from '@/components/recordings/RecordingDialog';
import QuickCreateButton from '@/components/layout/QuickCreateButton';
import { useCourse } from '@/context/CourseContext';
import { useTodayKey } from '@/hooks/use-today';
import { greetingPhrase, buildHeaderPhrases, type HeaderPhrase } from '@/lib/header-phrases';
import { startQuickRecording } from '@/lib/quick-recording';
import type { RecorderState } from '@/components/recordings/RecordingDialog';
import type { UserProfile } from '@/types';
import { tr, useLang } from '@/lib/i18n';
import { ChromePattern, useChromePattern } from '@/components/extensions/animaciones/Mosaic';

// La frase propia (clave `headerQuote`) se retiró en la 1.6.2: la barra ya no
// muestra un texto escrito a mano sino frases con los datos del usuario. Se
// borra lo que quedara guardado para no arrastrarlo en los respaldos.
try {
  if (typeof window !== 'undefined' && window.localStorage.getItem('headerQuote') !== null) {
    window.localStorage.removeItem('headerQuote');
  }
} catch {
  /* almacenamiento vetado: no hay nada que limpiar */
}

/** Cada cuánto cambia la frase: lo bastante para leerla y olvidarse de ella. */
const ROTATE_MS = 90_000;
/** Al retirar el ratón, nunca cambia antes de esto: se acaba de leer. */
const AFTER_HOVER_MS = 5_000;

/** Botones de la barra: fantasma en reposo, sólido con su recuadro abierto. */
const barButton = 'h-9 w-9 rounded-md border border-primary';

function usePrefersReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

// ============================================================
// La frase del centro de la barra.
//
// Altura fija y centrada, para que nada salte al cambiar. El relevo (1.6.6,
// Diego: «únicamente hacerse más pequeño y crecer, nada más»): la saliente se
// encoge hasta desaparecer y la entrante crece desde nada hasta su tamaño.
// Con «reducir movimiento», cambia sin animación.
// ============================================================

/** Lo que tarda cada mitad del relevo. */
const SHRINK_MS = 260;
const GROW_MS = 320;

function PhraseStage({ text }: { text: string }) {
  const reduced = usePrefersReducedMotion();
  const [shown, setShown] = useState(text);
  const [leaving, setLeaving] = useState<{ text: string; key: number } | null>(null);
  const turn = useRef(0);
  const inRef = useRef<HTMLHeadingElement>(null);
  const outRef = useRef<HTMLParagraphElement>(null);

  // Llega otra frase: la que estaba pasa a la capa de salida. En layout
  // effect para que no se pinte ni un fotograma con las dos iguales.
  useLayoutEffect(() => {
    if (text === shown) return;
    turn.current += 1;
    setLeaving(reduced ? null : { text: shown, key: turn.current });
    setShown(text);
  }, [text, shown, reduced]);

  useLayoutEffect(() => {
    if (!leaving) return;
    const out = outRef.current;
    const incoming = inRef.current;
    if (!out || typeof out.animate !== 'function') {
      setLeaving(null);
      return;
    }
    const animations: Animation[] = [
      out.animate([{ transform: 'scale(1)' }, { transform: 'scale(0)' }], {
        duration: SHRINK_MS,
        easing: 'ease-in',
        fill: 'forwards',
      }),
    ];
    if (incoming) {
      animations.push(
        incoming.animate([{ transform: 'scale(0)' }, { transform: 'scale(1)' }], {
          duration: GROW_MS,
          delay: SHRINK_MS,
          easing: 'ease-out',
          fill: 'backwards',
        })
      );
    }
    const key = leaving.key;
    Promise.all(animations.map((animation) => animation.finished))
      .then(() => setLeaving((current) => (current?.key === key ? null : current)))
      .catch(() => {
        /* cancelada: llegó otra frase a mitad del relevo */
      });
    return () => animations.forEach((animation) => animation.cancel());
    // Solo al empezar cada relevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving?.key]);

  const type = 'text-sm font-semibold tracking-wide text-primary';

  return (
    <>
      <h1 ref={inRef} className={cn('truncate px-2 text-center', type)}>
        {shown}
      </h1>
      {leaving && (
        <div aria-hidden className="pointer-events-none absolute inset-0 flex flex-col justify-center">
          <p key={leaving.key} ref={outRef} className={cn('truncate px-2 text-center', type)}>
            {leaving.text}
          </p>
        </div>
      )}
    </>
  );
}

/**
 * Rota entre las frases con datos (src/lib/header-phrases.ts) cada
 * `ROTATE_MS`, y se detiene mientras el ratón está encima para poder leerla.
 * Las frases se recalculan cuando cambian los datos, al cambiar de día y en
 * cada vuelta (así «buenos días» no sigue en pie por la tarde).
 */
function HeaderPhrases({ name }: { name?: string }) {
  const { tasks, archivedTasks, courses, studySessions, habits, studyGoals, dailyPerformances, streakGoal, advancedMode } = useCourse();
  const todayKey = useTodayKey();
  const lang = useLang();
  const [tick, setTick] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);

  // Sin modo Avanzado (1.7.3), solo el saludo, sin rotar: la frase con datos
  // que cambia cada 90 s es del modo Avanzado.
  const phrases = useMemo<HeaderPhrase[]>(
    () => {
      const all = buildHeaderPhrases({
        now: new Date(),
        name,
        tasks: tasks ?? [],
        archivedTasks: archivedTasks ?? [],
        courses: courses ?? [],
        studySessions: studySessions ?? [],
        habits: habits ?? [],
        studyGoals,
        dailyPerformances: dailyPerformances ?? [],
        streakGoal,
      });
      return advancedMode ? all : [greetingPhrase(new Date(), name)];
    },
    // `tick`, `todayKey` y `lang` no se leen dentro: renuevan el «ahora» y el idioma.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, todayKey, lang, name, tasks, archivedTasks, courses, studySessions, habits, studyGoals, dailyPerformances, streakGoal, advancedMode]
  );
  const phrasesRef = useRef(phrases);
  phrasesRef.current = phrases;

  // Si la plantilla que se mostraba deja de tener algo que decir, manda la primera.
  const current = phrases.find((phrase) => phrase.id === currentId) ?? phrases[0];

  // Reloj de la rotación: un único temporizador hasta el próximo cambio. Al
  // pasar el ratón se guarda lo que faltaba y se reanuda al retirarlo.
  const deadline = useRef(Date.now() + ROTATE_MS);
  const remaining = useRef(ROTATE_MS);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      deadline.current = Date.now() + ROTATE_MS;
      setCurrentId((previous) => {
        const list = phrasesRef.current;
        const index = Math.max(0, list.findIndex((phrase) => phrase.id === previous));
        return list[(index + 1) % list.length]?.id ?? null;
      });
      setTick((value) => value + 1);
    }, Math.max(0, deadline.current - Date.now()));
    return () => window.clearTimeout(timer);
  }, [paused, tick]);

  return (
    <div
      title={current?.text}
      className="relative flex h-7 min-w-0 flex-1 flex-col justify-center"
      onMouseEnter={() => {
        remaining.current = Math.max(0, deadline.current - Date.now());
        setPaused(true);
      }}
      onMouseLeave={() => {
        deadline.current = Date.now() + Math.max(remaining.current, AFTER_HOVER_MS);
        setPaused(false);
      }}
    >
      <PhraseStage text={current?.text ?? ''} />
    </div>
  );
}

interface HeaderProps {
  /** Lo inyecta el layout: nombre del saludo y dueño de los informes. */
  userProfile: UserProfile | null;
}

export default function Header({ userProfile }: HeaderProps) {
  const [isRecordingOpen, setRecordingOpen] = useState(false);
  /** Lo que hace la grabadora aunque su recuadro esté cerrado. */
  const [recorderState, setRecorderState] = useState<RecorderState>('idle');

  // Atajo global de grabación: Ctrl+Shift+F abre la grabadora Y empieza a
  // grabar en el acto, sin pasos intermedios.
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setRecordingOpen(true);
        startQuickRecording();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const chromePattern = useChromePattern('cabecera');

  // Para el saludo: el nombre de pila si lo hay; el invitado, sin nombre.
  const greetName = userProfile && !userProfile.isGuest
    ? userProfile.firstNames?.trim() || userProfile.username
    : undefined;

  return (
    <header className={cn('flex h-[60px] flex-shrink-0 items-center justify-between gap-3 border-b bg-background px-4', chromePattern && 'relative isolate')}>
      {/* Figuras de Animaciones detrás de la cabecera (1.8.0), si el usuario las puso aquí. */}
      {chromePattern && <ChromePattern chrome={chromePattern} size={180} />}
      {/* Los dos extremos miden lo mismo: así la frase queda centrada de verdad. */}
      <div className="flex w-36 shrink-0 items-center justify-start gap-2">
        {/* Crear una tarea o una anotación sin salir de donde estés. */}
        <QuickCreateButton />
      </div>

      <HeaderPhrases name={greetName} />

      <div className="flex w-36 shrink-0 items-center justify-end gap-2">
        {/* Grabación de voz (también con Ctrl+Shift+F). Sólida mientras su
            recuadro está abierto y también mientras graba con el recuadro
            cerrado: entonces además respira con el mismo brillo del dial de
            Enfoque durante una sesión, así nunca se olvida que el micrófono
            sigue abierto. En pausa, sólida sin brillo. */}
        <Button
          size="icon"
          variant={isRecordingOpen || recorderState !== 'idle' ? 'default' : 'fantasma'}
          title={
            recorderState === 'recording'
              ? tr('Grabando… (pulsa para ver la grabación)')
              : recorderState === 'paused'
                ? tr('Grabación en pausa (pulsa para verla)')
                : tr('Grabación (Ctrl+Shift+F)')
          }
          className={cn(barButton, 'transition-colors', recorderState === 'recording' && 'animate-session-glow')}
          onClick={() => setRecordingOpen(true)}
        >
          <Mic className="h-5 w-5" />
        </Button>

        <NotificationCenter />
      </div>

      {/* Grabadora global: montada siempre para no perder audio al cerrar */}
      <RecordingDialog
        open={isRecordingOpen}
        onOpenChange={setRecordingOpen}
        onStateChange={setRecorderState}
      />

    </header>
  );
}
