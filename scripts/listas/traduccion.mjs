// La traducción de letras (lib/lyrics-translate.ts): cuándo se pide a la nube
// y cuándo no. El cupo es de 30 al día por cuenta y la IA es de todos.
// (Las letras de ejemplo son inventadas para la prueba.)
import { check, makeFrame, ok, section, settle } from './base.mjs';

const ES = [
  'Cuando la noche cae sobre la ciudad',
  'yo te espero en la esquina de siempre',
  'no me digas que ya no quieres volver',
  'porque sin ti no sé qué voy a hacer',
  'el tiempo pasa y todo sigue igual',
  'pero mi corazón no te puede olvidar',
  'dime si mañana vas a estar aquí',
  'que yo por ti lo dejo todo',
];
const EN = [
  'When the night comes down on the city',
  'I will wait for you at the corner we know',
  'do not tell me that you are never coming back',
  'because without you I do not know what to do',
  'the time goes by and nothing ever changes',
  'but my heart can not forget you',
  'tell me if tomorrow you will be here',
  'and I would leave it all for you',
];
const PT = [
  'Quando a noite cai sobre a cidade',
  'eu te espero na esquina de sempre',
  'não me diga que você não quer voltar',
  'porque sem você eu não sei o que fazer',
  'o tempo passa e tudo continua igual',
  'mas o meu coração não pode te esquecer',
  'me diz se amanhã você vai estar aqui',
  'que eu por você deixo tudo',
];
const RU = [
  'Когда ночь опускается на город',
  'я жду тебя на нашем старом месте',
  'не говори мне что ты не вернёшься',
  'потому что без тебя я не знаю что делать',
  'время идёт и всё остаётся прежним',
  'но моё сердце не может тебя забыть',
  'это всё ради тебя',
];
const UK = ['Коли ніч спускається на місто', 'я чекаю тебе на нашому старому місці', 'не кажи мені що ти не повернешся', 'бо без тебе я не знаю що робити', 'час іде і все залишається як було', 'але моє серце не може тебе забути'];
const JA = ['夜が街に降りてくるとき', 'いつもの角であなたを待っている', 'もう戻らないなんて言わないで', 'あなたがいないとどうしていいかわからない', '時は流れてすべては同じまま', 'でも私の心はあなたを忘れられない'];
const ZH = ['当夜晚降临在这座城市', '我在老地方等你', '不要告诉我你不会回来', '没有你我不知道该怎么办', '时间流逝一切如旧', '但我的心无法忘记你'];
const plain = (lines) => lines.map((line) => line.normalize('NFD').replace(/[̀-ͯ]/g, ''));

