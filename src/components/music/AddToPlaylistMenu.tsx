import { ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useCourse } from '@/context/CourseContext';
import { toast } from '@/hooks/use-toast';
import { tr } from '@/lib/i18n';

// «Añadir a playlist» de la selección múltiple (2.0.2): las canciones marcadas
// van al final de la playlist elegida, sin repetir las que ya estaban.

export default function AddToPlaylistMenu({ songIds, exclude, onDone }: { songIds: readonly string[]; exclude?: string; onDone: () => void }) {
  const { playlists, updatePlaylist } = useCourse();
  const options = playlists.filter((playlist) => playlist.id !== exclude);

  const add = (id: string) => {
    const playlist = playlists.find((p) => p.id === id);
    if (!playlist) return;
    const fresh = songIds.filter((songId) => !playlist.songIds.includes(songId));
    if (fresh.length > 0) updatePlaylist(playlist.id, { songIds: [...playlist.songIds, ...fresh] });
    toast({
      title:
        fresh.length === 0
          ? tr('Ya estaban en «{name}»', { name: playlist.name })
          : fresh.length === 1
            ? tr('1 canción añadida a «{name}»', { name: playlist.name })
            : tr('{n} canciones añadidas a «{name}»', { n: fresh.length, name: playlist.name }),
    });
    onDone();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-8 px-2 text-xs">
          <ListPlus className="mr-1 h-4 w-4" />
          {tr('Añadir a playlist')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="max-h-72 overflow-y-auto">
        {options.length === 0 ? (
          <DropdownMenuItem disabled>{exclude ? tr('No tienes otras playlists') : tr('Aún no tienes playlists')}</DropdownMenuItem>
        ) : (
          options.map((playlist) => (
            <DropdownMenuItem key={playlist.id} onSelect={() => add(playlist.id)}>
              {playlist.name}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
