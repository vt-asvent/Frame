import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Check, Copy, Globe, LoaderCircle, Plug, Unplug } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import {
  CloudError,
  IA_CLOUD_CHANGED,
  IA_CLOUD_MCP,
  linkState,
  onLinkState,
  PAIR_MS,
  readCloudStatus,
  requestPairingCode,
  revokeCloud,
  setCloudOn,
  type CloudStatus,
  type LinkState,
  type PairingCode,
} from '@/lib/extensions/ia/cloud';
import { intlLocale, tr } from '@/lib/i18n';
import { deviceId } from '@/lib/sync-delta';
import { cn } from '@/lib/utils';
import { useCloudOn } from './IaRuntime';

// ============================================================
// Conexiones con IA · chats en la web (1.8.0): claude.ai y los demás chats
// con conectores llegan a Frame por su relé en la nube (cloud.ts). Aquí se
// pide el código, se ve qué chats tienen permiso y qué Frame les responde,
// y se les retira el permiso.
// ============================================================

function useLinkState(): LinkState {
  const [state, setState] = useState(linkState);
  useEffect(() => {
    const stop = onLinkState(setState);
    return () => {
      stop();
    };
  }, []);
  return state;
}

function cloudErrorText(error: unknown): string {
  if (error instanceof CloudError && error.code === 'session') return tr('Vuelve a iniciar sesión en Frame y prueba otra vez.');
  if (error instanceof CloudError && error.code === 'network') return tr('Revisa tu conexión a internet.');
  return tr('La nube de Frame no respondió. Prueba en un momento.');
}

const day = (ms: number) => new Date(ms).toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
const time = (ms: number) => new Date(ms).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' });

function LinkBadge({ state }: { state: LinkState }) {
  if (state === 'off') return null;
  const label =
    state === 'online' ? tr('En línea') : state === 'connecting' ? tr('Conectando…') : state === 'signed-out' ? tr('Sin sesión') : tr('Sin conexión');
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px]', state === 'online' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', state === 'online' ? 'bg-primary' : state === 'connecting' ? 'animate-pulse bg-muted-foreground' : 'bg-muted-foreground/60')} />
      {label}
    </span>
  );
}

function CopyField({ value, what, large = false }: { value: string; what: string; large?: boolean }) {
  const { toast } = useToast();
  const copy = () =>
    void navigator.clipboard?.writeText(value).then(
      () => toast({ title: tr('Copiado'), description: what }),
      () => toast({ variant: 'destructive', title: tr('No se pudo copiar') })
    );
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      <code className={cn('min-w-0 select-all truncate rounded-md border bg-background px-2 py-1 font-mono', large ? 'text-base font-semibold tracking-[0.18em]' : 'text-[11px]')}>{value}</code>
      <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={copy} aria-label={tr('Copiar')}>
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">{n}</span>
      <div className="min-w-0 flex-1 pt-px">{children}</div>
    </li>
  );
}

function PairingSteps({ pairing, busy, onNew }: { pairing: PairingCode; busy: boolean; onNew: () => void }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);
  const expired = now >= pairing.expires;
  return (
    <ol className="space-y-2.5 rounded-md bg-muted/60 p-3">
      <Step n={1}>{tr('En claude.ai, abre Configuración › Conectores y añade un conector personalizado. En ChatGPT, los conectores piden el modo desarrollador.')}</Step>
      <Step n={2}>
        {tr('Ponle de nombre Frame y pega esta dirección:')}
        <CopyField value={IA_CLOUD_MCP} what={tr('La dirección del conector de Frame.')} />
      </Step>
      <Step n={3}>
        {tr('Pulsa Conectar y, en la página de Frame que se abre, escribe este código:')}
        {expired ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
            {tr('El código caducó.')}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy} onClick={onNew}>
              {busy && <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {tr('Pedir otro')}
            </Button>
          </div>
        ) : (
          <>
            <CopyField value={pairing.code} what={tr('El código para conectar el chat.')} large />
            <p className="mt-1 text-[11px] text-muted-foreground">{tr('Vale una sola vez, hasta las {time}.', { time: time(pairing.expires) })}</p>
          </>
        )}
      </Step>
    </ol>
  );
}

