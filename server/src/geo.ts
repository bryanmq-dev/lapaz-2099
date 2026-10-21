// Proyección local (igual que el frontend y el script de datos) y utilidades de polilíneas.
export type LL = [number, number]
export type XZ = [number, number]

export const ORIGIN = { lat: -16.4958, lon: -68.1336 } // Plaza Murillo
const KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), KZ = 110574
export const project = (p: LL): XZ => [(p[0] - ORIGIN.lon) * KX, -(p[1] - ORIGIN.lat) * KZ]
export const unproject = ([x, z]: XZ): LL => [Math.round((ORIGIN.lon + x / KX) * 1e7) / 1e7, Math.round((ORIGIN.lat - z / KZ) * 1e7) / 1e7]
export const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Polilínea con longitudes acumuladas para muestrear por distancia recorrida. */
export class Path {
  readonly pts: XZ[]
  readonly cum: number[]
  constructor(pts: XZ[]) {
    this.pts = pts
    this.cum = [0]
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + dist(pts[i - 1], pts[i]))
  }
  get length() { return this.cum[this.cum.length - 1] }

  /** Punto y rumbo (grados desde el norte, sentido horario) a d metros del inicio. */
  at(d: number): { p: XZ; heading: number } {
    const t = Math.min(Math.max(d, 0), this.length)
    let lo = 0, hi = this.cum.length - 1
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.cum[m] <= t) lo = m; else hi = m }
    const a = this.pts[lo], b = this.pts[hi], seg = this.cum[hi] - this.cum[lo] || 1, f = (t - this.cum[lo]) / seg
    const heading = ((Math.atan2(b[0] - a[0], -(b[1] - a[1])) * 180) / Math.PI + 360) % 360
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], heading }
  }

  /** Distancia a lo largo de la línea del punto más cercano a p. */
  locate(p: XZ): number {
    let best = Infinity, at = 0
    for (let i = 1; i < this.pts.length; i++) {
      const [ax, az] = this.pts[i - 1], [bx, bz] = this.pts[i]
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
      const f = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2))
      const d = Math.hypot(ax + dx * f - p[0], az + dz * f - p[1])
      if (d < best) { best = d; at = this.cum[i - 1] + f * Math.sqrt(L2) }
    }
    return at
  }

  slice(from: number, to: number): XZ[] {
    const out: XZ[] = [this.at(from).p]
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > from && this.cum[i] < to) out.push(this.pts[i])
    out.push(this.at(to).p)
    return out
  }
}

/** Distancia de un punto a una polilínea. */
export function distToLine(p: XZ, pts: XZ[]): number {
  let best = Infinity
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i]
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1
    const f = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2))
    best = Math.min(best, Math.hypot(ax + dx * f - p[0], az + dz * f - p[1]))
  }
  return best
}

export const toGeoJSONLine = (pts: XZ[]) => JSON.stringify({ type: 'LineString', coordinates: pts.map(unproject) })
