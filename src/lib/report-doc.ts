import { getLang, intlLocale, tr } from '@/lib/i18n';

// ============================================================
// Documento de informe: UN modelo, dos formatos.
//
// Todos los informes de Frame —rendimiento, pendientes, hábitos y el general—
// se escriben una sola vez como BLOQUES (`DocModel`) y salen en PDF y DOCX
// por los dos traductores de este archivo. Esa es la razón de que los
// documentos compartan tipografía, retícula, paleta y jerarquía: no
// es una convención que haya que recordar, es que solo existe un maquetador.
//
// El .docx es un paquete OOXML de verdad —un ZIP con XML dentro—, no un HTML
// renombrado: Word lo abre sin la advertencia de «el formato no coincide con
// la extensión». Se escribe a mano (escritor ZIP + XML) porque una librería de
// docx añade varios megas al instalador para algo que se usa aquí y nada más.
//
// DIAGRAMAS: un informe sin figuras se lee como un listado. Los bloques
// `bars`, `stacked`, `heat`, `funnel` y `timeline` dibujan con RECTÁNGULOS DE
// COLOR, nunca con SVG: Word no rasteriza SVG incrustado de forma fiable, pero
// una celda de tabla con fondo la pinta idéntica a como la pinta el navegador.
// Por eso las mismas figuras se ven igual impresas y abiertas en Word.
// ============================================================

export type DocTone = 'ink' | 'muted' | 'accent' | 'danger' | 'warn' | 'ok';
export type DocAlign = 'left' | 'center' | 'right';

/** Paleta del documento impreso. Única para los cuatro informes. */
const COLOR: Record<DocTone, string> = {
  ink: '1F2430',
  muted: '6B7280',
  accent: '3F5BD6',
  danger: 'B42318',
  warn: 'B54708',
  ok: '067647',
};

/** Fondos suaves del mismo tono, para rellenos de barras y avisos. */
const SOFT: Record<DocTone, string> = {
  ink: 'E5E8EF',
  muted: 'EEF1F7',
  accent: 'E4E9FB',
  danger: 'FBE9E7',
  warn: 'FDF0E3',
  ok: 'E4F4EC',
};

const RULE = 'D9DEE8';
const TRACK = 'EEF1F7';
const PAPER = 'FFFFFF';

/** Cinco pasos de intensidad para el mapa de constancia. */
const HEAT = ['F1F4F9', 'DCE4FA', 'B9C6F2', '8098E8', '3F5BD6'];

/** Titulares en serif, cuerpo en palo seco. Idéntico en HTML y en DOCX. */
const SERIF_HTML = "Georgia, 'Times New Roman', serif";
const SANS_HTML = "'Segoe UI', Arial, Helvetica, sans-serif";
const SERIF_DOCX = 'Georgia';
const SANS_DOCX = 'Segoe UI';

export interface DocCell {
  text: string;
  bold?: boolean;
  tone?: DocTone;
  align?: DocAlign;
  /** Segunda línea de la celda, en gris y más pequeña (descripciones, notas). */
  note?: string;
  /** Fondo suave de la celda: subraya una fila sin romper la tabla. */
  fill?: DocTone;
}

export interface DocKpi {
  label: string;
  value: string;
  note?: string;
  /** Variación respecto al periodo anterior. Se pinta con su flecha. */
  delta?: { dir: 'up' | 'down' | 'flat'; text: string };
}

export interface DocBarItem {
  label: string;
  /** Lo que se imprime a la derecha de la barra (ya formateado). */
  value: string;
  /** 0–100. Determina cuánto se rellena. */
  percent: number;
  note?: string;
  tone?: DocTone;
  /** Marca de referencia sobre la barra (la meta), en el mismo 0–100. */
  target?: number;
}

export interface DocHeatCell {
  /** 0 = sin actividad · 4 = máximo. */
  level: 0 | 1 | 2 | 3 | 4;
  /** Número del día, si se quiere impreso dentro de la casilla. */
  text?: string;
  /** Resalta el día de hoy con el filo del acento. */
  ring?: boolean;
}

export type DocBlock =
  | {
      kind: 'cover';
      eyebrow: string;
      title: string;
      subtitle: string;
      /** Rejilla de datos del documento: estudiante, periodo, generado… */
      meta: { label: string; value: string }[];
      footnote?: string;
    }
  | { kind: 'section'; title: string; index?: string; note?: string }
  | { kind: 'subheading'; text: string; note?: string; level?: 1 | 2 }
  | { kind: 'paragraph'; text: string; tone?: DocTone }
  | { kind: 'callout'; title: string; text: string; tone?: DocTone }
  | { kind: 'kpis'; items: DocKpi[] }
  | { kind: 'bars'; items: DocBarItem[]; caption?: string; legend?: string }
  | {
      kind: 'stacked';
      items: { label: string; percent: number; value: string; tone: DocTone }[];
      caption?: string;
    }
  | {
      kind: 'heat';
      dayLabels: string[];
      rows: { label: string; cells: DocHeatCell[] }[];
      caption?: string;
      legend?: string;
    }
  | { kind: 'funnel'; steps: { label: string; value: string; percent: number; note?: string }[] }
  | { kind: 'timeline'; items: { when: string; title: string; note?: string }[] }
  | {
      kind: 'table';
      head: string[];
      rows: DocCell[][];
      aligns?: DocAlign[];
      /** Anchos en % del ancho útil. Deben sumar 100. */
      weights?: number[];
      caption?: string;
    }
  | { kind: 'pagebreak' }
  | { kind: 'footer'; text: string };

