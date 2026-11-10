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
//   2. Al abrir una app, el código de 6 dígitos (TOTP); la primera vez, la
//      clave para la app de autenticación. Ya no se pide más en esta pestaña.
//   3. El servidor no responde sin los dos pasos (`is_frame_owner()`) ni a
//      ninguna otra cuenta.
//
// El autenticador es de la BASE, no de Supabase Auth (migraciones 0021 y
// 0022): ella guarda la clave, comprueba el código (`metrics_unlock`) y da de
// alta uno nuevo (`metrics_totp_begin`). Este panel NO llama nunca a
// `supabase.auth.mfa`. Hasta el 10-nov-2026 lo hacía, y una cuenta con segundo
// factor en Auth pierde sus sesiones normales cada vez que lo verifica: cada
// visita a este panel le cerraba Frame al responsable en la laptop, el celular
// y la tablet.
//
// La sesión vive solo en esta pestaña y se cierra sola tras 30 minutos sin
// actividad. Ni entrar, ni el código, ni cerrar sesión aquí tocan las sesiones
// de Frame en sus equipos.
// ============================================================

type Phase = { kind: 'loading' } | { kind: 'signed-out'; notice?: string } | { kind: 'in'; verified: boolean };

type Step = { kind: 'checking' } | { kind: 'enroll'; secret: string; account: string } | { kind: 'verify' };

const IDLE_MS = 30 * 60 * 1000;
const NOT_OWNER = 'Esta cuenta no es la del responsable. Cierra sesión y entra con la suya.';

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

/** El segundo paso: pedir el código o, la primera vez, dar de alta el autenticador. Lo decide la base. */
async function secondFactor(): Promise<Step> {
  const { data: state, error: stateError } = await supabase.rpc('metrics_totp_state');
  if (stateError) {
    // La base aún no tiene la 0022 (el panel se publica un momento antes que ella).
    if (stateError.code === 'PGRST202') throw new Error('El panel se está actualizando. Vuelve a intentarlo en unos minutos.');
    throw stateError;
  }
  if (state === 'not-owner') throw new Error(NOT_OWNER);
  if (state === 'ready') return { kind: 'verify' };

  const { data: begun, error: beginError } = await supabase.rpc('metrics_totp_begin');
  if (beginError) throw beginError;
  const reply = (begun ?? null) as { ok?: boolean; secret?: unknown; reason?: string } | null;
  if (reply?.reason === 'exists') return { kind: 'verify' };
  if (reply?.reason === 'not-owner') throw new Error(NOT_OWNER);
  if (reply?.ok !== true || typeof reply.secret !== 'string' || !reply.secret) throw new Error('No se pudo preparar el alta del autenticador. Inténtalo de nuevo.');
  const { data: sessionData } = await supabase.auth.getSession();
  return { kind: 'enroll', secret: reply.secret, account: sessionData.session?.user.email ?? 'Frame' };
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
                <CodeForm onDone={verified} onCancel={() => setGate(null)} label="Código de 6 dígitos de tu app de autenticación" />
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

/** Lo que dijo la base al no abrir (ver `metrics_unlock`, migraciones 0021 y 0022). */
function unlockProblem(reply: UnlockReply): string {
  switch (reply.reason) {
    case 'code':
      return `Código incorrecto o ya usado. Escribe el que se ve ahora.${typeof reply.left === 'number' && reply.left <= 2 ? ` Te ${reply.left === 1 ? 'queda 1 intento' : `quedan ${reply.left} intentos`}.` : ''}`;
    case 'locked':
      return `Demasiados intentos. Espera ${Math.max(1, Math.ceil((reply.retry_in ?? 900) / 60))} min y vuelve a probar.`;
    case 'not-owner':
      return NOT_OWNER;
    case 'unavailable':
      return 'La clave del autenticador no se pudo leer. Hay que darlo de alta otra vez (ver la migración 0022).';
    case 'session':
      return 'La sesión de este panel venció. Cierra sesión y vuelve a entrar.';
    case 'no-factor':
      return 'Esta cuenta aún no tiene su app de autenticación dada de alta. Cierra este recuadro y vuelve a abrir la app.';
    default:
      return 'No se pudo comprobar el código. Inténtalo de nuevo.';
  }
}

/**
 * El código de cada visita y también el primero tras dar de alta el
 * autenticador (que lo confirma): los dos los comprueba la base, sin tocar las
 * sesiones de Frame.
 */
function CodeForm({ onDone, onCancel, label }: { onDone: () => Promise<void>; onCancel: () => void; label: string }) {
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
    const { data, error: rpcError } = await supabase.rpc('metrics_unlock', { p_code: code });
    const reply = (data ?? null) as UnlockReply | null;
    const problem = rpcError || !reply ? rpcError?.message || 'El servidor no respondió. Inténtalo de nuevo.' : reply.ok === true ? null : unlockProblem(reply);
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
  const [copied, setCopied] = useState(false);
  const name = 'Frame métricas';
  // En un teléfono, este enlace abre la app de autenticación con la clave ya puesta.
  const uri = `otpauth://totp/${encodeURIComponent(`${name}:${step.account}`)}?secret=${step.secret}&issuer=${encodeURIComponent(name)}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(step.secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Primera vez: en tu app de autenticación (Google Authenticator, Microsoft Authenticator, Authy…) añade una cuenta con «Introducir clave de configuración», de tipo «basada en tiempo», y
        escribe esta clave. Desde ahora te pedirá el código que muestre.
      </p>
      <code className="block select-all break-all rounded-md bg-secondary/50 p-3 text-center font-mono text-sm tracking-wider text-foreground">{step.secret.replace(/(.{4})(?=.)/g, '$1 ')}</code>
      <div className="flex items-center justify-between gap-3 text-xs">
        <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => void copy()}>
          {copied ? 'Clave copiada' : 'Copiar la clave'}
        </button>
        <a className="text-muted-foreground underline-offset-2 hover:underline" href={uri}>
          Abrir en la app de este equipo
        </a>
      </div>
      <CodeForm onDone={onDone} onCancel={onCancel} label="Código de 6 dígitos que muestra la app" />
    </div>
  );
}
