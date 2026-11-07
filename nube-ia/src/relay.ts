// Un relé por cuenta de Frame (Durable Object). Guarda la lista de
// herramientas que publicó la app (los chats la ven aunque Frame esté
// cerrada) y pasa cada llamada a una Frame abierta por su WebSocket, que
// hiberna mientras espera: sin llamadas no gasta nada. Lo que va y viene no
// se guarda en ninguna parte.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './util';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
/** La app avisa en cuanto recibe una llamada; si no, esa conexión está muerta. */
const ACK_MS = 6_000;
/** Lo que puede tardar una llamada, con la confirmación en pantalla (50 s) incluida. */
const CALL_MS = 80_000;
/** La app hace ping cada 25 s: sin noticias en este tiempo, la conexión está muerta. */
const STALE_MS = 80_000;
/** Con noticias en este tiempo, la conexión se da por viva y va primero. */
const FRESH_MS = 40_000;
const MAX_SOCKETS = 8;
const MAX_MESSAGE = 2 * 1024 * 1024;
const MAX_ARGS = 256 * 1024;
const MAX_TEXT = 300_000;
/** Llamadas por minuto y cuenta: de sobra para un chat, poco para un abuso. */
const RATE = 60;

export const OFFLINE =
  'Frame no está abierta en ningún equipo con esta cuenta, o no tiene activados los chats en la web (Extensiones › Conexiones con IA). Pide al usuario que la abra y vuelve a intentarlo.';
const UNSURE = 'Se perdió la conexión con Frame antes de saber si se hizo. Compruébalo con una herramienta de lectura antes de repetirlo.';
const LATE = 'Frame no respondió a tiempo. Si pedía confirmación para borrar, el usuario no respondió; si no, comprueba si se hizo antes de repetirlo.';
const BUSY = 'Demasiadas llamadas seguidas: espera un minuto y sigue.';
const REMOTE_NOTE = 'Esta conexión llega a Frame a través de la nube; si una herramienta responde que Frame no está abierta, pide al usuario que la abra.';

const STATUS_TOOL = {
  name: 'estado_de_frame',
  title: 'Estado de Frame',
  description: 'Dice si Frame está abierta y lista para recibir llamadas, y qué falta.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  annotations: { title: 'Estado de Frame', readOnlyHint: true, openWorldHint: false },
};

/** Una Frame conectada (va en el WebSocket: sobrevive a la hibernación). */
interface Device {
  sid: string;
  id: string;
  name: string;
  platform: string;
  version: string;
  /** Cuándo se presentó o volvió a primer plano: la más reciente responde. */
  at: number;
  /** Último mensaje suyo. */
  seen: number;
  ready: boolean;
}

interface Tool {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  [key: string]: unknown;
}

interface Catalog {
  tools: Tool[];
  instructions: string;
  version: string;
}

type Outcome = { ok: true; text: string } | { ok: false; error: string };
type Ending = Outcome | 'unacked' | 'cut';

interface Waiter {
  sid: string;
  acked: boolean;
  finish: (ending: Ending) => void;
}

interface Rpc {
  id?: number | string | null;
  method?: unknown;
  params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown };
}

/** Respuesta para el chat: estado HTTP y, si hay, el JSON ya escrito. */
export interface McpResult {
  status: number;
  body?: string;
}

const reply = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const failure = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
const content = (text: string, isError = false) => ({ content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) });
const str = (value: unknown, max: number, fallback = '') => (typeof value === 'string' && value ? value.slice(0, max) : fallback);

function cleanTools(raw: unknown): Tool[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Tool => !!t && typeof t === 'object' && typeof (t as Tool).name === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test((t as Tool).name) && typeof (t as Tool).inputSchema === 'object')
    .slice(0, 200);
}

export class FrameRelay extends DurableObject<Env> {
  private waiters = new Map<string, Waiter>();
  private catalogCache: Catalog | null | undefined;
  private gen: number | undefined;
  private tokens = RATE;
  private refilled = Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Los pings de la app se contestan sin despertar al relé.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  // ---------------- La app ----------------

