-- Inicio → Horario (Frame 1.9.0): cuántas fotos de horario lee cada cuenta al
-- día, para el cupo (src/horario.ts). Ni fotos ni clases: solo la cuenta. La
-- limpieza diaria borra los días pasados.
CREATE TABLE lecturas (owner TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (owner, day));
