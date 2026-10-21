// Grafo vial del Centro en memoria (cargado desde road_segments) y búsqueda de desvíos.
import { dist, distToLine, project, type LL, type XZ } from './geo.ts'

export interface Segment {
  id: number; name: string; highway: string; oneway: number; source: number; target: number
  length: number; congestion: number; pts: XZ[]
}
interface Edge { to: number; seg: Segment; forward: boolean }

export class RoadGraph {
  readonly segments = new Map<number, Segment>()
  private adj = new Map<number, Edge[]>()
  private nodes = new Map<number, XZ>()

  constructor(rows: { id: number; name: string; highway: string; oneway: number; source: string; target: string; length_m: number; congestion: number; coords: LL[] }[]) {
    for (const r of rows) {
      const s: Segment = {
        id: r.id, name: r.name, highway: r.highway, oneway: r.oneway, source: Number(r.source), target: Number(r.target),
        length: r.length_m, congestion: r.congestion, pts: r.coords.map(project),
      }
      this.segments.set(s.id, s)
      this.nodes.set(s.source, s.pts[0])
      this.nodes.set(s.target, s.pts[s.pts.length - 1])
      if (s.oneway >= 0) this.edge(s.source, { to: s.target, seg: s, forward: true })
      if (s.oneway <= 0) this.edge(s.target, { to: s.source, seg: s, forward: false })
    }
  }
  private edge(from: number, e: Edge) { const l = this.adj.get(from); if (l) l.push(e); else this.adj.set(from, [e]) }

  nearestNode(p: XZ): number {
    let best = -1, bd = Infinity
    for (const [id, q] of this.nodes) { const d = dist(p, q); if (d < bd) { bd = d; best = id } }
    return best
  }

  nearestSegment(p: XZ): Segment {
    let best: Segment | null = null, bd = Infinity
    for (const s of this.segments.values()) {
      if (dist(p, s.pts[0]) - s.length > bd) continue // descarte rápido
      const d = distToLine(p, s.pts)
      if (d < bd) { bd = d; best = s }
    }
    return best!
  }

  /**
   * Camino más corto respetando sentido único. Coste = longitud × (1 + 8·congestión) × penalización.
   * Los tramos con congestión ≥ 0.9 se consideran bloqueados.
   */
  shortestPath(from: number, to: number, penalty: (s: Segment) => number = () => 1) {
    const d = new Map<number, number>([[from, 0]])
    const prev = new Map<number, Edge & { from: number }>()
    const open = new Set([from])
    while (open.size) {
      let u = -1
      for (const n of open) if (u < 0 || d.get(n)! < d.get(u)!) u = n
      open.delete(u)
      if (u === to) break
      for (const e of this.adj.get(u) ?? []) {
        if (e.seg.congestion >= 0.9) continue
        const nd = d.get(u)! + e.seg.length * (1 + 8 * e.seg.congestion) * penalty(e.seg)
        if (nd < (d.get(e.to) ?? Infinity)) { d.set(e.to, nd); prev.set(e.to, { ...e, from: u }); open.add(e.to) }
      }
    }
    if (!prev.has(to)) return null
    const steps: (Edge & { from: number })[] = []
    for (let n = to; n !== from; n = prev.get(n)!.from) steps.unshift(prev.get(n)!)
    const pts: XZ[] = []
    for (const s of steps) {
      const p = s.forward ? s.seg.pts : [...s.seg.pts].reverse()
      pts.push(...(pts.length ? p.slice(1) : p))
    }
    const names = steps.map((s) => s.seg.name).filter((n, i, a) => n && a.indexOf(n) === i)
    return { pts, segments: steps.map((s) => s.seg.id), names, length: steps.reduce((a, s) => a + s.seg.length, 0) }
  }
}
