// Frame · IA en la nube · arnés de pruebas: el Worker real en Miniflare (D1 en
// memoria y el relé con SQLite), un Supabase de mentira y Frames falsas que se
// conectan por WebSocket como la app.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
export const ORIGEN = 'http://frame-ia.prueba';
export const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
export const VERIFICADOR = 'verificador-de-pruebas-con-longitud-suficiente-1234567890';

/** «sb-<uuid>» es la sesión de Supabase de esa cuenta; lo demás no vale. */
export const sesion = (cuenta: string) => `sb-${cuenta}`;
export const ANA = '11111111-2222-4333-8444-555555555555';
export const LUIS = '99999999-8888-4777-8666-555555555555';
/** AK Lore: el colegio de prueba y sus correos (uno sin comprobar). */
export const COLEGIO = 'colegio.prueba';
export const ALUMNA = '22222222-3333-4444-8555-666666666666';
export const SIN_COMPROBAR = '33333333-4444-4555-8666-777777777777';
const CORREOS: Record<string, { email: string; email_confirmed_at: string | null }> = {
  [ALUMNA]: { email: `alumna@${COLEGIO}`, email_confirmed_at: '2026-01-01T00:00:00Z' },
  [SIN_COMPROBAR]: { email: `nuevo@${COLEGIO}`, email_confirmed_at: null },
  [LUIS]: { email: 'luis@otro.prueba', email_confirmed_at: '2026-01-01T00:00:00Z' },
};
/** Da correo comprobado a una cuenta de prueba (antes de su primera llamada: la sesión se recuerda un minuto). */
export const conCorreo = (cuenta: string, email: string) => {
  CORREOS[cuenta] = { email, email_confirmed_at: '2026-01-01T00:00:00Z' };
  return cuenta;
};
/**
 * Sesiones que el Supabase de mentira no resuelve como siempre (el final es la cuenta):
 * «supabase-caido-» contesta 503, «supabase-limite-» 429, «supabase-pasarela-» el 401 de la
 * pasarela (no de Auth), «supabase-sin-red-» ni contesta, «supabase-parpadea-» falla la
 * primera vez y luego responde, y «sesion-cerrada-» es el «no» de Auth a una sesión que ya
 * no existe. PREGUNTAS cuenta cuántas veces se preguntó por cada una.
 */
export const PREGUNTAS: Record<string, number> = {};
/** El remitente de mentira (el Apps Script de Asvent): lo que le pidieron enviar. «rebota@…» simula que no sale. */
export const ENVIADOS: { to: string; code: string; minutes: number }[] = [];
/** El Drive de Asvent de mentira: cada archivo es un PDF corto con su id dentro. */
export const pdfDe = (id: string) => `%PDF-1.7 archivo ${id}`;
/**
 * Biblioteca 2: la carpeta «AK Lore» de mentira. `archivos` es lo que lista Drive (como lo
 * devuelve la API), `contenido` lo que tiene cada uno (si no, `pdfDe`), `sinMiniatura` los
 * que no dan portada y `listados` cuántas páginas se pidieron.
 */
export const DRIVE: { archivos: Record<string, unknown>[]; contenido: Record<string, string>; sinMiniatura: Set<string>; listados: number; caido: boolean } = {
  archivos: [],
  contenido: {},
  sinMiniatura: new Set(),
  listados: 0,
  caido: false,
};
/** Una imagen JPEG mínima: la portada que da Drive. */
export const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);

export const HERRAMIENTAS = [
  {
    name: 'listar_tareas',
    title: 'Listar tareas',
    description: 'Las tareas pendientes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'Listar tareas', readOnlyHint: true },
  },
  {
    name: 'crear_tarea',
    title: 'Crear tarea',
    description: 'Crea una tarea.',
    inputSchema: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'], additionalProperties: false },
    annotations: { title: 'Crear tarea', readOnlyHint: false, destructiveHint: false },
  },
];

export interface Llamada {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  client: string;
}

export const esperar = async (cond: () => boolean, ms = 5000) => {
  const hasta = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > hasta) throw new Error('tiempo agotado');
    await new Promise((r) => setTimeout(r, 15));
  }
};

/** Una Frame abierta: recibe llamadas, avisa que llegaron y responde. */
export class FrameFalsa {
  llamadas: Llamada[] = [];
  mensajes: Record<string, unknown>[] = [];
  cerrada: { code: number; reason: string } | null = null;
  /** responde (lo normal) · calla (conexión muerta) · acusa (recibe y no responde). */
  modo: 'responde' | 'calla' | 'acusa' = 'responde';
  respuesta: (l: Llamada) => { ok: boolean; text?: string; error?: string } = (l) => ({ ok: true, text: `hecho: ${l.tool} ${JSON.stringify(l.args)}` });

