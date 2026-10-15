import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  label: string
  value: number
  decimals?: number
  unit?: string
  /** diferencia frente a la línea base sin incidente */
  delta?: number
  deltaUnit?: string
  sub?: string
  tone: 'cyan' | 'green' | 'amber' | 'red'
}

/** Cuenta suavemente hasta el valor nuevo (700 ms); un solo rAF por cambio, limpiado al desmontar. */
function useTween(target: number) {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    const from = cur.current
    const t0 = performance.now()
    let raf = 0
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 700)
      cur.current = from + (target - from) * (1 - (1 - p) ** 3)
      setV(cur.current)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

export function MetricCard({ icon: Icon, label, value, decimals = 0, unit, delta, deltaUnit = '', sub, tone }: Props) {
  const shown = useTween(value)
  return (
    <div className={`metric tone-${tone}`}>
      <div className="metric-top">
        <Icon size={14} strokeWidth={1.75} />
        <span>{label}</span>
        <em className="sim-tag">SIM</em>
      </div>
      <div className="metric-val">
        {shown.toFixed(decimals)}
        {unit && <small>{unit}</small>}
      </div>
      <div className="metric-sub">
        {delta !== undefined && delta !== 0 ? (
          <b className={delta < 0 ? 'down' : 'up'}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
            {deltaUnit}
          </b>
        ) : null}
        <span>{sub ?? (delta === 0 ? 'estable' : '')}</span>
      </div>
    </div>
  )
}
