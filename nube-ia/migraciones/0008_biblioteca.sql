-- Biblioteca 2 (Frame 1.9.7): el índice sale de la carpeta «AK Lore» del Drive
-- de Asvent, tal como está. La nube la lee entera cada 5 minutos (biblioteca.ts)
-- y guarda aquí lo que vio: carpetas, archivos y accesos directos, con su
-- descripción y sus propiedades. Mover, renombrar o subir algo en Drive basta.
-- `miniatura` es el enlace temporal de Drive a la portada (dura horas): solo se
-- usa para copiarla a `lore_vistas` y nunca sale de aquí.
CREATE TABLE lore_nodos (
  id TEXT PRIMARY KEY,
  padre TEXT,
  nombre TEXT NOT NULL,
  mime TEXT NOT NULL,
  descripcion TEXT,
  props TEXT,
  tamano INTEGER,
  modificado TEXT,
  huella TEXT,
  destino TEXT,
  version TEXT,
  miniatura TEXT,
  pendiente INTEGER NOT NULL DEFAULT 0,
  intentos INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX lore_nodos_padre ON lore_nodos (padre);

CREATE INDEX lore_nodos_pendiente ON lore_nodos (pendiente) WHERE pendiente = 1;

-- La carpeta raíz, la configuración (biblioteca.json) y el índice ya armado,
-- en partes de 400 nodos: la app lo pide con una lectura por parte.
CREATE TABLE lore_estado (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

-- La portada de cada archivo, con la versión de Drive de la que salió.
ALTER TABLE lore_vistas ADD COLUMN version TEXT;
