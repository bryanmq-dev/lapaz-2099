import { useEffect, useRef, useState } from 'react'
import type { CableSnapshot } from '../../shared/metro'
export function useMetroStream() {
  const [cable, setCable] = useState<CableSnapshot | null>(null)
  const [status, setStatus] = useState('Conectando…')
  const [notice, setNotice] = useState('')
  const live = useRef({ cable: null as CableSnapshot | null, previous: null as CableSnapshot | null, received: 0, connected: false })
  useEffect(() => {
    const state = live.current
    let source: EventSource | null = null, retry: ReturnType<typeof setTimeout> | undefined, watchdog: ReturnType<typeof setTimeout> | undefined
    let lastSession = '', lastId = 0, disposed = false
    const connect = () => {
      if (disposed) return
      source = new EventSource('/api/metro/telefericos/stream')
      watchdog = setTimeout(() => { setStatus('Simulación desconectada'); state.connected = false }, 15000)
      source.onmessage = (e) => {
        clearTimeout(watchdog); setStatus('Simulación conectada'); state.connected = true
        const s = JSON.parse(e.data) as CableSnapshot
        state.received = performance.now()
        state.previous = state.cable?.session === s.session ? state.cable : null
        state.cable = s; setCable(s)
        const latest = s.events.at(-1)
        // al reconectar no se repiten avisos antiguos: solo se anuncia lo posterior al último evento visto de esta sesión
        if (lastSession === s.session && latest && latest.id > lastId) setNotice(latest.text)
        lastSession = s.session; lastId = latest?.id ?? 0
      }
      source.onerror = () => {
        state.connected = false; setStatus('Simulación desconectada · reintentando…'); source?.close(); clearTimeout(watchdog)
        retry = setTimeout(connect, 5000)
      }
    }
    connect()
    return () => { disposed = true; source?.close(); clearTimeout(retry); clearTimeout(watchdog); state.connected = false }
  }, [])
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer) }, [notice])
  return { cable, status, notice, live }
}
export type MetroLive = ReturnType<typeof useMetroStream>['live']
export async function metroCommand(path: string, body?: unknown) {
  const r = await fetch(`/api/metro/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15000) })
  const result = await r.json()
  if (!r.ok) throw new Error(result.message ?? `Error ${r.status}`)
  return result.message ?? 'Acción aplicada'
}
