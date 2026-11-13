import { useEffect, useState } from 'react';
import { CircleCheck, CircleAlert, Clock, Laptop, LoaderCircle, Smartphone, Tablet, Unlink, Wrench, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useCourse } from '@/context/CourseContext';
import { askToReconnect, useConnectionState } from '@/lib/connection-status';
import { agoMs, forgetDevice, repairAllDevices, setDevicesOpen, stateOf, useDevices, type DeviceRow, type DeviceState, type IssueKind } from '@/lib/devices';
import { deviceId } from '@/lib/sync-delta';
import { dateLocale, tr, trc } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Wire → Dispositivos (1.9.2 en Ajustes; desde la 1.9.9, en la interfaz de
// Wire, Diego): los equipos de la cuenta, si siguen vinculados y si están al
// día; «Corregir» pone a todos a sincronizar. Ver lib/devices.ts.
//
// 1.9.9: la tarjeta dice la verdad de cada equipo. Solo alarma (ámbar) lo que
// le falta a un equipo que está ABIERTO; uno cerrado se pondrá al día al
// abrirlo, y se dice así. De la música, las imágenes y los adjuntos (que solo
// viajan con Wire) se dice además qué hace falta: activar Wire en ese equipo,
// o esperar a que el equipo que los tiene esté abierto. Y «Corregir» cuenta lo
// que hizo: antes giraba seis segundos y no decía nada.
// ============================================================

const ICON = { laptop: Laptop, phone: Smartphone, tablet: Tablet } as const;
const KIND_LABEL = { laptop: 'Laptop', phone: 'Celular', tablet: 'Tablet' } as const;
const PLATFORM_LABEL: Record<string, string> = { windows: 'Windows', android: 'Android', ios: 'iOS', macos: 'macOS', linux: 'Linux', web: 'Web' };
/** Un equipo que latió hace menos de esto tiene Frame abierto. */
const OPEN_MS = 2 * 60_000;
/** Al abrir la tarjeta, lo que tardan los demás equipos en contestar. */
const SETTLE_MS = 4000;

const issuesOf = (row: DeviceRow): Partial<Record<IssueKind, unknown>> => {
  const raw: unknown = row.sync?.issues;
  return raw && typeof raw === 'object' ? (raw as Partial<Record<IssueKind, unknown>>) : {};
};

/** Lo que le falta a un equipo, en palabras («2 imágenes · 5 canciones»). */
function missingText(row: DeviceRow): string {
  const issues = issuesOf(row);
  const parts: string[] = [];
  const add = (kind: IssueKind, one: string, many: string) => {
    const n = issues[kind];
    if (typeof n === 'number' && n > 0) parts.push(n === 1 ? tr(one) : tr(many, { count: n }));
  };
  add('pending', '1 cambio por subir', '{count} cambios por subir');
  add('error', '1 error al sincronizar', '{count} errores al sincronizar');
  add('image', '1 imagen', '{count} imágenes');
  add('song', '1 canción', '{count} canciones');
  add('attachment', '1 adjunto', '{count} adjuntos');
  return parts.join(' · ');
}

/** Qué hace falta para que llegue lo que solo viaja con Wire (música, imágenes propias, adjuntos). Sin concordar con lo que falta: va detrás de «2 canciones · ». */
function wireHint(row: DeviceRow, self: boolean): string {
  const issues = issuesOf(row);
  if (!(['song', 'image', 'attachment'] as const).some((kind) => typeof issues[kind] === 'number' && (issues[kind] as number) > 0)) return '';
  if (row.sync?.wire === true) return tr('Wire espera al equipo que tiene los archivos');
  if (row.sync?.wire === false) return self ? tr('conecta Wire aquí') : tr('activa Wire en ese equipo');
  return tr('necesita Wire');
}

/** «hace 5 minutos», medido con el reloj del servidor (el de este equipo puede ir mal). */
function ago(iso: string | null | undefined, skew: number): string | null {
  const ms = agoMs(iso, skew);
  return Number.isFinite(ms) ? formatDistanceToNow(Date.now() - ms, { addSuffix: true, locale: dateLocale() }) : null;
}

const STATE_STYLE: Record<DeviceState, string> = {
  synced: 'text-emerald-500',
  waiting: 'text-muted-foreground',
  behind: 'text-amber-500',
  unlinked: 'text-muted-foreground',
  inactive: 'text-muted-foreground',
};

export function DevicesCard() {
  const { userProfile } = useCourse();
  const devices = useDevices();
  const [repairing, setRepairing] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  /** «Corregir» ya se pidió: se dice qué se hizo. */
  const [repaired, setRepaired] = useState(false);
  const [settling, setSettling] = useState(true);
  const connection = useConnectionState();
  const signedIn = !!userProfile && !userProfile.isGuest;
  /** La nube cerró la sesión de este equipo: se ofrece reconectarla aquí mismo. */
  const sessionLost = !!userProfile && connection.sessionLostFor === userProfile.id;

  // Con la tarjeta a la vista, lib/devices.ts mira cada 30 s y pide a los demás equipos que contesten.
  useEffect(() => {
    if (!signedIn) return;
    setDevicesOpen(true);
    setSettling(true);
    const timer = window.setTimeout(() => setSettling(false), SETTLE_MS);
    return () => {
      window.clearTimeout(timer);
      setDevicesOpen(false);
    };
  }, [signedIn]);

  if (!signedIn) {
    return (
      <Card>
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-lg font-bold text-primary">{tr('Dispositivos')}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 text-sm text-muted-foreground">{tr('Entra con tu cuenta para ver aquí tu laptop, tu celular y tu tablet, y si están sincronizados.')}</CardContent>
      </Card>
    );
  }

  const { rows, failed, skew } = devices;
  const me = deviceId();
  const list = rows ?? [];
  const states = new Map(list.map((row) => [row.device_id, stateOf(row, devices, me)] as const));
  const stateIs = (row: DeviceRow, ...wanted: DeviceState[]) => wanted.includes(states.get(row.device_id) ?? 'waiting');
  /** Con Frame abierto ahora: este equipo, o uno que latió hace nada. */
  const isOpen = (row: DeviceRow) => row.device_id === me || agoMs(row.last_seen, skew) < OPEN_MS;
  const active = list.filter((row) => stateIs(row, 'synced', 'waiting', 'behind'));
  // Solo alarma lo que le falta a un equipo abierto: uno cerrado no puede hacer nada hasta que lo abran.
  const behind = active.filter((row) => stateIs(row, 'behind') && isOpen(row));
  const mine = states.get(me);

  /** Cabecera: lo peor que pase, y si no pasa nada, lo mejor que se pueda afirmar. */
  const headline = behind.length
    ? { tone: 'text-amber-500', Icon: CircleAlert, spin: false, text: tr('{count} sin sincronizar del todo', { count: behind.length }) }
    : mine === 'waiting'
      ? { tone: 'text-muted-foreground', Icon: LoaderCircle, spin: true, text: tr('Sincronizando…') }
      : active.length > 1 && active.every((row) => stateIs(row, 'synced'))
        ? { tone: 'text-emerald-500', Icon: CircleCheck, spin: false, text: tr('Todo sincronizado entre tus {count} dispositivos', { count: active.length }) }
        : mine === 'synced'
          ? { tone: 'text-emerald-500', Icon: CircleCheck, spin: false, text: tr('Este dispositivo está al día') }
          : null;

  const repair = async () => {
    setRepairing(true);
    setUnreachable(false);
    setRepaired(false);
    const asked = await repairAllDevices();
    setUnreachable(!asked);
    // Los demás tardan unos segundos en hacerlo: el botón descansa mientras tanto.
    window.setTimeout(
      () => {
        setRepairing(false);
        setRepaired(asked);
      },
      asked ? 6000 : 0
    );
  };

  const forget = async (id: string) => {
    setUnreachable(false);
    setUnreachable(!(await forgetDevice(id)));
  };

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center gap-3 space-y-0 p-4 pb-3">
        <CardTitle className="text-lg font-bold text-primary">{tr('Dispositivos')}</CardTitle>
        {rows && headline && (
          <span className={cn('flex items-center gap-1.5 text-xs font-semibold', headline.tone)}>
            <headline.Icon className={cn('h-4 w-4', headline.spin && 'animate-spin')} />
            {headline.text}
          </span>
        )}
        <Button size="sm" variant={behind.length ? 'default' : 'outline'} className="ml-auto gap-2" onClick={() => void repair()} disabled={repairing || !rows}>
          {repairing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
          {trc('sincronización', 'Corregir')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {unreachable && (
          <p role="alert" className="text-xs text-destructive">
            {tr('No se pudo contactar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.')}
          </p>
        )}
        {repaired && !unreachable && (
          <p role="status" className="flex items-start gap-2 rounded-lg bg-primary/5 p-3 text-xs text-foreground/90">
            <CircleCheck className="mt-px h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1">
              {behind.length
                ? tr('Hecho: este equipo sincronizó y se lo pidió a los demás. Lo que sigue pendiente dice abajo qué necesita.')
                : tr('Hecho: este equipo sincronizó y se lo pidió a los demás.')}
            </span>
          </p>
        )}
        {sessionLost && (
          <p role="alert" className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-foreground/90">
            <CircleAlert className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1">{tr('La sesión de este equipo se cerró. Tus datos siguen aquí.')}</span>
            <Button size="sm" onClick={askToReconnect}>
              {tr('Volver a conectar')}
            </Button>
          </p>
        )}
        {failed && !unreachable && !sessionLost && <p className="text-xs text-muted-foreground">{tr('No se pudo leer la lista de dispositivos. Se reintenta sola.')}</p>}
        {!rows ? (
          !failed && <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((row) => {
              const state = states.get(row.device_id) ?? 'waiting';
              const Icon = ICON[row.kind] ?? Laptop;
              const self = row.device_id === me;
              const gone = state === 'unlinked' || state === 'inactive';
              const open = isOpen(row);
              const seen = ago(row.last_seen, skew);
              // Sin confirmar la última versión: o está en ello (abierto), o lo hará cuando lo abran.
              const busy = state === 'waiting' && (self || settling || open);
              /** Le falta algo y está cerrado: no es una alarma, es una espera. */
              const asleep = state === 'behind' && !open;
              const closedAt = ago(row.unlinked_at, skew);
              const missing = state === 'behind' ? missingText(row) : '';
              const hint = state === 'behind' && open ? wireHint(row, self) : '';
              const detail =
                state === 'unlinked'
                  ? self
                    ? // Este equipo sigue abierto, pero su sesión ya no existe en la nube (se cerró desde fuera).
                      tr('La sesión se cerró: vuelve a conectar tu cuenta')
                    : closedAt
                      ? tr('Se cerró la sesión {when}', { when: closedAt })
                      : seen
                        ? tr('Sesión cerrada · última vez {when}', { when: seen })
                        : tr('Desvinculado')
                  : state === 'inactive'
                    ? tr('Sin abrir Frame desde hace más de un mes')
                    : state === 'synced'
                      ? tr('Sincronizado')
                      : asleep
                        ? [missing, tr('Se pondrá al día al abrir Frame')].filter(Boolean).join(' · ')
                        : state === 'behind'
                          ? [missing, hint].filter(Boolean).join(' · ') || tr('Sincronizando…')
                          : busy
                            ? tr('Sincronizando…')
                            : tr('Se pondrá al día al abrir Frame');
              const DetailIcon = state === 'synced' ? CircleCheck : asleep ? Clock : state === 'behind' ? CircleAlert : state === 'waiting' ? (busy ? LoaderCircle : Clock) : null;
              return (
                <li key={row.device_id} className={cn('flex items-start gap-3 rounded-lg border p-3', self ? 'border-primary/50 bg-primary/5' : 'border-border/60')}>
                  <span className="relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className={cn('h-5 w-5', gone ? 'text-muted-foreground' : 'text-primary')} />
                    <span
                      className={cn(
                        'absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card',
                        state === 'unlinked' ? 'bg-muted-foreground' : state === 'inactive' ? 'bg-muted-foreground/60' : 'bg-emerald-500'
                      )}
                      title={state === 'unlinked' ? tr('Desvinculado') : tr('Vinculado')}
                    >
                      {state === 'unlinked' && <Unlink className="h-2.5 w-2.5 text-card" />}
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {tr(KIND_LABEL[row.kind] ?? 'Laptop')} · {PLATFORM_LABEL[row.platform] ?? row.platform}
                      {self && <span className="ml-1.5 text-xs font-normal text-primary">({tr('este')})</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {state === 'unlinked' ? tr('Desvinculado') : tr('Vinculado')}
                      {row.app_version ? ` · Frame ${row.app_version}` : ''}
                      {!self && state !== 'unlinked' && seen ? ` · ${seen}` : ''}
                    </p>
                    <p className={cn('mt-1 flex items-start gap-1 text-xs', asleep ? STATE_STYLE.waiting : STATE_STYLE[state])}>
                      {DetailIcon && <DetailIcon className={cn('mt-px h-3.5 w-3.5 shrink-0', busy && 'animate-spin')} />}
                      <span className="min-w-0">{detail}</span>
                    </p>
                  </div>
                  {!self && gone && (
                    <button
                      type="button"
                      onClick={() => void forget(row.device_id)}
                      className="rounded p-1 text-muted-foreground hover:text-foreground"
                      aria-label={tr('Quitar de la lista')}
                      title={tr('Quitar de la lista')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">
          {tr('Cada equipo con tu sesión aparece aquí. «Corregir» sincroniza datos, imágenes y Wire en este equipo y se lo pide a los demás: lo hacen en unos minutos si tienen Frame abierto, o al abrirlo.')}
        </p>
      </CardContent>
    </Card>
  );
}
