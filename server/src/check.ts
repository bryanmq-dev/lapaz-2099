// Comprobación de punta a punta contra PostGIS real: `pnpm --dir server check`
// Usa una base aparte (lapaz_check) para no interferir con la API en marcha.
import pg from 'pg'
import { unproject } from './geo.ts'

const ADMIN = process.env.ADMIN_URL ?? 'postgres://lapaz:lapaz@localhost:5433/lapaz'
process.env.DATABASE_URL = ADMIN.replace(/\/[^/]+$/, '/lapaz_check')
process.env.STOP_ALERT_S = '6'
process.env.BREAKDOWN_S = '14'
process.env.AUTO_PEAK = '0' // la hora punta se dispara a mano para poder medirla

const admin = new pg.Client(ADMIN)
await admin.connect()
await admin.query('DROP DATABASE IF EXISTS lapaz_check WITH (FORCE)')
await admin.query('CREATE DATABASE lapaz_check')
await admin.end()

const { migrate, seed, pool } = await import('./db.ts')
const { Simulator } = await import('./sim.ts')
const { seedFleet } = await import('./fleet.ts')
await migrate()
await seed()
await seedFleet()
const sim = new Simulator()
await sim.init()
const peek = sim as any // estado interno que la prueba necesita leer

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const ok = (c: unknown, msg: string) => { if (!c) throw new Error(`FALLO: ${msg}`); console.log(`  ✓ ${msg}`) }
const open = async (kind: string, plate?: string) => (await pool.query(
  `SELECT a.id FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id WHERE a.kind = $1 AND a.resolved_at IS NULL AND ($2::text IS NULL OR v.plate = $2)`,
  [kind, plate ?? null])).rowCount!
/** Avanza la simulación en tiempo real (las ventanas de alerta usan now()) hasta que se cumpla la condición. */
async function until(pred: () => Promise<boolean>, maxS: number, msg: string, each?: () => Promise<void>) {
  for (let i = 0; i < maxS; i++) {
    if (each) await each()
    await sim.tick()
    if (await pred()) return ok(true, msg)
    await sleep(1000)
  }
  throw new Error(`FALLO (tiempo agotado ${maxS}s): ${msg}`)
}
let msg = ''
const plateIn = (msg: string) => msg.split(': ')[1]

console.log('Línea base')
for (let i = 0; i < 8; i++) { await sim.tick(); await sleep(1000) }
ok((await pool.query(`SELECT count(*)::int n FROM alerts WHERE resolved_at IS NULL`)).rows[0].n === 0, 'sin alertas con la flota en sus rutas')
const regular = sim.vehicles.filter((v) => !v.reserve).length
ok(regular >= 200 && sim.vehicles.filter((v) => !v.reserve && v.kind === 'minibus').length >= 200, `hay ${regular} vehículos en servicio (≥ 200 minibuses)`)
ok((await pool.query(`SELECT count(DISTINCT vehicle_id)::int n FROM vehicle_positions`)).rows[0].n === regular, 'las posiciones de toda la flota en servicio se registran en PostGIS')
ok(sim.vehicles.filter((v) => v.reserve).length === 50 && sim.snapshot().vehicles.every((v) => !sim.vehicles.find((x) => x.id === v.id)!.reserve), '50 unidades de refuerzo esperan en base y no aparecen en el mapa')
ok(sim.snapshot().metrics.congestedSegments === 0, 'el tráfico normal no congestiona el Centro')

