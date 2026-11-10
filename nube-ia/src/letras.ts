// Música → letra → «Traducción» (Frame 1.9.2): la letra de la canción que
// suena, en el idioma de Frame. La traduce Gemma 4, el modelo barato de
// horario.ts, línea por línea: vuelven tantas líneas como llegaron, en el
// mismo orden, con el idioma original ({ from, lines }).
//
// Una letra larga se traduce por partes (como mucho 60 líneas o 2500
// caracteres cada una): así la respuesta siempre cabe en lo que el modelo
// puede escribir de una vez, también en ruso o japonés, y una letra de 150
// líneas no falla en cada intento por quedarse a medias.
//
// La letra no se guarda aquí: la app guarda la traducción en el equipo. De
// cada cuenta solo se cuenta cuántas traduce al día (D1, `traducciones`), y
// no se traduce si el gasto del día de todo Frame pasa de `TRANSLATE_UNTIL`:
// lo que queda de la cuota gratuita es para leer horarios, y con margen para
// que los lea Qwen, que es el que mejor lee fotos.
// Errores: 400 letra no válida · 429 cupo de la cuenta (`quota`) o de todo
// Frame (`daily`) · 503 la IA no respondió (`busy`) · 422 respondió, pero no
// con una traducción que sirva (`unusable`: repetir el pedido daría lo mismo).
import { answerOf, FALLBACK, QWEN_UNTIL } from './horario';
import { type Env, json } from './util';

export const TRANSLATE_LIMIT = 30;
/**
 * Con más gasto del día que esto, no se traduce. Queda por debajo de donde
 * Qwen deja de leer horarios (`QWEN_UNTIL` menos su reserva), con sitio para
 * varias lecturas suyas: traducir letras no le quita el buen lector a nadie.
 */
export const TRANSLATE_UNTIL = QWEN_UNTIL - 3_000;
/** Lo que se anota por cada parte si la respuesta no dice cuántas neuronas gastó. */
const COST = 15;
const MAX_LINES = 150;
const MAX_LINE = 300;
const MAX_CHARS = 6_000;
/** Lo que se le pide al modelo de una vez. */
const PART_LINES = 60;
const PART_CHARS = 2_500;

const LANGS: Record<string, string> = {
  es: 'Spanish',
  en: 'English',
  de: 'German',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  pt: 'Portuguese',
  ru: 'Russian',
};

const SCHEMA = {
  type: 'object',
  properties: {
    from: { type: 'string' },
    lines: {
      type: 'array',
      items: { type: 'object', properties: { n: { type: 'integer' }, text: { type: 'string' } }, required: ['n', 'text'] },
    },
  },
  required: ['from', 'lines'],
};

