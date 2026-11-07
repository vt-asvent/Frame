-- Frame · IA en la nube. Un «dueño» es una cuenta de Frame (su id de Supabase).
-- Aquí no hay datos de Frame: solo los permisos de los chats, y los códigos y
-- llaves van como huella SHA-256, nunca en claro.

-- Chats registrados (registro dinámico de OAuth). `used`: ya obtuvo acceso.
CREATE TABLE clients (id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', redirects TEXT NOT NULL, secret TEXT, created INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);

-- Códigos de emparejamiento que muestra Frame (10 min, se gastan al usarse).
CREATE TABLE pairings (code TEXT PRIMARY KEY, owner TEXT NOT NULL, expires INTEGER NOT NULL, tries INTEGER NOT NULL DEFAULT 0);
CREATE INDEX pairings_owner ON pairings(owner);

-- Códigos de autorización de OAuth (5 min, un solo uso).
CREATE TABLE grants (code TEXT PRIMARY KEY, client TEXT NOT NULL, owner TEXT NOT NULL, challenge TEXT NOT NULL, redirect TEXT NOT NULL, expires INTEGER NOT NULL);

-- Llaves de refresco de cada chat conectado. `since`: cuándo se conectó.
CREATE TABLE sessions (token TEXT PRIMARY KEY, client TEXT NOT NULL, owner TEXT NOT NULL, expires INTEGER NOT NULL, since INTEGER NOT NULL);
CREATE INDEX sessions_owner ON sessions(owner);
