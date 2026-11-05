import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabase } from '@/lib/supabase/client';
import { CLOUD_APPLIED_EVENT, adoptRemoteWrite, printOfLocal, pushToCloud, readCursor, writeCursor } from '@/lib/supabase/sync';
import { SCOPED_KEYS, isApplyingRemote } from '@/lib/storage-snapshot';
import {
  announcedFromSync,
  applyDelta,
  computeDelta,
  deviceId,
  ensureSyncKey,
  openDelta,
  rememberAnnounced,
  sealDelta,
  type Announced,
  type DeltaChange,
} from '@/lib/sync-delta';
import { noteLocalEdits } from '@/lib/sync-merge';
import { markLiveChange } from '@/lib/sync-status';
import { SYNC_NOW_EVENT } from '@/lib/sync-check';

// ============================================================
// Sincronización en vivo entre dispositivos (laptop ↔ celular ↔ tablet).
//
//   1. AL INSTANTE (1.6.8). Cada cambio del usuario viaja cifrado por el
//      canal de la cuenta (sync-delta.ts) a los ~200 ms (en una ráfaga, cada
//      medio segundo como mucho) y el otro dispositivo lo aplica sin bajar
//      nada: unos 250 ms de punta a punta.
//   2. RESPALDO. A los 600 ms del último cambio (y como mucho a los 3 s de
//      una ráfaga: antes, escribir sin pausa la posponía para siempre) se
//      sincroniza con la nube (sync.ts), que es lo que confirma y resuelve
//      los choques. Tras escribir, un «hay cambios» avisa a los demás con la
//      huella de lo escrito: quien ya lo tiene todo por el canal no baja nada;
//      los dispositivos con versiones anteriores, que solo entienden el aviso,
//      sincronizan como siempre.
//   3. RED DE SEGURIDAD. Al volver Frame al frente, al recuperar la conexión y
//      con una sonda de pocos bytes: cada 30 s mientras el canal no está
//      abierto; con él abierto, cada minuto (5 min oculta), porque los cambios
//      ya llegan por él. Con fallos seguidos, cada vez más espaciada (1.7.0:
//      con miles de equipos abiertos, la sonda de 30 s sola eran decenas de
//      millones de peticiones al mes).
//
// 1.7.2: el aviso de «hay cambios» y los cambios que no caben por el canal
// (cerrado o aún sin abrir) salen por HTTP (`httpSend`, la misma difusión de
// Realtime pero por petición). Lo que Diego vio el 13-oct: tocar el corazón
// en el celular y bloquearlo en el acto cerraba su canal antes de avisar, la
// laptop solo se enteraba con la sonda de 5 min y parecía que «no se
// sincronizaba». Ahora el aviso llega aunque el canal del que escribe esté
// caído; si el caído es el del que recibe, Realtime lo reconecta en ~30 s y
// la sonda del minuto lo cubre.
//
// Todo esto lo ejercita scripts/probar-sincronizacion.mjs con dos y tres
// dispositivos simulados (y uno con la 1.6.7).
// ============================================================

const DELTA_DEBOUNCE_MS = 200;
const DELTA_MAX_WAIT_MS = 500;
const LOCAL_DEBOUNCE_MS = 600;
const LOCAL_MAX_WAIT_MS = 3000;
const REMOTE_DELAY_MS = 150;
const PROBE_MS = 30_000;
/** Con el canal abierto la sonda es solo la red de seguridad (un aviso
 *  perdido tarda como mucho esto en notarse). */
const PROBE_READY_MS = 60_000;
const PROBE_READY_HIDDEN_MS = 5 * 60_000;
const PROBE_MAX_MS = 10 * 60_000;
/** Avisos de fuera que se atienden al momento por minuto; el resto, al final. */
const NUDGE_BURST = 20;
const NUDGE_WINDOW_MS = 60_000;
/** Volver a crear el canal a mano (al volver a la app, al recuperar la red o
 *  al despertar el equipo), como mucho una vez cada 5 s. Hasta la 1.7.2 era
 *  una vez por minuto contado desde la ÚLTIMA conexión: un celular bloqueado y
 *  desbloqueado antes de ese minuto volvía sin canal y lo que cambiaba en la
 *  laptop tardaba de 30 a 60 s (la sonda) en llegar; parecía que no llegaba.
 *  Son acciones del usuario, no llegan todas a la vez tras una caída. */
const RECONNECT_GAP_MS = 5_000;
/** Tras estar oculta tanto, el canal no es de fiar aunque diga estar abierto
 *  (Android congela la app y el socket puede llevar un rato muerto). */
