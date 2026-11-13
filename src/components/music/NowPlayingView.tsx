import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  FileText,
  Heart,
  LoaderCircle,
  MicVocal,
  Minus,
  Music,
  Pause,
  Play,
  Plus,
  Repeat,
  Shuffle,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { useCourse } from '@/context/CourseContext';
import {
  activeLineIndex,
  decodeTextFile,
  importLyrics,
  lyricsFromText,
  setLyricsOffset,
  storedLyrics,
  type SongLyrics,
} from '@/lib/lyrics';
import { formatClock, playbackClock, usePlaybackPosition } from '@/lib/playback-clock';
import { songTitle } from '@/lib/music-search';
import { cn } from '@/lib/utils';
import { decimalText, tr } from '@/lib/i18n';
import { artistLabel } from '@/lib/enum-labels';
import { formatListened, listeningAllTime, playsText, useListening } from '@/lib/listening';
import { songKey } from '@/lib/song-keys';
import { useMediaQuery } from '@/hooks/use-media-query';

// ============================================================
// «Reproduciendo»: la canción a pantalla completa DENTRO de Frame.
//
// A la izquierda, la canción: título, portada grande centrada, artista y, más
// pequeños, la línea de reproducción y los controles. A la derecha, la letra
// sincronizada: la línea que suena va resaltada y centrada, y tocar cualquier
// línea salta a ese punto. El fondo es la propia portada, desenfocada.
//
// En una pantalla estrecha (un teléfono de pie, 1.9.9) no caben lado a lado:
// la letra va arriba, centrada, y abajo la portada pequeña con el título, la
// línea de reproducción y los controles; se sale con la flecha de arriba a la
// izquierda.
//
// La letra es la que trajo la canción al importarla (sus etiquetas, o un .lrc
// o .txt con el mismo nombre) o la que el usuario le añade aquí desde un
// archivo suyo. Frame no la busca en internet (1.6.7, ver lyrics.ts).
//
// No tiene <audio> propio: el sonido sigue viviendo en la barra inferior; aquí
// solo se lee su avance (playback-clock) y se le dan órdenes.
// ============================================================

