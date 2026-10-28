import { randomUUID } from 'node:crypto'
import { STATE_LABEL, type CableCatalog, type CableState, type CableSnapshot, type CableEvent } from '../../shared/metro.ts'

export class CableSimulator {
  session = randomUUID()
  elapsed = 0
  automatic = true
  private seq = 0
  private eventId = 0
  private nextAt = 60
  private random = 2050
  private events: CableEvent[] = []
  private lines: Map<string, { id: string; state: CableState; phaseM: number; resumeAt: number | null; manual: boolean }>
  private names: Map<string, string>
  constructor(catalog: CableCatalog) {
    this.names = new Map(catalog.lines.map((l) => [l.id, l.name]))
    this.lines = new Map(catalog.lines.map((l) => [l.id, { id: l.id, state: 'normal', phaseM: 0, resumeAt: null, manual: false }]))
  }
  setState(id: string, state: CableState, source: 'manual' | 'auto' = 'manual') {
    const line = this.lines.get(id)
    if (!line) throw new Error('Línea desconocida')
    if (!(state in STATE_LABEL) || !['normal', 'mantenimiento', 'detenido'].includes(state)) throw new Error('Estado inválido')
    if (source === 'manual') { line.resumeAt = null; line.manual = state !== 'normal' }
    if (line.state === state) return
    const before = line.state
    line.state = state
    line.resumeAt = source === 'auto' && state !== 'normal' ? this.elapsed + (state === 'detenido' ? 45 : 90) : null
    this.events.push({ id: ++this.eventId, time: new Date().toISOString(), lineId: id, before, after: state, source, text: `${this.names.get(id)} · ${STATE_LABEL[state]} · ${source === 'manual' ? 'Control manual' : 'Escenario automático'}` })
    if (this.events.length > 100) this.events.shift()
    this.seq++
  }
  setAutomatic(enabled: boolean) { this.automatic = enabled; this.nextAt = this.elapsed + 60; this.seq++ }
  step(dt = 1) {
    // Fixed substeps make recovery and incident timing independent of caller cadence.
    for (let left = dt; left > 0; left -= 1) {
      const delta = Math.min(1, left)
      this.elapsed += delta
      for (const l of this.lines.values()) {
        if (l.state === 'normal') l.phaseM += delta * 5
        if (l.resumeAt !== null && this.elapsed >= l.resumeAt) this.setState(l.id, 'normal', 'auto')
      }
      if (this.automatic && this.elapsed >= this.nextAt) {
        this.nextAt = this.elapsed + 180
        const free = [...this.lines.values()].filter((l) => l.state === 'normal' && !l.manual)
        if (free.length && ![...this.lines.values()].some((l) => l.resumeAt !== null)) {
          this.random = (Math.imul(this.random, 1664525) + 1013904223) >>> 0
          this.setState(free[this.random % free.length].id, this.random % 2 ? 'detenido' : 'mantenimiento', 'auto')
        }
      }
      this.seq++
    }
  }
  reset() {
    this.session = randomUUID(); this.elapsed = 0; this.seq = 0; this.eventId = 0; this.events = []; this.random = 2050; this.nextAt = 60; this.automatic = true
    for (const l of this.lines.values()) { l.state = 'normal'; l.phaseM = 0; l.resumeAt = null; l.manual = false }
  }
  snapshot(): CableSnapshot {
    return { session: this.session, seq: this.seq, t: new Date().toISOString(), elapsed: this.elapsed, automatic: this.automatic,
      lines: [...this.lines.values()].map((l) => ({ id: l.id, state: l.state, phaseM: l.phaseM, speed: l.state === 'normal' ? 5 : 0, resumeAt: l.resumeAt })), events: this.events.map((e) => ({ ...e })) }
  }
}