  constructor(public ws: any) {
    ws.addEventListener('message', (e: { data: string }) => {
      const data = JSON.parse(e.data) as Record<string, unknown>;
      this.mensajes.push(data);
      if (data.t !== 'call') return;
      const llamada = data as unknown as Llamada;
      this.llamadas.push(llamada);
      if (this.modo === 'calla') return;
      ws.send(JSON.stringify({ t: 'ack', id: llamada.id }));
      if (this.modo === 'acusa') return;
      ws.send(JSON.stringify({ t: 'reply', id: llamada.id, ...this.respuesta(llamada) }));
    });
    ws.addEventListener('close', (e: { code: number; reason: string }) => {
      this.cerrada = { code: e.code, reason: e.reason };
    });
  }

  enviar(data: unknown) {
    this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
  }

  cerrar() {
    this.ws.close(1000, 'adiós');
  }
}

export interface Respuesta {
  estado: number;
  datos: any;
  texto: string;
  r: Response;
}

export interface Arnes {
  mf: Miniflare;
  pedir: (ruta: string, init?: RequestInit & { token?: string; json?: unknown; form?: Record<string, string> }) => Promise<Respuesta>;
  sql: (consulta: string, ...params: unknown[]) => Promise<any[]>;
  /** JSON-RPC a /mcp con el acceso de un chat. */
  rpc: (acceso: string, method: string, params?: unknown, id?: number | null) => Promise<Respuesta>;
  /** Herramienta MCP: el texto de la respuesta y si fue error. */
  mcp: (acceso: string, nombre: string, args?: object) => Promise<{ text: string; error: boolean; raw: any }>;
  /** Pide un código en la app (como Frame) y completa OAuth como Claude. */
  conectar: (cuenta: string, opciones?: { redirect?: string; nombre?: string }) => Promise<{ acceso: string; refresco: string; cliente: string }>;
  /** Abre una Frame falsa de la cuenta, ya presentada. */
  frame: (cuenta: string, nombre?: string, herramientas?: unknown[]) => Promise<FrameFalsa>;
  /** El WebSocket crudo con un pase dado. */
  socket: (pase: string) => Promise<{ estado: number; ws: any }>;
  pase: (cuenta: string) => Promise<string>;
  cron: () => Promise<void>;
  /** Una vuelta de la Biblioteca (el cron de cada 5 minutos). */
  sincronizar: () => Promise<void>;
  cerrar: () => Promise<void>;
}

const pkce = (v: string) => createHash('sha256').update(v).digest('base64url');

/**
 * Workers AI de mentira, por RPC como el de verdad. Responde un horario por
 * franjas, con una clase de dos franjas y un recreo, y cuántas neuronas gastó
 * (Qwen 400, Gemma 25). En la foto, «Y3Vwbw» simula la cuota gratuita agotada,
 * «bXVkbw» un modelo que no contesta con JSON y «cXdlbg» un Qwen caído. Un
 * pedido mal formado falla.
 */
