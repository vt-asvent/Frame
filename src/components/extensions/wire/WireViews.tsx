import { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CloudOff,
  FileText,
  Image as ImageIcon,
  HardDrive,
  Heart,
  Laptop,
  LoaderCircle,
  Mic,
  Music,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useToast } from '@/hooks/use-toast';
import { useCourse } from '@/context/CourseContext';
import { extRead, extWrite, useExtensionOn } from '@/lib/extensions/store';
import {
  chooseDriveAccount,
  confirmDriveAccount,
  deviceName,
  disconnectWire,
  renameDevice,
  requestWireCycle,
  runWireCycle,
  togglePin,
  useWireStatus,
  WIRE,
  type WireItemView,
} from '@/lib/extensions/wire/relay';
import { wireLive } from '@/components/extensions/wire/WireRuntime';
import { formatBytes } from '@/lib/music-import';
import { dateLocale, errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';

// ============================================================
// Wire en Ajustes (1.7.3):
//   · WirePanel, en la tarjeta de la extensión: la cuenta de Drive (elegir y
//     confirmar al instalar), el nombre de este equipo y desconectar;
//   · WireSection, sección propia: cuántos archivos se pueden compartir y
//     cuántos faltan, y el relevo en vivo, como una ventana de Drive.
// ============================================================

type Grant = Awaited<ReturnType<typeof chooseDriveAccount>>;

/** Al aceptar la instalación de Wire, su panel abre enseguida la elección de cuenta. */
export const markWireJustInstalled = () => extWrite(WIRE, 'connectOnOpen', true);

export function WirePanel() {
  const { toast } = useToast();
  const status = useWireStatus();
  const [grant, setGrant] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [name, setName] = useState(deviceName() ?? '');
  const started = useRef(false);

  const connect = async () => {
    setBusy(true);
    try {
      setGrant(await chooseDriveAccount());
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo conectar con Google Drive'), description: errorText(error).slice(0, 200) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current || status.account) return;
    if (extRead(WIRE, 'connectOnOpen', false)) {
      started.current = true;
      extWrite(WIRE, 'connectOnOpen', null);
      void connect();
    }
  }, [status.account]);

  const confirm = async () => {
    if (!grant) return;
    try {
      await confirmDriveAccount(grant);
      setGrant(null);
      setName(deviceName() ?? '');
      requestWireCycle(300);
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo guardar la conexión'), description: errorText(error).slice(0, 200) });
    }
  };

  return (
    <div className="space-y-2 text-xs">
      {status.account ? (
        <>
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            <HardDrive className="h-4 w-4 text-primary" />
            {tr('Relevo en el Drive de {email}.', { email: status.account })}
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => document.getElementById('wire')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {tr('Ver en vivo')}
            </button>
          </p>
          {/* 1.9.6: lo que solo el usuario puede arreglar se dice aquí, con su botón. */}
          {status.reauth && (
            <p role="alert" className="flex flex-wrap items-center gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-destructive">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{tr('Google retiró el permiso: vuelve a conectar tu Drive.')}</span>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void connect()} disabled={busy}>
                {busy && <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                {tr('Volver a conectar')}
              </Button>
            </p>
          )}
          {status.otherDrive && (
            <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-2.5 py-2 text-destructive">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">{tr('Otro de tus equipos tiene Wire en una cuenta de Google Drive distinta: conecta la misma en todos.')}</span>
            </p>
          )}
          {status.outdated.length > 0 && (
            <p role="status" className="flex items-start gap-2 rounded-md bg-primary/5 px-2.5 py-2 text-muted-foreground">
              <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">{tr('Actualiza Frame en «{name}»: hasta entonces no recibe la música de este equipo.', { name: status.outdated.join('», «') })}</span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Laptop className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">{tr('Este equipo se llama')}</span>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                renameDevice(name);
                requestWireCycle();
              }}
              className="h-7 w-44 text-xs"
              maxLength={40}
              aria-label={tr('Nombre de este equipo')}
            />
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-muted-foreground" onClick={() => setLeaving(true)}>
              <CloudOff className="mr-1.5 h-3.5 w-3.5" />
              {tr('Desconectar')}
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void connect()} disabled={busy}>
            {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <HardDrive className="mr-2 h-4 w-4" />}
            {tr('Elegir cuenta de Google Drive…')}
          </Button>
          <span className="text-muted-foreground">{tr('El relevo usa tu propio Drive.')}</span>
        </div>
      )}

      <AlertDialog open={!!grant} onOpenChange={(open) => !open && setGrant(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Usar este Drive como relevo?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Cuenta: {email}. Frame creará la carpeta «Frame · Wire» y solo verá lo que ponga en ella. Lo nuevo sube, tus otros equipos lo bajan y, cuando todos lo tienen, sale de Drive (salvo las canciones con corazón y lo que fijes).', {
                email: grant?.email ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirm()}>{tr('Confirmar')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Desconectar este equipo del relevo?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Este equipo deja de subir y bajar, y tus otros equipos dejan de esperarlo. Lo que ya llegó a Frame se queda, y lo que está en Drive sigue ahí para los demás.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void disconnectWire()}>{tr('Desconectar')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const kindIcon = (item: WireItemView) => (item.kind === 'song' ? Music : item.kind === 'image' ? ImageIcon : item.kind === 'recording' ? Mic : FileText);

/** Sección propia en Ajustes: el relevo en vivo, como una ventana de Drive. */
export function WireSection() {
  const on = useExtensionOn(WIRE);
  const status = useWireStatus();
  const course = useCourse();
  const ref = useRef<HTMLElement>(null);

  // Mientras se ve, el relevo va más rápido (en vivo).
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      wireLive.visible = entry.isIntersecting;
      if (entry.isIntersecting) requestWireCycle(800);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      wireLive.visible = false;
    };
  }, [on, status.account]);

  if (!on || !status.account) return null;

  const syncNow = () => {
    const p = course.userProfile;
    if (!p) return;
    void runWireCycle({
      uid: p.id,
      songs: course.songs,
      addSongs: course.addSongs,
      tasks: course.tasks,
      archivedTasks: course.archivedTasks,
      incompleteTasks: course.incompleteTasks,
      notes: course.notes,
      archivedNotes: course.archivedNotes,
    });
  };

  const ago = (at: number) => formatDistanceToNow(at, { addSuffix: true, locale: dateLocale() });

  return (
    <section ref={ref} id="wire" className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-primary">{tr('Wire · relevo por Drive')}</h2>
          <p className="text-xs text-muted-foreground">
            {status.phase === 'syncing'
              ? tr('Sincronizando…')
              : status.lastSync
                ? tr('Al día · {when}', { when: ago(status.lastSync) })
                : tr('Esperando la primera vuelta…')}
          </p>
        </div>
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold',
            status.phase === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'
          )}
        >
          <span className={cn('h-2 w-2 rounded-full', status.phase === 'error' ? 'bg-destructive' : 'bg-primary', status.phase === 'syncing' && 'animate-pulse')} />
          {status.phase === 'error' ? tr('Con problemas') : tr('En vivo')}
        </span>
        <Button size="sm" variant="outline" onClick={syncNow} disabled={status.phase === 'syncing'}>
          <RefreshCw className={cn('mr-2 h-4 w-4', status.phase === 'syncing' && 'animate-spin')} />
          {tr('Sincronizar ahora')}
        </Button>
      </div>

      {status.error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          {status.error}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: tr('Se pueden compartir'), value: status.shareable.songs + status.shareable.files, hint: tr('canciones: {songs} · archivos: {files}', status.shareable) },
          { label: tr('Faltan por subir'), value: status.pendingUp, hint: tr('a tus otros equipos') },
          { label: tr('Faltan por bajar'), value: status.pendingDown, hint: tr('a este equipo') },
          { label: tr('Equipos'), value: status.devices.filter((d) => d.active).length, hint: tr('activos esta semana') },
        ].map((card) => (
          <div key={card.label} className="rounded-lg border border-border/60 bg-gradient-to-b from-primary/[0.06] to-transparent px-3 py-2">
            <p className="text-[11px] font-semibold text-muted-foreground">{card.label}</p>
            <p className="font-headline text-2xl font-bold text-foreground">{card.value}</p>
            <p className="text-[10px] text-muted-foreground">{card.hint}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* La «ventana de Drive»: lo que está ahora mismo en la carpeta del relevo. */}
        <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
          <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2 text-xs">
            <span className="flex gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
              <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
            </span>
            <HardDrive className="ml-1 h-3.5 w-3.5 text-primary" />
            <span className="truncate text-muted-foreground">
              {tr('Mi unidad')} › <span className="font-semibold text-foreground">Frame · Wire</span>
            </span>
            <span className="ml-auto text-muted-foreground">{status.items.length}</span>
          </div>
          {status.transfer && (
            <div className="flex items-center gap-2 border-b border-border/50 bg-primary/5 px-3 py-2 text-xs">
              {status.transfer.direction === 'up' ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />}
              <span className="min-w-0 flex-1 truncate">
                {status.transfer.direction === 'up' ? tr('Subiendo «{name}»…', { name: status.transfer.name }) : tr('Bajando «{name}»…', { name: status.transfer.name })}
              </span>
              <span className="relative h-1.5 w-24 overflow-hidden rounded-full bg-primary/15">
                <span className="absolute inset-y-0 w-1/3 animate-[wire-slide_1.2s_ease-in-out_infinite] rounded-full bg-primary" />
              </span>
            </div>
          )}
          <ul className="max-h-80 overflow-y-auto">
            {status.items.length === 0 ? (
              <li className="p-6 text-center text-xs text-muted-foreground">
                {tr('Nada de paso: tus equipos tienen lo mismo. Lo nuevo aparecerá aquí mientras viaja.')}
              </li>
            ) : (
              status.items.map((item) => {
                const Icon = kindIcon(item);
                return (
                  <li key={item.id} className="flex animate-in fade-in slide-in-from-top-1 items-center gap-3 border-b border-border/40 px-3 py-2 text-xs last:border-0">
                    <Icon className="h-4 w-4 shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{item.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {formatBytes(item.size)} · {tr('de {device}', { device: item.fromName })}
                        {' · '}
                        {item.permanent
                          ? tr('se queda en Drive')
                          : item.waiting.length > 0
                            ? tr('lo espera: {devices}', { devices: item.waiting.join(', ') })
                            : tr('ya lo tienen todos')}
                      </span>
                    </span>
                    {item.permanent && !item.pinned && <Heart className="h-3.5 w-3.5 text-primary" aria-label={tr('Con corazón')} />}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => togglePin(item.key)}
                      title={item.pinned ? tr('Dejar de fijar') : tr('Fijar: que se quede en Drive')}
                      aria-label={item.pinned ? tr('Dejar de fijar') : tr('Fijar: que se quede en Drive')}
                    >
                      {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </Button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="space-y-4">
          <div>
            <p className="mb-2 text-xs font-bold text-muted-foreground">{tr('Equipos')}</p>
            <ul className="space-y-1.5">
              {status.devices.map((d) => (
                <li key={d.id} className={cn('flex items-center gap-2 text-xs', !d.active && 'opacity-60')}>
                  <Laptop className="h-3.5 w-3.5 text-primary" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {d.name}
                    {d.self && <span className="ml-1 text-muted-foreground">({tr('este')})</span>}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{d.self ? tr('ahora') : d.active ? ago(d.lastSeen) : tr('ya no se le espera')}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 text-xs font-bold text-muted-foreground">{tr('Actividad')}</p>
            <ul className="max-h-56 space-y-1.5 overflow-y-auto">
              {status.log.length === 0 && <li className="text-xs text-muted-foreground">{tr('Aún no hay movimiento.')}</li>}
              {status.log.map((entry) => {
                const Icon = { up: ArrowUp, down: ArrowDown, remove: Trash2, info: HardDrive, error: TriangleAlert }[entry.kind];
                return (
                  <li key={`${entry.at}-${entry.text}`} className="flex animate-in fade-in items-start gap-2 text-xs">
                    <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', entry.kind === 'error' ? 'text-destructive' : 'text-primary')} />
                    <span className="min-w-0 flex-1 text-foreground/90">{entry.text}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(entry.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">
        {tr('Lo que ya está en todos tus equipos se borra de Drive del todo, sin pasar por su papelera: deja de ocupar espacio en el acto. Un equipo que no se conecta en una semana deja de esperarse.')}
      </p>
    </section>
  );
}
