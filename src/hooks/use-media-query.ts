import { useCallback, useSyncExternalStore } from 'react';

/**
 * ¿Se cumple una consulta de medios? («(min-width: 640px)», por ejemplo).
 * Para lo que Tailwind no puede decidir solo: lo que solo debe ocurrir con
 * algo a la vista. Se reevalúa al cambiar el tamaño de la ventana. (El mismo
 * de Frame móvil, 1.1.8.)
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query]
  );
  const read = useCallback(() => window.matchMedia(query).matches, [query]);
  return useSyncExternalStore(subscribe, read, read);
}
