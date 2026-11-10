import { getSupabase } from './client';
import { collectLocalData, applyLocalData, type LocalSnapshot } from '@/lib/storage-snapshot';
import {
  buildLocalState,
  mergeStates,
  normalizeRemote,
  commitState,
  fingerprint,
  localStatePrint,
  statePrint,
  withForeign,
  type SyncState,
} from '@/lib/sync-merge';
import { isAccountDeletionInProgress } from '@/lib/account-deletion';
import { markSyncResult, markSyncStarted } from '@/lib/sync-status';
import { tr } from '@/lib/i18n';

const TABLE = 'backups';

// ============================================================
// Sincronización con la nube, en FUSIÓN — no en sobrescritura.
//
// Cada ciclo es leer → fusionar → escribir con control de concurrencia:
//
//   1. Se lee la fila remota junto con su `updated_at`.
//   2. Se fusiona registro a registro con el estado local (ver sync-merge.ts).
//   3. Se escribe CONDICIONANDO a que `updated_at` siga siendo el que se leyó.
//      Si otro dispositivo escribió mientras tanto, la condición no encaja, no
//      se escribe nada y se reintenta con el estado ya actualizado.
//
// El paso 3 es lo que evita que dos dispositivos se pisen: sin él, dos
// fusiones simultáneas escribirían la última y perderían la otra. El resultado
// fusionado se aplica también en local, así que ambos equipos convergen.
//
// EL CICLO OCIOSO NO CUESTA NADA: un CURSOR guarda la fecha de la fila que
// dejamos en la nube y la huella de lo local en ese momento; si ninguna de
// las dos cambió, el ciclo termina tras una sonda de unos pocos bytes.
//
// 1.6.8, tres reglas nuevas que evitan bajar y subir el respaldo entero sin
// necesidad (en una cuenta con uso eran ~390 KB de ida y otros tantos de
// vuelta por cada cambio):
//   · SOLO SUBIR: si la nube sigue como la dejamos y solo cambió lo local, lo
//     local YA es la fusión: se sube sin bajar nada antes.
//   · NO REESCRIBIR LO QUE YA ESTÁ: si lo fusionado es igual a lo que hay en
//     la nube (huella canónica), no se escribe. Hasta la 1.6.7 cada
//     dispositivo volvía a subir lo que acababa de bajar, y como cada subida
//     avisa a los demás, dos dispositivos abiertos se reenviaban el respaldo
//     sin parar.
//   · El estado de cada intento se publica (sync-status.ts): el verificador
//     de sincronización lo enseña y un fallo repetido llega al registro de
//     errores, en vez de fallar en silencio.
// ============================================================

const MAX_ATTEMPTS = 4;

interface RemoteRow {
  data: unknown;
  updated_at: string | null;
}

interface SyncCursor {
  /** `updated_at` de la fila tal como quedó tras nuestra última sincronización. */
  remoteAt: string | null;
  /** Huella de los datos locales en ese mismo instante. */
  localPrint: string;
  /** Huella canónica (statePrint) de lo que la fila tiene en `remoteAt`, si se conoce. */
  cloudPrint?: string;
}

export interface SyncResult {
  ok: boolean;
  /** Llegó algo de otro dispositivo y cambió lo de aquí. */
  applied: boolean;
  error: string | null;
  /** Se escribió en la nube (hay algo nuevo que los otros dispositivos deben traer). */
  wrote?: boolean;
  /** Si se escribió: la fecha que quedó en la fila y la huella de lo escrito. */
  remoteAt?: string;
  print?: string;
}

const cursorKey = (uid: string) => `syncCursor_${uid}`;

export function readCursor(uid: string): SyncCursor | null {
  try {
    const raw = localStorage.getItem(cursorKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncCursor>;
    if (typeof parsed?.localPrint !== 'string') return null;
    const cursor: SyncCursor = { remoteAt: parsed.remoteAt ?? null, localPrint: parsed.localPrint };
    if (typeof parsed.cloudPrint === 'string') cursor.cloudPrint = parsed.cloudPrint;
    return cursor;
  } catch {
    return null;
  }
}

export function writeCursor(uid: string, cursor: SyncCursor): void {
  try {
    localStorage.setItem(cursorKey(uid), JSON.stringify(cursor));
  } catch {
    /* sin cursor el próximo ciclo será completo: más caro, igual de correcto */
  }
}

export const sameInstant = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null) return a === b;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return !Number.isNaN(ta) && ta === tb;
};

