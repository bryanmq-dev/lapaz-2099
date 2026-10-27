import { useEffect, useState } from 'react'
import * as THREE from 'three'
import type { ZoneId } from '../../shared/zones'
import type { GeoRequest, GeoResponse, Packed } from './geoWorker'

export type ZoneGeometry = Record<'terrain' | 'buildings' | 'asphalt' | 'minor' | 'glow' | 'parks' | 'plazas', THREE.BufferGeometry>

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, (r: GeoResponse) => void>()

export function request(req: Omit<GeoRequest, 'id'>) {
  if (!worker) {
    worker = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<GeoResponse>) => { waiting.get(e.data.id)?.(e.data); waiting.delete(e.data.id) }
  }
  const id = ++seq
  return new Promise<GeoResponse>((resolve) => { waiting.set(id, resolve); worker!.postMessage({ ...req, id }) })
}

export const unpack = ({ attrs, index }: Packed) => {
  const g = new THREE.BufferGeometry()
  for (const [name, arr, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute(arr as Float32Array, size))
  if (index) g.setIndex(new THREE.BufferAttribute(index as Uint32Array, 1))
  return g
}

/** Geometría pesada de la zona, construida en un Web Worker. `minH` > 0 omite los edificios bajos sin nombre. */
export function useZoneGeometry(zone: ZoneId, light: boolean, minH: number) {
  const [geo, setGeo] = useState<{ key: string; g: ZoneGeometry } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = `${zone}|${light}|${minH}`
  useEffect(() => {
    let alive = true
    void request({ zone, light, minH }).then((r) => {
      if (!alive) return
      if (r.error) { setError(r.error); return }
      setGeo({ key, g: Object.fromEntries(Object.entries(r.geos).map(([k, p]) => [k, unpack(p)])) as ZoneGeometry })
    })
    return () => { alive = false }
  }, [zone, light, minH, key])
  // la geometría anterior se libera al reemplazarse
  useEffect(() => () => { if (geo) for (const g of Object.values(geo.g)) g.dispose() }, [geo])
  return { geo: geo?.g ?? null, stale: geo != null && geo.key !== key, error }
}
