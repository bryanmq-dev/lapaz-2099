// Simulador de flota sobre las rutas reales del caso de estudio.
// Movimiento en TS (determinista); detección de alertas con SQL espacial en PostGIS.
import { pool } from './db.ts'
import { Path, dist, distToLine, project, unproject, type LL, type XZ } from './geo.ts'
import { RoadGraph, type Segment } from './graph.ts'

export const OFF_ROUTE_M = 40      // distancia máxima a la ruta asignada
export const STOP_ALERT_S = Number(process.env.STOP_ALERT_S ?? 45) // tiempo detenido fuera de paradas para alertar
const BREAKDOWN_S = Number(process.env.BREAKDOWN_S ?? 100)
const LAYOVER_S = 40               // tramo fuera del Centro entre ida y vuelta (no se dibuja)
const SAMPLE_M = 10
const PRADO = 'Avenida 16 de Julio'

interface RouteInfo {
  id: number; code: string; direction: 'ida' | 'vuelta'; mode: string; color: string; union: string; name: string
  base: Path; active: Path; stops: { name: string; at: number }[]; segAt: Segment[]
  detour: { names: string[]; extraM: number; pts: XZ[] } | null
}

interface Vehicle {
  id: number; plate: string; driver: string; kind: string; code: string
  route: RouteInfo; path: Path; segAt: Segment[]; progress: number
  phase: 'ruta' | 'pausa'; wait: number; speed: number; heading: number; pos: XZ
  status: 'en_servicio' | 'desvio_autorizado'; breakdownUntil: number; nextStop: number; offPlan: boolean
}

export interface CityEvent { id: number; time: string; level: 'ok' | 'info' | 'warn' | 'critical'; text: string }

const clock = () => new Date().toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour12: false })
const hash = (n: number) => Math.abs(Math.sin(n * 12.9898) * 43758.5453) % 1

export class Simulator {
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

  async init() {
    const segs = (await pool.query(`SELECT id, name, highway, oneway, source, target, length_m, congestion, ST_AsGeoJSON(geom)::json->'coordinates' coords FROM road_segments`)).rows
    this.graph = new RoadGraph(segs)
    const rs = (await pool.query(
      `SELECT r.id, r.code, r.direction, r.mode, r.color, r.name, u.name union_name, ST_AsGeoJSON(r.geom)::json->'coordinates' coords,
              coalesce(json_agg(json_build_object('name', s.name, 'm', s.measure) ORDER BY s.seq) FILTER (WHERE s.id IS NOT NULL), '[]') stops
       FROM routes r JOIN unions u ON u.id = r.union_id LEFT JOIN stops s ON s.route_id = r.id GROUP BY r.id, u.name ORDER BY r.code, r.direction`)).rows
    this.routes = rs.map((r) => {
      const base = new Path((r.coords as LL[]).map(project))
      return {
        id: r.id, code: r.code, direction: r.direction, mode: r.mode, color: r.color, union: r.union_name, name: r.name,
        base, active: base, detour: null, segAt: this.sampleSegments(base),
        stops: r.stops.filter((s: any) => s.m > 0.02 && s.m < 0.98).map((s: any) => ({ name: s.name, at: s.m * base.length })),
      }
    })
    await this.reset(false)
  }

  /** Tramo vial más cercano cada 10 m de una trayectoria (para leer la congestión). */
  private sampleSegments(p: Path): Segment[] {
    const out: Segment[] = []
    for (let d = 0; d <= p.length; d += SAMPLE_M) out.push(this.graph.nearestSegment(p.at(d).p))
    return out
  }

  // ---- estado inicial ---------------------------------------------------------