export const printOfLocal = (uid: string): string => fingerprint(JSON.stringify(collectLocalData(uid)));

/** Un ciclo completo de sincronización: leer, fusionar y escribir. */
async function syncOnce(uid: string): Promise<SyncResult> {
  const supabase = getSupabase();
  if (!supabase) return { ok: false, applied: false, error: tr('Supabase no está configurado.') };
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { ok: false, applied: false, error: tr('Sin conexión.') };
  }

  // `getSession` lee la sesión guardada en el equipo; `getUser` hacía una
  // petición al servidor en CADA ciclo solo para confirmar lo que ya se sabía.
  // La autoridad real es la RLS de la tabla: con un token ajeno no escribe.
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionData.session?.user?.id !== uid) {
    // Sin sesión porque no se pudo RENOVAR (la red no contestó): la sesión
    // sigue guardada y volverá con la red. Decir «sesión inválida» mandaba a
    // volver a entrar sin motivo, y contaba como un fallo que no era.
    const status = (sessionError as { status?: number } | null | undefined)?.status;
    if (!sessionData.session && sessionError && (sessionError.name === 'AuthRetryableFetchError' || status === 0)) {
      return { ok: false, applied: false, error: sessionError.message || 'Failed to fetch' };
    }
    return { ok: false, applied: false, error: tr('Sesión inválida.') };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const now = new Date().toISOString();
    const localData = collectLocalData(uid);
    const localPrint = fingerprint(JSON.stringify(localData));

    // --- Sonda: ¿ha cambiado algo, aquí o allí, desde la última vez? ---
    const cursor = readCursor(uid);
    let remoteUnchanged = false;
    let probedAt: string | null = null;
    if (cursor) {
      const { data: probe, error: probeError } = await supabase
        .from(TABLE)
        .select('updated_at')
        .eq('user_id', uid)
        .maybeSingle<{ updated_at: string | null }>();
      if (probeError) return { ok: false, applied: false, error: probeError.message };
      // Se comparan INSTANTES, no cadenas: Postgres devuelve la fecha como
      // «…+00:00» y aquí se guardó como «…Z»; son el mismo momento.
      if (probe && sameInstant(probe.updated_at, cursor.remoteAt)) {
        remoteUnchanged = true;
        probedAt = probe.updated_at;
        if (cursor.localPrint === localPrint) return { ok: true, applied: false, error: null, wrote: false };
      }
    }

    // Mientras se sondeaba pudo llegar (y aplicarse) un cambio de otro
    // dispositivo por el canal: `localData` es de antes, pero la contabilidad
    // ya lo cuenta. Construir el estado con los dos desfasados RESUCITABA lo
    // que el otro acababa de borrar (y lapidaba lo que acababa de añadir): el
    // registro ya no estaba en la foto de referencia y lo local lo tenía, así
    // que parecía nuevo (lo encontró la prueba del corazón, 14-oct). Con lo
    // local cambiado, la vuelta empieza de nuevo con datos frescos.
    if (printOfLocal(uid) !== localPrint) continue;

    // --- Solo subir: la nube sigue como la dejamos, así que lo local con sus
    //     marcas nuevas ES la fusión. No hace falta bajar nada. ---
    if (remoteUnchanged && cursor) {
      // Con lo que la nube tiene de versiones más nuevas: subir sin ello lo borraría.
      const local = withForeign(uid, buildLocalState(uid, localData, now));
      const print = statePrint(local);
      // Lo de aquí solo cambió de forma (el orden de una lista, al reescribirla
      // la interfaz): la nube ya tiene exactamente esto.
      if (cursor.cloudPrint === print) {
        writeCursor(uid, { ...cursor, localPrint });
        return { ok: true, applied: false, error: null, wrote: false };
      }
      const guarded =
        probedAt === null
          ? supabase.from(TABLE).update({ data: local, updated_at: now }).eq('user_id', uid).is('updated_at', null)
          : supabase.from(TABLE).update({ data: local, updated_at: now }).eq('user_id', uid).eq('updated_at', probedAt);
      const { data: written, error } = await guarded.select('user_id');
      if (error) return { ok: false, applied: false, error: error.message };
      if (written && written.length > 0) {
        commitState(uid, local);
        // La huella de lo que se SUBIÓ, no la de ahora: si el usuario cambió algo
        // mientras tanto, el ciclo siguiente lo verá distinto y lo subirá.
        writeCursor(uid, { remoteAt: now, localPrint, cloudPrint: print });
        return { ok: true, applied: false, error: null, wrote: true, remoteAt: now, print };
      }
      // Otro dispositivo escribió justo entre la sonda y la escritura: fusión completa.
    }

    const { data: row, error: readError } = await supabase
      .from(TABLE)
      .select('data, updated_at')
      .eq('user_id', uid)
      .maybeSingle<RemoteRow>();
    if (readError) return { ok: false, applied: false, error: readError.message };

    // Lo mismo tras la lectura: datos y contabilidad del mismo instante.
    if (printOfLocal(uid) !== localPrint) continue;
    const local = withForeign(uid, buildLocalState(uid, localData, now));
    const remote = row ? normalizeRemote(row.data, row.updated_at) : null;
    const merged: SyncState = remote ? mergeStates(local, remote, now) : local;
    // Lo fusionado ya es lo que hay en la nube: nada que escribir.
    const mergedPrint = statePrint(merged);
    const alreadyThere = remote !== null && mergedPrint === statePrint(remote);

    if (!row) {
      // Primera vez para este usuario: no hay fila que proteger.
      const { error } = await supabase
        .from(TABLE)
        .upsert({ user_id: uid, data: merged as unknown, updated_at: now }, { onConflict: 'user_id' });
      if (error) return { ok: false, applied: false, error: error.message };
    } else if (!alreadyThere) {
      // Escritura condicionada: solo si nadie tocó la fila mientras fusionábamos.
      const payload = { data: merged as unknown, updated_at: now };
      const guarded =
        row.updated_at === null
          ? supabase.from(TABLE).update(payload).eq('user_id', uid).is('updated_at', null)
          : supabase.from(TABLE).update(payload).eq('user_id', uid).eq('updated_at', row.updated_at);

      const { data: written, error } = await guarded.select('user_id');
      if (error) return { ok: false, applied: false, error: error.message };

      if (!written || written.length === 0) {
        // Otro dispositivo se adelantó: se vuelve a leer y a fusionar.
        if (attempt === MAX_ATTEMPTS) {
          return { ok: false, applied: false, error: tr('La nube cambió mientras se sincronizaba; se reintentará luego.') };
        }
        await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
        continue;
      }
    }

    // ¿Tocó algo el usuario mientras hablábamos con la nube? Entonces lo
    // fusionado ya es viejo: volcarlo en disco PISARÍA ese cambio (la interfaz
    // lo tiene en memoria, pero el disco y la foto de referencia no, y en la
    // vuelta siguiente se daría por borrado). Se repite el ciclo con lo nuevo.
    if (printOfLocal(uid) !== localPrint) {
      if (attempt === MAX_ATTEMPTS) {
        return { ok: false, applied: false, error: tr('Los datos cambiaron mientras se sincronizaba; se reintentará luego.') };
      }
      continue;
    }

    // El resultado fusionado manda también en local: así este dispositivo ve
    // enseguida lo que hizo el otro, sin esperar a una bajada aparte.
    const outcome = applyLocalData(uid, merged.data as LocalSnapshot);
    if (!outcome.ok) {
      // Sin espacio en disco NO se da por sincronizado: fijar la foto de
      // referencia sobre un volcado a medias convertiría lo que faltó en
      // "borrado por el usuario" en el ciclo siguiente.
      return { ok: false, applied: false, error: tr('No hay espacio en el equipo para guardar lo que llegó de la nube.') };
    }
    commitState(uid, merged);
    const wrote = !row || !alreadyThere;
    writeCursor(uid, { remoteAt: wrote ? now : row.updated_at, localPrint: printOfLocal(uid), cloudPrint: mergedPrint });
    return wrote
      ? { ok: true, applied: outcome.changed, error: null, wrote, remoteAt: now, print: mergedPrint }
      : { ok: true, applied: outcome.changed, error: null, wrote };
  }

  return { ok: false, applied: false, error: tr('No se pudo sincronizar.') };
}

