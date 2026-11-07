import { useEffect, type RefObject } from 'react';
import { isTauri } from '@tauri-apps/api/core';

// ============================================================
// El bucle de dibujo de las animaciones de lienzo de 1.8.0 (Aurora boreal,
// Matrix ascendente y Tipoaurora), con los mismos ahorros que Constelación:
// ritmo fijo, menos fotogramas sin foco, pausa con la ventana oculta o
// minimizada y, con «reducir movimiento», un solo fotograma quieto.
// ============================================================

export interface Tone {
  /** «hsla(...)» del color con esa transparencia. */
  css: (alpha: number) => string;
}

/**
 * El color del mod si lo trae («H S% L%»); si no, la variable del tema.
 * `lift` aclara (o, negativo, oscurece) el color en puntos de luminosidad y
 * `minSaturation` le da al menos esa saturación (para luces más vivas).
 */
export function readTone(override: string | null, variable = '--primary', lift = 0, minSaturation = 0): Tone {
  const raw = override ?? getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3) return { css: (alpha) => `rgba(120, 150, 200, ${alpha})` };
  const [h, s, l] = parts;
  const light = Math.min(94, Math.max(6, parseFloat(l) + lift));
  const saturation = Math.max(parseFloat(s), minSaturation);
  const sat = Number.isFinite(saturation) ? `${saturation}%` : s;
  return { css: (alpha) => `hsla(${h}, ${sat}, ${Number.isFinite(light) ? `${light}%` : l}, ${alpha})` };
}

export interface Scene {
  /** Tamaño nuevo en píxeles CSS (al montar y al cambiar de tamaño). */
  resize(width: number, height: number): void;
  /** Un fotograma: `dt` en segundos desde el anterior (acotado) y `time` desde el inicio. */
  frame(ctx: CanvasRenderingContext2D, dt: number, time: number): void;
  /** El tema o el acento cambiaron. */
  retone(): void;
}

interface LoopOptions {
  contained: boolean;
  /** Fotogramas por segundo con la ventana enfocada. */
  fps: number;
  /** Resolución del lienzo respecto a la pantalla (0,5 = la mitad: más suave y barato). */
  resolution?: number;
}

export function useCanvasLoop(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: LoopOptions,
  makeScene: (ctx: CanvasRenderingContext2D) => Scene,
  deps: unknown[]
): void {
  const { contained, fps, resolution = 1 } = options;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = makeScene(ctx);
    let frameId = 0;
    let last = 0;
    const started = performance.now();
    let focused = document.hasFocus();

    const paintStill = () => scene.frame(ctx, 0, 12);

    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2) * resolution;
      const box = contained ? canvas.parentElement?.getBoundingClientRect() : null;
      const width = Math.max(1, Math.round(box ? box.width : window.innerWidth));
      const height = Math.max(1, Math.round(box ? box.height : window.innerHeight));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      scene.resize(width, height);
      if (reduced) paintStill();
    };

    const draw = (now: number = performance.now()) => {
      frameId = requestAnimationFrame(draw);
      const interval = 1000 / (focused ? fps : Math.min(fps, 20));
      if (last && now - last < interval - 2) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps;
      last = now;
      scene.frame(ctx, dt, (now - started) / 1000);
    };
    const start = () => {
      if (reduced || frameId) return;
      last = 0;
      draw();
    };
    const stop = () => {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0;
    };
    const handleVisibility = () => (document.hidden ? stop() : start());
    const handleFocus = () => {
      focused = true;
    };
    const handleBlur = () => {
      focused = false;
    };

    // Minimizada: WebView2 no siempre lo cuenta como «oculta», la ventana sí.
    let stopMinimizeWatch: (() => void) | null = null;
    let disposed = false;
    if (!contained && isTauri()) {
      void import('@tauri-apps/api/window')
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const unlisten = await win.onResized(() => {
            void win.isMinimized().then((minimized) => (minimized ? stop() : document.hidden || start()));
          });
          if (disposed) unlisten();
          else stopMinimizeWatch = unlisten;
        })
        .catch(() => undefined);
    }

    // El tema o el acento cambian `--primary`: se relee al vuelo.
    const retone = () => {
      scene.retone();
      if (reduced) paintStill();
    };
    const themeObserver = new MutationObserver(retone);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-accent', 'data-accent-mod'] });
    window.addEventListener('frame:accent-changed', retone);

    const observer = contained && canvas.parentElement ? new ResizeObserver(resize) : null;
    if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
    resize();
    start();
    if (!contained) window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      disposed = true;
      stopMinimizeWatch?.();
      stop();
      observer?.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('frame:accent-changed', retone);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contained, fps, resolution, ...deps]);
}
