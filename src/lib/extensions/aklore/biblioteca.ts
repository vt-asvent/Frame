import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SESSION_RESTORED_EVENT } from '@/lib/connection-status';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { format } from 'date-fns';
import { dateLocale, tr } from '@/lib/i18n';
import { activeProfileId } from '@/lib/profile-scope';
import { CLOUD_APPLIED_EVENT } from '@/lib/sync-merge';
import { AKLORE, demoOn, fold, fromCloud } from './source';

// ============================================================
// Biblioteca 2 (1.9.7): la carpeta «AK Lore» del Drive de Asvent, tal cual.
//
// La nube (nube-ia/src/biblioteca.ts) lee esa carpeta cada 5 minutos y da su
// índice: carpetas, archivos y accesos directos, con la descripción y las
// propiedades de cada uno. Aquí se arma la Biblioteca que se ve:
//   AK Lore / <Asignatura> / <Apartado> / <archivo>
// con los apartados «Guía y programa», «Temas», «Exámenes» y «Trabajos», y
// `_Biblioteca` (configuración, Destacados, Tarjetas y Portadas). Lo que no
// está donde debe se muestra igual (en «Otros»): la app es tolerante; el
// validador del contrato, estricto. Subir o mover algo en Drive basta.
//
// 1.9.8: la configuración trae los «programas» (IB, CNEB…), cada uno con sus
// grupos de asignaturas y sus pruebas: de ahí salen los filtros de la pantalla.
// Nada de eso está escrito en la app.
//
// 1.9.9: más filtros (convocatoria y año, procedencia, programa vigente,
// tarjetas, idioma, formato y clase de material; `pasaFiltros`), y «Tu
// paquete»: las asignaturas que la configuración da por fijas más las que el
// alumno elige, para bajarlas enteras (paquete.ts). Ya no se pregunta cuándo
// se dan los exámenes: rige la guía que la configuración pone primero.
// ============================================================

export interface BibNode {
  i: string;
  p: string | null;
  n: string;
  k: 'd' | 'f' | 's';
  m: string;
  d: string | null;
  x: Record<string, string> | null;
  z: number | null;
  t: string | null;
  h: string | null;
  g: string | null;
  v: string | null;
}

export interface BibSubjectConf {
  grupo?: string;
  niveles?: string[];
  alias?: string[];
  programa?: Record<string, string | null>;
  componentes?: string[];
  temas?: string[];
  color?: string;
}

/** Un programa («IB», «CNEB»): lo que se ve con él y los dos filtros que ofrece. */
export interface BibPrograma {
  nombre: string;
  /** Cómo se llama elegir uno de sus grupos («Nivel», «Curso»). */
  etiqueta?: string;
  /** Sus asignaturas, por grupos («Core», «NM»…; o un grupo por curso). */
  grupos: { nombre: string; asignaturas: string[] }[];
  /** Sus pruebas («Prueba 1», «IA»…): cada una reúne los componentes que le tocan. */
  componentes: { nombre: string; incluye: string[] }[];
  /** «Tu paquete»: las asignaturas que lleva siempre y cuántas más se eligen. */
  paquete?: { fijas: string[]; elegir: number };
}

export interface BibConfig {
  programas: BibPrograma[];
  asignaturas: Record<string, BibSubjectConf>;
}

export type Apartado = 'guia' | 'temas' | 'examenes' | 'trabajos' | 'otros';
const APARTADO_DE: Record<string, Apartado> = { 'Guía y programa': 'guia', Temas: 'temas', Exámenes: 'examenes', Trabajos: 'trabajos' };

export interface BibItem {
  id: string;
  title: string;
  ext: string;
  mime: string;
  size: number;
  modified: string | null;
  description: string;
  subject: string;
  apartado: Apartado;
  props: Record<string, string>;
  /** La clave estable (la del contrato) o, si no tiene, su id de Drive. */
  key: string;
  tipo: string;
  /** Versión de la portada copiada por la nube (null: no tiene). */
  cover: string | null;
  /** Portada propia (`_Biblioteca/Portadas/<clave>.*`). */
  customCover: { id: string; v: string } | null;
  hasCards: boolean;
}

export interface BibSubject {
  name: string;
  conf: BibSubjectConf;
  items: BibItem[];
}

export interface BibModel {
  subjects: BibSubject[];
  items: BibItem[];
  byId: Map<string, BibItem>;
  featured: BibItem[];
  config: BibConfig;
}

// ------------------------------------------------------------
// Tipos (lo que se lee en la tarjeta y cómo se agrupa)
// ------------------------------------------------------------

/** Etiqueta de cada tipo, en español (se traduce al pintarla). */
export const TIPO_LABEL: Record<string, string> = {
  guia: 'Guía',
  cuadernillo: 'Cuadernillo',
  programa: 'Programa',
  'material-de-ayuda': 'Material de ayuda',
  'documento-oficial': 'Documento oficial',
  clase: 'Clase',
  apuntes: 'Apuntes',
  lectura: 'Lectura',
  libro: 'Libro',
  obra: 'Obra',
  banco: 'Preguntas por tema',
  practica: 'Práctica',
  solucion: 'Solución',
  examen: 'Examen',
  esquema: 'Esquema de calificación',
  informe: 'Informe de los examinadores',
  'respuesta-calificada': 'Respuesta calificada',
  'prueba-colegio': 'Prueba del colegio',
  simulacro: 'Simulacro con IA',
  orientaciones: 'Orientaciones',
  ejemplo: 'Ejemplo calificado',
  criterios: 'Criterios',
  formulario: 'Formulario',
};

