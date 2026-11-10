import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { NUBE, nubeFetch } from '@/lib/nube';
import { deleteImage, getImage, saveImage } from '@/lib/music-db';
import { tr, useLang } from '@/lib/i18n';
import type { SongLyrics } from '@/lib/lyrics';

// ============================================================
// Música → letra → «Traducción» (1.9.2): la letra de la canción que suena,
// en el idioma de Frame, debajo de cada línea. La traduce la nube de Frame
// (nube-ia, POST /app/traducir: Gemma 4, con un cupo diario por cuenta) y la
// traducción se queda en este equipo: cada letra se pide una sola vez. Los
// coros repetidos van una sola vez, y lo que ya está en el idioma de Frame no
// se muestra dos veces.
//
// El cupo es corto y la IA es de todos, así que no se pide de más:
//   · una letra que ya está en el idioma de Frame no se manda (se reconoce
//     aquí, por sus palabras más comunes o su escritura);
//   · se espera un momento con la letra en pantalla: pasar canciones deprisa
//     no gasta nada;
//   · lo que falló no se vuelve a pedir enseguida, y agotado el cupo del día
//     no se pide más hasta mañana.
//
// Las traducciones van con lo demás de Música (IndexedDB), no en
// localStorage: allí solo queda el índice, para soltar las más viejas.
// ============================================================

const INDEX = 'frameLyricsTranslations';
const STORE_PREFIX = 'lyricsTr_';
const PREF = 'frameLyricsTranslate';
const BLOCK = 'frameLyricsTranslateBlock';
const MAX_SONGS = 200;
/** Lo que admite un pedido (nube-ia/src/letras.ts). */
const MAX_LINES = 150;
const MAX_CHARS = 6000;
/** Con la letra este rato en pantalla, se pide su traducción. */
const SETTLE_MS = 1200;

export type TranslationState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'done'; map: Map<string, string> }
  /** Ya está en el idioma de Frame. */
  | { status: 'same' }
  | { status: 'error'; message: string };

/** Las líneas distintas con texto (sin vacías, «♪» ni repetidas). */
function lyricLines(lyrics: SongLyrics | null): string[] {
  if (!lyrics || lyrics.missing || lyrics.instrumental) return [];
  const source = lyrics.synced.length > 0 ? lyrics.synced.map((line) => line.text) : lyrics.plain.split(/\r?\n/);
  const seen = new Set<string>();
  let chars = 0;
  for (const raw of source) {
    const line = raw.trim();
    if (!line || seen.has(line) || !/\p{L}/u.test(line) || line.length > 300) continue;
    if (seen.size >= MAX_LINES || chars + line.length > MAX_CHARS) break;
    seen.add(line);
    chars += line.length;
  }
  return [...seen];
}

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

// ------------------------------------------------------------
// ¿La letra ya está en el idioma de Frame?
// ------------------------------------------------------------

/**
 * Las palabras más repetidas de cada idioma (artículos, pronombres, verbos
 * auxiliares…). Lo que cuenta es cuántas de la letra son del idioma y cuántas
 * solo son de otro; por eso cada lista lleva también las que su idioma
 * comparte con los demás («no», «me», «a») y las suyas que en otro son una de
 * estas («son», «sin», «come» en inglés; «ti», «has», «mes» en español). Se
 * comparan sin tildes: una letra en español puede venir escrita sin ellas.
 */
