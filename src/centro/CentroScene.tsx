import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Billboard, Html, OrbitControls, PerformanceMonitor, Text } from '@react-three/drei'
import { XR, useXR } from '@react-three/xr'
import * as THREE from 'three'
import { Sky } from '../city/CityScene'
import { contourMaterial } from '../city/materials'
import { PALETTE, ribbon } from '../city/shared'
import { SCENE, useTheme } from '../theme'
import { makeHeight, project, type CentroData, type LL } from './data'
import { CameraRig, Geofences, TrafficLayers, Trail, Vehicles, type Geofence } from './FleetLayers'
import type { Snapshot } from './useFleet'
import { VrPanel } from './VrPanel'
import { ArPhonePanel, Reticle } from './ArPhone'
import { VrTable } from './VrTable'
import { VR, xrStore } from './xr'
import type { VehicleDetail } from './CentroPanel'
import { buildingsMaterial, drape, type HeightFn } from './geometry'
import { TIERS, lowerTier, useTier } from './quality'
import { useZoneGeometry } from './useZoneGeometry'


function Static({ data, height, inXR }: { data: CentroData; height: HeightFn; inXR: boolean }) {
  const light = useTheme() === 'light'
  const q = TIERS[useTier()]
  // en la maqueta los edificios bajos y sin nombre miden milímetros: se omiten para aligerar la escena
  const minH = inXR ? Math.max(VR.minBuildingH, q.minH) : q.minH
  const { geo } = useZoneGeometry(data.meta.zone, light, minH)
  const terrainMat = useMemo(() => contourMaterial({ density: 0.1, intensity: light ? 0.04 : 0.14, fadeFrom: 9000, fadeTo: 9999 }), [light])
  const buildingsMat = useMemo(() => buildingsMaterial(light, q.windows), [light, q.windows])
  if (!geo) return null

  return (
    <group>
      <mesh geometry={geo.terrain} material={terrainMat} raycast={() => null} />
      <mesh geometry={geo.parks} raycast={() => null}>
        <meshStandardMaterial color={light ? '#a6d3a0' : '#1d5a4c'} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={geo.plazas} raycast={() => null}>
        <meshStandardMaterial color={light ? '#ddd8c8' : '#2c4462'} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} />
      </mesh>
      <mesh geometry={geo.asphalt} raycast={() => null}>
        <meshStandardMaterial color={light ? '#6f7b8a' : '#0a1524'} roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={geo.minor} raycast={() => null}>
        <meshStandardMaterial color={light ? '#a3adb8' : '#1b2b40'} roughness={0.9} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      <mesh geometry={geo.glow} raycast={() => null}>
        <meshBasicMaterial color={light ? '#fbf8ec' : PALETTE.cyan} transparent opacity={light ? 0.8 : 0.55} toneMapped={false} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>
      <mesh geometry={geo.buildings} material={buildingsMat} raycast={() => null} />
      {data.landmarks.slice(0, inXR ? 99 : q.labels).map((l) => {
        const [x, z] = project(l.at)
        const at: [number, number, number] = [x, height(x, z) + 55, z]
        return inXR ? ( // <Html> es DOM y no se ve dentro del visor
          <Billboard key={l.label} position={at}>
            <Text font={VR.font} fontSize={60} color={light ? '#10233a' : '#e6f1ff'} outlineWidth={6} outlineColor={light ? '#ffffff' : '#07111F'} raycast={() => null}>{l.label}</Text>
          </Billboard>
        ) : (
          <Html key={l.label} position={at} center distanceFactor={900} zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
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
  // panel dentro del visor (VR/MR)
  detail: VehicleDetail | null; onToggleLine: (code: string) => void; onRun: (id: string) => void; busy: boolean; message: string
}

function Content({ data, snap, selected, onSelect, hidden, follow, homeSeq, focusAt, track, geofences, detail, onToggleLine, onRun, busy, message }: SceneProps) {
  const theme = useTheme()
  const T = SCENE[theme], light = theme === 'light'
  const mode = useXR((s) => s.mode)
  const inXR = mode != null
  // teléfono o tableta (Android): la sesión se maneja tocando la pantalla, no con controles en el espacio
  const phone = useXR((s) => (s.session as (XRSession & { interactionMode?: string }) | undefined)?.interactionMode === 'screen-space')
  const hit = useRef<THREE.Vector3 | null>(null)
  const [canPlace, setCanPlace] = useState(false)
  const [placed, setPlaced] = useState<[number, number, number] | null>(null)
  const get = useThree((s) => s.get)
  const [resetSeq, setResetSeq] = useState(0)
  const height = useMemo(() => makeHeight(data.elevation), [data.elevation])
  const home = useMemo(() => {
    const { bbox } = data.meta
    const [x, z] = project([(bbox.w + bbox.e) / 2, (bbox.s + bbox.n) / 2]) // centro del recuadro de la zona
    const t = new THREE.Vector3(x, height(x, z), z)
    return { target: t, camera: t.clone().add(new THREE.Vector3(1100, 1250, 1600)) }
  }, [height, data.meta])
  // la maqueta se centra en el punto medio del modelo y la base se ajusta a su recuadro
  const table = useMemo(() => {
    const { x0, z0, step, w, h } = data.elevation
    return { center: new THREE.Vector3(x0 + (w * step) / 2, 0, z0 + (h * step) / 2), size: [w * step, h * step] as [number, number] }
  }, [data.elevation])
  const focus = selected != null ? snap?.vehicles.find((v) => v.id === selected)?.code ?? null : null
  const fenceAlert = !!snap?.alerts.some((a) => a.kind === 'geocerca')
  const live = selected != null ? snap?.vehicles.find((v) => v.id === selected) ?? null : null

  // en la maqueta (~0.8 m) el plano cercano de 2 m la cortaría; al salir se devuelve la vista general (el visor deja la cámara donde estaba la cabeza)
  useEffect(() => {
    const camera = get().camera as THREE.PerspectiveCamera
    camera.near = inXR ? 0.02 : 2
    camera.far = inXR ? 50 : 30000
    if (!inXR) { camera.position.copy(home.camera); camera.up.set(0, 1, 0); camera.lookAt(home.target) }
    camera.updateProjectionMatrix()
  }, [inXR, get, home])

  const world = (
    <>
      <Static data={data} height={height} inXR={inXR} />
      <Routes data={data} height={height} hidden={hidden} focus={focus} />
      <Geofences list={geofences} height={height} alerted={fenceAlert} />
      <TrafficLayers snap={snap} height={height} />
      <Vehicles height={height} lines={data.lines} hidden={hidden} selected={selected} onSelect={onSelect} inXR={inXR} />
      {selected != null && <Trail track={track} height={height} />}
    </>
  )

  return (
    <>
      {mode !== 'immersive-ar' && <color attach="background" args={[T.bg]} />}
      {!inXR && <fog attach="fog" args={[T.horizon, 2600, 9000]} />}
      <hemisphereLight args={[T.hemiSky, T.hemiGround, light ? 1.1 : 0.8]} />
      <directionalLight color={T.sun} intensity={light ? 1.8 : 1.3} position={[-900, 1400, 700]} />
      <directionalLight color={T.rim} intensity={light ? 0.3 : 0.3} position={[800, 400, -900]} />
      {inXR && phone ? (
        <>
          {!placed && <Reticle onHit={(p) => { hit.current = p && p.clone(); if (!!p !== canPlace) setCanPlace(!!p) }} />}
          {placed && <VrTable center={table.center} size={table.size} resetSeq={resetSeq} at={placed} scale={VR.scale * VR.phoneScale}>{world}</VrTable>}
          <ArPhonePanel placed={!!placed} canPlace={canPlace} onPlace={() => hit.current && setPlaced(hit.current.toArray())} onReplace={() => { setPlaced(null); setCanPlace(false) }}
            hotspot={data.meta.hotspot?.name ?? ''} snap={snap} busy={busy} message={message} onRun={onRun}
            lines={data.lines} hidden={hidden} onToggle={onToggleLine} detail={detail} live={live} onRelease={() => onSelect(null)} />
        </>
      ) : inXR ? (
        <>
          <VrTable center={table.center} size={table.size} resetSeq={resetSeq}>{world}</VrTable>
          <VrPanel hotspot={data.meta.hotspot?.name ?? ''} zoneName={data.meta.name ?? ''} snap={snap} lines={data.lines} hidden={hidden} onToggle={onToggleLine} onRun={onRun} busy={busy} message={message}
            onHome={() => setResetSeq((n) => n + 1)} detail={detail} live={live} onRelease={() => onSelect(null)} />
        </>
      ) : (
        <>
          <Sky radius={20000} />
          {world}
          <OrbitControls makeDefault enableDamping dampingFactor={0.08} target={home.target.toArray()}
            minDistance={60} maxDistance={6000} maxPolarAngle={Math.PI * 0.47} />
          <CameraRig selected={selected} follow={follow} homeSeq={homeSeq} focusAt={focusAt} home={home} height={height} />
        </>
      )}
    </>
  )
}

export function CentroScene(props: SceneProps) {
  const tier = useTier()
  // el antialias y la preferencia de GPU se fijan al crear el contexto: se toman del nivel inicial
  const [gl] = useState(() => ({ antialias: TIERS[tier].antialias, powerPreference: tier === 'alta' ? 'high-performance' as const : 'default' as const }))
  return (
    // la posición inicial la fija Content al montar (necesita la altura del terreno)
    <Canvas dpr={[1, TIERS[tier].dpr]} gl={gl} camera={{ position: [1100, 1250, 1600], fov: 42, near: 2, far: 30000 }}
      onPointerMissed={(e) => e.type === 'click' && props.onSelect(null)}>
      {/* si los FPS caen de forma sostenida, baja el nivel de calidad (resolución, edificios, ventanas, rótulos) */}
      <PerformanceMonitor onDecline={lowerTier} flipflops={2} />
      <XR store={xrStore}>
        <Content {...props} />
      </XR>
    </Canvas>
  )
}
