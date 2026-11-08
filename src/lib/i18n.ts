import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Locale } from 'date-fns';
import { es } from 'date-fns/locale/es';

// ============================================================
// Idioma de la interfaz (1.6.7): español o inglés; desde 1.7.3, también
// ruso, alemán, francés, italiano, portugués (de Brasil) y japonés.
//
// El texto en español ES la clave: `tr('Guardar')` devuelve «Guardar» en
// español y lo que diga el diccionario (`i18n-en.ts`) en inglés. Así el código
// se sigue leyendo en el idioma en que se escribió y un texto sin traducir se
// nota enseguida (sale en español, y el comprobador de textos lo señala).
//
// Variables con nombre: `tr('Hoy llevas {total}', { total })`. El orden de
// las palabras cambia entre idiomas; las llaves, no.
//
// Cada diccionario (`i18n-<código>.ts`) solo se carga si hace falta. En los
// idiomas nuevos se carga también el inglés: lo que faltara en el suyo sale
// en inglés, no en español. En español, el inglés solo se carga cuando algo
// se guarda en varios idiomas (`inBothLangs`, el historial de avisos). Cambiar de idioma repinta la interfaz al
// instante (ver `LangRoot` en main.tsx) sin recargarla: el temporizador y la
// música siguen como estaban. Las ventanas auxiliares (mini temporizador,
// vistazo al horario) se enteran por el evento `storage`.
//
// Regla: `tr()` se llama al pintar o al actuar, NUNCA al cargar un módulo
// (una constante traducida al cargar se quedaría en el idioma de arranque).
// ============================================================

export type Lang = 'es' | 'en' | 'ru' | 'de' | 'fr' | 'it' | 'pt' | 'ja';

/** Los idiomas, en el orden del selector: español e inglés primero y luego
 *  por su propio nombre (Deutsch, Français, Italiano, Português, Русский, 日本語). */
export const LANGS: readonly Lang[] = ['es', 'en', 'de', 'fr', 'it', 'pt', 'ru', 'ja'];

/** Cada idioma, nombrado en sí mismo: quien cambió sin querer encuentra el suyo. */
export const LANG_NAMES: Record<Lang, string> = {
  es: 'Español',
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  pt: 'Português',
  ru: 'Русский',
  ja: '日本語',
};

export const isLang = (value: unknown): value is Lang => typeof value === 'string' && (LANGS as readonly string[]).includes(value);

/** Los que Frame conocía antes de 1.7.3 (y Frame móvil, por ahora). */
export const isClassicLang = (lang: Lang): boolean => lang === 'es' || lang === 'en';

export const LANG_STORAGE_KEY = 'appLanguage';

const readStored = (): Lang => {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (isLang(stored)) return stored;
    // Sin elección guardada: quien ya usaba Frame sigue en español; una
    // instalación nueva sigue el idioma del sistema si Frame lo tiene, y si
    // no, inglés (la pantalla de acceso ya sale en el idioma de quien la abre).
    if (localStorage.getItem('userProfile')) return 'es';
    const system = navigator.language?.toLowerCase().slice(0, 2);
    return isLang(system) ? system : 'en';
  } catch {
    return 'es';
  }
};

let current: Lang = readStored();
type Dictionary = Record<string, string>;
const dictionaries: Partial<Record<Lang, Dictionary>> = {};
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

// Cada idioma trae su diccionario y el formato de fechas de date-fns: así el
// arranque solo carga el español (1.9.0).
const LOADERS: Record<Exclude<Lang, 'es'>, () => Promise<[{ default: Dictionary }, Locale]>> = {
  en: () => Promise.all([import('./i18n-en'), import('date-fns/locale/en-US').then((m) => m.enUS)]),
  de: () => Promise.all([import('./i18n-de'), import('date-fns/locale/de').then((m) => m.de)]),
  fr: () => Promise.all([import('./i18n-fr'), import('date-fns/locale/fr').then((m) => m.fr)]),
  it: () => Promise.all([import('./i18n-it'), import('date-fns/locale/it').then((m) => m.it)]),
  pt: () => Promise.all([import('./i18n-pt'), import('date-fns/locale/pt-BR').then((m) => m.ptBR)]),
  ru: () => Promise.all([import('./i18n-ru'), import('date-fns/locale/ru').then((m) => m.ru)]),
  ja: () => Promise.all([import('./i18n-ja'), import('date-fns/locale/ja').then((m) => m.ja)]),
};

