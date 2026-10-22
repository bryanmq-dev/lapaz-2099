import { useState } from 'react'
import { Text } from '@react-three/drei'
import { PALETTE } from '../city/shared'
import type { VehicleDetail } from './CentroPanel'
import { SCENARIOS, STATE_LABEL } from './labels'
import type { LineInfo } from './data'
import type { FleetVehicle, Snapshot } from './useFleet'
import { VR } from './xr'

const TONE = { incident: PALETTE.red, warn: PALETTE.amber, recover: PALETTE.green, plain: '#3d6a94' } as const

function Label({ children, x = 0, y, size = 0.015, color = '#e6f1ff', anchor = 'center', width = 0.5 }: {
  children: string; x?: number; y: number; size?: number; color?: string; anchor?: 'left' | 'center'; width?: number
}) {
  return (
    <Text font={VR.font} position={[anchor === 'left' ? x - width / 2 : x, y, 0.003]} fontSize={size} color={color} maxWidth={width}
      anchorX={anchor} anchorY="middle" textAlign={anchor} lineHeight={1.3} raycast={() => null}>{children}</Text>
  )
}

function Button({ x, y, w, label, color, active = true, disabled, onClick }: {
  x: number; y: number; w: number; label: string; color: string; active?: boolean; disabled?: boolean; onClick: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <group position={[x, y, 0.002]}>
      <mesh onClick={disabled ? undefined : (e) => { e.stopPropagation(); onClick() }}
        onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
        <planeGeometry args={[w, 0.04]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={disabled ? 0.25 : active ? (hover ? 1 : 0.8) : 0.25} />
      </mesh>
      <Label y={0} size={0.014} width={w - 0.01}>{label}</Label>
    </group>
  )
}

/** Panel flotante a la izquierda de la maqueta: lo esencial del HUD del Centro, con el rayo del control como puntero. */
export function VrPanel({ snap, lines, hidden, onToggle, onRun, busy, message, onHome, detail, live, onRelease }: {
  snap: Snapshot | null; lines: LineInfo[]; hidden: Set<string>; onToggle: (code: string) => void
  onRun: (id: string) => void; busy: boolean; message: string; onHome: () => void
  detail: VehicleDetail | null; live: FleetVehicle | null; onRelease: () => void
}) {
  const m = snap?.metrics
  const jam = snap?.alerts.find((a) => a.kind === 'congestion')
  const jammed = (m?.congestedSegments ?? 0) > 0
  const off = busy || !snap
  const card = detail && live
    ? [`${detail.plate} · línea ${detail.code}`, `${STATE_LABEL[live.state]} · ${live.speedKmh.toFixed(0)} km/h`, `${detail.direction === 'ida' ? 'Ida' : 'Vuelta'} · ${detail.route_name}`, `Chofer: ${detail.driver} (ficticio)`].join('\n')
    : 'Apunta a un bus con el control y presiona el gatillo.'

  return (
    <group position={[-1.0, 1.25, -0.55]} rotation={[0, 0.9, 0]}>
      <mesh position={[0, -0.03, 0]} raycast={() => null}>
        <planeGeometry args={[0.56, 0.78]} />
        <meshBasicMaterial color="#07111F" toneMapped={false} transparent opacity={0.9} />
      </mesh>
      <Label y={0.325} size={0.022} color={PALETTE.cyan}>CENTRO LA PAZ · MAQUETA</Label>
      <Label y={0.285} size={0.014} color="#9dc4f8">
        {m ? `${m.active} vehículos · ${m.avgSpeedKmh.toFixed(0)} km/h · ${m.alerts} alertas` : 'Sin conexión con la API'}
      </Label>

      {jam && (
        <>
          <mesh position={[0, 0.232, 0.001]} raycast={() => null}>
            <planeGeometry args={[0.52, 0.055]} />
            <meshBasicMaterial color={PALETTE.red} toneMapped={false} transparent opacity={0.3} />
          </mesh>
          <Label y={0.232} size={0.012} width={0.5}>
            {`CONGESTIÓN · ${String(jam.detail.via ?? 'El Prado').toUpperCase()}\n${snap!.reroutes.length ? 'Desvío sugerido dentro del Centro' : `${jam.detail.vehiculos} vehículos a ${jam.detail.velocidad_kmh} km/h`}`}
          </Label>
        </>
      )}

      <Label y={0.185} size={0.011} color="#7f9bbd">ESCENARIOS</Label>
      {SCENARIOS.map(({ id, label, tone }, i) => {
        const despejar = id === 'congestion' && jammed
        return (
          <Button key={id} x={i % 2 ? 0.14 : -0.14} y={0.145 - 0.05 * Math.floor(i / 2)} w={0.26} disabled={off}
            label={despejar ? 'Despejar El Prado' : label} color={despejar ? TONE.recover : TONE[tone]} onClick={() => onRun(despejar ? 'despejar' : id)} />
        )
      })}
      <Button x={-0.14} y={0.045} w={0.26} label="Vista general" color={TONE.plain} onClick={onHome} />
      <Button x={0.14} y={0.045} w={0.26} label="Reiniciar" color={TONE.plain} disabled={off} onClick={() => onRun('reset')} />

      <Label y={-0.005} size={0.011} color="#7f9bbd">LÍNEAS</Label>
      {lines.map((l, i) => (
        <Button key={l.code} x={(i - (lines.length - 1) / 2) * 0.175} y={-0.04} w={0.165} label={`${hidden.has(l.code) ? '○' : '●'} ${l.code}`}
          color={l.color} active={!hidden.has(l.code)} onClick={() => onToggle(l.code)} />
      ))}

      <Label y={-0.095} size={0.011} color="#7f9bbd">VEHÍCULO</Label>
      <Label y={-0.165} size={0.014} anchor="left" width={0.5} x={0}>{card}</Label>
      {detail && live && <Button x={0} y={-0.25} w={0.2} label="Soltar" color={TONE.plain} onClick={onRelease} />}

      <Label y={-0.32} size={0.011} color="#9dc4f8" width={0.5}>{message || 'Escenarios simulados · alertas calculadas en PostGIS'}</Label>
      <Label y={-0.385} size={0.01} color="#7f9bbd" width={0.5}>Gatillo sobre la base: mover · con las dos manos: escalar y girar</Label>
    </group>
  )
}
