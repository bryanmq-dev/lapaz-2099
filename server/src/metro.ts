import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CableCatalog, CableState } from '../../shared/metro.ts'
import { CableSimulator } from './cable.ts'

const root = resolve(process.env.METRO_DATA_DIR ?? resolve(import.meta.dirname, '../../public/metro'))
export function metroData() {
  const { base } = JSON.parse(readFileSync(`${root}/current.json`, 'utf8'))
  if (!/^v\d+$/.test(base)) throw new Error('Versión metropolitana inválida')
  return (file: string) => JSON.parse(readFileSync(`${root}/${base}/${file}.json`, 'utf8'))
}

export function registerMetro(app: FastifyInstance) {
  let cable: CableSimulator | undefined, cableTimer: NodeJS.Timeout | undefined, cableIdle: NodeJS.Timeout | undefined, viewers = 0
  const active = new Set<() => void>(), senders = new Set<() => void>()
  const cableSim = () => cable ??= new CableSimulator(metroData()('cable') as CableCatalog)
  const broadcast = () => { for (const send of senders) send() }
  const stream = (req: FastifyRequest, reply: FastifyReply, get: () => unknown, subscribe: (send: () => void) => () => void) => {
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = () => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(get())}\n\n`) }
    send(); const off = subscribe(send)
    const close = () => reply.raw.end()
    active.add(close)
    reply.raw.on('close', () => { off(); active.delete(close) })
  }
  app.get('/api/metro/catalog', async () => { const d = metroData(); return { manifest: d('manifest'), cable: d('cable') } })
  // El motor avanza solo con espectadores; 60 s después del último se detiene (y con él el reloj de incidentes).
  app.get('/api/metro/telefericos/stream', (req, reply) => {
    const sim = cableSim()
    stream(req, reply, () => sim.snapshot(), (send) => {
      viewers++; clearTimeout(cableIdle); senders.add(send)
      cableTimer ??= setInterval(() => { sim.step(); broadcast() }, 1000)
      return () => { senders.delete(send); if (--viewers === 0) cableIdle = setTimeout(() => { clearInterval(cableTimer); cableTimer = undefined }, 60000) }
    })
  })
  app.post<{ Params: { id: string }; Body: { state: CableState } }>('/api/metro/telefericos/lines/:id/state', { schema: { body: { type: 'object', required: ['state'], additionalProperties: false, properties: { state: { enum: ['normal', 'mantenimiento', 'detenido'] } } } } }, async (req, reply) => {
    try { cableSim().setState(req.params.id, req.body.state); broadcast(); return { ok: true } }
    catch (e) { return reply.code(404).send({ message: (e as Error).message }) }
  })
  app.post<{ Body: { enabled: boolean } }>('/api/metro/telefericos/automation', { schema: { body: { type: 'object', required: ['enabled'], additionalProperties: false, properties: { enabled: { type: 'boolean' } } } } }, async (req) => { cableSim().setAutomatic(req.body.enabled); broadcast(); return { ok: true } })
  app.post('/api/metro/telefericos/reset', async () => { cableSim().reset(); broadcast(); return { ok: true } })
  app.addHook('preClose', async () => {
    clearInterval(cableTimer); clearTimeout(cableIdle)
    for (const close of active) close()
  })
}
