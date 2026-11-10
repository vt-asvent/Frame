import { tr } from '@/lib/i18n';

// ============================================================
// Extensiones de Frame (1.7.3): el formato abierto.
//
// Una extensión se describe con un manifiesto JSON (este archivo dice cómo).
// Las OFICIALES vienen dentro de Frame (catalog.ts) y su código es de Frame.
// Las de TERCEROS son solo datos: Frame lee su manifiesto y NUNCA ejecuta
// código suyo dentro de la app. Lo que una extensión de terceros puede aportar
// está cerrado en `contributes`: una fuente de música (la página de un
// programa que corre en este mismo equipo) o un «mod» de apariencia (colores,
// una imagen de fondo, parámetros de una animación de Frame). Si pide algo que
// Frame no entiende, no se instala.
//
// Los permisos se muestran y se aceptan al instalar; lo que aporta una
// extensión exige los permisos que necesita (una fuente de música, por
// ejemplo, no se acepta sin «añadir canciones»).
//
// Formato 1:
// {
//   "format": 1,
//   "id": "autor.nombre",                 // minúsculas, números, «.» y «-»
//   "name": "Nombre visible",
//   "version": "1.0.0",
//   "author": "Quién la hace",
//   "description": "Qué hace, en una o dos frases.",
//   "homepage": "https://…",              // opcional
//   "permissions": ["music.write", "files.pick", "local.app"],
//   "contributes": {
//     "musicSource": {
//       "page": "http://127.0.0.1:47321/", // solo este equipo
//       "label": "Busca y descarga",       // opcional
//       "folderHint": { "base": "downloads", "path": "Mi carpeta" }, // opcional
//       "engine": "yt-mp3/1",              // opcional: protocolo que Frame sabe hablar
//       "app": {                           // opcional, solo del catálogo: el programa
//         "updates": "https://github.com/…/latest.json",
//         "exe": "Carpeta/programa.exe",   // dentro de %LOCALAPPDATA%
//         "args": ["--tray"],
//         "minVersion": "1.2.0"
//       }
//     },
//     "appearance": {                       // permiso «appearance»
//       "accent": { "name": "Menta", "light": "#2F8F6B", "dark": "#8FD3B6" },
//       "background": { "name": "Mi fondo", "image": "data:image/webp;base64,…", "dim": 0.6 },
//       "animation": { "name": "Constelación lenta", "base": "constelacion", "params": { "speed": 0.5 } }
//     }
//   }
// }
// ============================================================

export const MANIFEST_FORMAT = 1;
/** Un manifiesto es texto corto: más que esto no es un manifiesto. */
export const MAX_MANIFEST_BYTES = 64 * 1024;
/** Con una imagen de fondo dentro (data URI), hasta esto. */
export const MAX_MOD_BYTES = 4 * 1024 * 1024;

export type PermissionId =
  | 'tasks.write'
  | 'calendar.write'
  | 'music.write'
  | 'music.read'
  | 'files.pick'
  | 'local.app'
  | 'google.drive'
  | 'data.read'
  | 'data.write'
  | 'appearance'
  | 'school.account';

