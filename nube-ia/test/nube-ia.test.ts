// Frame · IA en la nube: OAuth con el código de Frame, MCP y el relé a las
// Frame abiertas (respaldo entre equipos, cortes, permisos retirados, frenos).
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { firmarJwt } from '../src/biblioteca';
import { ALUMNA, type Arnes, CLAUDE, COLEGIO, conCorreo, crearArnes, DRIVE, ENVIADOS, esperar, LUIS, ORIGEN, pdfDe, PREGUNTAS, sesion, SIN_COMPROBAR, VERIFICADOR } from './ayuda';

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

  it('«no vale» solo si Supabase lo dice; si no se le pudo preguntar, 503 y sin tocar la sesión', async () => {
    const id = cuenta();
    // Auth dice que esa sesión ya no existe: 401, y no se insiste.
    const cerrada = await a.pedir('/app/status', { token: `sesion-cerrada-${id}` });
    expect([cerrada.estado, cerrada.datos.error]).toEqual([401, 'unauthorized']);
    expect(PREGUNTAS[`sesion-cerrada-${id}`]).toBe(1);
    // Supabase caído, con el tope de peticiones lleno, sin red o con la pasarela fallando: no es un «no».
    for (const caso of ['supabase-caido-', 'supabase-limite-', 'supabase-sin-red-', 'supabase-pasarela-']) {
      const r = await a.pedir('/app/status', { token: `${caso}${id}` });
      expect([caso, r.estado, r.datos.error]).toEqual([caso, 503, 'auth-unavailable']);
      // Se preguntó dos veces antes de rendirse.
      expect([caso, PREGUNTAS[`${caso}${id}`]]).toEqual([caso, 2]);
    }
    // Un tropiezo suelto ni se nota: la segunda pregunta llega.
    const parpadeo = await a.pedir('/app/status', { token: `supabase-parpadea-${id}` });
    expect(parpadeo.estado).toBe(200);
    expect(PREGUNTAS[`supabase-parpadea-${id}`]).toBe(2);
    // Y lo que no se pudo comprobar no se recuerda: en cuanto Supabase vuelve, entra.
    expect((await a.pedir('/app/status', { token: sesion(id) })).estado).toBe(200);
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

  it('con las asignaturas de Frame, dice a cuál corresponde cada nombre del horario', async () => {
    const gastado = async () => ((await a.sql('SELECT n FROM neuronas WHERE day=?', hoy())) as { n: number }[])[0]?.n ?? 0;
    // Sin asignaturas no hay vínculos ni se llama otra vez al modelo.
    const antes = await gastado();
    expect((await a.pedir('/app/horario', { token: sesion(cuenta()), json: foto() })).datos.links).toEqual({});
    expect((await gastado()) - antes).toBe(400);
    // «Historia» se llama igual: no pasa por el modelo. «Matemática» sí, y los índices que no existen se descartan.
    const r = await a.pedir('/app/horario', { token: sesion(cuenta()), json: { ...foto(), subjects: ['Matemáticas NS', '  historia ', 'Física', 'HISTORIA', 7, ''] } });
    expect(r.datos.classes).toHaveLength(2);
    expect(r.datos.links).toEqual({ Matemática: 'Matemáticas NS', Historia: 'historia' });
    expect((await gastado()) - antes).toBe(803);
    // Si el paso del vínculo falla, las clases vuelven igual, con lo que se llama igual.
    const sin = await a.pedir('/app/horario', { token: sesion(cuenta()), json: { ...foto(), subjects: ['Historia', 'sin-vinculo'] } });
    expect(sin.estado).toBe(200);
    expect(sin.datos.classes).toHaveLength(2);
    expect(sin.datos.links).toEqual({ Historia: 'Historia' });
    // Todas se llaman igual: tampoco se llama al modelo.
    const medio = await gastado();
    expect((await a.pedir('/app/horario', { token: sesion(cuenta()), json: { ...foto(), subjects: ['Historia', 'matematica'] } })).datos.links).toEqual({ Matemática: 'matematica', Historia: 'Historia' });
    expect((await gastado()) - medio).toBe(400);
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

  it('los destacados traen su vista previa, que no gasta el tope de descargas', async () => {
    await fila('guia-con-vista', 'drive-9');
    await a.sql("INSERT OR REPLACE INTO lore_vistas(id, mime, datos) VALUES('guia-con-vista', 'image/jpeg', X'FFD8FFE000104A464946')");
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    const indice = (await a.pedir('/app/lore', { token: sesion(ALUMNA) })).datos.guides as { id: string; preview?: boolean }[];
    expect(indice.find((g) => g.id === 'guia-con-vista')?.preview).toBe(true);
    expect(indice.find((g) => g.id === 'guia-historia')?.preview).toBeUndefined();
    const r = await a.pedir('/app/lore/vista/guia-con-vista', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(200);
    expect(r.r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.r.headers.get('cache-control')).toContain('private');
    expect(r.texto.length).toBeGreaterThan(4);
    expect(await a.sql('SELECT n FROM lore_descargas WHERE owner=?', ALUMNA)).toEqual([]);
    expect((await a.pedir('/app/lore/vista/guia-historia', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/lore/vista/..%2Fx', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/lore/vista/guia-con-vista', { token: sesion(LUIS) })).estado).toBe(403);
    expect((await a.pedir('/app/lore/vista/guia-con-vista')).estado).toBe(401);
  });

  it('la limpieza diaria olvida las descargas de días pasados', async () => {
    await a.sql("INSERT INTO lore_descargas(owner, day, n, bytes) VALUES('alguien', '2020-01-01', 3, 10)");
    await a.cron();
    expect(await a.sql("SELECT * FROM lore_descargas WHERE owner='alguien'")).toEqual([]);
  });

  describe('activarla con el correo del colegio', () => {
    const otra = () => conCorreo(cuenta(), `persona-${Math.random().toString(36).slice(2, 8)}@gmail.prueba`);
    const ultimo = (to: string) => [...ENVIADOS].reverse().find((carta) => carta.to === to)!;
    const pedirCodigo = (yo: string, email: string) => a.pedir('/app/lore/codigo', { token: sesion(yo), json: { email } });
    const activar = (yo: string, code: unknown) => a.pedir('/app/lore/activar', { token: sesion(yo), json: { code } });

    it('con el código que llega al correo institucional, la cuenta abre la Biblioteca entre con el correo que entre', async () => {
      const yo = otra();
      const correo = `alumno-uno@${COLEGIO}`;
      expect((await a.pedir('/app/lore/acceso', { token: sesion(yo) })).datos).toEqual({ active: false });
      expect((await a.pedir('/app/lore', { token: sesion(yo) })).estado).toBe(403);
      // Solo correos del colegio (cuenta el dominio tras la última arroba).
      // (Con «+» sería el mismo buzón con otra huella: tampoco.)
      for (const malo of ['alguien@gmail.prueba', `x@${COLEGIO}@otro.prueba`, `sin-arroba.${COLEGIO}`, `alumno-uno+2@${COLEGIO}`, '', 7]) {
        expect((await a.pedir('/app/lore/codigo', { token: sesion(yo), json: { email: malo } })).datos).toEqual({ error: 'email' });
      }
      const pedido = await pedirCodigo(yo, `  Alumno-Uno@${COLEGIO.toUpperCase()} `);
      expect(pedido.datos).toEqual({ ok: true, minutes: 10 });
      const carta = ultimo(correo);
      expect(carta.code).toMatch(/^\d{6}$/);
      expect(carta.minutes).toBe(10);
      // Ni el correo ni el código quedan legibles en la base.
      const guardado = JSON.stringify(await a.sql('SELECT * FROM lore_codigos WHERE owner=?', yo));
      expect(guardado).not.toContain(carta.code);
      expect(guardado).not.toContain('alumno-uno');
      const errado = carta.code === '000000' ? '000001' : '000000';
      expect((await activar(yo, errado)).datos).toEqual({ error: 'code', left: 4 });
      const hecho = await activar(yo, ` ${carta.code.slice(0, 3)} ${carta.code.slice(3)} `);
      expect(hecho.estado).toBe(200);
      expect(hecho.datos.active).toBe(true);
      expect(hecho.datos.until).toBeGreaterThan(Date.now() + 364 * 86_400_000);
      expect((await a.pedir('/app/lore/acceso', { token: sesion(yo) })).datos).toEqual({ active: true, until: hecho.datos.until });
      expect((await a.pedir('/app/lore', { token: sesion(yo) })).estado).toBe(200);
      expect((await a.pedir('/app/lore/archivo/guia-historia', { token: sesion(yo) })).estado).toBe(200);
      expect(JSON.stringify(await a.sql('SELECT * FROM lore_accesos WHERE owner=?', yo))).not.toContain('alumno-uno');
      // El código vale una vez.
      expect((await activar(yo, carta.code)).datos).toEqual({ error: 'expired' });
      // La cuenta que entra con su correo del colegio no necesita código.
      expect((await a.pedir('/app/lore/acceso', { token: sesion(ALUMNA) })).datos).toEqual({ active: true });
    });

    it('un invitado no puede pedirla, y sin remitente lo dice', async () => {
      const invitado = cuenta();
      expect((await pedirCodigo(invitado, `alumno@${COLEGIO}`)).datos).toEqual({ error: 'account' });
      expect((await activar(invitado, '123456')).estado).toBe(403);
      expect((await pedirCodigo(SIN_COMPROBAR, `alumno@${COLEGIO}`)).estado).toBe(403);
    });

    it('cinco códigos errados lo anulan, y uno caducado no vale', async () => {
      const yo = otra();
      const correo = `alumno-dos@${COLEGIO}`;
      await pedirCodigo(yo, correo);
      const bueno = ultimo(correo).code;
      const errado = bueno === '111111' ? '222222' : '111111';
      for (let i = 0; i < 4; i++) expect((await activar(yo, errado)).datos).toEqual({ error: 'code', left: 4 - i });
      expect((await activar(yo, errado)).datos).toEqual({ error: 'attempts' });
      expect((await activar(yo, bueno)).estado).toBe(429);
      // Pedir otro lo reemplaza y devuelve los intentos.
      await pedirCodigo(yo, correo);
      const nuevo = ultimo(correo).code;
      await a.sql('UPDATE lore_codigos SET expires=? WHERE owner=?', Date.now() - 1000, yo);
      expect((await activar(yo, nuevo)).datos).toEqual({ error: 'expired' });
      expect(await a.sql('SELECT * FROM lore_codigos WHERE owner=?', yo)).toEqual([]);
    });

    it('frena los envíos por cuenta y por correo, y cada correo activa dos cuentas como mucho', async () => {
      const yo = otra();
      const correo = `alumno-tres@${COLEGIO}`;
      for (let i = 0; i < 3; i++) expect((await pedirCodigo(yo, correo)).estado).toBe(200);
      expect((await pedirCodigo(yo, correo)).datos).toEqual({ error: 'wait' });
      // Otra cuenta, mismo correo: el freno del correo también cuenta.
      const segunda = otra();
      expect((await pedirCodigo(segunda, correo)).datos).toEqual({ error: 'wait' });
      // Un envío que no sale no deja código ni gasta el freno.
      const tercera = otra();
      expect((await pedirCodigo(tercera, `rebota@${COLEGIO}`)).datos).toEqual({ error: 'mail' });
      expect(await a.sql('SELECT * FROM lore_codigos WHERE owner=?', tercera)).toEqual([]);
      expect(await a.sql('SELECT n FROM lore_envios WHERE clave=?', `o:${tercera}`)).toEqual([{ n: 0 }]);
      expect(await a.sql('SELECT n FROM lore_envios WHERE clave=?', `o:${yo}`)).toEqual([{ n: 3 }]);
      // Tope de todo Frame en el día.
      await a.sql("INSERT OR REPLACE INTO lore_envios(clave, tramo, n) VALUES('todos', ?, 90)", hoy());
      expect((await pedirCodigo(tercera, `alumno-cuatro@${COLEGIO}`)).datos).toEqual({ error: 'daily' });
      await a.sql("DELETE FROM lore_envios WHERE clave='todos'");
      // Diez pedidos a la vez con códigos errados gastan cinco intentos, no más; y el bueno ya no entra.
      const prisa = otra();
      const apurado = `alumno-seis@${COLEGIO}`;
      await pedirCodigo(prisa, apurado);
      const bueno = ultimo(apurado).code;
      const otros = Array.from({ length: 10 }, (_, i) => String((Number(bueno) + i + 1) % 1_000_000).padStart(6, '0'));
      const respuestas = await Promise.all(otros.map((codigo) => activar(prisa, codigo)));
      expect(respuestas.filter((r) => r.datos.error === 'code')).toHaveLength(4);
      expect(respuestas.filter((r) => r.datos.error === 'attempts')).toHaveLength(6);
      expect(await a.sql('SELECT intentos FROM lore_codigos WHERE owner=?', prisa)).toEqual([{ intentos: 5 }]);
      expect((await activar(prisa, bueno)).datos).toEqual({ error: 'attempts' });
      // Dos cuentas activadas con un correo: la tercera ya no puede.
      const compartido = `alumno-cinco@${COLEGIO}`;
      for (const quien of [otra(), otra()]) {
        await pedirCodigo(quien, compartido);
        expect((await activar(quien, ultimo(compartido).code)).estado).toBe(200);
      }
      expect((await pedirCodigo(otra(), compartido)).datos).toEqual({ error: 'taken' });
    });

    it('la limpieza diaria quita códigos y activaciones caducados y los envíos de días pasados', async () => {
      const viva = otra();
      await a.sql("INSERT INTO lore_codigos(owner, correo, codigo, expires) VALUES('vieja', 'c', 'k', 1)");
      await a.sql("INSERT INTO lore_accesos(owner, correo, since, expires) VALUES('vieja', 'c', 1, 2)");
      await a.sql('INSERT INTO lore_accesos(owner, correo, since, expires) VALUES(?, ?, 1, ?)', viva, 'c', Date.now() + 60_000);
      await a.sql("INSERT INTO lore_envios(clave, tramo, n) VALUES('o:vieja', '2020-01-01T10', 3)");
      await a.cron();
      expect(await a.sql("SELECT * FROM lore_codigos WHERE owner='vieja'")).toEqual([]);
      expect(await a.sql("SELECT owner FROM lore_accesos WHERE owner IN ('vieja', ?)", viva)).toEqual([{ owner: viva }]);
      expect(await a.sql("SELECT * FROM lore_envios WHERE clave='o:vieja'")).toEqual([]);
    });
  });
});

describe('Biblioteca 2: la carpeta «AK Lore» de Drive', () => {
  const CARPETA = 'application/vnd.google-apps.folder';
  const carpeta = (id: string, name: string, padre: string) => ({ id, name, mimeType: CARPETA, parents: [padre], version: '1' });
  const archivo = (id: string, name: string, padre: string, extra: Record<string, unknown> = {}) => ({
    id, name, mimeType: 'application/pdf', parents: [padre], size: String(pdfDe(id).length), modifiedTime: '2026-11-11T00:00:00.000Z', version: '1', ...extra,
  });
  const CONFIG = { formato: 1, convocatorias: [{ id: '2027-11', nombre: 'Noviembre de 2027' }], asignaturas: { Física: { niveles: ['NM'] } } };
  type Nodo = { i: string; p: string; n: string; k: string; d: string | null; x: Record<string, string> | null; v: string | null; g: string | null };
  const indice = async (cuenta = ALUMNA) => {
    const primera = await a.pedir('/app/biblioteca', { token: sesion(cuenta) });
    const nodos: Nodo[] = [...(primera.datos?.nodos ?? [])];
    for (let p = 1; p < (primera.datos?.partes ?? 0); p++) nodos.push(...(await a.pedir(`/app/biblioteca?parte=${p}`, { token: sesion(cuenta) })).datos.nodos);
    return { ...primera, nodos };
  };
  const hoy = () => new Date().toISOString().slice(0, 10);

  beforeAll(() => {
    DRIVE.archivos = [
      carpeta('raiz-ak-lore-01', 'AK Lore', 'mi-unidad-de-asvent'),
      carpeta('carpeta-bib-01', '_Biblioteca', 'raiz-ak-lore-01'),
      archivo('config-json-01', 'biblioteca.json', 'carpeta-bib-01', { mimeType: 'application/json', size: '200' }),
      carpeta('carpeta-tarj-01', 'Tarjetas', 'carpeta-bib-01'),
      archivo('tarjetas-fis-01', 'fisica-guia.json', 'carpeta-tarj-01', { mimeType: 'application/json', size: '100' }),
      carpeta('carpeta-dest-01', 'Destacados', 'carpeta-bib-01'),
      { id: 'atajo-guia-0001', name: '01 Guía de Física', mimeType: 'application/vnd.google-apps.shortcut', parents: ['carpeta-dest-01'], shortcutDetails: { targetId: 'guia-fisica-001' }, version: '1' },
      carpeta('carpeta-fis-001', 'Física', 'raiz-ak-lore-01'),
      carpeta('carpeta-guia-01', 'Guía y programa', 'carpeta-fis-001'),
      archivo('guia-fisica-001', 'Guía de Física (primeros exámenes en 2025)', 'carpeta-guia-01', {
        description: 'La guía oficial de la asignatura.',
        properties: { clave: 'fisica-guia', tipo: 'guia', guia: '2025', idioma: 'es', origen: 'IB' },
      }),
      carpeta('carpeta-exam-01', 'Exámenes', 'carpeta-fis-001'),
      archivo('examen-fis-0001', 'Prueba 2 de Física, mayo de 2025, zona horaria 2', 'carpeta-exam-01', { properties: { clave: 'fisica-examen-2025-05-z2-p2', tipo: 'examen' } }),
      carpeta('carpeta-temas-1', 'Temas', 'carpeta-fis-001'),
      ...Array.from({ length: 510 }, (_, i) => archivo(`relleno-${String(i).padStart(6, '0')}`, `Apuntes ${i}`, 'carpeta-temas-1')),
      carpeta('carpeta-vieja-1', '_Anterior - Programa del Diploma (10-nov-2026)', 'raiz-ak-lore-01'),
      archivo('archivo-viejo-1', 'Guía vieja', 'carpeta-vieja-1'),
      archivo('oculto-punto-1', '.borrador', 'carpeta-guia-01'),
      { id: 'documento-gdoc1', name: 'Un documento de Google', mimeType: 'application/vnd.google-apps.document', parents: ['carpeta-guia-01'], version: '1' },
      archivo('fuera-de-raiz-1', 'Suelto', 'otra-carpeta-de-asvent'),
    ];
    DRIVE.contenido['config-json-01'] = JSON.stringify(CONFIG);
    DRIVE.contenido['tarjetas-fis-01'] = JSON.stringify({ formato: 1, de: 'fisica-guia', tarjetas: [{ id: 1, frente: 'a', reverso: 'b' }] });
  });

  it('antes de leer Drive, un índice vacío; y solo para cuentas que pueden abrirla', async () => {
    const r = await a.pedir('/app/biblioteca', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(200);
    expect(r.datos).toMatchObject({ formato: 2, partes: 0, nodos: [], config: null });
    expect((await a.pedir('/app/biblioteca', { token: sesion(LUIS) })).datos).toEqual({ error: 'school' });
    expect((await a.pedir('/app/biblioteca')).estado).toBe(401);
  });

  it('lee la carpeta entera, por páginas, y arma el índice por partes', async () => {
    await a.sincronizar();
    expect(DRIVE.listados).toBe(2);
    const r = await indice();
    expect(r.datos.partes).toBe(2);
    expect(r.datos.raiz).toBe('raiz-ak-lore-01');
    expect(r.datos.config).toEqual(CONFIG);
    const ids = new Set(r.nodos.map((n) => n.i));
    expect(ids.size).toBe(r.nodos.length);
    for (const id of ['carpeta-bib-01', 'config-json-01', 'tarjetas-fis-01', 'atajo-guia-0001', 'guia-fisica-001', 'examen-fis-0001', 'relleno-000509']) expect(ids).toContain(id);
    for (const id of ['raiz-ak-lore-01', 'carpeta-vieja-1', 'archivo-viejo-1', 'oculto-punto-1', 'documento-gdoc1', 'fuera-de-raiz-1']) expect(ids).not.toContain(id);
    const guia = r.nodos.find((n) => n.i === 'guia-fisica-001')!;
    expect(guia).toMatchObject({ p: 'carpeta-guia-01', n: 'Guía de Física (primeros exámenes en 2025)', k: 'f', d: 'La guía oficial de la asignatura.', x: { clave: 'fisica-guia', tipo: 'guia' } });
    expect(r.nodos.find((n) => n.i === 'atajo-guia-0001')).toMatchObject({ k: 's', g: 'guia-fisica-001' });
    expect(r.nodos.find((n) => n.i === 'carpeta-fis-001')).toMatchObject({ k: 'd', p: 'raiz-ak-lore-01' });
    // El examen lleva portada dibujada por la app: no se copia la de Drive. Lo apartado, tampoco.
    expect(r.nodos.find((n) => n.i === 'examen-fis-0001')!.v).toBeNull();
    expect(await a.sql("SELECT count(*) AS n FROM lore_vistas WHERE id IN ('archivo-viejo-1', 'examen-fis-0001')")).toEqual([{ n: 0 }]);
  });

  it('las portadas llegan poco a poco y, sin cambios, la app no vuelve a bajar el índice', async () => {
    const { datos } = await a.pedir('/app/biblioteca', { token: sesion(ALUMNA) });
    const igual = await a.pedir(`/app/biblioteca?si=${encodeURIComponent(datos.actualizado)}`, { token: sesion(ALUMNA) });
    expect(igual.datos).toEqual({ formato: 2, actualizado: datos.actualizado, igual: true });
    for (let i = 0; i < 30; i++) await a.sincronizar();
    expect(await a.sql('SELECT count(*) AS n FROM lore_nodos WHERE pendiente = 1')).toEqual([{ n: 0 }]);
    expect((await indice()).nodos.find((n) => n.i === 'guia-fisica-001')!.v).toBe('1');
    const antes = (await a.pedir('/app/biblioteca', { token: sesion(ALUMNA) })).datos.actualizado;
    await a.sincronizar();
    expect((await a.pedir('/app/biblioteca', { token: sesion(ALUMNA) })).datos.actualizado).toBe(antes);
  });

  it('mover, renombrar o borrar en Drive basta', async () => {
    const guia = DRIVE.archivos.find((f) => f.id === 'guia-fisica-001')!;
    guia.parents = ['carpeta-exam-01'];
    guia.name = 'Guía de Física (nueva)';
    guia.version = '2';
    DRIVE.archivos.find((f) => f.id === 'relleno-000001')!.trashed = true;
    await a.sincronizar();
    const r = await indice();
    expect(r.nodos.find((n) => n.i === 'guia-fisica-001')).toMatchObject({ p: 'carpeta-exam-01', n: 'Guía de Física (nueva)' });
    expect(r.nodos.find((n) => n.i === 'relleno-000001')).toBeUndefined();
    expect(await a.sql("SELECT count(*) AS n FROM lore_vistas WHERE id = 'relleno-000001'")).toEqual([{ n: 0 }]);
    // La portada se renueva con la versión.
    expect(await a.sql("SELECT version FROM lore_vistas WHERE id = 'guia-fisica-001'")).toEqual([{ version: '2' }]);
  });

  it('si Drive no responde, no se quita nada', async () => {
    DRIVE.caido = true;
    const antes = (await indice()).nodos.length;
    await a.sincronizar();
    DRIVE.caido = false;
    expect((await indice()).nodos.length).toBe(antes);
  });

  it('pasa el archivo de la carpeta, entero o por tramos, y lo cuenta', async () => {
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    const tam = pdfDe('guia-fisica-001').length;
    const r = await a.pedir('/app/biblioteca/archivo/guia-fisica-001', { token: sesion(ALUMNA) });
    expect(r.estado).toBe(200);
    expect(r.texto).toBe(pdfDe('guia-fisica-001'));
    expect(r.r.headers.get('content-disposition')).toContain(encodeURIComponent('Guía de Física (nueva)'));
    expect(r.r.headers.get('accept-ranges')).toBe('bytes');
    expect(await a.sql('SELECT n, bytes FROM lore_descargas WHERE owner=? AND day=?', ALUMNA, hoy())).toEqual([{ n: 1, bytes: tam }]);
    const t = await a.pedir('/app/biblioteca/archivo/guia-fisica-001', { token: sesion(ALUMNA), headers: { range: 'bytes=5-9' } });
    expect(t.estado).toBe(206);
    expect(t.texto).toBe(pdfDe('guia-fisica-001').slice(5, 10));
    expect(t.r.headers.get('content-range')).toBe(`bytes 5-9/${tam}`);
    expect(await a.sql('SELECT n, bytes FROM lore_descargas WHERE owner=? AND day=?', ALUMNA, hoy())).toEqual([{ n: 1, bytes: tam + 5 }]);
    expect((await a.pedir('/app/biblioteca/archivo/guia-fisica-001', { token: sesion(ALUMNA), headers: { range: `bytes=${tam + 5}-` } })).estado).toBe(416);
  });

  it('nada fuera de la raíz, apartado, carpeta o de Google', async () => {
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    for (const id of ['archivo-viejo-1', 'fuera-de-raiz-1', 'oculto-punto-1', 'carpeta-fis-001', 'documento-gdoc1', 'no-existe-nunca', '..%2Fx', 'relleno-000001']) {
      expect((await a.pedir(`/app/biblioteca/archivo/${id}`, { token: sesion(ALUMNA) })).estado, id).toBe(404);
    }
    expect(await a.sql('SELECT n FROM lore_descargas WHERE owner=?', ALUMNA)).toEqual([]);
    expect((await a.pedir('/app/biblioteca/archivo/guia-fisica-001', { token: sesion(LUIS) })).estado).toBe(403);
  });

  it('portadas y tarjetas, sin gastar el tope', async () => {
    await a.sql('DELETE FROM lore_descargas WHERE owner=?', ALUMNA);
    const v = await a.pedir('/app/biblioteca/vista/guia-fisica-001', { token: sesion(ALUMNA) });
    expect(v.estado).toBe(200);
    expect(v.r.headers.get('content-type')).toBe('image/jpeg');
    expect((await a.pedir('/app/biblioteca/vista/examen-fis-0001', { token: sesion(ALUMNA) })).estado).toBe(404);
    const t = await a.pedir('/app/biblioteca/tarjetas/fisica-guia', { token: sesion(ALUMNA) });
    expect(t.estado).toBe(200);
    expect(t.datos).toMatchObject({ formato: 1, de: 'fisica-guia' });
    expect((await a.pedir('/app/biblioteca/tarjetas/no-hay', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/biblioteca/tarjetas/..%2Fx', { token: sesion(ALUMNA) })).estado).toBe(404);
    expect((await a.pedir('/app/biblioteca/tarjetas/fisica-guia', { token: sesion(LUIS) })).estado).toBe(403);
    expect(await a.sql('SELECT n FROM lore_descargas WHERE owner=?', ALUMNA)).toEqual([]);
  });

  it('una configuración rota no reemplaza a la buena', async () => {
    DRIVE.contenido['config-json-01'] = '{ esto no es JSON';
    DRIVE.archivos.find((f) => f.id === 'config-json-01')!.version = '2';
    await a.sincronizar();
    expect((await a.pedir('/app/biblioteca', { token: sesion(ALUMNA) })).datos.config).toEqual(CONFIG);
  });

  it('la cuenta de servicio firma su JWT con RS256', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const jwt = await firmarJwt({ client_email: 'lector@proyecto.iam.gserviceaccount.com', private_key: pem }, 1_800_000_000_000);
    const [cab, cuerpo, firma] = jwt.split('.');
    const leer = (s: string) => JSON.parse(Buffer.from(s, 'base64url').toString());
    expect(leer(cab!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(leer(cuerpo!)).toEqual({
      iss: 'lector@proyecto.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/drive.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    expect(createVerify('RSA-SHA256').update(`${cab}.${cuerpo}`).verify(publicKey, Buffer.from(firma!, 'base64url'))).toBe(true);
  });
});
