import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cappedFetch } from '@/lib/capped-fetch';
import { sessionFetch } from './session-fetch';
import { SESSION_KEY, sessionStore } from './session-store';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Permite que la app siga funcionando 100% offline si no hay credenciales.
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  if (client) return client;

  client = createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: SESSION_KEY,
      // La sesión no se pierde porque el equipo se quede sin sitio (session-store.ts).
      storage: sessionStore,
    },
    // Cada petición (sesión, datos, imágenes) con su plazo: una colgada dejaba
    // la sincronización parada hasta reiniciar Frame (lib/capped-fetch.ts). Y
    // sobre eso, lo que cuida la sesión: session-fetch.ts.
    global: { fetch: sessionFetch },
    // Si el canal en vivo no puede conectar (servicio caído, o el tope de
    // conexiones simultáneas del plan lleno), cada equipo reintenta cada vez más
    // espaciado y al azar: 1 s, 2 s, 4 s… hasta 5 min. Por defecto insistía cada
    // 10 s para siempre, todos a la vez.
    realtime: {
      reconnectAfterMs: (tries: number) => Math.min(300_000, 1000 * 2 ** Math.max(0, tries - 1)) * (0.5 + Math.random()),
    },
  });

  return client;
}

/**
 * Cliente aparte, sin sesión y con flujo implícito, solo para pedir el correo
 * de «¿Olvidaste tu contraseña?». Con PKCE el enlace exigiría el verificador
 * guardado en este equipo; así la página web de la contraseña nueva puede
 * terminar el cambio desde cualquier navegador (1.6.6).
 */
export function getRecoveryClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) return null;
  return createClient(supabaseUrl!, supabaseAnonKey!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit' },
    global: { fetch: cappedFetch },
  });
}
