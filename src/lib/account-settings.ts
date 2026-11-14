import { ACCENT_CHANGED_EVENT, accentById, getAccent, getCustomHex, setAccent, setCustomAccent } from '@/lib/accent';
import { getLang, isClassicLang, isLang, setLang, subscribeLang, type Lang } from '@/lib/i18n';
import { getCardImageRatio, setCardImageRatio, subscribeCardImageRatio } from '@/lib/card-image-height';
import { WEATHER_PLACE_EVENT, loadWeatherPlace, saveWeatherPlace, type WeatherPlace } from '@/lib/weather';
import { CLOUD_APPLIED_EVENT } from '@/lib/supabase/sync';
import { getSyncStatus, subscribeSyncStatus } from '@/lib/sync-status';

// ============================================================
// Ajustes que siguen a la cuenta en todos sus dispositivos (1.6.8, Diego).
//
//   · el idioma de la app;
//   · la proporción de las imágenes de las tarjetas de asignaturas y colecciones;
//   · la ciudad del clima ELEGIDA A MANO (la detectada sola es de cada
//     dispositivo: depende de dónde está);
//   · el color de acento (2.0.0), desde que se cambia en algún dispositivo:
//     hasta entonces cada uno conserva el suyo.
//
// Cada uno sigue guardándose donde siempre (lo lee su pantalla sin esperar a
// nada); aquí solo se copia a `appSettings_<uid>`, que viaja con la cuenta,
// y lo que llega de otro dispositivo se aplica al instante. El tema, en
// cambio, es de cada dispositivo (oscuro en la laptop, claro en la tablet).
//
// Idiomas nuevos (1.7.3): Frame móvil y las versiones anteriores solo
// conocen español e inglés, y al guardar cualquier otro ajuste (la ciudad
// del clima, que se actualiza sola) anotan su idioma encima del de la
// cuenta y borran lo que no conocen. Por eso esta versión deja su marca
// (`multiLang`): si este equipo está en un idioma nuevo y llega un español
// o un inglés SIN la marca, no es una elección sino un ajuste anotado por
// una app que no conoce el idioma; se conserva el de aquí y se vuelve a
// anotar. Un cambio de idioma hecho en el teléfono, entonces, no llega a
// este equipo mientras use un idioma que el teléfono no tiene.
// ============================================================

interface AccountSettings {
  lang?: Lang;
  /** Lo anotó una versión que conoce los ocho idiomas (1.7.3 o posterior). */
  multiLang?: boolean;
  cardRatio?: number;
  /** Última ciudad elegida a mano (ausente: nunca se eligió una). */
  weather?: WeatherPlace;
  /** Color de acento (2.0.0) y, si es el propio, su valor. Ausente: nadie lo ha cambiado desde que viaja. */
  accent?: string;
  accentHex?: string;
}

const storageKey = (uid: string) => `appSettings_${uid}`;
const round = (value: number) => Math.round(value * 10_000) / 10_000;

