// ============================================================
// Google OAuth 2.0 nativo para Frame (flujo "installed app"):
// PKCE + redirect a loopback (127.0.0.1) capturado por el núcleo Rust.
//
// La pantalla de Google se abre en una VENTANA DE FRAME, no en el navegador
// del sistema: entrar a la app no debería sacarte de la app ni dejarte una
// pestaña de Chrome abierta. El redirect a 127.0.0.1 lo recibe el mismo
// oyente Rust venga de donde venga la ventana, y si la ventana no pudiera
// crearse se cae al navegador: mejor un rodeo que quedarse fuera.
//
// 1.6.7: solo la identidad (openid, email, profile) para entrar en Frame.
// La vinculación por API de Gmail y Classroom se fue: pedía permisos
// restringidos y sensibles que obligan a una auditoría de Google para
// publicar el acceso. Gmail y Classroom siguen dentro de Frame con sus
// páginas reales (GoogleEmbed), que no necesitan ningún permiso.
// ============================================================
import { invoke, isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { getLang, tr } from '@/lib/i18n';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
// Para clientes OAuth de tipo "Desktop app" Google emite un client_secret que
// NO se considera confidencial (documentación oficial de installed apps).
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET as string | undefined;

export const isGoogleConfigured = Boolean(CLIENT_ID);

// Ámbitos: solo la identidad (ver la cabecera).
const IDENTITY_SCOPES = ['openid', 'email', 'profile'];

interface GoogleTokens {
  accessToken: string;
  idToken?: string;
  /** Solo con `offline` (extensión Wire). */
  refreshToken?: string;
  expiresIn?: number;
}

interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  givenName?: string;
  familyName?: string;
  picture?: string;
}

// --- Nada de Google se guarda en el equipo (1.7.0) ---
//
// Hasta la 1.6.9 se guardaban el token de acceso, el de renovación y el
// id_token de cada cuenta en localStorage, en claro, sin que nada los leyera:
// eran restos de la vinculación de Gmail y Classroom por API (retirada en la
// 1.6.7). Con el de renovación —y el secreto de cliente, que va en la app—
// cualquiera con acceso al perfil del equipo podía volver a entrar en la
// cuenta de Frame. Ahora el token solo vive en memoria durante el acceso, y al
// arrancar y al salir se borra lo que dejaron las versiones anteriores.
const STORED_PREFIXES = ['googleAccounts', 'googleIntegrationAccounts', 'googleIdentity', 'googleTokens'];

/** Borra cualquier token o cuenta de Google guardada (de cualquier perfil). */
export function disconnectGoogle() {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && STORED_PREFIXES.some((prefix) => key === prefix || key.startsWith(`${prefix}_`))) localStorage.removeItem(key);
    }
  } catch {
    /* sin almacenamiento: no hay nada que borrar */
  }
}

// --- PKCE ---

function base64Url(bytes: Uint8Array): string {
  let str = '';
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function pkcePair() {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64Url(verifierBytes);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64Url(new Uint8Array(digest));
  return { verifier, challenge };
}

// --- Flujo de autorización ---

interface AuthorizeOptions {
  scopes: string[];
  /** 'select_account' muestra el selector de cuentas de Google. */
  prompt?: string;
  loginHint?: string;
  /** Pide también el token de renovación (acceso sin conexión). Solo Wire. */
  offline?: boolean;
}

/** El usuario cerró la ventana de Google antes de terminar. */
class AuthCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'AuthCancelled';
  }
}

