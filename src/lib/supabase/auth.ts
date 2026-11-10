import type { Session, SupabaseClient, User, AuthChangeEvent } from '@supabase/supabase-js';
import { getRecoveryClient, getSupabase } from './client';
import { removeCloudImages } from '@/lib/image-sync';
import { markDeviceUnlinked } from '@/lib/devices';
import { getLang, tr } from '@/lib/i18n';

const siteUrl =
  import.meta.env.VITE_SITE_URL ||
  (typeof window !== 'undefined' ? window.location.origin : '');

/**
 * Los mensajes de Supabase llegan en inglés y pensados para quien programa.
 * Un estudiante que ve «Invalid login credentials» no sabe si se equivocó él
 * o se rompió la app: aquí se traducen a lo que tiene que hacer.
 */
export function describeAuthError(message: string | null | undefined): string {
  const raw = (message ?? '').trim();
  const m = raw.toLowerCase();
  if (!raw) return tr('Algo salió mal. Inténtalo de nuevo.');
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit'))
    return tr('Ahora mismo no se pueden enviar más correos de confirmación. Espera una hora o entra con Google, que no necesita correo.');
  if (m.includes('rate limit') || m.includes('too many requests'))
    return tr('Demasiados intentos seguidos. Espera un par de minutos y vuelve a probar.');
  if (m.includes('invalid login credentials')) return tr('Correo o contraseña incorrectos.');
  if (m.includes('email not confirmed'))
    return tr('Tu correo aún no está confirmado: abre el enlace que te enviamos (mira también en spam).');
  if (m.includes('already registered') || m.includes('already been registered') || m.includes('user already'))
    return tr('Ese correo ya tiene una cuenta. Inicia sesión en lugar de registrarte.');
  if (m.includes('password should be at least') || m.includes('weak password'))
    return tr('La contraseña debe tener al menos 6 caracteres.');
  if (m.includes('unable to validate email') || m.includes('invalid email'))
    return tr('Ese correo no parece válido. Revísalo.');
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return tr('El registro de cuentas nuevas está desactivado por ahora.');
  if (m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed') || m.includes('network request'))
    return tr('No se pudo contactar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.');
  if (m.includes('id token') || m.includes('audience'))
    return tr('Google respondió, pero el servidor de Frame no aceptó la identidad. Inténtalo de nuevo en un minuto.');
  return raw;
}

interface AuthResult {
  user: User | null;
  session: Session | null;
  error: string | null;
}

interface PersonNames {
  firstNames: string;
  lastNames: string;
}

/** Espacios de más fuera: «  Rojas   Gaspar » → «Rojas Gaspar». */
export const tidyName = (value: string) => value.replace(/\s+/g, ' ').trim();

/**
 * «Acaba de entrar esta sesión»: lo dice quien la abrió (este archivo), con la
 * sesión en la mano. El controlador de la app la hidrata con esto, sin
 * depender del aviso SIGNED_IN de supabase-js: ese aviso se queda en cola
 * mientras la biblioteca termina de arrancar (hasta medio minuto si arranca
 * renovando la sesión anterior en una red que no contesta), y mientras tanto
 * el botón de entrar giraba con la sesión ya abierta.
 */
export const SESSION_OPENED_EVENT = 'frame:session-opened';
/** La sesión entró, pero la app no pudo abrirla (el equipo sin espacio…): el acceso deja de girar y lo dice. */
export const SESSION_OPEN_FAILED_EVENT = 'frame:session-open-failed';

function announceSession(session: Session | null): void {
  if (!session?.user || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<Session>(SESSION_OPENED_EVENT, { detail: session }));
}

/** Un fallo que no llegó como respuesta (red cortada a media lectura…): se devuelve, nunca se lanza. */
const thrownMessage = (e: unknown) => String((e as { message?: string } | null)?.message ?? e);

export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
  names?: PersonNames
): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null, error: tr('Supabase no está configurado.') };

  const metadata: Record<string, string> = { username: username.trim() };
  if (names) {
    metadata.first_names = tidyName(names.firstNames);
    metadata.last_names = tidyName(names.lastNames);
    metadata.full_name = `${metadata.first_names} ${metadata.last_names}`.trim();
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: metadata },
    });

    // Con la confirmación por correo activa, Supabase no dice «ya existe» (para
    // no revelar cuentas): devuelve un usuario fantasma sin identidades.
    if (!error && data.user && (data.user.identities?.length ?? 0) === 0) {
      return { user: null, session: null, error: 'User already registered' };
    }

    if (!error) announceSession(data.session);
    return { user: data.user, session: data.session, error: error?.message ?? null };
  } catch (e) {
    return { user: null, session: null, error: thrownMessage(e) };
  }
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null, error: tr('Supabase no está configurado.') };

  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) announceSession(data.session);
    return { user: data.user, session: data.session, error: error?.message ?? null };
  } catch (e) {
    return { user: null, session: null, error: thrownMessage(e) };
  }
}