async function loadOne(lang: Lang): Promise<void> {
  if (lang === 'es' || dictionaries[lang]) return;
  // Sin prototipo: una clave que llegue de datos («constructor», «toString»)
  // no debe devolver una función de Object en vez de un texto.
  const [dictionary, locale] = await LOADERS[lang]();
  DATE_LOCALES[lang] = locale;
  dictionaries[lang] = Object.assign(Object.create(null) as Dictionary, dictionary.default);
}

/** El diccionario del idioma y, en los nuevos, el inglés de respaldo. */
async function loadDictionary(lang: Lang): Promise<void> {
  await Promise.all([loadOne(lang), isClassicLang(lang) ? Promise.resolve() : loadOne('en')]);
}

/** El texto en el idioma actual: el suyo, o el inglés si le faltara. */
function lookup(key: string): string | undefined {
  const own = dictionaries[current];
  return own?.[key] ?? (current === 'en' ? undefined : dictionaries.en?.[key]);
}

/** Los títulos de las ventanas y de los selectores de archivos los pone el
 *  núcleo nativo: también se enteran del idioma. */
function tellNative(lang: Lang) {
  try {
    if (isTauri()) void invoke('set_ui_language', { lang }).catch(() => undefined);
  } catch {
    /* fuera de Tauri no hay núcleo nativo */
  }
}

function apply(lang: Lang) {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  tellNative(lang);
  notify();
}

/** Antes del primer pintado: deja listo el diccionario del idioma guardado. */
export async function prepareLang(): Promise<void> {
  await loadDictionary(current).catch(() => {
    current = 'es'; // sin diccionario, español antes que una mezcla
  });
  if (typeof document !== 'undefined') document.documentElement.lang = current;
  tellNative(current);
}

export async function setLang(lang: Lang): Promise<void> {
  if (lang === current) return;
  await loadDictionary(lang);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    /* sin almacenamiento, el cambio vale para esta sesión */
  }
  apply(lang);
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== LANG_STORAGE_KEY) return;
    const next = readStored();
    if (next === current) return;
    void loadDictionary(next)
      .then(() => apply(next))
      .catch(() => undefined);
  });
}

export const getLang = (): Lang => current;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Aviso de cambio de idioma fuera de React (ajustes de la cuenta, 1.6.8). */
export const subscribeLang = subscribe;

/** El idioma actual, con repintado al cambiar. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, getLang);

type Vars = Record<string, unknown>;

const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match)) : text;

/** Traduce un texto escrito en español al idioma de la interfaz. */
export function tr(text: string, vars?: Vars): string {
  if (current === 'es' || !dictionaries[current]) return fill(text, vars);
  const translated = lookup(text);
  if (translated === undefined && import.meta.env.DEV) console.warn('[idioma] sin traducir:', text);
  return fill(translated ?? text, vars);
}

/**
 * Como `tr`, para las palabras con dos sentidos: «Media» es *Medium* como
 * importancia y *Mean* como promedio; «Mañana», *Tomorrow* o *Morning*. La
 * clave inglesa es `contexto|texto`; en español sale el texto tal cual.
 */
export function trc(context: string, text: string, vars?: Vars): string {
  if (current === 'es' || !dictionaries[current]) return fill(text, vars);
  const translated = lookup(`${context}|${text}`) ?? lookup(text);
  if (translated === undefined && import.meta.env.DEV) console.warn('[idioma] sin traducir:', `${context}|${text}`);
  return fill(translated ?? text, vars);
}

