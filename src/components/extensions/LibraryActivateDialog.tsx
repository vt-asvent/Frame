import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Library, LoaderCircle, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { rememberLoreAccess } from '@/lib/extensions/aklore/access';
import { AKLORE, activateLore, fetchLoreAccess, requestLoreCode, type LoreAccess } from '@/lib/extensions/aklore/source';
import { officialById } from '@/lib/extensions/catalog';
import { installExtension, listInstalled, setExtensionEnabled } from '@/lib/extensions/store';
import { tr } from '@/lib/i18n';

// ============================================================
// Activar la Biblioteca (1.9.4, Diego): dos pasos y nada más.
//
//   1. Tu correo institucional  → [Enviar código]
//   2. El código de 6 dígitos que llegó a ese correo → se activa solo
//
// Vale para la cuenta de Frame con la que estás, entres con el correo que
// entres. Si la cuenta ya la tenía activada (en otro equipo), no pregunta nada.
// Al terminar instala la extensión en este equipo y abre la Biblioteca.
// ============================================================

type Step = 'checking' | 'email' | 'code';

export default function LibraryActivateDialog({ uid, open, onClose }: { uid: string | null | undefined; open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('checking');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [minutes, setMinutes] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** La ventana que hizo el pedido: si se cierra y se vuelve a abrir, su respuesta ya no cuenta. */
  const turn = useRef(0);

  const finish = (access: LoreAccess) => {
    if (!uid) return;
    rememberLoreAccess(uid, access);
    const manifest = officialById(AKLORE)?.manifest();
    if (listInstalled().some((entry) => entry.id === AKLORE)) setExtensionEnabled(AKLORE, true);
    else if (manifest) installExtension(manifest, true);
    toast({ title: tr('Biblioteca activada'), description: tr('Está en la barra lateral, debajo de Calendario.') });
    onClose();
    navigate('/biblioteca');
  };

  useEffect(() => {
    if (!open) return;
    const mine = ++turn.current;
    setStep('checking');
    setCode('');
    setError(null);
    setBusy(false);
    // Ya activada en otro equipo (o la cuenta es del colegio): directo.
    fetchLoreAccess()
      .then((access) => {
        if (turn.current !== mine) return;
        if (access.active) finish(access);
        else setStep('email');
      })
      .catch((problem: unknown) => {
        if (turn.current !== mine) return;
        setStep('email');
        setError(problem instanceof Error ? problem.message : String(problem));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    const mine = turn.current;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (problem) {
      if (turn.current === mine) setError(problem instanceof Error ? problem.message : String(problem));
    } finally {
      if (turn.current === mine) setBusy(false);
    }
  };

  const send = () =>
    run(async () => {
      const mine = turn.current;
      const valid = await requestLoreCode(email.trim());
      if (turn.current !== mine) return;
      setMinutes(valid);
      setCode('');
      setStep('code');
    });

  const activate = (value: string) =>
    run(async () => {
      const mine = turn.current;
      const access = await activateLore(value).catch((problem: unknown) => {
        // Código errado: el campo queda vacío para escribir otro.
        if (turn.current === mine) setCode('');
        throw problem;
      });
      if (turn.current !== mine) return;
      if (access.active) finish(access);
    });

  const onCode = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    setError(null);
    // Con los seis dígitos, se activa sin pulsar nada.
    if (digits.length === 6 && !busy) void activate(digits);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {step === 'code' ? <MailCheck className="h-6 w-6" /> : <Library className="h-6 w-6" />}
          </span>
          <DialogTitle className="pt-2 text-xl font-bold text-primary">{tr('Activar la Biblioteca')}</DialogTitle>
          <DialogDescription>
            {step === 'code'
              ? tr('Escribe el código de 6 dígitos que enviamos a {email}. Vale {minutes} minutos.', { email: email.trim(), minutes })
              : tr('Es para estudiantes del colegio. Escribe tu correo institucional y te enviaremos un código.')}
          </DialogDescription>
        </DialogHeader>

        {step === 'checking' ? (
          <div className="flex h-24 items-center justify-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : step === 'email' ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Input
              type="email"
              inputMode="email"
              autoFocus
              autoComplete="email"
              spellCheck={false}
              maxLength={120}
              placeholder={tr('Tu correo institucional')}
              aria-label={tr('Tu correo institucional')}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setError(null);
              }}
            />
            {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !email.includes('@')}>
              {busy && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              {tr('Enviar código')}
            </Button>
            <p className="text-center text-[11px] leading-snug text-muted-foreground">
              {tr('La Biblioteca quedará activada en tu cuenta de Frame, entres con el correo que entres. El código te lo envía Asvent por correo; en la nube de Frame solo queda una huella de tu correo institucional, que no se puede leer.')}
            </p>
          </form>
        ) : (
          <div className="space-y-3">
            <Input
              inputMode="numeric"
              autoFocus
              autoComplete="one-time-code"
              maxLength={7}
              placeholder="000000"
              aria-label={tr('Código de 6 dígitos')}
              className="h-12 text-center font-mono text-2xl tracking-[0.4em]"
              value={code}
              disabled={busy}
              onChange={(event) => onCode(event.target.value)}
            />
            {busy && (
              <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {tr('Comprobando…')}
              </p>
            )}
            {error && <p className="text-center text-xs text-destructive" role="alert">{error}</p>}
            <p className="text-center text-[11px] leading-snug text-muted-foreground">{tr('¿No llega? Revisa la carpeta de correo no deseado.')}</p>
            <div className="flex justify-between gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setStep('email');
                  setError(null);
                }}
              >
                {tr('Cambiar el correo')}
              </Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send()}>
                {tr('Enviar otro código')}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
