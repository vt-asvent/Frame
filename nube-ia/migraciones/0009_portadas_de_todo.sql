-- Biblioteca (Frame 1.9.8): cada tarjeta enseña la primera página de su archivo,
-- también las de exámenes, esquemas, bancos, simulacros y pruebas del colegio,
-- que antes dibujaba la app; y más nítida (640 px en vez de 400), porque las
-- tarjetas son más grandes. Todas vuelven a la cola: la lectura de cada 5
-- minutos renueva su enlace y las copia de a pocas. Mientras, sigue la anterior.
UPDATE lore_nodos SET pendiente = 1, intentos = 0 WHERE miniatura IS NOT NULL;