export interface DocModel {
  /** Va al título del documento y a la pestaña de impresión. */
  title: string;
  blocks: DocBlock[];
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------

// Los tres escapes aceptan lo que llegue. Un campo ausente en UNA tarea (datos
// antiguos, una creación rápida sin prioridad) lanzaba aquí un «cannot read
// properties of undefined» y se llevaba por delante el informe completo.
function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** XML no admite los caracteres de control: Word rechaza el paquete entero. */
function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


// Un porcentaje que no es un número (0/0 en un periodo sin datos) acababa como
// w:w="NaN" dentro del DOCX, y Word se niega a abrir el archivo entero.
const clampPct = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0;

const cellAlign = (aligns: DocAlign[] | undefined, i: number): DocAlign => aligns?.[i] ?? 'left';

const columnWeights = (block: { head: string[]; weights?: number[] }): number[] =>
  block.weights && block.weights.length === block.head.length
    ? block.weights
    : block.head.map(() => 100 / block.head.length);

const DELTA_MARK: Record<'up' | 'down' | 'flat', string> = { up: '▲', down: '▼', flat: '=' };


// ------------------------------------------------------------
// 1) HTML — es el que se imprime (y de ahí sale el PDF)
// ------------------------------------------------------------

export function renderDocHtml(doc: DocModel): string {
  const body = doc.blocks.map(htmlBlock).join('\n');

  return `<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><title>${escapeHtml(doc.title)}</title>
<style>
  @page { size: A4; margin: 15mm 13mm; }
  * { box-sizing: border-box; }
  body { font-family: ${SANS_HTML}; font-size: 10pt; color: #${COLOR.ink}; background: #fff; margin: 0; padding: 15mm 13mm; }
  /* Los diagramas de los informes SON fondos de celda (barras, mapas de calor,
     embudos). El diálogo de imprimir trae «Gráficos de fondo» desmarcado y
     los borraría todos: el PDF salía con las tablas vacías. Esta propiedad
     obliga a imprimirlos tal cual, esté como esté esa casilla. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print { body { padding: 0; } }
  h1, h2, h3 { page-break-after: avoid; margin: 0; }
  table { page-break-inside: auto; border-collapse: collapse; width: 100%; }
  tr, .fig { page-break-inside: avoid; }
  thead { display: table-header-group; }
  .brk { page-break-before: always; }
</style>
</head><body>${body}</body></html>`;
}

function htmlBlock(block: DocBlock): string {
  switch (block.kind) {
    // --- Portada -------------------------------------------------------
    case 'cover': {
      const meta = block.meta
        .map(
          (item) => `<td style="padding:7px 10px 6px 0;vertical-align:top;">
      <div style="font-size:7pt;color:#${COLOR.muted};">${escapeHtml(item.label)}</div>
      <div style="font-size:9.5pt;color:#${COLOR.ink};margin-top:1px;">${escapeHtml(item.value)}</div>
    </td>`
        )
        .join('');
      return `<div class="fig" style="margin-bottom:6px;">
  <table cellpadding="0" cellspacing="0" style="margin-bottom:14px;"><tr>
    <td style="font-family:${SERIF_HTML};font-size:11pt;color:#${COLOR.accent};">Frame</td>
    <td style="text-align:right;font-size:7.5pt;color:#${COLOR.muted};">Asvent</td>
  </tr></table>
  <div style="height:3px;background:#${COLOR.accent};"></div>
  <div style="font-size:8pt;color:#${COLOR.accent};margin-top:12px;">${escapeHtml(block.eyebrow)}</div>
  <h1 style="font-family:${SERIF_HTML};font-size:23pt;line-height:1.15;color:#${COLOR.ink};margin:5px 0 3px 0;font-weight:normal;">${escapeHtml(block.title)}</h1>
  <div style="font-size:11pt;color:#${COLOR.ink};">${escapeHtml(block.subtitle)}</div>
  <table cellpadding="0" cellspacing="0" style="margin-top:10px;border-top:1px solid #${RULE};border-bottom:1px solid #${RULE};"><tr>${meta}</tr></table>
  ${block.footnote ? `<div style="font-size:8pt;color:#${COLOR.muted};margin-top:7px;">${escapeHtml(block.footnote)}</div>` : ''}
</div>`;
    }

    // --- Jerarquía -----------------------------------------------------
    case 'section':
      return `<div style="margin-top:20px;page-break-after:avoid;">
  <table cellpadding="0" cellspacing="0"><tr>
    ${
      block.index
        ? `<td style="width:26px;vertical-align:bottom;font-family:${SERIF_HTML};font-size:15pt;color:#${COLOR.accent};line-height:1;">${escapeHtml(block.index)}</td>`
        : ''
    }
    <td style="vertical-align:bottom;">
      <h2 style="font-family:${SERIF_HTML};font-size:13pt;color:#${COLOR.ink};font-weight:normal;">${escapeHtml(block.title)}</h2>
    </td>
    ${
      block.note
        ? `<td style="text-align:right;vertical-align:bottom;font-size:8pt;color:#${COLOR.muted};">${escapeHtml(block.note)}</td>`
        : ''
    }
  </tr></table>
  <div style="height:2px;background:#${COLOR.accent};margin-top:4px;"></div>
  <div style="height:1px;background:#${RULE};margin-bottom:10px;"></div>
</div>`;

    case 'subheading': {
      const level = block.level ?? 1;
      const size = level === 1 ? '10.5pt' : '9.5pt';
      const color = level === 1 ? COLOR.accent : COLOR.ink;
      return `<h3 style="font-size:${size};color:#${color};margin:${level === 1 ? '14px' : '10px'} 0 4px 0;font-weight:600;page-break-after:avoid;">${escapeHtml(block.text)}${
        block.note
          ? `<span style="font-weight:400;font-size:8pt;color:#${COLOR.muted};"> · ${escapeHtml(block.note)}</span>`
          : ''
      }</h3>`;
    }

    case 'paragraph':
      return `<p style="font-size:9.5pt;line-height:1.45;color:#${COLOR[block.tone ?? 'ink']};margin:0 0 6px 0;text-align:justify;">${escapeHtml(block.text)}</p>`;

    case 'callout': {
      const tone = block.tone ?? 'accent';
      return `<table class="fig" cellpadding="0" cellspacing="0" style="margin:8px 0 10px 0;"><tr>
  <td style="width:3px;background:#${COLOR[tone]};"></td>
  <td style="background:#${SOFT[tone]};padding:8px 11px;">
    <div style="font-size:8pt;color:#${COLOR[tone]};font-weight:600;">${escapeHtml(block.title)}</div>
    <div style="font-size:9.5pt;line-height:1.45;color:#${COLOR.ink};margin-top:3px;">${escapeHtml(block.text)}</div>
  </td>
</tr></table>`;
    }

    // --- Indicadores ---------------------------------------------------
    case 'kpis': {
      // Filas de cuatro: es lo que entra sin apretujarse en A4 vertical.
      const rows: DocKpi[][] = [];
      for (let i = 0; i < block.items.length; i += 4) rows.push(block.items.slice(i, i + 4));
      const html = rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (kpi) => `<td style="padding:9px 11px;border:1px solid #${RULE};border-top:2.5px solid #${COLOR.accent};vertical-align:top;width:25%;background:#${PAPER};">
      <div style="font-size:7.5pt;color:#${COLOR.muted};">${escapeHtml(kpi.label)}</div>
      <div style="font-family:${SERIF_HTML};font-size:18pt;color:#${COLOR.accent};line-height:1.1;margin-top:3px;">${escapeHtml(kpi.value)}</div>
      ${kpi.note ? `<div style="font-size:7.5pt;color:#${COLOR.muted};margin-top:2px;">${escapeHtml(kpi.note)}</div>` : ''}
      ${
        kpi.delta
          ? `<div style="font-size:7.5pt;font-weight:600;margin-top:3px;color:#${kpi.delta.dir === 'up' ? COLOR.ok : kpi.delta.dir === 'down' ? COLOR.danger : COLOR.muted};">${DELTA_MARK[kpi.delta.dir]} ${escapeHtml(kpi.delta.text)}</div>`
          : ''
      }
    </td>`
              )
              .join('')}${
              row.length < 4
                ? Array.from({ length: 4 - row.length }, () => '<td style="width:25%;"></td>').join('')
                : ''
            }</tr>`
        )
        .join('');
      return `<table class="fig" cellpadding="0" cellspacing="0" style="margin:2px 0 6px 0;">${html}</table>`;
    }

    // --- Figuras -------------------------------------------------------
    case 'bars': {
      const rows = block.items
        .map((item) => {
          const pct = clampPct(item.percent);
          const tone = item.tone ?? 'accent';
          const target =
            item.target === undefined
              ? ''
              : `<div style="position:absolute;top:-2px;bottom:-2px;left:${clampPct(item.target)}%;width:1.5px;background:#${COLOR.ink};"></div>`;
          return `<tr>
  <td style="width:32%;padding:3px 8px 3px 0;font-size:9pt;color:#${COLOR.ink};vertical-align:middle;">${escapeHtml(item.label)}${
    item.note ? `<div style="font-size:7.5pt;color:#${COLOR.muted};">${escapeHtml(item.note)}</div>` : ''
  }</td>
  <td style="width:52%;padding:3px 0;vertical-align:middle;">
    <div style="position:relative;height:11px;background:#${TRACK};">
      <div style="height:11px;width:${pct}%;background:#${COLOR[tone]};"></div>${target}
    </div>
  </td>
  <td style="width:16%;padding:3px 0 3px 9px;text-align:right;font-size:9pt;font-weight:600;color:#${COLOR.ink};vertical-align:middle;white-space:nowrap;">${escapeHtml(item.value)}</td>
</tr>`;
        })
        .join('');
      return `<div class="fig">${block.caption ? caption(block.caption) : ''}<table cellpadding="0" cellspacing="0" style="margin-bottom:6px;">${rows}</table>${
        block.legend ? legendHtml(block.legend) : ''
      }</div>`;
    }

    case 'stacked': {
      const total = block.items.reduce((sum, item) => sum + Math.max(0, item.percent), 0) || 1;
      const cells = block.items
        .map(
          (item) =>
            `<td style="width:${(Math.max(0, item.percent) / total) * 100}%;height:20px;background:#${COLOR[item.tone]};"></td>`
        )
        .join('');
      const keys = block.items
        .map(
          (item) => `<td style="padding:5px 12px 0 0;font-size:8pt;color:#${COLOR.muted};white-space:nowrap;">
  <span style="display:inline-block;width:8px;height:8px;background:#${COLOR[item.tone]};"></span>
  <span style="color:#${COLOR.ink};font-weight:600;"> ${escapeHtml(item.label)}</span> ${escapeHtml(item.value)}</td>`
        )
        .join('');
      return `<div class="fig">${block.caption ? caption(block.caption) : ''}
<table cellpadding="0" cellspacing="0" style="margin-bottom:0;"><tr>${cells}</tr></table>
<table cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>${keys}<td></td></tr></table></div>`;
    }

    case 'heat': {
      // Casillas casi cuadradas: un calendario con celdas alargadas deja de
      // leerse como calendario. La tabla no ocupa el ancho completo.
      const head = `<tr><td style="width:40px;"></td>${block.dayLabels
        .map(
          (day) =>
            `<td style="width:32px;text-align:center;font-size:7pt;color:#${COLOR.muted};padding-bottom:3px;">${escapeHtml(day)}</td>`
        )
        .join('')}</tr>`;
      const rows = block.rows
        .map(
          (row) =>
            `<tr><td style="width:40px;font-size:7pt;color:#${COLOR.muted};padding-right:6px;white-space:nowrap;">${escapeHtml(row.label)}</td>${row.cells
              .map(
                (cell) =>
                  `<td style="width:32px;padding:1.5px;"><div style="height:22px;background:#${HEAT[cell.level]};${
                    cell.ring ? `outline:1.5px solid #${COLOR.ink};outline-offset:-1.5px;` : ''
                  }text-align:center;font-size:7pt;line-height:22px;color:#${cell.level >= 3 ? PAPER : COLOR.muted};">${escapeHtml(cell.text ?? '')}</div></td>`
              )
              .join('')}</tr>`
        )
        .join('');
      const scale = HEAT.map(
        (color) => `<span style="display:inline-block;width:13px;height:9px;background:#${color};"></span>`
      ).join(' ');
      return `<div class="fig">${block.caption ? caption(block.caption) : ''}
<table cellpadding="0" cellspacing="0" style="width:auto;margin-bottom:5px;">${head}${rows}</table>
<div style="font-size:7.5pt;color:#${COLOR.muted};margin-bottom:10px;">${escapeHtml(tr('Menos'))} ${scale} ${escapeHtml(tr('Más'))}${
        block.legend ? ` · ${escapeHtml(block.legend)}` : ''
      }</div></div>`;
    }

    case 'funnel': {
      const rows = block.steps
        .map((step, i) => {
          const pct = clampPct(step.percent);
          return `<tr>
  <td style="width:30%;padding:2px 8px 2px 0;font-size:9pt;color:#${COLOR.ink};vertical-align:middle;">${escapeHtml(step.label)}</td>
  <td style="width:52%;padding:2px 0;vertical-align:middle;">
    <table cellpadding="0" cellspacing="0" style="width:100%;"><tr>
      <td style="width:${(100 - pct) / 2}%;"></td>
      <td style="width:${pct}%;height:18px;background:#${COLOR.accent};opacity:${1 - i * 0.14};text-align:center;font-size:8pt;color:#fff;">${escapeHtml(step.note ?? '')}</td>
      <td style="width:${(100 - pct) / 2}%;"></td>
    </tr></table>
  </td>
  <td style="width:18%;padding:2px 0 2px 9px;text-align:right;font-size:9pt;font-weight:600;color:#${COLOR.ink};vertical-align:middle;">${escapeHtml(step.value)}</td>
</tr>`;
        })
        .join('');
      return `<div class="fig"><table cellpadding="0" cellspacing="0" style="margin-bottom:8px;">${rows}</table></div>`;
    }

    case 'timeline': {
      const rows = block.items
        .map(
          (item) => `<tr>
  <td style="width:22%;padding:4px 10px 4px 0;font-size:8pt;color:#${COLOR.muted};vertical-align:top;white-space:nowrap;">${escapeHtml(item.when)}</td>
  <td style="width:3px;background:#${RULE};padding:0;"></td>
  <td style="padding:4px 0 4px 10px;vertical-align:top;">
    <div style="font-size:9pt;font-weight:600;color:#${COLOR.ink};">${escapeHtml(item.title)}</div>
    ${item.note ? `<div style="font-size:8pt;color:#${COLOR.muted};">${escapeHtml(item.note)}</div>` : ''}
  </td>
</tr>`
        )
        .join('');
      return `<table class="fig" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">${rows}</table>`;
    }

    // --- Tablas --------------------------------------------------------
    case 'table': {
      const weights = columnWeights(block);
      const head = block.head
        .map(
          (h, i) =>
            `<th style="width:${weights[i]}%;text-align:${cellAlign(block.aligns, i)};padding:5px 8px;background:#${TRACK};border-bottom:1.5px solid #${RULE};font-size:7.5pt;color:#${COLOR.muted};font-weight:600;">${escapeHtml(h)}</th>`
        )
        .join('');
      const body = block.rows
        .map(
          (row) =>
            `<tr>${row
              .map((cell, i) => {
                const align = cell.align ?? cellAlign(block.aligns, i);
                return `<td style="text-align:${align};padding:5px 8px;border-bottom:1px solid #${RULE};${
                  cell.fill ? `background:#${SOFT[cell.fill]};` : ''
                }font-size:8.5pt;color:#${COLOR[cell.tone ?? 'ink']};${cell.bold ? 'font-weight:600;' : ''}vertical-align:top;">${escapeHtml(cell.text)}${
                  cell.note
                    ? `<div style="margin-top:2px;font-size:7.5pt;font-weight:400;color:#${COLOR.muted};">${escapeHtml(cell.note)}</div>`
                    : ''
                }</td>`;
              })
              .join('')}</tr>`
        )
        .join('');
      return `${block.caption ? caption(block.caption) : ''}<table cellpadding="0" cellspacing="0" style="margin-bottom:6px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    case 'pagebreak':
      return '<div class="brk"></div>';

    case 'footer':
      return `<div style="margin-top:20px;padding-top:7px;border-top:1px solid #${RULE};font-size:7.5pt;color:#${COLOR.muted};">${escapeHtml(block.text)}</div>`;
  }
}

const caption = (text: string): string =>
  `<div style="font-size:7.5pt;color:#${COLOR.muted};margin:6px 0 4px 0;">${escapeHtml(text)}</div>`;

const legendHtml = (text: string): string =>
  `<div style="font-size:7.5pt;color:#${COLOR.muted};margin:-2px 0 8px 0;">${escapeHtml(text)}</div>`;

// ------------------------------------------------------------
// 2) DOCX — paquete OOXML mínimo, escrito a mano
// ------------------------------------------------------------

/** A4 vertical en twips (1/1440 de pulgada) menos los márgenes laterales. */
const PAGE_WIDTH = 11906;
const MARGIN_X = 964;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_X * 2;

interface RunStyle {
  /** Familia tipográfica; por defecto la del documento (Segoe UI). */
  font?: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  /** Tamaño en medios puntos: 20 = 10 pt. */
  size?: number;
  caps?: boolean;
  spacing?: number;
  /** Sombreado del propio texto (no de la celda). */
  shade?: string;
}

function run(text: string, style: RunStyle = {}): string {
  // OJO: el orden de estas etiquetas NO es decorativo. El esquema de OOXML fija
  // la secuencia (rFonts, b, i, caps, color, spacing, sz, szCs, shd) y Word
  // declara el documento dañado si se altera. Lo mismo vale para tblPr,
  // tblBorders y tcMar más abajo.
  const props = [
    style.font ? `<w:rFonts w:ascii="${style.font}" w:hAnsi="${style.font}" w:cs="${style.font}"/>` : '',
    style.bold ? '<w:b/>' : '',
    style.italic ? '<w:i/>' : '',
    style.caps ? '<w:caps/>' : '',
    style.color ? `<w:color w:val="${style.color}"/>` : '',
    style.spacing ? `<w:spacing w:val="${style.spacing}"/>` : '',
    style.size ? `<w:sz w:val="${style.size}"/><w:szCs w:val="${style.size}"/>` : '',
    style.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${style.shade}"/>` : '',
  ].join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

