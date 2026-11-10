// Inicio → Horario (Frame 1.9.0): lee las clases de la foto de un horario.
//
// La app manda la foto (JPEG de 1600 px como mucho, en base64) con su sesión
// de Frame. Aquí la lee un modelo abierto (Apache 2.0) de Workers AI, sin
// retención de datos y dentro de la cuota gratuita de Cloudflare (10 000
// neuronas al día): Qwen 3.8, el que mejor lee fotos (1.9.1), mientras el gasto
// del día deja margen; si no, o si Qwen falla, Gemma 4, unas 15 veces más
// barato. Los dos leen la tabla franja por franja (en fotos torcidas acierta
// mucho más que pedir la lista de clases) y se devuelve
// { classes: [{ day, start, end, subject, room?, teacher? }] }, que la app
// limpia y une por bloques antes de guardarlo.
//
// Con la foto pueden llegar los NOMBRES de las asignaturas que el estudiante
// tiene en Frame (1.9.4). Entonces, tras leer la tabla, Gemma 4 (ya sin la
// foto: solo texto, unas 6 neuronas; Qwen de respaldo) dice a cuál corresponde cada
// nombre del horario («Mat. AyE» → «Matemática», «TOK» → «Teoría del
// Conocimiento»), y vuelve además { links: { "<como en el horario>": "<asignatura>" } }.
// Si ese paso falla, las clases vuelven igual, sin vínculos.
//
// La foto no se guarda en ninguna parte. De cada cuenta solo se cuenta cuántas
// lee al día (D1, `lecturas`), para que nadie agote la cuota de los demás, y
// de todo Frame, cuántas neuronas se gastan al día (`neuronas`).
// Errores: 400 imagen no válida · 429 cupo de la cuenta (`quota`) o de todo
// Frame (`daily`) agotado · 503 la IA no respondió (`busy`).
import { type Env, json } from './util';

export const MODEL = '@cf/qwen/qwen3.8-27b';
export const FALLBACK = '@cf/google/gemma-4-26b-a4b-it';
export const DAILY_LIMIT = 6;
/** Qwen solo mientras lo gastado hoy más una lectura grande (~1000) quepa aquí; el resto de la cuota queda para Gemma. */
export const QWEN_UNTIL = 8_000;
const QWEN_RESERVE = 1_000;
/** Lo que se anota si la respuesta no dice cuántas neuronas gastó. */
const COST: Record<string, number> = { [MODEL]: 450, [FALLBACK]: 40 };
/** Lo mismo para el paso que vincula los nombres (solo texto). */
const LINK_COST = 10;
const MAX_IMAGE = 4_000_000;

/** Los primeros bytes de la foto dicen si de verdad es del tipo que declara. */
const MAGIC = new Map<string, (b: number[]) => boolean>([
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/webp', (b) => String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP'],
]);

function isImage(image: string, mime: string): boolean {
  const check = MAGIC.get(mime);
  if (!check) return false;
  try {
    return check([...atob(image.slice(0, 16))].map((c) => c.charCodeAt(0)));
  } catch {
    return false;
  }
}

export const SCHEMA = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string' },
          end: { type: 'string' },
          kind: { type: 'string', enum: ['class', 'break'] },
          cells: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                day: { type: 'integer' },
                subject: { type: 'string' },
                room: { type: 'string' },
                teacher: { type: 'string' },
                span: { type: 'integer' },
              },
              required: ['day', 'subject', 'span'],
            },
          },
        },
        required: ['start', 'end', 'kind', 'cells'],
      },
    },
  },
  required: ['slots'],
};

export const PROMPT = `You read school timetables. The image is a student's weekly timetable (a photo, a screenshot or a table, in any language).
Read it TIME SLOT BY TIME SLOT, in order, following the time column (or the period column; if the times run across the top, each column is a slot). For every time slot:
- start and end: 24-hour HH:MM, exactly as printed for that slot (convert 1:00 pm to 13:00). If only period numbers are shown, use the times printed for those periods. Keep break slots (recess, lunch) too, with kind "break".
- cells: the classes that START in this slot, one per day. day: 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday, 7 Sunday, mapped from the day headers whatever their language or abbreviation. subject: as written, in its original language, with normal capitalisation; do not translate. room and teacher: only if written in that cell. span: how many consecutive time slots the cell covers (1 if only this one; a merged cell that also covers the next two slots has span 3).
- Leave out a day whose cell in this slot is empty, or is covered by a merged cell that started in an earlier slot.
Be exhaustive and precise: check every slot and every day before answering.
Answer only with JSON: {"slots":[{"start":"08:00","end":"08:45","kind":"class","cells":[{"day":1,"subject":"…","room":"…","teacher":"…","span":1}]}]}`;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object';

