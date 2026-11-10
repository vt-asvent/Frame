// El código REAL de Música → Añadir (leer una lista por su enlace, leer un
// CSV, encontrar el vídeo de cada canción, la cola de descargas) y de la
// traducción de letras, a mano de la prueba. Lo simulado es lo de fuera: el
// núcleo nativo, el programa de descargas, la biblioteca y la nube
// (scripts/listas/falsos.ts y scripts/probar-listas.mjs).
import { LinkError, readPlaylistLink, songsToCsv } from '@/lib/extensions/playlist-link';
import { EngineTimeout, parseSongsCsv, primaryArtist, safeFileName } from '@/lib/extensions/yt-mp3';
import { findSongVideo, scoreCandidate } from '@/lib/extensions/yt-mp3-match';
import { sameLanguage, watchTranslation } from '@/lib/lyrics-translate';
import * as queue from '@/lib/extensions/yt-mp3-downloads';

(globalThis as unknown as Record<string, unknown>).frame = {
  LinkError,
  readPlaylistLink,
  songsToCsv,
  EngineTimeout,
  parseSongsCsv,
  primaryArtist,
  safeFileName,
  findSongVideo,
  scoreCandidate,
  sameLanguage,
  watchTranslation,
  queue,
};
