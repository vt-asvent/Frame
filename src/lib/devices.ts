import { useSyncExternalStore } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { checkSession } from '@/lib/supabase/session-guard';
import { SESSION_RESTORED_EVENT } from '@/lib/connection-status';
import { readCursor, sameInstant } from '@/lib/supabase/sync';
import { wireWorking } from '@/lib/extensions/wire/relay';
import { currentSyncIssues, subscribeSyncIssues, type SyncIssue } from '@/lib/sync-check';
import { SYNC_NOW_EVENT, getSyncStatus, subscribeSyncStatus } from '@/lib/sync-status';
import { onPeerMessage, sendPeerMessage } from '@/lib/sync-peers';
import { deviceId } from '@/lib/sync-delta';
import { APP_VERSION } from '@/lib/version';

// ============================================================
// Dispositivos de la cuenta (1.9.2; desde la 1.9.9, en la interfaz de Wire).
//
// Cada equipo con sesión late (supabase/migrations/0018 y 0019): manda su
// tipo, sistema, versión y un resumen (`DeviceSync`), y recibe los equipos de
// la cuenta, la versión de la copia en la nube y la hora del servidor.
//
// · «Vinculado» lo decide el servidor mirando si la sesión del equipo sigue
//   existiendo; aquí solo se enseña. Al cerrar sesión el equipo se despide, y
//   el servidor no deja que un latido atrasado de esa sesión lo reviva.
// · «Al día» es tener la misma versión que la nube. La versión la sella el
//   reloj de quien escribe, así que solo se compara por igualdad: ordenar
//   versiones de equipos distintos daba falsos «desactualizado» en cuanto
//   un reloj iba adelantado.
// · La versión de la nube que este equipo conoce es la última que vio: la
//   del latido, o la suya propia si sincronizó después.
// · Un equipo que aún no confirmó la última versión no tiene un problema:
//   está en ello o está cerrado y lo hará al abrir Frame (`waiting`). Solo
//   cuenta como pendiente (`behind`) lo que su verificador de sincronización
//   encontró sin sincronizar. Cada equipo dice además si tiene Wire (1.9.9):
//   la música, las imágenes propias y los adjuntos solo viajan con él, y así
//   la tarjeta puede decir en cuál hay que activarlo.
//
// Los latidos van espaciados (al abrir, cada 10 min, al volver a la ventana
// y medio minuto después de un cambio). Con la tarjeta abierta en algún
// equipo, este pregunta por el canal en vivo (`ask`) y los demás laten al
// momento y avisan cuando cambian (`told`): la tarjeta se ve al día sin que
// nadie lata de más cuando no hay quien mire. Un latido que no llega se
// reintenta solo, cada vez más espaciado.
//
// «Corregir»: aquí, una vuelta completa de sincronización (datos, imágenes y
// Wire); a los demás se les pide lo mismo (resync_at) y lo hacen una vez.
// ============================================================

export type DeviceKind = 'laptop' | 'phone' | 'tablet';
export type IssueKind = SyncIssue['kind'];

export interface DeviceSync {
  v: 1;
  /** Versión de la nube (`backups.updated_at`) con la que este equipo quedó igual por última vez. */
  cloudAt: string | null;
  /** Lo que le falta, por tipo (del verificador de sincronización). */
  issues: Partial<Record<IssueKind, number>>;
  /** Manda y recibe por Wire (las versiones anteriores a la 1.9.9 y a la 1.4.1 de Android no lo dicen). */
  wire?: boolean;
}

export interface DeviceRow {
  device_id: string;
  kind: DeviceKind;
  platform: string;
  app_version: string;
  linked: boolean;
  first_seen: string;
  last_seen: string;
  /** Cuándo cerró sesión. Nulo y sin vincular: la sesión se cerró sin que el equipo avisara. */
  unlinked_at: string | null;
  sync: Partial<DeviceSync>;
  resync_at: string | null;
}

export type DeviceState = 'synced' | 'waiting' | 'behind' | 'unlinked' | 'inactive';

export interface DevicesSnapshot {
  /** null: todavía no se sabe (o no hay sesión). */
  rows: DeviceRow[] | null;
  /** El último latido no llegó. */
  failed: boolean;
  /** La versión más reciente de la nube que este equipo conoce. */
  cloudAt: string | null;
  /** Reloj de este equipo menos el del servidor (ms): las horas de las filas son del servidor. */
  skew: number;
}

