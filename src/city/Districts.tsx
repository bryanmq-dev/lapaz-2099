import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import { DISTRICTS } from '../simulation/cityData'
import type { BuildingStyle } from '../simulation/types'
import { sim } from '../simulation/useSimulation'
import { PALETTE, ROAD_GEOS, fx, padHeight, reducedMotion } from './shared'

const LABEL_H: Record<BuildingStyle, number> = { core: 25, high: 19, mid: 13, low: 10 }
const LIFT = 0.28
const BLUE = new THREE.Color('#3a8dff')
const RED = new THREE.Color(PALETTE.red)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function Districts() {
  const fills = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const edges = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const walls = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const labels = useRef<(HTMLDivElement | null)[]>([])
  const hover = useRef(-1)

  useFrame(() => {
    const view = sim.getView()
    const mode = view.state.mode
    DISTRICTS.forEach((d, i) => {
      const g = fx.glow[i]
      const col = fx.colors[i]
      const f = fills.current[i], e = edges.current[i], w = walls.current[i]
      if (f) { f.color.copy(col); f.opacity = 0.05 + g * 0.13 + (hover.current === i ? 0.1 : 0) }
      if (e) { e.color.copy(col); e.opacity = 0.55 + g * 0.45 }
      if (w) { w.color.copy(col); w.opacity = g * 0.2 }
      const el = labels.current[i]
      if (el) {
        const s = view.districts[i]
        const sel = view.state.selectedId === d.id ? '1' : '0'
        if (el.dataset.sel !== sel) el.dataset.sel = sel
        if (el.dataset.level !== s.level) el.dataset.level = s.level
        const v = mode === 'traffic' ? `${s.traffic}%` : mode === 'energy' ? `${s.loadMW} MW` : `${s.sensorsOnline}/${s.sensorsTotal}`
        const vEl = el.lastElementChild as HTMLElement
        if (vEl.textContent !== v) vEl.textContent = v
      }
    })
  })

  return (
    <group>
      {DISTRICTS.map((d, i) => {
        const y = padHeight(i) + LIFT
        return (
          <group key={d.id} position={[d.pos[0], y, d.pos[1]]}>
            <mesh rotation-x={-Math.PI / 2}
              onClick={(e) => { e.stopPropagation(); sim.dispatch({ type: 'select', id: sim.getView().state.selectedId === d.id ? null : d.id }) }}
              onPointerOver={(e) => { e.stopPropagation(); hover.current = i; document.body.style.cursor = 'pointer' }}
              onPointerOut={() => { hover.current = -1; document.body.style.cursor = '' }}>
              <circleGeometry args={[d.radius * 1.15, 56]} />
              <meshBasicMaterial ref={(m) => { fills.current[i] = m }} transparent opacity={0.05} depthWrite={false} toneMapped={false} />
            </mesh>
            <mesh rotation-x={-Math.PI / 2} raycast={() => null}>
              <ringGeometry args={[d.radius * 1.15 - 0.22, d.radius * 1.15, 72]} />
              <meshBasicMaterial ref={(m) => { edges.current[i] = m }} transparent opacity={0.6} toneMapped={false} depthWrite={false} />
            </mesh>
            <mesh position-y={1.6} raycast={() => null}>
              <cylinderGeometry args={[d.radius * 1.15, d.radius * 1.15, 3.2, 64, 1, true]} />
              <meshBasicMaterial ref={(m) => { walls.current[i] = m }} transparent opacity={0} side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
            <Html position={[0, LABEL_H[d.style], 0]} center distanceFactor={78} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
              <div className="dlabel" ref={(el) => { labels.current[i] = el }} data-level="ok" data-sel="0">
                <span>{d.name}</span>
                <i />
              </div>
            </Html>
          </group>
        )
      })}
      <IncidentFx />
    </group>
  )
}

