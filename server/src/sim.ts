// Simulador de flota sobre las rutas reales del caso de estudio y la flota simulada de refuerzo.
// Movimiento en TS (determinista, con seguimiento de vehículo); detección de alertas con SQL espacial en PostGIS.
// La congestión NO se impone: aparece cuando muchos minibuses coinciden en el mismo corredor y las paradas
// dentro del carril forman cola. Se mide sobre los tramos y de ahí salen las alertas y los desvíos.
import type pg from 'pg'
import type { ZoneDb } from './db.ts'
import { Path, dist, distToLine, type LL, type Projector, type XZ } from './geo.ts'
import { RoadGraph, type Segment } from './graph.ts'
import type { Zone } from '../../shared/zones.ts'

export const OFF_ROUTE_M = 40      // distancia máxima a la ruta asignada
export const STOP_ALERT_S = Number(process.env.STOP_ALERT_S ?? 45) // tiempo detenido fuera de paradas para alertar
const BREAKDOWN_S = Number(process.env.BREAKDOWN_S ?? 100)
const AUTO_PEAK = process.env.AUTO_PEAK !== '0' // hora punta automática (la comprobación de punta a punta la apaga)
const LAYOVER_S = 40               // tramo fuera de la zona entre ida y vuelta (no se dibuja)
const SAMPLE_M = 10

// seguimiento de vehículo (Krauss): un minibús ≈ 9 m con holgura, 1,2 m/s² de aceleración, 3 m/s² de frenada
const VEH_LEN = 9, ACCEL = 1.2, DECEL = 3, TAU = 1, DAWDLE = 0.3
const SURGE_WINDOW_S = 90          // las unidades de refuerzo llegan al hotspot repartidas en esta ventana
const PEAK_EVERY_S = 480           // separación entre horas punta automáticas
const JAM_ON = 0.55, JAM_OFF = 0.35 // nivel de congestión de un tramo para encenderse / apagarse (histéresis)
const JAM_FREE_MS = 4.5            // velocidad a la que un tramo se considera libre
const JAM_MIN_M = 150              // largo mínimo de tramos congestionados de una misma calle para abrir alerta
const JAM_OPEN_KMH = 9             // y velocidad media máxima de los vehículos dentro de ese tramo

interface RouteInfo {
  id: number; code: string; direction: 'ida' | 'vuelta'; mode: string; color: string; union: string; name: string; sim: boolean
  base: Path; active: Path; activeSegAt: Segment[]; stops: { name: string; at: number }[]; segAt: Segment[]; obAt: number
  sig: { at: number; group: 'A' | 'B' } | null // línea de pare del semáforo del hotspot (en el Centro, A: Prado y Mcal. Santa Cruz · B: Camacho)
  detour: { names: string[]; extraM: number; pts: XZ[] } | null
}

interface Vehicle {
  id: number; plate: string; driver: string; kind: string; code: string; reserve: boolean
  route: RouteInfo; path: Path; segAt: Segment[]; progress: number
  phase: 'ruta' | 'pausa' | 'reserva'; wait: number; speed: number; next: number; heading: number; pos: XZ
  status: 'en_servicio' | 'desvio_autorizado'; breakdownUntil: number; nextStop: number; offPlan: boolean
  vmax: number; queued: boolean; releaseAt: number
}

export interface CityEvent { id: number; time: string; level: 'ok' | 'info' | 'warn' | 'critical'; text: string }

const clock = () => new Date().toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour12: false })
const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1

export class Simulator {
  readonly zone: Zone
  readonly proj: Projector
  private readonly pool: pg.Pool
  private readonly hot: XZ                // hotspot de la zona (en el Centro, el Obelisco)
  /** líneas reales de la zona en el orden de lines.json: la 2.ª hace el desvío y la geocerca, la 3.ª la avería */
  realCodes: string[] = []
  graph!: RoadGraph
  routes: RouteInfo[] = []
  vehicles: Vehicle[] = []
  events: CityEvent[] = []
  openAlerts: any[] = []
  tickNo = 0
  private seq = 0
  private now = 0
  private listeners = new Set<(snap: unknown) => void>()
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private switched: Vehicle[] = [] // cambios de sentido pendientes de guardar antes de las posiciones
  private jammed = new Set<number>()                                   // tramos congestionados (con histéresis)
  private jams = new Map<string, { alertId: number; calm: number }>() // calles con alerta de congestión abierta
  private jamBuild = new Map<string, number>()                         // segundos que cada calle lleva sobre el umbral
  private peak: { since: number } | null = null
  private nextPeakAt = Infinity
  private rush = 0                // 0..1: más pasajeros por parada durante la hora punta
  private controlUntil = 0        // agente de tránsito en el hotspot hasta este instante
  private noDetour = new Set<RouteInfo>() // líneas ya avisadas de que no tienen rodeo
  private warmUntil = 0          // los vehículos parten superpuestos: no se abren alertas hasta que se reparten

  constructor(db: ZoneDb) {
    this.zone = db.zone
    this.proj = db.proj
    this.pool = db.pool
    this.hot = db.proj.project(db.zone.hotspot.at)
    this.realCodes = db.data('lines.json').map((l: any) => l.code)
  }

