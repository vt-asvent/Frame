import { useEffect, useSyncExternalStore, type RefObject } from 'react';

// ============================================================
// Tamaño de la imagen de las tarjetas de colecciones y asignaturas.
//
// 1.6.4: el usuario elige con el engranaje de Asignaturas el ALTO de la
// imagen. 1.6.6 (Diego): lo que se conserva en el resto de la app no es ese
// alto sino la PROPORCIÓN. En Asignaturas cada tarjeta mide un tercio del
// ancho; si ahí el usuario elige un alto z, la imagen guarda la relación
// z / ancho de esa tarjeta, y cualquier tarjeta más estrecha (al crear una
// tarea, en Métricas de hoy…) mantiene esa misma proporción: su ancho no
// cambia, su alto sí.
//
// Se guarda la proporción (alto / ancho). El engranaje sigue hablando en
// píxeles: los de la tarjeta de Asignaturas tal como se ve ahora.
// ============================================================

export const CARD_IMAGE_MIN = 64;
export const CARD_IMAGE_MAX = 200;
/** Ancho de referencia de una tarjeta de Asignaturas hasta que se mide la real. */
const REFERENCE_WIDTH = 352;
/** El antiguo `h-28` (112 px) sobre el ancho de referencia. */
export const CARD_RATIO_DEFAULT = 112 / REFERENCE_WIDTH;

const KEY = 'frameCardImageRatio';
const listeners = new Set<() => void>();

let ratio = (() => {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (Number.isFinite(saved) && saved > 0) return saved;
  } catch {
    /* sin almacenamiento */
  }
  return CARD_RATIO_DEFAULT;
})();

/** Ancho real de una tarjeta de Asignaturas, medido en pantalla. */
let referenceWidth = REFERENCE_WIDTH;

const emit = () => listeners.forEach((listener) => listener());

export function setCardImageRatio(next: number) {
  ratio = next;
  try {
    if (Math.abs(ratio - CARD_RATIO_DEFAULT) < 1e-6) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(ratio));
  } catch {
    /* sin almacenamiento: vale para esta sesión */
  }
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** La proporción actual y su aviso de cambio, fuera de React (ajustes de la cuenta, 1.6.8). */
export const getCardImageRatio = () => ratio;
export const subscribeCardImageRatio = subscribe;

/** Proporción alto / ancho de la imagen de toda tarjeta. */
export function useCardImageRatio(): number {
  return useSyncExternalStore(subscribe, () => ratio, () => ratio);
}

/** Estilo de la caja de la imagen: ancho de la tarjeta, alto proporcional. */
export function useCardImageStyle(): { aspectRatio: string } {
  const r = useCardImageRatio();
  return { aspectRatio: `1 / ${r}` };
}

/** Ancho de referencia (el de las tarjetas de Asignaturas). */
export function useReferenceWidth(): number {
  return useSyncExternalStore(subscribe, () => referenceWidth, () => referenceWidth);
}

/** Las tarjetas de Asignaturas informan de su ancho real (para el engranaje). */
export function useReportReferenceWidth(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      if (width > 0 && width !== referenceWidth) {
        referenceWidth = width;
        emit();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
}

/** El alto, en píxeles, que tendría la imagen en una tarjeta de Asignaturas. */
export const heightAtReference = (r: number, width: number) => Math.round(r * width);

/** Fija la proporción a partir de un alto elegido sobre la tarjeta de Asignaturas. */
export function setCardImageHeightAt(height: number, width: number) {
  const clamped = Math.min(CARD_IMAGE_MAX, Math.max(CARD_IMAGE_MIN, Math.round(height)));
  setCardImageRatio(clamped / Math.max(1, width));
}