const COMMON: Record<string, string> = {
  es:
    'el los las un una unos de del al a y e que en no se me te ti lo le les mi tu su mis tus sus mío mía tuyo tuya yo tú él ella nos os es son soy ' +
    'eres está estoy estás he has han hay por para con sin pero mas más muy ya si como cuando donde porque qué cómo quién todo nada algo esto eso ' +
    'este esta ese esa aquí ahora hoy siempre nunca también solo bien ser tengo tienes tiene quiero quieres puedo sé voy vas va fue era conmigo ' +
    'contigo ni hasta desde sobre dos tres mes',
  en:
    'the a an and or but as i you he she it we they me my your his her its our their im youre dont cant wont ill ive is are was were be been am do ' +
    'does did have has had will would can could to of in on at for with from by that this these those what when where why how who all no not so ' +
    'if just now never ever up out down know got get go come em die man war son sin solo plus pour ate',
  pt:
    'a os as um uma de do dos das no nos nas em e ou que não se me te eu você ele ela nós meu minha seu sua é são sou está estou tem ' +
    'tenho por para pra com sem mas mais muito já como quando onde porque tudo nada isso esse essa aqui agora hoje sempre nunca também só bem ' +
    'vou vai foi era quero posso sei comigo contigo nem até',
  fr:
    'le les un une des de au aux et ou que qui ne pas je tu il elle on nous vous ils me te se mon ma mes ton tes son sa ses ce cette ' +
    'ces est suis es sont ai as a dans en sur pour par avec sans mais plus très si comme quand où tout rien ça ici toujours jamais aussi bien ' +
    'moi toi lui y cest jai',
  it:
    'il lo i gli le un una di del della dei a al in con su per e che non mi ti si ci io tu lui lei noi voi loro mio mia tuo tua suo sua ' +
    'è sono sei siamo hai ma più molto già se come quando dove perché tutto niente questo questa qui ora oggi sempre mai anche solo bene ' +
    'nel nella',
  de:
    'der die das den dem des ein eine einen und oder aber ich er sie es wir ihr mich dich mir dir mein dein sein nicht kein ist bin bist ' +
    'sind war hat habe hast zu in im an am auf mit für von bei nach aus was wie wenn wer so nur noch schon auch immer nie hier jetzt will man',
};

/** Lo que se canta sin decir nada (y lo que tanto puede ser eso como una palabra): no cuenta para ningún idioma. */
const SOUNDS = new Set('na la da o oh ooh oooh yeah yea ye yeh eh ey hey ay ah aah uh mm mmm hmm woah whoa wo oo ha ho pa ra ta sha du doo ba bum uoh'.split(' '));

const plain = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

const WORDS = new Map(Object.entries(COMMON).map(([lang, words]) => [lang, new Set(plain(words).split(' '))]));

/**
 * ¿La letra está, entera, en el idioma `lang`? Solo dice que sí con margen:
 * ante la duda (una letra corta, o con partes en otro idioma) se pide la
 * traducción, que deja como están las líneas que no la necesitan.
 */
export function sameLanguage(lang: string, lines: string[]): boolean {
  const text = lines.join('\n').toLowerCase();
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 40) return false;
  const share = (pattern: RegExp) => letters.filter((letter) => pattern.test(letter)).length / letters.length;
  if (lang === 'ja') {
    // El kana solo es del japonés (el chino no lo tiene).
    const kana = lines.filter((line) => /[぀-ヿ]/.test(line)).length / lines.length;
    return kana >= 0.6 && share(/[぀-ヿ㐀-鿿]/) >= 0.7;
  }
  if (lang === 'ru') {
    // Cirílico, con letras del ruso y sin las de otros idiomas que lo usan.
    return share(/[Ѐ-ӿ]/) >= 0.85 && /[ыэ]/.test(text) && !/[іїєґјљњћђџў]/.test(text);
  }
  const mine = WORDS.get(lang);
  if (!mine || share(/[a-zÀ-ɏ]/) < 0.9) return false;
  const words = (plain(text).replace(/['’‘`´]/g, '').match(/\p{L}+/gu) ?? []).filter((word) => !SOUNDS.has(word));
  if (words.length < 25) return false;
  let own = 0;
  let foreign = 0;
  for (const word of words) {
    if (mine.has(word)) own += 1;
    else if ([...WORDS].some(([other, set]) => other !== lang && set.has(word))) foreign += 1;
  }
  return own / words.length >= 0.2 && foreign / words.length <= 0.03;
}

// ------------------------------------------------------------
// Lo guardado en este equipo
// ------------------------------------------------------------

type Pairs = [string, string][];

/** El índice de lo guardado (localStorage): clave → cuándo se usó por última vez. */
function readIndex(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(INDEX) ?? '{}') as Record<string, unknown> | null;
    if (!value || typeof value !== 'object') return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
  } catch {
    return {};
  }
}

