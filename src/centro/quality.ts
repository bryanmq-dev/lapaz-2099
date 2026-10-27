import { useSyncExternalStore } from 'react'

/**
 * Niveles de calidad para que la vista funcione en dispositivos modestos.
 * El nivel inicial sale del hardware que informa el navegador; si los FPS caen, PerformanceMonitor baja la resolución
 * y después el nivel. Se puede forzar con ?calidad=alta|media|baja.
 */
export type Tier = 'alta' | 'media' | 'baja'

export const TIERS: Record<Tier, { dpr: number; antialias: boolean; minH: number; windows: boolean; labels: number }> = {
  alta: { dpr: 1.75, antialias: true, minH: 0, windows: true, labels: 20 },
  media: { dpr: 1.25, antialias: true, minH: 4, windows: true, labels: 10 },
  baja: { dpr: 1, antialias: false, minH: 7, windows: false, labels: 6 }, // minH: sin edificios bajos sin nombre; windows: sin el shader de ventanas
}

function initial(): Tier {
  const forced = new URLSearchParams(location.search).get('calidad')
  if (forced === 'alta' || forced === 'media' || forced === 'baja') return forced
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory // Chrome/Edge; Safari no lo informa
  const cores = navigator.hardwareConcurrency || 4
  const touch = navigator.maxTouchPoints > 0 // teléfonos y tabletas (también el iPad, que se presenta como Mac)
  if ((mem && mem <= 3) || cores <= 4) return 'baja'
  if (touch || (mem && mem <= 6)) return 'media'
  return 'alta'
}

let tier: Tier = initial()
const subs = new Set<() => void>()
export const getTier = () => tier
/** Solo baja (nunca sube sola): evita oscilar entre niveles y reconstruir la geometría una y otra vez. */
export function lowerTier() {
  const next: Tier | null = tier === 'alta' ? 'media' : tier === 'media' ? 'baja' : null
  if (!next) return
  tier = next
  subs.forEach((fn) => fn())
}
export const useTier = () => useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn) } }, getTier)