  async init() {
    const { project } = this.proj
    const pool = this.pool
    const segs = (await pool.query(`SELECT id, name, highway, oneway, source, target, length_m, congestion, ST_AsGeoJSON(geom)::json->'coordinates' coords FROM road_segments`)).rows
    this.graph = new RoadGraph(project, segs)
    const rs = (await pool.query(
      `SELECT r.id, r.code, r.direction, r.mode, r.color, r.name, r.simulated, u.name union_name, ST_AsGeoJSON(r.geom)::json->'coordinates' coords,
              coalesce(json_agg(json_build_object('name', s.name, 'm', s.measure) ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]') stops
       FROM routes r JOIN unions u ON u.id = r.union_id LEFT JOIN stops s ON s.route_id = r.id GROUP BY r.id, u.name ORDER BY r.simulated, r.code, r.direction`)).rows
    this.routes = rs.map((r) => {
      const base = new Path((r.coords as LL[]).map(project))
      const ob = base.locate(this.hot)
      const segAt = this.sampleSegments(base)
      const crossesOb = dist(base.at(ob).p, this.hot) < 40 && ob > 40
      return {
        id: r.id, code: r.code, direction: r.direction, mode: r.mode, color: r.color, union: r.union_name, name: r.name, sim: r.simulated,
        base, active: base, activeSegAt: segAt, detour: null, segAt, obAt: crossesOb ? ob : -1, sig: crossesOb ? { at: ob - 14, group: this.signalGroup(base, segAt, ob) } : null,
        stops: r.stops.filter((s: any) => s.m > 0.02 && s.m < 0.98).map((s: any) => ({ name: s.name, at: s.m * base.length })),
      }
    })
    await this.reset(false)
  }

  /**
   * Fase del semáforo según por dónde llega la ruta al hotspot. En el Centro: B = Av. Camacho / Colón, A = Prado y Mcal. Santa Cruz.
   * En las demás zonas: A = llegadas norte-sur, B = este-oeste (rumbo de los últimos 60 m).
   */
  private signalGroup(base: Path, segAt: Segment[], ob: number): 'A' | 'B' {
    if (this.zone.id === 'centro') return [30, 50, 70, 90].some((m) => /Camacho|Colón/.test(segAt[Math.floor(Math.max(0, ob - m) / SAMPLE_M)].name)) ? 'B' : 'A'
    const h = base.at(Math.max(0, ob - 60)).heading % 180
    return h < 45 || h >= 135 ? 'A' : 'B'
  }

  /** Tramo vial más cercano cada 10 m de una trayectoria (para leer la congestión). */
  private sampleSegments(p: Path): Segment[] {
    const out: Segment[] = []
    for (let d = 0; d <= p.length; d += SAMPLE_M) out.push(this.graph.nearestSegment(p.at(d).p))
    return out
  }

  // ---- estado inicial ---------------------------------------------------------

  async reset(announce = true) {
    const pool = this.pool
    await pool.query(`UPDATE road_segments SET congestion = 0 WHERE congestion > 0`)
    await pool.query(`UPDATE alerts SET resolved_at = now() WHERE resolved_at IS NULL`)
    await pool.query(`UPDATE vehicles SET status = 'en_servicio'`)
    await pool.query(`TRUNCATE vehicle_positions`)
    for (const s of this.graph.segments.values()) s.congestion = 0
    for (const r of this.routes) { r.active = r.base; r.activeSegAt = r.segAt; r.detour = null }
    this.jammed.clear(); this.jams.clear(); this.jamBuild.clear(); this.noDetour.clear()
    this.peak = null; this.rush = 0; this.controlUntil = 0; this.warmUntil = this.now + 45
    this.nextPeakAt = AUTO_PEAK ? this.now + 20 : Infinity
    const rows = (await pool.query(
      `SELECT v.id, v.plate, v.kind, v.reserve, u.full_name driver, r.code, r.direction FROM vehicles v JOIN users u ON u.id = v.driver_id
       JOIN routes r ON r.id = v.route_id ORDER BY r.code, v.id`)).rows
    const share = new Map<string, any[]>() // unidades en servicio de cada sentido de cada línea
    for (const v of rows) if (!v.reserve) share.set(v.code + v.direction, [...(share.get(v.code + v.direction) ?? []), v])
    this.vehicles = rows.map((v) => {
      const route = this.routes.find((r) => r.code === v.code && r.direction === v.direction)!
      const list = share.get(v.code + v.direction) ?? []
      const k = list.indexOf(v)
      // reparto uniforme con un desfase propio de cada línea para que no coincidan en el mismo punto
      const progress = v.reserve ? 0 : ((k + hash(v.id * 3.7)) / list.length) * route.base.length * 0.96
      return {
        id: v.id, plate: v.plate, driver: v.driver, kind: v.kind, code: v.code, reserve: v.reserve, route, path: route.base, segAt: route.segAt,
        progress, phase: v.reserve ? 'reserva' : 'ruta', wait: 0, speed: 0, next: 0, heading: route.base.at(progress).heading, pos: route.base.at(progress).p, status: 'en_servicio',
        breakdownUntil: 0, nextStop: route.stops.findIndex((s) => s.at > progress), offPlan: false,
        vmax: (v.kind === 'trufi' ? 5 : 5.6) * (0.9 + 0.2 * hash(v.id)), queued: false, releaseAt: 0,
      } as Vehicle
    })
    this.events = []
    this.openAlerts = []
    const regular = this.vehicles.filter((v) => !v.reserve).length
    this.log('info', `Simulación iniciada en ${this.zone.name}: ${regular} vehículos en servicio y ${this.vehicles.length - regular} unidades de refuerzo en reserva (${this.routes.length / 2} líneas: ${this.routes.filter((r) => !r.sim).length / 2} reales y ${this.routes.filter((r) => r.sim).length / 2} simuladas)`)
    if (announce) this.log('ok', 'Simulación restablecida: sin congestión ni alertas')
  }

