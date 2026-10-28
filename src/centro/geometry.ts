import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ribbon } from '../city/shared'
import { project, type Area, type Building, type Elevation, type LL, type Street } from './data'

export type HeightFn = (x: number, z: number) => number

/** Ancho de calzada aproximado por jerarquía OSM (m). */
export const STREET_WIDTH: Record<string, number> = {
  motorway: 16, trunk: 16, primary: 13, secondary: 10, tertiary: 8.5, unclassified: 7, residential: 7,
  living_street: 6, pedestrian: 6, service: 4, steps: 3,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 7, tertiary_link: 7,
}
export const MAJOR = /^(motorway|trunk|primary|secondary)(_link)?$/

/** Densifica una polilínea (en metros) y la apoya sobre el terreno. */
export function drape(pts: LL[], height: HeightFn, lift: number, every = 6, projection = project): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  const p = pts.map(projection)
  for (let i = 0; i < p.length; i++) {
    if (i) {
      const [ax, az] = p[i - 1], [bx, bz] = p[i]
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / every))
      for (let k = 1; k < n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n
        out.push(new THREE.Vector3(x, height(x, z) + lift, z))
      }
    }
    out.push(new THREE.Vector3(p[i][0], height(p[i][0], p[i][1]) + lift, p[i][1]))
  }
  return out
}

// ---- terreno ------------------------------------------------------------------

