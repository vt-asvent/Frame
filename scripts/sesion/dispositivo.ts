// Un equipo con el código REAL de la sesión: src/lib/supabase/ (auth.ts,
// client.ts, session-store.ts, session-fetch.ts, session-guard.ts), nube.ts,
// connection-status.ts y capped-fetch.ts, y la biblioteca supabase-js de
// verdad. Lo único simulado es la red (el `fetch` del contexto) y lo que auth.ts
// llama de otras partes de Frame (Dispositivos, imágenes, idioma). Ver
// scripts/probar-sesion.mjs.
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
  signInMethodsOf,
  signOut,
  storedAccessToken,
  storedSessionUserId,
} from '@/lib/supabase/auth';
import { cappedFetch, isFetchTimeout } from '@/lib/capped-fetch';
import { getConnectionState } from '@/lib/connection-status';
import { NubeAuthError, nubeCall } from '@/lib/nube';
import { refreshEnded } from '@/lib/supabase/session-fetch';
import { checkSession, sessionRestored, startSessionGuard } from '@/lib/supabase/session-guard';
import { sessionOnlyInMemory } from '@/lib/supabase/session-store';

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
  signInMethodsOf,
  signOut,
  storedAccessToken,
  storedSessionUserId,
  cappedFetch,
  isFetchTimeout,
  getConnectionState,
  NubeAuthError,
  nubeCall,
  refreshEnded,
  checkSession,
  sessionRestored,
  startSessionGuard,
  sessionOnlyInMemory,
};
