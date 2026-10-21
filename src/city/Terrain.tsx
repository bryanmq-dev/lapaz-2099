import { useMemo } from 'react'
import * as THREE from 'three'
import { contourMaterial } from './materials'
import { heightAt } from './shared'

const SIZE = 460
const SEG = 300

/** Valle andino procedural: color por altura y curvas de nivel emisivas (look "gemelo digital"). */
export function Terrain() {
  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG)
    g.rotateX(-Math.PI / 2)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)))
    g.computeVertexNormals()
    const n = g.attributes.normal
    const col = new Float32Array(p.count * 3)
    const low = new THREE.Color('#0b1829'), rock = new THREE.Color('#1d3350'), high = new THREE.Color('#3b5776')
    const snow = new THREE.Color('#d6e8f8'), c = new THREE.Color()
    for (let i = 0; i < p.count; i++) {
      const h = p.getY(i)
      c.copy(low).lerp(rock, Math.min(1, h / 14)).lerp(high, Math.min(1, Math.max(0, (h - 14) / 22)))
      c.lerp(snow, Math.min(1, Math.max(0, (h - 36) / 8)))
      c.multiplyScalar(0.75 + 0.5 * n.getY(i)) // las pendientes se oscurecen
      col.set([c.r, c.g, c.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }, [])

  const material = useMemo(() => contourMaterial({ density: 0.55, intensity: 0.1, fadeFrom: 26, fadeTo: 40 }), [])

  return <mesh geometry={geometry} material={material} raycast={() => null} />
}
