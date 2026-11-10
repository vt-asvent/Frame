// La cola de descargas (lib/extensions/yt-mp3-downloads.ts) con un programa de
// descargas de mentira: cada canción baja en tres vueltas, o falla como diga
// el caso. El reloj es de mentira; un segundo es una vuelta de la cola.
import { check, makeFrame, ok, section } from './base.mjs';

const TRANSIENT = 'ERROR: unable to download video data: HTTP Error 429: Too Many Requests';
const PERMANENT = 'ERROR: [youtube] abc: Video unavailable. This video is private';
const idOf = (title) => (title.replace(/[^a-z0-9]/gi, '') + 'xxxxxxxxxxx').slice(0, 11);

/**
 * Un Frame con su cola, su biblioteca y un programa de descargas simulado.
 * `plan(título)` dice cómo le va a cada canción: `{ fails, permanent, search }`.
 */
function makeQueue(plan = () => ({})) {
  const made = makeFrame();
  const { frame, context, probe } = made;
  const q = frame.queue;
  const engine = { jobs: new Map(), seq: 0, tries: new Map(), orders: [], searches: [], cancelled: [], down: false };
  const need = () => {
    if (engine.down) throw new context.TypeError('Failed to fetch');
  };
  const step = (job) => {
    if (job.status !== 'queued' && job.status !== 'running') return;
    job.age += 1;
    if (job.age === 1) job.status = 'running';
    else if (job.outcome !== 'ok') {
      job.status = 'failed';
      job.error = job.outcome === 'permanent' ? PERMANENT : TRANSIENT;
    } else {
      job.downloaded = Math.min(job.total, job.downloaded + 500_000);
      job.progress = (0.9 * job.downloaded) / job.total;
      if (job.downloaded >= job.total) {
        job.status = 'done';
        job.progress = 1;
      }
    }
  };
  const client = {
    status: async () => (need(), { version: '9.9.9', busy: 0 }),
    search: async (query) => {
      need();
      engine.searches.push(query);
      // «Artista - Título»: el título es lo que va tras el guion.
      const title = query.split(' - ').pop().replace(/ audio$/, '');
      const how = plan(title);
      if (how.search === 'timeout') throw new frame.EngineTimeout();
      if (how.search === 'none') return [];
      const artist = query.includes(' - ') ? query.split(' - ')[0] : '';
      return [{ id: idOf(title), url: `https://www.youtube.com/watch?v=${idOf(title)}`, title: `${artist} - ${title}`, channel: `${artist} - Topic`, duration: how.videoSeconds ?? 200, thumbnail: '' }];
    },
    info: async (url) => (need(), { id: url.slice(-11), url, title: 'Vídeo', channel: 'Canal', duration: 200, thumbnail: '', artist: 'Canal', track: `Pista ${url.slice(-11)}`, album: null, year: null, audioSize: 1_000_000 }),
    song: async (order) => {
      need();
      const attempt = (engine.tries.get(order.url) ?? 0) + 1;
      engine.tries.set(order.url, attempt);
      const how = plan(order.title);
      engine.seq += 1;
      engine.orders.push(order);
      engine.jobs.set(engine.seq, { id: engine.seq, order, status: 'queued', age: 0, progress: 0, downloaded: 0, total: 1_000_000, outcome: how.permanent ? 'permanent' : attempt <= (how.fails ?? 0) ? 'fail' : 'ok' });
      return engine.seq;
    },
    jobs: async (ids) => {
      need();
      return ids.flatMap((id) => {
        const job = engine.jobs.get(id);
        if (!job) return [];
        step(job);
        return [{ id, title: job.order.title, status: job.status, progress: job.progress, downloaded: job.downloaded, total: job.total, speed: 100_000, size: job.status === 'done' ? 8_000_000 : null, file: job.status === 'done' ? `C:\\Musica\\${job.order.artist} - ${job.order.title}.mp3` : null, error: job.error ?? null }];
      });
    },
    pause: async (id) => {
      const job = engine.jobs.get(id);
      if (job && (job.status === 'queued' || job.status === 'running')) job.status = 'paused';
      return { ok: true };
    },
    resume: async (id) => {
      const job = engine.jobs.get(id);
      if (job?.status === 'paused') job.status = 'queued';
      return { ok: true };
    },
    cancel: async (id) => {
      engine.cancelled.push(id);
      const job = engine.jobs.get(id);
      if (job) job.status = 'cancelled';
      return { ok: true };
    },
    file: async (id) => {
      need();
      const job = engine.jobs.get(id);
      if (!job) throw new context.Error('ya no está');
      return new TextEncoder().encode(JSON.stringify({ title: job.order.title, artist: job.order.artist, duration: plan(job.order.title).videoSeconds ?? 200 })).buffer;
    },
    text: async () => {
      throw new context.Error('HTTP 404');
    },
    image: async () => undefined,
  };
  const library = [];
  const playlists = new Map();
  const finished = [];
  const detach = q.attachDownloads({
    uid: 'perfil-1',
    clientFor: () => client,
    songs: () => library,
    addSongs: async (songs) => void library.push(...songs),
    mergePlaylistSongs: (name, ids) => playlists.set(name, [...new Set([...(playlists.get(name) ?? []), ...ids])]),
    playlists: () => [...playlists].map(([name, songIds]) => ({ id: name, name, songIds })),
    updatePlaylist: (id, updates) => void (updates.songIds && playlists.set(id, updates.songIds)),
    finished: (summary) => void finished.push(summary),
  });
  const items = () => q.useDownloads().items;
  const states = () => items().map((item) => item.state);
  const count = (state) => states().filter((s) => s === state).length;
  const song = (title, extra = {}) => ({ title, artist: 'Artista', duration: 200, ...extra });
  return { ...made, q, engine, library, playlists, finished, detach, items, states, count, song, snapshot: () => q.useDownloads(), probe };
}