  // ---- ciclo ----------------------------------------------------------------------

  get running() { return this.timer != null }
  start() { if (!this.timer) this.timer = setInterval(() => void this.tick(), 1000) }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
  onSnapshot(fn: (s: unknown) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }

  async tick(dt = 1) {
    if (this.busy) return // nunca se solapan dos ticks
    this.busy = true
    const pool = this.pool
    const { unproject } = this.proj
    try {
      this.tickNo++
      this.now += dt
      this.runPeak()
      this.step(dt)
      if (this.switched.length) {
        const sw = this.switched.splice(0)
        try {
          await pool.query(`UPDATE vehicles v SET route_id = x.r, status = x.st FROM unnest($1::int[], $2::int[], $3::text[]) AS x(id, r, st) WHERE v.id = x.id`,
            [sw.map((v) => v.id), sw.map((v) => v.route.id), sw.map((v) => v.status)])
        } catch (e) {
          this.switched.unshift(...sw) // si la base falla, el cambio de sentido se reintenta: perderlo deja al vehículo «fuera de ruta» para siempre
          throw e
        }
      }
      const live = this.vehicles.filter((v) => v.phase === 'ruta')
      if (live.length) {
        await pool.query(
          `INSERT INTO vehicle_positions (vehicle_id, geom, speed_kmh, heading, queued)
           SELECT id, ST_SetSRID(ST_MakePoint(lon, lat), 4326), spd, hd, q FROM unnest($1::int[], $2::float8[], $3::float8[], $4::real[], $5::real[], $6::bool[]) AS t(id, lon, lat, spd, hd, q)`,
          [live.map((v) => v.id), ...[0, 1].map((k) => live.map((v) => unproject(v.pos)[k])), live.map((v) => v.speed * 3.6), live.map((v) => v.heading), live.map((v) => v.queued)],
        )
      }
      await this.monitorTraffic(live, dt)
      await this.detectAlerts()
      if (this.tickNo % 60 === 0) await pool.query(`DELETE FROM vehicle_positions WHERE ts < now() - interval '30 minutes'`)
      const snap = this.snapshot()
      this.listeners.forEach((fn) => fn(snap))
    } catch (e) {
      console.error('tick:', e)
    } finally {
      this.busy = false
    }
  }

  // ---- movimiento: seguimiento de vehículo ----------------------------------------

  /** Avanza un segundo: primero todos deciden su velocidad con el estado actual, después todos se mueven. */
  private step(dt: number) {
    const live: Vehicle[] = []
    for (const v of this.vehicles) {
      if (v.phase === 'pausa') { v.wait -= dt; if (v.wait <= 0) this.switchDirection(v) }
      else if (v.phase === 'reserva') { if (v.releaseAt > 0 && this.now >= v.releaseAt) this.release(v) }
      else live.push(v)
    }
    for (const v of live) this.drive(v, live, dt)
    for (const v of live) this.advance(v, dt)
  }

  /** Velocidad del siguiente segundo: libre, o la máxima segura detrás del vehículo que va delante (Krauss). */
  private drive(v: Vehicle, live: Vehicle[], dt: number) {
    v.queued = false
    if (v.breakdownUntil > this.now || v.wait > 0) { v.next = 0; return }
    let next = Math.min(v.vmax, v.speed + ACCEL * dt)
    let lead = this.leaderOf(v, live)
    const sig = v.path === v.route.base ? v.route.sig : null
    if (sig && v.progress < sig.at && !this.green(sig.group)) {
      const d = sig.at - v.progress // luz roja: la línea de pare actúa como un vehículo detenido, salvo que ya no alcance a frenar
      if (d < 90 && d > (v.speed * v.speed) / (2 * DECEL) && (!lead || d < lead.gap)) lead = { gap: d, speed: 0 }
    }
    if (lead) {
      const safe = lead.speed + (lead.gap - lead.speed * TAU) / ((v.speed + lead.speed) / (2 * DECEL) + TAU)
      if (safe < next) { next = Math.max(0, safe); v.queued = lead.gap < 25 }
    }
    if (next > 0) next = Math.max(0, next - DAWDLE * ACCEL * dt * hash(v.id * 131 + this.tickNo)) // vacilación humana
    v.next = next
  }

  /** Semáforo del hotspot (supuesto de la simulación): dos fases (A y B) con 3 s de despeje. */
  private green(group: 'A' | 'B') {
    const a = this.now < this.controlUntil ? 46 : 30, b = this.now < this.controlUntil ? 20 : 26 // el agente de tránsito da más verde a la fase A
    const t = this.now % (a + b + 6)
    return group === 'A' ? t < a : t >= a + 3 && t < a + 3 + b
  }

