import { useState } from 'react';
import { ListPlus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { useCourse } from '@/context/CourseContext';
import { toast } from '@/hooks/use-toast';
import { tr } from '@/lib/i18n';

// «Añadir a playlist» de la selección múltiple (2.0.2): las canciones marcadas
// van al final de la playlist elegida, sin repetir las que ya estaban, o a una
// playlist nueva que se crea aquí mismo (sin playlists, el menú no quedaba vacío).

export default function AddToPlaylistMenu({ songIds, exclude, onDone }: { songIds: readonly string[]; exclude?: string; onDone: () => void }) {
  const { playlists, updatePlaylist, mergePlaylistSongs } = useCourse();
  const options = playlists.filter((playlist) => playlist.id !== exclude);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const added = (n: number, playlistName: string) =>
    toast({
      title:
        n === 0
          ? tr('Ya estaban en «{name}»', { name: playlistName })
          : n === 1
            ? tr('1 canción añadida a «{name}»', { name: playlistName })
            : tr('{n} canciones añadidas a «{name}»', { n, name: playlistName }),
    });

  const add = (id: string) => {
    const playlist = playlists.find((p) => p.id === id);
    if (!playlist) return;
    const fresh = songIds.filter((songId) => !playlist.songIds.includes(songId));
    if (fresh.length > 0) updatePlaylist(playlist.id, { songIds: [...playlist.songIds, ...fresh] });
    added(fresh.length, playlist.name);
    onDone();
  };

  const create = () => {
    const clean = name.trim();
    if (!clean) return;
    // Si ya hay una con ese nombre, se suman a ella (mergePlaylistSongs no repite).
    const existing = playlists.find((p) => p.name.trim().toLowerCase() === clean.toLowerCase());
    mergePlaylistSongs(clean, [...songIds]);
    added(existing ? songIds.filter((songId) => !existing.songIds.includes(songId)).length : songIds.length, existing?.name ?? clean);
    setNaming(false);
    setName('');
    onDone();
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs">
            <ListPlus className="mr-1 h-4 w-4" />
            {tr('Añadir a playlist')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-72 overflow-y-auto">
          <DropdownMenuItem onSelect={() => setNaming(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {tr('Nueva playlist')}
          </DropdownMenuItem>
          {options.length > 0 && <DropdownMenuSeparator />}
          {options.map((playlist) => (
            <DropdownMenuItem key={playlist.id} onSelect={() => add(playlist.id)}>
              {playlist.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tr('Nueva playlist')}</DialogTitle>
          </DialogHeader>
          <form
            id="new-playlist-from-selection"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={tr('Nombre de la playlist')} aria-label={tr('Nombre de la playlist')} />
          </form>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setNaming(false)}>
              {tr('Cancelar')}
            </Button>
            <Button type="submit" form="new-playlist-from-selection" disabled={!name.trim()}>
              {tr('Crear')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
