import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase/client';
import { parseManifest, type ExtensionApp, type ExtensionManifest } from '@/lib/extensions/manifest';

// ============================================================
// Catálogo remoto de extensiones de terceros (1.7.6, migración 0014).
//
// El responsable de Frame activa una extensión para todos desde Supabase, sin
// publicar una versión nueva. Frame la muestra en Extensiones SOLO al buscarla
// por su nombre. Cada manifiesto pasa por la misma validación que un archivo
// .json (parseManifest): una del catálogo no tiene más permisos que una
// instalada a mano. Sin sesión, o sin red, se usa la última copia guardada.
// ============================================================

export interface CatalogEntry {
  id: string;
  manifest: ExtensionManifest;
  /** Vista previa para su tarjeta (https), si la tiene. */
  preview: string | null;
}

const CACHE_KEY = 'frameExtCatalog';
const MAX_AGE = 6 * 60 * 60 * 1000;

interface Cache {
  at: number;
  rows: { id: string; manifest: unknown; preview_url: string | null }[];
}

function validate(rows: Cache['rows']): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  for (const row of rows.slice(0, 200)) {
    if (!row || typeof row.id !== 'string') continue;
    const result = parseManifest(JSON.stringify(row.manifest ?? null));
    // parseManifest ya rechaza los prefijos reservados (frame., asvent.).
    if (!result.ok || result.manifest.id !== row.id) continue;
    const preview = typeof row.preview_url === 'string' && /^https:\/\/[^\s"'<>]+$/.test(row.preview_url) ? row.preview_url : null;
    out.push({ id: row.id, manifest: result.manifest, preview });
  }
  return out;
}

function readCache(): Cache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Cache;
    return Array.isArray(data?.rows) ? data : null;
  } catch {
    return null;
  }
}

let inflight: Promise<CatalogEntry[]> | null = null;

/** Lo activo en el catálogo (con caché de 6 h; `force` la salta). */
export function loadCatalog(force = false): Promise<CatalogEntry[]> {
  const cache = readCache();
  if (!force && cache && Date.now() - cache.at < MAX_AGE) return Promise.resolve(validate(cache.rows));
  inflight ??= (async () => {
    try {
      const supabase = getSupabase();
      if (!supabase) return validate(cache?.rows ?? []);
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return validate(cache?.rows ?? []);
      const { data, error } = await supabase.rpc('extension_catalog_list');
      if (error || !Array.isArray(data)) return validate(cache?.rows ?? []);
      const rows = data as Cache['rows'];
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), rows } satisfies Cache));
      } catch {
        /* sin espacio: se usa sin guardar */
      }
      return validate(rows);
    } catch {
      return validate(cache?.rows ?? []);
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * El programa que el CATÁLOGO declara para una extensión (1.9.0): solo las del
 * catálogo se instalan y se ponen al día solas, y con lo que diga el catálogo
 * hoy (no lo que traía el archivo con el que se instaló).
 */
export function catalogApp(id: string): ExtensionApp | null {
  const cache = readCache();
  return (cache && validate(cache.rows).find((entry) => entry.id === id)?.manifest.contributes?.musicSource?.app) || null;
}

/** El catálogo, cargado al montar (vacío mientras llega). */
export function useCatalog(): CatalogEntry[] {
  const [list, setList] = useState<CatalogEntry[]>(() => {
    const cache = readCache();
    return cache ? validate(cache.rows) : [];
  });
  useEffect(() => {
    let alive = true;
    void loadCatalog().then((rows) => alive && setList(rows));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}
