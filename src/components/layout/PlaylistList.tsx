import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, ListMusic } from 'lucide-react';
import { useCourse } from '@/context/CourseContext';
import { cn } from '@/lib/utils';
import { PlaylistItem } from './PlaylistItem';
import { tr } from '@/lib/i18n';

/** Cuánto hay que mantener pulsada una playlist para poder moverla. */
const HOLD_MS = 420;
/** Si el puntero se desplaza más que esto antes de tiempo, era un clic o un scroll. */
const HOLD_TOLERANCE_PX = 7;

/**
 * Reordenación por pulsación larga: se mantiene pulsada una playlist, «se
 * despega» y se arrastra arriba o abajo; al soltar, el orden queda guardado.
 * Un clic normal sigue abriendo la playlist.
 */
function useHoldToReorder(ids: string[], commit: (ids: string[]) => void) {
  const [order, setOrder] = useState(ids);
  const [dragId, setDragId] = useState<string | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;
  const dragRef = useRef<string | null>(null);
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const suppressClickRef = useRef(false);

  // Fuera de un arrastre manda el orden real (playlist creada, borrada…).
  const signature = ids.join('|');
  useEffect(() => {
    if (!dragRef.current) setOrder(signature ? signature.split('|') : []);
  }, [signature]);

  const cancelHold = useCallback(() => {
    if (holdRef.current) clearTimeout(holdRef.current.timer);
    holdRef.current = null;
  }, []);

  const finish = useCallback(() => {
    cancelHold();
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragId(null);
    document.body.style.removeProperty('user-select');
    document.body.style.removeProperty('cursor');
    commit(orderRef.current);
    // El clic que sigue al soltar no debe abrir la playlist arrastrada.
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, [cancelHold, commit]);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const hold = holdRef.current;
      if (hold && !dragRef.current) {
        if (Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > HOLD_TOLERANCE_PX) cancelHold();
        return;
      }
      const dragging = dragRef.current;
      if (!dragging) return;
      const target = document
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>('[data-playlist-id]');
      const overId = target?.dataset.playlistId;
      if (!overId || overId === dragging) return;
      setOrder((current) => {
        const from = current.indexOf(dragging);
        const to = current.indexOf(overId);
        if (from < 0 || to < 0) return current;
        const next = [...current];
        next.splice(from, 1);
        next.splice(to, 0, dragging);
        return next;
      });
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
    };
  }, [cancelHold, finish]);

  const bind = (id: string) => ({
    'data-playlist-id': id,
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      cancelHold();
      const timer = setTimeout(() => {
        holdRef.current = null;
        dragRef.current = id;
        setDragId(id);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }, HOLD_MS);
      holdRef.current = { timer, x: event.clientX, y: event.clientY };
    },
    onClickCapture: (event: React.MouseEvent) => {
      if (!suppressClickRef.current) return;
      event.preventDefault();
      event.stopPropagation();
    },
    // El arrastre nativo de enlaces robaría el gesto.
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
  });

  return { order, dragId, bind };
}

export function PlaylistList({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { playlists, reorderPlaylists } = useCourse();
  const [isPlaylistsOpen, setPlaylistsOpen] = useState(true);
  const [isClient, setIsClient] = useState(false);
  const { order, dragId, bind } = useHoldToReorder(
    (playlists ?? []).map((playlist) => playlist.id),
    reorderPlaylists
  );

  useEffect(() => {
    setIsClient(true);
  }, []);

  if (!isClient) {
    return null;
  }

  if (!playlists || playlists.length === 0) {
    return null;
  }

  const byId = new Map(playlists.map((playlist) => [playlist.id, playlist]));
  const ordered = order.map((id) => byId.get(id)).filter((playlist): playlist is NonNullable<typeof playlist> => !!playlist);
  // Recién creada y aún sin sitio en el orden local: al final, como en los datos.
  for (const playlist of playlists) if (!order.includes(playlist.id)) ordered.push(playlist);

  const items = ordered.map((playlist) => (
    <div
      key={playlist.id}
      {...bind(playlist.id)}
      className={cn(
        'touch-none rounded-md transition-[transform,box-shadow,background-color] duration-150',
        dragId === playlist.id && 'z-10 scale-[1.03] bg-primary/10 shadow-md ring-1 ring-primary/50',
        dragId !== null && dragId !== playlist.id && 'opacity-80'
      )}
    >
      <PlaylistItem playlist={playlist} collapsed={collapsed} onNavigate={onNavigate} />
    </div>
  ));

  // Contraído no hay sitio para el encabezado ni para plegar nada: las
  // playlists se muestran como iconos, separadas por una fina línea.
  if (collapsed) {
    return <div className="mt-2 flex flex-col gap-1 border-t border-border/70 pt-2">{items}</div>;
  }

  return (
    <div className="mt-4">
      <button type="button" className="w-full" aria-expanded={isPlaylistsOpen} onClick={() => setPlaylistsOpen((open) => !open)}>
        <div
          className={cn(
            'flex items-center justify-between w-full p-2 text-xs font-semibold rounded-md border border-primary bg-primary/20 text-primary',
          )}
        >
          <span className="flex items-center gap-2">
            <ListMusic className="h-3.5 w-3.5" />
            {tr('Mis playlists')}
          </span>
          {isPlaylistsOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </div>
      </button>
      {isPlaylistsOpen && (
        <div className="flex flex-col gap-1 mt-4" title={tr('Mantén pulsada una playlist para moverla')}>
          {items}
        </div>
      )}
    </div>
  );
}