/** Detección (ondas rojas hacia afuera), respuesta (ondas ámbar hacia adentro + unidades) y recuperación (verde). */
function IncidentFx() {
  const group = useRef<THREE.Group>(null)
  const beam = useRef<THREE.Mesh>(null)
  const rings = useRef<(THREE.Mesh | null)[]>([])
  const units = useRef<(THREE.Mesh | null)[]>([])
  const seen = useRef({ id: -1, phase: '', t0: 0 })
  const tmp = useRef(new THREE.Color())

  useFrame(() => {
    const view = sim.getView()
    const inc = view.state.incident
    const g = group.current!
    g.visible = !!inc
    if (!inc) return
    const i = DISTRICTS.findIndex((d) => d.id === inc.districtId)
    const d = DISTRICTS[i]
    const y = padHeight(i) + LIFT
    const t = fx.time * (reducedMotion ? 0.4 : 1)
    if (seen.current.id !== inc.id || seen.current.phase !== inc.phase) seen.current = { id: inc.id, phase: inc.phase, t0: fx.time }
    const col = tmp.current.copy(fx.colors[i])

    const b = beam.current!
    b.position.set(d.pos[0], y + 17, d.pos[1])
    const bm = b.material as THREE.MeshBasicMaterial
    bm.color.copy(col)
    bm.opacity = inc.phase === 'detected' ? 0.3 + 0.12 * Math.sin(t * 8) : 0.18 * clamp01(view.factor + 0.2)

    rings.current.forEach((r, j) => {
      if (!r) return
      const p = (t * (inc.phase === 'detected' ? 0.9 : 0.5) + j / 3) % 1
      const reach = d.radius * 1.5
      const s = inc.phase === 'responding' ? reach * (1 - p) : reach * p
      r.position.set(d.pos[0], y + 0.15, d.pos[1])
      r.scale.setScalar(Math.max(0.01, s))
      const m = r.material as THREE.MeshBasicMaterial
      m.color.copy(col)
      m.opacity = (inc.phase === 'responding' ? p : 1 - p) * 0.85
    })

    // unidades de respuesta: viajan por las avenidas del distrito afectado
    const arrive = Math.min(1, (fx.time - seen.current.t0) / 4)
    const mine = ROAD_GEOS.filter((r) => r.kind === 'avenue' && (r.from === i || r.to === i)).slice(0, 3)
    units.current.forEach((u, j) => {
      if (!u) return
      const r = mine[j]
      u.visible = !!r && inc.phase === 'responding'
      if (!u.visible) return
      const out = r.to === i ? r.pts : [...r.pts].reverse()
      const e = arrive * arrive * (3 - 2 * arrive)
      const k = Math.min(out.length - 1, e * (out.length - 1))
      const a = out[Math.floor(k)], c = out[Math.min(out.length - 1, Math.floor(k) + 1)], s = k - Math.floor(k)
      if (arrive < 1) u.position.set(a.x + (c.x - a.x) * s, a.y + 0.7, a.z + (c.z - a.z) * s)
      else {
        const ang = fx.time * 1.8 + j * 2.1
        u.position.set(d.pos[0] + Math.cos(ang) * 2.6, y + 0.8, d.pos[1] + Math.sin(ang) * 2.6)
      }
      ;(u.material as THREE.MeshBasicMaterial).color.copy(Math.sin(fx.time * 14 + j) > 0 ? RED : BLUE)
    })
  })

  return (
    <group ref={group} visible={false}>
      <mesh ref={beam} raycast={() => null}>
        <cylinderGeometry args={[0.7, 1.6, 34, 24, 1, true]} />
        <meshBasicMaterial transparent opacity={0.3} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {[0, 1, 2].map((j) => (
        <mesh key={j} ref={(m) => { rings.current[j] = m }} rotation-x={-Math.PI / 2} raycast={() => null}>
          <ringGeometry args={[0.93, 1, 72]} />
          <meshBasicMaterial transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
      {[0, 1, 2].map((j) => (
        <mesh key={`u${j}`} ref={(m) => { units.current[j] = m }} visible={false} raycast={() => null}>
          <sphereGeometry args={[0.5, 12, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </mesh>
      ))}
    </group>
  )
}
