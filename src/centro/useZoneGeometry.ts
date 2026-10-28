import { useEffect, useState, useSyncExternalStore } from 'react'
import * as THREE from 'three'
import type { ZoneId } from '../../shared/zones'
import type { GeoRequest, GeoResponse, Packed } from './geoWorker'

export type ZoneGeometry = Record<'terrain' | 'buildings' | 'asphalt' | 'minor' | 'glow' | 'parks' | 'plazas', THREE.BufferGeometry>
type Final = Required<Pick<GeoResponse, 'geos'>> & GeoResponse

let worker: Worker | null = null
let seq = 0
const waiting = new Map<number, { done: (r: Final) => void; progress?: (p: { loaded: number; total: number }) => void }>()

export function request(req: Omit<GeoRequest, 'id'>, onProgress?: (p: { loaded: number; total: number }) => void) {
  if (!worker) {
    worker = new Worker(new URL('./geoWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<GeoResponse>) => {
      const w = waiting.get(e.data.id)
      if (!w) return
      if (e.data.progress) { w.progress?.(e.data.progress); return }
      waiting.delete(e.data.id)
      w.done({ ...e.data, geos: e.data.geos ?? {} })
    }
  }
  const id = ++seq
  return new Promise<Final>((resolve) => { waiting.set(id, { done: resolve, progress: onProgress }); worker!.postMessage({ ...req, id }) })
}

export const unpack = ({ attrs, index }: Packed) => {
  const g = new THREE.BufferGeometry()
  for (const [name, arr, size] of attrs) g.setAttribute(name, new THREE.BufferAttribute(arr as Float32Array, size))
  if (index) g.setIndex(new THREE.BufferAttribute(index as Uint32Array, 1))
  return g
}

// ---- avance de la descarga de la ciudad (lo muestra la cabecera, fuera del Canvas) --------------------------
export type Download = { loaded: number; total: number; building: boolean } | null
let download: Download = null
const subs = new Set<() => void>()
const setDownload = (d: Download) => { download = d; subs.forEach((fn) => fn()) }
export const useDownload = () => useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn) } }, () => download)

/**
 * Geometría pesada de la zona, construida en un Web Worker. `extra` descarga también los edificios estimados bajos;
 * `minH` > 0 omite los edificios bajos sin nombre. `sizes` (meta.json) permite mostrar el avance en MB.
 */
export function useZoneGeometry(zone: ZoneId, light: boolean, minH: number, extra: boolean, sizes?: Record<string, number>, routesOnly = false) {
  const [geo, setGeo] = useState<{ key: string; g: ZoneGeometry } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const key = `${zone}|${light}|${minH}|${extra}|${routesOnly}`
  useEffect(() => {
    let alive = true
    void request({ zone, light, minH, extra, sizes, routesOnly }, (p) => alive && setDownload({ ...p, building: p.loaded >= p.total })).then((r) => {
      if (!alive) return
      setDownload(null)
      if (r.error) { setError(r.error); return }
      setGeo({ key, g: Object.fromEntries(Object.entries(r.geos).map(([k, p]) => [k, unpack(p)])) as ZoneGeometry })
    })
    return () => { alive = false; setDownload(null) }
  }, [zone, light, minH, extra, key, sizes, routesOnly])
  // la geometría anterior se libera al reemplazarse
  useEffect(() => () => { if (geo) for (const g of Object.values(geo.g)) g.dispose() }, [geo])
  return { geo: geo?.g ?? null, stale: geo != null && geo.key !== key, error }
}
