import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { OrbitControls as OrbitControlsImpl } from 'three/examples/jsm/controls/OrbitControls.js'
import { PALETTE, reducedMotion, ribbon } from '../city/shared'
import { FILLER_BUS, getTheme, useTheme } from '../theme'
import { project, type LL, type LineInfo } from './data'
import { drape, type HeightFn } from './geometry'
import { fleet, vehiclePos, type FleetVehicle, type Snapshot } from './useFleet'
import { minibusGeometry, trufiGeometry } from './minibus'
import { VR } from './xr'

const MAX = 400 // ponytail: ~330 vehículos con la hora punta; subir si la flota crece
/** Exageración del tamaño de los vehículos para que se lean a escala de ciudad (el modelo está en metros reales). */
export const VEHICLE_SCALE = 2.2
// objetos auxiliares reutilizados en cada frame (sin asignaciones por frame)
const o = new THREE.Object3D()
const c = new THREE.Color()
const eye = new THREE.Vector3()
const RED = new THREE.Color(PALETTE.red), AMBER = new THREE.Color(PALETTE.amber), GREEN = new THREE.Color(PALETTE.green)
const FILLER = { dark: new THREE.Color(FILLER_BUS.dark), light: new THREE.Color(FILLER_BUS.light) } // flota simulada: se distingue de las 3 líneas reales
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0)
const list: FleetVehicle[] = [] // la flota del frame (se reutiliza: sin arrays nuevos por frame)

export function Vehicles({ height, lines, hidden, selected, onSelect, inXR = false }: {
  height: HeightFn; lines: LineInfo[]; hidden: Set<string>; selected: number | null; onSelect: (id: number | null) => void; inXR?: boolean
}) {
  const vans = useRef<THREE.InstancedMesh>(null)   // minibuses (HiAce)
  const cars = useRef<THREE.InstancedMesh>(null)   // trufis
  const beacons = useRef<THREE.InstancedMesh>(null)
  const ring = useRef<THREE.Mesh>(null)
  // id del vehículo de cada instancia, por malla (para el clic)
  const ids = useRef({ vans: [] as number[], cars: [] as number[], beacons: [] as number[] })
  const lineColor = useMemo(() => new Map(lines.map((l) => [l.code, new THREE.Color(l.color)])), [lines])
  const geo = useMemo(() => ({ van: minibusGeometry(), car: trufiGeometry() }), [])
  const camera = useThree((s) => s.camera)

  useEffect(() => () => { geo.van.dispose(); geo.car.dispose() }, [geo])
  useLayoutEffect(() => {
    for (const m of [vans.current!, cars.current!, beacons.current!]) {
      m.frustumCulled = false
      for (let i = 0; i < MAX; i++) { m.setColorAt(i, c.set('#fff')); m.setMatrixAt(i, HIDE) }
    }
  }, [])

  useFrame(() => {
    const t = performance.now() / 1000 * (reducedMotion ? 0.3 : 1)
    list.length = 0
    for (const e of fleet.cur.values()) list.push(e.v)
    beacons.current!.worldToLocal(camera.getWorldPosition(eye)) // la cámara en coordenadas de la ciudad: en la maqueta (grupo escalado) distan distinto que en el mundo
    const I = ids.current
    let nv = 0, nc = 0, nb = 0
    for (const v of list) {
      const p = !hidden.has(v.code) ? vehiclePos(v.id) : null
      if (!p) continue
      const y = height(p.x, p.z)
      const trufi = v.kind === 'trufi'
      o.position.set(p.x, y, p.z)
      o.rotation.set(0, -p.h, 0) // rumbo desde el norte (−z), sentido horario; el modelo mira a −z
      o.scale.setScalar(VEHICLE_SCALE)
      o.updateMatrix()
      const base = lineColor.get(v.code) ?? FILLER[getTheme()]
      if (v.state === 'alerta') c.copy(RED).multiplyScalar(0.55 + 0.45 * Math.sin(t * 9))
      else if (v.state === 'detenido') c.copy(AMBER)
      else if (v.state === 'desvio') c.copy(GREEN)
      else c.copy(base).multiplyScalar(v.state === 'congestion' ? 0.55 : 1)
      const mesh = trufi ? cars.current! : vans.current!
      const k = trufi ? nc++ : nv++
      mesh.setMatrixAt(k, o.matrix); mesh.setColorAt(k, c)
      ;(trufi ? I.cars : I.vans)[k] = v.id
      // marcador con tamaño ~constante en pantalla: legible tanto en la vista general como de cerca
      const small = v.sim && v.id !== selected && v.state !== 'alerta' && v.state !== 'detenido' // la flota simulada: marcador más discreto
      o.position.y = y + 1.6
      const size = Math.max(small ? 2 : 3, eye.distanceTo(o.position) * (small ? 0.0042 : 0.0065)) * (v.id === selected ? 1.6 : v.state === 'alerta' ? 1.35 : 1) * (inXR ? VR.beacon : 1)
      o.position.y = y + 8 + size * 2.2
      o.rotation.set(0, t, 0)
      o.scale.setScalar(size)
      o.updateMatrix()
      beacons.current!.setMatrixAt(nb, o.matrix); beacons.current!.setColorAt(nb, c)
      I.beacons[nb++] = v.id
    }
    // las instancias que sobran se ocultan (solo las que estaban en uso el frame anterior)
    for (const [m, n, prev] of [[vans.current!, nv, I.vans], [cars.current!, nc, I.cars], [beacons.current!, nb, I.beacons]] as const) {
      for (let i = n; i < prev.length; i++) m.setMatrixAt(i, HIDE)
      prev.length = n
      m.instanceMatrix.needsUpdate = true
      if (m.instanceColor) m.instanceColor.needsUpdate = true
    }
    const sp = selected != null ? vehiclePos(selected) : null
    ring.current!.visible = !!sp
    if (sp) {
      ring.current!.position.set(sp.x, height(sp.x, sp.z) + 0.8, sp.z)
      ring.current!.scale.setScalar(1 + 0.15 * Math.sin(t * 4))
    }
  })

  const pick = (which: 'vans' | 'cars' | 'beacons') => (e: { stopPropagation: () => void; instanceId?: number }) => {
    e.stopPropagation()
    if (e.instanceId != null) onSelect(ids.current[which][e.instanceId] ?? null)
  }
  const hover = { onPointerOver: () => (document.body.style.cursor = 'pointer'), onPointerOut: () => (document.body.style.cursor = '') }

  return (
    <group>
      <instancedMesh ref={vans} args={[geo.van, undefined, MAX]} onClick={pick('vans')} {...hover}>
        <meshLambertMaterial vertexColors toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={cars} args={[geo.car, undefined, MAX]} onClick={pick('cars')} {...hover}>
        <meshLambertMaterial vertexColors toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={beacons} args={[undefined, undefined, MAX]} onClick={pick('beacons')}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <mesh ref={ring} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[14, 17, 48]} />
        <meshBasicMaterial color={PALETTE.cyan} toneMapped={false} transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  )
}

