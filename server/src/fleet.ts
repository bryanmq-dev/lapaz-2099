// Flota simulada de refuerzo: líneas S01… sobre la red vial real del Centro.
// Las calles y los sentidos únicos son reales (OSM); las líneas, los choferes y las placas son ficticios.
import { addStopFences, addStops, data, FIRST, LAST, LETTERS, pool, rng } from './db.ts'
import { Path, dist, project, toGeoJSONLine, type LL } from './geo.ts'
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
 * a↔b: extremos de la línea. regular: unidades en servicio todo el día. reserve: unidades de refuerzo de hora punta.
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
const OBELISCO = project([-68.135081, -16.498602])
const COLORS = ['#7FA8C9', '#9CB4C8', '#8FB5B0', '#A9B8C9']
const UNION = 'Flota simulada (refuerzo)'

/** Crea las líneas, choferes y vehículos simulados si aún no existen (idempotente). */
export async function seedFleet() {
  if ((await pool.query(`SELECT 1 FROM routes WHERE simulated LIMIT 1`)).rowCount) return
  const rows = (await pool.query(`SELECT id, name, highway, oneway, source, target, length_m, congestion, ST_AsGeoJSON(geom)::json->'coordinates' coords FROM road_segments`)).rows
  const graph = new RoadGraph(rows)
  const arterial = (s: { highway: string }) => (/primary|trunk|secondary/.test(s.highway) ? 0.75 : /tertiary/.test(s.highway) ? 1 : 1.5)
  const node = (k: string) => graph.nearestNode(project(P[k]))
  const landmarks = data('landmarks.json')
  const rand = rng(1912)
  const plates = new Set<string>((await pool.query(`SELECT plate FROM vehicles`)).rows.map((r) => r.plate))
  let n = (await pool.query(`SELECT count(*)::int n FROM users`)).rows[0].n + 100

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows: [u] } = await client.query(`INSERT INTO unions (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [UNION])
    const codes: string[] = []
    for (const [i, l] of LINES.entries()) {
      const code = `S${String(i + 1).padStart(2, '0')}`
      const dirs = (['ida', 'vuelta'] as const).map((direction) => {
        const [from, to] = direction === 'ida' ? [l.a, l.b] : [l.b, l.a]
        const path = graph.shortestPath(node(from), node(to), arterial)
        if (!path) throw new Error(`sin camino ${from} → ${to} (línea ${code})`)
        return { direction, from, to, path }
      })
      const ids: Record<string, number> = {}
      for (const d of dirs) {
        const { rows: [r] } = await client.query(
          `INSERT INTO routes (union_id, code, name, direction, mode, color, headway_min, geom, simulated)
           VALUES ($1, $2, $3, $4, 'minibus', $5, 10, ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), true) RETURNING id`,
          [u.id, code, `Línea simulada ${code}: ${NAME[d.from]} → ${NAME[d.to]}`, d.direction, COLORS[i % COLORS.length], toGeoJSONLine(d.path.pts)],
        )
        ids[d.direction] = r.id
      }
      codes.push(code)
      // Las unidades de refuerzo toman el sentido que llega antes al Obelisco desde su terminal (si hay dos parecidos, se alternan).
      const toOb = dirs.map((d) => { const p = new Path(d.path.pts), at = p.locate(OBELISCO); return { d: d.direction, at: dist(p.at(at).p, OBELISCO) < 40 ? at : Infinity } })
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
    await addStops(client, landmarks, codes)
    await addStopFences(client)
    await client.query('COMMIT')
    const c = (await pool.query(`SELECT count(*)::int n, count(*) FILTER (WHERE reserve)::int r FROM vehicles WHERE route_id IN (SELECT id FROM routes WHERE simulated)`)).rows[0]
    console.log(`flota simulada: ${LINES.length} líneas, ${c.n - c.r} minibuses en servicio y ${c.r} de refuerzo`)
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