  /** Vehículo más cercano por delante, en el mismo carril y sentido (sirve también donde se juntan varias líneas). */
  private leaderOf(v: Vehicle, live: Vehicle[]) {
    const th = (v.heading * Math.PI) / 180, hx = Math.sin(th), hz = -Math.cos(th)
    let best: Vehicle | null = null, bestAhead = 60
    for (const u of live) {
      if (u === v) continue
      const dx = u.pos[0] - v.pos[0], dz = u.pos[1] - v.pos[1]
      const ahead = dx * hx + dz * hz
      if (ahead <= 0.1 || ahead >= bestAhead || Math.abs(dx * hz - dz * hx) > 4) continue
      const dh = Math.abs(((u.heading - v.heading + 540) % 360) - 180)
      if (dh > 50) continue
      if (dh > 12 && u.id > v.id) continue // al confluir flujos con rumbos distintos cede solo uno de los dos: sin esto se traban en círculo
      best = u; bestAhead = ahead
    }
    return best && { gap: bestAhead - VEH_LEN, speed: best.speed }
  }

  private advance(v: Vehicle, dt: number) {
    if (v.wait > 0 && v.breakdownUntil <= this.now) v.wait = Math.max(0, v.wait - dt)
    v.speed = v.next
    v.progress += v.speed * dt
    const stop = v.path === v.route.base ? v.route.stops[v.nextStop] : undefined
    if (stop && v.progress >= stop.at) {
      v.progress = stop.at; v.nextStop++
      v.wait = this.dwell(v, v.nextStop)
      if (v.wait > 0) v.speed = 0 // el minibús se detiene EN el carril: quien viene detrás espera
    }
    if (v.progress >= v.path.length) {
      v.speed = 0
      if (v.reserve) { v.phase = 'reserva'; v.releaseAt = 0 } // la unidad de refuerzo regresa a base
      else { v.phase = 'pausa'; v.wait = LAYOVER_S }
      return
    }
    const at = v.path.at(v.progress)
    v.pos = at.p
    v.heading = at.heading
  }

  /** Segundos de parada: a veces nadie sube ni baja; en hora punta se tarda más. El agente de tránsito lo acorta. */
  private dwell(v: Vehicle, stopNo: number) {
    if (hash(v.id * 7.3 + stopNo) < 0.5) return 0
    const t = 2 + (v.id % 5) * 0.8 + 5 * this.rush
    return Math.round(this.now < this.controlUntil ? t * 0.4 : t)
  }

  /** Al terminar el tramo de la zona, el vehículo vuelve en el sentido contrario (ida ↔ vuelta). */
  private switchDirection(v: Vehicle) {
    const next = this.routes.find((r) => r.code === v.code && r.direction !== v.route.direction)!
    v.route = next
    v.path = next.active
    v.segAt = next.activeSegAt
    v.status = next.detour ? 'desvio_autorizado' : 'en_servicio'
    v.offPlan = false
    v.progress = 0
    v.nextStop = 0
    v.phase = 'ruta'
    this.switched.push(v)
  }

  // ---- hora punta: unidades de refuerzo ---------------------------------------------

  /** Una unidad de refuerzo entra a la zona por el inicio de su ruta. */
  private release(v: Vehicle) {
    v.path = v.route.active
    v.segAt = v.route.activeSegAt
    v.status = v.route.detour ? 'desvio_autorizado' : 'en_servicio'
    v.offPlan = false; v.progress = 0; v.nextStop = 0; v.releaseAt = 0; v.speed = 2; v.phase = 'ruta'
    v.pos = v.path.at(0).p
    v.heading = v.path.at(0).heading
  }

  /**
   * Sale el refuerzo de hora punta: cada unidad parte de modo que llegue al hotspot dentro de una ventana de
   * SURGE_WINDOW_S segundos. Nadie impone la congestión: la causa el exceso de minibuses que se juntan en el corredor.
   */
  private startPeak(): number {
    const units = this.vehicles.filter((v) => v.reserve && v.phase === 'reserva')
    if (!units.length) return 0
    const first = this.now + 10
    for (const v of units) {
      const toPrado = Math.max(0, v.route.obAt - 300) / 4 // tiempo hasta 300 m antes del hotspot a velocidad media
      v.releaseAt = Math.max(this.now + 1, first + hash(v.id * 17.7) * SURGE_WINDOW_S - toPrado)
    }
    this.peak = { since: this.now }
    this.rush = 1
    this.log('warn', this.zone.id === 'centro'
      ? `Hora punta: ${units.length} minibuses de refuerzo salen hacia el Centro (Prado · Obelisco · Camacho)`
      : `Hora punta: ${units.length} minibuses de refuerzo salen hacia ${this.zone.hotspot.name}`)
    return units.length
  }

  private runPeak() {
    if (!this.peak && this.now >= this.nextPeakAt) this.startPeak()
    if (this.peak && this.now > this.peak.since + 5 && !this.vehicles.some((v) => v.reserve && (v.phase === 'ruta' || v.releaseAt > 0))) {
      this.peak = null
      this.nextPeakAt = AUTO_PEAK ? this.now + PEAK_EVERY_S : Infinity
      this.log('ok', 'Fin de la hora punta: las unidades de refuerzo regresan a base')
    }
    this.rush = this.peak ? (this.now < this.controlUntil ? 0.3 : 1) : Math.max(0, this.rush - 1 / 90)
  }

