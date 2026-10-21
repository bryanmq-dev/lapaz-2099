import { useSyncExternalStore } from 'react'

/** Vista activa de la app: ciudad conceptual o Centro con datos reales. */
export type AppView = 'city' | 'centro'

let current: AppView = location.hash === '#centro' ? 'centro' : 'city'
const subs = new Set<() => void>()

export function setView(v: AppView) {
  if (v === current) return
  current = v
  history.replaceState(null, '', v === 'centro' ? '#centro' : location.pathname)
  subs.forEach((fn) => fn())
}

export const useView = () =>
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn) } }, () => current)
