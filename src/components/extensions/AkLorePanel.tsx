import { useState } from 'react';
import { KeyRound, Library } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import LibraryActivateDialog from '@/components/extensions/LibraryActivateDialog';
import { useCourse } from '@/context/CourseContext';
import { useAkLoreAccess } from '@/lib/extensions/aklore/access';
import { tr } from '@/lib/i18n';

/** La Biblioteca en su página de Extensiones: abrirla o, si esta cuenta aún no la activó, activarla. */
export function AkLorePanel() {
  const navigate = useNavigate();
  const { userProfile } = useCourse();
  const access = useAkLoreAccess(userProfile?.id);
  const [activating, setActivating] = useState(false);

  if (access === 'locked') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Button size="sm" onClick={() => setActivating(true)}>
          <KeyRound className="mr-2 h-4 w-4" />
          {tr('Activar con mi correo institucional')}
        </Button>
        <span className="text-muted-foreground">{tr('Esta cuenta aún no la tiene activada.')}</span>
        <LibraryActivateDialog uid={userProfile?.id} open={activating} onClose={() => setActivating(false)} />
      </div>
    );
  }
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
