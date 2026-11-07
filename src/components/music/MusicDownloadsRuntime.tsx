import { useEffect, useRef } from 'react';
import { useCourse } from '@/context/CourseContext';
import { useContributions } from '@/lib/extensions/store';
import { EngineClient } from '@/lib/extensions/yt-mp3';
import { attachDownloads } from '@/lib/extensions/yt-mp3-downloads';
import { toast } from '@/hooks/use-toast';
import { tr } from '@/lib/i18n';

// ============================================================
// La cola de descargas de Música, en segundo plano (montada en el diseño
// principal): sigue aunque se cierre «+ Añadir» o se cambie de interfaz, y lo
// pendiente continúa al volver a abrir Frame. Le presta a la cola la
// biblioteca del perfil y el programa de cada fuente de música.
// ============================================================

export default function MusicDownloadsRuntime() {
  const { userProfile, songs, addSongs, mergePlaylistSongs, playlists, updatePlaylist } = useCourse();
  const sources = useContributions('musicSource');
  const live = useRef({ songs, addSongs, mergePlaylistSongs, playlists, updatePlaylist, sources });
  live.current = { songs, addSongs, mergePlaylistSongs, playlists, updatePlaylist, sources };
  const clients = useRef(new Map<string, EngineClient>());

  const uid = userProfile?.id ?? null;
  useEffect(() => {
    if (!uid) return;
    return attachDownloads({
      uid,
      clientFor: (sourceId) => {
        const source = live.current.sources.find((s) => s.id === sourceId && s.value.engine);
        if (!source) return null;
        let client = clients.current.get(source.value.page);
        if (!client) {
          client = new EngineClient(source.value.page);
          clients.current.set(source.value.page, client);
        }
        return client;
      },
      songs: () => live.current.songs,
      addSongs: (list) => live.current.addSongs(list),
      mergePlaylistSongs: (name, ids) => live.current.mergePlaylistSongs(name, ids),
      playlists: () => live.current.playlists,
      updatePlaylist: (id, updates) => live.current.updatePlaylist(id, updates),
      finished: ({ done, skipped, failed }) => {
        const parts = [
          done === 1 ? tr('1 canción nueva en tu biblioteca') : tr('{count} canciones nuevas en tu biblioteca', { count: done }),
          ...(skipped > 0 ? [skipped === 1 ? tr('1 ya estaba') : tr('{count} ya estaban', { count: skipped })] : []),
          ...(failed > 0 ? [failed === 1 ? tr('1 con errores') : tr('{count} con errores', { count: failed })] : []),
        ];
        toast({
          variant: failed > 0 && done === 0 ? 'destructive' : 'default',
          title: tr('Descarga terminada'),
          description: parts.join(' · '),
          duration: failed > 0 ? 12000 : 6000,
        });
      },
    });
  }, [uid]);

  return null;
}
