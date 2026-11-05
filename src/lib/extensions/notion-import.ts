import { parseCsv } from '@/lib/csv';
import { listZip, readZipEntry, readZipText } from '@/lib/zip-read';
import { tr } from '@/lib/i18n';
import type { Course, TaskKind, TaskPriority } from '@/types';

// ============================================================
// Extensión «Notion»: importar tareas y fechas.
//
// Sin cuentas ni claves: se usa la exportación oficial de Notion
// (base de datos → ••• → Exportar → «Markdown y CSV»). Vale el .zip tal cual
// lo descarga Notion (también si trae otro .zip dentro) o el .csv suelto.
//
// De cada fila se reconoce, por el nombre de la columna (en inglés o en
// español):
//   título · fecha (o rango: se toma el final, que es la entrega) · estado
//   (para no traer lo ya hecho) · asignatura / etiquetas (se casan con las
//   asignaturas de Frame) · prioridad · tipo · descripción.
// Las fechas se entienden en los formatos que usa Notion: «October 6, 2026»,
// «6 de octubre de 2026», 06/10/2026, 2026-10-06, con o sin hora.
//
// Extensión desde la 1.7.3 (Ajustes → Extensiones → Notion):
//   · el texto de cada página (los .md del .zip) entra como descripción
//     cuando la fila no trae una;
//   · cada fila deja una huella (título + fecha) al importarse: al volver a
//     importar el mismo archivo, lo ya traído no se repite;
//   · si el archivo no sirve, se dice por qué (HTML, página suelta, .zip
//     dañado, tabla vacía) en vez de «no se encontró nada».
// ============================================================

/** Error con un mensaje para el usuario (ya traducido). */
export class NotionImportError extends Error {}

export interface NotionTable {
  /** Nombre de la base de datos (del archivo). */
  name: string;
  header: string[];
  rows: string[][];
  /** Texto de la página de cada fila (por título normalizado), de los .md del .zip. */
  pages?: Map<string, string>;
}

export interface NotionItem {
  key: string;
  title: string;
  /** Fecha local yyyy-MM-dd (la de entrega). */
  date: string | null;
  /** Inicio del rango, si la fecha era un rango. */
  startDate: string | null;
  time: string | null;
  done: boolean;
  courseId: string | null;
  courseLabel: string | null;
  priority: TaskPriority | null;
  kind: TaskKind | null;
  description: string;
}

export interface NotionMapping {
  title: string;
  date: string | null;
  status: string | null;
  course: string | null;
  priority: string | null;
  kind: string | null;
  description: string | null;
}

// ------------------------------------------------------------
// Lectura de archivos
// ------------------------------------------------------------

const tableName = (fileName: string) =>
  fileName
    .split('/')
    .pop()!
    .replace(/\.csv$/i, '')
    .replace(/_all$/i, '')
    // Notion añade un identificador hexadecimal al nombre: fuera.
    .replace(/\s+[0-9a-f]{32}$/i, '')
    .trim();

function toTable(fileName: string, text: string): NotionTable | null {
  const rows = parseCsv(text.replace(/^﻿/, '')).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) return null;
  const [header, ...body] = rows;
  return { name: tableName(fileName), header: header.map((h) => h.trim()), rows: body };
}

/** Páginas de un .zip: como mucho estas, y de este tamaño (texto, no adjuntos). */
const MAX_PAGES = 3000;
const MAX_PAGE_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 1024 * 1024 * 1024;

interface ZipContents {
  csvs: { name: string; text: string }[];
  pages: { name: string; text: string }[];
  html: boolean;
}

async function tablesFromZip(file: Blob, label: string, depth = 0, acc: ZipContents = { csvs: [], pages: [], html: false }): Promise<ZipContents> {
  let entries;
  try {
    entries = await listZip(file);
  } catch {
    throw new NotionImportError(tr('No pude abrir «{name}»: el .zip está dañado o incompleto. Vuelve a descargarlo de Notion.', { name: label }));
  }
  for (const entry of entries) {
    if (/\.csv$/i.test(entry.name)) acc.csvs.push({ name: entry.name, text: await readZipText(file, entry) });
    else if (/\.md$/i.test(entry.name) && acc.pages.length < MAX_PAGES && entry.size <= MAX_PAGE_BYTES) {
      acc.pages.push({ name: entry.name, text: await readZipText(file, entry) });
    } else if (/\.html?$/i.test(entry.name)) acc.html = true;
    else if (/\.zip$/i.test(entry.name) && depth < 2) {
      const bytes = await readZipEntry(file, entry);
      const inner = new Blob([bytes.slice().buffer as ArrayBuffer]);
      await tablesFromZip(inner, label, depth + 1, acc);
    }
  }
  return acc;
}

