// Lo único que el motor de la 1.6.8 tomaba de sync-check.ts: el nombre del
// evento de «Sincronizar ahora». El verificador de hoy arrastra módulos (el
// horario, desde la 1.9.0) que piden a sync-merge cosas que el de la 1.6.8 no
// tenía, y el probador nunca arranca el verificador en estos equipos.
export const SYNC_NOW_EVENT = 'frame:sync-now';
