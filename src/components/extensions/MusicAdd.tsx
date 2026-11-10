import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, FileDown, FileUp, Link2, ListMusic, LoaderCircle, Pause, Play, Plus, RefreshCw, RotateCcw, Weight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import GoogleEmbed from '@/components/integrations/GoogleEmbed';
import { useCourse } from '@/context/CourseContext';
import type { ExtensionManifest, MusicSourceContribution } from '@/lib/extensions/manifest';
import { EngineClient, parseSongsCsv, safeFileName, songBytes, youtubeId, type CsvSong } from '@/lib/extensions/yt-mp3';
import { engineError, ensureEngine, useEngineStep } from '@/lib/extensions/engine-app';
import {
  addCsvDownloads,
  addVideoDownload,
  cancelDownloads,
  clearFinishedDownloads,
  describeDownload,
  formatEta,
  isActive,
  isFinished,
  libraryMatcher,
  pauseDownloads,
  preciseBytes,
  probeDownload,
  removeDownload,
  resumeDownloads,
  retryDownloads,
  sizeParts,
  startDownloads,
  summarizeDownloads,
  useDownloads,
  type DownloadItem,
} from '@/lib/extensions/yt-mp3-downloads';
import { formatVideoDuration, readYoutubeVideo, youtubeIdFromUrl } from '@/lib/study-videos';
import { LinkError, readPlaylistLink, SERVICE_NAME, songsToCsv, type LinkService, type PartialReason } from '@/lib/extensions/playlist-link';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { decodeTextFile } from '@/lib/lyrics';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Música → «+ Añadir», con una fuente de música «yt-mp3/1». Desde la 1.9.0
// es una PÁGINA de Música (/music/anadir), no una ventana emergente (Diego):
//
//   ← Música   Añadir música
//   ┌──────────────── YouTube (3/5) ────────────────┬──── cola (2/5) ────┐
//   │                                                │ [+ Añadir][Iniciar]│
//   │   YouTube de verdad, incrustado                │ tarjetas (portada ·│
//   │                                                │ vídeo · canal ·    │
//   │                                                │ peso), con barra   │
//   └────────────────────────────────────────────────┴────────────────────┘
//   [enlace de una playlist · Leer la lista] [Elegir un CSV]
//     → resumen de lo que se bajará → [Guardar CSV] [Iniciar descarga]
//
// Desde la 1.9.2 la lista se puede leer de su enlace (Spotify, Deezer,
// YouTube Music, Apple Music; lib/extensions/playlist-link.ts), sin exportar
// nada en el navegador, y el CSV admite los formatos de varias apps.
//
// «Añadir» toma el vídeo abierto en YouTube. La descarga la hace el programa
// de la fuente, en MP3 de 320 kbps con la portada y la letra oficiales, y la
// cola (lib/extensions/yt-mp3-downloads.ts) la importa al terminar. Salir de
// la página no detiene nada: el avance se ve en Música, junto a «Aleatorio».
// ============================================================

type EngineState = 'checking' | 'up' | 'down' | 'outdated';

/** Alto común de YouTube y de la cola: casi toda la ventana. */
const BOX = 'h-[clamp(420px,calc(100vh-17rem),960px)]';
/** Más filas que esto en un CSV no se toman. */
const CSV_LIMIT = 1000;

interface CsvChoice {
  /** Nombre del archivo, o de la lista leída de su enlace. */
  file: string;
  songs: CsvSong[];
  playlist: string;
  truncated: boolean;
  /** Leída de su enlace en este servicio. */
  from?: LinkService;
  /** No llegó entera: el servicio enseña solo las primeras por enlace, o una página no llegó. */
  partial?: PartialReason;
}

/** Nombre de archivo sin los caracteres que Windows no admite. */
const fileSafe = (name: string) => safeFileName(name) || 'Playlist';

