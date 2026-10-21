import { useEffect, useState } from 'react'
import { ArrowLeft, MapPin, RefreshCw, Siren } from 'lucide-react'
import { setView } from '../view'
import { AlertsPanel, Events, Kpis, Lines, ScenarioBar, VehiclePanel, type VehicleDetail } from './CentroPanel'
import { CentroScene } from './CentroScene'
import { loadCentro, type CentroData, type LL } from './data'
import type { Geofence } from './FleetLayers'
import { runScenario, useFleet, type FleetAlert } from './useFleet'

/** Ficha del vehículo seleccionado (chofer, ruta, recorrido reciente), refrescada cada 2 s. */
function useVehicleDetail(id: number | null) {
  const [detail, setDetail] = useState<(VehicleDetail & { track: LL[] }) | null>(null)
  useEffect(() => {
    if (id == null) return
    let alive = true
    const load = () => fetch(`/api/vehicles/${id}`).then((r) => (r.ok ? r.json() : null)).then((d) => alive && setDetail(d)).catch(() => {})
    void load()
    const t = setInterval(load, 2000)
    return () => { alive = false; clearInterval(t) }
  }, [id])
  return detail?.id === id ? detail : null
}

function useGeofences(live: boolean) {
  const [list, setList] = useState<Geofence[]>([])
  useEffect(() => {
    if (!live || list.length) return
    fetch('/api/geofences').then((r) => r.json()).then((fc) => setList(fc.features.map((f: any) => ({ ...f.properties, coords: f.geometry.coordinates[0] })))).catch(() => {})
  }, [live, list.length])
  return list
}

export function CentroView() {
  const [data, setData] = useState<CentroData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [follow, setFollow] = useState(true)
  const [homeSeq, setHomeSeq] = useState(0)
  const [focusAt, setFocusAt] = useState<{ ll: LL; seq: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const { snap, status, retry } = useFleet()
  const detail = useVehicleDetail(selected)
  const geofences = useGeofences(status === 'live')

  useEffect(() => {
    let alive = true
    loadCentro().then((d) => alive && setData(d)).catch((e: Error) => alive && setError(e.message))
    return () => { alive = false }
  }, [])

  // si el vehículo sale del Centro (pausa entre ida y vuelta) se deja de seguir
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
    try { setMessage(await runScenario(id)) } catch { setMessage('No se pudo contactar a la API') }
    setBusy(false)
  }
  const jam = snap?.alerts.find((a) => a.kind === 'congestion')
  const clock = snap ? new Date(snap.t).toLocaleTimeString('es-BO', { timeZone: 'America/La_Paz', hour12: false }) : '--:--:--'

  return (
    <div className="stage">
      {data && (
        <CentroScene data={data} snap={snap} selected={selected} onSelect={select} hidden={hidden}
          follow={follow} homeSeq={homeSeq} focusAt={focusAt} track={detail?.track ?? []} geofences={geofences} />
      )}
      {!data && <div className="loading">{error ? `No se pudieron cargar los datos del Centro: ${error}` : 'Cargando el Centro de La Paz…'}</div>}

      <div className="hud hud-centro">
        <header className="top">
          <div className="brand">
            <button className="icon-btn" title="Volver a la vista ciudad" aria-label="Volver a la vista ciudad" onClick={() => setView('city')}>
              <ArrowLeft size={17} />
            </button>
            <div>
              <h1>CENTRO <span>LA PAZ</span></h1>
              <p>SEGUIMIENTO DE TRANSPORTE PÚBLICO</p>
            </div>
          </div>
          <div className="top-right">
            <span className={`api api-${status}`}><i />{status === 'live' ? 'API EN VIVO' : status === 'connecting' ? 'CONECTANDO…' : 'API SIN CONEXIÓN'}</span>
            <span className="demo"><i />DEMO · SIMULACIÓN</span>
            <div className="clock"><small>HORA LA PAZ</small><b>{clock}</b></div>
          </div>
        </header>

        {data && (
          <>
            <aside className="col col-left">
              <Kpis snap={snap} />
              <Lines lines={data.lines} routes={data.routes} hidden={hidden} snap={snap}
                onToggle={(c) => setHidden((h) => { const n = new Set(h); if (n.has(c)) n.delete(c); else n.add(c); return n })} />
            </aside>
            <aside className="col col-right">
              <VehiclePanel detail={detail} live={live} follow={follow} onFollow={() => setFollow((f) => !f)} />
              <AlertsPanel snap={snap} onPick={goTo} />
              <Events snap={snap} />
            </aside>
            <ScenarioBar snap={snap} busy={busy} message={message} onRun={run} onHome={() => { setSelected(null); setFocusAt(null); setHomeSeq((n) => n + 1) }} />
          </>
        )}

        {jam && (
          <div className="banner banner-detected" role="alert" onClick={() => goTo(jam)}>
            <div className="banner-main">
              <Siren size={20} />
              <div>
                <b>CONGESTIÓN · {String(jam.detail.via ?? 'El Prado').toUpperCase()}</b>
                <span>{snap!.reroutes.length ? `Desvío sugerido para ${snap!.reroutes.map((r) => `${r.code} ${r.direction}`).join(', ')} dentro del Centro` : `${jam.detail.vehiculos} vehículos a ${jam.detail.velocidad_kmh} km/h en ${jam.detail.largo_m} m`}</span>
              </div>
            </div>
            <button className="banner-go" onClick={(e) => { e.stopPropagation(); goTo(jam) }}><MapPin size={14} />Ver en el mapa</button>
          </div>
        )}

        {status === 'offline' && (
          <div className="offline panel">
            <b>API de seguimiento sin conexión</b>
            <span>La vista 3D del Centro funciona, pero los vehículos y alertas vienen del servidor. Inicia <code>docker compose up -d db</code> y <code>pnpm --dir server dev</code>.</span>
            <button className="icon-btn wide" onClick={retry}><RefreshCw size={15} />Reintentar</button>
          </div>
        )}
        {data && <p className="attribution">{data.meta.attribution}</p>}
      </div>
    </div>
  )
}