async function authorize({ scopes, prompt, loginHint, offline }: AuthorizeOptions): Promise<GoogleTokens> {
  if (!isTauri()) {
    throw new Error(tr('Las integraciones de Google requieren la app de escritorio Frame.'));
  }
  if (!CLIENT_ID) {
    throw new Error(tr('Falta VITE_GOOGLE_CLIENT_ID en el archivo .env.'));
  }

  const { verifier, challenge } = await pkcePair();
  const state = base64Url(crypto.getRandomValues(new Uint8Array(16)));

  // Hasta 3 intentos por si el puerto elegido está ocupado.
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 49152 + Math.floor(Math.random() * 16000);
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
      // La pantalla de Google, en el idioma de Frame (no en el de Windows).
      hl: getLang(),
    });
    if (prompt) params.set('prompt', prompt);
    if (loginHint) params.set('login_hint', loginHint);
    if (offline) params.set('access_type', 'offline');

    // 1. Armar la escucha ANTES de abrir el navegador.
    const waiter = invoke<{ params: Record<string, string> }>('oauth_wait_callback', {
      port,
      timeoutSecs: 300,
    });

    // Pequeño margen para detectar un fallo de bind inmediato.
    const bindProbe = await Promise.race([
      waiter.then(
        (r) => ({ done: true as const, result: r }),
        (e) => ({ done: true as const, error: String(e) })
      ),
      new Promise<{ done: false }>((res) => setTimeout(() => res({ done: false }), 250)),
    ]);
    if (bindProbe.done && 'error' in bindProbe && bindProbe.error) {
      lastError = bindProbe.error;
      continue; // puerto ocupado → reintenta con otro
    }

    // 2. Abrir la pantalla de Google dentro de Frame. Si el usuario cierra
    //    esa ventana sin terminar, se cancela la espera en vez de dejar el
    //    puerto ocupado cinco minutos.
    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    let stopClosedWatch: (() => void) | undefined;
    const closedByUser = new Promise<never>((_, reject) => {
      void listen('auth-window-closed', () => reject(new AuthCancelled()))
        .then((unlisten) => { stopClosedWatch = unlisten; })
        .catch(() => undefined);
    });
    // Marca la promesa como atendida: si el cierre llegara justo después de
    // resolverse la carrera, no queda un rechazo huérfano en consola.
    closedByUser.catch(() => undefined);

    let inApp = true;
    try {
      await invoke('open_auth_window', { url: authUrl });
    } catch {
      inApp = false;
      await openUrl(authUrl);
    }

    // 3. Esperar el redirect (o el cierre de la ventana).
    let cb: Record<string, string>;
    try {
      ({ params: cb } = await Promise.race([waiter, closedByUser]));
    } catch (e) {
      if (e instanceof AuthCancelled) {
        void invoke('oauth_cancel_wait', { port }).catch(() => undefined);
        throw new Error(tr('Inicio de sesión cancelado.'));
      }
      throw e;
    } finally {
      stopClosedWatch?.();
      if (inApp) void invoke('close_auth_window').catch(() => undefined);
    }
    if (cb.error) throw new Error(tr('Google rechazó la autorización: {error}', { error: cb.error }));
    if (cb.state !== state) throw new Error(tr('Estado OAuth inválido (posible intento de suplantación).'));
    if (!cb.code) throw new Error(tr('Google no devolvió un código de autorización.'));

    // 4. Intercambiar el código por tokens (en el proceso nativo).
    const form: Record<string, string> = {
      client_id: CLIENT_ID,
      code: cb.code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    };
    if (CLIENT_SECRET) form.client_secret = CLIENT_SECRET;

    const json = await invoke<any>('google_token_request', { form });

    return { accessToken: json.access_token, idToken: json.id_token, refreshToken: json.refresh_token, expiresIn: json.expires_in };
  }
  throw new Error(lastError || tr('No se pudo iniciar la escucha OAuth local.'));
}

/** Perfil de la cuenta dueña de un access token. */
async function fetchIdentity(accessToken: string): Promise<GoogleIdentity> {
  const resp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(tr('No se pudo obtener el perfil de Google.'));
  const info = await resp.json();
  return {
    sub: info.sub,
    email: info.email,
    name: info.name ?? info.email,
    givenName: info.given_name,
    familyName: info.family_name,
    picture: info.picture,
  };
}

/**
 * Inicio de sesión con Google. Devuelve el perfil y el id_token para abrir la
 * sesión de Supabase; nada se guarda en el equipo.
 */
// --- Google Drive para la extensión Wire (1.7.3) ---
//
// Excepción, con permiso expreso al instalar Wire: el relevo trabaja en
// segundo plano, así que necesita el token de RENOVACIÓN. No va a
// localStorage: el núcleo nativo lo guarda cifrado con DPAPI en la carpeta de
// la extensión (extensions.rs) y se borra al desconectar o desinstalar.
// Ámbito `drive.file`: Frame solo ve los archivos que él mismo crea.

const DRIVE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'];

export interface DriveGrant {
  email: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

/** Elige la cuenta de Google cuyo Drive hará de relevo. */
export async function authorizeDrive(): Promise<DriveGrant> {
  // `consent`: Google solo da el token de renovación la primera vez si no se fuerza.
  const tokens = await authorize({ scopes: DRIVE_SCOPES, prompt: 'select_account consent', offline: true });
  if (!tokens.refreshToken) throw new Error(tr('Google no dio acceso sin conexión. Vuelve a intentarlo.'));
  const identity = await fetchIdentity(tokens.accessToken);
  return {
    email: identity.email,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
  };
}

/** Token de acceso nuevo a partir del de renovación. */
export async function refreshGoogleAccess(refreshToken: string): Promise<{ accessToken: string; expiresAt: number }> {
  if (!CLIENT_ID) throw new Error(tr('Falta VITE_GOOGLE_CLIENT_ID en el archivo .env.'));
  const form: Record<string, string> = { client_id: CLIENT_ID, refresh_token: refreshToken, grant_type: 'refresh_token' };
  if (CLIENT_SECRET) form.client_secret = CLIENT_SECRET;
  const json = await invoke<any>('google_token_request', { form });
  return { accessToken: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
}

/** Retira el permiso en Google (lo mejor posible: si falla, el token igual se borra aquí). */
export async function revokeGoogleToken(token: string): Promise<void> {
  await fetch('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined);
}

export async function googleSignIn(options: { loginHint?: string } = {}): Promise<GoogleIdentity & { idToken?: string }> {
  // `loginHint`: al volver a conectar una cuenta (ReconnectDialog), Google la trae ya escrita.
  const tokens = await authorize({ scopes: IDENTITY_SCOPES, prompt: 'select_account', loginHint: options.loginHint });
  const identity = await fetchIdentity(tokens.accessToken);
  return { ...identity, idToken: tokens.idToken };
}