export const tipoLabel = (item: BibItem) => tr(TIPO_LABEL[item.tipo] ?? (item.ext ? item.ext.toUpperCase() : 'Archivo'));


/** «2025-05» → «mayo de 2025»; «muestra-2025» → «Examen de muestra (2025)». */
export function convocatoriaLabel(value: string | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (m) return tr('{mes} de {anio}', { mes: format(new Date(Number(m[1]), Number(m[2]) - 1, 1), 'LLLL', { locale: dateLocale() }), anio: m[1] });
  const s = /^muestra-(\d{4})$/.exec(value);
  return s ? tr('Examen de muestra ({anio})', { anio: s[1] }) : value;
}

const LANG_LABEL: Record<string, string> = { es: 'Español', en: 'Inglés', 'es-en': 'Español e inglés', fr: 'Francés', de: 'Alemán', pt: 'Portugués', it: 'Italiano' };
export const idiomaLabel = (lang: string | undefined) => (!lang ? '' : LANG_LABEL[lang] ? tr(LANG_LABEL[lang]) : lang.toUpperCase());

/** La guía que rige en una asignatura: la de la primera convocatoria que la tenga puesta (van de la más próxima). */
export const vigenteDe = (conf: BibSubjectConf | undefined): string | null => Object.values(conf?.programa ?? {}).find((v): v is string => !!v) ?? null;

/** ¿De qué guía es, respecto de la que rige? */
export function programaDe(item: BibItem, conf: BibSubjectConf | undefined): 'vigente' | 'anterior' | 'siguiente' | null {
  const vigente = vigenteDe(conf);
  const guia = item.props.guia;
  if (!vigente || !guia) return null;
  return guia === vigente ? 'vigente' : guia < vigente ? 'anterior' : 'siguiente';
}

/** ¿Vale para ese nivel? Sin nivel, vale para los dos. */
export const deNivel = (item: BibItem, nivel: 'NM' | 'NS' | null) => !nivel || !item.props.nivel || item.props.nivel.includes(nivel);

export const temasDe = (item: BibItem) => (item.props.tema ? item.props.tema.split('|').map((t) => t.trim()).filter(Boolean) : []);
export const vinculosDe = (item: BibItem) => (item.props.vinculos ? item.props.vinculos.split('|').map((t) => t.trim()).filter(Boolean) : []);

// ------------------------------------------------------------
// El modelo, a partir de los nodos
// ------------------------------------------------------------

const EMPTY_CONFIG: BibConfig = { programas: [], asignaturas: {} };

export function parseConfig(raw: unknown): BibConfig {
  const c = raw as Partial<BibConfig> | null;
  if (!c || typeof c !== 'object') return EMPTY_CONFIG;
  const list = <T,>(v: unknown, ok: (x: unknown) => x is T): T[] => (Array.isArray(v) ? v.filter(ok) : []);
  const isText = (x: unknown): x is string => typeof x === 'string';
  const asignaturas: Record<string, BibSubjectConf> = {};
  if (c.asignaturas && typeof c.asignaturas === 'object') {
    for (const [name, a] of Object.entries(c.asignaturas as Record<string, BibSubjectConf>)) {
      if (!a || typeof a !== 'object') continue;
      asignaturas[name] = {
        grupo: isText(a.grupo) ? a.grupo : undefined,
        niveles: list(a.niveles, isText),
        alias: list(a.alias, isText),
        programa: a.programa && typeof a.programa === 'object' ? a.programa : {},
        componentes: list(a.componentes, isText),
        temas: list(a.temas, isText),
        color: isText(a.color) && /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : undefined,
      };
    }
  }
  return {
    programas: list(c.programas, (x): x is BibPrograma => !!x && isText((x as BibPrograma).nombre)).map((p) => ({
      nombre: p.nombre,
      etiqueta: isText(p.etiqueta) ? p.etiqueta : undefined,
      grupos: list(p.grupos, (g): g is BibPrograma['grupos'][number] => !!g && isText((g as { nombre?: unknown }).nombre)).map((g) => ({ nombre: g.nombre, asignaturas: list(g.asignaturas, isText) })),
      componentes: list(p.componentes, (k): k is BibPrograma['componentes'][number] => !!k && isText((k as { nombre?: unknown }).nombre)).map((k) => ({ nombre: k.nombre, incluye: list(k.incluye, isText) })),
      ...(p.paquete && typeof p.paquete === 'object' ? { paquete: { fijas: list(p.paquete.fijas, isText), elegir: Math.max(0, Math.min(10, Math.floor(Number(p.paquete.elegir) || 0))) } } : {}),
    })),
    asignaturas,
  };
}