/** Lo que se pueda leer de una respuesta cortada a medias: las líneas que llegaron enteras. */
function salvage(text: string): { from?: string; lines: { n: number; text: string }[] } | null {
  const lines: { n: number; text: string }[] = [];
  for (const match of text.matchAll(/\{\s*"n"\s*:\s*(\d{1,3})\s*,\s*"text"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g)) {
    try {
      lines.push({ n: Number(match[1]), text: JSON.parse(match[2] ?? '""') as string });
    } catch {
      /* una línea ilegible no estropea las demás */
    }
  }
  if (lines.length === 0) return null;
  return { from: text.match(/"from"\s*:\s*"([A-Za-z]{2})"/)?.[1], lines };
}

/**
 * La traducción que devolvió el modelo, alineada por el número de cada línea
 * (si se salta o repite alguna, no se descuadra el resto). null si faltan
 * más de una de cada cinco.
 */
export function translationOf(out: unknown, count: number): { from: string; lines: string[] } | null {
  let value = answerOf(out);
  if (typeof value === 'string') {
    const text = value;
    try {
      value = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch {
      value = salvage(text);
    }
  }
  const v = value as { from?: unknown; lines?: unknown } | null;
  if (!v || !Array.isArray(v.lines)) return null;
  const lines: string[] = Array(count).fill('');
  v.lines.forEach((item, i) => {
    // { n, text } como pide el esquema; o, si vino una lista de textos, por su orden.
    const n = typeof item === 'string' ? i + 1 : Math.trunc(Number((item as { n?: unknown } | null)?.n));
    const text = typeof item === 'string' ? item : (item as { text?: unknown } | null)?.text;
    if (n >= 1 && n <= count && typeof text === 'string' && !lines[n - 1]) lines[n - 1] = text.replace(/^\s*\d{1,3}[.)]\s+/, '').trim().slice(0, 600);
  });
  if (lines.filter(Boolean).length < count * 0.8) return null;
  const from = typeof v.from === 'string' && /^[a-z]{2}$/i.test(v.from.trim()) ? v.from.trim().toLowerCase() : '';
  return { from, lines };
}

/** La letra en partes que el modelo traduce de una vez, sin partir ninguna línea. */
export function partsOf(lines: string[]): string[][] {
  const parts: string[][] = [];
  let part: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (part.length > 0 && (part.length >= PART_LINES || chars + line.length > PART_CHARS)) {
      parts.push(part);
      part = [];
      chars = 0;
    }
    part.push(line);
    chars += line.length;
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

export async function translateLyrics(req: Request, env: Env, owner: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { lines?: unknown; to?: unknown } | null;
  const to = typeof body?.to === 'string' && LANGS[body.to] ? body.to : '';
  const given: unknown[] = Array.isArray(body?.lines) ? body.lines : [];
  const valid =
    !!to &&
    given.length > 0 &&
    given.length <= MAX_LINES &&
    given.every((line) => typeof line === 'string' && line.trim() !== '' && line.length <= MAX_LINE) &&
    given.join('').length <= MAX_CHARS;
  if (!valid) return json({ error: 'lines' }, 400);
  const lines = given as string[];

  const day = new Date().toISOString().slice(0, 10);
  const spent = (await env.DB.prepare('SELECT n FROM neuronas WHERE day = ?').bind(day).first<number>('n')) ?? 0;
  if (spent >= TRANSLATE_UNTIL) return json({ error: 'daily' }, 429);
  const used = await env.DB.prepare('INSERT INTO traducciones (owner, day, n) VALUES (?, ?, 1) ON CONFLICT (owner, day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(owner, day)
    .first<number>('n');
  if ((used ?? 0) > TRANSLATE_LIMIT) return json({ error: 'quota', limit: TRANSLATE_LIMIT }, 429);

  const language = LANGS[to];
  const translatePart = (part: string[]) =>
    env.AI.run(FALLBACK, {
      messages: [
        {
          role: 'user',
          content:
            `Translate these song lyrics into ${language}, line by line: a natural, faithful translation that keeps the meaning and the tone, not word for word. ` +
            `In "lines", one {"n", "text"} for each of the ${part.length} numbered lines: n is its number and text its translation. A line already in ${language}, or made only of sounds or names, stays as it is. ` +
            `In "from", the ISO 639-1 code of the language most of the lyrics are in.\n\n` +
            part.map((line, i) => `${i + 1}. ${line}`).join('\n'),
        },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'lyrics', schema: SCHEMA } },
      chat_template_kwargs: { enable_thinking: false },
      temperature: 0.2,
      max_completion_tokens: 4000,
    });

  const parts = partsOf(lines);
  const outs = await Promise.allSettled(parts.map(translatePart));
  // Lo que el modelo llegó a trabajar se anota, falle o no alguna parte.
  const worked = outs.filter((out): out is PromiseFulfilledResult<unknown> => out.status === 'fulfilled');
  if (worked.length > 0) {
    const neurons = worked.reduce((sum, out) => {
      const n = Number((out.value as { usage?: { neurons?: unknown } } | null)?.usage?.neurons);
      return sum + (Number.isFinite(n) && n > 0 ? n : COST);
    }, 0);
    await env.DB.prepare('INSERT INTO neuronas (day, n) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n').bind(day, neurons).run();
  }
  const failure = outs.find((out): out is PromiseRejectedResult => out.status === 'rejected');
  if (failure) {
    const why = String(failure.reason).slice(0, 200);
    console.error('letras', why);
    // Sin la traducción entera no hay traducción: no se le cuenta a nadie.
    await env.DB.prepare('UPDATE traducciones SET n = n - 1 WHERE owner = ? AND day = ?').bind(owner, day).run();
    return /neuron|allocation|3036|4006/i.test(why) ? json({ error: 'daily' }, 429) : json({ error: 'busy' }, 503);
  }

  const translated: string[] = [];
  const origins = new Map<string, number>();
  for (const [i, part] of parts.entries()) {
    const result = translationOf(worked[i]?.value, part.length);
    // El modelo trabajó, pero lo que devolvió no sirve: otro intento daría lo mismo.
    if (!result) return json({ error: 'unusable' }, 422);
    translated.push(...result.lines);
    if (result.from) origins.set(result.from, (origins.get(result.from) ?? 0) + part.length);
  }
  // El idioma de la letra: el de la mayoría de sus líneas.
  const from = [...origins].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  return json({ from, lines: translated });
}
