-- Frame 1.9.1: cuántas neuronas de Workers AI gasta todo Frame cada día (UTC),
-- para leer con Qwen mientras quede margen en la cuota gratuita y pasar a
-- Gemma, más barato, cuando se acerque el tope (src/horario.ts). Sin cuentas
-- ni fotos. La limpieza diaria borra los días pasados.
CREATE TABLE neuronas (day TEXT PRIMARY KEY, n REAL NOT NULL DEFAULT 0);
