-- Biblioteca: qué archivos pidió hoy cada cuenta. La primera petición de un archivo
-- en el día lo «abre» y cuenta para el tope de archivos, empiece por el byte que
-- empiece; las siguientes ya no (lore.ts, `contarDescarga`). Una fila por archivo y
-- día, sin índice aparte: una sola escritura. La limpieza diaria borra los días pasados.
-- «IF NOT EXISTS»: la nube también la crea sola si la echa en falta (`asegurarAbiertos`).
CREATE TABLE IF NOT EXISTS lore_abiertos (
  owner TEXT NOT NULL,
  day TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY (owner, day, id)
) WITHOUT ROWID;
