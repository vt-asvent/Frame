import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getImage } from '@/lib/music-db';
import { activeProfileId } from '@/lib/profile-scope';
import { currentTimetableImageKey } from '@/lib/timetable';
import { tr } from '@/lib/i18n';

// ============================================================
// Vistazo al horario (ventana propia, sin marco).
//
// Se abre al dejar el cursor pegado al borde izquierdo de la pantalla, esté
// Frame delante, detrás o minimizada. Resuelve el caso de todos los días:
// mirar el horario mientras se trabaja en otra cosa, sin cambiar de app.
//
// La ventana ocupa MEDIA pantalla de alto, centrada en vertical y pegada al
// borde izquierdo; el ancho lo fija esta misma ventana en cuanto conoce la
// proporción real de la imagen, de modo que no sobre ni un píxel a su derecha
// (lo que sobrara se tragaría los clics de lo que haya debajo).
//
// IMPORTANTE — la ventana NO se destruye al cerrarse, solo se oculta. Por eso
// el estado de partida es "visible": si dependiera de recibir un evento para
// mostrarse, cualquier aviso perdido la dejaría abierta pero en blanco, que
// es exactamente lo que pasaba antes a partir del segundo vistazo. La
// animación de entrada se reinicia con una `key`, y si el aviso no llega, lo
// único que se pierde es la animación, no el horario.
// ============================================================

const ENTER_MS = 260;

export default function SchedulePeekWindow() {
  const [image, setImage] = useState<string | null>(null);
  /** Cambia en cada apertura: reinicia la animación de entrada. */
  const [nonce, setNonce] = useState(0);
  const imageRef = useRef<HTMLImageElement>(null);

  // La ventana es transparente: solo se ve la imagen del horario. Sin esto,
  // el fondo del tema pintaría un rectángulo alrededor.
  useEffect(() => {
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    document.body.style.margin = '0';
  }, []);

  // El horario del perfil activo (la ventana comparte su almacenamiento).
  const load = useCallback(() => {
    const uid = activeProfileId();
    if (!uid) {
      setImage(null);
      return;
    }
    void getImage(currentTimetableImageKey(uid)).then((stored) => setImage(stored));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const close = useCallback(() => {
    void invoke('schedule_peek', { visible: false }).catch(() => undefined);
  }, []);

  /**
   * Cada reapertura: recarga la imagen (pudo cambiarse) y reinicia la
   * animación. Se escucha por DOS vías porque ninguna es infalible sola:
   * el evento de Tauri y el cambio de visibilidad del propio webview.
   */
  useEffect(() => {
    const reopen = () => {
      load();
      setNonce((n) => n + 1);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') reopen();
    };
    document.addEventListener('visibilitychange', onVisibility);

    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen('schedule-peek-open', reopen);
      } catch {
        /* fuera de Tauri no hay nada que escuchar */
      }
    })();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      unlisten?.();
    };
  }, [load]);

  // Escape cierra; es el reflejo de cualquier ventana emergente.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /**
   * Ajusta el ancho de la ventana a la proporción de la imagen, para que el
   * borde derecho caiga justo donde termina el horario.
   */
  const fitWindow = useCallback(() => {
    const node = imageRef.current;
    if (!node || !node.naturalWidth || !node.naturalHeight) return;
    const width = Math.ceil((node.naturalWidth / node.naturalHeight) * window.innerHeight);
    void invoke('schedule_peek_resize', { width }).catch(() => undefined);
  }, []);

  return (
    <div
      onClick={close}
      style={{
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      {image ? (
        <img
          key={nonce}
          ref={imageRef}
          src={image}
          alt={tr('Mi horario')}
          onLoad={fitWindow}
          style={{
            display: 'block',
            height: '100vh',
            width: 'auto',
            maxWidth: 'none',
            objectFit: 'contain',
            borderRadius: '0 10px 10px 0',
            boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
            animation: `frame-peek-in ${ENTER_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both`,
          }}
        />
      ) : null}
    </div>
  );
}
