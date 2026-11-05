// ============================================================
// Geocodificación inversa: coordenadas → nombre real del lugar.
// Cadena de 3 proveedores gratuitos y SIN clave de API, con caché en
// localStorage y fallback a coordenadas formateadas.
//
// Las peticiones salen por Rust (http_get_text) cuando la app corre en
// Tauri: evita CORS,
// filtros del WebView y el bloqueo por User-Agent de Nominatim, que
// responde 403 a los User-Agent de navegador.
//
// Open-Meteo NO ofrece geocodificación inversa (su /v1/reverse responde
// 404): su API de geocoding es sólo búsqueda por nombre.
// ============================================================
import { invoke, isTauri } from '@tauri-apps/api/core';
import { decimalText, getLang } from '@/lib/i18n';

export type GeoSource = 'bigdatacloud' | 'photon' | 'nominatim' | 'ip' | 'manual' | 'coords';

interface ResolvedPlaceName {
  /** Ciudad o localidad principal. Ej: "Lima" */
  name: string;
  /** Detalle fino: distrito/barrio. Ej: "Distrito de Miraflores" */
  locality?: string;
  /** Región/departamento. Ej: "Lima" */
  admin?: string;
  /** País. Ej: "Perú" */
  country?: string;
  /** Código ISO del país, en mayúsculas. Ej: "PE" (1.6.9: para el Panel de uso). */
  countryCode?: string;
  source: GeoSource;
}

const TIMEOUT_MS = 7000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** GET JSON: por Rust dentro de Tauri (sin CORS), por fetch en el navegador. */
async function getJson(url: string): Promise<any> {
  if (isTauri()) {
    const text = await withTimeout(invoke<string>('http_get_text', { url }), TIMEOUT_MS);
    return JSON.parse(text);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

function clean(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s : undefined;
}

/** Código ISO de dos letras, en mayúsculas, o nada. */
export function cleanCountryCode(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(s) ? s : undefined;
}

/** Primer valor no vacío que además aporte información nueva frente a `name`. */
function pickDetail(candidates: (string | undefined)[], name: string): string | undefined {
  return candidates.find((v): v is string => !!v && v !== name);
}

// ---------- Proveedor 1: BigDataCloud (español nativo, el más rápido) ----------
async function fromBigDataCloud(lat: number, lon: number): Promise<ResolvedPlaceName | null> {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    localityLanguage: getLang(),
  });
  const d = await getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`);
  const name = clean(d?.city) ?? clean(d?.locality) ?? clean(d?.principalSubdivision);
  if (!name) return null;

  // adminLevel 8/10 = distrito o barrio: el detalle que delata la precisión del GPS.
  const admins: any[] = Array.isArray(d?.localityInfo?.administrative) ? d.localityInfo.administrative : [];
  const finest = admins
    .filter((a) => typeof a?.adminLevel === 'number' && a.adminLevel >= 7 && clean(a?.name))
    .sort((a, b) => b.adminLevel - a.adminLevel)
    .map((a) => clean(a.name))[0];

  return {
    name,
    locality: pickDetail([clean(d?.locality), finest], name),
    admin: clean(d?.principalSubdivision),
    country: clean(d?.countryName),
    countryCode: cleanCountryCode(d?.countryCode),
    source: 'bigdatacloud',
  };
}

// ---------- Proveedor 2: Photon / Komoot (datos OpenStreetMap) ----------
async function fromPhoton(lat: number, lon: number): Promise<ResolvedPlaceName | null> {
  // `lang` sólo admite default|de|en|fr — con 'es' responde HTTP 400.
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), lang: ['en', 'de', 'fr'].includes(getLang()) ? getLang() : 'default', limit: '1' });
  const d = await getJson(`https://photon.komoot.io/reverse?${params}`);
  const p = d?.features?.[0]?.properties;
  if (!p) return null;

  // `p.name` puede ser un POI (un monumento, un bar): sólo vale si es un lugar.
  const poi = p.osm_key === 'place' ? clean(p.name) : undefined;
  const name = clean(p.city) ?? clean(p.district) ?? clean(p.county) ?? clean(p.state) ?? poi;
  if (!name) return null;

  return {
    name,
    locality: pickDetail([clean(p.district), clean(p.locality)], name),
    admin: clean(p.state),
    country: clean(p.country),
    countryCode: cleanCountryCode(p.countrycode),
    source: 'photon',
  };
}