const KINDS: IssueKind[] = ['pending', 'error', 'image', 'song', 'attachment'];
const INACTIVE_MS = 30 * 86_400_000;
/** Latido de fondo. */
const BEAT_MS = 10 * 60_000;
/** Con la tarjeta abierta: cada cuánto mira y pregunta a los demás. */
const TICK_MS = 30_000;
/** Mínimo entre dos latidos. */
const MIN_GAP_MS = 2000;
/** Mínimo entre dos latidos pedidos por otro equipo. */
const ASK_GAP_MS = 5000;
/** Cuánto dura «alguien me está mirando» tras su última pregunta. */
const WATCH_MS = 60_000;
/** De un cambio de aquí al latido que lo cuenta: sin nadie mirando, y con alguien. */
const QUIET_CHANGE_MS = 30_000;
const WATCHED_CHANGE_MS = 1200;
/** Recién abierto o recién vuelto (a la ventana, a la red): un rato contando los cambios al momento. */
const EAGER_MS = 20_000;
/** Tras un latido que no llegó: 15 s, 30 s, 1 min… hasta el ritmo de fondo. */
const RETRY_MS = 15_000;
/** Lo que el servidor deja mandar a una despedida sobre los latidos de su misma sesión (0019). */
const GOODBYE_MS = 2 * 60_000;

export function deviceKind(): DeviceKind {
  const ua = navigator.userAgent;
  if (!/Android|iPhone|iPad|Mobile/i.test(ua)) return 'laptop';
  const short = Math.min(window.screen.width, window.screen.height);
  return /iPad/i.test(ua) || short >= 600 ? 'tablet' : 'phone';
}

function devicePlatform(): string {
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad/i.test(ua)) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS/i.test(ua)) return 'macos';
  if (/Linux/i.test(ua)) return 'linux';
  return 'web';
}

/** Cómo está este equipo ahora. Las claves van siempre en el mismo orden: se compara como texto. */
function summary(uid: string): DeviceSync {
  const counts = new Map<IssueKind, number>();
  for (const issue of currentSyncIssues()) counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1);
  const issues: Partial<Record<IssueKind, number>> = {};
  for (const kind of KINDS) {
    const count = counts.get(kind);
    if (count) issues[kind] = count;
  }
  return { v: 1, cloudAt: readCursor(uid)?.remoteAt ?? null, issues, wire: wireWorking() };
}

// ------------------------------------------------------------
// Lo que la tarjeta lee
// ------------------------------------------------------------

const EMPTY: DevicesSnapshot = { rows: null, failed: false, cloudAt: null, skew: 0 };
let snap = EMPTY;
const listeners = new Set<() => void>();

function publish(next: DevicesSnapshot) {
  snap = next;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getDevices = (): DevicesSnapshot => snap;

export function useDevices(): DevicesSnapshot {
  return useSyncExternalStore(subscribe, getDevices, getDevices);
}

/** Hace cuánto (ms) de una hora del servidor, sin fiarse del reloj de este equipo. */
export function agoMs(iso: string | null | undefined, skew: number): number {
  const at = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : Math.max(0, Date.now() - skew - at);
}

/** Lo que el verificador de ese equipo encontró sin sincronizar (tolera resúmenes de otras versiones). */
function issueCount(row: DeviceRow): number {
  const raw: unknown = row.sync?.issues;
  if (!raw || typeof raw !== 'object') return 0;
  let total = 0;
  for (const count of Object.values(raw)) if (typeof count === 'number' && count > 0) total += count;
  return total;
}

export function stateOf(row: DeviceRow, known: DevicesSnapshot, self = deviceId()): DeviceState {
  if (!row.linked) return 'unlinked';
  if (row.device_id !== self && agoMs(row.last_seen, known.skew) > INACTIVE_MS) return 'inactive';
  if (issueCount(row) > 0) return 'behind';
  return row.sync?.v === 1 && sameInstant(row.sync.cloudAt ?? null, known.cloudAt) ? 'synced' : 'waiting';
}

function parseReply(data: unknown): { devices: DeviceRow[]; cloudAt: string | null; skew: number } | null {
  if (!data || typeof data !== 'object') return null;
  const reply = data as { devices?: unknown; cloud_at?: unknown; now?: unknown };
  if (!Array.isArray(reply.devices)) return null;
  const devices = reply.devices.filter((row): row is DeviceRow => {
    const candidate = row as Partial<DeviceRow> | null;
    return (
      !!candidate &&
      typeof candidate === 'object' &&
      typeof candidate.device_id === 'string' &&
      typeof candidate.last_seen === 'string' &&
      !Number.isNaN(Date.parse(candidate.last_seen))
    );
  });
  const serverNow = typeof reply.now === 'string' ? Date.parse(reply.now) : Number.NaN;
  return {
    devices,
    cloudAt: typeof reply.cloud_at === 'string' ? reply.cloud_at : null,
    skew: Number.isNaN(serverNow) ? 0 : Date.now() - serverNow,
  };
}

// ------------------------------------------------------------
// Lo que la tarjeta y el cierre de sesión piden
// ------------------------------------------------------------

/** La tarjeta de Dispositivos está en pantalla. */
let cardOpen = false;
/** Cerrando sesión: ni un latido más. */
let muted = false;
let active: { refresh: () => void } | null = null;

/** Mira ya: late y, con la tarjeta abierta, pide a los demás equipos que también lo hagan. */
function refreshDevices(): void {
  active?.refresh();
}

/** La tarjeta avisa cuando entra y sale de la pantalla. */
export function setDevicesOpen(open: boolean): void {
  if (cardOpen === open) return;
  cardOpen = open;
  if (open) active?.refresh();
}

/** «Corregir»: aquí y en los demás equipos vinculados. False: no se les pudo pedir. */
export async function repairAllDevices(): Promise<boolean> {
  window.dispatchEvent(new Event(SYNC_NOW_EVENT));
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('device_request_resync', { p_from: deviceId() });
    if (error) return false;
  } catch {
    return false;
  }
  // El pedido ya está guardado: que lo vean ahora los que tengan Frame abierto.
  sendPeerMessage({ t: 'ask' });
  window.setTimeout(refreshDevices, 5000);
  return true;
}

