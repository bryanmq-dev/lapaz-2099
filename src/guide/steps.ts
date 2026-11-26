/** Paradas de la guía interactiva (#guia). El texto sale del informe; el lugar en el mapa es simbólico. */
export interface GuideStep {
  id: string
  /** nombre corto de la etiqueta sobre el mapa */
  place: string
  /** departamento donde está la parada (define su altura) */
  depto: string
  lonlat: [number, number]
  title: string
  body: string
  points?: string[]
}

export const STEPS: GuideStep[] = [
  {
    id: 'hola', place: 'Bolivia', depto: 'Cochabamba', lonlat: [-64.9, -17.2],
    title: '¡Hola! Soy Wayra',
    body: 'Te llevo por la investigación LA PAZ 2050 en siete paradas sobre el mapa de Bolivia: el problema, la metodología, los resultados, los límites y, al final, el software. Todo el tráfico que verás es simulado.',
  },
  {
    id: 'problema', place: 'La problemática', depto: 'La Paz', lonlat: [-68.13, -16.5],
    title: 'La problemática',
    body: 'La Paz registra 30.269 minibuses y 363 rutas de minibús (GAMLP, 2026). Simular permite probar medidas de tránsito sin intervenir la calle, pero una visualización 3D no demuestra que el modelo sea consistente.',
    points: ['¿Repite exactamente el mismo resultado?', '¿Sus alertas abren y cierran su ciclo?', '¿Sus desvíos respetan los sentidos de las calles?'],
  },
  {
    id: 'objetivo', place: 'Pregunta y objetivo', depto: 'La Paz', lonlat: [-69.05, -15.75],
    title: 'Pregunta y objetivo',
    body: '¿Cómo cambia el modelo ante distintas configuraciones vehiculares, controles e incidentes, y qué evidencia respalda la consistencia de esas comparaciones?',
    points: [
      'Objetivo: evaluar el comportamiento y la consistencia del modelo sobre la red vial del Centro de La Paz.',
      'Cinco objetivos específicos: caracterizar, comparar, comprobar rutas y alertas, determinar la repetibilidad y analizar cada componente del control.',
    ],
  },
  {
    id: 'metodo', place: 'Metodología', depto: 'Potosí', lonlat: [-67.55, -20.2],
    title: 'Metodología',
    body: 'Cuantitativa: experimentación computacional controlada, en Ciencia del Diseño. Es un estudio de viabilidad técnica. Un salar es plano y controlado, como un experimento.',
    points: [
      'Red real: 2.343 segmentos y 62 sentidos de ruta (OpenStreetMap).',
      'Unidad experimental: la ejecución (6 iniciales + 9 de ampliación).',
      'Condiciones: base, refuerzo (+50 vehículos en t = 60 s) y refuerzo + control (t = 180 s).',
      'Indicador: C = Δt · Σ segmentos congestionados, en segmentos·s.',
      'Verificación: huella SHA-256 del estado de cada segundo.',
    ],
  },
  {
    id: 'resultados', place: 'Investigación realizada', depto: 'Cochabamba', lonlat: [-66.16, -17.39],
    title: 'Investigación realizada',
    body: 'Cochabamba es la sede central de UNIVALLE: aquí están los hallazgos.',
    points: [
      'Con control, la carga de congestión baja un 22,20 % (de 1.599 a 1.244).',
      '900 de 900 estados idénticos entre repeticiones.',
      'Refuerzo y control son idénticos en los 179 s previos a intervenir.',
      'Ablaciones: combinado −36,6 %, paradas −29,0 %; los efectos no se suman.',
      '124 bloqueos de rutas sin ninguna violación; 28 de 28 alertas verificadas.',
    ],
  },
  {
    id: 'limites', place: 'Viabilidad y límites', depto: 'Chuquisaca', lonlat: [-65.26, -19.03],
    title: 'Viabilidad y límites',
    body: 'En la capital, lo que se puede afirmar: el modelo es técnicamente viable porque mide, compara y repite. No se demostró que prediga el tránsito de la ciudad.',
    points: [
      'Principal limitación: no está calibrado con datos de campo.',
      'Una sola zona; la ampliación usa dos configuraciones.',
      'Sin significación estadística: las repeticiones son idénticas a propósito.',
      'Siguiente paso: aforos, análisis de sensibilidad y reproducción externa.',
    ],
  },
  {
    id: 'software', place: 'El software', depto: 'Santa Cruz', lonlat: [-63.18, -17.78],
    title: 'El software',
    body: 'Es el objeto que se evaluó, no el resultado de la investigación.',
    points: [
      'Cliente: React + Three.js (React Three Fiber).',
      'Servidor: Node.js + TypeScript + Fastify, con un paso de 1 s.',
      'Datos: PostgreSQL + PostGIS (alertas con ST_DWithin y ST_Intersects).',
      'Modelos: seguimiento vehicular de Krauss y desvíos con Dijkstra.',
    ],
  },
  {
    id: 'mapa', place: 'Mapa 3D', depto: 'La Paz', lonlat: [-68.13, -16.5],
    title: 'El mapa 3D del Centro',
    body: 'Ahora entra al Centro de La Paz: calles, relieve y tres líneas son reales; los vehículos y el tráfico son simulados. Prueba «Hora punta en El Prado» y luego «Despejar El Prado».',
  },
]

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** HTML del popover de driver.js (el contenido es propio, pero se escapa igual). */
export const stepHtml = (s: GuideStep) =>
  `<p>${esc(s.body)}</p>${s.points ? `<ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}`
