import { useMemo } from 'react'
import { CityScene } from './city/CityScene'
import { Dashboard } from './components/Dashboard'
import { useSimClock, useSimulation } from './simulation/useSimulation'
import './styles.css'

export default function App() {
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
