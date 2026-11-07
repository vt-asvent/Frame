import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, WifiOff } from 'lucide-react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { activeProfileId } from '@/lib/profile-scope';
import { tr } from '@/lib/i18n';

// ============================================================
// Recuadro anfitrión de un servicio de Google REAL (Gmail, YouTube, Classroom
// y, con Wire, Drive) incrustado vía webview hijo de Tauri.
//
// - Se recorta contra el contenedor con scroll de la app: nunca se
//   superpone a la barra superior fija ni al reproductor de música.
// - Se aparta cuando hay un diálogo Radix abierto (para no taparlo).
// - Sin conexión, el webview se oculta y se muestra `offlineContent`.
// - Al desmontar se mueve fuera de vista SIN destruirse: la página de
//   Google no se recarga al volver a la sección.
// ============================================================

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

const SERVICE_LABEL: Record<GoogleEmbedProps['kind'], string> = {
  gmail: 'Gmail',
  youtube: 'YouTube',
  classroom: 'Google Classroom',
  drive: 'Google Drive',
};

interface GoogleEmbedProps {
  kind: 'gmail' | 'youtube' | 'classroom' | 'drive';
  /** Cuenta con que se abre (solo Drive: la de Wire). Si cambia, se vuelve a abrir con ella. */
  account?: string | null;
  /** alto del recuadro (clase Tailwind), p. ej. "h-[620px]" */
  heightClass: string;
  /** contenido a mostrar dentro del recuadro cuando no hay internet */
  offlineContent?: ReactNode;
  /**
   * El recuadro vive DENTRO de un diálogo.
   *
   * Por defecto el webview se aparta en cuanto hay un modal abierto, para no
   * taparlo. Cuando el modal ES este recuadro, esa regla lo escondería justo
   * cuando hay que verlo.
   */
  allowInModal?: boolean;
  /** Aparta el webview sin desmontarlo (para enseñar algo encima). */
  paused?: boolean;
}

export default function GoogleEmbed({
  kind,
  account = null,
  heightClass,
  offlineContent,
  allowInModal = false,
  paused = false,
}: GoogleEmbedProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const online = useOnline();
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!isTauri()) return;
    let raf = 0;
    let disposed = false;
    /** Lo último que se mandó al núcleo: si nada cambió, no se vuelve a mandar
     *  (salvo cada pocos segundos, por si el webview se recreó). */
    let lastSent = '';
    let lastSentAt = 0;

    const update = () => {
      if (disposed || !boxRef.current) return;
      const r = boxRef.current.getBoundingClientRect();

      // Recorte contra el contenedor de scroll: el webview nativo siempre se
      // dibuja encima del HTML, así que se recorta "a mano" para que no tape
      // la barra superior fija ni el reproductor.
      const clipEl = boxRef.current.closest('.overflow-y-auto');
      const clip = clipEl ? clipEl.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const top = Math.max(r.top, clip.top);
      const bottom = Math.min(r.bottom, clip.bottom);
      const height = bottom - top;

      // Radix marca body con pointer-events:none mientras un diálogo está
      // abierto: se aparta el webview para que no tape el modal.
      const modalOpen = !allowInModal && document.body.style.pointerEvents === 'none';

      const payload = {
        kind,
        // Cada perfil, su propia sesión de Google (1.6.7).
        profile: activeProfileId() ?? 'sin-perfil',
        account,
        x: Math.round(r.left * 2) / 2,
        y: Math.round(top * 2) / 2,
        width: Math.round(r.width * 2) / 2,
        height: Math.round(height * 2) / 2,
        visible: onlineRef.current && !modalOpen && !pausedRef.current && r.width > 1 && height > 24,
      };
      const key = JSON.stringify(payload);
      const now = performance.now();
      if (key === lastSent && now - lastSentAt < 3000) return;
      lastSent = key;
      lastSentAt = now;
      void invoke('google_embed_update', payload).catch(() => {});
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('online', schedule);
    window.addEventListener('offline', schedule);
    const resizeObserver = new ResizeObserver(schedule);
    if (boxRef.current) resizeObserver.observe(boxRef.current);
    const modalObserver = new MutationObserver(schedule);
    modalObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    // Red de seguridad para transiciones (colapso del sidebar, animaciones).
    const interval = setInterval(schedule, 400);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('online', schedule);
      window.removeEventListener('offline', schedule);
      resizeObserver.disconnect();
      modalObserver.disconnect();
      clearInterval(interval);
      // Al salir de la sección el webview se aparta (sin destruirse).
      void invoke('google_embed_update', {
        kind,
        profile: activeProfileId() ?? 'sin-perfil',
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        visible: false,
      }).catch(() => {});
    };
  }, [kind, account, allowInModal, paused]);

  return (
    <div ref={boxRef} className={`flex w-full items-center justify-center ${heightClass}`}>
      {online ? (
        // Solo se ve un instante mientras la página de Google carga encima.
        <div className="flex items-center gap-3 text-muted-foreground">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm">{tr('Cargando')}{' '}{SERVICE_LABEL[kind]}…</span>
        </div>
      ) : (
        offlineContent ?? (
          <div className="flex flex-col items-center gap-3 px-6 text-center text-muted-foreground">
            <WifiOff className="h-8 w-8" />
            <p className="text-sm font-semibold text-foreground">{tr('Sin conexión a internet')}</p>
            <p className="max-w-sm text-xs">{SERVICE_LABEL[kind]}{' '}{tr('necesita conexión a internet.')}</p>
          </div>
        )
      )}
    </div>
  );
}
