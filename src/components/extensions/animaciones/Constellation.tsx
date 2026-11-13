import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { cn } from '@/lib/utils';

/**
 * «Constelación» (vuelve en la 1.7.3 como animación de la extensión
 * Animaciones): puntos que derivan despacio y se enlazan con líneas finas al
 * acercarse, con un leve parallax del cursor.
 *
 * Es la de la 1.6.7 con sus ahorros (ritmo fijo, enlaces agrupados por
 * transparencia, pausa con la ventana oculta o minimizada) y ahora con
 * parámetros: intensidad, velocidad, densidad, distancia de enlace y color.
 * `contained` la dibuja dentro de su caja (vistas previas) en vez de a
 * pantalla completa detrás de la interfaz.
 */

const AREA_PER_NODE = 19000;
const MAX_NODES = 90;
const DRIFT = 0.55;
const FPS_FOCUSED = 60;
const FPS_BLURRED = 30;
const ALPHA_LEVELS = 24;
const PARALLAX_RANGE = 34;

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  depth: number;
  px: number;
  py: number;
}

/** El color: el del mod si lo trae; si no, `--primary` del tema. */
function readTone(override: string | null): (alpha: number) => string {
  const raw = override ?? getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3) return (alpha) => `rgba(120, 150, 200, ${alpha})`;
  const [h, s, l] = parts;
  return (alpha) => `hsla(${h}, ${s}, ${l}, ${alpha})`;
}

export interface ConstellationProps {
  intensity?: number;
  speed?: number;
  density?: number;
  linkDistance?: number;
  color?: string | null;
  contained?: boolean;
  className?: string;
}

export default function Constellation({
  intensity = 0.6,
  speed = 1,
  density = 1,
  linkDistance = 150,
  color = null,
  contained = false,
  className,
}: ConstellationProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let nodes: Node[] = [];
    let width = 0;
    let height = 0;
    let frameId = 0;
    let lastFrame = 0;
    let focused = document.hasFocus();
    let tone = readTone(color);
    let linkColors: string[] = [];
    let nodeFill = '';
    const paintColors = () => {
      linkColors = Array.from({ length: ALPHA_LEVELS }, (_, level) => tone(((level + 0.5) / ALPHA_LEVELS) * intensity * 0.3));
      nodeFill = tone(intensity * 0.62);
    };
    paintColors();
    const buckets: number[][] = Array.from({ length: ALPHA_LEVELS }, () => []);
    const linkSq = linkDistance * linkDistance;
    const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const box = contained ? canvas.parentElement?.getBoundingClientRect() : null;
      width = Math.max(1, Math.round(box ? box.width : window.innerWidth));
      height = Math.max(1, Math.round(box ? box.height : window.innerHeight));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(6, Math.min(MAX_NODES, Math.round(((width * height) / (contained ? 1000 : AREA_PER_NODE)) * density)));
      nodes = Array.from({ length: count }, () => {
        const x = Math.random() * width;
        const y = Math.random() * height;
        return {
          x,
          y,
          vx: (Math.random() - 0.5) * DRIFT * speed,
          vy: (Math.random() - 0.5) * DRIFT * speed,
          r: 0.9 + Math.random() * 1.5,
          depth: 0.35 + Math.random() * 0.65,
          px: x,
          py: y,
        };
      });
    };

    const draw = (now: number = performance.now()) => {
      frameId = requestAnimationFrame(draw);
      const interval = 1000 / (focused ? FPS_FOCUSED : FPS_BLURRED);
      const elapsed = now - lastFrame;
      if (lastFrame && elapsed < interval - 2) return;
      const step = lastFrame ? Math.min(4, elapsed / (1000 / 60)) : 1;
      lastFrame = now;
      const ease = (k: number) => 1 - Math.pow(1 - k, step);
      parallax.x += (parallax.targetX - parallax.x) * ease(0.07);
      parallax.y += (parallax.targetY - parallax.y) * ease(0.07);

      ctx.clearRect(0, 0, width, height);
      for (const node of nodes) {
        if (!reduced) {
          node.x += node.vx * step;
          node.y += node.vy * step;
          if (node.x < 0 || node.x > width) node.vx *= -1;
          if (node.y < 0 || node.y > height) node.vy *= -1;
        }
        node.px = node.x + parallax.x * node.depth;
        node.py = node.y + parallax.y * node.depth;
      }

      // Enlaces primero y puntos encima; un trazo por nivel de transparencia.
      ctx.lineWidth = 0.7;
      for (const bucket of buckets) bucket.length = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          const dx = a.px - b.px;
          const dy = a.py - b.py;
          const sq = dx * dx + dy * dy;
          if (sq > linkSq) continue;
          const closeness = 1 - Math.sqrt(sq) / linkDistance;
          buckets[Math.min(ALPHA_LEVELS - 1, Math.floor(closeness * ALPHA_LEVELS))].push(a.px, a.py, b.px, b.py);
        }
      }
      for (let level = 0; level < ALPHA_LEVELS; level++) {
        const segments = buckets[level];
        if (segments.length === 0) continue;
        ctx.strokeStyle = linkColors[level];
        ctx.beginPath();
        for (let k = 0; k < segments.length; k += 4) {
          ctx.moveTo(segments[k], segments[k + 1]);
          ctx.lineTo(segments[k + 2], segments[k + 3]);
        }
        ctx.stroke();
      }
      ctx.fillStyle = nodeFill;
      ctx.beginPath();
      for (const node of nodes) {
        ctx.moveTo(node.px + node.r, node.py);
        ctx.arc(node.px, node.py, node.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    const start = () => {
      if (!frameId) {
        lastFrame = 0;
        draw();
      }
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
            void win
              .isMinimized()
              .then((minimized) => (minimized ? stop() : document.hidden || start()))
              .catch(() => undefined);
          });
          if (disposed) unlisten();
          else stopMinimizeWatch = unlisten;
        })
        .catch(() => undefined);
    }

    const handleMouseMove = (event: MouseEvent) => {
      parallax.targetX = (event.clientX / window.innerWidth - 0.5) * PARALLAX_RANGE;
      parallax.targetY = (event.clientY / window.innerHeight - 0.5) * PARALLAX_RANGE;
    };

    // El tema o el acento cambian `--primary`: se relee al vuelo.
    const retone = () => {
      tone = readTone(color);
      paintColors();
    };
    const themeObserver = new MutationObserver(retone);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-accent', 'data-accent-mod'] });
    window.addEventListener('frame:accent-changed', retone);

    const observer = contained && canvas.parentElement ? new ResizeObserver(resize) : null;
    if (observer && canvas.parentElement) observer.observe(canvas.parentElement);
    resize();
    start();
    if (!contained) {
      window.addEventListener('resize', resize);
      window.addEventListener('mousemove', handleMouseMove);
    }
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
      window.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, [intensity, speed, density, linkDistance, color, contained]);

  return (
    <div className={cn('pointer-events-none overflow-hidden', contained ? 'absolute inset-0' : 'fixed inset-0 -z-10', className)} aria-hidden>
      <canvas ref={canvasRef} className="absolute inset-0 block" />
    </div>
  );
}
