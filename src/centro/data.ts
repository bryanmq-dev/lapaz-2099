// Datos reales del Centro (generados por scripts/centro/fetch.ts) y proyección a metros locales.
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
export interface Meta { bbox: { s: number; w: number; n: number; e: number }; origin: { lat: number; lon: number }; generated: string; attribution: string }

export interface CentroData {
  meta: Meta; elevation: Elevation; streets: Street[]; buildings: Building[]; areas: Area[]
  landmarks: Landmark[]; routes: RouteLine[]; lines: LineInfo[]
}

// Misma proyección que el script de datos y el servidor (equirectangular local, origen Plaza Murillo)
export const ORIGIN = { lat: -16.4958, lon: -68.1336 }
const KX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), KZ = 110574
export const project = (p: LL): [number, number] => [(p[0] - ORIGIN.lon) * KX, -(p[1] - ORIGIN.lat) * KZ]
export const unproject = (x: number, z: number): LL => [ORIGIN.lon + x / KX, ORIGIN.lat - z / KZ]

let cache: Promise<CentroData> | null = null

/** Carga perezosa: solo cuando se abre la vista del Centro. */
export function loadCentro(): Promise<CentroData> {
  const get = (f: string) => fetch(`${import.meta.env.BASE_URL}centro/${f}.json`).then((r) => {
    if (!r.ok) throw new Error(`${f}.json: HTTP ${r.status}`)
    return r.json()
  })
  cache ??= Promise.all(['meta', 'elevation', 'streets', 'buildings', 'areas', 'landmarks', 'routes', 'lines'].map(get))
    .then(([meta, elevation, streets, buildings, areas, landmarks, routes, lines]) => ({ meta, elevation, streets, buildings, areas, landmarks, routes, lines }))
    .catch((e) => { cache = null; throw e })
  return cache
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
