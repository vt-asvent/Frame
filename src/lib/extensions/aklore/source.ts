import { useEffect, useState, useSyncExternalStore } from 'react';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { NUBE, nubeFetch } from '@/lib/nube';
import { activeProfileId } from '@/lib/profile-scope';
import { getSupabase } from '@/lib/supabase/client';
import { CLOUD_APPLIED_EVENT } from '@/lib/sync-merge';
import { tr } from '@/lib/i18n';

// ============================================================
// AK Lore → la Biblioteca (1.9.2): el material del Programa del Diploma que
// Asvent guarda en su Drive. La nube de Frame (nube-ia/src/lore.ts) da el
// índice y pasa cada archivo: nadie recibe un enlace de Drive ni entra a ese
// Drive. Solo cuentas del colegio con el correo comprobado (lo decide la
// nube; aquí solo se muestra). El índice se guarda en este equipo para
// buscar sin red; los favoritos son de la cuenta y viajan con ella a sus
// otros dispositivos (`loreFavorites`, como el corazón de las canciones).
//
// Formato del índice (versión 1):
// { "format": 1, "guides": [ { "id": "ib-…", "title": "…", "subject": "Física",
//   "section": "Grupo 4 · Ciencias", "kind": "Examen", "component": "Prueba 1",
//   "lang": "es", "year": 2024, "pages": 18, "size": 482113,
//   "summary": "…", "format": "pdf", "updated": "2026-11-09T…" } ] }
// ============================================================

export const AKLORE = 'frame.aklore';

export const LORE_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'txt', 'image', 'other'] as const;
export type LoreFormat = (typeof LORE_FORMATS)[number];

export interface LoreGuide {
  id: string;
  title: string;
  subject: string;
  /** Tronco común, Grupo 1…5, General. */
  section: string;
  /** Guía, Examen, Esquema de calificación, Ejemplo calificado… */
  kind: string;
  /** Prueba 1, Evaluación interna… */
  component?: string;
  /** es, en o es-en. */
  lang?: string;
  year?: number;
  pages?: number;
  /** Fecha ISO de la última versión. */
  updated: string;
  format: LoreFormat;
  size?: number;
  summary?: string;
}

export interface LoreSource {
  id: string;
  /** Todo el índice. */
  list(signal?: AbortSignal): Promise<LoreGuide[]>;
  /** El archivo, para verlo o descargarlo. */
  open(guide: LoreGuide, signal?: AbortSignal): Promise<{ blob: Blob; fileName: string }>;
}

// ------------------------------------------------------------
// Índice (validado: lo que no cumple, se descarta)
// ------------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const whole = (value: unknown, min: number, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : undefined;

export function parseLoreIndex(raw: unknown): LoreGuide[] {
  const root = raw as { format?: unknown; guides?: unknown } | null;
  if (!root || root.format !== 1 || !Array.isArray(root.guides)) throw new Error(tr('El índice de la Biblioteca no tiene el formato esperado.'));
  const seen = new Set<string>();
  const out: LoreGuide[] = [];
  for (const item of root.guides.slice(0, 20_000)) {
    const g = item as Record<string, unknown>;
    const id = text(g?.id, 120);
    const title = text(g?.title, 240);
    const subject = text(g?.subject, 80);
    if (!id || !title || !subject || seen.has(id)) continue;
    seen.add(id);
    const optional = {
      component: text(g.component, 60),
      lang: text(g.lang, 8),
      summary: text(g.summary, 600),
      year: whole(g.year, 1990, 2100),
      pages: whole(g.pages, 1, 100_000),
      size: whole(g.size, 0, 2 ** 40),
    };
    out.push({
      id,
      title,
      subject,
      // En español, como llega todo el índice: el tipo se traduce al pintarlo.
      section: text(g.section, 80) || 'General',
      kind: text(g.kind, 40) || 'Documento',
      updated: Number.isFinite(Date.parse(String(g.updated))) ? new Date(String(g.updated)).toISOString() : new Date(0).toISOString(),
      format: (LORE_FORMATS as readonly string[]).includes(String(g.format)) ? (g.format as LoreFormat) : 'other',
      ...Object.fromEntries(Object.entries(optional).filter(([, v]) => v !== '' && v !== undefined)),
    });
  }
  return out;
}

const EXTENSION: Record<LoreFormat, string> = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', md: 'md', txt: 'txt', image: 'png', other: 'bin' };

export function fileNameOf(guide: LoreGuide): string {
  const base = guide.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150) || guide.id;
  return `${base}.${EXTENSION[guide.format]}`;
}

// ------------------------------------------------------------
// La nube de Frame
// ------------------------------------------------------------

