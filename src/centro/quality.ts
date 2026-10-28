import { useSyncExternalStore } from 'react'

/**
 * Niveles de calidad para que la vista funcione en dispositivos modestos. Se eligen en la cabecera (Automática, Alta,
 * Media, Baja); la elección se recuerda en el navegador y se puede forzar con ?calidad=alta|media|baja.
 * En Automática el nivel sale del hardware que informa el navegador, y PerformanceMonitor lo baja si caen los FPS.
 */
export type Tier = 'alta' | 'media' | 'baja' | 'rutas'
export type Choice = Tier | 'auto'

// las ventanas de los edificios se dibujan en todos los niveles: sin ellas la ciudad se ve plana
export const TIERS: Record<Tier, { dpr: number; antialias: boolean; extra: boolean; minH: number; labels: number }> = {
  rutas: { dpr: 1, antialias: false, extra: false, minH: 0, labels: 12 },
  alta: { dpr: 1.75, antialias: true, extra: true, minH: 0, labels: 20 },
  media: { dpr: 1.25, antialias: true, extra: true, minH: 4, labels: 10 },
  // extra: false → no descarga buildings-extra.json (los edificios estimados de menos de 11 m, ~60 % del peso)
  baja: { dpr: 1, antialias: false, extra: false, minH: 0, labels: 6 },
}

/** Archivos que descarga cada nivel (los tamaños vienen en meta.json). */
export const filesFor = (t: Tier) => ['elevation', 'streets', 'areas', t === 'rutas' ? 'references' : 'buildings', ...(TIERS[t].extra ? ['buildings-extra'] : [])]

function detect(): Tier {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory // Chrome/Edge; Safari no lo informa
  const cores = navigator.hardwareConcurrency || 4
  const touch = navigator.maxTouchPoints > 0 // teléfonos y tabletas (también el iPad, que se presenta como Mac)
  if ((mem && mem <= 3) || cores <= 4) return 'baja'
  if (touch || (mem && mem <= 6)) return 'media'
  return 'alta'
}

const KEY = 'lapaz-calidad'
const isTier = (v: unknown): v is Tier => v === 'alta' || v === 'media' || v === 'baja' || v === 'rutas'
function initialChoice(): Choice {
  const forced = new URLSearchParams(location.search).get('calidad')
  if (isTier(forced)) return forced
  try { const v = localStorage.getItem(KEY); if (isTier(v)) return v } catch { /* sin acceso: automática */ }
  return 'auto'
}

let choice: Choice = initialChoice()
let auto: Tier = detect() // nivel que usa «Automática» (puede bajar con los FPS)
const subs = new Set<() => void>()
const emit = () => subs.forEach((fn) => fn())

export const getChoice = () => choice
export const getTier = (): Tier => (choice === 'auto' ? auto : choice)
export const autoTier = () => auto

export function setChoice(c: Choice) {
  if (c === choice) return
  choice = c
  try { if (c === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, c) } catch { /* no es crítico */ }
  emit()
}

/** Solo en Automática, y solo baja (nunca sube sola): evita oscilar y reconstruir la geometría una y otra vez. */
export function lowerTier() {
  if (choice !== 'auto') return
  const next: Tier | null = auto === 'alta' ? 'media' : auto === 'media' ? 'baja' : null
  if (!next) return
  auto = next
  emit()
}

const subscribe = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }
export const useTier = () => useSyncExternalStore(subscribe, getTier)
export const useChoice = () => useSyncExternalStore(subscribe, getChoice)