function read(uid: string): AccountSettings | null {
  try {
    const raw = localStorage.getItem(storageKey(uid));
    const parsed = raw ? (JSON.parse(raw) as AccountSettings) : null;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/** El acento se anota desde que el usuario lo cambia en algún dispositivo de la cuenta. */
let accentChosen = false;

/** Lo de este dispositivo ahora mismo. */
function current(previous: AccountSettings | null): AccountSettings {
  const place = loadWeatherPlace();
  const withAccent = accentChosen || typeof previous?.accent === 'string';
  return {
    lang: getLang(),
    multiLang: true,
    cardRatio: round(getCardImageRatio()),
    // Una ubicación automática no pisa la última ciudad elegida a mano.
    weather: place && !place.auto ? place : previous?.weather,
    ...(withAccent ? { accent: getAccent(), accentHex: getAccent() === 'personal' ? getCustomHex() : previous?.accentHex } : {}),
  };
}

function write(uid: string, settings: AccountSettings): void {
  const text = JSON.stringify(settings);
  try {
    if (localStorage.getItem(storageKey(uid)) !== text) localStorage.setItem(storageKey(uid), text);
  } catch {
    /* sin espacio: el ajuste vale en este dispositivo */
  }
}

/** Aplica lo de la cuenta. Devuelve `true` si el idioma de aquí se conservó
 *  frente al de una app que no lo conoce (y hay que volver a anotarlo). */
async function apply(settings: AccountSettings): Promise<boolean> {
  let keptOwn = false;
  if (isLang(settings.lang) && settings.lang !== getLang()) {
    if (!isClassicLang(getLang()) && !settings.multiLang) keptOwn = true;
    else await setLang(settings.lang);
  }
  if (typeof settings.cardRatio === 'number' && settings.cardRatio > 0 && Math.abs(settings.cardRatio - getCardImageRatio()) > 1e-4) {
    setCardImageRatio(settings.cardRatio);
  }
  const place = settings.weather;
  if (place && typeof place.latitude === 'number' && typeof place.longitude === 'number') {
    const here = loadWeatherPlace();
    if (!here || here.auto || here.latitude !== place.latitude || here.longitude !== place.longitude) saveWeatherPlace(place);
  }
  if (typeof settings.accent === 'string') {
    const hex = typeof settings.accentHex === 'string' && /^#[0-9a-f]{6}$/i.test(settings.accentHex) ? settings.accentHex.toUpperCase() : null;
    if (settings.accent === 'personal') {
      if (hex && (getAccent() !== 'personal' || getCustomHex() !== hex)) setCustomAccent(hex);
    } else if (accentById(settings.accent).id === settings.accent && getAccent() !== settings.accent) {
      setAccent(accentById(settings.accent).id);
    }
  }
  return keptOwn;
}

/** Para la cuenta que sincroniza: aplica lo suyo y anota lo que cambie aquí. */
export function startAccountSettings(uid: string): () => void {
  // Mientras se aplica lo que llegó (el idioma tarda lo que su diccionario),
  // los avisos de cambio no se anotan: anotarían lo de antes encima.
  let applying = 0;
  const record = () => {
    if (applying === 0) write(uid, current(read(uid)));
  };
  const applyStored = () => {
    const settings = read(uid);
    if (!settings) return false;
    applying += 1;
    void apply(settings)
      .catch(() => false)
      .then((keptOwn) => {
        applying -= 1;
        // El idioma de aquí vuelve a la cuenta, con lo demás ya aplicado.
        if (keptOwn) record();
      });
    return true;
  };
  // Lo de la cuenta manda. Sin nada guardado, se anota lo de aquí, pero solo
  // tras la primera sincronización de la sesión: si este equipo arrancó sin
  // conexión (o aún no había bajado lo de la cuenta), anotarlo antes lo haría
  // lo más reciente y su idioma pisaría el elegido en los demás dispositivos.
  let stopWaiting: (() => void) | null = null;
  if (!applyStored()) {
    const afterFirstSync = () => {
      if (getSyncStatus().lastOkAt === null) return;
      stopWaiting?.();
      stopWaiting = null;
      if (!applyStored()) record();
    };
    stopWaiting = subscribeSyncStatus(afterFirstSync);
    afterFirstSync();
  }
  const onCloud = () => void applyStored();
  // El acento: solo un cambio de verdad (no el pintado inicial) lo hace viajar.
  let accentWas = `${getAccent()}|${getCustomHex()}`;
  const onAccent = () => {
    const now = `${getAccent()}|${getCustomHex()}`;
    if (now === accentWas) return;
    accentWas = now;
    accentChosen = true;
    record();
  };
  const stopLang = subscribeLang(record);
  const stopRatio = subscribeCardImageRatio(record);
  window.addEventListener(WEATHER_PLACE_EVENT, record);
  window.addEventListener(ACCENT_CHANGED_EVENT, onAccent);
  window.addEventListener(CLOUD_APPLIED_EVENT, onCloud);
  return () => {
    stopWaiting?.();
    stopLang();
    stopRatio();
    window.removeEventListener(WEATHER_PLACE_EVENT, record);
    window.removeEventListener(ACCENT_CHANGED_EVENT, onAccent);
    window.removeEventListener(CLOUD_APPLIED_EVENT, onCloud);
  };
}
