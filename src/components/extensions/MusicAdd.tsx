import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Download, FileAudio, FileDown, FileUp, FolderOpen, Link2, ListMusic, LoaderCircle, Music, Pause, Play, RefreshCw, RotateCcw, Weight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import { useCourse } from '@/context/CourseContext';
import type { ExtensionManifest, MusicSourceContribution } from '@/lib/extensions/manifest';
import { EngineClient, parseSongsCsv, safeFileName, songBytes, thumbnailUrl, youtubeId, type CsvSong } from '@/lib/extensions/yt-mp3';
import { engineError, ensureEngine, useEngineStep } from '@/lib/extensions/engine-app';
import {
  addCsvDownloads,
  cancelDownloads,
  clearFinishedDownloads,
  formatEta,
  isActive,
  isFinished,
  libraryMatcher,
  pauseDownloads,
  preciseBytes,
  removeDownload,
  resumeDownloads,
  retryDownloads,
  sizeParts,
  startDownloads,
  summarizeDownloads,
  useDownloads,
  type DownloadItem,
} from '@/lib/extensions/yt-mp3-downloads';
import { formatVideoDuration } from '@/lib/study-videos';
import { LinkError, readPlaylistLink, SERVICE_NAME, songsToCsv, type LinkService, type PartialReason } from '@/lib/extensions/playlist-link';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { decodeTextFile } from '@/lib/lyrics';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Música → «+ Añadir», con una fuente de música «yt-mp3/1»: una PÁGINA de
// Música (/music/anadir). Desde la 1.9.4 (Diego: fácil e intuitiva) son dos
// mitades y casi nada de texto:
//
//   ← Música                         [CSV] [Archivos] [Carpeta]
//   ┌────────── enlace ──────────┬───────── descargas ─────────┐
//   │ [ pega un enlace        → ] │ tarjetas (portada · título · │
//   │                             │ estado), con su barra        │
//   │ una canción: portada, datos │                              │
//   │ y [Descargar]               │                              │
//   │ una lista: cuántas, cuánto  │                              │
//   │ dura, cuánto pesa y         │                              │
//   │ [Descargar]                 │              [Pausar] [...]  │
//   └─────────────────────────────┴──────────────────────────────┘
//
// El enlace puede ser de un vídeo de YouTube o de una canción, un álbum o una
// playlist de Spotify, Deezer, YouTube Music o Apple Music
// (lib/extensions/playlist-link.ts); se lee al pegarlo. Un CSV de Exportify,
// TuneMyMusic, Soundiiz, Takeout o iTunes entra por su botón y se ve igual.
// Ya no hay YouTube incrustado ni «Añadir» / «Iniciar descarga»: «Descargar»
// lo pone en la cola y empieza.
//
// La descarga la hace el programa de la fuente, en MP3 de 320 kbps con la
// portada y la letra oficiales, y la cola (lib/extensions/yt-mp3-downloads.ts)
// la importa al terminar. Salir de la página no detiene nada: el avance se ve
// en Música, junto a «Aleatorio».
// ============================================================

type EngineState = 'checking' | 'up' | 'down' | 'outdated';

