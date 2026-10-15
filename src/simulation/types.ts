export type VisualizationMode = 'traffic' | 'energy' | 'sensors'
export type Level = 'ok' | 'info' | 'warn' | 'critical'
export type SensorKind = 'traffic' | 'energy' | 'air'
export type SensorState = 'ok' | 'alert' | 'offline'
export type IncidentPhase = 'detected' | 'responding' | 'recovering'
export type BuildingStyle = 'core' | 'high' | 'mid' | 'low'

export interface District {
  id: string
  name: string
  role: string
  pos: [number, number]
  radius: number
  style: BuildingStyle
  baseTraffic: number
  baseEnergy: number
  capacityMW: number
  /** peso en el índice de movilidad */
  weight: number
  /** habitantes (miles, ficticio) */
  population: number
}

export interface RoadLink {
  id: string
  name: string
  from: string
  to: string
}

export interface Sensor {
  id: string
  districtId: string
  kind: SensorKind
  pos: [number, number]
  /** fuera de línea por mantenimiento (estado base) */
  offline: boolean
}

export interface Incident {
  id: number
  districtId: string
  phase: IncidentPhase
  startedTick: number
  phaseTick: number
  /** factor de severidad al iniciar la recuperación */
  fromFactor: number
  normalRoute: string[]
  altRoute: string[]
  extraMinutes: number
}

export interface CityEvent {
  id: number
  time: string
  level: Level
  text: string
}

export interface CityMetrics {
  mobility: number
  mobilityDelta: number
  efficiency: number
  efficiencyDelta: number
  sensorsOnline: number
  sensorsTotal: number
  alerts: number
}

export interface DistrictStatus {
  id: string
  traffic: number
  energy: number
  loadMW: number
  level: Level
  sensorsOnline: number
  sensorsTotal: number
  hasIncident: boolean
  onAltRoute: boolean
}

export interface SensorStatus extends Sensor {
  state: SensorState
}

export interface Alert {
  id: string
  level: Level
  text: string
  districtId: string
}

export interface Recommendation {
  level: Level
  title: string
  text: string
  rule: string
}

export interface SimState {
  tick: number
  minute: number
  seq: number
  selectedId: string | null
  mode: VisualizationMode
  orbit: boolean
  /** se incrementa para pedir a la cámara volver a la vista general */
  viewSeq: number
  incident: Incident | null
  incidentCount: number
  events: CityEvent[]
}

export interface SimView {
  state: SimState
  clock: string
  districts: DistrictStatus[]
  sensors: SensorStatus[]
  metrics: CityMetrics
  alerts: Alert[]
  recommendation: Recommendation
  /** 0..1, severidad efectiva del incidente */
  factor: number
}

export type Action =
  | { type: 'tick' }
  | { type: 'select'; id: string | null }
  | { type: 'mode'; mode: VisualizationMode }
  | { type: 'orbit'; on: boolean }
  | { type: 'home' }
  | { type: 'incident' }
  | { type: 'resolve' }
  | { type: 'reset' }