/** Página de la web donde se elige la contraseña nueva. Desde la 1.7.3, la web
 *  oficial de Asvent (`vt-asvent/frame-app`); la vieja sigue como espejo y
 *  Supabase admite las dos en sus *Redirect URLs*. */
const PASSWORD_RECOVERY_URL = 'https://vt-asvent.github.io/frame-app/recuperar/';

/**
 * Envía el correo para elegir una contraseña nueva. Supabase no dice si el
 * correo tiene cuenta (para no revelarlo): la respuesta es la misma.
 */
export async function requestPasswordReset(email: string): Promise<{ error: string | null }> {
  const supabase = getRecoveryClient();
  if (!supabase) return { error: tr('Supabase no está configurado.') };
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: PASSWORD_RECOVERY_URL });
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: thrownMessage(e) };
  }
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: tr('Supabase no está configurado.') };

  try {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: siteUrl,
        queryParams: { prompt: 'select_account', hl: getLang() },
      },
    });
    return { error: error?.message ?? null };
  } catch (e) {
    return { error: thrownMessage(e) };
  }
}

// Inicia sesión en Supabase con un id_token de Google obtenido por el flujo
// OAuth nativo de la app de escritorio (PKCE + loopback).
export async function signInWithGoogleIdToken(idToken: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null, error: tr('Supabase no está configurado.') };

  // Una red de colegio parpadea: solo se repite lo que es fallo de red o del
  // servidor, nunca un «no» de Supabase (repetirlo no cambiaría la respuesta).
  // Y no más allá de medio minuto: con la red colgada cada intento agota su
  // plazo, y cinco seguidos eran minuto y medio de botón girando sin decir nada.
  let lastError: string | null = null;
  const startedAt = Date.now();
  for (const delay of [0, 1000, 2500, 5000, 8000]) {
    if (delay && Date.now() - startedAt + delay > 30_000) break;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (!error) {
        announceSession(data.session);
        return { user: data.user, session: data.session, error: null };
      }
      lastError = error.message;
      const status = (error as { status?: number }).status ?? 0;
      const retryable =
        error.name === 'AuthRetryableFetchError' ||
        status === 0 ||
        status >= 500 ||
        /failed to fetch|network|timeout|fetch/i.test(error.message);
      if (!retryable) break;
    } catch (e: any) {
      lastError = String(e?.message ?? e);
    }
  }
  return { user: null, session: null, error: lastError };
}

// Cierre de sesión PEDIDO por el usuario. El controlador de la app distingue
// así un «Cerrar sesión» de una sesión que la nube cerró por su cuenta: en el
// segundo caso no echa al usuario de la app (ver connection-status.ts).
const INTENTIONAL_SIGN_OUT_KEY = 'frameIntentionalSignOut';

/** ¿El último SIGNED_OUT lo pidió el usuario? Lee y borra la marca. */
export function consumeIntentionalSignOut(): boolean {
  try {
    const at = Number(localStorage.getItem(INTENTIONAL_SIGN_OUT_KEY) ?? 0);
    localStorage.removeItem(INTENTIONAL_SIGN_OUT_KEY);
    return at > 0 && Date.now() - at < 10 * 60_000;
  } catch {
    return true;
  }
}

