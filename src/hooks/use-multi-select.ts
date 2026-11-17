import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

// ============================================================
// Varias tarjetas a la vez (2.0.2, Diego): en Música, en cada playlist y en
// la Biblioteca. Con ratón, Ctrl+clic (⌘ en Mac) marca o desmarca una tarjeta
// y Mayús+clic marca el tramo desde la última; con el dedo, mantenerla
// presionada. Con algo marcado, un clic o un toque normal también marca, Esc
// suelta todo, y la barra de selección ofrece lo que se hace en conjunto.
// ============================================================

/** Cuánto hay que mantener el dedo para marcar una tarjeta. */
const LONG_PRESS_MS = 450;
/** Si el dedo se mueve más que esto, es desplazar la lista, no mantener. */
const LONG_PRESS_SLOP = 10;

export interface MultiSelect {
  selected: ReadonlySet<string>;
  /** Hay algo marcado: los clics marcan en vez de abrir. */
  active: boolean;
  toggle: (id: string) => void;
  clear: () => void;
  /** Marca todo lo visible. */
  selectAll: () => void;
  /** Para el clic de la tarjeta: `true` si fue para la selección (no se abre la tarjeta). */
  onCardClick: (event: MouseEvent, id: string) => boolean;
  /** Para la tarjeta: mantener presionado con el dedo la marca. */
  pressProps: (id: string) => {
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onContextMenu: (event: MouseEvent) => void;
  };
}

/** `order`: los id visibles, en el orden en que se ven (para Mayús+clic y «Todo»). */
export function useMultiSelect(order: readonly string[]): MultiSelect {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const anchor = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /** El clic que sigue a una pulsación larga ya la marcó: no abre la tarjeta. */
  const swallow = useRef(false);
  const active = selected.size > 0;

  // Lo que deja de verse (otra búsqueda, otra carpeta, un borrado) se suelta.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(order);
      const next = new Set([...prev].filter((id) => visible.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [order]);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    anchor.current = null;
    setSelected(new Set());
  }, []);

  const selectAll = useCallback(() => setSelected(new Set(order)), [order]);

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') clear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, clear]);

  const cancelPress = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancelPress, []);

  const onCardClick = (event: MouseEvent, id: string): boolean => {
    if (swallow.current) {
      swallow.current = false;
      event.preventDefault();
      return true;
    }
    const from = anchor.current ? order.indexOf(anchor.current) : -1;
    if (event.shiftKey && (active || event.ctrlKey || event.metaKey) && from >= 0) {
      event.preventDefault();
      const to = order.indexOf(id);
      if (to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        setSelected((prev) => new Set([...prev, ...order.slice(a, b + 1)]));
        anchor.current = id;
      }
      return true;
    }
    if (event.ctrlKey || event.metaKey || active) {
      event.preventDefault();
      toggle(id);
      return true;
    }
    return false;
  };

  const pressProps = (id: string) => ({
    onPointerDown: (event: PointerEvent) => {
      swallow.current = false;
      if (event.pointerType === 'mouse' || event.button !== 0) return;
      cancelPress();
      start.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = null;
        start.current = null;
        swallow.current = true;
        toggle(id);
        navigator.vibrate?.(15);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: PointerEvent) => {
      if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > LONG_PRESS_SLOP) cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    // La pulsación larga de Android abre el menú del sistema: aquí marca la tarjeta.
    onContextMenu: (event: MouseEvent) => {
      if (start.current || swallow.current) event.preventDefault();
    },
  });

  return { selected, active, toggle, clear, selectAll, onCardClick, pressProps };
}
