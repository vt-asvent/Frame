import { useSyncExternalStore } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { extRead, extWrite, onExtensionTeardown } from '@/lib/extensions/store';
import { blobToBase64, browserDownload } from '@/lib/file-save';
import { errorText, tr } from '@/lib/i18n';
import { trackEvent } from '@/lib/telemetry';
import { fileNameOf, type BibItem, type BibModel, type BibPrograma } from './biblioteca';
import { AKLORE, demoOn, fromCloud } from './source';

// ============================================================
// Biblioteca → «Tu paquete» (1.9.9, Diego): las asignaturas que la
// configuración da por fijas más las que el alumno elige, bajadas enteras a
// Descargas, cada una en su carpeta («Biblioteca de Frame/Física»).
//
// Son cientos de archivos: la descarga sigue aunque se cierre el recuadro o se
// salga de la Biblioteca, va de a dos, se puede detener, y recuerda lo ya
// bajado (por archivo y versión) para no repetirlo: si se corta, se queda sin
// red o llega al tope del día, al volver a pulsar sigue donde quedó.
// ============================================================

/** Carpeta de Descargas donde queda el paquete (la fija el núcleo nativo, `save_file_in_folder`; aquí, para decirla). */
export const CARPETA = 'Biblioteca de Frame';

export interface PackState {
  status: 'idle' | 'running' | 'done' | 'stopped';
  done: number;
  total: number;
  /** Bytes bajados en esta tanda. */
  bytes: number;
  failed: number;
  /** Por qué se detuvo, si no fue el usuario. */
  message: string | null;
}

const IDLE: PackState = { status: 'idle', done: 0, total: 0, bytes: 0, failed: 0, message: null };
let state: PackState = IDLE;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const set = (patch: Partial<PackState>) => {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
};

export function usePack(): PackState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state,
    () => state
  );
}

/** Las asignaturas extra que el alumno eligió para su paquete (se recuerdan en este equipo). */
export const packExtras = (): string[] => extRead<string[]>(AKLORE, 'paqueteExtras', []);
export const setPackExtras = (names: string[]) => extWrite(AKLORE, 'paqueteExtras', names);

/** Los archivos del paquete: los de las asignaturas fijas y los de las elegidas. */
export function packItems(model: BibModel, programa: BibPrograma, extras: readonly string[]): BibItem[] {
  const names = new Set([...(programa.paquete?.fijas ?? []), ...extras]);
  return model.subjects.filter((s) => names.has(s.name)).flatMap((s) => s.items);
}

/** Lo ya bajado: clave del archivo → versión que se bajó. */
const DONE_KEY = 'paqueteHecho';
const versionOf = (item: BibItem) => `${item.id}:${item.modified ?? ''}:${item.size}`;
const readDone = () => extRead<Record<string, string>>(AKLORE, DONE_KEY, {});

/** Cuántos de esos archivos faltan por bajar (o cambiaron desde que se bajaron). */
export function packPending(items: readonly BibItem[]): BibItem[] {
  const done = readDone();
  return items.filter((it) => done[it.key] !== versionOf(it));
}

/** Lo que viaja de la página al núcleo en cada mensaje: un archivo grande entero no cabe (y menos en un celular). */
const TROZO = 4 * 1_048_576;

async function saveOne(item: BibItem, signal: AbortSignal): Promise<number> {
  // `lote`: la nube anota estas descargas por muestreo, sin una escritura por archivo.
  const blob = await (await fromCloud(`/app/biblioteca/archivo/${encodeURIComponent(item.id)}?lote=1`, signal)).blob();
  if (!isTauri()) browserDownload(blob, fileNameOf(item));
  else {
    // El primer trozo crea el archivo (o reemplaza el de una bajada anterior); los demás se añaden.
    for (let from = 0; from === 0 || from < blob.size; from += TROZO) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      await invoke('save_file_in_folder', { subject: item.subject, fileName: fileNameOf(item), dataBase64: await blobToBase64(blob.slice(from, from + TROZO)), append: from > 0 });
    }
  }
  return blob.size;
}

/** Baja lo que falte de `items`. Si ya hay una descarga en marcha, no hace nada. */
export function startPack(items: readonly BibItem[]): void {
  if (state.status === 'running' || demoOn()) return;
  const queue = packPending(items);
  if (queue.length === 0) {
    set({ ...IDLE, status: 'done', total: items.length, done: items.length });
    return;
  }
  const mine = new AbortController();
  controller = mine;
  const done = readDone();
  set({ status: 'running', total: queue.length, done: 0, bytes: 0, failed: 0, message: null });
  let next = 0;
  let misses = 0;
  let stop: string | null = null;

  const worker = async () => {
    while (!mine.signal.aborted && stop === null && next < queue.length) {
      const item = queue[next++]!;
      try {
        let size: number;
        try {
          size = await saveOne(item, mine.signal);
        } catch (first) {
          // Un tropiezo de la red no descarta el archivo: se intenta otra vez. Lo que dice la nube con `stop` (tope del día, cuenta sin activar), no.
          if (mine.signal.aborted || (first as { stop?: boolean }).stop) throw first;
          size = await saveOne(item, mine.signal);
        }
        done[item.key] = versionOf(item);
        misses = 0;
        set({ done: state.done + 1, bytes: state.bytes + size });
        if (state.done % 10 === 0) extWrite(AKLORE, DONE_KEY, done);
      } catch (error) {
        if (mine.signal.aborted) return;
        misses++;
        set({ failed: state.failed + 1 });
        // Lo que no tiene sentido seguir intentando hoy, o cinco fallos seguidos (sin red): se detiene y lo dice.
        if ((error as { stop?: boolean }).stop || misses >= 5) stop = errorText(error).slice(0, 200);
      }
    }
  };

  void Promise.all([worker(), worker()]).then(() => {
    extWrite(AKLORE, DONE_KEY, done);
    if (state.done > 0) trackEvent('library_download', { n: state.done });
    if (controller === mine) controller = null;
    const left = queue.length - state.done;
    set({
      status: left === 0 ? 'done' : 'stopped',
      message: left === 0 ? null : stop ?? (mine.signal.aborted ? null : tr('{n} archivos no se pudieron bajar. Vuelve a pulsar «Descargar» para reintentarlos.', { n: left })),
    });
  });
}

export function stopPack(): void {
  controller?.abort();
}

/** Para empezar de cero (el recuadro se abre de nuevo tras terminar). */
export function resetPack(): void {
  if (state.status !== 'running') set(IDLE);
}

onExtensionTeardown(`${AKLORE}:paquete`, () => {
  stopPack();
  state = IDLE;
  extWrite(AKLORE, DONE_KEY, null);
  extWrite(AKLORE, 'paqueteExtras', null);
});
