import { useEffect, useState } from 'react'
import { project, type LL } from './data'

export type VehicleState = 'normal' | 'congestion' | 'desvio' | 'detenido' | 'alerta'
export type AlertKind = 'fuera_de_ruta' | 'detenido' | 'geocerca' | 'congestion'

export interface FleetVehicle {
  id: number; plate: string; code: string; sim: boolean; direction: 'ida' | 'vuelta'; kind: string
  lon: number; lat: number; heading: number; speedKmh: number; state: VehicleState; alert: AlertKind | null
}
export interface FleetAlert {
  id: number; kind: AlertKind; vehicleId: number | null; plate: string | null; code: string | null; detail: Record<string, unknown>; startedAt: string
  lon: number | null; lat: number | null // dónde ocurre (punto de la alerta en PostGIS)
}
export interface Reroute { code: string; direction: string; via: string[]; extraM: number; extraMin: number; coords: LL[] }
export interface FleetEvent { id: number; time: string; level: 'ok' | 'info' | 'warn' | 'critical'; text: string }
export interface Snapshot {
  t: string; vehicles: FleetVehicle[]; alerts: FleetAlert[]
  congestion: { id: number; level: number; coords: LL[] }[]; reroutes: Reroute[]
  metrics: { active: number; avgSpeedKmh: number; alerts: number; congestedSegments: number; peak: boolean; reserveOut: number }
  events: FleetEvent[]
}

/**
 * Último estado recibido, en un objeto mutable que la escena 3D lee por frame
 * (interpola entre la foto anterior y la actual sin re-renderizar React).
 */
export const fleet = {
  prev: new Map<number, { x: number; z: number; h: number }>(),
  cur: new Map<number, { x: number; z: number; h: number; v: FleetVehicle }>(),
  at: 0,
  snap: null as Snapshot | null,
}

function ingest(s: Snapshot) {
  fleet.prev = new Map([...fleet.cur].map(([id, p]) => [id, { x: p.x, z: p.z, h: p.h }]))
  fleet.cur = new Map(s.vehicles.map((v) => {
    const [x, z] = project([v.lon, v.lat])
    return [v.id, { x, z, h: (v.heading * Math.PI) / 180, v }]
  }))
  fleet.at = performance.now()
  fleet.snap = s
}

/** Posición interpolada entre la foto anterior y la actual (las fotos llegan cada 1 s). */
export function vehiclePos(id: number) {
  const c = fleet.cur.get(id)
  if (!c) return null
  const p = fleet.prev.get(id)
  const a = Math.min(1, (performance.now() - fleet.at) / 1000)
  if (!p || Math.hypot(c.x - p.x, c.z - p.z) > 80) return { x: c.x, z: c.z, h: c.h } // reaparece tras la pausa
  let dh = c.h - p.h
  if (dh > Math.PI) dh -= 2 * Math.PI
  if (dh < -Math.PI) dh += 2 * Math.PI
  return { x: p.x + (c.x - p.x) * a, z: p.z + (c.z - p.z) * a, h: p.h + dh * a }
}

export type FleetStatus = 'connecting' | 'live' | 'offline'

/** Suscripción SSE a /api/stream; se cierra al desmontar. EventSource reintenta solo. */
export function useFleet() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState<FleetStatus>('connecting')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onopen = () => setStatus('live')
    es.onmessage = (e) => {
      const s = JSON.parse(e.data) as Snapshot
      ingest(s)
      setSnap(s)
      setStatus('live')
    }
    es.onerror = () => setStatus(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting')
    const watchdog = setTimeout(() => { if (!fleet.snap) setStatus('offline') }, 6000)
    return () => { clearTimeout(watchdog); es.close() }
  }, [attempt])

  // EventSource no reintenta si el proxy responde 502 (API reiniciándose): reintento propio cada 5 s
  useEffect(() => {
    if (status !== 'offline') return
    const t = setTimeout(() => setAttempt((n) => n + 1), 5000)
    return () => clearTimeout(t)
  }, [status, attempt])

  return { snap, status, retry: () => { setStatus('connecting'); setAttempt((n) => n + 1) } }
}

export async function runScenario(id: string): Promise<string> {
  const r = await fetch(`/api/scenarios/${id}`, { method: 'POST' })
  const body = await r.json().catch(() => ({ message: `HTTP ${r.status}` }))
  return body.message
}
