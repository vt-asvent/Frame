import { useCallback } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { blobToBase64, browserDownload, folderOf } from '@/lib/file-save';
import { errorText, tr } from '@/lib/i18n';

// ============================================================
// «Descargar una copia» de un adjunto o del archivo de una anotación (1.6.7).
//
// La escribe Frame en Descargas, no la descarga del motor web: su aviso sale
// en el idioma de Windows y no dice dónde quedó el archivo. El aviso de Frame
// sí lo dice, y trae «Mostrar» para verlo en su carpeta.
// ============================================================

/** `source`: el archivo, o su data URL. Devuelve si la copia quedó guardada. */
export function useSaveCopy() {
  const { toast } = useToast();

  return useCallback(
    async (source: Blob | string, fileName: string): Promise<boolean> => {
      if (!isTauri()) {
        if (typeof source !== 'string') {
          browserDownload(source, fileName);
          return true;
        }
        const link = document.createElement('a');
        link.href = source;
        link.download = fileName;
        link.click();
        return true;
      }
      try {
        const dataBase64 = typeof source === 'string' ? source.split(',')[1] ?? '' : await blobToBase64(source);
        const path = await invoke<string>('save_file_copy', { fileName, dataBase64 });
        const savedName = path.split(/[\\/]/).pop() || fileName;
        toast({
          title: tr('Copia guardada'),
          description: tr('{savedName} · guardado en {folderOf}', { savedName, folderOf: folderOf(path) }),
          duration: 10000,
          action: (
            <ToastAction altText={tr('Mostrar en su carpeta')} onClick={() => void invoke('reveal_recording', { path }).catch(() => undefined)}>
              {tr('Mostrar')}
            </ToastAction>
          ),
        });
        return true;
      } catch (error) {
        toast({ variant: 'destructive', title: tr('No se pudo guardar la copia'), description: errorText(error) });
        return false;
      }
    },
    [toast]
  );
}
