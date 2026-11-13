// Biblioteca 2 (Frame 1.9.7): la carpeta «AK Lore» del Drive de Asvent, tal cual.
//
// Lo que hay en Drive es la Biblioteca: subir, mover, renombrar o reemplazar un
// archivo allí basta para que la app lo muestre así, sin actualizarla. Cada 5
// minutos (cron) esta nube lee la carpeta entera, guarda lo que vio en D1
// (`lore_nodos`), copia las portadas nuevas (`lore_vistas`) y arma el índice que
// pide la app, en partes (`lore_estado`). El contrato de la carpeta (qué va en
// cada sitio, títulos, descripciones y propiedades) está fuera de este repositorio.
//
// Quién lee: la cuenta de servicio lectora (LORE_SA_JSON), con permiso de lector
// sobre «AK Lore»: ve todo lo que hay, lo suba quien lo suba. Sin ella, el
// permiso `drive.file` de Asvent (lore.ts), que solo ve lo que subió Frame.
//
// El plan gratis de Cloudflare da 10 ms de procesador por ejecución: aquí no se
// interpreta el JSON de Drive. El texto de cada página va tal cual a D1, que lo
// recorre con sus funciones JSON, y el índice sale de D1 ya armado.
//
// Y da a TODA la cuenta 100 000 filas escritas y 5 millones leídas al día en D1:
// al pasarse, la base rechaza las escrituras hasta medianoche (UTC). El
// 13-nov-2026 una recopia de portadas las agotó en tres horas y dejó sin
// descargas a la Biblioteca. Desde entonces (ver `sincronizar`):
//   · sin cambios en Drive (lo dice su registro de cambios) no se lee la
//     carpeta ni se escribe nada; se relee igual cada 6 horas, por si acaso;
//   · una fila solo se reescribe si cambió de verdad, o si es una de las pocas
//     portadas que se copian en esa vuelta;
//   · la lectura lleva la cuenta de lo que gasta y se detiene sola, hasta el
//     día siguiente, mucho antes de acercarse al tope de la cuenta;
//   · servir un archivo no depende de poder anotarlo, y anotarlo no es una
//     escritura por tramo (lore.ts, `contarDescarga`).
//
// Rutas (con la sesión de Frame y la Biblioteca activada, ver lore-acceso.ts):
//   GET /app/biblioteca?parte=N&si=<actualizado> → el índice, por partes
//   GET /app/biblioteca/archivo/<id> → el archivo (admite Range, para hojear un PDF)
//   GET /app/biblioteca/vista/<id> → su portada (no cuenta para el tope)
//   GET /app/biblioteca/tarjetas/<clave> → sus tarjetas de estudio (JSON)
import { hasLoreAccess } from './lore-acceso';
import { DAILY_FILES, contarDescarga, driveToken, resetDriveAccess } from './lore';
import { type AppUser } from './supabase';
import { type Env, b64url, json } from './util';

const CARPETA = 'application/vnd.google-apps.folder';
const ATAJO = 'application/vnd.google-apps.shortcut';
const DRIVE_ID = /^[A-Za-z0-9_-]{10,100}$/;
const VISTA_ID = /^[A-Za-z0-9_-]{3,100}$/;
const CLAVE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const POR_PAGINA = 500;
const MAX_PAGINAS = 16;
/** Con las páginas de la lectura, el token, los cambios y la configuración, por debajo de las 50 peticiones que da el plan gratis por ejecución. */
const VISTAS_POR_VUELTA = 36;
/** Sin cambios en Drive, cada cuánto se relee igual la carpeta entera (por si su registro de cambios se dejó algo). */
const RELEER_CADA_MS = 6 * 3_600_000;
/** Páginas del registro de cambios que se miran por vuelta; con más, se relee la carpeta y se estrena marca. */
const MAX_PAGINAS_CAMBIOS = 5;
/** Lo más que la lectura puede gastar al día de la base: bien por debajo de lo que el plan da a toda la cuenta. */
const MAX_ESCRITAS_DIA = 40_000;
const MAX_LEIDAS_DIA = 2_000_000;
const NODOS_POR_PARTE = 400;
const MAX_TARJETAS = 1_000_000;
const MAX_CONFIG = 500_000;
const MAX_VISTA = 400_000;
/** Lado mayor de la portada copiada. Va en su versión: al cambiarlo, la app pide la nueva. */
const LADO_VISTA = 640;
const CAMPOS =
  'nextPageToken,files(id,name,mimeType,parents,description,properties,size,modifiedTime,sha256Checksum,version,thumbnailLink,shortcutDetails(targetId))';
