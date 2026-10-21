import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'

const here = import.meta.dirname
export const DATA_DIR = resolve(process.env.DATA_DIR ?? join(here, '../../public/centro'))
const MIGRATIONS_DIR = resolve(process.env.MIGRATIONS_DIR ?? join(here, '../../db/migrations'))

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://lapaz:lapaz@localhost:5433/lapaz',
  max: 6,
})

const data = (f: string) => JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'))

/** Aplica en orden las migraciones SQL pendientes. */
export async function migrate() {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
  const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name))
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await client.query('COMMIT')
      console.log(`migración aplicada: ${f}`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

// ---- datos ficticios de la flota (los choferes y las placas NO son reales) ----------------

const FIRST = ['Juan', 'Marco', 'Rubén', 'Elías', 'Wilfredo', 'Freddy', 'Germán', 'Simón', 'Edwin', 'Hugo', 'Rolando', 'Javier', 'Néstor', 'Ramiro', 'Grover', 'Lidia', 'Rosa', 'Julia', 'Ana', 'Celia']
const LAST = ['Mamani', 'Quispe', 'Condori', 'Choque', 'Flores', 'Apaza', 'Huanca', 'Limachi', 'Ticona', 'Callisaya', 'Poma', 'Chura', 'Gutiérrez', 'Vargas', 'Rojas', 'Laura']
const LETTERS = 'BCDFGHJKLMNPRSTVWXYZ'

function rng(seed: number) {
  let a = seed
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Vehículos por línea (simulación; ver docs/caso-estudio-rutas.md). */
export const FLEET: Record<string, number> = { '212': 10, '204': 8, '453': 8 }

/** Carga los datos del Centro y la flota ficticia si la base está vacía. */
export async function seed() {
  if ((await pool.query('SELECT count(*)::int n FROM routes')).rows[0].n > 0) return
  const lines = data('lines.json'), routes = data('routes.json'), roads = data('roads.json')
  const landmarks = data('landmarks.json'), schools = data('schools.json'), areas = data('areas.json')
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const l of lines) await client.query('INSERT INTO unions (name) VALUES ($1) ON CONFLICT DO NOTHING', [l.union])

    for (const r of routes) {
      const l = lines.find((x: any) => x.code === r.code)
      await client.query(
        `INSERT INTO routes (union_id, code, name, direction, mode, color, headway_min, osm_relation_id, geom)
         SELECT u.id, $2, $3, $4, $5, $6, $7, $8, ST_SetSRID(ST_GeomFromGeoJSON($9), 4326) FROM unions u WHERE u.name = $1`,
        [l.union, r.code, r.name, r.direction, l.mode, l.color, l.headwayMin, r.osm, JSON.stringify({ type: 'LineString', coordinates: r.pts })],
      )
    }

    // Paradas de referencia: inicio y fin del tramo + lugares conocidos a ≤ 120 m de la ruta (PostGIS).
    await client.query(
      `WITH lm AS (SELECT * FROM json_to_recordset($1::json) AS x(label text, lon float8, lat float8)),
       cand AS (
         SELECT r.id route_id, 'Ingreso al Centro' AS name, ST_StartPoint(r.geom) g FROM routes r
         UNION ALL SELECT r.id, 'Salida del Centro', ST_EndPoint(r.geom) FROM routes r
         UNION ALL SELECT r.id, lm.label, ST_ClosestPoint(r.geom, ST_SetSRID(ST_MakePoint(lm.lon, lm.lat), 4326))
           FROM routes r JOIN lm ON ST_DWithin(r.geom::geography, ST_SetSRID(ST_MakePoint(lm.lon, lm.lat), 4326)::geography, 120))
       INSERT INTO stops (route_id, seq, name, geom, measure)
       SELECT cand.route_id, row_number() OVER (PARTITION BY cand.route_id ORDER BY ST_LineLocatePoint(r.geom, cand.g)),
              cand.name, cand.g, ST_LineLocatePoint(r.geom, cand.g)
       FROM cand JOIN routes r ON r.id = cand.route_id`,
      [JSON.stringify(landmarks.map((l: any) => ({ label: l.label, lon: l.at[0], lat: l.at[1] })))],
    )

    await client.query(
      `INSERT INTO road_segments (id, osm_way_id, name, highway, oneway, source, target, length_m, geom)
       SELECT id, way, name, hw, oneway, s, t, len, ST_SetSRID(ST_GeomFromGeoJSON(json_build_object('type','LineString','coordinates', pts)::text), 4326)
       FROM json_to_recordset($1::json) AS x(id int, way bigint, name text, hw text, oneway smallint, s bigint, t bigint, len float8, pts json)`,
      [JSON.stringify(roads)],
    )

    // Geocercas: Plaza Murillo (polígono real de OSM), paradas, terminales del tramo y zonas escolares.
    const murillo = areas.find((a: any) => a.n === 'Plaza Murillo')
    await client.query(
      `INSERT INTO geofences (name, kind, max_dwell_s, geom) VALUES ('Plaza Murillo (sin tránsito vehicular)', 'restringida', NULL,
        ST_SetSRID(ST_GeomFromGeoJSON($1), 4326))`,
      [JSON.stringify({ type: 'Polygon', coordinates: [[...murillo.pts, murillo.pts[0]]] })],
    )
    await client.query(
      `INSERT INTO geofences (name, kind, max_dwell_s, geom)
       SELECT s.name || ' · ' || r.code || ' ' || r.direction, CASE WHEN s.name LIKE '%Centro' THEN 'terminal' ELSE 'parada' END::geofence_kind,
              CASE WHEN s.name LIKE '%Centro' THEN 300 ELSE 90 END,
              ST_Buffer(s.geom::geography, CASE WHEN s.name LIKE '%Centro' THEN 45 ELSE 30 END)::geometry
       FROM stops s JOIN routes r ON r.id = s.route_id ORDER BY r.code, r.direction, s.seq`,
    )
    await client.query(
      `WITH sc AS (SELECT * FROM json_to_recordset($1::json) AS x(name text, lon float8, lat float8)),
       near AS (SELECT DISTINCT ON (sc.name) sc.*, ST_Distance(r.geom::geography, ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography) d
                FROM sc JOIN routes r ON true ORDER BY sc.name, d)
       INSERT INTO geofences (name, kind, max_speed_kmh, geom)
       SELECT 'Zona escolar · ' || name, 'escolar', 20, ST_Buffer(ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, 60)::geometry
       FROM near WHERE d < 80 ORDER BY d LIMIT 3`,
      [JSON.stringify(schools.map((s: any) => ({ name: s.name, lon: s.at[0], lat: s.at[1] })))],
    )

    // Choferes y vehículos ficticios
    const rand = rng(2050)
    let n = 0
    for (const l of lines) {
      for (let i = 0; i < FLEET[l.code]; i++) {
        n++
        const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`
        const plate = `${1000 + Math.floor(rand() * 8999)}-${[0, 1, 2].map(() => LETTERS[Math.floor(rand() * LETTERS.length)]).join('')}`
        const { rows: [u] } = await client.query(
          `INSERT INTO users (full_name, role, phone, license_no) VALUES ($1, 'chofer', $2, $3) RETURNING id`,
          [name, `7${String(1000000 + Math.floor(rand() * 8999999)).slice(0, 7)}`, `LP-${String(4000000 + n * 7919).slice(0, 7)}`],
        )
        await client.query(
          `INSERT INTO vehicles (plate, kind, union_id, driver_id, route_id)
           SELECT $1, $2, u.id, $3, r.id FROM unions u, routes r WHERE u.name = $4 AND r.code = $5 AND r.direction = $6`,
          [plate, l.mode, u.id, l.union, l.code, i % 2 ? 'vuelta' : 'ida'],
        )
      }
    }
    await client.query(`INSERT INTO users (full_name, role) VALUES ('Operador de turno', 'operador')`)
    await client.query('COMMIT')
    const c = (await pool.query(`SELECT (SELECT count(*) FROM routes) r, (SELECT count(*) FROM stops) s, (SELECT count(*) FROM geofences) g,
      (SELECT count(*) FROM road_segments) rs, (SELECT count(*) FROM vehicles) v`)).rows[0]
    console.log(`seed: ${c.r} rutas, ${c.s} paradas, ${c.g} geocercas, ${c.rs} tramos viales, ${c.v} vehículos`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
