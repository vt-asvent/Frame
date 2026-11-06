import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileUp, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import ExtensionInstallDialog from '@/components/extensions/ExtensionInstallDialog';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import { domainHashOf, OFFICIAL_EXTENSIONS, type OfficialId } from '@/lib/extensions/catalog';
import { compareVersions, parseManifest, PERMISSIONS, type ExtensionManifest } from '@/lib/extensions/manifest';
import {
  installExtension,
  manifestOf,
  setExtensionEnabled,
  uninstallExtension,
  useInstalledExtensions,
  type InstalledExtension,
} from '@/lib/extensions/store';
import { EXTENSION_PANELS, ThirdPartyPanel } from '@/components/extensions/extension-panels';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { markWireJustInstalled, WireSection } from '@/components/extensions/wire/WireViews';
import { WIRE } from '@/lib/extensions/wire/relay';
import { useCatalog } from '@/lib/extensions/remote-catalog';

/** Vistas previas de las oficiales (1.7.6): captura .webp o vídeo .webm de menos de 5 s. */
const PREVIEW_FILES = import.meta.glob('/src/assets/extensiones/previews/*.{webp,png,webm}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const PREVIEWS: Record<string, string> = Object.fromEntries(
  Object.entries(PREVIEW_FILES).map(([file, url]) => [file.split('/').pop()!.replace(/\.(webp|png|webm)$/, ''), url])
);

// ============================================================
// Extensiones (1.7.3, rehecho el 6-nov-2026): una sección propia, fuera del
// menú principal. Se llega desde una sola fila en Ajustes (/extensiones).
//
// - Arriba, un buscador. Sin texto se ven solo las oficiales; al escribir se
//   filtra en vivo entre las oficiales, las de terceros instaladas y las del
//   catálogo remoto (1.7.6: estas solo aparecen al buscarlas por su nombre).
// - Cada extensión es una tarjeta (un tercio del ancho, 1.7.6): arriba su
//   nombre y su interruptor; abajo una vista previa de lo que hace en Frame
//   (los vídeos se reproducen al pasar el cursor). Encender una que no está
//   instalada abre la aceptación de permisos. Tocar la tarjeta abre su propio
//   panel (ajustes, permisos, desinstalar).
// - Lo que aporta una extensión activa vive en su sitio natural (Descargar en
//   Música, AK Lore en la barra lateral), no aquí.
// - `?ext=<id>` abre directamente el panel de esa extensión.
// ============================================================

interface Pending {
  manifest: ExtensionManifest;
  official: boolean;
  previous: ExtensionManifest | null;
}

/** Una fila de la lista: instalada o no, oficial o de terceros. */
interface Row {
  id: string;
  manifest: ExtensionManifest;
  official: boolean;
  entry: InstalledExtension | null;
  /** Vista previa remota (catálogo), si la tiene. */
  preview?: string | null;
  /** Del catálogo remoto y sin instalar: solo se ve al buscarla. */
  remote?: boolean;
}

