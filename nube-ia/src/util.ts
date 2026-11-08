// Ayudas compartidas: entorno, firmas y respuestas.
import type { FrameRelay } from './relay';

export interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace<FrameRelay>;
  /** 32 bytes en base64: firma los accesos de los chats y los pases de la app. */
  FRAME_IA_KEY: string;
  /** Proyecto de Supabase de Frame: solo para saber de quién es la app que llama. */
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  /** Workers AI: el lector de horarios (horario.ts). */
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
}

const text = new TextEncoder();

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function random(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', text.encode(s)));
}

let key: { source: string; hmac: CryptoKey } | null = null;

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (key?.source === env.FRAME_IA_KEY) return key.hmac;
  const raw = await crypto.subtle.digest('SHA-256', text.encode(`${env.FRAME_IA_KEY}:hmac`));
  key = { source: env.FRAME_IA_KEY, hmac: await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']) };
  return key.hmac;
}

/** Firmado y sin estado: `p` dice para qué sirve (acceso de un chat o pase de la app). */
export async function signToken(env: Env, payload: { p: string; e: number } & Record<string, unknown>): Promise<string> {
  const body = b64url(text.encode(JSON.stringify(payload)));
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(env), text.encode(body));
  return `${body}.${b64url(mac)}`;
}

/** El contenido si la firma vale, es del tipo pedido y no caducó. */
export async function verifyToken<T extends { p: string; e: number }>(env: Env, token: string, purpose: string): Promise<T | null> {
  const [body, mac, extra] = token.split('.');
  if (!body || !mac || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(mac), text.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64url(body))) as T;
    return data.p === purpose && typeof data.e === 'number' && data.e > Date.now() ? data : null;
  } catch {
    return null;
  }
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}

/** El relé de una cuenta. */
export const relayOf = (env: Env, owner: string) => env.RELAY.get(env.RELAY.idFromName(owner));
