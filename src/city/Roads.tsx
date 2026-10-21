import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DISTRICTS, ROADS, mulberry32 } from '../simulation/cityData'
import type { Incident } from '../simulation/types'
import { sim } from '../simulation/useSimulation'
import { getTheme, useTheme } from '../theme'
import { PALETTE, ROAD_GEOS, fx, reducedMotion, ribbon, type RoadGeo } from './shared'

const CYAN = new THREE.Color(PALETTE.cyan)
const GREEN = new THREE.Color(PALETTE.green)
const RED = new THREE.Color(PALETTE.red)
const AMBER = new THREE.Color(PALETTE.amber)
const idx = (id: string) => DISTRICTS.findIndex((d) => d.id === id)

/** ids de avenidas que forman la ruta alterna del incidente */
function altRoadIds(inc: Incident | null): Set<string> {
  const ids = new Set<string>()
  if (!inc) return ids
  for (let i = 0; i + 1 < inc.altRoute.length; i++) {
    const [a, b] = [inc.altRoute[i], inc.altRoute[i + 1]]
    const r = ROADS.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a))
    if (r) ids.add(r.id)
  }
  return ids
}

interface Vehicle { road: number; u: number; dir: 1 | -1; speed: number }
const VEHICLES: Vehicle[] = (() => {
  const rng = mulberry32(99)
  const v: Vehicle[] = []
  ROAD_GEOS.forEach((r, road) => {
    const n = r.kind === 'avenue' ? 9 : 4
    for (let i = 0; i < n; i++) v.push({ road, u: rng(), dir: rng() < 0.5 ? 1 : -1, speed: 3.4 + rng() * 2.4 })
  })
  return v
})()

export function Roads() {
  const light = useTheme() === 'light'
  const asphalt = useMemo(() => mergeGeometries(ROAD_GEOS.map((r) => ribbon(r.pts, 1.5, 0.02)))!, [])
  const lines = useMemo(() => ROAD_GEOS.map((r) => ribbon(r.pts, 0.17, 0.07)), [])
  const halos = useMemo(() => ROAD_GEOS.map((r) => ribbon(r.pts, 1.0, 0.05)), [])
  const lineMats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const haloMats = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const alt = useRef<{ inc: Incident | null; ids: Set<string> }>({ inc: null, ids: new Set() })
  const cars = useRef<THREE.InstancedMesh>(null)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const c = useMemo(() => new THREE.Color(), [])

  // color de cada vía a partir del color de sus distritos (mismo estado que el resto de la escena)
  const roadColor = (r: RoadGeo, out: THREE.Color) => {
    const { state } = sim.getView()
    if (state.mode === 'sensors') return out.copy(CYAN)
    return out.copy(CYAN).lerp(fx.colors[r.from], 0.7).lerp(fx.colors[r.to], 0.35)
  }

  useFrame((_, dt) => {
    const view = sim.getView()
    const inc = view.state.incident
    if (alt.current.inc !== inc) alt.current = { inc, ids: altRoadIds(inc) }
    const t = fx.time * (reducedMotion ? 0.3 : 1)
    const incIdx = inc ? idx(inc.districtId) : -1
    const onAlt = (r: RoadGeo) => alt.current.ids.has(r.id) && inc?.phase !== 'detected'

    ROAD_GEOS.forEach((r, i) => {
      const lm = lineMats.current[i], hm = haloMats.current[i]
      if (!lm || !hm) return
      roadColor(r, lm.color)
      let halo = view.state.mode === 'sensors' ? 0.08 : 0.17
      if (onAlt(r)) {
        lm.color.copy(GREEN)
        halo = 0.38 + 0.2 * Math.sin(t * 4)
      } else if (incIdx >= 0 && (r.from === incIdx || r.to === incIdx) && r.kind === 'avenue') {
        lm.color.copy(fx.colors[incIdx])
        halo = 0.3 + 0.15 * Math.sin(t * 6)
      }
      hm.color.copy(lm.color)
      hm.opacity = halo
    })

    // vehículos
    const mesh = cars.current
    if (!mesh) return
    const mode = view.state.mode
    VEHICLES.forEach((v, i) => {
      const r = ROAD_GEOS[v.road]
      const cong = (view.districts[r.from].traffic + view.districts[r.to].traffic) / 200
      const detour = onAlt(r)
      v.u += (v.dir * v.speed * (detour ? 1.1 : 1 - 0.85 * cong ** 1.3) * dt * (reducedMotion ? 0.3 : 1)) / r.length
      v.u -= Math.floor(v.u)
      const f = v.u * (r.pts.length - 1)
      const k = Math.min(r.pts.length - 2, Math.floor(f))
      const a = r.pts[k], b = r.pts[k + 1], s = f - k
      const tx = b.x - a.x, tz = b.z - a.z
      const l = Math.hypot(tx, tz) || 1
      const lane = v.dir * 0.3
      dummy.position.set(a.x + tx * s - (tz / l) * lane, a.y + (b.y - a.y) * s + 0.2, a.z + tz * s + (tx / l) * lane)
      dummy.rotation.set(0, Math.atan2(-tz, tx) + (v.dir < 0 ? Math.PI : 0), 0)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      if (detour) c.copy(GREEN)
      else if (mode === 'traffic') c.copy(GREEN).lerp(AMBER, Math.min(1, cong / 0.35)).lerp(RED, Math.min(1, Math.max(0, (cong - 0.35) / 0.25)))
      else if (mode === 'energy') c.set(getTheme() === 'light' ? '#1c7ea8' : '#cfeeff')
      else c.set(getTheme() === 'light' ? '#1b4d6b' : '#2b5f7c')
      mesh.setColorAt(i, c)
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
  })

  useLayoutEffect(() => {
    const m = cars.current!
    m.frustumCulled = false
    VEHICLES.forEach((_, i) => m.setColorAt(i, CYAN)) // crea instanceColor antes del primer render
  }, [])

  return (
    <group>
      <mesh geometry={asphalt} raycast={() => null}>
        <meshStandardMaterial color={light ? '#69778a' : '#0a1524'} roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      {ROAD_GEOS.map((r, i) => (
        <group key={r.id}>
          <mesh geometry={halos[i]} raycast={() => null}>
            <meshBasicMaterial ref={(m) => { haloMats.current[i] = m }} color={PALETTE.cyan} transparent opacity={0.17}
              blending={light ? THREE.NormalBlending : THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-3} polygonOffsetUnits={-3} />
          </mesh>
          <mesh geometry={lines[i]} raycast={() => null}>
            <meshBasicMaterial ref={(m) => { lineMats.current[i] = m }} color={PALETTE.cyan} toneMapped={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
          </mesh>
        </group>
      ))}
      <instancedMesh ref={cars} args={[undefined, undefined, VEHICLES.length]} raycast={() => null}>
        <boxGeometry args={[0.6, 0.2, 0.3]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
