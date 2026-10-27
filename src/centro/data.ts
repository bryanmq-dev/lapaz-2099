// Datos reales de una zona (generados por scripts/zonas/fetch.ts) y proyección a metros locales.
import { ZONES, type Zone, type ZoneId } from '../../shared/zones'

export type LL = [number, number]

export interface Street { id: number; name: string; hw: string; oneway: number; lanes: number; pts: LL[] }
export interface Building { h: number; b: number; k: string; n?: string; e?: 1; pts: LL[] }
export interface Area { k: string; n?: string; pts: LL[] }
export interface Landmark { label: string; osm: string; at: LL }
export interface RouteLine {
  code: string; direction: 'ida' | 'vuelta'; osm: number; name: string; operator: string; from: string; to: string
  osmRef: string; fullKm: number; km: number; issues: string[]; pts: LL[]
}
export interface LineInfo {
  code: string; mode: 'minibus' | 'trufi'; union: string; color: string; termini: string; corridor: string
  fare: string; schedule: string; headway: string; headwayMin: number; notes: string; assumed: string[]
}
export interface Elevation { x0: number; z0: number; step: number; w: number; h: number; min: number; max: number; dm: number[] }
export interface Meta {
  zone: ZoneId; name: string; bbox: { s: number; w: number; n: number; e: number }; origin: { lat: number; lon: number }
  hotspot: { name: string; short: string; at: LL; x: number; z: number }; generated: string; attribution: string
}

/** Datos livianos de la zona. Los pesados (edificios, calles, áreas) los descarga y construye el worker (geoWorker.ts). */
export interface CentroData {
  meta: Meta; elevation: Elevation; landmarks: Landmark[]; routes: RouteLine[]; lines: LineInfo[]
}

// Misma proyección que el script de datos y el servidor (equirectangular local con origen en la zona).
// ponytail: proyección global de la zona activa (solo se ve una a la vez); se fija con setZone() al entrar a la zona.
let origin = ZONES[0].origin
let KX = 0
const KZ = 110574
export let zone: Zone = ZONES[0]
export function setZone(z: Zone) {
  zone = z; origin = z.origin
  KX = 111320 * Math.cos((origin.lat * Math.PI) / 180)
}
setZone(ZONES[0])
export const project = (p: LL): [number, number] => [(p[0] - origin.lon) * KX, -(p[1] - origin.lat) * KZ]
export const unproject = (x: number, z: number): LL => [origin.lon + x / KX, origin.lat - z / KZ]

const cache = new Map<ZoneId, Promise<CentroData>>()

/** Carga perezosa de los datos de una zona (public/zonas/<id>/), una vez por zona. */
export function loadZone(id: ZoneId): Promise<CentroData> {
  const get = (f: string) => fetch(`${import.meta.env.BASE_URL}zonas/${id}/${f}.json`).then((r) => {
    if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`)
    return r.json()
  })
  let p = cache.get(id)
  if (!p) {
    p = Promise.all(['meta', 'elevation', 'landmarks', 'routes', 'lines'].map(get))
      .then(([meta, elevation, landmarks, routes, lines]) => ({ meta, elevation, landmarks, routes, lines }))
    p.catch(() => cache.delete(id))
    cache.set(id, p)
  }
  return p
}

/** Altura del terreno en la escena (m sobre el punto más bajo del modelo), interpolación bilineal. */
export function makeHeight(el: Elevation) {
  return (x: number, z: number) => {
    const gx = Math.min(el.w - 1.001, Math.max(0, (x - el.x0) / el.step))
    const gz = Math.min(el.h - 1.001, Math.max(0, (z - el.z0) / el.step))
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j
    const v = (a: number, b: number) => el.dm[b * el.w + a] / 10
    return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fz) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fz
  }
}
