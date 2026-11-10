// Qué vídeo es la canción (lib/extensions/yt-mp3-match.ts): mejor «no
// encontrada» que otra canción u otra versión.
import { check, makeFrame, ok, section } from './base.mjs';

const video = (title, channel, duration, id = 'abcdefghijk') => ({ id, url: `https://www.youtube.com/watch?v=${id}`, title, channel, duration, thumbnail: '' });
const THRESHOLD = 25;

export async function matching() {
  const { frame } = makeFrame();
  const score = (entry, song) => frame.scoreCandidate(entry, song);
  const accepted = (entry, song) => (score(entry, song) ?? -999) >= THRESHOLD;

  section('Emparejar: la canción');
  {
    const song = { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 };
    ok('el audio del disco («Topic»), con su duración', accepted(video('Mr. Brightside', 'The Killers - Topic', 223), song));
    ok('el vídeo oficial, medio minuto más largo', accepted(video('The Killers - Mr. Brightside (Official Music Video)', 'TheKillersVEVO', 250), song));
    ok('un vídeo con letra de otro canal, con el artista en el título', accepted(video('The Killers - Mr. Brightside (Lyrics)', 'Letras', 222), song));
    ok('sin duración en la lista, basta el vídeo oficial', accepted(video('The Killers - Mr. Brightside (Official Music Video)', 'TheKillersVEVO', 250), { ...song, duration: 0 }));
    ok('el título del CSV con su coletilla («- Remastered 2011»)', accepted(video('Bohemian Rhapsody (Remastered 2011)', 'Queen - Topic', 355), { title: 'Bohemian Rhapsody - Remastered 2011', artist: 'Queen', duration: 354 }));
    ok('un artista con paréntesis («BTS (방탄소년단)»)', accepted(video('BTS - Dynamite (Official MV)', 'HYBE LABELS', 223), { title: 'Dynamite', artist: 'BTS (방탄소년단)', duration: 199 }));
    ok('cualquiera de varios artistas', accepted(video('Shakira - TQG (Official Video)', 'Shakira', 200), { title: 'TQG', artist: 'KAROL G, Shakira', duration: 198 }));
  }

  section('Emparejar: lo que no es la canción');
  {
    const song = { title: 'Hallelujah', artist: 'Jeff Buckley', duration: 414 };
    check('un cover, aunque dure lo mismo', score(video('Jeff Buckley - Hallelujah (Cover by Alguien)', 'Alguien', 414), song), null);
    check('la misma canción en directo', score(video('Jeff Buckley - Hallelujah (Live at Sin-é)', 'Jeff Buckley', 420), song), null);
    check('el «Topic» de otro artista con el mismo título', score(video('Hallelujah', 'Pentatonix - Topic', 414), song), null);
    ok('otro artista, sin más señales', !accepted(video('Hallelujah', 'Canal cualquiera', 400), song));
    check('un audio que dura un minuto más', score(video('Jeff Buckley - Hallelujah', 'Jeff Buckley', 480), song), null);
    check('un «Topic» que no lleva el título, aunque dure igual', score(video('Lover, You Should’ve Come Over', 'Jeff Buckley - Topic', 414), song), null);
    check('el título como parte de otra palabra', score(video('Othello - Acto 1', 'Teatro', 300), { title: 'Hello', artist: '', duration: 300 }), null);
    ok('otra grabación en el «Topic» (medio minuto de diferencia)', !accepted(video('Hallelujah', 'Jeff Buckley - Topic', 445), song));
    check('una palabra de otra versión en el nombre del artista no cuenta', accepted(video('Cover Drive - Twilight (Official Video)', 'CoverDriveVEVO', 215), { title: 'Twilight', artist: 'Cover Drive', duration: 213 }), true);
    check('la versión pedida sí vale', accepted(video('Coldplay - Fix You (Live in São Paulo)', 'Coldplay', 320), { title: 'Fix You - Live in São Paulo', artist: 'Coldplay', duration: 318 }), true);
    check('un título de una letra, sin duración', score(video('Artista - A Sky Full of Stars', 'Artista', 260), { title: 'A', artist: 'Artista', duration: 0 }), null);
  }

  section('Emparejar: otros alfabetos');
  {
    const song = { title: '夜に駆ける', artist: 'YOASOBI', duration: 261 };
    ok('japonés: el título se comprueba', accepted(video('YOASOBI「夜に駆ける」 Official Music Video', 'Ayase / YOASOBI', 259), song));
    check('y no vale cualquier vídeo que dure igual', score(video('群青', 'YOASOBI - Topic', 261), song), null);
    ok('cirílico', accepted(video('Кино - Группа крови', 'Кино - Topic', 285), { title: 'Группа крови', artist: 'Кино', duration: 285 }));
    ok('coreano', accepted(video('아이유 - 밤편지 (Through the Night)', '아이유 - Topic', 253), { title: '밤편지', artist: '아이유', duration: 253 }));
    check('una versión cantada por otros (歌ってみた)', score(video('夜に駆ける 歌ってみた', 'だれか', 261), song), null);
  }

  section('Emparejar: entre varios resultados');
  {
    const song = { title: 'Stay', artist: 'Rihanna', duration: 0 };
    const exact = score(video('Rihanna - Stay ft. Mikky Ekko', 'RihannaVEVO', 240), song) ?? -999;
    const other = score(video('Rihanna - Stay With Me Tonight', 'RihannaVEVO', 240), song) ?? -999;
    ok('gana el vídeo cuyo título es el de la canción, no el que solo lo contiene', exact > other, `${exact} frente a ${other}`);
    const searches = [];
    const client = {
      search: async (q) => {
        searches.push(q);
        return q.endsWith('audio') ? [video('The Killers - Mr. Brightside (Official Audio)', 'The Killers', 222, 'bbbbbbbbbbb')] : [video('Algo que no es', 'Nadie', 100, 'aaaaaaaaaaa')];
      },
    };
    const found = await frame.findSongVideo(client, { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 });
    check('si la primera búsqueda no da nada fiable, prueba otra', [found?.id ?? null, searches.length], ['bbbbbbbbbbb', 2]);
    const none = await frame.findSongVideo({ search: async () => [video('Mr. Brightside (Karaoke)', 'Karaoke', 222)] }, { title: 'Mr. Brightside', artist: 'The Killers', duration: 222 });
    check('y si nada es fiable, nada', none, null);
  }
}