export async function queue() {
  section('Cola: una lista normal');
  {
    const t = makeQueue();
    const added = t.q.addCsvDownloads('fuente', [t.song('Uno'), t.song('Dos'), t.song('Tres')], "Rock 80's/90's: ..\\x");
    check('entran las tres', added, { added: 3, repeated: 0 });
    await t.seconds(12);
    check('y bajan las tres', [t.states(), t.library.map((s) => s.title)], [['done', 'done', 'done'], ['Uno', 'Dos', 'Tres']]);
    check('en su playlist, en el orden de la lista', t.playlists.get("Rock 80's/90's: ..\\x"), t.library.map((s) => s.id));
    check('la carpeta que se pide al programa es un nombre válido (sin barras: no sale de la carpeta de música)', [...new Set(t.engine.orders.map((o) => o.folder))], ["Rock 80's 90's .. x"]);
    check('se avisa una vez, al cerrar el lote', t.finished, [{ done: 3, skipped: 0, failed: 0 }]);
    check('a las métricas va un evento con cuántas, no uno por canción', t.probe.events, [{ event: 'song_download', props: { n: 3 } }]);

    const searches = t.engine.searches.length;
    const again = t.q.addCsvDownloads('fuente', [t.song('Uno'), t.song('Dos'), t.song('Cuatro')], 'Otra lista');
    await t.seconds(8);
    check('releer la lista: lo que ya está no se busca ni se baja', [again, t.states(), t.engine.searches.length - searches, t.library.length], [{ added: 3, repeated: 0 }, ['skipped', 'skipped', 'done'], 1, 4]);
    check('y entra igual en la otra playlist', t.playlists.get('Otra lista').length, 3);
  }

  section('Cola: lo ya descargado se reconoce aunque el vídeo dure distinto');
  {
    // La lista dice 200 s; el vídeo que se baja dura 215 (su introducción).
    const t = makeQueue(() => ({ videoSeconds: 215 }));
    t.q.addCsvDownloads('fuente', [t.song('Larga')], 'Lista');
    await t.seconds(8);
    check('baja', [t.states(), t.library[0]?.duration], [['done'], 215]);
    const before = t.engine.orders.length;
    t.q.addCsvDownloads('fuente', [t.song('Larga')], 'Lista');
    await t.seconds(6);
    check('al releer la lista no se vuelve a bajar', [t.states(), t.engine.orders.length - before], [['skipped'], 0]);
    ok('y «¿ya está en la biblioteca?» lo sabe', !!t.q.libraryMatcher(t.library)({ title: 'Larga', artist: 'Artista', duration: 200 }));
    ok('otra versión de 260 s no se confunde con ella', !t.q.libraryMatcher(t.library)({ title: 'Larga', artist: 'Artista', duration: 260 }));
  }

  section('Cola: repetidas');
  {
    const t = makeQueue();
    const spotify = (n) => String(n).padStart(22, '0');
    const added = t.q.addCsvDownloads(
      'fuente',
      [t.song('Uno', { spotifyId: spotify(1) }), t.song('Dos'), t.song('Uno', { spotifyId: spotify(1) }), t.song('Dos', { duration: 202 }), t.song('Dos', { duration: 260 }), { title: 'Sin artista', artist: undefined }],
      'Lista'
    );
    check('la misma canción no entra dos veces; otra versión (otra duración) sí; sin artista no rompe nada', added, { added: 4, repeated: 2 });
    check('leer la misma lista mientras baja no la duplica', t.q.addCsvDownloads('fuente', [t.song('Uno', { spotifyId: spotify(1) }), t.song('Dos')], 'Lista'), { added: 0, repeated: 2 });
    const other = t.q.addCsvDownloads('fuente', [t.song('Uno', { spotifyId: spotify(1) })], 'Favoritas');
    await t.seconds(20);
    check('la misma canción pedida por otra lista no se baja dos veces', [other, t.engine.orders.filter((o) => o.title === 'Uno').length], [{ added: 1, repeated: 0 }, 1]);
    check('y queda en las dos playlists', [t.playlists.get('Lista').includes(t.library.find((s) => s.title === 'Uno').id), t.playlists.get('Favoritas')], [true, [t.library.find((s) => s.title === 'Uno').id]]);
  }

  section('Cola: fallos');
  {
    const t = makeQueue((title) => ({ fails: title === 'Dudosa' ? 1 : title === 'Imposible' ? 9 : 0, permanent: title === 'Privada' }));
    t.q.addCsvDownloads('fuente', [t.song('Dudosa'), t.song('Privada'), t.song('Buena')], 'Lista');
    await t.seconds(6);
    check('la que falla una vez espera su reintento; la privada no se reintenta', t.states(), ['waiting', 'failed', 'done']);
    ok('con su aviso', !!t.items()[0].retryAt && t.items()[0].attempts === 1 && /private/.test(t.items()[1].error));
    await t.seconds(30);
    check('y al reintento sale', [t.states(), t.engine.orders.filter((o) => o.title === 'Dudosa').length, t.finished], [['done', 'failed', 'done'], 2, [{ done: 2, skipped: 0, failed: 1 }]]);

    const u = makeQueue((title) => ({ fails: title === 'Imposible' ? 9 : 0 }));
    u.q.addCsvDownloads('fuente', [u.song('Imposible'), u.song('Buena')], 'Lista');
    await u.seconds(200);
    check(
      'la que falla siempre se deja a la tercera, y el lote termina sin pausarse',
      [u.states(), u.items()[0].attempts, u.engine.orders.filter((o) => o.title === 'Imposible').length, u.snapshot().paused, u.finished],
      [['failed', 'done'], 3, 3, false, [{ done: 1, skipped: 0, failed: 1 }]]
    );
  }

  section('Cola: una racha de fallos la pausa');
  {
    let broken = true;
    const t = makeQueue(() => ({ fails: broken ? 99 : 0 }));
    t.q.addCsvDownloads('fuente', Array.from({ length: 10 }, (_, i) => t.song(`Canción ${i + 1}`)), 'Lista');
    await t.seconds(15);
    const snap = t.snapshot();
    check('se pausa sola y dice por qué', [snap.paused, snap.pausedWhy, snap.pausedDetail], [true, 'failing', TRANSIENT]);
    ok('sin dar por perdida ninguna canción', t.count('failed') === 0, JSON.stringify(t.states()));
    const orders = t.engine.orders.length;
    await t.seconds(300);
    check('y en pausa no pide nada más', t.engine.orders.length, orders);
    broken = false;
    t.engine.tries.clear();
    await t.q.resumeDownloads();
    await t.seconds(40);
    check('al reanudar (ya con la red bien) baja todo', [t.count('done'), t.snapshot().paused, t.snapshot().pausedWhy ?? null], [10, false, null]);
  }

  section('Cola: sin espacio en el equipo');
  {
    const t = makeQueue();
    t.probe.storage = 'full';
    t.q.addCsvDownloads('fuente', [t.song('Uno'), t.song('Dos'), t.song('Tres')], 'Lista');
    await t.seconds(12);
    const snap = t.snapshot();
    check('se pausa y lo dice', [snap.paused, snap.pausedWhy, snap.pausedDetail], [true, 'storage', 'el disco del equipo se quedó sin espacio']);
    ok('sin dar ninguna por fallida', t.count('failed') === 0 && t.library.length === 0, JSON.stringify(t.states()));
    t.probe.storage = 'ok';
    await t.q.resumeDownloads();
    await t.seconds(15);
    check('con sitio otra vez, entran sin volver a bajarlas', [t.states(), t.library.length, t.engine.orders.length], [['done', 'done', 'done'], 3, 3]);
  }

  section('Cola: el programa tarda o no está');
  {
    const t = makeQueue((title) => ({ search: title === 'Lenta' ? 'timeout' : 'ok' }));
    t.q.addCsvDownloads('fuente', [t.song('Lenta'), t.song('Buena')], 'Lista');
    await t.seconds(90);
    check('una búsqueda que no llega tres veces se deja: el lote cierra', [t.states(), t.items()[0].error, t.finished], [['failed', 'done'], 'El programa de descargas tardó demasiado en responder.', [{ done: 1, skipped: 0, failed: 1 }]]);

    const u = makeQueue();
    u.engine.down = true;
    u.q.addCsvDownloads('fuente', [u.song('Uno')], 'Lista');
    await u.seconds(30);
    check('con el programa cerrado, espera sin fallar', [u.states(), u.snapshot().problem], [['waiting'], 'engine']);
    u.engine.down = false;
    await u.seconds(15);
    check('y sigue cuando vuelve', [u.states(), u.snapshot().problem], [['done'], null]);
  }

  section('Cola: sin conexión');
  {
    const t = makeQueue();
    t.context.navigator.onLine = false;
    t.q.addCsvDownloads('fuente', [t.song('Uno'), t.song('Dos')], 'Lista');
    await t.seconds(20);
    check('no empieza nada y lo dice', [t.states(), t.snapshot().problem, t.engine.orders.length], [['waiting', 'waiting'], 'offline', 0]);
    t.context.navigator.onLine = true;
    await t.seconds(12);
    check('al volver, sigue sola', [t.states(), t.snapshot().problem], [['done', 'done'], null]);
  }

  section('Cola: cancelar todo');
  {
    const t = makeQueue();
    t.q.addCsvDownloads('fuente', Array.from({ length: 8 }, (_, i) => t.song(`Canción ${i + 1}`)), 'Lista');
    await t.seconds(5);
    const done = t.count('done');
    const removed = t.q.cancelDownloads();
    await t.seconds(10);
    ok('lo bajado se queda; lo demás sale de la cola', done > 0 && removed === 8 - done && t.items().length === done && t.states().every((s) => s === 'done'), JSON.stringify([done, removed, t.states()]));
    ok('y se cancela en el programa lo que estaba bajando', t.engine.cancelled.length > 0 && [...t.engine.jobs.values()].every((job) => job.status === 'done' || job.status === 'cancelled'));
    check('el lote se cierra con lo que llegó', t.finished, [{ done, skipped: 0, failed: 0 }]);
    check('cancelar sin nada pendiente no hace nada', t.q.cancelDownloads(), 0);
  }

  section('Cola: de una lista de YouTube');
  {
    const t = makeQueue();
    const added = t.q.addCsvDownloads(
      'fuente',
      [
        { title: 'Grupo - Vídeo uno', artist: 'Canal', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', fromYouTube: true },
        { title: 'Grupo - Vídeo uno (otra vez)', artist: 'Canal', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', fromYouTube: true },
        { title: 'Otro', artist: 'Canal', url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', fromYouTube: true },
      ],
      'De YouTube'
    );
    await t.seconds(12);
    check('el mismo vídeo dos veces entra una; la canción la dice el programa', [added, t.states(), t.library.map((s) => s.title)], [{ added: 2, repeated: 1 }, ['done', 'done'], ['Pista aaaaaaaaaaa', 'Pista bbbbbbbbbbb']]);
    t.q.addCsvDownloads('fuente', [{ title: 'Grupo - Vídeo uno', artist: 'Canal', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', fromYouTube: true }], 'De YouTube');
    const before = t.engine.orders.length;
    await t.seconds(6);
    check('releer la lista: el vídeo ya bajado no se vuelve a bajar', [t.states(), t.engine.orders.length - before], [['skipped'], 0]);
  }
}
