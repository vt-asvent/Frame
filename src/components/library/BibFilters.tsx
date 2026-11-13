import { useState, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SIN_FILTROS, TIPO_LABEL, avanzadosPuestos, type BibFiltros, type BibPrograma } from '@/lib/extensions/aklore/biblioteca';
import { tr } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// ============================================================
// Biblioteca → los filtros de la barra (1.9.9, Diego):
//
//   [ Nivel ▾ ]  dos pasos: el grupo (Troncales, NM, NS) y, enseguida, una de
//                sus asignaturas; el botón dice «NS / Historia».
//   [ Año ▾ ]    convocatoria (mayo, noviembre) y uno o varios años.
//   [ ⚙ ]        filtros avanzados, en un recuadro grande al centro.
//
// Los grupos, las asignaturas y las pruebas salen de la configuración de la
// carpeta; aquí solo se pintan.
// ============================================================

export const FILTER_BUTTON =
  'inline-flex h-10 max-w-[16rem] items-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Botón cuadrado de la barra; pulsado (`aria-pressed`), con el color del acento. */
export const SQUARE_BUTTON =
  'relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-input bg-card text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-primary';

const ROW = 'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent';

function Row({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick} className={ROW}>
      <Check className={cn('h-4 w-4 shrink-0', on ? 'opacity-100' : 'opacity-0')} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

/** El grupo y, dentro de él, la asignatura. `subjects`: las que tienen archivos. */
export function LevelPicker({
  programa,
  grupo,
  asignatura,
  subjects,
  onChoose,
}: {
  programa: BibPrograma;
  grupo: string | null;
  asignatura: string | null;
  subjects: ReadonlySet<string>;
  onChoose: (next: { grupo: string | null; asignatura: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  // Qué paso se ve: los grupos o las asignaturas del grupo elegido.
  const [step, setStep] = useState<'grupos' | 'asignaturas'>('grupos');
  const group = programa.grupos.find((g) => g.nombre === grupo) ?? null;
  const inGroup = (group?.asignaturas ?? []).filter((name) => subjects.has(name));
  const label = tr(programa.etiqueta ?? 'Asignaturas');
  const done = (next: { grupo: string | null; asignatura: string | null }) => {
    onChoose(next);
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setStep(group && inGroup.length > 1 ? 'asignaturas' : 'grupos');
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" aria-label={label} className={FILTER_BUTTON}>
          <span className="truncate">{group ? (asignatura ? `${tr(group.nombre)} / ${asignatura}` : tr(group.nombre)) : label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-80 w-64 overflow-y-auto p-1" role="menu">
        {step === 'grupos' || !group ? (
          <>
            <Row on={!group} onClick={() => done({ grupo: null, asignatura: null })}>
              {tr('Todo')}
            </Row>
            <div className="my-1 h-px bg-border" />
            {programa.grupos.map((g) => {
              const present = g.asignaturas.filter((name) => subjects.has(name));
              return (
                <Row
                  key={g.nombre}
                  on={g.nombre === grupo}
                  onClick={() => {
                    // Un grupo de una sola asignatura (un curso) se abre directamente; los demás pasan a elegirla.
                    if (present.length <= 1) return done({ grupo: g.nombre, asignatura: present[0] ?? null });
                    onChoose({ grupo: g.nombre, asignatura: null });
                    setStep('asignaturas');
                  }}
                >
                  {tr(g.nombre)}
                </Row>
              );
            })}
          </>
        ) : (
          <>
            <button type="button" onClick={() => setStep('grupos')} className={cn(ROW, 'font-semibold')}>
              <ArrowLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">{tr(group.nombre)}</span>
            </button>
            <div className="my-1 h-px bg-border" />
            <Row on={!asignatura} onClick={() => done({ grupo: group.nombre, asignatura: null })}>
              {tr('Todas')}
            </Row>
            {inGroup.map((name) => (
              <Row key={name} on={name === asignatura} onClick={() => done({ grupo: group.nombre, asignatura: name })}>
                {name}
              </Row>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-foreground hover:bg-muted'
      )}
    >
      {children}
    </button>
  );
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

const MESES: [string, string][] = [
  ['05', 'Mayo'],
  ['11', 'Noviembre'],
];

/** Convocatoria y año. `years`: los que hay, del más reciente al más antiguo. */
export function YearPicker({ filtros, years, onChange }: { filtros: BibFiltros; years: string[]; onChange: (next: BibFiltros) => void }) {
  const months = MESES.filter(([id]) => filtros.meses.includes(id)).map(([, name]) => tr(name));
  const chosen = [...filtros.anios].sort();
  const parts = [months.join(' · '), chosen.length > 3 ? tr('{n} años', { n: chosen.length }) : chosen.join(', ')].filter(Boolean);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={tr('Convocatoria y año')} className={FILTER_BUTTON}>
          <span className="truncate">{parts.length ? parts.join(' · ') : tr('Año')}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{tr('Convocatoria')}</p>
        <div className="flex flex-col gap-1.5">
          {MESES.map(([id, name]) => (
            <Row key={id} on={filtros.meses.includes(id)} onClick={() => onChange({ ...filtros, meses: toggle(filtros.meses, id) })}>
              {tr(name)}
            </Row>
          ))}
        </div>
        <div className="my-3 h-px bg-border" />
        <p className="mb-2 text-xs font-semibold text-muted-foreground">{tr('Año')}</p>
        <div className="flex max-h-44 flex-wrap gap-1.5 overflow-y-auto">
          {years.map((year) => (
            <Chip key={year} on={filtros.anios.includes(year)} onClick={() => onChange({ ...filtros, anios: toggle(filtros.anios, year) })}>
              {year}
            </Chip>
          ))}
        </div>
        {parts.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={() => onChange({ ...filtros, meses: [], anios: [] })}>
            {tr('Quitar')}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Los grupos de filtros avanzados: qué lista de `BibFiltros` tocan y sus opciones (valor y texto en español). */
const AVANZADOS: { campo: 'origen' | 'programa' | 'tarjetas' | 'idioma' | 'formato'; titulo: string; opciones: [string, string][] }[] = [
  {
    campo: 'origen',
    titulo: 'Material',
    opciones: [
      ['colegio', 'Interno (del colegio)'],
      ['IB', 'Externo (del IB)'],
      ['otros', 'Externo (otras fuentes)'],
      ['IA', 'Hecho con IA'],
    ],
  },
  {
    campo: 'programa',
    titulo: 'Programa',
    opciones: [
      ['vigente', 'Vigente'],
      ['anterior', 'No vigente'],
    ],
  },
  {
    campo: 'tarjetas',
    titulo: 'Tarjetas de estudio',
    opciones: [
      ['con', 'Con tarjetas'],
      ['sin', 'Sin tarjetas'],
    ],
  },
  {
    campo: 'idioma',
    titulo: 'Idioma',
    opciones: [
      ['es', 'Español'],
      ['en', 'Inglés'],
    ],
  },
  {
    campo: 'formato',
    titulo: 'Formato',
    opciones: [
      ['pdf', 'PDF'],
      ['audio', 'Audio'],
      ['video', 'Vídeo'],
      ['otros', 'Otros'],
    ],
  },
];

/** El botón cuadrado de los filtros avanzados y su recuadro, grande y al centro. `tipos`: las clases de material que hay. */
export function AdvancedFilters({ filtros, tipos, onChange }: { filtros: BibFiltros; tipos: string[]; onChange: (next: BibFiltros) => void }) {
  const [open, setOpen] = useState(false);
  const count = avanzadosPuestos(filtros);
  return (
    <>
      <button type="button" className={SQUARE_BUTTON} aria-pressed={count > 0} aria-label={tr('Filtros avanzados')} title={tr('Filtros avanzados')} onClick={() => setOpen(true)}>
        <SlidersHorizontal className="h-4 w-4" />
        {count > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{count}</span>}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{tr('Filtros avanzados')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {AVANZADOS.map((grupo) => (
              <section key={grupo.campo}>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{tr(grupo.titulo)}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {grupo.opciones.map(([value, label]) => (
                    <Chip key={value} on={filtros[grupo.campo].includes(value)} onClick={() => onChange({ ...filtros, [grupo.campo]: toggle(filtros[grupo.campo], value) })}>
                      {tr(label)}
                    </Chip>
                  ))}
                </div>
              </section>
            ))}
            {tipos.length > 1 && (
              <section>
                <h3 className="mb-2 text-xs font-semibold text-muted-foreground">{tr('Clase de material')}</h3>
                <div className="flex flex-wrap gap-1.5">
                  {tipos.map((tipo) => (
                    <Chip key={tipo} on={filtros.tipos.includes(tipo)} onClick={() => onChange({ ...filtros, tipos: toggle(filtros.tipos, tipo) })}>
                      {tr(TIPO_LABEL[tipo] ?? tipo)}
                    </Chip>
                  ))}
                </div>
              </section>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="gris" disabled={count === 0} onClick={() => onChange({ ...SIN_FILTROS, meses: filtros.meses, anios: filtros.anios })}>
              {tr('Quitar filtros')}
            </Button>
            <Button onClick={() => setOpen(false)}>{tr('Listo')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
