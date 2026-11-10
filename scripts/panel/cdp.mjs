// Mini cliente CDP sobre Edge sin ventana: abre una URL, ejecuta pasos y
// guarda capturas. Lo usa scripts/probar-panel.mjs. Uso: import { launch } from './panel/cdp.mjs'
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const EDGE = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((file) => existsSync(file));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ profile, width = 1440, height = 900, scale = 1 } = {}) {
  profile = path.resolve(profile ?? `.edge-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  try { (await import('node:fs')).rmSync(path.join(profile, 'DevToolsActivePort'), { force: true }); } catch {}
  if (!EDGE) throw new Error('No se encontró Microsoft Edge en este equipo.');
  const proc = spawn(EDGE, [
    '--headless=new', `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await sleep(100);
    const f = path.join(profile, 'DevToolsActivePort');
    if (existsSync(f)) { try { port = readFileSync(f, 'utf8').split(/\r?\n/)[0].trim(); } catch {} }
  }
  if (!port) throw new Error('sin puerto de depuración');
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {}
    await sleep(100);
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method) { listeners.forEach((l) => l(m)); globalThis.__cdpHandler?.(m); }
  });
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
  const consoleErrors = [];
  listeners.push((m) => {
    if (m.method === 'Runtime.exceptionThrown') consoleErrors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  };
  const nav = async (url, wait = 4000) => { await send('Page.navigate', { url }); await sleep(wait); };
  const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { try { if (await ev(expr)) return true; } catch {} await sleep(300); } return false; };
  const shot = async (file, clip) => {
    const r = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  };
  const resize = (w, h) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: false });
  const close = async () => { try { await send('Browser.close'); } catch {} await sleep(500); try { proc.kill(); } catch {} };
  return { send, ev, nav, until, shot, resize, close, consoleErrors, sleep, profile };
}
