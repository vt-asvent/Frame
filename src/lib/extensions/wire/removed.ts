import { extKey, extRead, extWrite } from '@/lib/extensions/store';

// ============================================================
// Wire: las canciones que el usuario BORRÓ en este equipo (1.9.6).
//
// Hasta la 1.9.5 el relevo deducía los borrados: «estaba y ya no está». Pero
// una canción también deja de estar cuando el equipo pierde su almacén de
// música (un disco lleno, una base dañada, el sistema que la vacía), y
// entonces todas quedaban como «borradas por el usuario»: no volvían nunca.
//
// Ahora borrar es un hecho que se anota aquí, en el momento de borrar. El
// relevo lo recoge en su siguiente vuelta: lo anotado no se vuelve a traer; lo
// que falta sin estar anotado es una pérdida y se trae de nuevo. Los adjuntos
// y las imágenes no lo necesitan: sus fichas viajan con la cuenta y dicen por
// sí solas si siguen existiendo.
//
// Solo se anota con Wire conectado: lo borrado antes de conectar no es un
// rechazo (al conectar, un equipo recibe lo que tengan los demás, como uno
// nuevo). Sin fechas de por medio: el reloj del equipo puede estar mal.
//
// Sin dependencias del relevo: lo llama CourseContext al confirmar un borrado.
// ============================================================

const WIRE = 'frame.wire';
/** Las que quepan: una lista de borrados nunca debe llenar el almacenamiento. */
const MAX = 4000;

export interface RemovedSong {
  /** Id de la canción en este equipo. */
  id: string;
  /** Su clave entre equipos (song-keys.ts) al borrarla. */
  key: string;
  at: number;
}

const name = (uid: string) => `removed:${uid}`;

const valid = (entry: unknown): entry is RemovedSong =>
  !!entry && typeof entry === 'object' && typeof (entry as RemovedSong).id === 'string' && typeof (entry as RemovedSong).key === 'string';

/** Lo que no cupo en el almacenamiento (estaba lleno): vive en memoria hasta que quepa. */
const unsaved = new Map<string, RemovedSong[]>();

function stored(uid: string): RemovedSong[] {
  const list = extRead<unknown>(WIRE, name(uid), []);
  return Array.isArray(list) ? list.filter(valid) : [];
}

function save(uid: string, list: RemovedSong[]): void {
  extWrite(WIRE, name(uid), list.length > 0 ? list : null);
  const kept = new Set(stored(uid).map((entry) => entry.id));
  const lost = list.filter((entry) => !kept.has(entry.id));
  if (lost.length > 0) unsaved.set(uid, lost);
  else unsaved.delete(uid);
}

/** Lo borrado y aún no recogido por el relevo. */
export function removedSongs(uid: string): RemovedSong[] {
  const waiting = unsaved.get(uid);
  if (!waiting) return stored(uid);
  const ids = new Set(waiting.map((entry) => entry.id));
  const merged = [...stored(uid).filter((entry) => !ids.has(entry.id)), ...waiting].slice(-MAX);
  save(uid, merged);
  return merged;
}

/** El usuario borró esta canción aquí (y no lo deshizo). */
export function noteSongRemoved(uid: string, id: string, key: string): void {
  if (!uid || !id || !key) return;
  if (!extRead<unknown>(WIRE, 'connection', null)) return;
  save(uid, [...removedSongs(uid).filter((entry) => entry.id !== id), { id, key, at: Date.now() }].slice(-MAX));
}

/** El relevo ya las anotó en su estado: fuera de la lista. */
export function forgetRemovedSongs(uid: string, ids: ReadonlySet<string>): void {
  if (ids.size === 0) return;
  save(
    uid,
    removedSongs(uid).filter((entry) => !ids.has(entry.id))
  );
}

/** Wire se conecta de nuevo en este equipo: lo borrado hasta ahora no cuenta. */
export function forgetAllRemoved(): void {
  unsaved.clear();
  const prefix = extKey(WIRE, 'removed:');
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(prefix)) localStorage.removeItem(key);
    }
  } catch {
    /* sin almacenamiento: no hay lista que olvidar */
  }
}
