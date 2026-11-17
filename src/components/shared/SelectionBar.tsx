import type { ReactNode } from 'react';
import { CheckCheck, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// La barra de la selección múltiple (2.0.2): flota arriba de la lista
// mientras haya tarjetas marcadas, sin mover nada de lo que hay debajo.
// Cuántas van, «Todo», lo que se hace con ellas y cerrar (o Esc).
// ============================================================

/** La marca de una tarjeta elegida: borde del color de Frame. */
export const SELECTED_CARD = 'ring-2 ring-primary ring-offset-2 ring-offset-background';

export default function SelectionBar({
  count,
  total,
  label,
  onSelectAll,
  onClear,
  children,
}: {
  count: number;
  total: number;
  /** «3 canciones», «1 archivo»… */
  label: string;
  onSelectAll: () => void;
  onClear: () => void;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky top-2 z-30 h-0">
      <div
        role="toolbar"
        aria-label={tr('Selección')}
        className="mx-auto flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-xl border border-primary/50 bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-top-2"
      >
        <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onClear} title={tr('Soltar la selección (Esc)')} aria-label={tr('Soltar la selección')}>
          <X className="h-4 w-4" />
        </Button>
        <span className="px-1 text-sm font-semibold tabular-nums text-foreground" aria-live="polite">
          {label}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className={cn('h-8 px-2 text-xs', count >= total && 'hidden')}
          onClick={onSelectAll}
          title={tr('Marcar todo lo que se ve')}
        >
          <CheckCheck className="mr-1 h-4 w-4" />
          {tr('Todo')}
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        {children}
      </div>
    </div>
  );
}
