import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { DISTRICTS, mulberry32 } from '../simulation/cityData'
import { sim } from '../simulation/useSimulation'
import { distToRoads, fx, heightAt } from './shared'

interface B { x: number; z: number; y: number; w: number; d: number; h: number; district: number; shade: number }

const CELL = 2.6
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

function generate(): B[] {
  const rng = mulberry32(2050)
  const out: B[] = []
  for (let gx = -78; gx <= 78; gx += CELL) for (let gz = -84; gz <= 76; gz += CELL) {
    const x = gx + (rng() - 0.5) * 0.5, z = gz + (rng() - 0.5) * 0.5
    let best = -1, bw = 0, bd = 0
    DISTRICTS.forEach((d, i) => {
      const dd = Math.hypot(x - d.pos[0], z - d.pos[1])
      const w = 1 - dd / (d.radius * 1.7)
      if (w > bw) { bw = w; best = i; bd = dd }
    })
    const roll = rng(), r1 = rng(), r2 = rng(), r3 = rng()
    if (best < 0 || roll > Math.min(1, 0.3 + bw * 1.3)) continue
    if (distToRoads(x, z) < 1.4) continue
    const y0 = heightAt(x, z)
    if (Math.abs(heightAt(x + 1.2, z) - y0) + Math.abs(heightAt(x, z + 1.2) - y0) > 1.5) continue
    const d = DISTRICTS[best]
    const core = clamp(1 - bd / d.radius, 0, 1)
    const out_ = bd > d.radius ? 0.5 : 1
    let h: number
    if (d.style === 'core') h = 3 + core ** 1.4 * 17 * (0.35 + r1)
    else if (d.style === 'high') h = 2.5 + core ** 1.2 * 12 * (0.4 + r1)
    else if (d.style === 'mid') h = 2 + core * 6.5 * (0.4 + r1)
    else h = 1.1 + r1 * 2.3 + core * 1.5
    out.push({ x, z, y: y0 - 0.3, w: 1.1 + r2 * 0.95, d: 1.1 + r3 * 0.95, h: h * out_ + 0.3, district: best, shade: 0.8 + r1 * 0.35 })
  }
  return out
}

const BUILDINGS = generate()

/** Ventanas procedurales (en espacio local del edificio) + tinte según el modo. */
function makeMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: '#9fb3c8', roughness: 0.75, metalness: 0.15 })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vN; varying float vSy; varying float vSeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLocal = position * isc; vN = normal; vSy = isc.y;
        vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);`,
      )
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vN; varying float vSy; varying float vSeed;')
      .replace(
        '#include <color_fragment>',
        `float roof = step(0.5, vN.y);
        vec3 tint = vColor.rgb;
        diffuseColor.rgb *= mix(mix(vec3(0.5, 0.6, 0.72), tint, 0.3), tint * 0.9, roof);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float fy = vLocal.y + vSy * 0.5;
        float hx = abs(vN.x) > 0.5 ? vLocal.z : vLocal.x;
        vec2 g = vec2(hx / 0.62, fy / 0.7);
        vec2 cell = floor(g); vec2 f = fract(g);
        float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.7);
        float rnd = fract(sin(dot(cell + vSeed * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
        float lit = step(0.5, rnd) * step(abs(vN.y), 0.5) * step(fy, vSy - 0.35) * step(0.3, fy);
        totalEmissiveRadiance += win * lit * mix(vec3(1.0, 0.78, 0.5), vColor.rgb * 1.6, 0.55) * (0.55 + 0.6 * rnd);
        totalEmissiveRadiance += roof * vColor.rgb * 0.35;`,
      )
  }
  return m
}

export function Buildings() {
  const ref = useRef<THREE.InstancedMesh>(null)
  const material = useMemo(() => makeMaterial(), [])
  const col = useMemo(() => new THREE.Color(), [])

  useLayoutEffect(() => {
    const mesh = ref.current!
    const o = new THREE.Object3D()
    BUILDINGS.forEach((b, i) => {
      o.position.set(b.x, b.y + b.h / 2, b.z)
      o.scale.set(b.w, b.h, b.d)
      o.updateMatrix()
      mesh.setMatrixAt(i, o.matrix)
      mesh.setColorAt(i, col.set('#4f7db0'))
    })
    mesh.instanceMatrix.needsUpdate = true
    // ponytail: culling desactivado, la ciudad entera casi siempre está en cuadro
    mesh.frustumCulled = false
  }, [col])

  useFrame(() => {
    const mesh = ref.current
    if (!mesh?.instanceColor) return
    const selected = sim.getView().state.selectedId
    BUILDINGS.forEach((b, i) => {
      const id = DISTRICTS[b.district].id
      const boost = b.shade * (1 + fx.glow[b.district] * (id === selected ? 0.5 : 0.4))
      col.copy(fx.colors[b.district]).multiplyScalar(boost)
      mesh.setColorAt(i, col)
    })
    mesh.instanceColor.needsUpdate = true
  })

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, BUILDINGS.length]} material={material} raycast={() => null}>
      <boxGeometry args={[1, 1, 1]} />
    </instancedMesh>
  )
}