/**
 * Texto de una página exportada: sin el título (# …) ni el bloque de
 * propiedades que Notion pone debajo («Estado: Hecho»…), que ya vienen en
 * las columnas.
 */
export function pageBody(markdown: string): string {
  const lines = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (lines[i]?.startsWith('# ')) i++;
  while (i < lines.length && !lines[i].trim()) i++;
  while (i < lines.length && /^[^:\n]{1,60}:\s/.test(lines[i])) i++;
  return lines.slice(i).join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 4000);
}

/** «Carpeta/Mi tarea 0123…abcd.md» → título normalizado. */
const pageTitle = (name: string) => norm(name.split('/').pop()!.replace(/\.md$/i, '').replace(/\s+[0-9a-f]{32}$/i, ''));
/** Carpeta de la página: la base de datos a la que pertenece. */
const pageFolder = (name: string) => tableName((name.split('/').slice(-2, -1)[0] ?? '') + '.csv');

export async function readNotionFiles(files: File[]): Promise<NotionTable[]> {
  const csvs: { name: string; text: string }[] = [];
  const pages: { name: string; text: string }[] = [];
  let html = false;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      throw new NotionImportError(tr('«{name}» pesa demasiado. Exporta solo la base de datos de tareas, sin «Incluir subpáginas» ni archivos adjuntos.', { name: file.name }));
    }
    if (/\.zip$/i.test(file.name)) {
      const found = await tablesFromZip(file, file.name);
      csvs.push(...found.csvs);
      pages.push(...found.pages);
      html ||= found.html;
    } else if (/\.csv$/i.test(file.name)) csvs.push({ name: file.name, text: await file.text() });
    else {
      throw new NotionImportError(
        tr('«{name}» no es una exportación de Notion. Elige el .zip que descarga Notion al exportar con «Markdown y CSV».', { name: file.name })
      );
    }
  }
  if (csvs.length === 0) {
    if (html) throw new NotionImportError(tr('Ese .zip se exportó en HTML. Vuelve a exportar desde Notion eligiendo el formato «Markdown y CSV».'));
    if (pages.length > 0) {
      throw new NotionImportError(tr('Ese .zip trae páginas sueltas, no una base de datos. En Notion, exporta la base de datos (la tabla con tus tareas).'));
    }
    return [];
  }
  // Notion exporta dos CSV por base: la vista y «_all» (todas las filas). Se
  // queda con «_all» cuando están los dos.
  const byName = new Map<string, { name: string; text: string }>();
  for (const csv of csvs) {
    const key = tableName(csv.name);
    const current = byName.get(key);
    if (!current || /_all\.csv$/i.test(csv.name)) byName.set(key, csv);
  }
  const tables = [...byName.values()].map((c) => toTable(c.name, c.text)).filter((t): t is NotionTable => !!t);
  if (tables.length === 0) throw new NotionImportError(tr('La base de datos está vacía: solo trae los nombres de las columnas.'));
  // El texto de cada página, con la tabla de su carpeta (o con todas, si no se sabe).
  for (const page of pages) {
    const body = pageBody(page.text);
    if (!body) continue;
    const folder = pageFolder(page.name);
    const owners = tables.filter((t) => t.name === folder);
    for (const table of owners.length > 0 ? owners : tables) {
      table.pages ??= new Map();
      if (!table.pages.has(pageTitle(page.name))) table.pages.set(pageTitle(page.name), body);
    }
  }
  return tables;
}

// ------------------------------------------------------------
// Columnas
// ------------------------------------------------------------

const norm = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

