import { useState } from 'react'
import {
  Activity, Bus, ChevronDown, Construction, Crosshair, Eye, EyeOff, Gauge, LocateFixed, Route, RotateCcw,
  ShieldAlert, ShieldCheck, TrafficCone, TriangleAlert,
} from 'lucide-react'
import { EventFeed } from '../components/EventFeed'
import { MetricCard } from '../components/MetricCard'
import type { LineInfo, RouteLine } from './data'
import { SCENARIOS, STATE_LABEL } from './labels'
import type { AlertKind, FleetAlert, FleetVehicle, Snapshot } from './useFleet'

const ALERT_LABEL: Record<AlertKind, string> = {
  fuera_de_ruta: 'Fuera de ruta', detenido: 'Detenido', geocerca: 'Geocerca', congestion: 'Congestión',
}

export interface VehicleDetail {
  id: number; plate: string; kind: string; status: string; driver: string; phone: string; license_no: string
  union_name: string; code: string; route_name: string; direction: string; color: string; stoppedSeconds: number
  alerts: { id: number; kind: AlertKind; started_at: string; resolved_at: string | null }[]
}

function Section({ title, icon: Icon, children, className = '' }: { title: string; icon: typeof Activity; children: React.ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <h2><Icon size={13} strokeWidth={1.75} />{title}</h2>
      {children}
    </section>
  )
}

export function Kpis({ snap }: { snap: Snapshot | null }) {
  const m = snap?.metrics
  return (
    <div className="kpis">
      <MetricCard icon={Bus} label="En la zona" value={m?.active ?? 0} sub={m?.reserveOut ? `${m.reserveOut} de refuerzo en hora punta` : 'vehículos activos'} tone="cyan" />
      <MetricCard icon={Gauge} label="Velocidad" value={m?.avgSpeedKmh ?? 0} decimals={1} unit="km/h" sub="media de la flota" tone={(m?.avgSpeedKmh ?? 20) < 10 ? 'amber' : 'green'} />
      <MetricCard icon={TriangleAlert} label="Alertas" value={m?.alerts ?? 0} sub={m?.alerts ? 'abiertas en PostGIS' : 'sin alertas'} tone={m?.alerts ? 'red' : 'green'} />
      <MetricCard icon={TrafficCone} label="Congestión" value={m?.congestedSegments ?? 0} sub="tramos saturados" tone={m?.congestedSegments ? 'amber' : 'green'} />
    </div>
  )
}

