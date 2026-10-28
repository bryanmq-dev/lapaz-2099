import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/**
 * Modelos low-poly propios de los vehículos (en metros, la trompa hacia −z, las ruedas sobre y = 0).
 * Minibús: Toyota HiAce H200 de techo alto, la van más común en las líneas de La Paz. Medidas de la ficha técnica de
 * Toyota: largo 5,38 m, ancho 1,88 m, alto 2,285 m, distancia entre ejes 3,11 m, llanta 195/80 R15 (Ø ≈ 0,69 m).
 * Trufi: automóvil tipo station wagon (≈ 4,3 × 1,7 × 1,5 m).
 * La carrocería va en blanco: el color de instancia (línea o estado) la tiñe; vidrios, llantas y parachoques son oscuros
 * y siguen oscuros al multiplicarse por cualquier color. Sin texturas ni shaders propios.
 */

interface Spec {
  L: number; W: number
  profile: [number, number][] // silueta lateral (z, y), de la trompa a la cola
  windows: { y0: number; y1: number; z: [number, number][] } // banda de ventanas laterales: tramos [z0, z1]
  windshield: [[number, number], [number, number]] // borde inferior y superior del parabrisas (z, y)
  rear: [number, number] // ventana trasera: y0, y1
  wheel: { r: number; axles: [number, number] }
  lights: { y: number; h: number }
}

const HIACE: Spec = {
  L: 5.38, W: 1.88,
  profile: [[-2.69, 0.32], [-2.69, 0.78], [-2.56, 1.06], [-2.3, 1.12], [-1.72, 2.05], [-1.55, 2.285], [2.6, 2.285], [2.69, 2.17], [2.69, 0.32]],
  windows: { y0: 1.28, y1: 1.98, z: [[-1.5, -0.62], [-0.5, 0.55], [0.67, 1.62], [1.74, 2.5]] },
  windshield: [[-2.27, 1.16], [-1.76, 2.0]],
  rear: [1.3, 2.0],
  wheel: { r: 0.345, axles: [-1.71, 1.4] },
  lights: { y: 0.86, h: 0.16 },
}

const WAGON: Spec = {
  L: 4.3, W: 1.7,
  profile: [[-2.15, 0.3], [-2.15, 0.72], [-1.35, 0.86], [-0.75, 1.42], [1.55, 1.47], [2.1, 1.02], [2.15, 0.72], [2.15, 0.3]],
  windows: { y0: 0.98, y1: 1.36, z: [[-0.62, 0.38], [0.48, 1.5]] },
  windshield: [[-1.3, 0.9], [-0.8, 1.38]],
  rear: [0.95, 1.38],
  wheel: { r: 0.3, axles: [-1.35, 1.28] },
  lights: { y: 0.7, h: 0.1 },
}

const WHITE = new THREE.Color('#ffffff'), GLASS = new THREE.Color('#1c2733'), TIRE = new THREE.Color('#111418')
const TRIM = new THREE.Color('#3a4048'), HEAD = new THREE.Color('#fff4d0'), TAIL = new THREE.Color('#d0202a')

/** Geometría lista para fusionar: sin índices ni UV, con color por vértice. */
function paint(g: THREE.BufferGeometry, color: THREE.Color) {
  const out = g.index ? g.toNonIndexed() : g
  out.deleteAttribute('uv')
  const n = out.getAttribute('position').count, col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3)
  out.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return out
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color) =>
  paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), color)