const serif = (text: string, style: RunStyle = {}): string => run(text, { font: SERIF_DOCX, ...style });

interface ParaStyle {
  align?: DocAlign;
  before?: number;
  after?: number;
  /** Filo inferior del párrafo (el subrayado de las secciones). */
  rule?: { color: string; size: number };
  keepNext?: boolean;
  pageBreak?: boolean;
  justify?: boolean;
}

function para(runs: string, style: ParaStyle = {}): string {
  const props = [
    style.keepNext ? '<w:keepNext/>' : '',
    style.pageBreak ? '<w:pageBreakBefore/>' : '',
    style.rule
      ? `<w:pBdr><w:bottom w:val="single" w:sz="${style.rule.size}" w:space="2" w:color="${style.rule.color}"/></w:pBdr>`
      : '',
    `<w:spacing w:before="${style.before ?? 0}" w:after="${style.after ?? 60}" w:line="252" w:lineRule="auto"/>`,
    style.justify
      ? '<w:jc w:val="both"/>'
      : style.align && style.align !== 'left'
        ? `<w:jc w:val="${style.align}"/>`
        : '',
  ].join('');
  return `<w:p><w:pPr>${props}</w:pPr>${runs}</w:p>`;
}

interface CellStyle {
  fill?: string;
  /** Bordes explícitos; sin esto la celda hereda los de la tabla. */
  borders?: string;
  /** Márgenes internos en twips (por defecto 60/80/60/80). */
  pad?: { top: number; left: number; bottom: number; right: number };
  valign?: 'top' | 'center' | 'bottom';
}

