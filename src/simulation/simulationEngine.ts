import { DISTRICTS, ROADS, SENSORS, districtById } from './cityData.ts'
import type {
  Action, Alert, CityEvent, CityMetrics, DistrictStatus, Incident, Level, Recommendation,
  SensorStatus, SimState, SimView,
} from './types.ts'

export const DETECT_TICKS = 3
export const RECOVER_TICKS = 6
const RESPONDING_FACTOR = 0.62
const START_MINUTE = 18 * 60 + 40
const INCIDENT_ORDER = ['centro', 'obrajes', 'miraflores', 'zonasur', 'sopocachi', 'villa', 'alto']

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const fmt = (m: number) => {
  const t = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}
const name = (id: string) => districtById(id).name
const dist = (a: string, b: string) => {
  const [p, q] = [districtById(a).pos, districtById(b).pos]
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}
const neighborsOf = (id: string) =>
  ROADS.filter((r) => r.from === id || r.to === id).map((r) => (r.from === id ? r.to : r.from))

// ---- rutas ---------------------------------------------------------------

/** Camino más corto (Dijkstra sobre el grafo de avenidas), evitando un distrito. */
function shortestPath(from: string, to: string, avoid?: string): { path: string[]; length: number } {
  const d = new Map<string, number>([[from, 0]])
  const prev = new Map<string, string>()
  const open = new Set([from])
  while (open.size) {
    let u = ''
    for (const n of open) if (!u || d.get(n)! < d.get(u)!) u = n
    open.delete(u)
    if (u === to) break
    for (const v of neighborsOf(u)) {
      if (v === avoid) continue
      const nd = d.get(u)! + dist(u, v)
      if (nd < (d.get(v) ?? Infinity)) { d.set(v, nd); prev.set(v, u); open.add(v) }
    }
  }
  if (!d.has(to)) return { path: [], length: 0 }
  const path = [to]
  while (path[0] !== from) path.unshift(prev.get(path[0])!)
  return { path, length: d.get(to)! }
}

/** Corredor afectado: los dos vecinos más alejados entre sí; ruta normal vs. alterna. */
function planRoutes(districtId: string) {
  const ns = neighborsOf(districtId)
  let best: [string, string] = [ns[0], ns[ns.length - 1]]
  let far = -1
  for (const a of ns) for (const b of ns) if (a < b && dist(a, b) > far) { far = dist(a, b); best = [a, b] }
  const normalLen = dist(best[0], districtId) + dist(districtId, best[1])
  const alt = shortestPath(best[0], best[1], districtId)
  return {
    normalRoute: [best[0], districtId, best[1]],
    altRoute: alt.path,
    extraMinutes: Math.max(2, Math.round((alt.length - normalLen) * 0.22)),
  }
}

// ---- estado --------------------------------------------------------------

function log(s: SimState, level: Level, text: string): SimState {
  const e: CityEvent = { id: s.seq + 1, time: fmt(s.minute), level, text }
  return { ...s, seq: s.seq + 1, events: [e, ...s.events].slice(0, 40) }
}

export function initialState(): SimState {
  let s: SimState = {
    tick: 0, minute: START_MINUTE, seq: 0, selectedId: null, mode: 'traffic', orbit: true,
    viewSeq: 0, incident: null, incidentCount: 0, events: [],
  }
  const online = SENSORS.filter((x) => !x.offline).length
  s = log(s, 'info', 'Gemelo digital en línea · modo simulación')
  s = log(s, 'ok', `Red de sensores sincronizada: ${online}/${SENSORS.length} conectados`)
  return s
}

