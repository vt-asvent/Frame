import { Library, Unplug } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLoreSource } from '@/lib/extensions/aklore/source';
import { tr } from '@/lib/i18n';

/** AK Lore en su tarjeta de Extensiones: abrirla y ver si hay material conectado. */
export function AkLorePanel() {
  const navigate = useNavigate();
  const source = useLoreSource();
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <Button size="sm" variant="outline" onClick={() => navigate('/aklore')}>
        <Library className="mr-2 h-4 w-4" />
        {tr('Abrir AK Lore')}
      </Button>
      <span className="flex items-center gap-1.5 text-muted-foreground">
        {source ? (
          tr('Material: {name}', { name: source.name })
        ) : (
          <>
            <Unplug className="h-3.5 w-3.5" />
            {tr('El material aún no está conectado. También está en la barra lateral.')}
          </>
        )}
      </span>
    </div>
  );
}
