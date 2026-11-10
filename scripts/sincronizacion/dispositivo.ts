// Un dispositivo con el motor de sincronización ACTUAL (el de src/).
import './entorno';
import { startLiveSync } from '@/lib/supabase/live-sync';
import { pushToCloud } from '@/lib/supabase/sync';
import { collectLocalData } from '@/lib/storage-snapshot';
import { localizePlaylists, rememberSongKeys, setLibraryIds } from '@/lib/song-keys';
import { reorderPlaylists } from '@/lib/playlist-order';
import { setEntityImage, startImageRefs } from '@/lib/image-refs';
import { IMAGE_UPDATED_EVENT, getImageRecord } from '@/lib/music-db';
import { agoMs, forgetDevice, getDevices, markDeviceUnlinked, repairAllDevices, setDevicesOpen, startDevices, stateOf } from '@/lib/devices';
import { startSyncCheck } from '@/lib/sync-check';
import { SYNC_NOW_EVENT, getSyncStatus } from '@/lib/sync-status';
import { deviceId } from '@/lib/sync-delta';
import type { Playlist, Song } from '@/types';
import { expose } from './controles';

expose({
  version: 'actual',
  startLiveSync,
  pushToCloud,
  collectLocalData,
  getSyncStatus,
  rememberSongKeys: (uid, songs) => rememberSongKeys(uid, songs as Song[]),
  localizePlaylists,
  reorderPlaylists: (list, orderedIds) => reorderPlaylists(list as Playlist[], orderedIds),
  images: { startImageRefs, setEntityImage, getImageRecord, updatedEvent: IMAGE_UPDATED_EVENT },
  devices: {
    startDevices,
    startSyncCheck,
    getDevices,
    stateOf,
    agoMs,
    setDevicesOpen,
    repairAllDevices,
    markDeviceUnlinked,
    forgetDevice,
    deviceId,
    setLibraryIds,
    syncNowEvent: SYNC_NOW_EVENT,
  },
});
