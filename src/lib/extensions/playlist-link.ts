import { invoke, isTauri } from '@tauri-apps/api/core';
import { getLang, tr } from '@/lib/i18n';
import { watchUrl, youtubeId, type CsvSong } from '@/lib/extensions/yt-mp3';

// ============================================================
// Playlists por enlace (1.9.2, Música → Añadir). Se pega el enlace de una
// lista (o de un álbum, una canción o un vídeo) y sus canciones quedan como
// si vinieran de un CSV, sin abrir el navegador ni exportar nada. Solo se lee
// lo que el servicio enseña a cualquiera, sin cuenta ni llave de nadie, desde
// el núcleo nativo (comando `playlist_page`, sin CORS y con una lista cerrada
// de servicios):
//
//   · Spotify: la página para insertar la lista en una web. Enseña hasta 100
//     canciones; para las más largas, su CSV (Exportify). Leer más allá pide
//     entrar con una cuenta y una app registrada en Spotify: Frame no usa la
//     llave anónima de esa página para pedirle el resto a su servicio interno.
//   · Deezer: su API pública, entera, página a página.
//   · YouTube y YouTube Music: la página de la lista y, en las largas, las
//     páginas siguientes, como las pide el propio sitio al bajar. Un vídeo
//     suelto, por su ficha pública (oEmbed).
//   · Apple Music: los datos de la página (las canciones que enseña).
//
// Lo que no se puede leer se dice con su motivo (lista privada, vacía, una
// mezcla de YouTube, otro servicio…): nunca un botón que no hace nada.
// ============================================================

export type LinkService = 'spotify' | 'deezer' | 'youtube' | 'apple';

export const SERVICE_NAME: Record<LinkService, string> = {
  spotify: 'Spotify',
  deezer: 'Deezer',
  youtube: 'YouTube',
  apple: 'Apple Music',
};

/** Por qué una lista no llegó entera: el servicio enseña solo las primeras por enlace, o una página no llegó. */
export type PartialReason = 'limit' | 'failed';

export interface LinkPlaylist {
  service: LinkService;
  /** Nombre de la lista o del álbum ('' para una canción suelta). */
  name: string;
  songs: CsvSong[];
  /** Si no está entera, por qué. */
  partial?: PartialReason;
}

type Kind = 'playlist' | 'album' | 'track';

type Target =
  | { service: 'spotify' | 'deezer'; kind: Kind; id: string }
  /** Una lista, un vídeo, o un vídeo dentro de una lista (entonces, la lista; y si no se puede leer, el vídeo). */
  | { service: 'youtube'; list?: string; video?: string }
  | { service: 'apple'; url: string }
  | { service: 'short'; url: string };

// Lo que llega de los servicios no tiene forma fija: se lee con cuidado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

interface Page {
  url: string;
  status: number;
  body: string;
}

/** Un error con el mensaje para la persona. */
export class LinkError extends Error {}

const fail = (message: string): never => {
  throw new LinkError(message);
};

const notFound = () => fail(tr('Esa lista no existe o es privada. Hazla pública (o compártela con enlace) y vuelve a intentarlo.'));
const emptyList = () => fail(tr('Esa lista está vacía.'));
const unreadable = (service: LinkService) => fail(tr('{service} cambió su página y Frame no pudo leer la lista. Usa su CSV mientras tanto.', { service: SERVICE_NAME[service] }));

// ------------------------------------------------------------
// El enlace
// ------------------------------------------------------------

const TRAILING = /[.,;:!?)\]}»"']+$/;

/** El enlace dentro de lo pegado: «Mira esta lista: https://… 🎶» → el enlace. */
function linkIn(text: string): string {
  const raw = text.trim();
  const uri = raw.match(/spotify:(?:playlist|album|track):[A-Za-z0-9]{22}/);
  if (uri) return uri[0];
  const url = raw.match(/https?:\/\/[^\s<>"'«»]+/i)?.[0];
  if (url) return url.replace(TRAILING, '');
  // Sin «https://»: la primera palabra con pinta de dirección.
  const bare = raw.split(/\s+/).find((word) => /^[a-z0-9-]+(\.[a-z0-9-]+)+\/\S/i.test(word));
  return bare ? `https://${bare.replace(TRAILING, '')}` : raw;
}

/** Servicios de música que Frame conoce pero no lee por enlace. */
const OTHER_SERVICES: [RegExp, string][] = [
  [/(^|\.)tidal\.com$/, 'TIDAL'],
  [/(^|\.)music\.amazon\.[a-z.]+$/, 'Amazon Music'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)qobuz\.com$/, 'Qobuz'],
  [/(^|\.)napster\.com$/, 'Napster'],
  [/(^|\.)audiomack\.com$/, 'Audiomack'],
  [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)pandora\.com$/, 'Pandora'],
  [/(^|\.)music\.yandex\.[a-z.]+$/, 'Yandex Music'],
];

