import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'
import { METRO, metroProjection, type CableCatalog, type CableState } from '../../shared/metro.ts'
import { migrate, seed, type ZoneDb } from './db.ts'
import { seedFleet } from './fleet.ts'
import { Simulator } from './sim.ts'
import { CableSimulator } from './cable.ts'

const root = resolve(process.env.METRO_DATA_DIR ?? resolve(import.meta.dirname, '../../public/metro'))
export function metroData() {
  const { base } = JSON.parse(readFileSync(`${root}/current.json`, 'utf8'))
  if (!/^v\d+$/.test(base)) throw new Error('Versión metropolitana inválida')
  return (file: string) => JSON.parse(readFileSync(`${root}/${base}/${file}.json`, 'utf8'))
}
export async function openMetro(): Promise<ZoneDb> {
  const url = process.env.DATABASE_URL ?? 'postgres://lapaz:lapaz@localhost:5433/lapaz'
  const client = new pg.Client(url)
  await client.connect()
  try { await client.query('CREATE SCHEMA IF NOT EXISTS metro') } finally { await client.end() }
  const pool = new pg.Pool({ connectionString: url, max: 4, options: '-c search_path=metro,public' })
  const read = metroData()
  // Catalog coverage is independent of fleet size. Bound the active demo fleet.
  const allLines = read('lines'), limit = Math.max(3, Math.min(100, Number(process.env.METRO_ACTIVE_LINES) || 24))
  const selected = allLines.slice(0, limit), codes = new Set(selected.map((l: { code: string }) => l.code))
  const db: ZoneDb = { zone: METRO, schema: 'metro', pool, proj: metroProjection, data: (file) => {
    const name = file.replace(/\.json$/, '')
    return name === 'lines' ? selected : name === 'routes' ? read(name).filter((r: { code: string }) => codes.has(r.code)) : read(name)
  } }
  try { await migrate(db); await seed(db); await seedFleet(db); return db } catch (e) { await pool.end(); throw e }
}

export function registerMetro(app: FastifyInstance) {
  let cable: CableSimulator | undefined, busPromise: Promise<{ sim: Simulator; db: ZoneDb }> | undefined
  const active = new Set<() => void>()
  const cableSim = () => cable ??= new CableSimulator(metroData()('cable') as CableCatalog)
  const buses = () => busPromise ??= (async () => {
    const db = await openMetro(), sim = new Simulator(db)
    await sim.init(); return { db, sim }
  })().catch((e) => { busPromise = undefined; throw e })
  const clients = { cable: 0, bus: 0 }
  let cableTimer: NodeJS.Timeout | undefined, cableIdle: NodeJS.Timeout | undefined, busIdle: NodeJS.Timeout | undefined
  const senders = new Set<() => void>()
  const broadcast = () => { for (const send of senders) send() }
  const stream = (req: FastifyRequest, reply: FastifyReply, get: () => unknown, subscribe: (send: () => void) => () => void) => {
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = () => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(get())}\n\n`) }
    send(); const off = subscribe(send)
    const close = () => reply.raw.end()
    active.add(close)
    reply.raw.on('close', () => { off(); active.delete(close) })
  }
  app.get('/api/metro/catalog', async () => { buses().catch(() => {}) /* precalienta el simulador vial */; const d = metroData(); return { manifest: d('manifest'), cable: d('cable'), routes: d('routes'), lines: d('lines'), busCatalog: d('bus-catalog') } })
  app.get('/api/metro/telefericos/stream', (req, reply) => {
    const sim = cableSim()
    stream(req, reply, () => sim.snapshot(), (send) => {
      clients.cable++; clearTimeout(cableIdle); senders.add(send)
      cableTimer ??= setInterval(() => { sim.step(); broadcast() }, 1000)
      return () => { senders.delete(send); if (--clients.cable === 0) cableIdle = setTimeout(() => { clearInterval(cableTimer); cableTimer = undefined }, 60000) }
    })
  })
  app.post<{ Params: { id: string }; Body: { state: CableState } }>('/api/metro/telefericos/lines/:id/state', { schema: { body: { type: 'object', required: ['state'], additionalProperties: false, properties: { state: { enum: ['normal', 'mantenimiento', 'detenido'] } } } } }, async (req, reply) => {
    try { cableSim().setState(req.params.id, req.body.state); broadcast(); return { ok: true } }
    catch (e) { return reply.code(404).send({ message: (e as Error).message }) }
  })
  app.post<{ Body: { enabled: boolean } }>('/api/metro/telefericos/automation', { schema: { body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } } }, async (req) => { cableSim().setAutomatic(req.body.enabled); broadcast(); return { ok: true } })
  app.post('/api/metro/telefericos/reset', async () => { cableSim().reset(); broadcast(); return { ok: true } })
  app.get('/api/metro/minibuses/stream', async (req, reply) => {
    const { sim } = await buses()
    stream(req, reply, () => sim.snapshot(), (send) => {
      clients.bus++; clearTimeout(busIdle); sim.start(); const off = sim.onSnapshot(send)
      return () => { off(); if (--clients.bus === 0) busIdle = setTimeout(() => sim.stop(), 60000) }
    })
  })
  app.post<{ Params: { id: string } }>('/api/metro/minibuses/scenarios/:id', async (req, reply) => {
    try { return { ok: true, message: await (await buses()).sim.scenario(req.params.id) } }
    catch (e) { return reply.code(400).send({ message: (e as Error).message }) }
  })
  app.addHook('preClose', async () => {
    clearInterval(cableTimer); clearTimeout(cableIdle); clearTimeout(busIdle)
    for (const close of active) close()
    if (busPromise) { const b = await busPromise.catch(() => null); if (b) { b.sim.stop(); await b.db.pool.end() } }
  })
}
