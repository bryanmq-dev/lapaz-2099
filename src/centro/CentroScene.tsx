import { useMemo } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { Sky } from '../city/CityScene'
import { contourMaterial } from '../city/materials'
import { PALETTE, ribbon } from '../city/shared'
import { SCENE, useTheme } from '../theme'
import { makeHeight, project, type CentroData, type LL } from './data'
import { CameraRig, Geofences, TrafficLayers, Trail, Vehicles, type Geofence } from './FleetLayers'
import type { Snapshot } from './useFleet'
import { areasGeometry, buildingsGeometry, buildingsMaterial, drape, streetGeometries, terrainGeometry, type HeightFn } from './geometry'

const GL = { antialias: true, powerPreference: 'high-performance' } as const

function Static({ data, height }: { data: CentroData; height: HeightFn }) {
  const { elevation: el } = data
  const light = useTheme() === 'light'
  const terrain = useMemo(() => terrainGeometry(el, light), [el, light])
  const terrainMat = useMemo(() => contourMaterial({ density: 0.1, intensity: light ? 0.04 : 0.14, fadeFrom: 9000, fadeTo: 9999 }), [light])
  const buildings = useMemo(() => buildingsGeometry(data.buildings, el.min, light), [data.buildings, el.min, light])
  const buildingsMat = useMemo(() => buildingsMaterial(light), [light])
  const streets = useMemo(() => streetGeometries(data.streets, height), [data.streets, height])
  const parks = useMemo(() => areasGeometry(data.areas, height, (a) => /park|garden|grass|pitch|playground|recreation/.test(a.k)), [data.areas, height])
  const plazas = useMemo(() => areasGeometry(data.areas, height, (a) => /square|pedestrian/.test(a.k)), [data.areas, height])

  return (
    <group>
      <mesh geometry={terrain} material={terrainMat} raycast={() => null} />
      <mesh geometry={parks} raycast={() => null}>
        <meshStandardMaterial color={light ? '#a6d3a0' : '#1d5a4c'} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={plazas} raycast={() => null}>
        <meshStandardMaterial color={light ? '#ddd8c8' : '#2c4462'} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={streets.asphalt} raycast={() => null}>
        <meshStandardMaterial color={light ? '#6f7b8a' : '#0a1524'} roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={streets.minor} raycast={() => null}>
        <meshStandardMaterial color={light ? '#a3adb8' : '#1b2b40'} roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={streets.glow} raycast={() => null}>
        <meshBasicMaterial color={light ? '#fbf8ec' : PALETTE.cyan} transparent opacity={light ? 0.8 : 0.55} toneMapped={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>
      <mesh geometry={buildings} material={buildingsMat} raycast={() => null} />
      {data.landmarks.map((l) => {
        const [x, z] = project(l.at)
        return (
          <Html key={l.label} position={[x, height(x, z) + 55, z]} center distanceFactor={900} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
            <div className="dlabel landmark"><span>{l.label}</span></div>
          </Html>
        )
      })}
    </group>
  )
}

function Routes({ data, height, hidden, focus }: { data: CentroData; height: HeightFn; hidden: Set<string>; focus: string | null }) {
  const lines = useMemo(() => data.routes.map((r) => ({
    r, color: data.lines.find((l) => l.code === r.code)?.color ?? PALETTE.cyan,
    geo: ribbon(drape(r.pts, height, 2.2, 4), r.direction === 'ida' ? 9 : 6, 0),
  })), [data, height])
  return (
    <group>
      {lines.filter(({ r }) => !hidden.has(r.code)).map(({ r, color, geo }) => (
        <mesh key={`${r.code}-${r.direction}`} geometry={geo} raycast={() => null}>
          <meshBasicMaterial color={color} transparent opacity={(r.direction === 'ida' ? 0.9 : 0.6) * (focus && focus !== r.code ? 0.25 : 1)} toneMapped={false}
            side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
        </mesh>
      ))}
    </group>
  )
}

export interface SceneProps {
  data: CentroData; snap: Snapshot | null; selected: number | null; onSelect: (id: number | null) => void
  hidden: Set<string>; follow: boolean; homeSeq: number; focusAt: { ll: LL; seq: number } | null; track: LL[]; geofences: Geofence[]
}

export function CentroScene({ data, snap, selected, onSelect, hidden, follow, homeSeq, focusAt, track, geofences }: SceneProps) {
  const theme = useTheme()
  const T = SCENE[theme], light = theme === 'light'
  const height = useMemo(() => makeHeight(data.elevation), [data.elevation])
  const home = useMemo(() => {
    const [x, z] = project([-68.1365, -16.4995]) // centro del recuadro (Prado / Casco Viejo)
    const t = new THREE.Vector3(x, height(x, z), z)
    return { target: t, camera: t.clone().add(new THREE.Vector3(1100, 1250, 1600)) }
  }, [height])
  const focus = selected != null ? snap?.vehicles.find((v) => v.id === selected)?.code ?? null : null
  const fenceAlert = !!snap?.alerts.some((a) => a.kind === 'geocerca')

  return (
    <Canvas dpr={[1, 1.75]} gl={GL} camera={{ position: home.camera.toArray(), fov: 42, near: 2, far: 30000 }}
      onPointerMissed={(e) => e.type === 'click' && onSelect(null)}>
      <color attach="background" args={[T.bg]} />
      <fog attach="fog" args={[T.horizon, 2600, 9000]} />
      <hemisphereLight args={[T.hemiSky, T.hemiGround, light ? 1.1 : 0.8]} />
      <directionalLight color={T.sun} intensity={light ? 1.8 : 1.3} position={[-900, 1400, 700]} />
      <directionalLight color={T.rim} intensity={light ? 0.3 : 0.3} position={[800, 400, -900]} />
      <Sky radius={20000} />
      <Static data={data} height={height} />
      <Routes data={data} height={height} hidden={hidden} focus={focus} />
      <Geofences list={geofences} height={height} alerted={fenceAlert} />
      <TrafficLayers snap={snap} height={height} />
      <Vehicles height={height} lines={data.lines} hidden={hidden} selected={selected} onSelect={onSelect} />
      {selected != null && <Trail track={track} height={height} />}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={home.target.toArray()}
        minDistance={60} maxDistance={6000} maxPolarAngle={Math.PI * 0.47} />
      <CameraRig selected={selected} follow={follow} homeSeq={homeSeq} focusAt={focusAt} home={home} height={height} />
    </Canvas>
  )
}