export function reduce(s: SimState, a: Action): SimState {
  switch (a.type) {
    case 'select':
      return s.selectedId === a.id ? s : { ...s, selectedId: a.id }
    case 'mode':
      return s.mode === a.mode ? s : { ...s, mode: a.mode }
    case 'orbit':
      return s.orbit === a.on ? s : { ...s, orbit: a.on }
    case 'home':
      return { ...s, selectedId: null, viewSeq: s.viewSeq + 1 }
    case 'reset':
      return resetState(s)
    case 'incident': {
      if (s.incident) return s
      const id = s.selectedId ?? INCIDENT_ORDER[s.incidentCount % INCIDENT_ORDER.length]
      const routes = planRoutes(id)
      const incident: Incident = {
        id: s.incidentCount + 1, districtId: id, phase: 'detected', startedTick: s.tick, phaseTick: s.tick,
        fromFactor: 1, ...routes,
      }
      const hit = SENSORS.filter((x) => x.districtId === id && x.kind === 'traffic' && !x.offline).map((x) => x.id)
      let n: SimState = { ...s, incident, incidentCount: s.incidentCount + 1 }
      n = log(n, 'critical', `Incidente de tráfico detectado en ${name(id)} · sensores ${hit.join(', ') || 'zonales'}`)
      return log(n, 'warn', `Congestión severa: movilidad en descenso · evaluando desvíos`)
    }
    case 'resolve': {
      const inc = s.incident
      if (!inc || inc.phase === 'recovering') return s
      const n: SimState = {
        ...s,
        incident: { ...inc, phase: 'recovering', phaseTick: s.tick, fromFactor: factorOf(inc, s.tick) },
      }
      return log(n, 'info', `Recuperación iniciada en ${name(inc.districtId)} · restableciendo semáforos y flujo`)
    }
    case 'tick': {
      let n: SimState = { ...s, tick: s.tick + 1, minute: s.minute + 1 }
      const inc = n.incident
      if (inc?.phase === 'detected' && n.tick - inc.phaseTick >= DETECT_TICKS) {
        n = { ...n, incident: { ...inc, phase: 'responding', phaseTick: n.tick } }
        n = log(n, 'warn', `Unidades de respuesta desplegadas en ${name(inc.districtId)}`)
        n = log(n, 'info', `Ruta alterna activa: ${inc.altRoute.map(name).join(' → ')} (+${inc.extraMinutes} min)`)
      } else if (inc?.phase === 'recovering' && n.tick - inc.phaseTick >= RECOVER_TICKS) {
        n = { ...n, incident: null }
        n = log(n, 'ok', `Movilidad normalizada en ${name(inc.districtId)} · incidente cerrado`)
      }
      return n
    }
  }
}

function resetState(s: SimState): SimState {
  const fresh = initialState()
  return log({ ...fresh, viewSeq: s.viewSeq + 1, orbit: s.orbit }, 'info', 'Simulación restablecida')
}

function factorOf(inc: Incident | null, tick: number): number {
  if (!inc) return 0
  if (inc.phase === 'detected') return 1
  if (inc.phase === 'responding') return RESPONDING_FACTOR
  return inc.fromFactor * (1 - clamp((tick - inc.phaseTick) / RECOVER_TICKS, 0, 1))
}

// ---- vista derivada (métricas, colores y alertas salen del mismo estado) ---

function districtsAt(minute: number, inc: Incident | null, f: number): DistrictStatus[] {
  const adj = inc ? neighborsOf(inc.districtId) : []
  return DISTRICTS.map((d, i) => {
    let traffic = d.baseTraffic + 7 * Math.sin((minute * 2 * Math.PI) / 90 + i * 1.3)
    let energy = d.baseEnergy + 5 * Math.sin((minute * 2 * Math.PI) / 140 + i * 0.7)
    const hasIncident = inc?.districtId === d.id
    const onAltRoute = !!inc && !hasIncident && inc.altRoute.includes(d.id)
    if (hasIncident) { traffic += 52 * f; energy += 7 * f }
    else if (adj.includes(d.id)) traffic += 15 * f
    else if (onAltRoute) { traffic += 6 * f; energy += 3 * f }
    traffic = clamp(Math.round(traffic), 4, 99)
    energy = clamp(Math.round(energy), 10, 99)
    const level: Level = traffic >= 80 || energy >= 90 ? 'critical' : traffic >= 60 || energy >= 78 ? 'warn' : 'ok'
    return {
      id: d.id, traffic, energy, level, hasIncident, onAltRoute,
      loadMW: Math.round((d.capacityMW * energy) / 100),
      sensorsOnline: 0, sensorsTotal: 0,
    }
  })
}

