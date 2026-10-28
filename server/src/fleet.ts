// Flota simulada de refuerzo: líneas S01… sobre la red vial real de cada zona.
// Las calles y los sentidos únicos son reales (OSM); las líneas, los choferes y las placas son ficticios.
import { addStopFences, addStops, FIRST, LAST, LETTERS, rng, type ZoneDb } from './db.ts'
import { Path, dist, toGeoJSONLine, type LL, type XZ } from './geo.ts'
import { RoadGraph } from './graph.ts'

const P: Record<string, LL> = {
  Isabel: [-68.124252, -16.50931], Condor: [-68.135452, -16.508917], Estudiante: [-68.131152, -16.504201], SanPedro: [-68.135239, -16.502465],
  Murillo: [-68.133557, -16.495706], SanFco: [-68.137051, -16.495682], Lanza: [-68.137462, -16.4947], Eguino: [-68.140838, -16.493789],
  Alonso: [-68.138344, -16.493265], Garita: [-68.146025, -16.495604], MRodriguez: [-68.138992, -16.500192],
  NE: [-68.1215, -16.4905], SE: [-68.1215, -16.5105], SW: [-68.1485, -16.5105], N: [-68.1345, -16.4888], S: [-68.1345, -16.5112],
  E: [-68.1212, -16.5], W: [-68.1488, -16.5], CamE: [-68.1312, -16.5004],
}
const NAME: Record<string, string> = {
  Isabel: 'Plaza Isabel la Católica', Condor: 'Plaza El Cóndor', Estudiante: 'Plaza del Estudiante', SanPedro: 'Plaza San Pedro', Murillo: 'Plaza Murillo',
  SanFco: 'Plaza San Francisco', Lanza: 'Mercado Lanza', Eguino: 'Plaza Eguino', Alonso: 'Plaza Alonso de Mendoza', Garita: 'Garita de Lima',
  MRodriguez: 'Mercado Rodríguez', CamE: 'Av. Camacho (extremo este)', N: 'borde norte', S: 'borde sur', E: 'borde este', W: 'borde oeste',
  NE: 'borde noreste', SE: 'borde sureste', SW: 'borde suroeste',
}

/**
 * Centro (a mano). a↔b: extremos de la línea. regular: unidades en servicio todo el día. reserve: unidades de refuerzo de hora punta.
 * Las 14 primeras cruzan el Obelisco (por la Av. Camacho, la Mcal. Santa Cruz o El Prado) y salen de plazas a menos de 1 km;
 * las demás no pasan por él. Las rutas son las más cortas por avenidas y respetan los sentidos únicos.
 */
const LINES: { a: string; b: string; regular: number; reserve: number }[] = [
  { a: 'CamE', b: 'Lanza', regular: 3, reserve: 5 }, { a: 'CamE', b: 'Alonso', regular: 3, reserve: 5 },
  { a: 'CamE', b: 'SanFco', regular: 3, reserve: 5 }, { a: 'SanPedro', b: 'SanFco', regular: 3, reserve: 4 },
  { a: 'SanPedro', b: 'Lanza', regular: 3, reserve: 4 }, { a: 'SanPedro', b: 'Alonso', regular: 3, reserve: 4 },
  { a: 'SanFco', b: 'Estudiante', regular: 3, reserve: 4 }, { a: 'SanFco', b: 'S', regular: 3, reserve: 4 },
  { a: 'Estudiante', b: 'Lanza', regular: 3, reserve: 4 }, { a: 'Estudiante', b: 'Alonso', regular: 3, reserve: 4 },
  { a: 'Alonso', b: 'Condor', regular: 3, reserve: 4 }, { a: 'SanFco', b: 'Murillo', regular: 3, reserve: 3 },
  { a: 'Isabel', b: 'SanFco', regular: 3, reserve: 0 }, { a: 'Alonso', b: 'Isabel', regular: 3, reserve: 0 },
  { a: 'Garita', b: 'Estudiante', regular: 13, reserve: 0 }, { a: 'Garita', b: 'Isabel', regular: 13, reserve: 0 },
  { a: 'Eguino', b: 'Isabel', regular: 13, reserve: 0 }, { a: 'Eguino', b: 'Estudiante', regular: 13, reserve: 0 },
  { a: 'N', b: 'SanPedro', regular: 13, reserve: 0 }, { a: 'W', b: 'E', regular: 13, reserve: 0 },
  { a: 'NE', b: 'SW', regular: 13, reserve: 0 }, { a: 'SE', b: 'SW', regular: 13, reserve: 0 },
  { a: 'Murillo', b: 'SE', regular: 13, reserve: 0 }, { a: 'NE', b: 'SanPedro', regular: 13, reserve: 0 },
  { a: 'Garita', b: 'S', regular: 13, reserve: 0 }, { a: 'Garita', b: 'NE', regular: 13, reserve: 0 },
  { a: 'Eguino', b: 'SE', regular: 13, reserve: 0 }, { a: 'MRodriguez', b: 'NE', regular: 13, reserve: 0 },
]
const COLORS = ['#7FA8C9', '#9CB4C8', '#8FB5B0', '#A9B8C9']
const UNION = 'Flota simulada (refuerzo)'
const arterial = (s: { highway: string }) => (/primary|trunk|secondary/.test(s.highway) ? 0.75 : /tertiary/.test(s.highway) ? 1 : 1.5)

