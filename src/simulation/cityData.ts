import type { District, RoadLink, Sensor, SensorKind } from './types.ts'

// Ciudad conceptual inspirada en La Paz. No es un mapa geográfico preciso.
export const DISTRICTS: District[] = [
  { id: 'centro', name: 'Centro', role: 'Gobierno y comercio', pos: [-2, -18], radius: 11, style: 'core', baseTraffic: 44, baseEnergy: 63, capacityMW: 85, weight: 1.6, population: 210 },
  { id: 'sopocachi', name: 'Sopocachi', role: 'Residencial y cultural', pos: [-22, 0], radius: 9, style: 'mid', baseTraffic: 33, baseEnergy: 52, capacityMW: 40, weight: 0.9, population: 90 },
  { id: 'miraflores', name: 'Miraflores', role: 'Salud y educación', pos: [22, -12], radius: 9, style: 'mid', baseTraffic: 38, baseEnergy: 56, capacityMW: 48, weight: 0.9, population: 110 },
  { id: 'villa', name: 'Villa Fátima', role: 'Mercados y transporte', pos: [14, -36], radius: 9, style: 'low', baseTraffic: 30, baseEnergy: 47, capacityMW: 35, weight: 0.8, population: 120 },
  { id: 'obrajes', name: 'Obrajes', role: 'Universidades', pos: [4, 14], radius: 10, style: 'mid', baseTraffic: 34, baseEnergy: 49, capacityMW: 44, weight: 1, population: 100 },
  { id: 'zonasur', name: 'Zona Sur', role: 'Negocios y servicios', pos: [12, 40], radius: 12, style: 'high', baseTraffic: 28, baseEnergy: 58, capacityMW: 70, weight: 1, population: 130 },
  { id: 'alto', name: 'El Alto', role: 'Altiplano · hub logístico', pos: [-8, -54], radius: 14, style: 'low', baseTraffic: 40, baseEnergy: 44, capacityMW: 60, weight: 1, population: 330 },
]

export const ROADS: RoadLink[] = [
  { id: 'r-alto-centro', name: 'Eje Altiplano', from: 'alto', to: 'centro' },
  { id: 'r-alto-villa', name: 'Corredor Norte', from: 'alto', to: 'villa' },
  { id: 'r-villa-centro', name: 'Av. Central', from: 'villa', to: 'centro' },
  { id: 'r-villa-mira', name: 'Anillo Este', from: 'villa', to: 'miraflores' },
  { id: 'r-centro-mira', name: 'Av. Oriental', from: 'centro', to: 'miraflores' },
  { id: 'r-centro-sopo', name: 'Eje Poniente', from: 'centro', to: 'sopocachi' },
  { id: 'r-centro-obra', name: 'Av. Costanera', from: 'centro', to: 'obrajes' },
  { id: 'r-sopo-obra', name: 'Corredor Obrajes', from: 'sopocachi', to: 'obrajes' },
  { id: 'r-mira-obra', name: 'Eje Sur', from: 'miraflores', to: 'obrajes' },
  { id: 'r-obra-sur', name: 'Corredor Sur', from: 'obrajes', to: 'zonasur' },
  { id: 'r-mira-sur', name: 'Eje Oriente-Sur', from: 'miraflores', to: 'zonasur' },
]

export function mulberry32(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SENSOR_COUNTS: Record<string, number> = { centro: 6, alto: 5, villa: 3, miraflores: 4, sopocachi: 4, obrajes: 4, zonasur: 4 }
const KINDS: SensorKind[] = ['traffic', 'energy', 'air']
const OFFLINE = new Set([7, 22])

function buildSensors(): Sensor[] {
  const rng = mulberry32(77)
  const out: Sensor[] = []
  for (const d of DISTRICTS) {
    const n = SENSOR_COUNTS[d.id]
    const a0 = rng() * Math.PI * 2
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2
      const r = d.radius * 0.62 + (k % 2 ? 0.9 : -0.9) // sobre la vía anular del distrito
      const idx = out.length
      out.push({
        id: `S-${String(idx + 1).padStart(2, '0')}`,
        districtId: d.id,
        kind: KINDS[idx % 3],
        pos: [d.pos[0] + Math.cos(a) * r, d.pos[1] + Math.sin(a) * r],
        offline: OFFLINE.has(idx),
      })
    }
  }
  return out
}

export const SENSORS: Sensor[] = buildSensors()
export const districtById = (id: string) => DISTRICTS.find((d) => d.id === id)!