export const PERMISSIONS: Record<PermissionId, { title: () => string; detail: () => string }> = {
  'tasks.write': {
    title: () => tr('Crear tareas'),
    detail: () => tr('Añade tareas a tu lista. No cambia ni borra las que ya tienes.'),
  },
  'calendar.write': {
    title: () => tr('Añadir fechas al calendario'),
    detail: () => tr('Crea fechas en tu calendario de Frame.'),
  },
  'music.write': {
    title: () => tr('Añadir canciones'),
    detail: () => tr('Copia canciones a tu biblioteca de Música.'),
  },
  'music.read': {
    title: () => tr('Leer tu música y tus archivos'),
    detail: () => tr('Usa tus canciones y adjuntos para llevarlos a tus otros equipos.'),
  },
  'files.pick': {
    title: () => tr('Leer lo que tú elijas'),
    detail: () => tr('Solo los archivos o la carpeta que elijas en el explorador de Windows.'),
  },
  'local.app': {
    title: () => tr('Mostrar un programa de este equipo'),
    detail: () => tr('Muestra dentro de Frame la página de un programa que tienes abierto aquí. Ese programa no ve tus datos de Frame.'),
  },
  'google.drive': {
    title: () => tr('Google Drive'),
    detail: () => tr('Solo los archivos que crea Frame en tu Drive: no ve ni toca los demás.'),
  },
  'data.read': {
    title: () => tr('Leer tus datos de estudio'),
    detail: () => tr('Asignaturas, tareas, sesiones, hábitos, informes y calendario. Nada de tu personalización.'),
  },
  'data.write': {
    title: () => tr('Crear y cambiar tus datos de estudio'),
    detail: () => tr('Crear y editar tareas, hábitos, sesiones y fechas. Para borrar, Frame te pide confirmación cada vez.'),
  },
  appearance: {
    title: () => tr('Cambiar el aspecto de Frame'),
    detail: () => tr('Añade colores, fondos o animaciones que tú eliges en Ajustes. No toca tus datos.'),
  },
  'school.account': {
    title: () => tr('Tu correo institucional'),
    detail: () => tr('Para activarla, Asvent envía un código a tu correo institucional. En la nube de Frame solo queda una huella de ese correo, que no se puede leer.'),
  },
};

export interface FolderHint {
  base: 'downloads' | 'music' | 'home';
  path: string;
}

export interface MusicSourceContribution {
  /** Página del programa: http://127.0.0.1:<puerto>/… o http://localhost:<puerto>/… */
  page: string;
  /** Texto corto bajo su nombre en «Descargar». */
  label?: string;
  /** Carpeta donde el programa deja lo que descarga (solo para proponerla). */
  folderHint?: FolderHint;
  /**
   * Protocolo que el programa habla, si Frame lo conoce. Con «yt-mp3/1» Frame
   * abre su propia ventana (vídeo incrustado, CSV, descarga en MP3 a 320 kbps)
   * en lugar de la página del programa. Rutas: GET /status, POST /search,
   * /info, /song, GET /jobs.
   */
  engine?: MusicEngine;
  /** El programa del que depende (1.9.0): Frame lo abre, lo instala y lo pone al día solo. */
  app?: ExtensionApp;
}

/**
 * El programa de una fuente de música. Frame lo abre si está cerrado y lo
 * instala o lo actualiza si falta o es anterior a `minVersion`, siempre con
 * un instalador firmado (ver ext_app_install en el núcleo). Solo para las
 * extensiones del catálogo.
 */
export interface ExtensionApp {
  /** Índice de versiones del actualizador de Tauri: https://github.com/…/latest.json */
  updates: string;
  /** Dónde queda instalado, dentro de %LOCALAPPDATA%: «Carpeta/programa.exe». */
  exe: string;
  /** Opciones al abrirlo en segundo plano (p. ej. «--tray»). */
  args?: string[];
  /** Versión mínima: si la que corre es anterior, Frame la actualiza. */
  minVersion?: string;
}

/** El bloque «app» de una fuente, validado; null si no es válido. */
function extensionApp(value: unknown): ExtensionApp | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const app = value as Record<string, unknown>;
  const updates = typeof app.updates === 'string' && /^https:\/\/github\.com\/[\w.\/-]+\.json$/.test(app.updates) && !app.updates.includes('..') ? app.updates : null;
  const exe = typeof app.exe === 'string' && /^[\w .-]+(\/[\w .-]+)*\.exe$/i.test(app.exe) && !app.exe.split('/').some((part) => part.trim() === '..' || part.trim() === '.') ? app.exe : null;
  const args = app.args === undefined ? [] : Array.isArray(app.args) && app.args.length <= 4 && app.args.every((arg) => typeof arg === 'string' && /^--[a-z0-9-]{1,30}$/.test(arg)) ? (app.args as string[]) : null;
  const minVersion = app.minVersion === undefined ? undefined : typeof app.minVersion === 'string' && /^\d+\.\d+\.\d+$/.test(app.minVersion) ? app.minVersion : null;
  if (!updates || !exe || !args || minVersion === null) return null;
  return { updates, exe, ...(args.length ? { args } : {}), ...(minVersion ? { minVersion } : {}) };
}

