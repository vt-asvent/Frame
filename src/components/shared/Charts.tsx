import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

// Gráficos de Frame en SVG propio (1.9.0). Sustituyen a recharts, que añadía
// 386 KB a la app para cinco gráficos: barras apiladas, área y línea con dos
// ejes (ComboChart), rosco (Donut) y anillo de progreso (Ring), con leyenda y
// un globo con los valores al pasar el ratón.

export interface ChartSeries {
  key: string;
  name: string;
  color: string;
  type: 'bar' | 'area' | 'line';
  /** Eje de la serie: el izquierdo (por defecto) o el derecho. */
  axis?: 'left' | 'right';
}

type Row = Record<string, string | number>;

const TICK = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' } as const;
const BOX = 'pointer-events-none absolute z-10 whitespace-nowrap rounded-md border bg-background px-2.5 py-1.5 text-xs shadow-md';

/** Ancho del contenedor, al día con cada cambio de tamaño. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Marcas «redondas» de 0 a un poco más que `max`: múltiplos de 1, 2, 2,5 o 5
 *  (o de los `steps` dados, p. ej. minutos), unas cuatro. */
function niceTicks(max: number, { steps, integer }: { steps?: number[]; integer?: boolean } = {}): number[] {
  const raw = Math.max(max, integer ? 1 : 0.0001) / 4;
  let step = steps?.find((s) => s >= raw);
  if (!step) {
    const power = 10 ** Math.floor(Math.log10(raw));
    step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  }
  if (integer) step = Math.max(1, Math.round(step));
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step! * 1000) / 1000);
}

