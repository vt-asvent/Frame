import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openItem, readRange, type BibItem } from './biblioteca';
import { demoOn } from './source';

// ============================================================
// PDF de la Biblioteca con pdf.js (1.9.7): la vista previa pide a la nube
// solo los tramos que necesita (las primeras páginas de una guía de 20 MB son
// unos pocos cientos de KB). pdf.js se carga la primera vez que hace falta.
// Sus archivos de apoyo (decodificadores en WebAssembly y las 14 fuentes
// estándar) los sirve Frame en /pdfjs/ (vite.config.ts, `pdfjsAssets`).
// ============================================================

type PdfJs = typeof import('pdfjs-dist');
let loading: Promise<PdfJs> | null = null;

function pdfjs(): Promise<PdfJs> {
  loading ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  });
  return loading;
}

/** Documentos abiertos hace poco (volver a uno no vuelve a pedir lo ya leído). */
interface Opened {
  promise: Promise<PDFDocumentProxy>;
  destroy: () => void;
}
const open = new Map<string, Opened>();
const KEEP = 3;

/** Tramos de 256 KB: pocos viajes y poco de más. */
const CHUNK = 256 * 1024;

export function openPdf(item: BibItem): Promise<PDFDocumentProxy> {
  const key = `${item.id}:${item.modified ?? ''}`;
  const ready = open.get(key);
  if (ready) {
    // Al final: es el más reciente.
    open.delete(key);
    open.set(key, ready);
    return ready.promise;
  }
  let destroyTask: (() => void) | null = null;
  let destroyed = false;
  const promise = pdfjs().then(async (lib) => {
    class Ranges extends lib.PDFDataRangeTransport {
      override requestDataRange(begin: number, end: number) {
        readRange(item, begin, end)
          .then((chunk) => this.onDataRange(begin, chunk))
          .catch(() => this.abort());
      }
    }
    const base = `${import.meta.env.BASE_URL}pdfjs/`;
    const common = {
      rangeChunkSize: CHUNK,
      disableAutoFetch: true,
      disableStream: true,
      isEvalSupported: false,
      enableXfa: false,
      wasmUrl: `${base}wasm/`,
      standardFontDataUrl: `${base}fonts/`,
    };
    // Sin tamaño conocido (o con los datos de ejemplo) no se pide por tramos: se baja entero.
    const whole = item.size <= 0 || demoOn() ? new Uint8Array(await (await openItem(item)).arrayBuffer()) : null;
    if (destroyed) throw new Error('cerrado');
    const task = whole ? lib.getDocument({ ...common, data: whole }) : lib.getDocument({ ...common, range: new Ranges(item.size, null) });
    destroyTask = () => void task.destroy().catch(() => undefined);
    if (destroyed) destroyTask();
    return task.promise;
  });
  const entry: Opened = {
    promise,
    destroy: () => {
      destroyed = true;
      destroyTask?.();
    },
  };
  promise.catch(() => open.get(key) === entry && open.delete(key));
  open.set(key, entry);
  while (open.size > KEEP) {
    const [oldest, doc] = open.entries().next().value as [string, Opened];
    open.delete(oldest);
    doc.destroy();
  }
  return promise;
}

export function forgetPdfs(): void {
  for (const doc of open.values()) doc.destroy();
  open.clear();
}

/**
 * Dibuja una página en un canvas al ancho dado (en píxeles CSS). Devuelve una
 * función para cancelar (la página salió de la vista o el diálogo se cerró).
 */
export function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): { done: Promise<void>; cancel: () => void } {
  let cancelled = false;
  let cancelTask: (() => void) | null = null;
  const done = doc.getPage(pageNumber).then(async (page) => {
    if (cancelled) return;
    const base = page.getViewport({ scale: 1 });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: (cssWidth / base.width) * ratio });
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.aspectRatio = `${base.width} / ${base.height}`;
    const task = page.render({ canvas, viewport });
    cancelTask = () => task.cancel();
    try {
      await task.promise;
    } catch (e) {
      if ((e as { name?: string }).name !== 'RenderingCancelledException') throw e;
    }
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelTask?.();
    },
  };
}