/** Cuadrilátero entre dos puntos de la silueta (z, y), de lado a lado (para parabrisas y ventana trasera). */
function pane(a: [number, number], b: [number, number], halfW: number, out: number) {
  const g = new THREE.BufferGeometry()
  const [za, ya] = a, [zb, yb] = b
  // se adelanta `out` m por la normal hacia afuera de la pendiente (adelante y arriba) para no pelear con la carrocería
  const dz = zb - za, dy = yb - ya, L = Math.hypot(dz, dy)
  const oz = (-dy / L) * out, oy = (dz / L) * out
  const p = [
    // orden antihorario visto desde afuera (adelante): si no, la cara se descarta
    -halfW, ya + oy, za + oz, halfW, yb + oy, zb + oz, halfW, ya + oy, za + oz,
    -halfW, ya + oy, za + oz, -halfW, yb + oy, zb + oz, halfW, yb + oy, zb + oz,
  ]
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3))
  g.computeVertexNormals()
  return g
}

function build(s: Spec) {
  const parts: THREE.BufferGeometry[] = []
  const hw = s.W / 2

  // carrocería: silueta lateral extruida a lo ancho, con un bisel pequeño para redondear las aristas
  const shape = new THREE.Shape(s.profile.map(([z, y]) => new THREE.Vector2(z, y)))
  const bevel = 0.05
  const body = new THREE.ExtrudeGeometry(shape, { depth: s.W - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1, curveSegments: 1 })
  body.rotateY(-Math.PI / 2) // la forma estaba en (x = z, y): pasa a (z, y) y la extrusión queda a lo ancho, en x ∈ [−(W−b), b]
  body.translate(hw - bevel, 0, 0) // centrada: x ∈ [−W/2, W/2]
  parts.push(paint(body, WHITE))

  // vidrios laterales (a ambos lados), parabrisas y ventana trasera
  const wy = (s.windows.y0 + s.windows.y1) / 2, wh = s.windows.y1 - s.windows.y0
  for (const [z0, z1] of s.windows.z) for (const side of [-1, 1])
    parts.push(box(0.02, wh, z1 - z0, side * (hw + 0.012), wy, (z0 + z1) / 2, GLASS))
  parts.push(paint(pane(s.windshield[0], s.windshield[1], hw - 0.12, 0.065), GLASS)) // por fuera del bisel (5 cm)
  const back = s.profile.reduce((m, [z]) => Math.max(m, z), -Infinity)
  parts.push(box(s.W - 0.26, s.rear[1] - s.rear[0], 0.02, 0, (s.rear[0] + s.rear[1]) / 2, back + 0.062, GLASS))

  // parachoques y faldón oscuros
  const front = s.profile[0][0]
  parts.push(box(s.W + 0.02, 0.24, 0.12, 0, 0.42, front - 0.02, TRIM))
  parts.push(box(s.W + 0.02, 0.24, 0.12, 0, 0.42, back + 0.02, TRIM))
  for (const side of [-1, 1]) parts.push(box(0.03, 0.16, s.L - 1.2, side * (hw + 0.01), 0.36, (front + back) / 2, TRIM))

  // faros y luces traseras
  for (const side of [-1, 1]) {
    parts.push(box(0.36, s.lights.h, 0.04, side * (hw - 0.3), s.lights.y, front - 0.06, HEAD))
    parts.push(box(0.12, s.lights.h * 2.2, 0.04, side * (hw - 0.1), s.lights.y + 0.15, back + 0.06, TAIL))
  }

  // ruedas: cilindros de 10 lados, eje a lo ancho
  for (const z of s.wheel.axles) for (const side of [-1, 1]) {
    const w = new THREE.CylinderGeometry(s.wheel.r, s.wheel.r, 0.22, 10).rotateZ(Math.PI / 2).translate(side * (hw - 0.1), s.wheel.r, z)
    parts.push(paint(w, TIRE))
  }

  const g = mergeGeometries(parts)!
  g.computeBoundingSphere()
  return g
}

export const minibusGeometry = () => build(HIACE)
export const trufiGeometry = () => build(WAGON)
/** Medidas reales (m) para el documento de fuentes y las comprobaciones. */
export const SPECS = { minibus: { L: HIACE.L, W: HIACE.W, H: 2.285 }, trufi: { L: WAGON.L, W: WAGON.W, H: 1.47 } }
