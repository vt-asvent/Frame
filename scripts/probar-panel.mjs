#!/usr/bin/env node
// ============================================================
// Prueba de la puerta del panel de métricas (10-nov-2026).
//
//   npm run metricas            (compila el panel en website/metricas)
//   node scripts/probar-panel.mjs
//
// Abre el panel YA COMPILADO en un Edge sin ventana, con un Supabase de
// mentira (ninguna petición sale a la nube), y recorre la puerta: entrar,
// código errado, bloqueo, código bueno, recargar, otra cuenta, alta del
// autenticador y base sin la migración 0022.
//
// Lo que no puede volver a pasar: que el panel llame al segundo factor de
// Supabase Auth (`/auth/v1/factors/…`). Verificar un factor de Auth borra las
// sesiones normales de esa cuenta, y cada visita al panel le cerraba Frame al
// responsable en todos sus equipos. El autenticador es de la base
// (supabase/migrations/0021 y 0022).
// ============================================================
import { launch } from './panel/cdp.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(here, '..', 'website');
const PORT = 9032;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' };
const server = createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(SITE, rel);
  if (!file.startsWith(path.resolve(SITE)) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
if (!existsSync(path.join(SITE, 'metricas', 'index.html'))) {
  console.error('Falta el panel compilado: npm run metricas');
  process.exit(1);
}
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const nowS = Math.floor(Date.now() / 1000);
const UID = '0b6f3c1e-7a2d-4c5b-9e8f-1a2b3c4d5e6f';
const fakeUser = { id: UID, aud: 'authenticated', role: 'authenticated', email: 'prueba@example.com', app_metadata: { provider: 'google' }, user_metadata: {}, created_at: new Date().toISOString(), factors: [{ id: 'f1', factor_type: 'totp', status: 'verified', friendly_name: 'Prueba' }] };
const tokenOf = (aal) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: UID, aud: 'authenticated', role: 'authenticated', email: fakeUser.email, iat: nowS, exp: nowS + 3600, aal, amr: [{ method: 'oauth', timestamp: nowS }], session_id: '11111111-2222-4333-8444-555555555555' })}.c2lnbmF0dXJl`;
const sessionOf = (aal) => ({ access_token: tokenOf(aal), token_type: 'bearer', expires_in: 3600, expires_at: nowS + 3600, refresh_token: 'prueba', user: fakeUser });
const EPOCH = Date.UTC(2024, 0, 1);
const today = Math.floor((Date.now() - 5 * 3600e3 - EPOCH) / 86400e3);
const snapshot = { v: 1, generated_at: new Date().toISOString(), tz: 'America/Lima', epoch: '2024-01-01', today, since: today - 399, users: [], ev: {}, sc: {}, reports: {}, mx_open: Array(168).fill(0), devices: { laptop: 0, phone: 0, tablet: 0, accounts: 0 }, errors: { open: 0, fixed: 0, ignored: 0, top: [] } };

/** Estado del Supabase de mentira. */
const cloud = { unlocked: false, mode: 'base', owner: true, totp: 'ready' };
const CLAVE = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const seen = [];
const codes = [];

const profile = path.join(os.tmpdir(), `frame-panel-prueba-${process.pid}`);
const b = await launch({ profile, width: 1200, height: 860 });
const log = [];
let failed = 0;
const check = (ok, text) => { log.push(`${ok ? '  ✓' : '  ✗'} ${text}`); if (!ok) failed += 1; };
const CORS = [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }, { name: 'Access-Control-Allow-Methods', value: 'GET,POST,OPTIONS' }, { name: 'Content-Type', value: 'application/json' }];
globalThis.__cdpHandler = (m) => {
  if (m.method !== 'Fetch.requestPaused') return;
  const { requestId, request } = m.params;
  const url = request.url;
  if (url.startsWith(`http://127.0.0.1:${PORT}/`) || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') { void b.send('Fetch.continueRequest', { requestId }).catch(() => {}); return; }
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co\//.test(url)) { seen.push(`CORTADA ${request.method} ${url.slice(0, 90)}`); void b.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {}); return; }
  const where = new URL(url).pathname;
  if (request.method !== 'OPTIONS') seen.push(`${request.method} ${where}`);
  let body = '{}';
  let code = 200;
  let posted = {};
  try { posted = JSON.parse(request.postData ?? '{}'); } catch {}
  if (request.method === 'OPTIONS') code = 204;
  else if (where.endsWith('/rpc/is_frame_owner')) body = JSON.stringify(cloud.owner && cloud.unlocked);
  else if (where.endsWith('/rpc/metrics_owner_account')) body = JSON.stringify(cloud.owner);
  else if (where.endsWith('/rpc/metrics_totp_state')) {
    if (cloud.mode === 'sin0022') { code = 404; body = JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.metrics_totp_state without parameters in the schema cache' }); }
    else body = JSON.stringify(!cloud.owner ? 'not-owner' : cloud.totp);
  } else if (where.endsWith('/rpc/metrics_totp_begin')) body = JSON.stringify(cloud.owner ? { ok: true, secret: CLAVE } : { ok: false, reason: 'not-owner' });
  else if (where.endsWith('/rpc/metrics_unlock')) {
    codes.push(posted.p_code);
    if (cloud.mode === 'ilegible') body = JSON.stringify({ ok: false, reason: 'unavailable' });
    else if (posted.p_code === '123456') { cloud.unlocked = true; cloud.totp = 'ready'; body = JSON.stringify({ ok: true, until: new Date(Date.now() + 12 * 3600e3).toISOString() }); }
    else if (posted.p_code === '999999') body = JSON.stringify({ ok: false, reason: 'code', left: 2 });
    else if (posted.p_code === '888888') body = JSON.stringify({ ok: false, reason: 'locked', retry_in: 540 });
    else body = JSON.stringify({ ok: false, reason: 'code', left: 4 });
  } else if (where.endsWith('/rpc/usage_snapshot')) body = JSON.stringify(snapshot);
  else if (where.endsWith('/rpc/usage_user_detail')) body = '{}';
  else if (where.endsWith('/rpc/impact_overview')) body = 'null';
  else if (where.endsWith('/auth/v1/user')) body = JSON.stringify(fakeUser);
  else if (/\/auth\/v1\/factors\/[^/]+\/challenge$/.test(where)) body = JSON.stringify({ id: 'c1', type: 'totp', expires_at: nowS + 300 });
  else if (/\/auth\/v1\/factors\/[^/]+\/verify$/.test(where)) { cloud.unlocked = true; body = JSON.stringify(sessionOf('aal2')); }
  void b.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: CORS, ...(code === 204 ? {} : { body: Buffer.from(body).toString('base64') }) }).catch(() => {});
};