  /** WebSocket de una Frame. El Worker ya comprobó su pase; aquí se gasta. */
  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 });
    const pass = req.headers.get('x-frame-pase') ?? '';
    const until = Number(req.headers.get('x-frame-caduca') ?? 0);
    const now = Date.now();
    if (!pass || !(until > now)) return new Response(null, { status: 401 });
    const used = (await this.ctx.storage.get<Record<string, number>>('pases')) ?? {};
    for (const [k, v] of Object.entries(used)) if (v < now) delete used[k];
    if (used[pass]) return new Response(null, { status: 401 });
    used[pass] = until;
    await this.ctx.storage.put('pases', used);

    const open = this.ctx.getWebSockets();
    if (open.length >= MAX_SOCKETS) {
      const oldest = open.sort((a, b) => (this.device(a)?.seen ?? 0) - (this.device(b)?.seen ?? 0))[0];
      try {
        oldest?.close(4001, 'Demasiadas conexiones');
      } catch {
        /* ya cerrado */
      }
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sid: crypto.randomUUID(), id: '', name: '', platform: '', version: '', at: now, seen: now, ready: false } satisfies Device);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message.length > MAX_MESSAGE) {
      ws.close(1009, 'Mensaje demasiado grande');
      return;
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(message) as Record<string, unknown>;
    } catch {
      return;
    }
    const device = this.device(ws);
    if (!data || typeof data !== 'object' || !device) return;
    const now = Date.now();
    device.seen = now;
    switch (data.t) {
      case 'hello': {
        const info = (data.device ?? {}) as Record<string, unknown>;
        const tools = cleanTools(data.tools);
        Object.assign(device, { id: str(info.id, 64), name: str(info.name, 60), platform: str(info.platform, 20), version: str(data.version, 20), at: now, ready: tools.length > 0 });
        ws.serializeAttachment(device);
        if (tools.length) await this.saveCatalog({ tools, instructions: str(data.instructions, 4000), version: device.version });
        ws.send(JSON.stringify({ t: 'ready' }));
        return;
      }
      case 'focus':
        device.at = now;
        ws.serializeAttachment(device);
        return;
      case 'ack': {
        ws.serializeAttachment(device);
        const waiter = this.waiters.get(String(data.id));
        if (waiter?.sid === device.sid) waiter.acked = true;
        return;
      }
      case 'reply': {
        ws.serializeAttachment(device);
        const waiter = this.waiters.get(String(data.id));
        if (waiter?.sid !== device.sid) return;
        waiter.acked = true;
        waiter.finish(data.ok === true ? { ok: true, text: str(data.text, MAX_TEXT, 'Hecho.') } : { ok: false, error: str(data.error, 4000, 'Frame no pudo hacerlo.') });
        return;
      }
      default:
        ws.serializeAttachment(device);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.lose(ws);
    try {
      ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000, reason.slice(0, 60));
    } catch {
      /* ya cerrado */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.lose(ws);
  }

  // ---------------- El Worker (RPC) ----------------

  /** Generación de los permisos: sube cada vez que se retiran. */
  async generation(): Promise<number> {
    this.gen ??= (await this.ctx.storage.get<number>('gen')) ?? 0;
    return this.gen;
  }

  /** Retira los permisos: los accesos ya entregados dejan de valer. */
  async revoke(): Promise<number> {
    const next = (await this.generation()) + 1;
    this.gen = next;
    await this.ctx.storage.put('gen', next);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(JSON.stringify({ t: 'revoked' }));
      } catch {
        /* ya cerrado */
      }
    }
    return next;
  }

  /** Las Frame abiertas ahora, la que responde primero (con su id, para que cada una se reconozca). */
  async devices(): Promise<{ id: string; name: string; platform: string; version: string; at: number }[]> {
    return this.live().map(({ d }) => ({ id: d.id, name: d.name, platform: d.platform, version: d.version, at: d.at }));
  }

  /** Una petición MCP (JSON-RPC, suelta o en lote) de un chat ya autenticado. */
  async mcp(raw: string, meta: { gen: number; client: string }): Promise<McpResult> {
    if (meta.gen !== (await this.generation())) return { status: 401 };
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { status: 400, body: JSON.stringify(failure(null, -32700, 'Parse error')) };
    }
    if (Array.isArray(body)) {
      if (!body.length) return { status: 400, body: JSON.stringify(failure(null, -32600, 'Invalid request')) };
      const out = (await Promise.all(body.slice(0, 20).map((m) => this.dispatch(m as Rpc, meta.client)))).filter(Boolean);
      return out.length ? { status: 200, body: JSON.stringify(out) } : { status: 202 };
    }
    const out = await this.dispatch(body as Rpc, meta.client);
    return out ? { status: 200, body: JSON.stringify(out) } : { status: 202 };
  }

  // ---------------- Por dentro ----------------

  private device(ws: WebSocket): Device | null {
    try {
      return (ws.deserializeAttachment() as Device | null) ?? null;
    } catch {
      return null;
    }
  }

  /** Conexiones vivas, la que responde primero; las muertas se cierran. */
  private live(): { ws: WebSocket; d: Device }[] {
    const now = Date.now();
    const out: { ws: WebSocket; d: Device; fresh: boolean }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const d = this.device(ws);
      if (!d) continue;
      const pong = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0;
      const seen = Math.max(d.seen, pong);
      if (now - seen > STALE_MS) {
        try {
          ws.close(4002, 'Sin noticias');
        } catch {
          /* ya cerrado */
        }
        continue;
      }
      if (d.ready) out.push({ ws, d, fresh: now - seen <= FRESH_MS });
    }
    return out.sort((a, b) => Number(b.fresh) - Number(a.fresh) || b.d.at - a.d.at);
  }

  private lose(ws: WebSocket): void {
    const sid = this.device(ws)?.sid;
    for (const waiter of [...this.waiters.values()]) if (waiter.sid === sid) waiter.finish(waiter.acked ? 'cut' : 'unacked');
  }

  private async catalog(): Promise<Catalog | null> {
    if (this.catalogCache === undefined) this.catalogCache = (await this.ctx.storage.get<Catalog>('catalogo')) ?? null;
    return this.catalogCache;
  }

  private async saveCatalog(next: Catalog): Promise<void> {
    const current = await this.catalog();
    if (current && JSON.stringify(current) === JSON.stringify(next)) return;
    this.catalogCache = next;
    await this.ctx.storage.put('catalogo', next);
  }

  private allow(): boolean {
    const now = Date.now();
    this.tokens = Math.min(RATE, this.tokens + ((now - this.refilled) / 60_000) * RATE);
    this.refilled = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  private ask(ws: WebSocket, sid: string, tool: string, args: unknown, client: string): Promise<Ending> {
    const id = crypto.randomUUID();
    return new Promise((resolve) => {
      const waiter: Waiter = { sid, acked: false, finish: () => undefined };
      const ackTimer = setTimeout(() => {
        if (waiter.acked) return;
        try {
          ws.close(4003, 'Sin respuesta');
        } catch {
          /* ya cerrado */
        }
        waiter.finish('unacked');
      }, ACK_MS);
      const callTimer = setTimeout(() => waiter.finish({ ok: false, error: LATE }), CALL_MS);
      waiter.finish = (ending) => {
        clearTimeout(ackTimer);
        clearTimeout(callTimer);
        if (this.waiters.delete(id)) resolve(ending);
      };
      this.waiters.set(id, waiter);
      try {
        ws.send(JSON.stringify({ t: 'call', id, tool, args, client }));
      } catch {
        waiter.finish('unacked');
      }
    });
  }

  /** A la Frame que responde primero. Si esa conexión estaba muerta y la
   *  herramienta solo lee, se prueba con la siguiente; si cambia algo, no se
   *  repite: podría hacerse dos veces. */
  private async relay(tool: string, args: unknown, client: string, readOnly: boolean): Promise<Outcome> {
    const targets = this.live();
    for (const { ws, d } of targets) {
      const ending = await this.ask(ws, d.sid, tool, args, client);
      if (typeof ending === 'object') return ending;
      if (!readOnly) return { ok: false, error: UNSURE };
    }
    return { ok: false, error: OFFLINE };
  }

  private async dispatch(rpc: Rpc, client: string): Promise<object | null> {
    if (!rpc || typeof rpc !== 'object' || typeof rpc.method !== 'string') return failure(rpc?.id, -32600, 'Invalid request');
    const { id, method, params } = rpc;
    if (id === undefined) return null; // notificación: nada que responder
    switch (method) {
      case 'initialize': {
        const catalog = await this.catalog();
        const asked = typeof params?.protocolVersion === 'string' ? params.protocolVersion : '';
        return reply(id, {
          protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'frame', title: 'Frame', version: catalog?.version || '1.8.0' },
          instructions: `${catalog?.instructions ?? ''} ${REMOTE_NOTE}`.trim(),
        });
      }
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: (await this.catalog())?.tools ?? [STATUS_TOOL] });
      case 'tools/call': {
        const name = typeof params?.name === 'string' ? params.name : '';
        const args = params?.arguments ?? {};
        if (name === STATUS_TOOL.name) {
          const open = this.live();
          const names = open.map(({ d }) => d.name || d.platform || 'Frame').join(', ');
          return reply(id, open.length ? content(`Frame está abierta y lista (${names}).`) : content(OFFLINE, true));
        }
        const tool = (await this.catalog())?.tools.find((t) => t.name === name);
        if (!tool) return failure(id, -32602, `Unknown tool: ${name}`);
        if (!args || typeof args !== 'object' || Array.isArray(args)) return failure(id, -32602, 'Arguments must be an object');
        if (JSON.stringify(args).length > MAX_ARGS) return reply(id, content('Los argumentos son demasiado grandes.', true));
        if (!this.allow()) return reply(id, content(BUSY, true));
        const outcome = await this.relay(name, args, client, tool.annotations?.readOnlyHint === true);
        return reply(id, outcome.ok ? content(outcome.text) : content(outcome.error, true));
      }
      default:
        return failure(id, -32601, `Method not found: ${method}`);
    }
  }
}
