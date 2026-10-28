import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity, Gauge, Map as MapIcon, Maximize, Minimize, PanelsTopLeft, Route, SatelliteDish, Siren, TriangleAlert, type LucideIcon,
} from 'lucide-react'
import { DISTRICTS, districtById } from '../simulation/cityData'
import { sim } from '../simulation/useSimulation'
import { setView } from '../view'
import { ZONES } from '../../shared/zones'
import type { DistrictStatus, IncidentPhase, Level, SimView } from '../simulation/types'
import { ControlPanel } from './ControlPanel'
import { EventFeed } from './EventFeed'
import { ThemeToggle } from './ThemeToggle'
import { MetricCard } from './MetricCard'

const trafficLabel = (v: number) => (v < 40 ? 'Fluido' : v < 60 ? 'Moderado' : v < 80 ? 'Denso' : 'Saturado')
const energyLabel = (v: number) => (v < 60 ? 'Estable' : v < 78 ? 'Elevada' : 'Crítica')
const levelOf = (v: number, warn: number, crit: number): Level => (v >= crit ? 'critical' : v >= warn ? 'warn' : 'ok')
const PHASES: { id: IncidentPhase; label: string }[] = [
  { id: 'detected', label: 'Detección' },
  { id: 'responding', label: 'Respuesta' },
  { id: 'recovering', label: 'Recuperación' },
]

function Meter({ label, value, text, level }: { label: string; value: number; text: string; level: Level }) {
  return (
    <div className="meter">
      <div className="meter-top"><span>{label}</span><b className={`lv-${level}`}>{text}</b></div>
      <div className="bar"><i className={`bg-${level}`} style={{ transform: `scaleX(${value / 100})` }} /></div>
    </div>
  )
}

function Section({ title, icon: Icon, children, className = '' }: { title: string; icon?: LucideIcon; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <h2>{Icon && <Icon size={13} strokeWidth={1.75} />}{title}</h2>
      {children}
    </section>
  )
}

function useFullscreen() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const h = () => setOn(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])
  const toggle = () => {
    const p = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()
    p.catch(() => {}) // el navegador puede denegarlo; no es crítico
  }
  return [on, toggle] as const
}

function ZoneDetail({ view }: { view: SimView }) {
  const sel = view.state.selectedId
  const detail = ZONES.find((z) => z.district === sel) // zona con vista detallada para este distrito (Obrajes no tiene)
  const d = sel ? view.districts[DISTRICTS.findIndex((x) => x.id === sel)] : null
  const info = sel ? districtById(sel) : null
  const all = view.districts
  const avg = (f: (s: DistrictStatus) => number) => Math.round(all.reduce((a, s) => a + f(s), 0) / all.length)
  const traffic = d ? d.traffic : avg((s) => s.traffic)
  const energy = d ? d.energy : avg((s) => s.energy)
  const mine = view.sensors.filter((s) => !sel || s.districtId === sel)
  const online = mine.filter((s) => s.state !== 'offline').length
  return (
    <Section title={d ? 'Zona seleccionada' : 'Ciudad completa'} icon={Activity}>
      <div className="zone-head">
        <b>{info ? info.name : 'La Paz 2050'}</b>
        <span>{info ? `${info.role} · ${info.population}k hab. (sim.)` : 'Promedio de las 7 zonas · selecciona una zona'}</span>
      </div>
      <Meter label="Tráfico" value={traffic} text={`${traffic}% · ${trafficLabel(traffic)}`} level={levelOf(traffic, 60, 80)} />
      <Meter label="Energía" value={energy} text={`${energy}% · ${d ? d.loadMW + ' MW · ' : ''}${energyLabel(energy)}`} level={levelOf(energy, 78, 90)} />
      <Meter label="Sensores" value={(online / mine.length) * 100} text={`${online}/${mine.length} en línea`} level={online < mine.length ? 'warn' : 'ok'} />
      {d && (
        <ul className="sensor-chips">
          {mine.map((s) => (
            <li key={s.id} className={`kind-${s.kind} st-${s.state}`} title={s.state}><i />{s.id}</li>
          ))}
        </ul>
      )}
      {detail && (
        <button className="cta cta-recover sm detail-cta" onClick={() => setView(detail.id)}>
          <MapIcon size={16} />Ver {detail.name} en detalle (datos reales)
        </button>
      )}
    </Section>
  )
}

