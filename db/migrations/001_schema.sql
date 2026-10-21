-- LA PAZ 2050 · seguimiento de transporte público (caso de estudio: Centro)
-- Geometrías en WGS84 (SRID 4326). Distancias en metros con ::geography.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('chofer', 'operador', 'admin');
CREATE TYPE vehicle_kind AS ENUM ('minibus', 'trufi', 'micro');
CREATE TYPE route_direction AS ENUM ('ida', 'vuelta');
CREATE TYPE geofence_kind AS ENUM ('restringida', 'parada', 'terminal', 'escolar');
CREATE TYPE alert_kind AS ENUM ('fuera_de_ruta', 'detenido', 'geocerca', 'congestion');

CREATE TABLE users (
  id          serial PRIMARY KEY,
  full_name   text NOT NULL,
  role        user_role NOT NULL,
  phone       text,
  license_no  text UNIQUE,              -- licencia de conducir (solo choferes)
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Sindicatos / operadores de transporte
CREATE TABLE unions (
  id    serial PRIMARY KEY,
  name  text NOT NULL UNIQUE
);

-- Cada fila es UN sentido de una línea: un vehículo sigue una ruta de ida o una de vuelta.
CREATE TABLE routes (
  id              serial PRIMARY KEY,
  union_id        int NOT NULL REFERENCES unions(id),
  code            text NOT NULL,                       -- número de línea, p. ej. '212'
  name            text NOT NULL,
  direction       route_direction NOT NULL,
  mode            vehicle_kind NOT NULL,
  color           text NOT NULL,
  headway_min     int NOT NULL,                        -- frecuencia de referencia
  osm_relation_id bigint,
  geom            geometry(LineString, 4326) NOT NULL, -- LINESTRING (no multilínea): un solo trazo continuo
  length_m        double precision GENERATED ALWAYS AS (ST_Length(geom::geography)) STORED,
  UNIQUE (code, direction)
);
CREATE INDEX routes_geom_idx ON routes USING gist (geom);

CREATE TABLE stops (
  id        serial PRIMARY KEY,
  route_id  int NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  seq       int NOT NULL,
  name      text NOT NULL,
  geom      geometry(Point, 4326) NOT NULL,
  measure   double precision NOT NULL,                 -- posición 0..1 sobre la ruta (ST_LineLocatePoint)
  UNIQUE (route_id, seq)
);
CREATE INDEX stops_geom_idx ON stops USING gist (geom);

CREATE TABLE vehicles (
  id         serial PRIMARY KEY,
  plate      text NOT NULL UNIQUE,
  kind       vehicle_kind NOT NULL,
  union_id   int NOT NULL REFERENCES unions(id),
  driver_id  int NOT NULL UNIQUE REFERENCES users(id),
  route_id   int NOT NULL REFERENCES routes(id),
  status     text NOT NULL DEFAULT 'en_servicio'
);

-- El conductor asignado debe tener rol de chofer.
CREATE FUNCTION check_driver_role() RETURNS trigger AS $$
BEGIN
  IF (SELECT role FROM users WHERE id = NEW.driver_id) <> 'chofer' THEN
    RAISE EXCEPTION 'el usuario % no tiene rol chofer', NEW.driver_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER vehicles_driver_role BEFORE INSERT OR UPDATE OF driver_id ON vehicles
  FOR EACH ROW EXECUTE FUNCTION check_driver_role();

CREATE TABLE geofences (
  id             serial PRIMARY KEY,
  name           text NOT NULL,
  kind           geofence_kind NOT NULL,
  max_dwell_s    int,                                  -- tiempo máximo detenido permitido dentro
  max_speed_kmh  int,
  geom           geometry(Polygon, 4326) NOT NULL
);
CREATE INDEX geofences_geom_idx ON geofences USING gist (geom);

-- Grafo vial del Centro (tramos entre intersecciones), para congestión y desvíos.
CREATE TABLE road_segments (
  id          int PRIMARY KEY,
  osm_way_id  bigint NOT NULL,
  name        text NOT NULL,
  highway     text NOT NULL,
  oneway      smallint NOT NULL,                       -- 1 sentido de la vía, -1 contrario, 0 doble
  source      bigint NOT NULL,
  target      bigint NOT NULL,
  length_m    double precision NOT NULL,
  congestion  real NOT NULL DEFAULT 0,                 -- 0 libre .. 1 bloqueado (simulado)
  geom        geometry(LineString, 4326) NOT NULL
);
CREATE INDEX road_segments_geom_idx ON road_segments USING gist (geom);

CREATE TABLE vehicle_positions (
  id          bigserial PRIMARY KEY,
  vehicle_id  int NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  ts          timestamptz NOT NULL DEFAULT now(),
  geom        geometry(Point, 4326) NOT NULL,
  speed_kmh   real NOT NULL,
  heading     real NOT NULL
);
CREATE INDEX vehicle_positions_vehicle_ts_idx ON vehicle_positions (vehicle_id, ts DESC);
CREATE INDEX vehicle_positions_geom_idx ON vehicle_positions USING gist (geom);

CREATE TABLE alerts (
  id               bigserial PRIMARY KEY,
  kind             alert_kind NOT NULL,
  vehicle_id       int REFERENCES vehicles(id) ON DELETE CASCADE,
  road_segment_id  int REFERENCES road_segments(id),
  geofence_id      int REFERENCES geofences(id),
  started_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  geom             geometry(Point, 4326),
  detail           jsonb NOT NULL DEFAULT '{}'
);
-- Una sola alerta abierta por vehículo y tipo (sin duplicados).
CREATE UNIQUE INDEX alerts_open_vehicle_idx ON alerts (vehicle_id, kind) WHERE resolved_at IS NULL AND vehicle_id IS NOT NULL;
CREATE UNIQUE INDEX alerts_open_segment_idx ON alerts (road_segment_id, kind) WHERE resolved_at IS NULL AND road_segment_id IS NOT NULL;