/** Nombre de playlist a partir del archivo («mi_lista.csv» → «Mi lista»). */
function playlistNameOf(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : tr('Descargas');
}

const durationText = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return tr('{m} min', { m: Math.max(1, minutes) });
  return minutes % 60 ? tr('{h} h {m} min', { h: Math.floor(minutes / 60), m: minutes % 60 }) : tr('{h} h', { h: minutes / 60 });
};

export default function MusicAdd({ id, manifest, source }: { id: string; manifest: ExtensionManifest; source: MusicSourceContribution }) {
  const navigate = useNavigate();
  const { songs } = useCourse();
  const downloads = useDownloads();
  const summary = useMemo(() => summarizeDownloads(downloads), [downloads]);
  const client = useMemo(() => new EngineClient(source.page), [source.page]);
  const [engine, setEngine] = useState<EngineState>('checking');
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [csv, setCsv] = useState<CsvChoice | null>(null);
  const [csvError, setCsvError] = useState<string | null>(null);
  const [link, setLink] = useState('');
  const [reading, setReading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const saveCopy = useSaveCopy();
  /** «¿Ya está en la biblioteca?», preparado una vez para todas las preguntas. */
  const inLibrary = useMemo(() => libraryMatcher(songs), [songs]);
  const [sizesShown, setSizesShown] = useState<Set<string>>(() => new Set());
  const listRef = useRef<HTMLUListElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const name = manifest.name;

  const step = useEngineStep();

  // Abierto y al día antes de nada: si está cerrado, Frame lo abre; si falta
  // o es viejo, lo instala o lo actualiza (engine-app.ts).
  const check = useCallback(
    async (force = false) => {
      setEngine('checking');
      setEngine(await ensureEngine(id, client, force));
    },
    [id, client]
  );

  useEffect(() => {
    void check();
  }, [check]);

  /** Archivos de este equipo: Música abre el explorador (su importación de siempre). */
  const local = (folder: boolean) => navigate('/music', { state: { importLocal: folder ? 'folder' : 'files' } });

  // El aviso se va solo.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // «Cancelar todo» pide un segundo clic, y la pregunta se retira sola.
  useEffect(() => {
    if (!confirmCancel) return;
    const timer = window.setTimeout(() => setConfirmCancel(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirmCancel]);

  // Si el programa se cae a mitad, la cola lo dice; al volver, se ve aquí.
  const engineProblem = downloads.problem === 'engine' || downloads.problem === 'outdated' ? downloads.problem : null;
  const shownEngine: EngineState = engine === 'up' && engineProblem ? (engineProblem === 'engine' ? 'down' : 'outdated') : engine;

  const items = downloads.items;
  const pending = items.filter((item) => item.state === 'pending').length;
  const finished = items.filter(isFinished).length;
  const unfinished = items.length - finished;
  /** Por qué la cola está parada sin que nadie la parara. */
  const queueNote =
    downloads.pausedWhy === 'failing'
      ? tr('La cola se pausó sola: varias descargas seguidas fallaron ({error}). Revisa tu conexión, o espera un rato si YouTube las está frenando, y pulsa «Reanudar».', {
          // (El detalle es el del programa de descargas, en su idioma: sin su «ERROR:» y sin alargarse.)
          error: (downloads.pausedDetail ?? tr('La descarga falló.')).replace(/^ERROR:\s*/i, '').slice(0, 110),
        })
      : downloads.pausedWhy === 'storage'
        ? tr('La cola se pausó sola: {error}. Libera espacio y pulsa «Reanudar».', { error: downloads.pausedDetail ?? tr('el disco del equipo se quedó sin espacio') })
        : downloads.problem === 'offline' && summary.active && !downloads.paused
          ? tr('Sin conexión: la cola espera y sigue sola cuando vuelva.')
          : null;
  const scrollToEnd = () =>
    window.setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 60);

  /** «Añadir»: el vídeo abierto en YouTube, como tarjeta. */
  const add = async () => {
    setAdding(true);
    setNotice(null);
    try {
      const url = await invoke<string>('youtube_embed_current_url');
      const videoId = youtubeIdFromUrl(url) ?? youtubeId(url);
      if (!videoId) {
        setNotice(tr('Abre primero el vídeo que quieres añadir: esta página no es un vídeo.'));
        return;
      }
      const item = addVideoDownload(id, videoId);
      if (!item) {
        setNotice(tr('Ese vídeo ya está en la cola.'));
        return;
      }
      scrollToEnd();
      // Título, canal y duración al momento; título y artista de la canción,
      // duración exacta y peso del audio, del programa.
      void readYoutubeVideo(videoId)
        .then((info) => describeDownload(item.id, { videoTitle: info.title, channel: info.uploader, duration: info.duration }))
        .catch(() => undefined);
      void probeDownload(item.id);
    } catch (error) {
      setNotice(errorText(String(error).replace(/^(Error:\s*|Invoke error:\s*)/i, '')).slice(0, 180) || tr('No se pudo leer el vídeo.'));
    } finally {
      setAdding(false);
    }
  };

  const onCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setCsvError(null);
    if (file.size > 10 * 1024 * 1024) {
      setCsvError(tr('Ese archivo pesa demasiado para ser una lista de canciones.'));
      return;
    }
    try {
      const text = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
      const list = parseSongsCsv(text, CSV_LIMIT);
      if (list.length === 0) {
        setCsvError(tr('Ese CSV no tiene canciones que Frame entienda: hace falta una columna con el título (y, mejor, otra con el artista) o con el enlace de YouTube.'));
        return;
      }
      setCsv({ file: file.name, songs: list, playlist: playlistNameOf(file.name), truncated: list.length >= CSV_LIMIT });
    } catch (error) {
      setCsvError(errorText(error).slice(0, 180));
    }
  };

  // (Por las canciones, no por `csv`: escribir el nombre de la playlist no lo recalcula.)
  const csvSongs = csv?.songs;
  const csvSummary = useMemo(() => {
    if (!csvSongs) return null;
    let seconds = 0;
    let known = 0;
    let bytes = 0;
    let have = 0;
    let linked = 0;
    for (const song of csvSongs) {
      if (song.duration) {
        seconds += song.duration;
        known += 1;
      }
      if (song.url) linked += 1;
      const videoId = song.url ? youtubeId(song.url) ?? undefined : undefined;
      // (De una lista de YouTube, su título y su artista son los del vídeo: solo vale su vídeo.)
      const wanted = song.fromYouTube ? { title: '', artist: '', videoId } : { title: song.title, artist: song.artist, duration: song.duration, videoId, spotifyId: song.spotifyId };
      if (inLibrary(wanted)) have += 1;
      else bytes += songBytes(song.duration ?? 210);
    }
    return { seconds, known, bytes, inLibrary: have, linked };
  }, [csvSongs, inLibrary]);

  /** «Leer la lista»: las canciones de una playlist por su enlace. Lo que no se puede leer, se dice. */
  const readLink = async () => {
    if (reading || !link.trim()) return;
    setReading(true);
    setCsvError(null);
    try {
      const list = await readPlaylistLink(link, CSV_LIMIT);
      setCsv({
        file: list.name || SERVICE_NAME[list.service],
        songs: list.songs,
        // (El nombre viene del servicio: como mucho, lo que admite el campo.)
        playlist: list.name.slice(0, 80),
        truncated: list.songs.length >= CSV_LIMIT,
        from: list.service,
        partial: list.partial,
      });
      setLink('');
    } catch (error) {
      setCsvError(error instanceof LinkError ? error.message : errorText(error).slice(0, 180));
    } finally {
      setReading(false);
    }
  };

  /** «Guardar CSV»: la lista leída, en Descargas (Frame la vuelve a leer igual). */
  const saveCsv = () => {
    if (!csv) return;
    void saveCopy(new Blob([songsToCsv(csv.songs)], { type: 'text/csv' }), `${fileSafe(csv.playlist || csv.file)}.csv`);
  };

  const startCsv = () => {
    if (!csv) return;
    // De un enlace, sin nombre (una canción suelta) no entra en ninguna playlist.
    const { added, repeated } = addCsvDownloads(id, csv.songs, csv.from ? csv.playlist.trim() : csv.playlist.trim() || playlistNameOf(csv.file));
    setNotice(
      added === 0
        ? tr('Esas canciones ya están en la cola.')
        : repeated === 1
          ? tr('1 ya estaba en la cola: no se repite.')
          : repeated > 1
            ? tr('{count} ya estaban en la cola: no se repiten.', { count: repeated })
            : null
    );
    setCsv(null);
    scrollToEnd();
  };

  const toggleSize = (itemId: string) =>
    setSizesShown((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex items-center gap-3">
        <Button variant="ghost" size="sm" className="shrink-0 rounded-full" onClick={() => navigate('/music')}>
          <ArrowLeft />
          {tr('Música')}
        </Button>
        <ExtensionIcon id={id} manifest={manifest} />
        <div className="min-w-0 flex-1">
          <h1 className="font-headline text-2xl font-bold text-primary">{tr('Añadir música')}</h1>
          <p className="text-xs text-muted-foreground">
            {tr('Abre una canción en YouTube y pulsa «Añadir». {name} la descarga en MP3 de 320 kbps con su portada y su letra oficiales.', { name })}
          </p>
        </div>
      </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          {/* YouTube de verdad, a la izquierda: 3/5 del ancho */}
          <div className={cn('relative min-w-0 overflow-hidden rounded-lg border border-border/60 bg-muted/30 lg:col-span-3', BOX)}>
            <GoogleEmbed kind="youtube" heightClass="absolute inset-0" />
          </div>

          {/* Cola de descargas: 2/5 */}
          <section className={cn('flex min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-2 lg:col-span-2', BOX)}>
            <div className="flex shrink-0 flex-wrap gap-2 [&>*]:min-w-fit [&>*]:flex-1">
              <Button onClick={() => void add()} disabled={adding} title={tr('Añadir el vídeo que tienes abierto en YouTube')}>
                {adding ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {tr('Añadir')}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  startDownloads();
                  scrollToEnd();
                }}
                disabled={pending === 0 || shownEngine !== 'up'}
                title={pending === 0 ? tr('Añade primero alguna canción') : tr('Descargar todas las canciones sin empezar')}
              >
                <Download className="mr-2 h-4 w-4" />
                {tr('Iniciar descarga')}
              </Button>
            </div>

            {notice && <p className="shrink-0 rounded-md bg-primary/10 px-2 py-1.5 text-[11px] text-foreground">{notice}</p>}
            {queueNote && (
              <p role="status" className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-foreground">
                {queueNote}
              </p>
            )}

            {shownEngine !== 'up' && (
              <div className="flex shrink-0 items-center gap-2 rounded-md border border-dashed border-border/70 px-2 py-1.5 text-[11px] text-muted-foreground">
                {shownEngine === 'checking' ? (
                  <>
                    <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    {step === 'installing'
                      ? tr('Instalando {name} en este equipo (solo esta vez)…', { name })
                      : step === 'updating'
                        ? tr('Poniendo al día {name}…', { name })
                        : step === 'starting'
                          ? tr('Abriendo {name}…', { name })
                          : tr('Buscando {name} en este equipo…', { name })}
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1">
                      {shownEngine === 'down'
                        ? tr('{name} no responde en este equipo. Frame lo vuelve a intentar solo; la cola sigue donde iba.', { name })
                        : tr('{name} necesita ponerse al día y aún no se pudo. Frame lo vuelve a intentar solo; la cola sigue donde iba.', { name })}
                      {engineError(id) === 'store'
                        ? ` ${tr('En la versión de la Microsoft Store, Frame no instala programas: instala {name} por tu cuenta y Frame lo abrirá y lo usará solo.', { name })}`
                        : engineError(id)
                          ? ` ${tr('Último intento: {error}', { error: errorText(engineError(id)!) })}`
                          : ''}
                    </span>
                    <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void check(true)}>
                      <RefreshCw className="mr-1 h-3 w-3" />
                      {tr('Reintentar')}
                    </Button>
                  </>
                )}
              </div>
            )}

            <ul ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" aria-label={tr('Cola de descargas')}>
              {items.length === 0 ? (
                <li className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
                  <Plus className="h-5 w-5 text-primary/70" />
                  {tr('Abre una canción en YouTube, a la izquierda, y pulsa «Añadir». También puedes pegar abajo el enlace de una playlist o subir un CSV.')}
                </li>
              ) : (
                items.map((item) => (
                  <QueueCard
                    key={item.id}
                    item={item}
                    engineName={name}
                    paused={downloads.paused}
                    sizeShown={sizesShown.has(item.id)}
                    onToggleSize={() => toggleSize(item.id)}
                    inLibrary={
                      item.state === 'pending' &&
                      item.origin === 'video' &&
                      !!inLibrary({ title: item.title, artist: item.artist, duration: item.duration, videoId: item.videoId })
                    }
                  />
                ))
              )}
            </ul>

            {(summary.active || finished > 0) && (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
                <span className="min-w-[11rem] flex-1 truncate tabular-nums">
                  {summary.active
                    ? [
                        summary.total === 1
                          ? tr('{done} de 1 lista', { done: summary.done + summary.skipped })
                          : tr('{done} de {total} listas', { done: summary.done + summary.skipped, total: summary.total }),
                        `${Math.floor(summary.progress * 100)} %`,
                        downloads.paused ? tr('en pausa') : summary.eta != null ? tr('faltan {eta}', { eta: formatEta(summary.eta) }) : tr('calculando el tiempo…'),
                      ].join(' · ')
                    : finished === 1
                      ? tr('1 terminada')
                      : tr('{count} terminadas', { count: finished })}
                </span>
                {summary.active ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={cn('h-6 shrink-0 px-2 text-[11px]', confirmCancel && 'bg-destructive/15 text-foreground hover:bg-destructive/25')}
                      onClick={() => {
                        if (confirmCancel) cancelDownloads();
                        setConfirmCancel(!confirmCancel);
                      }}
                      title={tr('Quitar de la cola todo lo que no ha terminado. Lo ya descargado se queda en tu biblioteca.')}
                    >
                      <X className="mr-1 h-3 w-3" />
                      {!confirmCancel ? tr('Cancelar todo') : unfinished === 1 ? tr('¿Quitar la que falta?') : tr('¿Quitar las {count} que faltan?', { count: unfinished })}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void (downloads.paused ? resumeDownloads() : pauseDownloads())}>
                      {downloads.paused ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
                      {downloads.paused ? tr('Reanudar') : tr('Pausar')}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={clearFinishedDownloads}>
                    {tr('Quitar las terminadas')}
                  </Button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* CSV */}
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          className="hidden"
          onChange={(event) => void onCsvFile(event)}
        />
        {csv && csvSummary ? (
          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
            <div className="flex items-center gap-2">
              {csv.from ? <Link2 className="h-4 w-4 shrink-0 text-primary" /> : <FileUp className="h-4 w-4 shrink-0 text-primary" />}
              <p className="min-w-0 flex-1 truncate font-semibold text-foreground" title={csv.file}>
                {csv.file}
                {csv.from && csv.file !== SERVICE_NAME[csv.from] && <span className="font-normal text-muted-foreground"> · {SERVICE_NAME[csv.from]}</span>}
              </p>
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => (csv.from ? setCsv(null) : fileRef.current?.click())}>
                {csv.from ? tr('Otra lista') : tr('Elegir otro')}
              </Button>
            </div>
            <ul className="grid gap-x-6 gap-y-1 text-muted-foreground sm:grid-cols-2">
              <li>
                <span className="font-semibold text-foreground">{csv.songs.length}</span>{' '}
                {csv.songs.length === 1 ? tr('canción') : tr('canciones')}
                {csvSummary.known > 0 && ` · ${durationText(csvSummary.seconds)}`}
                {csvSummary.known > 0 && csvSummary.known < csv.songs.length && ` (${tr('de {count} con duración', { count: csvSummary.known })})`}
              </li>
              <li>
                {tr('Peso estimado:')} <span className="font-semibold text-foreground">≈ {preciseBytes(csvSummary.bytes)}</span>{' '}
                {tr('(MP3 de 320 kbps con portada, letra y datos)')}
              </li>
              <li>
                {csvSummary.inLibrary === 0
                  ? tr('Ninguna está aún en tu biblioteca.')
                  : csvSummary.inLibrary === 1
                    ? tr('1 ya está en tu biblioteca: no se vuelve a bajar.')
                    : tr('{count} ya están en tu biblioteca: no se vuelven a bajar.', { count: csvSummary.inLibrary })}
              </li>
              <li>
                {csvSummary.linked === csv.songs.length
                  ? tr('Todas traen su enlace de YouTube.')
                  : csvSummary.linked === 0
                    ? tr('Cada una se busca en YouTube (la versión de estudio, por título, artista y duración).')
                    : tr('{linked} traen su enlace de YouTube; {search} se buscan.', { linked: csvSummary.linked, search: csv.songs.length - csvSummary.linked })}
              </li>
              {csv.truncated && <li className="text-destructive">{tr('Solo se toman las primeras {count} canciones.', { count: CSV_LIMIT })}</li>}
              {csv.partial && csv.from && !csv.truncated && (
                <li className="text-amber-600 dark:text-amber-400 sm:col-span-2">
                  {csv.partial === 'failed'
                    ? tr('Se leyeron las primeras {count} canciones y el resto no llegó. Vuelve a leer la lista más tarde: lo ya descargado no se repite.', {
                        count: csv.songs.length,
                      })
                    : csv.from === 'apple'
                      ? tr(
                          'Apple Music solo enseña por enlace las primeras {count} canciones de una lista. Para tenerla entera, pásala a un CSV (con TuneMyMusic o Soundiiz, o con «Exportar playlist» de iTunes) y elige aquí ese archivo.',
                          { count: csv.songs.length }
                        )
                      : tr('{service} solo enseña por enlace las primeras {count} canciones de una lista. Para tenerla entera, usa su CSV (por ejemplo, de Exportify).', {
                          service: SERVICE_NAME[csv.from],
                          count: csv.songs.length,
                        })}
                </li>
              )}
            </ul>
            <label className="flex items-center gap-2 text-muted-foreground">
              <span className="shrink-0">{tr('Playlist:')}</span>
              <Input
                value={csv.playlist}
                onChange={(event) => setCsv({ ...csv, playlist: event.target.value })}
                className="h-7 max-w-xs text-xs"
                maxLength={80}
              />
              <span className="hidden truncate text-[11px] sm:inline">{csv.from ? tr('en el orden de la lista') : tr('en el orden del CSV')}</span>
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="gris" onClick={() => setCsv(null)}>
                {tr('Quitar')}
              </Button>
              {csv.from && (
                <Button size="sm" variant="outline" onClick={saveCsv} title={tr('Guardar la lista como CSV en Descargas')}>
                  <FileDown className="mr-2 h-4 w-4" />
                  {tr('Guardar CSV')}
                </Button>
              )}
              <Button size="sm" onClick={startCsv} disabled={shownEngine !== 'up'}>
                <Download className="mr-2 h-4 w-4" />
                {tr('Iniciar descarga')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void readLink();
              }}
            >
              <label className="flex h-10 min-w-[16rem] flex-1 items-center gap-2 rounded-md border border-input bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring">
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={link}
                  onChange={(event) => {
                    setLink(event.target.value);
                    setCsvError(null);
                  }}
                  placeholder={tr('Pega el enlace de una playlist de Spotify, Deezer, YouTube Music o Apple Music')}
                  aria-label={tr('Enlace de una playlist')}
                  className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                  spellCheck={false}
                />
              </label>
              <Button type="submit" disabled={reading || !link.trim()}>
                {reading ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <ListMusic className="mr-2 h-4 w-4" />}
                {reading ? tr('Leyendo…') : tr('Leer la lista')}
              </Button>
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" />
                {tr('Elegir un CSV')}
              </Button>
            </form>
            <p className={cn('text-[11px]', csvError ? 'text-destructive' : 'text-muted-foreground')}>
              {csvError ??
                tr('Frame lee la lista (o un CSV de Exportify, TuneMyMusic, Soundiiz, Google Takeout o Apple Music) y baja cada canción en MP3 de 320 kbps con su portada, su letra y sus datos, dentro de su playlist.')}
            </p>
          </div>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          {tr('Puedes salir de esta página: la descarga sigue y su avance se ve en Música, junto a «Aleatorio».')}
          {' '}
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => local(false)}>
            {tr('Añadir archivos locales')}
          </button>
          {' · '}
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => local(true)}>
            {tr('una carpeta')}
          </button>
        </p>
    </div>
  );
}

