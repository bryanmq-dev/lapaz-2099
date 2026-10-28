import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Cabina de Mi Teleférico (tipo Omega de 10 plazas, ≈3,4 × 2,3 × 2,3 m). Origen en el cable: +x avanza, y sube, z es el ancho.
// SCALE exagera el tamaño real para que se lea desde la vista de ciudad.
export const CABIN_SCALE = 3.5

const roundedRect = (w: number, h: number, r: number) => {
  const x = -w / 2, y = -h / 2, s = new THREE.Shape()
  s.moveTo(x + r, y).lineTo(x + w - r, y).quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r).quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h).quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y)
  return s
}
const slab = (w: number, h: number, r: number, depth: number, cy: number) =>
  new THREE.ExtrudeGeometry(roundedRect(w, h, r), { depth, bevelEnabled: false, curveSegments: 3 }).translate(0, cy, -depth / 2)
const box = (w: number, h: number, d: number, x: number, y: number, z: number) => new THREE.BoxGeometry(w, h, d).translate(x, y, z)
const wheel = (x: number) => new THREE.CylinderGeometry(0.2, 0.2, 0.14, 8).rotateX(Math.PI / 2).translate(x, 0.05, 0)

/** `shell` toma el color de la línea (o del estado); `trim` lleva sus propios colores por vértice. */
export function cabinGeometry() {
  const shell = slab(3.4, 2.3, 0.55, 2.3, -2.85)
  const parts: [THREE.BufferGeometry, string][] = [
    [slab(2.96, 1.45, 0.4, 2.36, -2.7), '#10181f'], // ventanales tintados en ambas caras
    [new THREE.CylinderGeometry(0.24, 0.24, 2.4, 14).rotateX(Math.PI / 2).translate(0, -3.72, 0), '#f3f6f8'], // logotipo (disco)
    [box(3.1, 0.16, 2.0, 0, -1.62, 0), '#d4d9de'], // techo
    [box(1.2, 0.04, 1.1, 0, -1.5, 0), '#1c2d4f'], // panel solar
    [new THREE.CylinderGeometry(0.1, 0.1, 1.3, 6).translate(0, -0.89, 0), '#7d8790'], // brazo de suspensión
    [box(0.9, 0.3, 0.5, 0, -0.15, 0), '#444c53'], // carro
    [wheel(-0.3), '#22272c'], [wheel(0.3), '#22272c'],
  ]
  const trim = mergeGeometries(parts.map(([g, hex]) => {
    const flat = g.index ? g.toNonIndexed() : g, color = new THREE.Color(hex)
    flat.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: flat.attributes.position.count }, () => [color.r, color.g, color.b]).flat(), 3))
    if (flat !== g) g.dispose()
    return flat
  }))!
  shell.scale(CABIN_SCALE, CABIN_SCALE, CABIN_SCALE); trim.scale(CABIN_SCALE, CABIN_SCALE, CABIN_SCALE)
  return { shell, trim }
}
