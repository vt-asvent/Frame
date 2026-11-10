// ============================================================
// Ninguna petición espera para siempre (1.9.2).
//
// `fetch` no tiene tope. Si la red se traga los paquetes (el portal del
// colegio, un wifi a medias) o el equipo se duerme con una petición en
// camino, su promesa puede no resolverse nunca; y una sola petición colgada
// lo paraba todo, sin error ni aviso:
//   · en supabase-js la renovación de la sesión es única y las demás
//     peticiones la esperan: colgada ella, ninguna volvía a salir hasta
//     reiniciar Frame;
//   · la sincronización (y el relevo de Wire) esperan a su vuelta antes de
//     empezar otra: el equipo se quedaba «sincronizando» y dejaba de recibir
//     y de enviar.
//
// Aquí cada petición lleva su plazo. No es una prisa, es una red de
// seguridad: lo que cabe esperar de su tipo más lo que tardaría su tamaño en
// la red más lenta que se da por viva. Al cumplirse, la petición se cancela y
// falla como cualquier fallo de red, que es algo que todo lo de arriba ya
// sabe reintentar.
//
// Sin dependencias: lo prueba scripts/probar-sesion.mjs con una red simulada.
// ============================================================

export interface CapRule {
  /** Hasta que el servidor contesta (sin contar lo que tarde en subir el cuerpo). */
  answerMs: number;
  /** Para leer una respuesta que no dice cuánto pesa. */
  unsizedBodyMs: number;
  /** La red más lenta que se da por viva, en bytes por milisegundo. */
  bytesPerMs: number;
}

/** Con el tamaño de la respuesta a la vista: este margen más lo que tarde en bajar. */
const BODY_MARGIN_MS = 10_000;

function bodyBytes(body: unknown): number {
  if (typeof body === 'string') return body.length;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    let total = 0;
    body.forEach((value) => {
      total += typeof value === 'string' ? value.length : value.size;
    });
    return total;
  }
  return 0;
}

/** El error de un plazo cumplido: con la forma de un fallo de red, que es como se trata. */
export const isFetchTimeout = (error: unknown): boolean => error instanceof TypeError && /\(timeout\)$/.test(error.message);
const timeoutError = () => new TypeError('Failed to fetch (timeout)');

/** Un `fetch` con plazo; `ruleFor` dice cuál le toca a cada dirección. */
export function cappedFetchWith(ruleFor: (url: string) => CapRule): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const rule = ruleFor(url);
    const outer = init?.signal ?? (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const arm = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort(timeoutError());
      }, ms);
    };
    // Quien llama también puede cancelar (p. ej. la despedida de Dispositivos): se respeta.
    const onOuterAbort = () => {
      clearTimeout(timer);
      controller.abort(outer?.reason);
    };
    const release = () => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onOuterAbort);
    };

    arm(rule.answerMs + bodyBytes(init?.body) / rule.bytesPerMs);
    if (outer?.aborted) onOuterAbort();
    else outer?.addEventListener('abort', onOuterAbort, { once: true });

    return fetch(input, { ...init, signal: controller.signal }).then(
      (response) => {
        // Contestó. Queda leer el cuerpo, que también puede quedarse a medias: el
        // plazo sigue corriendo (cancelar una respuesta ya leída no hace nada).
        if (!response.body) {
          release();
          return response;
        }
        const length = Number(response.headers.get('content-length'));
        arm(Number.isFinite(length) && length > 0 ? BODY_MARGIN_MS + length / rule.bytesPerMs : rule.unsizedBodyMs);
        return response;
      },
      (error) => {
        release();
        throw timedOut ? timeoutError() : error;
      }
    );
  };
}

// ------------------------------------------------------------
// Supabase: según lo que se pide
// ------------------------------------------------------------
/** Una red de 4 KB/s aún se da por viva: el respaldo de una cuenta con uso (~400 KB) tiene sus 100 s. */
const SLOWEST_BYTES_PER_MS = 4;
const SUPABASE: Record<'logout' | 'auth' | 'storage' | 'data', CapRule> = {
  logout: { answerMs: 5_000, unsizedBodyMs: 5_000, bytesPerMs: SLOWEST_BYTES_PER_MS },
  auth: { answerMs: 15_000, unsizedBodyMs: 15_000, bytesPerMs: SLOWEST_BYTES_PER_MS },
  storage: { answerMs: 60_000, unsizedBodyMs: 300_000, bytesPerMs: SLOWEST_BYTES_PER_MS },
  data: { answerMs: 30_000, unsizedBodyMs: 120_000, bytesPerMs: SLOWEST_BYTES_PER_MS },
};

/** El `fetch` del cliente de Supabase (client.ts). */
export const cappedFetch = cappedFetchWith((url) => {
  if (url.includes('/auth/v1/logout')) return SUPABASE.logout;
  if (url.includes('/auth/v1/')) return SUPABASE.auth;
  if (url.includes('/storage/v1/')) return SUPABASE.storage;
  return SUPABASE.data;
});