const normalize = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function ExtensionsCenter() {
  const { userProfile } = useCourse();
  const { toast } = useToast();
  const navigate = useNavigate();
  const installed = useInstalledExtensions();
  const catalog = useCatalog();
  const fileRef = useRef<HTMLInputElement>(null);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [removing, setRemoving] = useState<InstalledExtension | null>(null);
  const [domainHash, setDomainHash] = useState<string | null>(null);
  const openId = params.get('ext');

  useEffect(() => {
    let alive = true;
    void domainHashOf(userProfile?.email).then((hash) => alive && setDomainHash(hash));
    return () => {
      alive = false;
    };
  }, [userProfile?.email]);

  /** Oficiales que este usuario puede ver (las de un colegio, solo con su cuenta). */
  const rows = useMemo<Row[]>(() => {
    const officials: Row[] = OFFICIAL_EXTENSIONS.filter(
      (e) => EXTENSION_PANELS[e.id] && (!e.domainHash || e.domainHash === domainHash)
    ).map((e) => {
      const entry = installed.find((i) => i.id === e.id) ?? null;
      return { id: e.id, manifest: (entry && manifestOf(entry)) || e.manifest(), official: true, entry };
    });
    const thirdParty: Row[] = installed
      .filter((i) => i.manifest)
      .map((i) => ({
        id: i.id,
        manifest: i.manifest!,
        official: false,
        entry: i,
        preview: catalog.find((c) => c.id === i.id)?.preview ?? null,
      }));
    const remote: Row[] = catalog
      .filter((c) => !installed.some((i) => i.id === c.id))
      .map((c) => ({ id: c.id, manifest: c.manifest, official: false, entry: null, preview: c.preview, remote: true }));
    return [...officials, ...thirdParty, ...remote];
  }, [installed, domainHash, catalog]);

  const q = normalize(query.trim());
  const visible = q
    ? rows.filter((r) =>
        // Las del catálogo, solo por su nombre (no aparecen buscando «música»).
        r.remote ? normalize(r.manifest.name).includes(q) : normalize(`${r.manifest.name} ${r.manifest.description} ${r.manifest.author}`).includes(q)
      )
    : rows.filter((r) => r.official);

  const open = rows.find((r) => r.id === openId) ?? null;
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ext', id);
    else next.delete('ext');
    setParams(next, { replace: true });
  };

  const toggle = (row: Row, on: boolean) => {
    if (!row.entry) {
      if (on) setPending({ manifest: row.manifest, official: row.official, previous: null });
      return;
    }
    setExtensionEnabled(row.id, on);
  };

  const onFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    try {
      const result = parseManifest(await file.text());
      if (!result.ok) {
        toast({ variant: 'destructive', title: tr('No se pudo instalar'), description: result.error, duration: 10000 });
        return;
      }
      const current = installed.find((e) => e.id === result.manifest.id);
      const previous = current ? manifestOf(current) : null;
      if (previous && compareVersions(result.manifest.version, previous.version) <= 0) {
        toast({
          title: tr('{name} ya está instalada', { name: result.manifest.name }),
          description: tr('Tienes la versión {version}; el archivo no trae una más nueva.', { version: previous.version }),
        });
        return;
      }
      setPending({ manifest: result.manifest, official: false, previous });
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo leer el archivo'), description: errorText(error).slice(0, 160) });
    }
  };

  const accept = () => {
    if (!pending) return;
    installExtension(pending.manifest, pending.official);
    if (pending.manifest.id === WIRE && !pending.previous) markWireJustInstalled();
    toast({
      title: pending.previous ? tr('{name} actualizada', { name: pending.manifest.name }) : tr('{name} instalada', { name: pending.manifest.name }),
    });
    setPending(null);
  };

  const remove = async () => {
    if (!removing) return;
    const name = manifestOf(removing)?.name ?? removing.id;
    setRemoving(null);
    setOpen(null);
    await uninstallExtension(removing.id);
    toast({ title: tr('{name} desinstalada', { name }), description: tr('No quedó nada suyo en este equipo.') });
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate('/settings')} aria-label={tr('Volver a Ajustes')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tr('Buscar extensiones')}
            aria-label={tr('Buscar extensiones')}
            className="pl-9"
            autoFocus
          />
        </div>
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
        {visible.map((row) => (
          <ExtensionCard key={row.id} row={row} onOpen={() => setOpen(row.id)} onToggle={(value) => toggle(row, value)} />
        ))}
        {visible.length === 0 && (
          <li className="col-span-full rounded-lg border border-border/60 px-3 py-8 text-center text-xs text-muted-foreground">
            {tr('Ninguna extensión coincide con «{query}».', { query })}
          </li>
        )}
      </ul>

      <div className="mt-4 flex justify-center">
        <input
          ref={fileRef}
          type="file"
          accept=".json,.frame-ext,application/json"
          className="hidden"
          onChange={(e) => void onFile(e.target.files)}
        />
        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => fileRef.current?.click()} title={tr('Extensiones de terceros: un archivo .json')}>
          <FileUp className="mr-2 h-4 w-4" />
          {tr('Instalar desde archivo…')}
        </Button>
      </div>

      <Dialog open={!!open} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          {open && <ExtensionPanel row={open} onToggle={(v) => toggle(open, v)} onRemove={() => open.entry && setRemoving(open.entry)} />}
        </DialogContent>
      </Dialog>

      <ExtensionInstallDialog
        manifest={pending?.manifest ?? null}
        official={pending?.official ?? false}
        previous={pending?.previous}
        onCancel={() => setPending(null)}
        onAccept={accept}
      />

      <AlertDialog open={!!removing} onOpenChange={(value) => !value && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr('¿Desinstalar {name}?', { name: removing ? manifestOf(removing)?.name ?? '' : '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr('Se borra todo lo que guardó en este equipo: sus ajustes, la carpeta elegida y sus llaves. Lo que trajo a Frame (tareas, fechas, canciones) se queda. Puedes volver a instalarla cuando quieras.')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr('Cancelar')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {tr('Desinstalar')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Tarjeta de una extensión: nombre e interruptor arriba, vista previa abajo. */
function ExtensionCard({ row, onOpen, onToggle }: { row: Row; onOpen: () => void; onToggle: (on: boolean) => void }) {
  const on = !!row.entry?.enabled;
  const src = PREVIEWS[row.id] ?? row.preview ?? null;
  const isVideo = !!src && /\.(webm|mp4)(\?|$)/i.test(src);
  const videoRef = useRef<HTMLVideoElement>(null);
  const play = () => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  };
  const stop = () => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
  };

  return (
    <li
      className="group flex flex-col gap-2.5 rounded-xl border border-border/60 bg-card p-3 transition-colors hover:border-primary/40"
      onMouseEnter={play}
      onMouseLeave={stop}
    >
      <div className="flex items-center gap-2.5">
        <ExtensionIcon id={row.id} manifest={row.manifest} className="h-7 w-7 rounded-md [&_svg]:h-4 [&_svg]:w-4" />
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground focus-visible:outline-none"
          title={row.manifest.description}
        >
          {row.manifest.name}
          {!row.official && <span className="ml-2 text-[10px] font-bold text-muted-foreground">{tr('De terceros')}</span>}
        </button>
        <Switch
          checked={on}
          onCheckedChange={onToggle}
          aria-label={on ? tr('Desactivar {name}', { name: row.manifest.name }) : tr('Activar {name}', { name: row.manifest.name })}
          className="data-[state=unchecked]:bg-muted-foreground/30"
        />
      </div>
      <button
        type="button"
        onClick={onOpen}
        onFocus={play}
        onBlur={stop}
        aria-label={tr('Abrir {name}', { name: row.manifest.name })}
        className="relative aspect-video w-full overflow-hidden rounded-lg border border-border/60 bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {src && isVideo ? (
          <video ref={videoRef} src={src} muted loop playsInline preload="metadata" className="h-full w-full object-cover" />
        ) : src ? (
          <img src={src} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 p-3">
            <ExtensionIcon id={row.id} manifest={row.manifest} className="h-12 w-12 rounded-xl [&_svg]:h-7 [&_svg]:w-7" />
            <span className="line-clamp-2 text-center text-[11px] text-muted-foreground">{row.manifest.description}</span>
          </span>
        )}
      </button>
    </li>
  );
}

