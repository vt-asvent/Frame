import { useEffect, useState } from 'react';
import { CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LoaderCircle, UserRound } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { clearGuestLinkPending, guestLinkedTo, markGuestLinkPending } from '@/lib/guest-link';
import { GUEST_NAME } from '@/lib/enum-labels';
import { flushEvents, trackEvent } from '@/lib/telemetry';
import type { UserProfile } from '@/types';
import { useToast } from '@/hooks/use-toast';
import { isSupabaseConfigured } from '@/lib/supabase/client';
import {
  SESSION_OPEN_FAILED_EVENT,
  describeAuthError,
  requestPasswordReset,
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
  signInWithGoogleIdToken,
} from '@/lib/supabase/auth';
import { googleSignIn, isGoogleConfigured } from '@/lib/google/auth';
import { isTauri } from '@tauri-apps/api/core';
import AuthShell, { PasswordInput, validateUsername } from '@/components/auth/AuthShell';
import GoogleGlyph from '@/components/auth/GoogleGlyph';
import { EchoHeader } from '@/components/shared/EchoWord';
import { tr } from '@/lib/i18n';

interface AuthFormProps {
  onAuthSuccess?: () => void;
  /**
   * Vincular la cuenta de un invitado: el MISMO recuadro de acceso, dentro de
   * un recuadro emergente. Con Google o con correo, antes de abrir la sesión
   * se deja la marca de guest-link.ts y el controlador de la app suma los
   * datos del invitado a la cuenta (sin borrar ni duplicar nada).
   */
  linkGuest?: UserProfile;
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Nombres que sugiere Google: «Completa tu perfil» los propone ya escritos. */
export const SUGGESTED_NAMES_KEY = 'frameSuggestedNames';

const MIN_PASSWORD = 8;

// Al registrarse con Google, el avatar de la app arranca siendo la foto de la
// cuenta de Google (en alta resolución). Solo si el usuario aún no puso una:
// después puede cambiarla o quitarla en Ajustes con total libertad.
async function applyGoogleAvatar(uid: string, pictureUrl?: string) {
  if (!pictureUrl || !uid) return;
  try {
    const { getImage, saveImage } = await import('@/lib/music-db');
    if (await getImage(`profileAvatar_${uid}`)) return;

    const hiRes = pictureUrl.replace(/=s\d+(-c)?/, '=s256$1');
    const resp = await fetch(hiRes);
    if (!resp.ok) return;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    await saveImage(`profileAvatar_${uid}`, dataUrl);
    // El sidebar y Ajustes escuchan 'storage' para recargar el avatar.
    window.dispatchEvent(new StorageEvent('storage', { key: `profileAvatar_${uid}` }));
  } catch {
    /* la foto es un extra: nunca debe frenar el inicio de sesión */
  }
}

/**
 * Perfil de invitado que este equipo recuerda (se guarda al cerrar su sesión)
 * y que aún no se vinculó a ninguna cuenta: se ofrece retomarlo.
 */
function rememberedGuest(): UserProfile | null {
  try {
    const raw = localStorage.getItem('lastLocalProfile');
    if (!raw) return null;
    const profile = JSON.parse(raw) as Partial<UserProfile>;
    if (!profile?.id || !/^\d{12}$/.test(profile.id) || guestLinkedTo(profile.id)) return null;
    return {
      ...profile,
      id: profile.id,
      username: profile.username || GUEST_NAME,
      isGuest: true,
      createdAt: profile.createdAt || new Date().toISOString(),
    } as UserProfile;
  } catch {
    return null;
  }
}

export default function AuthForm({ linkGuest }: AuthFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordAgain, setPasswordAgain] = useState('');
  const [username, setUsername] = useState(() =>
    linkGuest?.username && linkGuest.username !== GUEST_NAME ? linkGuest.username.slice(0, 12) : ''
  );
  const { toast } = useToast();

  // Tras entrar, este recuadro sigue girando hasta que la app abre la sesión
  // (AppController). Si no pudo abrirla, deja de girar y lo dice: antes se
  // quedaba así para siempre.
  useEffect(() => {
    const onFailed = () => {
      setIsLoading(false);
      toast({ variant: 'destructive', title: tr('No se pudo iniciar sesión'), description: describeAuthError(null) });
    };
    window.addEventListener(SESSION_OPEN_FAILED_EVENT, onFailed);
    return () => window.removeEventListener(SESSION_OPEN_FAILED_EVENT, onFailed);
  }, [toast]);