function tableCell(width: number, content: string, style: CellStyle = {}): string {
  const pad = style.pad ?? { top: 60, left: 80, bottom: 60, right: 80 };
  // Orden fijado por el esquema: tcW, tcBorders, shd, tcMar, vAlign.
  const props = [
    // `|| 1`: un ancho no finito dejaría w:w="NaN" y Word rechaza el archivo.
    `<w:tcW w:w="${Math.max(1, Math.round(width) || 1)}" w:type="dxa"/>`,
    style.borders ?? '',
    style.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${style.fill}"/>` : '',
    `<w:tcMar><w:top w:w="${pad.top}" w:type="dxa"/><w:left w:w="${pad.left}" w:type="dxa"/><w:bottom w:w="${pad.bottom}" w:type="dxa"/><w:right w:w="${pad.right}" w:type="dxa"/></w:tcMar>`,
    style.valign && style.valign !== 'top' ? `<w:vAlign w:val="${style.valign}"/>` : '',
  ].join('');
  return `<w:tc><w:tcPr>${props}</w:tcPr>${content}</w:tc>`;
}

const NO_TABLE_BORDERS = `<w:tblBorders>
<w:top w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:bottom w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/>
<w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/>
</w:tblBorders>`;

/**
 * Tabla sin bordes: la usan todas las figuras. `borders` SUSTITUYE al bloque
 * de bordes por defecto; antes se añadía detrás, y la tabla de la portada
 * salía con dos <w:tblBorders> en el mismo <w:tblPr>. El esquema OOXML admite
 * uno solo: Word lo toleraba, otros lectores (y la validación estricta) no.
 */
