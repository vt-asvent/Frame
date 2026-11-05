import { closeMusicDB, MUSIC_DB_NAME } from '@/lib/music-db';
import { disconnectGoogle } from '@/lib/google/auth';
import { FILE_HANDLES_DB_NAME } from '@/lib/file-handles';
import { wipeProfileMedia } from '@/lib/profile-scope';
import { forgetAllExtensions } from '@/lib/extensions/store';

/** Base del antiguo módulo Conocimiento (Aether KN): sin pantalla desde la
 *  Fase 16 y sin código desde la 1.6.7. Sus datos siguen en el equipo de quien
 *  la usó; borrar la cuenta también la elimina. */
const KNOWLEDGE_DB_NAME = 'AetherDatabase_KN_V2';

/** Rescate para `onblocked`: una conexión viva en otra ventana dejaría la
 *  promesa sin resolver y el diálogo colgado con el indicador de carga. */
const DELETE_TIMEOUT_MS = 3000;

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const rescue = window.setTimeout(finish, DELETE_TIMEOUT_MS);
    const done = () => {
      window.clearTimeout(rescue);
      finish();
    };

    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = done;
      request.onerror = done;
      // `onblocked` no resuelve: lo hará el temporizador de rescate.
    } catch {
      done();
    }
  });
}

/**
 * Borra TODO el rastro local del usuario en este dispositivo: tokens de
 * Google, localStorage completo (incluida la sesión `aether-auth`
 * de Supabase), sessionStorage y las dos bases IndexedDB (música/imágenes y
 * Asignaturas).
 *
 * `localStorage.clear()` es deliberadamente total: es la única forma fiable
 * de cubrir las decenas de claves globales y con sufijo `_<uid>` del proyecto.
 * Por eso NO debe usarse al cerrar sesión, solo al eliminar la cuenta.
 *
 * Llamar siempre después de `signOut()` y del borrado remoto.
 */
/** ¿Hay en este equipo datos de OTRO perfil (un hermano, el perfil de invitado
 *  que se usó antes de crear la cuenta)? */
function otherProfilesOnDevice(uid: string): boolean {
  try {
    if (localStorage.getItem('lastLocalProfile')) return true;
    const suffix = `_${uid}`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? '';
      const match = key.match(/^(courses|tasks|studySessions|habits)_(.+)$/);
      if (match && !key.endsWith(suffix)) return true;
    }
  } catch {
    /* ante la duda se borra todo, que es lo que se pidió */
  }
  return false;
}

/**
 * Borra del equipo lo que Frame guardó del usuario `uid`.
 *
 * Si es el ÚNICO perfil del equipo se arrasa con todo (almacenamiento y bases
 * de datos). Si hay otro, solo se borran las claves de este usuario: antes un
 * `localStorage.clear()` y el borrado de las bases enteras destruían también
 * las asignaturas, la música y los adjuntos del otro perfil, sin avisar.
 */
export async function wipeLocalAccountData(uid?: string): Promise<void> {
  if (uid && otherProfilesOnDevice(uid)) {
    try {
      disconnectGoogle();
    } catch {
      /* revocar tokens es un extra */
    }
    // Su música e imágenes también (1.6.7: son de cada perfil). Antes que sus
    // claves, porque de ellas salen los ids.
    await wipeProfileMedia(uid).catch(() => undefined);
    try {
      const suffix = `_${uid}`;
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) ?? '';
        if (key.endsWith(suffix) || key.endsWith(`${suffix}__bak`) || key.includes(`${suffix}_`)) doomed.push(key);
      }
      doomed.push('userProfile', 'aether-auth');
      doomed.forEach((key) => localStorage.removeItem(key));
      window.sessionStorage.clear();
    } catch {
      /* no bloquear el flujo */
    }
    return;
  }

  try {
    disconnectGoogle();
  } catch {
    /* revocar tokens es un extra: nunca debe frenar el borrado */
  }

  // Las extensiones de este equipo, con sus carpetas y llaves (1.7.3).
  await forgetAllExtensions().catch(() => undefined);

  // Sin cerrar la conexión del módulo, `deleteDatabase` quedaría bloqueado.
  closeMusicDB();

  await Promise.all([
    deleteIndexedDb(MUSIC_DB_NAME),
    deleteIndexedDb(KNOWLEDGE_DB_NAME),
    // Copias y manejadores de los archivos adjuntos a tareas. Se quedaba atrás:
    // "eliminar todo mi rastro" dejaba en el equipo los documentos adjuntados.
    deleteIndexedDb(FILE_HANDLES_DB_NAME),
  ]);

  try {
    window.localStorage.clear();
  } catch {
    /* no bloquear el flujo */
  }
  try {
    window.sessionStorage.clear();
  } catch {
    /* no bloquear el flujo */
  }
}
