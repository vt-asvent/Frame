import type { MouseEvent, ReactNode } from 'react';
import { Check, Music, Trash2 } from 'lucide-react';
import Image from '@/lib/image';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SELECTED_CARD } from '@/components/shared/SelectionBar';
import type { MultiSelect } from '@/hooks/use-multi-select';
import { artistLabel } from '@/lib/enum-labels';
import { songTitle } from '@/lib/music-search';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { Song } from '@/types';

// La tarjeta de una canción, la misma en Música y en cada playlist (2.0.2:
// antes había tres copias casi iguales). Un clic la reproduce; con la
// selección múltiple (use-multi-select), Ctrl+clic o mantenerla presionada la
// marca. `handle`: el asa para arrastrarla, en las playlists.

export default function SongCard({
  song,
  cardId,
  highlighted,
  select,
  onPlay,
  onRemove,
  removeTitle,
  handle,
}: {
  song: Song;
  cardId?: string;
  highlighted?: boolean;
  select: MultiSelect;
  onPlay: () => void;
  onRemove: () => void;
  removeTitle: string;
  handle?: ReactNode;
}) {
  const selected = select.selected.has(song.id);
  const click = (event: MouseEvent) => {
    if (!select.onCardClick(event, song.id)) onPlay();
  };
  return (
    <Card
      id={cardId}
      aria-selected={select.active ? selected : undefined}
      className={cn(
        'group relative select-none bg-accent/40 transition-colors hover:bg-accent/80',
        highlighted && 'animate-pulse-border',
        selected && cn(SELECTED_CARD, 'bg-primary/15')
      )}
    >
      {!select.active && (
        <div className="absolute right-1 top-1 z-10 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={removeTitle}
            aria-label={removeTitle}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-5 w-5" />
          </Button>
        </div>
      )}
      <div className="flex items-center">
        {handle}
        <div onClick={click} {...select.pressProps(song.id)} className="min-w-0 flex-grow cursor-pointer">
          <CardContent className={cn('flex items-center gap-4 p-4', handle && 'pl-0')}>
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-md bg-accent">
              {song.picture ? (
                <Image src={song.picture} alt={songTitle(song)} fill style={{ objectFit: 'cover' }} className="rounded-md" />
              ) : (
                <Music className="h-6 w-6 text-primary" />
              )}
              {selected && (
                <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground shadow" aria-label={tr('Elegida')}>
                  <Check className="h-3.5 w-3.5" />
                </span>
              )}
            </div>
            <div className="flex min-w-0 flex-col truncate">
              <p className="truncate font-semibold text-foreground">{songTitle(song)}</p>
              <p className="truncate text-xs text-muted-foreground">{artistLabel(song.artist)}</p>
            </div>
          </CardContent>
        </div>
      </div>
    </Card>
  );
}
