// ============================================================
// Orden de las playlists del menú (1.7.3).
//
// Cada playlist lleva su número de orden (`order`, 1.6.8) y la fusión de la
// sincronización decide registro a registro: gana la versión más reciente de
// cada playlist ENTERA. Hasta la 1.7.2, mover una playlist renumeraba todas
// (0, 1, 2…) y reescribía cada una cuyo número cambiaba. Si otro dispositivo
// acababa de reordenar las canciones de una de ellas y aún no había llegado,
// esa reescritura (solo para cambiarle el número) era más nueva y se llevaba
// la playlist entera con su orden de canciones VIEJO: el cambio del otro
// dispositivo se deshacía en todos (lo encontró la prueba de tres
// dispositivos, 5-nov-2026).
//
// Ahora mover una playlist reescribe solo las que cambian de sitio: se
// conserva la secuencia creciente más larga de los números que ya hay y las
// demás reciben un número entre sus vecinas (puede ser fraccionario o
// negativo; `byOrder` ordena por número en las dos apps). Arrastrar una
// playlist reescribe esa sola.
// ============================================================

import type { Playlist } from '@/types';

/** Por debajo de esta separación entre vecinas, se renumera todo una vez. */
const MIN_GAP = 1e-6;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Índices de una subsecuencia estrictamente creciente más larga (solo números). */
function longestIncreasing(values: (number | null)[]): Set<number> {
  const n = values.length;
  const length = new Array<number>(n).fill(0);
  const previous = new Array<number>(n).fill(-1);
  let best = -1;
  for (let i = 0; i < n; i++) {
    const vi = values[i];
    if (vi === null) continue;
    length[i] = 1;
    for (let j = 0; j < i; j++) {
      const vj = values[j];
      if (vj !== null && vj < vi && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        previous[i] = j;
      }
    }
    if (best < 0 || length[i] > length[best]) best = i;
  }
  const keep = new Set<number>();
  for (let i = best; i >= 0; i = previous[i]) keep.add(i);
  return keep;
}

/**
 * La lista en el orden nuevo (`orderedIds`; lo que no venga en ella va al
 * final, como estaba), con `order` cambiado SOLO en las playlists que hace
 * falta. Las demás son el mismo objeto de antes.
 */
export function reorderPlaylists(previous: Playlist[], orderedIds: string[]): Playlist[] {
  const byId = new Map(previous.map((playlist) => [playlist.id, playlist]));
  const next: Playlist[] = [];
  for (const id of orderedIds) {
    const found = byId.get(id);
    if (found) {
      next.push(found);
      byId.delete(id);
    }
  }
  for (const rest of byId.values()) next.push(rest);

  const values = next.map((playlist) => (finite(playlist.order) ? playlist.order : null));
  const keep = longestIncreasing(values);
  const assigned: number[] = new Array(next.length);
  let renumber = keep.size === 0;

  for (let i = 0; i < next.length && !renumber; ) {
    if (keep.has(i)) {
      assigned[i] = values[i] as number;
      i++;
      continue;
    }
    // Tramo [i, j) sin número que conservar, entre dos que sí (o un extremo).
    let j = i;
    while (j < next.length && !keep.has(j)) j++;
    const count = j - i;
    const left = i > 0 ? assigned[i - 1] : null;
    const right = j < next.length ? (values[j] as number) : null;
    for (let k = 1; k <= count; k++) {
      let value: number;
      if (left !== null && right !== null) value = left + ((right - left) * k) / (count + 1);
      else if (left !== null) value = left + k;
      else value = (right as number) - (count + 1 - k);
      assigned[i + k - 1] = value;
    }
    if (left !== null && right !== null && (right - left) / (count + 1) < MIN_GAP) renumber = true;
    i = j;
  }

  // Sin números útiles (listas de antes de la 1.6.8) o sin hueco entre dos
  // vecinas tras muchísimos arrastres: 0, 1, 2… una vez.
  if (renumber) for (let i = 0; i < next.length; i++) assigned[i] = i;

  return next.map((playlist, i) => (playlist.order === assigned[i] ? playlist : { ...playlist, order: assigned[i] }));
}