console.log('Hora punta: ~50 minibuses por El Prado, el Obelisco y la Av. Camacho')
// La congestión no se impone: se mide. La simulación avanza sin esperar (las alertas de PostGIS que miran el reloj real
// no se evalúan aquí) y al final se restablece.
const fast = async (pred: () => boolean, maxTicks: number, msg: string) => {
  for (let i = 0; i < maxTicks; i++) { await sim.tick(); if (pred()) return ok(true, `${msg} (a los ${i + 1} s simulados)`) }
  throw new Error(`FALLO (${maxTicks} s simulados): ${msg}`)
}
msg = await sim.scenario('congestion')
ok(msg.startsWith('Hora punta'), msg)
ok((await sim.scenario('congestion')).startsWith('Ya hay'), 'una segunda hora punta no se duplica')
await fast(() => sim.snapshot().metrics.reserveOut >= 45, 120, 'salen las unidades de refuerzo')
await fast(() => peek.jams.size > 0, 600, 'la congestión aparece sola, sin imponerla')
await fast(() => [...peek.jams.keys()].some((k: string) => /Prado|16 de Julio|Camacho|Santa Cruz/.test(k)), 600, 'la cola se forma en El Prado, la Mcal. Santa Cruz o la Av. Camacho')
ok((await open('congestion')) >= 1, 'alerta de congestión abierta en PostGIS')
ok(sim.snapshot().alerts.some((a) => a.kind === 'congestion' && /Obelisco/.test(String(a.detail.via))), 'la alerta indica la zona del Obelisco')
ok(sim.snapshot().congestion.length > 0 && sim.snapshot().metrics.avgSpeedKmh > 0, 'los tramos congestionados se miden en la simulación')
await fast(() => sim.routes.some((r) => r.detour), 120, 'se proponen desvíos')
const box = (await pool.query(`SELECT ST_XMin(e) w, ST_XMax(e) e, ST_YMin(e) s, ST_YMax(e) n FROM (SELECT ST_Extent(geom) e FROM road_segments) x`)).rows[0]
ok(sim.routes.filter((r) => r.detour).every((r) => r.detour!.pts.every((p) => { const [lon, lat] = unproject(p); return lon >= box.w && lon <= box.e && lat >= box.s && lat <= box.n })), 'los desvíos no salen del Centro')
ok((await sim.scenario('despejar')).startsWith('Control'), 'el agente de tránsito entra en acción')
await fast(() => peek.jams.size === 0 && !peek.peak, 900, 'la congestión se resuelve sola al pasar el refuerzo')
ok(sim.routes.every((r) => !r.detour), 'se retiran los desvíos al normalizarse')
ok((await open('congestion')) === 0, 'la alerta de congestión se cierra')
await sim.scenario('reset')
ok(sim.snapshot().metrics.congestedSegments === 0 && sim.snapshot().metrics.reserveOut === 0, 'el reset devuelve el refuerzo a base y limpia la congestión')
for (let i = 0; i < 8; i++) { await sim.tick(); await sleep(1000) }
ok((await pool.query(`SELECT count(*)::int n FROM alerts WHERE resolved_at IS NULL`)).rows[0].n === 0, 'sin alertas tras el reset')

console.log('Desvío no autorizado (Línea 204)')
msg = await sim.scenario('desvio')
for (let i = 0; i < 20 && !msg.startsWith('Desvío'); i++) { await sim.tick(); await sleep(1000); msg = await sim.scenario('desvio') }
const p1 = plateIn(msg)
await until(async () => (await open('fuera_de_ruta', p1)) === 1, 120, `alerta «fuera de ruta» para ${p1}`)
await until(async () => (await open('fuera_de_ruta', p1)) === 0, 180, `la alerta se cierra cuando ${p1} vuelve a su ruta`)

console.log('Avería (Línea 453)')
msg = await sim.scenario('averia')
const p2 = plateIn(msg)
await until(async () => (await open('detenido', p2)) === 1, 30, `alerta «detenido» para ${p2}`)
await until(async () => (await open('detenido', p2)) === 0, 40, `la alerta se cierra cuando ${p2} reanuda la marcha`)

console.log('Geocerca Plaza Murillo (Línea 204)')
msg = await sim.scenario('geocerca')
for (let i = 0; i < 90 && !msg.startsWith('Ingreso'); i++) { await sim.tick(); await sleep(1000); msg = await sim.scenario('geocerca') }
ok(msg.startsWith('Ingreso'), msg)
const p3 = plateIn(msg)
await until(async () => (await open('geocerca', p3)) === 1, 180, `alerta «geocerca» para ${p3}`)

await sim.scenario('reset')
ok((await pool.query(`SELECT count(*)::int n FROM alerts WHERE resolved_at IS NULL`)).rows[0].n === 0, 'reset cierra todas las alertas')
await pool.end()
console.log('servidor OK')
