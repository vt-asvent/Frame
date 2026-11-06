import { Bot, Library, Music, Palette, Puzzle, Sparkles } from 'lucide-react';
import wireLogo from '@/assets/extensiones/wire.png';
import claudeLogo from '@/assets/extensiones/claude.png';
import { cn } from '@/lib/utils';
import type { ExtensionManifest } from '@/lib/extensions/manifest';

/** Logotipo de Notion (silueta oficial, Simple Icons, CC0). */
export function NotionLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" />
    </svg>
  );
}

const TILE = 'flex shrink-0 items-center justify-center rounded-lg h-9 w-9';

/**
 * Icono de cada extensión, en su baldosa. Notion, Wire y las Conexiones con IA
 * (Claude) llevan su marca; las demás de Asvent, el acento de Frame; las de terceros, un
 * icono según lo que aportan, en gris: se distinguen de un vistazo.
 */
export function ExtensionIcon({ id, manifest, className }: { id?: string; manifest?: ExtensionManifest | null; className?: string }) {
  if (id === 'frame.notion' || !id) {
    return (
      <span className={cn(TILE, 'bg-white text-black ring-1 ring-black/10', className)}>
        <NotionLogo className="h-5 w-5" />
      </span>
    );
  }
  // Wire lleva su logo oficial y las Conexiones con IA el de Claude (1.7.6).
  const logos: Record<string, string> = { 'frame.wire': wireLogo, 'frame.ia': claudeLogo };
  if (logos[id]) {
    return (
      <span className={cn(TILE, 'overflow-hidden', className)}>
        <img src={logos[id]} alt="" aria-hidden draggable={false} className="h-full w-full object-contain" />
      </span>
    );
  }
  const official: Record<string, typeof Bot> = {
    'frame.animaciones': Sparkles,
    'frame.aklore': Library,
  };
  const Icon = official[id];
  if (Icon) {
    return (
      <span className={cn(TILE, 'bg-primary/10 text-primary ring-1 ring-primary/20', className)}>
        <Icon className="h-5 w-5" />
      </span>
    );
  }
  const ThirdParty = manifest?.contributes?.musicSource ? Music : manifest?.contributes?.appearance ? Palette : Puzzle;
  return (
    <span className={cn(TILE, 'bg-muted text-muted-foreground ring-1 ring-border', className)}>
      <ThirdParty className="h-5 w-5" />
    </span>
  );
}
