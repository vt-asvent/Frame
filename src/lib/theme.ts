// ============================================================
// Tema de Frame: claro / oscuro / según el dispositivo.
// - El modo oscuro es el tema histórico de la app y queda INTACTO.
// - El modo claro es un "arena claro" (nunca blanco puro), derivado
//   tono a tono del oscuro (misma estructura de variables en globals.css).
// - La preferencia se guarda en localStorage y se aplica alternando la
//   clase `dark` en <html> (Tailwind darkMode: 'class').
// index.html incluye un mini-script que aplica esto ANTES del primer
// pintado para que no haya destello del tema equivocado.
// ============================================================

import { initAccent } from '@/lib/accent';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'frameTheme';
/** Evento entre ventanas nativas: la flotante de Enfoque escucha aquí. */
const THEME_EVENT = 'frame-theme-changed';

export function getThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* localStorage puede no estar disponible */
  }
  // El oscuro es la identidad histórica de Frame: es el valor por defecto.
  return 'dark';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyTheme(pref: ThemePreference = getThemePreference()): void {
  const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

export function setThemePreference(pref: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* sin persistencia, pero el tema igual se aplica en esta sesión */
  }
  applyTheme(pref);
  // La ventana flotante de Enfoque es otra ventana con su propio contexto de
  // JavaScript: se le avisa aparte, o se quedaría en el tema con el que nació.
  void broadcastTheme(pref);
}

/** Aviso a las demás ventanas nativas de la app. Fuera de Tauri no hay ninguna. */
async function broadcastTheme(pref: ThemePreference): Promise<void> {
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(THEME_EVENT, pref);
  } catch {
    /* en el navegador basta con el evento 'storage' */
  }
}

/** Se llama una vez al arrancar EN CADA VENTANA: aplica la preferencia, sigue
 *  en vivo los cambios de tema del sistema operativo cuando la opción es
 *  "dispositivo", y obedece los cambios hechos desde otra ventana. */
export function initTheme(): void {
  applyTheme();
  initAccent();
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (getThemePreference() === 'system') applyTheme('system');
    });

  // Otra pestaña/ventana del mismo origen cambió la preferencia.
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) applyTheme();
  });

  // Otra ventana NATIVA (la flotante de Enfoque) cambió la preferencia.
  void (async () => {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      await listen<ThemePreference>(THEME_EVENT, (event) => {
        const pref = event.payload;
        applyTheme(pref === 'light' || pref === 'dark' || pref === 'system' ? pref : undefined);
      });
    } catch {
      /* fuera de Tauri no hay ventanas hermanas que escuchar */
    }
  })();
}
