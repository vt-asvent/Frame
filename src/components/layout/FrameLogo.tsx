// Logotipo de Frame (6-nov-2026): el símbolo de dos flechas en degradado
// turquesa y azul, sobre fondo transparente; se lee igual en claro y oscuro.
// Archivos de la marca: `docs/marca/logo/` (LEEME.txt). Aquí, un WebP de 256 px
// (el logo nunca pasa de 64 px en pantalla).
import logo from '@/assets/marca/Frame-logo.webp';

export default function FrameLogo({ className = 'h-8 w-8' }: { className?: string }) {
  return <img src={logo} alt="" aria-hidden draggable={false} className={`${className} select-none object-contain`} />;
}
