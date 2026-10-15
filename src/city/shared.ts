import * as THREE from 'three'
import { DISTRICTS, ROADS } from '../simulation/cityData'
import type { SimView, VisualizationMode } from '../simulation/types'

export const reducedMotion =
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export const PALETTE = {
  bg: '#07111F',
  cyan: '#00D5FF',
  green: '#43F5B5',
  amber: '#FFB547',
  red: '#FF5470',
  neutral: '#4f7db0',
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1)
  return t * t * (3 - 2 * t)
}

// ---- terreno: cañón andino + meseta (El Alto) + cordillera -----------------

function natural(x: number, z: number): number {
  const b = x - 0.25 * z
  const wall = sstep(20, 64, Math.abs(b))
  let h = 2.2 - z * 0.035 + (wall + 0.07 * Math.sin(wall * 15)) * 24
  const rough =
    Math.sin(x * 0.21 + z * 0.13) * 1.6 + Math.sin(x * 0.47 - z * 0.39) * 0.8 + Math.sin(x * 0.09 + z * 0.31) * 2.2
  h += rough * (0.12 + wall * 1.1)
  // meseta del altiplano al norte
  h += (12.2 - h) * sstep(-34, -47, z)
  // cordillera alrededor
  const r = Math.hypot(x, z * 0.9)
  const ang = Math.atan2(z, x)
  h += sstep(78, 135, r) * (26 + 12 * Math.sin(ang * 3 + 1) + 6 * Math.sin(ang * 7))
  // picos nevados (conceptuales)
  h += 52 * Math.exp(-((x - 62) ** 2 + (z + 118) ** 2) / 700)
  h += 40 * Math.exp(-((x + 78) ** 2 + (z + 105) ** 2) / 500)
  return h
}

const PAD_H = DISTRICTS.map((d) => natural(d.pos[0], d.pos[1]))

/** Altura del terreno con cada distrito aplanado en una plataforma. */
export function heightAt(x: number, z: number): number {
  let h = natural(x, z)
  DISTRICTS.forEach((d, i) => {
    const w = 1 - sstep(d.radius * 0.9, d.radius * 1.5, Math.hypot(x - d.pos[0], z - d.pos[1]))
    if (w > 0) h += (PAD_H[i] - h) * w
  })
  return h
}
export const padHeight = (i: number) => PAD_H[i]

// ---- vías ----------------------------------------------------------------

export interface RoadGeo {
  id: string
  kind: 'avenue' | 'ring'
  from: number
  to: number
  pts: THREE.Vector3[]
  length: number
}

const dIndex = (id: string) => DISTRICTS.findIndex((d) => d.id === id)
const ROAD_LIFT = 0.22

function sample(curve: THREE.Curve<THREE.Vector3>, length: number): THREE.Vector3[] {
  return curve.getSpacedPoints(Math.max(12, Math.round(length / 1.1))).map((p) => new THREE.Vector3(p.x, heightAt(p.x, p.z) + ROAD_LIFT, p.z))
}

function buildRoads(): RoadGeo[] {
  const out: RoadGeo[] = []
  ROADS.forEach((r, k) => {
    const a = DISTRICTS[dIndex(r.from)].pos
    const b = DISTRICTS[dIndex(r.to)].pos
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const side = k % 2 ? 1 : -1
    const mx = (a[0] + b[0]) / 2 + (-(b[1] - a[1]) / len) * len * 0.1 * side
    const mz = (a[1] + b[1]) / 2 + ((b[0] - a[0]) / len) * len * 0.1 * side
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(a[0], 0, a[1]), new THREE.Vector3(mx, 0, mz), new THREE.Vector3(b[0], 0, b[1])])
    const pts = sample(curve, len)
    out.push({ id: r.id, kind: 'avenue', from: dIndex(r.from), to: dIndex(r.to), pts, length: len })
  })
  DISTRICTS.forEach((d, i) => {
    const R = d.radius * 0.62
    const ring = new THREE.CatmullRomCurve3(
      Array.from({ length: 12 }, (_, j) => {
        const t = (j / 12) * Math.PI * 2
        return new THREE.Vector3(d.pos[0] + Math.cos(t) * R, 0, d.pos[1] + Math.sin(t) * R)
      }),
      true,
    )
    const len = R * Math.PI * 2
    out.push({ id: `ring-${d.id}`, kind: 'ring', from: i, to: i, pts: sample(ring, len), length: len })
  })
  return out
}

