// Comprobación de punta a punta contra PostGIS real: `pnpm --dir server check`
// Usa una base aparte (lapaz_check) para no interferir con la API en marcha.
import pg from 'pg'

const ADMIN = process.env.ADMIN_URL ?? 'postgres://lapaz:lapaz@localhost:5433/lapaz'
process.env.DATABASE_URL = ADMIN.replace(/\/[^/]+$/, '/lapaz_check')
process.env.STOP_ALERT_S = '6'
process.env.BREAKDOWN_S = '14'

const admin = new pg.Client(ADMIN)
await admin.connect()
await admin.query('DROP DATABASE IF EXISTS lapaz_check WITH (FORCE)')
await admin.query('CREATE DATABASE lapaz_check')
await admin.end()

const { migrate, seed, pool } = await import('./db.ts')
const { Simulator } = await import('./sim.ts')
await migrate()
await seed()
const sim = new Simulator()
await sim.init()

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
const plateIn = (msg: string) => msg.split(': ')[1]

console.log('Línea base')
for (let i = 0; i < 8; i++) { await sim.tick(); await sleep(1000) }
ok((await pool.query(`SELECT count(*)::int n FROM alerts WHERE resolved_at IS NULL`)).rows[0].n === 0, 'sin alertas con la flota en sus rutas')
ok((await pool.query(`SELECT count(DISTINCT vehicle_id)::int n FROM vehicle_positions`)).rows[0].n === sim.vehicles.length, 'todas las posiciones se registran en PostGIS')

console.log('Congestión en El Prado + desvío')
await sim.scenario('congestion')
await sim.tick()
ok(await open('congestion') === 1, 'alerta de congestión abierta')
const detours = sim.routes.filter((r) => r.detour)
ok(detours.some((r) => r.code === '212'), 'la Línea 212 (que usa el Prado) recibe desvío')
ok(detours.every((r) => !r.detour!.names.includes('Avenida 16 de Julio')), 'ningún desvío pasa por la Av. 16 de Julio bloqueada')
const box = (await pool.query(`SELECT ST_XMin(e) w, ST_XMax(e) e, ST_YMin(e) s, ST_YMax(e) n FROM (SELECT ST_Extent(geom) e FROM road_segments) x`)).rows[0]
ok(sim.snapshot().reroutes.every((r) => r.coords.every(([lon, lat]) => lon >= box.w && lon <= box.e && lat >= box.s && lat <= box.n)), 'los desvíos no salen del Centro')
for (let i = 0; i < 6; i++) { await sim.tick(); await sleep(1000) }
ok(await open('fuera_de_ruta') === 0, 'un desvío autorizado no genera alertas de fuera de ruta')
await sim.scenario('despejar')
ok(await open('congestion') === 0 && sim.routes.every((r) => !r.detour), 'al despejar se cierra la alerta y se retiran los desvíos')

console.log('Desvío no autorizado (Línea 204)')
let msg = await sim.scenario('desvio')
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