/**
 * Antes de cerrar la sesión: este equipo queda «desvinculado». Nunca falla y
 * tarda como mucho `budgetMs`: pasado ese tiempo la petición se CANCELA. Si
 * siguiera viva tras el cierre, saldría con la llave de quien entre después y
 * desvincularía esa sesión nueva.
 */
export async function markDeviceUnlinked(budgetMs = 2500): Promise<void> {
  muted = true;
  const supabase = getSupabase();
  if (!supabase) return;
  const cancel = new AbortController();
  const timer = window.setTimeout(() => cancel.abort(), budgetMs);
  try {
    // Un latido que siga en camino llega después y no lo revive: la despedida manda (0019).
    const { error } = await supabase.rpc('device_unlink', { p_device_id: deviceId() }).abortSignal(cancel.signal);
    if (!error) sendPeerMessage({ t: 'told' });
  } catch {
    /* sin red: los demás lo verán desvinculado cuando la sesión deje de existir */
  } finally {
    window.clearTimeout(timer);
  }
}

/** Quitar de la lista un equipo que ya no se usa (si vuelve a entrar, reaparece). */
export async function forgetDevice(id: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  try {
    const { error } = await supabase.rpc('device_forget', { p_device_id: id });
    if (error) return false;
  } catch {
    return false;
  }
  if (snap.rows) publish({ ...snap, rows: snap.rows.filter((row) => row.device_id !== id) });
  return true;
}

// ------------------------------------------------------------
// Latido
// ------------------------------------------------------------

