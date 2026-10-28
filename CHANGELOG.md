# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

## [Sin publicar]

### Agregado
- **Mapa unificado · La Paz y El Alto** (`#metropolitano`): una sola escena continua con relieve, calles y edificios por sectores que se descargan según la cámara. Selector de transporte (Minibuses y tráfico / Teleféricos), registro de eventos y panel plegable.
- **Teleféricos de Mi Teleférico** (las 10 líneas, 45 estaciones de OSM, transbordos tomados de las relaciones y no de la cercanía): cabinas en ambos sentidos con retorno en terminales, tres estados por línea (normal, mantenimiento, detenido), incidentes automáticos reproducibles por semilla y cambios manuales. Estado y movimiento **simulados**; alturas del cable aproximadas.
- **Minibuses metropolitanos** en el esquema `metro` de PostGIS: 54 de 121 relaciones OSM tienen recorrido continuo sobre la red dirigida; el resto queda señalado en `bus-catalog.json`.
- Nivel de calidad **Solo rutas** (también en las zonas): sin edificios completos, con un máximo de 10 de referencia por sector.
- `scripts/metro/fetch.ts` (extracción versionada y atómica a `public/metro/<versión>/`), `scripts/metro/from-pbf.py` (rellena la caché desde Geofabrik sin Overpass) y `API_URL` para el proxy de Vite.

## [0.6.0] — 2026-10-27

Tres zonas nuevas con vista detallada, minibús real, calidad seleccionable y realidad aumentada en más dispositivos.

### Agregado
- **Zonas El Alto (La Ceja), Sopocachi y Calacoto**, con el mismo proceso del Centro: terreno, calles, edificios, áreas, hitos y escuelas de OpenStreetMap y elevación SRTM, **3 líneas reales de minibús** por zona y simulación completa (hora punta, congestión emergente, desvíos o aviso de que no hay rodeo, desvío no autorizado, avería y geocerca). Documentadas en `docs/zonas/`.
  - El Alto: 212, 731 y 267. Sopocachi: 296, 847 y 906. Calacoto: 922, 458 y 379 (en OSM tienen un solo sentido: la vuelta es un supuesto).
- **Selector de zona** en la cabecera y acceso desde la vista Ciudad (doble clic o «Ver en detalle»).
- **Minibús Toyota HiAce H200 de techo alto** (modelo propio con las medidas de la ficha técnica) y una station wagon para los trufis, en lugar de cajas.
- **Selector de calidad de la ciudad** (Automática, Alta, Media, Baja) con lo que descarga cada nivel. La calidad baja descarga menos edificios. Barra de avance mientras se descarga la ciudad.
- **Realidad mixta en teléfonos Android** (hit-test para colocar la maqueta sobre una superficie y panel HTML sobre la cámara).
- **AR Quick Look en iPad y iPhone**, donde no existe WebXR en ningún navegador: la maqueta se exporta a USDZ y se coloca sobre la mesa real.
- **`docs/fuentes.md`**: de dónde sale cada dato, modelo y supuesto, con licencias, para la defensa.
- Script `scripts/zonas/fetch.ts` con `--discover` (rutas OSM de una zona) y `--try` (evaluar líneas candidatas).

### Cambiado
- La API sirve varias zonas: un **esquema de PostgreSQL por zona** (el Centro sigue en `public`) y cada zona **simula solo mientras alguien la mira**. Rutas `/api/zones/<zona>/…`; las de `/api/…` siguen siendo del Centro.
- Los datos pasan de `public/centro/` a `public/zonas/<zona>/`.
- **Rendimiento en dispositivos modestos:** la vista de zona se descarga solo al abrirla, los edificios se construyen en un Web Worker y la calidad baja sola si caen los FPS.
- **Ventanas luminosas** en modo oscuro (cálidas y frías, con halo).

### Corregido
- Al cambiar de tema sin recargar, los edificios seguían con el shader del otro tema.
- El iPad se trataba como un escritorio (se presenta como Mac): ahora se reconoce por ser táctil.

### Fuera de esta versión
- Miraflores y Villa Fátima (Overpass estuvo saturado; se pueden agregar con el mismo proceso).

## [0.5.0] — 2026-10-22

Maqueta interactiva del Centro para gafas VR / realidad mixta (Meta Quest 3).

### Agregado
- **Modo VR y realidad mixta** en la vista del Centro (WebXR, `@react-three/xr`). Botones «VR» y «Mixta» en la cabecera, visibles solo si el navegador soporta WebXR. La ciudad se ve como una **maqueta de ~1 m sobre una mesa**: se mueve y gira con un control, se escala con los dos, y los buses se seleccionan apuntando con el rayo.
- **Panel flotante 3D** en el visor: KPIs, anuncio de congestión, los escenarios (hora punta, desvío, avería, geocerca, despejar, reiniciar), interruptores de las líneas, ficha del bus seleccionado y «Vista general».
- `HTTPS=1 pnpm dev` levanta Vite con certificado autofirmado para abrir la app desde el Quest por Wi-Fi.