function table(widths: number[], rows: string, borders = NO_TABLE_BORDERS): string {
  return `<w:tbl><w:tblPr><w:tblW w:w="${Math.max(1, Math.round(widths.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)) || 1)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths
    .map((w) => `<w:gridCol w:w="${Math.max(1, Math.round(w) || 1)}"/>`)
    .join('')}</w:tblGrid>${rows}</w:tbl>`;
}

/** Fila de altura fija: así una barra de color mide lo mismo que en pantalla. */
const trHeight = (twips: number): string =>
  `<w:trPr><w:trHeight w:hRule="exact" w:val="${twips}"/></w:trPr>`;

/** Párrafo vacío y minúsculo: rellena las celdas de color sin darles alto. */
const fillPara = (): string =>
  '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="180" w:lineRule="exact"/></w:pPr></w:p>';

/**
 * Una barra pintada como fila de tabla: [relleno][pista].
 * Devuelve la tabla completa, lista para incrustar en una celda.
 */
function barTable(width: number, percent: number, color: string, track = TRACK): string {
  const pct = clampPct(percent);
  const filled = Math.round((width * pct) / 100);
  const rest = Math.max(0, width - filled);
  const cells =
    (filled > 0 ? tableCell(filled, fillPara(), { fill: color, pad: { top: 0, left: 0, bottom: 0, right: 0 } }) : '') +
    (rest > 0 ? tableCell(rest, fillPara(), { fill: track, pad: { top: 0, left: 0, bottom: 0, right: 0 } }) : '');
  const widths = [filled > 0 ? filled : 0, rest > 0 ? rest : 0].filter((w) => w > 0);
  return table(widths, `<w:tr>${trHeight(150)}${cells}</w:tr>`);
}

const CAPTION_STYLE: RunStyle = { color: COLOR.muted, size: 15, bold: true };