const notALink = () => tr('Ese enlace no es de una playlist, un álbum o una canción de Spotify, Deezer, YouTube o Apple Music.');
const otherKind = (service: LinkService) => tr('De {service}, Frame lee playlists, álbumes y canciones: ese enlace es de otra cosa.', { service: SERVICE_NAME[service] });

/** Listas de YouTube que son solo de quien las mira: «Me gusta», «Ver más tarde», la música que te gusta. */
const PERSONAL_LISTS = new Set(['LL', 'WL', 'LM']);
const ownList = () => tr('Esa lista de YouTube es solo tuya (tus «Me gusta» o «Ver más tarde») y no tiene enlace público. Pon sus vídeos en una playlist pública o no listada y pega su enlace.');
const mixList = () => tr('Las mezclas y radios de YouTube cambian con cada persona: no son una lista que se pueda leer. Pega el enlace de una playlist o de un vídeo.');

/** Qué es un enlace: lo que hay que leer, o el motivo (para la persona) por el que no se puede. */
function resolve(text: string): Target | string {
  const link = linkIn(text);
  const uri = link.match(/^spotify:(playlist|album|track):([A-Za-z0-9]{22})$/);
  if (uri) return { service: 'spotify', kind: uri[1] as Kind, id: uri[2] };
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return notALink();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return notALink();
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const path = url.pathname;

  if (host === 'open.spotify.com' || host === 'play.spotify.com') {
    const m = path.match(/\/(playlist|album|track)\/([A-Za-z0-9]{22})(?:\/|$)/);
    if (m) return { service: 'spotify', kind: m[1] as Kind, id: m[2] };
    if (/\/collection(\/|$)/.test(path)) return tr('Tus canciones guardadas de Spotify no tienen enlace público. Ponlas en una playlist y pega su enlace.');
    return otherKind('spotify');
  }
  if (['spotify.link', 'spotify.app.link', 'link.deezer.com', 'deezer.page.link'].includes(host)) {
    return { service: 'short', url: `https://${host}${path}${url.search}` };
  }
  if (host === 'deezer.com') {
    const m = path.match(/\/(playlist|album|track)\/(\d{1,20})(?:\/|$)/);
    return m ? { service: 'deezer', kind: m[1] as Kind, id: m[2] } : otherKind('deezer');
  }
  if (host === 'youtube.com' || host === 'music.youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
    const listed = url.searchParams.get('list') ?? '';
    const video = youtubeId(url.toString()) ?? undefined;
    const personal = PERSONAL_LISTS.has(listed);
    const list = !personal && /^[A-Za-z0-9_-]{10,80}$/.test(listed) ? listed : undefined;
    if (list || video) return { service: 'youtube', list, video };
    if (personal) return ownList();
    return tr('De YouTube, Frame lee playlists (su enlace lleva «list=») y vídeos. Usa «Compartir» y pega ese enlace.');
  }
  if (host === 'music.apple.com') {
    if (/^\/library(\/|$)/.test(path)) {
      return tr('Ese enlace es de tu biblioteca de Apple Music y solo se abre con tu cuenta. En la playlist, elige Compartir → Copiar enlace y pega ese.');
    }
    return /\/(playlist|album|song)\//.test(path) ? { service: 'apple', url: `https://music.apple.com${path}${url.search}` } : otherKind('apple');
  }
  const other = OTHER_SERVICES.find(([pattern]) => pattern.test(host))?.[1];
  if (other) {
    return tr('Frame aún no lee listas de {service} por su enlace. Pásala a un CSV (con TuneMyMusic o Soundiiz) y elige aquí ese archivo.', { service: other });
  }
  return notALink();
}

// ------------------------------------------------------------
// Pedir y leer
// ------------------------------------------------------------

