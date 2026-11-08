import { useEffect, useState } from 'react';
import { IMAGE_UPDATED_EVENT, getImage, type ImageUpdatedDetail } from '@/lib/music-db';

/**
 * Una imagen del almacén local, siempre al día.
 *
 * Se relee sola cuando cambia: al guardarla aquí y también cuando llega de
 * otro dispositivo (image-sync.ts). Antes cada pantalla la leía una sola vez
 * al montarse y una foto de perfil nueva no aparecía hasta reiniciar.
 * El tercer valor dice si ya se leyó: «aún no hay foto» no es «cargando».
 */
export function useStoredImage(key: string | null | undefined): [string | null, (value: string | null) => void, boolean] {
  const [image, setImage] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  useEffect(() => {
    setImage(null);
    if (!key) return;
    let alive = true;
    const load = () => {
      void getImage(key)
        .then((value) => {
          if (alive) setImage(value);
        })
        .catch(() => undefined)
        .finally(() => {
          if (alive) setLoadedKey(key);
        });
    };
    load();
    const onUpdate = (event: Event) => {
      if ((event as CustomEvent<ImageUpdatedDetail>).detail?.key === key) load();
    };
    window.addEventListener(IMAGE_UPDATED_EVENT, onUpdate);
    return () => {
      alive = false;
      window.removeEventListener(IMAGE_UPDATED_EVENT, onUpdate);
    };
  }, [key]);

  return [image, setImage, !!key && loadedKey === key];
}