function aggregate(ds: DistrictStatus[], f: number) {
  let wt = 0, avgT = 0, avgE = 0
  ds.forEach((s, i) => { const w = DISTRICTS[i].weight; wt += w; avgT += w * s.traffic; avgE += w * s.energy })
  avgT /= wt; avgE /= wt
  return {
    mobility: Math.round(100 - 0.7 * avgT),
    efficiency: Math.round((94.2 - 0.05 * avgE - 2.4 * f) * 10) / 10,
  }
}

function recommend(s: SimState, ds: DistrictStatus[]): Recommendation {
  const inc = s.incident
  if (inc) {
    const where = name(inc.districtId)
    if (inc.phase === 'detected')
      return { level: 'critical', rule: 'R-01 · incidente sin respuesta', title: `Verificar y despachar en ${where}`, text: 'Confirmar con sensores adyacentes, desplegar unidades y calcular desvío.' }
    if (inc.phase === 'responding')
      return { level: 'warn', rule: 'R-02 · desvío por saturación', title: 'Desviar el flujo por la ruta alterna', text: `${inc.altRoute.map(name).join(' → ')} · +${inc.extraMinutes} min frente a la ruta habitual.` }
    return { level: 'info', rule: 'R-03 · recuperación en curso', title: 'Normalizando semáforos y flujo', text: `Retirar el desvío cuando la congestión de ${where} baje de 60%.` }
  }
  const hot = ds.filter((d) => d.traffic >= 60)[0]
  if (hot) return { level: 'info', rule: 'R-04 · pico de tráfico', title: `Ajustar ciclos semafóricos en ${name(hot.id)}`, text: 'Ampliar fase verde en el eje principal durante la hora punta.' }
  return { level: 'ok', rule: 'R-00 · operación estable', title: 'Sin acciones requeridas', text: 'Todos los indicadores dentro de rango. Prueba “Simular incidente”.' }
}

export function derive(s: SimState): SimView {
  const f = factorOf(s.incident, s.tick)
  const districts = districtsAt(s.minute, s.incident, f)
  const base = aggregate(districtsAt(s.minute, null, 0), 0)
  const now = aggregate(districts, f)

  const sensors: SensorStatus[] = SENSORS.map((x) => ({
    ...x,
    state: x.offline ? 'offline' : s.incident?.districtId === x.districtId && x.kind === 'traffic' && f > 0.35 ? 'alert' : 'ok',
  }))
  districts.forEach((d) => {
    const mine = sensors.filter((x) => x.districtId === d.id)
    d.sensorsTotal = mine.length
    d.sensorsOnline = mine.filter((x) => x.state !== 'offline').length
  })

  const alerts: Alert[] = []
  if (s.incident) {
    const id = s.incident.districtId
    const lvl: Level = s.incident.phase === 'detected' ? 'critical' : s.incident.phase === 'responding' ? 'warn' : 'info'
    alerts.push({ id: `inc-${s.incident.id}`, level: lvl, districtId: id, text: `Incidente de tráfico · ${name(id)}` })
  }
  sensors.filter((x) => x.state === 'alert').forEach((x) =>
    alerts.push({ id: x.id, level: 'warn', districtId: x.districtId, text: `${x.id} · flujo anómalo en ${name(x.districtId)}` }))

  const online = sensors.filter((x) => x.state !== 'offline').length
  const metrics: CityMetrics = {
    mobility: now.mobility, mobilityDelta: now.mobility - base.mobility,
    efficiency: now.efficiency, efficiencyDelta: Math.round((now.efficiency - base.efficiency) * 10) / 10,
    sensorsOnline: online, sensorsTotal: sensors.length, alerts: alerts.length,
  }
  return { state: s, clock: fmt(s.minute), districts, sensors, metrics, alerts, recommendation: recommend(s, districts), factor: f }
}

// ---- store mínimo (sin dependencias) ------------------------------------

export function createSim() {
  let view = derive(initialState())
  const subs = new Set<() => void>()
  return {
    getView: () => view,
    subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn) } },
    dispatch(a: Action) {
      const next = reduce(view.state, a)
      if (next === view.state) return
      view = derive(next)
      subs.forEach((fn) => fn())
    },
  }
}
