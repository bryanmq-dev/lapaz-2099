import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { metroProjection, type CableLine } from '../../shared/metro'
import { cableLoop } from '../../shared/cableMotion'
import { makeHeight } from '../centro/data'
import { buildingsMaterial, drape, streetGeometries, terrainGeometry } from '../centro/geometry'
import { unpack, type ZoneGeometry } from '../centro/useZoneGeometry'
import { TIERS, lowerTier, type Tier } from '../centro/quality'
import { SCENE, useTheme } from '../theme'
import type { MetroData } from './data'
import type { MetroLive } from './useMetroStream'
import type { Packed } from '../centro/geoWorker'
import { cabinGeometry } from './cabinGeometry'

export interface MetroFocus { station: string | null; seq: number }
type Props = { data: MetroData; tier: Tier; selected: string | null; station: string | null; focus: MetroFocus; live: MetroLive; onSelectLine: (id: string) => void; onSelectStation: (id: string) => void; onProgress: (message: string) => void }
type Cabin = ReturnType<typeof cabinGeometry>
const STATE_COLOR = { detenido: '#ff5e63', mantenimiento: '#f4b454' } as const
const WIRE_GAP = 8 // separación lateral de cada sentido respecto al eje de la línea (igual que en cableLoop)
const dispose = (g: Record<string, THREE.BufferGeometry>) => Object.values(g).forEach((v) => v.dispose())
function useSectorGeometry(props: Props, ids: string[], light: boolean) {
  const [entries, setEntries] = useState<Record<string, ZoneGeometry>>({})
  const key = `${props.data.base}|${props.tier}|${light}`
  const wanted = useRef(ids); wanted.current = ids
  const manager = useRef<{ request: () => void } | null>(null)
  useEffect(() => {
    let disposed = false, busy = false
    const cache = new Map<string, ZoneGeometry>(), failed = new Set<string>()
    const worker = new Worker(new URL('./sectorWorker.ts', import.meta.url), { type: 'module' })
    setEntries({})
    const publish = () => { if (!disposed) setEntries(Object.fromEntries([...cache].filter(([id]) => wanted.current.includes(id)))) }
    const request = () => {
      if (disposed) return
      for (const [id, geo] of cache) if (!wanted.current.includes(id)) { cache.delete(id); dispose(geo) }
      publish()
      if (busy) return
      const id = wanted.current.find((id) => !cache.has(id) && !failed.has(id))
      if (!id) { if (!failed.size) props.onProgress('Mapa listo'); return }
      busy = true; props.onProgress(`Cargando detalle · sector ${id}`)
      worker.postMessage({ id, base: props.data.base, tier: props.tier, light, elevation: props.data.elevation })
    }
    worker.onmessage = ({ data }: MessageEvent<{ id: string; error?: string; geos: Record<string, Packed> }>) => {
      busy = false
      if (data.error) { failed.add(data.id); props.onProgress(`${data.error} · usa Reintentar mapa`) }
      else {
        const geo = Object.fromEntries(Object.entries(data.geos).map(([k, v]) => [k, unpack(v)])) as ZoneGeometry
        if (wanted.current.includes(data.id)) cache.set(data.id, geo); else dispose(geo)
      }
      request()
    }
    worker.onerror = () => { props.onProgress('Error al construir el mapa · usa Reintentar mapa'); busy = false }
    manager.current = { request }; request()
    return () => { disposed = true; worker.terminate(); for (const geo of cache.values()) dispose(geo); manager.current = null }
  // Settings are represented by key; callbacks are React setters.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => { manager.current?.request() }, [ids])
  return entries
}
function Sectors(props: Props & { light: boolean; controls: React.RefObject<any> }) {
  const { camera } = useThree()
  const [ids, setIds] = useState<string[]>([])
  const last = useRef(0)
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.6) return
    last.current = clock.elapsedTime
    const target = props.controls.current?.target ?? new THREE.Vector3()
    const distance = camera.position.distanceTo(target)
    const count = distance > 18000 ? 0 : props.tier === 'alta' ? 12 : props.tier === 'media' ? 8 : 4
    const next = props.data.manifest.sectors.map((s) => { const [x, z] = metroProjection.project(s.center); return { id: s.id, d: Math.hypot(x - target.x, z - target.z) } }).sort((a, b) => a.d - b.d).slice(0, count).map((s) => s.id).sort()
    setIds((old) => old.join() === next.join() ? old : next)
  })
  const entries = useSectorGeometry(props, ids, props.light)
  const material = useMemo(() => buildingsMaterial(props.light), [props.light])
  useEffect(() => () => material.dispose(), [material])
  return <group>{Object.entries(entries).map(([id, g]) => <group key={id}>
    <mesh geometry={g.asphalt}><meshBasicMaterial color={props.light ? '#586b77' : '#51687b'} /></mesh>
    <mesh geometry={g.minor}><meshBasicMaterial color={props.light ? '#8c969b' : '#32495d'} /></mesh>
    <mesh geometry={g.parks}><meshStandardMaterial color={props.light ? '#91b5a1' : '#193b37'} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={g.buildings} material={material} />
  </group>)}</group>
}
function Cable({ line, props, height, cabin }: { line: CableLine; props: Props; height: (x: number, z: number) => number; cabin: Cabin }) {
  const loop = useMemo(() => cableLoop(line, props.data.cable.stations), [line, props.data.cable.stations])
  const shell = useRef<THREE.InstancedMesh>(null), trim = useRef<THREE.InstancedMesh>(null)
  const dummyRef = useRef(new THREE.Object3D())
  // un cable por sentido, como en la red real: el desplazamiento es perpendicular al rumbo
  const wire = useMemo(() => {
    const points = drape(line.pts, height, 25, 15, metroProjection.project), segments: THREE.Vector3[] = []
    for (const side of [1, -1]) {
      const shifted = points.map((q, i) => {
        const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)], len = Math.hypot(b.x - a.x, b.z - a.z) || 1
        return new THREE.Vector3(q.x - (b.z - a.z) / len * WIRE_GAP * side, q.y, q.z + (b.x - a.x) / len * WIRE_GAP * side)
      })
      shifted.forEach((q, i) => { if (i) segments.push(shifted[i - 1], q) })
    }
    return new THREE.BufferGeometry().setFromPoints(segments)
  }, [line, height])
  useEffect(() => () => wire.dispose(), [wire])
  useFrame(() => {
    const dummy = dummyRef.current
    const state = props.live.current.cable?.lines.find((s) => s.id === line.id)
    const previous = props.live.current.previous?.lines.find((s) => s.id === line.id)
    let phase = state?.phaseM ?? 0
    if (state?.state === 'normal' && previous && props.live.current.connected) {
      const alpha = Math.min(1, (performance.now() - props.live.current.received) / 1000)
      phase = previous.phaseM + (state.phaseM - previous.phaseM) * alpha
    }
    for (let i = 0; i < loop.count; i++) {
      const { p, heading } = loop.at(phase + i / loop.count * loop.length)
      // la cabina avanza por +x; heading es de brújula (0 = norte, 90 = este)
      dummy.position.set(p[0], height(...p) + 25, p[1]); dummy.rotation.y = Math.PI / 2 - heading * Math.PI / 180
      dummy.updateMatrix(); shell.current?.setMatrixAt(i, dummy.matrix); trim.current?.setMatrixAt(i, dummy.matrix)
    }
    for (const m of [shell.current, trim.current]) if (m) m.instanceMatrix.needsUpdate = true
  })
  const state = props.live.current.cable?.lines.find((s) => s.id === line.id)?.state ?? 'normal'
  const pick = (e: { stopPropagation: () => void }) => { e.stopPropagation(); props.onSelectLine(line.id) }
  return <group>
    <lineSegments geometry={wire}><lineBasicMaterial color={line.color} transparent opacity={props.selected && props.selected !== line.id ? 0.25 : 1} /></lineSegments>
    <instancedMesh ref={shell} args={[cabin.shell, undefined, loop.count]} frustumCulled={false} onClick={pick}>
      <meshStandardMaterial color={state === 'normal' ? line.color : STATE_COLOR[state]} roughness={0.45} metalness={0.1} />
    </instancedMesh>
    <instancedMesh ref={trim} args={[cabin.trim, undefined, loop.count]} frustumCulled={false} onClick={pick}>
      <meshStandardMaterial vertexColors roughness={0.35} metalness={0.2} />
    </instancedMesh>
  </group>
}
// Vuelo suave hacia una estación (misma aproximación que con los vehículos: ~420 m, orientación de la vista general) o de vuelta a la ciudad.
const HOME = { target: new THREE.Vector3(0, 700, 0), camera: new THREE.Vector3(13000, 24000, 18000) }
function CameraRig({ focus, height, stations, controls }: { focus: MetroFocus; height: (x: number, z: number) => number; stations: Props['data']['cable']['stations']; controls: React.RefObject<any> }) {
  const camera = useThree((s) => s.camera), goal = useRef<{ target: THREE.Vector3; camera: THREE.Vector3 } | null>(null), seen = useRef(0)
  useEffect(() => {
    if (focus.seq === seen.current) return
    seen.current = focus.seq
    const station = stations.find((s) => s.id === focus.station)
    if (!station) { goal.current = HOME; return }
    const [x, z] = metroProjection.project(station.at), target = new THREE.Vector3(x, height(x, z) + 25, z)
    goal.current = { target, camera: target.clone().add(new THREE.Vector3(230, 260, 330)) }
  }, [focus, stations, height])
  useFrame((_, dt) => {
    const g = goal.current, c = controls.current
    if (!g || !c) return
    const k = 1 - Math.exp(-dt * 3)
    c.target.lerp(g.target, k); camera.position.lerp(g.camera, k)
    if (camera.position.distanceTo(g.camera) < 4) goal.current = null
  })
  useEffect(() => { controls.current?.target.copy(HOME.target); controls.current?.update() }, [controls])
  return <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI * 0.47} minDistance={60} maxDistance={60000} enableDamping onStart={() => { goal.current = null }} />
}
function World(props: Props) {
  const light = useTheme() === 'light', controls = useRef<any>(null)
  const height = useMemo(() => makeHeight(props.data.elevation), [props.data.elevation])
  const terrain = useMemo(() => terrainGeometry(props.data.elevation, light), [props.data.elevation, light])
  const overview = useMemo(() => streetGeometries(props.data.overview, height, metroProjection.project, 140), [props.data.overview, height])
  const cabin = useMemo(() => cabinGeometry(), [])
  useEffect(() => () => terrain.dispose(), [terrain])
  useEffect(() => () => dispose(overview), [overview])
  useEffect(() => () => { cabin.shell.dispose(); cabin.trim.dispose() }, [cabin])
  return <>
    <color attach="background" args={[SCENE[light ? 'light' : 'dark'].bg]} />
    <ambientLight intensity={1.4} /><directionalLight position={[2000, 9000, 3000]} intensity={2} />
    <mesh geometry={terrain}><meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={overview.asphalt}><meshBasicMaterial color={light ? '#4f6672' : '#7597ae'} /></mesh>
    <Sectors {...props} light={light} controls={controls} />
    {props.data.cable.lines.map((line) => <Cable key={line.id} line={line} props={props} height={height} cabin={cabin} />)}
    {props.data.cable.stations.map((s) => { const [x, z] = metroProjection.project(s.at), chosen = props.station === s.id; return <group key={s.id} position={[x, height(x, z) + 25, z]}>
      <mesh onClick={(e) => { e.stopPropagation(); props.onSelectStation(s.id) }}><cylinderGeometry args={[22, 22, 12, 12]} /><meshStandardMaterial color={chosen ? '#fff2bd' : '#b9d9e3'} /></mesh>
      <Html position={[0, 45, 0]} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}><span className={`metro-station-label${chosen ? ' chosen' : ''}`}>{s.name.split(' / ')[0]}</span></Html>
    </group> })}
    <CameraRig focus={props.focus} height={height} stations={props.data.cable.stations} controls={controls} />
    <PerformanceMonitor onDecline={lowerTier} />
  </>
}
export function MetroScene(props: Props) {
  return <Canvas camera={{ position: HOME.camera.toArray(), near: 5, far: 120000, fov: 45 }} dpr={TIERS[props.tier].dpr} gl={{ antialias: true }}><World {...props} /></Canvas>
}
