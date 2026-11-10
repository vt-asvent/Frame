#!/usr/bin/env node
// ============================================================
// Prueba de Música → Añadir y de la traducción de letras (1.9.2).
//
//   node scripts/probar-listas.mjs
//   node scripts/probar-listas.mjs --solo=cola     (enlaces, csv, emparejar, traduccion o cola)
//
// Corre el código REAL de src/lib (playlist-link.ts, yt-mp3.ts,
// yt-mp3-match.ts, yt-mp3-downloads.ts, lyrics-translate.ts), empaquetado con
// esbuild, en contextos aislados de Node. Lo simulado es lo de fuera: las
// páginas de los servicios, el programa de descargas, la biblioteca y la nube
// de Frame (scripts/listas/). No usa la red, y el reloj es de mentira: las
// esperas de la cola pasan al instante.
//
// Es lo que no se puede probar a mano sin bajar cientos de canciones: una
// lista larga con repetidas, la red que se cae a mitad, YouTube que frena, el
// equipo que se queda sin espacio.
// ============================================================
import { summary } from './listas/base.mjs';
import { csv, links } from './listas/enlaces.mjs';
import { matching } from './listas/emparejar.mjs';
import { translation } from './listas/traduccion.mjs';
import { queue } from './listas/cola.mjs';

const only = process.argv.find((arg) => arg.startsWith('--solo='))?.slice(7);
const groups = { enlaces: links, csv, emparejar: matching, traduccion: translation, cola: queue };
if (only && !groups[only]) {
  console.error(`No hay un grupo «${only}». Los que hay: ${Object.keys(groups).join(', ')}.`);
  process.exit(2);
}

const started = Date.now();
for (const [name, run] of Object.entries(groups)) {
  if (!only || only === name) await run();
}
const { passed, failed } = summary();
console.log('');
if (failed.length > 0) {
  console.log(`✗ ${failed.length} de ${passed + failed.length} comprobaciones fallaron:`);
  for (const label of failed) console.log(`   · ${label}`);
  process.exit(1);
}
console.log(`✓ Todo en orden · ${passed} comprobaciones · ${((Date.now() - started) / 1000).toFixed(1)} s`);
