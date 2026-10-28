// Zonas con vista detallada. Lo usan el script de datos (scripts/zonas/fetch.ts), la API (server/src) y el front.
// Solo datos: sin dependencias de Node ni del navegador.

export type ZoneId = 'centro' | 'alto' | 'sopocachi' | 'calacoto'
export type LL = [number, number] // [lon, lat]

export interface ZoneLine {
  code: string; ida: number; vuelta: number // relaciones OSM (PTv2) de cada sentido
}

export interface Zone {
  id: ZoneId | 'metro'
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

export const ZONES: (Zone & { id: ZoneId })[] = [
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
    lines: [ // minibuses con ida y vuelta y más recorrido dentro del recuadro (scripts/zonas/fetch.ts --discover)
      { code: '212', ida: 9381528, vuelta: 9393419 },
      { code: '731', ida: 9394021, vuelta: 9394239 },
      { code: '267', ida: 19980924, vuelta: 20619663 },
    ],
  },
  {
    id: 'sopocachi', name: 'Sopocachi', district: 'sopocachi',
    bbox: { s: -16.526, w: -68.142, n: -16.502, e: -68.112 },
    origin: { lat: -16.5104, lon: -68.1268 }, // Plaza Abaroa
    hotspot: { name: 'Plaza Abaroa', short: 'Plaza Abaroa', at: [-68.1268, -16.5104] },
    tall: { axis: [[-68.1335, -16.5045], [-68.1268, -16.5104], [-68.1195, -16.5165]], base: [13, 8, 5] }, // Av. 6 de Agosto
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Mirador|Montículo|Embajada|Teatro',
    lines: [ // minibuses con corredores distintos dentro de la zona (scripts/zonas/fetch.ts --discover y --try)
      { code: '296', ida: 19980960, vuelta: 20619577 },
      { code: '847', ida: 19982381, vuelta: 20108303 },
      { code: '906', ida: 10261371, vuelta: 20083458 },
    ],
  },
  {
    id: 'calacoto', name: 'Calacoto', district: 'zonasur',
    bbox: { s: -16.552, w: -68.096, n: -16.528, e: -68.066 },
    origin: { lat: -16.5405, lon: -68.0815 }, // Calle 21 de Calacoto
    hotspot: { name: 'Av. Ballivián y Calle 21', short: 'Calle 21', at: [-68.07805, -16.53897] }, // cruce en el grafo vial de OSM
    tall: { axis: [[-68.091467, -16.54119], [-68.086355, -16.539856], [-68.080979, -16.538747], [-68.07549, -16.539084]], base: [18, 9, 5] }, // Av. José Ballivián (traza de OSM)
    landmarks: 'Plaza|Mercado|Parque|Iglesia|Centro Comercial|Megacenter|Estadio|Club|Universidad',
    // En OSM estas líneas tienen UNA sola relación (sin ida y vuelta separadas): se declara la misma en ambos sentidos y la
    // vuelta se supone por el mismo corredor en sentido contrario (ver oneRelation en scripts/zonas/fetch.ts)
    lines: [
      { code: '922', ida: 10259073, vuelta: 10259073 },
      { code: '458', ida: 9424671, vuelta: 9424671 },
      { code: '379', ida: 10253969, vuelta: 10253969 },
    ],
  },
]

export const zoneById = (id: string) => ZONES.find((z) => z.id === id)
