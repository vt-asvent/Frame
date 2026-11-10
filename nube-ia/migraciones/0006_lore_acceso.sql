-- AK Lore → Biblioteca (Frame 1.9.3): se activa con un código enviado al
-- correo del colegio (ver src/lore-acceso.ts). Del correo solo se guarda una
-- huella con clave; del código, también.

-- El código vivo de cada cuenta de Frame (uno; pedir otro lo reemplaza).
CREATE TABLE lore_codigos (
  owner TEXT PRIMARY KEY,
  correo TEXT NOT NULL,
  codigo TEXT NOT NULL,
  expires INTEGER NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0
);

-- Cuentas de Frame con la Biblioteca activada, y con la huella de qué correo.
CREATE TABLE lore_accesos (
  owner TEXT PRIMARY KEY,
  correo TEXT NOT NULL,
  since INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX lore_accesos_correo ON lore_accesos (correo);

-- Freno de envíos: por cuenta y por correo cada hora, y de todo Frame cada día.
CREATE TABLE lore_envios (
  clave TEXT NOT NULL,
  tramo TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (clave, tramo)
);
