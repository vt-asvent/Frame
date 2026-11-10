import { cappedFetchWith } from '@/lib/capped-fetch';

// El Worker de Frame en Cloudflare (nube-ia/): el relé de los chats con IA, el
// lector de horarios, la traducción de letras y la Biblioteca. Ninguno guarda
// lo que pasa por él.
export const NUBE = 'https://frame-ia.vtasvent.workers.dev';

/**
 * `fetch` hacia esa nube, con plazo (ver capped-fetch.ts): sin él, una red que
 * se traga los paquetes dejaba la pantalla girando para siempre. Lo que pasa
 * por la IA (leer un horario, traducir una letra) puede tardar; lo demás
 * contesta enseguida y, si es un archivo, tiene lo que tarde en bajar.
 */
export const nubeFetch = cappedFetchWith((url) =>
  /\/app\/(horario|traducir)(\?|$)/.test(url)
    ? { answerMs: 150_000, unsizedBodyMs: 30_000, bytesPerMs: 4 }
    : { answerMs: 30_000, unsizedBodyMs: 300_000, bytesPerMs: 4 }
);
