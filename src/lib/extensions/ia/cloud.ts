// ============================================================
// Conexiones con IA · chats en la web (1.8.0).
//
// claude.ai (web, escritorio y celular) y los demás chats con conectores MCP
// remotos llegan a Frame por un relé en la nube (nube-ia/, Cloudflare): la app
// le abre un WebSocket, publica sus herramientas y atiende cada llamada con el
// mismo motor que el puente local, confirmación para borrar incluida. El relé
// no guarda nada de lo que pasa. Se activa por equipo (apagado de fábrica) y
// solo con una cuenta de Frame: el relé sabe de quién es cada Frame por su
// sesión de Supabase.
// ============================================================

import { NUBE as IA_CLOUD, nubeFetch } from '@/lib/nube';
import { getActiveSession } from '@/lib/supabase/auth';
import { extRead, extWrite } from '@/lib/extensions/store';
import { deviceId } from '@/lib/sync-delta';
import { APP_VERSION } from '@/lib/version';
import { IA, IA_INSTRUCTIONS, IA_TOOLS } from './tools';

/** La dirección que se pega en el chat como conector. */
export const IA_CLOUD_MCP = `${IA_CLOUD}/mcp`;
/** Cambió el interruptor de este equipo o se retiraron los permisos. */
export const IA_CLOUD_CHANGED = 'frame-ia-cloud';

/** Ping al relé (lo contesta sin despertarse) y cuánto se espera el pong. */
const PING_MS = 25_000;
const PONG_MS = 10_000;
/** Lo que cabe en una respuesta: de sobra para un chat, y el relé recorta igual. */
const MAX_REPLY = 300_000;
/** Lo que vale un código de emparejamiento (como en nube-ia/src/oauth.ts). */
export const PAIR_MS = 10 * 60_000;

/** ¿Este equipo atiende a los chats de la web? */
export const readCloudOn = (): boolean => extRead<boolean>(IA, 'cloud', false);

export function setCloudOn(on: boolean): void {
  extWrite(IA, 'cloud', on || null);
  window.dispatchEvent(new Event(IA_CLOUD_CHANGED));
}

