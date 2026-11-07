// ============================================================
// Fundidos suaves con el fondo de la app (1.8.0: compartido entre la cabecera
// de las playlists e Inicio). Con dos o tres paradas lineales se ve el escalón
// donde empieza la imagen; esta curva entra y sale despacio.
// ============================================================

/** [posición %, opacidad]. */
export const EASED_STOPS: [number, number][] = [
  [0, 0], [8.1, 0.013], [15.5, 0.049], [22.5, 0.104], [29, 0.175], [35.3, 0.259], [41.2, 0.352], [47.1, 0.45],
  [52.9, 0.55], [58.8, 0.648], [64.7, 0.741], [71, 0.825], [77.5, 0.896], [84.5, 0.951], [91.9, 0.987], [100, 1],
];

/**
 * Máscara de transparencia: al principio del degradado la imagen no se ve
 * (asoma el fondo REAL de detrás, claro u oscuro) y al final se ve entera.
 */
export const easedMask = (direction = 'to right'): string =>
  `linear-gradient(${direction}, ${EASED_STOPS.map(([at, alpha]) => `rgba(0,0,0,${alpha}) ${at}%`).join(', ')})`;

/** Velo de un color del tema (por defecto, el fondo): opaco al principio, transparente al final. */
export const easedVeil = (direction = 'to right', color = 'var(--background)'): string =>
  `linear-gradient(${direction}, ${EASED_STOPS.map(([at, alpha]) => `hsl(${color} / ${Math.round((1 - alpha) * 1000) / 1000}) ${at}%`).join(', ')})`;
