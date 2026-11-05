import { useEffect, useState, type ComponentType } from 'react';
import { FolderOpen, Music, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NotionImportDialog from '@/components/extensions/NotionImportDialog';
import { WirePanel } from '@/components/extensions/wire/WireViews';
import { AnimacionesPanel } from '@/components/extensions/animaciones/AnimacionesPanel';
import { AkLorePanel } from '@/components/extensions/AkLorePanel';
import { NotionLogo } from '@/components/extensions/ExtensionIcons';
import { useToast } from '@/hooks/use-toast';
import type { OfficialId } from '@/lib/extensions/catalog';
import type { ExtensionManifest } from '@/lib/extensions/manifest';
import { pickSourceFolder, sourceFolder } from '@/lib/extensions/native';
import { errorText, tr } from '@/lib/i18n';

// ============================================================
// Lo que cada extensión ofrece en Ajustes → Extensiones, una vez instalada
// y activa. Una oficial aparece en el catálogo cuando tiene aquí su panel.
// ============================================================

type PanelProps = { id: string; manifest: ExtensionManifest };

function NotionPanel() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <NotionLogo className="mr-2 h-4 w-4" />
          {tr('Importar de Notion…')}
        </Button>
        <span className="text-[11px] text-muted-foreground">{tr('Tareas o fechas de una base de datos exportada.')}</span>
      </div>
      <NotionImportDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

export const EXTENSION_PANELS: Partial<Record<OfficialId, ComponentType<PanelProps>>> = {
  'frame.notion': NotionPanel,
  'frame.wire': WirePanel,
  'frame.animaciones': AnimacionesPanel,
  'frame.aklore': AkLorePanel,
};

/** Carpeta de descargas de una fuente de música (se elige una vez, se cambia aquí). */
export function SourceFolderRow({ id, manifest }: PanelProps) {
  const { toast } = useToast();
  const [folder, setFolder] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void sourceFolder(id).then((name) => alive && setFolder(name));
    return () => {
      alive = false;
    };
  }, [id]);
  const choose = async () => {
    try {
      const name = await pickSourceFolder(id, manifest.contributes?.musicSource?.folderHint);
      if (name) setFolder(name);
    } catch (error) {
      toast({ variant: 'destructive', title: tr('No se pudo elegir la carpeta'), description: errorText(error).slice(0, 160) });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <FolderOpen className="h-4 w-4 text-primary" />
      {folder ? tr('Trae las descargas de «{folder}».', { folder }) : tr('Aún no sabe dónde guarda las descargas.')}
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void choose()}>
        {folder ? tr('Cambiar…') : tr('Elegir carpeta…')}
      </Button>
    </div>
  );
}

/** Extensiones de terceros: dicen dónde se usa lo que aportan. */
export function ThirdPartyPanel(props: PanelProps) {
  const c = props.manifest.contributes ?? {};
  return (
    <div className="space-y-2">
      {c.musicSource && (
        <>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Music className="h-4 w-4 text-primary" />
            {tr('Se usa en Música → Importar → Descargar.')}
          </p>
          <SourceFolderRow {...props} />
        </>
      )}
      {c.appearance && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Palette className="h-4 w-4 text-primary" />
          {tr('Se elige en la extensión Animaciones y en Ajustes → Color de acento.')}
        </p>
      )}
    </div>
  );
}