/** Las asignaturas de un programa (o de uno de sus grupos). Las que ningún programa nombra van con el primero. */
export function subjectsIn(model: BibModel, programa: BibPrograma | null, grupo: string | null): BibSubject[] {
  if (!programa) return model.subjects;
  const all = model.config.programas;
  const group = programa.grupos.find((g) => g.nombre === grupo);
  const names = new Set((group ? [group] : programa.grupos).flatMap((g) => g.asignaturas));
  const listed = new Set(all.flatMap((p) => p.grupos.flatMap((g) => g.asignaturas)));
  return model.subjects.filter((s) => names.has(s.name) || (!group && programa === all[0] && !listed.has(s.name)));
}

/** ¿Es de esa prueba? (`null`: sin filtro). */
export const deComponente = (item: BibItem, componente: BibPrograma['componentes'][number] | null) => !componente || componente.incluye.includes(item.props.componente ?? '');

// ------------------------------------------------------------
// Filtros (1.9.9): cada lista vacía no filtra; con valores, el archivo debe
// coincidir con alguno. Viven en la pantalla (no se guardan).
// ------------------------------------------------------------

export interface BibFiltros {
  /** Convocatoria: '05' (mayo), '11' (noviembre). */
  meses: string[];
  anios: string[];
  /** 'IB' · 'colegio' · 'IA' · 'otros'. */
  origen: string[];
  /** 'vigente' · 'anterior'. */
  programa: string[];
  /** 'con' · 'sin' tarjetas de estudio. */
  tarjetas: string[];
  /** 'es' · 'en'. */
  idioma: string[];
  /** 'pdf' · 'audio' · 'video' · 'otros'. */
  formato: string[];
  /** Clase de material (`tipo`). */
  tipos: string[];
}

export const SIN_FILTROS: BibFiltros = { meses: [], anios: [], origen: [], programa: [], tarjetas: [], idioma: [], formato: [], tipos: [] };

/** El año de un archivo: el de su convocatoria o examen de muestra, o el que dice su ficha. */
export const anioDe = (item: BibItem): string | null => /^(?:muestra-)?(\d{4})/.exec(item.props.convocatoria ?? '')?.[1] ?? item.props.anio ?? null;
/** El mes de su convocatoria ('05', '11'), si es de una. */
export const mesDe = (item: BibItem): string | null => /^\d{4}-(\d{2})$/.exec(item.props.convocatoria ?? '')?.[1] ?? null;
export const origenDe = (item: BibItem) => (['IB', 'colegio', 'IA'].includes(item.props.origen ?? '') ? item.props.origen! : 'otros');
export const formatoDe = (item: BibItem) => (item.ext === 'pdf' ? 'pdf' : ['mp3', 'm4a'].includes(item.ext) ? 'audio' : item.ext === 'mp4' ? 'video' : 'otros');

export function pasaFiltros(item: BibItem, f: BibFiltros, conf: BibSubjectConf | undefined): boolean {
  const en = (lista: string[], valor: string | null) => lista.length === 0 || (valor !== null && lista.includes(valor));
  if (!en(f.meses, mesDe(item)) || !en(f.anios, anioDe(item)) || !en(f.origen, origenDe(item)) || !en(f.formato, formatoDe(item)) || !en(f.tipos, item.tipo)) return false;
  if (f.idioma.length > 0 && !f.idioma.some((l) => (item.props.idioma ?? '').split('-').includes(l))) return false;
  // Con las dos opciones marcadas (o ninguna) no hay nada que filtrar.
  if (f.tarjetas.length === 1 && (f.tarjetas[0] === 'con') !== item.hasCards) return false;
  if (f.programa.length === 1 && (f.programa[0] === 'anterior') !== (programaDe(item, conf) === 'anterior')) return false;
  return true;
}

/** Cuántos filtros avanzados están puestos (el año y la convocatoria tienen su propio botón). */
export const avanzadosPuestos = (f: BibFiltros) => [f.origen, f.programa, f.tarjetas, f.idioma, f.formato, f.tipos].filter((l) => l.length > 0).length;

const LOOSE = 'Otros archivos';

