// Logotipo de Frame (4-nov-2026): una barra y una flecha que sube, con
// esquinas redondeadas. Fuente de verdad única dentro de la app; los archivos
// de la marca (SVG, PNG e .ico) están en `docs/marca/logo/`.
// - Plano (sin degradado) para 16-64 px: azul marino #0B2A5B y esmeralda
//   #6A9E8B; en oscuro, azul bebé #A7C7F2 y esmeralda claro #9CC2B4.
// - Degradado para tamaños grandes, diagonal de abajo a la izquierda hacia
//   arriba a la derecha (claro y oscuro, como en el LEEME de la marca).
// El logo ocupa el 86 % del ancho del cuadrado, centrado (viewBox 1000).
import { useId } from 'react';

interface FrameLogoProps {
  className?: string;
  /** `flat` (por defecto) hasta 64 px; `gradient` para tamaños grandes. */
  variant?: 'flat' | 'gradient';
}

const BAR_POINTS =
  '73.4,789.7 72.5,791.0 71.7,792.4 71.1,793.9 70.6,795.4 70.2,797.0 ' +
  '70.0,798.6 70.0,800.2 70.1,801.8 70.4,803.4 70.8,805.0 71.4,806.5 ' +
  '72.1,807.9 72.9,809.3 73.9,810.6 75.0,811.8 76.2,812.9 77.5,813.8 ' +
  '78.9,814.6 80.4,815.3 81.9,815.8 83.5,816.2 85.1,816.5 86.7,816.5 ' +
  '241.2,816.5 242.9,816.4 244.6,816.2 246.3,815.7 247.9,815.1 ' +
  '249.5,814.4 250.9,813.4 252.3,812.3 253.5,811.1 254.6,809.8 ' +
  '545.7,419.2 546.6,417.8 547.4,416.3 548.0,414.8 548.5,413.2 ' +
  '548.8,411.6 549.0,409.9 549.0,408.3 548.8,406.6 548.4,405.0 ' +
  '548.0,403.4 547.3,401.9 546.5,400.5 545.6,399.1 544.5,397.8 ' +
  '543.3,396.7 542.0,395.6 540.6,394.7 539.2,394.0 537.6,393.4 ' +
  '536.0,392.9 534.4,392.6 532.7,392.5 389.6,388.3 388.0,388.4 ' +
  '386.4,388.5 384.9,388.9 383.4,389.3 381.9,390.0 380.5,390.7 ' +
  '379.2,391.6 378.0,392.6 376.8,393.7 375.8,394.9 73.4,789.7 ';

const ARROW_POINTS =
  '448.8,626.6 447.9,628.0 447.1,629.5 446.5,631.0 446.0,632.6 ' +
  '445.7,634.3 445.6,636.0 445.6,637.6 445.8,639.3 446.2,640.9 ' +
  '446.7,642.5 447.4,644.0 448.2,645.5 449.2,646.9 450.3,648.1 ' +
  '451.5,649.3 452.8,650.3 454.3,651.2 455.8,651.9 457.3,652.5 ' +
  '459.0,652.9 460.6,653.1 462.3,653.2 606.9,653.2 608.5,653.1 ' +
  '610.0,652.9 611.6,652.6 613.0,652.1 614.5,651.4 615.8,650.6 ' +
  '617.1,649.7 618.3,648.7 619.4,647.6 620.4,646.4 862.3,317.2 ' +
  '862.9,316.5 863.3,316.0 863.8,315.7 864.2,315.4 864.7,315.1 ' +
  '865.3,314.8 865.8,314.7 866.3,314.5 866.9,314.5 867.9,314.4 ' +
  '913.3,314.4 914.9,314.3 916.5,314.1 918.1,313.7 919.6,313.2 ' +
  '921.1,312.5 922.5,311.7 923.8,310.7 925.0,309.6 926.1,308.4 ' +
  '927.1,307.2 927.9,305.8 928.6,304.3 929.2,302.8 929.6,301.2 ' +
  '929.9,299.6 930.0,298.0 930.0,296.4 929.8,294.8 929.4,293.2 ' +
  '928.9,291.7 928.2,290.2 879.4,192.7 878.6,191.3 877.6,189.9 ' +
  '876.5,188.7 875.3,187.5 874.0,186.5 872.7,185.6 871.2,184.9 ' +
  '869.7,184.3 868.1,183.9 866.4,183.6 864.8,183.5 863.2,183.5 ' +
  '861.5,183.7 859.9,184.1 858.4,184.6 856.9,185.3 663.6,283.3 ' +
  '662.2,284.1 660.8,285.1 659.6,286.1 658.5,287.3 657.5,288.6 ' +
  '656.6,289.9 655.9,291.4 655.3,292.9 654.9,294.4 654.6,296.0 ' +
  '654.4,297.6 654.4,299.3 654.6,300.9 655.0,302.4 655.4,304.0 ' +
  '656.1,305.5 656.8,306.9 657.7,308.2 658.8,309.5 659.9,310.6 ' +
  '661.2,311.7 662.5,312.6 663.9,313.3 665.4,313.9 667.0,314.4 ' +
  '668.1,314.7 668.6,314.9 669.2,315.2 669.7,315.5 670.2,315.9 ' +
  '670.6,316.3 671.0,316.7 671.4,317.2 671.7,317.7 671.9,318.3 ' +
  '672.1,318.9 672.2,319.5 672.3,320.1 672.3,320.7 672.3,321.3 ' +
  '672.2,321.9 672.0,322.5 671.8,323.0 671.5,323.6 670.9,324.4 ' +
  '448.8,626.6 ';

export default function FrameLogo({ className = 'h-8 w-8', variant = 'flat' }: FrameLogoProps) {
  const id = useId().replace(/:/g, '');
  if (variant === 'gradient') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" className={className} aria-hidden focusable="false">
        <defs>
          <linearGradient id={`${id}b`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" className="[stop-color:#0A2858] dark:[stop-color:#7FA6DC]" />
            <stop offset="1" className="[stop-color:#275C7E] dark:[stop-color:#B4D7E4]" />
          </linearGradient>
          <linearGradient id={`${id}a`} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" className="[stop-color:#3D7064] dark:[stop-color:#86B4A2]" />
            <stop offset="1" className="[stop-color:#93C2B0] dark:[stop-color:#C9E5DA]" />
          </linearGradient>
        </defs>
        <polygon points={BAR_POINTS} fill={`url(#${id}b)`} />
        <polygon points={ARROW_POINTS} fill={`url(#${id}a)`} />
      </svg>
    );
  }
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" className={className} aria-hidden focusable="false">
      <polygon points={BAR_POINTS} className="fill-[#0B2A5B] dark:fill-[#A7C7F2]" />
      <polygon points={ARROW_POINTS} className="fill-[#6A9E8B] dark:fill-[#9CC2B4]" />
    </svg>
  );
}
