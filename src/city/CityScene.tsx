import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { DISTRICTS } from '../simulation/cityData'
import { sim } from '../simulation/useSimulation'
import { Buildings } from './Buildings'
import { Districts } from './Districts'
import { Fallback } from './Fallback'
import { Roads } from './Roads'
import { SensorNodes } from './SensorNodes'
import { Terrain } from './Terrain'
import { SCENE, useTheme } from '../theme'
import { padHeight, reducedMotion, stepColors } from './shared'

const HOME_POS = new THREE.Vector3(98, 86, 72)
const HOME_TARGET = new THREE.Vector3(0, 0, -8)
const CAMERA = { position: HOME_POS.toArray(), fov: 42, near: 0.5, far: 1500 }
const GL = { antialias: true, powerPreference: 'high-performance' } as const

export function Sky({ radius = 800 }: { radius?: number }) {
  const T = SCENE[useTheme()]
  const uniforms = useMemo(() => ({ uH: { value: new THREE.Color(T.horizon) }, uZ: { value: new THREE.Color(T.zenith) } }), [T])
  return (
    <mesh raycast={() => null} renderOrder={-10}>
      <sphereGeometry args={[radius, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide} depthWrite={false} fog={false} uniforms={uniforms}
        vertexShader="varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }"
        fragmentShader="uniform vec3 uH; uniform vec3 uZ; varying vec3 vP;
          void main(){ float h = normalize(vP).y; gl_FragColor = vec4(mix(uH, uZ, smoothstep(0.0, 0.5, h)), 1.0);
          #include <colorspace_fragment>
          }"
      />
    </mesh>
  )
}

/** Avanza los colores suavizados una vez por frame, antes de que el resto de la escena los lea. */
function Stepper() {
  useFrame((_, dt) => stepColors(sim.getView(), Math.min(dt, 0.1)), -10)
  return null
}

/** Vuela hacia la zona seleccionada / vista general y aplica la órbita automática. */
function CameraRig() {
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null
  const camera = useThree((s) => s.camera)
  const get = useThree((s) => s.get)
  const seen = useRef({ sel: null as string | null, view: 0 })
  const goal = useRef<{ t: THREE.Vector3; p: THREE.Vector3 | null } | null>(null)

  useEffect(() => {
    if (!controls) return
    const cancel = () => { goal.current = null; sim.dispatch({ type: 'orbit', on: false }) }
    controls.addEventListener('start', cancel)
    return () => controls.removeEventListener('start', cancel)
  }, [controls])

  useFrame((_, dt) => {
    const ctl = get().controls as OrbitControlsImpl | null
    if (!ctl) return
    const { selectedId, viewSeq, orbit } = sim.getView().state
    if (viewSeq !== seen.current.view) goal.current = { t: HOME_TARGET, p: HOME_POS }
    else if (selectedId !== seen.current.sel && selectedId) {
      const i = DISTRICTS.findIndex((d) => d.id === selectedId)
      goal.current = { t: new THREE.Vector3(DISTRICTS[i].pos[0], padHeight(i) + 3, DISTRICTS[i].pos[1]), p: null }
    }
    seen.current = { sel: selectedId, view: viewSeq }
    ctl.autoRotate = orbit && !reducedMotion && !goal.current
    ctl.autoRotateSpeed = 0.35

    const g = goal.current
    if (!g) return
    const k = 1 - Math.exp(-dt * 3)
    const before = ctl.target.clone()
    ctl.target.lerp(g.t, k)
    camera.position.add(ctl.target.clone().sub(before)) // mantiene el ángulo de vista
    if (g.p) camera.position.lerp(g.p, k)
    else {
      const off = camera.position.clone().sub(ctl.target)
      if (off.length() > 105) camera.position.lerp(ctl.target.clone().add(off.setLength(105)), k)
    }
    if (ctl.target.distanceTo(g.t) < 0.1 && (!g.p || camera.position.distanceTo(g.p) < 0.2)) goal.current = null
  })
  return null
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('Escena 3D no disponible, usando vista alterna:', e) }
  render() { return this.state.failed ? <Fallback /> : this.props.children }
}

function hasWebGL() {
  try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false }
}

export function CityScene() {
  const theme = useTheme()
  const T = SCENE[theme], light = theme === 'light'
  if (!hasWebGL()) return <Fallback />
  return (
    <Boundary>
      <Canvas dpr={[1, 1.75]} gl={GL} camera={CAMERA}>
        <color attach="background" args={[T.bg]} />
        <fog attach="fog" args={[T.horizon, 95, 270]} />
        <hemisphereLight args={[T.hemiSky, T.hemiGround, light ? 1.05 : 0.75]} />
        <directionalLight color={T.sun} intensity={light ? 1.7 : 1.25} position={[-70, 90, 50]} />
        <directionalLight color={T.rim} intensity={light ? 0.3 : 0.35} position={[60, 30, -60]} />
        <Sky />
        {T.stars && <Stars radius={500} depth={60} count={1800} factor={5} fade speed={reducedMotion ? 0 : 0.4} />}
        <Stepper />
        <Terrain />
        <Roads />
        <Buildings />
        <Districts />
        <SensorNodes />
        <OrbitControls makeDefault enableDamping dampingFactor={0.07} target={HOME_TARGET.toArray()}
          minDistance={22} maxDistance={190} maxPolarAngle={Math.PI * 0.46} />
        <CameraRig />
      </Canvas>
    </Boundary>
  )
}
