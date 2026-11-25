import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, OrbitControls, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { OrbitControls as OrbitImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { SCENE, useTheme } from '../theme'
import { STEPS } from './steps'

export interface Department { name: string; ring: [number, number][] }

// proyección local: 1 unidad = 100 km, origen en el centro de Bolivia, norte hacia -z
const LON0 = -64.7, LAT0 = -16.7, K = 1.11, COS = Math.cos((LAT0 * Math.PI) / 180)
const px = (lon: number) => (lon - LON0) * COS * K
const pn = (lat: number) => (lat - LAT0) * K
/** Altura simbólica de cada departamento: el altiplano arriba, los llanos abajo. */
const HEIGHT: Record<string, number> = {
  'La Paz': 1.2, Oruro: 1.35, 'Potosí': 1.45, Cochabamba: 0.9, Chuquisaca: 0.8, Tarija: 0.6, 'Santa Cruz': 0.35, 'El Beni': 0.25, Pando: 0.25,
}
const heightOf = (depto: string) => HEIGHT[depto] ?? 0.5
const world = (lon: number, lat: number, depto: string) => new THREE.Vector3(px(lon), heightOf(depto), -pn(lat))

const COLORS = {
  dark: { low: '#1f5677', high: '#4fb0c6', active: '#00d5ff', lake: '#1f8fd1', salt: '#e8f1f7', robot: '#eef4fa', accent: '#9D084C', eye: '#43f5b5' },
  light: { low: '#a9c98f', high: '#c9a978', active: '#9D084C', lake: '#3e9bd6', salt: '#ffffff', robot: '#ffffff', accent: '#9D084C', eye: '#00a3c4' },
} as const

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const HOP_S = 1.3, FLY_S = 1.4 // el robot llega antes que la cámara, así la tarjeta lo encuentra quieto

function Departments({ deps, active, light }: { deps: Department[]; active: string; light: boolean }) {
  const c = light ? COLORS.light : COLORS.dark
  const geos = useMemo(() => deps.map((d) => {
    // se encoge un 1,5 % hacia su centro para que se vean las juntas entre departamentos, como fichas
    const pts = d.ring.map(([lon, lat]) => new THREE.Vector2(px(lon), pn(lat)))
    const cen = pts.reduce((a, p) => a.add(p), new THREE.Vector2()).divideScalar(pts.length)
    const shape = new THREE.Shape(pts.map((p) => p.clone().sub(cen).multiplyScalar(0.985).add(cen)))
    const g = new THREE.ExtrudeGeometry(shape, { depth: heightOf(d.name), bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 })
    g.rotateX(-Math.PI / 2)
    return { name: d.name, g }
  }), [deps])
  useEffect(() => () => geos.forEach(({ g }) => g.dispose()), [geos])
  const max = Math.max(...Object.values(HEIGHT))
  return <>{geos.map(({ name, g }) => (
    <mesh key={name} geometry={g}>
      <meshStandardMaterial flatShading roughness={0.85}
        color={new THREE.Color(c.low).lerp(new THREE.Color(c.high), heightOf(name) / max)}
        emissive={name === active ? c.active : '#000000'} emissiveIntensity={name === active ? 0.22 : 0} />
    </mesh>
  ))}</>
}

/** Hitos que hacen reconocible el mapa: el lago Titicaca y el salar de Uyuni. */
function Landmarks({ light }: { light: boolean }) {
  const c = light ? COLORS.light : COLORS.dark
  return <>
    <mesh position={world(-69.15, -16.0, 'La Paz').add(new THREE.Vector3(0, 0.06, 0))} rotation-x={-Math.PI / 2} scale={[1, 1.6, 1]}>
      <circleGeometry args={[0.32, 9]} /><meshStandardMaterial color={c.lake} flatShading roughness={0.3} />
    </mesh>
    <mesh position={world(-67.6, -20.2, 'Potosí').add(new THREE.Vector3(0, 0.06, 0))} rotation-x={-Math.PI / 2} scale={[1.4, 1, 1]}>
      <circleGeometry args={[0.38, 8]} /><meshStandardMaterial color={c.salt} flatShading roughness={0.6} />
    </mesh>
  </>
}

function Station({ index, active, onPick }: { index: number; active: boolean; onPick: (i: number) => void }) {
  const s = STEPS[index]
  const pos = useMemo(() => world(...s.lonlat, s.depto).add(new THREE.Vector3(0, 0.06, 0)), [s])
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const k = active && !reduced() ? 1 + 0.35 * ((clock.elapsedTime * 1.2) % 1) : 1
    ring.current.scale.setScalar(k)
  })
  if (index === 0 || index === STEPS.length - 1) return null // la primera y la última se anclan en el robot (la última comparte lugar con «La problemática»)
  return (
    <group position={pos}>
      <mesh position-y={0.25}><coneGeometry args={[0.09, 0.5, 6]} /><meshStandardMaterial color={active ? '#9D084C' : '#7f8ea3'} flatShading /></mesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.01}><ringGeometry args={[0.16, 0.22, 16]} /><meshBasicMaterial color={active ? '#00d5ff' : '#7f8ea3'} transparent opacity={0.8} /></mesh>
      <Html position={[0, 0.65, 0]} center zIndexRange={[20, 0]}>
        <button id={`guia-st-${s.id}`} className={`guia-label ${active ? 'on' : ''}`} onClick={() => onPick(index)}>{s.place}</button>
      </Html>
    </group>
  )
}