function docxBlock(block: DocBlock): string {
  switch (block.kind) {
    // --- Portada -------------------------------------------------------
    case 'cover': {
      const half = Math.floor(CONTENT_WIDTH / 2);
      const brand = table(
        [half, CONTENT_WIDTH - half],
        `<w:tr>${tableCell(half, para(serif('Frame', { color: COLOR.accent, size: 22 }), { after: 0 }), {
          pad: { top: 0, left: 0, bottom: 0, right: 0 },
        })}${tableCell(
          CONTENT_WIDTH - half,
          para(run('Asvent', { color: COLOR.muted, size: 15 }), { align: 'right', after: 0 }),
          { pad: { top: 0, left: 0, bottom: 0, right: 0 } }
        )}</w:tr>`
      );
      const columns = Math.max(1, block.meta.length);
      const metaWidth = Math.floor(CONTENT_WIDTH / columns);
      const meta = table(
        block.meta.map(() => metaWidth),
        `<w:tr>${block.meta
          .map((item) =>
            tableCell(
              metaWidth,
              para(run(item.label, { color: COLOR.muted, size: 13 }), { after: 20 }) +
                para(run(item.value, { color: COLOR.ink, size: 18 }), { after: 0 }),
              { pad: { top: 100, left: 0, bottom: 100, right: 120 } }
            )
          )
          .join('')}</w:tr>`,
        `<w:tblBorders><w:top w:val="single" w:sz="6" w:space="0" w:color="${RULE}"/><w:left w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="6" w:space="0" w:color="${RULE}"/><w:right w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideH w:val="none" w:sz="0" w:space="0" w:color="auto"/><w:insideV w:val="none" w:sz="0" w:space="0" w:color="auto"/></w:tblBorders>`
      );
      return [
        brand,
        para('', { after: 0, rule: { color: COLOR.accent, size: 24 } }),
        para(run(block.eyebrow, { color: COLOR.accent, size: 16, bold: true }), {
          before: 200,
          after: 40,
        }),
        para(serif(block.title, { color: COLOR.ink, size: 46 }), { after: 40 }),
        para(run(block.subtitle, { color: COLOR.ink, size: 22 }), { after: 140 }),
        meta,
        block.footnote ? para(run(block.footnote, { color: COLOR.muted, size: 15 }), { before: 120, after: 60 }) : para(''),
      ].join('');
    }

    // --- Jerarquía -----------------------------------------------------
    case 'section':
      return para(
        (block.index ? serif(`${block.index}  `, { color: COLOR.accent, size: 26 }) : '') +
          serif(block.title, { color: COLOR.ink, size: 26 }) +
          (block.note ? run(`   ${block.note}`, { color: COLOR.muted, size: 15 }) : ''),
        {
          before: 340,
          after: 130,
          rule: { color: COLOR.accent, size: 14 },
          keepNext: true,
        }
      );

    case 'subheading':
      return para(
        run(block.text, {
          bold: true,
          color: block.level === 2 ? COLOR.ink : COLOR.accent,
          size: block.level === 2 ? 19 : 21,
        }) + (block.note ? run(`  ·  ${block.note}`, { color: COLOR.muted, size: 16 }) : ''),
        { before: block.level === 2 ? 160 : 240, after: 80, keepNext: true }
      );

    case 'paragraph':
      return para(run(block.text, { color: COLOR[block.tone ?? 'ink'], size: 19 }), { after: 100, justify: true });

    case 'callout': {
      const tone = block.tone ?? 'accent';
      const barW = 40;
      const bodyW = CONTENT_WIDTH - barW;
      return (
        table(
          [barW, bodyW],
          `<w:tr>${tableCell(barW, fillPara(), { fill: COLOR[tone], pad: { top: 0, left: 0, bottom: 0, right: 0 } })}${tableCell(
            bodyW,
            para(run(block.title, { color: COLOR[tone], size: 15, bold: true }), { after: 40 }) +
              para(run(block.text, { color: COLOR.ink, size: 19 }), { after: 0, justify: true }),
            { fill: SOFT[tone], pad: { top: 120, left: 160, bottom: 120, right: 160 } }
          )}</w:tr>`
        ) + para('', { after: 60 })
      );
    }

    // --- Indicadores ---------------------------------------------------
    case 'kpis': {
      const rows: DocKpi[][] = [];
      for (let i = 0; i < block.items.length; i += 4) rows.push(block.items.slice(i, i + 4));
      const width = Math.floor(CONTENT_WIDTH / 4);
      const border = `<w:tcBorders><w:top w:val="single" w:sz="18" w:space="0" w:color="${COLOR.accent}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/></w:tcBorders>`;
      const body = rows
        .map(
          (row) =>
            `<w:tr>${row
              .map((kpi) =>
                tableCell(
                  width,
                  para(run(kpi.label, { color: COLOR.muted, size: 14, bold: true }), { after: 20 }) +
                    para(serif(kpi.value, { color: COLOR.accent, size: 32 }), { after: kpi.note || kpi.delta ? 20 : 0 }) +
                    (kpi.note ? para(run(kpi.note, { color: COLOR.muted, size: 14 }), { after: kpi.delta ? 20 : 0 }) : '') +
                    (kpi.delta
                      ? para(
                          run(`${DELTA_MARK[kpi.delta.dir]} ${kpi.delta.text}`, {
                            color: kpi.delta.dir === 'up' ? COLOR.ok : kpi.delta.dir === 'down' ? COLOR.danger : COLOR.muted,
                            size: 14,
                            bold: true,
                          }),
                          { after: 0 }
                        )
                      : ''),
                  { borders: border, pad: { top: 120, left: 140, bottom: 120, right: 140 } }
                )
              )
              .join('')}${
              // Rellena la fila incompleta: Word exige el mismo número de celdas.
              row.length < 4
                ? Array.from({ length: 4 - row.length }, () => tableCell(width, para(''))).join('')
                : ''
            }</w:tr>`
        )
        .join('');
      return table(Array.from({ length: 4 }, () => width), body) + para('', { after: 40 });
    }

    // --- Figuras -------------------------------------------------------
    case 'bars': {
      const labelW = Math.floor(CONTENT_WIDTH * 0.32);
      const valueW = Math.floor(CONTENT_WIDTH * 0.16);
      const barW = CONTENT_WIDTH - labelW - valueW;
      const rows = block.items
        .map((item) => {
          const inner = barW - 160; // deja aire a la derecha de la pista
          return `<w:tr>${tableCell(
            labelW,
            para(run(item.label, { color: COLOR.ink, size: 18 }), { after: item.note ? 10 : 0 }) +
              (item.note ? para(run(item.note, { color: COLOR.muted, size: 14 }), { after: 0 }) : ''),
            { pad: { top: 50, left: 0, bottom: 50, right: 120 }, valign: 'center' }
          )}${tableCell(barW, barTable(inner, item.percent, COLOR[item.tone ?? 'accent']) + fillPara(), {
            pad: { top: 50, left: 0, bottom: 50, right: 160 },
            valign: 'center',
          })}${tableCell(valueW, para(run(item.value, { color: COLOR.ink, size: 18, bold: true }), { align: 'right', after: 0 }), {
            pad: { top: 50, left: 60, bottom: 50, right: 0 },
            valign: 'center',
          })}</w:tr>`;
        })
        .join('');
      return (
        (block.caption ? para(run(block.caption, CAPTION_STYLE), { before: 120, after: 60 }) : '') +
        table([labelW, barW, valueW], rows) +
        (block.legend ? para(run(block.legend, { color: COLOR.muted, size: 14 }), { before: 60, after: 80 }) : para('', { after: 40 }))
      );
    }

    case 'stacked': {
      const total = block.items.reduce((sum, item) => sum + Math.max(0, item.percent), 0) || 1;
      const widths = block.items.map((item) =>
        Math.max(1, Math.round((Math.max(0, item.percent) / total) * CONTENT_WIDTH))
      );
      const bar = table(
        widths,
        `<w:tr>${trHeight(240)}${block.items
          .map((item, i) =>
            tableCell(widths[i], fillPara(), { fill: COLOR[item.tone], pad: { top: 0, left: 0, bottom: 0, right: 0 } })
          )
          .join('')}</w:tr>`
      );
      const keys = block.items
        .map(
          (item) =>
            run('■ ', { color: COLOR[item.tone], size: 18 }) +
            run(`${item.label} `, { color: COLOR.ink, size: 15, bold: true }) +
            run(`${item.value}    `, { color: COLOR.muted, size: 15 })
        )
        .join('');
      return (
        (block.caption ? para(run(block.caption, CAPTION_STYLE), { before: 120, after: 60 }) : '') +
        bar +
        para(keys, { before: 60, after: 100 })
      );
    }

    case 'heat': {
      // Casillas casi cuadradas (≈0,3 cm) y una columna de relleno al final:
      // repartir el ancho útil entre siete días daría celdas alargadas que ya
      // no se leen como un calendario.
      const labelW = 620;
      const cellW = 440;
      const filler = Math.max(0, CONTENT_WIDTH - labelW - cellW * block.dayLabels.length);
      const widths = [labelW, ...block.dayLabels.map(() => cellW), ...(filler > 0 ? [filler] : [])];
      const tail = filler > 0 ? tableCell(filler, para('')) : '';
      const head = `<w:tr>${tableCell(labelW, para(''), { pad: { top: 0, left: 0, bottom: 30, right: 0 } })}${block.dayLabels
        .map((day) =>
          tableCell(cellW, para(run(day, { color: COLOR.muted, size: 13, bold: true }), { align: 'center', after: 0 }), {
            pad: { top: 0, left: 0, bottom: 40, right: 0 },
          })
        )
        .join('')}${tail}</w:tr>`;
      const rows = block.rows
        .map(
          (row) =>
            `<w:tr>${trHeight(300)}${tableCell(
              labelW,
              para(run(row.label, { color: COLOR.muted, size: 13 }), { after: 0 }),
              { pad: { top: 30, left: 0, bottom: 30, right: 80 }, valign: 'center' }
            )}${row.cells
              .map((cell) =>
                tableCell(
                  cellW,
                  para(
                    run(cell.text ?? '', { color: cell.level >= 3 ? PAPER : COLOR.muted, size: 13 }),
                    { align: 'center', after: 0 }
                  ),
                  {
                    fill: HEAT[cell.level],
                    borders: cell.ring
                      ? `<w:tcBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="${COLOR.ink}"/><w:left w:val="single" w:sz="8" w:space="0" w:color="${COLOR.ink}"/><w:bottom w:val="single" w:sz="8" w:space="0" w:color="${COLOR.ink}"/><w:right w:val="single" w:sz="8" w:space="0" w:color="${COLOR.ink}"/></w:tcBorders>`
                      : `<w:tcBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${PAPER}"/><w:left w:val="single" w:sz="4" w:space="0" w:color="${PAPER}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${PAPER}"/><w:right w:val="single" w:sz="4" w:space="0" w:color="${PAPER}"/></w:tcBorders>`,
                    pad: { top: 20, left: 0, bottom: 20, right: 0 },
                    valign: 'center',
                  }
                )
              )
              .join('')}${tail}</w:tr>`
        )
        .join('');
      const scale = HEAT.map((color) => run('  ', { shade: color, size: 18 })).join(run(' ', { size: 18 }));
      return (
        (block.caption ? para(run(block.caption, CAPTION_STYLE), { before: 120, after: 60 }) : '') +
        table(widths, head + rows) +
        para(
          run(`${tr('Menos')}  `, { color: COLOR.muted, size: 14 }) +
            scale +
            run(`  ${tr('Más')}`, { color: COLOR.muted, size: 14 }) +
            (block.legend ? run(`   ·   ${block.legend}`, { color: COLOR.muted, size: 14 }) : ''),
          { before: 80, after: 100 }
        )
      );
    }

    case 'funnel': {
      const labelW = Math.floor(CONTENT_WIDTH * 0.3);
      const valueW = Math.floor(CONTENT_WIDTH * 0.18);
      const barW = CONTENT_WIDTH - labelW - valueW;
      const inner = barW - 160;
      const rows = block.steps
        .map((step) => {
          const pct = clampPct(step.percent);
          const filled = Math.max(60, Math.round((inner * pct) / 100));
          const side = Math.max(0, Math.round((inner - filled) / 2));
          const widths = side > 0 ? [side, filled, inner - filled - side] : [filled];
          const cells =
            (side > 0 ? tableCell(side, fillPara(), { pad: { top: 0, left: 0, bottom: 0, right: 0 } }) : '') +
            tableCell(
              filled,
              para(run(step.note ?? '', { color: PAPER, size: 15, bold: true }), { align: 'center', after: 0 }),
              { fill: COLOR.accent, pad: { top: 40, left: 0, bottom: 40, right: 0 }, valign: 'center' }
            ) +
            (side > 0 && inner - filled - side > 0
              ? tableCell(inner - filled - side, fillPara(), { pad: { top: 0, left: 0, bottom: 0, right: 0 } })
              : '');
          const stepBar = table(
            widths.filter((w) => w > 0),
            `<w:tr>${trHeight(280)}${cells}</w:tr>`
          );
          return `<w:tr>${tableCell(labelW, para(run(step.label, { color: COLOR.ink, size: 18 }), { after: 0 }), {
            pad: { top: 40, left: 0, bottom: 40, right: 120 },
            valign: 'center',
          })}${tableCell(barW, stepBar + fillPara(), { pad: { top: 40, left: 0, bottom: 40, right: 160 }, valign: 'center' })}${tableCell(
            valueW,
            para(run(step.value, { color: COLOR.ink, size: 18, bold: true }), { align: 'right', after: 0 }),
            { pad: { top: 40, left: 60, bottom: 40, right: 0 }, valign: 'center' }
          )}</w:tr>`;
        })
        .join('');
      return table([labelW, barW, valueW], rows) + para('', { after: 60 });
    }

    case 'timeline': {
      const whenW = Math.floor(CONTENT_WIDTH * 0.22);
      const ruleW = 30;
      const bodyW = CONTENT_WIDTH - whenW - ruleW;
      const rows = block.items
        .map(
          (item) =>
            `<w:tr>${tableCell(whenW, para(run(item.when, { color: COLOR.muted, size: 15 }), { after: 0 }), {
              pad: { top: 70, left: 0, bottom: 70, right: 140 },
            })}${tableCell(ruleW, fillPara(), { fill: RULE, pad: { top: 0, left: 0, bottom: 0, right: 0 } })}${tableCell(
              bodyW,
              para(run(item.title, { color: COLOR.ink, size: 18, bold: true }), { after: item.note ? 20 : 0 }) +
                (item.note ? para(run(item.note, { color: COLOR.muted, size: 15 }), { after: 0 }) : ''),
              { pad: { top: 70, left: 160, bottom: 70, right: 0 } }
            )}</w:tr>`
        )
        .join('');
      return table([whenW, ruleW, bodyW], rows) + para('', { after: 60 });
    }

    // --- Tablas --------------------------------------------------------
    case 'table': {
      const weights = columnWeights(block);
      const widths = weights.map((w) => Math.max(400, Math.floor((CONTENT_WIDTH * w) / 100)));
      const head = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.head
        .map((h, i) =>
          tableCell(
            widths[i],
            para(run(h, { bold: true, color: COLOR.muted, size: 14 }), {
              align: cellAlign(block.aligns, i),
              after: 0,
            }),
            { fill: TRACK, pad: { top: 90, left: 100, bottom: 90, right: 100 } }
          )
        )
        .join('')}</w:tr>`;
      const body = block.rows
        .map(
          (row) =>
            `<w:tr>${row
              .map((cell, i) =>
                tableCell(
                  widths[i],
                  para(run(cell.text, { bold: cell.bold, color: COLOR[cell.tone ?? 'ink'], size: 17 }), {
                    align: cell.align ?? cellAlign(block.aligns, i),
                    after: cell.note ? 20 : 0,
                  }) +
                    (cell.note
                      ? para(run(cell.note, { color: COLOR.muted, size: 14 }), {
                          align: cell.align ?? cellAlign(block.aligns, i),
                          after: 0,
                        })
                      : ''),
                  { fill: cell.fill ? SOFT[cell.fill] : undefined, pad: { top: 80, left: 100, bottom: 80, right: 100 } }
                )
              )
              .join('')}</w:tr>`
        )
        .join('');
      return (
        (block.caption ? para(run(block.caption, CAPTION_STYLE), { before: 120, after: 60 }) : '') +
        `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH}" w:type="dxa"/><w:tblBorders>
<w:bottom w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/>
<w:insideH w:val="single" w:sz="4" w:space="0" w:color="${RULE}"/>
</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths
          .map((w) => `<w:gridCol w:w="${w}"/>`)
          .join('')}</w:tblGrid>${head}${body}</w:tbl>` +
        para('', { after: 40 })
      );
    }

    case 'pagebreak':
      return para('', { pageBreak: true, after: 0 });

    case 'footer':
      return para(run(block.text, { color: COLOR.muted, size: 14, italic: true }), {
        before: 300,
        after: 0,
        keepNext: false,
      });
  }
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