export function Dashboard({ view }: { view: SimView }) {
  const { state, metrics, districts } = view
  const [panels, setPanels] = useState(true)
  const [full, toggleFull] = useFullscreen()
  const inc = state.incident
  const incName = inc ? districtById(inc.districtId).name : ''
  const phaseIdx = inc ? PHASES.findIndex((p) => p.id === inc.phase) : -1
  const gridAlerts = metrics.alerts

  return (
    <div className={`hud ${panels ? '' : 'hud-min'}`}>
      <header className="top">
        <div className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 26 11 9l5 8 4-6 9 15Z" fill="none" stroke="#00D5FF" strokeWidth="1.6" strokeLinejoin="round" />
            <circle cx="20" cy="11" r="2" fill="#43F5B5" />
          </svg>
          <div>
            <h1>LA PAZ <span>2050</span></h1>
            <p>SMART CITY CONTROL</p>
          </div>
        </div>
        <div className="top-right">
          <button className="icon-btn wide" onClick={() => setView('metropolitano')}>Vista Mi Teleférico 2050</button>
          <button className="icon-btn wide" title="Vistas detalladas por zona, con datos reales" onClick={() => setView('centro')}>
            <MapIcon size={15} />Zonas en detalle
          </button>
          <span className="demo"><i />DEMO · SIMULACIÓN</span>
          <div className="clock"><small>HORA SIM.</small><b>{view.clock}</b></div>
          <ThemeToggle />
          <button className="icon-btn" aria-pressed={panels} title="Mostrar / ocultar paneles" aria-label="Mostrar u ocultar paneles" onClick={() => setPanels(!panels)}>
            <PanelsTopLeft size={17} />
          </button>
          <button className="icon-btn" title="Pantalla completa" aria-label="Pantalla completa" onClick={toggleFull}>
            {full ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>
      </header>

      <div className="kpis">
        <MetricCard icon={Gauge} label="Movilidad" value={metrics.mobility} unit="/100" delta={metrics.mobilityDelta} deltaUnit=" pts" sub={metrics.mobilityDelta ? 'por incidente' : 'estable'}
          tone={metrics.mobility < 60 ? 'red' : metrics.mobility < 72 ? 'amber' : 'green'} />
        <MetricCard icon={Activity} label="Eficiencia" value={metrics.efficiency} decimals={1} unit="%" delta={metrics.efficiencyDelta} deltaUnit=" pts" tone="cyan" />
        <MetricCard icon={SatelliteDish} label="Sensores" value={metrics.sensorsOnline} unit={`/${metrics.sensorsTotal}`} sub={`${metrics.sensorsTotal - metrics.sensorsOnline} en mantenimiento`} tone="cyan" />
        <MetricCard icon={TriangleAlert} label="Alertas" value={metrics.alerts} sub={gridAlerts ? 'requieren atención' : 'sin alertas'} tone={gridAlerts ? 'red' : 'green'} />
      </div>

      {inc && (
        <div className={`banner banner-${inc.phase}`} role="alert">
          <div className="banner-main">
            <Siren size={20} />
            <div>
              <b>INCIDENTE SIMULADO · {incName}</b>
              <span>
                {inc.phase === 'detected' && 'Congestión severa detectada · calculando ruta alterna…'}
                {inc.phase === 'responding' && `Ruta alterna: ${inc.altRoute.map((id) => districtById(id).name).join(' → ')} · +${inc.extraMinutes} min`}
                {inc.phase === 'recovering' && 'Restableciendo semáforos y flujo vehicular…'}
              </span>
            </div>
          </div>
          <ol className="steps">
            {PHASES.map((p, i) => (
              <li key={p.id} className={i < phaseIdx ? 'done' : i === phaseIdx ? 'now' : ''}><i />{p.label}</li>
            ))}
          </ol>
        </div>
      )}

      <aside className="col col-left">
        <Section title="Zonas urbanas" icon={Route} className="zones">
          <ul>
            {DISTRICTS.map((d, i) => {
              const s = districts[i]
              const v = state.mode === 'traffic' ? `${s.traffic}%` : state.mode === 'energy' ? `${s.loadMW} MW` : `${s.sensorsOnline}/${s.sensorsTotal}`
              return (
                <li key={d.id}>
                  <button aria-pressed={state.selectedId === d.id} onClick={() => sim.dispatch({ type: 'select', id: state.selectedId === d.id ? null : d.id })}>
                    <i className={`dot bg-${s.hasIncident ? 'critical' : s.level}`} />
                    <span className="zname">{d.name}<small>{d.role}</small></span>
                    <b>{v}</b>
                  </button>
                </li>
              )
            })}
          </ul>
        </Section>
        <Section title="Estado del sistema" icon={Activity} className="sys">
          <dl>
            <dt>Gemelo digital</dt><dd className="lv-info">Simulación</dd>
            <dt>Red de sensores</dt><dd className={gridAlerts ? 'lv-warn' : 'lv-ok'}>{metrics.sensorsOnline}/{metrics.sensorsTotal}</dd>
            <dt>Semáforos</dt><dd className={inc ? 'lv-warn' : 'lv-ok'}>{inc ? 'Contingencia' : 'Adaptativos'}</dd>
            <dt>Ciclo</dt><dd>1 s = 1 min · #{state.tick}</dd>
          </dl>
          <p className="note">Todos los datos son ficticios. Representación conceptual, no un mapa preciso.</p>
        </Section>
      </aside>

      <aside className="col col-right">
        <ZoneDetail view={view} />
        <Section title="Recomendación" icon={Route} className="reco">
          <div className={`reco-card lv-box-${view.recommendation.level}`}>
            <b>{view.recommendation.title}</b>
            <span>{view.recommendation.text}</span>
            <small>{view.recommendation.rule} · generada por reglas de simulación</small>
          </div>
          {view.alerts.length > 0 && (
            <ul className="alerts">
              {view.alerts.slice(0, 3).map((a) => (
                <li key={a.id} className={`ev-${a.level}`}><TriangleAlert size={12} />{a.text}</li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Registro de eventos" icon={Activity} className="events">
          <EventFeed events={state.events} />
        </Section>
      </aside>

      <ControlPanel view={view} />
    </div>
  )
}