/** Wayra: robot hecho con primitivas, que flota y salta de parada en parada. */
function Robot({ step }: { step: number }) {
  const theme = useTheme()
  const c = theme === 'light' ? COLORS.light : COLORS.dark
  const g = useRef<THREE.Group>(null), arm = useRef<THREE.Group>(null), light = useRef<THREE.MeshStandardMaterial>(null)
  const target = useMemo(() => {
    const s = STEPS[step]
    return world(...s.lonlat, s.depto).add(new THREE.Vector3(0.55, 0.35, 0.35))
  }, [step])
  const hop = useRef({ from: new THREE.Vector3(), to: null as THREE.Vector3 | null, t0: 0 })
  useFrame(({ clock }, dt) => {
    const r = g.current
    if (!r) return
    const t = clock.elapsedTime, h = hop.current
    // el salto empieza en el mismo cuadro en que cambia el destino (un useEffect llegaba tarde y a veces lo saltaba)
    if (h.to !== target) { h.from = h.to ? r.position.clone() : target.clone(); h.to = target; h.t0 = t }
    const e = reduced() ? 1 : Math.min(1, (t - h.t0) / HOP_S)
    const s = e * e * (3 - 2 * e)
    r.position.lerpVectors(h.from, target, s)
    r.position.y += Math.sin(Math.PI * s) * 1.4 * Math.min(1, h.from.distanceTo(target) / 3) // salto en arco
    if (!reduced()) r.position.y += Math.sin(t * 2.2) * 0.05
    const dir = new THREE.Vector3().subVectors(target, h.from)
    if (e < 1 && dir.lengthSq() > 1e-4) r.rotation.y = THREE.MathUtils.damp(r.rotation.y, Math.atan2(dir.x, dir.z), 6, dt)
    else r.rotation.y = THREE.MathUtils.damp(r.rotation.y, 0.6, 3, dt) // de frente a la cámara al llegar
    const wave = t - h.t0 - HOP_S // saluda 1,6 s al llegar
    if (arm.current) arm.current.rotation.z = !reduced() && e >= 1 && wave < 1.6 ? 1.9 + Math.sin(t * 9) * 0.45 : 0.3
    if (light.current) light.current.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.8
  })
  return (
    <group ref={g} scale={0.7}>
      <RoundedBox args={[0.62, 0.62, 0.5]} radius={0.12} position-y={0.45}><meshStandardMaterial color={c.robot} roughness={0.4} /></RoundedBox>
      <mesh position={[0, 0.5, 0.26]}><boxGeometry args={[0.32, 0.12, 0.02]} /><meshStandardMaterial color={c.accent} /></mesh>
      <RoundedBox args={[0.56, 0.42, 0.46]} radius={0.12} position-y={1.0}><meshStandardMaterial color={c.robot} roughness={0.4} /></RoundedBox>
      <mesh position={[0, 1.0, 0.235]}><boxGeometry args={[0.42, 0.22, 0.02]} /><meshStandardMaterial color="#0b1726" roughness={0.2} /></mesh>
      {[-0.1, 0.1].map((x) => <mesh key={x} position={[x, 1.0, 0.25]}><sphereGeometry args={[0.045, 10, 8]} /><meshStandardMaterial color={c.eye} emissive={c.eye} emissiveIntensity={1.6} /></mesh>)}
      <mesh position={[0, 1.32, 0]}><cylinderGeometry args={[0.015, 0.015, 0.22, 6]} /><meshStandardMaterial color="#7f8ea3" /></mesh>
      <mesh position={[0, 1.46, 0]}><sphereGeometry args={[0.06, 10, 8]} /><meshStandardMaterial ref={light} color={c.accent} emissive={c.accent} /></mesh>
      <group position={[-0.36, 0.62, 0]} rotation-z={-0.3}><mesh position-y={-0.16}><capsuleGeometry args={[0.06, 0.22, 4, 8]} /><meshStandardMaterial color={c.robot} /></mesh></group>
      <group ref={arm} position={[0.36, 0.62, 0]}><mesh position-y={-0.16}><capsuleGeometry args={[0.06, 0.22, 4, 8]} /><meshStandardMaterial color={c.robot} /></mesh></group>
      <mesh position-y={0.08} rotation-x={Math.PI / 2}><torusGeometry args={[0.24, 0.05, 8, 20]} /><meshStandardMaterial color={c.eye} emissive={c.eye} emissiveIntensity={0.9} /></mesh>
      {/* ancla HTML de driver.js para la primera y la última parada: una caja invisible sobre el robot */}
      <Html position={[0, 0.8, 0]} center zIndexRange={[20, 0]}>
        <span id="guia-st-robot" className="guia-robot-anchor" aria-hidden="true" />
      </Html>
    </group>
  )
}

