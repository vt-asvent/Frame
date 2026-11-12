import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Archivos de apoyo de pdf.js (Biblioteca, 1.9.7): los decodificadores de
// imágenes JBIG2 y JPEG 2000 (WebAssembly, con su respaldo en JS), el de color
// ICC y las 14 fuentes estándar. Se sirven desde node_modules en desarrollo y
// se copian a dist/pdfjs/ al compilar: el repositorio no guarda binarios.
const ROOT = path.resolve(__dirname, '..', 'node_modules', 'pdfjs-dist');
const SETS: { from: string; to: string; keep: (name: string) => boolean }[] = [
  { from: 'wasm', to: 'pdfjs/wasm', keep: (n) => /^(jbig2|openjpeg|qcms)/.test(n) && /\.(wasm|js)$/.test(n) },
  { from: 'standard_fonts', to: 'pdfjs/fonts', keep: (n) => /\.(pfb|ttf)$/.test(n) },
];

const files = () =>
  SETS.flatMap((set) =>
    fs
      .readdirSync(path.join(ROOT, set.from))
      .filter(set.keep)
      .map((name) => ({ url: `${set.to}/${name}`, file: path.join(ROOT, set.from, name) }))
  );

const TYPES: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript', '.pfb': 'application/octet-stream', '.ttf': 'font/ttf' };

export function pdfjsAssets(): Plugin {
  return {
    name: 'frame-pdfjs-assets',
    configureServer(server) {
      const byUrl = new Map(files().map((f) => [`/${f.url}`, f.file]));
      server.middlewares.use((req, res, next) => {
        const file = byUrl.get((req.url ?? '').split('?')[0]!);
        if (!file) return next();
        res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files()) this.emitFile({ type: 'asset', fileName: f.url, source: fs.readFileSync(f.file) });
    },
  };
}
