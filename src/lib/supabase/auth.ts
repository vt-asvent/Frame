import type { Session, User, AuthChangeEvent } from '@supabase/supabase-js';
import { getRecoveryClient, getSupabase } from './client';
import { removeCloudImages } from '@/lib/image-sync';
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

  return { user: data.user, session: data.session, error: error?.message ?? null };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null, error: tr('Supabase no está configurado.') };

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data.user, session: data.session, error: error?.message ?? null };
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
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: PASSWORD_RECOVERY_URL });
  return { error: error?.message ?? null };
}

export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: tr('Supabase no está configurado.') };

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: siteUrl,
      queryParams: { prompt: 'select_account', hl: getLang() },
    },
  });

  return { error: error?.message ?? null };
}

// Inicia sesión en Supabase con un id_token de Google obtenido por el flujo
// OAuth nativo de la app de escritorio (PKCE + loopback).
export async function signInWithGoogleIdToken(idToken: string): Promise<AuthResult> {
  const supabase = getSupabase();
  if (!supabase) return { user: null, session: null, error: tr('Supabase no está configurado.') };

  // Una red de colegio parpadea: solo se repite lo que es fallo de red o del
  // servidor, nunca un «no» de Supabase (repetirlo no cambiaría la respuesta).
  let lastError: string | null = null;
  for (const delay of [0, 1000, 2500, 5000, 8000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
      if (!error) return { user: data.user, session: data.session, error: null };
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

export async function signOut(): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  if (!supabase) return { error: null };
  try {
    localStorage.setItem(INTENTIONAL_SIGN_OUT_KEY, String(Date.now()));
  } catch {
    /* sin marca, el controlador lo tratará como cierre inesperado (no expulsa) */
  }

  const { error } = await supabase.auth.signOut();
  return { error: error?.message ?? null };
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
