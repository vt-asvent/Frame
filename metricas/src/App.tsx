import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ExternalLink, KeyRound, LoaderCircle, Lock, LogOut, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Toaster } from '@/components/ui/toaster';
import { isConfigured, supabase } from '@m/lib/supabase';
import { CACHE_KEY, clearPanelCache } from '@m/lib/cache';
import { appById, METRICS_APPS, type MetricsApp } from '@m/apps';
import { dayOfInstant, type UsageSnapshot } from '@m/lib/usage-model';

const Panel = lazy(() => import('@m/Panel'));

// ============================================================
// Panel único de métricas (1.7.3): la puerta y las tarjetas.
//
// Pedido del 5-nov-2026: una página principal con una tarjeta por app
// (nombre, logo y un resumen muy breve). Al abrir una se pide el código del
// autenticador y, una vez verificado, no se vuelve a pedir en esa sesión.
// Reemplaza a «Métricas de Frame» (13-oct), que pedía el código al entrar.
//
//   1. Google: la cuenta del responsable. Con ella solo se ven las tarjetas.
//   2. Al abrir una app, el código de 6 dígitos (TOTP); la primera vez, el QR.
//      Ya no se pide más en esta pestaña.
//   3. El servidor no responde sin los dos pasos (`is_frame_owner()`) ni a
//      ninguna otra cuenta.
//
// El código lo comprueba la BASE (`metrics_unlock`, migración 0021), no el
// segundo factor de Supabase Auth. Hasta el 10-nov-2026 se verificaba con
// `mfa.challengeAndVerify`: al hacerlo, Auth sube la sesión a `aal2` y borra
// todas las demás de la cuenta que no lo son, es decir, la de Frame en la
// laptop, el celular y la tablet del responsable. Cada visita a este panel le
// cerraba Frame en todos sus equipos. Auth solo interviene ya en el ALTA del
// autenticador (una vez en la vida), que no tiene otra vía.
//
// La sesión vive solo en esta pestaña y se cierra sola tras 30 minutos sin
// actividad. Ni entrar, ni el código, ni cerrar sesión aquí tocan las sesiones
// de Frame en sus equipos.
// ============================================================

type Phase = { kind: 'loading' } | { kind: 'signed-out'; notice?: string } | { kind: 'in'; verified: boolean };

type Step = { kind: 'checking' } | { kind: 'enroll'; factorId: string; qr: string; secret: string } | { kind: 'verify'; factorId: string };

const IDLE_MS = 30 * 60 * 1000;
const FACTOR_NAME = 'Métricas de Frame';

const message = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? error ?? '');

/** ¿Hay sesión de Google y ya pasó el segundo paso? Lo segundo lo dice la base. */
async function decide(): Promise<Phase> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  if (!sessionData.session) return { kind: 'signed-out' };
  // Si la base no contesta ahora, se entra sin verificar: al abrir una app se vuelve a preguntar.
  const { data: verified, error: ownerError } = await supabase.rpc('is_frame_owner');
  return { kind: 'in', verified: !ownerError && verified === true };
}

/** El segundo paso: pedir el código o, la primera vez, darlo de alta. */
async function secondFactor(): Promise<Step> {
  // Solo la cuenta del responsable llega al código (las demás, ni al alta del autenticador).
  const { data: owner, error: ownerError } = await supabase.rpc('metrics_owner_account');
  if (ownerError) throw ownerError;
  if (owner !== true) throw new Error('Esta cuenta no es la del responsable. Cierra sesión y entra con la suya.');
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) throw listError;
  const verified = factors.totp[0];
  if (verified) return { kind: 'verify', factorId: verified.id };

  // Un alta a medias (se cerró la pestaña antes de escribir el código) no se reutiliza.
  for (const factor of factors.all) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: factor.id });
  }
  const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: FACTOR_NAME,
    issuer: 'Frame',
  });
  if (enrollError) throw enrollError;
  return { kind: 'enroll', factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret };
}