/**
 * El mismo texto en varios idiomas, para lo que se GUARDA ya escrito (el
 * historial de la campana): así un aviso de ayer se lee en el idioma de hoy.
 * Siempre en español e inglés, y además en el idioma actual si es otro.
 * `build` debe ser síncrona y solo construir textos. Si el diccionario inglés
 * aún no estaba cargado, se carga para la próxima vez.
 */
export function inBothLangs<T>(build: () => T): Partial<Record<Lang, T>> {
  const previous = current;
  const out: Partial<Record<Lang, T>> = {};
  const langs: Lang[] = ['es', 'en'];
  if (!isClassicLang(previous)) langs.push(previous);
  try {
    for (const lang of langs) {
      if (lang !== 'es' && !dictionaries[lang]) continue;
      current = lang;
      out[lang] = build();
    }
  } finally {
    current = previous;
  }
  if (!dictionaries.en) void loadDictionary('en').catch(() => undefined);
  return out;
}

/** De lo guardado en varios idiomas, lo del actual; si no está, inglés y si no, español. */
export function pickLang<T>(texts: Partial<Record<Lang, T>> | undefined): T | undefined {
  if (!texts) return undefined;
  return texts[current] ?? (current === 'es' ? undefined : texts.en) ?? texts.es;
}

/**
 * El texto de un error, listo para mostrarlo. Los mensajes propios de Frame
 * salen en el idioma de la interfaz, también los que llegan del núcleo nativo
 * con la forma «Prefijo: detalle» (el diccionario guarda «Prefijo: {e}»). Lo
 * que escribe otro (el sistema, Google, el servidor) se muestra tal cual.
 */
export function errorText(error: unknown): string {
  const raw = String((error as { message?: unknown } | null)?.message ?? error ?? '');
  if (current === 'es' || !dictionaries[current]) return raw;
  const whole = lookup(raw);
  if (whole !== undefined) return whole;
  const colon = raw.indexOf(': ');
  if (colon > 0) {
    const pattern = lookup(`${raw.slice(0, colon)}: {e}`);
    if (pattern !== undefined) return fill(pattern, { e: raw.slice(colon + 2) });
  }
  return raw;
}

/** «a, b y c» / «a, b and c»: una lista en el idioma de la interfaz. */
export function listText(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return tr('{list} y {last}', { list: items.slice(0, -1).join(', '), last: items[items.length - 1] });
}

/** Un texto traducido que va dentro de una frase («Alta» → «alta»). Baja solo
 *  la primera letra: `toLowerCase()` entero rompería los sustantivos alemanes
 *  («in 3 tagen»). Con `noun`, en alemán lo deja igual («Abend» sigue «Abend»). */
export function lowerFirst(text: string, noun = false): string {
  if (!text || (noun && current === 'de')) return text;
  return text.charAt(0).toLocaleLowerCase(INTL_LOCALES[current]) + text.slice(1);
}

/** Locale de date-fns para el idioma actual. SOLO para dar formato a fechas:
 *  los cálculos de semanas siguen con `es` (la semana de Frame empieza en
 *  lunes; con `enUS` empezaría en domingo y moverían las métricas). */
export const dateLocale = (): Locale => DATE_LOCALES[current] ?? es;

const DATE_LOCALES: Partial<Record<Lang, Locale>> = { es };
const INTL_LOCALES: Record<Lang, string> = { es: 'es-PE', en: 'en-US', de: 'de-DE', fr: 'fr-FR', it: 'it-IT', pt: 'pt-BR', ru: 'ru-RU', ja: 'ja-JP' };

/** Etiqueta BCP 47 para `toLocaleString` e `Intl`. */
export const intlLocale = (): string => INTL_LOCALES[current];

/** Número con decimales fijos: coma en español (como siempre en Frame) y en
 *  los idiomas que la usan; punto en inglés y japonés. */
export const decimalText = (value: number, digits = 1): string => {
  const text = value.toFixed(digits);
  return current === 'en' || current === 'ja' ? text : text.replace('.', ',');
};