  // ---- congestión medida, alertas y desvíos ---------------------------------------------

  /**
   * Lee la velocidad real de los vehículos en cada tramo (media móvil), marca los tramos congestionados y abre o cierra
   * una alerta por calle. Al abrirse la primera se proponen desvíos; al cerrarse la última se retiran.
   */
  private async monitorTraffic(live: Vehicle[], dt: number) {
    const pool = this.pool
    const stat = new Map<number, { n: number; sum: number }>()
    for (const v of live) {
      const seg = v.segAt[Math.min(v.segAt.length - 1, Math.floor(v.progress / SAMPLE_M))]
      const e = stat.get(seg.id)
      if (e) { e.n++; e.sum += v.speed } else stat.set(seg.id, { n: 1, sum: v.speed })
    }
    const byStreet = new Map<string, Segment[]>()
    for (const s of this.graph.segments.values()) {
      const e = stat.get(s.id)
      const raw = e && e.n >= 3 ? Math.min(1, Math.max(0, 1 - e.sum / e.n / JAM_FREE_MS)) : 0
      s.congestion = s.congestion * 0.8 + raw * 0.2
      if (s.congestion >= JAM_ON) this.jammed.add(s.id)
      else if (s.congestion < JAM_OFF) this.jammed.delete(s.id)
      if (this.jammed.has(s.id) && s.name) byStreet.set(s.name, [...(byStreet.get(s.name) ?? []), s])
    }
    const metersOf = (list: Segment[] | undefined) => (list ?? []).reduce((a, s) => a + s.length, 0)
    let changed = false
    for (const [name, list] of byStreet) {
      if (this.jams.has(name)) continue
      if (this.now < this.warmUntil) continue
      const t = (this.jamBuild.get(name) ?? 0) + dt
      this.jamBuild.set(name, metersOf(list) >= JAM_MIN_M ? t : 0)
      if (t >= 12 && metersOf(list) >= JAM_MIN_M && (await this.openJam(name, list))) changed = true
    }
    for (const name of [...this.jamBuild.keys()]) if (!byStreet.has(name)) this.jamBuild.delete(name)
    for (const [name, jam] of this.jams) {
      if (metersOf(byStreet.get(name)) >= 40) { jam.calm = 0; continue }
      jam.calm += dt
      if (jam.calm >= 25) {
        await pool.query(`UPDATE alerts SET resolved_at = now() WHERE id = $1`, [jam.alertId])
        this.jams.delete(name)
        this.log('ok', `Congestión resuelta en ${name}: el flujo se normaliza`)
        changed = true
      }
    }
    if (changed) {
      if (this.jams.size) await this.applyDetours()
      else this.clearDetours()
    }
  }

  private async openJam(name: string, list: Segment[]) {
    const worst = list.reduce((a, s) => (s.congestion > a.congestion ? s : a))
    const inside = new Set(list.map((s) => s.id))
    const cars = this.vehicles.filter((v) => v.phase === 'ruta' && inside.has(v.segAt[Math.min(v.segAt.length - 1, Math.floor(v.progress / SAMPLE_M))].id))
    const kmh = cars.length ? Math.round((cars.reduce((a, v) => a + v.speed, 0) / cars.length) * 36) / 10 : 0
    if (kmh > JAM_OPEN_KMH) return false // tramos lentos pero con flujo: aún no es una congestión
    const nearOb = list.some((s) => s.pts.some((p) => dist(p, this.hot) < 350))
    const detail = { via: nearOb ? `${name} (zona ${this.zone.hotspot.short})` : name, tramos: list.length, largo_m: Math.round(list.reduce((a, s) => a + s.length, 0)), vehiculos: cars.length, velocidad_kmh: kmh }
    const { rows } = await this.pool.query(
      `INSERT INTO alerts (kind, road_segment_id, geom, detail) SELECT 'congestion', $1, ST_LineInterpolatePoint(geom, 0.5), $2::jsonb FROM road_segments WHERE id = $1
       ON CONFLICT DO NOTHING RETURNING id`, [worst.id, JSON.stringify(detail)])
    this.jams.set(name, { alertId: rows[0]?.id ?? 0, calm: 0 })
    this.log('critical', `Congestión en ${name}: ${cars.length} vehículos a ${kmh} km/h en ${detail.largo_m} m`)
    return true
  }

