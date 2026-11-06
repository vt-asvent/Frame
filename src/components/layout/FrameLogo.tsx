// Logotipo de Frame (6-nov-2026): el símbolo de dos flechas en degradado
// turquesa y azul, sobre fondo transparente. Se lee igual en claro y oscuro,
// así que no hay variante por tema. Archivos de la marca: `docs/marca/logo/`
// (LEEME.txt). Aquí se usan los PNG con 4 % de margen de `src/assets/marca/`,
// importados para que también funcionen en el panel de Métricas.
// El logo del 4-nov-2026 (barra y flecha) queda en `docs/marca/logo/anterior-2026-11-04/`.

import logo256 from '@/assets/marca/Frame-logo-256.png';
import logo512 from '@/assets/marca/Frame-logo-512.png';

interface FrameLogoProps {
  className?: string;
  /** Se conserva por compatibilidad: `gradient` pide la imagen de 512 px. */
  variant?: 'flat' | 'gradient';
}

export default function FrameLogo({ className = 'h-8 w-8', variant = 'flat' }: FrameLogoProps) {
  const src = variant === 'gradient' ? logo512 : logo256;
  return <img src={src} alt="" aria-hidden draggable={false} className={`${className} select-none object-contain`} />;
}
