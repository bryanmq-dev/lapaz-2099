import Fastify from 'fastify'
import { migrate, pool, seed } from './db.ts'
import { seedFleet } from './fleet.ts'
import { Simulator } from './sim.ts'

const PORT = Number(process.env.PORT ?? 3001)
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } })
const sim = new Simulator()

const featureCollection = (rows: any[]) => ({
  type: 'FeatureCollection',
  features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties })),
})

app.get('/api/health', async () => ({ ok: true, tick: sim.tickNo, vehicles: sim.vehicles.length }))

app.get('/api/routes', async () => featureCollection((await pool.query(
  `SELECT r.id, r.code, r.name, r.direction, r.mode, r.color, r.simulated, r.headway_min, r.osm_relation_id, round(r.length_m) length_m,
          u.name union_name, ST_AsGeoJSON(r.geom)::json geometry
   FROM routes r JOIN unions u ON u.id = r.union_id ORDER BY r.code, r.direction`)).rows))

app.get('/api/stops', async () => featureCollection((await pool.query(
  `SELECT s.id, s.seq, s.name, r.code, r.direction, ST_AsGeoJSON(s.geom)::json geometry
   FROM stops s JOIN routes r ON r.id = s.route_id ORDER BY r.code, r.direction, s.seq`)).rows))

app.get('/api/geofences', async () => featureCollection((await pool.query(
  `SELECT id, name, kind, max_dwell_s, max_speed_kmh, ST_AsGeoJSON(geom)::json geometry FROM geofences ORDER BY id`)).rows))

app.get<{ Params: { id: string } }>('/api/vehicles/:id', async (req, reply) => {
  const id = Number(req.params.id)
  const { rows: [v] } = await pool.query(
    `SELECT v.id, v.plate, v.kind, v.status, u.full_name driver, u.phone, u.license_no, un.name union_name,
            r.code, r.name route_name, r.direction, r.color
     FROM vehicles v JOIN users u ON u.id = v.driver_id JOIN unions un ON un.id = v.union_id JOIN routes r ON r.id = v.route_id
     WHERE v.id = $1`, [id])
  if (!v) return reply.code(404).send({ error: 'vehículo no encontrado' })
  const track = (await pool.query(
    `SELECT ST_X(geom) lon, ST_Y(geom) lat FROM (SELECT geom, ts FROM vehicle_positions WHERE vehicle_id = $1 ORDER BY ts DESC LIMIT 90) x ORDER BY ts`, [id])).rows
  const alerts = (await pool.query(
    `SELECT id, kind, started_at, resolved_at, detail FROM alerts WHERE vehicle_id = $1 ORDER BY started_at DESC LIMIT 5`, [id])).rows
  const stopped = (await pool.query(
    `SELECT coalesce(extract(epoch FROM now() - max(ts) FILTER (WHERE speed_kmh >= 2)), 0)::int s FROM vehicle_positions
     WHERE vehicle_id = $1 AND ts > now() - interval '10 minutes'`, [id])).rows[0].s
  return { ...v, stoppedSeconds: stopped, track: track.map((p) => [p.lon, p.lat]), alerts }
})

app.get<{ Querystring: { active?: string } }>('/api/alerts', async (req) => (await pool.query(
  `SELECT a.id, a.kind, a.vehicle_id, a.road_segment_id, a.started_at, a.resolved_at, a.detail, v.plate
   FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id
   ${req.query.active ? 'WHERE a.resolved_at IS NULL' : ''} ORDER BY a.started_at DESC LIMIT 100`)).rows)

app.post<{ Params: { id: string } }>('/api/scenarios/:id', async (req, reply) => {
  try {
    return { ok: true, message: await sim.scenario(req.params.id) }
  } catch (e) {
    return reply.code(400).send({ ok: false, message: (e as Error).message })
  }
})

/** Una foto por tick (posiciones, alertas, congestión, desvíos, métricas y eventos). */
app.get('/api/stream', (req, reply) => {
  reply.hijack()
  reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  const send = (s: unknown) => reply.raw.write(`data: ${JSON.stringify(s)}\n\n`)
  send(sim.snapshot())
  const off = sim.onSnapshot(send)
  req.raw.on('close', off)
})

async function main() {
  for (let i = 1; ; i++) {
    try { await pool.query('SELECT 1'); break } catch (e) {
      if (i >= 30) throw e
      console.log(`esperando a PostGIS (${i})…`)
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  await migrate()
  await seed()
  await seedFleet()
  await sim.init()
  sim.start()
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`API lista en :${PORT}`)
}

const shutdown = async () => { sim.stop(); await app.close(); await pool.end(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await main()