/** `stop`: no tiene sentido seguir con el resto de una colección. */
const fail = (message: string, stop = true) => Object.assign(new Error(message), { stop });
const offline = () => fail(tr('Sin conexión: vuelve a intentarlo cuando tengas internet.'));

async function fromCloud(path: string, signal?: AbortSignal): Promise<Response> {
  const supabase = getSupabase();
  if (!supabase || !navigator.onLine) throw offline();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw fail(tr('Entra con tu cuenta del colegio para usar la Biblioteca.'));
  // Con plazo (nube.ts). Un corte de red se dice así, no con el error del navegador.
  const resp = await nubeFetch(`${NUBE}${path}`, { headers: { authorization: `Bearer ${data.session.access_token}` }, signal }).catch((error: unknown) => {
    throw signal?.aborted ? error : offline();
  });
  if (resp.ok) return resp;
  const body = (await resp.json().catch(() => null)) as { error?: string } | null;
  if (resp.status === 401) throw fail(tr('Tu sesión venció: vuelve a entrar con tu cuenta del colegio.'));
  if (resp.status === 403) throw fail(tr('La Biblioteca es solo para cuentas del colegio con el correo comprobado.'));
  if (resp.status === 404) throw fail(tr('Ese archivo ya no está en la Biblioteca.'), false);
  if (resp.status === 429) throw fail(tr('Llegaste al tope de descargas de hoy. Mañana puedes seguir.'));
  if (body?.error === 'lore-off') throw fail(tr('La Biblioteca aún se está preparando. Vuelve en un rato.'));
  throw fail(tr('La Biblioteca no respondió ({status}). Inténtalo de nuevo.', { status: resp.status }), false);
}

/** Los últimos archivos abiertos: «Ver» y luego «Descargar» bajan una sola vez. */
const recent = new Map<string, Blob>();
const RECENT_BYTES = 80 * 1024 * 1024;
/** Los que están bajando: pedir otra vez el mismo espera a esa descarga, no abre otra (ni gasta otra del tope del día). */
const arriving = new Map<string, Promise<Blob>>();

/** Al salir de la Biblioteca: los archivos abiertos dejan de ocupar memoria. */
export function forgetOpenedFiles(): void {
  recent.clear();
}

async function download(guide: LoreGuide, signal?: AbortSignal): Promise<Blob> {
  let blob: Blob;
  try {
    blob = await (await fromCloud(`/app/lore/archivo/${encodeURIComponent(guide.id)}`, signal)).blob();
  } catch (error) {
    // La bajada se cortó a media lectura: es la red.
    throw signal?.aborted || (error as { stop?: unknown }).stop !== undefined ? error : offline();
  }
  recent.set(guide.id, blob);
  let total = [...recent.values()].reduce((sum, b) => sum + b.size, 0);
  for (const [id, b] of recent) {
    if (total <= RECENT_BYTES || id === guide.id) break;
    recent.delete(id);
    total -= b.size;
  }
  return blob;
}

const cloudSource: LoreSource = {
  id: 'nube',
  list: async (signal) => parseLoreIndex(await (await fromCloud('/app/lore', signal)).json()),
  open: async (guide, signal) => {
    const fileName = fileNameOf(guide);
    const ready = recent.get(guide.id);
    if (ready) return { blob: ready, fileName };
    // Con `signal` (el visor, una colección), la descarga es de quien la pidió y se cancela con él.
    if (signal) return { blob: await download(guide, signal), fileName };
    let pending = arriving.get(guide.id);
    if (!pending) {
      pending = download(guide).finally(() => arriving.delete(guide.id));
      arriving.set(guide.id, pending);
    }
    return { blob: await pending, fileName };
  },
};

// ------------------------------------------------------------
// La fuente: la nube (o, solo en desarrollo, datos de ejemplo)
// ------------------------------------------------------------

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Solo en desarrollo: probar la pantalla con datos de ejemplo. */
export const demoAvailable = import.meta.env.DEV;

export function setDemo(on: boolean): void {
  extWrite(AKLORE, 'demo', on || null);
  notify();
}

export const demoOn = () => demoAvailable && extRead<boolean>(AKLORE, 'demo', false) === true;

const currentSource = (): LoreSource => (demoOn() ? demoSource : cloudSource);

export function useLoreSource(): LoreSource {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    currentSource,
    currentSource
  );
}

// ------------------------------------------------------------
// El índice, con copia en este equipo
// ------------------------------------------------------------

interface CachedIndex {
  source: string;
  at: number;
  guides: LoreGuide[];
}

export interface LoreIndexState {
  guides: LoreGuide[];
  loading: boolean;
  error: string | null;
  /** Hora del índice que se muestra (puede ser la copia). */
  at: number | null;
  reload: () => void;
}

