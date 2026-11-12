import { useEffect, useMemo, useState } from 'react';
import { Check, Download, LoaderCircle, RotateCcw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useSaveCopy } from '@/hooks/use-save-copy';
import { useToast } from '@/hooks/use-toast';
import { answerCard, cardsCsv, cardsDue, fetchCards, fileNameOf, resetCards, useStudy, type BibItem, type CardSet } from '@/lib/extensions/aklore/biblioteca';
import { errorText, tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Tarjetas de estudio de un archivo (1.9.7). Se repasan aquí, por cajas
// (Leitner): «La sé» la manda más lejos; «Repasar» la trae mañana. El avance
// es de la cuenta y viaja con ella. Se descargan en CSV (frente, reverso),
// que Anki y Quizlet importan.
// ============================================================

export default function StudyCardsDialog({ item, color, onClose }: { item: BibItem | null; color: string; onClose: () => void }) {
  const [set, setSet] = useState<CardSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const study = useStudy();
  const saveCopy = useSaveCopy();
  const { toast } = useToast();
  /** Las tarjetas de esta vuelta (se fijan al empezar: responder no las reordena). */
  const [round, setRound] = useState<number[] | null>(null);
  const [at, setAt] = useState(0);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    setSet(null);
    setError(null);
    setRound(null);
    setAt(0);
    setFlipped(false);
    if (!item) return;
    let alive = true;
    fetchCards(item)
      .then((s) => alive && setSet(s))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [item]);

  const progress = useMemo(() => (set ? cardsDue(set, study) : null), [set, study]);
  useEffect(() => {
    if (set && progress && round === null) setRound(progress.due.map((c) => c.id));
  }, [set, progress, round]);

  if (!item) return null;
  const card = set && round && at < round.length ? set.tarjetas.find((c) => c.id === round[at]) : null;
  const finished = !!set && !!round && at >= round.length;

  const answer = (knew: boolean) => {
    if (!set || !card) return;
    if (!answerCard(set.de, card.id, knew)) toast({ variant: 'destructive', title: tr('No se pudo guardar tu avance'), description: tr('No hay espacio en el equipo para guardarlo.') });
    setFlipped(false);
    setAt((n) => n + 1);
  };

  const download = async () => {
    if (!set) return;
    await saveCopy(new Blob([cardsCsv(set)], { type: 'text/csv;charset=utf-8' }), fileNameOf({ ...item, title: tr('Tarjetas de {titulo}', { titulo: set.titulo }), ext: 'csv' }));
  };

  const again = () => {
    resetCards(set!.de);
    setRound(set!.tarjetas.map((c) => c.id));
    setAt(0);
    setFlipped(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-w-xl flex-col">
        <DialogHeader>
          <DialogTitle className="pr-6">{set?.titulo ?? item.title}</DialogTitle>
          <DialogDescription>
            {set && progress
              ? tr('{n} tarjetas · dominas {known} · hoy tocan {due}', { n: set.tarjetas.length, known: progress.known, due: progress.due.length })
              : tr('Tarjetas de estudio')}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !set || !round ? (
          <div className="flex h-56 items-center justify-center">
            <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : finished || !card ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border border-border/60 p-6 text-center">
            <Check className="h-8 w-8 text-emerald-500" />
            <p className="font-semibold">{round.length ? tr('Terminaste el repaso de hoy') : tr('Hoy no te toca ninguna')}</p>
            <p className="text-sm text-muted-foreground">{tr('Las que marcaste para repasar vuelven mañana; las que sabes, en unos días.')}</p>
            <Button variant="outline" onClick={again}>
              <RotateCcw className="mr-2 h-4 w-4" />
              {tr('Repasar todas desde cero')}
            </Button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setFlipped((f) => !f)}
              className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-xl border-2 p-6 text-center transition-colors hover:bg-muted/40"
              style={{ borderColor: color }}
              aria-label={flipped ? tr('Ver la pregunta') : tr('Ver la respuesta')}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {flipped ? tr('Respuesta') : tr('Pregunta')} · {at + 1}/{round.length}
              </span>
              <span className={cn('whitespace-pre-line leading-relaxed', flipped ? 'text-base' : 'text-lg font-semibold')}>{flipped ? card.reverso : card.frente}</span>
              {!flipped && <span className="text-xs text-muted-foreground">{tr('Toca para ver la respuesta')}</span>}
              {flipped && card.pagina && <span className="text-xs text-muted-foreground">{tr('Página {n} del documento', { n: card.pagina })}</span>}
            </button>
            <div className="flex flex-wrap justify-center gap-2">
              {flipped ? (
                <>
                  <Button variant="outline" onClick={() => answer(false)}>
                    <Undo2 className="mr-2 h-4 w-4" />
                    {tr('Repasar')}
                  </Button>
                  <Button onClick={() => answer(true)}>
                    <Check className="mr-2 h-4 w-4" />
                    {tr('La sé')}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setFlipped(true)}>
                  {tr('Ver la respuesta')}
                </Button>
              )}
            </div>
          </>
        )}
        {set && (
          <div className="flex justify-end border-t border-border/60 pt-3">
            <Button variant="ghost" size="sm" onClick={() => void download()}>
              <Download className="mr-2 h-4 w-4" />
              {tr('Descargar las tarjetas (CSV)')}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