function touch(key: string) {
  const index = readIndex();
  index[key] = Date.now();
  // Las más recientes; las demás se vuelven a pedir si hace falta.
  for (const old of Object.keys(index).sort((a, b) => index[b] - index[a]).slice(MAX_SONGS)) {
    delete index[old];
    void deleteImage(STORE_PREFIX + old).catch(() => undefined);
  }
  try {
    localStorage.setItem(INDEX, JSON.stringify(index));
  } catch {
    /* sin espacio para el índice: la traducción sigue guardada */
  }
}

async function stored(key: string): Promise<Pairs | null> {
  const raw = await getImage(STORE_PREFIX + key).catch(() => null);
  if (!raw) return null;
  try {
    const pairs = (JSON.parse(raw) as { pairs?: unknown } | null)?.pairs;
    if (!Array.isArray(pairs)) return null;
    return pairs.filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string');
  } catch {
    return null;
  }
}

async function remember(key: string, pairs: Pairs) {
  await saveImage(STORE_PREFIX + key, JSON.stringify({ pairs })).catch(() => undefined);
  touch(key);
}

// ------------------------------------------------------------
// Pedir
// ------------------------------------------------------------

type Failure = 'quota' | 'daily' | 'unusable' | 'busy' | 'offline' | 'session';

class TranslateError extends Error {
  constructor(
    readonly kind: Failure,
    message: string
  ) {
    super(message);
  }
}

/** Pedidos en curso: la misma letra no se pide dos veces a la vez. */
const inflight = new Map<string, Promise<{ from: string; lines: string[] }>>();
/** Letras que fallaron hace poco: hasta cuándo no se vuelven a pedir, y qué se dice. */
const failed = new Map<string, { until: number; message: string }>();

/** El día de la nube (UTC): su cupo se renueva al cambiar. */
const cloudDay = () => new Date().toISOString().slice(0, 10);

/** Cupo agotado (el de la cuenta o el de todo Frame): hoy ya no se pide más. */
function blockedToday(): string | null {
  try {
    const value = JSON.parse(localStorage.getItem(BLOCK) ?? 'null') as { day?: string; message?: string } | null;
    return value?.day === cloudDay() && typeof value.message === 'string' ? value.message : null;
  } catch {
    return null;
  }
}

function noteFailure(key: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const kind = error instanceof TranslateError ? error.kind : 'busy';
  if (kind === 'quota' || kind === 'daily') {
    try {
      localStorage.setItem(BLOCK, JSON.stringify({ day: cloudDay(), message }));
    } catch {
      /* sin guardar: se sabrá otra vez al siguiente intento */
    }
  } else if (kind === 'unusable') {
    // La IA no supo con esta letra: otro intento gastaría cupo para lo mismo.
    failed.set(key, { until: Date.now() + 6 * 3600_000, message });
  } else if (kind === 'busy') {
    failed.set(key, { until: Date.now() + 2 * 60_000, message });
  }
  return message;
}

