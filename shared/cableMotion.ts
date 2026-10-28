import { Path, type XZ } from './geo.ts'
import { metroProjection, type CableLine, type CableStation } from './metro.ts'

/** Closed two-way loop. Stations slow individual cabins; terminal arcs avoid teleportation. */
export function cableLoop(line: CableLine, stations: CableStation[]) {
  const path = new Path(line.pts.map(metroProjection.project))
  const points: XZ[] = [], stationAt = stations.filter((s) => line.stationIds.includes(s.id)).map((s) => path.locate(metroProjection.project(s.at)))
  const append = (d: number, side: number) => {
    const { p, heading } = path.at(d), a = heading * Math.PI / 180
    points.push([p[0] + Math.cos(a) * side * 8, p[1] + Math.sin(a) * side * 8])
  }
  for (let d = 0; d < path.length; d += 12) append(d, 1)
  append(path.length, 1)
  for (let k = 1; k <= 12; k++) {
    const { p, heading } = path.at(path.length), a = heading * Math.PI / 180, t = k / 12 * Math.PI
    points.push([p[0] + 8 * (Math.cos(a) * Math.cos(t) + Math.sin(a) * Math.sin(t)), p[1] + 8 * (Math.sin(a) * Math.cos(t) - Math.cos(a) * Math.sin(t))])
  }
  for (let d = path.length; d > 0; d -= 12) append(d, -1)
  append(0, -1)
  for (let k = 1; k <= 12; k++) {
    const { p, heading } = path.at(0), a = heading * Math.PI / 180, t = k / 12 * Math.PI
    points.push([p[0] - 8 * (Math.cos(a) * Math.cos(t) + Math.sin(a) * Math.sin(t)), p[1] - 8 * (Math.sin(a) * Math.cos(t) - Math.cos(a) * Math.sin(t))])
  }
  points.push(points[0])
  const loop = new Path(points), weighted = [0]
  for (let i = 1; i < points.length; i++) {
    const d = path.locate(points[i]), slow = stationAt.some((s) => Math.abs(s - d) < 30)
    weighted.push(weighted[i - 1] + (loop.cum[i] - loop.cum[i - 1]) * (slow ? 5 : 1))
  }
  const total = weighted.at(-1)!
  return {
    length: total,
    count: Math.max(12, Math.min(120, Math.round(path.length / 150) * 2)),
    at(phase: number) {
      const d = ((phase % total) + total) % total
      let lo = 0, hi = weighted.length - 1
      while (hi - lo > 1) { const m = (hi + lo) >> 1; if (weighted[m] <= d) lo = m; else hi = m }
      const f = (d - weighted[lo]) / (weighted[hi] - weighted[lo] || 1)
      return loop.at(loop.cum[lo] + f * (loop.cum[hi] - loop.cum[lo]))
    },
  }
}