/**
 * Otro dispositivo acaba de escribir en la nube (su aviso trae la fecha que
 * dejó en la fila y la huella de lo que escribió). Si lo de aquí ya es
 * EXACTAMENTE eso, porque sus cambios llegaron uno a uno por el canal, se da
 * por sincronizado sin bajar el respaldo entero. Si algo no encaja (un cambio
 * propio sin subir, un mensaje perdido, un tercer dispositivo), devuelve false
 * y toca la sincronización completa de siempre.
 */
export function adoptRemoteWrite(uid: string, remoteAt: string, print: string): boolean {
  const cursor = readCursor(uid);
  if (!cursor) return false;
  const data = collectLocalData(uid);
  const localPrint = fingerprint(JSON.stringify(data));
  if (cursor.localPrint !== localPrint || localStatePrint(uid, data) !== print) return false;
  writeCursor(uid, { remoteAt, localPrint, cloudPrint: print });
  return true;
}

// ------------------------------------------------------------
// Testigo del respaldo
//
// Sincronizar en silencio tiene un problema: si lleva días fallando, el
// usuario cree que está a salvo cuando no lo está. Se deja constancia de
// cada intento para poder decírselo (y desde la 1.6.8 se publica en vivo).
// ------------------------------------------------------------
interface StoredSyncStatus {
  lastOkAt: string | null;
  lastTryAt: string | null;
  lastError: string | null;
}