export function IaCloudSection() {
  const { toast } = useToast();
  const { userProfile } = useCourse();
  const account = !!userProfile?.id && userProfile.isGuest !== true;
  const cloudOn = useCloudOn();
  const link = useLinkState();
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState<'code' | 'revoke' | null>(null);
  const [askRevoke, setAskRevoke] = useState(false);

  const refresh = useCallback(async () => {
    if (!account) return;
    try {
      setStatus(await readCloudStatus());
    } catch {
      /* sin red o sin sesión: se queda lo último que se supo */
    }
  }, [account]);

  // Al abrir, al cambiar la conexión y cuando se retiran los permisos.
  useEffect(() => {
    void refresh();
  }, [refresh, link]);
  useEffect(() => {
    const update = () => void refresh();
    window.addEventListener(IA_CLOUD_CHANGED, update);
    return () => window.removeEventListener(IA_CLOUD_CHANGED, update);
  }, [refresh]);
  // Con un código a la vista, mirar a menudo si el chat ya se conectó.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [pairing, refresh]);
  useEffect(() => {
    if (!pairing || !status) return;
    const fresh = status.chats.find((chat) => chat.latest >= pairing.expires - PAIR_MS - 5000);
    if (!fresh) return;
    setPairing(null);
    toast({ title: tr('{name} quedó conectado', { name: fresh.name || tr('El chat') }), description: tr('Ya puede usar Frame mientras esté abierta.') });
  }, [pairing, status, toast]);

  const newCode = async () => {
    setBusy('code');
    try {
      if (!cloudOn) setCloudOn(true);
      setPairing(await requestPairingCode());
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo pedir el código'), description: cloudErrorText(error) });
    } finally {
      setBusy(null);
    }
  };

  const revoke = async () => {
    setBusy('revoke');
    try {
      await revokeCloud();
      setPairing(null);
      toast({ title: tr('Chats desconectados'), description: tr('Ya no pueden entrar a Frame. Para volver a usarlos, conéctalos con un código nuevo.') });
      await refresh();
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudieron desconectar'), description: cloudErrorText(error) });
    } finally {
      setBusy(null);
      setAskRevoke(false);
    }
  };

  const chats = status?.chats ?? [];
  const responder = status?.devices[0];
  const me = deviceId();
  const who =
    !cloudOn || link !== 'online' || !responder
      ? null
      : responder.id === me
        ? tr('Responde este equipo.')
        : responder.platform === 'android'
          ? tr('Ahora responde la Frame de tu celular; este equipo, si esa se cierra.')
          : tr('Ahora responde Frame en otro equipo; este, si esa se cierra.');

  return (
    <section className="space-y-2.5 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Globe className="h-4 w-4 text-primary" />
        <p className="flex-1 text-sm font-medium">{tr('Chats en la web')}</p>
        {account && cloudOn && <LinkBadge state={link} />}
      </div>
      <p className="text-muted-foreground">
        {tr('claude.ai (en la web, el escritorio y el celular), ChatGPT y otros chats con conectores llegan a Frame a través de su nube, que pasa cada llamada sin guardarla. Frame tiene que estar abierta.')}
      </p>

      {!account ? (
        <p className="rounded-md bg-muted/60 p-2.5 text-muted-foreground">{tr('Inicia sesión con tu cuenta de Frame para conectar chats en la web.')}</p>
      ) : (
        <>
          {chats.length > 0 && (
            <ul className="space-y-1">
              {chats.map((chat) => (
                <li key={chat.name} className="flex items-center gap-2 rounded-md border px-3 py-1.5">
                  <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">{chat.name || tr('Un chat')}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{tr('desde el {date}', { date: day(chat.since) })}</span>
                </li>
              ))}
            </ul>
          )}
          {who && <p className="text-[11px] text-muted-foreground">{who}</p>}
          {chats.length > 0 && !cloudOn && (
            <p className="text-[11px] text-muted-foreground">{tr('Este equipo no les responde: activa «Responder desde este equipo» para que lo haga.')}</p>
          )}

          {pairing && <PairingSteps pairing={pairing} busy={busy === 'code'} onNew={() => void newCode()} />}
          {/* El consentimiento, antes de la primera conexión (Política de Privacidad, 3.7). */}
          {chats.length === 0 && !pairing && (
            <p className="text-[11px] text-muted-foreground">
              {tr('Al conectar un chat, aceptas que sus llamadas pasen por la nube de Frame en Cloudflare (Estados Unidos y otros países), como explica la Política de Privacidad (3.7).')}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {!pairing && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => void newCode()}>
                {busy === 'code' ? <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1 h-3.5 w-3.5" />}
                {chats.length ? tr('Conectar otro chat') : tr('Conectar un chat')}
              </Button>
            )}
            {chats.length > 0 && (
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => setAskRevoke(true)}>
                <Unplug className="mr-1 h-3.5 w-3.5" />
                {tr('Desconectar los chats')}
              </Button>
            )}
            <label className="ml-auto flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
              <Switch checked={cloudOn} onCheckedChange={(value) => setCloudOn(value)} aria-label={tr('Responder desde este equipo')} />
              {tr('Responder desde este equipo')}
            </label>
          </div>
        </>
      )}

      <AlertDialog open={askRevoke} onOpenChange={(open) => !open && busy !== 'revoke' && setAskRevoke(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Desconectar los chats de la web?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Todos los chats que conectaste pierden el permiso al instante, también en tus otros equipos. Para volver a usarlos, conéctalos de nuevo con un código.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === 'revoke'}>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy === 'revoke'}
              onClick={(event) => {
                event.preventDefault();
                void revoke();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy === 'revoke' && <LoaderCircle className="mr-1 h-3.5 w-3.5 animate-spin" />}
              {tr('Desconectar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