const SIN_CACHE = { 'cache-control': 'private, no-store' };

// ------------------------------------------------------------
// Acceso a Drive: la cuenta de servicio lectora, o el permiso de Asvent
// ------------------------------------------------------------

interface CuentaDeServicio {
  client_email: string;
  private_key: string;
}

let lector: { token: string; until: number } | null = null;

/** El JWT firmado (RS256) que Google cambia por un token de la cuenta de servicio, de solo lectura. */
export async function firmarJwt(cuenta: CuentaDeServicio, ahora = Date.now()): Promise<string> {
  const enc = new TextEncoder();
  const s = Math.floor(ahora / 1000);
  const cab = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const cuerpo = b64url(
    enc.encode(
      JSON.stringify({
        iss: cuenta.client_email,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        aud: 'https://oauth2.googleapis.com/token',
        iat: s,
        exp: s + 3600,
      }),
    ),
  );
  const pem = cuenta.private_key.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const llave = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firma = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', llave, enc.encode(`${cab}.${cuerpo}`));
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

/**
 * Con cuenta de servicio, solo ella: si fallara y se pasara al permiso de Asvent, que ve
 * menos, la lectura completa borraría del índice lo que no subió Frame.
 */
async function tokenLector(env: Env): Promise<string | null> {
  if (!env.LORE_SA_JSON) return driveToken(env);
  if (lector && lector.until > Date.now()) return lector.token;
  let cuenta: CuentaDeServicio;
  try {
    cuenta = JSON.parse(env.LORE_SA_JSON) as CuentaDeServicio;
    if (!cuenta.client_email || !cuenta.private_key) throw new Error('incompleta');
  } catch {
    console.error('biblioteca: la clave de la cuenta de servicio no es válida');
    return null;
  }
  const assertion = await firmarJwt(cuenta).catch(() => null);
  if (!assertion) {
    console.error('biblioteca: no se pudo firmar con la cuenta de servicio');
    return null;
  }
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  }).catch(() => null);
  const out = r?.ok ? ((await r.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null) : null;
  if (!out?.access_token) {
    console.error('biblioteca: token de la cuenta de servicio', r?.status ?? 'red');
    return null;
  }
  lector = { token: out.access_token, until: Date.now() + Math.max(60, (out.expires_in ?? 3600) - 300) * 1000 };
  return lector.token;
}

function olvidarToken(): void {
  lector = null;
  resetDriveAccess();
}

async function drive(env: Env, ruta: string, cabeceras: Record<string, string> = {}): Promise<Response | null> {
  const token = await tokenLector(env);
  if (!token) return null;
  const r = await fetch(`https://www.googleapis.com/drive/v3/${ruta}`, { headers: { ...cabeceras, authorization: `Bearer ${token}` } }).catch(() => null);
  if (r?.status === 401) olvidarToken();
  return r;
}

// ------------------------------------------------------------
// La lectura de cada 5 minutos
// ------------------------------------------------------------

const GUARDAR_PAGINA = `INSERT INTO lore_nodos (id, padre, nombre, mime, descripcion, props, tamano, modificado, huella, destino, version, miniatura, pendiente, intentos)
SELECT json_extract(f.value, '$.id'), json_extract(f.value, '$.parents[0]'), json_extract(f.value, '$.name'), json_extract(f.value, '$.mimeType'),
  json_extract(f.value, '$.description'), json_extract(f.value, '$.properties'), CAST(json_extract(f.value, '$.size') AS INTEGER),
  json_extract(f.value, '$.modifiedTime'), json_extract(f.value, '$.sha256Checksum'), json_extract(f.value, '$.shortcutDetails.targetId'),
  CAST(json_extract(f.value, '$.version') AS TEXT), json_extract(f.value, '$.thumbnailLink'), json_extract(f.value, '$.thumbnailLink') IS NOT NULL, 0
FROM json_each(?1, '$.files') f
WHERE json_extract(f.value, '$.id') IS NOT NULL AND json_extract(f.value, '$.name') IS NOT NULL AND json_extract(f.value, '$.mimeType') IS NOT NULL
ON CONFLICT (id) DO UPDATE SET padre = excluded.padre, nombre = excluded.nombre, mime = excluded.mime, descripcion = excluded.descripcion,
  props = excluded.props, tamano = excluded.tamano, modificado = excluded.modificado, huella = excluded.huella, destino = excluded.destino,
  version = excluded.version, miniatura = excluded.miniatura,
  pendiente = CASE WHEN lore_nodos.version IS excluded.version AND lore_nodos.miniatura IS NOT NULL THEN lore_nodos.pendiente ELSE excluded.miniatura IS NOT NULL END,
  intentos = CASE WHEN lore_nodos.version IS excluded.version AND lore_nodos.miniatura IS NOT NULL THEN lore_nodos.intentos ELSE 0 END
WHERE lore_nodos.version IS NOT excluded.version OR lore_nodos.padre IS NOT excluded.padre OR lore_nodos.nombre IS NOT excluded.nombre
  OR (lore_nodos.pendiente = 1 AND lore_nodos.miniatura IS NOT excluded.miniatura AND lore_nodos.id IN (SELECT value FROM json_each(?2)))
  OR (lore_nodos.miniatura IS NULL AND excluded.miniatura IS NOT NULL)`;
