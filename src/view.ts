import { useSyncExternalStore } from 'react'
import { zoneById, type ZoneId } from '../shared/zones'

/** Vista activa de la app: ciudad conceptual o una zona con datos reales (#zona/<id>; #centro sigue funcionando). */
export type AppView = 'city' | 'metropolitano' | ZoneId

const parse = (hash: string): AppView => {
  if (hash === '#metropolitano') return 'metropolitano'
  const id = hash === '#centro' ? 'centro' : hash.startsWith('#zona/') ? hash.slice(6) : ''
  return zoneById(id)?.id ?? 'city'
}

let current: AppView = parse(location.hash)
const subs = new Set<() => void>()

export function setView(v: AppView) {
  if (v === current) return
  current = v
  history.replaceState(null, '', v === 'city' ? `${location.pathname}${location.search}` : v === 'metropolitano' ? '#metropolitano' : `#zona/${v}`)
  subs.forEach((fn) => fn())
}

addEventListener('hashchange', () => { const v = parse(location.hash); if (v !== current) { current = v; subs.forEach((fn) => fn()) } })

export const useView = () =>
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn) } }, () => current)