/** Espera a `task` como mucho `ms`: lo que tarde más sigue por detrás, sin retener a quien espera. */
export function within<T>(task: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([task, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

const AUTH_STORAGE_KEY = 'aether-auth';

/** ¿Hay una sesión guardada en este equipo? (Lo que manda: supabase-js siempre lee de ahí.) */
export function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function storedSession(): { access_token?: unknown; user?: { id?: unknown } } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as { access_token?: unknown; user?: { id?: unknown } } | null) : null;
  } catch {
    return null;
  }
}

/** La llave de acceso guardada: con ella se le pide a la nube que cierre ESA sesión. */
function storedAccessToken(): string | null {
  const token = storedSession()?.access_token;
  return typeof token === 'string' && token ? token : null;
}

/** La cuenta de la sesión guardada en este equipo, o null si no hay ninguna. */
export function storedSessionUserId(): string | null {
  const id = storedSession()?.user?.id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Le pide a la nube que cierre la sesión de esa llave (`global`: todas las de
 * la cuenta). Es una petición suelta, con su plazo, que no toca la sesión
 * guardada: llegue cuando llegue, no puede afectar a quien entre después.
 * Nunca lanza; null si se hizo (o si ya no había nada que cerrar).
 */
async function revokeSession(supabase: SupabaseClient, accessToken: string, scope: 'local' | 'global'): Promise<string | null> {
  try {
    const result = await within(supabase.auth.admin.signOut(accessToken, scope), 6000);
    if (!result) return 'timeout';
    const status = (result.error as { status?: number } | null)?.status;
    // 401, 403 y 404: esa sesión (o la cuenta) ya no existía, que es lo que se quería.
    return !result.error || status === 401 || status === 403 || status === 404 ? null : result.error.message;
  } catch (e) {
    return thrownMessage(e);
  }
}

/**
 * Cierra la sesión de ESTE equipo. Cuando vuelve, aquí ya no hay sesión, haya
 * respondido la nube o no.
 *
 * Lo que esto cierra (1.9.2):
 *   · supabase-js cierra por defecto la sesión de TODOS los equipos de la
 *     cuenta: salir en el celular dejaba a la laptop sin sesión (y sin
 *     sincronizar) hasta volver a entrar. Ahora solo la de este equipo;
 *     `everywhere` queda para cuando se borra la cuenta.
 *   · Con el token vencido y sin red, supabase-js devuelve el error SIN borrar
 *     la sesión guardada: la app mostraba el acceso, pero la sesión volvía sola
 *     en el siguiente arranque.
 *   · Su `signOut` habla con la nube ANTES de borrar la sesión de aquí. En una
 *     red que se traga los paquetes (portal del colegio) «Cerrar sesión» se
 *     quedaba girando; y si se dejaba de esperarlo, seguía vivo por detrás: al
 *     terminar borraba la sesión que hubiera en ese momento, que podía ser la
 *     de quien acababa de volver a entrar.
 *
 * Por eso el orden es el contrario y nada queda pendiente sobre la sesión
 * guardada: primero se borra aquí (sin red: `_removeSession` es el borrado de
 * la propia biblioteca, que avisa SIGNED_OUT y anula cualquier renovación en
 * marcha) y después se avisa a la nube con una petición suelta.
 *
 * Devuelve el fallo de la nube solo con `everywhere`, que es cuando se espera
 * su respuesta; en un cierre normal la nube se entera por detrás.
 */
export async function signOut(options: { everywhere?: boolean } = {}): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: null };
  try {
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(Date.now()));
  } catch {
    /* sin marca, el controlador lo tratará como cierre inesperado (no expulsa) */
  }

  // 1. Dispositivos: este equipo queda «desvinculado» en la cuenta. Necesita la
  //    sesión, así que va antes; se cancela solo si tarda (ver devices.ts).
  await within(markDeviceUnlinked(), 3000);

  // 2. Aquí: fuera ya. La llave se lee después del paso 1, que pudo renovarla.
  const accessToken = storedAccessToken();
  try {
    const auth = supabase.auth as unknown as { _removeSession?: () => Promise<void> };
    if (typeof auth._removeSession === 'function') await within(auth._removeSession(), 2000);
  } catch {
    /* se quita a mano abajo */
  }
  if (hasStoredSession()) {
    try {
      for (const suffix of ['', '-code-verifier', '-user']) localStorage.removeItem(AUTH_STORAGE_KEY + suffix);
      // Sin aviso SIGNED_OUT nadie consumió la marca: fuera, para que un
      // cierre posterior de la nube no se tome por pedido del usuario.
      localStorage.removeItem(INTENTIONAL_SIGN_OUT_KEY);
    } catch {
      /* almacenamiento vetado: nada más que hacer */
    }
  }

  // 3. En la nube: que esa sesión deje de valer.
  if (!accessToken) return { error: null };
  const revoked = revokeSession(supabase, accessToken, options.everywhere ? 'global' : 'local');
  return { error: options.everywhere ? await revoked : null };
}

