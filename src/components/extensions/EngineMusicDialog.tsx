import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Download, FileUp, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import { useToast } from '@/hooks/use-toast';
import type { ExtensionManifest, MusicSourceContribution } from '@/lib/extensions/manifest';
import { pickSourceFolder, scanSourceFolder, sourceFolder } from '@/lib/extensions/native';
import {
  bestMatch,
  embedUrl,
  EngineClient,
  mp3Bytes,
  parseSongsCsv,
  songOf,
  youtubeId,
  type CsvSong,
  type EngineJob,
  type EngineVideo,
} from '@/lib/extensions/yt-mp3';
import { formatBytes, type PickedSource } from '@/lib/music-import';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Música → Importar, con una fuente de música que habla «yt-mp3/1» (1.7.6).
//
// Ventana propia de Frame (no la página del programa):
//   - buscador (texto o enlace) y el vídeo de YouTube incrustado;
//   - fila inferior: [CSV] · peso del MP3 de 320 kbps · [Descargar];
//   - «CSV» despliega abajo un recuadro para subir una lista de canciones;
//   - abajo, en pequeño, «Añadir archivos locales».
// El programa descarga en su carpeta; al terminar, Frame la lee con la
// importación de siempre (que no duplica lo que ya estaba).
// ============================================================

type Status = 'checking' | 'up' | 'down';

interface CsvRow extends CsvSong {
  state: 'pending' | 'searching' | 'queued' | 'nomatch' | 'error';
  job?: number;
}