export const MUSIC_ENGINES = ['yt-mp3/1'] as const;
export type MusicEngine = (typeof MUSIC_ENGINES)[number];

/** Animaciones de Frame que un mod puede variar (extensión Animaciones). */
export const ANIMATION_BASES = ['constelacion', 'olas', 'aurora', 'matrix', 'mosaico', 'boreal', 'tipoaurora'] as const;
export type AnimationBase = (typeof ANIMATION_BASES)[number];

export interface AppearanceContribution {
  accent?: { name: string; light: string; dark: string };
  /** Imagen como data URI (png, jpeg o webp); `dim` (0–0,9) la vela para que el texto se lea. */
  background?: { name: string; image: string; dim: number };
  /** Una variante de una animación de Frame: solo números y colores. */
  animation?: { name: string; base: AnimationBase; params: Record<string, number | string> };
}

export interface ExtensionContributions {
  musicSource?: MusicSourceContribution;
  appearance?: AppearanceContribution;
}

export interface ExtensionManifest {
  format: typeof MANIFEST_FORMAT;
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  homepage?: string;
  permissions: PermissionId[];
  contributes?: ExtensionContributions;
}

/** Ids de extensión: «autor.nombre», 2 a 5 partes, 64 caracteres como mucho. */
export const EXTENSION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){1,4}$/;
/** Reservados para las de Asvent. */
const RESERVED_PREFIXES = ['frame.', 'asvent.'];
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Lo que cada aportación necesita que el manifiesto pida. */
const NEEDS: Record<keyof ExtensionContributions, PermissionId[]> = {
  musicSource: ['music.write', 'files.pick', 'local.app'],
  appearance: ['appearance'],
};

/** Permisos que una extensión de terceros puede pedir (el resto son de las oficiales). */
const THIRD_PARTY_PERMISSIONS = new Set<PermissionId>(['music.write', 'files.pick', 'local.app', 'appearance']);

const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_DATA = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const PARAM_KEY = /^[a-zA-Z][a-zA-Z0-9]{0,23}$/;

export type ManifestResult = { ok: true; manifest: ExtensionManifest } | { ok: false; error: string };

const fail = (error: string): ManifestResult => ({ ok: false, error });

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f]/.test(value)
    ? value.trim()
    : null;

/** ¿Es la página de un programa de ESTE equipo? (http, 127.0.0.1 o localhost, puerto alto). */
export function isLocalPage(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 300) return false;
  try {
    const url = new URL(raw);
    const port = Number(url.port);
    return (
      url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === 'localhost') &&
      Number.isInteger(port) &&
      port >= 1024 &&
      port <= 65535 &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function folderHint(raw: unknown): FolderHint | null | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object') return null;
  const { base, path } = raw as Record<string, unknown>;
  if (base !== 'downloads' && base !== 'music' && base !== 'home') return null;
  const clean = text(path, 120);
  // Una subcarpeta, sin salir de la base: nada de «..», rutas absolutas ni unidades.
  if (!clean || /(^|[\\/])\.\.([\\/]|$)/.test(clean) || /^[\\/]|:/.test(clean)) return null;
  return { base, path: clean };
}