const HIDDEN_STALE_MS = 15_000;
/** Si el temporizador de la sonda llega con este retraso, el equipo durmió. */
const SLEEP_GAP_MS = 2 * PROBE_MS;

export function startLiveSync(uid: string): () => void {
  let stopped = false;
  let timer: number | null = null;
  let timerAt = 0;
  let deltaTimer: number | null = null;
  /** Primer cambio aún sin sincronizar / sin anunciar (para las esperas máximas). */
  let pendingSince: number | null = null;
  let deltaSince: number | null = null;
  let running = false;
  let again = false;
  let channel: RealtimeChannel | null = null;
  let channelReady = false;
  const dirty = new Set<string>();
  let announced: Announced | null = announcedFromSync(uid);
  const me = deviceId();
  let failures = 0;
  let lastRunAt = Date.now();
  let lastOkAt = 0;
  const nudgeTimes: number[] = [];

  const run = async () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    pendingSince = null;
    lastRunAt = Date.now();
    // Lo pendiente de anunciar, antes: así la sincronización ve cuándo se hizo
    // cada cambio y el otro dispositivo recibe la misma marca por el canal.
    flushLocal();
    try {
      const result = await pushToCloud(uid);
      if (result.ok) {
        failures = 0;
        lastOkAt = Date.now();
        // Lo que la nube ya tiene cuenta como anunciado; y si la cuenta aún no
        // tiene clave para los cambios al instante, se crea (viaja en el
        // siguiente ciclo).
        announced = announcedFromSync(uid);
        ensureSyncKey(uid);
      }
      // Llegó algo de otro dispositivo: la interfaz viva relee el disco.
      if (result.applied) window.dispatchEvent(new Event(CLOUD_APPLIED_EVENT));
      // Subimos algo nuevo: que los otros dispositivos lo traigan ya (o que
      // comprueben con la huella que ya lo tienen). Siempre por HTTP: un canal
      // que se cree abierto puede estar muerto (el celular tras la pantalla
      // apagada) y el aviso se perdería sin ruido.
      if (result.ok && result.wrote && channel) {
        void broadcast('changed', { at: Date.now(), from: me, u: result.remoteAt, p: result.print }, true);
      }
      if (!result.ok) failures += 1;
    } catch {
      failures += 1; // el siguiente disparo lo reintenta
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        schedule(300);
      }
    }
  };

  /** Programa la sincronización completa; `local`: viene de un cambio del usuario. */
  const schedule = (delay: number, local = false) => {
    if (stopped) return;
    if (local) {
      const now = Date.now();
      pendingSince ??= now;
      delay = Math.min(delay, Math.max(0, pendingSince + LOCAL_MAX_WAIT_MS - now));
    }
    if (timer !== null) window.clearTimeout(timer);
    timerAt = Date.now() + delay;
    timer = window.setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };

  /** Sin retrasar lo ya programado antes (a diferencia de `schedule`, que pospone). */
  const scheduleBy = (delay: number) => {
    if (timer !== null && timerAt <= Date.now() + delay) return;
    schedule(delay);
  };

  /**
   * Un aviso de fuera («hay cambios», o un cambio que no se pudo leer). El
   * canal de la cuenta es público para quien sepa su nombre: alguien podría
   * mandar avisos sin parar. Hasta 20 por minuto se atienden al momento (el
   * uso real, incluso con versiones anteriores, queda muy por debajo); los
   * demás se juntan en una sola sincronización al final del minuto.
   */
  const remoteNudge = () => {
    const now = Date.now();
    while (nudgeTimes.length > 0 && now - nudgeTimes[0] > NUDGE_WINDOW_MS) nudgeTimes.shift();
    if (nudgeTimes.length < NUDGE_BURST) {
      nudgeTimes.push(now);
      scheduleBy(REMOTE_DELAY_MS);
      return;
    }
    scheduleBy(nudgeTimes[0] + NUDGE_WINDOW_MS - now);
  };

  /**
   * Un mensaje a los otros dispositivos: por el canal si está abierto, y si
   * no (o si se pide `viaHttp`), por la difusión HTTP de Realtime, que no
   * depende del estado del canal de este dispositivo.
   */
  const broadcast = async (event: 'changed' | 'delta', payload: object, viaHttp = false) => {
    if (!channel || stopped) return;
    try {
      if (!viaHttp && channelReady) await channel.send({ type: 'broadcast', event, payload });
      else if (typeof channel.httpSend === 'function') await channel.httpSend(event, payload);
      else await channel.send({ type: 'broadcast', event, payload });
    } catch {
      /* sin red o difusión caída: la sonda y el siguiente aviso lo cubren */
    }
  };

  // --- 1. Al instante: los cambios, cifrados, por el canal ---
  const sendDelta = async (changes: DeltaChange[]) => {
    const sealed = await sealDelta(uid, changes);
    if (sealed) void broadcast('delta', sealed);
  };

  /**
   * Lo cambiado aquí desde lo último anunciado: se anota cuándo se hizo
   * (sync-merge.ts, también sin conexión) y viaja si el canal está abierto.
   */
  const flushLocal = () => {
    if (deltaTimer !== null) window.clearTimeout(deltaTimer);
    deltaTimer = null;
    deltaSince = null;
    if (stopped || dirty.size === 0) return;
    announced ??= announcedFromSync(uid);
    if (!announced) return; // sin primera sincronización: todo viaja con ella
    const keys = [...dirty];
    dirty.clear();
    const changes = noteLocalEdits(uid, computeDelta(uid, keys, announced, new Date().toISOString()));
    if (changes.length > 0 && channel) void sendDelta(changes);
  };

  const receiveDelta = async (payload: unknown) => {
    const changes = await openDelta(uid, payload);
    if (!changes) {
      // No se pudo leer (otra clave, aún sin la de la cuenta): que llegue por la nube.
      remoteNudge();
      return;
    }
    if (changes.length === 0) return;
    const cursor = readCursor(uid);
    const wasSynced = cursor !== null && cursor.localPrint === printOfLocal(uid);
    const applied = applyDelta(uid, changes);
    if (applied.length === 0) {
      schedule(REMOTE_DELAY_MS);
      return;
    }
    if (announced) rememberAnnounced(announced, applied);
    // Si aquí no había nada pendiente, lo aplicado no es un cambio propio que
    // haya que subir: lo sube quien lo hizo. Así los dos no escriben lo mismo.
    if (wasSynced && cursor) writeCursor(uid, { ...cursor, localPrint: printOfLocal(uid) });
    markLiveChange();
    window.dispatchEvent(new Event(CLOUD_APPLIED_EVENT));
    // Lo que no se aplicó (había un cambio propio pendiente) lo resuelve la fusión.
    if (applied.length < changes.length) schedule(REMOTE_DELAY_MS);
  };

  // --- 2. Cambios locales: se vigila el propio almacenamiento ---
  const keyOf = new Map<string, string>(SCOPED_KEYS.map((key) => [`${key}_${uid}`, key]));
  const onLocalChange = (storageKey: string) => {
    const key = keyOf.get(storageKey);
    if (!key || isApplyingRemote()) return;
    dirty.add(key);
    // Como la sincronización, con espera máxima: escribir sin pausa no retiene
    // los cambios al instante hasta que el usuario pare.
    const now = Date.now();
    deltaSince ??= now;
    if (deltaTimer !== null) window.clearTimeout(deltaTimer);
    deltaTimer = window.setTimeout(flushLocal, Math.min(DELTA_DEBOUNCE_MS, Math.max(0, deltaSince + DELTA_MAX_WAIT_MS - now)));
    schedule(LOCAL_DEBOUNCE_MS, true);
  };
  const proto = Storage.prototype;
  const originalSet = proto.setItem;
  const originalRemove = proto.removeItem;
  const patchedSet = function (this: Storage, key: string, value: string) {
    originalSet.call(this, key, value);
    if (this === window.localStorage) onLocalChange(key);
  };
  const patchedRemove = function (this: Storage, key: string) {
    originalRemove.call(this, key);
    if (this === window.localStorage) onLocalChange(key);
  };
  proto.setItem = patchedSet;
  proto.removeItem = patchedRemove;

  // --- 3. El canal de la cuenta (Realtime Broadcast) ---
  const supabase = getSupabase();
  let subscribedOnce = false;
  let lastConnectAt = 0;
  const connect = () => {
    if (!supabase || stopped) return;
    try {
      channelReady = false;
      const next = supabase.channel(`frame-sync:${uid}`, { config: { broadcast: { self: false } } });
      next.on('broadcast', { event: 'changed' }, (message) => {
        const payload = message.payload as { from?: string; u?: unknown; p?: unknown } | undefined;
        if (payload?.from === me) return;
        // Lo que escribió ya llegó entero por el canal: nada que bajar.
        if (!running && typeof payload?.u === 'string' && typeof payload.p === 'string' && adoptRemoteWrite(uid, payload.u, payload.p)) return;
        remoteNudge();
      });
      next.on('broadcast', { event: 'delta' }, (message) => void receiveDelta(message.payload));
      next.subscribe((status) => {
        channelReady = status === 'SUBSCRIBED';
        // Al (re)conectar se pone al día: pudo perderse un aviso mientras tanto.
        // Tras una caída del servicio todos vuelven a la vez: un azar de hasta
        // 3 s reparte las sincronizaciones en vez de llegar todas juntas.
        if (channelReady) {
          scheduleBy(subscribedOnce ? REMOTE_DELAY_MS + Math.floor(Math.random() * 3000) : REMOTE_DELAY_MS);
          subscribedOnce = true;
        }
      });
      channel = next;
      lastConnectAt = Date.now();
    } catch {
      channel = null;
    }
  };
  connect();

  /** Canal nuevo (el viejo se suelta). Si el anterior se creó hace menos de
   *  5 s, se reintenta al cumplirse ese respiro si para entonces sigue sin
   *  abrirse (sin esto, despertar justo tras una reconexión dejaba la app sin
   *  canal hasta la sonda siguiente: lo encontró la prueba de playlists). */
  let reconnectTimer: number | null = null;
  const reconnect = (): void => {
    if (!supabase || stopped) return;
    const wait = lastConnectAt + RECONNECT_GAP_MS - Date.now();
    if (wait > 0) {
      reconnectTimer ??= window.setTimeout(() => {
        reconnectTimer = null;
        if (!channelReady) reconnect();
      }, wait);
      return;
    }
    if (channel) void supabase.removeChannel(channel).catch(() => undefined);
    channel = null;
    connect();
  };

  // --- 4. Red de seguridad ---
  let hiddenAt: number | null = document.visibilityState === 'visible' ? null : Date.now();
  const onVisible = () => {
    if (document.visibilityState !== 'visible') {
      hiddenAt ??= Date.now();
      // A segundo plano: lo pendiente sale ya, sin esperar a la pausa (Android
      // puede congelar la app en cuanto deja de verse).
      if (pendingSince !== null || dirty.size > 0) schedule(0);
      return;
    }
    // Android duerme el canal con la app en segundo plano: al volver, uno nuevo
    // si no está abierto o si estuvo oculta un buen rato (puede decir que está
    // abierto y llevar muerto desde que se congeló). La sincronización de
    // abajo trae lo que cambió mientras tanto.
    const hiddenFor = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (!channelReady || hiddenFor >= HIDDEN_STALE_MS) reconnect();
    schedule(200);
  };
  // En Windows la ventana recibe el foco a cada rato (al cambiar de ventana):
  // con el canal abierto y una sincronización buena hace menos de 20 s, nada.
  const onFocus = () => {
    if (channelReady && Date.now() - lastOkAt < 20_000) return;
    onVisible();
  };
  const onOnline = () => {
    if (!channelReady) reconnect();
    schedule(200);
  };
  // «Sincronizar ahora» del verificador de sincronización.
  const onNow = () => schedule(0);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  window.addEventListener(SYNC_NOW_EVENT, onNow);
  const probeEvery = () => {
    const visible = document.visibilityState === 'visible';
    // Sin canal: visible cada 30 s, oculta cada 2 min (Android congela lo de fondo).
    const base = channelReady ? (visible ? PROBE_READY_MS : PROBE_READY_HIDDEN_MS) : visible ? PROBE_MS : 4 * PROBE_MS;
    // Con fallos seguidos (sesión caducada, base en solo lectura…), cada vez más
    // espaciada; un éxito, la conexión o volver a la ventana lo devuelven al ritmo normal.
    return failures > 0 ? Math.max(base, Math.min(PROBE_MAX_MS, PROBE_MS * 2 ** failures)) : base;
  };
  // Si el temporizador llega muy tarde, el equipo estuvo suspendido (la tapa
  // cerrada): el canal no es de fiar y lo de los demás no llegó. Canal nuevo y
  // puesta al día, sin esperar a la próxima sonda.
  let lastTickAt = Date.now();
  const interval = window.setInterval(() => {
    const now = Date.now();
    const slept = now - lastTickAt >= SLEEP_GAP_MS;
    lastTickAt = now;
    if (slept) {
      reconnect();
      schedule(0);
      return;
    }
    if (now - lastRunAt >= probeEvery() - 1000) schedule(0);
  }, PROBE_MS);

  // Primera puesta al día al arrancar.
  schedule(800);

  return () => {
    stopped = true;
    if (timer !== null) window.clearTimeout(timer);
    if (deltaTimer !== null) window.clearTimeout(deltaTimer);
    if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('online', onOnline);
    window.removeEventListener(SYNC_NOW_EVENT, onNow);
    if (proto.setItem === patchedSet) proto.setItem = originalSet;
    if (proto.removeItem === patchedRemove) proto.removeItem = originalRemove;
    if (channel && supabase) void supabase.removeChannel(channel).catch(() => undefined);
  };
}
