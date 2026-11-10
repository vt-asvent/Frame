import { Library } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { tr } from '@/lib/i18n';

/** AK Lore en su tarjeta de Extensiones: abrir la Biblioteca. */
export function AkLorePanel() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={() => navigate('/biblioteca')}>
        <Library className="mr-2 h-4 w-4" />
        {tr('Abrir la Biblioteca')}
      </Button>
      <span className="text-muted-foreground">{tr('También está en la barra lateral, debajo de Calendario.')}</span>
    </div>
  );
}