export function buildModel(nodes: BibNode[], raiz: string | null, rawConfig: unknown): BibModel {
  const config = parseConfig(rawConfig);
  const kids = new Map<string, BibNode[]>();
  for (const n of nodes) if (n.p) kids.set(n.p, [...(kids.get(n.p) ?? []), n]);
  const children = (id: string) => kids.get(id) ?? [];
  const top = raiz ? children(raiz) : [];

  // _Biblioteca: Destacados (en el orden de sus nombres), Tarjetas y Portadas.
  const reserved = top.find((n) => n.k === 'd' && n.n === '_Biblioteca');
  const sub = (name: string) => (reserved ? children(reserved.i).find((n) => n.k === 'd' && n.n === name) : undefined);
  const featuredTargets = (sub('Destacados') ? children(sub('Destacados')!.i) : [])
    .filter((n) => n.k === 's' && n.g)
    .sort((a, b) => a.n.localeCompare(b.n, 'es', { numeric: true }))
    .map((n) => n.g!);
  const cardKeys = new Set((sub('Tarjetas') ? children(sub('Tarjetas')!.i) : []).filter((n) => n.k === 'f' && n.n.endsWith('.json')).map((n) => n.n.slice(0, -5)));
  const covers = new Map<string, { id: string; v: string }>();
  for (const n of sub('Portadas') ? children(sub('Portadas')!.i) : []) {
    const m = /^(.+)\.(jpe?g|png|webp)$/i.exec(n.n);
    if (n.k === 'f' && m && n.v) covers.set(m[1]!, { id: n.i, v: n.v });
  }

  const items: BibItem[] = [];
  const add = (n: BibNode, subject: string, apartado: Apartado) => {
    const ext = /\.([A-Za-z0-9]{1,5})$/.exec(n.n)?.[1]?.toLowerCase() ?? '';
    const props = n.x && typeof n.x === 'object' ? n.x : {};
    const key = props.clave && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(props.clave) ? props.clave : n.i;
    items.push({
      id: n.i,
      title: (ext ? n.n.slice(0, -(ext.length + 1)) : n.n).trim() || n.n,
      ext,
      mime: n.m,
      size: n.z ?? 0,
      modified: n.t,
      description: n.d?.trim() ?? '',
      subject,
      apartado,
      props,
      key,
      tipo: props.tipo ?? '',
      cover: n.v,
      customCover: covers.get(key) ?? null,
      hasCards: cardKeys.has(key),
    });
  };
  /** Lo que haya más abajo, sin niveles: se muestra en su apartado. */
  const flatten = (id: string, subject: string, apartado: Apartado) => {
    for (const c of children(id)) {
      if (c.k === 'd') flatten(c.i, subject, apartado);
      else if (c.k === 'f') add(c, subject, apartado);
    }
  };
  for (const n of top) {
    if (n === reserved) continue;
    if (n.k === 'f') add(n, LOOSE, 'otros');
    if (n.k !== 'd') continue;
    for (const c of children(n.i)) {
      if (c.k === 'd') flatten(c.i, n.n, APARTADO_DE[c.n] ?? 'otros');
      else if (c.k === 'f') add(c, n.n, 'otros');
    }
  }

  const bySubject = new Map<string, BibItem[]>();
  for (const it of items) bySubject.set(it.subject, [...(bySubject.get(it.subject) ?? []), it]);
  // En el orden de los programas y sus grupos; lo que no nombran, al final.
  const order = config.programas.flatMap((p) => p.grupos.flatMap((g) => g.asignaturas));
  const subjects: BibSubject[] = [...bySubject.keys()]
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b, 'es');
    })
    .map((name) => ({ name, conf: config.asignaturas[name] ?? {}, items: bySubject.get(name)! }));
  const byId = new Map(items.map((it) => [it.id, it]));
  const featured = featuredTargets.map((id) => byId.get(id)).filter((it): it is BibItem => !!it);
  return { subjects, items, byId, featured, config };
}

// ------------------------------------------------------------
// Búsqueda (sin tildes ni mayúsculas): título, descripción y lo que lo describe
// ------------------------------------------------------------

export function searchItems(items: BibItem[], query: string): BibItem[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  const scored: { item: BibItem; score: number }[] = [];
  for (const item of items) {
    const title = fold(item.title);
    const rest = fold(
      [item.subject, tipoLabel(item), item.description, item.props.componente ?? '', item.props.tema ?? '', convocatoriaLabel(item.props.convocatoria), item.props.anio ?? '', item.props.parte ?? ''].join(' ')
    );
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
    if (all) scored.push({ item, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'es', { numeric: true })).map((s) => s.item);
}

// ------------------------------------------------------------
// El índice, con copia en este equipo (se ve al instante y sin red)
// ------------------------------------------------------------

interface IndexCopy {
  actualizado: string | null;
  raiz: string | null;
  config: unknown;
  nodos: BibNode[];
}

interface IndexPart extends IndexCopy {
  formato: number;
  partes: number;
  parte: number;
  igual?: boolean;
}

const INDEX_KEY = 'indice2';

async function fetchIndex(known: IndexCopy | null, signal: AbortSignal): Promise<IndexCopy> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const si = known?.actualizado ? `&si=${encodeURIComponent(known.actualizado)}` : '';
    const first = (await (await fromCloud(`/app/biblioteca?parte=0${si}`, signal)).json()) as IndexPart;
    if (first.formato !== 2) throw new Error(tr('El índice de la Biblioteca no tiene el formato esperado.'));
    if (first.igual && known) return known;
    const nodos = [...(first.nodos ?? [])];
    let moved = false;
    for (let p = 1; p < first.partes; p++) {
      const part = (await (await fromCloud(`/app/biblioteca?parte=${p}`, signal)).json()) as IndexPart;
      // La nube rearmó el índice a medias: se empieza de nuevo.
      if (part.actualizado !== first.actualizado) {
        moved = true;
        break;
      }
      nodos.push(...(part.nodos ?? []));
    }
    if (!moved) return { actualizado: first.actualizado, raiz: first.raiz, config: first.config, nodos };
  }
  throw new Error(tr('La Biblioteca se está actualizando. Vuelve a intentarlo en un momento.'));
}

