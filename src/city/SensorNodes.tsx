import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { SENSORS } from '../simulation/cityData'
import type { SensorKind, SensorState } from '../simulation/types'
import { sim } from '../simulation/useSimulation'
import { PALETTE, heightAt, reducedMotion } from './shared'

const KIND_COLOR: Record<SensorKind, THREE.Color> = {
  traffic: new THREE.Color(PALETTE.cyan),
  energy: new THREE.Color(PALETTE.amber),
  air: new THREE.Color(PALETTE.green),
}
const KIND_LABEL: Record<SensorKind, string> = { traffic: 'Tráfico', energy: 'Energía', air: 'Calidad del aire' }
const STATE_LABEL: Record<SensorState, string> = { ok: 'En línea', alert: 'Alerta · flujo anómalo', offline: 'Sin señal (mantenimiento)' }
const OFFLINE = new THREE.Color('#4a5a6e')
const ALERT = new THREE.Color(PALETTE.red)
const POLE = 4.2

const BASE = SENSORS.map((s) => new THREE.Vector3(s.pos[0], heightAt(s.pos[0], s.pos[1]), s.pos[1]))

export function SensorNodes() {
  const heads = useRef<THREE.InstancedMesh>(null)
  const rings = useRef<THREE.InstancedMesh>(null)
  const poles = useRef<THREE.InstancedMesh>(null)
  const scale = useRef(SENSORS.map(() => 1))
  const [hover, setHover] = useState<number | null>(null)
  const o = useMemo(() => new THREE.Object3D(), [])
  const c = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    SENSORS.forEach((_, i) => {
      o.position.copy(BASE[i]).y += POLE / 2
      o.scale.set(1, 1, 1)
      o.updateMatrix()
      poles.current!.setMatrixAt(i, o.matrix)
      heads.current!.setColorAt(i, c.set('#fff'))
      rings.current!.setColorAt(i, c.set('#fff'))
    })
    for (const m of [heads.current!, rings.current!, poles.current!]) m.frustumCulled = false
  }, [o, c])

  useFrame((_, dt) => {
    const { state, sensors } = sim.getView()
    const t = performance.now() / 1000 * (reducedMotion ? 0.3 : 1)
    const k = 1 - Math.exp(-dt * 6)
    sensors.forEach((s, i) => {
      const emph = state.mode === 'sensors' || s.state === 'alert' || state.mode === s.kind ? 1 : 0.45
      scale.current[i] += (emph - scale.current[i]) * k
      const sc = scale.current[i] * (state.mode === 'sensors' ? 1.5 : 1.1)
      const top = BASE[i].y + POLE
      o.position.set(BASE[i].x, top, BASE[i].z)
      o.scale.setScalar(sc)
      o.updateMatrix()
      heads.current!.setMatrixAt(i, o.matrix)
      const col = s.state === 'offline' ? OFFLINE : s.state === 'alert' ? ALERT : KIND_COLOR[s.kind]
      heads.current!.setColorAt(i, c.copy(col).multiplyScalar(s.state === 'alert' ? 0.6 + 0.4 * Math.sin(t * 10) : 1))

      // anillo pulsante (solo sensores destacados y vivos)
      const live = s.state !== 'offline' && emph === 1
      const speed = s.state === 'alert' ? 1.6 : 0.6
      const p = (t * speed + (i * 0.37) % 1) % 1
      o.position.y = BASE[i].y + 0.35
      o.rotation.x = -Math.PI / 2
      o.scale.setScalar(live ? (0.6 + p * 4.2) * (state.mode === 'sensors' ? 1.2 : 0.8) : 0)
      o.updateMatrix()
      rings.current!.setMatrixAt(i, o.matrix)
      rings.current!.setColorAt(i, c.copy(col).multiplyScalar((1 - p) * 0.9))
      o.rotation.x = 0
    })
    for (const m of [heads.current!, rings.current!]) {
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
  })

  const pick = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(e.instanceId ?? null); document.body.style.cursor = 'pointer' }
  const leave = () => { setHover(null); document.body.style.cursor = '' }
  const view = sim.getView()
  const hs = hover != null ? view.sensors[hover] : null

  return (
    <group>
      <instancedMesh ref={poles} args={[undefined, undefined, SENSORS.length]} raycast={() => null}>
        <cylinderGeometry args={[0.07, 0.1, POLE, 6]} />
        <meshBasicMaterial color="#35607f" />
      </instancedMesh>
      <instancedMesh ref={heads} args={[undefined, undefined, SENSORS.length]} onPointerOver={pick} onPointerOut={leave}
        onClick={(e) => { e.stopPropagation(); sim.dispatch({ type: 'select', id: SENSORS[e.instanceId!].districtId }) }}>
        <octahedronGeometry args={[0.42, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={rings} args={[undefined, undefined, SENSORS.length]} raycast={() => null}>
        <ringGeometry args={[0.85, 1, 40]} />
        <meshBasicMaterial toneMapped={false} transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
      </instancedMesh>
      {hover != null && hs && (
        <Html position={[BASE[hover].x, BASE[hover].y + POLE + 1.4, BASE[hover].z]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="tip">
            <b>{hs.id}</b> · {KIND_LABEL[hs.kind]}
            <span className={`tip-${hs.state}`}>{STATE_LABEL[hs.state]}</span>
          </div>
        </Html>
      )}
    </group>
  )
}
