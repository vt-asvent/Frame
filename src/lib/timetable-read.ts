import { useEffect, useState } from 'react';
import { getImage } from '@/lib/music-db';
import { NubeAuthError, nubeCall, sessionProblemText } from '@/lib/nube';
import { getSupabase } from '@/lib/supabase/client';
import { localImageKey, readTimetables, tidyClasses, updateTimetable } from '@/lib/timetable';
import { linkAfterReading } from '@/lib/timetable-links';
import { tr } from '@/lib/i18n';

// ============================================================
// Leer las clases de la foto de un horario (1.9.0).
//
// La foto se reduce aquí (1600 px, JPEG) y va, con la sesión de la cuenta, al
// Worker de Frame en Cloudflare (nube-ia/src/horario.ts), que la lee con
// Qwen 3.8 o Gemma 4 en Workers AI —sin guardarla— y con un cupo diario por cuenta. Lo que
// vuelve se limpia y se une por bloques (timetable.ts) antes de guardarse.
//
// Con la foto van los NOMBRES de las asignaturas de Frame (1.9.3): el mismo
// modelo dice a cuál corresponde cada nombre del horario («Mat. AyE» →
// «Matemática»), y aquí se guarda ese vínculo (timetable-links.ts).
//
// «Leyendo» no se guarda: es de este equipo y de este momento. Si Frame se
// cierra a mitad, el horario queda «sin leer» y se puede repetir.
// ============================================================

export const READING_CHANGED = 'frame:timetable-reading';
const reading = new Set<string>();

export function useReading(id: string | null | undefined): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((value) => value + 1);
    window.addEventListener(READING_CHANGED, bump);
    return () => window.removeEventListener(READING_CHANGED, bump);
  }, []);
  return !!id && reading.has(id);
}

/** La foto reducida a 1600 px en JPEG (sin fondo transparente), en base64. */
async function shrink(dataUrl: string): Promise<{ image: string; mime: string }> {
  const element = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(tr('No se pudo abrir la imagen del horario.')));
    img.src = dataUrl;
  });
  const scale = Math.min(1, 1600 / Math.max(element.naturalWidth, element.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(element.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(element.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error(tr('No se pudo abrir la imagen del horario.'));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(element, 0, 0, canvas.width, canvas.height);
  const out = canvas.toDataURL('image/jpeg', 0.88);
  return { image: out.slice(out.indexOf(',') + 1), mime: 'image/jpeg' };
}

const ERRORS: Record<string, () => string> = {
  account: () => tr('Inicia sesión en tu cuenta de Frame para que lea tu horario.'),
  quota: () => tr('Hoy ya leíste muchos horarios. Inténtalo de nuevo mañana.'),
  image: () => tr('Esa imagen no se pudo enviar. Prueba con una foto o captura en JPG o PNG.'),
  not_configured: () => tr('El lector de horarios aún no está disponible. Inténtalo más tarde.'),
  busy: () => tr('El lector de horarios está muy ocupado ahora. Inténtalo en unos minutos.'),
  daily: () => tr('El lector de horarios ya no tiene lecturas libres hoy. Inténtalo mañana.'),
};

/**
 * Lee (o vuelve a leer) las clases de un horario y las guarda en su ficha, con
 * el vínculo de cada nombre con su asignatura de Frame. True si las leyó.
 */
export async function readTimetable(uid: string, id: string, courses: readonly { id: string; name: string }[] = []): Promise<boolean> {
  if (reading.has(id)) return false;
  const timetable = readTimetables(uid).find((item) => item.id === id);
  if (!timetable) return false;
  reading.add(id);
  window.dispatchEvent(new Event(READING_CHANGED));
  try {
    if (!getSupabase() || !navigator.onLine) throw new Error(tr('Sin conexión: vuelve a intentarlo cuando tengas internet.'));
    const photo = await getImage(localImageKey(uid, timetable));
    if (!photo) throw new Error(tr('La foto de este horario aún no llega a este dispositivo.'));
    // La sesión la resuelve nube.ts: sin cuenta aquí, cerrada en la nube, o sin poder comprobarla ahora.
    const response = await nubeCall('/app/horario', {
      body: JSON.stringify({ ...(await shrink(photo)), subjects: courses.map((course) => course.name.trim().slice(0, 80)).filter(Boolean).slice(0, 60) }),
    }).catch((error: unknown) => {
      if (error instanceof NubeAuthError) throw new Error(error.problem === 'signed-out' ? ERRORS.account() : sessionProblemText(error.problem));
      return null;
    });
    const data = response ? await response.json().catch(() => null) : null;
    if (!response?.ok) {
      // 404: el lector aún no está publicado.
      const code = response?.status === 404 ? 'not_configured' : typeof data?.error === 'string' ? data.error : '';
      throw new Error((ERRORS[code] ?? ERRORS.busy)());
    }
    const classes = tidyClasses(Array.isArray(data?.classes) ? data.classes : []);
    if (classes.length === 0) {
      throw new Error(tr('No se encontraron clases en la imagen. Prueba con una foto más nítida o añádelas a mano en «Semanal».'));
    }
    updateTimetable(uid, id, { classes, read: 'done' });
    const proposed: Record<string, string> = {};
    if (data?.links && typeof data.links === 'object') {
      for (const [subject, name] of Object.entries(data.links as Record<string, unknown>)) if (typeof name === 'string') proposed[subject] = name;
    }
    linkAfterReading(uid, classes, courses, proposed);
    return true;
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : tr('No se pudo leer el horario.');
    updateTimetable(uid, id, { read: 'failed', error: message });
    return false;
  } finally {
    reading.delete(id);
    window.dispatchEvent(new Event(READING_CHANGED));
  }
}
