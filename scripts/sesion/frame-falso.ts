// Lo que auth.ts usa del resto de Frame, reducido a lo que la prueba de sesión
// necesita observar (scripts/probar-sesion.mjs). Sustituye a lib/devices.ts,
// lib/image-sync.ts y lib/i18n.ts.

interface Probe {
  /** Veces que el cierre de sesión despidió a este equipo. */
  unlinks: number;
  /** Lo que tarda esa despedida en contestar (ms). */
  unlinkDelay: number;
}

const probe = ((globalThis as unknown as { __probe?: Probe }).__probe ??= { unlinks: 0, unlinkDelay: 0 });

/** Dispositivos: la despedida. La de verdad se cancela sola a los 2,5 s; esta tarda lo que diga la prueba. */
export async function markDeviceUnlinked(): Promise<void> {
  probe.unlinks += 1;
  if (probe.unlinkDelay > 0) await new Promise((resolve) => setTimeout(resolve, probe.unlinkDelay));
}

export async function removeCloudImages(): Promise<void> {
  /* sin imágenes en la prueba */
}

/** El texto en español es la clave: se devuelve tal cual. */
export const tr = (text: string): string => text;
export const getLang = (): string => 'es';