/** Recorrido reciente del vehículo seleccionado (desde vehicle_positions). */
export function Trail({ track, height }: { track: LL[]; height: HeightFn }) {
  const pts = useMemo(() => (track.length > 1 ? drape(track, height, 3, 8).map((p) => p.toArray() as [number, number, number]) : null), [track, height])
  if (!pts) return null
  return <Line points={pts} color={PALETTE.cyan} lineWidth={3} transparent opacity={0.85} depthWrite={false} />
}

/** Cintas animadas sobre el terreno. Se monta con key = conjunto de tramos: la geometría se crea una vez por conjunto. */
function Ribbons({ lines, height, width, lift, color, speed, base }: {
  lines: LL[][]; height: HeightFn; width: number; lift: number; color: string; speed: number; base: number
}) {
  const [geo] = useState(() => mergeGeometries(lines.map((l) => ribbon(drape(l, height, lift, 5), width, 0))))
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => { if (mat.current) mat.current.opacity = base + 0.3 * Math.sin((performance.now() / 1000) * speed * (reducedMotion ? 0.3 : 1)) })
  useEffect(() => () => geo?.dispose(), [geo])
  if (!geo) return null
  return (
    <mesh geometry={geo} raycast={() => null}>
      <meshBasicMaterial ref={mat} color={color} transparent opacity={base} toneMapped={false} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-8} />
    </mesh>
  )
}

/** Tramos congestionados (rojo pulsante) y desvíos sugeridos (verde). */
export function TrafficLayers({ snap, height }: { snap: Snapshot | null; height: HeightFn }) {
  if (!snap) return null
  const congKey = snap.congestion.map((s) => s.id).join(',')
  const rerKey = snap.reroutes.map((r) => `${r.code}${r.direction}${r.extraM}`).join(',')
  return (
    <group>
      {congKey && <Ribbons key={congKey} lines={snap.congestion.map((s) => s.coords)} height={height} width={16} lift={2.6} color={PALETTE.red} speed={5} base={0.55} />}
      {rerKey && <Ribbons key={rerKey} lines={snap.reroutes.map((r) => r.coords)} height={height} width={11} lift={3.2} color={PALETTE.green} speed={3} base={0.6} />}
    </group>
  )
}