export class CloudError extends Error {
  constructor(
    public readonly code: 'session' | 'network' | 'server',
    message?: string
  ) {
    super(message ?? code);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await getActiveSession();
  if (!session) throw new CloudError('session');
  let response: Response;
  try {
    response = await nubeFetch(`${IA_CLOUD}${path}`, { ...init, headers: { authorization: `Bearer ${session.access_token}` } });
  } catch {
    throw new CloudError('network');
  }
  if (response.status === 401) throw new CloudError('session');
  if (!response.ok) throw new CloudError('server', `HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface PairingCode {
  code: string;
  expires: number;
}

export interface CloudStatus {
  /** Los chats con permiso, por nombre: desde cuándo y su última autorización. */
  chats: { name: string; since: number; latest: number }[];
  /** Las Frame abiertas ahora; la primera es la que responde. `id`: el de cada equipo. */
  devices: { id: string; name: string; platform: string; version: string; at: number }[];
}

export const requestPairingCode = () => request<PairingCode>('/app/pair', { method: 'POST' });
export const readCloudStatus = () => request<CloudStatus>('/app/status');
export const revokeCloud = () => request<{ ok: boolean }>('/app/revoke', { method: 'POST' });

// ------------------------------------------------------------
// La conexión con el relé
// ------------------------------------------------------------

export type LinkState = 'off' | 'connecting' | 'online' | 'retrying' | 'signed-out';

export interface CloudCall {
  tool: string;
  args: unknown;
  client: string;
}

export type CloudReply = { ok: true; text: string } | { ok: false; error: string };

let state: LinkState = 'off';
const watchers = new Set<(next: LinkState) => void>();

export const linkState = (): LinkState => state;

export function onLinkState(watch: (next: LinkState) => void): () => void {
  watchers.add(watch);
  return () => watchers.delete(watch);
}

function setState(next: LinkState) {
  if (state === next) return;
  state = next;
  for (const watch of watchers) watch(next);
}

const platform = () => (/android/i.test(navigator.userAgent) ? 'android' : 'windows');

function clip(reply: CloudReply): CloudReply {
  if (!reply.ok || reply.text.length <= MAX_REPLY) return reply;
  return { ok: true, text: `${reply.text.slice(0, MAX_REPLY - 80)}\n\n… (recortado: la respuesta era demasiado larga)` };
}

/**
 * Abre la conexión con el relé y la mantiene: ping cada 25 s, reconexión con
 * espera creciente y al azar (1 s … 1 min), enseguida al volver la red o la
 * ventana. Al volver al primer plano, esta Frame pasa a ser la que responde.
 * Devuelve con qué cerrarla.
 */
export function startCloudLink(onCall: (call: CloudCall) => Promise<CloudReply>): () => void {
  let socket: WebSocket | null = null;
  let stopped = false;
  let opening = false;
  let tries = 0;
  let lastFocus = 0;
  let retryTimer: number | undefined;
  let pingTimer: number | undefined;
  let pongTimer: number | undefined;

  const clearTimers = () => {
    window.clearTimeout(retryTimer);
    window.clearInterval(pingTimer);
    window.clearTimeout(pongTimer);
  };

  const later = (ms: number, next: LinkState) => {
    if (stopped) return;
    clearTimers();
    setState(next);
    retryTimer = window.setTimeout(() => void open(), ms);
  };

  const retry = () => {
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(tries, 6)) * (0.5 + Math.random());
    tries += 1;
    later(wait, 'retrying');
  };

  const ping = () => {
    if (socket?.readyState !== WebSocket.OPEN) return;
    socket.send('ping');
    window.clearTimeout(pongTimer);
    // Sin pong, la conexión está muerta aunque no lo parezca: se rehace.
    pongTimer = window.setTimeout(() => socket?.close(4000, 'Sin pong'), PONG_MS);
  };

  const answer = (ws: WebSocket, id: string, call: CloudCall) => {
    void onCall(call)
      .catch((error: unknown): CloudReply => ({ ok: false, error: `Frame no pudo hacerlo: ${error instanceof Error ? error.message : String(error)}` }))
      .then((reply) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'reply', id, ...clip(reply) }));
      });
  };

  const open = async () => {
    if (stopped || opening) return;
    opening = true;
    clearTimers();
    setState('connecting');
    let ticket: string;
    try {
      ticket = (await request<{ ticket: string }>('/app/ticket', { method: 'POST' })).ticket;
    } catch (error) {
      opening = false;
      // Sin sesión válida no hay a quién conectar: se reintenta despacio.
      if (error instanceof CloudError && error.code === 'session') later(60_000, 'signed-out');
      else retry();
      return;
    }
    opening = false;
    if (stopped) return;
    const ws = new WebSocket(`${IA_CLOUD.replace(/^http/, 'ws')}/app/socket?ticket=${encodeURIComponent(ticket)}`);
    socket = ws;
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          t: 'hello',
          device: { id: deviceId(), name: platform() === 'android' ? 'Android' : 'Windows', platform: platform() },
          version: APP_VERSION,
          tools: IA_TOOLS,
          instructions: IA_INSTRUCTIONS,
        })
      );
    };
    ws.onmessage = (event: MessageEvent) => {
      if (socket !== ws || typeof event.data !== 'string') return;
      if (event.data === 'pong') {
        window.clearTimeout(pongTimer);
        return;
      }
      let data: { t?: string; id?: string; tool?: string; args?: unknown; client?: string };
      try {
        data = JSON.parse(event.data) as typeof data;
      } catch {
        return;
      }
      if (data.t === 'ready') {
        tries = 0;
        setState('online');
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(ping, PING_MS);
      } else if (data.t === 'call' && typeof data.id === 'string' && typeof data.tool === 'string') {
        // Primero el acuse: el relé sabe enseguida que esta Frame está viva.
        ws.send(JSON.stringify({ t: 'ack', id: data.id }));
        answer(ws, data.id, { tool: data.tool, args: data.args ?? {}, client: typeof data.client === 'string' ? data.client : '' });
      } else if (data.t === 'revoked') {
        window.dispatchEvent(new Event(IA_CLOUD_CHANGED));
      }
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      socket = null;
      retry();
    };
  };

  // Red o ventana de vuelta: reconectar ya si hacía falta, y avisar al relé
  // de que esta es la Frame que el usuario tiene delante.
  const wake = () => {
    if (stopped) return;
    if (!socket || socket.readyState === WebSocket.CLOSING || socket.readyState === WebSocket.CLOSED) {
      if (!opening) {
        tries = 0;
        void open();
      }
      return;
    }
    if (socket.readyState === WebSocket.OPEN && Date.now() - lastFocus > 30_000) {
      lastFocus = Date.now();
      socket.send(JSON.stringify({ t: 'focus' }));
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') wake();
  };
  window.addEventListener('online', wake);
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', onVisibility);

  void open();

  return () => {
    stopped = true;
    clearTimers();
    window.removeEventListener('online', wake);
    window.removeEventListener('focus', wake);
    document.removeEventListener('visibilitychange', onVisibility);
    const ws = socket;
    socket = null;
    ws?.close(1000, 'Apagada');
    setState('off');
  };
}