  /** Propone a cada línea que cruza tramos congestionados un rodeo por la red vial (respeta sentido único). */
  private async applyDetours() {
    const blocked = new Set(this.jammed)
    let sim = 0
    for (const r of this.routes) {
      const hits = r.segAt.map((s, i) => (blocked.has(s.id) ? i : -1)).filter((i) => i >= 0)
      if (hits.length < 4) continue
      const entry = Math.max(0, hits[0] * SAMPLE_M - 40), exit = Math.min(r.base.length, hits[hits.length - 1] * SAMPLE_M + 40)
      const alt = this.graph.shortestPath(this.graph.nearestNode(r.base.at(entry).p), this.graph.nearestNode(r.base.at(exit).p), undefined, JAM_ON)
      if (!alt) { if (!r.sim && !this.noDetour.has(r)) { this.noDetour.add(r); this.log('warn', `Sin desvío disponible para Línea ${r.code} (${r.direction})`) } continue }
      const had = r.detour
      r.active = new Path([...r.base.slice(0, entry), ...alt.pts, ...r.base.slice(exit, r.base.length)])
      r.detour = { names: alt.names, extraM: Math.round(r.active.length - r.base.length), pts: alt.pts }
      const fresh = !had || had.extraM !== r.detour.extraM // solo se avisa si el desvío es nuevo o cambió
      if (r.sim) { if (fresh) sim++ }
      else if (fresh) this.log('info', `Desvío sugerido Línea ${r.code} (${r.direction}): ${alt.names.slice(0, 4).join(' → ')} · ${r.detour.extraM >= 0 ? '+' : ''}${r.detour.extraM} m (~${Math.max(1, Math.round(r.detour.extraM / 300))} min)`)
      // el tramo vial de cada 10 m solo cambia en el desvío: se reutiliza el de la ruta base antes y después (desfase < 10 m)
      const segAt = [...r.segAt.slice(0, Math.floor(entry / SAMPLE_M)), ...this.sampleSegments(new Path(alt.pts)), ...r.segAt.slice(Math.ceil(exit / SAMPLE_M))]
      r.activeSegAt = segAt
      for (const v of this.vehicles) if (v.route === r && v.phase === 'ruta' && v.progress < entry && !v.offPlan) {
        v.path = r.active; v.segAt = segAt; v.status = 'desvio_autorizado'
      }
    }
    if (sim) this.log('info', `Desvío sugerido a ${sim} sentidos de líneas simuladas que cruzan el tramo congestionado`)
    await this.syncStatus()
  }

  private clearDetours() {
    this.noDetour.clear()
    if (!this.routes.some((r) => r.detour)) return
    for (const r of this.routes) { r.active = r.base; r.activeSegAt = r.segAt; r.detour = null }
    this.log('ok', 'Se retiran los desvíos sugeridos')
  }

  // ---- alertas (PostGIS) ---------------------------------------------------------

  private async detectAlerts() {
    const pool = this.pool
    const { rows } = await pool.query(
      `WITH v AS (
         SELECT DISTINCT ON (p.vehicle_id) p.vehicle_id, p.geom, ve.route_id, ve.status
         FROM vehicle_positions p JOIN vehicles ve ON ve.id = p.vehicle_id
         WHERE p.ts > now() - interval '4 seconds' ORDER BY p.vehicle_id, p.ts DESC),
       off AS (   -- fuera de ruta: ninguna posición de los últimos 3 s a menos de $1 m de su ruta
         SELECT v.vehicle_id, v.geom, round(ST_Distance(v.geom::geography, r.geom::geography)) d
         FROM v JOIN routes r ON r.id = v.route_id
         WHERE v.status <> 'desvio_autorizado'
           AND (SELECT count(*) FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id AND p.ts > now() - interval '3500 milliseconds') >= 3
           AND NOT EXISTS (
             SELECT 1 FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id AND p.ts > now() - interval '3500 milliseconds'
               AND ST_DWithin(p.geom::geography, r.geom::geography, $1))),
       stopped AS ( -- detenido: velocidad < 2 km/h durante $2 s, fuera de paradas, terminales y colas de tráfico
         SELECT v.vehicle_id, v.geom FROM v
         WHERE (SELECT max(speed_kmh) FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id AND p.ts > now() - make_interval(secs => $2)) < 2
           AND (SELECT min(ts) FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id) < now() - make_interval(secs => $2)
           AND NOT EXISTS (SELECT 1 FROM geofences g WHERE g.kind IN ('parada', 'terminal') AND ST_Intersects(g.geom, v.geom))
           AND NOT EXISTS (SELECT 1 FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id AND p.queued AND p.ts > now() - make_interval(secs => $2))),
       fence AS (   -- dentro de una geocerca restringida
         SELECT v.vehicle_id, v.geom, g.id gid, g.name FROM v JOIN geofences g ON g.kind = 'restringida' AND ST_Intersects(g.geom, v.geom)),
       cur AS (
         SELECT 'fuera_de_ruta'::alert_kind kind, vehicle_id, geom, NULL::int gid, jsonb_build_object('distancia_m', d) detail FROM off
         UNION ALL SELECT 'detenido', vehicle_id, geom, NULL, '{}'::jsonb FROM stopped
         UNION ALL SELECT 'geocerca', vehicle_id, geom, gid, jsonb_build_object('geocerca', name) FROM fence),
       opened AS (
         INSERT INTO alerts (kind, vehicle_id, geofence_id, geom, detail) SELECT kind, vehicle_id, gid, geom, detail FROM cur
         ON CONFLICT (vehicle_id, kind) WHERE resolved_at IS NULL AND vehicle_id IS NOT NULL DO NOTHING
         RETURNING id, kind, vehicle_id, detail),
       closed AS (
         UPDATE alerts a SET resolved_at = now()
         WHERE a.resolved_at IS NULL AND a.vehicle_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM cur WHERE cur.vehicle_id = a.vehicle_id AND cur.kind = a.kind)
         RETURNING id, kind, vehicle_id, detail)
       SELECT 'open' op, * FROM opened UNION ALL SELECT 'close', * FROM closed`,
      [OFF_ROUTE_M, STOP_ALERT_S],
    )
    for (const a of rows) {
      const v = this.vehicles.find((x) => x.id === a.vehicle_id)
      const who = v ? `${v.plate} (Línea ${v.code}, ${v.driver})` : `vehículo ${a.vehicle_id}`
      if (a.op === 'open') {
        if (a.kind === 'fuera_de_ruta') this.log('critical', `Fuera de ruta: ${who} a ${a.detail.distancia_m} m de su recorrido`)
        if (a.kind === 'detenido') this.log('warn', `Detenido más de ${STOP_ALERT_S} s fuera de parada: ${who}`)
        if (a.kind === 'geocerca') this.log('critical', `Ingreso a geocerca «${a.detail.geocerca}»: ${who}`)
      } else if (v?.phase === 'ruta') {
        this.log('ok', `Alerta resuelta (${a.kind.replace(/_/g, ' ')}): ${who}`)
      }
    }
    this.openAlerts = (await pool.query(
      `SELECT a.id, a.kind, a.vehicle_id, a.road_segment_id, a.started_at, a.detail, ST_X(a.geom) lon, ST_Y(a.geom) lat, v.plate, r.code
       FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN routes r ON r.id = v.route_id
       WHERE a.resolved_at IS NULL ORDER BY a.started_at DESC`)).rows
  }

