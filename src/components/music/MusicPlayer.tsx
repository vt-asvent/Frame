import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import Image from '@/lib/image';
import { useCourse } from '@/context/CourseContext';
import { useRouter } from '@/lib/navigation';
import { getSongFileFromDB } from '@/lib/music-db';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Shuffle,
  Repeat,
  Heart,
  ChevronDown,
  Maximize2,
} from 'lucide-react';
import NowPlayingView from '@/components/music/NowPlayingView';
import { playbackClock } from '@/lib/playback-clock';
import { installListeningGuards, listening, playlistIdFromHref } from '@/lib/listening';
import { songTitle } from '@/lib/music-search';
import { cn } from '@/lib/utils';
import { withSong } from '@/hooks/use-song-highlight';
import { tr } from '@/lib/i18n';
import { artistLabel, playbackContextLabel } from '@/lib/enum-labels';

// Tope de canciones ilegibles encadenadas que el reproductor salta solo antes
// de detenerse: evita recorrer en bucle una biblioteca entera sin audio.
const MAX_CONSECUTIVE_SKIPS = 5;

export default function MusicPlayer() {
    const { 
        currentSong, 
        isPlaying, 
        togglePlay, 
        playNext, 
        playPrevious, 
        repeatMode,
        setRepeatMode,
        isShuffle, 
        toggleShuffle,
        playingContext,
        playingContextHref,
        toggleSongFavorite,
        hasInteracted,
        isPlayerVisible,
        setPlayerVisible,
        playbackHistory,
        userProfile,
    } = useCourse();
    const router = useRouter();
    const audioRef = useRef<HTMLAudioElement>(null);
    const [audioSrc, setAudioSrc] = useState<string | undefined>(undefined);
    const [progress, setProgress] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);

    // Marquee state
    const songName = currentSong ? songTitle(currentSong) : '';
    const artistName = artistLabel(currentSong?.artist);
    const titleContainerRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    
    // Repeat button logic refs
    const mouseDownTimeRef = useRef<number>(0);
    const clickCountRef = useRef<number>(0);
    const clickCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Espejos del estado/acciones del contexto para poder usarlos dentro de
    // callbacks asíncronos sin recrearlos ni arrastrar cierres obsoletos.
    const playNextRef = useRef(playNext);
    const togglePlayRef = useRef(togglePlay);
    const isPlayingRef = useRef(isPlaying);
    const skipAttemptsRef = useRef(0);

    useEffect(() => {
        playNextRef.current = playNext;
        togglePlayRef.current = togglePlay;
        isPlayingRef.current = isPlaying;
    });

    // Una canción sin audio utilizable (blob perdido en IndexedDB o descarga
    // corrupta) dejaba el reproductor congelado al final de la pista anterior:
    // aquí se salta sola en lugar de quedarse parada.
    const skipUnplayableSong = useCallback(() => {
        if (!isPlayingRef.current) return;
        if (skipAttemptsRef.current >= MAX_CONSECUTIVE_SKIPS) {
            skipAttemptsRef.current = 0;
            togglePlayRef.current();
            return;
        }
        skipAttemptsRef.current += 1;
        playNextRef.current();
    }, []);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        const song = currentSong;

        if (!song) {
            setAudioSrc(undefined);
            return;
        }

        getSongFileFromDB(song.id)
            .then(file => {
                if (cancelled) return;
                if (!file) {
                    setAudioSrc(undefined);
                    skipUnplayableSong();
                    return;
                }
                skipAttemptsRef.current = 0;
                objectUrl = URL.createObjectURL(file);
                setAudioSrc(objectUrl);
            })
            .catch(error => {
                if (cancelled) return;
                console.error('No se pudo leer el audio de la canción:', error);
                setAudioSrc(undefined);
                skipUnplayableSong();
            });

        return () => {
            cancelled = true;
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [currentSong?.id, skipUnplayableSong]);

    useEffect(() => () => {
        if (clickCommitTimerRef.current) {
            clearTimeout(clickCommitTimerRef.current);
        }
    }, []);

    useEffect(() => {
        const audio = audioRef.current;
        if (audio && audioSrc) {
            if (isPlaying && hasInteracted) {
                audio.play().catch(e => {
                    if (e.name !== 'AbortError') {
                        console.error("Audio play failed:", e)
                    }
                });
            } else {
                audio.pause();
            }
        }
    }, [isPlaying, audioSrc, hasInteracted]);
    
    useEffect(() => {
        const audio = audioRef.current;
        if(audio) {
            audio.volume = isMuted ? 0 : volume;
        }
    }, [volume, isMuted]);

    useLayoutEffect(() => {
        const container = titleContainerRef.current;
        // Re-check on songName change or when the player visibility changes (as this can affect layout)
        if (!container || !isPlayerVisible) {
            setIsOverflowing(false);
            return;
        };

        // This is a robust way to measure text width without being affected by the container's current state.
        const measureSpan = document.createElement('span');
        measureSpan.style.fontSize = '1.125rem'; // Corresponds to text-lg
        measureSpan.style.fontWeight = '600'; // Corresponds to font-semibold
        measureSpan.style.position = 'absolute';
        measureSpan.style.visibility = 'hidden';
        measureSpan.style.whiteSpace = 'nowrap';
        measureSpan.textContent = songName;
        
        document.body.appendChild(measureSpan);
        const textWidth = measureSpan.offsetWidth;
        document.body.removeChild(measureSpan);
        
        const containerWidth = container.clientWidth;

        setIsOverflowing(textWidth > containerWidth);

    }, [songName, isPlayerVisible]);

    const handleTimeUpdate = () => {
        const audio = audioRef.current;
        if (audio) {
            setProgress(audio.currentTime);
            setDuration(audio.duration);
            // Otras vistas (letras, escucha previa) siguen el avance desde aquí.
            playbackClock.publish(audio.currentTime, audio.duration);
            // Estadísticas de escucha (1.8.0): solo lo que suena de verdad.
            if (!audio.paused && currentSong) {
                const listId = playlistIdFromHref(playingContextHref);
                listening.tick({
                    owner: userProfile?.id,
                    song: currentSong,
                    list: listId ? { id: listId, name: playingContext } : null,
                    time: audio.currentTime,
                    duration: audio.duration,
                    rate: audio.playbackRate,
                });
            }
        }
    };

    // Lo escuchado se guarda también al ocultar o cerrar la ventana.
    useEffect(() => {
        installListeningGuards();
        return () => listening.pause();
    }, []);

    // …y pueden pedir un salto sin tener acceso al <audio>.
    useEffect(
        () =>
            playbackClock.registerSeek((seconds) => {
                const audio = audioRef.current;
                if (!audio) return;
                audio.currentTime = seconds;
                setProgress(seconds);
                playbackClock.publish(seconds, audio.duration);
            }),
        []
    );

    const [isNowPlayingOpen, setNowPlayingOpen] = useState(false);

    const handleProgressChange = (value: number[]) => {
        const audio = audioRef.current;
        if (audio) {
            audio.currentTime = value[0];
            setProgress(value[0]);
        }
    };

    const handleEnded = () => {
        const audio = audioRef.current;
        // Terminó: si vuelve a sonar (repetir), es otra reproducción.
        listening.ended();

        if (audio && repeatMode.mode === 'infinite') {
            audio.currentTime = 0;
            audio.play().catch(e => console.error("Audio play failed:", e));
            return;
        }

        if (audio && repeatMode.mode === 'finite' && repeatMode.count > 0) {
            // Consume una repetición. Al agotarse el contador el modo pasa a
            // 'off', así que el siguiente final de pista ya cae en playNext.
            const newCount = repeatMode.count - 1;
            setRepeatMode(newCount > 0 ? { mode: 'finite', count: newCount } : { mode: 'off' });
            audio.currentTime = 0;
            audio.play().catch(e => console.error("Audio play failed:", e));
            return;
        }

        // Sin repetición: siguiente de la cola; si la cola se agotó, playNext
        // elige una aleatoria de la biblioteca central.
        playNext();
    };

    // El archivo existe pero el navegador no puede decodificarlo (descarga
    // truncada, contenedor roto): se salta igual que si faltara.
    const handleAudioError = () => {
        const audio = audioRef.current;
        if (!audio || !audioSrc || audio.src !== audioSrc) return;
        console.warn('Audio ilegible, se salta a la siguiente canción:', currentSong?.fileName);
        skipUnplayableSong();
    };

    const handleRepeatMouseDown = () => {
        mouseDownTimeRef.current = Date.now();
    };

    const handleRepeatMouseUp = () => {
        const pressDuration = Date.now() - mouseDownTimeRef.current;
        const isCurrentlyOff = repeatMode.mode === 'off';

        // --- LONG PRESS (>= 750ms) ---
        if (pressDuration >= 750) {
            if (clickCommitTimerRef.current) {
                clearTimeout(clickCommitTimerRef.current); // Cancel any pending click actions
            }
            clickCountRef.current = 0;

            if (repeatMode.mode === 'finite') {
                // From finite -> long press -> infinite
                setRepeatMode({ mode: 'infinite' });
            } else if (repeatMode.mode === 'infinite') {
                // From infinite -> long press -> off
                setRepeatMode({ mode: 'off' });
            } else { // isCurrentlyOff
                // From off -> long press -> infinite
                setRepeatMode({ mode: 'infinite' });
            }
            return;
        }

        // --- SHORT PRESS / CLICK ---
        if (!isCurrentlyOff) {
            // If mode is ON (finite or infinite), a single short click turns it OFF.
            if (clickCommitTimerRef.current) {
                clearTimeout(clickCommitTimerRef.current);
            }
            clickCountRef.current = 0;
            setRepeatMode({ mode: 'off' });
            return;
        }

        // If we're here, mode is OFF and it's a short press.
        // We need to handle single vs. multi-click.
        clickCountRef.current += 1;

        // Clear any previous timer to reset the multi-click window
        if (clickCommitTimerRef.current) {
            clearTimeout(clickCommitTimerRef.current);
        }

        // Set a timer. If no more clicks come in, this will fire.
        clickCommitTimerRef.current = setTimeout(() => {
            if (clickCountRef.current > 0) {
                // Set to finite mode with the number of clicks recorded
                setRepeatMode({ mode: 'finite', count: clickCountRef.current });
            }
            clickCountRef.current = 0; // Reset counter after action is committed
        }, 400); // 400ms window to wait for more clicks
    };

    const formatTime = (time: number) => {
        if (isNaN(time) || time === 0) return '0:00';
        const minutes = Math.floor(time / 60);
        const seconds = Math.floor(time % 60);
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    };

    const toggleMute = () => {
        setIsMuted(prev => !prev);
    }

    const handleLikeClick = () => {
        if (currentSong) {
            toggleSongFavorite(currentSong.id);
        }
    };
    
    const handlePreviousClick = () => {
      if (audioRef.current && audioRef.current.currentTime >= 5) {
        audioRef.current.currentTime = 0;
      } else {
        playPrevious();
      }
    };

    if (!currentSong) {
        return null;
    }

    const isBackButtonDisabled = isShuffle && playbackHistory.length === 0;

    return (
        <div className={cn(
            "flex-shrink-0 transition-all duration-500 ease-in-out overflow-hidden bg-card border-t border-border",
            isPlayerVisible ? "max-h-[120px]" : "max-h-0 !border-t-0"
        )}>
            <div className="group relative h-[120px] flex items-center px-4 gap-4">
                 <NowPlayingView open={isNowPlayingOpen} onClose={() => setNowPlayingOpen(false)} />
                 <audio
                    ref={audioRef}
                    src={audioSrc}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleTimeUpdate}
                    onEnded={handleEnded}
                    onPause={() => listening.pause()}
                    onError={handleAudioError}
                />
                
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setPlayerVisible(false)}
                    >
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    </Button>
                </div>

                <div className="flex items-center gap-4 w-1/4 min-w-0">
                    <div className="relative h-20 w-20 shrink-0 rounded-md bg-accent flex items-center justify-center">
                        {currentSong.picture ? (
                            <Image 
                                src={currentSong.picture} 
                                alt={songName} 
                                layout="fill"
                                objectFit="cover"
                                className="rounded-md"
                            />
                        ) : (
                            <Music className="h-8 w-8 text-primary" />
                        )}
                    </div>
                    <div className="space-y-2 flex-1 overflow-hidden min-w-0">
                        <div ref={titleContainerRef} className="relative w-full h-7 overflow-hidden">
                            <p className={cn(
                                "absolute top-0 left-0 font-semibold text-lg text-foreground whitespace-nowrap",
                                isOverflowing && "animate-marquee"
                            )}>
                                {songName}
                                {isOverflowing && <span className="inline-block w-8" />}
                                {isOverflowing && songName}
                            </p>
                        </div>
                        {/* El artista, no el formato: "LOCAL - MP3" era el mismo
                            texto en las mil canciones. `truncate` lo corta con
                            puntos suspensivos antes de invadir los controles. */}
                        <p className="truncate text-xs font-semibold text-primary" title={artistName}>
                            {artistName}
                        </p>
                    </div>
                </div>

                <div className="flex flex-col items-center justify-center w-1/2 gap-4">
                    <div className="flex items-center gap-4">
                        <Button 
                            variant="ghost" 
                            size="icon" 
                            className={cn("h-8 w-8", isShuffle && "bg-primary/20 text-primary border border-primary")}
                            onClick={toggleShuffle}
                            title={tr('Aleatorio')}
                        >
                            <Shuffle className="h-5 w-5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handlePreviousClick} disabled={isBackButtonDisabled}>
                            <SkipBack className="h-5 w-5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full bg-primary text-primary-foreground hover:bg-primary/90" onClick={togglePlay}>
                            {isPlaying ? <Pause className="h-6 w-6 fill-primary-foreground" /> : <Play className="h-6 w-6 fill-primary-foreground" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={playNext}>
                            <SkipForward className="h-5 w-5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn(
                                "h-8 w-8 relative",
                                repeatMode.mode !== 'off' && "bg-primary/20 text-primary border border-primary"
                            )}
                            onMouseDown={handleRepeatMouseDown}
                            onMouseUp={handleRepeatMouseUp}
                        >
                            <Repeat className="h-5 w-5" />
                            {repeatMode.mode === 'finite' && repeatMode.count > 0 && (
                                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground pointer-events-none select-none">
                                    {repeatMode.count}
                                </span>
                            )}
                        </Button>
                    </div>
                    <div className="w-full flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatTime(progress)}</span>
                        <Slider
                            value={[progress]}
                            max={duration || 0}
                            step={1}
                            onValueChange={handleProgressChange}
                        />
                        <span>{formatTime(duration)}</span>
                    </div>
                </div>
                
                <div className="flex flex-col items-center justify-center w-1/4 gap-1">
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" size="icon" onClick={toggleMute}>
                            {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                        </Button>
                        <Slider 
                            value={[isMuted ? 0 : volume]}
                            max={1}
                            step={0.05}
                            onValueChange={(value) => {
                                setVolume(value[0]);
                                if(isMuted && value[0] > 0) setIsMuted(false);
                            }}
                            className="w-24"
                        />
                        <Button variant="ghost" size="icon" onClick={handleLikeClick} title={tr('Favorita')}>
                            <Heart className={cn("h-5 w-5", currentSong.isFavorite && "fill-primary text-primary")} />
                        </Button>
                    </div>
                    {/* Vista «Reproduciendo»: portada grande y letra sincronizada. */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="absolute bottom-2 right-2 h-7 w-7 text-muted-foreground hover:text-primary"
                        onClick={() => setNowPlayingOpen(true)}
                        title={tr('Ver la canción a pantalla completa, con su letra')}
                        aria-label={tr('Abrir la vista Reproduciendo')}
                    >
                        <Maximize2 className="h-4 w-4" />
                    </Button>
                    {playingContext && (
                        // De dónde sale lo que suena. Al pulsarlo se vuelve ahí:
                        // la playlist en curso o la biblioteca central.
                        <button
                            type="button"
                            // Lleva a la playlist (o a Música) y ubica la canción que suena,
                            // con el mismo parpadeo azul de «Próxima tarea».
                            onClick={() => router.push(currentSong ? withSong(playingContextHref, currentSong.id) : playingContextHref)}
                            title={tr('Ir a {place}', { place: playbackContextLabel(playingContext) })}
                            className="w-full truncate rounded px-2 text-center text-xs font-semibold text-muted-foreground transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            {playbackContextLabel(playingContext)}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
