// Prueba del relevo de la extensión Wire (1.7.3) con un Drive falso.
//
// Ejecuta las reglas REALES (src/lib/extensions/wire/plan.ts, empaquetado con
// esbuild) en tres equipos simulados que se turnan, con un reloj propio:
//
//   1. dos equipos con bibliotecas distintas terminan con lo mismo y Drive
//      queda vacío;
//   2. un tercer equipo nuevo recibe todo y Drive vuelve a vaciarse;
//   3. una canción con corazón se queda en Drive para siempre; sin corazón,
//      sale cuando todos la tienen;
//   4. lo que el usuario borra en un equipo no vuelve a ese equipo;
//   5. un equipo apagado más de una semana deja de esperarse y lo que solo
//      él esperaba sale de Drive; al volver, recibe lo nuevo;
//   6. dos equipos suben lo mismo a la vez: queda una sola copia;
//   7. un archivo fijado a mano se queda en Drive.
//
// Uso: node scripts/probar-wire.mjs   (sale con 1 si algo falla)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = await esbuild.build({
  entryPoints: [path.join(root, 'src/lib/extensions/wire/plan.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { planCycle, updateDeclined, WEEK_MS } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`
);

const DAY = 24 * 60 * 60 * 1000;
let failures = 0;
const check = (ok, text) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${text}`);
  if (!ok) failures++;
};

function world() {
  const drive = { items: [], records: new Map(), seq: 0, clock: Date.UTC(2026, 10, 5) };
  const devices = new Map();
  const add = (id, library = [], extra = {}) =>
    devices.set(id, { id, have: new Set(library), known: new Set(), declined: new Set(), keep: new Set(extra.keep ?? []), online: true });
  /** Una vuelta del relevo en un equipo, como la hace relay.ts. */
  const turn = (id) => {
    const d = devices.get(id);
    if (!d.online) return;
    d.declined = updateDeclined(d.known, d.have, d.declined);
    const uploadable = new Map([...d.have].map((k) => [k, k.startsWith('s:') ? 'song' : 'attachment']));
    const local = { deviceId: id, now: drive.clock, have: d.have, declined: d.declined, keep: d.keep, uploadable };
    const records = [...drive.records.values()];
    const plan = planCycle(local, records, drive.items);
    for (const gone of plan.dropDevices) drive.records.delete(gone.id);
    for (const { item, permanent } of plan.setPermanent) item.permanent = permanent;
    const removed = new Set(plan.remove.map((i) => i.id));
    drive.items = drive.items.filter((i) => !removed.has(i.id));
    for (const item of plan.download) d.have.add(item.key);
    for (const job of plan.upload) {
      drive.items.push({ id: `f${++drive.seq}`, key: job.key, kind: job.kind, from: id, permanent: job.permanent, created: drive.clock + drive.seq, name: job.key, size: 1 });
    }
    drive.records.set(id, { id, name: id, lastSeen: drive.clock, have: [...d.have], declined: [...d.declined], keep: [...d.keep] });
    d.known = new Set(d.have);
    drive.clock += 60_000;
  };
  /** Varias vueltas por turnos, hasta que nada cambie. */
  const settle = (ids, rounds = 6) => {
    for (let r = 0; r < rounds; r++) for (const id of ids) turn(id);
  };
  const keys = () => drive.items.map((i) => i.key).sort();
  return { drive, devices, add, turn, settle, keys };
}

const sorted = (set) => [...set].sort().join(',');

console.log('1. Dos equipos con bibliotecas distintas');
{
  const w = world();
  w.add('A', ['s:1', 's:2']);
  w.add('B', ['s:2', 's:3']);
  w.settle(['A', 'B']);
  check(sorted(w.devices.get('A').have) === 's:1,s:2,s:3', 'A tiene las tres');
  check(sorted(w.devices.get('B').have) === 's:1,s:2,s:3', 'B tiene las tres');
  check(w.keys().length === 0, 'Drive quedó vacío');

  console.log('2. Llega un tercer equipo vacío');
  w.add('C', []);
  w.settle(['C', 'A', 'B']);
  check(sorted(w.devices.get('C').have) === 's:1,s:2,s:3', 'C recibió todo');
  check(w.keys().length === 0, 'Drive volvió a vaciarse');
}

console.log('3. Corazón: para siempre');
{
  const w = world();
  w.add('A', ['s:1', 's:2'], { keep: ['s:1'] });
  w.add('B', []);
  w.settle(['A', 'B']);
  check(sorted(w.devices.get('B').have) === 's:1,s:2', 'B recibió las dos');
  check(w.keys().join() === 's:1', 'solo la canción con corazón sigue en Drive');
  check(w.drive.items[0]?.permanent === true, 'marcada como permanente');
  w.devices.get('A').keep.delete('s:1');
  w.settle(['A', 'B']);
  check(w.keys().length === 0, 'sin corazón, sale de Drive');
}

console.log('4. Lo borrado en un equipo no vuelve');
{
  const w = world();
  w.add('A', ['s:1', 's:2']);
  w.add('B', ['s:1', 's:2']);
  w.settle(['A', 'B']);
  w.devices.get('B').have.delete('s:2');
  w.settle(['B', 'A']);
  check(!w.devices.get('B').have.has('s:2'), 'B no recibe otra vez lo que borró');
  check(w.keys().length === 0, 'nada se quedó esperando en Drive');
  w.devices.get('B').have.add('s:2');
  w.turn('B');
  check(!w.devices.get('B').declined.has('s:2'), 'si lo vuelve a importar, deja de estar rechazado');
}

console.log('5. Un equipo apagado más de una semana');
{
  const w = world();
  w.add('A', ['s:1']);
  w.add('B', ['s:1']);
  w.add('C', ['s:1']);
  w.settle(['A', 'B', 'C']);
  w.devices.get('C').online = false;
  w.devices.get('A').have.add('s:4');
  w.settle(['A', 'B']);
  check(w.devices.get('B').have.has('s:4'), 'B recibió la nueva');
  check(w.keys().join() === 's:4', 'Drive la guarda mientras C la espera');
  w.drive.clock += WEEK_MS + DAY;
  w.settle(['A', 'B']);
  check(!w.drive.records.has('C'), 'la ficha de C se quitó');
  check(w.keys().length === 0, 'sin C, la nueva salió de Drive');
  w.devices.get('C').online = true;
  w.settle(['C', 'A', 'B']);
  check(w.devices.get('C').have.has('s:4'), 'al volver, C la recibe (se vuelve a subir)');
  check(w.keys().length === 0, 'y Drive vuelve a vaciarse');
}

console.log('6. Dos equipos suben lo mismo a la vez');
{
  const w = world();
  w.add('A', ['s:5']);
  w.add('B', ['s:5']);
  w.add('C', []);
  // C se registra primero; A y B planifican sobre el mismo Drive.
  w.turn('C');
  const before = [...w.drive.items];
  w.turn('A');
  const fromA = w.drive.items.filter((i) => i.from === 'A');
  w.drive.items = before; // B aún no ve lo que subió A
  w.turn('B');
  w.drive.items = [...w.drive.items, ...fromA];
  check(w.drive.items.filter((i) => i.key === 's:5').length === 2, 'hubo dos copias');
  w.settle(['A', 'B', 'C']);
  check(w.devices.get('C').have.has('s:5'), 'C la recibió');
  check(w.keys().length === 0, 'no quedó ninguna copia de más');
}

console.log('7. Un adjunto fijado a mano');
{
  const w = world();
  w.add('A', ['a:x']);
  w.add('B', [], { keep: ['a:x'] });
  w.settle(['A', 'B']);
  check(w.devices.get('B').have.has('a:x'), 'B lo recibió');
  check(w.keys().join() === 'a:x' && w.drive.items[0].permanent, 'sigue en Drive, permanente');
}

console.log(failures === 0 ? '\nTodo bien.' : `\n${failures} comprobación(es) fallaron.`);
process.exit(failures === 0 ? 0 : 1);
