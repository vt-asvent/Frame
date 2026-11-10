import { format, parseISO } from 'date-fns';
import type { DocBlock, DocCell, DocHeatCell, DocModel, DocTone } from '@/lib/report-doc';
import { buildImpactDoc, type ImpactData } from '@m/lib/impact-report';
import { dateLocale, decimalText, tr } from '@m/lib/i18n';
import {
  activeDaysIn,
  activityOf,
  adoptionOf,
  byCity,
  byContinent,
  byCountry,
  cohortsOf,
  continentOf,
  countBy,
  dayOfInstant,
  displayName,
  dormant,
  FEATURE_KEYS,
  featureValue,
  firstDayOf,
  hoursOf,
  isOutdated,
  levelOf,
  mondayOf,
  newestVersions,
  peakWindow,
  rangeLength,
  seriesOf,
  seriesTotals,
  stickinessSeries,
  sum,
  sumMatrices,
  summarize,
  weekdaysOf,
  weekTwoReturn,
  type Grouping,
  type Range,
  type SnapUser,
  type UserDetail,
  type UsageSnapshot,
} from '@m/lib/usage-model';
import {
  bucketLabel,
  CONTINENT_LABEL,
  countryName,
  dayLabel,
  DEVICE_LABEL,
  EVENT_LABEL,
  FEATURE_LABEL,
  hourLabel,
  LANG_LABEL,
  LEVEL_HINT,
  LEVEL_LABEL,
  longDayLabel,
  minutesLabel,
  numberLabel,
  pctLabel,
  PLATFORM_LABEL,
  SCREEN_LABEL,
  weekdayShort,
} from '@m/components/UsageBits';
import type { Continent } from '@m/lib/world-map';

// ============================================================
// Reporte del Panel de uso (1.6.9): todo lo que el panel recoge, en un
// documento que se puede presentar (Word, PDF o Markdown, report-doc.ts).
//
// Pedido de Diego: «absolutamente todos los datos que se recopilan», sin
// exagerar: ni más de unas 200 páginas ni un folleto de diez. Así:
//   · Siempre: resumen, método y privacidad, evolución, estudiantes,
//     geografía, cuándo estudian, funciones, retención, el análisis de
//     impacto (semana 1 frente a semana 2…), versiones y errores, el día a
//     día del plazo y un glosario.
//   · La tendencia de largo plazo (13 meses y 26 semanas), sea cual sea el
//     plazo: el día a día de un mes no dice hacia dónde va Frame.
//   · Una ficha por estudiante, ordenadas por estudio en el plazo, hasta
//     llenar unas 190 páginas; el resto queda en la tabla de estudiantes.
// Los nombres de usuario solo aparecen porque el documento es del
// responsable (Política de Privacidad, 3.2); nunca el contenido de nada.
// ============================================================

export interface UsageReportInput {
  snapshot: UsageSnapshot;
  users: SnapUser[];
  range: Range;
  grouping: Grouping;
  details: Map<string, UserDetail>;
  impact: unknown;
  /** El filtro del mapa (país o continente), si lo hay. */
  scope: string | null;
}

const PAGE_BUDGET = 190;

const c = (text: string, extra: Partial<DocCell> = {}): DocCell => ({ text, ...extra });
const right = (text: string, extra: Partial<DocCell> = {}): DocCell => ({ text, align: 'right', ...extra });
const percent = (value: number, max: number) => (max > 0 ? Math.round((value / max) * 100) : 0);

const GROUPING_TEXT: Record<Grouping, () => string> = {
  day: () => tr('por día'),
  '3days': () => tr('cada tres días'),
  week: () => tr('por semana'),
  month: () => tr('por mes'),
};

/** Mapa de calor de la semana (lunes arriba) en bloques del documento. */
function weekHeat(matrix: number[], caption: string, legend: string): DocBlock {
  const max = Math.max(0, ...matrix);
  const days = weekdayShort();
  return {
    kind: 'heat',
    dayLabels: Array.from({ length: 24 }, (_, hour) => (hour % 3 === 0 ? String(hour) : '')),
    rows: days.map((day, row) => ({
      label: day,
      cells: Array.from({ length: 24 }, (_, hour): DocHeatCell => {
        const value = matrix[row * 24 + hour] ?? 0;
        const level = max > 0 && value > 0 ? (Math.min(4, 1 + Math.floor((value / max) * 3.999)) as DocHeatCell['level']) : 0;
        return { level };
      }),
    })),
    caption,
    legend,
  };
}

function placeOf(user: SnapUser): string {
  return [user.ci, user.cc ? countryName(user.cc) : user.co].filter(Boolean).join(', ') || tr('Sin ubicación');
}