export interface BibState {
  model: BibModel | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useBiblioteca(enabled: boolean): BibState {
  const demo = demoOn();
  const [copy, setCopy] = useState<IndexCopy | null>(() => (demo ? demoIndex() : extRead<IndexCopy | null>(AKLORE, INDEX_KEY, null)));
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    if (demo) {
      setCopy(demoIndex());
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const known = extRead<IndexCopy | null>(AKLORE, INDEX_KEY, null);
    fetchIndex(known, controller.signal)
      .then((fresh) => {
        if (fresh !== known) {
          extWrite(AKLORE, INDEX_KEY, fresh);
          // La copia de la Biblioteca anterior (1.9.2) ya no se usa.
          extWrite(AKLORE, 'index', null);
        }
        setCopy(fresh);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoading(false);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => controller.abort();
  }, [enabled, demo, tick]);

  useEffect(() => {
    const again = () => setTick((t) => t + 1);
    window.addEventListener(SESSION_RESTORED_EVENT, again);
    return () => window.removeEventListener(SESSION_RESTORED_EVENT, again);
  }, []);

  const model = useMemo(() => (copy ? buildModel(copy.nodos, copy.raiz, copy.config) : null), [copy]);
  return { model, loading, error, reload: () => setTick((t) => t + 1) };
}

// ------------------------------------------------------------
// Portadas: la que copió la nube, de a pocas a la vez
// ------------------------------------------------------------

const coverUrls = new Map<string, string>();
const coverWaiting = new Map<string, Promise<string | null>>();
let coverActive = 0;
const coverQueue: (() => void)[] = [];
const COVER_PARALLEL = 4;

async function loadCover(id: string, v: string): Promise<string | null> {
  if (coverActive >= COVER_PARALLEL) await new Promise<void>((go) => coverQueue.push(go));
  coverActive++;
  try {
    const blob = await (await fromCloud(`/app/biblioteca/vista/${encodeURIComponent(id)}?v=${encodeURIComponent(v)}`)).blob();
    if (!blob.type.startsWith('image/')) return null;
    const url = URL.createObjectURL(blob);
    coverUrls.set(`${id}:${v}`, url);
    return url;
  } catch {
    return null;
  } finally {
    coverActive--;
    coverQueue.shift()?.();
  }
}

/** La portada de un archivo (dirección de imagen): su primera página, o null mientras llega o si no tiene. */
export function useCover(item: BibItem | null, visible: boolean): string | null {
  const target = !item || demoOn() ? null : item.customCover ?? (item.cover ? { id: item.id, v: item.cover } : null);
  const key = target ? `${target.id}:${target.v}` : null;
  const [url, setUrl] = useState<string | null>(() => (key ? coverUrls.get(key) ?? null : null));
  useEffect(() => {
    if (!key || !target) {
      setUrl(null);
      return;
    }
    const ready = coverUrls.get(key);
    if (ready) {
      setUrl(ready);
      return;
    }
    if (!visible) return;
    let alive = true;
    let pending = coverWaiting.get(key);
    if (!pending) {
      pending = loadCover(target.id, target.v).finally(() => coverWaiting.delete(key));
      coverWaiting.set(key, pending);
    }
    void pending.then((made) => alive && setUrl(made));
    return () => {
      alive = false;
    };
    // `target` sale de `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, visible]);
  return url;
}

// ------------------------------------------------------------
// Archivos
// ------------------------------------------------------------

const recent = new Map<string, Blob>();
const RECENT_BYTES = 80 * 1024 * 1024;
const arriving = new Map<string, Promise<Blob>>();

export function forgetBibFiles(): void {
  recent.clear();
}

const MIME_DE: Record<string, string> = { pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export const fileNameOf = (item: BibItem) => {
  const base = item.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 150) || item.id;
  return item.ext ? `${base}.${item.ext}` : base;
};

async function download(item: BibItem): Promise<Blob> {
  if (demoOn()) return demoFile(item);
  const blob = await (await fromCloud(`/app/biblioteca/archivo/${encodeURIComponent(item.id)}`)).blob();
  const typed = blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: MIME_DE[item.ext] ?? 'application/octet-stream' });
  recent.set(item.id, typed);
  let total = [...recent.values()].reduce((s, b) => s + b.size, 0);
  for (const [id, b] of recent) {
    if (total <= RECENT_BYTES || id === item.id) break;
    recent.delete(id);
    total -= b.size;
  }
  return typed;
}

/** El archivo entero (para abrirlo, verlo o guardarlo). Pedirlo dos veces espera a la misma descarga. */
export async function openItem(item: BibItem): Promise<Blob> {
  const ready = recent.get(item.id);
  if (ready) return ready;
  let pending = arriving.get(item.id);
  if (!pending) {
    pending = download(item).finally(() => arriving.delete(item.id));
    arriving.set(item.id, pending);
  }
  return pending;
}

/** Un tramo de un archivo (el visor de PDF hojea así sin bajarlo entero). */
export async function readRange(item: BibItem, begin: number, end: number, signal?: AbortSignal): Promise<Uint8Array> {
  const ready = recent.get(item.id);
  if (ready) return new Uint8Array(await ready.slice(begin, end).arrayBuffer());
  if (demoOn()) return new Uint8Array(await (await demoFile(item)).slice(begin, end).arrayBuffer());
  const r = await fromCloud(`/app/biblioteca/archivo/${encodeURIComponent(item.id)}`, signal, { range: `bytes=${begin}-${end - 1}` });
  const bytes = new Uint8Array(await r.arrayBuffer());
  // Un servidor que no admite tramos manda el archivo entero: se recorta.
  return r.status === 206 ? bytes : bytes.slice(begin, end);
}

// ------------------------------------------------------------
// Tarjetas de estudio
// ------------------------------------------------------------

export interface StudyCard {
  id: number;
  frente: string;
  reverso: string;
  pagina?: number;
}

export interface CardSet {
  de: string;
  titulo: string;
  huella: string;
  tarjetas: StudyCard[];
}

export async function fetchCards(item: BibItem): Promise<CardSet> {
  const raw = demoOn() ? DEMO_CARDS : ((await (await fromCloud(`/app/biblioteca/tarjetas/${encodeURIComponent(item.key)}`)).json()) as Record<string, unknown>);
  const list = Array.isArray(raw.tarjetas) ? raw.tarjetas : [];
  const seen = new Set<number>();
  const tarjetas: StudyCard[] = [];
  for (const c of list as Record<string, unknown>[]) {
    const id = c?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || seen.has(id)) continue;
    if (typeof c.frente !== 'string' || typeof c.reverso !== 'string' || !c.frente.trim() || !c.reverso.trim()) continue;
    seen.add(id);
    tarjetas.push({ id, frente: c.frente.slice(0, 600), reverso: c.reverso.slice(0, 1200), ...(typeof c.pagina === 'number' ? { pagina: c.pagina } : {}) });
  }
  if (tarjetas.length === 0) throw new Error(tr('Estas tarjetas no tienen el formato esperado.'));
  return { de: item.key, titulo: typeof raw.titulo === 'string' && raw.titulo.trim() ? raw.titulo.trim() : item.title, huella: typeof raw.huella === 'string' ? raw.huella : '', tarjetas };
}

/** Para Anki o Quizlet: «frente,reverso», con comillas cuando hacen falta. */
export function cardsCsv(set: CardSet): string {
  const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return `﻿${set.tarjetas.map((c) => `${cell(c.frente)},${cell(c.reverso)}`).join('\r\n')}\r\n`;
}

// ------------------------------------------------------------
// Avance de repaso: de la cuenta, viaja con ella (colección `loreStudy`: una
// ficha por juego de tarjetas, con la caja de Leitner y el día en que toca
// cada tarjeta).
// ------------------------------------------------------------

export interface StudyRecord {
  id: string;
  /** id de tarjeta → [caja 1…5, día (desde 1970) en que vuelve a tocar]. */
  c?: Record<string, [number, number]>;
}

const studyKey = (uid: string) => `loreStudy_${uid}`;
const studyListeners = new Set<() => void>();
let studyCache: { key: string; raw: string | null; list: StudyRecord[] } | null = null;
const NO_STUDY: StudyRecord[] = [];

function readStudy(): StudyRecord[] {
  const uid = activeProfileId();
  if (!uid) return NO_STUDY;
  const key = studyKey(uid);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    /* sin almacenamiento */
  }
  if (studyCache && studyCache.key === key && studyCache.raw === raw) return studyCache.list;
  let list: StudyRecord[] = NO_STUDY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) list = parsed.filter((r): r is StudyRecord => !!r && typeof (r as StudyRecord).id === 'string');
  } catch {
    /* ilegible */
  }
  studyCache = { key, raw, list };
  return list;
}