interface FleetLine { a: number; b: number; an: string; bn: string; regular: number; reserve: number }

/**
 * Zonas nuevas: las líneas salen solas de los hitos de la zona y de 8 puntos en los bordes del recuadro.
 * Hasta 12 líneas cortas cruzan el hotspot (llevan el refuerzo de hora punta) y 10 largas recorren la zona.
 * ponytail: selección codiciosa por dirección de llegada al hotspot; calibrar por zona si la cola no se forma.
 */
function autoLines(db: ZoneDb, graph: RoadGraph, hot: XZ): FleetLine[] {
  const { zone, proj } = db
  const { s, w, n, e } = zone.bbox, dy = 0.0014, dx = 0.0015 // ~150 m hacia dentro
  const edges: [string, LL][] = [
    ['borde norte', [(w + e) / 2, n - dy]], ['borde sur', [(w + e) / 2, s + dy]], ['borde este', [e - dx, (s + n) / 2]], ['borde oeste', [w + dx, (s + n) / 2]],
    ['borde noreste', [e - dx, n - dy]], ['borde noroeste', [w + dx, n - dy]], ['borde sureste', [e - dx, s + dy]], ['borde suroeste', [w + dx, s + dy]],
  ]
  const anchors = new Map<number, string>()
  for (const [name, at] of [...db.data('landmarks.json').map((l: any) => [l.label, l.at] as [string, LL]), ...edges]) {
    const node = graph.nearestNode(proj.project(at))
    if (!anchors.has(node)) anchors.set(node, name)
  }
  const ids = [...anchors.keys()]
  const cands: { a: number; b: number; len: number; sector: number; crosses: boolean }[] = []
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const go = graph.shortestPath(ids[i], ids[j], arterial), back = graph.shortestPath(ids[j], ids[i], arterial)
    if (!go || !back || go.length < 900) continue
    const cross = [go, back].map((p) => { const path = new Path(p.pts), at = path.locate(hot); return dist(path.at(at).p, hot) < 40 && at > 80 ? path.at(at - 60).p : null })
    const from = cross.find((x) => x)
    const sector = from ? Math.round(((Math.atan2(from[0] - hot[0], -(from[1] - hot[1])) * 180) / Math.PI + 360) % 360 / 90) % 4 : -1
    cands.push({ a: ids[i], b: ids[j], len: go.length, sector, crosses: !!from })
  }
  cands.sort((x, y) => y.len - x.len)
  const picked: typeof cands = []
  // las que cruzan el hotspot: trayectos cortos (1,2–3,5 km, primero los más cortos), como en el Centro, donde el refuerzo
  // sale a menos de 1 km del Obelisco; con trayectos largos la hora punta tarda demasiado en terminar.
  // En ronda por sector de llegada (N, E, S, O) para que la cola se forme desde varios lados.
  const short = cands.filter((c) => c.crosses && c.len >= 1200 && c.len <= 3500).sort((x, y) => x.len - y.len)
  const bySector = [0, 1, 2, 3].map((k) => short.filter((c) => c.sector === k))
  for (let round = 0; picked.length < 12 && bySector.some((l) => l.length > round); round++)
    for (const l of bySector) if (l[round] && picked.length < 12) picked.push(l[round])
  const crossing = picked.length
  for (const c of cands) { if (picked.length >= crossing + 10) break; if (!picked.includes(c)) picked.push(c) }
  return picked.map((c, i) => ({ a: c.a, b: c.b, an: anchors.get(c.a)!, bn: anchors.get(c.b)!, regular: i < crossing ? 3 : 10, reserve: i < crossing ? 4 : 0 }))
}

