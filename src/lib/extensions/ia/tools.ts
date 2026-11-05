// ============================================================
// Conexiones con IA (1.7.3): las herramientas que Frame ofrece por MCP.
//
// Se escriben en `tools.json` (src-tauri/src/ia_bridge.rs) para que la IA
// las vea aunque Frame esté cerrada. Las descripciones son para el modelo,
// no para la interfaz: van en español y no pasan por `tr()`.
// Nada de personalización (temas, colores, ajustes): solo los datos útiles.
// ============================================================

export const IA = 'frame.ia';

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface IaTool {
  name: string;
  title: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  annotations: Annotations & { title?: string };
}

const text = (description: string) => ({ type: 'string', description });
const day = (description: string) => ({ type: 'string', description: `${description} Formato AAAA-MM-DD.`, pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const oneOf = (values: string[], description: string) => ({ type: 'string', enum: values, description });
const int = (description: string, minimum?: number, maximum?: number) => ({ type: 'integer', description, minimum, maximum });
const bool = (description: string) => ({ type: 'boolean', description });

const ID = text('Identificador que devolvió una herramienta de listado.');
const COURSE = text('Asignatura: su id o su nombre (sin importar mayúsculas ni tildes).');
const PRIORITY = oneOf(['Baja', 'Media', 'Alta'], 'Urgencia.');
const KIND = oneOf(['Tarea', 'Examen', 'Proyecto', 'Actividad', 'Personal'], 'Naturaleza del pendiente.');
const DIFFICULTY = oneOf(['Fácil', 'Media', 'Difícil'], 'Dificultad percibida.');
const DUE = text('Fecha límite: AAAA-MM-DD, o AAAA-MM-DDTHH:mm con hora local. Cadena vacía para quitarla.');
const PHASE = oneOf(['mañana', 'tarde', 'noche', 'todo el día'], 'Momento del día en que toca.');
const DAYS = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  description: 'Días de la semana en que toca (0 = domingo … 6 = sábado). Vacío o los siete = cada día.',
};
const EVENT_KIND = oneOf(
  ['entrega', 'evento', 'examen', 'personal', 'libre', 'vacaciones', 'reunion', 'salida', 'cumple', 'recordatorio', 'otro'],
  'Tipo de evento ("libre" = día sin clases).'
);
const SCOPE = oneOf(['semana', 'mes', 'anio'], 'Periodo: la semana, el mes o el año que contiene la fecha de referencia.');

function tool(
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
  annotations: Annotations = {}
): IaTool {
  return {
    name,
    title,
    description,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
    annotations: { title, openWorldHint: false, ...annotations },
  };
}

const READ: Annotations = { readOnlyHint: true };
const WRITE: Annotations = { readOnlyHint: false, destructiveHint: false };
const ERASE: Annotations = { readOnlyHint: false, destructiveHint: true };

export const IA_TOOLS: IaTool[] = [
  tool('resumen_de_hoy', 'Resumen de hoy', 'Fecha y hora de hoy, pendientes que vencen pronto o ya vencieron, eventos de hoy, hábitos de hoy, minutos estudiados y lo que suena. Úsala primero para orientarte.', {}, [], READ),

  // --- Tareas ---
  tool(
    'listar_tareas',
    'Listar tareas',
    'Tareas de Frame. Por defecto, las pendientes de todas las asignaturas, de la más próxima a la más lejana.',
    {
      estado: oneOf(['pendientes', 'culminadas', 'incompletas'], 'Cuáles: las pendientes (por defecto), las culminadas o las que no se pudieron terminar.'),
      asignatura: COURSE,
      buscar: text('Texto que debe aparecer en el nombre o la descripción.'),
      desde: day('Solo las que vencen desde este día.'),
      hasta: day('Solo las que vencen hasta este día.'),
      limite: int('Máximo de resultados (por defecto 50).', 1, 200),
    },
    [],
    READ
  ),
  tool(
    'crear_tarea',
    'Crear tarea',
    'Crea una tarea pendiente. Sin asignatura queda como tarea suelta en Inicio.',
    {
      nombre: text('Nombre de la tarea.'),
      asignatura: COURSE,
      descripcion: text('Detalle.'),
      fecha_limite: DUE,
      prioridad: PRIORITY,
      tipo: KIND,
      dificultad: DIFFICULTY,
      minutos_estimados: int('Tiempo estimado en minutos.', 0, 6000),
    },
    ['nombre'],
    WRITE
  ),
  tool(
    'editar_tarea',
    'Editar tarea',
    'Cambia los campos que se indiquen de una tarea pendiente.',
    {
      id: ID,
      nombre: text('Nombre nuevo.'),
      asignatura: text('Asignatura nueva (id o nombre); cadena vacía para dejarla suelta.'),
      descripcion: text('Detalle nuevo.'),
      fecha_limite: DUE,
      prioridad: PRIORITY,
      tipo: KIND,
      dificultad: DIFFICULTY,
      progreso: int('Avance en %.', 0, 100),
      minutos_estimados: int('Tiempo estimado en minutos (0 lo quita).', 0, 6000),
    },
    ['id'],
    WRITE
  ),
  tool('culminar_tarea', 'Culminar tarea', 'Marca una tarea como culminada: sale de pendientes y queda en el archivo de su asignatura.', { id: ID }, ['id'], WRITE),
  tool('marcar_tarea_incompleta', 'Marcar tarea incompleta', 'Retira una tarea de pendientes como «no se pudo terminar» (no cuenta como culminada).', { id: ID }, ['id'], WRITE),
  tool('borrar_tarea', 'Borrar tarea', 'Borra una tarea pendiente sin archivarla. Frame pide confirmación al usuario.', { id: ID }, ['id'], ERASE),

  // --- Asignaturas y colecciones ---
  tool('listar_asignaturas', 'Listar asignaturas', 'Asignaturas con su profesor, su colección y cuántas tareas tienen pendientes.', {}, [], READ),
  tool('crear_asignatura', 'Crear asignatura', 'Crea una asignatura.', { nombre: text('Nombre.'), profesor: text('Profesor o profesora.') }, ['nombre'], WRITE),
  tool('editar_asignatura', 'Editar asignatura', 'Cambia el nombre o el profesor de una asignatura.', { asignatura: COURSE, nombre: text('Nombre nuevo.'), profesor: text('Profesor nuevo.') }, ['asignatura'], WRITE),
  tool(
    'borrar_asignatura',
    'Borrar asignatura',
    'Borra una asignatura con sus tareas, recursos y archivo (las grabaciones quedan sueltas). Frame pide confirmación al usuario; durante unos segundos se puede deshacer con Ctrl+Z en Frame.',
    { asignatura: COURSE },
    ['asignatura'],
    ERASE
  ),
  tool('listar_colecciones', 'Listar colecciones', 'Colecciones (grupos de asignaturas) con sus asignaturas.', {}, [], READ),
  tool(
    'crear_coleccion',
    'Crear colección',
    'Crea una colección de asignaturas.',
    { nombre: text('Nombre.'), asignaturas: { type: 'array', items: { type: 'string' }, description: 'Asignaturas (id o nombre).' } },
    ['nombre'],
    WRITE
  ),
  tool(
    'editar_coleccion',
    'Editar colección',
    'Cambia el nombre o las asignaturas de una colección (la lista de asignaturas reemplaza a la anterior).',
    { id: ID, nombre: text('Nombre nuevo.'), asignaturas: { type: 'array', items: { type: 'string' }, description: 'Asignaturas (id o nombre).' } },
    ['id'],
    WRITE
  ),

  // --- Hábitos ---
  tool(
    'listar_habitos',
    'Listar hábitos',
    'Hábitos con su momento del día, sus días, si tocan y están hechos hoy, y lo hecho en los últimos 7 días.',
    { incluir_archivados: bool('También los archivados.') },
    [],
    READ
  ),
  tool('crear_habito', 'Crear hábito', 'Crea un hábito.', { nombre: text('Nombre.'), momento: PHASE, dias: DAYS }, ['nombre'], WRITE),
  tool(
    'editar_habito',
    'Editar hábito',
    'Cambia un hábito: nombre, momento, días o si está archivado.',
    { id: ID, nombre: text('Nombre nuevo.'), momento: PHASE, dias: DAYS, archivado: bool('Archivarlo (true) o devolverlo (false).') },
    ['id'],
    WRITE
  ),
  tool(
    'marcar_habito',
    'Marcar hábito',
    'Marca un hábito como hecho (o no hecho) un día; por defecto, hoy.',
    { id: ID, fecha: day('Día (por defecto, hoy).'), hecho: bool('true = hecho (por defecto); false = quitar la marca.') },
    ['id'],
    { ...WRITE, idempotentHint: true }
  ),
  tool('borrar_habito', 'Borrar hábito', 'Borra un hábito con todo su historial. Frame pide confirmación al usuario. Para guardarlo sin verlo, mejor editar_habito con archivado = true.', { id: ID }, ['id'], ERASE),

  // --- Calendario ---
  tool(
    'listar_eventos',
    'Listar eventos',
    'Eventos del calendario de Frame en un rango (por defecto, de hoy a 30 días). Con incluir_tareas, también las tareas que vencen en él.',
    { desde: day('Primer día.'), hasta: day('Último día.'), incluir_tareas: bool('Añadir las tareas pendientes que vencen en el rango.') },
    [],
    READ
  ),
  tool(
    'crear_evento',
    'Crear evento',
    'Crea un evento en el calendario de Frame.',
    {
      titulo: text('Título.'),
      fecha: day('Día del evento.'),
      fecha_fin: day('Último día, si dura varios.'),
      hora: text('Hora local HH:mm; sin ella es de todo el día.'),
      tipo: EVENT_KIND,
      nombre_tipo: text('Nombre del tipo cuando tipo = "otro".'),
      descripcion: text('Detalle.'),
      color: text('Color hex (#RRGGBB o #RRGGBBAA). Opcional.'),
    },
    ['titulo', 'fecha'],
    WRITE
  ),
  tool(
    'editar_evento',
    'Editar evento',
    'Cambia los campos que se indiquen de un evento. Cadena vacía en fecha_fin u hora para quitarlas.',
    {
      id: ID,
      titulo: text('Título nuevo.'),
      fecha: day('Día nuevo.'),
      fecha_fin: text('Último día (AAAA-MM-DD) o cadena vacía.'),
      hora: text('Hora HH:mm o cadena vacía.'),
      tipo: EVENT_KIND,
      nombre_tipo: text('Nombre del tipo cuando tipo = "otro".'),
      descripcion: text('Detalle nuevo.'),
      color: text('Color hex nuevo.'),
    },
    ['id'],
    WRITE
  ),
  tool('borrar_evento', 'Borrar evento', 'Borra un evento del calendario. Frame pide confirmación al usuario.', { id: ID }, ['id'], ERASE),

  // --- Sesiones de estudio ---
  tool(
    'listar_sesiones',
    'Listar sesiones',
    'Sesiones de estudio registradas, de la más reciente a la más antigua, y si hay una en curso.',
    { desde: day('Desde este día.'), hasta: day('Hasta este día.'), limite: int('Máximo (por defecto 20).', 1, 200) },
    [],
    READ
  ),
  tool(
    'editar_sesion',
    'Editar sesión',
    'Corrige la percepción o la nota de una sesión. Solo las de hoy: las anteriores quedan cerradas.',
    { id: ID, percepcion: int('Enfoque percibido, de 1 a 20.', 1, 20), notas: text('Anotación de lo que se hizo.') },
    ['id'],
    WRITE
  ),
  tool('borrar_sesion', 'Borrar sesión', 'Borra una sesión de hoy (las anteriores no se pueden borrar). Frame pide confirmación al usuario.', { id: ID }, ['id'], ERASE),

  // --- Recursos de las asignaturas ---
  tool(
    'listar_recursos',
    'Listar recursos',
    'Recursos (anotaciones, enlaces y archivos) de una asignatura.',
    { asignatura: COURSE, buscar: text('Texto que debe aparecer.') },
    ['asignatura'],
    READ
  ),
  tool(
    'crear_recurso',
    'Crear recurso',
    'Añade a una asignatura una anotación de texto o un enlace.',
    { asignatura: COURSE, texto: text('Texto de la anotación, o título del enlace.'), enlace: text('URL (http o https) si es un enlace.') },
    ['asignatura'],
    WRITE
  ),
  tool('editar_recurso', 'Editar recurso', 'Cambia el texto o el enlace de un recurso.', { id: ID, texto: text('Texto nuevo.'), enlace: text('URL nueva.') }, ['id'], WRITE),
  tool('borrar_recurso', 'Borrar recurso', 'Quita un recurso de su asignatura (queda en el archivo de la asignatura). Frame pide confirmación al usuario.', { id: ID }, ['id'], ERASE),

  // --- Música ---
  tool(
    'buscar_canciones',
    'Buscar canciones',
    'Canciones de la biblioteca de este equipo. Sin texto, las primeras de la biblioteca.',
    { buscar: text('Título, artista o álbum.'), solo_favoritas: bool('Solo las favoritas.'), limite: int('Máximo (por defecto 25).', 1, 200) },
    [],
    READ
  ),
  tool(
    'reproducir_cancion',
    'Reproducir canción',
    'Pone a sonar una canción en Frame (por id o por búsqueda; con búsqueda, la que mejor coincide). Después sigue la biblioteca.',
    { id: text('Id de buscar_canciones.'), buscar: text('Título y/o artista.') },
    [],
    WRITE
  ),
  tool(
    'controlar_musica',
    'Controlar música',
    'Pausa, reanuda, salta o consulta lo que suena.',
    { accion: oneOf(['estado', 'pausar', 'reanudar', 'siguiente', 'anterior', 'aleatorio_si', 'aleatorio_no'], 'Qué hacer.') },
    ['accion'],
    WRITE
  ),
  tool('listar_playlists', 'Listar playlists', 'Playlists con cuántas canciones tienen en este equipo.', {}, [], READ),
  tool(
    'reproducir_playlist',
    'Reproducir playlist',
    'Pone a sonar una playlist desde el principio o en orden aleatorio.',
    { playlist: text('Id o nombre de la playlist.'), aleatorio: bool('Empezar por una al azar y mezclar.') },
    ['playlist'],
    WRITE
  ),

  // --- Informes ---
  tool(
    'ver_informe',
    'Ver informe',
    'Devuelve en Markdown el informe de rendimiento (estudio, tareas, hábitos, metas) o el de pendientes de un periodo.',
    { tipo: oneOf(['rendimiento', 'pendientes'], 'Qué informe.'), periodo: SCOPE, fecha: day('Un día del periodo (por defecto, hoy).') },
    ['tipo'],
    READ
  ),
  tool(
    'crear_informe',
    'Crear informe',
    'Guarda el informe como documento Word (.docx) o Markdown (.md) en la carpeta de informes de Frame y devuelve dónde quedó.',
    {
      tipo: oneOf(['rendimiento', 'pendientes'], 'Qué informe.'),
      periodo: SCOPE,
      fecha: day('Un día del periodo (por defecto, hoy).'),
      formato: oneOf(['docx', 'md'], 'Formato (por defecto docx).'),
    },
    ['tipo'],
    WRITE
  ),
];

export const IA_INSTRUCTIONS =
  'Frame es la app de estudio del usuario. Estas herramientas leen y cambian sus datos en este equipo: tareas, asignaturas, colecciones, hábitos, calendario, sesiones de estudio, recursos, música e informes. ' +
  'Empieza por resumen_de_hoy para saber la fecha. Usa los id que devuelven los listados. Las herramientas que borran piden confirmación al usuario dentro de Frame; si la rechaza, no insistas. ' +
  'No cambies nada que el usuario no haya pedido.';

export const isDestructive = (name: string): boolean => IA_TOOLS.some((t) => t.name === name && t.annotations.destructiveHint);
export const isReadOnly = (name: string): boolean => IA_TOOLS.some((t) => t.name === name && t.annotations.readOnlyHint);
