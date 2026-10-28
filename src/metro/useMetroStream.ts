import { useEffect, useRef, useState } from 'react'
import type { CableSnapshot, TransportMode } from '../../shared/metro'
import type { Snapshot } from '../centro/useFleet'
export function useMetroStream(mode: TransportMode) {
  const [cable, setCable] = useState<CableSnapshot | null>(null)
  const [bus, setBus] = useState<Snapshot | null>(null)
  const [status, setStatus] = useState('Conectando…')
  const [notice, setNotice] = useState('')
  const live = useRef({ cable: null as CableSnapshot | null, previous: null as CableSnapshot | null, bus: null as Snapshot | null, previousBus: null as Snapshot | null, received: 0, connected: false })
  useEffect(() => {
    setStatus('Conectando…'); setNotice(''); live.current.connected = false
    let source: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined
    let lastSession = '', lastId = 0, disposed = false
    const connect = () => {
      if (disposed) return
      source = new EventSource(`/api/metro/${mode}/stream`)
      watchdog = setTimeout(() => { setStatus('Simulación desconectada'); live.current.connected = false }, 15000)
      source.onmessage = (e) => {
        clearTimeout(watchdog); setStatus('Simulación conectada'); live.current.connected = true
        const value = JSON.parse(e.data)
        live.current.received = performance.now()
        if (mode === 'telefericos') {
          const s = value as CableSnapshot
          live.current.previous = live.current.cable?.session === s.session ? live.current.cable : null
          live.current.cable = s; setCable(s)
          const latest = s.events.at(-1)
          if (lastSession === s.session && latest && latest.id > lastId) setNotice(latest.text)
          lastSession = s.session; lastId = latest?.id ?? 0
        } else { live.current.previousBus = live.current.bus; live.current.bus = value; setBus(value) }
      }
      source.onerror = () => {
        live.current.connected = false; setStatus('Simulación desconectada · reintentando…'); source?.close(); clearTimeout(watchdog)
        retry = setTimeout(connect, 5000)
      }
    }
    connect()
    return () => { disposed = true; source?.close(); clearTimeout(retry); clearTimeout(watchdog); live.current.connected = false }
  }, [mode])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer) }, [notice])
  return { cable, bus, status, notice, live }
}
export type MetroLive = ReturnType<typeof useMetroStream>['live']
export async function metroCommand(path: string, body?: unknown) {
  const r = await fetch(`/api/metro/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000) })
  const result = await r.json()
  if (!r.ok) throw new Error(result.message ?? `Error ${r.status}`)
  return result.message ?? 'Acción aplicada'
}
