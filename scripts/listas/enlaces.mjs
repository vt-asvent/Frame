// Leer una lista por su enlace (lib/extensions/playlist-link.ts). Las páginas
// son de mentira, pero con la forma de las de verdad (comprobada el 9-nov-2026):
// la página para insertar de Spotify, la API pública de Deezer, la página de
// una lista de YouTube y los datos de una página de Apple Music.
import { check, failure, makeFrame, ok, section } from './base.mjs';

const SPOTIFY_ID = '37i9dQZF1DXcBWIGoYBM5M';
const NBSP = ' ';

const spotifyPage = (props) => ({
  url: 'https://open.spotify.com/embed/x',
  status: 200,
  body: `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script></html>`,
});
const spotifyEntity = (entity) => spotifyPage({ state: { data: { entity } } });
const spotifyTrack = (n, subtitle = `Artista ${n}`) => ({
  uri: `spotify:track:${String(n).padStart(22, '0')}`,
  title: `Canción ${n}`,
  subtitle,
  duration: 200_000 + n * 1000,
});

const lockup = (id, title, channel, clock) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    metadata: { lockupMetadataViewModel: { title: { content: title }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: channel } }] }] } } } },
    contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBadgeViewModel: { text: clock } }] } },
  },
});
const continuation = (token) => ({ continuationItemViewModel: { continuationCommand: { innertubeCommand: { continuationCommand: { token } } } } });
const videoId = (n) => `vid${String(n).padStart(8, '0')}`;
const youtubePage = (data, status = 200) => ({
  url: 'https://www.youtube.com/playlist',
  status,
  body: `<html><script>"INNERTUBE_CLIENT_VERSION":"2.20261109.01.00"</script><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`,
});
const youtubeList = (title, items) => ({ metadata: { playlistMetadataRenderer: { title } }, contents: { list: items } });

const appleTrack = (n, artistName, artists) => ({
  id: `a${n}`,
  title: `Tema ${n}`,
  artistName,
  duration: 180_000 + n * 1000,
  trackNumber: n,
  subtitleLinks: artists.map((title) => ({ title })),
  tertiaryLinks: [{ title: `Disco ${n} - Single` }],
  contentDescriptor: { identifiers: { storeAdamID: `9${n}` } },
  artwork: { dictionary: { url: `https://is1-ssl.mzstatic.com/image/thumb/Music/${n}/{w}x{h}bb.{f}` } },
});
const applePage = (tracks, name = 'Mi lista') => ({
  url: 'https://music.apple.com/x',
  status: 200,
  body: `<html><meta property="og:title" content="${name} en Apple Music"><script type="application/json" id="serialized-server-data">${JSON.stringify([{ data: { sections: [{ items: tracks }] } }])}</script></html>`,
});

