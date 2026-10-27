// Descarga y prepara los datos reales de las zonas con vista detallada (shared/zones.ts).
//   node scripts/zonas/fetch.ts centro alto   → zonas indicadas (usa la caché si existe)
//   node scripts/zonas/fetch.ts --all         → todas las zonas
//   node scripts/zonas/fetch.ts --refresh …   → vuelve a descargar
//   node scripts/zonas/fetch.ts --discover …  → lista las rutas de transporte OSM de la zona para elegir las 3 líneas
// Fuentes: OpenStreetMap vía Overpass (© OpenStreetMap contributors, ODbL) y
// mosaicos de elevación Terrarium (AWS Terrain Tiles, derivados de SRTM y otros).
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { ZONES, type Zone } from '../../shared/zones.ts'

const MARGIN_M = 450 // el terreno se extiende un poco más allá del recuadro
const CORE_H = 11    // edificios principales: todos los reales de OSM, los que tienen nombre y los estimados de esta altura o más
// la zona en proceso: las funciones de abajo leen estos valores (se fijan en main para cada zona)
let ZONE: Zone = ZONES[0]
let BBOX = ZONE.bbox
let ORIGIN = ZONE.origin
let OUT = '', CACHE = '', bb = ''
const UA = 'lapaz2050-digital-twin/0.2 (academic demo; Univalle La Paz)'
const MIRRORS = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']
const REFRESH = process.argv.includes('--refresh')
const DISCOVER = process.argv.includes('--discover')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---- descargas con caché y reintentos -------------------------------------

async function overpass(name: string, query: string): Promise<any> {
  const file = join(CACHE, `${name}.json`)
  if (!REFRESH && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  let wait = 8000
  for (let attempt = 1; attempt <= 10; attempt++) {
    for (const url of MIRRORS) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) })
        if (res.ok) {
          const json = await res.json()
          writeFileSync(file, JSON.stringify(json))
          console.log(`  ✓ ${name} (${json.elements.length} elementos, ${url})`)
          return json
        }
        console.log(`  … ${name}: HTTP ${res.status} en ${url}`)
      } catch (e) {
        console.log(`  … ${name}: ${(e as Error).message}`)
      }
    }
    await sleep(wait)
    wait = Math.min(wait * 2, 120000)
  }
  throw new Error(`Overpass no respondió para ${name}`)
}

