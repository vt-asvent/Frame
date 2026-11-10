// Un equipo con el código REAL de la sesión: src/lib/supabase/auth.ts,
// client.ts y capped-fetch.ts, y la biblioteca supabase-js de verdad. Lo único
// simulado es la red (el `fetch` del contexto) y lo que auth.ts llama de otras
// partes de Frame (Dispositivos, imágenes, idioma). Ver scripts/probar-sesion.mjs.
import { getSupabase } from '@/lib/supabase/client';
import {
  SESSION_OPENED_EVENT,
  consumeIntentionalSignOut,
  describeAuthError,
  getActiveSession,
  hasStoredSession,
  onAuthChange,
  signInWithEmail,
  signInWithGoogleIdToken,
  signOut,
  storedSessionUserId,
} from '@/lib/supabase/auth';
import { cappedFetch, isFetchTimeout } from '@/lib/capped-fetch';

(globalThis as unknown as Record<string, unknown>).frame = {
  getSupabase,
  SESSION_OPENED_EVENT,
  consumeIntentionalSignOut,
  describeAuthError,
  getActiveSession,
  hasStoredSession,
  onAuthChange,
  signInWithEmail,
  signInWithGoogleIdToken,
  signOut,
  storedSessionUserId,
  cappedFetch,
  isFetchTimeout,
};
