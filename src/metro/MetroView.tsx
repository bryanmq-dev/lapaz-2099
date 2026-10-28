import { useEffect, useState } from 'react'
import { ArrowLeft, CableCar, Bus, LocateFixed, RotateCcw, PanelsTopLeft, RefreshCw, CircleCheck, Construction, CirclePause, MapPin } from 'lucide-react'
import { STATE_LABEL, type CableState, type TransportMode } from '../../shared/metro'
import { setView } from '../view'
import { ThemeToggle } from '../components/ThemeToggle'
import { QualityPicker } from '../centro/QualityPicker'
import { useTier } from '../centro/quality'
import { loadMetro, type MetroData } from './data'
import { MetroScene } from './MetroScene'
import { metroCommand, useMetroStream } from './useMetroStream'
import './metro.css'

export function MetroView() {
  const [data, setData] = useState<MetroData | null>(null), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const [mode, setMode] = useState<TransportMode>('minibuses'), [selected, setSelected] = useState<string | null>(null), [focus, setFocus] = useState(0)
  const [panels, setPanels] = useState(true), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [progress, setProgress] = useState('Cargando mapa…')
  const tier = useTier(), stream = useMetroStream(mode)
  useEffect(() => {
    const controller = new AbortController(); setError('')
    loadMetro(controller.signal).then(setData).catch((e) => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [retry])
  const choose = (id: string | null) => { setSelected(id); setFocus((v) => v + 1) }
  const run = async (path: string, body?: unknown) => {
    setBusy(true); setMessage('')
    try { setMessage(await metroCommand(path, body)) } catch (e) { setMessage((e as Error).message) }
    finally { setBusy(false) }
  }
  const connected = stream.status === 'Simulación conectada'
  const line = data?.cable.lines.find((l) => l.id === selected)
  const current = stream.cable?.lines.find((l) => l.id === selected)
  const items = mode === 'telefericos' ? data?.cable.lines.map((l) => ({ id: l.id, name: l.name, color: l.color, detail: `${l.stationIds.length} estaciones · ${(l.lengthM / 1000).toFixed(1)} km` })) : data?.lines.map((l) => ({ id: l.code, name: l.corridor || l.code, color: l.color, detail: `OSM · ${l.code.split('·')[0]}` }))
  return <div className="stage metro-stage">
    {data && <MetroScene key={retry} data={data} mode={mode} tier={tier} selected={selected} focus={focus} live={stream.live} onSelect={choose} onProgress={setProgress} />}
    <header className="metro-header panel">
      <button className="icon-btn" aria-label="Volver a Ciudad" onClick={() => setView('city')}><ArrowLeft size={18} /></button>
      <div className="metro-title"><h1>La Paz · El Alto</h1><span>Mapa unificado · datos OpenStreetMap</span></div>
      <QualityPicker /><ThemeToggle />
      <button className="icon-btn" aria-label={panels ? 'Ocultar panel' : 'Mostrar panel'} aria-expanded={panels} onClick={() => setPanels(!panels)}><PanelsTopLeft size={18} /></button>
    </header>
    <nav className="metro-modes panel" aria-label="Transporte">
      {(['minibuses', 'telefericos'] as const).map((m) => <button key={m} aria-pressed={mode === m} onClick={() => { setMode(m); setSelected(null) }}>{m === 'minibuses' ? <Bus size={18} /> : <CableCar size={18} />}{m === 'minibuses' ? 'Minibuses y tráfico' : 'Teleféricos'}</button>)}
    </nav>
    {error && <div className="metro-error panel" role="alert"><b>No se pudo abrir el mapa</b><p>{error}</p><button className="cta sm" onClick={() => setRetry((n) => n + 1)}>Reintentar</button></div>}
    {panels && <aside className="metro-sidebar" aria-label="Control del transporte">
      <section className="panel metro-section">
        <div className="metro-section-title"><h2>{mode === 'telefericos' ? 'Red de teleféricos' : 'Red vial metropolitana'}</h2><span>{items?.length ?? '—'}</span></div>
        <p className="metro-connection"><i className={connected ? 'online' : ''} />{stream.status}</p>
        {mode === 'telefericos' ? <label className="metro-auto"><input type="checkbox" checked={stream.cable?.automatic ?? true} disabled={busy || !connected} onChange={(e) => void run('telefericos/automation', { enabled: e.target.checked })} />Incidentes automáticos</label> : <p>Flota y tráfico simulados sobre calles reales. Selecciona una ruta para encuadrarla.</p>}
        <div className="metro-lines">{items?.map((item) => {
          const state = stream.cable?.lines.find((l) => l.id === item.id)?.state ?? 'normal'
          const Icon = state === 'normal' ? CircleCheck : state === 'mantenimiento' ? Construction : CirclePause
          return <button key={item.id} className={selected === item.id ? 'selected' : ''} onClick={() => choose(item.id)} aria-pressed={selected === item.id}>
            <i style={{ background: item.color }} /><span><b>{item.name}</b><small>{item.detail}</small>{mode === 'telefericos' && <small className={`metro-state ${state}`}><Icon size={12} />{STATE_LABEL[state]}</small>}</span>
          </button>
        })}</div>
      </section>
      {mode === 'telefericos' && line && <section className="panel metro-section">
        <h2>{line.name}</h2><p>{current ? STATE_LABEL[current.state] : 'Esperando simulación'}</p>
        <div className="metro-state-controls">{(['normal', 'mantenimiento', 'detenido'] as CableState[]).map((s) => <button key={s} disabled={busy || !connected} aria-pressed={current?.state === s} onClick={() => void run(`telefericos/lines/${line.id}/state`, { state: s })}>{STATE_LABEL[s]}</button>)}</div>
        <ol className="metro-stations">{line.stationIds.map((id) => { const station = data?.cable.stations.find((s) => s.id === id); return <li key={id}><MapPin size={13} />{station?.name}{(station?.lines.length ?? 0) > 1 && <small>Intercambio</small>}</li> })}</ol>
        <small>Movimiento y estados simulados · alturas del cable aproximadas</small>
      </section>}
      {mode === 'minibuses' && <section className="panel metro-section">
        <h2>Escenarios de tráfico</h2>
        <div className="metro-metrics"><span><b>{stream.bus?.metrics.active ?? '—'}</b>vehículos</span><span><b>{stream.bus?.metrics.avgSpeedKmh ?? '—'}</b>km/h</span><span><b>{stream.bus?.metrics.alerts ?? '—'}</b>alertas</span></div>
        <div className="metro-state-controls">{[['congestion', 'Hora punta'], ['despejar', 'Despejar tráfico'], ['averia', 'Vehículo detenido'], ['desvio', 'Fuera de ruta']].map(([id, label]) => <button key={id} disabled={busy || !connected} onClick={() => void run(`minibuses/scenarios/${id}`)}>{label}</button>)}</div>
        {stream.bus?.alerts.map((a) => <p key={a.id} className="metro-alert">{a.kind.replaceAll('_', ' ')} · {a.code ?? 'Red vial'}</p>)}
        {stream.bus?.reroutes.map((r) => <p key={r.code + r.direction}>Desvío {r.code}: {r.via.slice(0, 3).join(' → ')}</p>)}
      </section>}
      <section className="panel metro-section"><h2>Registro de eventos</h2><ul className="metro-events">{mode === 'telefericos' ? [...(stream.cable?.events ?? [])].reverse().slice(0, 20).map((e) => <li key={`${stream.cable?.session}:${e.id}`}><time>{new Date(e.time).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz' })}</time>{e.text}</li>) : [...(stream.bus?.events ?? [])].reverse().slice(0, 20).map((e) => <li key={e.id}><time>{e.time}</time>{e.text}</li>)}{!(mode === 'telefericos' ? stream.cable?.events.length : stream.bus?.events.length) && <li>Los cambios de la simulación aparecerán aquí.</li>}</ul></section>
    </aside>}
    <div className="metro-tools panel">
      <button onClick={() => choose(null)}><LocateFixed size={16} />Toda la ciudad</button>
      <button disabled={busy || !connected} onClick={() => void run(mode === 'telefericos' ? 'telefericos/reset' : 'minibuses/scenarios/reset')}><RotateCcw size={16} />Restablecer</button>
      <button onClick={() => setRetry((v) => v + 1)}><RefreshCw size={16} />Reintentar mapa</button>
    </div>
    <div className="metro-notice panel" role="status" aria-live="polite">{busy ? 'Aplicando acción…' : message || stream.notice || progress}</div>
    <footer className="metro-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors · ODbL</a> · Elevación AWS Terrain Tiles · Simulación</footer>
  </div>
}