const DOCUMENT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="${SANS_DOCX}" w:hAnsi="${SANS_DOCX}" w:cs="${SANS_DOCX}"/>
<w:color w:val="${COLOR.ink}"/><w:sz w:val="20"/><w:szCs w:val="20"/>
<w:lang w:val="__LANG__"/>
</w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="252" w:lineRule="auto"/></w:pPr></w:pPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;

function coreProps(title: string, isoDate: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title)}</dc:title>
<dc:creator>Frame</dc:creator>
<cp:lastModifiedBy>Frame</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>
</cp:coreProperties>`;
}

function docxParts(doc: DocModel, generatedAt: Date): { name: string; data: Uint8Array<ArrayBuffer> }[] {
  const body = doc.blocks.map(docxBlock).join('');
  const sectPr = `<w:sectPr><w:pgSz w:w="${PAGE_WIDTH}" w:h="16838"/><w:pgMar w:top="1077" w:right="${MARGIN_X}" w:bottom="1077" w:left="${MARGIN_X}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${sectPr}</w:body></w:document>`;

  return [
    { name: '[Content_Types].xml', text: CONTENT_TYPES },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'docProps/core.xml', text: coreProps(doc.title, generatedAt.toISOString().replace(/\.\d+Z$/, 'Z')) },
    { name: 'word/_rels/document.xml.rels', text: DOCUMENT_RELS },
    { name: 'word/styles.xml', text: STYLES.replace('__LANG__', intlLocale()) },
    { name: 'word/document.xml', text: document },
  ].map((part) => ({ name: part.name, data: utf8(part.text) }));
}

