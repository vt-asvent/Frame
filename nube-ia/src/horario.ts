// Inicio → Horario (Frame 1.9.0): lee las clases de la foto de un horario.
//
// La app manda la foto (JPEG de 1600 px como mucho, en base64) con su sesión
// de Frame. Aquí se le pasa a Gemma 4 en Workers AI —modelo abierto (Apache
// 2.0), sin retención de datos y dentro de la cuota gratuita de Cloudflare— y
// se devuelve { classes: [{ day, start, end, subject, room?, teacher? }] }, que
// la app limpia y une por bloques antes de guardarlo.
//
// La foto no se guarda en ninguna parte. De cada cuenta solo se cuenta cuántas
// lee al día (D1, `lecturas`), para que nadie agote la cuota de los demás.
// Errores: 400 imagen no válida · 429 cupo de la cuenta (`quota`) o de todo
// Frame (`daily`) agotado · 503 la IA no respondió (`busy`).
import { type Env, json } from './util';

export const MODEL = '@cf/google/gemma-4-26b-a4b-it';
export const DAILY_LIMIT = 12;
const MAX_IMAGE = 4_000_000;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SCHEMA = {
  type: 'object',
  properties: {
    classes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          day: { type: 'integer' },
          start: { type: 'string' },
          end: { type: 'string' },
          subject: { type: 'string' },
          room: { type: 'string' },
          teacher: { type: 'string' },
          kind: { type: 'string', enum: ['class', 'break'] },
        },
        required: ['day', 'start', 'end', 'subject', 'kind'],
      },
    },
  },
  required: ['classes'],
};

const PROMPT = `You read school timetables. The image is a student's weekly timetable (a photo, a screenshot or a table, in any language).
Return EVERY class of the week:
- day: 1 Monday, 2 Tuesday, 3 Wednesday, 4 Thursday, 5 Friday, 6 Saturday, 7 Sunday. Map the column (or row) headers to these numbers, whatever their language or abbreviation.
- start and end: 24-hour HH:MM. Take them from the time column or row of the table (convert 1:00 pm to 13:00). If only period numbers are shown, use the times printed for those periods.
- A cell that spans several rows or columns is ONE class covering that whole range.
- subject: the subject name as written, in its original language, with normal capitalisation. Do not translate. Expand an abbreviation only if the image itself makes it obvious.
- room and teacher: only if they are written for that class.
- Breaks, recess, lunch, free periods and empty cells: kind "break". Never invent classes for empty cells.
Be exhaustive and precise: check every day and every time slot before answering.
Answer only with JSON: {"classes":[{"day":1,"start":"08:00","end":"09:30","subject":"…","room":"…","teacher":"…","kind":"class"}]}`;

/** El texto (o el objeto) que devolvió el modelo, venga en el formato que venga. */
function answerOf(out: unknown): unknown {
  const o = out as { response?: unknown; choices?: { message?: { content?: unknown } }[] } | null;
  return o?.choices?.[0]?.message?.content ?? o?.response ?? null;
}

export function classesOf(out: unknown): Record<string, unknown>[] | null {
  let value = answerOf(out);
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value.slice(value.indexOf('{'), value.lastIndexOf('}') + 1));
    } catch {
      return null;
    }
  }
  const list = (value as { classes?: unknown } | null)?.classes;
  if (!Array.isArray(list)) return null;
  return list
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && (item as { kind?: unknown }).kind !== 'break')
    .slice(0, 200)
    .map(({ day, start, end, subject, room, teacher }) => ({ day, start, end, subject, room, teacher }));
}

export async function readTimetable(req: Request, env: Env, owner: string): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { image?: unknown; mime?: unknown } | null;
  const image = typeof body?.image === 'string' ? body.image : '';
  const mime = typeof body?.mime === 'string' ? body.mime : '';
  // Solo el comienzo: revisar 1 MB de base64 gastaría el CPU del plan gratis.
  if (image.length < 100 || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/]+$/.test(image.slice(0, 100)) || !TYPES.includes(mime)) {
    return json({ error: 'image' }, 400);
  }

  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare('INSERT INTO lecturas (owner, day, n) VALUES (?, ?, 1) ON CONFLICT (owner, day) DO UPDATE SET n = n + 1 RETURNING n')
    .bind(owner, day)
    .first<number>('n');
  if ((used ?? 0) > DAILY_LIMIT) return json({ error: 'quota', limit: DAILY_LIMIT }, 429);
  const refund = () => env.DB.prepare('UPDATE lecturas SET n = n - 1 WHERE owner = ? AND day = ?').bind(owner, day).run();

  let out: unknown;
  try {
    out = await env.AI.run(MODEL, {
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
      max_completion_tokens: 4096,
    });
  } catch (e) {
    await refund();
    const why = String(e).slice(0, 200);
    console.error('horario', why);
    // La cuota gratuita de Cloudflare es de todo Frame y vuelve cada día.
    return /neuron|allocation|3036|4006/i.test(why) ? json({ error: 'daily' }, 429) : json({ error: 'busy' }, 503);
  }
  const classes = classesOf(out);
  if (!classes) {
    await refund();
    return json({ error: 'busy' }, 503);
  }
  return json({ classes });
}