function LyricsPanel({
  lyrics,
  loading,
  note,
  onAttach,
  centered,
}: {
  lyrics: SongLyrics | null;
  loading: boolean;
  /** Aviso tras elegir un archivo que no servía. */
  note: string | null;
  onAttach: () => void;
  /** Letra centrada (pantalla estrecha). */
  centered: boolean;
}) {
  const { progress } = usePlaybackPosition();
  const containerRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lines = lyrics?.synced ?? [];
  const offset = lyrics?.offset ?? 0;
  const active = useMemo(() => activeLineIndex(lines, progress - offset), [lines, progress, offset]);

  // La línea activa se mantiene centrada. Se desplaza el PANEL, no la página.
  useEffect(() => {
    const container = containerRef.current;
    const line = lineRefs.current[active];
    if (!container || !line) return;
    container.scrollTo({
      top: line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [active]);

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-white/70">
        <LoaderCircle className="h-6 w-6 animate-spin" />
        <p className="text-sm">{tr('Cargando la letra…')}</p>
      </div>
    );
  }

  if (!lyrics || lyrics.missing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/70">
        <MicVocal className="h-8 w-8" />
        <p className="text-base font-semibold text-white">
          {lyrics?.instrumental ? tr('Canción instrumental') : tr('Sin letra para esta canción')}
        </p>
        {!lyrics?.instrumental && (
          <>
            <p className="max-w-xs text-xs leading-relaxed">
              {tr('Frame muestra la letra que trae la canción en sus etiquetas o en un archivo .lrc con su mismo nombre. Si tienes ese archivo, añádelo aquí.')}
            </p>
            <Button
              variant="ghost"
              onClick={onAttach}
              className="mt-1 h-9 rounded-full border border-white/25 px-4 text-xs font-semibold text-white/90 hover:bg-white/15 hover:text-white"
            >
              <FileText className="mr-2 h-4 w-4" />
              {tr('Añadir letra…')}
            </Button>
            {note && <p className="text-xs text-white/60">{note}</p>}
          </>
        )}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="hide-scrollbar h-full overflow-y-auto px-2 py-6">
        <p className={cn('mb-4 text-[10px] font-semibold text-white/50', centered && 'text-center')}>{tr('Letra sin sincronizar')}</p>
        <p className={cn('whitespace-pre-wrap text-lg font-semibold leading-relaxed text-white/85', centered && 'text-center')}>{lyrics.plain}</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="hide-scrollbar relative h-full overflow-y-auto scroll-smooth [mask-image:linear-gradient(to_bottom,transparent,black_14%,black_86%,transparent)]"
    >
      <div className={centered ? 'py-[22vh]' : 'py-[28vh]'}>
        {lines.map((line, index) => (
          <button
            key={`${line.time}-${index}`}
            ref={(el) => {
              lineRefs.current[index] = el;
            }}
            type="button"
            onClick={() => playbackClock.seek(Math.max(0, line.time + offset))}
            title={tr('Saltar a {clock}', { clock: formatClock(Math.max(0, line.time + offset)) })}
            className={cn(
              'block w-full rounded-lg px-3 py-2 font-headline text-2xl font-bold leading-snug transition-all duration-300 lg:text-3xl',
              centered ? 'text-center' : 'text-left',
              index === active
                ? 'scale-[1.02] text-white'
                : index < active
                  ? 'text-white/30 hover:text-white/60'
                  : 'text-white/45 hover:text-white/70'
            )}
          >
            {line.text || '♪'}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Pie de la letra: cambiarla por la de otro archivo y, si va sincronizada, el
 * ajuste fino de sus tiempos.
 */
function LyricsFooter({
  synced,
  offset,
  onOffset,
  onAttach,
}: {
  synced: boolean;
  offset: number;
  onOffset: (delta: number) => void;
  onAttach: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-2 text-[11px] text-white/55">
      <Button
        variant="ghost"
        onClick={onAttach}
        title={tr('Usar la letra de un archivo .lrc o .txt')}
        className="h-7 rounded-full px-3 text-[11px] text-white/70 hover:bg-white/15 hover:text-white"
      >
        <FileText className="mr-1.5 h-3.5 w-3.5" />
        {tr('Cambiar letra…')}
      </Button>
      {synced && (
      <div className="flex items-center rounded-full border border-white/15" title={tr('Ajusta si la letra va adelantada o atrasada')}>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-white/75 hover:bg-white/15 hover:text-white" onClick={() => onOffset(-0.5)} title={tr('Letra 0,5 s antes')}>
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <span className="min-w-[3.25rem] text-center tabular-nums text-white/80">
          {offset === 0 ? tr('A tiempo') : `${offset > 0 ? '+' : '−'}${decimalText(Math.abs(offset))} s`}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full text-white/75 hover:bg-white/15 hover:text-white" onClick={() => onOffset(0.5)} title={tr('Letra 0,5 s después')}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      )}
    </div>
  );
}

export default function NowPlayingView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    currentSong,
    isPlaying,
    togglePlay,
    playNext,
    playPrevious,
    isShuffle,
    toggleShuffle,
    repeatMode,
    setRepeatMode,
    toggleSongFavorite,
    userProfile,
  } = useCourse();
  const { progress, duration } = usePlaybackPosition();
  // Cuánto ha sonado esta canción desde que Frame lo mide (1.8.0).
  const allTime = useListening(open ? userProfile?.id : null, listeningAllTime, []);
  const songStats = allTime && currentSong ? allTime.songs.find((s) => s.key === songKey(currentSong)) : undefined;
  // La letra guardada y de qué canción es: al cambiar de canción, la anterior
  // sigue un instante en el estado, y no es la de la que suena.
  const [loaded, setLoaded] = useState<{ songId: string; lyrics: SongLyrics | null } | null>(null);
  const [lyricsNote, setLyricsNote] = useState<string | null>(null);
  const lyricsInputRef = useRef<HTMLInputElement>(null);

  const songId = currentSong?.id ?? null;
  const loading = !!songId && loaded?.songId !== songId;
  const lyrics = loaded && !loading ? loaded.lyrics : null;
  // Ancha: la canción y la letra, lado a lado. Estrecha (un teléfono de pie): la letra arriba y la canción abajo.
  const wide = useMediaQuery('(min-width: 1024px)');

  // La letra guardada se lee al abrir y al cambiar de canción.
  useEffect(() => {
    if (!open || !songId) return;
    let alive = true;
    setLoaded(null);
    setLyricsNote(null);
    void storedLyrics(songId)
      .then((result) => alive && setLoaded({ songId, lyrics: result }))
      .catch(() => alive && setLoaded({ songId, lyrics: null }));
    return () => {
      alive = false;
    };
  }, [open, songId]);

  const songRef = useRef(currentSong);
  songRef.current = currentSong;

  /** Letra desde un archivo del usuario (.lrc o .txt): se guarda con la canción. */
  const attachLyrics = async (file: File | undefined) => {
    const song = currentSong;
    if (!file || !song) return;
    if (file.size > 2 * 1024 * 1024) {
      setLyricsNote(tr('Ese archivo es demasiado grande para ser una letra.'));
      return;
    }
    const parsed = lyricsFromText(decodeTextFile(new Uint8Array(await file.arrayBuffer())));
    if (!parsed) {
      setLyricsNote(tr('Ese archivo no trae ninguna letra.'));
      return;
    }
    await importLyrics(song.id, parsed);
    if (songRef.current?.id !== song.id) return; // cambió la canción mientras tanto
    setLoaded({ songId: song.id, lyrics: parsed });
    setLyricsNote(null);
  };

  const changeOffset = (delta: number) => {
    if (!currentSong || !lyrics) return;
    const next = Math.max(-30, Math.min(30, Math.round(((lyrics.offset ?? 0) + delta) * 10) / 10));
    setLoaded({ songId: currentSong.id, lyrics: { ...lyrics, offset: next } });
    void setLyricsOffset(currentSong.id, next);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || !currentSong) return null;

  const title = songTitle(currentSong);
  const artist = artistLabel(currentSong.artist);
  const control = 'h-10 w-10 rounded-full text-white/80 hover:bg-white/15 hover:text-white';

  const cover = (className: string, icon: string) => (
    <div className={cn('shrink-0 overflow-hidden bg-white/10 ring-1 ring-white/15', className)}>
      {currentSong.picture ? (
        <img src={currentSong.picture} alt={title} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center">
          <Music className={cn('text-white/60', icon)} />
        </span>
      )}
    </div>
  );

  const seek = (
    <div>
      <Slider
        value={[Math.min(progress, duration || 0)]}
        max={duration || 0}
        step={1}
        onValueChange={(value) => playbackClock.seek(value[0])}
        aria-label={tr('Posición de la canción')}
        className="[&_[role=slider]]:border-white [&_[role=slider]]:bg-white [&>span:first-child]:bg-white/25 [&>span:first-child>span]:bg-white"
      />
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-white/60">
        <span>{formatClock(progress)}</span>
        <span>{formatClock(duration)}</span>
      </div>
    </div>
  );

  const controls = (
    <div className="flex items-center justify-center gap-2">
      <Button variant="ghost" size="icon" onClick={toggleShuffle} title={tr('Aleatorio')} className={cn(control, 'h-9 w-9', isShuffle && 'bg-white/20 text-white')}>
        <Shuffle className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={playPrevious} title={tr('Anterior')} className={control}>
        <SkipBack className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={togglePlay}
        title={isPlaying ? tr('Pausar') : tr('Reproducir')}
        className="h-14 w-14 rounded-full bg-white text-neutral-900 hover:bg-white/90 hover:text-neutral-900"
      >
        {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current pl-0.5" />}
      </Button>
      <Button variant="ghost" size="icon" onClick={playNext} title={tr('Siguiente')} className={control}>
        <SkipForward className="h-5 w-5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={repeatMode.mode === 'off' ? tr('Repetir esta canción') : tr('Dejar de repetir')}
        onClick={() => setRepeatMode(repeatMode.mode === 'off' ? { mode: 'infinite' } : { mode: 'off' })}
        className={cn(control, 'h-9 w-9', repeatMode.mode !== 'off' && 'bg-white/20 text-white')}
      >
        <Repeat className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        title={currentSong.isFavorite ? tr('Quitar de favoritas') : tr('Marcar como favorita')}
        onClick={() => void toggleSongFavorite(currentSong.id)}
        className={cn(control, 'h-9 w-9')}
      >
        <Heart className={cn('h-4 w-4', currentSong.isFavorite && 'fill-white text-white')} />
      </Button>
    </div>
  );

  const lyricsBlock = (
    <>
      <div className={wide ? 'h-[68%] w-full' : 'min-h-0 w-full flex-1'}>
        <LyricsPanel lyrics={lyrics} loading={loading} note={lyricsNote} onAttach={() => lyricsInputRef.current?.click()} centered={!wide} />
      </div>
      {!loading && lyrics && !lyrics.missing && (
        <LyricsFooter synced={lyrics.synced.length > 0} offset={lyrics.offset ?? 0} onOffset={changeOffset} onAttach={() => lyricsInputRef.current?.click()} />
      )}
      {!loading && lyrics && lyricsNote && <p className="mt-2 text-right text-xs text-white/60">{lyricsNote}</p>}
      <input
        ref={lyricsInputRef}
        type="file"
        accept=".lrc,.txt,text/plain"
        className="hidden"
        onChange={(event) => {
          void attachLyrics(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </>
  );

  return (
    <div className="fixed inset-0 z-40 overflow-hidden bg-neutral-950 text-white animate-in fade-in-0 duration-300" role="dialog" aria-label={tr('Reproduciendo')}>
      {/* Fondo: la portada, muy desenfocada, y un velo para que el texto se lea. */}
      {currentSong.picture && (
        <img src={currentSong.picture} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-60 blur-3xl" />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/55 to-black/80" />

      {wide ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title={tr('Cerrar (Esc)')}
            className="absolute right-5 top-5 z-10 h-10 w-10 rounded-full text-white/80 hover:bg-white/15 hover:text-white"
          >
            <ChevronDown className="h-6 w-6" />
          </Button>
          <div className="relative grid h-full grid-cols-[minmax(0,5fr)_minmax(0,6fr)] gap-14 px-16 py-10">
            {/* ---- La canción ---- */}
            <div className="flex min-h-0 flex-col items-center justify-center text-center">
              <h2 className="w-full max-w-md truncate font-headline text-3xl font-bold" title={title}>
                {title}
              </h2>
              {cover('my-6 aspect-square w-full max-w-[min(22rem,42vh)] rounded-2xl shadow-[0_30px_80px_rgba(0,0,0,0.55)]', 'h-20 w-20')}
              <p className="w-full max-w-md truncate text-base font-semibold text-white/75" title={artist}>
                {artist}
              </p>
              {songStats && (songStats.plays > 0 || songStats.seconds >= 60) && (
                <p className="mt-1 text-xs tabular-nums text-white/55">
                  {tr('{plays} · {time} en total', { plays: playsText(songStats.plays), time: formatListened(songStats.seconds) })}
                </p>
              )}
              <div className="mt-6 w-full max-w-sm space-y-3">
                {seek}
                {controls}
              </div>
            </div>
            {/* ---- La letra: ~68 % del alto, centrada ---- */}
            <div className="flex min-h-0 flex-col justify-center">{lyricsBlock}</div>
          </div>
        </>
      ) : (
        <div className="relative flex h-full flex-col px-5 pb-[max(1.25rem,var(--safe-bottom,0px))] pt-[max(0.75rem,var(--safe-top,0px))]">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title={tr('Volver')}
            aria-label={tr('Volver')}
            className="-ml-2 h-10 w-10 shrink-0 rounded-full text-white/80 hover:bg-white/15 hover:text-white"
          >
            <ChevronLeft className="h-6 w-6" />
          </Button>
          {/* ---- La letra, arriba ---- */}
          <div className="flex min-h-0 flex-1 flex-col">{lyricsBlock}</div>
          {/* ---- La canción, abajo ---- */}
          <div className="mt-4 shrink-0 space-y-3">
            <div className="flex items-center gap-3">
              {cover('h-16 w-16 rounded-xl', 'h-7 w-7')}
              <div className="min-w-0">
                <h2 className="truncate font-headline text-lg font-bold" title={title}>
                  {title}
                </h2>
                <p className="truncate text-sm font-semibold text-white/70" title={artist}>
                  {artist}
                </p>
              </div>
            </div>
            {seek}
            {controls}
          </div>
        </div>
      )}
    </div>
  );
}
