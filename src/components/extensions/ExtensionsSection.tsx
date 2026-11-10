import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileUp, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import ExtensionInstallDialog from '@/components/extensions/ExtensionInstallDialog';
import LibraryActivateDialog from '@/components/extensions/LibraryActivateDialog';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import { AKLORE } from '@/lib/extensions/aklore/source';
import { OFFICIAL_EXTENSIONS, type OfficialId } from '@/lib/extensions/catalog';
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
import { easedMask } from '@/lib/eased-fade';

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
// - Cada extensión es una tarjeta (un tercio del ancho total, 1.8.0): arriba
//   su nombre y su interruptor; abajo una vista previa de lo que hace en Frame
//   (los vídeos se reproducen al pasar el cursor). Encender una que no está
//   instalada abre la aceptación de permisos.
// - Tocar la tarjeta abre su propia interfaz (1.8.0, como la de una
//   asignatura: oculta el resto): el logo grande con lo básico al lado y,
//   debajo, lo suyo (el funcionamiento en vivo de Wire, las opciones de
//   Animaciones…), sus permisos y desinstalar.
// - Lo que aporta una extensión activa vive en su sitio natural (Descargar en
//   Música, la Biblioteca en la barra lateral), no aquí.
// - La Biblioteca (1.9.4) no pasa por el recuadro de permisos: al activarla
//   pide el correo institucional y el código que llega a él
//   (LibraryActivateDialog), y solo entonces se instala.
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
  /** Oficial que, sin instalar, solo se ve al buscarla por su nombre. */
  searchOnly?: boolean;
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
  const [activating, setActivating] = useState(false);
  const openId = params.get('ext');
  /** Con correo: una cuenta de Frame, no un invitado. */
  const hasAccount = !!userProfile?.email && !userProfile.isGuest;

  /** Oficiales que este usuario puede ver (la Biblioteca, solo con una cuenta). */
  const rows = useMemo<Row[]>(() => {
    const officials: Row[] = OFFICIAL_EXTENSIONS.filter((e) => EXTENSION_PANELS[e.id] && (!e.needsAccount || hasAccount)).map((e) => {
      const entry = installed.find((i) => i.id === e.id) ?? null;
      return { id: e.id, manifest: (entry && manifestOf(entry)) || e.manifest(), official: true, entry, searchOnly: !!e.searchOnly && !entry };
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
  }, [installed, hasAccount, catalog]);

  const q = normalize(query.trim());
  /** Sin espacios ni tildes: «frame descargas» encuentra «Frame Descargas». */
  const squeezed = (text: string) => normalize(text).replace(/\s+/g, '');
  const visible = q
    ? rows.filter((r) =>
        // Las del catálogo, solo por su nombre (no aparecen buscando «música»).
        r.remote || r.searchOnly
          ? normalize(r.manifest.name).includes(q) || squeezed(r.manifest.name).includes(squeezed(query))
          : normalize(`${r.manifest.name} ${r.manifest.description} ${r.manifest.author}`).includes(q)
      )
    : rows.filter((r) => r.official && !r.searchOnly);

  const open = rows.find((r) => r.id === openId) ?? null;
  const inUse = installed.filter((e) => e.enabled).length;
  const rootRef = useRef<HTMLDivElement>(null);

  // Al entrar o salir de una extensión, arriba del todo (como al abrir una asignatura).
  useEffect(() => {
    const scroller = rootRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    scroller?.scrollTo({ top: 0 });
  }, [openId]);
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('ext', id);
    else next.delete('ext');
    setParams(next, { replace: true });
  };

  const toggle = (row: Row, on: boolean) => {
    if (!row.entry) {
      if (!on) return;
      // La Biblioteca se instala al activarla con el código del correo institucional.
      if (row.id === AKLORE) setActivating(true);
      else setPending({ manifest: row.manifest, official: row.official, previous: null });
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
    <div ref={rootRef} className="w-full px-6 pb-8 pt-4 md:px-8">
      {open ? (
        <ExtensionPage
          row={open}
          onBack={() => setOpen(null)}
          onToggle={(v) => toggle(open, v)}
          onRemove={() => open.entry && setRemoving(open.entry)}
        />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" onClick={() => navigate('/settings')} aria-label={tr('Volver a Ajustes')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            {/* Buscador redondo (1.8.0) con, a la derecha, cuántas hay en uso. */}
            <label className="flex h-10 min-w-0 flex-1 cursor-text items-center gap-2 rounded-full border border-input bg-card px-4 ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={tr('Buscar extensiones')}
                aria-label={tr('Buscar extensiones')}
                autoComplete="off"
                spellCheck={false}
                className="h-full min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                autoFocus
              />
              <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground" aria-live="polite">
                <span className="font-semibold text-foreground/70">{inUse}</span> {tr('en uso')}
              </span>
            </label>
          </div>

          <ul className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
        </>
      )}

      <ExtensionInstallDialog
        manifest={pending?.manifest ?? null}
        official={pending?.official ?? false}
        previous={pending?.previous}
        onCancel={() => setPending(null)}
        onAccept={accept}
      />
      <LibraryActivateDialog uid={userProfile?.id} open={activating} onClose={() => setActivating(false)} />

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

const HERO_MASK = easedMask('to right');

/**
 * La interfaz propia de una extensión (1.8.0): arriba el logo grande con su
 * nombre, autor, versión, descripción y el interruptor, sobre su vista previa;
 * debajo, lo suyo (ajustes y funcionamiento) y, al lado, permisos y desinstalar.
 */
function ExtensionPage({ row, onBack, onToggle, onRemove }: { row: Row; onBack: () => void; onToggle: (on: boolean) => void; onRemove: () => void }) {
  const { manifest, entry } = row;
  const on = !!entry?.enabled;
  const Panel: ComponentType<{ id: string; manifest: ExtensionManifest }> | undefined =
    EXTENSION_PANELS[row.id as OfficialId] ?? (entry?.manifest ? ThirdPartyPanel : undefined);
  const permissions = entry?.granted ?? manifest.permissions;
  const src = PREVIEWS[row.id] ?? row.preview ?? null;
  const isVideo = !!src && /\.(webm|mp4)(\?|$)/i.test(src);
  const state = on ? tr('Activada') : entry ? tr('Desactivada') : tr('Sin instalar');

  return (
    <div className="space-y-6">
      <div className="relative -mx-6 -mt-4 overflow-hidden border-b border-border/60 md:-mx-8">
        {/* La vista previa, a la derecha, se funde con el fondo de la app. Solo
            donde cabe sin meterse bajo el texto: más ancha, sus letras se
            cruzaban con la descripción. */}
        {src && (
          <div className="absolute inset-y-0 right-0 hidden w-[42%] xl:block" style={{ WebkitMaskImage: HERO_MASK, maskImage: HERO_MASK }} aria-hidden>
            {/* 2 px después del borde transparente de la máscara (ver HomeCards). */}
            <div className="absolute inset-y-0 left-0.5 right-0 overflow-hidden">
              {isVideo ? (
                <video src={src} autoPlay muted loop playsInline className="h-full w-full object-cover" />
              ) : (
                <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
              )}
            </div>
          </div>
        )}

        <div className="relative z-[1] px-6 pb-8 pt-4 md:px-8">
          <Button variant="ghost" size="sm" className="-ml-2 mb-4 rounded-full text-muted-foreground" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            {tr('Extensiones')}
          </Button>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ExtensionIcon id={row.id} manifest={manifest} className="h-24 w-24 shrink-0 rounded-3xl shadow-lg [&_svg]:h-11 [&_svg]:w-11" />
            <div className="min-w-0 max-w-xl space-y-1.5">
              <h1 className="truncate font-headline text-3xl font-bold text-primary" title={manifest.name}>
                {manifest.name}
              </h1>
              <p className="text-xs text-muted-foreground">
                {row.official ? tr('Oficial') : tr('De terceros · {author}', { author: manifest.author })}
                {' · '}
                {tr('Versión {version}', { version: manifest.version })}
                {entry && <> · {tr('Instalada el {date}', { date: new Date(entry.installedAt).toLocaleDateString() })}</>}
              </p>
              <p className="text-sm text-foreground/90">{manifest.description}</p>
              <label className="inline-flex cursor-pointer items-center gap-2.5 pt-1.5">
                <Switch
                  checked={on}
                  onCheckedChange={onToggle}
                  aria-label={on ? tr('Desactivar {name}', { name: manifest.name }) : tr('Activar {name}', { name: manifest.name })}
                  className="data-[state=unchecked]:bg-muted-foreground/30"
                />
                <span className={cn('text-xs font-semibold', on ? 'text-primary' : 'text-muted-foreground')}>{state}</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0 space-y-4">
          {on && Panel ? (
            <>
              <Panel id={row.id} manifest={manifest} />
              {row.id === WIRE && <WireSection />}
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              {entry ? tr('Desactivada: no hace nada y conserva sus ajustes.') : tr('Actívala para instalarla; antes verás los permisos que pide.')}
            </p>
          )}
        </section>

        <aside className="space-y-3 self-start rounded-xl border border-border/60 bg-card p-4">
          <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            {tr('Permisos')}
          </p>
          <ul className="space-y-2">
            {permissions.map((id) => (
              <li key={id} className="text-xs">
                <span className="font-semibold text-foreground">{PERMISSIONS[id]?.title() ?? id}</span>
                <span className="text-muted-foreground"> · {PERMISSIONS[id]?.detail()}</span>
              </li>
            ))}
            {permissions.length === 0 && <li className="text-xs text-muted-foreground">{tr('Ninguno.')}</li>}
          </ul>
          {(manifest.homepage || entry) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              {manifest.homepage && (
                <a href={manifest.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {tr('Página de la extensión')}
                </a>
              )}
              {entry && (
                <Button variant="ghost" size="sm" className="ml-auto text-destructive hover:text-destructive" onClick={onRemove}>
                  <Trash2 className="mr-2 h-4 w-4" />
                  {tr('Desinstalar')}
                </Button>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