const COLUMN_HINTS: Record<keyof Omit<NotionMapping, 'title'> | 'titleName', RegExp> = {
  titleName: /^(name|nombre|titulo|title|tarea|task|pendiente|actividad|asunto)$/,
  date: /(fecha|date|due|vence|vencimiento|entrega|deadline|plazo|cuando|when|dia)/,
  status: /(estado|status|done|hecho|completad|terminad|listo|check|progreso|progress)/,
  course: /(asignatura|curso|materia|subject|course|clase|class|area|categoria|category|tags?|etiquetas?|proyecto|project)/,
  priority: /(prioridad|priority|importancia|urgencia|urgency)/,
  kind: /^(tipo|type|clase de tarea|kind)$/,
  description: /(descripcion|description|notas?|notes?|detalle|comentario|resumen)/,
};

export function guessMapping(table: NotionTable): NotionMapping {
  const used = new Set<string>();
  const pick = (re: RegExp) => {
    const hit = table.header.find((h) => !used.has(h) && re.test(norm(h)));
    if (hit) used.add(hit);
    return hit ?? null;
  };
  const title = pick(COLUMN_HINTS.titleName) ?? table.header[0];
  used.add(title);
  // La fecha: la primera columna que se llame así Y tenga valores con aspecto de fecha.
  let date: string | null = null;
  for (const h of table.header) {
    if (used.has(h) || !COLUMN_HINTS.date.test(norm(h))) continue;
    const index = table.header.indexOf(h);
    if (table.rows.some((r) => parseNotionDate(r[index] ?? '', 'dmy'))) {
      date = h;
      used.add(h);
      break;
    }
  }
  return {
    title,
    date,
    status: pick(COLUMN_HINTS.status),
    priority: pick(COLUMN_HINTS.priority),
    kind: pick(COLUMN_HINTS.kind),
    course: pick(COLUMN_HINTS.course),
    description: pick(COLUMN_HINTS.description),
  };
}

// ------------------------------------------------------------
// Fechas
// ------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  ene: 1, abr: 4, ago: 8, dic: 12,
};