  async reset(announce = true) {
    await pool.query(`UPDATE road_segments SET congestion = 0 WHERE congestion > 0`)
    await pool.query(`UPDATE alerts SET resolved_at = now() WHERE resolved_at IS NULL`)
    await pool.query(`UPDATE vehicles SET status = 'en_servicio'`)
    await pool.query(`TRUNCATE vehicle_positions`)
    for (const s of this.graph.segments.values()) s.congestion = 0
    for (const r of this.routes) { r.active = r.base; r.detour = null }
    const rows = (await pool.query(
      `SELECT v.id, v.plate, v.kind, u.full_name driver, r.code, r.direction FROM vehicles v JOIN users u ON u.id = v.driver_id
       JOIN routes r ON r.id = v.route_id ORDER BY r.code, v.id`)).rows
    const byLine = new Map<string, any[]>()
    rows.forEach((v) => byLine.set(v.code, [...(byLine.get(v.code) ?? []), v]))
    this.vehicles = []
    for (const [, list] of byLine) list.forEach((v, i) => {
      const route = this.routes.find((r) => r.code === v.code && r.direction === v.direction)!
      const share = list.filter((x) => x.direction === v.direction)
      const k = share.indexOf(v)
      const progress = ((k + 0.5 * (i % 2)) / share.length) * route.base.length * 0.96
      this.vehicles.push({
        id: v.id, plate: v.plate, driver: v.driver, kind: v.kind, code: v.code, route, path: route.base, segAt: route.segAt,
        progress, phase: 'ruta', wait: 0, speed: 0, heading: 0, pos: route.base.at(progress).p, status: 'en_servicio',
        breakdownUntil: 0, nextStop: route.stops.findIndex((s) => s.at > progress), offPlan: false,
      })
    })
    this.events = []
    this.openAlerts = []
    this.log('info', `Simulación iniciada: ${this.vehicles.length} vehículos en ${this.routes.length / 2} líneas reales del Centro`)
    if (announce) this.log('ok', 'Simulación restablecida: sin congestión ni alertas')
  }

  // ---- ciclo ----------------------------------------------------------------------

  start() { this.timer = setInterval(() => void this.tick(), 1000) }
  stop() { if (this.timer) clearInterval(this.timer) }
  onSnapshot(fn: (s: unknown) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }

  private congestionAt(v: Vehicle) {
    const seg = v.segAt[Math.min(v.segAt.length - 1, Math.floor(v.progress / SAMPLE_M))]
    const major = /primary|secondary|trunk/.test(seg.highway)
    const base = (major ? 0.18 : 0.06) + hash(seg.id) * (major ? 0.25 : 0.12)
    return Math.min(1, seg.congestion + base * (0.85 + 0.15 * Math.sin(this.tickNo / 90 + seg.id)))
  }