// `?2` son las portadas que se copian en esta vuelta: el enlace de Drive cambia en cada lectura, y renovarlo en todas
// las pendientes reescribía cientos de filas cada 5 minutos (así se agotó el cupo de la base el 13-nov-2026).

/** Los nodos que se ven: los de la raíz para abajo, sin carpetas ni archivos que empiecen por «_» o «.» (salvo `_Biblioteca`). */
const ARBOL = `arbol(id) AS (
  SELECT n.id FROM lore_nodos n WHERE n.padre = (SELECT v FROM lore_estado WHERE k = 'raiz')
    AND (substr(n.nombre, 1, 1) NOT IN ('_', '.') OR n.nombre = '_Biblioteca')
  UNION ALL
  SELECT n.id FROM lore_nodos n JOIN arbol a ON n.padre = a.id WHERE substr(n.nombre, 1, 1) NOT IN ('_', '.')
)`;

const RAIZ = `INSERT INTO lore_estado (k, v)
SELECT 'raiz', id FROM (
  SELECT ?1 AS id WHERE ?1 IS NOT NULL
  UNION ALL
  SELECT * FROM (SELECT r.id FROM lore_nodos r WHERE ?1 IS NULL AND r.nombre = 'AK Lore' AND r.mime = '${CARPETA}'
    AND (r.padre IS NULL OR r.padre NOT IN (SELECT id FROM lore_nodos)) ORDER BY r.id LIMIT 1)
)`;

const INDICE = `WITH RECURSIVE ${ARBOL},
filas AS (
  SELECT n.id, n.padre, n.nombre, n.mime, n.descripcion, n.props, n.tamano, n.modificado, n.huella, n.destino, w.version AS vista,
    (row_number() OVER (ORDER BY n.id) - 1) / ${NODOS_POR_PARTE} AS parte
  FROM arbol a JOIN lore_nodos n ON n.id = a.id LEFT JOIN lore_vistas w ON w.id = n.id
  WHERE n.mime NOT GLOB 'application/vnd.google-apps.*' OR n.mime IN ('${CARPETA}', '${ATAJO}')
)
INSERT INTO lore_estado (k, v)
SELECT 'indice:' || parte, json_group_array(json_object(
  'i', id, 'p', padre, 'n', nombre, 'k', CASE mime WHEN '${CARPETA}' THEN 'd' WHEN '${ATAJO}' THEN 's' ELSE 'f' END,
  'm', mime, 'd', descripcion, 'x', json(props), 'z', tamano, 't', modificado, 'h', huella, 'g', destino, 'v', vista))
FROM filas GROUP BY parte`;

/** Busca un campo de primer nivel en la respuesta de Drive sin interpretarla entera (un valor escapado dentro de un texto no coincide). */
function campo(texto: string, nombre: string): string | null {
  return new RegExp(`"${nombre}"\\s*:\\s*"([^"\\\\]+)"`).exec(texto)?.[1] ?? null;
}

export interface Vuelta {
  paginas: number;
  cambios: number;
  borrados: number;
  vistas: number;
  config: boolean;
  indice: boolean;
  /** Filas de la base escritas y leídas en esta vuelta: lo que cuenta para los topes diarios del plan. */
  escritas: number;
  leidas: number;
  /** Drive dice que nada cambió y no quedan portadas por copiar: no se leyó la carpeta. */
  omitida?: boolean;
  error?: string;
}

type Meta = { rows_written?: number; rows_read?: number } | undefined;

