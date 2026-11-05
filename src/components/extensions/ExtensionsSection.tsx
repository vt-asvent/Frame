import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { ExternalLink, FileUp, MoreHorizontal, ShieldCheck, Trash2 } from 'lucide-react';
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

// ============================================================
// Ajustes → Extensiones (1.7.3): el centro de extensiones.
//
// Arriba las instaladas (con su interruptor y lo que ofrecen); debajo el
// catálogo oficial que falta por instalar; «Instalar desde archivo» acepta el
// manifiesto de una de terceros (lib/extensions/manifest.ts). Cada oficial
// aparece aquí en cuanto tiene su panel (extension-panels.tsx).
// ============================================================

interface Pending {
  manifest: ExtensionManifest;
  official: boolean;
  previous: ExtensionManifest | null;
}

export default function ExtensionsSection() {
  const { userProfile } = useCourse();
  const { toast } = useToast();
  const installed = useInstalledExtensions();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [removing, setRemoving] = useState<InstalledExtension | null>(null);
  const [details, setDetails] = useState<InstalledExtension | null>(null);
  const [domainHash, setDomainHash] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const location = useLocation();

  // «Ir a Extensiones» (desde Música → Descargar) llega con #extensiones.
  useEffect(() => {
    if (location.hash === '#extensiones') sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash]);

  useEffect(() => {
    let alive = true;
    void domainHashOf(userProfile?.email).then((hash) => alive && setDomainHash(hash));
    return () => {
      alive = false;
    };
  }, [userProfile?.email]);

  /** Oficiales que este usuario puede ver (las de un colegio, solo con su cuenta). */
  const available = useMemo(
    () => OFFICIAL_EXTENSIONS.filter((e) => EXTENSION_PANELS[e.id] && (!e.domainHash || e.domainHash === domainHash)),
    [domainHash]
  );
  const notInstalled = available.filter((e) => !installed.some((i) => i.id === e.id));
  const shown = installed.filter((e) => {
    const official = OFFICIAL_EXTENSIONS.find((o) => o.id === e.id);
    return !official || available.includes(official);
  });

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
    toast({
      title: pending.previous ? tr('{name} actualizada', { name: pending.manifest.name }) : tr('{name} instalada', { name: pending.manifest.name }),
    });
    setPending(null);
  };

  const remove = async () => {
    if (!removing) return;
    const name = manifestOf(removing)?.name ?? removing.id;
    setRemoving(null);
    await uninstallExtension(removing.id);
    toast({ title: tr('{name} desinstalada', { name }), description: tr('No quedó nada suyo en este equipo.') });
  };

  return (
    <section ref={sectionRef} id="extensiones" className="rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-primary">{tr('Extensiones')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {tr('Añaden funciones a Frame en este equipo. Se desactivan o se quitan cuando quieras, sin dejar rastro.')}
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.frame-ext,application/json"
          className="hidden"
          onChange={(e) => void onFile(e.target.files)}
        />
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title={tr('Extensiones de terceros: un archivo .json')}>
          <FileUp className="mr-2 h-4 w-4" />
          {tr('Instalar desde archivo…')}
        </Button>
      </div>

      {shown.length > 0 && (
        <ul className="mt-4 grid gap-3 xl:grid-cols-2">
          {shown.map((entry) => {
            const manifest = manifestOf(entry);
            if (!manifest) return null;
            const Panel: ComponentType<{ id: string; manifest: ExtensionManifest }> | undefined =
              EXTENSION_PANELS[entry.id as OfficialId] ?? (entry.manifest ? ThirdPartyPanel : undefined);
            return (
              <li key={entry.id} className="flex flex-col gap-3 rounded-lg border border-border/60 p-3">
                <div className="flex items-start gap-3">
                  <ExtensionIcon id={entry.id} manifest={manifest} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold text-foreground">
                      {manifest.name}
                      <span className={cn('text-[10px] font-bold', entry.manifest ? 'text-muted-foreground' : 'text-primary')}>
                        {entry.manifest ? tr('De terceros · {author}', { author: manifest.author }) : tr('Oficial')}
                      </span>
                    </p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">{manifest.description}</p>
                  </div>
                  <Switch
                    checked={entry.enabled}
                    onCheckedChange={(on) => setExtensionEnabled(entry.id, on)}
                    aria-label={entry.enabled ? tr('Desactivar {name}', { name: manifest.name }) : tr('Activar {name}', { name: manifest.name })}
                    className="mt-1 data-[state=unchecked]:bg-muted-foreground/30"
                  />
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={tr('Más opciones de {name}', { name: manifest.name })}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDetails(entry)}>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        {tr('Permisos y detalles')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRemoving(entry)} className="text-destructive focus:text-destructive">
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tr('Desinstalar')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {entry.enabled && Panel ? (
                  <Panel id={entry.id} manifest={manifest} />
                ) : !entry.enabled ? (
                  <p className="text-xs text-muted-foreground">{tr('Desactivada: no hace nada y conserva sus ajustes.')}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {notInstalled.length > 0 && (
        <>
          <p className="mb-2 mt-5 text-xs font-bold text-muted-foreground">{tr('Catálogo de Asvent')}</p>
          <ul className="grid gap-3 xl:grid-cols-2">
            {notInstalled.map((entry) => {
              const manifest = entry.manifest();
              return (
                <li key={entry.id} className="flex items-start gap-3 rounded-lg border border-dashed border-border p-3">
                  <ExtensionIcon id={entry.id} manifest={manifest} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{manifest.name}</p>
                    <p className="text-xs text-muted-foreground">{manifest.description}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {manifest.permissions.map((p) => PERMISSIONS[p].title()).join(' · ')}
                    </p>
                  </div>
                  <Button size="sm" onClick={() => setPending({ manifest, official: true, previous: null })}>
                    {tr('Instalar')}
                  </Button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <ExtensionInstallDialog
        manifest={pending?.manifest ?? null}
        official={pending?.official ?? false}
        previous={pending?.previous}
        onCancel={() => setPending(null)}
        onAccept={accept}
      />

      <AlertDialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
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

      <Dialog open={!!details} onOpenChange={(open) => !open && setDetails(null)}>
        <DialogContent className="sm:max-w-md">
          {details && (() => {
            const manifest = manifestOf(details);
            if (!manifest) return null;
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="text-primary">{manifest.name}</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground">
                  {tr('Versión {version} · {author}', { version: manifest.version, author: manifest.author })}
                  {' · '}
                  {tr('Instalada el {date}', { date: new Date(details.installedAt).toLocaleDateString() })}
                </p>
                <p className="text-sm">{manifest.description}</p>
                <ul className="space-y-2">
                  {details.granted.map((id) => (
                    <li key={id} className="rounded-lg border border-border/60 px-3 py-2">
                      <p className="text-sm font-semibold">{PERMISSIONS[id]?.title() ?? id}</p>
                      <p className="text-xs text-muted-foreground">{PERMISSIONS[id]?.detail()}</p>
                    </li>
                  ))}
                </ul>
                {manifest.homepage && (
                  <a href={manifest.homepage} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" />
                    {tr('Página de la extensión')}
                  </a>
                )}
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </section>
  );
}
