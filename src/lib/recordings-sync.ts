import { deleteRecordingAudio } from '@/lib/music-db';
import { CLOUD_APPLIED_EVENT, deletedIds } from '@/lib/sync-merge';

// ============================================================
// Grabaciones entre dispositivos (2.0.0). La ficha viaja con la cuenta
// (storage-snapshot.ts) y el audio con Wire (relay.ts, clase `recording`).
// Aquí, lo que faltaba para que borrar en un equipo borre en todos: cuando la
// ficha de una grabación tiene lápida (se borró aquí o llegó borrada de otro
// equipo) y ya no está en este, su audio interno también se va.
//
// La copia que la laptop deja en Documentos\Frame\Grabaciones es un archivo
// del usuario: solo la quita quien borra la grabación en esa laptop.
// ============================================================

export function startRecordingsSweep(uid: string): () => void {
  const sweep = () => {
    let here: { id?: string }[] = [];
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(`recordings_${uid}`) ?? '[]');
      if (Array.isArray(stored)) here = stored as { id?: string }[];
    } catch {
      return; // fichas ilegibles: no se borra nada
    }
    const alive = new Set(here.map((record) => record?.id));
    for (const id of deletedIds(uid, 'recordings')) if (!alive.has(id)) void deleteRecordingAudio(id).catch(() => undefined);
  };
  window.addEventListener(CLOUD_APPLIED_EVENT, sweep);
  sweep();
  return () => window.removeEventListener(CLOUD_APPLIED_EVENT, sweep);
}