/** La app abierta va en la dirección (#frame) para que «Atrás» vuelva a las tarjetas. */
const viewFromHash = () => appById(window.location.hash.replace(/^#/, ''))?.id ?? null;

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(viewFromHash);
  const [gate, setGate] = useState<{ app: MetricsApp; step: Step } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const next = await decide();
      setPhase(next);
      return next;
    } catch (reason) {
      setError(message(reason));
      setPhase({ kind: 'signed-out' });
      return null;
    }
  }, []);

  // Solo esta pestaña: las sesiones de Frame en los equipos del responsable siguen abiertas.
  const signOut = useCallback(async (notice?: string) => {
    clearPanelCache();
    setGate(null);
    history.replaceState(null, '', window.location.pathname);
    setView(null);
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setPhase({ kind: 'signed-out', notice });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id: string | null) => {
    if (id) window.location.hash = id;
    else history.pushState(null, '', window.location.pathname);
    setView(id);
  };

  /** Abrir una tarjeta: dentro, tras el código (una vez por sesión); fuera, en otra pestaña. */
  const open = useCallback(
    async (app: MetricsApp) => {
      if (app.access.kind === 'link') {
        window.open(app.access.href, '_blank', 'noopener,noreferrer');
        return;
      }
      if (app.access.kind !== 'inside') return;
      if (phase.kind === 'in' && phase.verified) {
        go(app.id);
        return;
      }
      setGate({ app, step: { kind: 'checking' } });
      try {
        const step = await secondFactor();
        setGate((current) => (current?.app.id === app.id ? { app, step } : current));
      } catch (reason) {
        setGate(null);
        setError(message(reason));
      }
    },
    [phase]
  );

  // Recargar con #frame sin haber verificado: se pide el código al llegar.
  useEffect(() => {
    if (phase.kind !== 'in' || phase.verified || !view || gate) return;
    const app = appById(view);
    go(null);
    if (app) void open(app);
    // Solo al terminar de decidir la sesión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const verified = async () => {
    const target = gate?.app ?? null;
    const next = await refresh();
    setGate(null);
    if (target && next?.kind === 'in' && next.verified) go(target.id);
  };

  // 30 minutos sin tocar nada (o con el equipo dormido) cierran la sesión.
  const lastActivity = useRef(Date.now());
  const signedIn = phase.kind === 'in';
  useEffect(() => {
    if (!signedIn) return;
    lastActivity.current = Date.now();
    const touch = () => {
      lastActivity.current = Date.now();
    };
    const check = () => {
      if (Date.now() - lastActivity.current > IDLE_MS) void signOut('La sesión se cerró tras 30 minutos sin actividad.');
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [signedIn, signOut]);

  const signIn = async () => {
    setError(null);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${window.location.pathname}`, queryParams: { prompt: 'select_account' } },
    });
    if (oauthError) setError(message(oauthError));
  };

  if (phase.kind === 'in') {
    const current = phase.verified ? appById(view) : null;
    return (
      <div className="min-h-screen bg-background">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/60 bg-background/90 px-4 py-2.5 backdrop-blur md:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            {current ? (
              <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2 text-xs" onClick={() => go(null)}>
                <ArrowLeft className="h-4 w-4" /> Apps
              </Button>
            ) : (
              <ShieldCheck className="h-4 w-4 text-primary" />
            )}
            <span className="font-headline font-bold">{current ? current.name : 'Asvent'}</span>
            <span className="text-muted-foreground">· Métricas</span>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
          </Button>
        </header>

        {current?.id === 'frame' ? (
          <Suspense
            fallback={
              <div className="flex h-60 items-center justify-center">
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
              </div>
            }
          >
            <Panel />
          </Suspense>
        ) : (
          <Home verified={phase.verified} onOpen={(app) => void open(app)} error={error} />
        )}

        {gate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-10" role="dialog" aria-modal aria-label={`Código para ${gate.app.name}`}>
            <div className="max-h-full w-full max-w-sm overflow-y-auto rounded-xl border border-border/70 bg-card p-6 shadow-lg">
              <div className="mb-4 flex items-center gap-3">
                <div className="h-9 w-9 shrink-0">{gate.app.logo}</div>
                <div>
                  <h2 className="font-headline text-base font-bold">{gate.app.name}</h2>
                  <p className="text-xs text-muted-foreground">Una vez por sesión: después no se vuelve a pedir.</p>
                </div>
              </div>
              {gate.step.kind === 'checking' && (
                <div className="flex h-24 items-center justify-center">
                  <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}
              {gate.step.kind === 'enroll' && <Enroll step={gate.step} onDone={verified} onCancel={() => setGate(null)} />}
              {gate.step.kind === 'verify' && (
                <CodeForm mode="unlock" factorId={gate.step.factorId} onDone={verified} onCancel={() => setGate(null)} label="Código de 6 dígitos de tu app de autenticación" />
              )}
            </div>
          </div>
        )}
        <Toaster />
      </div>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm rounded-xl border border-border/70 bg-card p-6 shadow-sm">
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="font-headline text-lg font-bold">Métricas de Asvent</h1>
        </div>

        {!isConfigured && <p className="text-sm text-destructive">Falta la configuración de Supabase en esta compilación.</p>}

        {phase.kind === 'loading' && (
          <div className="flex h-24 items-center justify-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}

        {phase.kind === 'signed-out' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Acceso restringido. Entra con la cuenta del responsable; al abrir una app se pide el código de tu app de autenticación.</p>
            {phase.notice && <p className="rounded-md border border-border/60 bg-secondary/40 p-2.5 text-xs text-muted-foreground">{phase.notice}</p>}
            <Button className="w-full" onClick={() => void signIn()} disabled={!isConfigured}>
              Entrar con Google
            </Button>
          </div>
        )}

        {error && <p className="mt-4 break-words text-xs text-destructive">{error}</p>}
      </div>
    </main>
  );
}

/** Lo último que esta pestaña bajó del panel de Frame (nada si aún no se abrió). */
function frameSummary(): string | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    const snapshot = raw ? (JSON.parse(raw) as UsageSnapshot) : null;
    if (snapshot?.v !== 1) return null;
    const accounts = snapshot.users.filter((u) => !u.g).length;
    const active = snapshot.users.filter((u) => (u.a.length > 0 ? u.a[u.a.length - 1] : dayOfInstant(u.ls)) >= snapshot.today - 6).length;
    return `${accounts} ${accounts === 1 ? 'cuenta' : 'cuentas'} · ${active} ${active === 1 ? 'activa' : 'activas'} en 7 días`;
  } catch {
    return null;
  }
}

function Home({ verified, onOpen, error }: { verified: boolean; onOpen: (app: MetricsApp) => void; error: string | null }) {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <h1 className="font-headline text-xl font-bold">Tus apps</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {verified ? 'Código verificado en esta sesión: abre la que quieras analizar.' : 'Al abrir una se pide el código de tu app de autenticación, una sola vez por sesión.'}
      </p>
      {error && <p className="mt-3 break-words text-xs text-destructive">{error}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {METRICS_APPS.map((app) => {
          const summary = app.id === 'frame' && verified ? frameSummary() : null;
          const disabled = app.access.kind === 'none';
          return (
            <button
              key={app.id}
              type="button"
              disabled={disabled}
              onClick={() => onOpen(app)}
              className="group flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-5 text-left shadow-sm transition-colors enabled:hover:border-primary/60 enabled:hover:bg-secondary/30 disabled:cursor-default disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 shrink-0">{app.logo}</div>
                <div className="min-w-0">
                  <p className="font-headline text-base font-bold">{app.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{app.tagline}</p>
                </div>
              </div>
              <p className="min-h-[1.25rem] text-sm text-foreground/90">
                {app.access.kind === 'inside' ? summary ?? (verified ? 'Abre para ver el uso al día.' : 'Uso, estudiantes, errores e impacto.') : app.access.note}
              </p>
              <span className="mt-auto flex items-center gap-1.5 text-xs font-medium text-primary">
                {app.access.kind === 'inside' &&
                  (verified ? (
                    'Abrir'
                  ) : (
                    <>
                      <Lock className="h-3.5 w-3.5" /> Pide el código
                    </>
                  ))}
                {app.access.kind === 'link' && (
                  <>
                    <ExternalLink className="h-3.5 w-3.5" /> Abrir su panel
                  </>
                )}
                {app.access.kind === 'none' && <span className="text-muted-foreground">Sin métricas todavía</span>}
              </span>
            </button>
          );
        })}
      </div>
    </main>
  );
}

interface UnlockReply {
  ok?: boolean;
  reason?: string;
  left?: number;
  retry_in?: number;
}

/** Lo que dijo la base al no abrir (ver `metrics_unlock`, migración 0021). */
function unlockProblem(reply: UnlockReply): string {
  switch (reply.reason) {
    case 'code':
      return `Código incorrecto o ya usado. Escribe el que se ve ahora.${typeof reply.left === 'number' && reply.left <= 2 ? ` Te ${reply.left === 1 ? 'queda 1 intento' : `quedan ${reply.left} intentos`}.` : ''}`;
    case 'locked':
      return `Demasiados intentos. Espera ${Math.max(1, Math.ceil((reply.retry_in ?? 900) / 60))} min y vuelve a probar.`;
    case 'not-owner':
      return 'Esta cuenta no es la del responsable. Cierra sesión y entra con la suya.';
    case 'session':
      return 'La sesión de este panel venció. Cierra sesión y vuelve a entrar.';
    case 'no-factor':
      return 'Esta cuenta aún no tiene su app de autenticación dada de alta. Cierra este recuadro y vuelve a abrir la app.';
    default:
      return 'No se pudo comprobar el código. Inténtalo de nuevo.';
  }
}

/**
 * `unlock`: el código de cada visita, que comprueba la base sin tocar las
 * sesiones de Frame. `enroll`: el primer código tras escanear el QR, que tiene
 * que pasar por Supabase Auth para dar el autenticador por bueno.
 */
function CodeForm({
  mode,
  factorId,
  onDone,
  onCancel,
  label,
}: {
  mode: 'unlock' | 'enroll';
  factorId: string;
  onDone: () => Promise<void>;
  onCancel: () => void;
  label: string;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError('Escribe los 6 dígitos.');
      return;
    }
    setBusy(true);
    setError(null);
    /** La vía de Supabase Auth: el alta, o si la base no puede comprobarlo (clave ilegible, base sin la 0021). */
    const withAuth = async (): Promise<string | null> => {
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (!verifyError) return null;
      return /invalid|expired/i.test(verifyError.message) ? 'Código incorrecto o vencido. Escribe el que se ve ahora.' : verifyError.message;
    };
    let problem: string | null;
    if (mode === 'enroll') {
      problem = await withAuth();
    } else {
      const { data, error: rpcError } = await supabase.rpc('metrics_unlock', { p_code: code });
      const reply = (data ?? null) as UnlockReply | null;
      if (rpcError?.code === 'PGRST202' || reply?.reason === 'unavailable') problem = await withAuth();
      else if (rpcError || !reply) problem = rpcError?.message || 'El servidor no respondió. Inténtalo de nuevo.';
      else problem = reply.ok === true ? null : unlockProblem(reply);
    }
    setBusy(false);
    if (problem) {
      setCode('');
      setError(problem);
      return;
    }
    await onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block text-xs font-medium text-muted-foreground" htmlFor="codigo">
        {label}
      </label>
      <Input
        id="codigo"
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={6}
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        className="h-11 text-center font-mono text-lg tracking-[0.4em]"
        placeholder="000000"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <Button type="submit" className="flex-1 gap-1.5" disabled={busy}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Verificar
        </Button>
      </div>
    </form>
  );
}

function Enroll({ step, onDone, onCancel }: { step: Extract<Step, { kind: 'enroll' }>; onDone: () => Promise<void>; onCancel: () => void }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Primera vez: escanea este código con una app de autenticación (Google Authenticator, Microsoft Authenticator, Authy…). Desde ahora te pedirá el código que muestre.
      </p>
      <div className="flex justify-center rounded-lg bg-white p-3">
        <img src={step.qr} alt="Código QR para la app de autenticación" className="h-44 w-44" />
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">¿No puedes escanearlo? Escribe esta clave</summary>
        <code className="mt-2 block select-all break-all rounded-md bg-secondary/50 p-2 font-mono text-[11px] text-foreground">{step.secret}</code>
      </details>
      <p className="rounded-md border border-border/60 bg-secondary/40 p-2.5 text-xs text-muted-foreground">
        Solo esta vez: al dar de alta el autenticador, la sesión de Frame en tus equipos se cierra y hay que volver a entrar. Después, abrir este panel ya no la toca.
      </p>
      <CodeForm mode="enroll" factorId={step.factorId} onDone={onDone} onCancel={onCancel} label="Código de 6 dígitos que muestra la app" />
    </div>
  );
}