/** ¿Cambió algo en Drive desde la marca? Si no, dice la marca nueva. Ante la duda (Drive no responde, demasiadas páginas), sí. */
async function cambiosDesde(env: Env, marca: string): Promise<{ hay: boolean; marca?: string }> {
  let token = marca;
  for (let i = 0; i < MAX_PAGINAS_CAMBIOS; i++) {
    const q = new URLSearchParams({ pageToken: token, pageSize: '100', spaces: 'drive', includeRemoved: 'true', fields: 'newStartPageToken,nextPageToken,changes(fileId)' });
    const r = await drive(env, `changes?${q}`);
    const j = r?.ok ? ((await r.json().catch(() => null)) as { newStartPageToken?: string; nextPageToken?: string; changes?: unknown[] } | null) : null;
    if (!j || j.changes?.length) return { hay: true };
    // Una página vacía con continuación: cambios de otros archivos del Drive, que este permiso no ve.
    if (j.newStartPageToken) return { hay: false, marca: j.newStartPageToken };
    if (!j.nextPageToken) return { hay: true };
    token = j.nextPageToken;
  }
  return { hay: true };
}

/** La marca desde la que se preguntará la próxima vez qué cambió. */
async function marcaDeCambios(env: Env): Promise<string | null> {
  const r = await drive(env, 'changes/startPageToken');
  const j = r?.ok ? ((await r.json().catch(() => null)) as { startPageToken?: string } | null) : null;
  return j?.startPageToken && /^[A-Za-z0-9_-]{1,200}$/.test(j.startPageToken) ? j.startPageToken : null;
}

/** La base dijo que la cuenta agotó su tope diario: hasta medianoche (UTC) no tiene sentido volver a leer la carpeta. */
let baseAgotadaHasta = 0;
const TOPE_DE_LA_BASE = /daily row (write|read) limit/i;

interface Gasto {
  d: string;
  w: number;
  r: number;
}

/** Lo que la lectura lleva gastado hoy (UTC, como cuenta Cloudflare); otro día empieza de cero. */
function gastoDe(texto: string | undefined, dia: string): Gasto {
  try {
    const g = JSON.parse(texto ?? '') as Gasto;
    if (g?.d === dia && Number.isFinite(g.w) && Number.isFinite(g.r)) return g;
  } catch {
    /* sin anotar aún */
  }
  return { d: dia, w: 0, r: 0 };
}

/**
 * Una vuelta. Si Drive dice que nada cambió, no quedan portadas y no toca releer, no hace nada más. Si no: lee todo,
 * guarda lo cambiado, quita lo que ya no está, copia unas portadas y rearma el índice si algo cambió.
 */
export async function sincronizar(env: Env, ahora = Date.now()): Promise<Vuelta> {
  const v: Vuelta = { paginas: 0, cambios: 0, borrados: 0, vistas: 0, config: false, indice: false, escritas: 0, leidas: 0 };
  if (!env.LORE_SA_JSON && !env.LORE_DRIVE_REFRESH) return { ...v, error: 'sin-drive' };
  if (ahora < baseAgotadaHasta) return { ...v, error: 'la base agotó su tope de hoy: la lectura sigue mañana (UTC)' };
  const gasta = (meta: Meta) => {
    v.escritas += meta?.rows_written ?? 0;
    v.leidas += meta?.rows_read ?? 0;
  };

  // 0. Lo que quedó de la vuelta anterior y lo gastado hoy: con el cupo propio agotado, se espera a mañana.
  const antes = await env.DB.prepare("SELECT k, v FROM lore_estado WHERE k IN ('raiz', 'config_version', 'partes', 'cambios', 'releida', 'gasto')").all<{ k: string; v: string }>();
  gasta(antes.meta);
  const estado = Object.fromEntries(antes.results.map((r) => [r.k, r.v]));
  const gasto = gastoDe(estado.gasto, new Date(ahora).toISOString().slice(0, 10));
  if (gasto.w >= MAX_ESCRITAS_DIA || gasto.r >= MAX_LEIDAS_DIA) return { ...v, error: `presupuesto (${gasto.w} escritas, ${gasto.r} leídas hoy)` };

  // 1. Las portadas que se copian en esta vuelta: solo a ellas se les renueva el enlace.
  const toca = await env.DB.prepare('SELECT id FROM lore_nodos WHERE pendiente = 1 ORDER BY intentos, id LIMIT ?').bind(VISTAS_POR_VUELTA).all<{ id: string }>();
  gasta(toca.meta);
  const elegidas = JSON.stringify(toca.results.map((r) => r.id));

  // 2. ¿Hay que leer la carpeta? Solo si falta algo, quedan portadas, toca releer o Drive dice que algo cambió.
  const releer = !estado.raiz || !estado.partes || !estado.cambios || toca.results.length > 0 || ahora - Number(estado.releida ?? 0) >= RELEER_CADA_MS;
  if (!releer) {
    const c = await cambiosDesde(env, estado.cambios!);
    if (!c.hay) {
      // La marca avanza aunque los cambios fueran de otros archivos: la próxima pregunta vuelve a ser de una página.
      if (c.marca && c.marca !== estado.cambios) await env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('cambios', ?)").bind(c.marca).run();
      return { ...v, omitida: true };
    }
  }

  let error: string | undefined;
  try {
    error = await leerCarpeta(env, v, estado, elegidas, gasta, ahora);
  } catch (e) {
    error = String(e).slice(0, 200);
    if (TOPE_DE_LA_BASE.test(error)) baseAgotadaHasta = Math.floor(ahora / 86_400_000 + 1) * 86_400_000;
  }
  // Lo gastado se anota pase lo que pase. Si la base ya no deja escribir, esto falla también, y ya no hay nada que cuidar.
  gasto.w += v.escritas + 2;
  gasto.r += v.leidas;
  await env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('gasto', ?)")
    .bind(JSON.stringify(gasto))
    .run()
    .catch(() => undefined);
  return error ? { ...v, error } : v;
}

