import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { isTauri } from '@tauri-apps/api/core';
import GoogleGlyph from '@/components/auth/GoogleGlyph';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { RECONNECT_EVENT } from '@/lib/connection-status';
import { googleSignIn, isGoogleConfigured } from '@/lib/google/auth';
import { describeAuthError, signInMethodsOf, signInWithEmail, signInWithGoogleIdToken, signOut } from '@/lib/supabase/auth';
import { sessionRestored } from '@/lib/supabase/session-guard';
import { SYNC_NOW_EVENT } from '@/lib/sync-status';
import { tr } from '@/lib/i18n';
import type { UserProfile } from '@/types';

// ============================================================
// «Vuelve a conectar tu cuenta» (1.9.5).
//
// Cuando la nube cierra la sesión de este equipo (cambio de contraseña, cierre
// desde otro sitio…), antes había que pulsar la campana, salir a la pantalla
// de acceso, entrar de nuevo y esperar a que la app se montara otra vez. Ahora
// es un paso y no se sale de donde se está: el mismo botón de Google (o la
// contraseña) y la cuenta queda conectada; lo abierto ni se entera.
//
// Lo abren la campana («Sin conexión con tu cuenta») y Ajustes → Dispositivos.
// Solo deja entrar con LA MISMA cuenta: otra de Google abriría otra cuenta de
// Frame en medio de esta.
// ============================================================

export default function ReconnectDialog({ userProfile }: { userProfile: UserProfile }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<'google' | 'password' | null>(null);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const email = (userProfile.email ?? '').trim();

  useEffect(() => {
    const show = () => {
      setError(null);
      setPassword('');
      setBusy(null);
      setOpen(true);
    };
    window.addEventListener(RECONNECT_EVENT, show);
    return () => window.removeEventListener(RECONNECT_EVENT, show);
  }, []);

  // Lo que se anotó mientras la sesión vivía (auth.ts); sin nada anotado se ofrecen las dos.
  const methods = signInMethodsOf(userProfile.id);
  const canGoogle = isTauri() && isGoogleConfigured && (methods ? methods.google : true);
  const canPassword = !!email && (methods ? methods.password : true);

  /** La misma cuenta, conectada otra vez: nada se recarga, solo se pone al día. */
  const finish = (uid: string | undefined) => {
    setPassword('');
    setOpen(false);
    // Otra cuenta (no debería: se comprueba antes): la abre el controlador de la app, como siempre.
    if (uid !== userProfile.id) return;
    sessionRestored();
    window.dispatchEvent(new Event(SYNC_NOW_EVENT));
    toast({ title: tr('Cuenta conectada de nuevo') });
  };

  const withGoogle = async () => {
    setBusy('google');
    setError(null);
    try {
      const identity = await googleSignIn(email ? { loginHint: email } : {});
      if (email && identity.email.trim().toLowerCase() !== email.toLowerCase()) {
        setError(tr('Esa es otra cuenta de Google. Entra con {email}.', { email }));
        return;
      }
      if (!identity.idToken) throw new Error('id token');
      const { user, error: failed } = await signInWithGoogleIdToken(identity.idToken);
      if (failed) throw new Error(failed);
      finish(user?.id);
    } catch (reason) {
      const message = String((reason as { message?: unknown } | null)?.message ?? reason);
      // Cerrar la ventana de Google es una decisión, no un error.
      if (!/cancelado|cancell?ed/i.test(message)) setError(describeAuthError(message));
    } finally {
      setBusy(null);
    }
  };

  const withPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy('password');
    setError(null);
    const { user, error: failed } = await signInWithEmail(email, password);
    setBusy(null);
    if (failed) {
      setError(describeAuthError(failed));
      return;
    }
    finish(user?.id);
  };

  /** Sin ninguna vía aquí (no debería pasar): la pantalla de acceso, con los datos en el equipo. */
  const toAccessScreen = async () => {
    setOpen(false);
    await signOut().catch(() => undefined);
    localStorage.removeItem('userProfile');
    window.dispatchEvent(new Event('profileUpdated'));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tr('Vuelve a conectar tu cuenta')}</DialogTitle>
          <DialogDescription>
            {email ? tr('La sesión de {email} se cerró. Tus datos siguen en este equipo.', { email }) : tr('La sesión de tu cuenta se cerró. Tus datos siguen en este equipo.')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {canGoogle && (
            <Button variant="outline" className="w-full gap-2 bg-background" onClick={() => void withGoogle()} disabled={!!busy}>
              {busy === 'google' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GoogleGlyph className="h-[18px] w-[18px]" />}
              {tr('Continuar con Google')}
            </Button>
          )}
          {canPassword && (
            <form onSubmit={withPassword} className="flex gap-2">
              <Input
                type="password"
                autoComplete="current-password"
                placeholder={tr('Contraseña')}
                aria-label={tr('Contraseña')}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={!!busy}
              />
              <Button type="submit" className="shrink-0" disabled={!!busy || !password}>
                {busy === 'password' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : tr('Conectar')}
              </Button>
            </form>
          )}
          {!canGoogle && !canPassword && (
            <Button variant="outline" className="w-full" onClick={() => void toAccessScreen()}>
              {tr('Iniciar sesión')}
            </Button>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
