// AK Lore → Biblioteca (Frame 1.9.2): el índice del material y sus descargas.
//
// Los archivos viven en el Drive de Asvent, en carpetas que creó Frame (ámbito
// `drive.file`: esta nube no ve nada más de ese Drive). Nadie recibe un enlace
// a Drive: la app pide el índice y cada archivo aquí, con su sesión de Frame,
// y esta nube los trae de Drive y se los pasa tal cual, sin guardarlos.
//
// Solo para cuentas del colegio con el correo comprobado: el dominio se compara
// por su resumen SHA-256 (el código público no lo nombra), como en la app.
// Cada cuenta tiene un tope diario de archivos y de bytes (`lore_descargas`).
//
// Rutas: GET /app/lore → { format: 1, guides: [...] }
//        GET /app/lore/archivo/<id> → el archivo (attachment)
// Errores: 403 `school` (otra cuenta) · 404 · 429 `quota` · 503 `lore-off`
// (sin Drive conectado) o `drive` (Drive no respondió).
import { type AppUser } from './supabase';
import { type Env, json } from './util';

/** SHA-256 del dominio del colegio: el mismo que lleva la app (catalog.ts). */
export const SCHOOL_DOMAIN_HASH = '0c072257f310f7ab180aa97e5d30aa09faff66bb44510472c3826a59ebc3c8de';
export const DAILY_FILES = 300;
export const DAILY_BYTES = 3_000_000_000;

const ID = /^[a-z0-9][a-z0-9-]{2,79}$/;

export async function isSchoolAccount(env: Env, user: AppUser): Promise<boolean> {
  // Lo que sigue a la ÚLTIMA arroba: es el dominio que de verdad recibe el correo.
  const email = user.email ?? '';
  const domain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
  if (!domain || !email.includes('@') || !user.confirmed) return false;
  return (await sha256Hex(domain)) === (env.LORE_DOMAIN_HASH || SCHOOL_DOMAIN_HASH);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface LoreRow {
  id: string;
  drive_id: string;
  title: string;
  subject: string;
  section: string;
  kind: string;
  component: string | null;
  lang: string | null;
  year: number | null;
  size: number;
  pages: number | null;
  summary: string | null;
  format: string;
  updated: string;
}

/** Todo el índice (unos cientos de filas: cabe en una respuesta). */
export async function loreIndex(env: Env, user: AppUser): Promise<Response> {
  if (!(await isSchoolAccount(env, user))) return json({ error: 'school' }, 403);
  const { results } = await env.DB.prepare(
    'SELECT id, title, subject, section, kind, component, lang, year, size, pages, summary, format, updated FROM lore ORDER BY section, subject, kind, title',
  ).all<Omit<LoreRow, 'drive_id'>>();
  const guides = results.map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    section: r.section,
    kind: r.kind,
    ...(r.component ? { component: r.component } : {}),
    ...(r.lang ? { lang: r.lang } : {}),
    ...(r.year ? { year: r.year } : {}),
    ...(r.pages ? { pages: r.pages } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    size: r.size,
    format: r.format,
    updated: r.updated,
  }));
  // Sin caché: la del navegador no distingue sesiones y, tras cambiar de cuenta
  // en el mismo equipo, serviría el índice sin pasar por la comprobación de
  // arriba. La app guarda su propia copia para buscar sin conexión.
  return json({ format: 1, guides }, 200, { 'cache-control': 'private, no-store' });
}

// ------------------------------------------------------------
// Drive: un token de acceso a partir del de renovación de Asvent
// ------------------------------------------------------------

let access: { token: string; until: number } | null = null;

export function resetDriveAccess(): void {
  access = null;
}

async function driveToken(env: Env): Promise<string | null> {
  if (access && access.until > Date.now()) return access.token;
  if (!env.LORE_DRIVE_REFRESH || !env.LORE_GOOGLE_ID || !env.LORE_GOOGLE_SECRET) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: env.LORE_DRIVE_REFRESH,
      client_id: env.LORE_GOOGLE_ID,
      client_secret: env.LORE_GOOGLE_SECRET,
    }),
  }).catch(() => null);
  if (!r?.ok) {
    console.error('lore token', r?.status ?? 'red');
    return null;
  }
  const out = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null;
  if (!out?.access_token) return null;
  access = { token: out.access_token, until: Date.now() + Math.max(60, (out.expires_in ?? 3600) - 300) * 1000 };
  return access.token;
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** Un archivo: se cuenta, se trae de Drive y se pasa sin guardarlo. */
export async function loreFile(env: Env, user: AppUser, id: string): Promise<Response> {
  if (!(await isSchoolAccount(env, user))) return json({ error: 'school' }, 403);
  if (!ID.test(id)) return json({ error: 'not_found' }, 404);
  const row = await env.DB.prepare('SELECT id, drive_id, title, size, format FROM lore WHERE id = ?').bind(id).first<Pick<LoreRow, 'id' | 'drive_id' | 'title' | 'size' | 'format'>>();
  if (!row) return json({ error: 'not_found' }, 404);

  const day = new Date().toISOString().slice(0, 10);
  const used = await env.DB.prepare(
    'INSERT INTO lore_descargas (owner, day, n, bytes) VALUES (?, ?, 1, ?) ON CONFLICT (owner, day) DO UPDATE SET n = n + 1, bytes = bytes + excluded.bytes RETURNING n, bytes',
  )
    .bind(user.owner, day, row.size)
    .first<{ n: number; bytes: number }>();
  const refund = () => env.DB.prepare('UPDATE lore_descargas SET n = n - 1, bytes = bytes - ? WHERE owner = ? AND day = ?').bind(row.size, user.owner, day).run();
  if (!used || used.n > DAILY_FILES || used.bytes > DAILY_BYTES) {
    await refund();
    return json({ error: 'quota', files: DAILY_FILES }, 429);
  }

  const token = await driveToken(env);
  if (!token) {
    await refund();
    return json({ error: env.LORE_DRIVE_REFRESH ? 'drive' : 'lore-off' }, 503);
  }
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(row.drive_id)}?alt=media`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r?.ok || !r.body) {
    if (r?.status === 401) resetDriveAccess();
    console.error('lore drive', r?.status ?? 'red');
    await refund();
    return json({ error: r?.status === 404 ? 'not_found' : 'drive' }, r?.status === 404 ? 404 : 503);
  }
  const name = `${row.title}.${row.format}`.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, ' ').trim();
  return new Response(r.body, {
    status: 200,
    headers: {
      'content-type': MIME[row.format] ?? 'application/octet-stream',
      ...(r.headers.get('content-length') ? { 'content-length': r.headers.get('content-length')! } : {}),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'private, no-store',
    },
  });
}
