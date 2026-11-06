import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Pipette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { customAccent, hexToHsl } from '@/lib/accent';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Selector de color propio (Ajustes → Color, 1.7.6): área de saturación y
// brillo, barra de tono, código hex, RGB y HSL, cuentagotas (si el sistema lo
// permite) y la vista previa del acento en claro y en oscuro, que es lo que
// Frame aplicará de verdad.
// ============================================================

type Hsv = { h: number; s: number; v: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5) * 255, f(3) * 255, f(1) * 255];
}

const HEX = /^#?[0-9a-f]{6}$/i;

/** Arrastre dentro de un rectángulo: devuelve la posición relativa 0..1. */
function useDrag(onMove: (x: number, y: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const move = useCallback(
    (event: PointerEvent | ReactPointerEvent) => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      onMove(clamp((event.clientX - box.left) / box.width, 0, 1), clamp((event.clientY - box.top) / box.height, 0, 1));
    },
    [onMove]
  );
  const onPointerDown = (event: ReactPointerEvent) => {
    event.preventDefault();
    move(event);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { ref, onPointerDown };
}

export default function ColorPicker({ initial, onApply }: { initial: string; onApply: (hex: string) => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(...hexToRgb(initial)));
  const hex = rgbToHex(...hsvToRgb(hsv));
  const [hexDraft, setHexDraft] = useState(hex);
  useEffect(() => setHexDraft(hex), [hex]);
  const [r, g, b] = hexToRgb(hex);
  const [hh, ss, ll] = hexToHsl(hex);
  const preview = customAccent(hex);

  const sv = useDrag(useCallback((x, y) => setHsv((c) => ({ ...c, s: x, v: 1 - y })), []));
  const hue = useDrag(useCallback((x) => setHsv((c) => ({ ...c, h: x * 359.9 })), []));

  const setRgb = (index: number, value: string) => {
    const n = clamp(Number(value) || 0, 0, 255);
    const next: [number, number, number] = [r, g, b];
    next[index] = n;
    setHsv(rgbToHsv(...next));
  };

  const eyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
  const pick = async () => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await new (window as any).EyeDropper().open();
      if (HEX.test(result.sRGBHex)) setHsv(rgbToHsv(...hexToRgb(result.sRGBHex)));
    } catch {
      /* el usuario canceló */
    }
  };

  return (
    <div className="w-[17rem] space-y-3">
      <div
        ref={sv.ref}
        onPointerDown={sv.onPointerDown}
        className="relative h-36 w-full cursor-crosshair touch-none overflow-hidden rounded-md"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        role="slider"
        aria-label={tr('Saturación y brillo')}
        aria-valuetext={hex}
      >
        <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
        <span
          className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
        />
      </div>

      <div className="flex items-center gap-2">
        <div
          ref={hue.ref}
          onPointerDown={hue.onPointerDown}
          className="relative h-3 flex-1 cursor-pointer touch-none rounded-full"
          style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}
          role="slider"
          aria-label={tr('Tono')}
          aria-valuenow={Math.round(hsv.h)}
          aria-valuemin={0}
          aria-valuemax={360}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
            style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }}
          />
        </div>
        {eyeDropper && (
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => void pick()} title={tr('Cuentagotas')} aria-label={tr('Cuentagotas')}>
            <Pipette className="h-4 w-4" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-[1fr_repeat(3,2.6rem)] gap-1.5 text-[10px] text-muted-foreground">
        <label className="space-y-0.5">
          <span>HEX</span>
          <Input
            value={hexDraft}
            onChange={(e) => {
              const v = e.target.value.trim();
              setHexDraft(v);
              if (HEX.test(v)) setHsv(rgbToHsv(...hexToRgb(v.startsWith('#') ? v : `#${v}`)));
            }}
            className="h-7 px-2 font-mono text-xs uppercase"
            spellCheck={false}
            maxLength={7}
          />
        </label>
        {(['R', 'G', 'B'] as const).map((label, i) => (
          <label key={label} className="space-y-0.5">
            <span>{label}</span>
            <Input
              type="number"
              min={0}
              max={255}
              value={[r, g, b][i]}
              onChange={(e) => setRgb(i, e.target.value)}
              className="h-7 px-1 text-center font-mono text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
          </label>
        ))}
      </div>
      <p className="font-mono text-[10px] text-muted-foreground">HSL {hh}° {ss}% {ll}%</p>

      <div className="grid grid-cols-2 gap-1.5">
        {(['light', 'dark'] as const).map((mode) => (
          <div
            key={mode}
            className={cn('flex items-center justify-between rounded-md px-2 py-1.5 text-[10px]', mode === 'light' ? 'bg-[#F3EFE6] text-[#2B2620]' : 'bg-[#1B1B1D] text-[#E9E6E1]')}
          >
            <span>{mode === 'light' ? tr('Claro') : tr('Oscuro')}</span>
            <span
              className="rounded px-1.5 py-0.5 font-semibold"
              style={{ background: `hsl(${preview[mode].primary})`, color: `hsl(${preview[mode].foreground})` }}
            >
              Aa
            </span>
          </div>
        ))}
      </div>

      <Button type="button" size="sm" className="w-full" onClick={() => onApply(hex)}>
        <Check className="mr-2 h-4 w-4" />
        {tr('Usar este color')}
      </Button>
    </div>
  );
}