function appearance(raw: unknown): AppearanceContribution | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return tr('«appearance» no es válido.');
  const a = raw as Record<string, unknown>;
  const other = Object.keys(a).filter((key) => !['accent', 'background', 'animation'].includes(key));
  if (other.length > 0) return tr('La extensión aporta cosas que esta versión de Frame no sabe usar: {fields}.', { fields: other.join(', ') });
  const out: AppearanceContribution = {};
  if (a.accent !== undefined) {
    const c = a.accent as Record<string, unknown> | null;
    const name = text(c?.name, 30);
    if (!c || !name || typeof c.light !== 'string' || !HEX.test(c.light) || typeof c.dark !== 'string' || !HEX.test(c.dark)) {
      return tr('El color del mod necesita nombre y dos tonos, «light» y «dark», como #2F8F6B.');
    }
    out.accent = { name, light: c.light.toUpperCase(), dark: c.dark.toUpperCase() };
  }
  if (a.background !== undefined) {
    const b = a.background as Record<string, unknown> | null;
    const name = text(b?.name, 30);
    if (!b || !name || typeof b.image !== 'string' || !IMAGE_DATA.test(b.image)) {
      return tr('El fondo del mod necesita nombre y una imagen PNG, JPEG o WebP incrustada (data:image/…;base64).');
    }
    const dim = b.dim === undefined ? 0.5 : Number(b.dim);
    if (!Number.isFinite(dim) || dim < 0 || dim > 0.9) return tr('«dim» del fondo debe ir de 0 a 0,9.');
    out.background = { name, image: b.image, dim };
  }
  if (a.animation !== undefined) {
    const n = a.animation as Record<string, unknown> | null;
    const name = text(n?.name, 30);
    if (!n || !name || !(ANIMATION_BASES as readonly string[]).includes(String(n.base))) {
      return tr('La animación del mod necesita nombre y una base de Frame: {bases}.', { bases: ANIMATION_BASES.join(', ') });
    }
    const params: Record<string, number | string> = {};
    if (n.params !== undefined) {
      if (!n.params || typeof n.params !== 'object' || Array.isArray(n.params)) return tr('Los parámetros de la animación no son válidos.');
      const entries = Object.entries(n.params as Record<string, unknown>);
      if (entries.length > 12) return tr('La animación admite 12 parámetros como mucho.');
      for (const [key, value] of entries) {
        if (!PARAM_KEY.test(key)) return tr('Parámetro de animación no válido: {key}.', { key });
        if (typeof value === 'number' && Number.isFinite(value)) params[key] = value;
        else if (typeof value === 'string' && HEX.test(value)) params[key] = value.toUpperCase();
        else return tr('Los parámetros de la animación solo pueden ser números o colores (#RRGGBB).');
      }
    }
    out.animation = { name, base: n.base as AnimationBase, params };
  }
  if (!out.accent && !out.background && !out.animation) return tr('«appearance» está vacío.');
  return out;
}

/**
 * Valida un manifiesto de TERCEROS (el de un archivo). Devuelve un error
 * claro, en el idioma de Frame, si algo no cuadra.
 */