function writeStudy(update: (list: StudyRecord[]) => StudyRecord[]): boolean {
  const uid = activeProfileId();
  if (!uid) return false;
  const next = update(readStudy()).sort((a, b) => a.id.localeCompare(b.id));
  try {
    localStorage.setItem(studyKey(uid), JSON.stringify(next));
  } catch {
    return false;
  }
  studyListeners.forEach((fn) => fn());
  return true;
}

export function useStudy(): StudyRecord[] {
  return useSyncExternalStore(
    (fn) => {
      studyListeners.add(fn);
      window.addEventListener(CLOUD_APPLIED_EVENT, fn);
      window.addEventListener('profileUpdated', fn);
      return () => {
        studyListeners.delete(fn);
        window.removeEventListener(CLOUD_APPLIED_EVENT, fn);
        window.removeEventListener('profileUpdated', fn);
      };
    },
    readStudy,
    readStudy
  );
}

const today = () => Math.floor(Date.now() / 86_400_000);
/** Días hasta volver a ver una tarjeta según su caja (Leitner). */
const GAP = [0, 1, 2, 4, 8, 16];

/** Anota una respuesta: «la sé» sube de caja; «repasar» la devuelve a la 1. */
export function answerCard(set: string, card: number, knew: boolean): boolean {
  return writeStudy((list) => {
    const rec = list.find((r) => r.id === set) ?? { id: set, c: {} };
    const box = rec.c?.[card]?.[0] ?? 0;
    const nextBox = knew ? Math.min(5, box + 1) : 1;
    const c = { ...(rec.c ?? {}), [card]: [nextBox, today() + GAP[nextBox]!] as [number, number] };
    return [...list.filter((r) => r.id !== set), { ...rec, c }];
  });
}