async function page(url: string, body?: unknown): Promise<Page> {
  try {
    return await invoke<Page>('playlist_page', { url, body: body === undefined ? null : JSON.stringify(body) });
  } catch {
    return fail(tr('No se pudo leer la lista. Revisa la conexión e inténtalo de nuevo.'));
  }
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** Texto con entidades HTML («&amp;», «&#39;») como texto normal. */
function decodeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,6});/gi, (whole, code: string) => {
    const c = code.toLowerCase();
    if (c[0] !== '#') return ENTITIES[c] ?? whole;
    const n = c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
  });
}

const metaTitle = (html: string) => decodeHtml(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/)?.[1] ?? '').trim();

/** Primer objeto que cumple `test`, a cualquier profundidad. */
function findFirst(node: Json, test: (o: Json) => boolean, depth = 0): Json | null {
  if (!node || typeof node !== 'object' || depth > 40) return null;
  if (!Array.isArray(node) && test(node)) return node;
  for (const value of Array.isArray(node) ? node : Object.values(node)) {
    const hit = findFirst(value, test, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** Todos los objetos que cumplen `test` (sin entrar en ellos). */
function findAll(node: Json, test: (o: Json) => boolean, out: Json[] = [], depth = 0): Json[] {
  if (!node || typeof node !== 'object' || depth > 40) return out;
  if (!Array.isArray(node) && test(node)) {
    out.push(node);
    return out;
  }
  for (const value of Array.isArray(node) ? node : Object.values(node)) findAll(value, test, out, depth + 1);
  return out;
}

/** Texto en una línea, sin espacios duros ni de más. */
const clean = (value: unknown) => String(value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const yearOf = (value: unknown) => {
  const year = Number(String(value ?? '').slice(0, 4));
  return year > 1900 && year < 2100 ? year : undefined;
};

/** La canción como la de un CSV: sin los campos vacíos, pero siempre con título y artista (aunque sea ''). */
function song(fields: CsvSong): CsvSong {
  const filled = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined && v !== '' && v !== 0)) as Partial<CsvSong>;
  return { ...filled, title: clean(fields.title), artist: clean(fields.artist) };
}

// ------------------------------------------------------------
// Spotify: la página para insertar
// ------------------------------------------------------------

/** Lo más que enseña la página de una lista. */
const SPOTIFY_SHOWN = 100;

/**
 * Los artistas de «Artista, Otro»: Spotify los separa con coma y ESPACIO DURO,
 * así que una coma normal es parte del nombre («Tyler, The Creator»).
 */
const spotifyArtists = (subtitle: unknown) =>
  String(subtitle ?? '')
    .split(/, /)
    .map(clean)
    .filter(Boolean);

async function spotify(kind: Kind, id: string): Promise<LinkPlaylist> {
  const res = await page(`https://open.spotify.com/embed/${kind}/${id}`);
  if (res.status === 404) notFound();
  const raw = res.body.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  let props: Json = null;
  try {
    props = raw ? JSON.parse(raw)?.props?.pageProps : null;
  } catch {
    /* abajo */
  }
  const entity: Json = props?.state?.data?.entity ?? null;
  // Una lista privada o borrada contesta 200 con una página de «no encontrada».
  if (!entity) return res.status >= 400 || Number(props?.status) === 404 ? notFound() : unreadable('spotify');
  const artistsOf = (t: Json): string[] =>
    Array.isArray(t.artists) ? t.artists.map((a: Json) => clean(a?.name)).filter(Boolean) : spotifyArtists(t.subtitle);
  const list: Json[] = kind === 'track' ? [entity] : Array.isArray(entity.trackList) ? entity.trackList : [];
  const albumName = kind === 'album' ? clean(entity.name ?? entity.title) : '';
  const albumArtist = kind === 'album' ? spotifyArtists(entity.subtitle)[0] ?? '' : '';
  const songs = list
    .map((t, index) =>
      song({
        title: clean(t.title ?? t.name),
        artist: artistsOf(t)[0] ?? '',
        album: albumName || undefined,
        albumArtist: albumArtist || undefined,
        track: kind === 'album' ? index + 1 : undefined,
        year: yearOf((t.releaseDate ?? (kind === 'album' ? entity.releaseDate : null))?.isoString),
        duration: Number(t.duration) > 0 ? Number(t.duration) / 1000 : undefined,
        spotifyId: String(t.uri ?? '').match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1],
      })
    )
    .filter((s) => s.title);
  return {
    service: 'spotify',
    name: kind === 'track' ? '' : clean(entity.name ?? entity.title),
    songs,
    // Por lo que trae la página, no por lo que queda tras limpiar.
    ...(kind !== 'track' && list.length >= SPOTIFY_SHOWN ? { partial: 'limit' as const } : {}),
  };
}

// ------------------------------------------------------------
// Deezer: la API pública
// ------------------------------------------------------------

async function deezerJson(path: string): Promise<Json> {
  const res = await page(`https://api.deezer.com/${path}`);
  let data: Json;
  try {
    data = JSON.parse(res.body);
  } catch {
    return unreadable('deezer');
  }
  if (data?.error) {
    // 800: no existe. OAuthException (200, 300): es privada y pide la cuenta de su dueño.
    const code = Number(data.error.code);
    const gone = code === 800 || code === 200 || code === 300 || data.error.type === 'OAuthException';
    return gone ? notFound() : fail(tr('Deezer no respondió. Inténtalo de nuevo en un momento.'));
  }
  return data;
}

async function deezer(kind: Kind, id: string, limit: number): Promise<LinkPlaylist> {
  const songOf = (t: Json, album: Json, index?: number) =>
    song({
      title: clean(t?.title),
      artist: clean(t?.artist?.name),
      album: clean(t?.album?.title ?? album?.title) || undefined,
      albumArtist: clean(album?.artist?.name) || undefined,
      track: Number(t?.track_position) > 0 ? Number(t.track_position) : index !== undefined ? index + 1 : undefined,
      year: yearOf(album?.release_date ?? t?.release_date),
      duration: Number(t?.duration) > 0 ? Number(t.duration) : undefined,
      cover: String(t?.album?.cover_xl ?? album?.cover_xl ?? '').startsWith('https://') ? String(t?.album?.cover_xl ?? album?.cover_xl) : undefined,
    });
  if (kind === 'track') {
    const t = await deezerJson(`track/${id}`);
    return { service: 'deezer', name: '', songs: [songOf(t, t.album)].filter((s) => s.title) };
  }
  const info = await deezerJson(`${kind}/${id}`);
  const songs: CsvSong[] = [];
  let cut = false;
  for (let index = 0; songs.length < limit && index < 2000; index += 100) {
    let pageData: Json;
    try {
      pageData = await deezerJson(`${kind}/${id}/tracks?limit=100&index=${index}`);
    } catch (error) {
      // La primera página es la lista; si falla una posterior, vale lo ya leído (y se dice).
      if (songs.length === 0) throw error;
      cut = true;
      break;
    }
    const data: Json[] = Array.isArray(pageData?.data) ? pageData.data : [];
    data.forEach((t, i) => {
      const s = songOf(t, kind === 'album' ? info : null, kind === 'album' ? index + i : undefined);
      if (s.title && songs.length < limit) songs.push(s);
    });
    if (data.length < 100 || !pageData?.next) break;
  }
  return { service: 'deezer', name: clean(info?.title), songs, ...(cut ? { partial: 'failed' as const } : {}) };
}

// ------------------------------------------------------------
// YouTube y YouTube Music: la página de la lista
// ------------------------------------------------------------

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

function textOf(node: Json): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.content === 'string') return node.content;
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: Json) => r?.text ?? '').join('');
  return '';
}

