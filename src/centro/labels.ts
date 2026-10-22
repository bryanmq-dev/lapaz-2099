import { Ban, Route, TrafficCone, Wrench } from 'lucide-react'
import type { FleetVehicle } from './useFleet'

export const STATE_LABEL: Record<FleetVehicle['state'], string> = {
  normal: 'En servicio', congestion: 'En congestión', desvio: 'Desvío autorizado', detenido: 'Detenido', alerta: 'Con alerta',
}

export const SCENARIOS = [
  { id: 'congestion', label: 'Hora punta en El Prado', icon: TrafficCone, tone: 'incident' },
  { id: 'desvio', label: 'Desvío no autorizado', icon: Route, tone: 'warn' },
  { id: 'averia', label: 'Avería', icon: Wrench, tone: 'warn' },
  { id: 'geocerca', label: 'Ingreso a geocerca', icon: Ban, tone: 'warn' },
] as const