/** Alto común de las dos mitades: casi toda la ventana. */
const BOX = 'lg:h-[clamp(420px,calc(100vh-11rem),960px)]';
/** Más filas que esto en un CSV no se toman. */
const CSV_LIMIT = 1000;
/** Los servicios cuyos enlaces se leen, para enseñarlos bajo la barra. */
const SERVICES = ['YouTube', 'Spotify', 'Deezer', 'Apple Music', 'YouTube Music'];

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
  /** El último enlace mandado a leer: si llega otro antes, su respuesta ya no cuenta. */
  const readTurn = useRef(0);
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

  // Lo que quedó «sin empezar» de una versión anterior (había un botón aparte
  // para iniciarlo) empieza solo: aquí «Descargar» ya lo hace todo.
  useEffect(() => {
    if (pending > 0 && shownEngine === 'up') startDownloads();
  }, [pending, shownEngine]);

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

  const onCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    readTurn.current += 1;
    setReading(false);
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
    for (const song of csvSongs) {
      if (song.duration) {
        seconds += song.duration;
        known += 1;
      }
      const videoId = song.url ? youtubeId(song.url) ?? undefined : undefined;
      // (De una lista de YouTube, su título y su artista son los del vídeo: solo vale su vídeo.)
      const wanted = song.fromYouTube ? { title: '', artist: '', videoId } : { title: song.title, artist: song.artist, duration: song.duration, videoId, spotifyId: song.spotifyId };
      if (inLibrary(wanted)) have += 1;
      else bytes += songBytes(song.duration ?? 210);
    }
    return { seconds, known, bytes, inLibrary: have };
  }, [csvSongs, inLibrary]);

  /** Lee lo que hay tras un enlace: una canción, un álbum o una playlist. Lo que no se puede leer, se dice. */
  const readLink = async (text: string) => {
    const wanted = text.trim();
    if (!wanted) return;
    const mine = ++readTurn.current;
    setReading(true);
    setCsvError(null);
    setCsv(null);
    try {
      const list = await readPlaylistLink(wanted, CSV_LIMIT);
      if (readTurn.current !== mine) return;
      setCsv({
        file: list.name || SERVICE_NAME[list.service],
        songs: list.songs,
        // (El nombre viene del servicio: como mucho, lo que admite el campo.)
        playlist: list.name.slice(0, 80),
        truncated: list.songs.length >= CSV_LIMIT,
        from: list.service,
        partial: list.partial,
      });
    } catch (error) {
      if (readTurn.current === mine) setCsvError(error instanceof LinkError ? error.message : errorText(error).slice(0, 180));
    } finally {
      if (readTurn.current === mine) setReading(false);
    }
  };

  /** Quita lo leído y deja la barra lista para otro enlace. */
  const clear = () => {
    readTurn.current += 1;
    setReading(false);
    setCsv(null);
    setCsvError(null);
    setLink('');
  };

  /** «Guardar CSV»: la lista leída, en Descargas (Frame la vuelve a leer igual). */
  const saveCsv = () => {
    if (!csv) return;
    void saveCopy(new Blob([songsToCsv(csv.songs)], { type: 'text/csv' }), `${fileSafe(csv.playlist || csv.file)}.csv`);
  };

  /** «Descargar»: a la cola, y empieza. */
  const download = () => {
    if (!csv) return;
    // De un enlace, sin nombre (una canción suelta) no entra en ninguna playlist.
    const { added, repeated } = addCsvDownloads(id, csv.songs, csv.from ? csv.playlist.trim() : csv.playlist.trim() || playlistNameOf(csv.file));
    setNotice(
      added === 0
        ? csv.songs.length === 1
          ? tr('Esa canción ya está en la cola.')
          : tr('Esas canciones ya están en la cola.')
        : repeated === 1
          ? tr('1 ya estaba en la cola: no se repite.')
          : repeated > 1
            ? tr('{count} ya estaban en la cola: no se repiten.', { count: repeated })
            : null
    );
    clear();
    scrollToEnd();
  };

  const toggleSize = (itemId: string) =>
    setSizesShown((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });

  /** Una sola canción (no un CSV): se enseña con su portada, no como una lista. */
  const single = csv && csv.from && csv.songs.length === 1 ? csv.songs[0] : null;
  const singleVideo = single?.url ? youtubeId(single.url) : null;
  const singleCover = single ? single.cover ?? (singleVideo ? thumbnailUrl(singleVideo) : null) : null;
  const canDownload = shownEngine === 'up';

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" className="shrink-0 rounded-full" onClick={() => navigate('/music')}>
          <ArrowLeft />
          {tr('Música')}
        </Button>
        <ExtensionIcon id={id} manifest={manifest} />
        <span className="min-w-0 flex-1 truncate font-headline text-lg font-bold text-primary">{name}</span>
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} title={tr('Una lista en CSV: de Exportify, TuneMyMusic, Soundiiz, Google Takeout o Apple Music')}>
          <FileUp />
          {tr('CSV')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => local(false)} title={tr('Añadir canciones que ya tienes en este equipo')}>
          <FileAudio />
          {tr('Archivos')}
        </Button>
        <Button size="sm" variant="outline" onClick={() => local(true)} title={tr('Añadir una carpeta de canciones de este equipo')}>
          <FolderOpen />
          {tr('Carpeta')}
        </Button>
      </header>
      <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" className="hidden" onChange={(event) => void onCsvFile(event)} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Mitad izquierda: el enlace y lo que hay detrás */}
        <section className={cn('flex min-w-0 flex-col gap-3 rounded-lg border border-border/60 bg-muted/20 p-3', BOX)}>
          <form
            className="flex shrink-0 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void readLink(link);
            }}
          >
            <label className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-md border border-primary bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
              <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                value={link}
                autoFocus
                onChange={(event) => {
                  setLink(event.target.value);
                  setCsvError(null);
                }}
                onPaste={(event) => {
                  // Pegar ya es pedirlo: se lee sin pulsar nada más.
                  const pasted = event.clipboardData.getData('text').trim();
                  if (!/^https?:\/\//i.test(pasted)) return;
                  event.preventDefault();
                  setLink(pasted);
                  void readLink(pasted);
                }}
                placeholder={tr('Pega el enlace de una canción o de una playlist')}
                aria-label={tr('Enlace de una canción o de una playlist')}
                className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
                spellCheck={false}
                autoComplete="off"
              />
              {(link || csv) && (
                <button type="button" onClick={clear} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={tr('Borrar')}>
                  <X className="h-4 w-4" />
                </button>
              )}
            </label>
            <Button type="submit" size="icon" className="h-12 w-12 shrink-0" disabled={reading || !link.trim()} aria-label={tr('Leer el enlace')} title={tr('Leer el enlace')}>
              {reading ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
            </Button>
          </form>

          {csvError && (
            <p role="alert" className="shrink-0 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {csvError}
            </p>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {reading ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                {tr('Leyendo el enlace…')}
              </div>
            ) : csv && csvSummary && single ? (
              // Una canción: su portada, sus datos y «Descargar».
              <div className="m-auto flex w-full max-w-sm flex-col items-center gap-3 py-4 text-center">
                <div className="aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-muted">
                  {singleCover ? <img src={singleCover} alt="" draggable={false} className="h-full w-full object-cover" /> : <Music className="m-auto h-full w-10 text-muted-foreground" />}
                </div>
                <div className="min-w-0 max-w-full">
                  <p className="truncate font-headline text-base font-bold text-foreground" title={single.title}>
                    {single.title || tr('Canción')}
                  </p>
                  <p className="truncate text-sm text-muted-foreground">{[single.artist, single.album].filter(Boolean).join(' · ') || SERVICE_NAME[csv.from!]}</p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {[single.duration ? formatVideoDuration(single.duration) : null, csvSummary.inLibrary ? null : `≈ ${preciseBytes(csvSummary.bytes)}`, 'MP3 320 kbps'].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {csvSummary.inLibrary > 0 && <p className="text-xs text-primary">{tr('Ya está en tu biblioteca: no se volverá a bajar')}</p>}
                <Button className="w-full" onClick={download} disabled={!canDownload}>
                  <Download />
                  {tr('Descargar')}
                </Button>
              </div>
            ) : csv && csvSummary ? (
              // Una lista (por enlace o por CSV): qué se obtuvo, en recuadros, y «Descargar».
              <div className="m-auto flex w-full max-w-md flex-col gap-3 py-4">
                <div className="flex items-center gap-2">
                  {csv.from ? <ListMusic className="h-5 w-5 shrink-0 text-primary" /> : <FileUp className="h-5 w-5 shrink-0 text-primary" />}
                  <p className="min-w-0 flex-1 truncate font-headline text-base font-bold text-foreground" title={csv.file}>
                    {csv.file}
                  </p>
                  {csv.from && csv.file !== SERVICE_NAME[csv.from] && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{SERVICE_NAME[csv.from]}</span>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Stat value={String(csv.songs.length)} label={csv.songs.length === 1 ? tr('canción') : tr('canciones')} />
                  <Stat value={csvSummary.known > 0 ? durationText(csvSummary.seconds) : '—'} label={tr('de música')} />
                  <Stat value={`≈ ${preciseBytes(csvSummary.bytes)}`} label={tr('en MP3 de 320 kbps')} />
                  <Stat value={String(csvSummary.inLibrary)} label={tr('ya en tu biblioteca')} />
                </div>
                {csv.truncated && <p className="text-xs text-destructive">{tr('Solo se toman las primeras {count} canciones.', { count: CSV_LIMIT })}</p>}
                {csv.partial && csv.from && !csv.truncated && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
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
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="shrink-0">{tr('Playlist:')}</span>
                  <Input value={csv.playlist} onChange={(event) => setCsv({ ...csv, playlist: event.target.value })} className="h-8 text-xs" maxLength={80} />
                </label>
                <div className="flex gap-2">
                  {csv.from && (
                    <Button variant="outline" onClick={saveCsv} title={tr('Guardar la lista como CSV en Descargas')}>
                      <FileDown />
                      {tr('Guardar CSV')}
                    </Button>
                  )}
                  <Button className="flex-1" onClick={download} disabled={!canDownload}>
                    <Download />
                    {tr('Descargar')}
                  </Button>
                </div>
              </div>
            ) : (
              // Nada aún: de dónde puede ser el enlace.
              <div className="flex flex-1 flex-col items-center justify-center gap-3 py-10 text-center">
                <Link2 className="h-8 w-8 text-primary/70" aria-hidden />
                <ul className="flex max-w-xs flex-wrap justify-center gap-1.5" aria-label={tr('Enlaces que se pueden leer')}>
                  {SERVICES.map((service) => (
                    <li key={service} className="rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs text-muted-foreground">
                      {service}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

        {/* Mitad derecha: lo que se está descargando */}
        <section className={cn('flex min-h-[18rem] min-w-0 flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3', BOX)}>
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
              <li className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
                <Download className="h-8 w-8 text-primary/70" aria-hidden />
                {tr('Tus descargas aparecerán aquí.')}
              </li>
            ) : (
              items.map((item) => (
                <QueueCard key={item.id} item={item} engineName={name} paused={downloads.paused} sizeShown={sizesShown.has(item.id)} onToggleSize={() => toggleSize(item.id)} />
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
    </div>
  );
}

/** Un dato de la lista leída, en su recuadro: la cifra grande y qué es. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-background/70 px-3 py-2.5 text-center">
      <p className="truncate font-headline text-xl font-bold tabular-nums text-foreground">{value}</p>
      <p className="truncate text-[11px] text-muted-foreground">{label}</p>
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
}: {
  item: DownloadItem;
  engineName: string;
  paused: boolean;
  sizeShown: boolean;
  onToggleSize: () => void;
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
            {statusText(item, engineName, paused)}
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