  async tick(dt = 1) {
    if (this.busy) return // nunca se solapan dos ticks
    this.busy = true
    try {
      this.tickNo++
      this.now += dt
      for (const v of this.vehicles) this.move(v, dt)
      if (this.switched.length) {
        const sw = this.switched.splice(0)
        await pool.query(`UPDATE vehicles v SET route_id = x.r, status = x.st FROM unnest($1::int[], $2::int[], $3::text[]) AS x(id, r, st) WHERE v.id = x.id`,
          [sw.map((v) => v.id), sw.map((v) => v.route.id), sw.map((v) => v.status)])
      }
      const live = this.vehicles.filter((v) => v.phase === 'ruta')
      if (live.length) {
        await pool.query(
          `INSERT INTO vehicle_positions (vehicle_id, geom, speed_kmh, heading)
           SELECT id, ST_SetSRID(ST_MakePoint(lon, lat), 4326), spd, hd FROM unnest($1::int[], $2::float8[], $3::float8[], $4::real[], $5::real[]) AS t(id, lon, lat, spd, hd)`,
          [live.map((v) => v.id), ...[0, 1].map((k) => live.map((v) => unproject(v.pos)[k])), live.map((v) => v.speed * 3.6), live.map((v) => v.heading)],
        )
      }
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

  private move(v: Vehicle, dt: number) {
    if (v.phase === 'pausa') {
      v.wait -= dt
      if (v.wait <= 0) this.switchDirection(v)
      return
    }
    if (v.breakdownUntil > this.now || v.wait > 0) { v.wait = Math.max(0, v.wait - dt); v.speed = 0; return }
    const cruise = v.kind === 'trufi' ? 5.0 : 5.6 // m/s ≈ 18–20 km/h en el Centro
    v.speed = cruise * Math.max(0.06, 1 - 0.9 * this.congestionAt(v))
    v.progress += v.speed * dt
    const stop = v.path === v.route.base ? v.route.stops[v.nextStop] : undefined
    if (stop && v.progress >= stop.at) { v.progress = stop.at; v.wait = 6 + (v.id % 5); v.nextStop++ }
    if (v.progress >= v.path.length) { v.phase = 'pausa'; v.wait = LAYOVER_S; v.speed = 0; return }
    const at = v.path.at(v.progress)
    v.pos = at.p
    v.heading = at.heading
  }

  /** Al terminar el tramo del Centro, el vehículo vuelve en el sentido contrario (ida ↔ vuelta). */
  private switchDirection(v: Vehicle) {
    const next = this.routes.find((r) => r.code === v.code && r.direction !== v.route.direction)!
    v.route = next
    v.path = next.active
    v.segAt = next.active === next.base ? next.segAt : this.sampleSegments(next.active)
    v.status = next.detour ? 'desvio_autorizado' : 'en_servicio'
    v.offPlan = false
    v.progress = 0
    v.nextStop = 0
    v.phase = 'ruta'
    this.switched.push(v)
  }

  // ---- alertas (PostGIS) ---------------------------------------------------------

  private async detectAlerts() {
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
       stopped AS ( -- detenido: velocidad < 2 km/h durante $2 s, fuera de paradas y terminales
         SELECT v.vehicle_id, v.geom FROM v
         WHERE (SELECT max(speed_kmh) FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id AND p.ts > now() - make_interval(secs => $2)) < 2
           AND (SELECT min(ts) FROM vehicle_positions p WHERE p.vehicle_id = v.vehicle_id) < now() - make_interval(secs => $2)
           AND NOT EXISTS (SELECT 1 FROM geofences g WHERE g.kind IN ('parada', 'terminal') AND ST_Intersects(g.geom, v.geom))),
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
      `SELECT a.id, a.kind, a.vehicle_id, a.road_segment_id, a.started_at, a.detail, v.plate, r.code
       FROM alerts a LEFT JOIN vehicles v ON v.id = a.vehicle_id LEFT JOIN routes r ON r.id = v.route_id
       WHERE a.resolved_at IS NULL ORDER BY a.started_at DESC`)).rows
  }

  // ---- escenarios -------------------------------------------------------------------

  async scenario(id: string): Promise<string> {
    switch (id) {
      case 'congestion': return this.congestPrado()
      case 'despejar': return this.clearCongestion()
      case 'desvio': return this.unauthorizedDetour()
      case 'averia': return this.breakdown()
      case 'geocerca': return this.enterPlaza()
      case 'reset': await this.reset(); return 'Simulación restablecida'
      default: throw new Error(`escenario desconocido: ${id}`)
    }
  }

