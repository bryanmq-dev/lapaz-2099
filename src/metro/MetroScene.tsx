import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { metroProjection, type CableLine, type TransportMode } from '../../shared/metro'
import { cableLoop } from '../../shared/cableMotion'
import { makeHeight } from '../centro/data'
import { buildingsMaterial, drape, streetGeometries, terrainGeometry } from '../centro/geometry'
import { unpack, type ZoneGeometry } from '../centro/useZoneGeometry'
import { TIERS, lowerTier, type Tier } from '../centro/quality'
import { SCENE, useTheme } from '../theme'
import type { MetroData } from './data'
import type { MetroLive } from './useMetroStream'
import type { Packed } from '../centro/geoWorker'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ribbon } from '../city/shared'

type Props = { data: MetroData; mode: TransportMode; tier: Tier; selected: string | null; focus: number; live: MetroLive; onSelect: (id: string) => void; onProgress: (message: string) => void }
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
function Cable({ line, props, height }: { line: CableLine; props: Props; height: (x: number, z: number) => number }) {
  const loop = useMemo(() => cableLoop(line, props.data.cable.stations), [line, props.data.cable.stations])
  const mesh = useRef<THREE.InstancedMesh>(null)
  const dummyRef = useRef(new THREE.Object3D())
  const wire = useMemo(() => { const points = drape(line.pts, height, 25, 15, metroProjection.project); return new THREE.BufferGeometry().setFromPoints(points.flatMap((p, i) => i ? [points[i - 1], p] : [])) }, [line, height])
  const cabin = useMemo(() => {
    const body = new THREE.BoxGeometry(12, 8, 14).translate(0, -4, 0), roof = new THREE.BoxGeometry(14, 2, 16).translate(0, 7, 0), hanger = new THREE.BoxGeometry(2, 8, 2).translate(0, 12, 0)
    const g = mergeGeometries([body, roof, hanger])!; body.dispose(); roof.dispose(); hanger.dispose(); return g
  }, [])
  useEffect(() => () => cabin.dispose(), [cabin])
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
      dummy.position.set(p[0], height(...p) + 22, p[1]); dummy.rotation.y = -heading * Math.PI / 180
      dummy.updateMatrix(); mesh.current?.setMatrixAt(i, dummy.matrix)
    }
    if (mesh.current) mesh.current.instanceMatrix.needsUpdate = true
  })
  const state = props.live.current.cable?.lines.find((s) => s.id === line.id)?.state
  return <group>
    <lineSegments geometry={wire}><lineBasicMaterial color={line.color} transparent opacity={props.selected && props.selected !== line.id ? 0.25 : 1} /></lineSegments>
    <instancedMesh ref={mesh} args={[cabin, undefined, loop.count]} frustumCulled={false} onClick={(e) => { e.stopPropagation(); props.onSelect(line.id) }}>
      <meshStandardMaterial color={state === 'detenido' ? '#ff5e63' : state === 'mantenimiento' ? '#f4b454' : line.color} emissive={line.color} emissiveIntensity={0.25} />
    </instancedMesh>
  </group>
}
function Buses({ props, height }: { props: Props; height: (x: number, z: number) => number }) {
  const mesh = useRef<THREE.InstancedMesh>(null), dummyRef = useRef(new THREE.Object3D())
  useFrame(() => {
    const dummy = dummyRef.current
    if (!mesh.current) return
    const state = props.live.current, vehicles = state.bus?.vehicles ?? [], previous = new Map(state.previousBus?.vehicles.map((v) => [v.id, v]) ?? [])
    const alpha = Math.min(1, (performance.now() - state.received) / 1000)
    mesh.current.count = Math.min(2000, vehicles.length)
    for (let i = 0; i < mesh.current.count; i++) {
      const v = vehicles[i], old = previous.get(v.id), p = metroProjection.project([v.lon, v.lat]), before = old ? metroProjection.project([old.lon, old.lat]) : p
      const interpolate = Math.hypot(p[0] - before[0], p[1] - before[1]) < 80 && state.connected
      const x = interpolate ? before[0] + (p[0] - before[0]) * alpha : p[0], z = interpolate ? before[1] + (p[1] - before[1]) * alpha : p[1]
      dummy.position.set(x, height(x, z) + 7, z); dummy.rotation.y = -v.heading * Math.PI / 180; dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      mesh.current.setColorAt(i, new THREE.Color(v.state === 'normal' ? '#80cfe7' : '#f3a75c'))
    }
    mesh.current.instanceMatrix.needsUpdate = true; if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true
  })
  const routes = useMemo(() => {
    const selected = props.data.routes.find((r) => r.code === props.selected)
    const list = selected ? [selected] : props.data.routes.slice(0, 24)
    return list.map((r) => ribbon(drape(r.pts, height, 4, 30, metroProjection.project), selected ? 10 : 4, 0))
  }, [props.data.routes, props.selected, height])
  const congestionData = props.live.current.bus?.congestion
  const congestion = useMemo(() => (congestionData ?? []).map((s) => ribbon(drape(s.coords, height, 6, 30, metroProjection.project), 15, 0)), [congestionData, height])
  useEffect(() => () => routes.forEach((g) => g.dispose()), [routes])
  useEffect(() => () => congestion.forEach((g) => g.dispose()), [congestion])
  return <group>
    {routes.map((g, i) => <mesh key={i} geometry={g}><meshBasicMaterial color="#34bcd5" transparent opacity={0.7} side={THREE.DoubleSide} /></mesh>)}
    {congestion.map((g, i) => <mesh key={i} geometry={g}><meshBasicMaterial color="#ff804e" side={THREE.DoubleSide} /></mesh>)}
    <instancedMesh ref={mesh} args={[undefined, undefined, 2000]} frustumCulled={false} onClick={(e) => { const v = props.live.current.bus?.vehicles[e.instanceId ?? -1]; if (v) props.onSelect(v.code) }}>
      <boxGeometry args={[8, 10, 18]} /><meshStandardMaterial />
    </instancedMesh>
  </group>
}
function World(props: Props) {
  const light = useTheme() === 'light', controls = useRef<any>(null)
  const { camera } = useThree()
  const height = useMemo(() => makeHeight(props.data.elevation), [props.data.elevation])
  const terrain = useMemo(() => terrainGeometry(props.data.elevation, light), [props.data.elevation, light])
  const overview = useMemo(() => streetGeometries(props.data.overview, height, metroProjection.project, 90), [props.data.overview, height])
  useEffect(() => () => terrain.dispose(), [terrain])
  useEffect(() => () => dispose(overview), [overview])
  useEffect(() => {
    let pts = props.mode === 'telefericos' ? props.data.cable.lines.find((l) => l.id === props.selected)?.pts : props.data.routes.find((r) => r.code === props.selected)?.pts
    if (!pts?.length) { camera.position.set(13000, 24000, 18000); controls.current?.target.set(0, 700, 0) }
    else {
      const points = pts.map(metroProjection.project), bounds = new THREE.Box3().setFromPoints(points.map(([x, z]) => new THREE.Vector3(x, height(x, z), z))), center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3())
      const distance = Math.max(1200, size.x, size.z) * 1.3
      controls.current?.target.copy(center); camera.position.copy(center).add(new THREE.Vector3(distance * 0.25, distance, distance * 0.7))
    }
    controls.current?.update()
  }, [props.focus, camera, props.mode, props.selected, props.data.routes, props.data.cable.lines, height])
  return <>
    <color attach="background" args={[SCENE[light ? 'light' : 'dark'].bg]} />
    <ambientLight intensity={1.4} /><directionalLight position={[2000, 9000, 3000]} intensity={2} />
    <mesh geometry={terrain}><meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={overview.asphalt}><meshBasicMaterial color={light ? '#687e88' : '#59758b'} /></mesh>
    <Sectors {...props} light={light} controls={controls} />
    {props.mode === 'telefericos' ? <>
      {props.data.cable.lines.map((line) => <Cable key={line.id} line={line} props={props} height={height} />)}
      {props.data.cable.stations.map((s) => { const [x, z] = metroProjection.project(s.at), chosen = props.selected && s.lines.includes(props.selected); return <group key={s.id} position={[x, height(x, z) + 25, z]}>
        <mesh onClick={(e) => { e.stopPropagation(); props.onSelect(s.lines[0]) }}><cylinderGeometry args={[22, 22, 12, 12]} /><meshStandardMaterial color={chosen ? '#fff2bd' : '#b9d9e3'} /></mesh>
        {chosen && <Html position={[0, 45, 0]} center style={{ pointerEvents: 'none' }}><span className="metro-station-label">{s.name}</span></Html>}
      </group> })}
    </> : <Buses props={props} height={height} />}
    <OrbitControls ref={controls} makeDefault maxPolarAngle={Math.PI * 0.47} minDistance={100} maxDistance={60000} enableDamping />
    <PerformanceMonitor onDecline={lowerTier} />
  </>
}
export function MetroScene(props: Props) {
  return <Canvas camera={{ position: [13000, 24000, 18000], near: 5, far: 120000, fov: 45 }} dpr={TIERS[props.tier].dpr} gl={{ antialias: true }}><World {...props} /></Canvas>
}