export async function getActiveSession(): Promise<Session | null> {
  const supabase = getSupabase();
  if (!supabase) return null;

  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

// Sincroniza el username en el metadata de Auth y en la tabla profiles.
export async function updateUsername(username: string): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: tr('Supabase no está configurado.') };

  const trimmed = username.trim();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { error: tr('Sesión inválida.') };

  const { error: metaError } = await supabase.auth.updateUser({ data: { username: trimmed } });
  if (metaError) return { error: metaError.message };

  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: user.id, username: trimmed, updated_at: new Date().toISOString() }, { onConflict: 'id' });

  return { error: profileError?.message ?? null };
}

/** Guarda nombres y apellidos en los metadatos de la cuenta (viajan con la sesión). */
export async function updatePersonNames(names: PersonNames): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: tr('Supabase no está configurado.') };
  const first = tidyName(names.firstNames);
  const last = tidyName(names.lastNames);
  const { error } = await supabase.auth.updateUser({
    data: { first_names: first, last_names: last, full_name: `${first} ${last}`.trim() },
  });
  return { error: error?.message ?? null };
}

export function onAuthChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange((event, session) => callback(event, session));
  return () => data.subscription.unsubscribe();
}

/** `full` = se borró también la fila de `auth.users` (el RPC estaba disponible).
 *  `data-only` = solo se purgaron los datos del usuario; la cuenta sigue existiendo. */
export type DeleteAccountMode = 'full' | 'data-only';

interface DeleteAccountResult {
  mode: DeleteAccountMode;
  /** Detalle técnico del fallo parcial, o `null` si todo salió bien. */
  error: string | null;
}

/**
 * Borra la cuenta del usuario en la nube.
 *
 * 1) Intenta el RPC `delete_current_user` (SECURITY DEFINER), la ÚNICA vía sin
 *    `service_role` que elimina de verdad la fila de `auth.users`.
 * 2) Si ese RPC no está desplegado, degrada a purgar las filas del usuario en
 *    `backups`, `telemetry_*` y `profiles`, y devuelve `data-only` para que la
 *    interfaz pueda ser honesta sobre lo que realmente ocurrió.
 *
 * Nunca lanza: siempre devuelve un resultado.
 * El SQL del RPC vive en `supabase/migrations/0001_delete_current_user.sql`.
 */
export async function deleteRemoteAccount(uid: string): Promise<DeleteAccountResult> {
  const supabase = getSupabase();
  if (!supabase) return { mode: 'data-only', error: null }; // sin nube: nada que borrar

  // Sus imágenes de la nube (foto de perfil, horario, portadas) se van antes:
  // una vez borrado el usuario, ya nadie podría quitarlas.
  await removeCloudImages(uid);

  const { error: rpcError } = await supabase.rpc('delete_current_user');
  if (!rpcError) return { mode: 'full', error: null };

  // PGRST202: PostgREST no encuentra la función. 42883: undefined_function.
  const isMissing = rpcError.code === 'PGRST202' || rpcError.code === '42883';
  if (!isMissing) return { mode: 'data-only', error: rpcError.message };

  const failures: string[] = [];
  const purge = async (table: string, column: string) => {
    const { error } = await supabase.from(table).delete().eq(column, uid);
    if (error) failures.push(`${table}: ${error.message}`);
  };

  await purge('backups', 'user_id');
  await purge('telemetry_weekly', 'user_id');
  await purge('telemetry_users', 'user_id');
  await purge('profiles', 'id');

  return { mode: 'data-only', error: failures.length > 0 ? failures.join(' | ') : null };
}