export async function translation() {
  section('Traducción: ¿ya está en el idioma de Frame?');
  {
    const { frame } = makeFrame();
    const same = frame.sameLanguage;
    check('español con Frame en español', same('es', ES), true);
    check('español escrito sin tildes', same('es', plain(ES)), true);
    check('inglés con Frame en español', same('es', EN), false);
    check('mitad y mitad: se pide (la IA deja como están las líneas en español)', same('es', [...ES.slice(0, 4), ...EN.slice(4)]), false);
    check('portugués no es español', same('es', PT), false);
    check('ni español es portugués', same('pt', ES), false);
    check('portugués con Frame en portugués', same('pt', PT), true);
    check('inglés con Frame en inglés', same('en', EN), true);
    check('con tarareos de por medio', same('es', [...ES, 'na na na na', 'oh oh oh', 'la la la la la']), true);
    check('ruso con Frame en ruso', same('ru', RU), true);
    check('ucraniano no es ruso', same('ru', UK), false);
    check('japonés con Frame en japonés', same('ja', JA), true);
    check('chino no es japonés', same('ja', ZH), false);
    check('una letra muy corta: ante la duda, se pide', same('es', ['Hola, mi amor']), false);
  }

  section('Traducción: cuándo se pide');
  {
    const { frame, probe, advance } = makeFrame();
    const asked = [];
    let answer = (lines) => new Response(JSON.stringify({ from: 'en', lines: lines.map((line) => `[es] ${line}`) }), { status: 200 });
    probe.nube = async (url, init) => {
      const body = JSON.parse(init.body);
      asked.push({ url, to: body.to, lines: body.lines.length, bearer: init.headers.authorization });
      return answer(body.lines);
    };
    let n = 0;
    const lyric = () => [...EN, `this is the song number ${++n} of the test`];
    const watch = (lines) => {
      const states = [];
      const stop = frame.watchTranslation(lines, 'es', (s) => states.push(s.status === 'done' ? `done:${s.map.size}` : s.status === 'error' ? `error:${s.message}` : s.status));
      return { states, stop };
    };

    const a = lyric();
    const skipped = watch(a);
    await settle();
    await advance(1000);
    skipped.stop();
    await advance(2000);
    check('pasar de canción antes de un segundo no gasta nada', [asked.length, skipped.states], [0, ['loading']]);

    const first = watch(a);
    await settle();
    await advance(1300);
    check('con la letra en pantalla, se pide una vez', [asked.length, first.states, asked[0]], [1, ['loading', 'done:9'], { url: 'https://nube.prueba/app/traducir', to: 'es', lines: 9, bearer: 'Bearer llave-de-prueba' }]);
    const again = watch(a);
    await settle();
    await advance(1300);
    check('la misma letra no se vuelve a pedir: está guardada en el equipo', [asked.length, again.states], [1, ['loading', 'done:9']]);
    ok('guardada con lo demás de Música, no en localStorage', [...probe.images.keys()].some((key) => key.startsWith('lyricsTr_es_')));

    const b = lyric();
    const two = [watch(b), watch(b)];
    await settle();
    await advance(1300);
    check('dos vistas de la misma letra, un solo pedido', [asked.length, two.map((w) => w.states.at(-1))], [2, ['done:9', 'done:9']]);

    answer = (lines) => new Response(JSON.stringify({ from: 'es', lines: lines.map((line) => `${line}.`) }), { status: 200 });
    const c = lyric();
    const same = watch(c);
    await settle();
    await advance(1300);
    const sameAgain = watch(c);
    await settle();
    await advance(1300);
    check('si la IA dice que ya estaba en el idioma, no se pintan retoques (y se recuerda)', [asked.length, same.states.at(-1), sameAgain.states.at(-1)], [3, 'same', 'same']);

    answer = () => new Response(JSON.stringify({ error: 'unusable' }), { status: 422 });
    const d = lyric();
    const bad = watch(d);
    await settle();
    await advance(1300);
    const badAgain = watch(d);
    await settle();
    await advance(1300);
    check('una letra con la que la IA no supo no se reintenta enseguida', [asked.length, bad.states.at(-1), badAgain.states], [4, 'error:No se pudo traducir esta letra.', ['loading', 'error:No se pudo traducir esta letra.']]);

    answer = () => new Response(JSON.stringify({ error: 'busy' }), { status: 503 });
    const e = lyric();
    const busy = watch(e);
    await settle();
    await advance(1300);
    const busySoon = watch(e);
    await settle();
    await advance(1300);
    check('la IA ocupada: no se insiste al momento', [asked.length, busy.states.at(-1), busySoon.states.at(-1)], [5, 'error:No se pudo traducir la letra ahora. Inténtalo de nuevo.', 'error:No se pudo traducir la letra ahora. Inténtalo de nuevo.']);
    await advance(3 * 60_000);
    answer = (lines) => new Response(JSON.stringify({ from: 'en', lines: lines.map((line) => `[es] ${line}`) }), { status: 200 });
    const busyLater = watch(e);
    await settle();
    await advance(1300);
    check('pasado un rato, sí', [asked.length, busyLater.states.at(-1)], [6, 'done:9']);

    probe.nube = async () => {
      asked.push({ offline: true });
      throw new TypeError('Failed to fetch');
    };
    const f = lyric();
    const offline = watch(f);
    await settle();
    await advance(1300);
    check('sin red se dice en claro (no «Failed to fetch»)', offline.states.at(-1), 'error:Sin conexión: la traducción necesita internet.');
    probe.nube = async (url, init) => {
      asked.push({ retry: true });
      return new Response(JSON.stringify({ from: 'en', lines: JSON.parse(init.body).lines.map((line) => `[es] ${line}`) }), { status: 200 });
    };
    const online = watch(f);
    await settle();
    await advance(1300);
    check('y al volver la red se pide', [asked.length, online.states.at(-1)], [8, 'done:9']);

    probe.session = false;
    const noSession = watch(lyric());
    await settle();
    await advance(1300);
    check('sin entrar con una cuenta no se llama a la nube', [asked.length, noSession.states.at(-1)], [8, 'error:Entra con tu cuenta para traducir letras.']);
    probe.session = true;

    probe.nube = async () => {
      asked.push({ quota: true });
      return new Response(JSON.stringify({ error: 'quota', limit: 30 }), { status: 429 });
    };
    const full = watch(lyric());
    await settle();
    await advance(1300);
    const after = watch(lyric());
    await settle();
    await advance(1300);
    check('agotado el cupo del día, no se pide más hoy', [asked.length, full.states.at(-1), after.states], [9, 'error:Ya tradujiste 30 letras hoy. Mañana puedes seguir.', ['loading', 'error:Ya tradujiste 30 letras hoy. Mañana puedes seguir.']]);
    await advance(24 * 3600_000);
    probe.nube = async (url, init) => {
      asked.push({ nextDay: true });
      return new Response(JSON.stringify({ from: 'en', lines: JSON.parse(init.body).lines.map((line) => `[es] ${line}`) }), { status: 200 });
    };
    const tomorrow = watch(lyric());
    await settle();
    await advance(1300);
    check('al día siguiente, otra vez', [asked.length, tomorrow.states.at(-1)], [10, 'done:9']);

    const spanish = watch(ES);
    await settle();
    await advance(1300);
    check('una letra en español con Frame en español ni se manda', [asked.length, spanish.states], [10, ['same']]);
  }
}