// ------------------------------------------------------------
// Tarjeta de la cola
// ------------------------------------------------------------

function statusText(item: DownloadItem, engineName: string, paused: boolean): string {
  const percent = () => {
    const total = item.sourceBytes ?? 0;
    const share = total > 0 ? Math.min(1, item.downloaded / total) : Math.min(1, item.progress / 0.9);
    return `${Math.floor(share * 100)} %`;
  };
  if (paused && isActive(item) && item.state !== 'importing') {
    return item.state === 'downloading' ? `${tr('En pausa')} · ${percent()}` : tr('En pausa');
  }
  switch (item.state) {
    case 'pending':
      return item.duration ? `${formatVideoDuration(item.duration)} · ${tr('Sin empezar')}` : tr('Sin empezar');
    case 'waiting':
      return item.retryAt ? tr('No salió a la primera: se reintenta sola en un momento') : tr('En espera');
    case 'resolving':
      return item.videoId ? tr('Buscando su portada y su letra…') : tr('Buscando la canción en YouTube…');
    case 'queued':
      return tr('En la cola de {name}', { name: engineName });
    case 'downloading':
      // yt-dlp tarda unos segundos en arrancar antes del primer byte.
      if (!item.downloaded && !item.progress) return tr('Conectando con YouTube…');
      return item.speed > 0 ? `${percent()} · ${preciseBytes(item.speed)}/s` : percent();
    case 'converting':
      return tr('Convirtiendo a MP3 de 320 kbps…');
    case 'importing':
      return tr('Entrando en tu biblioteca…');
    case 'done':
      return [
        tr('En tu biblioteca'),
        item.officialCover ? tr('portada oficial') : item.hasCover ? tr('portada del vídeo') : tr('sin portada'),
        item.hasLyrics ? (item.synced ? tr('letra sincronizada') : tr('letra')) : tr('sin letra'),
      ].join(' · ');
    case 'skipped':
      return tr('Ya estaba en tu biblioteca');
    case 'nomatch':
      return tr('No se encontró una versión fiable en YouTube');
    case 'failed':
      return item.error || tr('La descarga falló.');
  }
}