/** La lectura completa. Devuelve el error, si lo hubo; lo hecho queda en `v`. */
async function leerCarpeta(env: Env, v: Vuelta, estado: Record<string, string>, elegidas: string, gasta: (meta: Meta) => void, ahora: number): Promise<string | undefined> {
  // La marca se pide ANTES de leer: lo que cambie durante la lectura saldrá en la siguiente pregunta.
  const marca = await marcaDeCambios(env);

  // 1. Todo lo que ve el lector, por páginas, tal cual a D1.
  const ids: string[] = [];
  let pagina: string | null = null;
  do {
    const q = new URLSearchParams({ q: 'trashed = false', pageSize: String(POR_PAGINA), fields: CAMPOS, spaces: 'drive' });
    if (pagina) q.set('pageToken', pagina);
    const r = await drive(env, `files?${q}`);
    if (!r?.ok) return `drive ${r?.status ?? 'red'}`;
    const texto = await r.text();
    const hecho = await env.DB.prepare(GUARDAR_PAGINA).bind(texto, elegidas).run();
    gasta(hecho.meta);
    v.cambios += hecho.meta.changes ?? 0;
    for (const m of texto.matchAll(/"id"\s*:\s*"([A-Za-z0-9_-]+)"/g)) ids.push(m[1]!);
    pagina = campo(texto, 'nextPageToken');
    v.paginas++;
  } while (pagina && v.paginas < MAX_PAGINAS);
  if (pagina) return 'demasiadas-paginas';

  // 2. Lo que ya no está (borrado, a la papelera o fuera del alcance del lector).
  const fuera = await env.DB.prepare('DELETE FROM lore_nodos WHERE id NOT IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).run();
  gasta(fuera.meta);
  v.borrados = fuera.meta.changes ?? 0;
  if (v.borrados) gasta((await env.DB.prepare('DELETE FROM lore_vistas WHERE version IS NOT NULL AND id NOT IN (SELECT id FROM lore_nodos)').run()).meta);

  // 3. La raíz y la configuración.
  if (v.cambios || v.borrados || !estado.raiz || !estado.partes) {
    for (const h of await env.DB.batch([env.DB.prepare("DELETE FROM lore_estado WHERE k = 'raiz'"), env.DB.prepare(RAIZ).bind(env.LORE_ROOT ?? null)])) gasta(h.meta);
  }
  const cfgs = await env.DB.prepare(
    "SELECT n.id, n.version, n.tamano FROM lore_nodos n JOIN lore_nodos b ON b.id = n.padre WHERE n.nombre = 'biblioteca.json' AND b.nombre = '_Biblioteca' AND b.padre = (SELECT v FROM lore_estado WHERE k = 'raiz') LIMIT 1",
  ).all<{ id: string; version: string | null; tamano: number | null }>();
  gasta(cfgs.meta);
  const cfg = cfgs.results[0];
  const versionCfg = cfg ? `${cfg.id}:${cfg.version ?? ''}` : '';
  if (versionCfg !== (estado.config_version ?? '')) {
    if (!cfg) {
      gasta((await env.DB.prepare("DELETE FROM lore_estado WHERE k IN ('config', 'config_version')").run()).meta);
      v.config = true;
    } else if ((cfg.tamano ?? 0) <= MAX_CONFIG) {
      const r = await drive(env, `files/${encodeURIComponent(cfg.id)}?alt=media`);
      const texto = r?.ok ? await r.text() : null;
      if (texto !== null && texto.length <= MAX_CONFIG) {
        // Si no es JSON válido, se queda la anterior; el validador lo dice.
        const hechos = await env.DB.batch([
          env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) SELECT 'config', json(?1) WHERE json_valid(?1) AND json_type(?1) = 'object'").bind(texto),
          env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('config_version', ?)").bind(versionCfg),
        ]);
        for (const h of hechos) gasta(h.meta);
        v.config = true;
      }
    }
  }

  // 4. Portadas: la primera página de todo lo que se ve (1.9.8: también exámenes, esquemas y bancos).
  if (v.cambios || v.borrados) {
    gasta((await env.DB.prepare(`WITH RECURSIVE ${ARBOL} UPDATE lore_nodos SET pendiente = 0 WHERE pendiente = 1 AND id NOT IN (SELECT id FROM arbol)`).run()).meta);
  }
  v.vistas = await copiarPortadas(env, elegidas, gasta);

  // 5. El índice, solo si algo cambió.
  if (v.cambios || v.borrados || v.vistas || v.config || !estado.partes) {
    const hechos = await env.DB.batch([
      env.DB.prepare("DELETE FROM lore_estado WHERE k GLOB 'indice:*'"),
      env.DB.prepare(INDICE),
      env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) SELECT 'partes', count(*) FROM lore_estado WHERE k GLOB 'indice:*'"),
      env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('actualizado', ?)").bind(new Date().toISOString()),
    ]);
    for (const h of hechos) gasta(h.meta);
    v.indice = true;
  }

  // 6. Desde dónde preguntar la próxima vez y cuándo se leyó todo por última vez.
  const hechos = await env.DB.batch([
    ...(marca ? [env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('cambios', ?)").bind(marca)] : []),
    env.DB.prepare("INSERT OR REPLACE INTO lore_estado (k, v) VALUES ('releida', ?)").bind(String(ahora)),
  ]);
  for (const h of hechos) gasta(h.meta);
  return undefined;
}

/**
 * Copia a D1 las portadas elegidas en esta vuelta (el enlace de Drive caduca en horas y pide permiso: la app no puede
 * usarlo). Solo esas: son las que tienen el enlace recién renovado.
 */
async function copiarPortadas(env: Env, elegidas: string, gasta: (meta: Meta) => void): Promise<number> {
  const lista = await env.DB.prepare('SELECT id, miniatura, version FROM lore_nodos WHERE pendiente = 1 AND id IN (SELECT value FROM json_each(?1))')
    .bind(elegidas)
    .all<{ id: string; miniatura: string | null; version: string | null }>();
  gasta(lista.meta);
  const { results } = lista;
  if (!results.length) return 0;
  const token = await tokenLector(env);
  if (!token) return 0;
  const hechos = await Promise.all(
    results.map(async (n) => {
      if (!n.miniatura?.startsWith('https://')) return { n, ok: null };
      const url = /=s\d+$/.test(n.miniatura) ? n.miniatura.replace(/=s\d+$/, `=s${LADO_VISTA}`) : n.miniatura;
      const r = await fetch(url, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      const mime = (r?.headers.get('content-type') ?? '').split(';')[0]!.trim();
      if (!r?.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) return { n, ok: null };
      const datos = await r.arrayBuffer();
      return { n, ok: datos.byteLength > 0 && datos.byteLength <= MAX_VISTA ? { mime, datos } : null };
    }),
  );
  const pasos = hechos.flatMap(({ n, ok }) =>
    ok
      ? [
          env.DB.prepare('INSERT OR REPLACE INTO lore_vistas (id, mime, datos, version) VALUES (?, ?, ?, ?)').bind(n.id, ok.mime, ok.datos, `${n.version ?? '0'}.${LADO_VISTA}`),
          env.DB.prepare('UPDATE lore_nodos SET pendiente = 0 WHERE id = ? AND version IS ?').bind(n.id, n.version),
        ]
      : // Tres intentos (el enlace se renueva en cada vuelta); sin portada, la app enseña una hoja en blanco.
        [env.DB.prepare('UPDATE lore_nodos SET intentos = intentos + 1, pendiente = intentos + 1 < 3 WHERE id = ?').bind(n.id)],
  );
  for (const h of await env.DB.batch(pasos)) gasta(h.meta);
  return hechos.filter((h) => h.ok).length;
}

// ------------------------------------------------------------
// Lo que pide la app
// ------------------------------------------------------------

/** El índice por partes. Con `si` igual al último, solo dice que no cambió (una lectura de D1). */
export async function bibliotecaIndice(env: Env, user: AppUser, url: URL): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  const n = Number(url.searchParams.get('parte') ?? '0');
  const parte = Number.isInteger(n) && n >= 0 && n < 1000 ? n : -1;
  if (parte < 0) return json({ error: 'not_found' }, 404);
  const { results } = await env.DB.prepare("SELECT k, v FROM lore_estado WHERE k IN ('actualizado', 'partes', 'raiz', 'config', ?1)")
    .bind(`indice:${parte}`)
    .all<{ k: string; v: string }>();
  const e = Object.fromEntries(results.map((r) => [r.k, r.v]));
  const actualizado = e.actualizado ?? null;
  const si = url.searchParams.get('si');
  if (parte === 0 && si && si === actualizado) return json({ formato: 2, actualizado, igual: true }, 200, SIN_CACHE);
  const partes = Number(e.partes ?? 0);
  if (parte > 0 && parte >= partes) return json({ error: 'not_found' }, 404);
  // Se arma como texto: D1 ya lo devolvió en JSON y volver a interpretarlo gastaría procesador.
  const cuerpo = `{"formato":2,"actualizado":${JSON.stringify(actualizado)},"raiz":${JSON.stringify(e.raiz ?? null)},"partes":${partes},"parte":${parte},"config":${
    parte === 0 && e.config ? e.config : 'null'
  },"nodos":${e[`indice:${parte}`] ?? '[]'}}`;
  return new Response(cuerpo, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', ...SIN_CACHE } });
}

/** Un nodo de la Biblioteca, si está dentro de la raíz y no en una carpeta apartada («_…», «.…»). */
async function nodoVisible(env: Env, id: string) {
  return env.DB.prepare(
    `WITH RECURSIVE sube(id, padre, nombre, nivel) AS (
      SELECT id, padre, nombre, 0 FROM lore_nodos WHERE id = ?1
      UNION ALL SELECT p.id, p.padre, p.nombre, s.nivel + 1 FROM lore_nodos p JOIN sube s ON p.id = s.padre WHERE s.nivel < 10
    ),
    raiz(v) AS (SELECT v FROM lore_estado WHERE k = 'raiz')
    SELECT x.id, x.nombre, x.mime, x.tamano,
      EXISTS (SELECT 1 FROM sube, raiz WHERE sube.id = raiz.v) AS dentro,
      EXISTS (SELECT 1 FROM sube, raiz WHERE sube.id <> raiz.v AND substr(sube.nombre, 1, 1) IN ('_', '.')) AS apartado
    FROM lore_nodos x WHERE x.id = ?1`,
  )
    .bind(id)
    .first<{ id: string; nombre: string; mime: string; tamano: number | null; dentro: number; apartado: number }>();
}

const TIPOS_SERVIBLES = /^(application\/(pdf|json|msword|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-[a-z.]+|vnd\.oasis\.opendocument\.[a-z.]+|epub\+zip)|image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|ogg|wav|x-wav|webm|aac|x-m4a)|video\/(mp4|webm|quicktime)|text\/(plain|csv|markdown))$/;

/** Un archivo: se cuenta, se trae de Drive y se pasa sin guardarlo. Con Range, solo ese tramo (el visor de PDF hojea así los libros grandes). */
export async function bibliotecaArchivo(req: Request, env: Env, user: AppUser, id: string): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  const nodo = DRIVE_ID.test(id) ? await nodoVisible(env, id) : null;
  if (!nodo || !nodo.dentro || nodo.apartado || nodo.mime.startsWith('application/vnd.google-apps.')) return json({ error: 'not_found' }, 404);

  const tamano = Math.max(0, nodo.tamano ?? 0);
  const rango = req.headers.get('range')?.trim() ?? '';
  const m = /^bytes=(\d+)-(\d*)$/.exec(rango);
  let inicio = 0;
  let fin = tamano - 1;
  if (m) {
    inicio = Number(m[1]);
    fin = m[2] ? Math.min(Number(m[2]), tamano - 1) : tamano - 1;
    if (tamano && inicio > fin) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${tamano}` } });
  }
  // Un archivo cuenta una vez al día, en su primera petición (empiece por donde empiece). Los bytes de los tramos
  // pequeños de hojearlo se anotan por muestreo (lore.ts): una vista previa son decenas de peticiones y las
  // escrituras de la base están contadas. Si la cuenta falla, el archivo se sirve igual.
  const bytes = Math.max(0, fin - inicio + 1);
  // `?lote=1`: un archivo entero de «Tu paquete» (cientos seguidos), que se anota por muestreo.
  const lote = !m && new URL(req.url).searchParams.get('lote') === '1';
  const cuenta = await contarDescarga(env, user.owner, { id: nodo.id, bytes, entero: !m, lote });
  if (!cuenta.cabe) return json(cuenta.lleno ? { error: 'lleno' } : { error: 'quota', files: DAILY_FILES }, 429);
  const devolver = cuenta.devolver;

  const r = await drive(env, `files/${encodeURIComponent(nodo.id)}?alt=media`, m ? { range: rango } : {});
  if (!r || !(r.status === 200 || r.status === 206) || !r.body) {
    console.error('biblioteca archivo', r?.status ?? 'sin-drive');
    await devolver();
    if (!r) return json({ error: 'lore-off' }, 503);
    return json({ error: r.status === 404 ? 'not_found' : 'drive' }, r.status === 404 ? 404 : 503);
  }
  const tipo = TIPOS_SERVIBLES.test(nodo.mime) ? nodo.mime : 'application/octet-stream';
  const cab: Record<string, string> = {
    'content-type': tipo,
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nodo.nombre.replace(/[\u0000-\u001f"\\/:*?<>|]+/g, ' ').trim())}`,
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff',
    ...SIN_CACHE,
  };
  for (const h of ['content-length', 'content-range']) {
    const valor = r.headers.get(h);
    if (valor) cab[h] = valor;
  }
  return new Response(r.body, { status: r.status, headers: cab });
}

