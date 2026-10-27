import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { distToLine, projector, type Projector, type XZ } from './geo.ts'
import type { Zone } from '../../shared/zones.ts'

const here = import.meta.dirname
const DATA_ROOT = resolve(process.env.DATA_DIR ?? join(here, '../../public/zonas'))
const MIGRATIONS_DIR = resolve(process.env.MIGRATIONS_DIR ?? join(here, '../../db/migrations'))
const URL = () => process.env.DATABASE_URL ?? 'postgres://lapaz:lapaz@localhost:5433/lapaz'

/**
 * Conexión de una zona. Cada zona vive en su propio esquema de PostgreSQL (el Centro en `public`, las demás en `z_<id>`):
 * las tablas y las consultas son las mismas, y el `search_path` de la conexión elige el esquema.
 */
export interface ZoneDb {
  zone: Zone; schema: string; pool: pg.Pool; proj: Projector
  data: (f: string) => any
}

/** Espera a que PostGIS acepte conexiones (en Docker arranca después que la API). */
export async function waitForDb() {
  for (let i = 1; ; i++) {
    const c = new pg.Client(URL())
    try { await c.connect(); await c.query('SELECT 1'); await c.end(); return } catch (e) {
      await c.end().catch(() => {})
      if (i >= 30) throw e
      console.log(`esperando a PostGIS (${i})…`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
}

export async function openZone(zone: Zone): Promise<ZoneDb> {
  const schema = zone.id === 'centro' ? 'public' : `z_${zone.id}`
  if (schema !== 'public') {
    const c = new pg.Client(URL())
    await c.connect()
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
    await c.end()
  }
  const pool = new pg.Pool({ connectionString: URL(), max: zone.id === 'centro' ? 6 : 3, options: `-c search_path=${schema},public` })
  const dir = join(DATA_ROOT, zone.id)
  const db: ZoneDb = { zone, schema, pool, proj: projector(zone.origin), data: (f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) }
  await migrate(db)
  return db
}

/** Aplica en orden las migraciones SQL pendientes en el esquema de la zona. */
export async function migrate({ pool, schema }: ZoneDb) {
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
      console.log(`migración aplicada (${schema}): ${f}`)
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  }
}

// ---- datos ficticios de la flota (los choferes y las placas NO son reales) ----------------

export const FIRST = ['Juan', 'Marco', 'Rubén', 'Elías', 'Wilfredo', 'Freddy', 'Germán', 'Simón', 'Edwin', 'Hugo', 'Rolando', 'Javier', 'Néstor', 'Ramiro', 'Grover', 'Lidia', 'Rosa', 'Julia', 'Ana', 'Celia']
export const LAST = ['Mamani', 'Quispe', 'Condori', 'Choque', 'Flores', 'Apaza', 'Huanca', 'Limachi', 'Ticona', 'Callisaya', 'Poma', 'Chura', 'Gutiérrez', 'Vargas', 'Rojas', 'Laura']
export const LETTERS = 'BCDFGHJKLMNPRSTVWXYZ'

export function rng(seed: number) {
  let a = seed
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

/** Nombres de las paradas en los bordes del recuadro: el Centro conserva los suyos («Ingreso al Centro»). */
export const edgeStops = (zone: Zone) => (zone.id === 'centro' ? ['Ingreso al Centro', 'Salida del Centro'] : [`Ingreso a ${zone.name}`, `Salida de ${zone.name}`])

/** Paradas de referencia: inicio y fin del tramo + lugares conocidos a ≤ 120 m de la ruta (PostGIS). */
export async function addStops(client: pg.PoolClient, zone: Zone, landmarks: any[], codes: string[] | null = null) {
  const [entry, exit] = edgeStops(zone)
  await client.query(
    `WITH lm AS (SELECT * FROM json_to_recordset($1::json) AS x(label text, lon float8, lat float8)),
     rt AS (SELECT * FROM routes WHERE $2::text[] IS NULL OR code = ANY($2)),
     cand AS (
       SELECT r.id route_id, $3::text AS name, ST_StartPoint(r.geom) g FROM rt r
       UNION ALL SELECT r.id, $4::text, ST_EndPoint(r.geom) FROM rt r
       UNION ALL SELECT r.id, lm.label, ST_ClosestPoint(r.geom, ST_SetSRID(ST_MakePoint(lm.lon, lm.lat), 4326))
         FROM rt r JOIN lm ON ST_DWithin(r.geom::geography, ST_SetSRID(ST_MakePoint(lm.lon, lm.lat), 4326)::geography, 120))
     INSERT INTO stops (route_id, seq, name, geom, measure)
     SELECT cand.route_id, row_number() OVER (PARTITION BY cand.route_id ORDER BY ST_LineLocatePoint(r.geom, cand.g)),
            cand.name, cand.g, ST_LineLocatePoint(r.geom, cand.g)
     FROM cand JOIN routes r ON r.id = cand.route_id`,
    [JSON.stringify(landmarks.map((l: any) => ({ label: l.label, lon: l.at[0], lat: l.at[1] }))), codes, entry, exit],
  )
}

/** Geocercas de parada y terminal (las paradas de los bordes) para las paradas que aún no tienen una. */
export async function addStopFences(client: pg.PoolClient, zone: Zone) {
  await client.query(
    `INSERT INTO geofences (name, kind, max_dwell_s, geom)
     SELECT s.name || ' · ' || r.code || ' ' || r.direction, CASE WHEN s.name = ANY($1) THEN 'terminal' ELSE 'parada' END::geofence_kind,
            CASE WHEN s.name = ANY($1) THEN 300 ELSE 90 END,
            ST_Buffer(s.geom::geography, CASE WHEN s.name = ANY($1) THEN 45 ELSE 30 END)::geometry
     FROM stops s JOIN routes r ON r.id = s.route_id
     WHERE NOT EXISTS (SELECT 1 FROM geofences g WHERE g.name = s.name || ' · ' || r.code || ' ' || r.direction)
     ORDER BY r.code, r.direction, s.seq`,
    [edgeStops(zone)],
  )
}

/**
 * Plaza peatonal de la zona para el escenario «Ingreso a geocerca»: la plaza con nombre más cercana a alguna línea real.
 * Polígono de OSM si existe; si la plaza solo está mapeada como punto (hito), un círculo de PLAZA_R m.
 */
const PLAZA_R = 12
function nearestPlaza({ proj, data }: ZoneDb, areas: any[], landmarks: any[], routes: any[]) {
  const line = routes.flatMap((r: any) => r.pts.map(proj.project))
  const away = (at: [number, number]) => { const p = proj.project(at); return Math.min(...line.map((q: [number, number]) => Math.hypot(q[0] - p[0], q[1] - p[1]))) }
  // un hito-punto puede estar junto a la calzada: su círculo (PLAZA_R) no debe tocar ninguna vía transitable, o la flota
  // normal «entraría» a la geocerca
  const roads = data('roads.json').map((r: any) => r.pts.map(proj.project) as XZ[])
  const clear = (at: [number, number]) => { const p = proj.project(at); return roads.every((pts: XZ[]) => distToLine(p, pts) > PLAZA_R + 4) }
  const center = (pts: [number, number][]) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]) as [number, number]
  const cands = [
    ...areas.filter((a: any) => a.n && /square|pedestrian/.test(a.k) && a.pts.length >= 3).map((a: any) => ({ n: a.n, pts: a.pts, d: away(center(a.pts)) })),
    ...landmarks.filter((l: any) => /^plaza/i.test(l.label) && clear(l.at)).map((l: any) => ({ n: l.label, at: l.at, d: away(l.at) })),
  ]
  return cands.sort((x, y) => x.d - y.d)[0] as { n: string; pts?: [number, number][]; at?: [number, number] } | undefined
}

/** Vehículos por línea real (simulación; ver docs/caso-estudio-rutas.md). Las líneas sin dato llevan 8. */
export const FLEET: Record<string, number> = { '212': 10, '204': 8, '453': 8 }

/** Carga los datos de la zona y la flota ficticia si su esquema está vacío. */
export async function seed(db: ZoneDb) {
  const { pool, data, zone } = db
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

    await addStops(client, zone, landmarks)

    await client.query(
      `INSERT INTO road_segments (id, osm_way_id, name, highway, oneway, source, target, length_m, geom)
       SELECT id, way, name, hw, oneway, s, t, len, ST_SetSRID(ST_GeomFromGeoJSON(json_build_object('type','LineString','coordinates', pts)::text), 4326)
       FROM json_to_recordset($1::json) AS x(id int, way bigint, name text, hw text, oneway smallint, s bigint, t bigint, len float8, pts json)`,
      [JSON.stringify(roads)],
    )

    // Geocercas: una plaza peatonal (polígono real de OSM), paradas, terminales del tramo y zonas escolares.
    // En el Centro es Plaza Murillo; en las demás zonas, la plaza con nombre más cercana a la segunda línea real
    // (la que usa el escenario «Ingreso a geocerca»).
    const plaza = zone.id === 'centro' ? { n: 'Plaza Murillo', ...areas.find((a: any) => a.n === 'Plaza Murillo') } : nearestPlaza(db, areas, landmarks, routes)
    if (plaza) await client.query(
      `INSERT INTO geofences (name, kind, max_dwell_s, geom) VALUES ($2 || ' (sin tránsito vehicular)', 'restringida', NULL,
        CASE WHEN $3::float8 > 0 THEN ST_Buffer(ST_SetSRID(ST_GeomFromGeoJSON($1), 4326)::geography, $3)::geometry ELSE ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) END)`,
      [JSON.stringify(plaza.pts ? { type: 'Polygon', coordinates: [[...plaza.pts, plaza.pts[0]]] } : { type: 'Point', coordinates: plaza.at }), plaza.n, plaza.pts ? 0 : PLAZA_R],
    )
    await addStopFences(client, zone)
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
      for (let i = 0; i < (FLEET[l.code] ?? 8); i++) {
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
    console.log(`seed ${zone.id}: ${c.r} rutas, ${c.s} paradas, ${c.g} geocercas, ${c.rs} tramos viales, ${c.v} vehículos`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