/** El texto (o el objeto) que devolvió el modelo, venga en el formato que venga. */
export function answerOf(out: unknown): unknown {
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  return o?.choices?.[0]?.message?.content ?? o?.response ?? null;
}

/** Franjas → clases: cada celda empieza en su franja y acaba donde acaba la última que cubre. */
export function classesOf(out: unknown): Obj[] | null {
  let value = answerOf(out);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1));
    } catch {
      return null;
    }
  }
  const slots = isObj(value) ? value.slots : null;
  if (!Array.isArray(slots)) return null;
  const classes: Obj[] = [];
  slots.forEach((slot, i) => {
    if (!isObj(slot) || slot.kind === 'break' || !Array.isArray(slot.cells)) return;
    for (const cell of slot.cells) {
      if (!isObj(cell)) continue;
      const span = Math.min(Math.max(Math.trunc(Number(cell.span)) || 1, 1), slots.length - i);
      const last = slots[i + span - 1];
      classes.push({ day: cell.day, start: slot.start, end: isObj(last) ? last.end : slot.end, subject: cell.subject, room: cell.room, teacher: cell.teacher });
    }
  });
  return classes.slice(0, 200);
}

export const LINK_SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] },
    },
  },
  required: ['links'],
};

const numbered = (names: string[]) => names.map((name, i) => `${i}. ${JSON.stringify(name)}`).join('\n');

export const linkPrompt = (read: string[], own: string[]) => `A student's timetable names its classes as in list A. List B has the subjects the same student keeps in a study app.
For each name in A, find the subject in B that is the SAME school subject. It counts as the same when it is written differently, abbreviated ("Mat." is "Matemática"), an acronym ("TdC" or "TOK" is "Teoría del Conocimiento"), has a level, group, room or teacher added ("Física NM", "Historia 5B"), or is in another language ("English" is "Inglés").
A different subject is NOT the same, even if it shares a word ("Educación Física" is not "Física"; "Historia del Arte" is not "Historia") or is related to it (a research-skills class is not the extended essay; a homeroom or tutoring hour is no subject). Match only when it is the very same class under another spelling. When no subject in B is clearly the same, answer -1: a wrong match is worse than none.
Several names in A may share one subject in B.
A:
${numbered(read)}
B:
${numbered(own)}
Answer only with JSON, one entry per name in A: {"links":[{"a":0,"b":2},{"a":1,"b":-1}]}`;

const flat = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Los nombres de asignaturas que mandó la app: texto corto, sin repetidos, como mucho 60. */
export function subjectsOf(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Map<string, string>();
  for (const value of raw.slice(0, 200)) {
    if (typeof value !== 'string') continue;
    const name = value.replace(/\s+/g, ' ').trim().slice(0, 80);
    const key = flat(name);
    if (key && !seen.has(key)) seen.set(key, name);
    if (seen.size >= 60) break;
  }
  return [...seen.values()];
}

/** Respuesta del modelo → { nombre del horario: asignatura }, solo con índices que existen. */
export function linksOf(out: unknown, read: string[], own: string[]): Record<string, string> {
  let value = answerOf(out);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1));
    } catch {
      return {};
    }
  }
  const list = isObj(value) ? value.links : null;
  const links: Record<string, string> = {};
  if (!Array.isArray(list)) return links;
  for (const entry of list) {
    if (!isObj(entry)) continue;
    const a = Number(entry.a);
    const b = Number(entry.b);
    const from = Number.isInteger(a) ? read[a] : undefined;
    const to = Number.isInteger(b) ? own[b] : undefined;
    if (from !== undefined && to !== undefined) links[from] = to;
  }
  return links;
}

/**
 * A qué asignatura de Frame corresponde cada nombre leído. Los que se llaman
 * igual no pasan por el modelo. Nunca falla: sin respuesta, sin vínculos.
 */
