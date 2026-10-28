import { useEffect, useState } from 'react'
import { ArrowLeft, LocateFixed, RotateCcw, PanelsTopLeft, RefreshCw, CircleCheck, Construction, CirclePause, MapPin } from 'lucide-react'
import { STATE_LABEL, type CableState } from '../../shared/metro'
import { setView } from '../view'
import { ThemeToggle } from '../components/ThemeToggle'
import { QualityPicker } from '../centro/QualityPicker'
import { useTier } from '../centro/quality'
import { loadMetro, type MetroData } from './data'
import { MetroScene, type MetroFocus } from './MetroScene'
import { metroCommand, useMetroStream } from './useMetroStream'
import './metro.css'

export function MetroView() {
  const [data, setData] = useState<MetroData | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<string | null>(null), [station, setStation] = useState<string | null>(null), [focus, setFocus] = useState<MetroFocus>({ station: null, seq: 0 })
  const [panels, setPanels] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [progress, setProgress] = useState('Cargando mapa…')
  const tier = useTier(), stream = useMetroStream()
  useEffect(() => {
    const controller = new AbortController(); setError('')
    loadMetro(controller.signal).then(setData).catch((e) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [retry])
  // elegir una línea solo abre su panel; el zoom de cámara es exclusivo de las estaciones
  const chooseStation = (id: string | null) => {
    setStation(id)
    const lines = data?.cable.stations.find((s) => s.id === id)?.lines ?? []
    if (id && !(selected && lines.includes(selected))) setSelected(lines[0] ?? null)
    setFocus((f) => ({ station: id, seq: f.seq + 1 }))
  }
  const home = () => { setSelected(null); chooseStation(null) }
  const run = async (path: string, body?: unknown) => {
    setBusy(true); setMessage('')
    try { setMessage(await metroCommand(path, body)) } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  const connected = stream.status === 'Simulación conectada'
  const line = data?.cable.lines.find((l) => l.id === selected)
  const current = stream.cable?.lines.find((l) => l.id === selected)
  return <div className="stage metro-stage">
    {data && <MetroScene key={retry} data={data} tier={tier} selected={selected} station={station} focus={focus} live={stream.live} onSelectLine={setSelected} onSelectStation={chooseStation} onProgress={setProgress} />}
    <header className="metro-header panel">
      <button className="icon-btn" aria-label="Volver a Ciudad" onClick={() => setView('city')}><ArrowLeft size={18} /></button>
      <div className="metro-title"><h1>Vista «Mi Teleférico 2050»</h1><span>La Paz · El Alto · datos OpenStreetMap</span></div>
      <QualityPicker /><ThemeToggle />
      <button className="icon-btn" aria-label={panels ? 'Ocultar panel' : 'Mostrar panel'} aria-expanded={panels} onClick={() => setPanels(!panels)}><PanelsTopLeft size={18} /></button>
    </header>
    {error && <div className="metro-error panel" role="alert"><b>No se pudo abrir el mapa</b><p>{error}</p><button className="cta sm" onClick={() => setRetry((n) => n + 1)}>Reintentar</button></div>}
    {panels && <aside className="metro-sidebar" aria-label="Control de los teleféricos">
      <section className="panel metro-section">
        <div className="metro-section-title"><h2>Red de teleféricos</h2><span>{data?.cable.lines.length ?? '—'}</span></div>
        <p className="metro-connection"><i className={connected ? 'online' : ''} />{stream.status}</p>
        <label className="metro-auto"><input type="checkbox" checked={stream.cable?.automatic ?? true} disabled={busy || !connected} onChange={(e) => void run('telefericos/automation', { enabled: e.target.checked })} />Incidentes automáticos</label>
        <div className="metro-lines">{data?.cable.lines.map((l) => {
          const state = stream.cable?.lines.find((s) => s.id === l.id)?.state ?? 'normal'
          const Icon = state === 'normal' ? CircleCheck : state === 'mantenimiento' ? Construction : CirclePause
          return <button key={l.id} className={selected === l.id ? 'selected' : ''} onClick={() => setSelected(l.id)} aria-pressed={selected === l.id}>
            <i style={{ background: l.color }} /><span><b>{l.name}</b><small>{l.stationIds.length} estaciones · {(l.lengthM / 1000).toFixed(1)} km</small><small className={`metro-state ${state}`}><Icon size={12} />{STATE_LABEL[state]}</small></span>
          </button>
        })}</div>
      </section>
      {line && <section className="panel metro-section">
        <h2>{line.name}</h2><p>{current ? STATE_LABEL[current.state] : 'Esperando simulación'}</p>
        <div className="metro-state-controls">{(['normal', 'mantenimiento', 'detenido'] as CableState[]).map((s) => <button key={s} disabled={busy || !connected} aria-pressed={current?.state === s} onClick={() => void run(`telefericos/lines/${line.id}/state`, { state: s })}>{STATE_LABEL[s]}</button>)}</div>
        <ol className="metro-stations">{line.stationIds.map((id) => { const s = data?.cable.stations.find((x) => x.id === id); return <li key={id}><button className={station === id ? 'selected' : ''} aria-pressed={station === id} onClick={() => chooseStation(id)}><MapPin size={13} />{s?.name}{(s?.lines.length ?? 0) > 1 && <small>Intercambio</small>}</button></li> })}</ol>
        <small>Movimiento y estados simulados · alturas del cable aproximadas</small>
      </section>}
      <section className="panel metro-section"><h2>Registro de eventos</h2><ul className="metro-events">{[...(stream.cable?.events ?? [])].reverse().slice(0, 20).map((e) => <li key={`${stream.cable?.session}:${e.id}`}><time>{new Date(e.time).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })}</time>{e.text}</li>)}{!stream.cable?.events.length && <li>Los cambios de la simulación aparecerán aquí.</li>}</ul></section>
    </aside>}
    <div className="metro-tools panel">
      <button onClick={home}><LocateFixed size={16} />Toda la ciudad</button>
      <button disabled={busy || !connected} onClick={() => void run('telefericos/reset')}><RotateCcw size={16} />Restablecer</button>
      <button onClick={() => setRetry((v) => v + 1)}><RefreshCw size={16} />Reintentar mapa</button>
    </div>
    <div className="metro-notice panel" role="status" aria-live="polite">{busy ? 'Aplicando acción…' : message || stream.notice || progress}</div>
    <footer className="metro-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a> · Elevación AWS Terrain Tiles · Simulación</footer>
  </div>
}