const syncStatusKey = (uid: string) => `syncStatus_${uid}`;

function recordSyncAttempt(uid: string, ok: boolean, error: string | null): void {
  markSyncResult(ok, error);
  try {
    const now = new Date().toISOString();
    const raw = localStorage.getItem(syncStatusKey(uid));
    const previous = (raw ? JSON.parse(raw) : {}) as Partial<StoredSyncStatus>;
    const next: StoredSyncStatus = {
      lastOkAt: ok ? now : previous.lastOkAt ?? null,
      lastTryAt: now,
      lastError: ok ? null : error,
    };
    localStorage.setItem(syncStatusKey(uid), JSON.stringify(next));
  } catch {
    /* si ni esto cabe, el aviso de cuota ya habrá saltado */
  }
}

async function run(uid: string): Promise<SyncResult> {
  markSyncStarted();
  let result: SyncResult;
  try {
    result = await syncOnce(uid);
  } catch (error) {
    // Un fallo inesperado (red cortada a media respuesta, JSON ilegible…)
    // también se cuenta: antes se tragaba sin dejar rastro.
    result = { ok: false, applied: false, error: error instanceof Error ? error.message : String(error) };
  }
  recordSyncAttempt(uid, result.ok, result.error);
  return result;
}

/**
 * Sube los cambios locales fusionándolos con lo que haya en la nube.
 * Conserva el nombre de siempre: lo llaman el ciclo automático, el cierre de
 * sesión y la creación de perfil.
 */
export async function pushToCloud(uid: string): Promise<SyncResult> {
  // Cuenta en proceso de borrado: nada vuelve a escribir en la nube.
  if (isAccountDeletionInProgress()) return { ok: false, applied: false, error: null };
  return run(uid);
}

/**
 * Aviso a la interfaz viva de que el disco cambió por debajo de ella (llegó
 * algo de otro dispositivo). Sin él, el proveedor de datos seguiría con su
 * copia en memoria y la volvería a escribir encima en su siguiente guardado,
 * deshaciendo lo que acaba de llegar.
 */
export { CLOUD_APPLIED_EVENT } from '@/lib/sync-merge';

/**
 * Trae lo que haya en la nube fusionándolo con lo local. Es el MISMO ciclo:
 * bajar sin fusionar destruiría el trabajo hecho sin conexión.
 */
export async function pullFromCloud(uid: string): Promise<SyncResult> {
  return run(uid);
}
