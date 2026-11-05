import { useState, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import FrameLogo from '@/components/layout/FrameLogo';
import { APP_VERSION } from '@/lib/version';
import { cn } from '@/lib/utils';
import { tr } from '@/lib/i18n';

// ============================================================
// Marco común de las pantallas de acceso (entrar, registrarse y completar
// el perfil): la franja de marca del recuadro, sobre el fondo liso de la app
// (sin constelación desde la 1.6.8). La marca va como en el menú lateral: el
// logo y «FRAME» a su derecha. Sin efectos que sigan al cursor (1.6.7, Diego).
// ============================================================

interface AuthShellProps {
  /** Título bajo la marca (p. ej. «Completa tu perfil»); sin él, la marca es el título. */
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  /** Dentro de un recuadro emergente (vincular la cuenta de un invitado): el
   *  mismo recuadro de acceso, sin la pantalla de fondo. */
  inDialog?: boolean;
}

export default function AuthShell({ title, description, children, inDialog = false }: AuthShellProps) {
  const card = (
    <Card
      className={cn(
        'relative z-10 w-full max-w-md border-border/60 bg-card/95 shadow-2xl backdrop-blur-sm',
        inDialog && 'border-0 bg-transparent shadow-none backdrop-blur-none'
      )}
    >
      {/* En el recuadro emergente, la X de cerrar ocupa la esquina derecha. */}
      <div
        className={cn(
          'flex items-center justify-between px-5 pt-4 text-[10.5px] font-semibold text-muted-foreground/80',
          inDialog && 'pr-12'
        )}
      >
        <span>{tr('Asvent')}</span>
        <span>2026 · v{APP_VERSION}</span>
      </div>
      <CardHeader echo={false} className="items-center pb-4 pt-3 text-center">
        <div className="flex items-center justify-center gap-3">
          <FrameLogo className="h-16 w-16" />
          <span className="select-none text-3xl font-bold text-foreground">{tr('FRAME')}</span>
        </div>
        {title && <CardTitle className="pt-2 text-xl font-bold text-foreground">{title}</CardTitle>}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      {children}
    </Card>
  );

  if (inDialog) return card;

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-x-hidden overflow-y-auto bg-background px-4 py-8">
      {card}
    </div>
  );
}

/** Campo de contraseña con botón para verla: evita errores al teclearla a ciegas. */
export function PasswordInput({
  id,
  value,
  onChange,
  disabled,
  autoComplete,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoComplete: 'current-password' | 'new-password';
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        disabled={disabled}
        autoComplete={autoComplete}
        placeholder={placeholder}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        aria-label={visible ? tr('Ocultar contraseña') : tr('Mostrar contraseña')}
        tabIndex={-1}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Único dato que se pide al crear una cuenta: cómo te llamará Frame. */
export function validateUsername(username: string): string | null {
  const user = username.trim();
  if (user.length === 0 || user.length > 12) return tr('El nombre de usuario debe tener entre 1 y 12 caracteres.');
  return null;
}
