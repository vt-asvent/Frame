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
  cerrar: () => Promise<void>;
}

const pkce = (v: string) => createHash('sha256').update(v).digest('base64url');

/**
 * Workers AI de mentira, por RPC como el de verdad. Responde un horario con un
 * recreo; «Y3Vwbw» en la foto simula la cuota gratuita agotada y «bXVkbw», un
 * modelo que no contesta con JSON. Un pedido mal formado falla.
 */
const IA_FALSA = `
import { WorkerEntrypoint } from 'cloudflare:workers';
export class IA extends WorkerEntrypoint {
  async run(model, input) {
    const foto = input.messages[0].content.find((p) => p.type === 'image_url').image_url.url;
    if (model !== '@cf/google/gemma-4-26b-a4b-it' || !foto.startsWith('data:image/jpeg;base64,') || !input.response_format) throw new Error('pedido mal formado');
    if (foto.includes('Y3Vwbw')) throw new Error('3036: Account limited: you have used up your daily free allocation of 10,000 neurons');
    if (foto.includes('bXVkbw')) return { choices: [{ message: { content: 'No puedo.' } }] };
    const classes = [
      { day: 1, start: '08:00', end: '09:30', subject: 'Matemática', room: 'A-1', kind: 'class' },
      { day: 1, start: '09:30', end: '09:45', subject: 'Recreo', kind: 'break' },
      { day: 2, start: '08:00', end: '09:30', subject: 'Historia', teacher: 'Prof. Ríos', kind: 'class' },
    ];
    return { choices: [{ message: { content: 'Aquí está: ' + JSON.stringify({ classes }) } }] };
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
        bindings: { FRAME_IA_KEY: 'clave-de-pruebas-que-no-es-secreta', SUPABASE_URL: 'https://supabase.prueba/', SUPABASE_ANON_KEY: 'anon-de-pruebas' },
        serviceBindings: { AI: { name: 'ia-falsa', entrypoint: 'IA' } },
        outboundService: async (pedido: any) => {
          const url = new URL(pedido.url);
          const auth = pedido.headers.get('authorization') ?? '';
          if (url.hostname !== 'supabase.prueba' || url.pathname !== '/auth/v1/user' || pedido.headers.get('apikey') !== 'anon-de-pruebas' || !auth.startsWith('Bearer sb-')) {
            return new Response(JSON.stringify({ msg: 'invalid' }), { status: 401 }) as never;
          }
          return new Response(JSON.stringify({ id: auth.slice(10), aud: 'authenticated' }), { headers: { 'content-type': 'application/json' } }) as never;
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

  return { mf, pedir, sql, rpc, mcp, conectar, frame, socket, pase, cron, cerrar: () => mf.dispose() };
}