/**
 * El .docx, comprimido (1.6.9). Word lo abre como documento nativo. El Reporte del Panel de uso, con una
 * ficha por estudiante, pasaba de 13 MB sin comprimir; el XML se reduce unas
 * treinta veces. Sin `CompressionStream` (motores viejos) sale sin comprimir.
 */
export async function renderDocxBlobPacked(doc: DocModel, generatedAt: Date = new Date()): Promise<Blob> {
  const entries = docxParts(doc, generatedAt);
  const packed = await Promise.all(entries.map((entry) => deflateRaw(entry.data)));
  if (packed.some((data) => data === null)) return zipStore(entries, generatedAt);
  return zipStore(entries.map((entry, i) => ({ ...entry, packed: packed[i]! })), generatedAt);
}

async function deflateRaw(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

// --- Escritor ZIP ("store" o, si llega ya comprimida, "deflate") --------------
//
// Un informe normal pesa unas decenas de KB y va sin comprimir; el Reporte del
// Panel de uso (1.6.9) llega comprimido por el navegador (renderDocxBlobPacked).

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Bytes UTF-8 respaldados por un ArrayBuffer propio (lo que `Blob` acepta). */
function utf8(text: string): Uint8Array<ArrayBuffer> {
  const source = new TextEncoder().encode(text);
  const bytes = new Uint8Array(source.length);
  bytes.set(source);
  return bytes;
}

function zipStore(entries: { name: string; data: Uint8Array<ArrayBuffer>; packed?: Uint8Array<ArrayBuffer> }[], stamp: Date): Blob {
  const dosTime = ((stamp.getHours() << 11) | (stamp.getMinutes() << 5) | (stamp.getSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((stamp.getFullYear() - 1980) << 9) | ((stamp.getMonth() + 1) << 5) | stamp.getDate()) & 0xffff;

  const parts: Uint8Array<ArrayBuffer>[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = utf8(entry.name);
    const crc = crc32(entry.data);
    const stored = entry.packed ?? entry.data;
    const method = entry.packed ? 8 : 0; // 8 = deflate · 0 = sin compresión

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, stored.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, stored);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);

    offset += local.length + stored.length;
  }

  const centralSize = central.reduce((total, chunk) => total + chunk.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ------------------------------------------------------------
// 3) Markdown (1.6.9) — el Reporte del Panel de uso también sale así: texto
//    plano que se lee en cualquier editor y se pega donde haga falta. Las
//    figuras de color pasan a tablas con su cifra (y una barra de bloques).
// ------------------------------------------------------------

const mdCell = (value: string) => String(value ?? '').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const mdBar = (percent: number) => '█'.repeat(Math.round(clampPct(percent) / 10)) || '·';
const HEAT_MARK = ['·', '░', '▒', '▓', '█'];

function mdTable(head: string[], rows: string[][], aligns?: DocAlign[]): string[] {
  const rule = head.map((_, i) => (aligns?.[i] === 'right' ? '---:' : aligns?.[i] === 'center' ? ':---:' : '---'));
  return [`| ${head.map(mdCell).join(' | ')} |`, `| ${rule.join(' | ')} |`, ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`), ''];
}

function mdBlock(block: DocBlock): string[] {
  switch (block.kind) {
    case 'cover':
      return [
        `# ${block.title}`,
        '',
        `*${block.eyebrow}*`,
        '',
        block.subtitle,
        '',
        ...block.meta.map((item) => `- **${item.label}:** ${item.value}`),
        '',
        ...(block.footnote ? [`> ${block.footnote}`, ''] : []),
      ];
    case 'section':
      return [`## ${block.index ? `${block.index}. ` : ''}${block.title}`, '', ...(block.note ? [`*${block.note}*`, ''] : [])];
    case 'subheading':
      return [`${block.level === 2 ? '####' : '###'} ${block.text}`, '', ...(block.note ? [`*${block.note}*`, ''] : [])];
    case 'paragraph':
      return [block.text, ''];
    case 'callout':
      return [`> **${block.title}**`, '>', `> ${block.text}`, ''];
    case 'kpis':
      return mdTable(
        [tr('Indicador'), tr('Valor'), tr('Nota')],
        block.items.map((item) => [item.label, item.delta ? `${item.value} (${DELTA_MARK[item.delta.dir]} ${item.delta.text})` : item.value, item.note ?? '']),
        ['left', 'right', 'left']
      );
    case 'bars':
      return [
        ...mdTable(
          ['', tr('Valor'), ''],
          block.items.map((item) => [item.note ? `${item.label} (${item.note})` : item.label, item.value, mdBar(item.percent)]),
          ['left', 'right', 'left']
        ),
        ...(block.caption ? [`*${block.caption}*`, ''] : []),
      ];
    case 'stacked':
      return [
        ...mdTable(['', tr('Valor'), '%'], block.items.map((item) => [item.label, item.value, `${clampPct(item.percent)} %`]), ['left', 'right', 'right']),
        ...(block.caption ? [`*${block.caption}*`, ''] : []),
      ];
    case 'heat':
      return [
        ...mdTable(['', ...block.dayLabels], block.rows.map((row) => [row.label, ...row.cells.map((cell) => cell.text ?? HEAT_MARK[cell.level])])),
        ...(block.caption ? [`*${block.caption}*`, ''] : []),
        ...(block.legend ? [`*${block.legend}*`, ''] : []),
      ];
    case 'funnel':
      return mdTable(['', tr('Valor'), '%'], block.steps.map((step) => [step.note ? `${step.label} (${step.note})` : step.label, step.value, `${clampPct(step.percent)} %`]), ['left', 'right', 'right']);
    case 'timeline':
      return [...block.items.map((item) => `- **${item.when}** · ${item.title}${item.note ? ` — ${item.note}` : ''}`), ''];
    case 'table':
      return [
        ...mdTable(block.head, block.rows.map((row) => row.map((cell) => (cell.note ? `${cell.text} (${cell.note})` : cell.text))), block.aligns),
        ...(block.caption ? [`*${block.caption}*`, ''] : []),
      ];
    case 'pagebreak':
      return ['---', ''];
    case 'footer':
      return [`*${block.text}*`, ''];
  }
}

export function renderDocMarkdown(doc: DocModel): string {
  return `${doc.blocks.flatMap(mdBlock).join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
