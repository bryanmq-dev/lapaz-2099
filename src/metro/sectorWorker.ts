import { metroProjection } from '../../shared/metro'
import { makeHeight, type Elevation, type Street, type Building, type Area } from '../centro/data'
import { streetGeometries, buildingsGeometry, areasGeometry } from '../centro/geometry'
import type { BufferAttribute } from 'three'
export interface SectorRequest { id: string; base: string; tier: string; light: boolean; elevation: Elevation }
self.onmessage = async ({ data: r }: MessageEvent<SectorRequest>) => {
  try {
    const get = async (f: string) => { const response = await fetch(`${r.base}/sectors/${r.id}/${f}.json`); if (!response.ok) throw new Error(`Sector ${r.id}: HTTP ${response.status}`); return response.json() }
    const [streets, buildings, areas] = await Promise.all([get('streets'), get(r.tier === 'rutas' ? 'references' : 'buildings'), get('areas')]) as [Street[], Building[], Area[]]
    const height = makeHeight(r.elevation)
    const roads = streetGeometries(streets, height, metroProjection.project, 30)
    const list = buildings.filter((b) => r.tier !== 'baja' || b.n || b.h >= 8)
    const geos = { ...roads, buildings: buildingsGeometry(list, r.elevation.min, r.light, metroProjection.project), parks: areasGeometry(areas, height, () => true, metroProjection.project) }
    const transfer: Transferable[] = []
    const packed = Object.fromEntries(Object.entries(geos).map(([name, g]) => {
      const attrs = Object.entries(g.attributes).map(([key, attr]) => { const a = attr as BufferAttribute; transfer.push(a.array.buffer); return [key, a.array, a.itemSize] })
      const index = g.index?.array ?? null; if (index) transfer.push(index.buffer)
      return [name, { attrs, index }]
    }))
    postMessage({ id: r.id, geos: packed }, { transfer })
  } catch (e) { postMessage({ id: r.id, error: (e as Error).message }) }
}
