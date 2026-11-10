import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from '@/lib/navigation';
import Image from '@/lib/image';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import { dndAccessibility } from '@/lib/dnd-a11y';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Pencil, Trash2, Check, X, LoaderCircle, Shuffle, PlusCircle, Music, Menu, Camera, Search } from 'lucide-react';
import WaveBackdrop from '@/components/courses/WaveBackdrop';
import ImagePickerDialog from '@/components/shared/ImagePickerDialog';
import { aspectOf } from '@/components/shared/ImageCropper';
import { setEntityImage, type ImageSource } from '@/lib/image-refs';
import { useStoredImage } from '@/hooks/use-stored-image';
import { cn } from '@/lib/utils';
import { formatHoursMinutes } from '@/lib/duration';
import { easedMask, easedVeil } from '@/lib/eased-fade';
import { formatListened, listeningAllTime, playsText, useListening } from '@/lib/listening';
import type { Playlist, Song } from '@/types';
import { useCourse } from '@/context/CourseContext';
import SongPickerGrid from '@/components/music/SongPickerGrid';
import { songCardId, useSongHighlight } from '@/hooks/use-song-highlight';
import { songMatches, songTitle } from '@/lib/music-search';
import { EchoHeader } from '@/components/shared/EchoWord';
import { tr } from '@/lib/i18n';
import { artistLabel } from '@/lib/enum-labels';

/** La imagen: transparente (= fondo de la app) a la izquierda, entera a la derecha. */
const HEADER_IMAGE_MASK = easedMask('to right');
/** El velo: color del fondo a la izquierda, transparente a la derecha. */
const HEADER_BACKGROUND_VEIL = easedVeil('to right');

const SortablePlaylistSongCard = ({ song, onPlay, onRemove, highlighted }: { song: Song; onPlay: () => void; onRemove: () => void; highlighted?: boolean }) => {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        zIndex: isDragging ? 10 : 'auto',
    };

    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onRemove();
    };

    return (
        <div ref={setNodeRef} style={style} id={songCardId(song.id)}>
            <Card className={cn("bg-accent/40 group relative transition-shadow", isDragging && "shadow-lg opacity-75", highlighted && 'animate-pulse-border')}>
                 <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={handleDeleteClick}>
                        <Trash2 className="h-5 w-5" />
                    </Button>
                </div>
                <div className="flex items-center">
                    <div {...attributes} {...listeners} className="p-4 cursor-grab active:cursor-grabbing touch-none">
                        <Menu className="h-5 w-5 text-muted-foreground/60" />
                    </div>
                    <div onClick={onPlay} className="flex-grow cursor-pointer hover:bg-accent/80 min-w-0">
                        <CardContent className="p-4 pl-0 flex items-center gap-4">
                            <div className="relative h-16 w-16 shrink-0 rounded-md bg-accent flex items-center justify-center">
                                {song.picture ? (
                                    <Image
                                        src={song.picture}
                                        alt={songTitle(song)}
                                        fill
                                        style={{objectFit: 'cover'}}
                                        className="rounded-md"
                                    />
                                ) : (
                                    <Music className="h-6 w-6 text-primary" />
                                )}
                            </div>
                            <div className="flex flex-col truncate min-w-0">
                                <p className="font-semibold text-foreground truncate">{songTitle(song)}</p>
                                <p className="text-xs text-muted-foreground truncate">{artistLabel(song.artist)}</p>
                            </div>
                        </CardContent>
                    </div>
                </div>
            </Card>
        </div>
    );
};

// A non-sortable version for when search is active
const PlaylistSongCard = ({ song, onPlay, onRemove, highlighted }: { song: Song; onPlay: () => void; onRemove: () => void; highlighted?: boolean }) => {
    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onRemove();
    };

    return (
        <Card id={songCardId(song.id)} onClick={onPlay} className={cn("bg-accent/40 group relative transition-shadow cursor-pointer hover:bg-accent/80", highlighted && 'animate-pulse-border')}>
            <div className="absolute top-1 right-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={handleDeleteClick}>
                    <Trash2 className="h-5 w-5" />
                </Button>
            </div>
            <CardContent className="p-4 flex items-center gap-4">
                 <div className="relative h-16 w-16 shrink-0 rounded-md bg-accent flex items-center justify-center">
                    {song.picture ? (
                        <Image
                            src={song.picture}
                            alt={songTitle(song)}
                            fill
                            style={{objectFit: 'cover'}}
                            className="rounded-md"
                        />
                    ) : (
                        <Music className="h-6 w-6 text-primary" />
                    )}
                </div>
                <div className="flex flex-col truncate min-w-0">
                    <p className="font-semibold text-foreground truncate">{songTitle(song)}</p>
                    <p className="text-xs text-muted-foreground truncate">{artistLabel(song.artist)}</p>
                </div>
            </CardContent>
        </Card>
    );
};