  // El invitado se convierte en cuenta desde dentro («Vincular con Google»,
  // guest-link.ts): sus datos pasan solos, sin archivos de por medio.

  /** Invitado que se vincula: lo suyo de uso sale y queda la marca de traslado. */
  const prepareGuestLink = async (google: { picture?: string; firstNames?: string; lastNames?: string } = {}) => {
    if (!linkGuest) return;
    await Promise.race([flushEvents().catch(() => 0), pause(3000)]);
    markGuestLinkPending(linkGuest, google);
  };
  const abortGuestLink = () => {
    if (linkGuest) clearGuestLinkPending();
  };

  // El cambio de vista (login -> app) lo dispara onAuthChange en el AppController.
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Validación propia (1.6.7): las burbujas del navegador hablarían en el
    // idioma de Windows, no en el de Frame.
    const missing =
      (mode === 'register' ? validateUsername(username) : null) ??
      (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
        ? tr('Escribe un correo válido, como nombre@correo.com.')
        : !password
          ? tr('Escribe tu contraseña de Frame.')
          : null);
    if (missing) {
      toast({ variant: 'destructive', title: tr('Revisa tus datos'), description: missing });
      setIsLoading(false);
      return;
    }

    if (mode === 'register') {
      const problem =
        (password.length < MIN_PASSWORD
          ? tr('La contraseña debe tener al menos {MIN_PASSWORD} caracteres.', { MIN_PASSWORD })
          : password !== passwordAgain
            ? tr('Las dos contraseñas no coinciden.')
            : null);
      if (problem) {
        toast({ variant: "destructive", title: tr('Revisa tus datos'), description: problem });
        setIsLoading(false);
        return;
      }
      // Solo el nombre de usuario: nombres y apellidos, si hacen falta, se ponen en Ajustes.
      await prepareGuestLink();
      const { session, error } = await signUpWithEmail(email, password, username);
      // Sin sesión todavía (falta confirmar el correo): la marca se deja otra
      // vez cuando entre con su correo y contraseña desde este mismo recuadro.
      if (error || !session) abortGuestLink();
      if (error) {
        toast({ variant: "destructive", title: tr('No se pudo crear la cuenta'), description: describeAuthError(error) });
        setIsLoading(false);
        return;
      }
      if (!session) {
        toast({
          title: tr('Confirma tu correo'),
          description: tr('Te enviamos un enlace para activar tu cuenta. Ábrelo y vuelve aquí a iniciar sesión (mira también en spam).'),
          duration: 12000,
        });
        setMode('login');
        setIsLoading(false);
      }
      return;
    }