/** Curva monótona (Fritsch–Carlson) por los puntos: suave y sin pasarse de los valores. */
function curve(points: [number, number][]): string {
  const n = points.length;
  if (n < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const slope = points.slice(1).map(([x, y], i) => (y - points[i][1]) / (x - points[i][0]));
  const t = points.map((_, i) =>
    i === 0 ? slope[0] : i === n - 1 ? slope[n - 2] : slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2
  );
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    if (a * a + b * b > 9) {
      const k = 3 / Math.hypot(a, b);
      t[i] = k * a * slope[i];
      t[i + 1] = k * b * slope[i];
    }
  }
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += `C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

/** Rectángulo con las esquinas de arriba redondeadas. */
function topRounded(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.min(radius, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function Legend({ series }: { series: Pick<ChartSeries, 'name' | 'color' | 'type'>[] }) {
  return (
    <ul className="mt-1 flex flex-wrap justify-center gap-x-3 gap-y-1 text-[11px]">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5" style={{ color: s.color }}>
          <span
            className={s.type === 'line' ? 'h-0.5 w-3 rounded-full' : 'h-2.5 w-2.5 rounded-sm'}
            style={{ backgroundColor: s.color }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: color }} />;
}

interface ComboChartProps {
  /** Una fila por categoría del eje X: `name` y un número por serie. */
  data: Row[];
  series: ChartSeries[];
  height: number;
  /** Texto de las marcas del eje izquierdo y, si hace falta, sus pasos. */
  leftTick?: (value: number) => string;
  leftSteps?: number[];
  /** Eje derecho: rango fijo o solo enteros. */
  rightDomain?: [number, number];
  rightInteger?: boolean;
  maxBarSize?: number;
  /** Cómo se lee cada valor en el globo. */
  format: (value: number, series: ChartSeries) => string;
}

/** Barras apiladas, áreas y líneas sobre las mismas categorías, con dos ejes. */
export function ComboChart({ data, series, height, leftTick = String, leftSteps, rightDomain, rightInteger, maxBarSize = 36, format }: ComboChartProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const value = (row: Row, key: string) => Number(row[key]) || 0;
  const bars = series.filter((s) => s.type === 'bar');
  const leftSeries = series.filter((s) => s.axis !== 'right');
  const rightSeries = series.filter((s) => s.axis === 'right');

  const leftMax = Math.max(
    0,
    ...data.map((row) => bars.reduce((sum, s) => sum + value(row, s.key), 0)),
    ...data.flatMap((row) => leftSeries.filter((s) => s.type !== 'bar').map((s) => value(row, s.key)))
  );
  const leftTicks = niceTicks(leftMax, { steps: leftSteps });
  const rightTicks = rightDomain
    ? [0, 1, 2, 3, 4].map((i) => rightDomain[0] + ((rightDomain[1] - rightDomain[0]) * i) / 4)
    : niceTicks(Math.max(0, ...data.flatMap((row) => rightSeries.map((s) => value(row, s.key)))), { integer: rightInteger });

  const margin = { top: 8, right: rightSeries.length ? 34 : 10, bottom: 22, left: 42 };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const band = data.length ? plotW / data.length : 0;
  const cx = (i: number) => margin.left + band * (i + 0.5);
  const scale = (ticks: number[]) => {
    const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
    return (v: number) => margin.top + plotH * (1 - (v - lo) / (hi - lo || 1));
  };
  const yLeft = scale(leftTicks);
  const yRight = scale(rightTicks);
  const yOf = (s: ChartSeries) => (s.axis === 'right' ? yRight : yLeft);
  const barW = Math.min(maxBarSize, band * 0.8);
  const bottom = margin.top + plotH;

  const pick = (clientX: number, rect: DOMRect) => {
    const i = Math.floor((clientX - rect.left - margin.left) / (band || 1));
    setHover(i >= 0 && i < data.length ? i : null);
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height: height + 24 }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          onMouseMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHover(null)}
        >
          {/* Rejilla punteada y eje X */}
          <g stroke="hsl(var(--foreground))" strokeOpacity={0.2} strokeDasharray="3 3">
            {leftTicks.map((t) => (
              <line key={t} x1={margin.left} x2={margin.left + plotW} y1={yLeft(t)} y2={yLeft(t)} />
            ))}
            {data.map((_, i) => (
              <line key={i} x1={cx(i)} x2={cx(i)} y1={margin.top} y2={bottom} />
            ))}
          </g>
          <line x1={margin.left} x2={margin.left + plotW} y1={bottom} y2={bottom} stroke="hsl(var(--foreground))" strokeOpacity={0.5} />

          {/* Marcas de los ejes */}
          {leftTicks.map((t) => (
            <text key={t} x={margin.left - 6} y={yLeft(t)} dy="0.32em" textAnchor="end" {...TICK}>
              {leftTick(t)}
            </text>
          ))}
          {rightSeries.length > 0 &&
            rightTicks.map((t) => (
              <text key={t} x={margin.left + plotW + 6} y={yRight(t)} dy="0.32em" {...TICK} fill="hsl(var(--primary))">
                {Math.round(t * 10) / 10}
              </text>
            ))}
          {data.map((row, i) => (
            <text key={i} x={cx(i)} y={bottom + 15} textAnchor="middle" {...TICK}>
              {String(row.name)}
            </text>
          ))}

          {/* Resalte de la categoría bajo el ratón */}
          {hover !== null &&
            (bars.length ? (
              <rect x={margin.left + band * hover} y={margin.top} width={band} height={plotH} rx={4} fill="hsl(var(--accent))" />
            ) : (
              <line x1={cx(hover)} x2={cx(hover)} y1={margin.top} y2={bottom} stroke="hsl(var(--border))" />
            ))}

          {/* Barras apiladas: la de arriba de cada columna, redondeada */}
          {data.map((row, i) => {
            let acc = 0;
            const top = bars.reduce((last, s, j) => (value(row, s.key) > 0 ? j : last), -1);
            return bars.map((s, j) => {
              const v = value(row, s.key);
              if (v <= 0) return null;
              const y0 = yLeft(acc);
              acc += v;
              const y1 = yLeft(acc);
              const x = cx(i) - barW / 2;
              return j === top ? (
                <path key={s.key} d={topRounded(x, y1, barW, y0 - y1, 4)} fill={s.color} />
              ) : (
                <rect key={s.key} x={x} y={y1} width={barW} height={y0 - y1} fill={s.color} />
              );
            });
          })}

          {/* Áreas y líneas */}
          {series
            .filter((s) => s.type !== 'bar')
            .map((s) => {
              const y = yOf(s);
              const points = data.map((row, i) => [cx(i), y(value(row, s.key))] as [number, number]);
              const path = curve(points);
              return (
                <g key={s.key}>
                  {s.type === 'area' && points.length > 0 && (
                    <path d={`${path}L${points[points.length - 1][0]},${bottom}L${points[0][0]},${bottom}Z`} fill={s.color} fillOpacity={0.18} />
                  )}
                  <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
                  {s.type === 'line' &&
                    points.map(([x, py], i) => (
                      <circle key={i} cx={x} cy={py} r={hover === i ? 4 : 3} fill="hsl(var(--background))" stroke={s.color} strokeWidth={2} />
                    ))}
                </g>
              );
            })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div
          className={BOX}
          style={{ top: margin.top, ...(cx(hover) > width / 2 ? { right: width - cx(hover) + 14 } : { left: cx(hover) + 14 }) }}
        >
          <p className="mb-0.5 font-medium">{String(data[hover].name)}</p>
          {/* Las barras en cero no se listan: en una semana con seis asignaturas, sobran. */}
          {series.filter((s) => s.type !== 'bar' || value(data[hover], s.key) > 0).map((s) => (
            <p key={s.key} style={{ color: s.color }}>
              <Swatch color={s.color} />
              {s.name}: {format(value(data[hover], s.key), s)}
            </p>
          ))}
        </div>
      )}
      <Legend series={series} />
    </div>
  );
}

export interface DonutSlice {
  name: string;
  value: number;
  color: string;
}

interface DonutProps {
  data: DonutSlice[];
  height: number;
  /** Radios interior y exterior, como fracción del radio disponible. */
  inner: number;
  outer: number;
  /** Con él, globo al pasar el ratón y leyenda debajo. */
  format?: (value: number) => string;
  /** Lo que va en el centro del rosco. */
  children?: ReactNode;
}

/** Rosco: un sector por valor, en el sentido del reloj desde las 12. */
export function Donut({ data, height, inner, outer, format, children }: DonutProps) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0);
  const size = Math.min(width, height);
  const c = { x: width / 2, y: height / 2 };
  const [ri, ro] = [(size / 2) * inner, (size / 2) * outer];
  const visible = data.filter((d) => d.value > 0).length;
  const pad = visible > 1 ? (2 * Math.PI) / 180 : 0;
  const at = (r: number, a: number) => `${c.x + r * Math.sin(a)},${c.y - r * Math.cos(a)}`;

  let start = 0;
  const slices = data.map((d) => {
    const sweep = total > 0 ? (Math.max(0, d.value) / total) * 2 * Math.PI : 0;
    const [a0, a1] = [start + pad / 2, start + sweep - pad / 2];
    start += sweep;
    if (sweep <= 0 || a1 <= a0) return null;
    if (sweep >= 2 * Math.PI - 1e-6) {
      // Un solo sector: dos medias vueltas, porque un arco SVG no cierra el círculo.
      return `M${at(ro, 0)}A${ro},${ro} 0 1 1 ${at(ro, Math.PI)}A${ro},${ro} 0 1 1 ${at(ro, 0)}M${at(ri, 0)}A${ri},${ri} 0 1 0 ${at(ri, Math.PI)}A${ri},${ri} 0 1 0 ${at(ri, 0)}Z`;
    }
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${at(ro, a0)}A${ro},${ro} 0 ${large} 1 ${at(ro, a1)}L${at(ri, a1)}A${ri},${ri} 0 ${large} 0 ${at(ri, a0)}Z`;
  });

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} className="block" onMouseLeave={() => setHover(null)}>
            {slices.map(
              (d, i) =>
                d && (
                  <path
                    key={data[i].name}
                    d={d}
                    fill={data[i].color}
                    fillRule="evenodd"
                    opacity={hover && hover.i !== i ? 0.7 : 1}
                    onMouseMove={format ? (e) => setHover({ i, x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY }) : undefined}
                  />
                )
            )}
          </svg>
        )}
        {children && <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">{children}</div>}
        {format && hover && data[hover.i] && (
          <div className={BOX} style={{ top: hover.y + 12, ...(hover.x > width / 2 ? { right: width - hover.x + 12 } : { left: hover.x + 12 }) }}>
            <Swatch color={data[hover.i].color} />
            {data[hover.i].name}: {format(data[hover.i].value)}
          </div>
        )}
      </div>
      {format && <Legend series={data.map((d) => ({ name: d.name, color: d.color, type: 'bar' }))} />}
    </div>
  );
}

/** Anillo de progreso de 0 a 100, desde las 12 y en el sentido del reloj. */
export function Ring({ value, height, inner = 0.74 }: { value: number; height: number; inner?: number }) {
  const ro = height / 2;
  const width = ro - ro * inner;
  const r = ro - width / 2;
  const length = 2 * Math.PI * r;
  const part = Math.min(100, Math.max(0, value)) / 100;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${height} ${height}`} className="block">
      <circle cx={ro} cy={ro} r={r} fill="none" stroke="hsl(var(--muted))" strokeWidth={width} />
      {part > 0 && (
        <circle
          cx={ro}
          cy={ro}
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${length * part} ${length}`}
          transform={`rotate(-90 ${ro} ${ro})`}
        />
      )}
    </svg>
  );
}