export default function PlaylistDetailsClient({ id }: { id: string }) {
  const router = useRouter();
  const {
    playlists,
    songs: allSongs,
    areSongsLoading,
    updatePlaylist,
    deletePlaylist,
    playSong,
    userProfile,
  } = useCourse();

  const [playlist, setPlaylist] = useState<Playlist | undefined>(undefined);
  const [playlistSongs, setPlaylistSongs] = useState<Song[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // «Ir a lo que suena» desde el reproductor: centra la canción y parpadea.
  const highlightId = useSongHighlight(!isLoading && playlistSongs.length > 0);
  useEffect(() => {
    // Si un filtro la escondía, se quita para poder mostrarla.
    if (highlightId) setSearchQuery('');
  }, [highlightId]);
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedPlaylistName, setEditedPlaylistName] = useState('');

  // Cuánto ha sonado esta playlist desde que Frame lo mide (1.8.0).
  const listened = useListening(userProfile?.id, listeningAllTime, []);
  const listStats = listened && playlist ? listened.lists.find((l) => l.id === playlist.id) : undefined;

  const [isAddSongsOpen, setAddSongsOpen] = useState(false);
  const [addSongsSearch, setAddSongsSearch] = useState('');
  const [songToRemove, setSongToRemove] = useState<Song | null>(null);

  const [isImagePickerOpen, setImagePickerOpen] = useState(false);
  // El encuadre usa la proporción real de la mitad derecha de la cabecera.
  const headerImageRef = useRef<HTMLDivElement>(null);
  const [pickerAspect, setPickerAspect] = useState<number>();
  const playlistId = playlist?.id ?? null;
  // Imagen propia de la cabecera (clave `playlistImage_<id>`, junto a las
  // portadas). Se relee sola: también cuando llega de otro dispositivo.
  const [customImage, setCustomImage] = useStoredImage(playlistId ? `playlistImage_${playlistId}` : null);
  const handleSelectImage = async (dataUrl: string, source?: ImageSource) => {
    if (!playlistId) return;
    await setEntityImage(userProfile?.id, `playlistImage_${playlistId}`, dataUrl, source);
    setCustomImage(dataUrl);
    setImagePickerOpen(false);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    // Wait until songs are loaded from IndexedDB before trying to process playlists.
    // This prevents a race condition where playlists are loaded from localStorage
    // before the async song loading from IndexedDB is complete.
    if (areSongsLoading) {
      setIsLoading(true);
      return;
    }

    const foundPlaylist = playlists.find(p => p.id === id);
    if (foundPlaylist) {
      setPlaylist(foundPlaylist);
      setEditedPlaylistName(foundPlaylist.name);
      
      const songsInPlaylist = foundPlaylist.songIds
        .map(songId => allSongs.find(s => s.id === songId))
        .filter((s): s is Song => !!s);
      
      setPlaylistSongs(songsInPlaylist);
    } else {
        setPlaylist(undefined);
        setPlaylistSongs([]);
    }
    // Set loading to false only after all data processing is complete.
    setIsLoading(false);
  }, [id, playlists, allSongs, areSongsLoading]);


  // Persist the new order after a drag operation finishes.
  // This useEffect runs after the component re-renders with the new local `playlistSongs` state.
  const persistOrder = (ordered: Song[]) => {
      if (!playlist) return;
      const visible = new Set(ordered.map(s => s.id));
      // Las canciones que no están en ESTE equipo conservan su sitio exacto:
      // solo se reordenan los huecos de las visibles. Antes se iban al final y
      // en el otro dispositivo, donde sí están, la playlist se desordenaba.
      let next = 0;
      const newSongIds = playlist.songIds.map(songId => (visible.has(songId) ? ordered[next++]?.id ?? songId : songId));
      if (JSON.stringify(newSongIds) !== JSON.stringify(playlist.songIds)) {
          updatePlaylist(playlist.id, { songIds: newSongIds });
      }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Update local state immediately for smooth UI feedback.
      // The useEffect above will handle persisting the change to the context.
      const oldIndex = playlistSongs.findIndex((item) => item.id === active.id);
      const newIndex = playlistSongs.findIndex((item) => item.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      const reordered = arrayMove(playlistSongs, oldIndex, newIndex);
      setPlaylistSongs(reordered);
      persistOrder(reordered);
    }
  };


  /** Mismo buscador que la biblioteca: por nombre Y por artista. */
  const filteredSongs = useMemo(
    () => (searchQuery ? playlistSongs.filter(song => songMatches(song, searchQuery)) : playlistSongs),
    [searchQuery, playlistSongs]
  );

  const handleEdit = () => {
    if (playlist) {
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    if (playlist) setEditedPlaylistName(playlist.name);
  };

  const handleSaveName = () => {
    if (editedPlaylistName.trim() && playlist) {
      updatePlaylist(playlist.id, { name: editedPlaylistName.trim() });
      setIsEditing(false);
    }
  };

  const handleDelete = () => {
    if (playlist) {
      deletePlaylist(playlist.id);
      router.push('/music');
    }
  };
  
  const handlePlaySong = (song: Song) => {
    playSong(song, {
      context: playlist?.name,
      queue: playlistSongs,
      // La barra inferior enseña este nombre; con la ruta, además, vuelve aquí.
      href: playlist ? `/playlists?id=${encodeURIComponent(playlist.id)}` : undefined,
    });
  };
  
  const handleShufflePlay = () => {
    if (playlistSongs.length === 0) return;
    const randomIndex = Math.floor(Math.random() * playlistSongs.length);
    handlePlaySong(playlistSongs[randomIndex]);
  };

  /** Añade la canción EN EL ACTO, sin "Guardar cambios": si el usuario cierra
   *  el diálogo a medias no pierde lo que llevaba añadido. */
  const handleAddSongToPlaylist = (songId: string) => {
      if (!playlist || playlist.songIds.includes(songId)) return;
      updatePlaylist(playlist.id, { songIds: [...playlist.songIds, songId] });
  };

  const handleRemoveSongFromPlaylist = (songId: string) => {
      if (playlist) {
          const newSongIds = playlist.songIds.filter(id => id !== songId);
          updatePlaylist(playlist.id, { songIds: newSongIds });
      }
  };

  if (isLoading) {
    return <div className="flex h-full w-full items-center justify-center"><LoaderCircle className="h-10 w-10 animate-spin text-primary" /></div>;
  }

  if (!playlist) {
    return (
      <div className="text-center py-16 p-6">
        <p className="text-lg text-muted-foreground">{tr('Playlist no encontrada.')}</p>
        <Button onClick={() => router.push('/music')} className="mt-4">{tr('Ir al Inicio')}</Button>
      </div>
    );
  }
  
  // Imagen de cabecera: la elegida; si no hay, la portada de su primera canción.
  const headerImage = customImage ?? playlistSongs.find((song) => song.picture)?.picture ?? null;

  // Disable drag-and-drop while searching to prevent ordering conflicts.
  const isSearching = searchQuery.trim().length > 0;
  
  const songsToShow = isSearching ? filteredSongs : playlistSongs;

  // Duración total de lo que se ve (toda la playlist, o lo que encuentra la
  // búsqueda, igual que el contador). Las canciones anteriores a la 1.6.7 se
  // miden en segundo plano: mientras falte alguna, «calculando…».
  let totalSeconds = 0;
  let measuring = false;
  for (const song of songsToShow) {
    if (typeof song.duration === 'number') totalSeconds += song.duration;
    else measuring = true;
  }
  const totalLabel = songsToShow.length === 0
    ? null
    : measuring
      ? tr('calculando…')
      : totalSeconds > 0
        ? formatHoursMinutes(totalSeconds / 60)
        : null;

  return (
    <div className="space-y-6 px-6 pb-6 md:px-8 md:pb-8">
      {/* CABECERA a sangre, en cuartos (1.6.7, Diego). Mitad izquierda: nombre,
          buscador (con el contador dentro) y acciones, apilados. La imagen
          ocupa los 3/4 de la derecha y, hacia la izquierda, se vuelve del color
          del fondo; un velo ocupa los 3/4 de la izquierda: empieza con el color
          del fondo y se vuelve transparente hacia la derecha. Así la imagen
          nace sin borde. */}
      <div className="relative -mx-6 overflow-hidden border-b border-border/60 md:-mx-8">
        {/* La imagen se funde con una MÁSCARA de transparencia, no con un
            degradado pintado: así se ve el fondo real de la app, en modo claro
            y oscuro. */}
        <div
          ref={headerImageRef}
          className="absolute inset-y-0 right-0 w-3/4"
          style={{ WebkitMaskImage: HEADER_IMAGE_MASK, maskImage: HEADER_IMAGE_MASK }}
          aria-hidden
        >
          {/* 2 px después del borde transparente de la máscara (ver HomeCards). */}
          <div className="absolute inset-y-0 left-0.5 right-0 overflow-hidden">
            {headerImage ? (
              <img src={headerImage} alt="" className="h-full w-full object-cover" />
            ) : (
              <WaveBackdrop />
            )}
          </div>
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 left-0 w-3/4"
          style={{ backgroundImage: HEADER_BACKGROUND_VEIL }}
          aria-hidden
        />

        {/* Cambiar la imagen: esquina superior derecha de la interfaz. */}
        <Button
          size="icon"
          variant="ghost"
          onClick={() => {
            setPickerAspect(aspectOf(headerImageRef.current));
            setImagePickerOpen(true);
          }}
          title={tr('Cambiar la imagen de la playlist')}
          aria-label={tr('Cambiar la imagen de la playlist')}
          className="absolute right-4 top-4 z-10 h-10 w-10 rounded-full border border-border/60 bg-background/70 text-foreground backdrop-blur transition-colors hover:bg-background hover:text-primary md:right-6"
        >
          <Camera className="h-5 w-5" />
        </Button>

        <div className="relative z-[1] w-full space-y-4 px-6 py-7 md:w-1/2 md:px-8">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                value={editedPlaylistName}
                onChange={(e) => setEditedPlaylistName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                autoFocus
                className="h-12 text-center text-3xl font-bold"
              />
              <Button size="icon" variant="ghost" onClick={handleSaveName} title={tr('Guardar el nombre')}><Check className="h-6 w-6 text-green-500"/></Button>
              <Button size="icon" variant="ghost" onClick={handleCancelEdit} title={tr('Descartar')}><X className="h-6 w-6 text-red-500"/></Button>
            </div>
          ) : (
            <h1 className="truncate text-center font-headline text-4xl font-bold leading-[3rem] text-primary" title={playlist.name}>
              {playlist.name}
            </h1>
          )}
          {listStats && listStats.seconds >= 60 && !isEditing && (
            <p className="-mt-3 text-center text-xs tabular-nums text-muted-foreground">
              {tr('Escuchada {time} · {plays}', { time: formatListened(listStats.seconds), plays: playsText(listStats.plays) })}
            </p>
          )}

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="playlist-search"
              aria-label={tr('Buscar en la playlist')}
              placeholder={tr('canciones o artistas…')}
              className={cn('w-full border-primary bg-card pl-9', totalLabel ? 'pr-52' : 'pr-32')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 whitespace-nowrap text-xs text-muted-foreground">
              / <span className="font-bold text-foreground/80">{songsToShow.length}</span>{' '}
              {songsToShow.length === 1 ? tr('canción') : tr('canciones')}
              {totalLabel && (
                <>
                  {' · '}
                  <span className={cn(!measuring && 'font-bold text-foreground/80')}>{totalLabel}</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-md border border-primary bg-primary/20"
                onClick={handleShufflePlay}
                disabled={playlistSongs.length === 0}
                title={tr('Reproducir en orden aleatorio')}
              >
                <Shuffle className="h-5 w-5 text-primary" />
              </Button>
              <Button onClick={() => setAddSongsOpen(true)}>
                <PlusCircle />
                {tr('Añadir canciones')}
              </Button>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={handleEdit} title={tr('Cambiar el nombre')}><Pencil className="h-5 w-5" /></Button>
              <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="icon" title={tr('Eliminar la playlist')}><Trash2 className="h-5 w-5 text-red-500/90" /></Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{tr('¿Eliminar esta playlist?')}</AlertDialogTitle>
                    <AlertDialogDescription>{tr('Se eliminará «{name}». Las canciones siguen en tu biblioteca.', { name: playlist.name })}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{tr('Eliminar')}</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </div>

      {isImagePickerOpen && (
        <ImagePickerDialog
          open={isImagePickerOpen}
          onOpenChange={setImagePickerOpen}
          onSelect={handleSelectImage}
          title={tr('Imagen de {name}', { name: playlist.name })}
          aspect={pickerAspect}
        />
      )}
      
      {songsToShow.length > 0 ? (
         !isSearching ? (
            <DndContext accessibility={dndAccessibility()}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
                modifiers={[restrictToParentElement]}
            >
                <SortableContext items={playlistSongs} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {playlistSongs.map(song => (
                            <SortablePlaylistSongCard
                                key={song.id}
                                song={song}
                                onPlay={() => handlePlaySong(song)}
                                onRemove={() => setSongToRemove(song)}
                                highlighted={song.id === highlightId}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>
         ) : (
             <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredSongs.map(song => (
                    <PlaylistSongCard
                        key={song.id}
                        song={song}
                        onPlay={() => handlePlaySong(song)}
                        onRemove={() => setSongToRemove(song)}
                        highlighted={song.id === highlightId}
                    />
                ))}
             </div>
         )
      ) : (
        <Card className="border-dashed mt-8 flex flex-col items-center justify-center text-center p-12 gap-4">
          <div className="p-4 rounded-full bg-primary/20">
              <Music className="h-10 w-10 text-primary" />
          </div>
          <div className="space-y-1">
              <h3 className="font-semibold text-lg">{tr('Playlist vacía')}</h3>
              <p className="text-sm text-muted-foreground">{searchQuery ? tr('No hay canciones que coincidan con tu búsqueda.') : tr('Usa el botón "Añadir canciones" para llenar esta playlist.')}</p>
          </div>
        </Card>
      )}

      {/* Mismo selector que al CREAR la playlist: rejilla de dos columnas con
          portada, escucha previa y "+" que añade en el acto. Antes aquí
          reaparecía una lista de casillas con el nombre del archivo. */}
      <Dialog open={isAddSongsOpen} onOpenChange={setAddSongsOpen}>
        <DialogContent className="max-w-2xl">
          <EchoHeader word={tr('Añadir')}>
            <DialogHeader>
              <DialogTitle className="text-center text-xl font-bold text-primary">
                {tr('Añadir canciones a «{name}»', { name: playlist.name })}
              </DialogTitle>
            </DialogHeader>
          </EchoHeader>

          <SongPickerGrid
            selectedIds={playlist.songIds}
            onAdd={handleAddSongToPlaylist}
            search={addSongsSearch}
            onSearchChange={setAddSongsSearch}
          />

          <DialogFooter className="items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {playlist.songIds.length}{" "}
              {playlist.songIds.length === 1 ? tr('canción en la playlist') : tr('canciones en la playlist')}
            </p>
            <Button onClick={() => setAddSongsOpen(false)}>{tr('Listo')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!songToRemove} onOpenChange={(isOpen) => !isOpen && setSongToRemove(null)}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>{tr('¿Eliminar canción de la playlist?')}</AlertDialogTitle>
                <AlertDialogDescription>
                    {tr('Esto quitará «{song}» de la playlist «{playlist}». La canción permanecerá en tu biblioteca.', { song: songToRemove ? songTitle(songToRemove) : '', playlist: playlist.name })}
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
                <AlertDialogAction 
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => {
                        if (songToRemove) {
                            handleRemoveSongFromPlaylist(songToRemove.id);
                            setSongToRemove(null);
                        }
                    }}
                >
                    {tr('Eliminar')}
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