### Cambiado
- `STATE_LABEL` y `SCENARIOS` pasan de `CentroPanel.tsx` a `labels.ts` para compartirlos con el panel VR.
- Las balizas de los vehículos miden su tamaño en coordenadas de la ciudad (sin efecto en la vista de escritorio).

### Pendiente
- Verificar escala, rendimiento (72 FPS) y selección en los visores reales; las perillas están en `src/centro/xr.ts`.

## [0.4.0] — 2026-10-21

Modo claro en toda la aplicación y paneles ocultables en la vista del Centro.

### Agregado
- **Modo claro / oscuro** con un botón sol/luna en las cabeceras de la vista ciudad y del Centro. La elección se recuerda (`localStorage`); el oscuro sigue siendo el predeterminado.
  - La interfaz usa variables CSS; el modo claro solo las redefine.
  - Las escenas 3D tienen paleta clara: cielo, niebla, luces, terreno, edificios (sin ventanas encendidas de día), calles, parques, plazas y geocercas.
  - Los buses de las líneas reales **conservan su color**; los buses de relleno de la flota simulada pasan a **negro** en modo claro (siguen grises en oscuro).
- **Ocultar paneles** en la vista del Centro, con el mismo botón que la vista ciudad (`hud-min`). Se deja a la vista la cabecera, los escenarios y el anuncio de congestión.

### Corregido
- En móvil, los botones de la cabecera de la vista ciudad (paneles y pantalla completa) se salían de la pantalla: ahora la cabecera hace salto de línea.

## [0.3.0] — 2026-10-21

Flota simulada de más de 240 minibuses, hora punta con congestión emergente en El Prado, el Obelisco y la Av. Camacho, y vista del Centro adaptada a móvil.

### Corregido
- Vista Centro en móvil y tablet: la grilla de 330 px + 350 px pisaba los `@media` y recortaba la pantalla. Ahora en ≤720 px los paneles laterales se ocultan, el encabezado se compacta y los 4 escenarios quedan en una cuadrícula de 2 columnas sobre un fondo casi opaco, con la atribución de OSM debajo; en ≤1050 px se oculta el panel derecho.

### Agregado
- **Flota simulada de 28 líneas** (`server/src/fleet.ts`, migración `002_flota_simulada.sql`): 224 minibuses en servicio más 50 unidades de refuerzo, sobre rutas calculadas en la red vial real (no son líneas reales). Con las líneas reales hay más de 240 minibuses en servicio.
- **Hora punta con congestión emergente**: las 50 unidades de refuerzo llegan en ~90 s a El Prado, el Obelisco y la Av. Camacho y forman cola por sí solas. Salen al iniciar, cada 8 min y con el botón «Hora punta en El Prado».
- **Seguimiento de vehículo** (modelo de Krauss), paradas dentro del carril y un semáforo simulado en el Obelisco. La congestión de cada tramo se mide con la velocidad real de los vehículos.
- Las alertas de congestión indican la zona (p. ej. «Av. Eliodoro Camacho (zona Obelisco)») y los vehículos en cola ya no disparan alertas de «detenido» (`vehicle_positions.queued`).
- **Clic en una congestión**: el anuncio rojo, su botón «Ver en el mapa» y la alerta del panel hacen volar la cámara al lugar (~420 m). Las alertas del stream incluyen ahora `lon` y `lat` (el punto de PostGIS).
- **Documentación técnica** en `docs/explicacion-tecnica.md`: origen de los datos, modelo de datos, simulador, detección de congestión y alertas, incidentes, API, front, pruebas, parámetros, límites y un guion para exponerlo.
- La comprobación de punta a punta cubre la flota (≥ 200 minibuses), la hora punta, la alerta emergente, los desvíos y la recuperación.

### Cambiado
- Botones de escenarios y de iconos de la vista Centro con fondo casi sólido en lugar de translúcido.
- «Congestión en El Prado» pasa a «Hora punta en El Prado»: ya no fija la congestión a mano. «Despejar El Prado» simula a un agente de tránsito.
- Los desvíos se calculan con una cola de prioridad (de ~2–5 s a ~0,4 s) y se proponen solos cuando se abre una congestión; el panel solo lista los de las líneas reales.
- La vista Centro dibuja hasta 400 vehículos (antes 64); los de la flota simulada llevan color y marcador propios.

## [0.2.0] — 2026-10-21

Seguimiento de transporte público en el Centro de La Paz con datos reales y PostGIS.

### Agregado
- **Vista 3D del Centro con datos reales** (`src/centro/`):
  - terreno de elevación SRTM (3.441–4.087 m);
  - 2.489 calles de OpenStreetMap con ancho según jerarquía;
  - 2.180 edificios reales extruidos con ventanas, más 22.970 lotes estimados para completar manzanas sin datos;
  - plazas y parques, y 14 lugares de referencia.

  Se entra desde el botón “Centro en detalle”, desde el panel de la zona Centro o con doble clic en su plataforma 3D. La URL `#centro` abre directamente esta vista.
