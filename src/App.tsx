import { Suspense, lazy, useMemo } from 'react'
import { CityScene } from './city/CityScene'
import { Dashboard } from './components/Dashboard'
import { useSimClock, useSimulation } from './simulation/useSimulation'
import { useView } from './view'
import './styles.css'

// la vista detallada (three.js de las zonas, XR, worker) se descarga solo al abrir una zona
const CentroView = lazy(() => import('./centro/CentroView').then((m) => ({ default: m.CentroView })))

const MetroView = lazy(() => import('./metro/MetroView').then((m) => ({ default: m.MetroView })))

function CityView() {
  useSimClock()
  const view = useSimulation()
  // la escena 3D se crea una sola vez: lee el estado por frame y no depende de los re-renders del dashboard
  const scene = useMemo(() => <CityScene />, [])
  return (
    <div className="stage">
      {scene}
      <Dashboard view={view} />
    </div>
  )
}

export default function App() {
  const view = useView()
  return view === 'city' ? <CityView /> : (
    <Suspense fallback={<div className="loading">Cargando la vista detallada…</div>}>
      {view === 'metropolitano' ? <MetroView /> : <CentroView key={view} zone={view} />}
    </Suspense>
  )
}