  // ---- escenarios -------------------------------------------------------------------

  async scenario(id: string): Promise<string> {
    switch (id) {
      case 'congestion': return this.rushHour()
      case 'despejar': return this.trafficControl()
      case 'desvio': return this.unauthorizedDetour()
      case 'averia': return this.breakdown()
      case 'geocerca': return this.enterPlaza()
      case 'reset': await this.reset(); return 'Simulación restablecida'
      default: throw new Error(`escenario desconocido: ${id}`)
    }
  }

  /** Hora punta ahora: salen las unidades de refuerzo y la congestión se forma sola. */
  private async rushHour() {
    if (this.peak) return 'Ya hay una hora punta en curso'
    const n = this.startPeak()
    return n ? `Hora punta: ${n} minibuses de refuerzo salen hacia ${this.zone.id === 'centro' ? 'el Centro' : this.zone.hotspot.name}` : 'No hay unidades de refuerzo disponibles'
  }

  /** Un agente de tránsito ordena el hotspot: paradas más cortas y el refuerzo que no salió se queda en base. */
  private async trafficControl() {
    if (!this.jams.size && !this.peak) return 'No hay congestión activa'
    this.controlUntil = this.now + 150
    for (const v of this.vehicles) if (v.reserve && v.phase === 'reserva') v.releaseAt = 0
    this.log('ok', `Agente de tránsito en ${this.zone.id === 'centro' ? 'el Obelisco' : this.zone.hotspot.name}: paradas más cortas y el refuerzo pendiente se retiene en base`)
    return 'Control de tránsito activado'
  }

  private pick(code: string, pred: (v: Vehicle) => boolean = () => true) {
    return this.vehicles.find((v) => v.code === code && v.phase === 'ruta' && !v.offPlan && v.breakdownUntil <= this.now && pred(v))
  }

  /** Un minibús de la 2.ª línea real (la 204 en el Centro) deja su ruta por una calle lateral y se reincorpora más adelante. */
  private async unauthorizedDetour() {
    const code = this.realCodes[1]
    let best: { v: Vehicle; start: number; end: number; alt: NonNullable<ReturnType<RoadGraph['shortestPath']>> } | null = null
    for (const v of this.vehicles) {
      if (v.code !== code || v.phase !== 'ruta' || v.offPlan || v.breakdownUntil > this.now || v.path !== v.route.active) continue
      const near = new Set(v.segAt.map((s) => s.id))
      for (const ahead of [60, 160, 260]) {
        const start = v.progress + ahead, end = start + 260
        if (end > v.path.length - 150) continue
        const alt = this.graph.shortestPath(this.graph.nearestNode(v.path.at(start).p), this.graph.nearestNode(v.path.at(end).p), (s) => (near.has(s.id) ? 6 : 1))
        if (!alt) continue
        const away = Math.max(...alt.pts.map((p) => distToLine(p, v.route.base.pts)))
        if (away < 70) continue // debe salir de verdad del corredor para ser un desvío
        if (!best || alt.length < best.alt.length) best = { v, start, end, alt }
      }
    }
    if (!best) return `No hay un vehículo de la Línea ${code} disponible ahora; intenta en unos segundos`
    const { v, start, end, alt } = best
    v.path = new Path([...v.path.slice(0, start), ...alt.pts, ...v.path.slice(end, v.path.length)])
    v.segAt = this.sampleSegments(v.path)
    v.offPlan = true
    this.log('warn', `Simulación: ${v.plate} (Línea ${code}) toma ${alt.names.slice(0, 2).join(' / ') || 'una calle lateral'} sin autorización`)
    return `Desvío no autorizado: ${v.plate}`
  }

