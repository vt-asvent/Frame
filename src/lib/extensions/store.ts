import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { officialById, type OfficialId } from './catalog';
import type { ExtensionContributions, ExtensionManifest, PermissionId } from './manifest';

// ============================================================
// Extensiones instaladas en ESTE equipo (1.7.3).
//
// - La lista vive en `frameExt:installed`. Como el tema o el acento, es del
//   equipo: cada equipo decide qué extensiones tiene.
// - Todo lo que una extensión guarda va con su prefijo: `frameExt:<id>:…` en
//   localStorage, la base IndexedDB `frameExt:<id>` y, en el núcleo nativo,
//   sus carpetas y llaves (`ext_forget`). Desinstalar borra exactamente eso y
//   nada más: no queda rastro de la extensión y Frame sigue como estaba.
// - Lo que una extensión trajo a Frame (tareas de Notion, canciones
//   descargadas) es del usuario, no de la extensión: se queda.
// - Desactivar la apaga sin borrar nada; al reactivarla vuelve como estaba.
// ============================================================

const INSTALLED_KEY = 'frameExt:installed';
export const EXTENSIONS_CHANGED = 'frame-extensions-changed';

export interface InstalledExtension {
  id: string;
  enabled: boolean;
  version: string;
  installedAt: string;
  /** Permisos aceptados al instalar (o al actualizar). */
  granted: PermissionId[];
  /** Solo las de terceros: el manifiesto tal como se instaló. */
  manifest?: ExtensionManifest;
}

let cache: InstalledExtension[] | null = null;
let cacheRaw: string | null = null;

function read(): InstalledExtension[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(INSTALLED_KEY);
  } catch {
    /* sin almacenamiento: ninguna instalada */
  }
  if (cache && raw === cacheRaw) return cache;
  let list: InstalledExtension[] = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      list = parsed.filter(
        (e): e is InstalledExtension =>
          !!e && typeof e.id === 'string' && typeof e.enabled === 'boolean' && Array.isArray(e.granted) && (!!officialById(e.id) || !!e.manifest)
      );
    }
  } catch {
    list = [];
  }
  cache = list;
  cacheRaw = raw;
  return list;
}

function write(list: InstalledExtension[]) {
  localStorage.setItem(INSTALLED_KEY, JSON.stringify(list));
  window.dispatchEvent(new Event(EXTENSIONS_CHANGED));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === INSTALLED_KEY) onChange();
  };
  window.addEventListener(EXTENSIONS_CHANGED, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(EXTENSIONS_CHANGED, onChange);
    window.removeEventListener('storage', onStorage);
  };
}

export const listInstalled = (): InstalledExtension[] => read();

/** Lista de instaladas, que repinta al instalar, activar o quitar. */
export function useInstalledExtensions(): InstalledExtension[] {
  return useSyncExternalStore(subscribe, read, read);
}

/** ¿Está instalada y activa? */
export function useExtensionOn(id: OfficialId | string): boolean {
  const list = useInstalledExtensions();
  return list.some((e) => e.id === id && e.enabled);
}

/** El manifiesto de una instalada (el oficial, o el que vino en el archivo). */
export function manifestOf(entry: InstalledExtension): ExtensionManifest | null {
  return officialById(entry.id)?.manifest() ?? entry.manifest ?? null;
}

/** Las aportaciones de un tipo de las extensiones ACTIVAS (para Música, Apariencia…). */
export function useContributions<K extends keyof ExtensionContributions>(
  kind: K
): { id: string; manifest: ExtensionManifest; value: NonNullable<ExtensionContributions[K]> }[] {
  const list = useInstalledExtensions();
  return list
    .filter((e) => e.enabled && e.manifest?.contributes?.[kind])
    .map((e) => ({ id: e.id, manifest: e.manifest!, value: e.manifest!.contributes![kind]! }));
}

export function installExtension(manifest: ExtensionManifest, isOfficial: boolean): void {
  const list = read().filter((e) => e.id !== manifest.id);
  const previous = read().find((e) => e.id === manifest.id);
  list.push({
    id: manifest.id,
    enabled: true,
    version: manifest.version,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    granted: [...manifest.permissions],
    ...(isOfficial ? {} : { manifest }),
  });
  write(list);
}

export function setExtensionEnabled(id: string, enabled: boolean): void {
  write(read().map((e) => (e.id === id ? { ...e, enabled } : e)));
}

// ------------------------------------------------------------
// Datos de cada extensión (con su prefijo)
// ------------------------------------------------------------

export const extKey = (id: string, name: string) => `frameExt:${id}:${name}`;

export function extRead<T>(id: string, name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(extKey(id, name));
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function extWrite(id: string, name: string, value: unknown): void {
  try {
    if (value === undefined || value === null) localStorage.removeItem(extKey(id, name));
    else localStorage.setItem(extKey(id, name), JSON.stringify(value));
  } catch {
    /* lleno o bloqueado: la extensión sigue sin recordar */
  }
}

/** Nombre de la base IndexedDB propia de una extensión (si la necesita). */
export const extDatabase = (id: string) => `frameExt:${id}`;

/** Lo que una extensión oficial debe apagar antes de borrarse (bucles, conexiones). */
const teardowns = new Map<string, () => Promise<void> | void>();
export function onExtensionTeardown(id: string, fn: () => Promise<void> | void): void {
  teardowns.set(id, fn);
}

/** Borra TODO lo que la extensión guardó en este equipo. */
async function forget(id: string): Promise<void> {
  try {
    await teardowns.get(id)?.();
  } catch {
    /* lo que no se pudo apagar se borra igual */
  }
  try {
    const prefix = `frameExt:${id}:`;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* sin almacenamiento: nada que borrar */
  }
  await new Promise<void>((resolve) => {
    try {
      const request = indexedDB.deleteDatabase(extDatabase(id));
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
  if (isTauri()) await invoke('ext_forget', { ext: id }).catch(() => undefined);
}

/** Desinstala: apaga, borra sus datos y la quita de la lista. */
export async function uninstallExtension(id: string): Promise<void> {
  // Primero fuera de la lista: lo que dependa de ella se desmonta ya.
  write(read().filter((e) => e.id !== id));
  await forget(id);
}

/** Al eliminar la cuenta o borrar el equipo: todas, sin dejar nada. */
export async function forgetAllExtensions(): Promise<void> {
  const ids = read().map((e) => e.id);
  try {
    localStorage.removeItem(INSTALLED_KEY);
  } catch {
    /* nada */
  }
  for (const id of ids) await forget(id);
  window.dispatchEvent(new Event(EXTENSIONS_CHANGED));
}