export function resetCards(set: string): boolean {
  return writeStudy((list) => list.filter((r) => r.id !== set));
}

/** Qué toca repasar hoy de un juego (las nuevas y las vencidas), y cuántas domina. */
export function cardsDue(set: CardSet, study: StudyRecord[]): { due: StudyCard[]; known: number } {
  const rec = study.find((r) => r.id === set.de)?.c ?? {};
  const now = today();
  const due = set.tarjetas.filter((c) => !rec[c.id] || rec[c.id]![1] <= now);
  const known = set.tarjetas.filter((c) => (rec[c.id]?.[0] ?? 0) >= 3).length;
  return { due, known };
}

// ------------------------------------------------------------
// Datos de ejemplo (solo desarrollo: probar la pantalla sin la nube)
// ------------------------------------------------------------

const demoNode = (i: string, p: string, n: string, k: BibNode['k'] = 'd', x: Record<string, string> | null = null, d: string | null = null, extra: Partial<BibNode> = {}): BibNode => ({
  i, p, n, k, m: k === 'd' ? 'application/vnd.google-apps.folder' : k === 's' ? 'application/vnd.google-apps.shortcut' : 'application/pdf', d, x, z: k === 'f' ? 240_000 : null, t: '2026-11-11T00:00:00.000Z', h: null, g: null, v: null, ...extra,
});