async function request(lines: string[], to: string): Promise<{ from: string; lines: string[] }> {
  const offline = () => new TranslateError('offline', tr('Sin conexión: la traducción necesita internet.'));
  const supabase = getSupabase();
  if (!supabase || !navigator.onLine) throw offline();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new TranslateError('session', tr('Entra con tu cuenta para traducir letras.'));
  const resp = await nubeFetch(`${NUBE}/app/traducir`, {
    method: 'POST',
    headers: { authorization: `Bearer ${data.session.access_token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ lines, to }),
  }).catch(() => null);
  // La red se cortó (o no contestó en su plazo): se dice así, no con el error del navegador.
  if (!resp) throw offline();
  const body = (await resp.json().catch(() => null)) as { lines?: unknown; from?: unknown; error?: string; limit?: number } | null;
  if (resp.ok && Array.isArray(body?.lines)) {
    return { from: typeof body.from === 'string' ? body.from : '', lines: body.lines.map((line) => (typeof line === 'string' ? line : '')) };
  }
  if (resp.status === 429 && body?.error === 'quota') {
    throw new TranslateError('quota', tr('Ya tradujiste {count} letras hoy. Mañana puedes seguir.', { count: body.limit ?? 30 }));
  }
  if (resp.status === 429) throw new TranslateError('daily', tr('La traducción descansa por hoy. Vuelve a intentarlo mañana.'));
  if (resp.status === 401) throw new TranslateError('session', tr('Tu sesión venció: vuelve a entrar para traducir letras.'));
  if (body?.error === 'unusable') throw new TranslateError('unusable', tr('No se pudo traducir esta letra.'));
  throw new TranslateError('busy', tr('No se pudo traducir la letra ahora. Inténtalo de nuevo.'));
}

/**
 * Sigue la traducción de unas líneas al idioma `lang`: avisa de cada estado
 * (cargando, hecha, ya en ese idioma, error) y devuelve cómo dejar de seguirla
 * (al cambiar de canción antes de tiempo, lo que no se llegó a pedir no se pide).
 */
export function watchTranslation(lines: string[], lang: string, onState: (state: TranslationState) => void): () => void {
  if (lines.length === 0) {
    onState({ status: 'off' });
    return () => undefined;
  }
  if (sameLanguage(lang, lines)) {
    onState({ status: 'same' });
    return () => undefined;
  }
  const joined = lines.join('\n');
  // (Por la letra, no por la canción: la misma letra en otra copia no se vuelve a pedir.)
  const key = `${lang}_${hash(joined)}_${joined.length.toString(36)}`;
  const shown = (pairs: Pairs): TranslationState => (pairs.length > 0 ? { status: 'done', map: new Map(pairs) } : { status: 'same' });
  let alive = true;
  let timer = 0;
  onState({ status: 'loading' });
  void stored(key).then((cached) => {
    if (!alive) return;
    if (cached) {
      touch(key);
      onState(shown(cached));
      return;
    }
    const recent = failed.get(key);
    const stop = blockedToday() ?? (recent && recent.until > Date.now() ? recent.message : null);
    if (stop) {
      onState({ status: 'error', message: stop });
      return;
    }
    timer = window.setTimeout(() => {
      // (Otra vista de la misma letra pudo traerla mientras esta esperaba.)
      void stored(key).then((late) => {
        if (!alive) return;
        if (late) {
          onState(shown(late));
          return;
        }
        let pending = inflight.get(key);
        if (!pending) {
          pending = request(lines, lang).finally(() => inflight.delete(key));
          inflight.set(key, pending);
        }
        pending
          .then((result) => {
            // Si la IA dice que ya estaba en este idioma, lo que devuelva son retoques, no una traducción.
            const pairs: Pairs =
              result.from === lang
                ? []
                : lines
                    .map((line, i) => [line, (result.lines[i] ?? '').trim()] as [string, string])
                    .filter(([line, text]) => text && text.toLowerCase() !== line.toLowerCase());
            void remember(key, pairs);
            if (alive) onState(shown(pairs));
          })
          .catch((error: unknown) => {
            const message = noteFailure(key, error);
            if (alive) onState({ status: 'error', message });
          });
      });
    }, SETTLE_MS);
  });
  return () => {
    alive = false;
    window.clearTimeout(timer);
  };
}

/**
 * La traducción de la letra que se ve (pedida solo con `enabled`). `lyrics`
 * tiene que ser la de `songId`: al cambiar de canción, null hasta que llegue
 * la suya (si no, se pediría la traducción de la letra anterior).
 */
export function useLyricsTranslation(songId: string | null | undefined, lyrics: SongLyrics | null, enabled: boolean): TranslationState {
  const lang = useLang();
  const [state, setState] = useState<TranslationState>({ status: 'off' });
  // Las líneas como texto: mover el ajuste de tiempos no vuelve a pedir nada.
  const joined = useMemo(() => lyricLines(lyrics).join('\n'), [lyrics]);

  useEffect(() => {
    if (!enabled || !songId || !joined) {
      setState({ status: 'off' });
      return;
    }
    return watchTranslation(joined.split('\n'), lang, setState);
  }, [songId, joined, enabled, lang]);

  return state;
}

/** ¿Se quiere ver la traducción? (Se recuerda en este equipo.) */
export function translationWanted(): boolean {
  try {
    return localStorage.getItem(PREF) === '1';
  } catch {
    return false;
  }
}

export function setTranslationWanted(on: boolean) {
  try {
    localStorage.setItem(PREF, on ? '1' : '0');
  } catch {
    /* sin guardar la preferencia */
  }
}
