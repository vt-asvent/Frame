-- AK Lore → Biblioteca (Frame 1.9.4): la vista previa de los documentos
-- destacados (las guías): la primera página, en una imagen pequeña (JPEG de
-- unos 30 KB) que se genera al subir el archivo. Va aquí y no en Drive: son
-- pocas y así llegan en una sola consulta, sin gastar el tope de descargas.
CREATE TABLE lore_vistas (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  datos BLOB NOT NULL
);