/** Crea las líneas, choferes y vehículos simulados de la zona si aún no existen (idempotente). */
export async function seedFleet(db: ZoneDb) {
  const { pool, zone, proj } = db
  if ((await pool.query(`SELECT 1 FROM routes WHERE simulated LIMIT 1`)).rowCount) return
  const rows = (await pool.query(`SELECT id, name, highway, oneway, source, target, length_m, congestion, ST_AsGeoJSON(geom)::json->'coordinates' coords FROM road_segments`)).rows
  const graph = new RoadGraph(proj.project, rows)
  const hot = proj.project(zone.hotspot.at)
  const lines: FleetLine[] = zone.id === 'centro'
    ? LINES.map((l) => ({ a: graph.nearestNode(proj.project(P[l.a])), b: graph.nearestNode(proj.project(P[l.b])), an: NAME[l.a], bn: NAME[l.b], regular: l.regular, reserve: l.reserve }))
    : autoLines(db, graph, hot)
  const landmarks = db.data('landmarks.json')
  const rand = rng(1912)
  const plates = new Set<string>((await pool.query(`SELECT plate FROM vehicles`)).rows.map((r) => r.plate))
  let n = (await pool.query(`SELECT count(*)::int n FROM users`)).rows[0].n + 100

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [u] } = await client.query(`INSERT INTO unions (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [UNION])
    const codes: string[] = []
    for (const [i, l] of lines.entries()) {
      const code = `S${String(i + 1).padStart(2, '0')}`
      const dirs = (['ida', 'vuelta'] as const).map((direction) => {
        const [from, to] = direction === 'ida' ? [l.an, l.bn] : [l.bn, l.an]
        const path = graph.shortestPath(direction === 'ida' ? l.a : l.b, direction === 'ida' ? l.b : l.a, arterial)
        if (!path) throw new Error(`sin camino ${from} → ${to} (línea ${code})`)
        return { direction, from, to, path }
      })
      const ids: Record<string, number> = {}
      for (const d of dirs) {
        const { rows: [r] } = await client.query(
          `INSERT INTO routes (union_id, code, name, direction, mode, color, headway_min, geom, simulated)
           VALUES ($1, $2, $3, $4, 'minibus', $5, 10, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), true) RETURNING id`,
          [u.id, code, `Línea simulada ${code}: ${d.from} → ${d.to}`, d.direction, COLORS[i % COLORS.length], toGeoJSONLine(d.path.pts, proj.unproject)],
        )
        ids[d.direction] = r.id
      }
      codes.push(code)
      // Las unidades de refuerzo toman el sentido que llega antes al hotspot desde su terminal (si hay dos parecidos, se alternan).
      const toOb = dirs.map((d) => { const p = new Path(d.path.pts), at = p.locate(hot); return { d: d.direction, at: dist(p.at(at).p, hot) < 40 ? at : Infinity } })
      const best = Math.min(...toOb.map((x) => x.at))
      const crossing = toOb.filter((x) => x.at <= best * 1.35).map((x) => x.d)
      const total = l.regular + l.reserve
      for (let k = 0; k < total; k++) {
        const reserve = k >= l.regular
        const direction = reserve && crossing.length ? crossing[(k - l.regular) % crossing.length] : k % 2 ? 'vuelta' : 'ida'
        const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`
        let plate = ''
        do plate = `${1000 + Math.floor(rand() * 8999)}-${[0, 1, 2].map(() => LETTERS[Math.floor(rand() * LETTERS.length)]).join('')}`
        while (plates.has(plate))
        plates.add(plate)
        n++
        const { rows: [d] } = await client.query(
          `INSERT INTO users (full_name, role, phone, license_no) VALUES ($1, 'chofer', $2, $3) RETURNING id`,
          [name, `7${String(1000000 + Math.floor(rand() * 8999999)).slice(0, 7)}`, `LP-${String(4000000 + n * 7919).slice(0, 7)}`],
        )
        await client.query(
          `INSERT INTO vehicles (plate, kind, union_id, driver_id, route_id, reserve) VALUES ($1, 'minibus', $2, $3, $4, $5)`,
          [plate, u.id, d.id, ids[direction], reserve],
        )
      }
    }
    await addStops(client, zone, landmarks, codes)
    await addStopFences(client, zone)
    await client.query('COMMIT')
    const c = (await pool.query(`SELECT count(*)::int n, count(*) FILTER (WHERE reserve)::int r FROM vehicles WHERE route_id IN (SELECT id FROM routes WHERE simulated)`)).rows[0]
    console.log(`flota simulada ${zone.id}: ${lines.length} líneas, ${c.n - c.r} minibuses en servicio y ${c.r} de refuerzo`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
