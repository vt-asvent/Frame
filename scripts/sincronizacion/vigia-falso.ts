// Sustituye a src/lib/supabase/session-guard.ts en la prueba de sincronización.
// Dispositivos le pregunta al vigía cuando la nube dice que la sesión de este
// equipo ya no existe; aquí no hay sesiones de verdad (eso lo prueba
// scripts/probar-sesion.mjs), así que contesta «ninguna» y no hace nada.
export type SessionCheck = 'alive' | 'ended' | 'unknown' | 'none';

export const checkSession = async (): Promise<SessionCheck> => 'none';
export const sessionRestored = (): void => undefined;
export const startSessionGuard = (): void => undefined;