const text = () => b.ev(`document.body.innerText`);
const clickText = (sel, re) => b.ev(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>${re}.test(x.textContent)); if(el){el.click(); return true} return false})()`);
const typeCode = (value) => b.ev(`(()=>{const input=document.querySelector('#codigo'); if(!input) return false; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);
const submit = () => clickText('button', '/Verificar/');
const usedAuthMfa = () => seen.some((line) => /\/auth\/v1\/factors/.test(line));

try {
  await b.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { if (!sessionStorage.getItem('frame-metricas')) sessionStorage.setItem('frame-metricas', ${JSON.stringify(JSON.stringify(sessionOf('aal1')))}); } catch {}` });

  log.push('1. Entrar: con sesión de Google (aal1) se ven las tarjetas, sin verificar');
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  check(await b.until(`document.body.innerText.includes('Tus apps')`, 30000), 'aparecen las tarjetas');
  check((await text()).includes('Pide el código'), 'la tarjeta de Frame pide el código');
  check(seen.includes('POST /rest/v1/rpc/is_frame_owner'), '«verificado» se le pregunta a la base (is_frame_owner)');

  log.push('2. Abrir Frame: pide el código');
  check(await clickText('button', '/Frame/'), 'clic en la tarjeta de Frame');
  check(await b.until(`!!document.querySelector('#codigo')`, 15000), 'aparece el campo del código');
  check(seen.includes('POST /rest/v1/rpc/metrics_totp_state'), 'antes le pregunta a la base si hay autenticador (metrics_totp_state)');

  log.push('3. Código errado, y el bloqueo');
  await typeCode('999999');
  await submit();
  check(await b.until(`document.body.innerText.includes('Código incorrecto o ya usado')`, 10000), 'dice «Código incorrecto o ya usado»');
  check((await text()).includes('Te quedan 2 intentos'), 'y cuántos intentos quedan');
  await typeCode('888888');
  await submit();
  check(await b.until(`document.body.innerText.includes('Demasiados intentos')`, 10000), 'tras demasiados fallos: «Demasiados intentos. Espera 9 min…»');
  check((await text()).includes('Espera 9 min'), 'con los minutos que faltan');
  check(!usedAuthMfa(), 'hasta aquí, ni una llamada al segundo factor de Supabase Auth');

  log.push('4. Código correcto: abre el panel sin pasar por Supabase Auth');
  await typeCode('123456');
  await submit();
  check(await b.until(`location.hash === '#frame' && !document.querySelector('#codigo')`, 15000), 'la puerta se cierra y entra a #frame');
  check(await b.until(`${JSON.stringify(seen)}.length >= 0 && true`, 100), '(esperando al panel)');
  await b.sleep(2500);
  check(seen.includes('POST /rest/v1/rpc/usage_snapshot'), 'el panel pide su foto (usage_snapshot)');
  check(!usedAuthMfa(), 'NINGUNA llamada a /auth/v1/factors/…/challenge ni /verify: las sesiones de Frame no se tocan');
  check(JSON.stringify(codes) === JSON.stringify(['999999', '888888', '123456']), `los tres códigos fueron a metrics_unlock (${codes.join(', ')})`);

  log.push('5. Recargar la pestaña: sigue verificado (lo dice la base), no vuelve a pedir el código');
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  check(await b.until(`document.body.innerText.includes('Código verificado en esta sesión')`, 20000), 'dice «Código verificado en esta sesión»');

  log.push('6. Otra cuenta (no es la del responsable): ni código ni alta del autenticador');
  cloud.unlocked = false;
  cloud.owner = false;
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  await b.until(`document.body.innerText.includes('Tus apps')`, 20000);
  await clickText('button', '/Frame/');
  check(await b.until(`document.body.innerText.includes('Esta cuenta no es la del responsable')`, 10000), 'dice «Esta cuenta no es la del responsable»');
  check(!(await b.ev(`!!document.querySelector('#codigo')`)), 'y no enseña el campo del código');
  check(!seen.includes('POST /rest/v1/rpc/metrics_totp_begin') && !usedAuthMfa(), 'ni empieza el alta de un autenticador');

  log.push('7. Sin autenticador todavía: el alta la hace la base (clave para escribir en la app), no Supabase Auth');
  cloud.owner = true;
  cloud.unlocked = false;
  cloud.totp = 'none';
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  await b.until(`document.body.innerText.includes('Tus apps')`, 20000);
  await clickText('button', '/Frame/');
  check(await b.until(`document.body.innerText.includes('Introducir clave de configuración')`, 15000), 'explica cómo añadir la cuenta en la app de autenticación');
  check((await text()).replace(/\s+/g, '').includes(CLAVE), 'y enseña la clave que le dio la base');
  check(seen.includes('POST /rest/v1/rpc/metrics_totp_begin'), 'pedida a metrics_totp_begin');
  check(await b.ev(`[...document.querySelectorAll('a')].some((a) => a.href.startsWith('otpauth://totp/') && a.href.includes('secret=${CLAVE}') && a.href.includes('issuer='))`), 'con el enlace otpauth para abrirla en el teléfono');
  await typeCode('123456');
  await submit();
  check(await b.until(`location.hash === '#frame' && !document.querySelector('#codigo')`, 15000), 'el primer código la confirma y entra');
  check(!usedAuthMfa(), 'sin ninguna llamada a /auth/v1/factors (ni alta ni verificación en Auth)');

  log.push('8. La clave no se puede leer (unavailable): lo dice; no hay vía por Supabase Auth');
  cloud.unlocked = false;
  cloud.mode = 'ilegible';
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  await b.until(`document.body.innerText.includes('Tus apps')`, 20000);
  await clickText('button', '/Frame/');
  await b.until(`!!document.querySelector('#codigo')`, 15000);
  await typeCode('123456');
  await submit();
  check(await b.until(`document.body.innerText.includes('La clave del autenticador no se pudo leer')`, 10000), 'dice «La clave del autenticador no se pudo leer»');
  check(!usedAuthMfa(), 'y no prueba con Supabase Auth');

  log.push('9. Base sin la migración 0022 (el panel se publica antes): espera, sin tocar Supabase Auth');
  cloud.mode = 'sin0022';
  await b.nav(`http://127.0.0.1:${PORT}/metricas/`, 2500);
  await b.until(`document.body.innerText.includes('Tus apps')`, 20000);
  await clickText('button', '/Frame/');
  check(await b.until(`document.body.innerText.includes('El panel se está actualizando')`, 10000), 'dice «El panel se está actualizando»');
  check(!(await b.ev(`!!document.querySelector('#codigo')`)), 'sin campo de código');
  check(!usedAuthMfa(), 'y en toda la prueba, NINGUNA petición a /auth/v1/factors');

  const errors = b.consoleErrors.filter((e) => !/Failed to load resource|ERR_BLOCKED_BY_CLIENT/.test(String(e)));
  check(errors.length === 0, `sin errores en la consola${errors.length ? ': ' + JSON.stringify(errors.slice(0, 3)) : ''}`);
} catch (e) {
  log.push('FALLO ' + (e?.stack ?? e));
  failed += 1;
} finally {
  await b.close();
  server.close();
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log(log.join('\n'));
  console.log(failed ? `\n✗ ${failed} fallos` : '\n✓ Todo en orden');
  if (failed) console.log('peticiones: ' + JSON.stringify([...new Set(seen)]));
  process.exit(failed ? 1 : 0);
}