function cachedIndex(source: LoreSource | null): { guides: LoreGuide[]; at: number | null } {
  const cached = source ? extRead<CachedIndex | null>(AKLORE, 'index', null) : null;
  if (!cached || cached.source !== source?.id) return { guides: [], at: null };
  try {
    return { guides: parseLoreIndex({ format: 1, guides: cached.guides }), at: cached.at };
  } catch {
    return { guides: [], at: null };
  }
}

export function useLoreIndex(source: LoreSource | null): LoreIndexState {
  /** `of`: de qué fuente es lo que hay en el estado (null: de ninguna todavía). */
  const [state, setState] = useState<{ of: string | null; guides: LoreGuide[]; at: number | null; loading: boolean; error: string | null }>(() => ({
    of: source?.id ?? null,
    ...cachedIndex(source),
    loading: !!source,
    error: null,
  }));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!source) {
      setState({ of: null, guides: [], at: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    // Mientras llega el índice, la copia de este equipo: se ve al instante y es
    // lo que queda si no hay conexión. (La fuente llega un instante después del
    // primer pintado, cuando se comprueba la cuenta: sin esto la copia no se leía nunca.)
    setState((s) => ({ ...(s.of === source.id && s.guides.length > 0 ? s : { ...s, ...cachedIndex(source) }), of: source.id, loading: true, error: null }));
    source
      .list(controller.signal)
      .then((guides) => {
        const at = Date.now();
        extWrite(AKLORE, 'index', { source: source.id, at, guides } satisfies CachedIndex);
        setState({ of: source.id, guides, at, loading: false, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [source, tick]);

  // Con una fuente que aún no empezó a cargar (el efecto corre tras pintar), ya es «cargando».
  const waiting = !!source && state.of !== source.id;
  return { guides: waiting ? [] : state.guides, at: waiting ? null : state.at, loading: state.loading || waiting, error: waiting ? null : state.error, reload: () => setTick((t) => t + 1) };
}

// ------------------------------------------------------------
// Favoritos: de la cuenta. Viajan con ella (colección `loreFavorites`, una
// ficha por archivo, como el corazón de las canciones): los marcados en la
// laptop aparecen en el celular, y dos personas en un mismo equipo no ven los
// del otro. Quitar uno borra su ficha y la lápida lleva el borrado.
// ------------------------------------------------------------

const favoritesKey = (uid: string) => `loreFavorites_${uid}`;
const NONE: ReadonlySet<string> = new Set();
const favoriteListeners = new Set<() => void>();
/** Lo leído, con el texto del que salió: no se vuelve a armar si no cambió. */
let favoriteCache: { key: string; raw: string | null; ids: ReadonlySet<string> } | null = null;

function readFavorites(): ReadonlySet<string> {
  const uid = activeProfileId();
  if (!uid) return NONE;
  const key = favoritesKey(uid);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* sin almacenamiento: sin favoritos */
  }
  if (favoriteCache && favoriteCache.key === key && favoriteCache.raw === raw) return favoriteCache.ids;
  let ids: ReadonlySet<string> = NONE;
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) ids = new Set(list.map((entry) => (entry as { id?: unknown } | null)?.id).filter((id): id is string => typeof id === 'string'));
  } catch {
    /* ilegible: como si no hubiera */
  }
  favoriteCache = { key, raw, ids };
  return ids;
}

const favoritesChanged = () => favoriteListeners.forEach((fn) => fn());

export function useLoreFavorites(): ReadonlySet<string> {
  return useSyncExternalStore(
    (fn) => {
      favoriteListeners.add(fn);
      // Lo que llega de otro dispositivo de la cuenta (o al cambiar de perfil).
      window.addEventListener(CLOUD_APPLIED_EVENT, fn);
      window.addEventListener('profileUpdated', fn);
      return () => {
        favoriteListeners.delete(fn);
        window.removeEventListener(CLOUD_APPLIED_EVENT, fn);
        window.removeEventListener('profileUpdated', fn);
      };
    },
    readFavorites,
    readFavorites
  );
}

/** Marca o quita un favorito. False: no se pudo guardar (el equipo sin espacio). */
export function toggleFavorite(id: string): boolean {
  const uid = activeProfileId();
  if (!uid) return false;
  const next = new Set(readFavorites());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  try {
    // Ordenados: el mismo conjunto se escribe igual en todos los dispositivos.
    localStorage.setItem(favoritesKey(uid), JSON.stringify([...next].sort().map((entry) => ({ id: entry }))));
  } catch {
    return false;
  }
  favoritesChanged();
  return true;
}

// ------------------------------------------------------------
// Búsqueda (sin tildes ni mayúsculas)
// ------------------------------------------------------------

export const fold = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

export function searchGuides(guides: LoreGuide[], query: string): LoreGuide[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return guides;
  const scored: { guide: LoreGuide; score: number }[] = [];
  for (const guide of guides) {
    const title = fold(guide.title);
    const rest = fold([guide.subject, guide.section, guide.kind, guide.component ?? '', String(guide.year ?? ''), guide.summary ?? ''].join(' '));
    let score = 0;
    let all = true;
    for (const word of words) {
      if (title.includes(word)) score += title.startsWith(word) ? 4 : 3;
      else if (rest.includes(word)) score += 1;
      else {
        all = false;
        break;
      }
    }
    if (all) scored.push({ guide, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.guide);
}

// ------------------------------------------------------------
// Datos de ejemplo (solo desarrollo)
// ------------------------------------------------------------

const DEMO: Omit<LoreGuide, 'updated' | 'format'>[] = [
  { id: 'd1', title: 'Guía de Física', subject: 'Física', section: 'Grupo 4 · Ciencias', kind: 'Guía', component: 'General', lang: 'es', year: 2023, pages: 196, summary: 'Temas, prácticas científicas, evaluación interna y criterios.' },
  { id: 'd2', title: 'Física NS, Prueba 1, mayo de 2024', subject: 'Física', section: 'Grupo 4 · Ciencias', kind: 'Examen', component: 'Prueba 1', lang: 'es', year: 2024, pages: 24 },
  { id: 'd3', title: 'Física NS, Prueba 1, mayo de 2024: esquema de calificación', subject: 'Física', section: 'Grupo 4 · Ciencias', kind: 'Esquema de calificación', component: 'Prueba 1', lang: 'es', year: 2024, pages: 12 },
  { id: 'd4', title: 'Investigación científica: ejemplo con comentarios del moderador', subject: 'Física', section: 'Grupo 4 · Ciencias', kind: 'Ejemplo calificado', component: 'Evaluación interna', lang: 'en', year: 2025, pages: 14 },
  { id: 'd5', title: 'Guía de Matemáticas: Análisis y Enfoques', subject: 'Matemáticas: Análisis y Enfoques', section: 'Grupo 5 · Matemáticas', kind: 'Guía', lang: 'es', year: 2019, pages: 112 },
  { id: 'd6', title: 'Exploración matemática: ejemplo calificado A', subject: 'Matemáticas: Análisis y Enfoques', section: 'Grupo 5 · Matemáticas', kind: 'Ejemplo calificado', component: 'Exploración', lang: 'en', year: 2021, pages: 20 },
  { id: 'd7', title: 'Historia, Prueba 2, noviembre de 2023', subject: 'Historia', section: 'Grupo 3 · Individuos y sociedades', kind: 'Examen', component: 'Prueba 2', lang: 'es', year: 2023, pages: 8 },
  { id: 'd8', title: 'Informe de la asignatura: Historia, mayo de 2024', subject: 'Historia', section: 'Grupo 3 · Individuos y sociedades', kind: 'Informe del examinador', lang: 'es', year: 2024, pages: 41 },
  { id: 'd9', title: 'Guía de Teoría del Conocimiento', subject: 'Teoría del Conocimiento', section: 'Tronco común', kind: 'Guía', lang: 'es', year: 2021, pages: 64 },
  { id: 'd10', title: 'Ensayo de TdC: ejemplo con comentarios del examinador', subject: 'Teoría del Conocimiento', section: 'Tronco común', kind: 'Ejemplo calificado', component: 'Ensayo', lang: 'es-en', year: 2022, pages: 9 },
  { id: 'd11', title: 'English B HL Paper 1, May 2024', subject: 'Inglés B', section: 'Grupo 2 · Adquisición de lenguas', kind: 'Examen', component: 'Paper 1', lang: 'en', year: 2024, pages: 6 },
  { id: 'd12', title: 'Límites de calificación, mayo de 2024', subject: 'General del PD', section: 'General', kind: 'Límites de calificación', lang: 'es', year: 2024, pages: 30 },
];

const demoSource: LoreSource = {
  id: 'demo',
  list: async () => {
    await new Promise((r) => setTimeout(r, 300));
    return DEMO.map((g, i) => ({ ...g, format: 'pdf' as const, updated: new Date(Date.UTC(2026, 10, 4)).toISOString(), size: 180_000 + i * 731_113 }));
  },
  open: async (guide) => {
    const body = `%PDF-1.4\n% ${guide.title} (ejemplo de desarrollo)\n`;
    return { blob: new Blob([body], { type: 'application/pdf' }), fileName: fileNameOf(guide) };
  },
};

// Al desinstalar, la copia del índice y el modo de ejemplo se borran con el
// resto de sus datos, y los archivos abiertos salen de la memoria. Los
// favoritos son de la cuenta: se quedan, por si vuelve a activarla.
onExtensionTeardown(AKLORE, () => {
  forgetOpenedFiles();
  notify();
});