export const ROAD_GEOS: RoadGeo[] = buildRoads()

/** Distancia (en XZ) al punto de vía más cercano. */
export function distToRoads(x: number, z: number): number {
  let best = Infinity
  for (const r of ROAD_GEOS) for (const p of r.pts) {
    const d = (p.x - x) ** 2 + (p.z - z) ** 2
    if (d < best) best = d
  }
  return Math.sqrt(best)
}

/** Cinta plana que sigue el terreno. */
export function ribbon(pts: THREE.Vector3[], width: number, lift = 0): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const t = pts[Math.min(n - 1, i + 1)].clone().sub(pts[Math.max(0, i - 1)])
    const nx = -t.z, nz = t.x
    const l = Math.hypot(nx, nz) || 1
    const ox = (nx / l) * width / 2, oz = (nz / l) * width / 2
    pos.push(p.x + ox, p.y + lift, p.z + oz, p.x - ox, p.y + lift, p.z - oz)
    if (i < n - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2) }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

// ---- color por distrito (único punto donde estado -> color) ---------------

const C = {
  green: new THREE.Color(PALETTE.green),
  cyan: new THREE.Color(PALETTE.cyan),
  amber: new THREE.Color(PALETTE.amber),
  red: new THREE.Color(PALETTE.red),
  neutral: new THREE.Color(PALETTE.neutral),
}
const tmp = new THREE.Color()

function ramp(low: THREE.Color, v: number): THREE.Color {
  const t = v / 100
  return t < 0.6 ? tmp.copy(low).lerp(C.amber, sstep(0.3, 0.6, t)) : tmp.copy(C.amber).lerp(C.red, sstep(0.6, 0.85, t))
}

export const fx = {
  /** color suavizado de cada distrito */
  colors: DISTRICTS.map(() => new THREE.Color(PALETTE.neutral)),
  /** 0..1 brillo extra (selección / incidente) */
  glow: DISTRICTS.map(() => 0),
  time: 0,
}

export function stepColors(view: SimView, dt: number) {
  const { state, districts } = view
  fx.time += dt
  const k = 1 - Math.exp(-dt * 4)
  const inc = state.incident
  districts.forEach((d, i) => {
    let target: THREE.Color
    let glow = state.selectedId === d.id ? 0.55 : 0
    if (d.hasIncident && inc) {
      glow = 1
      if (inc.phase === 'detected') target = tmp.copy(C.red).lerp(C.amber, 0.5 + 0.5 * Math.sin(fx.time * 7) * 0.5)
      else if (inc.phase === 'responding') target = tmp.copy(C.amber)
      else target = tmp.copy(C.amber).lerp(C.green, clamp(1 - view.factor / Math.max(inc.fromFactor, 0.01), 0, 1))
    } else if (state.mode === 'traffic') target = ramp(C.green, d.traffic)
    else if (state.mode === 'energy') target = ramp(C.cyan, d.energy)
    else target = tmp.copy(C.neutral)
    fx.colors[i].lerp(target, d.hasIncident && inc?.phase === 'detected' ? 0.5 : k)
    fx.glow[i] += (glow - fx.glow[i]) * k
  })
}

export const MODE_LEGEND: Record<VisualizationMode, { from: string; to: string; low: string; high: string }> = {
  traffic: { from: PALETTE.green, to: PALETTE.red, low: 'Fluido', high: 'Saturado' },
  energy: { from: PALETTE.cyan, to: PALETTE.red, low: 'Carga baja', high: 'Sobrecarga' },
  sensors: { from: PALETTE.cyan, to: PALETTE.green, low: 'Red de sensores', high: 'Tipos: tráfico · energía · aire' },
}