/**
 * La cámara vuela a cada parada en FLY_S segundos (sin control del usuario mientras tanto) y avisa al llegar.
 * La tarjeta de driver.js se muestra recién entonces, con la escena quieta: así no se mueve bajo el dedo.
 */
function CameraRig({ step, onArrive }: { step: number; onArrive: (step: number) => void }) {
  const size = useThree((st) => st.size)
  const portrait = size.height > size.width
  const goal = useMemo(() => {
    const s = STEPS[step]
    const tgt = step === 0 ? new THREE.Vector3(1.1, 0.5, 0.9) : world(...s.lonlat, s.depto) // vista general: centro del recuadro de Bolivia
    const off = step === 0 ? new THREE.Vector3(0, 15, 13) : new THREE.Vector3(1.2, 5.5, 6.5)
    // en vertical el popover ocupa la parte de arriba: se apunta más al norte para que el mapa quede abajo
    if (portrait && step === 0) tgt.z -= 3
    return { tgt, pos: tgt.clone().add(off.multiplyScalar(portrait ? (step === 0 ? 2.1 : 1.45) : 1)) }
  }, [step, portrait]) // solo la orientación: la barra del navegador móvil cambia el alto sin girar
  const fly = useRef({ goal: null as typeof goal | null, t0: 0, pos: new THREE.Vector3(), tgt: new THREE.Vector3(), done: true })
  const arrive = useRef(onArrive)
  useEffect(() => { arrive.current = onArrive })
  useFrame(({ clock, camera, controls }) => {
    const c = controls as OrbitImpl | null // makeDefault la registra en el estado
    if (!c) return
    const f = fly.current, t = clock.elapsedTime
    if (f.goal !== goal) { f.goal = goal; f.t0 = t; f.pos.copy(camera.position); f.tgt.copy(c.target); f.done = false; c.enabled = false }
    if (f.done) return
    const e = reduced() ? 1 : Math.min(1, (t - f.t0) / FLY_S)
    const k = e < 0.5 ? 4 * e * e * e : 1 - (-2 * e + 2) ** 3 / 2 // easeInOutCubic
    camera.position.lerpVectors(f.pos, goal.pos, k)
    c.target.lerpVectors(f.tgt, goal.tgt, k)
    c.update()
    if (e >= 1) { f.done = true; c.enabled = true; arrive.current(step) }
  })
  return <OrbitControls makeDefault enableDamping maxPolarAngle={1.35} minDistance={3} maxDistance={40} />
}

export function GuideScene({ deps, step, onPick, onArrive }: { deps: Department[]; step: number; onPick: (i: number) => void; onArrive: (step: number) => void }) {
  const theme = useTheme()
  const light = theme === 'light'
  const sc = SCENE[theme]
  return (
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 22, 19], fov: 45, near: 0.1, far: 200 }} gl={{ antialias: true }}>
      <color attach="background" args={[sc.bg]} />
      <fog attach="fog" args={[sc.bg, 30, 70]} />
      <hemisphereLight args={[sc.hemiSky, sc.hemiGround, light ? 1.2 : 1.3]} />
      {/* ponytail: sin sombras; el relieve se lee con el sombreado plano y en móvil rinde mejor */}
      <directionalLight position={[-8, 14, 6]} intensity={light ? 1.8 : 1.7} color={sc.sun} />
      <directionalLight position={[9, 6, -8]} intensity={0.5} color={sc.rim} />
      <Departments deps={deps} active={step === 0 ? '' : STEPS[step].depto} light={light} />
      <Landmarks light={light} />
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <circleGeometry args={[14, 48]} /><meshStandardMaterial color={light ? '#dfe9f0' : '#0a1828'} roughness={1} />
      </mesh>
      {STEPS.map((_, i) => <Station key={i} index={i} active={i === step} onPick={onPick} />)}
      <Robot step={step} />
      <CameraRig step={step} onArrive={onArrive} />
    </Canvas>
  )
}
