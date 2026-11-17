import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { catalogApp, loadCatalog } from '@/lib/extensions/remote-catalog';
import type { EngineClient, EngineStatus } from '@/lib/extensions/yt-mp3';

// ============================================================
// El programa de una fuente de música, siempre listo (1.9.0, Diego: «una vez
// que activa la extensión, nunca más debe tener que actualizarla»).
//
// Antes de hablar con el programa, Frame lo deja abierto y al día:
//   · cerrado → lo abre en segundo plano (ext_app_launch);
//   · sin instalar, o anterior a la versión que pide el catálogo → descarga
//     su instalador, comprueba la firma y lo instala en silencio
//     (ext_app_install), nunca con canciones dentro.
// Qué programa y desde dónde lo dice el CATÁLOGO (remote-catalog.ts), no el
// archivo con que se instaló la extensión. El programa, además, se pone al
// día solo y repara su yt-dlp (desde su 1.2.0).
// ============================================================

/** Versión mínima del protocolo: desde ella el programa entrega el archivo terminado. */
export const MIN_ENGINE = [1, 1, 0];
/** Tras cada instalación fallida se espera un poco más antes de la siguiente (2.0.2: antes, media hora de golpe). */
const INSTALL_BACKOFF_MS = [60_000, 3 * 60_000, 10 * 60_000, 30 * 60_000];
/** Abrir el programa no se repite más seguido que esto: uno que no arranca no debe multiplicarse. */
const RELAUNCH_MS = 45_000;

export type EngineHealth = 'up' | 'down' | 'outdated';
export type EngineStep = 'starting' | 'installing' | 'updating';

const parse = (version: string) => version.split('.').map((part) => Number.parseInt(part, 10) || 0);

export function versionBelow(version: string, minimum: number[]): boolean {
  const parts = parse(version);
  for (let i = 0; i < minimum.length; i++) {
    if ((parts[i] ?? 0) !== minimum[i]) return (parts[i] ?? 0) < minimum[i];
  }
  return false;
}

// Lo que se está haciendo ahora (para que «+ Añadir» lo cuente).
let step: EngineStep | null = null;
const listeners = new Set<() => void>();
const setStep = (next: EngineStep | null) => {
  step = next;
  listeners.forEach((listener) => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const useEngineStep = (): EngineStep | null => useSyncExternalStore(subscribe, () => step, () => step);

const running = new Map<string, Promise<EngineHealth>>();
const nextInstall = new Map<string, number>();
const failures = new Map<string, number>();
const lastLaunch = new Map<string, number>();
const lastError = new Map<string, string>();

/** Por qué falló la última instalación del programa de esta fuente ('store': versión de la Store). */
export const engineError = (sourceId: string): string | null => lastError.get(sourceId) ?? null;

/**
 * «Descargar» (2.0.2): Frame baja el instalador oficial, comprueba su firma y lo deja en
 * Descargas, a la vista en el Explorador. El usuario lo instala y «+ Añadir», que sigue
 * mirando, se conecta solo. Es la vía de la versión de la Store (que no instala programas)
 * y la salida de la otra si instalarlo en silencio falló.
 */
export async function downloadEngineInstaller(sourceId: string, name: string): Promise<void> {
  if (!catalogApp(sourceId)) await loadCatalog().catch(() => undefined);
  const app = catalogApp(sourceId);
  if (!app) throw new Error('El catálogo de Frame no responde. Revisa tu conexión.');
  await invoke<string>('ext_app_download_installer', { updates: app.updates, name });
}

const health = (status: EngineStatus | null): EngineHealth => (!status ? 'down' : versionBelow(status.version, MIN_ENGINE) ? 'outdated' : 'up');

async function waitUp(client: EngineClient, ms: number): Promise<EngineStatus | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      return await client.status();
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
    }
  }
  return null;
}

/**
 * Deja listo el programa de la fuente `sourceId` y dice cómo quedó. Una sola
 * vez a la vez por fuente: quien llega mientras tanto espera lo mismo.
 * `force` («Reintentar»): vuelve a intentar la instalación aunque acabe de fallar.
 */
export function ensureEngine(sourceId: string, client: EngineClient, force = false): Promise<EngineHealth> {
  const current = running.get(sourceId);
  if (current) return current;
  if (force) {
    nextInstall.delete(sourceId);
    lastLaunch.delete(sourceId);
  }
  const job = repair(sourceId, client).finally(() => {
    running.delete(sourceId);
    setStep(null);
  });
  running.set(sourceId, job);
  return job;
}

async function repair(sourceId: string, client: EngineClient): Promise<EngineHealth> {
  let status = await client.status().catch(() => null);
  if (!isTauri()) return health(status);
  if (!catalogApp(sourceId)) await loadCatalog().catch(() => undefined);
  const app = catalogApp(sourceId);
  if (!app) return health(status);
  // La mayor entre la que pide el catálogo y la del protocolo.
  const wanted = app.minVersion && !versionBelow(app.minVersion, MIN_ENGINE) ? parse(app.minVersion) : MIN_ENGINE;
  const ready = () => {
    lastError.delete(sourceId);
    failures.delete(sourceId);
    return 'up' as const;
  };
  if (status && !versionBelow(status.version, wanted)) return ready();
  const args = app.args ?? [];

  if (!status && Date.now() - (lastLaunch.get(sourceId) ?? 0) >= RELAUNCH_MS) {
    setStep('starting');
    if (await invoke<boolean>('ext_app_launch', { exe: app.exe, args }).catch(() => false)) {
      lastLaunch.set(sourceId, Date.now());
      status = await waitUp(client, 20_000);
      if (status && !versionBelow(status.version, wanted)) return ready();
    }
  }

  // Falta o es viejo: se instala la última versión. Nunca a mitad de una
  // descarga (el instalador cierra el programa), y tras un fallo, cada vez
  // un poco más espaciado (el usuario puede forzarlo con «Reintentar»).
  if ((status && status.busy > 0) || Date.now() < (nextInstall.get(sourceId) ?? 0)) return health(status);
  setStep(status ? 'updating' : 'installing');
  try {
    await invoke<string>('ext_app_install', { updates: app.updates, exe: app.exe, args });
    lastLaunch.set(sourceId, Date.now());
  } catch (error) {
    const failed = (failures.get(sourceId) ?? 0) + 1;
    failures.set(sourceId, failed);
    nextInstall.set(sourceId, Date.now() + INSTALL_BACKOFF_MS[Math.min(failed, INSTALL_BACKOFF_MS.length) - 1]);
    lastError.set(sourceId, String(error).replace(/^(Error:\s*|Invoke error:\s*)/i, '').slice(0, 200));
    return health(status);
  }
  const after = await waitUp(client, 30_000);
  return after && !versionBelow(after.version, wanted) ? ready() : health(after);
}
