import { useCallback, useEffect, useState } from 'react';
import { FolderOpen, LoaderCircle, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExtensionIcon } from '@/components/extensions/ExtensionIcons';
import { useToast } from '@/hooks/use-toast';
import type { ExtensionManifest, MusicSourceContribution } from '@/lib/extensions/manifest';
import { pickSourceFolder, scanSourceFolder, sourceFolder } from '@/lib/extensions/native';
import type { PickedSource } from '@/lib/music-import';
import { errorText, tr } from '@/lib/i18n';

// ============================================================
// Música → Importar → Descargar (1.7.3): la página de un programa de
// descargas de ESTE equipo (una extensión de terceros, «fuente de música»),
// dentro de Frame.
//
// - La página va en un iframe con su propio origen (127.0.0.1:<puerto>): no
//   ve nada de Frame y Frame no ejecuta nada suyo.
// - Lo descargado no pasa por la página: el programa lo deja en su carpeta
//   (la elige el usuario una vez) y Frame lo trae de ahí con la importación
//   de siempre, que ya reconoce lo que estaba en la biblioteca.
// - Al cerrar, si en la carpeta hay canciones nuevas, se ofrece importarlas.
// ============================================================

type Status = 'checking' | 'up' | 'down';

/** ¿Responde el programa? Basta con que conteste (la respuesta no se lee). */
async function reachable(page: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 2500);
  try {
    await fetch(page, { mode: 'no-cors', cache: 'no-store', signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

export default function MusicSourceDialog({
  id,
  manifest,
  source,
  open,
  onOpenChange,
  onImport,
}: {
  id: string;
  manifest: ExtensionManifest;
  source: MusicSourceContribution;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lo que hay en la carpeta, para la importación de siempre (que descarta lo que ya estaba). */
  onImport: (picked: PickedSource, quiet: boolean) => void;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status>('checking');
  const [folder, setFolder] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Cambia para recargar la página cuando el programa vuelve a responder. */
  const [frameKey, setFrameKey] = useState(0);

  const check = useCallback(async () => {
    setStatus('checking');
    const up = await reachable(source.page);
    setStatus(up ? 'up' : 'down');
    if (up) setFrameKey((k) => k + 1);
  }, [source.page]);

  useEffect(() => {
    if (!open) return;
    void check();
    void sourceFolder(id).then(setFolder);
  }, [open, id, check]);

  const chooseFolder = async (): Promise<boolean> => {
    try {
      const name = await pickSourceFolder(id, source.folderHint);
      if (name) setFolder(name);
      return !!name;
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo elegir la carpeta'), description: errorText(error).slice(0, 160) });
      return false;
    }
  };

  /** Mira la carpeta y pasa lo que haya a la importación. */
  const bring = async (quiet: boolean) => {
    if (!folder && !(await chooseFolder())) return;
    setBusy(true);
    try {
      const picked = await scanSourceFolder(id);
      if (!picked) {
        setFolder(null);
        if (!quiet) toast({ variant: 'destructive', title: tr('La carpeta ya no está'), description: tr('Elige de nuevo dónde guarda las descargas.') });
        return;
      }
      onOpenChange(false);
      onImport(picked, quiet);
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo leer la carpeta'), description: errorText(error).slice(0, 160) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Al cerrar, si ya sabe dónde mirar, trae lo nuevo (sin avisar si no hay nada).
        if (!next && folder && !busy) void bring(true);
        else onOpenChange(next);
      }}
    >
      <DialogContent className="flex h-[88vh] max-w-5xl flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="flex-row items-center gap-3 space-y-0 pr-8">
          <ExtensionIcon id={id} manifest={manifest} />
          <div className="min-w-0 flex-1 text-left">
            <DialogTitle className="text-lg font-bold text-primary">{manifest.name}</DialogTitle>
            <DialogDescription className="text-xs">
              {source.label ?? tr('Busca una canción o sube una lista; lo que descargues llega a tu biblioteca.')}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-background">
          {status === 'up' ? (
            <iframe
              key={frameKey}
              src={source.page}
              title={manifest.name}
              // Su propio origen (127.0.0.1): no comparte nada con Frame.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
              referrerPolicy="no-referrer"
              className="h-full w-full"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              {status === 'checking' ? (
                <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <>
                  <p className="max-w-md text-sm text-foreground">
                    {tr('{name} no está abierto en este equipo. Ábrelo y pulsa «Reintentar».', { name: manifest.name })}
                  </p>
                  <Button variant="outline" onClick={() => void check()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    {tr('Reintentar')}
                  </Button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            {folder
              ? tr('Las descargas se traen de «{folder}».', { folder })
              : tr('Elige la carpeta donde {name} guarda las descargas.', { name: manifest.name })}
          </span>
          <Button size="sm" variant="ghost" className="h-8" onClick={() => void chooseFolder()}>
            {folder ? tr('Cambiar…') : tr('Elegir carpeta…')}
          </Button>
          <Button size="sm" className="h-8" onClick={() => void bring(false)} disabled={busy}>
            {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            {tr('Traer a Frame')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