async function linkSubjects(env: Env, day: string, models: string[], classes: Obj[], own: string[]): Promise<Record<string, string>> {
  const byName = new Map(own.map((name) => [flat(name), name] as const));
  const links: Record<string, string> = {};
  const read: string[] = [];
  for (const item of classes) {
    const subject = typeof item.subject === 'string' ? item.subject.replace(/\s+/g, ' ').trim().slice(0, 80) : '';
    if (!subject || subject in links || read.includes(subject)) continue;
    const same = byName.get(flat(subject));
    if (same) links[subject] = same;
    else if (read.length < 40) read.push(subject);
  }
  if (read.length === 0 || own.length === 0) return links;
  for (const model of models) {
    try {
      const out = await env.AI.run(model, {
        messages: [{ role: 'user', content: linkPrompt(read, own) }],
        response_format: { type: 'json_schema', json_schema: { name: 'links', schema: LINK_SCHEMA } },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0,
        max_completion_tokens: 900,
      });
      const neurons = Number((out as { usage?: { neurons?: unknown } } | null)?.usage?.neurons);
      await env.DB.prepare('INSERT INTO neuronas (day, n) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n')
        .bind(day, Number.isFinite(neurons) && neurons > 0 ? neurons : LINK_COST)
        .run();
      return { ...links, ...linksOf(out, read, own) };
    } catch (e) {
      console.error('horario vínculos', model, String(e).slice(0, 200));
    }
  }
  return links;
}

export async function readTimetable(req: Request, env: Env, owner: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { image?: unknown; mime?: unknown; subjects?: unknown } | null;
  const image = typeof body?.image === 'string' ? body.image : '';
  const mime = typeof body?.mime === 'string' ? body.mime : '';
  // Solo el comienzo: revisar 1 MB de base64 gastaría el CPU del plan gratis.
  if (image.length < 100 || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+$/.test(image.slice(0, 100)) || !isImage(image, mime)) {
    return json({ error: 'image' }, 400);
  }

  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare('INSERT INTO lecturas (owner, day, n) VALUES (?, ?, 1) ON CONFLICT (owner, day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(owner, day)
    .first<number>('n');
  if ((used ?? 0) > DAILY_LIMIT) return json({ error: 'quota', limit: DAILY_LIMIT }, 429);

  const spent = (await env.DB.prepare('SELECT n FROM neuronas WHERE day = ?').bind(day).first<number>('n')) ?? 0;
  const models = spent + QWEN_RESERVE <= QWEN_UNTIL ? [MODEL, FALLBACK] : [FALLBACK];
  for (const model of models) {
    let out: unknown;
    try {
      out = await env.AI.run(model, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${mime};base64,${image}` } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'timetable', schema: SCHEMA } },
        chat_template_kwargs: { enable_thinking: false },
        temperature: 0,
        max_completion_tokens: 6000,
      });
    } catch (e) {
      const why = String(e).slice(0, 200);
      console.error('horario', model, why);
      // La cuota gratuita de Cloudflare es de todo Frame y vuelve cada día. Si se
      // agotó, ningún modelo llega a trabajar: esa lectura no se le cuenta a nadie.
      if (/neuron|allocation|3036|4006/i.test(why)) {
        await env.DB.prepare('UPDATE lecturas SET n = n - 1 WHERE owner = ? AND day = ?').bind(owner, day).run();
        return json({ error: 'daily' }, 429);
      }
      continue;
    }
    const neurons = Number((out as { usage?: { neurons?: unknown } } | null)?.usage?.neurons);
    await env.DB.prepare('INSERT INTO neuronas (day, n) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET n = n + excluded.n')
      .bind(day, Number.isFinite(neurons) && neurons > 0 ? neurons : COST[model])
      .run();
    // Lo demás cuenta aunque no salga nada legible: si no, cualquiera usaría el
    // modelo sin límite enviando fotos que no son horarios.
    const classes = classesOf(out);
    if (classes) {
      const own = subjectsOf(body?.subjects);
      // El vínculo es solo texto: Gemma acierta igual que Qwen en las pruebas (30 de 30) y gasta diez veces menos.
      const links = own.length > 0 && classes.length > 0 ? await linkSubjects(env, day, [FALLBACK, MODEL], classes, own) : {};
      return json({ classes, links });
    }
  }
  return json({ error: 'busy' }, 503);
}
