// Grafo vial de una zona en memoria (cargado desde road_segments) y búsqueda de desvíos.
import { dist, distToLine, type LL, type Projector, type XZ } from './geo.ts'

export interface Segment {
  id: number; name: string; highway: string; oneway: number; source: number; target: number
  length: number; congestion: number; pts: XZ[]
}
interface Edge { to: number; seg: Segment; forward: boolean }

export class RoadGraph {
  readonly segments = new Map<number, Segment>()
  private adj = new Map<number, Edge[]>()
  private nodes = new Map<number, XZ>()
  private cells = new Map<string, Set<Segment>>()

  constructor(project: Projector['project'], rows: { id: number; name: string; highway: string; oneway: number; source: string; target: string; length_m: number; congestion: number; coords: LL[] }[]) {
    for (const r of rows) {
      const s: Segment = {
        id: r.id, name: r.name, highway: r.highway, oneway: r.oneway, source: Number(r.source), target: Number(r.target),
        length: r.length_m, congestion: r.congestion, pts: r.coords.map(project),
      }
      this.segments.set(s.id, s)
      const xs = s.pts.map((p) => p[0]), zs = s.pts.map((p) => p[1])
      for (let x = Math.floor(Math.min(...xs) / 250); x <= Math.floor(Math.max(...xs) / 250); x++)
        for (let z = Math.floor(Math.min(...zs) / 250); z <= Math.floor(Math.max(...zs) / 250); z++) {
          const key = `${x},${z}`; let cell = this.cells.get(key)
          if (!cell) { cell = new Set(); this.cells.set(key, cell) }; cell.add(s)
        }
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
    const candidates = new Set<Segment>()
    const cx = Math.floor(p[0] / 250), cz = Math.floor(p[1] / 250)
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++)
      for (const s of this.cells.get(`${x},${z}`) ?? []) candidates.add(s)
    for (const s of candidates) { const d = distToLine(p, s.pts); if (d < bd) { bd = d; best = s } }
    if (bd < 250) return best!
    for (const s of this.segments.values()) {
      if (dist(p, s.pts[0]) - s.length > bd) continue // descarte rápido
      const d = distToLine(p, s.pts)
      if (d < bd) { bd = d; best = s }
    }
    return best!
  }

  /**
   * Camino más corto respetando sentido único. Coste = longitud × (1 + 8·congestión) × penalización.
   * Los tramos con congestión ≥ blockAt (0.9 por defecto) se consideran bloqueados.
   */
  shortestPath(from: number, to: number, penalty: (s: Segment) => number = () => 1, blockAt = 0.9) {
    const d = new Map<number, number>([[from, 0]])
    const prev = new Map<number, Edge & { from: number }>()
    const heap: [number, number][] = [[0, from]] // cola de prioridad (dist, nodo) con eliminación perezosa
    const push = (item: [number, number]) => {
      let i = heap.push(item) - 1
      while (i > 0 && heap[(i - 1) >> 1][0] > heap[i][0]) { const p = (i - 1) >> 1; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p }
    }
    const pop = () => {
      const top = heap[0], last = heap.pop()!
      if (heap.length) {
        heap[0] = last
        for (let i = 0; ; ) {
          let m = i; const l = 2 * i + 1, r = l + 1
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r
          if (m === i) break
          ;[heap[m], heap[i]] = [heap[i], heap[m]]; i = m
        }
      }
      return top
    }
    while (heap.length) {
      const [du, u] = pop()
      if (du > d.get(u)!) continue
      if (u === to) break
      for (const e of this.adj.get(u) ?? []) {
        if (e.seg.congestion >= blockAt) continue
        const nd = du + e.seg.length * (1 + 8 * e.seg.congestion) * penalty(e.seg)
        if (nd < (d.get(e.to) ?? Infinity)) { d.set(e.to, nd); prev.set(e.to, { ...e, from: u }); push([nd, e.to]) }
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