async function tile(z: number, x: number, y: number): Promise<Buffer> {
  const file = join(CACHE, `terrarium-${z}-${x}-${y}.png`)
  if (!REFRESH && existsSync(file)) return readFileSync(file)
  const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`mosaico ${z}/${x}/${y}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, buf)
  return buf
}

/** Decodificador PNG mínimo (8 bits, RGB/RGBA, sin entrelazado): suficiente para Terrarium. */
function decodePng(buf: Buffer) {
  let pos = 8, width = 0, height = 0, ctype = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); ctype = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('PNG no soportado') }
    if (type === 'IDAT') idat.push(data)
    pos += 12 + len
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : 0
  if (!bpp) throw new Error(`PNG color type ${ctype} no soportado`)
  const raw = inflateSync(Buffer.concat(idat)), stride = width * bpp
  const px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? px[dst + i - bpp] : 0, b = y ? px[dst - stride + i] : 0, c = y && i >= bpp ? px[dst - stride + i - bpp] : 0
      let v = raw[src + i]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[dst + i] = v & 255
    }
  }
  return { width, height, bpp, px }
}

// ---- utilidades geográficas -------------------------------------------------

let KX = 0
const KZ = 110574
const toLocal = (lon: number, lat: number) => [(lon - ORIGIN.lon) * KX, -(lat - ORIGIN.lat) * KZ]
const toLonLat = (x: number, z: number) => [ORIGIN.lon + x / KX, ORIGIN.lat - z / KZ]
const r6 = (v: number) => Math.round(v * 1e6) / 1e6
type LL = [number, number]
const ll = (g: { lon: number; lat: number }): LL => [r6(g.lon), r6(g.lat)]
const inBox = ([lon, lat]: LL) => lat >= BBOX.s && lat <= BBOX.n && lon >= BBOX.w && lon <= BBOX.e
const meters = (a: LL, b: LL) => { const [ax, az] = toLocal(a[0], a[1]), [bx, bz] = toLocal(b[0], b[1]); return Math.hypot(ax - bx, az - bz) }
const lineLength = (p: LL[]) => p.reduce((s, q, i) => (i ? s + meters(p[i - 1], q) : 0), 0)

// ---- 1. elevación -----------------------------------------------------------

async function elevation() {
  const Z = 15, n = 2 ** Z
  const [x0m, z0m] = toLocal(BBOX.w, BBOX.n).map((v) => v - MARGIN_M)
  const [x1m, z1m] = toLocal(BBOX.e, BBOX.s).map((v) => v + MARGIN_M)
  const [wl, nl] = toLonLat(x0m, z0m), [el, sl] = toLonLat(x1m, z1m)
  const tx = (lon: number) => ((lon + 180) / 360) * n
  const ty = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n
  const tiles = new Map<string, ReturnType<typeof decodePng>>()
  for (let x = Math.floor(tx(wl)); x <= Math.floor(tx(el)); x++)
    for (let y = Math.floor(ty(nl)); y <= Math.floor(ty(sl)); y++) tiles.set(`${x}/${y}`, decodePng(await tile(Z, x, y)))
  console.log(`  ✓ elevación: ${tiles.size} mosaicos Terrarium z${Z}`)
  const at = (gx: number, gy: number) => {
    const t = tiles.get(`${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`)!
    const i = ((gy % 256) * 256 + (gx % 256)) * t.bpp
    return t.px[i] * 256 + t.px[i + 1] + t.px[i + 2] / 256 - 32768
  }
  const sample = (lon: number, lat: number) => {
    const gx = tx(lon) * 256 - 0.5, gy = ty(lat) * 256 - 0.5
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy
    return (at(ix, iy) * (1 - fx) + at(ix + 1, iy) * fx) * (1 - fy) + (at(ix, iy + 1) * (1 - fx) + at(ix + 1, iy + 1) * fx) * fy
  }
  const STEP = 15
  const w = Math.round((x1m - x0m) / STEP) + 1, h = Math.round((z1m - z0m) / STEP) + 1
  const vals: number[] = []
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [lon, lat] = toLonLat(x0m + i * STEP, z0m + j * STEP)
    vals.push(sample(lon, lat))
  }
  const min = Math.floor(Math.min(...vals)), max = Math.ceil(Math.max(...vals))
  writeFileSync(join(OUT, 'elevation.json'), JSON.stringify({ x0: x0m, z0: z0m, step: STEP, w, h, min, max, dm: vals.map((v) => Math.round((v - min) * 10)) }))
  console.log(`  ✓ elevation.json ${w}×${h}, ${min}–${max} m s. n. m.`)
  return sample
}

// ---- 2. calles y grafo vial ---------------------------------------------------

const DRAW = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service|steps|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/
const ROUTABLE = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$/

async function streets() {
  const raw = await overpass('streets', `[out:json][timeout:180];way["highway"](${bb});out body geom;`)
  const ways = raw.elements.filter((w: any) => DRAW.test(w.tags.highway) && w.tags.area !== 'yes')
  const out = ways.map((w: any) => ({
    id: w.id, name: w.tags.name ?? '', hw: w.tags.highway, oneway: w.tags.oneway === 'yes' || w.tags.junction === 'roundabout' ? 1 : w.tags.oneway === '-1' ? -1 : 0,
    lanes: Number(w.tags.lanes) || 0, pts: w.geometry.map(ll),
  }))
  writeFileSync(join(OUT, 'streets.json'), JSON.stringify(out))
  console.log(`  ✓ streets.json ${out.length} vías`)

  // grafo: se corta cada vía en los nodos compartidos con otras vías transitables
  const drive = raw.elements.filter((w: any) => ROUTABLE.test(w.tags.highway) && w.tags.area !== 'yes' && w.tags.access !== 'no')
  const uses = new Map<number, number>()
  for (const w of drive) w.nodes.forEach((n: number, i: number) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)))
  const segs: any[] = []
  for (const w of drive) {
    const oneway = w.tags.oneway === 'yes' || w.tags.junction === 'roundabout' ? 1 : w.tags.oneway === '-1' ? -1 : 0
    let start = 0
    for (let i = 1; i < w.nodes.length; i++) {
      if (i === w.nodes.length - 1 || (uses.get(w.nodes[i]) ?? 0) > 1) {
        const pts = w.geometry.slice(start, i + 1).map(ll)
        segs.push({ id: segs.length + 1, way: w.id, name: w.tags.name ?? '', hw: w.tags.highway, oneway, s: w.nodes[start], t: w.nodes[i], len: Math.round(lineLength(pts) * 10) / 10, pts })
        start = i
      }
    }
  }
  writeFileSync(join(OUT, 'roads.json'), JSON.stringify(segs))
  console.log(`  ✓ roads.json ${segs.length} tramos del grafo vial`)
  return { els: raw.elements as any[], segs }
}

// ---- 3. edificios, áreas y lugares ----------------------------------------------

/** Distancia (m) al eje de edificios altos de la zona (ZONE.tall.axis). */
function distToAxis(x: number, z: number) {
  const p = ZONE.tall.axis.map(([lon, lat]) => toLocal(lon, lat))
  let best = Infinity
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i], dx = bx - ax, dz = bz - az
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)))
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz))
  }
  return best
}

function buildingHeight(t: Record<string, string>, c: LL): number {
  const h = parseFloat(t.height ?? t['building:height'] ?? '')
  if (h > 0) return h
  const lv = parseFloat(t['building:levels'] ?? '')
  if (lv > 0) return lv * 3 + 1
  // ponytail: estimación sin dato — más alto junto al eje principal de la zona, bajo en las laderas
  const [x, z] = toLocal(c[0], c[1])
  const axis = ZONE.id === 'centro'
    ? Math.abs(x * 0.85 + z * 0.53 - 420) // distancia aprox. al eje NO→SE del Prado
    : distToAxis(x, z)
  const seed = Math.abs(Math.sin(c[0] * 91731 + c[1] * 51287)) // estable por edificio
  const [near, mid, far] = ZONE.tall.base
  const base = axis < 220 ? near : axis < 600 ? mid : far
  return Math.round(base * (0.6 + seed * 0.9))
}

async function buildingsAndAreas(sample: (lon: number, lat: number) => number) {
  const raw = await overpass('buildings', `[out:json][timeout:180];way["building"](${bb});out tags geom;`)
  const out: any[] = []
  for (const w of raw.elements) {
    const pts: LL[] = w.geometry.map(ll)
    if (pts.length < 4 || !pts.some(inBox)) continue
    const c: LL = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
    const base = Math.min(...pts.map((p) => sample(p[0], p[1])))
    out.push({ h: buildingHeight(w.tags, c), b: Math.round(base * 10) / 10, k: w.tags.building, n: w.tags.name, pts: pts.slice(0, -1) })
  }
  writeFileSync(join(OUT, 'buildings.json'), JSON.stringify(out))
  const tagged = raw.elements.filter((w: any) => w.tags['building:levels'] || w.tags.height).length
  console.log(`  ✓ buildings.json ${out.length} edificios (${tagged} con altura/pisos reales en OSM)`)

  const areas = await overpass('areas', `[out:json][timeout:180];(way["leisure"~"^(park|garden|pitch|playground)$"](${bb});way["place"="square"](${bb});way["highway"="pedestrian"]["area"="yes"](${bb});way["landuse"~"^(grass|recreation_ground)$"](${bb}););out tags geom;`)
  const av = areas.elements.map((w: any) => ({ k: w.tags.leisure ?? w.tags.place ?? w.tags.landuse ?? 'pedestrian', n: w.tags.name, pts: w.geometry.map(ll).slice(0, -1) }))
  writeFileSync(join(OUT, 'areas.json'), JSON.stringify(av))
  console.log(`  ✓ areas.json ${av.length} plazas/parques`)
  return { buildings: out, areas: av }
}

/**
 * Relleno de manzanas: OSM solo tiene parte de los edificios del Centro. A lo largo de cada calle se
 * colocan lotes (fachada continua, típica del casco paceño) donde no hay edificio OSM, plaza ni otra vía.
 * Se marcan con e:1 (estimado) para distinguirlos de los reales.
 */
function infill(streetsOut: any[], real: any[], areas: any[], sample: (lon: number, lat: number) => number) {
  const rng = (() => { let a = 2050; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } })()
  const CELL = 12
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
  const grid = new Map<string, [number, number][]>()
  const put = (x: number, z: number) => { const k = key(x, z); grid.set(k, [...(grid.get(k) ?? []), [x, z]]) }
  const near = (x: number, z: number, r: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const [a, b] of grid.get(`${Math.floor(x / CELL) + i},${Math.floor(z / CELL) + j}`) ?? []) if (Math.hypot(a - x, b - z) < r) return true
    return false
  }
  const loc = (pts: LL[]) => pts.map((p) => toLocal(p[0], p[1]))
  const inside = (x: number, z: number, poly: number[][]) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c
    }
    return c
  }
  // obstáculos: bordes de calles (densificados), edificios reales y áreas abiertas
  const roadPts = new Map<string, [number, number][]>()
  for (const st of streetsOut) {
    const p = loc(st.pts)
    for (let i = 1; i < p.length; i++) {
      const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]), n = Math.max(1, Math.ceil(L / 3))
      for (let k = 0; k <= n; k++) {
        const x = p[i - 1][0] + ((p[i][0] - p[i - 1][0]) * k) / n, z = p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * k) / n
        const kk = key(x, z); roadPts.set(kk, [...(roadPts.get(kk) ?? []), [x, z]])
      }
    }
  }
  const nearRoad = (x: number, z: number, r: number) => {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++)
      for (const [a, b] of roadPts.get(`${Math.floor(x / CELL) + i},${Math.floor(z / CELL) + j}`) ?? []) if (Math.hypot(a - x, b - z) < r) return true
    return false
  }
  const realPolys = real.map((b) => loc(b.pts))
  realPolys.forEach((poly) => poly.forEach(([x, z]) => put(x, z)))
  const realIdx = new Map<string, number[][][]>()
  realPolys.forEach((poly) => { const [x, z] = poly[0]; const k = key(x, z); realIdx.set(k, [...(realIdx.get(k) ?? []), poly]) })
  const inReal = (x: number, z: number) => {
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++)
      for (const poly of realIdx.get(`${Math.floor(x / CELL) + i},${Math.floor(z / CELL) + j}`) ?? []) if (inside(x, z, poly)) return true
    return false
  }
  const openPolys = areas.map((a) => loc(a.pts))
  const HALF: Record<string, number> = { motorway: 9, trunk: 9, primary: 8, secondary: 6.5, tertiary: 5.5, residential: 4.5, unclassified: 4.5, living_street: 3.5, pedestrian: 4, service: 3, steps: 2.5 }
  const out: any[] = []
  for (const st of streetsOut) {
    if (/link$|motorway|trunk/.test(st.hw)) continue
    const p = loc(st.pts), half = HALF[st.hw] ?? 4
    for (let i = 1; i < p.length; i++) {
      const dx = p[i][0] - p[i - 1][0], dz = p[i][1] - p[i - 1][1], L = Math.hypot(dx, dz)
      if (L < 6) continue
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux
      for (let t = 4; t < L - 4; t += 7 + rng() * 3) {
        for (const side of [1, -1]) {
          const w = 6 + rng() * 4, d = 9 + rng() * 7, off = half + 1.2 + d / 2
          const cx = p[i - 1][0] + ux * t + nx * off * side, cz = p[i - 1][1] + uz * t + nz * off * side
          const [lon, lat] = toLonLat(cx, cz)
          if (!inBox([lon, lat]) || near(cx, cz, 6.5) || inReal(cx, cz) || nearRoad(cx, cz, d / 2 + 1)) continue
          if (openPolys.some((poly) => inside(cx, cz, poly))) continue
          const corners = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([a, b]) => {
            const x = cx + ux * a + nx * side * b, z = cz + uz * a + nz * side * b
            const q = toLonLat(x, z); return [r6(q[0]), r6(q[1])] as LL
          })
          const base = Math.min(...corners.map((q) => sample(q[0], q[1])))
          put(cx, cz)
          out.push({ h: buildingHeight({}, [lon, lat]), b: Math.round(base * 10) / 10, k: 'yes', e: 1, pts: corners })
        }
      }
    }
  }
  return out
}

/** Hitos fijos del Centro (las otras zonas los eligen solas, ver landmarks()). */
const CENTRO_LANDMARKS: { label: string; re: RegExp }[] = [
  { label: 'Plaza Murillo', re: /^Plaza (Pedro Domingo )?Murillo$/i },
  { label: 'Plaza San Francisco', re: /^Plaza (Mayor de )?San Francisco$/i },
  { label: 'Basílica de San Francisco', re: /^Basílica (Menor )?de San Francisco$/i },
  { label: 'Plaza del Estudiante', re: /^Plaza (Franz Tamayo|del Estudiante)$/i },
  { label: 'Plaza Isabel la Católica', re: /^Plaza Isabel la Católica$/i },
  { label: 'Plaza San Pedro', re: /^Plaza (Mariscal Sucre|San Pedro)$/i },
  { label: 'Plaza Eguino', re: /^Plaza Eguino$/i },
  { label: 'Plaza Alonso de Mendoza', re: /^Plaza Alonso de Mendoza$/i },
  { label: 'Plaza El Cóndor', re: /^Plaza El C[oó]ndor$/i },
  { label: 'Obelisco', re: /^Obelisco/i },
  { label: 'Mercado Rodríguez', re: /^Mercado Rodr[ií]guez$/i },
  { label: 'Mercado Lanza', re: /^Mercado Lanza$/i },
  { label: 'Palacio de Gobierno', re: /^Palacio (de Gobierno|Quemado)$/i },
  { label: 'Garita de Lima', re: /Garita de Lima/i },
]

async function schools() {
  const raw = await overpass('schools', `[out:json][timeout:180];nwr["amenity"="school"]["name"](${bb});out center tags;`)
  const out = raw.elements.map((e: any) => ({ name: e.tags.name, osm: `${e.type}/${e.id}`, at: ll(e.center ?? e) }))
  writeFileSync(join(OUT, 'schools.json'), JSON.stringify(out))
  console.log(`  ✓ schools.json ${out.length} unidades educativas`)
}

async function landmarks() {
  const raw = await overpass('landmarks', `[out:json][timeout:180];nwr["name"](${bb})["name"~"${ZONE.landmarks}",i];out center tags;`)
  let found: { label: string; osm: string; at: LL }[]
  if (ZONE.id === 'centro') {
    found = CENTRO_LANDMARKS.flatMap(({ label, re }) => {
      const e = raw.elements.find((x: any) => re.test(x.tags.name))
      if (!e) { console.log(`  ! no encontrado en OSM: ${label}`); return [] }
      return [{ label, osm: `${e.type}/${e.id}`, at: ll(e.center ?? e) }]
    })
  } else {
    // ponytail: hitos automáticos — plazas y lugares con nombre, preferidos por tipo, separados ≥ 350 m, hasta 12
    const rank = (t: Record<string, string>) => (t.place === 'square' || /^Plaza/i.test(t.name) ? 0 : t.amenity === 'marketplace' || /^Mercado/i.test(t.name) ? 1 : t.leisure === 'park' || t.leisure === 'stadium' ? 2 : 3)
    const cands = raw.elements
      .map((e: any) => ({ e, at: ll(e.center ?? e), r: rank(e.tags) }))
      .filter((c: any) => inBox(c.at) && c.e.tags.name.length <= 40 && !/^(Calle|Avenida|Av\.|Pasaje)/i.test(c.e.tags.name))
      .sort((a: any, b: any) => a.r - b.r || (a.e.type === 'way' ? -1 : 1))
    found = []
    for (const c of cands) {
      if (found.length >= 12) break
      if (found.some((f) => f.label === c.e.tags.name || meters(f.at, c.at) < 350)) continue
      found.push({ label: c.e.tags.name, osm: `${c.e.type}/${c.e.id}`, at: c.at })
    }
  }
  const h = ZONE.hotspot
  if (!found.some((f) => meters(f.at, h.at) < 120)) found.push({ label: h.short, osm: '', at: h.at }) // el hotspot siempre se rotula
  writeFileSync(join(OUT, 'landmarks.json'), JSON.stringify(found))
  console.log(`  ✓ landmarks.json ${found.length} lugares`)
}

// ---- 4. rutas del caso de estudio ---------------------------------------------

/** Encadena las vías de la relación en una sola LINESTRING orientada, y valida continuidad y sentido. */
interface Seg { s: number; t: number; oneway: number; len: number; pts: LL[] }

/** Camino más corto por la red vial (respeta sentido único) entre los nodos más cercanos a a y b. */
function bridge(segs: Seg[], a: LL, b: LL): LL[] | null {
  const pos = new Map<number, LL>()
  const adj = new Map<number, { to: number; seg: Seg; fwd: boolean }[]>()
  const add = (u: number, e: { to: number; seg: Seg; fwd: boolean }) => adj.set(u, [...(adj.get(u) ?? []), e])
  for (const g of segs) {
    pos.set(g.s, g.pts[0]); pos.set(g.t, g.pts[g.pts.length - 1])
    if (g.oneway >= 0) add(g.s, { to: g.t, seg: g, fwd: true })
    if (g.oneway <= 0) add(g.t, { to: g.s, seg: g, fwd: false })
  }
  const nearest = (p: LL) => [...pos].reduce((best, [id, q]) => (meters(p, q) < best[1] ? [id, meters(p, q)] : best), [0, Infinity] as [number, number])[0]
  const from = nearest(a), to = nearest(b)
  const dist = new Map([[from, 0]]), prev = new Map<number, { u: number; seg: Seg; fwd: boolean }>(), open = new Set([from])
  while (open.size) {
    let u = -1
    for (const n of open) if (u < 0 || dist.get(n)! < dist.get(u)!) u = n
    open.delete(u)
    if (u === to) break
    for (const e of adj.get(u) ?? []) {
      const d = dist.get(u)! + e.seg.len
      if (d < (dist.get(e.to) ?? Infinity)) { dist.set(e.to, d); prev.set(e.to, { u, seg: e.seg, fwd: e.fwd }); open.add(e.to) }
    }
  }
  if (!prev.has(to)) return null
  const parts: LL[][] = []
  for (let n = to; n !== from; n = prev.get(n)!.u) { const p = prev.get(n)!; parts.unshift(p.fwd ? p.seg.pts : [...p.seg.pts].reverse()) }
  return parts.flatMap((p, i) => (i ? p.slice(1) : p))
}

function chain(rel: any, wayTags: Map<number, Record<string, string>>, segs: Seg[]) {
  const members = rel.members.filter((m: any) => m.type === 'way' && ['', 'forward', 'backward'].includes(m.role ?? '') && m.geometry?.length)
  const line: LL[] = []
  const issues: string[] = []
  let wrongWay = 0
  members.forEach((m: any, i: number) => {
    let g: LL[] = m.geometry.map(ll)
    if (line.length) {
      const last = line[line.length - 1]
      if (meters(last, g[g.length - 1]) < meters(last, g[0])) g = g.reverse()
      const gap = meters(last, g[0])
      if (gap > 15) {
        const fix = bridge(segs, last, g[0])
        issues.push(`salto de ${gap.toFixed(0)} m antes de la vía ${m.ref} → ${fix ? `reparado por la red vial (${lineLength(fix).toFixed(0)} m)` : 'SIN REPARAR'}`)
        if (fix) line.push(...fix)
      }
      line.push(...(gap < 0.5 ? g.slice(1) : g))
    } else {
      const next = members[i + 1]?.geometry?.map(ll) as LL[] | undefined
      if (next && Math.min(meters(g[0], next[0]), meters(g[0], next[next.length - 1])) < Math.min(meters(g[g.length - 1], next[0]), meters(g[g.length - 1], next[next.length - 1]))) g = g.reverse()
      line.push(...g)
    }
    const t = wayTags.get(m.ref) ?? {}
    const forward = meters(g[0], m.geometry.map(ll)[0]) < 0.5
    if (t.oneway === 'yes' && !forward && inBox(g[0])) { wrongWay++; issues.push(`contramano en ${t.name ?? m.ref}`) }
  })
  return { line, issues, wrongWay }
}

/** Tramo continuo más largo dentro del recuadro (algunas rutas salen y vuelven a entrar). */
function clipToBox(line: LL[]): LL[] {
  let best: LL[] = [], cur: LL[] = []
  for (const p of line) {
    if (inBox(p)) cur.push(p)
    else { if (lineLength(cur) > lineLength(best)) best = cur; cur = [] }
  }
  return lineLength(cur) > lineLength(best) ? cur : best
}

async function routes(streetEls: any[], segs: Seg[]) {
  if (!ZONE.lines.length) { console.log('  ! la zona aún no tiene líneas elegidas (usar --discover)'); return }
  const ids = ZONE.lines.flatMap((c) => [c.ida, c.vuelta])
  const raw = await overpass(`routes-${ids.join('-')}`, `[out:json][timeout:180];relation(id:${ids.join(',')});out geom;`)
  const wayTags = new Map<number, Record<string, string>>(streetEls.map((w) => [w.id, w.tags]))
  const out: any[] = []
  for (const c of ZONE.lines) for (const dir of ['ida', 'vuelta'] as const) {
    const rel = raw.elements.find((r: any) => r.id === c[dir])
    const { line, issues, wrongWay } = chain(rel, wayTags, segs)
    const clipped = clipToBox(line)
    out.push({
      code: c.code, direction: dir, osm: rel.id, name: rel.tags.name, operator: rel.tags.operator ?? '', from: rel.tags.from ?? '', to: rel.tags.to ?? '',
      osmRef: rel.tags.ref ?? '', fullKm: Math.round(lineLength(line) / 10) / 100, km: Math.round(lineLength(clipped) / 10) / 100,
      issues, wrongWay, pts: clipped,
    })
    console.log(`  ✓ ${c.code} ${dir}: ${(lineLength(clipped) / 1000).toFixed(2)} km en la zona de ${(lineLength(line) / 1000).toFixed(1)} km · ${issues.length ? issues.join('; ') : 'sin observaciones'}`)
  }
  writeFileSync(join(OUT, 'routes.json'), JSON.stringify(out))
}

// ---- 5. descubrimiento de líneas -------------------------------------------

/**
 * Lista las rutas OSM de transporte que pasan por la zona, agrupadas por número de línea, con lo que sirve
 * para elegir las 3 del caso de estudio: modo, operador, si hay ida y vuelta, km dentro de la zona y saltos.
 */
async function discover() {
  // 1) solo etiquetas (liviano); 2) geometría recortada al recuadro, por lotes: las rutas cruzan toda la ciudad
  const tags = await overpass('discover-tags', `[out:json][timeout:120];rel(${bb})[type=route][route~"^(bus|minibus|share_taxi)$"];out tags;`)
  const ids: number[] = tags.elements.map((r: any) => r.id)
  const geom = new Map<number, any>()
  for (let i = 0; i < ids.length; i += 12) {
    const part = ids.slice(i, i + 12)
    const raw = await overpass(`discover-geom-${part[0]}-${part.length}`, `[out:json][timeout:120];rel(id:${part.join(',')});out tags geom(${bb});`)
    for (const r of raw.elements) geom.set(r.id, r)
  }
  const rows = tags.elements.map((tr: any) => {
    const rel = geom.get(tr.id) ?? { members: [] }
    const t = tr.tags
    const ways = (rel.members ?? []).filter((m: any) => m.type === 'way' && m.geometry?.length)
    const km = ways.reduce((a: number, m: any) => a + lineLength(m.geometry.filter((g: any) => g).map(ll)), 0) / 1000
    const mode = /trufi/i.test(t.name ?? '') || t.route === 'share_taxi' ? 'trufi' : /puma|bus municipal|setram|lapazbus/i.test(`${t.name} ${t.operator} ${t.network}`) ? 'municipal' : /micro/i.test(t.name ?? '') ? 'micro' : 'minibus'
    return { id: tr.id, ref: t.ref ?? '?', mode, name: t.name ?? '', from: t.from ?? '', to: t.to ?? '', op: t.operator ?? '', km, ptv2: t['public_transport:version'] === '2' }
  })
  const byRef = new Map<string, typeof rows>()
  for (const r of rows) byRef.set(`${r.mode} ${r.ref}`, [...(byRef.get(`${r.mode} ${r.ref}`) ?? []), r])
  const groups = [...byRef].map(([k, rs]) => ({ k, rs, km: Math.min(...rs.map((r: any) => r.km)) })).sort((a, b) => (b.rs.length >= 2 ? 1 : 0) - (a.rs.length >= 2 ? 1 : 0) || b.km - a.km)
  console.log(`  rutas OSM en ${ZONE.name}: ${rows.length} relaciones, ${groups.length} líneas`)
  for (const g of groups) {
    console.log(`  ${g.k.padEnd(20)} ${`${g.rs.length} rel.`.padEnd(7)} ${g.km.toFixed(2)} km en zona (el sentido más corto)`)
    for (const r of g.rs) console.log(`      ${r.id}  ${r.km.toFixed(2)} km  ${r.ptv2 ? 'PTv2' : '    '}  ${r.op ? `[${r.op}] ` : ''}${r.name}${r.from ? ` (${r.from} → ${r.to})` : ''}`)
  }
  writeFileSync(join(CACHE, 'discover-summary.json'), JSON.stringify(groups, null, 1))
}

// ---- main ---------------------------------------------------------------------

async function build(zone: Zone) {
  ZONE = zone; BBOX = zone.bbox; ORIGIN = zone.origin
  KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180)
  OUT = `public/zonas/${zone.id}`; CACHE = `scripts/zonas/.cache/${zone.id}`
  bb = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`
  mkdirSync(OUT, { recursive: true })
  mkdirSync(CACHE, { recursive: true })
  console.log(`LA PAZ 2050 · preparando datos de ${zone.name}`)
  if (DISCOVER) return discover()
  const sample = await elevation()
  const { els: streetEls, segs } = await streets()
  const { buildings: real, areas } = await buildingsAndAreas(sample)
  const streetsOut = JSON.parse(readFileSync(join(OUT, 'streets.json'), 'utf8'))
  const est = infill(streetsOut, real, areas, sample)
  // dos archivos: la calidad baja del front solo descarga los principales (~40 % del peso); el resto, en buildings-extra.json
  const all = [...real, ...est], core = (b: any) => !b.e || b.n || b.h >= CORE_H
  writeFileSync(join(OUT, 'buildings.json'), JSON.stringify(all.filter(core)))
  writeFileSync(join(OUT, 'buildings-extra.json'), JSON.stringify(all.filter((b) => !core(b))))
  console.log(`  ✓ buildings.json: ${real.length} reales de OSM + ${est.length} estimados (relleno de manzanas)`)
  await landmarks()
  await schools()
  await routes(streetEls, segs)
  const [hx, hz] = toLocal(zone.hotspot.at[0], zone.hotspot.at[1])
  // tamaño de cada archivo (bytes): el front estima cuánto descarga cada nivel de calidad
  const sizes = Object.fromEntries(['elevation', 'streets', 'areas', 'buildings', 'buildings-extra', 'landmarks', 'routes', 'lines']
    .filter((f) => existsSync(join(OUT, `${f}.json`))).map((f) => [f, statSync(join(OUT, `${f}.json`)).size]))
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({
    zone: zone.id, sizes, name: zone.name, bbox: BBOX, origin: ORIGIN, hotspot: { ...zone.hotspot, x: Math.round(hx), z: Math.round(hz) },
    generated: new Date().toISOString().slice(0, 10),
    attribution: '© OpenStreetMap contributors (ODbL) · Elevación: AWS Terrain Tiles (SRTM y otras fuentes)',
  }, null, 2))
  console.log('Listo →', OUT)
}

const ids = process.argv.includes('--all') ? ZONES.map((z) => z.id) : process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (!ids.length) { console.log(`uso: node scripts/zonas/fetch.ts [--refresh] [--discover] <${ZONES.map((z) => z.id).join('|')}…|--all>`); process.exit(1) }
for (const id of ids) {
  const z = ZONES.find((x) => x.id === id)
  if (!z) throw new Error(`zona desconocida: ${id}`)
  await build(z)
}