interface ParsedDate {
  date: string;
  time: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): string | null {
  if (!(y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const probe = new Date(y, m - 1, d);
  if (probe.getMonth() !== m - 1) return null; // 31 de febrero
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseTime(text: string): string | null {
  const m = /(\d{1,2}):(\d{2})\s*(a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?/i.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const suffix = (m[3] ?? '').toLowerCase().replace(/[.\s]/g, '');
  if (suffix === 'pm' && h < 12) h += 12;
  if (suffix === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Una fecha suelta (sin rango). `order` resuelve 06/10/2026: día/mes o mes/día. */
export function parseNotionDate(raw: string, order: 'dmy' | 'mdy'): ParsedDate | null {
  const text = raw.trim();
  if (!text) return null;
  const time = parseTime(text);
  let m = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(text);
  if (m) {
    const date = valid(Number(m[1]), Number(m[2]), Number(m[3]));
    return date ? { date, time } : null;
  }
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(text);
  if (m) {
    let a = Number(m[1]);
    let b = Number(m[2]);
    const y = Number(m[3]);
    if (order === 'mdy' && b <= 12 && a <= 12) [a, b] = [b, a];
    else if (a <= 12 && b > 12) [a, b] = [b, a]; // tenía que ser mes/día
    const date = valid(y, b, a);
    return date ? { date, time } : null;
  }
  const lower = norm(text);
  // «October 6, 2026» / «Oct 6, 2026»
  m = /([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(lower);
  if (m && MONTHS[m[1]]) {
    const date = valid(Number(m[3]), MONTHS[m[1]], Number(m[2]));
    return date ? { date, time } : null;
  }
  // «6 de octubre de 2026» / «6 oct 2026»
  m = /(\d{1,2})\s+(?:de\s+)?([a-z]+)\.?(?:\s+de)?\s+(\d{4})/.exec(lower);
  if (m && MONTHS[m[2]]) {
    const date = valid(Number(m[3]), MONTHS[m[2]], Number(m[1]));
    return date ? { date, time } : null;
  }
  return null;
}

/** Notion escribe los rangos como «A → B». Devuelve [inicio, fin]. */
function parseNotionRange(raw: string, order: 'dmy' | 'mdy'): [ParsedDate | null, ParsedDate | null] {
  const parts = raw.split(/\s*(?:→|->|–|—)\s*/);
  if (parts.length >= 2) {
    const start = parseNotionDate(parts[0], order);
    const end = parseNotionDate(parts[parts.length - 1], order);
    return [start, end ?? start];
  }
  const single = parseNotionDate(raw, order);
  return [single, single];
}

/** ¿Las fechas de la columna son día/mes o mes/día? Lo dicen los valores > 12. */
function detectOrder(values: string[]): 'dmy' | 'mdy' {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = /(\d{1,2})[/.-](\d{1,2})[/.-]\d{4}/.exec(v);
    if (!m) continue;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

// ------------------------------------------------------------
// Interpretación de filas
// ------------------------------------------------------------

const DONE = /^(done|completed?|complete|finished|listo|lista|hecho|hecha|terminad[oa]|completad[oa]|finalizad[oa]|entregad[oa]|yes|si|sí|true|✓|✔|x)$/i;

function mapPriority(value: string): TaskPriority | null {
  const v = norm(value);
  if (!v) return null;
  if (/(alta|high|urgente|urgent|critica|critical|importante|p1)/.test(v)) return 'Alta';
  if (/(media|medium|normal|moderada|p2)/.test(v)) return 'Media';
  if (/(baja|low|menor|p3)/.test(v)) return 'Baja';
  return null;
}

function mapKind(value: string): TaskKind | null {
  const v = norm(value);
  if (!v) return null;
  if (/(examen|exam|prueba|test|evaluacion|quiz|parcial)/.test(v)) return 'Examen';
  if (/(proyecto|project)/.test(v)) return 'Proyecto';
  if (/(actividad|activity|exposicion|laboratorio|lab)/.test(v)) return 'Actividad';
  if (/(personal)/.test(v)) return 'Personal';
  if (/(tarea|homework|assignment|deber|trabajo)/.test(v)) return 'Tarea';
  return null;
}

function matchCourse(value: string, courses: Course[]): Course | null {
  const tags = value
    .split(/[,;]/)
    .map((t) => norm(t))
    .filter(Boolean);
  for (const tag of tags) {
    const exact = courses.find((c) => norm(c.name) === tag);
    if (exact) return exact;
  }
  for (const tag of tags) {
    if (tag.length < 3) continue;
    const loose = courses.find((c) => norm(c.name).includes(tag) || tag.includes(norm(c.name)));
    if (loose) return loose;
  }
  return null;
}

export function interpretTable(table: NotionTable, mapping: NotionMapping, courses: Course[]): NotionItem[] {
  const col = (name: string | null) => (name ? table.header.indexOf(name) : -1);
  const iTitle = col(mapping.title);
  const iDate = col(mapping.date);
  const iStatus = col(mapping.status);
  const iCourse = col(mapping.course);
  const iPriority = col(mapping.priority);
  const iKind = col(mapping.kind);
  const iDescription = col(mapping.description);
  const order = iDate >= 0 ? detectOrder(table.rows.map((r) => r[iDate] ?? '')) : 'dmy';

  const items: NotionItem[] = [];
  table.rows.forEach((row, index) => {
    const title = (row[iTitle] ?? '').trim();
    if (!title) return;
    const [start, end] = iDate >= 0 ? parseNotionRange(row[iDate] ?? '', order) : [null, null];
    const statusText = iStatus >= 0 ? (row[iStatus] ?? '').trim() : '';
    const courseText = iCourse >= 0 ? (row[iCourse] ?? '').trim() : '';
    const course = courseText ? matchCourse(courseText, courses) : null;
    items.push({
      key: `${index}`,
      title: title.slice(0, 200),
      date: end?.date ?? null,
      startDate: start && end && start.date !== end.date ? start.date : null,
      time: end?.time ?? null,
      done: DONE.test(statusText),
      courseId: course?.id ?? null,
      courseLabel: course?.name ?? (courseText || null),
      priority: iPriority >= 0 ? mapPriority(row[iPriority] ?? '') : null,
      kind: iKind >= 0 ? mapKind(row[iKind] ?? '') : null,
      description: ((iDescription >= 0 ? (row[iDescription] ?? '').trim() : '') || table.pages?.get(norm(title)) || '').slice(0, 4000),
    });
  });
  return items;
}

/** Huella de una fila: qué se importó (tarea o fecha), con qué título y para qué día. */
export const notionFingerprint = (as: 'tasks' | 'events', title: string, date: string | null) => `${as === 'tasks' ? 't' : 'e'}|${norm(title)}|${date ?? ''}`;

/** yyyy-MM-dd → ISO del inicio de ese día local (como guarda Frame las entregas). */
export function dueIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toISOString();
}