const DEMO_INDEX: IndexCopy = {
  actualizado: 'demo',
  raiz: 'raiz',
  config: {
    programas: [
      {
        nombre: 'IB',
        etiqueta: 'Nivel',
        grupos: [
          { nombre: 'Troncales', asignaturas: ['Monografía'] },
          { nombre: 'NM', asignaturas: ['Física'] },
          { nombre: 'NS', asignaturas: ['Historia'] },
        ],
        componentes: [
          { nombre: 'Prueba 1', incluye: ['Prueba 1', 'Prueba 1A', 'Prueba 1B'] },
          { nombre: 'Prueba 2', incluye: ['Prueba 2'] },
          { nombre: 'IA', incluye: ['Evaluación interna', 'Investigación histórica'] },
        ],
        paquete: { fijas: ['Historia', 'Monografía'], elegir: 1 },
      },
      { nombre: 'CNEB', etiqueta: 'Curso', grupos: [{ nombre: 'Matemática (3.º)', asignaturas: ['Matemática (3.º)'] }], componentes: [] },
    ],
    asignaturas: {
      Física: { grupo: 'Grupo 4, Ciencias', niveles: ['NM'], alias: ['fisica'], programa: { '2027-11': '2025', '2028-11': '2025' }, componentes: ['Prueba 1A', 'Prueba 1B', 'Prueba 2', 'Evaluación interna'], temas: ['A.1 Cinemática', 'A.2 Fuerzas y cantidad de movimiento'], color: '#2563eb' },
      Historia: { grupo: 'Grupo 3, Individuos y Sociedades', niveles: ['NS'], alias: ['historia'], programa: { '2027-11': '2017' }, componentes: ['Prueba 1', 'Prueba 2', 'Prueba 3', 'Investigación histórica'], temas: [], color: '#a16207' },
      Monografía: { grupo: 'Núcleo', alias: ['monografia'], componentes: ['Monografía'], color: '#334155' },
    },
  },
  nodos: [
    demoNode('bib', 'raiz', '_Biblioteca'),
    demoNode('dest', 'bib', 'Destacados'),
    demoNode('tarj', 'bib', 'Tarjetas'),
    demoNode('t1', 'tarj', 'fisica-guia-2025.json', 'f'),
    demoNode('s1', 'dest', '01 Guía de Física', 's', null, null, { g: 'f1' }),
    demoNode('s2', 'dest', '02 Cuadernillo', 's', null, null, { g: 'f2' }),
    demoNode('fis', 'raiz', 'Física'),
    demoNode('fg', 'fis', 'Guía y programa'),
    demoNode('ft', 'fis', 'Temas'),
    demoNode('fe', 'fis', 'Exámenes'),
    demoNode('fw', 'fis', 'Trabajos'),
    demoNode('f1', 'fg', 'Guía de Física (primeros exámenes en 2025).pdf', 'f', { clave: 'fisica-guia-2025', tipo: 'guia', guia: '2025', nivel: 'NM y NS', idioma: 'es', origen: 'IB' }, 'Guía oficial del IB para los dos niveles: temas, indagación, pruebas y criterios.'),
    demoNode('f2', 'fg', 'Cuadernillo de datos de Física (versión 1.2).pdf', 'f', { clave: 'fisica-cuadernillo', tipo: 'cuadernillo', guia: '2025', idioma: 'es', origen: 'IB' }, 'Las ecuaciones y constantes que da el IB en las pruebas.'),
    demoNode('f3', 'ft', 'Cantidad de movimiento e impulso, clase del colegio.pdf', 'f', { clave: 'fisica-clase-impulso', tipo: 'clase', tema: 'A.2 Fuerzas y cantidad de movimiento', idioma: 'es', origen: 'colegio' }, 'Sesión de cuarto sobre impulso y conservación de la cantidad de movimiento.'),
    demoNode('f4', 'ft', 'Preguntas de examen por tema de Física, A.1 Cinemática (parte 1 de 2).pdf', 'f', { clave: 'fisica-banco-a1', tipo: 'banco', tema: 'A.1 Cinemática', guia: '2025', idioma: 'es-en', origen: 'IA' }, 'Preguntas reales de exámenes sobre cinemática, reunidas con IA.'),
    demoNode('f5', 'fe', 'Prueba 2 de Física, mayo de 2025, zona horaria 2.pdf', 'f', { clave: 'fisica-examen-2025-05-z2-p2', tipo: 'examen', componente: 'Prueba 2', convocatoria: '2025-05', zona: '2', nivel: 'NM', guia: '2025', idioma: 'es', origen: 'IB' }, 'Cuestionario oficial del Nivel Medio, 50 puntos.'),
    demoNode('f6', 'fe', 'Esquema de calificación de la Prueba 2 de Física, mayo de 2025, zona horaria 2.pdf', 'f', { clave: 'fisica-esquema-2025-05-z2-p2', tipo: 'esquema', componente: 'Prueba 2', convocatoria: '2025-05', zona: '2', nivel: 'NM', guia: '2025', idioma: 'en', origen: 'IB' }, 'Las respuestas que acepta el IB. En inglés.'),
    demoNode('f7', 'fe', 'Prueba 2 de Física, mayo de 2016 (programa anterior).pdf', 'f', { clave: 'fisica-examen-2016-05-p2', tipo: 'examen', componente: 'Prueba 2', convocatoria: '2016-05', guia: '2016', idioma: 'es', origen: 'IB' }, 'Cuestionario de la guía anterior.'),
    demoNode('f8', 'fe', 'Simulacro de examen de Física hecho con IA, n.º 1.pdf', 'f', { clave: 'fisica-simulacro-01', tipo: 'simulacro', guia: '2025', idioma: 'es', origen: 'IA' }, 'Preguntas nuevas hechas con IA; no son del IB.'),
    demoNode('f9', 'fw', 'Lista de cotejo de la investigación científica de Física.pdf', 'f', { clave: 'fisica-cotejo', tipo: 'criterios', componente: 'Evaluación interna', idioma: 'es', origen: 'colegio' }, 'Preguntas para revisar la investigación criterio por criterio.'),
    demoNode('his', 'raiz', 'Historia'),
    demoNode('hg', 'his', 'Guía y programa'),
    demoNode('h1', 'hg', 'Guía de Historia (primeros exámenes en 2017).pdf', 'f', { clave: 'historia-guia-2017', tipo: 'guia', guia: '2017', idioma: 'es', origen: 'IB' }, 'Guía oficial del IB.'),
    demoNode('mat', 'raiz', 'Matemática (3.º)'),
    demoNode('mt', 'mat', 'Temas'),
    demoNode('mt1', 'mt', 'Ecuaciones cuadráticas, clase de Matemática de 3.º.pdf', 'f', { clave: 'mate3-clase-cuadraticas', tipo: 'clase', idioma: 'es', origen: 'colegio' }, 'Sesión de tercero sobre ecuaciones cuadráticas.'),
    demoNode('mon', 'raiz', 'Monografía'),
    demoNode('mw', 'mon', 'Trabajos'),
    demoNode('m1', 'mw', 'Monografía calificada de ejemplo de Historia (24 de 30).pdf', 'f', { clave: 'mono-historia-1', tipo: 'ejemplo', componente: 'Monografía', vinculos: 'Historia', puntos: '24 de 30', idioma: 'es', origen: 'IB' }, 'Una monografía de Historia con su calificación.'),
  ],
};

/** La página de pruebas puede dejar su propio índice (el real, por ejemplo) en `window.__frameBibDemo`. */
const demoIndex = (): IndexCopy => (window as { __frameBibDemo?: IndexCopy }).__frameBibDemo ?? DEMO_INDEX;

const DEMO_CARDS = {
  titulo: 'Guía de Física: cómo te evalúan',
  huella: '',
  tarjetas: [
    { id: 1, frente: '¿Cuánto vale la Prueba 1 en el Nivel Medio?', reverso: '36 % de la nota, 1 hora y 30 minutos y 45 puntos.' },
    { id: 2, frente: '¿Qué es la Prueba 1B?', reverso: 'Preguntas basadas en datos, 20 puntos.' },
    { id: 3, frente: '¿Cuántas palabras puede tener la investigación científica?', reverso: '3 000 como máximo.' },
  ],
};

async function demoFile(item: BibItem): Promise<Blob> {
  // Un PDF mínimo de una página con el título (válido para el visor).
  const text = item.title.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, ' ').slice(0, 60);
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 18 Tf 60 760 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: 'application/pdf' });
}

onExtensionTeardown(`${AKLORE}:biblioteca`, () => {
  forgetBibFiles();
  extWrite(AKLORE, INDEX_KEY, null);
});