    await prepareGuestLink();
    const { error } = await signInWithEmail(email, password);
    if (error) {
      abortGuestLink();
      toast({ variant: "destructive", title: tr('No se pudo iniciar sesión'), description: describeAuthError(error) });
      setIsLoading(false);
    }
  };

  // «¿Olvidaste tu contraseña?»: usa el correo ya escrito arriba. El enlace
  // lleva a la página de la web donde se elige la nueva (1.6.6).
  const handleForgotPassword = async () => {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      toast({ title: tr('Escribe tu correo'), description: tr('Pon arriba el correo de tu cuenta y vuelve a pulsar «¿Olvidaste tu contraseña?».') });
      return;
    }
    setIsLoading(true);
    const { error } = await requestPasswordReset(address);
    setIsLoading(false);
    if (error) {
      toast({ variant: 'destructive', title: tr('No se pudo enviar el correo'), description: describeAuthError(error) });
      return;
    }
    toast({
      title: tr('Revisa tu correo'),
      description: tr('Si {address} tiene una cuenta, te llegará un enlace para elegir una contraseña nueva (mira también en spam). Caduca en una hora.', { address }),
      duration: 12000,
    });
  };

  const handleGoogle = async () => {
    setIsLoading(true);

    // App de escritorio: flujo OAuth nativo (PKCE) en una ventana de Frame.
    if (isTauri() && isGoogleConfigured) {
      try {
        const identity = await googleSignIn();
        try {
          sessionStorage.setItem(
            SUGGESTED_NAMES_KEY,
            JSON.stringify({ firstNames: identity.givenName ?? '', lastNames: identity.familyName ?? '' })
          );
        } catch {
          /* es solo una ayuda para no teclear */
        }

        // Si hay Supabase, la identidad de Google también inicia la sesión
        // en la nube (el AppController hidrata el perfil desde esa sesión).
        if (isSupabaseConfigured && identity.idToken) {
          await prepareGuestLink({ picture: identity.picture, firstNames: identity.givenName, lastNames: identity.familyName });
          const { user, error } = await signInWithGoogleIdToken(identity.idToken);
          if (error) {
            abortGuestLink();
            throw new Error(error);
          }
          if (user) void applyGoogleAvatar(user.id, identity.picture);
          return; // onAuthChange se encarga del resto
        }

        // Sin Supabase: perfil local-first con la identidad de Google.
        const username = (identity.givenName || identity.name || tr('Usuario')).slice(0, 12).trim();
        const timestampPart = String(Date.now()).slice(-8);
        const randomPart = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        const profile: UserProfile = {
          id: timestampPart + randomPart,
          username,
          isGuest: false,
          email: identity.email,
          createdAt: new Date().toISOString(),
          ...(identity.givenName ? { firstNames: identity.givenName } : {}),
          ...(identity.familyName ? { lastNames: identity.familyName } : {}),
        };
        localStorage.setItem('userProfile', JSON.stringify(profile));
        await applyGoogleAvatar(profile.id, identity.picture);
        window.dispatchEvent(new Event('profileUpdated'));
        return;
      } catch (e: any) {
        const message = String(e?.message ?? e);
        // Cerrar la ventana de Google es una decisión, no un error.
        // (En los dos idiomas: «Inicio de sesión cancelado» / «Sign-in canceled».)
        if (!/cancelado|cancell?ed/i.test(message)) {
          toast({ variant: 'destructive', title: tr('No se pudo entrar con Google'), description: describeAuthError(message) });
        }
        setIsLoading(false);
        return;
      }
    }

    // Navegador (desarrollo): redirect OAuth clásico de Supabase.
    await prepareGuestLink();
    const { error } = await signInWithGoogle();
    if (error) {
      abortGuestLink();
      toast({ variant: "destructive", title: tr('No se pudo entrar con Google'), description: describeAuthError(error) });
      setIsLoading(false);
    }
  };

  const googleButton = (
    <Button variant="outline" className="w-full gap-2 bg-background" onClick={handleGoogle} disabled={isLoading}>
      {isLoading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <GoogleGlyph className="h-[18px] w-[18px]" />}
      {tr('Continuar con Google')}
    </Button>
  );

  // --- Entrar como invitado: sin cuenta, sin formularios, al instante. ---
  // El perfil nace con nombre («Invitado», editable en Ajustes) para entrar
  // directamente en la app. Después se vincula Google desde dentro sin perder
  // nada (la «G» del pie del menú o Ajustes → Cuenta: GuestLinkDialog).
  const [resumeCandidate, setResumeCandidate] = useState<UserProfile | null>(null);

  const enterAsGuest = (resume: UserProfile | null) => {
    try {
      const profile: UserProfile = resume ?? {
        id: String(Date.now()).slice(-8) + String(Math.floor(Math.random() * 10000)).padStart(4, '0'),
        username: GUEST_NAME,
        isGuest: true,
        createdAt: new Date().toISOString(),
      };
      localStorage.setItem('userProfile', JSON.stringify(profile));
      if (resume) localStorage.removeItem('lastLocalProfile');
      trackEvent('guest_started', { resumed: Boolean(resume) });
      setResumeCandidate(null);
      window.dispatchEvent(new Event('profileUpdated'));
    } catch {
      toast({ variant: 'destructive', title: tr('No se pudo entrar como invitado'), description: tr('Inténtalo de nuevo.') });
    }
  };

  const handleGuest = () => {
    const remembered = rememberedGuest();
    if (remembered) setResumeCandidate(remembered);
    else enterAsGuest(null);
  };

  // Discreto, bajo «Entrar»: la vía rápida está ahí para quien la busque.
  const guestButton = (
    <button
      type="button"
      onClick={handleGuest}
      disabled={isLoading}
      className="mx-auto flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
    >
      <UserRound className="h-3.5 w-3.5" />
      {tr('Entrar como invitado')}
    </button>
  );

  const resumeDialog = (
    <Dialog open={resumeCandidate !== null} onOpenChange={(open) => !open && setResumeCandidate(null)}>
      <DialogContent className="sm:max-w-md">
        <EchoHeader word={tr('Invitado')}>
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-primary">{tr('Ya hay un invitado en este equipo')}</DialogTitle>
            <DialogDescription className="text-center text-xs">
              {resumeCandidate?.username && resumeCandidate.username !== GUEST_NAME
                ? tr('Se usó Frame como invitado con el nombre «{username}». ', { username: resumeCandidate.username })
                : tr('Se usó Frame como invitado en este equipo. ')}
              {tr('Puedes seguir con ese perfil y todo lo que tiene, o empezar uno nuevo (el anterior no se borra).')}
            </DialogDescription>
          </DialogHeader>
        </EchoHeader>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => enterAsGuest(null)}>
            {tr('Empezar uno nuevo')}
          </Button>
          <Button onClick={() => resumeCandidate && enterAsGuest(resumeCandidate)}>{tr('Seguir con ese perfil')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  const divider = (
    <div className="relative">
      <Separator />
      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">{tr('o con tu correo')}</span>
    </div>
  );

  return (
    <AuthShell inDialog={Boolean(linkGuest)}>
        {isSupabaseConfigured ? (
          <CardContent className="space-y-4 pt-5">
            {googleButton}
            {divider}
            <Tabs value={mode} onValueChange={(v) => setMode(v as 'login' | 'register')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">{tr('Iniciar sesión')}</TabsTrigger>
                <TabsTrigger value="register">{tr('Registrarse')}</TabsTrigger>
              </TabsList>

              <form onSubmit={handleEmailAuth} noValidate className="space-y-3.5 pt-4">
                <TabsContent value="register" className="m-0 space-y-3.5">
                  <div className="space-y-1.5">
                    <Label htmlFor="username">{tr('Nombre de usuario')}</Label>
                    <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={12} placeholder={tr('Así te saludará Frame (máx. 12)')} autoComplete="nickname" disabled={isLoading} />
                  </div>
                </TabsContent>

                <div className="space-y-1.5">
                  <Label htmlFor="email">{tr('Correo')}</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={tr('tu@correo.com')} autoComplete="email" required disabled={isLoading} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">{mode === 'register' ? tr('Contraseña para Frame') : tr('Contraseña de Frame')}</Label>
                  <PasswordInput
                    id="password"
                    value={password}
                    onChange={setPassword}
                    disabled={isLoading}
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    placeholder={mode === 'register' ? tr('Mínimo {MIN_PASSWORD} caracteres', { MIN_PASSWORD }) : undefined}
                  />
                  {mode === 'login' && (
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleForgotPassword()}
                        disabled={isLoading}
                        className="rounded px-1 text-[11px] text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                      >
                        {tr('¿Olvidaste tu contraseña?')}
                      </button>
                    </div>
                  )}
                </div>
                <TabsContent value="register" className="m-0 space-y-1.5">
                  <Label htmlFor="passwordAgain">{tr('Repite la contraseña')}</Label>
                  <PasswordInput id="passwordAgain" value={passwordAgain} onChange={setPasswordAgain} disabled={isLoading} autoComplete="new-password" />
                </TabsContent>
                {mode === 'register' && (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {tr('Crea una contraseña nueva, exclusiva de Frame. No escribas la de tu correo electrónico: Frame nunca la necesita ni te la pedirá.')}
                  </p>
                )}

                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading && <LoaderCircle className="h-4 w-4 animate-spin mr-2" />}
                  {mode === 'login' ? tr('Entrar') : tr('Crear cuenta')}
                </Button>
                {!linkGuest && guestButton}
              </form>
            </Tabs>
          </CardContent>
        ) : (
          <CardContent className="space-y-4 pt-5">
            <p className="text-sm text-center text-muted-foreground">
                {tr('Esta aplicación funciona sin conexión. Todos tus datos se almacenan localmente en tu dispositivo.')}
            </p>
            {isGoogleConfigured && googleButton}
            {!linkGuest && guestButton}
          </CardContent>
        )}

      {resumeDialog}
    </AuthShell>
  );
}