export function parseManifest(raw: string): ManifestResult {
  if (raw.length > MAX_MOD_BYTES) return fail(tr('El archivo es demasiado grande para ser una extensión (4 MB como mucho).'));
  let data: unknown;
  try {
    data = JSON.parse(raw.replace(/^﻿/, ''));
  } catch {
    return fail(tr('El archivo no es una extensión de Frame: no es JSON válido.'));
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return fail(tr('El archivo no es una extensión de Frame.'));
  const m = data as Record<string, unknown>;
  if (m.format !== MANIFEST_FORMAT) {
    return typeof m.format === 'number' && m.format > MANIFEST_FORMAT
      ? fail(tr('Esta extensión necesita una versión más nueva de Frame.'))
      : fail(tr('El archivo no es una extensión de Frame (falta «format»: 1).'));
  }
  const allowed = new Set(['format', 'id', 'name', 'version', 'author', 'description', 'homepage', 'permissions', 'contributes', '$schema']);
  const unknown = Object.keys(m).filter((key) => !allowed.has(key));
  if (unknown.length > 0) return fail(tr('La extensión trae campos que Frame no conoce: {fields}.', { fields: unknown.join(', ') }));

  const id = typeof m.id === 'string' ? m.id : '';
  if (id.length > 64 || !EXTENSION_ID.test(id)) {
    return fail(tr('El «id» de la extensión no es válido: usa la forma «autor.nombre», en minúsculas.'));
  }
  if (RESERVED_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return fail(tr('Ese «id» está reservado para las extensiones de Asvent.'));
  }
  const name = text(m.name, 40);
  if (!name) return fail(tr('Falta el nombre de la extensión (40 caracteres como mucho).'));
  const version = typeof m.version === 'string' && VERSION.test(m.version) ? m.version : null;
  if (!version) return fail(tr('La versión debe tener la forma 1.0.0.'));
  const author = text(m.author, 60);
  if (!author) return fail(tr('Falta el autor de la extensión.'));
  const description = text(m.description, 300);
  if (!description) return fail(tr('Falta la descripción de la extensión (300 caracteres como mucho).'));
  let homepage: string | undefined;
  if (m.homepage !== undefined) {
    try {
      const url = new URL(String(m.homepage));
      if (url.protocol !== 'https:') throw new Error();
      homepage = url.toString();
    } catch {
      return fail(tr('La página web de la extensión debe empezar por https://.'));
    }
  }

  if (!Array.isArray(m.permissions)) return fail(tr('Falta la lista de permisos («permissions»).'));
  const permissions = [...new Set(m.permissions)] as PermissionId[];
  const strange = permissions.filter((p) => !THIRD_PARTY_PERMISSIONS.has(p));
  if (strange.length > 0) {
    return fail(tr('La extensión pide permisos que Frame no da a extensiones de terceros: {permissions}.', { permissions: strange.join(', ') }));
  }

  const contributes: ExtensionContributions = {};
  if (m.contributes !== undefined) {
    if (!m.contributes || typeof m.contributes !== 'object' || Array.isArray(m.contributes)) {
      return fail(tr('«contributes» no es válido.'));
    }
    const c = m.contributes as Record<string, unknown>;
    const other = Object.keys(c).filter((key) => key !== 'musicSource' && key !== 'appearance');
    if (other.length > 0) return fail(tr('La extensión aporta cosas que esta versión de Frame no sabe usar: {fields}.', { fields: other.join(', ') }));
    if (c.musicSource !== undefined) {
      const s = c.musicSource as Record<string, unknown> | null;
      if (!s || typeof s !== 'object') return fail(tr('«musicSource» no es válido.'));
      if (!isLocalPage(s.page)) {
        return fail(tr('La fuente de música debe ser la página de un programa de este equipo (http://127.0.0.1:puerto/).'));
      }
      const label = s.label === undefined ? undefined : text(s.label, 60);
      if (label === null) return fail(tr('El texto de la fuente de música es demasiado largo.'));
      const hint = folderHint(s.folderHint);
      if (hint === null) return fail(tr('La carpeta propuesta de la fuente de música no es válida.'));
      let engine: MusicEngine | undefined;
      if (s.engine !== undefined) {
        if (typeof s.engine !== 'string' || !(MUSIC_ENGINES as readonly string[]).includes(s.engine)) {
          return fail(tr('Esta versión de Frame no conoce el protocolo de la fuente de música.'));
        }
        engine = s.engine as MusicEngine;
      }
      const app = s.app === undefined ? undefined : extensionApp(s.app);
      if (app === null) return fail(tr('El programa de la fuente de música no es válido.'));
      contributes.musicSource = {
        page: s.page,
        ...(label ? { label } : {}),
        ...(hint ? { folderHint: hint } : {}),
        ...(engine ? { engine } : {}),
        ...(app ? { app } : {}),
      };
    }
    if (c.appearance !== undefined) {
      const look = appearance(c.appearance);
      if (typeof look === 'string') return fail(look);
      contributes.appearance = look;
    }
  }
  if (!contributes.musicSource && !contributes.appearance) return fail(tr('La extensión no aporta nada que Frame sepa usar.'));
  // Sin imagen de fondo, un manifiesto es texto corto.
  if (!contributes.appearance?.background && raw.length > MAX_MANIFEST_BYTES) {
    return fail(tr('El archivo es demasiado grande para ser una extensión.'));
  }
  for (const [kind, needs] of Object.entries(NEEDS) as [keyof ExtensionContributions, PermissionId[]][]) {
    if (!contributes[kind]) continue;
    const missing = needs.filter((p) => !permissions.includes(p));
    if (missing.length > 0) {
      return fail(tr('A la extensión le faltan permisos para lo que aporta: {permissions}.', { permissions: missing.join(', ') }));
    }
  }

  return {
    ok: true,
    manifest: { format: MANIFEST_FORMAT, id, name, version, author, description, ...(homepage ? { homepage } : {}), permissions, contributes },
  };
}

/** -1, 0 o 1, comparando versiones x.y.z. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