const clockSeconds = (text: string) => {
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : undefined;
};

interface YtVideo {
  id: string;
  title: string;
  channel: string;
  seconds?: number;
}

/** El vídeo de un elemento de la lista (el diseño de 2025 y el de antes). */
function videoOf(item: Json): YtVideo | null {
  const lockup = item?.lockupViewModel;
  if (lockup && YT_ID.test(lockup.contentId ?? '') && (!lockup.contentType || lockup.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')) {
    const meta = lockup.metadata?.lockupMetadataViewModel;
    const rows: Json[] = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const badge = findFirst(lockup.contentImage, (o) => typeof o?.thumbnailBadgeViewModel?.text === 'string');
    return {
      id: lockup.contentId,
      title: clean(textOf(meta?.title)),
      channel: clean(textOf(rows[0]?.metadataParts?.[0]?.text)),
      seconds: badge ? clockSeconds(badge.thumbnailBadgeViewModel.text) : undefined,
    };
  }
  const legacy = item?.playlistVideoRenderer;
  if (legacy && YT_ID.test(legacy.videoId ?? '')) {
    return {
      id: legacy.videoId,
      title: clean(textOf(legacy.title)),
      channel: clean(textOf(legacy.shortBylineText)),
      seconds: Number(legacy.lengthSeconds) || undefined,
    };
  }
  return null;
}

/** La lista de vídeos más larga de la respuesta y la ficha para pedir la siguiente página. */
function videoList(root: Json): { videos: YtVideo[]; next: string | null } {
  let best: Json[] = [];
  let bestCount = 0;
  const walk = (node: Json, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      const count = node.reduce((n: number, x: Json) => n + (videoOf(x) ? 1 : 0), 0);
      if (count > bestCount) {
        best = node;
        bestCount = count;
      }
      node.forEach((x) => walk(x, depth + 1));
      return;
    }
    Object.values(node).forEach((x) => walk(x, depth + 1));
  };
  walk(root, 0);
  const videos = best.map(videoOf).filter((v): v is YtVideo => !!v);
  const tail = best.find((x) => !videoOf(x) && findFirst(x, (o) => typeof o?.continuationCommand?.token === 'string'));
  const next = tail ? findFirst(tail, (o) => typeof o?.continuationCommand?.token === 'string').continuationCommand.token : null;
  return { videos, next };
}

