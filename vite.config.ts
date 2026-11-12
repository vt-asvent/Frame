import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pdfjsAssets } from './scripts/pdfjs-assets';

const pkg = createRequire(import.meta.url)('./package.json') as { version: string };

// Frame — build SPA optimizado para escritorio (Tauri).
export default defineConfig({
  plugins: [react(), pdfjsAssets()],
  // Una sola fuente de verdad para la versión: package.json. Antes estaba
  // escrita a mano en la pantalla de información Y en la telemetría, así que
  // ambas se quedaron congeladas en 1.0.0 mientras la app iba por la 1.2.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Fecha de compilación: la usan los documentos legales como fecha de
    // entrada en vigor, para que no haya que actualizarla a mano.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Tauri espera un puerto fijo en dev y no debe limpiar la pantalla.
  clearScreen: false,
  server: {
    port: 9002,
    strictPort: true,
  },
  // Solo las variables públicas de Tauri (TAURI_ENV_*): con «TAURI_» bastaría
  // citar la clave de firma en el código para meterla en el paquete (1.7.0).
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    // Webview2 (Windows) es Chromium moderno: target alto = bundles más pequeños.
    target: 'chrome120',
    minify: 'esbuild',
    // Mapas ocultos: se generan pero el código no los cita. scripts/guardar-mapas.mjs
    // los saca de dist/ antes de empaquetar y los guarda para leer la pila
    // de los errores reportados.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 1500,
  },
});