// ---------- Proveedor 3: Nominatim (sólo vía Rust: exige User-Agent identificable) ----------
async function fromNominatim(lat: number, lon: number): Promise<ResolvedPlaceName | null> {
  if (!isTauri()) return null; // desde el WebView responde 403 Forbidden
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(lat),
    lon: String(lon),
    zoom: '14',
    'accept-language': getLang(),
  });
  const d = await getJson(`https://nominatim.openstreetmap.org/reverse?${params}`);
  const a = d?.address ?? {};
  const name =
    clean(a.city) ??
    clean(a.town) ??
    clean(a.village) ??
    clean(a.municipality) ??
    clean(a.county) ??
    clean(a.state);
  if (!name) return null;

  return {
    name,
    locality: pickDetail(
      [clean(a.suburb), clean(a.city_district), clean(a.neighbourhood), clean(a.quarter)],
      name
    ),
    admin: clean(a.state),
    country: clean(a.country),
    countryCode: cleanCountryCode(a.country_code),
    source: 'nominatim',
  };
}

// ---------- Caché ----------

const CACHE_KEY = 'weatherGeocodeCache';
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 días: los topónimos no cambian
const CACHE_MAX = 40;

type CacheEntry = ResolvedPlaceName & { at: number };

/** ~110 m de resolución: suficiente para no repetir peticiones al moverse por
 *  casa. El idioma va en la clave: «Perú» y «Peru» son entradas distintas. */
function cacheKey(lat: number, lon: number): string {
  const base = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  return getLang() === 'es' ? base : `${getLang()}:${base}`;
}

function loadCache(): Record<string, CacheEntry> {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, CacheEntry>) : {};
  } catch {
    return {};
  }
}

function saveCache(key: string, entry: CacheEntry) {
  try {
    const cache = loadCache();
    cache[key] = entry;
    const keys = Object.keys(cache);
    if (keys.length > CACHE_MAX) {
      keys
        .sort((a, b) => (cache[a].at ?? 0) - (cache[b].at ?? 0))
        .slice(0, keys.length - CACHE_MAX)
        .forEach((k) => delete cache[k]);
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* almacenamiento lleno: se ignora, se resolverá de nuevo la próxima vez */
  }
}

// ---------- API pública ----------

const PROVIDERS: { id: GeoSource; run: (lat: number, lon: number) => Promise<ResolvedPlaceName | null> }[] = [
  { id: 'bigdatacloud', run: fromBigDataCloud },
  { id: 'photon', run: fromPhoton },
  { id: 'nominatim', run: fromNominatim },
];

/** Coordenadas → nombre real del lugar. null si los tres proveedores fallan. */
export async function reverseGeocode(
  latitude: number,
  longitude: number
): Promise<ResolvedPlaceName | null> {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  const key = cacheKey(latitude, longitude);
  const hit = loadCache()[key];
  if (hit?.name && Date.now() - (hit.at ?? 0) < CACHE_TTL) {
    const { at: _at, ...cached } = hit;
    return cached;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

  for (const provider of PROVIDERS) {
    try {
      const result = await provider.run(latitude, longitude);
      if (result?.name) {
        saveCache(key, { ...result, at: Date.now() });
        return result;
      }
    } catch (e) {
      console.warn(`[reverse-geocode] proveedor ${provider.id} falló:`, e);
    }
  }
  return null;
}

/** Fallback legible: (-12.0464, -77.0428) → "12,046° S · 77,043° O". */
export function formatCoords(latitude: number, longitude: number): string {
  const part = (v: number, pos: string, neg: string) =>
    `${decimalText(Math.abs(v), 3)}° ${v >= 0 ? pos : neg}`;
  return `${part(latitude, 'N', 'S')} · ${part(longitude, 'E', 'O')}`;
}
