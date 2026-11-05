import { useRef, useState } from 'react';
import { Download, FileAudio, FolderOpen, FolderInput, LoaderCircle, Puzzle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { EchoHeader } from '@/components/shared/EchoWord';
import MusicSourceDialog from '@/components/extensions/MusicSourceDialog';
import { useContributions } from '@/lib/extensions/store';
import { useCourse } from '@/context/CourseContext';
import { useToast } from '@/hooks/use-toast';
import {
  formatBytes,
  pickMusic,
  planMusicImport,
  releasePickedMusic,
  storeImportedSongs,
  type ImportOutcome,
  type MusicImportPlan,
  type PickedSource,
} from '@/lib/music-import';
import { errorText, tr } from '@/lib/i18n';

// ============================================================
// Botón «Importar» de Música (ver lib/music-import.ts). Desde la 1.7.3
// pregunta de dónde:
//   · «Archivos locales»: canciones sueltas o una carpeta entera, con el
//     explorador de Windows (lo de siempre);
//   · «Descargar»: la página de un programa de descargas de este equipo, que
//     aporta una extensión «fuente de música» (Ajustes → Extensiones). Lo
//     que descarga se trae de su carpeta con esta misma importación.
// ============================================================

type Stage = 'idle' | 'reading' | 'confirm' | 'importing' | 'done';

export default function MusicImportButton({ variant = 'button' }: { variant?: 'button' | 'empty' }) {
  const { songs, addSongs, mergePlaylistSongs } = useCourse();
  const { toast } = useToast();
  const navigate = useNavigate();
  const sources = useContributions('musicSource');
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [noSource, setNoSource] = useState(false);
  const activeSource = sources.find((s) => s.id === sourceId) ?? null;
  const [stage, setStage] = useState<Stage>('idle');
  const [plan, setPlan] = useState<MusicImportPlan | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, title: '' });
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const stopRef = useRef(false);

  const finish = () => {
    void releasePickedMusic();
    setStage('idle');
    setPlan(null);
    setOutcome(null);
  };

  const choose = async (folder: boolean) => {
    try {
      const source = await pickMusic(folder);
      if (!source) return;
      await importFrom(source, false);
    } catch (error) {
      void releasePickedMusic();
      setStage('idle');
      toast({ variant: 'destructive', title: tr('No se pudo abrir'), description: errorText(error).slice(0, 160) });
    }
  };

  /** Planifica lo elegido (o lo que dejó una fuente de descargas) y pide confirmar. */
  const importFrom = async (source: PickedSource, quiet: boolean) => {
    try {
      setStage('reading');
      const next = await planMusicImport(source, songs);
      if (next.entries.length === 0) {
        void releasePickedMusic();
        setStage('idle');
        // Al cerrar «Descargar» sin bajar nada: no hay nada que decir.
        if (quiet) return;
        const formats = formatsOf(next.unsupported);
        toast({
          title: next.existing.size > 0 ? tr('Ya tienes esas canciones') : tr('No hay canciones que Frame pueda reproducir'),
          description:
            next.existing.size > 0
              ? tr('Todo lo elegido ya estaba en tu biblioteca.')
              : next.unsupported.length > 0
                ? tr('Lo elegido está en {formats}, que Frame no reproduce. Frame importa MP3, M4A, AAC, OGG, Opus, FLAC, WAV y WebM.', { formats })
                : tr('Frame importa MP3, M4A, AAC, OGG, Opus, FLAC, WAV y WebM.'),
        });
        return;
      }
      setPlan(next);
      setStage('confirm');
    } catch (error) {
      void releasePickedMusic();
      setStage('idle');
      toast({ variant: 'destructive', title: tr('No se pudo abrir'), description: errorText(error).slice(0, 160) });
    }
  };

  const run = async () => {
    if (!plan) return;
    stopRef.current = false;
    setStage('importing');
    setProgress({ done: 0, total: plan.entries.length, title: '' });
    // Si guardar falla (disco lleno), el recuadro vuelve a «confirmar»: antes
    // se quedaba en «importando» para siempre y no había forma de cerrarlo.
    try {
      const result = await storeImportedSongs(
        plan,
        songs,
        (done, total, title) => setProgress({ done, total, title }),
        (batch) => addSongs(batch),
        () => stopRef.current
      );
      for (const playlist of plan.playlists) mergePlaylistSongs(playlist.name, playlist.songIds);
      setOutcome(result);
      setStage('done');
    } catch (error) {
      setStage('confirm');
      toast({
        variant: 'destructive',
        title: tr('La importación se detuvo'),
        description: tr('{error} Vuelve a intentarlo: lo ya importado no se repite.', { error: errorText(error) }),
        duration: 12000,
      });
    }
  };

  const formatsOf = (list: { format: string }[]) => [...new Set(list.map((file) => file.format))].join(', ');

  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <>
      {/* No modal: abrir el menú no bloquea el resto de la pantalla. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          {variant === 'empty' ? (
            <Button className="mt-2">
              <FolderInput className="mr-2 h-4 w-4" />
              {tr('Importar música')}
            </Button>
          ) : (
            <Button title={tr('Importar canciones o una carpeta de tu equipo')}>
              <FolderInput className="h-4 w-4" />
              {tr('Importar')}
            </Button>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs text-muted-foreground">{tr('Archivos locales')}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => void choose(false)}>
            <FileAudio className="mr-2 h-4 w-4 text-primary" />
            <span className="flex flex-col">
              {tr('Canciones…')}
              <span className="text-[11px] text-muted-foreground">{tr('Con sus letras y portadas, si las tienes')}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void choose(true)}>
            <FolderOpen className="mr-2 h-4 w-4 text-primary" />
            <span className="flex flex-col">
              {tr('Una carpeta…')}
              <span className="text-[11px] text-muted-foreground">{tr('Con todas sus subcarpetas')}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs text-muted-foreground">{tr('Descargar')}</DropdownMenuLabel>
          {sources.length > 0 ? (
            sources.map((source) => (
              <DropdownMenuItem key={source.id} onSelect={() => setSourceId(source.id)}>
                <Download className="mr-2 h-4 w-4 text-primary" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{source.manifest.name}…</span>
                  <span className="text-[11px] text-muted-foreground">
                    {source.value.label ?? tr('Busca una canción o sube una lista')}
                  </span>
                </span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem onSelect={() => setNoSource(true)}>
              <Download className="mr-2 h-4 w-4 text-primary" />
              <span className="flex flex-col">
                {tr('Buscar y descargar…')}
                <span className="text-[11px] text-muted-foreground">{tr('Con una extensión de descargas')}</span>
              </span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeSource && (
        <MusicSourceDialog
          id={activeSource.id}
          manifest={activeSource.manifest}
          source={activeSource.value}
          open={!!activeSource}
          onOpenChange={(open) => !open && setSourceId(null)}
          onImport={(picked, quiet) => void importFrom(picked, quiet)}
        />
      )}

      <Dialog open={noSource} onOpenChange={setNoSource}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl font-bold text-primary">{tr('Descargar música')}</DialogTitle>
            <DialogDescription className="text-center">
              {tr('Para buscar canciones o subir una lista y descargarlas, instala una extensión de descargas: un programa de este equipo que trae su archivo de extensión para Frame.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-center">
            <Button
              onClick={() => {
                setNoSource(false);
                navigate('/settings#extensiones');
              }}
            >
              <Puzzle className="mr-2 h-4 w-4" />
              {tr('Ir a Extensiones')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={stage !== 'idle'} onOpenChange={(open) => !open && stage !== 'importing' && stage !== 'reading' && finish()}>
        <DialogContent className="sm:max-w-md">
          <EchoHeader word={tr('Importar')}>
            <DialogHeader>
              <DialogTitle className="text-center text-xl font-bold text-primary">{tr('Importar música')}</DialogTitle>
              <DialogDescription className="text-center">
                {stage === 'reading' && tr('Leyendo lo que elegiste…')}
                {stage === 'confirm' && plan && tr('Desde «{name}».', { name: plan.source.name })}
                {stage === 'importing' && tr('Copiando tus canciones dentro de Frame…')}
                {stage === 'done' && tr('Listo.')}
              </DialogDescription>
            </DialogHeader>
          </EchoHeader>

          {stage === 'reading' && (
            <div className="flex justify-center py-6">
              <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            </div>
          )}

          {stage === 'confirm' && plan && (
            <div className="space-y-2 py-2 text-sm">
              <p>
                <span className="font-bold text-foreground">{plan.entries.length}</span>{' '}
                {plan.entries.length === 1 ? tr('canción nueva') : tr('canciones nuevas')} · {formatBytes(plan.bytes)}
              </p>
              {plan.existing.size > 0 && (
                <p className="text-muted-foreground">
                  {plan.existing.size === 1
                    ? tr('1 ya estaba en tu biblioteca: no se duplica.')
                    : tr('{count} ya estaban en tu biblioteca: no se duplican.', { count: plan.existing.size })}
                </p>
              )}
              {plan.lyricFiles > 0 && (
                <p className="text-muted-foreground">
                  {plan.lyricFiles === 1
                    ? tr('1 trae su letra en un archivo aparte.')
                    : tr('{count} traen su letra en un archivo aparte.', { count: plan.lyricFiles })}
                </p>
              )}
              {plan.playlists.length > 0 && (
                <p className="text-muted-foreground">
                  {plan.playlists.length === 1 ? tr('También su playlist.') : tr('También sus {count} playlists.', { count: plan.playlists.length })}
                </p>
              )}
              {plan.unsupported.length > 0 && (
                <p className="text-muted-foreground">
                  {plan.unsupported.length === 1
                    ? tr('1 archivo queda fuera: está en {formats}, que Frame no reproduce.', { formats: formatsOf(plan.unsupported) })
                    : tr('{count} archivos quedan fuera: están en {formats}, que Frame no reproduce.', { count: plan.unsupported.length, formats: formatsOf(plan.unsupported) })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {tr('Se copian dentro de Frame: después puedes mover o borrar los archivos originales.')}
              </p>
            </div>
          )}

          {stage === 'importing' && (
            <div className="space-y-2 py-2">
              <Progress value={percent} />
              <p className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span className="truncate">{progress.title}</span>
                <span className="shrink-0 tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              </p>
            </div>
          )}

          {stage === 'done' && outcome && (
            <div className="space-y-1.5 py-2 text-sm">
              <p>
                <span className="font-bold text-foreground">{outcome.imported}</span>{' '}
                {outcome.imported === 1 ? tr('canción importada') : tr('canciones importadas')}
                {outcome.cancelled && tr(' (cancelaste el resto)')}
              </p>
              {outcome.imported > 0 && (
                <p className="text-xs text-muted-foreground">
                  {outcome.covers}{' '}{tr('con portada ·')}{' '}{outcome.lyrics}{' '}{tr('con letra')}
                </p>
              )}
              {outcome.stoppedFor && (
                <p className="text-xs text-destructive">{tr('Se detuvo porque')}{' '}{outcome.stoppedFor}.</p>
              )}
              {outcome.skipped.length > 0 && (
                <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    {outcome.skipped.length === 1 ? tr('Una no entró:') : tr('{length} no entraron:', { length: outcome.skipped.length })}
                  </p>
                  <ul className="max-h-32 space-y-0.5 overflow-y-auto">
                    {outcome.skipped.slice(0, 50).map((item, index) => (
                      <li key={`${item.name}-${index}`} className="truncate" title={`${item.name}: ${item.reason}`}>
                        {tr('«{name}»: {reason}', { name: item.name, reason: item.reason })}
                      </li>
                    ))}
                  </ul>
                  {outcome.skipped.length > 50 && <p>{tr('y {count} más.', { count: outcome.skipped.length - 50 })}</p>}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {stage === 'confirm' && (
              <>
                <Button variant="gris" onClick={finish}>
                  {tr('Cancelar')}
                </Button>
                <Button onClick={() => void run()}>{tr('Importar')}</Button>
              </>
            )}
            {stage === 'importing' && (
              <Button variant="gris" onClick={() => (stopRef.current = true)}>
                {tr('Detener')}
              </Button>
            )}
            {stage === 'done' && <Button onClick={finish}>{tr('Cerrar')}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