- **Caso de estudio de 3 líneas reales** (`docs/caso-estudio-rutas.md`), con ficha, fuentes y supuestos marcados:
  - minibús 212 (Sindicato COTRANSTUR);
  - minibús 204 (Sindicato Pedro Domingo Murillo);
  - trufi 453 (Sindicato de Transporte Eduardo Avaroa).
- **Script de datos** `scripts/centro/fetch.ts`:
  - descarga Overpass y elevación Terrarium, con caché local;
  - encadena y valida las rutas (continuidad, sentido de circulación) y repara saltos con la red vial;
  - genera el grafo vial y rellena manzanas.
- **Base de datos PostGIS** (`db/migrations/001_schema.sql`): `users` (rol chofer), `unions`, `vehicles`, `routes` (LINESTRING por sentido ida/vuelta), `stops`, `geofences`, `road_segments`, `vehicle_positions` y `alerts`.
  - Trigger que exige rol chofer para el conductor asignado.
  - Una sola alerta abierta por vehículo y tipo.
- **API Fastify** (`server/`):
  - simulador de flota sobre las rutas reales;
  - alertas en SQL espacial (fuera de ruta, detenido, geocerca, congestión);
  - desvíos dentro del Centro (Dijkstra que respeta sentido único);
  - endpoints REST y stream SSE.
- **Escenarios**: congestión en El Prado (con desvíos sugeridos) y despejar, desvío no autorizado, avería, ingreso a geocerca (Plaza Murillo) y restablecer.
- **Vehículos clicables y seguibles**: ficha con chofer (ficticio), licencia, sindicato, ruta y sentido, velocidad y tiempo sin avanzar; recorrido reciente y cámara que sigue al vehículo.
- **Panel del Centro**:
  - KPIs de flota;
  - fichas de las líneas, con opción de mostrar u ocultar cada una;
  - alertas, que al hacer clic enfocan el vehículo;
  - desvíos sugeridos con nombres de calles;
  - registro de eventos;
  - estado de la API y atribución de OpenStreetMap.
- **Contenedores**: `docker-compose.yml` (PostGIS 17 + API + web) y `server/Dockerfile`. nginx redirige `/api` con el búfer desactivado para SSE.
- **Comprobación de punta a punta** contra PostGIS real (`pnpm --dir server check`): línea base sin alertas falsas y cada escenario abre y cierra su alerta.

### Cambiado
- El material de curvas de nivel se extrajo a `src/city/materials.ts` para compartirlo entre las dos vistas.
- `Sky` acepta un radio, para la escala en metros de la vista del Centro.
- `App.tsx` cambia entre la vista ciudad y la vista Centro (`src/view.ts`).
- En desarrollo, Vite redirige `/api` a `localhost:3001`.
- La línea 453 usa color lavanda para no confundirse con el verde de los desvíos sugeridos.

### Corregido
- Alertas falsas de «fuera de ruta a 0 m» al cambiar de sentido: ahora el cambio de ruta se guarda antes de registrar posiciones y la regla exige 3 muestras reales seguidas.
- El desvío no autorizado elige el rodeo lateral más corto que se aleje al menos 70 m del corredor, para que la alerta se abra y se cierre en alrededor de un minuto.
- El stream SSE reintenta solo cada 5 s si la API se reinicia (EventSource no reintenta ante un 502 del proxy).
- Una geocerca de parada por cada ruta (antes solo se creaba una por nombre de lugar).

## [0.1.1] — 2026-10-15

### Agregado
- `Dockerfile` multi-etapa (build con pnpm, servido por nginx), `nginx.conf` y `.dockerignore`.

### Cambiado
- Las barras de los medidores se animan con `transform: scaleX` en lugar de `width`.

## [0.1.0] — 2026-10-15

### Agregado
- **Gemelo digital conceptual de La Paz 2050**: ciudad 3D procedural con React Three Fiber.
  - Valle andino, meseta de El Alto y cordillera.
  - 7 distritos con edificios instanciados y ventanas procedurales.
  - Avenidas con vehículos animados y sensores con anillos pulsantes.
- **Dashboard** con KPIs de movilidad, eficiencia energética, sensores y alertas; zonas seleccionables; detalle de zona; recomendación basada en reglas; registro de eventos; pantalla completa y ocultar paneles.
- **Modos de visualización**: tráfico, energía y sensores.
- **Simulación de incidente** con fases de detección, respuesta y recuperación, ruta alterna y métricas coherentes.
- Motor de simulación determinista en `src/simulation/`, con comprobación `pnpm check:sim`.
- Vista 2D alternativa si WebGL no está disponible.