export function terrainGeometry(el: Elevation, light = false) {
  const { w, h } = el
  const pos = new Float32Array(w * h * 3)
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = (j * w + i) * 3
    pos[k] = el.x0 + i * el.step; pos[k + 1] = el.dm[j * w + i] / 10; pos[k + 2] = el.z0 + j * el.step
  }
  const idx: number[] = []
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1
    idx.push(a, c, b, b, c, d)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  const n = g.attributes.normal, span = el.max - el.min
  const col = new Float32Array(w * h * 3)
  const low = new THREE.Color(light ? '#c9cfae' : '#0b1829'), mid = new THREE.Color(light ? '#bcb394' : '#1a3150'), high = new THREE.Color(light ? '#a29d92' : '#33506f'), c = new THREE.Color()
  for (let v = 0; v < w * h; v++) {
    const t = pos[v * 3 + 1] / span
    c.copy(low).lerp(mid, Math.min(1, t * 2.2)).lerp(high, Math.max(0, t * 2 - 1)).multiplyScalar(0.7 + 0.5 * n.getY(v))
    col.set([c.r, c.g, c.b], v * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

// ---- edificios (una sola malla; ventanas en el shader) -------------------------

/** Extrusión propia: paredes con coordenadas de fachada (u, v) para el patrón de ventanas + techo triangulado. */
export function buildingsGeometry(list: Building[], minElev: number, light = false, projection = project) {
  const pos: number[] = [], nor: number[] = [], col: number[] = [], win: number[] = [], idx: number[] = []
  const real = new THREE.Color(light ? '#dfe3e8' : '#6f8fb0'), est = new THREE.Color(light ? '#c6ccd4' : '#3f5874'), named = new THREE.Color(light ? '#f3d9b8' : '#a8c6e4')
  for (const b of list) {
    let ring = b.pts.map(projection)
    if (THREE.ShapeUtils.isClockWise(ring.map(([x, z]) => new THREE.Vector2(x, -z)))) ring = ring.reverse()
    const y0 = b.b - minElev - 2, y1 = b.b - minElev + b.h, H = b.h + 2
    const tone = b.n ? named : b.e ? est : real
    const seed = Math.abs(Math.sin(ring[0][0] * 12.9898 + ring[0][1] * 78.233)) % 1
    let u = 0
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length]
      const L = Math.hypot(bx - ax, bz - az)
      if (L < 0.05) continue
      const nx = -(bz - az) / L, nz = (bx - ax) / L // hacia afuera (anillo antihorario en el mapa)
      const base = pos.length / 3
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az)
      for (let k = 0; k < 4; k++) { nor.push(nx, 0, nz); col.push(tone.r, tone.g, tone.b) }
      win.push(u, 0, H, seed, u + L, 0, H, seed, u + L, H, H, seed, u, H, H, seed)
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
      u += L
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
    const base = pos.length / 3
    for (const [x, z] of ring) { pos.push(x, y1, z); nor.push(0, 1, 0); col.push(tone.r, tone.g, tone.b); win.push(0, H, H, seed) }
    for (const [a, b2, c] of tris) idx.push(base + a, base + c, base + b2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aWin', new THREE.Float32BufferAttribute(win, 4))
  g.setIndex(idx)
  return g
}

export function buildingsMaterial(light = false) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 })
  // el texto de onBeforeCompile es el mismo en ambos temas: sin una clave propia, three reutilizaría el shader del otro tema
  m.customProgramCacheKey = () => (light ? 'buildings-day' : 'buildings-night')
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aWin; varying vec4 vWin; varying float vRoof;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWin = aWin; vRoof = step(0.5, normal.y);')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vWin; varying float vRoof;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec2 g = vec2(vWin.x / 3.4, vWin.y / 3.0);
        vec2 cell = floor(g); vec2 f = fract(g);
        // distancia normalizada al borde de la ventana: < 1 dentro, crece hacia afuera (para el halo)
        float d = max(abs(f.x - 0.5) / 0.28, abs(f.y - 0.5) / 0.22);
        float win = step(d, 1.0);
        float rnd = fract(sin(dot(cell + vWin.w * 97.1, vec2(12.9898, 78.233))) * 43758.5453);
        float facade = (1.0 - vRoof) * step(2.5, vWin.y) * step(vWin.y, vWin.z - 1.5);
        float lit = step(0.46, rnd) * facade;
        ${light
          ? 'diffuseColor.rgb *= 1.0 - 0.4 * win * lit; // de día: vidrios oscuros, sin luces'
          : `// de noche: ventanas encendidas que brillan (cálidas y algunas frías) con un halo suave sobre la fachada
        vec3 tint = mix(vec3(1.0, 0.72, 0.38), vec3(0.5, 0.86, 1.0), step(0.82, rnd));
        float halo = (1.0 - smoothstep(1.0, 1.7, d)) * (1.0 - win);
        float flicker = 0.75 + 0.5 * fract(rnd * 7.31); // intensidad propia de cada ventana
        diffuseColor.rgb *= 1.0 - 0.55 * win * facade; // vidrio más oscuro que el muro
        totalEmissiveRadiance += (win * 1.9 + halo * 0.45) * lit * tint * flicker;
        totalEmissiveRadiance += win * (1.0 - lit) * facade * vec3(0.03, 0.08, 0.14); // apagadas: reflejo azul tenue
        totalEmissiveRadiance += vRoof * vec3(0.0, 0.18, 0.26);`}`,
      )
  }
  return m
}

// ---- calles, áreas y rutas ------------------------------------------------------

export function streetGeometries(streets: Street[], height: HeightFn, projection = project, every = 6) {
  const asphalt: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], minor: THREE.BufferGeometry[] = []
  for (const s of streets) {
    const pts = drape(s.pts, height, 0.6, every, projection)
    if (pts.length < 2) continue
    const w = STREET_WIDTH[s.hw] ?? 6
    if (s.hw === 'steps' || s.hw === 'pedestrian') minor.push(ribbon(pts, w, 0))
    else asphalt.push(ribbon(pts, w, 0))
    if (MAJOR.test(s.hw)) glow.push(ribbon(pts, 0.9, 0.12))
  }
  const merge = (l: THREE.BufferGeometry[]) => (l.length ? mergeGeometries(l)! : new THREE.BufferGeometry()) // una zona puede no tener escalinatas ni peatonales
  return { asphalt: merge(asphalt), glow: merge(glow), minor: merge(minor) }
}

export function areasGeometry(areas: Area[], height: HeightFn, keep: (a: Area) => boolean, projection = project) {
  const parts: THREE.BufferGeometry[] = []
  for (const a of areas) {
    if (!keep(a) || a.pts.length < 3) continue
    const ring = a.pts.map(projection)
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), [])
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(ring.flatMap(([x, z]) => [x, height(x, z) + 0.45, z]), 3))
    g.setIndex(tris.flatMap(([p, q, r]) => [p, r, q]))
    parts.push(g)
  }
  return parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry()
}
