import { tr } from '@/lib/i18n';
import { MANIFEST_FORMAT, type ExtensionManifest } from './manifest';

// ============================================================
// Catálogo oficial de extensiones (1.7.3). Su código viene dentro de Frame;
// el usuario decide cuáles instala, y al instalar acepta sus permisos.
// Las de terceros entran por archivo (manifest.ts) y son solo datos.
// ============================================================

export type OfficialId = 'frame.notion' | 'frame.wire' | 'frame.animaciones' | 'frame.aklore' | 'frame.ia';

export interface OfficialExtension {
  id: OfficialId;
  manifest: () => ExtensionManifest;
  /**
   * Solo la ven las cuentas con correo (no los invitados): para usarla hay que
   * activarla en la nube de Frame (la Biblioteca, con el correo institucional).
   */
  needsAccount?: boolean;
  /** Sin instalar, solo aparece al buscarla por su nombre (como las del catálogo). */
  searchOnly?: boolean;
}

const official = (
  id: OfficialId,
  name: string | (() => string),
  description: () => string,
  permissions: ExtensionManifest['permissions']
): (() => ExtensionManifest) => () => ({
  format: MANIFEST_FORMAT,
  id,
  name: typeof name === 'function' ? name() : name,
  version: '1.0.0',
  author: 'Asvent',
  description: description(),
  permissions,
});

export const OFFICIAL_EXTENSIONS: OfficialExtension[] = [
  {
    id: 'frame.wire',
    manifest: official(
      'frame.wire',
      'Wire',
      () =>
        tr('Lleva tus canciones, adjuntos e imágenes propias a tus otros equipos usando tu Google Drive como relevo. Cuando todos los tienen, se borran de Drive, salvo lo que marques para siempre.'),
      ['google.drive', 'music.read', 'music.write']
    ),
  },
  {
    id: 'frame.notion',
    manifest: official(
      'frame.notion',
      'Notion',
      () => tr('Trae tus tareas y fechas desde una exportación de Notion, sin cuentas ni claves. Al volver a importar no se duplica nada.'),
      ['files.pick', 'tasks.write', 'calendar.write']
    ),
  },
  {
    id: 'frame.animaciones',
    manifest: official(
      'frame.animaciones',
      () => tr('Animaciones'),
      () => tr('Elige animaciones de fondo (vuelve la constelación), pon tu propia imagen de fondo y usa mods de apariencia.'),
      ['appearance', 'files.pick']
    ),
  },
  {
    id: 'frame.ia',
    manifest: official(
      'frame.ia',
      () => tr('Conexiones con IA'),
      () =>
        tr('Deja que Claude, ChatGPT, Gemini y otras IA manejen Frame, en este equipo o desde la web: tareas, asignaturas, hábitos, calendario, sesiones, informes y música. Para borrar, Frame te pide confirmación.'),
      ['data.read', 'data.write']
    ),
  },
  {
    id: 'frame.aklore',
    manifest: official(
      'frame.aklore',
      () => tr('Biblioteca'),
      () =>
        tr('Guías, exámenes pasados, esquemas de calificación y ejemplos del Programa del Diploma, con buscador, filtros, favoritos y descarga por colección. Se activa con tu correo institucional.'),
      ['school.account']
    ),
    needsAccount: true,
    searchOnly: true,
  },
];

export const officialById = (id: string): OfficialExtension | undefined => OFFICIAL_EXTENSIONS.find((e) => e.id === id);