export interface Geofence { id: number; name: string; kind: 'restringida' | 'parada' | 'terminal' | 'escolar'; coords: LL[] }

/** Geocercas como volúmenes translúcidos (restringidas en rojo, escolares en ámbar). */
export function Geofences({ list, height, alerted }: { list: Geofence[]; height: HeightFn; alerted: boolean }) {
  const light = useTheme() === 'light'
  const walls = useMemo(() => {
    const build = (kind: Geofence['kind'], h: number) => {
      const pos: number[] = []
      for (const g of list.filter((x) => x.kind === kind)) {
        const ring = g.coords.map(project)
        for (let i = 1; i < ring.length; i++) {
          const [ax, az] = ring[i - 1], [bx, bz] = ring[i], ay = height(ax, az), by = height(bx, bz)
          pos.push(ax, ay, az, bx, by, bz, bx, by + h, bz, ax, ay, az, bx, by + h, bz, ax, ay + h, az)
        }
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      return geo
    }
    return { restricted: build('restringida', 30), school: build('escolar', 14) }
  }, [list, height])
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => { if (mat.current) mat.current.opacity = (alerted ? 0.3 + 0.2 * Math.sin(performance.now() / 160) : 0.22) * (light ? 1.4 : 1) })
  return (
    <group>
      <mesh geometry={walls.restricted} raycast={() => null}>
        <meshBasicMaterial ref={mat} color={PALETTE.red} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={light ? THREE.NormalBlending : THREE.AdditiveBlending} />
      </mesh>
      <mesh geometry={walls.school} raycast={() => null}>
        <meshBasicMaterial color={PALETTE.amber} transparent opacity={light ? 0.25 : 0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} blending={light ? THREE.NormalBlending : THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

/** Sigue al vehículo seleccionado y vuelve a la vista general cuando se pide. */
export function CameraRig({ selected, follow, homeSeq, focusAt, home, height }: {
  selected: number | null; follow: boolean; homeSeq: number; focusAt: { ll: LL; seq: number } | null
  home: { target: THREE.Vector3; camera: THREE.Vector3 }; height: HeightFn
}) {
  const get = useThree((s) => s.get)
  const camera = useThree((s) => s.camera)
  const goHome = useRef(false)
  const approach = useRef(false)
  const seenHome = useRef(homeSeq)
  const seenFocus = useRef(focusAt?.seq ?? 0)
  const focusGoal = useRef<{ target: THREE.Vector3; camera: THREE.Vector3 } | null>(null) // vuelo hacia una zona (p. ej. una congestión)

  useEffect(() => { approach.current = selected != null }, [selected])
  useEffect(() => { if (import.meta.env.DEV) Object.assign(globalThis, { __centro: get }) }, [get]) // depuración
  useEffect(() => {
    if (homeSeq !== seenHome.current) { seenHome.current = homeSeq; goHome.current = true; focusGoal.current = null }
  }, [homeSeq])
  useEffect(() => {
    if (!focusAt || focusAt.seq === seenFocus.current) return
    seenFocus.current = focusAt.seq
    const [x, z] = project(focusAt.ll)
    const target = new THREE.Vector3(x, height(x, z), z)
    focusGoal.current = { target, camera: target.clone().add(new THREE.Vector3(230, 260, 330)) } // ~420 m, misma orientación que la vista general
    goHome.current = false
  }, [focusAt, height])

  useFrame((_, dt) => {
    const ctl = get().controls as OrbitControlsImpl | null
    if (!ctl) return
    const k = 1 - Math.exp(-dt * 3)
    if (goHome.current) {
      ctl.target.lerp(home.target, k)
      camera.position.lerp(home.camera, k)
      if (camera.position.distanceTo(home.camera) < 5) goHome.current = false
      return
    }
    const fly = focusGoal.current
    if (fly) {
      ctl.target.lerp(fly.target, k)
      camera.position.lerp(fly.camera, k)
      if (camera.position.distanceTo(fly.camera) < 4) focusGoal.current = null
      return
    }
    if (selected == null || !follow) return
    const p = vehiclePos(selected)
    if (!p) return
    const goal = new THREE.Vector3(p.x, height(p.x, p.z), p.z)
    const before = ctl.target.clone()
    ctl.target.lerp(goal, k)
    camera.position.add(ctl.target.clone().sub(before))
    if (approach.current) {
      const off = camera.position.clone().sub(ctl.target)
      if (off.length() > 520) camera.position.lerp(ctl.target.clone().add(off.setLength(520)), k)
      else approach.current = false
    }
  })
  return null
}