export function startDevices(uid: string): () => void {
  const me = deviceId();
  const resyncKey = `frameDeviceResync_${uid}`;
  const cursorNow = () => readCursor(uid)?.remoteAt ?? null;

  let stopped = false;
  let beating = false;
  let again = false;
  let timer: number | null = null;
  let dueAt = 0;
  let lastStartAt = 0;
  let askDueAt = 0;
  let watchedUntil = 0;
  let hiddenUntil = 0;
  let eagerUntil = Date.now() + EAGER_MS;
  /** Latidos seguidos que no llegaron. */
  let failures = 0;
  /** Ya se repitió el latido tras comprobar que la sesión vive (una vez por episodio). */
  let relinkTried = false;
  /** Resumen del último latido que llegó, el anunciado a quien mira y el que enseña la tarjeta. */
  let sent: string | null = null;
  let told: string | null = null;
  let shown: string | null = null;
  let seenCursor = cursorNow();
  let cloudAt = seenCursor;
  let nudgedFor: string | null = null;
  let handledResync: string | null = null;
  try {
    handledResync = localStorage.getItem(resyncKey);
  } catch {
    /* sin almacenamiento: un pedido viejo se atiende otra vez, inofensivo */
  }
  muted = false;
  /** Al parar (cambio de cuenta, cierre), el latido en camino se cancela: no sale con otra sesión. */
  const cancel = new AbortController();

  /** Publica la lista con la fila de este equipo al momento (no como quedó en el último latido). */
  const show = (rows: DeviceRow[], patch: Partial<DevicesSnapshot> = {}) => {
    const mine = summary(uid);
    shown = JSON.stringify(mine);
    const skew = patch.skew ?? snap.skew;
    publish({
      ...snap,
      ...patch,
      rows: rows.map((row) => {
        if (row.device_id !== me) return row;
        // Este equipo late con su sesión viva. Si el servidor aún lo cuenta como despedido (Frame
        // se cerró a media salida; se le pasa solo, ver `beat`), aquí se ve como está: vinculado.
        const leaving = !row.linked && !muted && agoMs(row.unlinked_at, skew) < GOODBYE_MS;
        return leaving ? { ...row, sync: mine, linked: true, unlinked_at: null } : { ...row, sync: mine };
      }),
      cloudAt,
    });
  };

  const schedule = (delay: number, urgent = false) => {
    if (stopped) return;
    const at = urgent ? Date.now() + delay : Math.max(Date.now() + delay, lastStartAt + MIN_GAP_MS);
    if (timer !== null) {
      if (dueAt <= at) return;
      window.clearTimeout(timer);
    }
    dueAt = at;
    timer = window.setTimeout(() => {
      timer = null;
      if (beating) again = true;
      else void beat();
    }, Math.max(0, at - Date.now()));
  };

  /** El latido no llegó: se dice y se reintenta, cada vez más espaciado. */
  const missed = () => {
    if (stopped || muted) return;
    if (!snap.failed) publish({ ...snap, failed: true });
    failures += 1;
    schedule(Math.min(BEAT_MS, RETRY_MS * 2 ** (failures - 1)));
  };

  /** La nube tiene una versión que este equipo no: que la traiga ya, sin esperar a su sonda. */
  const catchUp = () => {
    const target = cloudAt;
    if (target === null || target === nudgedFor || sameInstant(cursorNow(), target)) return;
    // Lo normal es que el aviso del otro equipo esté llegando: solo si en 3 s sigue igual.
    window.setTimeout(() => {
      if (stopped || cloudAt !== target || nudgedFor === target) return;
      if (sameInstant(cursorNow(), target) || getSyncStatus().phase !== 'idle') return;
      nudgedFor = target;
      window.dispatchEvent(new Event(SYNC_NOW_EVENT));
    }, 3000);
  };

  /** Otro equipo pulsó «Corregir»: una vuelta completa aquí, una sola vez por pedido. */
  const handleResync = (value: string | null) => {
    if (!value || value === handledResync) return;
    handledResync = value;
    try {
      localStorage.setItem(resyncKey, value);
    } catch {
      /* sin marca se atendería otra vez al reabrir: inofensivo */
    }
    window.dispatchEvent(new Event(SYNC_NOW_EVENT));
  };

  const beat = async (): Promise<void> => {
    const supabase = getSupabase();
    if (stopped || muted || !supabase) return;
    if (beating) {
      again = true;
      return;
    }
    if (!navigator.onLine) {
      if (!snap.failed) publish({ ...snap, failed: true });
      return;
    }
    beating = true;
    lastStartAt = Date.now();
    const mine = summary(uid);
    const json = JSON.stringify(mine);
    try {
      const { data, error } = await supabase
        .rpc('device_heartbeat', {
          p_device_id: me,
          p_kind: deviceKind(),
          p_platform: devicePlatform(),
          p_app_version: APP_VERSION,
          p_sync: mine,
        })
        .abortSignal(cancel.signal);
      if (stopped || muted) return;
      const reply = error ? null : parseReply(data);
      if (!reply) {
        missed();
        return;
      }
      failures = 0;
      sent = json;
      // Si este equipo sincronizó con el latido en camino, su versión es más nueva que la respuesta.
      const cursor = cursorNow();
      if (cursor !== mine.cloudAt) seenCursor = cursor;
      cloudAt = cursor !== mine.cloudAt ? cursor : reply.cloudAt;
      show(reply.devices, { failed: false, skew: reply.skew });
      const own = reply.devices.find((row) => row.device_id === me);
      handleResync(own?.resync_at ?? null);
      if (own && !own.linked && own.unlinked_at) {
        // Este equipo se despidió y sigue con sesión (Frame se cerró a media salida). El servidor
        // lo vuelve a vincular cuando pase su margen: se late justo entonces, no en diez minutos.
        const left = GOODBYE_MS - agoMs(own.unlinked_at, reply.skew);
        if (left > 0) schedule(left + 3000);
      } else if (own && !own.linked) {
        // Sin despedida: la nube ya no encuentra la sesión de este equipo (se cerró desde fuera).
        // Se le pregunta a Supabase ahora, sin esperar a que la llave venza: si terminó, el usuario
        // lo sabe en el acto y la reconecta sin salir (session-guard.ts); si sigue viva, se late otra vez.
        void checkSession().then((state) => {
          // Viva: un latido más para que la nube lo vea, y solo uno (si siguiera diciendo lo mismo, no se insiste).
          if (state !== 'alive' || relinkTried || stopped) return;
          relinkTried = true;
          schedule(1500);
        });
      }
      if (own?.linked) relinkTried = false;
      if (shown !== json) schedule(1500);
      else catchUp();
      // A quien mira la tarjeta en otro equipo. Recién abierto o recién vuelto no se sabe si
      // alguien mira (sus preguntas no llegaron): se avisa igual, una vez por cambio.
      const now = Date.now();
      if ((now < watchedUntil || now < eagerUntil) && told !== json) {
        told = json;
        sendPeerMessage({ t: 'told' });
      }
    } catch {
      missed();
    } finally {
      beating = false;
      if (again) {
        again = false;
        schedule(0);
      }
    }
  };

  /** Cambió algo de aquí: terminó una sincronización, llegó un cambio en vivo o cambió lo que falta. */
  const onLocal = () => {
    if (stopped) return;
    const mine = summary(uid);
    const json = JSON.stringify(mine);
    if (mine.cloudAt !== seenCursor) {
      // Este equipo acaba de quedar igual que la nube: esa es la versión que conoce.
      seenCursor = mine.cloudAt;
      cloudAt = mine.cloudAt;
    }
    if (snap.rows && (json !== shown || cloudAt !== snap.cloudAt)) show(snap.rows);
    if (json === sent) return;
    // En segundo plano Frame puede dejar de correr en cualquier momento: sin esperas.
    const now = Date.now();
    if (now < hiddenUntil) schedule(300, true);
    else schedule(cardOpen || now < watchedUntil || now < eagerUntil ? WATCHED_CHANGE_MS : QUIET_CHANGE_MS);
  };

  const refresh = () => {
    if (cardOpen) sendPeerMessage({ t: 'ask' });
    schedule(0);
  };

  const onHide = () => {
    // A segundo plano (en el celular puede no volver a correr): que la nube sepa cómo queda este equipo.
    hiddenUntil = Date.now() + 5000;
    if (JSON.stringify(summary(uid)) !== sent) schedule(0, true);
  };
  const onVisibility = () => {
    if (document.visibilityState !== 'visible') {
      onHide();
      return;
    }
    // De vuelta: lo que este equipo traiga ahora se cuenta en cuanto termine, no medio minuto después.
    eagerUntil = Date.now() + EAGER_MS;
    if (cardOpen) refresh();
    else if (Date.now() - lastStartAt > 2 * 60_000) schedule(1500);
  };
  const onOnline = () => {
    eagerUntil = Date.now() + EAGER_MS;
    schedule(1500);
  };
  /** La cuenta se reconectó sin salir de Frame: este equipo vuelve a contar ya. */
  const onRestored = () => {
    failures = 0;
    eagerUntil = Date.now() + EAGER_MS;
    schedule(300, true);
  };

  const stopStatus = subscribeSyncStatus(onLocal);
  const stopIssues = subscribeSyncIssues(onLocal);
  const stopPeers = onPeerMessage((message) => {
    if (stopped) return;
    const now = Date.now();
    if (message.t === 'ask') {
      // Otro equipo tiene la tarjeta abierta: latir ya (como mucho cada 5 s) y, un rato, contarle los cambios.
      if (now >= watchedUntil) told = null;
      watchedUntil = now + WATCH_MS;
      if (askDueAt > now) return;
      askDueAt = Math.max(now + 300, askDueAt + ASK_GAP_MS);
      schedule(askDueAt - now);
    } else if (message.t === 'told' && cardOpen) {
      // Un equipo cambió: mirar. Nunca se contesta a esto con otro aviso.
      schedule(200);
    }
  });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onHide);
  window.addEventListener('online', onOnline);
  window.addEventListener(SESSION_RESTORED_EVENT, onRestored);
  const tick = window.setInterval(() => {
    if (cardOpen && document.visibilityState === 'visible') refresh();
    else if (Date.now() - lastStartAt >= BEAT_MS) schedule(0);
  }, TICK_MS);

  const instance = { refresh };
  active = instance;
  if (cardOpen) refresh();
  else schedule(5000);

  return () => {
    stopped = true;
    cancel.abort();
    if (active === instance) active = null;
    if (timer !== null) window.clearTimeout(timer);
    window.clearInterval(tick);
    stopStatus();
    stopIssues();
    stopPeers();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('online', onOnline);
    window.removeEventListener(SESSION_RESTORED_EVENT, onRestored);
    publish(EMPTY);
  };
}
