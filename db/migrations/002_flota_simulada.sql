-- Flota simulada de refuerzo y tráfico emergente.
-- La flota de fondo (líneas S01…) sale de rutas calculadas sobre la red vial real; no son líneas reales.
ALTER TABLE routes ADD COLUMN simulated boolean NOT NULL DEFAULT false;

-- Unidades de refuerzo: salen de servicio en hora punta (ver server/src/sim.ts).
ALTER TABLE vehicles ADD COLUMN reserve boolean NOT NULL DEFAULT false;

-- Un vehículo en cola (detrás de otro que avanza despacio) no está «detenido» por una anomalía.
ALTER TABLE vehicle_positions ADD COLUMN queued boolean NOT NULL DEFAULT false;
