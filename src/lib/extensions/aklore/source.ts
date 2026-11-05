import { useEffect, useState, useSyncExternalStore } from 'react';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { tr } from '@/lib/i18n';

// ============================================================
// AK Lore (1.7.3): guías del material recopilado del colegio.
//
// La FUENTE del material aún no existe; Diego decide de dónde se lee. Aquí
// queda la conexión preparada:
//   · `LoreSource`: lo único que la pantalla necesita de una fuente (listar
//     el índice y abrir una guía);
//   · `jsonIndexSource`: un adaptador para un índice JSON (formato abajo),
//     que puede servir cualquier origen (una carpeta compartida, una base de
//     datos, la web de Asvent); sin conectar;
//   · el índice se guarda en este equipo para buscar sin red.
// Mientras no haya fuente, la pantalla lo dice. En desarrollo se puede
// probar con datos de ejemplo (nunca en la app publicada).
//
// Formato del índice (versión 1):
// {
//   "format": 1,
//   "guides": [
//     { "id": "mat-5-derivadas", "title": "Derivadas: guía de repaso",
//       "subject": "Matemáticas", "kind": "Guía", "grade": "5.º",
//       "author": "…", "updated": "2026-11-01", "format": "pdf",
//       "size": 482113, "summary": "…", "tags": ["cálculo"],
//       "href": "https://…/derivadas.pdf" }
//   ]
// }
// ============================================================

export const AKLORE = 'frame.aklore';

export const LORE_FORMATS = ['pdf', 'docx', 'pptx', 'xlsx', 'md', 'txt', 'image', 'link', 'other'] as const;
export type LoreFormat = (typeof LORE_FORMATS)[number];

export interface LoreGuide {
  id: string;
  title: string;
  subject: string;
  /** Guía, resumen, examen resuelto, apuntes… */
  kind: string;
  grade?: string;
  author?: string;
  /** Fecha ISO de la última versión. */
  updated: string;
  format: LoreFormat;
  size?: number;
  summary?: string;
  tags?: string[];
  /** Dónde está el archivo (solo lo usa la fuente). */
  href?: string;
}

export type LoreContent = { kind: 'file'; blob: Blob; fileName: string } | { kind: 'link'; url: string };

export interface LoreSource {
  id: string;
  name: string;
  /** Todo el índice. */
  list(signal?: AbortSignal): Promise<LoreGuide[]>;
  /** El contenido de una guía, para verla o descargarla. */
  open(guide: LoreGuide, signal?: AbortSignal): Promise<LoreContent>;
}