/** La portada de un archivo, copiada de Drive en la sincronización. No cuenta para el tope. */
export async function bibliotecaVista(env: Env, user: AppUser, id: string): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  const row = VISTA_ID.test(id) ? await env.DB.prepare('SELECT mime, datos FROM lore_vistas WHERE id = ?').bind(id).first<{ mime: string; datos: ArrayBuffer | number[] }>() : null;
  if (!row) return json({ error: 'not_found' }, 404);
  const bytes = row.datos instanceof ArrayBuffer ? new Uint8Array(row.datos) : Uint8Array.from(row.datos);
  // La app pide `?v=<versión>`: si la portada cambia, cambia la dirección.
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': /^image\/(jpeg|png|webp)$/.test(row.mime) ? row.mime : 'application/octet-stream', 'cache-control': 'private, max-age=2592000, immutable' },
  });
}

/** Las tarjetas de estudio de un archivo: `_Biblioteca/Tarjetas/<clave>.json`. */
export async function bibliotecaTarjetas(env: Env, user: AppUser, clave: string): Promise<Response> {
  if (!(await hasLoreAccess(env, user))) return json({ error: 'school' }, 403);
  if (!CLAVE.test(clave) || clave.length > 64) return json({ error: 'not_found' }, 404);
  const nodo = await env.DB.prepare(
    `SELECT n.id, n.tamano FROM lore_nodos n JOIN lore_nodos t ON t.id = n.padre JOIN lore_nodos b ON b.id = t.padre
     WHERE n.nombre = ?1 AND t.nombre = 'Tarjetas' AND b.nombre = '_Biblioteca' AND b.padre = (SELECT v FROM lore_estado WHERE k = 'raiz') LIMIT 1`,
  )
    .bind(`${clave}.json`)
    .first<{ id: string; tamano: number | null }>();
  if (!nodo || (nodo.tamano ?? 0) > MAX_TARJETAS) return json({ error: 'not_found' }, 404);
  const r = await drive(env, `files/${encodeURIComponent(nodo.id)}?alt=media`);
  if (!r?.ok) return json({ error: r ? 'drive' : 'lore-off' }, 503);
  const texto = await r.text();
  if (texto.length > MAX_TARJETAS) return json({ error: 'not_found' }, 404);
  return new Response(texto, { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=600' } });
}