  /** Bloqueo del Prado (Av. 16 de Julio): alerta de congestión + desvío por la red vial del Centro. */
  private async congestPrado() {
    const blocked = [...this.graph.segments.values()].filter((s) => s.name === PRADO)
    if (!blocked.length) throw new Error('no hay tramos de la Av. 16 de Julio en el grafo')
    if (blocked[0].congestion >= 0.9) return 'El Prado ya está congestionado'
    const ids = blocked.map((s) => s.id)
    blocked.forEach((s) => (s.congestion = 0.95))
    await pool.query(`UPDATE road_segments SET congestion = 0.95 WHERE id = ANY($1)`, [ids])
    await pool.query(
      `INSERT INTO alerts (kind, road_segment_id, geom, detail)
       SELECT 'congestion', $1, ST_LineInterpolatePoint(geom, 0.5), $2::jsonb FROM road_segments WHERE id = $1
       ON CONFLICT DO NOTHING`,
      [ids[Math.floor(ids.length / 2)], JSON.stringify({ via: 'Av. 16 de Julio (El Prado)', tramos: ids.length })],
    )
    this.log('critical', `Congestión severa en Av. 16 de Julio (El Prado): ${ids.length} tramos saturados`)
    const blockedSet = new Set(ids)
    for (const r of this.routes) {
      const hits = r.segAt.map((s, i) => (blockedSet.has(s.id) ? i : -1)).filter((i) => i >= 0)
      if (!hits.length) continue
      const entry = Math.max(0, hits[0] * SAMPLE_M - 40), exit = Math.min(r.base.length, hits[hits.length - 1] * SAMPLE_M + 40)
      const from = this.graph.nearestNode(r.base.at(entry).p), to = this.graph.nearestNode(r.base.at(exit).p)
      const alt = this.graph.shortestPath(from, to)
      if (!alt) { this.log('warn', `Sin desvío disponible para Línea ${r.code} (${r.direction})`); continue }
      const pts = [...r.base.slice(0, entry), ...alt.pts, ...r.base.slice(exit, r.base.length)]
      r.active = new Path(pts)
      r.detour = { names: alt.names, extraM: Math.round(r.active.length - r.base.length), pts: alt.pts }
      const extraMin = Math.max(1, Math.round(r.detour.extraM / 300))
      this.log('info', `Desvío sugerido Línea ${r.code} (${r.direction}): ${alt.names.slice(0, 4).join(' → ')} · ${r.detour.extraM >= 0 ? '+' : ''}${r.detour.extraM} m (~${extraMin} min)`)
      const segAt = this.sampleSegments(r.active)
      for (const v of this.vehicles) if (v.route === r && v.phase === 'ruta' && v.progress < entry && !v.offPlan) {
        v.path = r.active; v.segAt = segAt; v.status = 'desvio_autorizado'
      }
    }
    await this.syncStatus()
    return 'Congestión simulada en El Prado'
  }

  private async clearCongestion() {
    const jammed = [...this.graph.segments.values()].filter((s) => s.congestion > 0)
    if (!jammed.length) return 'No hay congestión activa'
    jammed.forEach((s) => (s.congestion = 0))
    await pool.query(`UPDATE road_segments SET congestion = 0 WHERE congestion > 0`)
    await pool.query(`UPDATE alerts SET resolved_at = now() WHERE kind = 'congestion' AND resolved_at IS NULL`)
    for (const r of this.routes) { r.active = r.base; r.detour = null }
    // los vehículos ya desviados terminan su tramo; los siguientes vuelven a la ruta habitual
    this.log('ok', 'El Prado despejado: se retiran los desvíos y se normaliza el flujo')
    return 'Congestión despejada'
  }

  private pick(code: string, pred: (v: Vehicle) => boolean = () => true) {
    return this.vehicles.find((v) => v.code === code && v.phase === 'ruta' && !v.offPlan && v.breakdownUntil <= this.now && pred(v))
  }

