import { useEffect, useState } from 'react'
import { ArrowLeft, MapPin, PanelsTopLeft, RefreshCw, Siren } from 'lucide-react'
import { ThemeToggle } from '../components/ThemeToggle'
import { setView } from '../view'
import { ZONES, zoneById, type ZoneId } from '../../shared/zones'
import { AlertsPanel, Events, Kpis, Lines, ScenarioBar, VehiclePanel, type VehicleDetail } from './CentroPanel'
import { CentroScene } from './CentroScene'
import { loadZone, setZone, type CentroData, type LL } from './data'
import type { Geofence } from './FleetLayers'
import { api, runScenario, useFleet, type FleetAlert } from './useFleet'
import { VrEnter } from './VrEnter'
import { openQuickLook } from './quicklook'

/** Ficha del vehículo seleccionado (chofer, ruta, recorrido reciente), refrescada cada 2 s. */
function useVehicleDetail(zone: ZoneId, id: number | null) {
  const [detail, setDetail] = useState<(VehicleDetail & { track: LL[] }) | null>(null)
  useEffect(() => {
    if (id == null) return
    let alive = true
    const load = () => fetch(`${api(zone)}/vehicles/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => alive && setDetail(d)).catch(() => {})
    void load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [zone, id])
  return detail?.id === id ? detail : null
}

function useGeofences(zone: ZoneId, live: boolean) {
  const [list, setList] = useState<Geofence[]>([])
  useEffect(() => {
    if (!live || list.length) return
    fetch(`${api(zone)}/geofences`).then((r) => r.json()).then((fc) => setList(fc.features.map((f: any) => ({ ...f.properties, coords: f.geometry.coordinates[0] })))).catch(() => {})
  }, [zone, live, list.length])
  return list
}

/** Vista detallada de una zona (el Centro y las demás): escena 3D, flota en vivo, alertas y escenarios. */
export function CentroView({ zone: id }: { zone: ZoneId }) {
  const zone = zoneById(id)!
  setZone(zone) // ponytail: proyección de la zona activa antes de que se use (ver data.ts)
  const [data, setData] = useState<CentroData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [follow, setFollow] = useState(true)
  const [homeSeq, setHomeSeq] = useState(0)
  const [focusAt, setFocusAt] = useState<{ ll: LL; seq: number } | null>(null)
  const [panels, setPanels] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { snap, status, retry } = useFleet(id)
  const detail = useVehicleDetail(id, selected)
  const geofences = useGeofences(id, status === 'live')

  useEffect(() => {
    let alive = true
    loadZone(id).then((d) => alive && setData(d)).catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [id])

  // si el vehículo sale de la zona (pausa entre ida y vuelta) se deja de seguir
  const live = snap?.vehicles.find((v) => v.id === selected) ?? null
  const select = (id: number | null) => { setSelected(id); if (id != null) setFollow(true) }
  /** Alerta con vehículo: sigue al vehículo. Alerta de zona (congestión): la cámara vuela al lugar. */
  const goTo = (a: FleetAlert) => {
    if (a.vehicleId) return select(a.vehicleId)
    if (a.lon == null || a.lat == null) return
    setSelected(null)
    setFocusAt((f) => ({ ll: [a.lon!, a.lat!], seq: (f?.seq ?? 0) + 1 }))
  }
  const run = async (id: string) => {
    setBusy(true)
    try { setMessage(await runScenario(zone.id, id)) } catch { setMessage('No se pudo contactar a la API') }
    setBusy(false)
  }
  const toggleLine = (c: string) => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })
  const jam = snap?.alerts.find((a) => a.kind === 'congestion')
  const clock = snap ? new Date(snap.t).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour12: false }) : '--:--:--'

  return (
    <div className="stage">
      {data && (
        <CentroScene data={data} snap={snap} selected={selected} onSelect={select} hidden={hidden}
          follow={follow} homeSeq={homeSeq} focusAt={focusAt} track={detail?.track ?? []} geofences={geofences}
          detail={detail} onToggleLine={toggleLine} onRun={run} busy={busy} message={message} />
      )}
      {!data && <div className="loading">{error ? `No se pudieron cargar los datos de ${zone.name}: ${error}` : `Cargando ${zone.name}…`}</div>}

      <div className={`hud hud-centro ${panels ? '' : 'hud-min'}`}>
        <header className="top">
          <div className="brand">
            <button className="icon-btn" title="Volver a la vista ciudad" aria-label="Volver a la vista ciudad" onClick={() => setView('city')}>
              <ArrowLeft size={17} />
            </button>
            <div>
              <h1>{zone.name.toUpperCase()} <span>LA PAZ</span></h1>
              <p className="zone-pick">
                <select value={id} onChange={(e) => setView(e.target.value as ZoneId)} aria-label="Cambiar de zona">
                  {ZONES.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
                <span>· SEGUIMIENTO DE TRANSPORTE PÚBLICO</span>
              </p>
            </div>
          </div>
          <div className="top-right">
            <span className={`api api-${status}`}><i />{status === 'live' ? 'API EN VIVO' : status === 'connecting' ? 'CONECTANDO…' : 'API SIN CONEXIÓN'}</span>
            <span className="demo"><i />DEMO · SIMULACIÓN</span>
            <div className="clock"><small>HORA LA PAZ</small><b>{clock}</b></div>
            <div className="tools">
              <VrEnter onQuickLook={data ? () => openQuickLook(data) : undefined} />
              <ThemeToggle />
              <button className="icon-btn panels-toggle" aria-pressed={panels} title="Mostrar / ocultar paneles" aria-label="Mostrar u ocultar paneles" onClick={() => setPanels(!panels)}>
                <PanelsTopLeft size={17} />
              </button>
            </div>
          </div>
        </header>

        {data && (
          <>
            <aside className="col col-left">
              <Kpis snap={snap} />
              <Lines lines={data.lines} routes={data.routes} hidden={hidden} snap={snap}
                onToggle={toggleLine} />
            </aside>
            <aside className="col col-right">
              <VehiclePanel detail={detail} live={live} follow={follow} onFollow={() => setFollow((f) => !f)} />
              <AlertsPanel snap={snap} onPick={goTo} />
              <Events snap={snap} />
            </aside>
            <ScenarioBar hotspot={zone.hotspot.name} snap={snap} busy={busy} message={message} onRun={run} onHome={() => { setSelected(null); setFocusAt(null); setHomeSeq((n) => n + 1) }} />
          </>
        )}

        {jam && (
          <div className="banner banner-detected" role="alert" onClick={() => goTo(jam)}>
            <div className="banner-main">
              <Siren size={20} />
              <div>
                <b>CONGESTIÓN · {String(jam.detail.via ?? zone.hotspot.name).toUpperCase()}</b>
                <span>{snap!.reroutes.length ? `Desvío sugerido para ${snap!.reroutes.map((r) => `${r.code} ${r.direction}`).join(', ')} dentro de ${zone.name}` : `${jam.detail.vehiculos} vehículos a ${jam.detail.velocidad_kmh} km/h en ${jam.detail.largo_m} m`}</span>
              </div>
            </div>
            <button className="banner-go" onClick={(e) => { e.stopPropagation(); goTo(jam) }}><MapPin size={14} />Ver en el mapa</button>
          </div>
        )}

        {status === 'offline' && (
          <div className="offline panel">
            <b>API de seguimiento sin conexión</b>
            <span>La vista 3D de {zone.name} funciona, pero los vehículos y alertas vienen del servidor. Inicia <code>docker compose up -d db</code> y <code>pnpm --dir server dev</code>.</span>
            <button className="icon-btn wide" onClick={retry}><RefreshCw size={15} />Reintentar</button>
          </div>
        )}
        {data && <p className="attribution">{data.meta.attribution}</p>}
      </div>
    </div>
  )
}