function QueueCard({
  item,
  engineName,
  paused,
  sizeShown,
  onToggleSize,
  inLibrary,
}: {
  item: DownloadItem;
  engineName: string;
  paused: boolean;
  sizeShown: boolean;
  onToggleSize: () => void;
  inLibrary: boolean;
}) {
  const title = item.origin === 'video' ? item.videoTitle || item.title : item.title || item.videoTitle;
  const subtitle = item.origin === 'video' ? item.channel || item.artist : [item.artist, item.album].filter(Boolean).join(' · ');
  const parts = sizeParts(item);
  const bar =
    item.state === 'downloading' || item.state === 'converting' || item.state === 'importing'
      ? item.state === 'downloading'
        ? Math.min(1, item.sourceBytes ? item.downloaded / item.sourceBytes : item.progress / 0.9)
        : 1
      : null;
  const bad = item.state === 'failed' || item.state === 'nomatch';
  const noDownload = item.state === 'skipped' || item.state === 'nomatch';

  return (
    <li className="group rounded-md border border-border/50 bg-background/70 p-1.5">
      <div className="flex items-center gap-2">
        <div className="h-9 w-16 shrink-0 overflow-hidden rounded bg-muted">
          {item.image && <img src={item.image} alt="" className="h-full w-full object-cover" loading="lazy" draggable={false} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground" title={title}>
            {title || (item.videoId ? tr('Leyendo el vídeo…') : '—')}
          </p>
          <p className="truncate text-[11px] text-muted-foreground" title={subtitle}>
            {subtitle || ' '}
          </p>
          <p
            className={cn('truncate text-[10px] tabular-nums', bad ? 'text-destructive' : item.state === 'done' ? 'text-primary' : 'text-muted-foreground')}
            title={item.error}
          >
            {inLibrary ? tr('Ya está en tu biblioteca: no se volverá a bajar') : statusText(item, engineName, paused)}
          </p>
        </div>
        {bad && (
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => retryDownloads([item.id])} title={tr('Reintentar')}>
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
          onClick={() => removeDownload(item.id)}
          title={isActive(item) ? tr('Cancelar y quitar de la cola') : tr('Quitar de la cola')}
          aria-label={tr('Quitar de la cola')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant={sizeShown ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7 shrink-0 gap-1 px-1.5 text-[11px] tabular-nums"
          onClick={onToggleSize}
          aria-pressed={sizeShown}
          title={tr('Peso de la descarga')}
        >
          <Weight className="h-3.5 w-3.5" />
          {sizeShown && !noDownload && <span>{parts.exact ? '' : '≈ '}{preciseBytes(parts.total)}</span>}
        </Button>
      </div>
      {bar != null && (
        <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full bg-primary transition-[width] duration-700', item.state !== 'downloading' && 'animate-pulse')}
            style={{ width: `${Math.round(bar * 100)}%` }}
          />
        </div>
      )}
      {sizeShown && (
        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
          {noDownload
            ? tr('No se descarga: no ocupa espacio.')
            : item.finalBytes
              ? tr('{size} en disco: el MP3 de 320 kbps con su portada, su letra y sus datos.', { size: preciseBytes(item.finalBytes) })
              : [
                  tr('MP3 de 320 kbps: {size}', { size: preciseBytes(parts.audio) }),
                  item.coverBytes != null
                    ? item.coverBytes > 0
                      ? tr('portada: {size}', { size: preciseBytes(parts.cover) })
                      : tr('sin portada')
                    : tr('portada: ≈ {size}', { size: preciseBytes(parts.cover) }),
                  item.lyricsBytes != null
                    ? item.lyricsBytes > 0
                      ? tr('letra: {size}', { size: preciseBytes(parts.lyrics) })
                      : tr('sin letra')
                    : tr('letra: ≈ {size}', { size: preciseBytes(parts.lyrics) }),
                  tr('datos: 2 KB'),
                ].join(' · ') + (parts.durationKnown ? '' : ` ${tr('(aún sin su duración)')}`)}
        </p>
      )}
    </li>
  );
}
