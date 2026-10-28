// Web Worker: descarga, parsea y construye la geometría pesada de una zona (terreno, ~25 000 edificios, calles y áreas)
// fuera del hilo principal. En un teléfono modesto esto congelaba la página varios segundos.
import * as THREE from 'three'
import { zoneById, type ZoneId } from '../../shared/zones'
import { makeHeight, setZone, type Area, type Building, type Elevation, type Street } from './data'
import { areasGeometry, buildingsGeometry, streetGeometries, terrainGeometry } from './geometry'

/**
 * `extra`: también los edificios de buildings-extra.json (calidad media y alta).
 * `ql`: versión liviana para AR Quick Look (USDZ va sin comprimir): solo edificios reales, terreno a 1/3, avenidas.
 * `sizes`: bytes de cada archivo (meta.json), para informar el avance de la descarga.
 */
export interface GeoRequest { id: number; zone: ZoneId; light: boolean; minH: number; extra: boolean; ql?: boolean; sizes?: Record<string, number> }
export type Packed = { attrs: [string, ArrayLike<number>, number][]; index: ArrayLike<number> | null }
/** Respuesta final (`geos`) o avance de la descarga (`progress`, varias veces antes de la respuesta). */
export interface GeoResponse { id: number; geos?: Record<string, Packed>; progress?: { loaded: number; total: number }; error?: string }

const post = (r: GeoResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer)

// un archivo por zona se descarga una sola vez; `onBytes` suma los bytes a medida que llegan
const cache = new Map<string, Promise<any>>()
function get(zone: ZoneId, f: string, onBytes: (n: number) => void) {
  const key = `${zone}/${f}`
  let p = cache.get(key)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}zonas/${zone}/${f}.json`).then(async (r) => {
      if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`)
      if (!r.body) return r.json()
      const reader = r.body.getReader(), parts: Uint8Array[] = []
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value); onBytes(value.byteLength)
      }
      return JSON.parse(await new Blob(parts as BlobPart[]).text())
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}
const loaded = (zone: ZoneId, f: string) => cache.has(`${zone}/${f}`)

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
  const { id, zone, light, minH, extra, ql, sizes = {} } = e.data
  try {
    setZone(zoneById(zone)!)
    const names = ['elevation', 'streets', 'areas', 'buildings', ...(extra && !ql ? ['buildings-extra'] : [])]
    // avance: solo cuenta lo que aún no se había descargado (al subir de nivel, solo el archivo extra)
    const total = names.filter((f) => !loaded(zone, f)).reduce((a, f) => a + (sizes[f] ?? 0), 0)
    let got = 0, last = 0
    const onBytes = (n: number) => {
      got += n
      const now = performance.now()
      if (total && now - last > 120) { last = now; post({ id, progress: { loaded: got, total } }) }
    }
    const [el, streets, areas, core, more = []] = await Promise.all(names.map((f) => get(zone, f, onBytes))) as [Elevation, Street[], Area[], Building[], Building[]?]
    if (total) post({ id, progress: { loaded: total, total } })
    const buildings = more.length ? [...core, ...more] : core
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
    post({ id, geos }, transfer)
  } catch (err) {
    post({ id, error: (err as Error).message })
  }
}
