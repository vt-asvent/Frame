import Link from '@/lib/navigation';
import { usePathname, useSearchParams } from '@/lib/navigation';
import { Music2 } from 'lucide-react';
import type { Playlist } from '@/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function PlaylistItem({
  playlist,
  collapsed = false,
  onNavigate,
}: {
  playlist: Playlist;
  collapsed?: boolean;
  /** Al abrir la playlist (el panel lateral del vertical se cierra con esto). */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const isActive = pathname.includes('/playlists') && searchParams.get('id') === playlist.id;

  return (
    <Button
      variant={isActive ? 'default' : 'ghost'}
      className={cn('text-xs h-8 w-full', collapsed ? 'justify-center px-0' : 'justify-start gap-3')}
      asChild
    >
      {/* RUTA LIMPIA Y ESTÁNDAR */}
      <Link href={`/playlists/?id=${playlist.id}`} onClick={onNavigate} title={collapsed ? playlist.name : undefined}>
        <div className="w-4 flex items-center justify-center shrink-0">
          <Music2 className="h-4 w-4" />
        </div>
        {!collapsed && <span className="truncate">{playlist.name}</span>}
      </Link>
    </Button>
  );
}
