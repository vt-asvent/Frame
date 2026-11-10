// Frame · IA en la nube: OAuth con el código de Frame, MCP y el relé a las
// Frame abiertas (respaldo entre equipos, cortes, permisos retirados, frenos).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALUMNA, type Arnes, CLAUDE, crearArnes, esperar, LUIS, ORIGEN, pdfDe, sesion, SIN_COMPROBAR, VERIFICADOR } from './ayuda';

let a: Arnes;
beforeAll(async () => {
  a = await crearArnes();
});
afterAll(async () => {
  await a?.cerrar();
});

/** Una cuenta nueva por prueba: los relés no se pisan. */
const cuenta = () => randomUUID();
const pkce = (v: string) => createHash('sha256').update(v).digest('base64url');

async function autorizar(cliente: string, codigo: string) {
  return a.pedir('/authorize', {
    headers: { 'accept-language': 'es-PE,es;q=0.9' },
    form: { client_id: cliente, redirect_uri: CLAUDE, state: 'e', code_challenge: pkce(VERIFICADOR), code_challenge_method: 'S256', response_type: 'code', code: codigo },
  });
}

describe('descubrimiento y OAuth', () => {
  it('anuncia el recurso y el servidor de autorización', async () => {
    const r = await a.pedir('/.well-known/oauth-protected-resource/mcp');
    expect(r.datos.resource).toBe(`${ORIGEN}/mcp`);
    expect(r.datos.authorization_servers).toEqual([ORIGEN]);
    const s = await a.pedir('/.well-known/oauth-authorization-server');
    expect(s.datos.code_challenge_methods_supported).toEqual(['S256']);
    expect(s.datos.registration_endpoint).toBe(`${ORIGEN}/register`);
    expect((await a.pedir('/')).datos.mcp).toBe(`${ORIGEN}/mcp`);
  });

  it('pide autorización a quien llama a /mcp sin acceso válido', async () => {
    const r = await a.pedir('/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'initialize' } });
    expect(r.estado).toBe(401);
    expect(r.r.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${ORIGEN}/.well-known/oauth-protected-resource"`);
    expect((await a.rpc('esto.no', 'ping')).estado).toBe(401);
    // Un pase de la app no sirve como acceso de un chat.
    expect((await a.rpc(await a.pase(cuenta()), 'ping')).estado).toBe(401);
  });

  it('solo registra chats conocidos o herramientas locales', async () => {
    for (const uri of ['https://evil.example/cb', 'http://claude.ai/cb', 'https://claude.ai.evil.example/cb', 'javascript:alert(1)']) {
      expect((await a.pedir('/register', { json: { client_name: 'X', redirect_uris: [uri] } })).estado).toBe(400);
    }
    expect((await a.pedir('/register', { json: { client_name: 'X', redirect_uris: [] } })).estado).toBe(400);
    for (const uri of [CLAUDE, 'https://chatgpt.com/connector_platform_oauth_redirect', 'http://localhost:3334/cb', 'http://127.0.0.1:9/cb']) {
      expect((await a.pedir('/register', { json: { client_name: 'X', redirect_uris: [uri] } })).estado).toBe(201);
    }
  });

  it('la app solo entra con una sesión de Frame válida', async () => {
    expect((await a.pedir('/app/pair', { method: 'POST' })).estado).toBe(401);
    expect((await a.pedir('/app/pair', { method: 'POST', token: 'otra-cosa-cualquiera-larga' })).estado).toBe(401);
    expect((await a.pedir('/app/status', { token: sesion('no-es-un-uuid') })).estado).toBe(401);
    const r = await a.pedir('/app/pair', { method: 'POST', token: sesion(cuenta()) });
    expect(r.estado).toBe(200);
    expect(r.datos.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(r.datos.expires).toBeGreaterThan(Date.now() + 9 * 60_000);
  });

  it('la página de autorización dice quién pide y adónde se vuelve', async () => {
    const reg = await a.pedir('/register', { json: { client_name: 'Claude <b>', redirect_uris: [CLAUDE] } });
    const q = new URLSearchParams({ client_id: reg.datos.client_id, redirect_uri: CLAUDE, response_type: 'code', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's' });
    const es = await a.pedir(`/authorize?${q}`, { headers: { 'accept-language': 'es-PE,es;q=0.9' } });
    expect(es.estado).toBe(200);
    expect(es.texto).toContain('Conectar con Frame');
    expect(es.texto).toContain('Claude &#60;b&#62;');
    expect(es.texto).toContain('<b>claude.ai</b>');
    expect(es.r.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect((await a.pedir(`/authorize?${q}`, { headers: { 'accept-language': 'de-DE' } })).texto).toContain('Connect to Frame');
    q.set('code_challenge_method', 'plain');
    expect((await a.pedir(`/authorize?${q}`)).estado).toBe(400);
    q.set('code_challenge_method', 'S256');
    q.set('redirect_uri', 'https://claude.ai/otra');
    expect((await a.pedir(`/authorize?${q}`)).estado).toBe(400);
  });

  it('conecta con el código de Frame; el código y la autorización valen una vez', async () => {
    const yo = cuenta();
    const par = await a.pedir('/app/pair', { method: 'POST', token: sesion(yo) });
    const cliente = (await a.pedir('/register', { json: { client_name: 'Claude', redirect_uris: [CLAUDE] } })).datos.client_id as string;
    const mal = await autorizar(cliente, 'ZZZZ-ZZZZ');
    expect(mal.estado).toBe(400);
    expect(mal.texto).toContain('no es válido');
    // Da igual mayúsculas o guion.
    const bien = await autorizar(cliente, String(par.datos.code).toLowerCase().replace('-', ''));
    expect(bien.estado).toBe(302);
    const vuelta = new URL(bien.r.headers.get('location')!);
    expect(vuelta.origin + vuelta.pathname).toBe(CLAUDE);
    expect(vuelta.searchParams.get('state')).toBe('e');
    expect((await autorizar(cliente, par.datos.code)).estado).toBe(400);

    const code = vuelta.searchParams.get('code')!;
    const malPkce = await a.pedir('/token', { form: { grant_type: 'authorization_code', code, redirect_uri: CLAUDE, client_id: cliente, code_verifier: 'otro-verificador-cualquiera-de-longitud-suficiente-123' } });
    expect(malPkce.datos.error).toBe('invalid_grant');
    // La autorización se gastó con el intento fallido.
    const otra = await a.pedir('/token', { form: { grant_type: 'authorization_code', code, redirect_uri: CLAUDE, client_id: cliente, code_verifier: VERIFICADOR } });
    expect(otra.datos.error).toBe('invalid_grant');

    const { acceso, refresco } = await a.conectar(yo);
    expect(acceso.split('.')).toHaveLength(2);
    expect(refresco.length).toBeGreaterThan(30);
  });

  it('veinte fallos anulan los códigos vigentes', async () => {
    const par = await a.pedir('/app/pair', { method: 'POST', token: sesion(cuenta()) });
    const cliente = (await a.pedir('/register', { json: { client_name: 'Claude', redirect_uris: [CLAUDE] } })).datos.client_id as string;
    for (let i = 0; i < 20; i++) await autorizar(cliente, `MALO-${String(i).padStart(4, '0')}`);
    expect((await autorizar(cliente, par.datos.code)).estado).toBe(400);
  });

  it('pedir códigos nuevos anula los más viejos', async () => {
    const yo = cuenta();
    const codigos: string[] = [];
    for (let i = 0; i < 4; i++) codigos.push((await a.pedir('/app/pair', { method: 'POST', token: sesion(yo) })).datos.code);
    const cliente = (await a.pedir('/register', { json: { client_name: 'Claude', redirect_uris: [CLAUDE] } })).datos.client_id as string;
    expect((await autorizar(cliente, codigos[0]!)).estado).toBe(400);
    expect((await autorizar(cliente, codigos[3]!)).estado).toBe(302);
  });

  it('refresca, y el refresco anterior vale un momento', async () => {
    const yo = cuenta();
    const { refresco, cliente } = await a.conectar(yo);
    const r1 = await a.pedir('/token', { form: { grant_type: 'refresh_token', refresh_token: refresco, client_id: cliente } });
    expect(r1.estado).toBe(200);
    expect((await a.rpc(r1.datos.access_token, 'ping')).datos.result).toEqual({});
    const r2 = await a.pedir('/token', { form: { grant_type: 'refresh_token', refresh_token: refresco, client_id: cliente } });
    expect(r2.estado).toBe(200);
    const otro = (await a.pedir('/register', { json: { client_name: 'Otro', redirect_uris: [CLAUDE] } })).datos.client_id as string;
    expect((await a.pedir('/token', { form: { grant_type: 'refresh_token', refresh_token: refresco, client_id: otro } })).datos.error).toBe('invalid_grant');
  });
});

describe('relé', () => {
  it('sin Frame abierta: se conecta, ofrece el estado y explica qué falta', async () => {
    const { acceso } = await a.conectar(cuenta());
    const init = await a.rpc(acceso, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-ai' } });
    expect(init.datos.result.protocolVersion).toBe('2025-06-18');
    expect(init.datos.result.serverInfo.name).toBe('frame');
    expect((await a.rpc(acceso, 'initialize', { protocolVersion: '1999-01-01' })).datos.result.protocolVersion).toBe('2025-11-25');
    const lista = await a.rpc(acceso, 'tools/list');
    expect(lista.datos.result.tools.map((t: { name: string }) => t.name)).toEqual(['estado_de_frame']);
    const estado = await a.mcp(acceso, 'estado_de_frame');
    expect(estado.error).toBe(true);
    expect(estado.text).toContain('no está abierta');
  });

  it('pasa cada llamada a la Frame abierta y devuelve su respuesta', async () => {
    const yo = cuenta();
    const f = await a.frame(yo);
    const { acceso } = await a.conectar(yo, { nombre: 'Claude' });
    const lista = await a.rpc(acceso, 'tools/list');
    expect(lista.datos.result.tools.map((t: { name: string }) => t.name)).toEqual(['listar_tareas', 'crear_tarea']);
    const init = await a.rpc(acceso, 'initialize', { protocolVersion: '2025-11-25' });
    expect(init.datos.result.instructions).toContain('Frame es la app de estudio.');
    expect(init.datos.result.instructions).toContain('a través de la nube');
    expect(init.datos.result.serverInfo.version).toBe('1.8.0');

    const hecho = await a.mcp(acceso, 'crear_tarea', { titulo: 'Leer el capítulo 3' });
    expect(hecho).toMatchObject({ error: false, text: 'hecho: crear_tarea {"titulo":"Leer el capítulo 3"}' });
    expect(f.llamadas[0]).toMatchObject({ tool: 'crear_tarea', client: 'Claude', args: { titulo: 'Leer el capítulo 3' } });

    f.respuesta = () => ({ ok: false, error: 'No existe esa asignatura.' });
    expect(await a.mcp(acceso, 'listar_tareas')).toMatchObject({ error: true, text: 'No existe esa asignatura.' });
    f.respuesta = () => ({ ok: true, text: 'x'.repeat(400_000) });
    expect((await a.mcp(acceso, 'listar_tareas')).text.length).toBe(300_000);

    expect((await a.rpc(acceso, 'tools/call', { name: 'borrar_todo', arguments: {} })).datos.error.code).toBe(-32602);
    expect((await a.rpc(acceso, 'tools/call', { name: 'crear_tarea', arguments: [1] })).datos.error.code).toBe(-32602);
    expect((await a.rpc(acceso, 'metodo/raro')).datos.error.code).toBe(-32601);
    expect((await a.rpc(acceso, 'notifications/initialized', undefined, null)).estado).toBe(202);
    const lote = await a.pedir('/mcp', { token: acceso, json: [{ jsonrpc: '2.0', id: 'a', method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 'b', method: 'tools/list' }] });
    expect(lote.datos.map((m: { id: string }) => m.id)).toEqual(['a', 'b']);
    expect((await a.pedir('/mcp', { token: acceso, body: '{roto', method: 'POST' })).datos.error.code).toBe(-32700);
    expect((await a.mcp(acceso, 'estado_de_frame')).text).toBe('Frame está abierta y lista (Laptop).');
    expect((await a.pedir('/mcp', { token: acceso, method: 'GET' })).estado).toBe(405);

    // El chat de otra cuenta no llega a esta Frame.
    const ajeno = await a.conectar(cuenta());
    expect((await a.mcp(ajeno.acceso, 'estado_de_frame')).error).toBe(true);
    expect(f.llamadas).toHaveLength(3);
    f.cerrar();
  });

  it('responde la Frame más reciente; la que vuelve a primer plano pasa al frente', async () => {
    const yo = cuenta();
    const laptop = await a.frame(yo, 'Laptop');
    const celular = await a.frame(yo, 'Celular');
    const { acceso } = await a.conectar(yo);
    await a.mcp(acceso, 'listar_tareas');
    expect([laptop.llamadas.length, celular.llamadas.length]).toEqual([0, 1]);
    laptop.enviar({ t: 'focus' });
    await new Promise((r) => setTimeout(r, 50));
    await a.mcp(acceso, 'listar_tareas');
    expect([laptop.llamadas.length, celular.llamadas.length]).toEqual([1, 1]);
    const estado = await a.pedir('/app/status', { token: sesion(yo) });
    expect(estado.datos.devices.map((d: { name: string }) => d.name)).toEqual(['Laptop', 'Celular']);
    expect(estado.datos.chats).toEqual([{ name: 'Claude', since: expect.any(Number), latest: expect.any(Number) }]);
    expect(estado.datos.devices[0].id).toBe('id-Laptop');
    laptop.cerrar();
    celular.cerrar();
  });

  it('si la conexión elegida está muerta, lo que solo lee prueba con otra y lo que cambia no se repite', async () => {
    const yo = cuenta();
    const viva = await a.frame(yo, 'Laptop');
    const muerta = await a.frame(yo, 'Celular');
    muerta.modo = 'calla';
    const { acceso } = await a.conectar(yo);
    const leida = await a.mcp(acceso, 'listar_tareas');
    expect(leida.error).toBe(false);
    expect([viva.llamadas.length, muerta.llamadas.length]).toEqual([1, 1]);
    await esperar(() => muerta.cerrada !== null);

    const otra = await a.frame(yo, 'Tablet');
    otra.modo = 'calla';
    const cambio = await a.mcp(acceso, 'crear_tarea', { titulo: 'Repasar' });
    expect(cambio.error).toBe(true);
    expect(cambio.text).toContain('antes de repetirlo');
    expect(viva.llamadas).toHaveLength(1);
    // La siguiente ya va a la que sigue viva.
    expect((await a.mcp(acceso, 'crear_tarea', { titulo: 'Repasar' })).error).toBe(false);
    expect(viva.llamadas).toHaveLength(2);
    viva.cerrar();
  });

  it('si Frame se cierra a mitad de una llamada, lo dice', async () => {
    const yo = cuenta();
    const f = await a.frame(yo);
    f.modo = 'acusa';
    const { acceso } = await a.conectar(yo);
    const pendiente = a.mcp(acceso, 'crear_tarea', { titulo: 'Algo' });
    await esperar(() => f.llamadas.length === 1);
    f.cerrar();
    const r = await pendiente;
    expect(r.error).toBe(true);
    expect(r.text).toContain('Se perdió la conexión');
    expect((await a.mcp(acceso, 'listar_tareas')).text).toContain('no está abierta');
  });

  it('retirar los permisos corta los accesos vivos y avisa a la app', async () => {
    const yo = cuenta();
    const f = await a.frame(yo);
    const { acceso, refresco, cliente } = await a.conectar(yo);
    expect((await a.rpc(acceso, 'ping')).estado).toBe(200);
    expect((await a.pedir('/app/revoke', { method: 'POST', token: sesion(yo) })).datos).toEqual({ ok: true });
    expect((await a.rpc(acceso, 'ping')).estado).toBe(401);
    expect((await a.pedir('/token', { form: { grant_type: 'refresh_token', refresh_token: refresco, client_id: cliente } })).datos.error).toBe('invalid_grant');
    await esperar(() => f.mensajes.some((m) => m.t === 'revoked'));
    expect((await a.pedir('/app/status', { token: sesion(yo) })).datos.chats).toEqual([]);
    // Se puede volver a conectar con un código nuevo.
    const nuevo = await a.conectar(yo);
    expect((await a.mcp(nuevo.acceso, 'listar_tareas')).error).toBe(false);
    f.cerrar();
  });

  it('el pase del WebSocket vale una vez, es de su cuenta y no se falsifica', async () => {
    const yo = cuenta();
    const pase = await a.pase(yo);
    expect((await a.socket(pase)).estado).toBe(101);
    expect((await a.socket(pase)).estado).toBe(401);
    const [cuerpo, firma] = pase.split('.');
    const otro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(cuerpo!, 'base64url').toString()), o: cuenta(), n: 'nuevo' })).toString('base64url');
    expect((await a.socket(`${otro}.${firma}`)).estado).toBe(401);
    const { acceso } = await a.conectar(yo);
    expect((await a.socket(acceso)).estado).toBe(401);
    expect((await a.pedir('/app/socket?ticket=x')).estado).toBe(426);
  });

  it('no acepta un catálogo inválido ni mensajes enormes', async () => {
    const yo = cuenta();
    const { acceso } = await a.conectar(yo);
    const f = await a.frame(yo, 'Laptop', [{ name: 'mal nombre', inputSchema: {} }, { name: 'sin_esquema' }]);
    expect((await a.rpc(acceso, 'tools/list')).datos.result.tools.map((t: { name: string }) => t.name)).toEqual(['estado_de_frame']);
    expect((await a.mcp(acceso, 'estado_de_frame')).error).toBe(true);
    f.enviar('z'.repeat(2 * 1024 * 1024 + 10));
    await esperar(() => f.cerrada !== null);
  });

  it('pone freno a las ráfagas', async () => {
    const yo = cuenta();
    const f = await a.frame(yo);
    const { acceso } = await a.conectar(yo);
    // 60 de golpe y luego una por segundo: en una ráfaga de 80, las últimas se frenan.
    const textos: string[] = [];
    for (let i = 0; i < 80; i++) textos.push((await a.mcp(acceso, 'listar_tareas')).text);
    expect(textos.slice(0, 60).every((t) => t.startsWith('hecho'))).toBe(true);
    expect(textos.filter((t) => t.includes('Demasiadas llamadas')).length).toBeGreaterThanOrEqual(10);
    f.cerrar();
  });

  it('la limpieza diaria quita lo caducado y los registros sin usar', async () => {
    const viejo = Date.now() - 2 * 86_400_000;
    await a.sql("INSERT INTO clients(id, name, redirects, created, used) VALUES('sin-usar', 'X', '[]', ?, 0), ('usado', 'Y', '[]', ?, 1)", viejo, viejo);
    await a.sql("INSERT INTO pairings(code, owner, expires) VALUES('viejo', 'o', ?)", viejo);
    await a.sql("INSERT INTO sessions(token, client, owner, expires, since) VALUES('vieja', 'usado', 'o', ?, ?)", viejo, viejo);
    await a.cron();
    expect(await a.sql("SELECT id FROM clients WHERE id IN ('sin-usar', 'usado')")).toEqual([{ id: 'usado' }]);
    expect(await a.sql("SELECT * FROM pairings WHERE code='viejo'")).toEqual([]);
    expect(await a.sql("SELECT * FROM sessions WHERE token='vieja'")).toEqual([]);
  });
});

describe('lector de horarios', () => {
  // «/9j/4AAQSkZJRg» es el comienzo de un JPEG (FF D8 FF E0 … JFIF) en base64.
  const foto = (marca = '') => ({ image: `/9j/4AAQSkZJRg${marca}${'A'.repeat(160)}`, mime: 'image/jpeg' });
  const hoy = () => new Date().toISOString().slice(0, 10);

  it('solo con sesión de Frame y una imagen válida', async () => {
    expect((await a.pedir('/app/horario', { json: foto() })).estado).toBe(401);
    const yo = sesion(cuenta());
    expect((await a.pedir('/app/horario', { token: yo, json: { image: 'corta', mime: 'image/jpeg' } })).datos).toEqual({ error: 'image' });
    expect((await a.pedir('/app/horario', { token: yo, json: { ...foto(), mime: 'image/gif' } })).estado).toBe(400);
    expect((await a.pedir('/app/horario', { token: yo, json: { image: `<${'A'.repeat(160)}`, mime: 'image/jpeg' } })).estado).toBe(400);
    // Base64 válido, pero no es un JPEG (ni un PNG que dice ser JPEG).
    expect((await a.pedir('/app/horario', { token: yo, json: { image: 'A'.repeat(160), mime: 'image/jpeg' } })).datos).toEqual({ error: 'image' });
    expect((await a.pedir('/app/horario', { token: yo, json: { image: `iVBORw0KGgo${'A'.repeat(160)}`, mime: 'image/jpeg' } })).estado).toBe(400);
    expect((await a.pedir('/app/horario', { token: yo, json: { image: `iVBORw0KGgo${'A'.repeat(160)}`, mime: 'image/png' } })).estado).toBe(200);
  });

  it('devuelve las clases sin los recreos y sin guardar la foto', async () => {
    const yo = cuenta();
    const r = await a.pedir('/app/horario', { token: sesion(yo), json: foto() });
    expect(r.estado).toBe(200);
    expect(r.datos.classes).toEqual([
      { day: 1, start: '08:00', end: '09:30', subject: 'Matemática', room: 'A-1' },
      { day: 2, start: '08:00', end: '09:30', subject: 'Historia', teacher: 'Prof. Ríos' },
    ]);
    expect(await a.sql('SELECT owner, day, n FROM lecturas WHERE owner=?', yo)).toEqual([{ owner: yo, day: hoy(), n: 1 }]);
  });

  it('cada cuenta tiene un cupo diario; solo la cuota agotada de Cloudflare no lo gasta', async () => {
    const yo = cuenta();
    expect((await a.pedir('/app/horario', { token: sesion(yo), json: foto('Y3Vwbw') })).datos).toEqual({ error: 'daily' });
    expect(await a.sql('SELECT n FROM lecturas WHERE owner=?', yo)).toEqual([{ n: 0 }]);
    // El modelo trabajó aunque no saliera nada legible: cuenta (si no, sería gratis abusar).
    expect((await a.pedir('/app/horario', { token: sesion(yo), json: foto('bXVkbw') })).datos).toEqual({ error: 'busy' });
    expect(await a.sql('SELECT n FROM lecturas WHERE owner=?', yo)).toEqual([{ n: 1 }]);
    for (let i = 0; i < 5; i++) expect((await a.pedir('/app/horario', { token: sesion(yo), json: foto() })).estado).toBe(200);
    const pasado = await a.pedir('/app/horario', { token: sesion(yo), json: foto() });
    expect(pasado.estado).toBe(429);
    expect(pasado.datos).toEqual({ error: 'quota', limit: 6 });
    expect((await a.pedir('/app/horario', { token: sesion(cuenta()), json: foto() })).estado).toBe(200);
  });

  it('lee con Qwen; si Qwen falla o el gasto del día se acerca al tope, con Gemma', async () => {
    const gastado = async () => ((await a.sql('SELECT n FROM neuronas WHERE day=?', hoy())) as { n: number }[])[0]?.n ?? 0;
    await a.sql('INSERT OR REPLACE INTO neuronas(day, n) VALUES(?, 0)', hoy());
    expect((await a.pedir('/app/horario', { token: sesion(cuenta()), json: foto() })).estado).toBe(200);
    expect(await gastado()).toBe(400);
    // Qwen caído: responde Gemma con las mismas clases.
    const r = await a.pedir('/app/horario', { token: sesion(cuenta()), json: foto('cXdlbg') });
    expect(r.datos.classes).toHaveLength(2);
    expect(await gastado()).toBe(425);
    // Cerca del tope de Qwen (8000 menos una lectura grande), solo Gemma.
    await a.sql('UPDATE neuronas SET n=7100 WHERE day=?', hoy());
    expect((await a.pedir('/app/horario', { token: sesion(cuenta()), json: foto() })).estado).toBe(200);
    expect(await gastado()).toBe(7125);
  });

  it('la limpieza diaria olvida las cuentas de días pasados', async () => {
    await a.sql("INSERT INTO lecturas(owner, day, n) VALUES('alguien', '2020-01-01', 3)");
    await a.sql("INSERT INTO neuronas(day, n) VALUES('2020-01-01', 50)");
    await a.cron();
    expect(await a.sql("SELECT * FROM lecturas WHERE owner='alguien'")).toEqual([]);
    expect(await a.sql("SELECT * FROM neuronas WHERE day='2020-01-01'")).toEqual([]);
  });
});

describe('traducción de letras', () => {
  const hoy = () => new Date().toISOString().slice(0, 10);
  const letra = (lineas = ['Hello darkness, my old friend', "I've come to talk with you again"], to = 'es') => ({ lines: lineas, to });

  it('solo con sesión de Frame y una letra válida', async () => {
    expect((await a.pedir('/app/traducir', { json: letra() })).estado).toBe(401);
    const yo = sesion(cuenta());
    for (const mala of [{}, letra([]), letra(['hola'], 'xx'), letra(['']), letra(Array(151).fill('la')), letra(['a'.repeat(301)]), { lines: [3], to: 'es' }]) {
      const r = await a.pedir('/app/traducir', { token: yo, json: mala });
      expect(r.estado).toBe(400);
      expect(r.datos).toEqual({ error: 'lines' });
    }
  });

  it('devuelve una línea por línea, sin números, y solo cuenta la traducción', async () => {
    const yo = cuenta();
    await a.sql('INSERT OR REPLACE INTO neuronas(day, n) VALUES(?, 0)', hoy());
    const r = await a.pedir('/app/traducir', { token: sesion(yo), json: letra() });
    expect(r.estado).toBe(200);
    expect(r.datos).toEqual({ from: 'en', lines: ['[es] Hello darkness, my old friend', "[es] I've come to talk with you again"] });
    expect(await a.sql('SELECT n FROM traducciones WHERE owner=?', yo)).toEqual([{ n: 1 }]);
    expect(await a.sql('SELECT n FROM neuronas WHERE day=?', hoy())).toEqual([{ n: 12 }]);
  });

  it('cada cuenta tiene un cupo diario; la cuota agotada de Cloudflare no lo gasta', async () => {
    const yo = cuenta();
    expect((await a.pedir('/app/traducir', { token: sesion(yo), json: letra(['sin-ia']) })).datos).toEqual({ error: 'daily' });
    expect(await a.sql('SELECT n FROM traducciones WHERE owner=?', yo)).toEqual([{ n: 0 }]);
    // El modelo trabajó aunque devolviera otro número de líneas: cuenta, y se
    // dice que esa letra no salió (repetir el pedido daría lo mismo).
    const rota = await a.pedir('/app/traducir', { token: sesion(yo), json: letra(['rota', 'dos']) });
    expect(rota.estado).toBe(422);
    expect(rota.datos).toEqual({ error: 'unusable' });
    for (let i = 0; i < 29; i++) expect((await a.pedir('/app/traducir', { token: sesion(yo), json: letra() })).estado).toBe(200);
    const pasado = await a.pedir('/app/traducir', { token: sesion(yo), json: letra() });
    expect(pasado.estado).toBe(429);
    expect(pasado.datos).toEqual({ error: 'quota', limit: 30 });
    expect((await a.pedir('/app/traducir', { token: sesion(cuenta()), json: letra() })).estado).toBe(200);
  });

  it('no traduce si el gasto del día deja sin margen a los horarios (que van primero)', async () => {
    const yo = cuenta();
    // El tope queda por debajo de donde Qwen deja de leer horarios (7000): con sitio para varias lecturas suyas.
    await a.sql('INSERT OR REPLACE INTO neuronas(day, n) VALUES(?, 5000)', hoy());
    const r = await a.pedir('/app/traducir', { token: sesion(yo), json: letra() });
    expect(r.estado).toBe(429);
    expect(r.datos).toEqual({ error: 'daily' });
    expect(await a.sql('SELECT n FROM traducciones WHERE owner=?', yo)).toEqual([]);
    await a.sql('UPDATE neuronas SET n=4999 WHERE day=?', hoy());
    expect((await a.pedir('/app/traducir', { token: sesion(yo), json: letra() })).estado).toBe(200);
    await a.sql('UPDATE neuronas SET n=0 WHERE day=?', hoy());
  });

  it('una letra larga se traduce por partes y vuelve entera y en orden', async () => {
    const yo = cuenta();
    await a.sql('INSERT OR REPLACE INTO neuronas(day, n) VALUES(?, 0)', hoy());
    // 150 líneas (lo más que admite un pedido): tres partes, de 60, 60 y 30.
    const lineas = Array.from({ length: 150 }, (_, i) => `verso ${String(i + 1).padStart(3, '0')} de una letra bastante larga`);
    const r = await a.pedir('/app/traducir', { token: sesion(yo), json: letra(lineas) });
    expect(r.estado).toBe(200);
    expect(r.datos).toEqual({ from: 'en', lines: lineas.map((l) => `[es] ${l}`) });
    expect(await a.sql('SELECT n FROM traducciones WHERE owner=?', yo)).toEqual([{ n: 1 }]);
    expect(await a.sql('SELECT n FROM neuronas WHERE day=?', hoy())).toEqual([{ n: 36 }]);
    await a.sql('UPDATE neuronas SET n=0 WHERE day=?', hoy());
  });

  it('de una respuesta cortada a medias se aprovechan las líneas que llegaron enteras', async () => {
    const yo = cuenta();
    const lineas = ['cortada uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
    const r = await a.pedir('/app/traducir', { token: sesion(yo), json: letra(lineas) });
    expect(r.estado).toBe(200);
    // (La IA de mentira las devuelve al revés: la que se pierde con el corte es la primera.)
    expect(r.datos).toEqual({ from: 'en', lines: ['', '[es] dos', '[es] tres', '[es] cuatro', '[es] cinco', '[es] seis'] });
  });

  it('la limpieza diaria olvida las cuentas de días pasados', async () => {
    await a.sql("INSERT INTO traducciones(owner, day, n) VALUES('alguien', '2020-01-01', 3)");
    await a.cron();
    expect(await a.sql("SELECT * FROM traducciones WHERE owner='alguien'")).toEqual([]);
  });
});

describe('AK Lore: la Biblioteca', () => {
  const fila = (id: string, drive: string, extra: Partial<Record<string, unknown>> = {}) =>
    a.sql(
      'INSERT OR REPLACE INTO lore (id, drive_id, title, subject, section, kind, component, lang, year, size, pages, summary, format, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      drive,
      extra.title ?? `Guía ${id}`,
      extra.subject ?? 'Historia',
      'Asignaturas NS',
      'Guía',
      'General',
      'es',
      2025,
      1000,
      12,
      'Resumen.',
      'pdf',
      '2026-11-09T00:00:00.000Z',
    );
  const hoy = () => new Date().toISOString().slice(0, 10);

  it('solo para cuentas del colegio con el correo comprobado', async () => {
    await fila('guia-historia', 'drive-1');
    expect((await a.pedir('/app/lore')).estado).toBe(401);
    expect((await a.pedir('/app/lore', { token: sesion(LUIS) })).datos).toEqual({ error: 'school' });
    expect((await a.pedir('/app/lore', { token: sesion(SIN_COMPROBAR) })).estado).toBe(403);
    expect((await a.pedir('/app/lore/archivo/guia-historia', { token: sesion(LUIS) })).estado).toBe(403);
    const r = await a.pedir('/app/lore', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(200);
    expect(r.datos.format).toBe(1);
    const guia = r.datos.guides.find((g: { id: string }) => g.id === 'guia-historia');
    expect(guia).toMatchObject({ title: 'Guía guia-historia', subject: 'Historia', section: 'Asignaturas NS', kind: 'Guía', size: 1000, format: 'pdf' });
    expect(guia.drive_id).toBeUndefined();
  });

  it('pasa el archivo de Drive sin guardarlo y lo cuenta', async () => {
    await fila('guia-fisica', 'drive-2', { title: 'Guía de Física' });
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    const r = await a.pedir('/app/lore/archivo/guia-fisica', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(200);
    expect(r.texto).toBe(pdfDe('drive-2'));
    expect(r.r.headers.get('content-type')).toBe('application/pdf');
    expect(r.r.headers.get('content-disposition')).toContain(encodeURIComponent('Guía de Física.pdf'));
    expect(await a.sql('SELECT n, bytes FROM lore_descargas WHERE owner=? AND day=?', ALUMNA, hoy())).toEqual([{ n: 1, bytes: 1000 }]);
  });

  it('un archivo que falta o un tope agotado no cuentan', async () => {
    await fila('guia-perdida', 'falta');
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    expect((await a.pedir('/app/lore/archivo/guia-perdida', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/lore/archivo/no-existe', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/lore/archivo/..%2Fx', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect(await a.sql('SELECT n FROM lore_descargas WHERE owner=?', ALUMNA)).toEqual([{ n: 0 }]);
    await a.sql('UPDATE lore_descargas SET n=300 WHERE owner=?', ALUMNA);
    const r = await a.pedir('/app/lore/archivo/guia-historia', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(429);
    expect(r.datos).toEqual({ error: 'quota', files: 300 });
    expect(await a.sql('SELECT n FROM lore_descargas WHERE owner=?', ALUMNA)).toEqual([{ n: 300 }]);
  });

  it('la limpieza diaria olvida las descargas de días pasados', async () => {
    await a.sql("INSERT INTO lore_descargas(owner, day, n, bytes) VALUES('alguien', '2020-01-01', 3, 10)");
    await a.cron();
    expect(await a.sql("SELECT * FROM lore_descargas WHERE owner='alguien'")).toEqual([]);
  });
});
