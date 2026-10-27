import Fastify, { type FastifyReply } from 'fastify'
import { openZone, seed, waitForDb, type ZoneDb } from './db.ts'
import { seedFleet } from './fleet.ts'
import { Simulator } from './sim.ts'
import { ZONES, zoneById, type ZoneId } from '../../shared/zones.ts'

const PORT = Number(process.env.PORT ?? 3001)
const IDLE_MS = 60_000 // una zona sin espectadores deja de simular después de este tiempo
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'warn' } })

const featureCollection = (rows: any[]) => ({
  type: 'FeatureCollection',
  features: rows.map(({ geometry, ...properties }) => ({ type: 'Feature', geometry, properties })),
})

// ---- zonas: cada una con su esquema, su simulador y sus espectadores ------------------------

interface Live { db: ZoneDb; sim: Simulator; viewers: number; idle: NodeJS.Timeout | null }
const zones = new Map<ZoneId, Promise<Live>>()

/** Prepara la zona una sola vez (esquema, datos, flota y simulador). No la pone a simular. */
function zone(id: ZoneId): Promise<Live> {
  let z = zones.get(id)
  if (!z) {
    z = (async () => {
      const db = await openZone(zoneById(id)!)
      await seed(db)
      await seedFleet(db)
      const sim = new Simulator(db)
      await sim.init()
      return { db, sim, viewers: 0, idle: null }
    })()
    z.catch((e) => { console.error(`zona ${id}:`, e); zones.delete(id) })
    zones.set(id, z)
  }
  return z
}

/** Simula solo mientras alguien mira la zona (más 60 s): así varias zonas caben en una laptop. */
function watch(live: Live) {
  live.viewers++
  if (live.idle) { clearTimeout(live.idle); live.idle = null }
  if (!live.sim.running) live.sim.start()
  return () => {
    if (--live.viewers > 0) return
    live.idle = setTimeout(() => { live.sim.stop(); live.idle = null }, IDLE_MS)
  }
}

const zoneOf = (id: string, reply: FastifyReply) => {
  if (zoneById(id)) return zone(id as ZoneId)
  reply.code(404).send({ error: `zona desconocida: ${id}` })
  return null
}

app.get('/api/zones', async () => Promise.all(ZONES.map(async (z) => {
  const live = zones.has(z.id) ? await zones.get(z.id)!.catch(() => null) : null
  return { id: z.id, name: z.name, district: z.district, hotspot: z.hotspot.name, ready: !!live, running: !!live?.sim.running, vehicles: live?.sim.vehicles.length ?? 0 }
})))

app.get('/api/health', async () => {
  const live = await Promise.all([...zones.values()].map((z) => z.catch(() => null)))
  return { ok: true, zones: live.filter((l) => l).map((l) => ({ zone: l!.db.zone.id, running: l!.sim.running, tick: l!.sim.tickNo, vehicles: l!.sim.vehicles.length })) }
})

/** Rutas por zona: /api/zones/:zone/… y, por compatibilidad, /api/… para el Centro. */
function routes(prefix: string, idOf: (params: any) => string) {
  app.get(`${prefix}/routes`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    return featureCollection((await z.db.pool.query(
      `SELECT r.id, r.code, r.name, r.direction, r.mode, r.color, r.simulated, r.headway_min, r.osm_relation_id, round(r.length_m) length_m,
              u.name union_name, ST_AsGeoJSON(r.geom)::json geometry
       FROM routes r JOIN unions u ON u.id = r.union_id ORDER BY r.code, r.direction`)).rows)
  })

  app.get(`${prefix}/stops`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    return featureCollection((await z.db.pool.query(
      `SELECT s.id, s.seq, s.name, r.code, r.direction, ST_AsGeoJSON(s.geom)::json geometry
       FROM stops s JOIN routes r ON r.id = s.route_id ORDER BY r.code, r.direction, s.seq`)).rows)
  })

  app.get(`${prefix}/geofences`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    return featureCollection((await z.db.pool.query(
      `SELECT id, name, kind, max_dwell_s, max_speed_kmh, ST_AsGeoJSON(geom)::json geometry FROM geofences ORDER BY id`)).rows)
  })

  app.get(`${prefix}/vehicles/:id`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    const pool = z.db.pool
    const id = Number((req.params as any).id)
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
    return { ...v, stoppedSeconds: stopped, track: track.map((p: any) => [p.lon, p.lat]), alerts }
  })

  app.get(`${prefix}/alerts`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    const active = (req.query as any).active
    return (await z.db.pool.query(
      `SELECT a.id, a.kind, a.vehicle_id, a.road_segment_id, a.started_at, a.resolved_at, a.detail, v.plate
       FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id
       ${active ? 'WHERE a.resolved_at IS NULL' : ''} ORDER BY a.started_at DESC LIMIT 100`)).rows
  })

  app.post(`${prefix}/scenarios/:id`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    try {
      return { ok: true, message: await z.sim.scenario((req.params as any).id) }
    } catch (e) {
      return reply.code(400).send({ ok: false, message: (e as Error).message })
    }
  })

  /** Una foto por tick (posiciones, alertas, congestión, desvíos, métricas y eventos). */
  app.get(`${prefix}/stream`, async (req, reply) => {
    const z = await zoneOf(idOf(req.params), reply); if (!z) return
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = (s: unknown) => reply.raw.write(`data: ${JSON.stringify(s)}\n\n`)
    send(z.sim.snapshot())
    const off = z.sim.onSnapshot(send)
    const unwatch = watch(z)
    req.raw.on('close', () => { off(); unwatch() })
  })
}
routes('/api/zones/:zone', (p) => p.zone)
routes('/api', () => 'centro')

async function main() {
  await waitForDb()
  await zone('centro')
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`API lista en :${PORT}`)
  // las demás zonas se preparan en segundo plano, una tras otra (la primera vez cargan datos y flota)
  for (const z of ZONES.slice(1)) await zone(z.id).then(() => console.log(`zona lista: ${z.name}`), () => {})
}

const shutdown = async () => {
  await app.close()
  for (const z of zones.values()) { const live = await z.catch(() => null); if (live) { live.sim.stop(); await live.db.pool.end() } }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
await main()
