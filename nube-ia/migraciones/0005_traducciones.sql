-- Música → letra → «Traducción» (Frame 1.9.2): cuántas letras traduce cada
-- cuenta al día, para el cupo (src/letras.ts). Ni letras ni traducciones: solo
-- la cuenta. La limpieza diaria borra los días pasados.
CREATE TABLE traducciones (owner TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, day));
