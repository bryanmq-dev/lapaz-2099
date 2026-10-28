// Reproducible metropolitan extraction. Run from repository root with Node 24+.
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs'
import { configure, elevation, streets, overpass, buildingsAndAreas } from '../zonas/fetch.ts'
import { METRO, CABLE_NAMES, CABLE_COLORS, metroProjection, type CableCatalog, type CableLine, type MetroSector } from '../../shared/metro.ts'
import { Path, type LL } from '../../shared/geo.ts'
import { RoadGraph } from '../../server/src/graph.ts'
const ROOT = 'public/metro', OUT = `${ROOT}/.staging`, CACHE = 'scripts/metro/.cache'
mkdirSync(OUT, { recursive: true }); mkdirSync(CACHE, { recursive: true })
const save = (f: string, v: unknown) => writeFileSync(`${OUT}/${f}.json`, JSON.stringify(v))
const read = (f: string) => JSON.parse(readFileSync(f, 'utf8'))
const ll = (p: any): LL => [p.lon, p.lat]
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const length = (p: LL[]) => new Path(p.map(metroProjection.project)).length
const distance = (a: LL, b: LL) => length([a, b])
const bb = Object.values({ s: METRO.bbox.s, w: METRO.bbox.w, n: METRO.bbox.n, e: METRO.bbox.e }).join(',')
configure(METRO, OUT, CACHE)
const sample = await elevation(90, 12)
const { els, segs } = await streets()
const el = read(`${OUT}/elevation.json`)
const allStreets = read(`${OUT}/streets.json`)
const cableRaw = await overpass('cable', `[out:json][timeout:180];(way["aerialway"="gondola"](${bb});node["aerialway"~"^(station|yes)$"]["name"](${bb});node["aerialway"="pylon"](${bb});relation["route"="aerialway"](${bb}););out body geom;`)
const cable: CableCatalog = { lines: [], stations: [] }
const ways = cableRaw.elements.filter((e: any) => e.type === 'way' && e.tags?.aerialway === 'gondola')
const stationNodes = cableRaw.elements.filter((e: any) => e.type === 'node' && e.tags?.name && ['station', 'yes'].includes(e.tags.aerialway))
for (const [i, name] of CABLE_NAMES.entries()) {
  const id = norm(name)
  const relations = cableRaw.elements.filter((e: any) => e.type === 'relation' && norm(e.tags?.name ?? '').includes(id))
  const memberIds = new Set(relations.flatMap((r: any) => r.members.filter((m: any) => m.type === 'way').map((m: any) => m.ref)))
  const parts = ways.filter((w: any) => memberIds.has(w.id) || norm(w.tags.name ?? '').includes(id)).map((w: any) => ({ id: w.id, nodes: w.nodes as number[], pts: w.geometry.map(ll) as LL[] }))
  if (!parts.length) throw new Error(`Falta la línea ${name} en OSM: revisar extracción antes de publicar`)
  // Ways may meet at distinct nodes (e.g. Morada at Faro Murillo): chain by endpoint proximity.
  let pts: LL[] = parts[0].pts.slice(); const osm: string[] = [`way/${parts[0].id}`]; parts.shift()
  while (parts.length) {
    let best: { ix: number; tail: boolean; rev: boolean; d: number } | null = null
    parts.forEach((p: any, ix: number) => {
      for (const tail of [true, false]) for (const rev of [false, true]) {
        const d = distance(tail ? pts.at(-1)! : pts[0], rev ? p.pts.at(-1) : p.pts[0])
        if (!best || d < best.d) best = { ix, tail, rev, d }
      }
    })
    if (!best || best.d > 80) throw new Error(`Tramos desconectados en ${name}`)
    const p = parts.splice(best.ix, 1)[0], seg: LL[] = best.rev ? p.pts.slice().reverse() : p.pts
    // best.tail: seg starts near our tail (append as-is); else it must end near our head (prepend).
    pts = best.tail ? [...pts, ...(best.d < 1 ? seg.slice(1) : seg)] : [...(best.rev ? p.pts : p.pts.slice().reverse()), ...pts]
    osm.push(`way/${p.id}`)
  }
  const path = new Path(pts.map(metroProjection.project))
  // Stops come from the line's own OSM relations (never from proximity); platforms of one station share an identity.
  const stopIds = new Set(relations.flatMap((r: any) => r.members.filter((m: any) => m.type === 'node' && /^stop/.test(m.role ?? '')).map((m: any) => m.ref)))
  const stops = stationNodes.filter((s: any) => stopIds.has(s.id))
    .sort((a: any, b: any) => path.locate(metroProjection.project(ll(a))) - path.locate(metroProjection.project(ll(b))))
  if (stops.length < 2) throw new Error(`Faltan estaciones de ${name}`)
  const stationIds: string[] = []
  for (const s of stops) {
    const place = cable.stations.find((x) => norm(x.name) === norm(s.tags.name) && distance(x.at, ll(s)) < 150)
    const key = place?.id ?? `node/${s.id}`
    if (place) { if (!place.lines.includes(id)) place.lines.push(id) }
    else cable.stations.push({ id: key, name: s.tags.name, at: ll(s), osm: key, lines: [id] })
    if (!stationIds.includes(key)) stationIds.push(key)
  }
  const line: CableLine = { id, name: `Línea ${name}`, color: CABLE_COLORS[i], osm, stationIds, pts, supports: pts, issues: ['Alturas del cable aproximadas: terreno + 25 m; no representan ingeniería real.'], lengthM: path.length }
  cable.lines.push(line)
}
save('cable', cable)
console.log(`Teleférico: ${cable.lines.length} líneas, ${cable.stations.length} estaciones`)
// Global graph is generated before visual partitioning. Crossings retain OSM node identities.
const graph = new RoadGraph(metroProjection.project, segs.map((s: any) => ({ id: s.id, name: s.name, highway: s.hw, oneway: s.oneway, source: String(s.s), target: String(s.t), length_m: s.len, congestion: 0, coords: s.pts })))
const tags = await overpass('bus-tags', `[out:json][timeout:180];rel["type"="route"]["route"~"^(minibus|share_taxi|bus)$"](${bb});out tags;`)
const catalog: any[] = [], routes: any[] = [], lines: any[] = []
const known = new Map<number, any>()
for (const dir of readdirSync('scripts/zonas/.cache')) for (const f of readdirSync(`scripts/zonas/.cache/${dir}`).filter((f) => f.startsWith('routes-'))) for (const r of read(`scripts/zonas/.cache/${dir}/${f}`).elements) known.set(r.id, r)
if (existsSync(`${CACHE}/bus-local.json`)) for (const r of read(`${CACHE}/bus-local.json`).elements) known.set(r.id, r)
const missing = tags.elements.filter((r: any) => !known.has(r.id)).map((r: any) => r.id)
for (let i = 0; i < missing.length; i += 20) {
  const ids = missing.slice(i, i + 20)
  const raw = await overpass(`bus-members-${ids.join('-')}`, `[out:json][timeout:180];rel(id:${ids.join(',')});out body geom;`)
  for (const r of raw.elements) known.set(r.id, r)
}
const streetIds = new Set(els.map((e: any) => e.id))
for (const tag of tags.elements) {
  const r = known.get(tag.id), issues: string[] = [], pts: LL[] = []
  const members = (r?.members ?? []).filter((m: any) => m.type === 'way' && ['', 'forward', 'backward'].includes(m.role ?? '') && m.geometry?.length && streetIds.has(m.ref))
  // Reconstruct by actual directed road paths, never invent a reverse journey.
  let lastNode: number | null = null
  for (let j = 0; j < members.length; j++) {
    const m = members[j]; let p: LL[] = m.geometry.map(ll)
    if (pts.length && distance(pts.at(-1)!, p.at(-1)!) < distance(pts.at(-1)!, p[0])) p = p.reverse()
    else if (!pts.length && members[j + 1]) { const next = members[j + 1].geometry.map(ll); if (Math.min(distance(p[0], next[0]), distance(p[0], next.at(-1))) < Math.min(distance(p.at(-1)!, next[0]), distance(p.at(-1)!, next.at(-1)))) p.reverse() }
    const a = graph.nearestNode(metroProjection.project(p[0])), b = graph.nearestNode(metroProjection.project(p.at(-1)!))
    if (lastNode !== null && lastNode !== a) {
      const bridge = graph.shortestPath(lastNode, a)
      if (!bridge || bridge.length > 500) { issues.push('Discontinuidad entre miembros OSM'); break }
      pts.push(...bridge.pts.map(metroProjection.unproject))
    }
    if (a !== b) {
      const path = graph.shortestPath(a, b)
      if (!path || path.length > Math.max(length(p) * 1.5, 200)) { issues.push('Recorrido incompatible con la red dirigida'); break }
      pts.push(...path.pts.map(metroProjection.unproject))
    }
    lastNode = b
  }
  const valid = !issues.length && pts.length > 1 && length(pts) > 1000
  catalog.push({ osm: r.id, name: r.tags.name ?? '', ref: r.tags.ref ?? '', valid, issues })
  if (!valid) continue
  const code = `${r.tags.ref ?? 'OSM'}·${r.id}`, color = ['#71b6d6', '#bda3de', '#75c5a1'][lines.length % 3]
  lines.push({ code, mode: r.tags.route === 'share_taxi' ? 'trufi' : 'minibus', union: r.tags.operator ?? 'Operador OSM sin identificar', color, headwayMin: 5, termini: `${r.tags.from ?? ''} → ${r.tags.to ?? ''}`, corridor: r.tags.name ?? code, assumed: ['Flota y frecuencia simuladas'], fare: '', schedule: '', headway: 'Simulada', notes: '' })
  routes.push({ code, direction: 'ida', osm: r.id, name: r.tags.name ?? code, operator: r.tags.operator ?? '', from: r.tags.from ?? '', to: r.tags.to ?? '', osmRef: r.tags.ref ?? '', fullKm: length(pts) / 1000, km: length(pts) / 1000, issues, pts })
}
if (!routes.length) throw new Error('No hay rutas viales válidas')
save('bus-catalog', catalog); save('routes', routes); save('lines', lines)
console.log(`Minibuses: ${routes.length} relaciones válidas de ${catalog.length}`)
const sectors: MetroSector[] = [], buildings = new Map<number, any>(), areas: any[] = []
// 4 x 4 download regions. Each stored feature belongs to one visual sector.
for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
  const { s, w, n, e } = METRO.bbox, dx = (e - w) / 4, dy = (n - s) / 4
  const bbox = { s: s + y * dy, w: w + x * dx, n: s + (y + 1) * dy, e: w + (x + 1) * dx }
  configure({ ...METRO, bbox }, `${OUT}/parts/${x}-${y}`, `${CACHE}/${x}-${y}`)
  const got = await buildingsAndAreas(sample)
  for (const b of got.buildings) buildings.set(b.osm, b)
  areas.push(...got.areas)
}
configure(METRO, OUT, CACHE)
const sectorFor = ([lon, lat]: LL) => `${Math.min(7, Math.max(0, Math.floor((lon - METRO.bbox.w) / (METRO.bbox.e - METRO.bbox.w) * 8)))}-${Math.min(7, Math.max(0, Math.floor((lat - METRO.bbox.s) / (METRO.bbox.n - METRO.bbox.s) * 8)))}`
const groups = new Map<string, { buildings: any[]; streets: any[]; areas: any[] }>()
for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) groups.set(`${x}-${y}`, { buildings: [], streets: [], areas: [] })
for (const b of buildings.values()) groups.get(sectorFor(b.pts[0]))!.buildings.push(b)
// Split long streets at vertices: each segment belongs to exactly one sector, continuous at borders.
for (const s of allStreets) for (let i = 1; i < s.pts.length; i++) groups.get(sectorFor(s.pts[i - 1]))!.streets.push({ ...s, pts: [s.pts[i - 1], s.pts[i]] })
const seenAreas = new Set<string>()
for (const a of areas) { const key = JSON.stringify(a.pts); if (!seenAreas.has(key)) { groups.get(sectorFor(a.pts[0]))!.areas.push(a); seenAreas.add(key) } }
for (const [id, g] of groups) {
  mkdirSync(`${OUT}/sectors/${id}`, { recursive: true })
  const [x, y] = id.split('-').map(Number), dx = (METRO.bbox.e - METRO.bbox.w) / 8, dy = (METRO.bbox.n - METRO.bbox.s) / 8
  const w = METRO.bbox.w + x * dx, s = METRO.bbox.s + y * dy
  const landmarkBuildings = g.buildings.filter((b) => b.n).sort((a, b) => b.h - a.h).slice(0, 10)
  const files = { streets: g.streets, buildings: g.buildings, references: landmarkBuildings, areas: g.areas }
  const sizes: Record<string, number> = {}
  for (const [file, data] of Object.entries(files)) { save(`sectors/${id}/${file}`, data); sizes[file] = statSync(`${OUT}/sectors/${id}/${file}.json`).size }
  sectors.push({ id, center: [w + dx / 2, s + dy / 2], bounds: [w, s, w + dx, s + dy], sizes })
}
save('overview', allStreets.filter((s: any) => /^(motorway|trunk|primary|secondary|tertiary)/.test(s.hw)))
save('landmarks', cable.stations.map((s) => ({ label: s.name, at: s.at, osm: s.osm })))
save('schools', []); save('areas', areas); save('buildings', [...buildings.values()])
save('manifest', { version: new Date().toISOString(), generated: new Date().toISOString(), origin: METRO.origin, bbox: METRO.bbox, sectors, streets: allStreets.length, roadSegments: segs.length, buildings: buildings.size, attribution: '© OpenStreetMap contributors · ODbL · Elevación AWS Terrain Tiles (SRTM y otras fuentes)' })
// Validation before publication. Keep immutable versions and atomically replace the pointer.
if (cable.lines.length !== 10 || !sectors.length || el.w < 2 || segs.length < 1000) throw new Error('Extracción incompleta')
const version = `v${Date.now()}`
rmSync(`${OUT}/parts`, { recursive: true, force: true })
renameSync(OUT, `${ROOT}/${version}`)
writeFileSync(`${ROOT}/current.tmp`, JSON.stringify({ base: version }))
renameSync(`${ROOT}/current.tmp`, `${ROOT}/current.json`)
console.log(`Listo: ${ROOT}/${version}`)