  /** Un vehículo de la 3.ª línea real (el trufi 453 en el Centro) se detiene (avería) lejos de las paradas durante 100 s. */
  private async breakdown() {
    const code = this.realCodes[2]
    const v = this.pick(code, (x) => {
      const s = x.route.stops.map((st) => Math.abs(st.at - x.progress))
      return x.progress > 120 && x.progress < x.path.length - 200 && (!s.length || Math.min(...s) > 80)
    }) ?? this.pick(code)
    if (!v) return `No hay un vehículo de la Línea ${code} disponible ahora`
    v.breakdownUntil = this.now + BREAKDOWN_S
    this.log('warn', `Simulación: ${v.plate} (Línea ${code}, ${v.driver}) se detiene por avería`)
    return `Avería simulada: ${v.plate}`
  }

  /**
   * Un minibús corta camino por la plaza peatonal de la zona (en el Centro, Plaza Murillo, con la 204). Lo intenta la línea real
   * que pasa más cerca de la plaza (en el Centro, la 2.ª).
   */
  private async enterPlaza() {
    const { rows: [g] } = await this.pool.query(`SELECT name, ST_X(c) lon, ST_Y(c) lat FROM (SELECT name, ST_Centroid(geom) c FROM geofences WHERE kind = 'restringida' LIMIT 1) x`)
    if (!g) return 'La zona no tiene una plaza peatonal para este escenario'
    const plaza = this.proj.project([g.lon, g.lat])
    const name = String(g.name).replace(/ \(sin tránsito vehicular\)$/, '')
    const near = (c: string) => Math.min(...this.routes.filter((r) => r.code === c).map((r) => dist(r.base.at(r.base.locate(plaza)).p, plaza)))
    const code = this.zone.id === 'centro' ? this.realCodes[1] : [...this.realCodes].sort((a, b) => near(a) - near(b))[0]
    const reach = Math.max(200, near(code) + 60) // la plaza puede quedar a algunas cuadras de la línea
    for (const v of this.vehicles) {
      if (v.code !== code || v.phase !== 'ruta' || v.offPlan || v.path !== v.route.active) continue
      const m = v.path.locate(plaza)
      if (dist(v.path.at(m).p, plaza) > reach || v.progress > m - 60) continue
      v.path = new Path([...v.path.slice(0, m - 50), plaza, ...v.path.slice(m + 50, v.path.length)])
      v.segAt = this.sampleSegments(v.path)
      v.offPlan = true
      this.log('warn', `Simulación: ${v.plate} (Línea ${code}) se dirige a cruzar la ${name}`)
      return `Ingreso a geocerca simulado: ${v.plate}`
    }
    return `Ningún minibús de la ${code} se acerca ahora a ${name}; intenta en unos segundos`
  }

  private async syncStatus() {
    await this.pool.query(`UPDATE vehicles v SET status = x.st FROM unnest($1::int[], $2::text[]) AS x(id, st) WHERE v.id = x.id`,
      [this.vehicles.map((v) => v.id), this.vehicles.map((v) => v.status)])
  }

  // ---- salida -------------------------------------------------------------------------

  log(level: CityEvent['level'], text: string) {
    this.events = [{ id: ++this.seq, time: clock(), level, text }, ...this.events].slice(0, 40)
  }

  snapshot() {
    const { unproject } = this.proj
    const alertBy = new Map(this.openAlerts.filter((a) => a.vehicle_id).map((a) => [a.vehicle_id, a.kind]))
    const live = this.vehicles.filter((v) => v.phase === 'ruta')
    const vehicles = live.map((v) => {
      const [lon, lat] = unproject(v.pos)
      const state = alertBy.get(v.id) ? 'alerta' : v.speed === 0 && v.breakdownUntil > this.now ? 'detenido'
        : v.status === 'desvio_autorizado' ? 'desvio' : v.speed < 2 ? 'congestion' : 'normal'
      return { id: v.id, plate: v.plate, code: v.code, sim: v.route.sim, direction: v.route.direction, kind: v.kind, lon, lat, heading: Math.round(v.heading), speedKmh: Math.round(v.speed * 36) / 10, state, alert: alertBy.get(v.id) ?? null }
    })
    const congested = [...this.jammed].map((id) => this.graph.segments.get(id)!)
    return {
      t: new Date().toISOString(),
      vehicles,
      alerts: this.openAlerts.map((a) => ({ id: a.id, kind: a.kind, vehicleId: a.vehicle_id, plate: a.plate, code: a.code, detail: a.detail, startedAt: a.started_at, lon: a.lon, lat: a.lat })),
      congestion: congested.map((s) => ({ id: s.id, level: s.congestion, coords: s.pts.map(unproject) })),
      reroutes: this.routes.filter((r) => r.detour && !r.sim).map((r) => ({
        code: r.code, direction: r.direction, via: r.detour!.names, extraM: r.detour!.extraM,
        extraMin: Math.max(1, Math.round(r.detour!.extraM / 300)), coords: r.detour!.pts.map(unproject),
      })),
      metrics: {
        active: live.length,
        avgSpeedKmh: live.length ? Math.round((live.reduce((s, v) => s + v.speed, 0) / live.length) * 36) / 10 : 0,
        alerts: this.openAlerts.length,
        congestedSegments: congested.length,
        peak: this.peak != null,
        reserveOut: this.vehicles.filter((v) => v.reserve && v.phase === 'ruta').length,
      },
      events: this.events,
    }
  }
}
