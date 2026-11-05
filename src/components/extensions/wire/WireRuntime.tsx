import { useEffect, useRef } from 'react';
import { useCourse } from '@/context/CourseContext';
import { useExtensionOn } from '@/lib/extensions/store';
import { requestWireCycle, runWireCycle, WIRE, type WireContext } from '@/lib/extensions/wire/relay';

// ============================================================
// El relevo de Wire en segundo plano (montado en el diseño principal).
// Da una vuelta al arrancar, cada minuto y medio (cada 20 s mientras la
// vista en vivo de Ajustes está a la vista), al volver a la ventana y poco
// después de que cambie la biblioteca o los adjuntos.
// ============================================================

const SLOW_MS = 90_000;
const LIVE_MS = 20_000;

/** La vista en vivo pide más ritmo mientras se ve. */
export const wireLive = { visible: false };

export default function WireRuntime() {
  const on = useExtensionOn(WIRE);
  const { userProfile, songs, addSongs, tasks, archivedTasks, incompleteTasks, notes, archivedNotes } = useCourse();
  const ctxRef = useRef<WireContext | null>(null);

  ctxRef.current = userProfile
    ? { uid: userProfile.id, songs, addSongs, tasks, archivedTasks, incompleteTasks, notes, archivedNotes }
    : null;

  // Vuelta periódica.
  useEffect(() => {
    if (!on || !userProfile) return;
    let stop = false;
    let timer: number | undefined;
    const loop = async () => {
      if (stop) return;
      if (ctxRef.current && document.visibilityState === 'visible') await runWireCycle(ctxRef.current);
      if (!stop) timer = window.setTimeout(() => void loop(), wireLive.visible ? LIVE_MS : SLOW_MS);
    };
    timer = window.setTimeout(() => void loop(), 4000);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && ctxRef.current) requestWireCycle(1500);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [on, userProfile?.id]);

  // Cambió la biblioteca o los adjuntos: vuelta pronto (con el contexto nuevo).
  const fingerprint = `${songs.length}:${songs.filter((s) => s.isFavorite).length}:${tasks.length}:${notes.length}`;
  useEffect(() => {
    if (!on || !ctxRef.current) return;
    const timer = window.setTimeout(() => ctxRef.current && void runWireCycle(ctxRef.current), 5000);
    return () => window.clearTimeout(timer);
  }, [on, fingerprint]);

  return null;
}
