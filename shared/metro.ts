import { projector } from './geo.ts'
import type { LL } from './geo.ts'
import { ZONES, type Zone } from './zones.ts'

// Urban coverage envelope, including the outlying western/southern neighbourhoods.
export const METRO = {
  ...ZONES[0], id: 'metro', name: 'La Paz · El Alto', district: 'metro',
  bbox: { s: -16.65, w: -68.32, n: -16.38, e: -68.0 },
  origin: { lat: -16.51, lon: -68.15 },
  tall: { axis: [], base: [12, 9, 6] }, lines: [],
} satisfies Zone
export const metroProjection = projector(METRO.origin)
export type CableState = 'normal' | 'mantenimiento' | 'detenido'
export type TransportMode = 'minibuses' | 'telefericos'
export const STATE_LABEL: Record<CableState, string> = { normal: 'Normal / avanzando', mantenimiento: 'En mantenimiento', detenido: 'Detenido' }
export const CABLE_NAMES = ['Roja', 'Amarilla', 'Verde', 'Azul', 'Naranja', 'Blanca', 'Celeste', 'Morada', 'Café', 'Plateada']
export const CABLE_COLORS = ['#e64b5d', '#eebf31', '#37ac67', '#437de3', '#ee8b32', '#e3e7ed', '#39c9e5', '#a766d6', '#ac7958', '#9caabd']
export interface CableStation { id: string; name: string; at: LL; osm: string; lines: string[] }
export interface CableLine {
  id: string; name: string; color: string; osm: string[]; stationIds: string[]
  pts: LL[]; supports: LL[]; issues: string[]; lengthM: number
}
export interface CableCatalog { lines: CableLine[]; stations: CableStation[] }
export interface MetroSector { id: string; center: LL; bounds: [number, number, number, number]; sizes: Record<string, number> }
export interface MetroManifest {
  version: string; generated: string; attribution: string; origin: { lat: number; lon: number }
  bbox: typeof METRO.bbox; sectors: MetroSector[]; streets: number; buildings: number; roadSegments: number
}
export interface CableEvent { id: number; time: string; lineId: string; before: CableState; after: CableState; source: 'manual' | 'auto'; text: string }
export interface CableSnapshot {
  session: string; seq: number; t: string; elapsed: number; automatic: boolean
  lines: { id: string; state: CableState; phaseM: number; speed: number; resumeAt: number | null }[]
  events: CableEvent[]
}