export function buildUsageReport({ snapshot, users, range, grouping, details, impact, scope }: UsageReportInput): DocModel {
  const summary = summarize(snapshot, range, users);
  const activity = summary.activity;
  const generated = format(parseISO(snapshot.generated_at), tr("d 'de' MMMM 'de' yyyy, HH:mm"), { locale: dateLocale() });
  const newest = newestVersions(snapshot.users);
  const study = sumMatrices(users.map((user) => user.mx), 168);
  const peak = peakWindow(study);
  const back = weekTwoReturn(snapshot, users);
  const sleeping = dormant(snapshot, users);
  const continents = byContinent(users, range);
  const countries = byCountry(users, range);
  const cities = byCity(users, range);
  const series = seriesOf(snapshot, range, grouping, users);
  const daily = seriesOf(snapshot, range, 'day', users);
  const adoption = adoptionOf(users);

  let sectionNo = 0;
  const section = (title: string, note?: string): DocBlock => ({ kind: 'section', title, index: String(++sectionNo).padStart(2, '0'), note });
  /** Los anexos van con su letra, sin número. */
  const annex = (title: string, note?: string): DocBlock => ({ kind: 'section', title, note });

  const blocks: DocBlock[] = [
    {
      kind: 'cover',
      eyebrow: tr('Reporte de uso'),
      title: tr('Frame en el mundo'),
      subtitle: tr('Del {from} al {to}', { from: longDayLabel(range.from), to: longDayLabel(range.to) }),
      meta: [
        { label: tr('Alcance'), value: scope ?? tr('Todos los estudiantes') },
        { label: tr('Estudiantes'), value: numberLabel(summary.users) },
        { label: tr('Activos en el plazo'), value: numberLabel(summary.active) },
        { label: tr('Estudio en el plazo'), value: minutesLabel(activity.minutes) },
        { label: tr('Países'), value: numberLabel(summary.countries) },
        { label: tr('Datos calculados'), value: generated },
      ],
      footnote: tr('Documento generado por Frame (VT Asvent) a partir de indicadores de uso seudónimos y agregados. No contiene el contenido de nada de lo que escriben los estudiantes.'),
    },
  ];

  // ---------------- 1. Resumen ----------------
  blocks.push(section(tr('Resumen'), tr('{days} días, agrupados {grouping}.', { days: rangeLength(range), grouping: GROUPING_TEXT[grouping]() })));
  const findings: string[] = [];
  findings.push(
    tr('{active} de {users} estudiantes usaron Frame en el plazo; de media, {daily} cada día ({pct} de los activos del mes).', {
      active: numberLabel(summary.active),
      users: numberLabel(summary.users),
      daily: decimalText(Math.round(summary.avgDaily * 10) / 10),
      pct: pctLabel(summary.stickiness),
    })
  );
  if (activity.minutes > 0)
    findings.push(
      tr('Registraron {minutes} de estudio en {sessions} sesiones: {per} por estudiante activo.', {
        minutes: minutesLabel(activity.minutes),
        sessions: numberLabel(activity.sessions),
        per: summary.minutesPerActive === null ? '—' : minutesLabel(summary.minutesPerActive),
      })
    );
  if (activity.tasks > 0)
    findings.push(tr('Culminaron {tasks} tareas; {pct} de las que tenían plazo, a tiempo.', { tasks: numberLabel(activity.tasks), pct: pctLabel(summary.onTimePct) }));
  if (peak)
    findings.push(tr('La franja con más estudio es de {from} a {to} ({share} % del tiempo de estudio).', { from: hourLabel(peak.start), to: hourLabel((peak.start + 3) % 24), share: peak.share }));
  if (back.eligible > 0)
    findings.push(tr('{pct} de quienes ya cumplieron dos semanas volvió en su segunda semana ({n} de {total}).', { pct: pctLabel(back.pct), n: back.returned, total: back.eligible }));
  if (countries[0] && countries[0].key !== '?')
    findings.push(
      summary.countries === 1
        ? tr('Todos los estudiantes con ubicación están en {country} ({n}).', { country: countryName(countries[0].key), n: countries[0].users })
        : tr('El país con más estudiantes es {country} ({n}), de {total} países.', { country: countryName(countries[0].key), n: countries[0].users, total: summary.countries })
    );
  blocks.push(...findings.map((text): DocBlock => ({ kind: 'paragraph', text })));
  blocks.push({
    kind: 'kpis',
    items: [
      { label: tr('Estudiantes'), value: numberLabel(summary.users), note: tr('{accounts} con cuenta · {guests} invitados · {fresh} nuevos', { accounts: summary.accounts, guests: summary.guests, fresh: summary.newUsers }) },
      { label: tr('Activos en el plazo'), value: numberLabel(summary.active), note: tr('{today} hoy · {d7} en 7 días · {d30} en 30', { today: summary.activeToday, d7: summary.active7, d30: summary.active30 }) },
      { label: tr('Estudio'), value: minutesLabel(activity.minutes), note: tr('{sessions} sesiones', { sessions: numberLabel(activity.sessions) }) },
      { label: tr('Tareas culminadas'), value: numberLabel(activity.tasks), note: tr('{pct} a tiempo', { pct: pctLabel(summary.onTimePct) }) },
    ],
  });
  blocks.push({
    kind: 'kpis',
    items: [
      { label: tr('Constancia de hábitos'), value: pctLabel(summary.habitsPct), note: tr('{done} de {possible} marcas', { done: activity.habitsDone, possible: activity.habitsPossible }) },
      { label: tr('Enfoque medio'), value: summary.focusAvg === null ? '—' : `${decimalText(summary.focusAvg)} / 20` },
      { label: tr('Vuelven la segunda semana'), value: pctLabel(back.pct), note: tr('{n} de {total}', { n: back.returned, total: back.eligible }) },
      { label: tr('Alcance'), value: tr('{n} países', { n: summary.countries }), note: tr('{n} ciudades', { n: summary.cities }) },
    ],
  });

  // ---------------- 2. Método y privacidad ----------------
  blocks.push(section(tr('Método y privacidad')));
  blocks.push(
    { kind: 'paragraph', text: tr('Cada copia de Frame envía, como mucho cada seis horas, indicadores agregados de su uso: minutos y sesiones de estudio por día, tareas culminadas (a tiempo y de importancia alta), constancia de hábitos, el enfoque que el estudiante declara al terminar una sesión, cuántos elementos tiene de cada función y, desde la 1.6.9, su lugar aproximado (la ciudad del clima de Inicio, que el propio estudiante ve y puede cambiar), su zona horaria, su idioma, su tipo de equipo y en qué horas estudia. Además se registran hechos con fecha: abrir la app, abrir una interfaz (una vez al día), terminar una sesión o una tarea, generar un informe y, desde la 1.9.2, descargar canciones o archivos de la Biblioteca (cuántos, nunca cuáles). De cada cuenta se sabe además en cuántos equipos tiene la sesión abierta y de qué tipo son (laptop, celular o tablet): es lo mismo que ella ve en Ajustes.') },
    { kind: 'paragraph', text: tr('Nunca viaja el contenido de nada: ni nombres de tareas o asignaturas, ni notas, ni música, ni imágenes, ni la posición exacta. Los estudiantes se identifican por un número aleatorio; de las cuentas, además, por su nombre de usuario, que solo ve el responsable de Frame. La cuenta del responsable no cuenta en ninguna cifra. Quien elimina su cuenta desaparece del panel en el acto.') },
    { kind: 'paragraph', text: tr('El servidor calcula el panel como mucho cada 6, 12 o 24 horas (lo elige el responsable). Los días se cuentan en la hora de Perú; las horas del día, en la hora local de cada estudiante. Un estudiante está activo un día si ese día abrió Frame o registró algo.') },
    {
      kind: 'table',
      head: [tr('Término'), tr('Qué significa')],
      weights: [28, 72],
      rows: [
        [c(tr('Activo en el plazo'), { bold: true }), c(tr('Abrió Frame o registró algo al menos un día del plazo.'))],
        ...(['high', 'mid', 'low', 'none'] as const).map((level) => [c(LEVEL_LABEL[level](), { bold: true }), c(LEVEL_HINT[level]())]),
        [c(tr('Uso diario sobre el mensual'), { bold: true }), c(tr('Activos de media al día entre activos en 30 días: cuánto vuelve cada día quien usa Frame.'))],
        [c(tr('Constancia de hábitos'), { bold: true }), c(tr('Marcas hechas entre marcas posibles de los hábitos activos.'))],
        [c(tr('A tiempo'), { bold: true }), c(tr('Tarea culminada el día de su plazo o antes.'))],
        [c(tr('Enfoque'), { bold: true }), c(tr('Lo que el estudiante declara, de 1 a 20, al terminar una sesión de rendimiento.'))],
        [c(tr('Cohorte'), { bold: true }), c(tr('Quienes empezaron a usar Frame la misma semana.'))],
      ],
    }
  );

  // ---------------- 3. Evolución ----------------
  const maxActive = Math.max(1, ...series.map((point) => point.active));
  blocks.push(section(tr('Evolución en el plazo'), tr('Agrupado {grouping}.', { grouping: GROUPING_TEXT[grouping]() })));
  if (series.length <= 40) {
    blocks.push({
      kind: 'bars',
      items: series.map((point) => ({ label: bucketLabel(point.from, point.to), value: tr('{n} activos · {m}', { n: point.active, m: minutesLabel(point.minutes) }), percent: percent(point.active, maxActive) })),
      caption: tr('Estudiantes activos en cada tramo y su estudio.'),
    });
  }
  blocks.push({
    kind: 'table',
    head: [tr('Tramo'), tr('Activos'), tr('Nuevos'), tr('Aperturas'), tr('Estudio'), tr('Sesiones'), tr('Tareas'), tr('Hábitos'), tr('Enfoque')],
    aligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    weights: [20, 9, 9, 10, 14, 10, 9, 10, 9],
    rows: series.map((point) => [
      c(bucketLabel(point.from, point.to)),
      right(String(point.active)),
      right(String(point.newUsers)),
      right(String(point.opens)),
      right(minutesLabel(point.minutes)),
      right(String(point.sessions)),
      right(String(point.tasks)),
      right(pctLabel(point.habitsPct)),
      right(point.focus === null ? '—' : decimalText(point.focus)),
    ]),
  });

  // ---------------- 4. Estudiantes ----------------
  blocks.push(section(tr('Estudiantes'), tr('Quiénes son y cuánto usan Frame.')));
  const levelTone: Record<string, DocTone> = { high: 'ok', mid: 'accent', low: 'warn', none: 'muted' };
  blocks.push({
    kind: 'stacked',
    items: (['high', 'mid', 'low', 'none'] as const).map((level) => ({
      label: LEVEL_LABEL[level](),
      percent: percent(summary.levels[level], summary.users),
      value: String(summary.levels[level]),
      tone: levelTone[level],
    })),
    caption: tr('Nivel de actividad en el plazo.'),
  });
  const distribution = (title: string, rows: { label: string; value: number }[]): DocBlock[] => {
    const total = sum(rows.map((row) => row.value));
    return [
      { kind: 'subheading', text: title },
      { kind: 'bars', items: rows.map((row) => ({ label: row.label, value: `${row.value} · ${percent(row.value, total)} %`, percent: percent(row.value, total) })) },
    ];
  };
  blocks.push(
    ...distribution(tr('Cuentas e invitados'), [{ label: tr('Con cuenta'), value: summary.accounts }, { label: tr('Invitados'), value: summary.guests }]),
    ...distribution(tr('Sistema'), countBy(users, (user) => user.pl).map((row) => ({ label: PLATFORM_LABEL[row.key] ?? tr('Sin dato'), value: row.value }))),
    ...distribution(tr('Equipo'), countBy(users, (user) => user.dv).map((row) => ({ label: DEVICE_LABEL[row.key]?.() ?? tr('Sin dato'), value: row.value }))),
    ...distribution(tr('Idioma de Frame'), countBy(users, (user) => user.la).map((row) => ({ label: LANG_LABEL[row.key]?.() ?? tr('Sin dato'), value: row.value }))),
    ...distribution(tr('Idioma del sistema'), countBy(users, (user) => user.lo).map((row) => ({ label: row.key === '?' ? tr('Sin dato') : row.key, value: row.value }))),
    ...distribution(tr('Estudio acumulado desde el inicio'), [
      { label: tr('Sin estudio'), value: summary.studyBuckets.none },
      { label: tr('Menos de 1 h'), value: summary.studyBuckets.lt1h },
      { label: tr('De 1 a 5 h'), value: summary.studyBuckets.h1_5 },
      { label: tr('De 5 a 20 h'), value: summary.studyBuckets.h5_20 },
      { label: tr('20 h o más'), value: summary.studyBuckets.h20 },
    ])
  );
  const activityById = new Map(users.map((user) => [user.id, activityOf(user, range)]));
  const ownOf = (user: SnapUser) => activityById.get(user.id) ?? activityOf(user, range);
  const ranked = [...users].sort((a, b) => ownOf(b).minutes - ownOf(a).minutes || b.a.length - a.a.length);
  blocks.push(
    { kind: 'subheading', text: tr('Todos los estudiantes'), note: tr('Ordenados por estudio en el plazo.') },
    {
      kind: 'table',
      head: [tr('Estudiante'), tr('Lugar'), tr('Días activos'), tr('Estudio'), tr('Tareas'), tr('Racha'), tr('Versión'), tr('Última vez')],
      aligns: ['left', 'left', 'right', 'right', 'right', 'right', 'left', 'left'],
      weights: [20, 20, 9, 12, 8, 8, 11, 12],
      rows: ranked.map((user) => {
        const own = ownOf(user);
        return [
          c(displayName(user, tr('Invitado')), { bold: true, note: user.g ? tr('Invitado') : tr('Cuenta') }),
          c(placeOf(user)),
          right(String(own.activeDays)),
          right(minutesLabel(own.minutes)),
          right(String(own.tasks)),
          right(user.st === null ? '—' : String(user.st)),
          c(`${PLATFORM_LABEL[user.pl ?? ''] ?? '—'} ${user.ve ?? ''}`, isOutdated(user, newest) ? { tone: 'warn' } : {}),
          c(dayLabel(dayOfInstant(user.ls))),
        ];
      }),
    }
  );

  // ---------------- 5. Geografía ----------------
  blocks.push(section(tr('Dónde se usa Frame'), tr('Según la ciudad del clima de Inicio (aproximada; nunca la posición exacta).')));
  const maxContinent = Math.max(1, ...continents.map((group) => group.users));
  blocks.push(
    { kind: 'subheading', text: tr('Continentes') },
    {
      kind: 'bars',
      items: continents.map((group) => ({
        label: CONTINENT_LABEL[group.key as Continent | '?'](),
        value: tr('{n} estudiantes · {a} activos', { n: group.users, a: group.active }),
        percent: percent(group.users, maxContinent),
      })),
    },
    { kind: 'subheading', text: tr('Países'), note: tr('Cifras del plazo.') },
    {
      kind: 'table',
      head: [tr('País'), tr('Continente'), tr('Estudiantes'), tr('Activos'), tr('Estudio'), tr('Sesiones'), tr('Tareas'), tr('A tiempo'), tr('Hábitos'), tr('Enfoque')],
      aligns: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
      weights: [16, 13, 9, 8, 12, 9, 8, 9, 8, 8],
      rows: countries.map((group) => {
        const part = group.members.map(ownOf);
        const total = (key: keyof (typeof part)[number]) => sum(part.map((row) => row[key]));
        return [
          c(countryName(group.key)),
          c(CONTINENT_LABEL[(continentOf(group.key === '?' ? null : group.key) ?? '?') as Continent | '?']()),
          right(String(group.users)),
          right(String(group.active)),
          right(minutesLabel(group.minutes)),
          right(String(total('sessions'))),
          right(String(total('tasks'))),
          right(pctLabel(total('withDue') > 0 ? Math.round((total('onTime') / total('withDue')) * 100) : null)),
          right(pctLabel(total('habitsPossible') > 0 ? Math.round((total('habitsDone') / total('habitsPossible')) * 100) : null)),
          right(total('focusDays') > 0 ? decimalText(total('focusSum') / total('focusDays')) : '—'),
        ];
      }),
    },
    { kind: 'subheading', text: tr('Ciudades') },
    {
      kind: 'table',
      head: [tr('Ciudad'), tr('País'), tr('Estudiantes'), tr('Activos'), tr('Estudio en el plazo')],
      aligns: ['left', 'left', 'right', 'right', 'right'],
      weights: [28, 24, 15, 13, 20],
      rows: cities.map((group) => {
        const codes = [...new Set(group.members.map((user) => user.cc).filter(Boolean))] as string[];
        return [
          c(group.key === '?' ? tr('Sin ciudad') : group.key),
          c(codes.map(countryName).join(', ') || '—'),
          right(String(group.users)),
          right(String(group.active)),
          right(minutesLabel(group.minutes)),
        ];
      }),
    }
  );

  // ---------------- 6. Cuándo estudian ----------------
  const hours = hoursOf(study);
  const weekdays = weekdaysOf(study);
  const maxHour = Math.max(1, ...hours);
  const maxDay = Math.max(1, ...weekdays);
  const slen = sumMatrices(users.map((user) => user.sl), 5);
  const focus = sumMatrices(users.map((user) => user.fo), 5);
  const days = weekdayShort();
  blocks.push(section(tr('Cuándo estudian'), tr('Hora local de cada estudiante; estudio de los últimos 140 días.')));
  if (peak) blocks.push({ kind: 'callout', title: tr('La franja con más estudio'), text: tr('De {from} a {to}: {share} % de todo el tiempo de estudio.', { from: hourLabel(peak.start), to: hourLabel((peak.start + 3) % 24), share: peak.share }), tone: 'accent' });
  blocks.push(
    weekHeat(study, tr('Minutos de estudio por día de la semana y hora (lunes arriba).'), tr('Hora local de cada estudiante.')),
    { kind: 'subheading', text: tr('Por hora del día') },
    { kind: 'bars', items: hours.map((value, hour) => ({ label: hourLabel(hour), value: minutesLabel(value), percent: percent(value, maxHour) })) },
    { kind: 'subheading', text: tr('Por día de la semana') },
    { kind: 'bars', items: weekdays.map((value, day) => ({ label: days[day], value: minutesLabel(value), percent: percent(value, maxDay) })) },
    { kind: 'subheading', text: tr('Duración de las sesiones') },
    {
      kind: 'bars',
      items: [tr('< 15 min'), tr('15–30 min'), tr('30–60 min'), tr('1–2 h'), tr('2 h o más')].map((label, i) => ({ label, value: numberLabel(slen[i]), percent: percent(slen[i], Math.max(1, ...slen)) })),
    },
    { kind: 'subheading', text: tr('Enfoque que declaran (1–20)') },
    { kind: 'bars', items: ['1–4', '5–8', '9–12', '13–16', '17–20'].map((label, i) => ({ label, value: numberLabel(focus[i]), percent: percent(focus[i], Math.max(1, ...focus)) })) },
    weekHeat(snapshot.mx_open, tr('Aperturas de Frame por día de la semana y hora (todos los estudiantes, 400 días).'), tr('Hora local de cada estudiante.'))
  );

  // ---------------- 7. Funciones ----------------
  const screens = seriesTotals(snapshot.sc, range).filter((row) => row.key in SCREEN_LABEL);
  const events = seriesTotals(snapshot.ev, range).filter((row) => row.key in EVENT_LABEL);
  blocks.push(section(tr('Qué usan'), tr('Funciones, interfaces y actividad.')));
  blocks.push(
    {
      kind: 'bars',
      items: adoption.map((row) => ({ label: FEATURE_LABEL[row.key](), value: tr('{pct} % · {users} est. · {total} en total', { pct: row.pct, users: row.users, total: numberLabel(row.total) }), percent: row.pct })),
      caption: tr('Estudiantes que tienen al menos uno (de los que ya mandaron su perfil).'),
    },
    { kind: 'subheading', text: tr('Interfaces abiertas en el plazo'), note: tr('Una vez por estudiante y día.') },
    {
      kind: 'table',
      head: [tr('Interfaz'), tr('Veces'), tr('Días con uso'), tr('Estudiantes que la usan')],
      aligns: ['left', 'right', 'right', 'right'],
      weights: [40, 20, 20, 20],
      rows: screens.map((row) => [c(SCREEN_LABEL[row.key]()), right(numberLabel(row.count)), right(String(row.days)), right(String(users.filter((user) => (user.sc[row.key] ?? 0) > 0).length))]),
    },
    { kind: 'subheading', text: tr('Actividad en el plazo') },
    {
      kind: 'table',
      head: [tr('Qué'), tr('Veces'), tr('Días')],
      aligns: ['left', 'right', 'right'],
      weights: [60, 20, 20],
      rows: events.map((row) => [c(EVENT_LABEL[row.key]()), right(numberLabel(row.count)), right(String(row.days))]),
    },
    {
      kind: 'table',
      head: [tr('Informes generados (400 días)'), tr('Veces')],
      aligns: ['left', 'right'],
      weights: [70, 30],
      rows: Object.entries(snapshot.reports).map(([formatId, count]) => [c(formatId.toUpperCase()), right(numberLabel(count))]),
    }
  );

  // ---------------- 8. Retención ----------------
  const cohorts = cohortsOf(snapshot, 12, users);
  const stick = stickinessSeries(snapshot, { from: Math.max(range.from, range.to - 364), to: range.to }, users).filter((_, index, all) => index % 7 === (all.length - 1) % 7);
  blocks.push(section(tr('Retención'), tr('Quién vuelve y quién se va.')));
  blocks.push(
    {
      kind: 'kpis',
      items: [
        { label: tr('Vuelven la segunda semana'), value: pctLabel(back.pct), note: tr('{n} de {total}', { n: back.returned, total: back.eligible }) },
        { label: tr('Uso diario sobre el mensual'), value: pctLabel(summary.stickiness) },
        { label: tr('Sin abrir Frame 14 días'), value: numberLabel(sleeping.d14), note: tr('{n} llevan 30 o más', { n: sleeping.d30 }) },
        { label: tr('Activos en 30 días'), value: numberLabel(summary.active30) },
      ],
    },
    { kind: 'subheading', text: tr('Cohortes semanales'), note: tr('De quienes empezaron cada semana, porcentaje activo en las semanas siguientes.') },
    {
      kind: 'table',
      head: [tr('Semana del'), tr('Nuevos'), ...Array.from({ length: 12 }, (_, i) => String(i))],
      aligns: ['left', 'right', ...Array.from({ length: 12 }, () => 'right' as const)],
      weights: [14, 8, ...Array.from({ length: 12 }, () => 78 / 12)],
      rows: cohorts.map((cohort) => [
        c(dayLabel(cohort.monday)),
        right(String(cohort.size)),
        ...cohort.weeks.map((value) => right(value === null || cohort.size === 0 ? '' : String(value), value !== null && value >= 50 ? { fill: 'accent' } : {})),
      ]),
    },
    { kind: 'subheading', text: tr('Activos del día, de 7 y de 30 días'), note: tr('Una fila por semana.') },
    {
      kind: 'table',
      head: [tr('Día'), tr('Del día'), tr('De 7 días'), tr('De 30 días')],
      aligns: ['left', 'right', 'right', 'right'],
      weights: [40, 20, 20, 20],
      rows: stick.map((point) => [c(dayLabel(point.dn)), right(String(point.dau)), right(String(point.wau)), right(String(point.mau))]),
    }
  );

  // ---------------- 9. Impacto (el informe que ya existía) ----------------
  if (impact && typeof impact === 'object' && 'headline' in (impact as object)) {
    blocks.push(section(tr('Impacto'), tr('Semana 1 frente a semana 2 y siguientes, para todos los estudiantes (sin filtro).')));
    for (const block of buildImpactDoc(impact as ImpactData, null).blocks) {
      if (block.kind === 'cover' || block.kind === 'footer') continue;
      blocks.push(block.kind === 'section' ? { kind: 'subheading', text: block.title, note: block.note } : block);
    }
  }

  // ---------------- 10. Versiones y errores ----------------
  const versions = countBy(users, (user) => (user.pl && user.ve ? `${user.pl}|${user.ve}` : null));
  blocks.push(section(tr('Versiones y errores')));
  blocks.push(
    {
      kind: 'table',
      head: [tr('Sistema'), tr('Versión'), tr('Estudiantes'), '']
      ,
      aligns: ['left', 'left', 'right', 'left'],
      weights: [25, 25, 20, 30],
      rows: versions.map((row) => {
        const [platform, version] = row.key === '?' ? ['?', '?'] : row.key.split('|');
        return [c(PLATFORM_LABEL[platform] ?? platform), c(version), right(String(row.value)), c(version === newest[platform] ? tr('la más nueva') : '', { tone: 'ok' })];
      }),
    },
    {
      kind: 'kpis',
      items: [
        { label: tr('Errores abiertos'), value: numberLabel(snapshot.errors.open) },
        { label: tr('Corregidos'), value: numberLabel(snapshot.errors.fixed) },
        { label: tr('Ignorados'), value: numberLabel(snapshot.errors.ignored) },
      ],
    }
  );
  if (snapshot.errors.top.length > 0) {
    blocks.push({
      kind: 'table',
      head: [tr('Error abierto'), tr('Veces'), tr('Estudiantes'), tr('Versiones')],
      aligns: ['left', 'right', 'right', 'left'],
      weights: [55, 10, 13, 22],
      rows: snapshot.errors.top.map((item) => [c(`${item.scope} · ${item.name}`, { note: item.message }), right(String(item.n)), right(String(item.users)), c((item.versions ?? []).join(', '))]),
    });
  }

  // ---------------- Anexo A: día a día ----------------
  blocks.push({ kind: 'pagebreak' }, annex(tr('Anexo A · Día a día'), tr('Todas las cifras de cada día del plazo.')));
  blocks.push({
    kind: 'table',
    head: [tr('Día'), tr('Activos'), tr('Nuevos'), tr('Aperturas'), tr('Estudio'), tr('Sesiones'), tr('Tareas'), tr('Hábitos'), tr('Enfoque')],
    aligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
    weights: [16, 10, 9, 10, 15, 10, 9, 11, 10],
    rows: daily.map((point) => [
      c(dayLabel(point.from)),
      right(String(point.active)),
      right(String(point.newUsers)),
      right(String(point.opens)),
      right(minutesLabel(point.minutes)),
      right(String(point.sessions)),
      right(String(point.tasks)),
      right(pctLabel(point.habitsPct)),
      right(point.focus === null ? '—' : decimalText(point.focus)),
    ]),
  });

  // ---------------- Anexo B: tendencia de largo plazo ----------------
  // Sea cual sea el plazo elegido: las últimas 26 semanas y los últimos 13
  // meses, para ver hacia dónde va Frame y no solo cómo le fue este mes.
  const trendRow = (point: (typeof series)[number], label: string): DocCell[] => [
    c(label),
    right(String(point.active)),
    right(String(point.newUsers)),
    right(String(point.opens)),
    right(minutesLabel(point.minutes)),
    right(String(point.sessions)),
    right(String(point.tasks)),
    right(pctLabel(point.habitsPct)),
    right(point.focus === null ? '—' : decimalText(point.focus)),
  ];
  const trendHead = [tr('Tramo'), tr('Activos'), tr('Nuevos'), tr('Aperturas'), tr('Estudio'), tr('Sesiones'), tr('Tareas'), tr('Hábitos'), tr('Enfoque')];
  const trendAligns: ('left' | 'right')[] = ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'];
  const firstMonth = (() => {
    const date = new Date(Date.UTC(2024, 0, 1) + (snapshot.today - 364) * 86_400_000);
    return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - Date.UTC(2024, 0, 1)) / 86_400_000);
  })();
  const months = seriesOf(snapshot, { from: Math.max(snapshot.since, firstMonth), to: snapshot.today }, 'month', users);
  const weeks = seriesOf(snapshot, { from: Math.max(snapshot.since, mondayOf(snapshot.today) - 25 * 7), to: snapshot.today }, 'week', users);
  const maxMonth = Math.max(1, ...months.map((point) => point.active));
  blocks.push(
    { kind: 'pagebreak' },
    annex(tr('Anexo B · Tendencia de largo plazo'), tr('Los últimos 13 meses y las últimas 26 semanas, sea cual sea el plazo del reporte.')),
    {
      kind: 'bars',
      items: months.map((point) => ({
        label: format(new Date(Date.UTC(2024, 0, 1) + point.from * 86_400_000 + 43_200_000), tr('MMMM yyyy'), { locale: dateLocale() }),
        value: tr('{n} activos · {m}', { n: point.active, m: minutesLabel(point.minutes) }),
        percent: percent(point.active, maxMonth),
      })),
      caption: tr('Estudiantes activos cada mes y su estudio.'),
    },
    {
      kind: 'table',
      head: trendHead,
      aligns: trendAligns,
      weights: [20, 9, 9, 10, 14, 10, 9, 10, 9],
      rows: months.map((point) => trendRow(point, format(new Date(Date.UTC(2024, 0, 1) + point.from * 86_400_000 + 43_200_000), tr('MMM yyyy'), { locale: dateLocale() }))),
    },
    { kind: 'subheading', text: tr('Semana a semana') },
    {
      kind: 'table',
      head: trendHead,
      aligns: trendAligns,
      weights: [20, 9, 9, 10, 14, 10, 9, 10, 9],
      rows: weeks.map((point) => trendRow(point, bucketLabel(point.from, point.to))),
    }
  );

  // ---------------- Anexo C: una ficha por estudiante ----------------
  // Lo de arriba ocupa unas 25 páginas fijas más sus tablas largas.
  const basePages = 25 + Math.ceil(daily.length / 38) + Math.ceil(users.length / 30) + Math.ceil(countries.length / 38) + Math.ceil(cities.length / 38) + Math.ceil(series.length / 38);
  const fichas = Math.max(0, Math.min(ranked.length, PAGE_BUDGET - basePages));
  if (fichas > 0) {
    blocks.push(
      { kind: 'pagebreak' },
      annex(
        tr('Anexo C · Ficha de cada estudiante'),
        fichas < ranked.length
          ? tr('Los {n} con más estudio en el plazo; los demás están en la tabla de estudiantes.', { n: fichas })
          : tr('Ordenadas por estudio en el plazo.')
      )
    );
    ranked.slice(0, fichas).forEach((user, index) => {
      const own = ownOf(user);
      const detail = details.get(user.id);
      const continent = continentOf(user.cc);
      if (index > 0) blocks.push({ kind: 'pagebreak' });
      blocks.push(
        { kind: 'subheading', text: displayName(user, tr('Invitado')), note: `${user.g ? tr('Invitado') : tr('Cuenta')} · ${placeOf(user)} · ${tr('desde el {day}', { day: longDayLabel(firstDayOf(user)) })}` },
        {
          kind: 'kpis',
          items: [
            { label: tr('Estudio en el plazo'), value: minutesLabel(own.minutes), note: tr('{n} sesiones', { n: own.sessions }) },
            { label: tr('Días activos'), value: String(activeDaysIn(user, range)), note: LEVEL_LABEL[levelOf(user, range)]() },
            { label: tr('Tareas culminadas'), value: String(own.tasks), note: tr('{pct} a tiempo', { pct: pctLabel(own.withDue > 0 ? Math.round((own.onTime / own.withDue) * 100) : null) }) },
            { label: tr('Racha'), value: user.st === null ? '—' : String(user.st), note: tr('mejor: {n}', { n: user.bs ?? '—' }) },
          ],
        },
        {
          kind: 'table',
          head: [tr('Dato'), tr('Valor'), tr('Dato'), tr('Valor')],
          weights: [20, 30, 20, 30],
          rows: [
            [c(tr('Ciudad y región'), { tone: 'muted' }), c([user.ci, user.re].filter(Boolean).join(', ') || '—'), c(tr('País y continente'), { tone: 'muted' }), c(`${user.cc ? countryName(user.cc) : user.co ?? '—'}${continent ? ` · ${CONTINENT_LABEL[continent]()}` : ''}`)],
            [c(tr('Zona horaria'), { tone: 'muted' }), c(user.tz ?? '—'), c(tr('Idioma'), { tone: 'muted' }), c(`${user.la ? LANG_LABEL[user.la]?.() ?? user.la : '—'} · ${user.lo ?? '—'}`)],
            [c(tr('Equipo'), { tone: 'muted' }), c(`${user.dv ? DEVICE_LABEL[user.dv]?.() ?? user.dv : '—'} · ${PLATFORM_LABEL[user.pl ?? ''] ?? '—'} ${user.ve ?? ''}`), c(tr('Última vez'), { tone: 'muted' }), c(longDayLabel(dayOfInstant(user.ls)))],
            [c(tr('Constancia de hábitos'), { tone: 'muted' }), c(pctLabel(own.habitsPossible > 0 ? Math.round((own.habitsDone / own.habitsPossible) * 100) : null)), c(tr('Enfoque medio'), { tone: 'muted' }), c(own.focusDays > 0 ? `${decimalText(Math.round((own.focusSum / own.focusDays) * 10) / 10)} / 20` : '—')],
          ],
        }
      );
      if (user.mx && Math.max(...user.mx) > 0) blocks.push(weekHeat(user.mx, tr('Cuándo estudia (últimos 140 días).'), tr('Hora local del estudiante.')));
      const features = FEATURE_KEYS.map((key) => ({ key, value: featureValue(user, key) })).filter((row) => row.value > 0);
      const screens = Object.entries(user.sc).filter(([screen, days]) => screen in SCREEN_LABEL && days > 0).sort((a, b) => b[1] - a[1]);
      blocks.push({
        kind: 'table',
        head: [tr('Funciones que usa'), tr('Elementos'), tr('Interfaces que abre'), tr('Días')],
        aligns: ['left', 'right', 'left', 'right'],
        weights: [32, 14, 36, 18],
        rows: Array.from({ length: Math.max(features.length, Math.min(screens.length, 12), 1) }, (_, i) => [
          c(features[i] ? FEATURE_LABEL[features[i].key]() : i === 0 ? tr('Aún sin perfil') : ''),
          right(features[i] ? numberLabel(features[i].value) : ''),
          c(screens[i] ? SCREEN_LABEL[screens[i][0]]() : ''),
          right(screens[i] ? String(screens[i][1]) : ''),
        ]),
      });
      if (detail && detail.weeks.length > 0) {
        blocks.push({
          kind: 'table',
          head: [tr('Semana del'), tr('Estudio'), tr('Días'), tr('Tareas'), tr('A tiempo'), tr('Enfoque'), tr('Hábitos')],
          aligns: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
          weights: [20, 16, 10, 12, 14, 14, 14],
          rows: detail.weeks.slice(-6).map(([monday, minutes, , days, tasks, onTime, withDue, focusAvg, habits]) => [
            c(dayLabel(dayOfInstant(`${monday}T17:00:00Z`))),
            right(minutesLabel(minutes)),
            right(String(days)),
            right(String(tasks)),
            right(pctLabel(withDue > 0 ? Math.round((onTime / withDue) * 100) : null)),
            right(focusAvg === null ? '—' : decimalText(Number(focusAvg))),
            right(pctLabel(habits)),
          ]),
        });
      }
    });
  }

  blocks.push({ kind: 'footer', text: tr('Frame · VT Asvent · Reporte de uso · datos calculados el {when}', { when: generated }) });
  return { title: tr('Frame - Reporte de uso'), blocks };
}
