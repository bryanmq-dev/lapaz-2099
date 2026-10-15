import { Car, LocateFixed, Orbit, RotateCcw, ShieldCheck, Siren, Radio, Zap, type LucideIcon } from 'lucide-react'
import { MODE_LEGEND } from '../city/shared'
import { sim } from '../simulation/useSimulation'
import type { SimView, VisualizationMode } from '../simulation/types'

const MODES: { id: VisualizationMode; label: string; icon: LucideIcon }[] = [
  { id: 'traffic', label: 'Tráfico', icon: Car },
  { id: 'energy', label: 'Energía', icon: Zap },
  { id: 'sensors', label: 'Sensores', icon: Radio },
]

export function ControlPanel({ view }: { view: SimView }) {
  const { mode, incident, orbit } = view.state
  const legend = MODE_LEGEND[mode]
  const recovering = incident?.phase === 'recovering'
  return (
    <div className="controls panel">
      <div className="controls-row">
        <div className="seg" role="group" aria-label="Modo de visualización">
          {MODES.map(({ id, label, icon: Icon }) => (
            <button key={id} aria-pressed={mode === id} onClick={() => sim.dispatch({ type: 'mode', mode: id })}>
              <Icon size={15} strokeWidth={1.75} />
              {label}
            </button>
          ))}
        </div>

        {!incident ? (
          <button className="cta cta-incident" onClick={() => sim.dispatch({ type: 'incident' })}>
            <Siren size={17} />
            Simular incidente
          </button>
        ) : (
          <button className="cta cta-recover" disabled={recovering} onClick={() => sim.dispatch({ type: 'resolve' })}>
            <ShieldCheck size={17} />
            {recovering ? 'Recuperando…' : 'Simular recuperación'}
          </button>
        )}

        <div className="icon-group">
          <button className="icon-btn" aria-pressed={orbit} title="Órbita automática" aria-label="Órbita automática"
            onClick={() => sim.dispatch({ type: 'orbit', on: !orbit })}>
            <Orbit size={17} />
          </button>
          <button className="icon-btn" title="Vista general" aria-label="Vista general" onClick={() => sim.dispatch({ type: 'home' })}>
            <LocateFixed size={17} />
          </button>
          <button className="icon-btn" title="Restablecer simulación" aria-label="Restablecer simulación" onClick={() => sim.dispatch({ type: 'reset' })}>
            <RotateCcw size={17} />
          </button>
        </div>
      </div>

      <div className="legend">
        <span>{legend.low}</span>
        <i style={{ background: `linear-gradient(90deg, ${legend.from}, ${mode === 'sensors' ? legend.to : '#FFB547'}, ${mode === 'sensors' ? legend.to : legend.to})` }} />
        <span>{legend.high}</span>
      </div>
    </div>
  )
}
