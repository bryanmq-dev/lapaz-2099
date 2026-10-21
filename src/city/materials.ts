import * as THREE from 'three'

/**
 * Terreno con color por vértice y curvas de nivel emisivas (look "gemelo digital").
 * density: curvas por unidad de altura; fade*: altura donde las curvas se apagan.
 */
export function contourMaterial({ density, intensity, fadeFrom, fadeTo }: { density: number; intensity: number; fadeFrom: number; fadeTo: number }) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvH = position.y;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vH;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float q = vH * ${density.toFixed(4)};
        float cl = abs(fract(q) - 0.5);
        float line = 1.0 - smoothstep(0.0, max(fwidth(q) * 1.1, 0.02), cl);
        totalEmissiveRadiance += vec3(0.0, 0.5, 0.7) * line * ${intensity.toFixed(3)} * (1.0 - smoothstep(${fadeFrom.toFixed(1)}, ${fadeTo.toFixed(1)}, vH));`,
      )
  }
  return m
}