const IA_FALSA = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class IA extends WorkerEntrypoint {
  async run(model, input) {
    const contenido = input.messages[0].content;
    if (typeof contenido === 'string' && contenido.includes('study app')) {
      // Vínculo de asignaturas (horario.ts): el primer nombre del horario es la
      // primera asignatura; lo demás, índices que no existen. «sin-vinculo»
      // entre las asignaturas simula un modelo que falla en este paso.
      if (!input.response_format) throw new Error('pedido mal formado');
      if (contenido.includes('sin-vinculo')) throw new Error('5000: model unavailable');
      return { choices: [{ message: { content: JSON.stringify({ links: [{ a: 0, b: 0 }, { a: 7, b: 0 }, { a: 0.5, b: 1 }, { a: 1, b: -1 }] }) } }], usage: { neurons: 3 } };
    }
    if (typeof contenido === 'string') {
      // Letras (letras.ts): «sin-ia» simula la cuota gratuita agotada, «rota»
      // una respuesta con otro número de líneas y «cortada» una que se queda a
      // medias (sin su final). Las líneas vuelven numeradas.
      if (model !== '@cf/google/gemma-4-26b-a4b-it' || !input.response_format) throw new Error('pedido mal formado');
      if (contenido.includes('sin-ia')) throw new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons');
      const lineas = contenido.split('\\n').filter((l) => /^\\d+\\. /.test(l)).map((l) => l.replace(/^\\d+\\. /, ''));
      const usage = { neurons: 12 };
      const salida = contenido.includes('rota') ? [{ n: 1, text: 'una sola' }] : lineas.map((l, i) => ({ n: i + 1, text: (i + 1) + '. [es] ' + l })).reverse();
      const texto = JSON.stringify({ from: 'EN', lines: salida });
      return { choices: [{ message: { content: contenido.includes('cortada') ? texto.slice(0, -30) : texto } }], usage };
    }
    const foto = contenido.find((p) => p.type === 'image_url').image_url.url;
    const qwen = model === '@cf/qwen/qwen3.8-27b';
    if ((!qwen && model !== '@cf/google/gemma-4-26b-a4b-it') || !/^data:image\\/(jpeg|png|webp);base64,/.test(foto) || !input.response_format) throw new Error('pedido mal formado');
    if (foto.includes('Y3Vwbw')) throw new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons');
    if (foto.includes('cXdlbg') && qwen) throw new Error('5000: model unavailable');
    const usage = { neurons: qwen ? 400 : 25 };
    if (foto.includes('bXVkbw')) return { choices: [{ message: { content: 'No puedo.' } }], usage };
    const slots = [
      { start: '08:00', end: '08:45', kind: 'class', cells: [
        { day: 1, subject: 'Matemática', room: 'A-1', span: 2 },
        { day: 2, subject: 'Historia', teacher: 'Prof. Ríos', span: 2 },
      ] },
      { start: '08:45', end: '09:30', kind: 'class', cells: [] },
      { start: '09:30', end: '09:45', kind: 'break', cells: [{ day: 1, subject: 'Recreo', span: 1 }] },
    ];
    return { choices: [{ message: { content: 'Aquí está: ' + JSON.stringify({ slots }) } }], usage };
  }
}
export default { fetch: () => new Response('ia') };
`;

export async function crearArnes(): Promise<Arnes> {
  const mf = new Miniflare({
    workers: [
      {
        name: 'frame-ia',
        modules: true,
        scriptPath: join(RAIZ, 'dist', 'index.js'),
        compatibilityDate: '2026-08-01',
        d1Databases: { DB: 'frame-ia-pruebas' },
        durableObjects: { RELAY: { className: 'FrameRelay', useSQLite: true } },
        bindings: {
          FRAME_IA_KEY: 'clave-de-pruebas-que-no-es-secreta',
          SUPABASE_URL: 'https://supabase.prueba/',
          SUPABASE_ANON_KEY: 'anon-de-pruebas',
          LORE_DRIVE_REFRESH: 'renovacion-de-prueba',
          LORE_GOOGLE_ID: 'cliente-de-prueba',
          LORE_GOOGLE_SECRET: 'secreto-de-prueba',
          LORE_DOMAIN_HASH: createHash('sha256').update(COLEGIO).digest('hex'),
          LORE_MAIL_URL: 'https://correo.prueba/exec',
          LORE_MAIL_KEY: 'clave-del-correo',
        },
        serviceBindings: { AI: { name: 'ia-falsa', entrypoint: 'IA' } },
        outboundService: async (pedido: any) => {
          const url = new URL(pedido.url);
          const auth = pedido.headers.get('authorization') ?? '';
          if (url.hostname === 'oauth2.googleapis.com' && url.pathname === '/token') {
            const form = new URLSearchParams(await pedido.text());
            const ok = form.get('refresh_token') === 'renovacion-de-prueba' && form.get('client_id') === 'cliente-de-prueba' && form.get('client_secret') === 'secreto-de-prueba';
            return new Response(JSON.stringify(ok ? { access_token: 'acceso-drive', expires_in: 3600 } : { error: 'invalid_grant' }), { status: ok ? 200 : 400 }) as never;
          }
          if (url.hostname === 'www.googleapis.com' && url.pathname === '/drive/v3/files') {
            if (auth !== 'Bearer acceso-drive') return new Response('{}', { status: 401 }) as never;
            if (DRIVE.caido) return new Response('{}', { status: 500 }) as never;
            DRIVE.listados++;
            const desde = Number(url.searchParams.get('pageToken') ?? 0);
            const tam = Number(url.searchParams.get('pageSize') ?? 100);
            const vivos = DRIVE.archivos.filter((f) => !f.trashed);
            const pagina = vivos.slice(desde, desde + tam).map((f) => ({
              ...f,
              ...(DRIVE.sinMiniatura.has(String(f.id)) || f.mimeType === 'application/vnd.google-apps.folder' ? {} : { thumbnailLink: `https://lh3.googleusercontent.com/prueba/${f.id}=s220` }),
            }));
            const sigue = desde + tam < vivos.length ? { nextPageToken: String(desde + tam) } : {};
            return new Response(JSON.stringify({ ...sigue, files: pagina }, null, 1), { headers: { 'content-type': 'application/json' } }) as never;
          }
          if (url.hostname === 'lh3.googleusercontent.com') {
            if (auth !== 'Bearer acceso-drive' || !url.pathname.endsWith('=s640')) return new Response('', { status: 403 }) as never;
            return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }) as never;
          }
          if (url.hostname === 'www.googleapis.com' && url.pathname.startsWith('/drive/v3/files/')) {
            const id = decodeURIComponent(url.pathname.slice('/drive/v3/files/'.length));
            if (auth !== 'Bearer acceso-drive' || url.searchParams.get('alt') !== 'media') return new Response('{}', { status: 401 }) as never;
            if (id === 'falta') return new Response('{}', { status: 404 }) as never;
            const cuerpo = DRIVE.contenido[id] ?? pdfDe(id);
            const rango = /^bytes=(\d+)-(\d*)$/.exec(pedido.headers.get('range') ?? '');
            if (rango) {
              const ini = Number(rango[1]);
              const fin = rango[2] ? Math.min(Number(rango[2]), cuerpo.length - 1) : cuerpo.length - 1;
              const trozo = cuerpo.slice(ini, fin + 1);
              return new Response(trozo, { status: 206, headers: { 'content-type': 'application/pdf', 'content-length': String(trozo.length), 'content-range': `bytes ${ini}-${fin}/${cuerpo.length}` } }) as never;
            }
            return new Response(cuerpo, { headers: { 'content-type': 'application/pdf', 'content-length': String(Buffer.byteLength(cuerpo)) } }) as never;
          }
          if (url.hostname === 'correo.prueba') {
            const carta = (await pedido.json().catch(() => null)) as { key?: string; to?: string; code?: string; minutes?: number } | null;
            if (pedido.method !== 'POST' || carta?.key !== 'clave-del-correo' || !carta.to || !/^\d{6}$/.test(carta.code ?? '')) return new Response(JSON.stringify({ ok: false, error: 'key' })) as never;
            if (carta.to.startsWith('rebota@')) return new Response(JSON.stringify({ ok: false, error: 'quota' })) as never;
            ENVIADOS.push({ to: carta.to, code: carta.code!, minutes: carta.minutes ?? 0 });
            return new Response(JSON.stringify({ ok: true })) as never;
          }
          if (url.hostname !== 'supabase.prueba' || url.pathname !== '/auth/v1/user' || pedido.headers.get('apikey') !== 'anon-de-pruebas') {
            return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }) as never;
          }
          const ficha = auth.slice(7);
          PREGUNTAS[ficha] = (PREGUNTAS[ficha] ?? 0) + 1;
          if (ficha.startsWith('supabase-caido-')) return new Response('upstream connect error', { status: 503 }) as never;
          if (ficha.startsWith('supabase-limite-')) return new Response(JSON.stringify({ code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' }), { status: 429 }) as never;
          if (ficha.startsWith('supabase-pasarela-')) return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 401 }) as never;
          if (ficha.startsWith('supabase-sin-red-')) throw new Error('connect failed');
          if (ficha.startsWith('sesion-cerrada-')) {
            return new Response(JSON.stringify({ code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' }), { status: 403 }) as never;
          }
          if (ficha.startsWith('supabase-parpadea-')) {
            if (PREGUNTAS[ficha] === 1) return new Response('bad gateway', { status: 502 }) as never;
            return new Response(JSON.stringify({ id: ficha.slice(-36), aud: 'authenticated' }), { headers: { 'content-type': 'application/json' } }) as never;
          }
          if (!auth.startsWith('Bearer sb-')) {
            return new Response(JSON.stringify({ code: 403, error_code: 'bad_jwt', msg: 'invalid JWT: unable to parse or verify signature' }), { status: 403 }) as never;
          }
          const id = auth.slice(10);
          return new Response(JSON.stringify({ id, aud: 'authenticated', ...(CORREOS[id] ?? {}) }), { headers: { 'content-type': 'application/json' } }) as never;
        },
      },
      { name: 'ia-falsa', modules: true, compatibilityDate: '2026-08-01', script: IA_FALSA },
    ],
  });
  const db = await mf.getD1Database('DB');
  for (const archivo of readdirSync(join(RAIZ, 'migraciones')).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(RAIZ, 'migraciones', archivo), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');
    for (const s of sql.split(/;\s*\n/).map((x) => x.trim().replace(/;$/, '')).filter(Boolean)) await db.prepare(s).run();
  }

  const pedir: Arnes['pedir'] = async (ruta, init = {}) => {
    const cab: Record<string, string> = { ...(init.headers as Record<string, string>) };
    if (init.token) cab.authorization = `Bearer ${init.token}`;
    let body = init.body;
    if (init.json !== undefined) {
      cab['content-type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    if (init.form) {
      cab['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(init.form).toString();
    }
    const r = await mf.dispatchFetch(`${ORIGEN}${ruta}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers: cab, body, redirect: 'manual' } as never);
    const texto = await r.text();
    let datos: unknown = null;
    try {
      datos = JSON.parse(texto);
    } catch {
      /* no era JSON */
    }
    return { estado: r.status, datos, texto, r: r as unknown as Response };
  };

  const sql: Arnes['sql'] = async (consulta, ...params) => (await db.prepare(consulta).bind(...params).all()).results;

  let siguiente = 1;
  const rpc: Arnes['rpc'] = (acceso, method, params, id) =>
    pedir('/mcp', { token: acceso, json: { jsonrpc: '2.0', ...(id === null ? {} : { id: id ?? siguiente++ }), method, ...(params === undefined ? {} : { params }) } });

  const mcp: Arnes['mcp'] = async (acceso, nombre, args = {}) => {
    const { datos } = await rpc(acceso, 'tools/call', { name: nombre, arguments: args });
    const content = datos?.result?.content ?? [];
    return { text: content.map((c: { text?: string }) => c.text ?? '').join(''), error: !!datos?.result?.isError, raw: datos };
  };

  const conectar: Arnes['conectar'] = async (cuenta, opciones = {}) => {
    const redirect = opciones.redirect ?? CLAUDE;
    const par = await pedir('/app/pair', { method: 'POST', token: sesion(cuenta) });
    if (par.estado !== 200) throw new Error(`pair ${par.estado}`);
    const reg = await pedir('/register', { json: { client_name: opciones.nombre ?? 'Claude', redirect_uris: [redirect] } });
    const cliente = reg.datos.client_id as string;
    const form = {
      client_id: cliente, redirect_uri: redirect, state: 'estado', code_challenge: pkce(VERIFICADOR), code_challenge_method: 'S256',
      response_type: 'code', scope: 'frame', resource: `${ORIGEN}/mcp`, code: par.datos.code,
    };
    const au = await pedir('/authorize', { form });
    if (au.estado !== 302) throw new Error(`authorize ${au.estado} ${au.texto.slice(0, 200)}`);
    const code = new URL(au.r.headers.get('location')!).searchParams.get('code')!;
    const t = await pedir('/token', { form: { grant_type: 'authorization_code', code, redirect_uri: redirect, client_id: cliente, code_verifier: VERIFICADOR } });
    if (t.estado !== 200) throw new Error(`token ${t.estado} ${t.texto}`);
    return { acceso: t.datos.access_token, refresco: t.datos.refresh_token, cliente };
  };

  const pase: Arnes['pase'] = async (cuenta) => {
    const r = await pedir('/app/ticket', { method: 'POST', token: sesion(cuenta) });
    if (r.estado !== 200) throw new Error(`ticket ${r.estado}`);
    return r.datos.ticket as string;
  };

  const socket: Arnes['socket'] = async (p) => {
    const r: any = await mf.dispatchFetch(`${ORIGEN}/app/socket?ticket=${encodeURIComponent(p)}`, { headers: { upgrade: 'websocket' } } as never);
    const ws = r.webSocket;
    if (ws) ws.accept();
    return { estado: r.status, ws };
  };

  const frame: Arnes['frame'] = async (cuenta, nombre = 'Laptop', herramientas = HERRAMIENTAS) => {
    const { estado, ws } = await socket(await pase(cuenta));
    if (estado !== 101 || !ws) throw new Error(`socket ${estado}`);
    const f = new FrameFalsa(ws);
    f.enviar({ t: 'hello', device: { id: `id-${nombre}`, name: nombre, platform: 'windows' }, version: '1.8.0', tools: herramientas, instructions: 'Frame es la app de estudio.' });
    await esperar(() => f.mensajes.some((m) => m.t === 'ready'));
    return f;
  };

  const cron = async () => {
    const w = await mf.getWorker();
    await w.scheduled({ cron: '17 9 * * *' });
  };

  const sincronizar = async () => {
    const w = await mf.getWorker();
    await w.scheduled({ cron: '*/5 * * * *' });
  };

  return { mf, pedir, sql, rpc, mcp, conectar, frame, socket, pase, cron, sincronizar, cerrar: () => mf.dispose() };
}