  /** Un minibús de la 204 deja su ruta por una calle lateral y se reincorpora más adelante (el rodeo más corto disponible). */
  private async unauthorizedDetour() {
    let best: { v: Vehicle; start: number; end: number; alt: NonNullable<ReturnType<RoadGraph['shortestPath']>> } | null = null
    for (const v of this.vehicles) {
      if (v.code !== '204' || v.phase !== 'ruta' || v.offPlan || v.breakdownUntil > this.now || v.path !== v.route.active) continue
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
    if (!best) return 'No hay un vehículo de la Línea 204 disponible ahora; intenta en unos segundos'
    const { v, start, end, alt } = best
    v.path = new Path([...v.path.slice(0, start), ...alt.pts, ...v.path.slice(end, v.path.length)])
    v.segAt = this.sampleSegments(v.path)
    v.offPlan = true
    this.log('warn', `Simulación: ${v.plate} (Línea 204) toma ${alt.names.slice(0, 2).join(' / ') || 'una calle lateral'} sin autorización`)
    return `Desvío no autorizado: ${v.plate}`
  }

  /** Un trufi de la 453 se detiene (avería) lejos de las paradas durante 100 s. */
  private async breakdown() {
    const v = this.pick('453', (x) => {
      const s = x.route.stops.map((st) => Math.abs(st.at - x.progress))
      return x.progress > 120 && x.progress < x.path.length - 200 && (!s.length || Math.min(...s) > 80)
    }) ?? this.pick('453')
    if (!v) return 'No hay un trufi de la Línea 453 disponible ahora'
    v.breakdownUntil = this.now + BREAKDOWN_S
    this.log('warn', `Simulación: ${v.plate} (Línea 453, ${v.driver}) se detiene por avería`)
    return `Avería simulada: ${v.plate}`
  }

  /** Un minibús de la 204 corta camino por la Plaza Murillo (zona peatonal restringida). */
  private async enterPlaza() {
    const { rows: [g] } = await pool.query(`SELECT ST_X(c) lon, ST_Y(c) lat FROM (SELECT ST_Centroid(geom) c FROM geofences WHERE kind = 'restringida' LIMIT 1) x`)
    const plaza = project([g.lon, g.lat])
    for (const v of this.vehicles) {
      if (v.code !== '204' || v.phase !== 'ruta' || v.offPlan || v.path !== v.route.active) continue
      const m = v.path.locate(plaza)
      if (dist(v.path.at(m).p, plaza) > 200 || v.progress > m - 60) continue
      v.path = new Path([...v.path.slice(0, m - 50), plaza, ...v.path.slice(m + 50, v.path.length)])
      v.segAt = this.sampleSegments(v.path)
      v.offPlan = true
      this.log('warn', `Simulación: ${v.plate} (Línea 204) se dirige a cruzar la Plaza Murillo`)
      return `Ingreso a geocerca simulado: ${v.plate}`
    }
    return 'Ningún minibús de la 204 se acerca ahora a Plaza Murillo; intenta en unos segundos'
  }

  private async syncStatus() {
    await pool.query(`UPDATE vehicles v SET status = x.st FROM unnest($1::int[], $2::text[]) AS x(id, st) WHERE v.id = x.id`,
      [this.vehicles.map((v) => v.id), this.vehicles.map((v) => v.status)])
  }

  // ---- salida -------------------------------------------------------------------------

  log(level: CityEvent['level'], text: string) {
    this.events = [{ id: ++this.seq, time: clock(), level, text }, ...this.events].slice(0, 40)
  }

  snapshot() {
    const alertBy = new Map(this.openAlerts.filter((a) => a.vehicle_id).map((a) => [a.vehicle_id, a.kind]))
    const live = this.vehicles.filter((v) => v.phase === 'ruta')
    const vehicles = live.map((v) => {
      const [lon, lat] = unproject(v.pos)
      const state = alertBy.get(v.id) ? 'alerta' : v.speed === 0 && v.breakdownUntil > this.now ? 'detenido'
        : v.status === 'desvio_autorizado' ? 'desvio' : v.speed < 2 ? 'congestion' : 'normal'
      return { id: v.id, plate: v.plate, code: v.code, direction: v.route.direction, kind: v.kind, lon, lat, heading: Math.round(v.heading), speedKmh: Math.round(v.speed * 36) / 10, state, alert: alertBy.get(v.id) ?? null }
    })
    const congested = [...this.graph.segments.values()].filter((s) => s.congestion > 0)
    return {
      t: new Date().toISOString(),
      vehicles,
      alerts: this.openAlerts.map((a) => ({ id: a.id, kind: a.kind, vehicleId: a.vehicle_id, plate: a.plate, code: a.code, detail: a.detail, startedAt: a.started_at })),
      congestion: congested.map((s) => ({ id: s.id, level: s.congestion, coords: s.pts.map(unproject) })),
      reroutes: this.routes.filter((r) => r.detour).map((r) => ({
        code: r.code, direction: r.direction, via: r.detour!.names, extraM: r.detour!.extraM,
        extraMin: Math.max(1, Math.round(r.detour!.extraM / 300)), coords: r.detour!.pts.map(unproject),
      })),
      metrics: {
        active: live.length,
        avgSpeedKmh: live.length ? Math.round((live.reduce((s, v) => s + v.speed, 0) / live.length) * 36) / 10 : 0,
        alerts: this.openAlerts.length,
        congestedSegments: congested.length,
      },
      events: this.events,
    }
  }
}
