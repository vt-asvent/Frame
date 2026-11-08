import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import { PERMISSIONS, type ExtensionManifest } from '@/lib/extensions/manifest';
import { catalogApp } from '@/lib/extensions/remote-catalog';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// «Instalar» una extensión: quién la hace, qué aporta y QUÉ PERMISOS pide.
// Se instala solo si el usuario los acepta aquí. Al actualizar una de
// terceros, los permisos nuevos se marcan.
// ============================================================

export default function ExtensionInstallDialog({
  manifest,
  official,
  previous,
  onCancel,
  onAccept,
}: {
  manifest: ExtensionManifest | null;
  official: boolean;
  /** La versión instalada, si es una actualización. */
  previous?: ExtensionManifest | null;
  onCancel: () => void;
  onAccept: () => void;
}) {
  const fresh = new Set(previous ? manifest?.permissions.filter((p) => !previous.permissions.includes(p)) : []);
  // Del catálogo y con programa (1.9.0): Frame lo instala y lo mantiene al día.
  const app = manifest ? catalogApp(manifest.id) : null;
  return (
    <Dialog open={!!manifest} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        {manifest && (
          <>
            <DialogHeader className="items-center text-center">
              <ExtensionIcon id={manifest.id} manifest={manifest} className="h-12 w-12 [&>svg]:h-7 [&>svg]:w-7" />
              <DialogTitle className="pt-2 text-xl font-bold text-primary">
                {previous ? tr('Actualizar {name}', { name: manifest.name }) : tr('Instalar {name}', { name: manifest.name })}
              </DialogTitle>
              <DialogDescription>
                {previous
                  ? tr('De la versión {from} a la {to} · {author}', { from: previous.version, to: manifest.version, author: manifest.author })
                  : tr('Versión {version} · {author}', { version: manifest.version, author: manifest.author })}
              </DialogDescription>
            </DialogHeader>

            <p className="text-sm text-foreground">{manifest.description}</p>

            {official ? (
              <p className="flex items-start gap-2 rounded-lg bg-primary/10 p-3 text-xs text-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                {tr('Extensión oficial de Asvent: viene dentro de Frame.')}
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-foreground">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                {app
                  ? tr('No es de Asvent. Frame usa los datos de este archivo, con los permisos de abajo, y solo instala su programa si viene firmado por su autor.')
                  : tr('No es de Asvent. Frame no ejecuta nada suyo: solo usa los datos de este archivo, con los permisos de abajo.')}
              </p>
            )}

            <div>
              <p className="mb-2 text-xs font-bold text-muted-foreground">{tr('Podrá:')}</p>
              <ul className="space-y-2">
                {manifest.permissions.map((id) => (
                  <li key={id} className={cn('rounded-lg border border-border/60 px-3 py-2', fresh.has(id) && 'border-primary/50 bg-primary/5')}>
                    <p className="text-sm font-semibold text-foreground">
                      {PERMISSIONS[id].title()}
                      {fresh.has(id) && <span className="ml-2 text-[10px] font-bold uppercase text-primary">{tr('Nuevo')}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{PERMISSIONS[id].detail()}</p>
                  </li>
                ))}
                {app && (
                  <li className={cn('rounded-lg border border-border/60 px-3 py-2', !previous?.contributes?.musicSource?.app && previous && 'border-primary/50 bg-primary/5')}>
                    <p className="text-sm font-semibold text-foreground">{tr('Instalar y mantener al día su programa')}</p>
                    <p className="text-xs text-muted-foreground">
                      {tr('Frame descarga su programa de su página oficial, comprueba la firma de su autor y lo instala en este equipo, sin permisos de administrador. Después lo abre y lo actualiza solo.')}
                    </p>
                  </li>
                )}
              </ul>
            </div>

            <p className="text-[11px] text-muted-foreground">
              {tr('Puedes desactivarla o desinstalarla cuando quieras. Al desinstalarla se borra todo lo que guardó en este equipo; lo que trajo a Frame se queda.')}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onCancel}>
                {tr('Cancelar')}
              </Button>
              <Button onClick={onAccept}>{previous ? tr('Aceptar y actualizar') : tr('Aceptar e instalar')}</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