export async function links() {
  section('Enlaces: Spotify');
  {
    const { frame, probe } = makeFrame();
    const asked = [];
    probe.page = (url) => {
      asked.push(url);
      return spotifyEntity({
        type: 'playlist',
        name: 'Mezcla',
        trackList: [
          spotifyTrack(1, 'Tyler, The Creator'),
          spotifyTrack(2, `KAROL G,${NBSP}Judeline,${NBSP}rusowsky`),
          spotifyTrack(3, `Earth, Wind & Fire,${NBSP}The Emotions`),
          { ...spotifyTrack(4), subtitle: '' },
        ],
      });
    };
    const list = await frame.readPlaylistLink(`Mira esta lista: https://open.spotify.com/intl-es/playlist/${SPOTIFY_ID}?si=abc123 🎶`);
    check('el enlace se saca del texto pegado', asked, [`https://open.spotify.com/embed/playlist/${SPOTIFY_ID}`]);
    check('una coma dentro del nombre no parte al artista', list.songs.map((s) => s.artist), ['Tyler, The Creator', 'KAROL G', 'Earth, Wind & Fire', '']);
    check('una canción sin artista lleva artista vacío, no ausente', typeof list.songs[3].artist, 'string');
    check('nombre, duración e id de Spotify', [list.name, list.songs[0].duration, list.songs[0].spotifyId, list.partial ?? null], ['Mezcla', 201, '0000000000000000000001', null]);

    probe.page = () => spotifyEntity({ type: 'playlist', name: 'Larga', trackList: Array.from({ length: 100 }, (_, i) => (i === 7 ? { ...spotifyTrack(i), title: '' } : spotifyTrack(i))) });
    const long = await frame.readPlaylistLink(`spotify:playlist:${SPOTIFY_ID}`);
    check('100 en la página: se avisa de que puede no estar entera, aunque una no valga', [long.songs.length, long.partial], [99, 'limit']);

    probe.page = () => spotifyPage({ status: 404, title: 'Page not found' });
    check('una lista privada o borrada (200 con página de «no encontrada») se dice', await failure(frame.readPlaylistLink(`https://open.spotify.com/playlist/${SPOTIFY_ID}`)), 'Esa lista no existe o es privada. Hazla pública (o compártela con enlace) y vuelve a intentarlo.');
    probe.page = () => spotifyEntity({ type: 'playlist', name: 'Nada', trackList: [] });
    check('una lista vacía no es «privada»', await failure(frame.readPlaylistLink(`https://open.spotify.com/playlist/${SPOTIFY_ID}`)), 'Esa lista está vacía.');
    probe.page = () => ({ url: 'x', status: 200, body: '<html>otra cosa</html>' });
    ok('si la página cambió de forma, se dice', /cambió su página/.test(await failure(frame.readPlaylistLink(`https://open.spotify.com/playlist/${SPOTIFY_ID}`))));

    probe.page = () => spotifyEntity({ type: 'track', name: 'Una', title: 'Una', artists: [{ name: 'Los Dos' }, { name: 'Otro' }], duration: 222_200, releaseDate: { isoString: '2004-06-15T00:00:00Z' }, uri: `spotify:track:${SPOTIFY_ID}` });
    const one = await frame.readPlaylistLink(`https://open.spotify.com/track/${SPOTIFY_ID}`);
    check('una canción suelta: sin playlist, con su año', [one.name, one.songs.length, one.songs[0].artist, one.songs[0].year], ['', 1, 'Los Dos', 2004]);
  }

  section('Enlaces: cortos');
  {
    const { frame, probe } = makeFrame();
    const entity = spotifyEntity({ type: 'playlist', name: 'Corta', trackList: [spotifyTrack(1)] });
    probe.page = (url) => (url.startsWith('https://spotify.link/') ? { url: `https://open.spotify.com/playlist/${SPOTIFY_ID}?si=x`, status: 200, body: '' } : entity);
    check('el que redirige', (await frame.readPlaylistLink('https://spotify.link/AbCdEf')).name, 'Corta');
    probe.page = (url) =>
      url.startsWith('https://spotify.link/')
        ? { url, status: 200, body: `<script>window.location = "https:\\/\\/open.spotify.com\\/playlist\\/${SPOTIFY_ID}?si=x&amp;nd=1"</script>` }
        : entity;
    check('el que contesta con una página que trae el enlace largo', (await frame.readPlaylistLink('https://spotify.link/AbCdEf')).name, 'Corta');
    probe.page = (url) => ({ url, status: 200, body: '<html>nada</html>' });
    ok('el que no lleva a ninguna lista', /no es de una playlist/.test(await failure(frame.readPlaylistLink('https://spotify.link/AbCdEf'))));
  }

  section('Enlaces: Deezer');
  {
    const { frame, probe } = makeFrame();
    const track = (n) => ({ title: `Pista ${n}`, artist: { name: 'Earth, Wind & Fire' }, album: { title: 'Disco', cover_xl: 'https://cdn-images.dzcdn.net/x.jpg' }, duration: 180 + n });
    let failAt = -1;
    probe.page = (url) => {
      const index = Number(new URL(url).searchParams.get('index') ?? -1);
      if (index < 0) return { url, status: 200, body: JSON.stringify({ title: 'De Deezer', nb_tracks: 120 }) };
      if (index === failAt) return { url, status: 200, body: JSON.stringify({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } }) };
      const count = index === 0 ? 100 : 20;
      return { url, status: 200, body: JSON.stringify({ data: Array.from({ length: count }, (_, i) => track(index + i)), ...(index === 0 ? { next: 'x' } : {}) }) };
    };
    const whole = await frame.readPlaylistLink('https://www.deezer.com/es/playlist/3155776842');
    check('entera, página a página, con el artista tal cual', [whole.songs.length, whole.songs[0].artist, whole.partial ?? null], [120, 'Earth, Wind & Fire', null]);
    failAt = 100;
    const cut = await frame.readPlaylistLink('https://www.deezer.com/es/playlist/3155776842');
    check('si falla una página posterior, vale lo leído y se dice', [cut.songs.length, cut.partial], [100, 'failed']);
    probe.page = (url) => ({ url, status: 200, body: JSON.stringify({ error: { type: 'OAuthException', message: 'An active access token must be used', code: 200 } }) });
    ok('una lista privada', /no existe o es privada/.test(await failure(frame.readPlaylistLink('https://deezer.com/playlist/1'))));
    probe.page = (url) => ({ url, status: 200, body: JSON.stringify({ error: { type: 'DataException', message: 'no data', code: 800 } }) });
    ok('una lista que no existe', /no existe o es privada/.test(await failure(frame.readPlaylistLink('https://deezer.com/playlist/1'))));
  }

  section('Enlaces: YouTube');
  {
    const { frame, probe } = makeFrame();
    const first = [
      lockup(videoId(1), 'Grupo - Canción uno', 'Grupo - Topic', '3:21'),
      lockup(videoId(2), '[Vídeo privado]', '', ''),
      lockup(videoId(3), '[MV] Grupo – Canción [4K]', 'Grupo', '1:02:03'),
      lockup(videoId(1), 'Grupo - Canción uno', 'Grupo - Topic', '3:21'),
      continuation('ficha-2'),
    ];
    let secondStatus = 200;
    const posts = [];
    probe.page = (url, body) => {
      if (body) {
        posts.push(JSON.parse(body).continuation);
        return { url, status: secondStatus, body: JSON.stringify({ onResponseReceivedActions: [{ appendContinuationItemsAction: { continuationItems: [lockup(videoId(4), 'Otra', 'Canal', '4:00')] } }] }) };
      }
      return youtubePage(youtubeList('Mis vídeos', first));
    };
    const whole = await frame.readPlaylistLink('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
    check('lee todas las páginas; fuera el privado y el repetido; un título entre corchetes se queda', whole.songs.map((s) => s.title), ['Grupo - Canción uno', '[MV] Grupo – Canción [4K]', 'Otra']);
    check('canal sin «- Topic», duración y enlace de cada vídeo', [whole.songs[0].artist, whole.songs[0].duration, whole.songs[1].duration, whole.songs[0].url, whole.songs[0].fromYouTube], ['Grupo', 201, 3723, `https://www.youtube.com/watch?v=${videoId(1)}`, true]);
    check('pide la página siguiente con su ficha', [posts, whole.name, whole.partial ?? null], [['ficha-2'], 'Mis vídeos', null]);
    secondStatus = 500;
    const cut = await frame.readPlaylistLink('https://music.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI');
    check('si la página siguiente falla, no se da la lista por entera', [cut.songs.length, cut.partial], [2, 'failed']);

    const refused = youtubePage({ alerts: [{ alertRenderer: { type: 'ERROR', text: { runs: [{ text: 'No se puede visualizar este tipo de playlist.' }] } } }] });
    probe.page = (url) => (url.includes('/oembed') ? { url, status: 200, body: JSON.stringify({ title: 'Rick Astley - Never Gonna Give You Up', author_name: 'Rick Astley' }) } : refused);
    ok('una mezcla no es una lista', /mezclas y radios/.test(await failure(frame.readPlaylistLink('https://www.youtube.com/playlist?list=RDdQw4w9WgXcQ'))));
    const mixed = await frame.readPlaylistLink('https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVMdQw4w9WgXcQ');
    check('un vídeo dentro de una mezcla: el vídeo', [mixed.name, mixed.songs.map((s) => [s.title, s.artist, s.url])], ['', [['Rick Astley - Never Gonna Give You Up', 'Rick Astley', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ']]]);
    check('un vídeo suelto', (await frame.readPlaylistLink('https://youtu.be/dQw4w9WgXcQ')).songs.length, 1);
    probe.page = (url) => ({ url, status: 404, body: 'Not Found' });
    check('un vídeo que no existe', await failure(frame.readPlaylistLink('https://www.youtube.com/watch?v=00000000000')), 'Ese vídeo no existe o es privado.');
    ok('una lista que no existe (404)', /no existe o es privada/.test(await failure(frame.readPlaylistLink('https://www.youtube.com/playlist?list=PL0000000000000000000000000000000000'))));
    probe.page = () => ({ url: 'https://consent.youtube.com/m?continue=x', status: 302, body: '' });
    ok('el aviso de condiciones de YouTube se explica', /aceptar sus condiciones/.test(await failure(frame.readPlaylistLink('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI'))));
    ok('«Me gusta» y «Ver más tarde» no tienen enlace público', /solo tuya/.test(await failure(frame.readPlaylistLink('https://www.youtube.com/playlist?list=LL'))));
    ok('una página de YouTube que no es lista ni vídeo', /list=/.test(await failure(frame.readPlaylistLink('https://music.youtube.com/browse/MPREb_abcdefghij'))));
    probe.page = () => youtubePage(youtubeList('Vacía', []));
    check('una lista sin vídeos', await failure(frame.readPlaylistLink('https://www.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI')), 'Esa lista está vacía.');
  }

  section('Enlaces: Apple Music');
  {
    const { frame, probe } = makeFrame();
    probe.page = () => applePage([appleTrack(1, 'Simon & Garfunkel', ['Simon & Garfunkel']), appleTrack(2, 'Drake & Don Toliver', ['Drake', 'Don Toliver']), appleTrack(3, 'Tyler, The Creator', [])]);
    const list = await frame.readPlaylistLink('https://music.apple.com/us/playlist/mi-lista/pl.f4d106fed2bd41149aaacabb233eb5eb');
    check('el primer artista por su enlace, sin partir nombres con «&» o coma', list.songs.map((s) => s.artist), ['Simon & Garfunkel', 'Drake', 'Tyler, The Creator']);
    check('nombre, álbum sin «- Single» y portada a 1000 px', [list.name, list.songs[0].album, list.songs[0].cover, list.partial ?? null], ['Mi lista', 'Disco 1', 'https://is1-ssl.mzstatic.com/image/thumb/Music/1/1000x1000bb.jpg', null]);
    const single = await frame.readPlaylistLink('https://music.apple.com/us/song/tema-1/91');
    check('la página de una canción no crea una playlist con su nombre', single.name, '');
    probe.page = () => applePage(Array.from({ length: 100 }, (_, i) => appleTrack(i + 1, 'Alguien', ['Alguien'])));
    check('100 en la página: puede no estar entera', (await frame.readPlaylistLink('https://music.apple.com/us/playlist/x/pl.abc')).partial, 'limit');
    ok('un enlace de la biblioteca propia se explica sin pedir nada', /tu biblioteca de Apple Music/.test(await failure(frame.readPlaylistLink('https://music.apple.com/library/playlist/p.abc123'))));
  }

  section('Enlaces: lo que no se lee');
  {
    const { frame } = makeFrame();
    const cases = [
      ['https://tidal.com/browse/playlist/abc', /aún no lee listas de TIDAL/],
      ['https://music.amazon.com/playlists/B0ABC', /aún no lee listas de Amazon Music/],
      ['https://soundcloud.com/user/sets/lista', /aún no lee listas de SoundCloud/],
      ['https://open.spotify.com/artist/0C0XlULifJtAgn6ZNCW2eu', /De Spotify, Frame lee playlists, álbumes y canciones/],
      ['https://open.spotify.com/collection/tracks', /canciones guardadas de Spotify/],
      ['hola, ¿qué tal?', /no es de una playlist/],
      ['https://example.com/playlist/1', /no es de una playlist/],
    ];
    for (const [text, expected] of cases) ok(text, expected.test(await failure(frame.readPlaylistLink(text))));
    // Lo que sí se reconoce llega a pedirse (aquí, sin página que lo conteste).
    const reached = [];
    for (const text of ['open.spotify.com/album/' + SPOTIFY_ID, 'https://m.youtube.com/playlist?list=PLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI', 'https://www.deezer.com/fr/album/302127']) {
      reached.push(await failure(frame.readPlaylistLink(text)));
    }
    check('lo que sí: enlaces con o sin «https://», con región o de móvil', [...new Set(reached)], ['No se pudo leer la lista. Revisa la conexión e inténtalo de nuevo.']);
  }
}

export async function csv() {
  const { frame } = makeFrame();
  const parse = (text) => frame.parseSongsCsv(text, 1000);

  section('CSV: formatos');
  {
    const exportify = [
      '"Track URI","Track Name","Album Name","Artist Name(s)","Release Date","Duration (ms)"',
      '"spotify:track:0000000000000000000001","EARFQUAKE","IGOR","Tyler, The Creator","2019-05-17","190067"',
      '"spotify:track:0000000000000000000002","Uno, dos","Disco ""raro""","KAROL G;Judeline","2025-01-01","200000"',
      '"spotify:track:0000000000000000000003","Tres","Disco","Shakira, Burna Boy","2024-01-01","180000"',
    ].join('\r\n');
    const songs = parse(exportify);
    check('Exportify: comillas, comas dentro y varios artistas', songs.map((s) => [s.title, s.artist, s.album, s.duration, s.year]), [
      ['EARFQUAKE', 'Tyler, The Creator', 'IGOR', 190.067, 2019],
      ['Uno, dos', 'KAROL G', 'Disco "raro"', 200, 2025],
      ['Tres', 'Shakira', 'Disco', 180, 2024],
    ]);
    check('con su id de Spotify', songs[0].spotifyId, '0000000000000000000001');

    const itunes = ['Name\tArtist\tAlbum\tTime\tYear', 'Song (12" Mix)\tArtista\tDisco\t215\t1987', 'Otra\tOtro\tD\t3:20\t2001', '"Heroes" (Single Version)\tDavid Bowie\tH\t210\t1977', 'Última\tAlguien\tD\t1:02:03\t2020'].join('\n');
    check('iTunes: unas comillas sueltas no se tragan las filas siguientes', parse(itunes).map((s) => [s.title, s.artist, s.duration]), [
      ['Song (12" Mix)', 'Artista', 215],
      ['Otra', 'Otro', 200],
      ['"Heroes" (Single Version)', 'David Bowie', 210],
      ['Última', 'Alguien', 3723],
    ]);

    const takeout = ['Playlist Id,Channel Id,Time Created,Time Updated,Title,Description,Visibility', 'PLabc,UCxyz,2020-01-01,2021-01-01,Mi playlist,,Private', '', 'Video Id,Time Added', 'dQw4w9WgXcQ,2020-01-01 00:00:00 UTC', '9bZkp7q19f0,2020-01-02 00:00:00 UTC'].join('\n');
    check('Takeout antiguo: la tabla de vídeos, no el bloque de la playlist', parse(takeout).map((s) => [s.title, s.url]), [['', 'dQw4w9WgXcQ'], ['', '9bZkp7q19f0']]);

    check('cabeceras en francés, con «;»', parse('Nom;Artiste;Album;Durée\nLa vie;Quelqu’un;Le disque;3:05').map((s) => [s.title, s.artist, s.album, s.duration]), [['La vie', 'Quelqu’un', 'Le disque', 185]]);
    check('en alemán', parse('Titel,Künstler,Album,Jahr\nLied,Jemand,Platte,1999').map((s) => [s.title, s.artist, s.year]), [['Lied', 'Jemand', 1999]]);
    check('en ruso', parse('Название,Исполнитель,Альбом\nПесня,Кто-то,Диск').map((s) => [s.title, s.artist, s.album]), [['Песня', 'Кто-то', 'Диск']]);
    check('en japonés (iTunes)', parse('名前\tアーティスト\tアルバム\t時間\n歌\t誰か\t盤\t200').map((s) => [s.title, s.artist, s.album, s.duration]), [['歌', '誰か', '盤', 200]]);
    check('una fila sin artista no rompe nada', parse('Title,Artist\nSola,\nCon,Alguien').map((s) => [s.title, s.artist]), [['Sola', ''], ['Con', 'Alguien']]);
    check('sin columnas que sirvan, nada', parse('a,b\n1,2'), []);
  }

  section('CSV: «Guardar CSV» y vuelta');
  {
    const songs = [
      { title: '=', artist: 'Ed Sheeran', album: '=', duration: 200, spotifyId: '0000000000000000000009' },
      { title: '@ my worst', artist: 'blackbear', duration: 180 },
      { title: 'EARFQUAKE', artist: 'Tyler, The Creator', albumArtist: 'Tyler, The Creator', track: 2, year: 2019, cover: 'https://i.scdn.co/image/x' },
      { title: 'Grupo - Vídeo "en vivo"', artist: 'Canal, Oficial', duration: 213, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', fromYouTube: true },
    ];
    const text = frame.songsToCsv(songs);
    ok('lo que una hoja de cálculo tomaría por fórmula va protegido', /\n'=,Ed Sheeran,'=,/.test(text) && /\n'@ my worst,/.test(text), text);
    check('Frame lo vuelve a leer igual', parse(text), songs);
    check('nombres de carpeta', ["Rock 80's/90's", 'Workout: 2024', '..\\..\\x', 'CON', '  . . ', 'a'.repeat(120)].map(frame.safeFileName), ["Rock 80's 90's", 'Workout 2024', 'x', '_CON', '', 'a'.repeat(80)]);
    check('el primer artista de una lista', ['A;B', 'A, B', 'Tyler, The Creator;Otro', 'Earth, Wind & Fire, The Emotions', ''].map(frame.primaryArtist), ['A', 'A', 'Tyler, The Creator', 'Earth, Wind & Fire', '']);
  }
}