export function Lines({ lines, routes, hidden, onToggle, snap }: {
  lines: LineInfo[]; routes: RouteLine[]; hidden: Set<string>; onToggle: (code: string) => void; snap: Snapshot | null
}) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Section title="Caso de estudio · 3 líneas" icon={Route} className="lines">
      <ul>
        {lines.map((l) => {
          const r = routes.filter((x) => x.code === l.code)
          const active = snap?.vehicles.filter((v) => v.code === l.code).length ?? 0
          const isOpen = open === l.code
          return (
            <li key={l.code} style={{ '--line': l.color } as React.CSSProperties}>
              <div className="line-row">
                <span className="line-code">{l.code}</span>
                <button className="line-main" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : l.code)}>
                  <b>{l.union}</b>
                  <small>{l.mode === 'trufi' ? 'Trufi' : 'Minibús'} · {active} en la zona · {r.map((x) => `${x.direction} ${x.km} km`).join(' · ')}</small>
                </button>
                <button className="icon-btn sm" aria-pressed={!hidden.has(l.code)} title={hidden.has(l.code) ? 'Mostrar línea' : 'Ocultar línea'}
                  aria-label={`${hidden.has(l.code) ? 'Mostrar' : 'Ocultar'} línea ${l.code}`} onClick={() => onToggle(l.code)}>
                  {hidden.has(l.code) ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <ChevronDown size={14} className={`chev ${isOpen ? 'up' : ''}`} aria-hidden />
              </div>
              {isOpen && (
                <dl className="ficha">
                  <dt>Extremos</dt><dd>{l.termini}</dd>
                  <dt>Corredor</dt><dd>{l.corridor}</dd>
                  <dt>Tarifa</dt><dd>{l.fare}</dd>
                  <dt>Horario</dt><dd>{l.schedule}{l.assumed.includes('schedule') && <em className="assumed">supuesto</em>}</dd>
                  <dt>Frecuencia</dt><dd>{l.headway}{l.assumed.includes('headway') && <em className="assumed">supuesto</em>}</dd>
                  <dt>OSM</dt><dd>{r.map((x) => `${x.direction}: relación ${x.osm}`).join(' · ')}</dd>
                  <dt>Notas</dt><dd>{l.notes}</dd>
                </dl>
              )}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

export function VehiclePanel({ detail, live, follow, onFollow }: {
  detail: VehicleDetail | null; live: FleetVehicle | null; follow: boolean; onFollow: () => void
}) {
  if (!detail || !live) {
    return (
      <Section title="Vehículo" icon={Bus}>
        <p className="hint">Haz clic en un vehículo del mapa o en una alerta para ver su chofer, ruta y estado.</p>
      </Section>
    )
  }
  return (
    <Section title="Vehículo seleccionado" icon={Bus} className="vehicle">
      <div className="veh-head" style={{ '--line': detail.color } as React.CSSProperties}>
        <span className="line-code">{detail.code}</span>
        <div>
          <b>{detail.plate}</b>
          <small>{detail.kind === 'trufi' ? 'Trufi' : 'Minibús'} · {detail.union_name}</small>
        </div>
        <button className="icon-btn sm" aria-pressed={follow} title="Seguir con la cámara" aria-label="Seguir con la cámara" onClick={onFollow}>
          <Crosshair size={14} />
        </button>
      </div>
      <dl className="kv">
        <dt>Chofer</dt><dd>{detail.driver} <em className="assumed">ficticio</em></dd>
        <dt>Licencia</dt><dd className="mono">{detail.license_no}</dd>
        <dt>Ruta</dt><dd>{detail.direction === 'ida' ? 'Ida' : 'Vuelta'} · {detail.route_name}</dd>
        <dt>Estado</dt><dd className={`st-${live.state}`}>{STATE_LABEL[live.state]}</dd>
        <dt>Velocidad</dt><dd className="mono">{live.speedKmh.toFixed(1)} km/h</dd>
        <dt>Sin avanzar</dt><dd className="mono">{detail.stoppedSeconds > 3 ? `${detail.stoppedSeconds} s` : '—'}</dd>
      </dl>
      {detail.alerts.length > 0 && (
        <ul className="alerts">
          {detail.alerts.slice(0, 3).map((a) => (
            <li key={a.id} className={a.resolved_at ? 'ev-ok' : 'ev-critical'}>
              {a.resolved_at ? <ShieldCheck size={12} /> : <TriangleAlert size={12} />}
              {ALERT_LABEL[a.kind]} · {new Date(a.started_at).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour12: false })}{a.resolved_at ? ' · resuelta' : ''}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function AlertsPanel({ snap, onPick }: { snap: Snapshot | null; onPick: (alert: FleetAlert) => void }) {
  const alerts = snap?.alerts ?? []
  const reroutes = snap?.reroutes ?? []
  return (
    <Section title="Alertas y desvíos" icon={ShieldAlert} className="reco">
      {alerts.length === 0 && reroutes.length === 0 && (
        <div className="reco-card lv-box-ok">
          <b>Flota en ruta</b>
          <span>Sin alertas abiertas. Las reglas se evalúan cada segundo con SQL espacial en PostGIS.</span>
        </div>
      )}
      {alerts.length > 0 && (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id}>
              <button disabled={!a.vehicleId && a.lon == null} onClick={() => onPick(a)} className={`al-${a.kind}`} title={a.vehicleId ? 'Seguir al vehículo' : 'Ver en el mapa'}>
                <TriangleAlert size={12} />
                <b>{ALERT_LABEL[a.kind]}</b>
                <span>{a.plate ? `${a.plate} · Línea ${a.code}` : String(a.detail.via ?? '')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {reroutes.map((r) => (
        <div key={`${r.code}${r.direction}`} className="reco-card lv-box-warn">
          <b>Desvío sugerido · Línea {r.code} ({r.direction})</b>
          <span>{r.via.slice(0, 5).join(' → ')}</span>
          <small>{r.extraM >= 0 ? '+' : ''}{r.extraM} m · ~{r.extraMin} min · camino más corto en la red vial de la zona (Dijkstra, respeta sentido único)</small>
        </div>
      ))}
    </Section>
  )
}

export function Events({ snap }: { snap: Snapshot | null }) {
  return (
    <Section title="Registro de eventos" icon={Activity} className="events">
      <EventFeed events={snap?.events ?? []} />
    </Section>
  )
}


export function ScenarioBar({ hotspot, snap, busy, message, onRun, onHome }: {
  hotspot: string; snap: Snapshot | null; busy: boolean; message: string; onRun: (id: string) => void; onHome: () => void
}) {
  const jammed = (snap?.metrics.congestedSegments ?? 0) > 0
  return (
    <div className="controls panel">
      <div className="controls-row">
        {SCENARIOS.map(({ id, label, icon: Icon, tone }) =>
          id === 'congestion' && jammed ? (
            <button key="despejar" className="cta cta-recover sm" disabled={busy || !snap} onClick={() => onRun('despejar')}>
              <ShieldCheck size={16} />Despejar {hotspot}
            </button>
          ) : (
            <button key={id} className={`cta sm cta-${tone}`} disabled={busy || !snap} onClick={() => onRun(id)}>
              <Icon size={16} />{id === 'congestion' ? `${label} en ${hotspot}` : label}
            </button>
          ))}
        <div className="icon-group">
          <button className="icon-btn" title="Vista general" aria-label="Vista general" onClick={onHome}><LocateFixed size={17} /></button>
          <button className="icon-btn" title="Restablecer simulación" aria-label="Restablecer simulación" disabled={busy || !snap} onClick={() => onRun('reset')}>
            <RotateCcw size={17} />
          </button>
        </div>
      </div>
      <div className="legend scenario-msg" aria-live="polite">
        {message || <><Construction size={12} />Escenarios simulados · alertas calculadas en PostGIS</>}
      </div>
    </div>
  )
}
