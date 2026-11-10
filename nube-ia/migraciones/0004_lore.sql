-- AK Lore → Biblioteca (Frame 1.9.2): el índice del material que está en el
-- Drive de Asvent y lo que descarga cada cuenta al día (tope, ver lore.ts).
CREATE TABLE lore (
  id TEXT PRIMARY KEY,
  drive_id TEXT NOT NULL,
  title TEXT NOT NULL,
  subject TEXT NOT NULL,
  section TEXT NOT NULL,
  kind TEXT NOT NULL,
  component TEXT,
  lang TEXT,
  year INTEGER,
  size INTEGER NOT NULL,
  pages INTEGER,
  summary TEXT,
  format TEXT NOT NULL,
  updated TEXT NOT NULL
);

CREATE TABLE lore_descargas (
  owner TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, day)
);
