// Web Worker: descarga, parsea y construye la geometría pesada de una zona (terreno, ~25 000 edificios, calles y áreas)
// fuera del hilo principal. En un teléfono modesto esto congelaba la página varios segundos.
import * as THREE from 'three'
import { zoneById, type ZoneId } from '../../shared/zones'
import { makeHeight, setZone, type Area, type Building, type Elevation, type Street } from './data'
import { areasGeometry, buildingsGeometry, streetGeometries, terrainGeometry } from './geometry'

/** `ql`: versión liviana para AR Quick Look (USDZ va sin comprimir): solo edificios reales, terreno a 1/3, avenidas. */
export interface GeoRequest { id: number; zone: ZoneId; light: boolean; minH: number; ql?: boolean }
export type Packed = { attrs: [string, ArrayLike<number>, number][]; index: ArrayLike<number> | null }
export interface GeoResponse { id: number; geos: Record<string, Packed>; error?: string }

const files = new Map<ZoneId, Promise<{ el: Elevation; buildings: Building[]; streets: Street[]; areas: Area[] }>>()
const get = (zone: ZoneId, f: string) => fetch(`${import.meta.env.BASE_URL}zonas/${zone}/${f}.json`).then((r) => {
  if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`)
  return r.json()
})
const load = (zone: ZoneId) => {
  let p = files.get(zone)
  if (!p) {
    p = Promise.all(['elevation', 'buildings', 'streets', 'areas'].map((f) => get(zone, f))).then(([el, buildings, streets, areas]) => ({ el, buildings, streets, areas }))
    p.catch(() => files.delete(zone))
    files.set(zone, p)
  }
  return p
}

/** Terreno a 1/k de resolución (para el USDZ). */
function coarse(el: Elevation, k: number): Elevation {
  const w = Math.floor((el.w - 1) / k) + 1, h = Math.floor((el.h - 1) / k) + 1, dm: number[] = []
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dm.push(el.dm[j * k * el.w + i * k])
  return { ...el, step: el.step * k, w, h, dm }
}

function pack(g: THREE.BufferGeometry, out: Transferable[]): Packed {
  const attrs: Packed['attrs'] = Object.entries(g.attributes).map(([name, a]) => {
    const arr = (a as THREE.BufferAttribute).array as Float32Array
    out.push(arr.buffer)
    return [name, arr, a.itemSize]
  })
  const index = g.index ? (g.index.array as Uint32Array) : null
  if (index) out.push(index.buffer)
  return { attrs, index }
}

self.onmessage = async (e: MessageEvent<GeoRequest>) => {
  const { id, zone, light, minH, ql } = e.data
  try {
    setZone(zoneById(zone)!)
    const { el, buildings, streets, areas } = await load(zone)
    const height = makeHeight(el)
    const list = buildings.filter((b) => (ql ? !b.e && (b.n || b.h >= 6) : minH <= 0 || b.n || b.h >= minH))
    const st = streetGeometries(ql ? streets.filter((x) => /primary|secondary|trunk|motorway/.test(x.hw)) : streets, height)
    const built: Record<string, THREE.BufferGeometry> = {
      terrain: terrainGeometry(ql ? coarse(el, 3) : el, light),
      buildings: buildingsGeometry(list, el.min, light),
      asphalt: st.asphalt, minor: st.minor, glow: st.glow,
      parks: areasGeometry(areas, height, (a) => /park|garden|grass|pitch|playground|recreation/.test(a.k)),
      plazas: areasGeometry(areas, height, (a) => /square|pedestrian/.test(a.k)),
    }
    const transfer: Transferable[] = []
    const geos = Object.fromEntries(Object.entries(built).map(([k, g]) => [k, pack(g, transfer)]))
    ;(self as unknown as Worker).postMessage({ id, geos } satisfies GeoResponse, transfer)
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, geos: {}, error: (err as Error).message } satisfies GeoResponse)
  }
}