export default function EngineMusicDialog({
  id,
  manifest,
  source,
  open,
  onOpenChange,
  onImport,
  onLocal,
}: {
  id: string;
  manifest: ExtensionManifest;
  source: MusicSourceContribution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (picked: PickedSource, quiet: boolean) => void;
  /** «Añadir archivos locales»: canciones (false) o una carpeta (true). */
  onLocal: (folder: boolean) => void;
}) {
  const { toast } = useToast();
  const client = useMemo(() => new EngineClient(source.page), [source.page]);
  const [status, setStatus] = useState<Status>('checking');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<EngineVideo[]>([]);
  const [video, setVideo] = useState<EngineVideo | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvName, setCsvName] = useState('');
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvRunning, setCsvRunning] = useState(false);
  const csvStop = useRef(false);
  /** Trabajos pedidos desde esta ventana (los demás del programa no se miran). */
  const [mine, setMine] = useState<number[]>([]);
  const [jobs, setJobs] = useState<EngineJob[]>([]);
  const [queuing, setQueuing] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  const [bringing, setBringing] = useState(false);

  const check = useCallback(async () => {
    setStatus('checking');
    setStatus((await client.alive()) ? 'up' : 'down');
  }, [client]);

  useEffect(() => {
    if (!open) return;
    void check();
    void sourceFolder(id).then(setFolder);
  }, [open, id, check]);

  // Progreso de lo pedido, cada segundo mientras haya algo en curso.
  const mineJobs = jobs.filter((j) => mine.includes(j.id));
  const pending = mineJobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'paused').length;
  const doneCount = mineJobs.filter((j) => j.status === 'done').length;
  useEffect(() => {
    if (!open || mine.length === 0) return;
    let alive = true;
    const tick = async () => {
      try {
        const list = await client.jobs();
        if (alive) setJobs(list);
      } catch {
        /* el programa se cerró: se reintenta en el siguiente */
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [open, mine.length, client]);

  const chooseFolder = async (): Promise<boolean> => {
    try {
      const name = await pickSourceFolder(id, source.folderHint);
      if (name) setFolder(name);
      return !!name;
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo elegir la carpeta'), description: errorText(error).slice(0, 160) });
      return false;
    }
  };

  /** Trae a Frame lo que haya en la carpeta del programa. */
  const bring = async (quiet: boolean) => {
    if (!folder && !(await chooseFolder())) return;
    setBringing(true);
    try {
      const picked = await scanSourceFolder(id);
      if (!picked) {
        setFolder(null);
        if (!quiet) toast({ variant: 'destructive', title: tr('La carpeta ya no está'), description: tr('Elige de nuevo dónde guarda las descargas.') });
        return;
      }
      setMine([]);
      setJobs([]);
      onOpenChange(false);
      onImport(picked, quiet);
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo leer la carpeta'), description: errorText(error).slice(0, 160) });
    } finally {
      setBringing(false);
    }
  };

  // Cuando termina todo lo pedido, se trae solo.
  const autoBrought = useRef(false);
  useEffect(() => {
    if (mine.length > 0 && pending === 0 && !csvRunning && mineJobs.length >= mine.length && doneCount > 0 && !autoBrought.current) {
      autoBrought.current = true;
      void bring(true);
    }
    if (pending > 0) autoBrought.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, doneCount, csvRunning, mine.length, mineJobs.length]);

  const runSearch = async () => {
    const text = query.trim();
    if (!text) return;
    setSearching(true);
    try {
      if (youtubeId(text)) {
        const one = await client.info(`https://www.youtube.com/watch?v=${youtubeId(text)}`);
        setResults([one]);
        setVideo(one);
      } else {
        const list = await client.search(text, 6);
        setResults(list);
        setVideo(list[0] ?? null);
        if (list.length === 0) toast({ title: tr('Sin resultados'), description: tr('Prueba con el artista y el nombre de la canción.') });
      }
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo buscar'), description: errorText(error).slice(0, 160) });
      void check();
    } finally {
      setSearching(false);
    }
  };

  const queueVideo = async () => {
    if (!video) return;
    setQueuing(true);
    try {
      // Título y artista fiables (los de YouTube Music, si los hay), y la letra.
      const full = video.artist !== undefined ? video : await client.info(video.url).catch(() => video);
      const { artist, title } = songOf(full);
      const lyrics = await client.lyrics(artist, title, full.duration);
      const job = await client.song({
        url: full.url,
        title,
        artist,
        ...(full.album ? { album: full.album } : {}),
        ...(lyrics ? { lyrics } : {}),
      });
      setMine((list) => [...list, job]);
      toast({ title: tr('Descargando «{title}»', { title }), description: tr('Llega a tu biblioteca en cuanto termine.') });
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo descargar'), description: errorText(error).slice(0, 160) });
    } finally {
      setQueuing(false);
    }
  };

  const readCsv = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: 'destructive', title: tr('El archivo es demasiado grande'), description: tr('Un CSV de canciones pesa menos de 5 MB.') });
      return;
    }
    const songs = parseSongsCsv(await file.text());
    if (songs.length === 0) {
      toast({
        variant: 'destructive',
        title: tr('No se encontraron canciones'),
        description: tr('El CSV necesita una columna con el título (y mejor también el artista) o con el enlace de YouTube.'),
      });
      return;
    }
    setCsvName(file.name);
    setCsvRows(songs.map((s) => ({ ...s, state: 'pending' })));
  };

  const runCsv = async () => {
    csvStop.current = false;
    setCsvRunning(true);
    const folderName = csvName.replace(/\.csv$/i, '').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || undefined;
    for (let i = 0; i < csvRows.length; i++) {
      if (csvStop.current) break;
      const row = csvRows[i];
      if (row.state !== 'pending' && row.state !== 'error') continue;
      const set = (patch: Partial<CsvRow>) => setCsvRows((list) => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
      set({ state: 'searching' });
      try {
        let url = row.url;
        let duration = row.duration;
        if (!url) {
          const found = bestMatch(row, await client.search(`${row.artist} ${row.title}`.trim(), 6));
          if (!found) {
            set({ state: 'nomatch' });
            continue;
          }
          url = found.url;
          duration = duration ?? found.duration ?? undefined;
        }
        const [lyrics, cover] = await Promise.all([
          row.artist ? client.lyrics(row.artist, row.title, duration) : Promise.resolve(undefined),
          row.cover ? client.image(row.cover) : Promise.resolve(undefined),
        ]);
        let title = row.title;
        let artist = row.artist;
        if (!title || !artist) {
          const info = songOf(await client.info(url));
          title ||= info.title;
          artist ||= info.artist;
        }
        const job = await client.song({
          url,
          title,
          artist,
          ...(row.album ? { album: row.album } : {}),
          ...(row.track ? { track: row.track } : {}),
          ...(cover ? { cover } : {}),
          ...(lyrics ? { lyrics } : {}),
          ...(folderName ? { folder: folderName } : {}),
        });
        set({ state: 'queued', job });
        setMine((list) => [...list, job]);
      } catch {
        set({ state: 'error' });
      }
    }
    setCsvRunning(false);
  };

  const size = video?.duration ? formatBytes(mp3Bytes(video.duration)) : null;
  const csvCounts = {
    queued: csvRows.filter((r) => r.state === 'queued').length,
    nomatch: csvRows.filter((r) => r.state === 'nomatch').length,
    error: csvRows.filter((r) => r.state === 'error').length,
  };
  const overall = mineJobs.length > 0 ? mineJobs.reduce((sum, j) => sum + (j.status === 'done' ? 1 : (j.progress ?? 0) / 100), 0) / mine.length : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && csvRunning) csvStop.current = true;
        // Al cerrar con descargas listas y la carpeta conocida, se traen.
        if (!next && folder && doneCount > 0 && !bringing) void bring(true);
        else onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-2xl flex-col gap-3 overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-8">
          <ExtensionIcon id={id} manifest={manifest} />
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-lg font-bold text-primary">{manifest.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {source.label ?? tr('Busca una canción o pega su enlace; se descarga en MP3 a 320 kbps con portada y letra.')}
            </DialogDescription>
          </div>
        </DialogHeader>

        {status !== 'up' ? (
          <div className="flex aspect-video flex-col items-center justify-center gap-3 rounded-lg border border-border/60 bg-muted/30 p-6 text-center">
            {status === 'checking' ? (
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            ) : (
              <>
                <p className="max-w-md text-sm text-foreground">
                  {tr('{name} no está abierto en este equipo. Ábrelo y pulsa «Reintentar».', { name: manifest.name })}
                </p>
                <Button variant="outline" onClick={() => void check()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  {tr('Reintentar')}
                </Button>
              </>
            )}
          </div>
        ) : (
          <>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void runSearch();
              }}
            >
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tr('Canción, artista o enlace de YouTube')}
                aria-label={tr('Buscar en YouTube')}
                autoFocus
              />
              <Button type="submit" variant="outline" size="icon" disabled={searching || !query.trim()} aria-label={tr('Buscar')}>
                {searching ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>

            <div className="relative aspect-video overflow-hidden rounded-lg border border-border/60 bg-black">
              {video ? (
                <iframe
                  key={video.id}
                  src={embedUrl(video.id)}
                  title={video.title}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="h-full w-full"
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/60">
                  {tr('Busca una canción o pega su enlace para verla aquí.')}
                </div>
              )}
            </div>

            {results.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {results.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setVideo(item)}
                    title={item.title}
                    className={cn(
                      'w-28 shrink-0 overflow-hidden rounded-md border text-left text-[10px] leading-tight transition-colors',
                      item.id === video?.id ? 'border-primary' : 'border-border/60 hover:border-primary/50'
                    )}
                  >
                    <img src={item.thumbnail} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                    <span className="line-clamp-2 px-1.5 py-1">{item.title}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-stretch gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCsvOpen((v) => !v)}
                aria-expanded={csvOpen}
                className={cn('h-10 w-10 shrink-0 border border-border p-0 text-xs font-bold', csvOpen && 'border-primary text-primary')}
                title={tr('Subir un CSV de canciones')}
              >
                CSV
              </Button>
              <div className="grid flex-1 grid-cols-2 gap-2">
                <div className="flex items-center justify-center text-sm tabular-nums text-muted-foreground">
                  {size ? (
                    <span title={tr('MP3 a 320 kbps')}>
                      {size} <span className="text-[10px]">· MP3 320</span>
                    </span>
                  ) : (
                    '—'
                  )}
                </div>
                <Button type="button" className="h-10" onClick={() => void queueVideo()} disabled={!video || queuing}>
                  {queuing ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  {tr('Descargar')}
                </Button>
              </div>
            </div>

            {csvOpen && (
              <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                {csvRows.length === 0 ? (
                  <label
                    className="flex cursor-pointer flex-col items-center gap-1.5 py-4 text-center text-sm text-muted-foreground hover:text-foreground"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => {
                      event.preventDefault();
                      void readCsv(event.dataTransfer.files[0]);
                    }}
                  >
                    <FileUp className="h-6 w-6 text-primary" />
                    <span>{tr('Arrastra aquí el CSV de canciones o haz clic para elegirlo')}</span>
                    <span className="text-[11px]">{tr('Sirve el de Exportify (Spotify) o uno con columnas de título y artista.')}</span>
                    <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => void readCsv(event.target.files?.[0])} />
                  </label>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold">{csvName}</span> · {csvRows.length}{' '}
                        {csvRows.length === 1 ? tr('canción') : tr('canciones')}
                      </span>
                      {!csvRunning && (
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setCsvRows([])} aria-label={tr('Quitar el CSV')}>
                          <X className="h-4 w-4" />
                        </Button>
                      )}
                      {csvRunning ? (
                        <Button size="sm" variant="gris" onClick={() => (csvStop.current = true)}>
                          {tr('Detener')}
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => void runCsv()} disabled={!csvRows.some((r) => r.state === 'pending' || r.state === 'error')}>
                          <Download className="mr-2 h-4 w-4" />
                          {tr('Descargar todas')}
                        </Button>
                      )}
                    </div>
                    {(csvCounts.queued > 0 || csvCounts.nomatch > 0 || csvCounts.error > 0) && (
                      <p className="text-[11px] text-muted-foreground">
                        {tr('{queued} en cola · {nomatch} sin una versión fiable · {error} con error', csvCounts)}
                      </p>
                    )}
                    <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
                      {csvRows.map((row, index) => (
                        <li key={index} className="flex items-center gap-2">
                          <span className="w-4 shrink-0">
                            {row.state === 'searching' && <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />}
                            {row.state === 'queued' && <Check className="h-3.5 w-3.5 text-primary" />}
                            {(row.state === 'nomatch' || row.state === 'error') && <X className="h-3.5 w-3.5 text-destructive" />}
                          </span>
                          <span className={cn('min-w-0 flex-1 truncate', row.state === 'nomatch' && 'text-muted-foreground line-through')}>
                            {row.artist ? `${row.artist} — ` : ''}
                            {row.title || row.url}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}

            {mine.length > 0 && (
              <div className="space-y-1">
                <Progress value={Math.round(overall * 100)} />
                <p className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {pending > 0
                      ? tr('Descargando: {done} de {total} listas', { done: doneCount, total: mine.length })
                      : tr('{done} de {total} listas', { done: doneCount, total: mine.length })}
                  </span>
                  {doneCount > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={bringing} onClick={() => void bring(false)}>
                      {bringing && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />}
                      {tr('Traer ya a Frame')}
                    </Button>
                  )}
                </p>
              </div>
            )}
          </>
        )}

        <p className="text-center text-[11px] text-muted-foreground">
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => onLocal(false)}>
            {tr('Añadir archivos locales')}
          </button>
          {' · '}
          <button type="button" className="underline-offset-2 hover:underline" onClick={() => onLocal(true)}>
            {tr('una carpeta')}
          </button>
          {folder && (
            <>
              {' · '}
              <button type="button" className="underline-offset-2 hover:underline" onClick={() => void chooseFolder()} title={tr('Las descargas se traen de «{folder}».', { folder })}>
                {tr('Carpeta de descargas')}
              </button>
            </>
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}
