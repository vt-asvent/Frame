// Un equipo con el relevo REAL de Wire: src/lib/extensions/wire/ (relay.ts,
// drive.ts, plan.ts, removed.ts) y src/lib/song-keys.ts. Lo único simulado es
// la red (el `fetch` del contexto: un Google Drive falso) y lo que el relevo
// llama de otras partes de Frame (scripts/relevo/falsos.ts). Ver
// scripts/probar-relevo.mjs.
import {
  confirmDriveAccount,
  deviceName,
  disconnectWire,
  noteWirePeer,
  renameDevice,
  requestWireCycle,
  runWireCycle,
  togglePin,
  useWireStatus,
  wireConnection,
} from '@/lib/extensions/wire/relay';
import { noteSongRemoved, removedSongs } from '@/lib/extensions/wire/removed';
import { libraryKeys } from '@/lib/song-keys';

(globalThis as unknown as Record<string, unknown>).wire = {
  confirmDriveAccount,
  deviceName,
  disconnectWire,
  noteWirePeer,
  renameDevice,
  requestWireCycle,
  runWireCycle,
  togglePin,
  status: useWireStatus,
  wireConnection,
  noteSongRemoved,
  removedSongs,
  libraryKeys,
};