/** El panel propio de una extensión: interruptor, sus ajustes, permisos y desinstalar. */
function ExtensionPanel({ row, onToggle, onRemove }: { row: Row; onToggle: (on: boolean) => void; onRemove: () => void }) {
  const { manifest, entry } = row;
  const on = !!entry?.enabled;
  const Panel: ComponentType<{ id: string; manifest: ExtensionManifest }> | undefined =
    EXTENSION_PANELS[row.id as OfficialId] ?? (entry?.manifest ? ThirdPartyPanel : undefined);
  const permissions = entry?.granted ?? manifest.permissions;

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-3 pr-6">
          <ExtensionIcon id={row.id} manifest={manifest} />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-primary">{manifest.name}</DialogTitle>
            <p className="text-[11px] text-muted-foreground">
              {row.official ? tr('Oficial') : tr('De terceros · {author}', { author: manifest.author })}
              {' · '}
              {tr('Versión {version}', { version: manifest.version })}
              {entry && <> · {tr('Instalada el {date}', { date: new Date(entry.installedAt).toLocaleDateString() })}</>}
            </p>
          </div>
          <Switch
            checked={on}
            onCheckedChange={onToggle}
            aria-label={on ? tr('Desactivar {name}', { name: manifest.name }) : tr('Activar {name}', { name: manifest.name })}
            className="data-[state=unchecked]:bg-muted-foreground/30"
          />
        </div>
        <DialogDescription className="pt-1 text-sm">{manifest.description}</DialogDescription>
      </DialogHeader>

      {on && Panel ? (
        <div className="space-y-4">
          <Panel id={row.id} manifest={manifest} />
          {row.id === WIRE && <WireSection />}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {entry ? tr('Desactivada: no hace nada y conserva sus ajustes.') : tr('Actívala para instalarla; antes verás los permisos que pide.')}
        </p>
      )}

      <div className="space-y-2 border-t border-border/60 pt-3">
        <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          {tr('Permisos')}
        </p>
        <ul className="space-y-1.5">
          {permissions.map((id) => (
            <li key={id} className="text-xs">
              <span className="font-semibold text-foreground">{PERMISSIONS[id]?.title() ?? id}</span>
              <span className="text-muted-foreground"> · {PERMISSIONS[id]?.detail()}</span>
            </li>
          ))}
        </ul>
        <div className={cn('flex flex-wrap items-center gap-2 pt-1', manifest.homepage ? 'justify-between' : 'justify-end')}>
          {manifest.homepage && (
            <a href={manifest.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3.5 w-3.5" />
              {tr('Página de la extensión')}
            </a>
          )}
          {entry && (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRemove}>
              <Trash2 className="mr-2 h-4 w-4" />
              {tr('Desinstalar')}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}