// ------------------------------------------------------------
// Índice JSON (validado: lo que no cumple, se descarta)
// ------------------------------------------------------------

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export function parseLoreIndex(raw: unknown): LoreGuide[] {
  const root = raw as { format?: unknown; guides?: unknown } | null;
  if (!root || root.format !== 1 || !Array.isArray(root.guides)) throw new Error(tr('El índice de AK Lore no tiene el formato esperado.'));
  const seen = new Set<string>();
  const out: LoreGuide[] = [];
  for (const item of root.guides.slice(0, 20_000)) {
    const g = item as Record<string, unknown>;
    const id = text(g?.id, 120);
    const title = text(g?.title, 200);
    const subject = text(g?.subject, 80);
    if (!id || !title || !subject || seen.has(id)) continue;
    seen.add(id);
    const format = (LORE_FORMATS as readonly string[]).includes(String(g.format)) ? (g.format as LoreFormat) : 'other';
    const href = text(g.href, 2000);
    out.push({
      id,
      title,
      subject,
      kind: text(g.kind, 40) || tr('Guía'),
      ...(text(g.grade, 20) ? { grade: text(g.grade, 20) } : {}),
      ...(text(g.author, 80) ? { author: text(g.author, 80) } : {}),
      updated: Number.isFinite(Date.parse(String(g.updated))) ? new Date(String(g.updated)).toISOString() : new Date(0).toISOString(),
      format,
      ...(typeof g.size === 'number' && g.size >= 0 ? { size: g.size } : {}),
      ...(text(g.summary, 600) ? { summary: text(g.summary, 600) } : {}),
      ...(Array.isArray(g.tags) ? { tags: g.tags.map((t) => text(t, 40)).filter(Boolean).slice(0, 12) } : {}),
      ...(/^https:\/\//i.test(href) ? { href } : {}),
    });
  }
  return out;
}

/**
 * Una fuente que lee un índice JSON por HTTPS. `headers` da la credencial
 * que haga falta (la decide la fuente elegida). Aún no se usa.
 */
export function jsonIndexSource(options: { id: string; name: string; indexUrl: string; headers?: () => Promise<Record<string, string>> }): LoreSource {
  const get = async (url: string, signal?: AbortSignal) => {
    const resp = await fetch(url, { headers: (await options.headers?.()) ?? {}, signal });
    if (!resp.ok) throw new Error(tr('El material respondió {status}.', { status: resp.status }));
    return resp;
  };
  return {
    id: options.id,
    name: options.name,
    list: async (signal) => parseLoreIndex(await (await get(options.indexUrl, signal)).json()),
    open: async (guide, signal) => {
      if (!guide.href) throw new Error(tr('Esa guía no dice dónde está su archivo.'));
      if (guide.format === 'link') return { kind: 'link', url: guide.href };
      const blob = await (await get(guide.href, signal)).blob();
      return { kind: 'file', blob, fileName: fileNameOf(guide) };
    },
  };
}

const EXTENSION: Record<LoreFormat, string> = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', md: 'md', txt: 'txt', image: 'png', link: 'url', other: 'bin' };

export function fileNameOf(guide: LoreGuide): string {
  const base = `${guide.subject} - ${guide.title}`.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
  return `${base}.${EXTENSION[guide.format]}`;
}

// ------------------------------------------------------------
// La fuente conectada (ninguna, hasta que Diego la elija)
// ------------------------------------------------------------

let connected: LoreSource | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

/** Para cuando exista el material: conectar (o quitar) la fuente. */
export function connectLoreSource(source: LoreSource | null): void {
  connected = source;
  notify();
}

/** Solo en desarrollo: probar la pantalla con guías de ejemplo. */
export const demoAvailable = import.meta.env.DEV;

export function setDemo(on: boolean): void {
  extWrite(AKLORE, 'demo', on || null);
  notify();
}

function currentSource(): LoreSource | null {
  if (connected) return connected;
  if (demoAvailable && extRead(AKLORE, 'demo', false)) return demoSource;
  return null;
}

export function useLoreSource(): LoreSource | null {
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

export function useLoreIndex(source: LoreSource | null): LoreIndexState {
  const cached = source ? extRead<CachedIndex | null>(AKLORE, 'index', null) : null;
  const usable = cached && cached.source === source?.id ? cached : null;
  const [state, setState] = useState<{ guides: LoreGuide[]; at: number | null; loading: boolean; error: string | null }>({
    guides: usable?.guides ?? [],
    at: usable?.at ?? null,
    loading: !!source,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!source) {
      setState({ guides: [], at: null, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    source
      .list(controller.signal)
      .then((guides) => {
        const at = Date.now();
        extWrite(AKLORE, 'index', { source: source.id, at, guides } satisfies CachedIndex);
        setState({ guides, at, loading: false, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState((s) => ({ ...s, loading: false, error: error instanceof Error ? error.message : String(error) }));
      });
    return () => controller.abort();
  }, [source, tick]);

  return { ...state, reload: () => setTick((t) => t + 1) };
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
  if (words.length === 0) return [...guides].sort((a, b) => b.updated.localeCompare(a.updated));
  const scored: { guide: LoreGuide; score: number }[] = [];
  for (const guide of guides) {
    const title = fold(guide.title);
    const rest = fold([guide.subject, guide.kind, guide.grade ?? '', guide.author ?? '', guide.summary ?? '', ...(guide.tags ?? [])].join(' '));
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
  return scored.sort((a, b) => b.score - a.score || b.guide.updated.localeCompare(a.guide.updated)).map((s) => s.guide);
}

// ------------------------------------------------------------
// Datos de ejemplo (solo desarrollo)
// ------------------------------------------------------------

const DEMO: Omit<LoreGuide, 'updated'>[] = [
  { id: 'd1', title: 'Derivadas: reglas y ejercicios resueltos', subject: 'Matemáticas', kind: 'Guía', grade: '5.º', format: 'md', summary: 'Reglas de derivación, regla de la cadena y diez ejercicios resueltos paso a paso.', tags: ['cálculo', 'derivadas'] },
  { id: 'd2', title: 'Integrales por partes', subject: 'Matemáticas', kind: 'Resumen', grade: '5.º', format: 'md', summary: 'Cuándo usar integración por partes y cómo elegir u y dv.', tags: ['cálculo'] },
  { id: 'd3', title: 'Cinemática en una dimensión', subject: 'Física', kind: 'Guía', grade: '4.º', format: 'md', summary: 'MRU, MRUV y caída libre con gráficos de posición y velocidad.', tags: ['mecánica'] },
  { id: 'd4', title: 'Leyes de Newton: problemas tipo', subject: 'Física', kind: 'Examen resuelto', grade: '4.º', format: 'md', summary: 'Diagramas de cuerpo libre y planos inclinados.', tags: ['dinámica'] },
  { id: 'd5', title: 'Estequiometría sin miedo', subject: 'Química', kind: 'Guía', grade: '4.º', format: 'md', summary: 'Moles, reactivo limitante y rendimiento.', tags: ['moles'] },
  { id: 'd6', title: 'Revolución Industrial: causas y consecuencias', subject: 'Historia', kind: 'Resumen', grade: '5.º', format: 'md', summary: 'Esquema con fechas clave y fuentes para comentar.', tags: ['siglo XIX'] },
  { id: 'd7', title: 'Guerra Fría en mapas', subject: 'Historia', kind: 'Apuntes', grade: '5.º', format: 'md', summary: 'Bloques, crisis y conferencias en orden cronológico.', tags: ['siglo XX'] },
  { id: 'd8', title: 'Essay structure: thesis and topic sentences', subject: 'Inglés', kind: 'Guía', grade: '4.º', format: 'md', summary: 'How to build a thesis and connect paragraphs.', tags: ['writing'] },
  { id: 'd9', title: 'Célula y orgánulos', subject: 'Biología', kind: 'Resumen', grade: '3.º', format: 'md', summary: 'Funciones de cada orgánulo con un esquema para memorizar.', tags: ['célula'] },
  { id: 'd10', title: 'Genética mendeliana', subject: 'Biología', kind: 'Guía', grade: '4.º', format: 'md', summary: 'Cuadros de Punnett, dominancia y probabilidad.', tags: ['genética'] },
  { id: 'd11', title: 'Ecuaciones cuadráticas', subject: 'Matemáticas', kind: 'Apuntes', grade: '3.º', format: 'md', summary: 'Fórmula general, discriminante y factorización.', tags: ['álgebra'] },
  { id: 'd12', title: 'Ondas y sonido', subject: 'Física', kind: 'Resumen', grade: '5.º', format: 'md', summary: 'Frecuencia, longitud de onda, efecto Doppler.', tags: ['ondas'] },
];

const demoSource: LoreSource = {
  id: 'demo',
  name: tr('Datos de ejemplo'),
  list: async () => {
    await new Promise((r) => setTimeout(r, 350));
    const day = 86_400_000;
    return DEMO.map((g, i) => ({ ...g, updated: new Date(Date.UTC(2026, 10, 4) - i * 3 * day).toISOString(), size: 2000 + i * 731 }));
  },
  open: async (guide) => {
    const body = `# ${guide.title}\n\n${guide.subject} · ${guide.kind}${guide.grade ? ` · ${guide.grade}` : ''}\n\n${guide.summary ?? ''}\n\n(Guía de ejemplo para probar AK Lore: el material real aún no está conectado.)\n`;
    return { kind: 'file', blob: new Blob([body], { type: 'text/markdown' }), fileName: fileNameOf(guide) };
  },
};

// Al desinstalar, la copia del índice y el modo de ejemplo se borran con el
// resto de sus datos; quien muestre la fuente se entera.
onExtensionTeardown(AKLORE, notify);
