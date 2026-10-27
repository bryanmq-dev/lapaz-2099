// Zonas con vista detallada. Lo usan el script de datos (scripts/zonas/fetch.ts), la API (server/src) y el front.
// Solo datos: sin dependencias de Node ni del navegador.

export type ZoneId = 'centro' | 'alto' | 'sopocachi' | 'calacoto' | 'miraflores' | 'fatima'
export type LL = [number, number] // [lon, lat]

export interface ZoneLine {
  code: string; ida: number; vuelta: number // relaciones OSM (PTv2) de cada sentido
}

export interface Zone {
  id: ZoneId
  name: string
  /** distrito de la vista Ciudad que abre esta zona (src/simulation/cityData.ts) */
  district: string
  bbox: { s: number; w: number; n: number; e: number }
  /** origen de las coordenadas locales en metros (x hacia el este, z hacia el sur) */
  origin: { lat: number; lon: number }
  /** cruce donde se forma la hora punta: el refuerzo converge aquí y hay un semáforo simulado */
  hotspot: { name: string; short: string; at: LL }
  /** eje de edificios altos para estimar alturas sin dato en OSM (polilínea) y alturas base cerca / medio / lejos */
  tall: { axis: LL[]; base: [number, number, number] }
  /** palabras de los nombres OSM que cuentan como hitos del mapa */
  landmarks: string
  lines: ZoneLine[]
}

export const ZONES: Zone[] = [
  {
    id: 'centro', name: 'Centro', district: 'centro',
    bbox: { s: -16.512, w: -68.15, n: -16.488, e: -68.12 },
    origin: { lat: -16.4958, lon: -68.1336 }, // Plaza Murillo
    hotspot: { name: 'El Prado', short: 'Obelisco', at: [-68.135081, -16.498602] },
    tall: { axis: [], base: [14, 9, 6] }, // el Centro usa su fórmula original (eje del Prado), ver scripts/zonas/fetch.ts
    landmarks: 'Plaza|Basílica|Obelisco|Mercado|Palacio|Garita',
    lines: [
      { code: '212', ida: 9381528, vuelta: 9393419 },
      { code: '204', ida: 19447024, vuelta: 19422164 },
      { code: '453', ida: 17767401, vuelta: 17675641 },
    ],
  },
  {
    id: 'alto', name: 'El Alto', district: 'alto',
    bbox: { s: -16.522, w: -68.182, n: -16.498, e: -68.152 },
    origin: { lat: -16.5045, lon: -68.163 }, // La Ceja
    hotspot: { name: 'La Ceja', short: 'La Ceja', at: [-68.1628, -16.5048] },
    tall: { axis: [[-68.175, -16.5185], [-68.1628, -16.5048], [-68.1545, -16.5005]], base: [12, 7, 5] }, // Av. 6 de Marzo → La Ceja → bajada de la Autopista
    landmarks: 'Plaza|Mercado|Feria|Terminal|Estación|Iglesia|Parque|Ceja|Mirador',
    lines: [],
  },
  {
    id: 'sopocachi', name: 'Sopocachi', district: 'sopocachi',
    bbox: { s: -16.526, w: -68.142, n: -16.502, e: -68.112 },
    origin: { lat: -16.5104, lon: -68.1268 }, // Plaza Abaroa
    hotspot: { name: 'Plaza Abaroa', short: 'Plaza Abaroa', at: [-68.1268, -16.5104] },
    tall: { axis: [[-68.1335, -16.5045], [-68.1268, -16.5104], [-68.1195, -16.5165]], base: [13, 8, 5] }, // Av. 6 de Agosto
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Mirador|Montículo|Embajada|Teatro',
    lines: [],
  },
  {
    id: 'calacoto', name: 'Calacoto', district: 'zonasur',
    bbox: { s: -16.552, w: -68.096, n: -16.528, e: -68.066 },
    origin: { lat: -16.5405, lon: -68.0815 }, // Calle 21 de Calacoto
    hotspot: { name: 'Av. Ballivián y Calle 21', short: 'Calle 21', at: [-68.0838, -16.5413] },
    tall: { axis: [[-68.0915, -16.5345], [-68.0838, -16.5413], [-68.0745, -16.5470]], base: [18, 9, 5] }, // Av. Ballivián
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Centro Comercial|Megacenter|Estadio|Club|Universidad',
    lines: [],
  },
  {
    id: 'miraflores', name: 'Miraflores', district: 'miraflores',
    bbox: { s: -16.511, w: -68.128, n: -16.487, e: -68.098 },
    origin: { lat: -16.4995, lon: -68.1205 }, // Estadio Hernando Siles
    hotspot: { name: 'Av. Busch y Av. Saavedra', short: 'Av. Busch', at: [-68.1205, -16.4958] },
    tall: { axis: [[-68.1260, -16.5020], [-68.1205, -16.4958], [-68.1135, -16.4900]], base: [12, 8, 5] }, // Av. Saavedra
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Estadio|Hospital|Facultad|Universidad|Monumento',
    lines: [],
  },
  {
    id: 'fatima', name: 'Villa Fátima', district: 'villa',
    bbox: { s: -16.494, w: -68.128, n: -16.470, e: -68.098 },
    origin: { lat: -16.4815, lon: -68.1135 }, // Plaza de Villa Fátima
    hotspot: { name: 'Av. de las Américas', short: 'Las Américas', at: [-68.1132, -16.4808] },
    tall: { axis: [[-68.1210, -16.4880], [-68.1132, -16.4808], [-68.1060, -16.4745]], base: [10, 7, 4] }, // Av. de las Américas
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Terminal|Estación|Cementerio|Hospital',
    lines: [],
  },
]

export const zoneById = (id: string) => ZONES.find((z) => z.id === id)