const songOfVideo = (v: YtVideo) =>
  song({ title: v.title, artist: v.channel.replace(/\s+-\s+Topic$/i, ''), url: watchUrl(v.id), duration: v.seconds, fromYouTube: true });

/** Un vídeo suelto, por su ficha pública. Sin ficha (no deja insertarse), entra igual: lo demás lo dice el programa al bajarlo. */
async function youtubeVideo(id: string): Promise<LinkPlaylist> {
  const res = await page(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`);
  if (res.status === 404 || res.status === 400) fail(tr('Ese vídeo no existe o es privado.'));
  let info: Json = null;
  try {
    info = JSON.parse(res.body);
  } catch {
    /* sin ficha */
  }
  return {
    service: 'youtube',
    name: '',
    songs: [songOfVideo({ id, title: clean(info?.title) || tr('Vídeo de YouTube'), channel: clean(info?.author_name) })],
  };
}

async function youtube(list: string, video: string | undefined, limit: number): Promise<LinkPlaylist> {
  const lang = getLang();
  const res = await page(`https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=${lang}`);
  // Fuera de la lista de servicios no se sigue: el aviso de cookies de algunos países.
  if (res.status >= 300 && res.status < 400 && /(^|\/\/)consent\.(youtube|google)\.com\//.test(res.url)) {
    return fail(tr('YouTube pide aceptar sus condiciones antes de enseñar la lista, y Frame no puede hacerlo por ti. Añade los vídeos desde YouTube, aquí arriba, o usa un CSV.'));
  }
  if (res.status === 404) return video ? youtubeVideo(video) : notFound();
  const raw = res.body.match(/ytInitialData\s*=\s*(\{[\s\S]+?\});\s*<\/script>/)?.[1];
  let data: Json = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* abajo */
  }
  if (!data) return video ? youtubeVideo(video) : unreadable('youtube');
  let { videos, next } = videoList(data);
  if (videos.length === 0) {
    // «La playlist no existe», «No se puede visualizar este tipo de playlist» (una mezcla)…
    const refused = Array.isArray(data.alerts) && data.alerts.some((a: Json) => a?.alertRenderer?.type === 'ERROR');
    if (video) return youtubeVideo(video);
    if (!refused) return emptyList();
    return list.startsWith('RD') ? fail(mixList()) : notFound();
  }
  const name =
    clean(data.metadata?.playlistMetadataRenderer?.title) ||
    clean(textOf(data.microformat?.microformatDataRenderer?.title)) ||
    metaTitle(res.body).replace(/\s*-\s*YouTube$/, '');
  const version = res.body.match(/"INNERTUBE_CLIENT_VERSION":"([\d.]+)"/)?.[1] ?? '2.20260101.00.00';
  const seen = new Set<string>();
  const out: YtVideo[] = [];
  const keep = (batch: YtVideo[]) => {
    for (const item of batch) {
      // Los vídeos privados o borrados («[Vídeo privado]») no se pueden bajar.
      // (Solo un corchete que lo abarca todo: «[MV] Grupo – Canción [4K]» es un título.)
      if (seen.has(item.id) || /^\[[^\]]*\]$/.test(item.title)) continue;
      seen.add(item.id);
      if (out.length < limit) out.push(item);
    }
  };
  keep(videos);
  let cut = false;
  for (let round = 0; next && out.length < limit; round++) {
    // (Tope de vueltas: 30 páginas de 100 es más que el límite de canciones.)
    if (round >= 30) break;
    let json: Json = null;
    try {
      const more = await page('https://www.youtube.com/youtubei/v1/browse?prettyPrint=false', {
        context: { client: { clientName: 'WEB', clientVersion: version, hl: lang } },
        continuation: next,
      });
      json = more.status === 200 ? JSON.parse(more.body) : null;
    } catch {
      /* abajo: vale lo ya leído, y se dice */
    }
    const following = json ? videoList(json?.onResponseReceivedActions ?? json) : null;
    if (!following || following.videos.length === 0) {
      cut = true;
      break;
    }
    ({ videos, next } = following);
    keep(videos);
  }
  if (out.length === 0) return emptyList();
  return { service: 'youtube', name, songs: out.map(songOfVideo), ...(cut ? { partial: 'failed' as const } : {}) };
}

// ------------------------------------------------------------
// Apple Music: los datos de su página
// ------------------------------------------------------------

/** Lo más que enseña la página de una lista. */
const APPLE_SHOWN = 100;

async function apple(url: string, limit: number): Promise<LinkPlaylist> {
  const res = await page(url);
  if (res.status === 404) notFound();
  const raw = res.body.match(/<script[^>]*id="serialized-server-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let data: Json = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    /* abajo */
  }
  if (!data) return res.status >= 400 ? notFound() : unreadable('apple');
  const isAlbum = /\/album\//.test(url);
  const only = new URL(url).searchParams.get('i');
  /** Una canción suelta (su página, o «?i=» dentro de un álbum): no es una lista. */
  const single = !!only || /\/song\//.test(url);
  // Nombre, artista, año y portada del álbum: los datos estructurados de la página.
  let ld: Json = null;
  try {
    ld = JSON.parse(res.body.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? 'null');
  } catch {
    /* sin ellos, el título de la página */
  }
  const pageName = clean(ld?.name) || metaTitle(res.body).replace(/\s+(on|en|em|auf|sur|su)\s+Apple\s+Music$/i, '');
  const albumName = pageName.replace(/\s+-\s+(Single|EP)$/i, '');
  const albumArtist = isAlbum ? clean((Array.isArray(ld?.byArtist) ? ld.byArtist[0] : ld?.byArtist)?.name) : '';
  const albumCover =
    isAlbum && typeof ld?.image === 'string' && /^https:\/\/[a-z0-9-]+\.mzstatic\.com\/image\/thumb\//.test(ld.image)
      ? ld.image.replace(/\/[^/]+$/, '/1000x1000bb.jpg')
      : undefined;
  const lockups = findAll(data, (o) => typeof o?.title === 'string' && typeof o?.artistName === 'string' && typeof o?.duration === 'number');
  const seen = new Set<string>();
  const songs: CsvSong[] = [];
  let shown = 0;
  for (const t of lockups) {
    const songId = String(t.contentDescriptor?.identifiers?.storeAdamID ?? t.id ?? '');
    if (seen.has(songId)) continue;
    seen.add(songId);
    shown += 1;
    if ((only && songId !== only) || songs.length >= limit) continue;
    const art = String(t.artwork?.dictionary?.url ?? '');
    // El primer artista, por su enlace: «Simon & Garfunkel» o «Tyler, The Creator»
    // son uno solo, y partir el texto «Drake & Don Toliver» no lo distingue.
    const first = Array.isArray(t.subtitleLinks) ? clean(t.subtitleLinks[0]?.title) : '';
    const s = song({
      title: clean(t.title),
      artist: first || clean(t.artistName),
      album: isAlbum ? albumName || undefined : clean(t.tertiaryLinks?.[0]?.title).replace(/\s+-\s+(Single|EP)$/i, '') || undefined,
      albumArtist: albumArtist || undefined,
      track: Number(t.trackNumber) > 0 ? Number(t.trackNumber) : undefined,
      year: isAlbum ? yearOf(ld?.datePublished) : undefined,
      duration: t.duration > 0 ? t.duration / 1000 : undefined,
      cover: art.startsWith('https://') ? art.replace('{w}x{h}bb.{f}', '1000x1000bb.jpg').replace(/\{[a-z]+\}/g, '') : albumCover,
    });
    if (s.title) songs.push(s);
  }
  if (shown === 0 || (only && songs.length === 0)) return notFound();
  return {
    service: 'apple',
    name: single ? '' : isAlbum ? albumName : pageName,
    songs,
    // La página enseña las primeras; el resto lo carga la web con su clave.
    ...(!isAlbum && !single && shown >= APPLE_SHOWN ? { partial: 'limit' as const } : {}),
  };
}

// ------------------------------------------------------------
// Entrada
// ------------------------------------------------------------

/**
 * Las canciones de una lista por su enlace. Lanza `LinkError` con el
 * mensaje para la persona si el enlace no sirve o el servicio no responde.
 */
export async function readPlaylistLink(text: string, limit = 1000): Promise<LinkPlaylist> {
  if (!isTauri()) fail(tr('Leer una lista por su enlace funciona en la app de Frame.'));
  let found = resolve(text);
  if (typeof found !== 'string' && found.service === 'short') {
    // Enlace corto: adonde lleva o, si contesta con una página, el enlace largo que trae dentro.
    const res = await page(found.url);
    const landed = resolve(res.url);
    // (En la página puede venir como texto de un script, con las barras escapadas.)
    const html = decodeHtml(res.body).replace(/\\\//g, '/');
    const long = html.match(/https:\/\/(?:open\.spotify\.com|(?:www\.)?deezer\.com)\/[^"'\s<>\\]*?(?:playlist|album|track)\/[A-Za-z0-9]+/)?.[0];
    const inside = long ? resolve(long) : notALink();
    found = typeof landed !== 'string' && landed.service !== 'short' ? landed : typeof inside !== 'string' && inside.service !== 'short' ? inside : notALink();
  }
  if (typeof found === 'string') return fail(found);
  const target = found;
  const result =
    target.service === 'spotify'
      ? await spotify(target.kind, target.id)
      : target.service === 'deezer'
        ? await deezer(target.kind, target.id, limit)
        : target.service === 'youtube'
          ? target.list
            ? await youtube(target.list, target.video, limit)
            : await youtubeVideo(target.video!)
          : await apple((target as { url: string }).url, limit);
  if (result.songs.length === 0) emptyList();
  return { ...result, songs: result.songs.slice(0, limit) };
}

// ------------------------------------------------------------
// «Guardar CSV»
// ------------------------------------------------------------

const csvCell = (value: unknown) => {
  let text = value === undefined || value === null ? '' : String(value);
  // Una hoja de cálculo toma por fórmula lo que empieza así («=», «@ my worst»): con
  // un apóstrofo delante lo lee como texto, y Frame lo quita al leerlo (yt-mp3.ts).
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * La lista como CSV con las columnas de Exportify (Frame lo vuelve a leer
 * igual). Lo de una lista de YouTube va sin título ni artista, con el del
 * vídeo y su canal aparte: al leerlo otra vez, la canción la dice YouTube Music.
 */
export function songsToCsv(songs: CsvSong[]): string {
  const header = [
    'Track Name',
    'Artist Name(s)',
    'Album Name',
    'Album Artist Name(s)',
    'Track Number',
    'Duration (ms)',
    'Album Release Date',
    'Album Image URL',
    'Track URI',
    'URL',
    'Video Title',
    'Channel',
  ];
  const lines = songs.map((s) =>
    [
      s.fromYouTube ? '' : s.title,
      s.fromYouTube ? '' : s.artist,
      s.album,
      s.albumArtist,
      s.track,
      s.duration ? Math.round(s.duration * 1000) : '',
      s.year,
      s.cover,
      s.spotifyId ? `spotify:track:${s.spotifyId}` : '',
      s.url,
      s.fromYouTube ? s.title : '',
      s.fromYouTube ? s.artist : '',
    ]
      .map(csvCell)
      .join(',')
  );
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}
