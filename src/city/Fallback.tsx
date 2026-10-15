import { DISTRICTS, ROADS, districtById } from '../simulation/cityData'
import { sim, useSimulation } from '../simulation/useSimulation'

const COLOR = { ok: '#43F5B5', info: '#00D5FF', warn: '#FFB547', critical: '#FF5470' }

/** Esquema 2D del gemelo digital cuando WebGL no está disponible. Usa el mismo estado de simulación. */
export function Fallback() {
  const v = useSimulation()
  return (
    <div className="fallback" role="img" aria-label="Esquema 2D de la ciudad (la escena 3D no está disponible)">
      <svg viewBox="-60 -80 120 150" preserveAspectRatio="xMidYMid meet">
        {ROADS.map((r) => {
          const [a, b] = [districtById(r.from).pos, districtById(r.to).pos]
          return <line key={r.id} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#00D5FF" strokeOpacity={0.35} strokeWidth={0.6} />
        })}
        {DISTRICTS.map((d, i) => (
          <g key={d.id} onClick={() => sim.dispatch({ type: 'select', id: d.id })} style={{ cursor: 'pointer' }}>
            <circle cx={d.pos[0]} cy={d.pos[1]} r={d.radius} fill={COLOR[v.districts[i].level]} fillOpacity={v.state.selectedId === d.id ? 0.35 : 0.15} stroke={COLOR[v.districts[i].level]} strokeWidth={0.6} />
            <text x={d.pos[0]} y={d.pos[1] + 1} textAnchor="middle" fontSize={3.2} fill="#e8f1fa">{d.name}</text>
          </g>
        ))}
      </svg>
      <p>Vista 2D alterna · la escena 3D requiere WebGL</p>
    </div>
  )
}
