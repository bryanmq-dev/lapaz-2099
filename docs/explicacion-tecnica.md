# LA PAZ 2050 · Explicación técnica

Guía para entender, defender y extender el proyecto: qué es real y qué es simulado, cómo se obtienen los datos, cómo se mueven los buses, cómo se detectan la congestión y los incidentes, y cómo viaja todo hasta la pantalla. Los nombres de archivo y constantes son los del código.

## 1. Qué es el proyecto

Un **gemelo digital** de La Paz con dos vistas:

| Vista | Qué muestra | De dónde salen los datos |
|---|---|---|
| **Ciudad** | Visión conceptual de toda la ciudad: 7 distritos, KPIs, sensores y un incidente con fases de detección, respuesta y recuperación. | Datos inventados; el motor corre en el navegador (`src/simulation/`). |
| **Centro** | El Centro (≈ 3,2 × 2,7 km) reconstruido en 3D, con flota de transporte público, alertas espaciales y desvíos. | Terreno, calles, edificios y rutas **reales** (OSM y SRTM); flota, tráfico y alertas **simulados** en un servidor con PostGIS. |

Esta guía cubre sobre todo la vista Centro, que es la que tiene backend.

### Qué es real y qué no

| Real | Simulado |
|---|---|
| Relieve (3.441–4.087 m), 2.489 calles, 2.343 tramos del grafo vial, 2.180 edificios, plazas, parques, 14 lugares de referencia. | Posición de cada vehículo, velocidades, paradas, colas y semáforo. |
| Recorrido y sindicato de 3 líneas (212, 204, 453), con relación OSM. | Los choferes, licencias, teléfonos y placas (generados). |
| Sentidos únicos y jerarquía de las calles. | Las 28 líneas de refuerzo `S01`…`S28`: calculadas sobre la red real, pero **no existen** como líneas. |
|  | Congestión, alertas, incidentes y la hora punta. |

El proyecto no dice en ningún sitio que los datos simulados sean reales: la interfaz lleva la etiqueta «DEMO · SIMULACIÓN» y las fichas marcan los supuestos.

## 2. Arquitectura

```
                 OpenStreetMap (Overpass)      AWS Terrain Tiles (Terrarium, SRTM)
                            │                              │
                            └──────────┬───────────────────┘
                                       ▼
          scripts/zonas/fetch.ts <zona>  (una vez por zona, con caché)
                                       │
                                       ▼
                          public/zonas/<zona>/*.json
                     ┌─────────────────┴──────────────────┐
                     │ (se sirven tal cual)               │ (el servidor los carga al sembrar)
                     ▼                                    ▼
   Navegador: React 19 + three.js            API Fastify 5 + simulador (Node 24)
   (vista de zona, escena 3D)                server/src/*.ts   ── SQL ──►  PostGIS 17
                     ▲                                    │              (un esquema por zona)
                     └── SSE /api/zones/<zona>/stream ◄───┘   (una «foto» por segundo)
```

- **Front**: Vite + React 19 (con React Compiler) + `@react-three/fiber` y `three`. Sin librería de estado: un objeto mutable (`fleet`) y `useSyncExternalStore` para la vista activa.
- **API**: Fastify 5 + `pg`. Node ejecuta TypeScript directamente (sin paso de compilación); `tsc --noEmit` solo comprueba tipos.
- **Base de datos**: PostGIS 17 (`postgis/postgis:17-3.5`). Geometrías en WGS84 (SRID 4326); las distancias en metros se calculan con `::geography`.
- **Despliegue**: `docker-compose.yml` levanta `db`, `api` y `web` (nginx). nginx sirve el front y redirige `/api` a la API con el búfer desactivado (`proxy_buffering off`), imprescindible para SSE. En desarrollo, Vite redirige `/api` a `localhost:3001`.
- **Arranque de la API** (`server/src/server.ts`): espera a PostGIS → para el Centro: `openZone()` (crea el esquema y aplica `db/migrations/*.sql` pendientes) → `seed()` (datos y flota real, solo si el esquema está vacío) → `seedFleet()` (flota simulada, idempotente) → `sim.init()` → escucha en `:3001`. Después prepara las demás zonas en segundo plano, una tras otra.
- **Zonas** (`shared/zones.ts`): cada zona define su recuadro, el origen de su proyección, su hotspot de hora punta y sus 3 líneas reales. La usan el script de datos, la API y el front.
- **Un esquema de PostgreSQL por zona**: el Centro vive en `public` y las demás en `z_alto`, `z_sopocachi`, etc. Las tablas y las consultas son idénticas; la conexión de cada zona fija su `search_path`. Así las zonas no se mezclan sin tener que agregar una columna `zone` a cada tabla y a cada consulta.
- **Simulación bajo demanda**: una zona solo hace ticks mientras alguien mira su stream (y 60 s más). Seis zonas caben en una laptop modesta.

## 3. Origen de los datos

Todo sale de `scripts/zonas/fetch.ts` (`node scripts/zonas/fetch.ts <zona…|--all>`; `--refresh` descarga de nuevo; `--discover` lista las rutas de transporte de la zona para elegir las líneas). Lo que baja se guarda en `scripts/zonas/.cache/<zona>` (no se versiona) y lo que genera, en `public/zonas/<zona>/`. La tabla completa de fuentes y licencias está en [fuentes.md](fuentes.md). Lo que sigue describe el Centro; las demás zonas usan el mismo proceso con su propio recuadro y origen.

**Recuadro y proyección.** El recuadro es S −16,512 · O −68,150 · N −16,488 · E −68,120. Todo se proyecta a **metros locales** con una equirectangular centrada en la Plaza Murillo: `x = (lon − lon₀)·111320·cos(lat₀)`, `z = −(lat − lat₀)·110574`. El mismo par de fórmulas está en el script, en el servidor (`geo.ts`) y en el front (`data.ts`), de modo que las posiciones coinciden sin conversiones. A esta escala (km) el error frente a una proyección exacta es despreciable.

| Archivo | Fuente | Cómo se obtiene |
|---|---|---|
| `elevation.json` | AWS Terrain Tiles (Terrarium, derivados de SRTM), zoom 15 | Se decodifican los PNG (decodificador mínimo propio) y la altura es `R·256 + G + B/256 − 32768`. Se remuestrea con interpolación bilineal a una malla de **15 m**, con 450 m de margen alrededor del recuadro. |
| `streets.json` | OSM, `way["highway"]` | Vías dibujables, con nombre, jerarquía, sentido único y carriles. |
| `roads.json` | OSM (las mismas vías) | **Grafo vial**: solo vías transitables; cada vía se corta en los nodos compartidos con otras (intersecciones). Resultado: tramos con `source`, `target`, longitud y sentido. |
| `buildings.json` | OSM, `way["building"]` + estimados | 2.180 huellas reales. La altura sale de `height`, o de `building:levels × 3 + 1`, o se estima (más alta junto al eje del Prado). Además se **rellenan** manzanas sin datos con 22.970 lotes estimados sobre una celda de 12 m. |
| `areas.json`, `landmarks.json`, `schools.json` | OSM | Parques y plazas; 14 lugares con nombre (Obelisco, Mercado Lanza…); colegios (para zonas escolares). |
| `routes.json` | OSM, relaciones de ruta | Ver abajo. |
| `lines.json` | Escrito a mano | Ficha de cada línea (sindicato, tarifa, horario, frecuencia) con los supuestos marcados. |

**Rutas del caso de estudio.** OSM tiene ≈ 111 relaciones de transporte en la zona; se eligieron 3 que cruzan por corredores distintos (criterios y fuentes en [caso-estudio-rutas.md](caso-estudio-rutas.md)). Una relación PTv2 es una lista de vías sin garantía de orden ni continuidad, así que `chain()`:

1. ordena y orienta las vías para formar **una sola `LINESTRING`**;
2. si hay un salto de más de 15 m, lo **repara con el camino más corto por la red vial** (`bridge()`), respetando sentidos únicos, y lo deja anotado en `issues`;
3. cuenta las vías recorridas **a contramano** (`wrongWay`) para validar el sentido;
4. recorta al tramo continuo más largo dentro del recuadro (`clipToBox`), porque las líneas salen y vuelven a entrar.

**Flota simulada (`server/src/fleet.ts`).** Las rutas `S01`…`S28` se calculan al sembrar: Dijkstra sobre el grafo entre dos extremos (plazas o bordes del recuadro), con un coste menor en vías `primary/secondary` (×0,75) y mayor en residenciales (×1,5). La ida y la vuelta son caminos distintos porque hay sentidos únicos. No se pidió a OSM que las listara: son una construcción propia y están marcadas `routes.simulated = true`.

**Por qué no se bajaron las ~100 líneas reales.** Overpass estaba saturado al intentarlo y la dependencia de una API inestable para 100 relaciones, cada una con sus saltos y contramanos, no compensaba. La flota simulada sobre calles reales cumple lo que se necesita (tráfico creíble) sin afirmar que sean líneas reales.

## 4. Modelo de datos (PostGIS)

`db/migrations/001_schema.sql` y `002_flota_simulada.sql`:

| Tabla | Contenido y decisiones |
|---|---|
| `users` | Choferes (`role = 'chofer'`), operador. `license_no` único. |
| `unions` | Sindicatos. La flota simulada comparte uno («Flota simulada (refuerzo)»). |
| `routes` | **Un sentido de una línea por fila** (`UNIQUE (code, direction)`). `geom` es `LineString` (no multilínea: un solo trazo continuo), `length_m` es columna generada. `simulated` distingue las líneas inventadas. |
| `stops` | Paradas de referencia con `measure` (0..1 sobre la ruta, `ST_LineLocatePoint`). Se derivan en SQL: inicio, fin y los lugares conocidos a ≤ 120 m de la ruta. |
| `vehicles` | Un chofer por vehículo (`driver_id` único). Un **trigger** impide asignar un usuario que no sea chofer. `reserve` marca las unidades de refuerzo. |
| `geofences` | Plaza Murillo (polígono real, restringida), una por parada/terminal (buffer de 30/45 m) y zonas escolares. |
| `road_segments` | El grafo vial (`congestion`, `oneway`, `source`, `target`). |
| `vehicle_positions` | Una fila por vehículo y segundo (`speed_kmh`, `heading`, `queued`). Índices por `(vehicle_id, ts DESC)` y GiST. Se purgan las de más de 30 min cada 60 ticks. |
| `alerts` | `kind` (`fuera_de_ruta`, `detenido`, `geocerca`, `congestion`), `started_at`, `resolved_at`, `geom`, `detail` (JSON). **Índices únicos parciales**: una alerta abierta por `(vehículo, tipo)` y por `(tramo, tipo)`, que evitan duplicados aunque la regla se evalúe cada segundo. |

## 5. El simulador (`server/src/sim.ts`)

Un único objeto `Simulator` con un **tick de 1 s**. La idea: el movimiento y el tráfico se calculan en TypeScript (determinista), y la **detección de alertas se hace en SQL espacial** sobre lo que se registró en PostGIS.

### 5.1 Un tick

```
tick()
 ├─ runPeak()            programa o termina la hora punta
 ├─ step()               ① cada vehículo decide su velocidad con el estado actual
 │                       ② después todos se mueven (así el orden de la lista no sesga)
 ├─ guardar cambios de sentido (UPDATE vehicles) y posiciones (INSERT … unnest)
 ├─ monitorTraffic()     mide la congestión; abre/cierra alertas; propone/retira desvíos
 ├─ detectAlerts()       SQL espacial: fuera de ruta, detenido, geocerca
 └─ snapshot() → SSE     una «foto» JSON a todos los clientes
```

`busy` impide que dos ticks se solapen. En una máquina normal un tick tarda ~100 ms con ~300 vehículos.

### 5.2 Cómo avanza un bus

Cada vehículo recorre su `Path` (polilínea con longitudes acumuladas): `progress` son los metros recorridos y `path.at(progress)` da posición y rumbo. Los estados (`phase`) son:

- `ruta`: circulando por el Centro.
- `pausa`: terminó su tramo y pasa `LAYOVER_S = 40 s` fuera de la zona (el resto del recorrido real no se dibuja). Después **cambia de sentido** (ida ↔ vuelta, `switchDirection`).
- `reserva`: unidad de refuerzo esperando en base (no aparece en el mapa).

**Seguimiento de vehículo (modelo de Krauss).** La velocidad del siguiente segundo es:

```
next = min( vmax, v + a·dt, v_seguro )
v_seguro = v_líder + (hueco − v_líder·τ) / ( (v + v_líder)/(2b) + τ )
next     = max(0, next − DAWDLE·a·dt·rand)        // vacilación humana
```

con `a = 1,2 m/s²`, `b = 3 m/s²`, `τ = 1 s`, `DAWDLE = 0,3` y un largo de 9 m por vehículo. `vmax` es ≈ 20 km/h (5,6 m/s; 5,0 para trufi) con ±10 % por vehículo. `v_seguro` es la mayor velocidad que permite frenar sin chocar con el de delante; es estable con pasos de 1 s, que es lo que hace falta aquí. El «rand» es una función hash determinista, no `Math.random()`: la simulación es reproducible.

**Quién va delante (`leaderOf`).** Se busca el vehículo más cercano en un radio de 60 m que esté por delante en el rumbo propio, con desviación lateral < 4 m y rumbo parecido (< 50°). Así el modelo funciona también donde se juntan varias líneas en la misma calle, sin necesidad de que compartan ruta. Dos detalles importantes:

- **Prioridad al confluir.** Si los rumbos difieren más de 12° (dos flujos que se unen), solo cede el de **id mayor**. Sin esta regla aparecían bloqueos circulares (A espera a B, B a C, C a A) y decenas de vehículos quedaban parados para siempre; con ella un ciclo es imposible.
- **Un solo carril por sentido.** Es una simplificación deliberada (ver límites): hace que una parada o una avería bloquee a los de atrás, que es justo lo que se quiere observar.

**Paradas (`dwell`).** Al llegar a una parada de su ruta el vehículo se detiene **en el carril**. La mitad de las veces nadie sube ni baja (0 s); si no, dura `2 + (id mod 5)·0,8 + 5·rush` s, donde `rush` vale 1 en hora punta. El agente de tránsito la reduce al 40 %.

**Semáforo del Obelisco (`green`).** Las rutas que lo cruzan llevan una línea de pare 14 m antes del punto. Dos fases: A (Prado y Mcal. Santa Cruz) y B (Camacho), con ciclo de **62 s** (A 30 s, B 26 s, 3 s de despeje entre fases). En rojo la línea actúa como un vehículo parado delante, salvo que ya no alcance a frenar. Es un **supuesto**: no hay datos públicos de sus tiempos.

### 5.3 La flota

| Grupo | Vehículos | Detalle |
|---|---|---|
| Líneas reales | 10 (212) + 8 (204) + 8 (453) = 26 | `server/src/db.ts`, `FLEET`. |
| Simulada, en servicio | 224 | 14 líneas que cruzan el Obelisco (3 c/u) y 14 que no (13 c/u). |
| Simulada, refuerzo | 50 | En 12 de las líneas que cruzan el Obelisco; en base hasta la hora punta. |

Son **242 minibuses** en servicio (más 8 trufis) y 292 en hora punta. Al arrancar se reparten uniformemente a lo largo de su ruta con un desfase propio de cada vehículo.

### 5.4 La hora punta (el origen de la congestión)

La congestión **no se impone**. Se provoca la causa y se deja que el sistema reaccione:

1. `startPeak()` programa la salida de las 50 unidades de refuerzo. Cada una parte de una plaza a menos de 1 km del Obelisco, de modo que llegue a 300 m del Obelisco dentro de una ventana de `SURGE_WINDOW_S = 90 s`.
2. Hay tres accesos: la **Av. Camacho** (15 unidades), la **Mcal. Santa Cruz** (desde San Pedro y San Francisco) y **El Prado** (desde la Plaza del Estudiante).
3. Llegan 50 unidades en 90 s (≈ 33 por minuto, repartidas en tres accesos) además del tráfico normal, a un cruce cuya fase verde deja pasar del orden de 10 a 12 vehículos por minuto en cada acceso (estimación a partir de un arranque de ~2 s por vehículo y una fase de 30 s). Los que no pasan hacen cola, la cola frena a los que llegan detrás y se propaga hacia atrás por el Prado, la Santa Cruz y la Camacho.

Se dispara sola 20 s después de iniciar y cada 480 s, o con el botón «Hora punta en El Prado». En la prueba de punta a punta la alerta aparece a los 117 s y la cola se disuelve a los 435 s (tiempo simulado), con ~20 vehículos en cola en el Prado y ~12 en la Camacho.

### 5.5 Cómo se detecta la congestión (`monitorTraffic`)

1. **Medir.** Cada tick se agrupa a los vehículos por tramo vial (el tramo más cercano cada 10 m de su ruta, precalculado en `segAt`). Un tramo con **≥ 3 vehículos** tiene `raw = 1 − velocidad_media / 4,5 m/s`, acotado a [0, 1]. Con menos vehículos, 0.
2. **Suavizar.** `congestión = 0,8·anterior + 0,2·raw`: una media móvil (~5 s) evita parpadeos.
3. **Histéresis.** Un tramo pasa a «congestionado» con ≥ 0,55 y deja de serlo con < 0,35 (`jammed`). Así el mapa no cambia cada segundo.
4. **Agrupar por calle.** Se suman los metros de tramos congestionados de cada calle. Se abre una alerta cuando la calle lleva **≥ 12 s** con **≥ 150 m** congestionados y la velocidad media de los vehículos dentro es **< 9 km/h** (`openJam`). El `detail` guarda calle, tramos, largo, vehículos y velocidad; si está a menos de 350 m del Obelisco se añade «(zona Obelisco)». El punto de la alerta (`alerts.geom`) es el centro del tramo más lento.
5. **Cerrar.** Cuando quedan < 40 m congestionados durante **25 s** se cierra (`resolved_at`).
6. **No alertar al arrancar.** Durante 45 s tras un reinicio no se abren alertas: los vehículos parten superpuestos y se reparten.

Las alertas de congestión se guardan en `alerts` con `road_segment_id` (no con `vehicle_id`); el índice único parcial por tramo evita duplicados.

### 5.6 Desvíos

Al abrirse una congestión, `applyDetours()` busca para cada ruta que cruza tramos congestionados un rodeo por la red vial:

- Entrada y salida: 40 m antes y después del tramo afectado.
- **Dijkstra con cola de prioridad** (`graph.ts`). Coste de un tramo = `longitud × (1 + 8·congestión)`; los tramos con congestión ≥ 0,55 se consideran bloqueados; respeta los sentidos únicos; no sale del recuadro.
- Solo se desvían los vehículos que **aún no llegaron** a la entrada del desvío (los que ya están en la cola no pueden salir). Su estado pasa a `desvio_autorizado`, que se guarda **antes** de evaluar alertas para que no cuenten como «fuera de ruta».
- El segmento vial de cada 10 m se reutiliza de la ruta base antes y después del desvío: solo se vuelve a calcular el tramo nuevo (de ~2–5 s a ~0,4 s en total).
- Al cerrarse la última congestión, `clearDetours()` retira los desvíos.
- El panel lista los desvíos de las 3 líneas reales; los de la flota simulada se aplican en silencio y se resumen en un evento.

## 6. Detección de alertas con SQL espacial

`detectAlerts()` es **una sola consulta** con CTEs, evaluada cada segundo sobre las posiciones de los últimos segundos:

| Regla | Condición | Detalle |
|---|---|---|
| `fuera_de_ruta` | Las últimas ≥ 3 muestras (3,5 s) están **todas** a más de 40 m de la ruta asignada. | `ST_DWithin(posición::geography, ruta::geography, 40)`. Se ignora si el vehículo está en `desvio_autorizado`. Exigir 3 muestras evita falsos positivos al cambiar de sentido. |
| `detenido` | Velocidad < 2 km/h durante 45 s. | **No** cuenta si está en una geocerca de parada o terminal, ni si estuvo **en cola** (`queued`) en ese tiempo. La cola de tráfico no es una anomalía. |
| `geocerca` | La posición cae dentro de una geocerca `restringida`. | `ST_Intersects`. Hoy: Plaza Murillo. |

La misma consulta **abre** (`INSERT … ON CONFLICT DO NOTHING`) y **cierra** (`UPDATE … resolved_at`) las alertas: abre las nuevas de la lista «actual» y cierra las que dejaron de cumplirse. Los eventos del registro se derivan de lo que `RETURNING` devuelve.

El flag `queued` lo calcula el simulador: es verdadero si el vehículo está frenado por el de delante a menos de 25 m, o por una luz roja.

## 7. Incidentes y escenarios

`POST /api/scenarios/:id`. Todos terminan siendo **eventos en la simulación** que las reglas anteriores detectan solas:

| Escenario | Qué hace | Qué se detecta |
|---|---|---|
| `congestion` (Hora punta en El Prado) | Libera las 50 unidades de refuerzo. | Congestión emergente en Prado / Santa Cruz / Camacho; desvíos. |
| `despejar` (Despejar El Prado) | Agente de tránsito durante 150 s: paradas al 40 %, 46 s de verde para el Prado y el refuerzo pendiente se queda en base. | La congestión se resuelve antes. |
| `desvio` | Un minibús de la 204 deja su ruta por la calle lateral que más se aleje del corredor (≥ 70 m) y se reincorpora más adelante. Se elige el rodeo más corto (Dijkstra con penalización a las calles de su propia ruta). | `fuera_de_ruta`; se cierra al volver. |
| `averia` | Un trufi de la 453 se detiene 100 s lejos de las paradas (`BREAKDOWN_S`). Los de atrás hacen cola. | `detenido` solo para el averiado; los de la cola no alertan. |
| `geocerca` | Un minibús de la 204 corta camino por la Plaza Murillo. | `geocerca`. |
| `reset` | Restablece todo: congestión, alertas, posiciones, desvíos y refuerzo en base. | — |

## 8. API y tiempo real

| Endpoint | Para qué |
|---|---|
| `GET /api/stream` | **SSE**. Una foto por tick: vehículos, alertas (con `lon/lat`), tramos congestionados, desvíos, métricas, eventos. |
| `GET /api/vehicles/:id` | Ficha (chofer, licencia, sindicato, ruta), recorrido de los últimos 90 puntos, alertas y segundos sin avanzar. |
| `GET /api/alerts[?active=1]`, `/api/routes`, `/api/stops`, `/api/geofences` | Consultas en GeoJSON/JSON. |
| `POST /api/scenarios/:id` | Dispara un escenario. |
| `GET /api/health` | Estado: tick y vehículos. |

SSE y no WebSocket porque el flujo es unidireccional (servidor → cliente) y `EventSource` reconecta solo. Pero no reintenta ante un 502 del proxy (API reiniciándose), así que `useFleet` reintenta cada 5 s por su cuenta. Una foto con ~290 vehículos pesa ~45 KB; no se comprime ni se diferencia porque a 1 Hz sobra.

## 9. El front de la vista Centro

**Flujo de datos.** `useFleet` abre el `EventSource` y, por cada foto: (1) actualiza un objeto mutable `fleet` (posiciones anterior y actual) que la escena 3D lee en cada frame; (2) hace `setSnap` para los paneles de React, que solo se renderizan una vez por segundo. Los vehículos **no pasan por el estado de React**: `vehiclePos()` interpola entre la foto anterior y la actual según el reloj del frame, de modo que se mueven suaves a 60 fps aunque lleguen datos a 1 Hz.

**Escena.** `CentroScene` (react-three-fiber):
- Terreno (malla con material de curvas de nivel), calles (asfalto, secundarias, brillo en las principales), 25.000 edificios en **una sola malla** (`buildingsGeometry`: extrusión propia de cada huella, con coordenadas de fachada) cuyas ventanas se dibujan en el shader, más parques y plazas.
- Vehículos en dos `InstancedMesh` (cuerpos y marcadores), hasta 400. El color depende de la línea y del estado (alerta, avería, desvío, congestión). La flota simulada va en gris con marcador discreto.
- Los tramos congestionados y los desvíos se dibujan como cintas animadas drapeadas sobre el terreno, que se regeneran solo cuando cambia el conjunto de tramos.
- Las geocercas son volúmenes translúcidos.

**Interacción.**
- Clic en un vehículo o en una alerta de vehículo: ficha del chofer, recorrido reciente y cámara que lo sigue.
- **Clic en el anuncio o en la alerta de una congestión**: la cámara vuela al punto (`CameraRig`: interpolación exponencial de objetivo y posición, a ~420 m, con la misma orientación que la vista general). El punto viene de `alerts.geom` (`ST_X/ST_Y`) a través del stream. El botón «Ver en el mapa» hace lo mismo con teclado.
- «Vista general» devuelve la cámara al inicio y cancela cualquier vuelo.

**Modo claro y oscuro.** `src/theme.ts` guarda el tema (`localStorage`, con `try/catch` por si el navegador lo bloquea) y lo aplica como `data-theme` en `<html>`; el oscuro es el predeterminado. Hay dos capas:
- **Interfaz**: todo el CSS usa variables (`--panel-a`, `--text`, `--btn-red`…). `:root[data-theme="light"]` redefine solo esas variables, así que no hay una hoja de estilos paralela.
- **Escenas 3D** (`SCENE` en `theme.ts`): cielo, niebla, luces, terreno, edificios, calles, parques y geocercas cambian de paleta con `useTheme()`. El terreno y los edificios llevan el color en los vértices, así que se **regeneran** al cambiar de tema; el cielo solo actualiza sus uniformes. De día los edificios no tienen ventanas encendidas (se oscurecen los vidrios) y las geocercas dejan la mezcla aditiva, que no se ve sobre fondo claro.
- **Buses**: las 3 líneas reales conservan su color en ambos temas. La flota simulada (la de relleno que provoca la congestión) es gris en oscuro y **negra en claro** (`FILLER_BUS`).

**Ocultar paneles.** El botón de la cabecera (igual que en la vista Ciudad) añade `hud-min`, que oculta las columnas laterales y los KPIs y deja la barra de escenarios, el anuncio de congestión y la cabecera. En móvil los paneles ya van ocultos y el botón no se muestra.

**Responsive.** En ≤ 720 px se ocultan los paneles laterales, el encabezado se compacta y los 4 escenarios pasan a una cuadrícula de 2 columnas sobre un fondo casi opaco. En ≤ 1050 px se oculta el panel derecho. Los botones del Centro tienen fondo casi sólido para leerse sobre el mapa.

**Modo VR / realidad mixta (Meta Quest 3).** La misma escena se puede ver como una **maqueta sobre una mesa** con WebXR (`@react-three/xr`). Fuera de una sesión XR nada cambia; los botones «VR» y «Mixta» de la cabecera solo aparecen si el navegador soporta WebXR.
- **Escala** (`VR` en `src/centro/xr.ts`): en XR 1 unidad = 1 m, y el Centro mide 4,1 km. `VrTable` mete los mismos componentes (`Static`, `Routes`, `Geofences`, `TrafficLayers`, `Vehicles`) en un grupo escalado a `VR.scale` (0.00025 → ~1 m) y centrado ante el usuario. Por eso el plano cercano de la cámara baja de 2 m a 2 cm mientras dura la sesión.
- **Qué se apaga en XR**: cielo, niebla, `OrbitControls` y `CameraRig` (la cabeza manda). En «Mixta» tampoco hay color de fondo, para que se vea el passthrough. Los rótulos `<Html>` (DOM, invisibles en el visor) pasan a `<Text>` de drei con una fuente local (`public/fonts/`), y los edificios bajos sin nombre se omiten (`VR.minBuildingH`) para aligerar la escena.
- **Interacción**: los rayos de los controles disparan los mismos `onClick` de los buses. La **base** de la maqueta es el único asa de `@react-three/handle`: con un control se mueve y gira en Y, con los dos se escala (si la asa fuera la ciudad, cada clic sobre un bus también arrastraría la maqueta). Las balizas de los vehículos se miden en coordenadas de la ciudad (`worldToLocal`) y se agrandan ×`VR.beacon` para poder apuntarlas.
- **Panel** (`VrPanel`): KPIs, anuncio de congestión, los 4 escenarios (más «Despejar»), interruptores de las 3 líneas, ficha del bus seleccionado y «Vista general» (devuelve la maqueta a su sitio). Es 3D, no DOM; los datos son los mismos que los del HUD.
- **Acceso**: WebXR exige contexto seguro. Por USB: `adb reverse tcp:5173 tcp:5173` y abrir `http://localhost:5173#centro` en el Quest (el proxy `/api` de Vite cubre la API). Por Wi-Fi: `HTTPS=1 pnpm dev` (certificado autofirmado: Avanzado → continuar) o un túnel. La laptop debe tener la BD y la API levantadas.
- **Rendimiento**: el Quest 3 renderiza dos ojos con GPU móvil. Perillas en `xr.ts`: `minBuildingH`, `foveation`, `frameBufferScaling`. Meta: 72 FPS con la hora punta.

**XR en otros dispositivos.** Los botones de la cabecera (`VrEnter.tsx`) dependen de lo que ofrece el navegador:
- **Android con ARCore** (`immersive-ar` en una sesión de pantalla, `interactionMode === 'screen-space'`): una retícula sigue la superficie que mira la cámara (`useXRHitTest`) y la maqueta (a la mitad de tamaño) se coloca con un botón. El panel es HTML sobre la cámara (`XRDomOverlay`, en `ArPhone.tsx`), porque el panel 3D sería ilegible en un teléfono.
- **iPad y iPhone**: no hay WebXR en ningún navegador (todos usan WebKit). El botón exporta la maqueta a **USDZ** (`USDZExporter` de three, `quicklook.ts`) y la abre en **AR Quick Look**, que la apoya sobre una mesa real. Es una foto del momento: solo edificios reales de OSM, terreno a un tercio de resolución, avenidas, las 3 rutas y los vehículos donde están. El iPad se presenta como Mac; se reconoce por ser táctil.
- **Tabletas y teléfonos sin ningún modo**: el botón aparece atenuado y, al tocarlo, explica por qué.

**Rendimiento en dispositivos modestos.**
- **Carga diferida**: la vista de zona (y con ella XR) se descarga solo al abrir una zona (`React.lazy`).
- **Web Worker** (`geoWorker.ts`): edificios, calles y áreas se descargan, parsean y construyen fuera del hilo principal; las geometrías vuelven como buffers transferidos (sin copia). Antes, construir ~25.000 edificios congelaba la página en un teléfono.
- **Niveles de calidad** (`quality.ts`): alta, media o baja según `deviceMemory`, núcleos y si es táctil. `PerformanceMonitor` (drei) baja el nivel si los FPS caen de forma sostenida. El nivel bajo usa resolución 1×, sin antialias, omite los edificios bajos sin nombre, cambia el shader de ventanas por un material Lambert y muestra menos rótulos. Se puede forzar con `?calidad=`.
- **Vehículos**: una malla instanciada por tipo (minibús y trufi), sin arrays nuevos por frame.

**Vehículos.** Minibús: modelo propio de la Toyota HiAce H200 de techo alto (`minibus.ts`, ~430 triángulos, medidas de la ficha técnica). Trufi: station wagon. La carrocería es blanca en el color de vértice y el color de instancia (línea o estado) la tiñe; vidrios, llantas y parachoques son oscuros y siguen oscuros. Se dibujan 2,2 veces más grandes que su tamaño real (`VEHICLE_SCALE`) para leerse a escala de ciudad.

**Vista Ciudad.** Aparte, `src/simulation/simulationEngine.ts` es un motor determinista por pasos (siete distritos, KPIs derivados, incidente con fases de detección, respuesta y recuperación, y Dijkstra sobre un grafo de avenidas para la ruta alterna). Se comprueba con `pnpm check:sim`.

## 10. Comprobaciones

| Comando | Qué cubre |
|---|---|
| `pnpm exec tsc -b && pnpm lint && pnpm build` | Tipos, lint (oxlint) y build del front. |
| `pnpm check:sim` | El motor de la vista ciudad. |
| `pnpm --dir server typecheck` | Tipos del servidor. |
| `pnpm --dir server check` | **De punta a punta contra PostGIS real**, en una base aparte (`lapaz_check`). 28 comprobaciones. |

`server/src/check.ts` verifica, entre otras cosas: ≥ 200 minibuses en servicio; las 50 unidades de refuerzo no aparecen en el mapa; el tráfico normal no congestiona; la hora punta no se duplica; la congestión **aparece sola** y la alerta indica la zona del Obelisco; se proponen desvíos que no salen del Centro; se resuelve sola al pasar el refuerzo; y cada incidente (desvío, avería, geocerca) abre y cierra su alerta. Corre en **tiempo real** porque las ventanas de SQL usan `now()`; las partes de congestión avanzan el reloj de la simulación sin esperar.

## 11. Parámetros ajustables

Todos son constantes al inicio de `server/src/sim.ts` (salvo los marcados):

| Constante | Valor | Efecto |
|---|---|---|
| `VEH_LEN`, `ACCEL`, `DECEL`, `TAU`, `DAWDLE` | 9 m, 1,2, 3, 1 s, 0,3 | Dinámica de seguimiento: densidad de cola, rapidez de arranque, irregularidad. |
| `SURGE_WINDOW_S` | 90 | Cuánto se reparte la llegada del refuerzo. Menos = cola más brusca. |
| `PEAK_EVERY_S` | 480 | Separación entre horas punta automáticas. `AUTO_PEAK=0` las desactiva. |
| `JAM_ON`, `JAM_OFF` | 0,55 / 0,35 | Histéresis de un tramo congestionado. |
| `JAM_FREE_MS` | 4,5 m/s | Velocidad a la que un tramo cuenta como libre. |
| `JAM_MIN_M`, `JAM_OPEN_KMH` | 150 m, 9 km/h | Cuánto y qué tan lento debe ser para abrir una alerta. |
| `OFF_ROUTE_M`, `STOP_ALERT_S`, `BREAKDOWN_S` | 40 m, 45 s, 100 s | Reglas de alerta e incidente (los dos últimos, por variable de entorno). |
| `green()` | 30 / 26 / 3 s | Ciclo del semáforo. |
| `LINES` (`fleet.ts`) | 28 líneas | Extremos y unidades de cada línea simulada. |
| `MAX` (`FleetLayers.tsx`) | 400 | Tope de vehículos dibujados. |

## 12. Límites y supuestos

- **Un solo carril por sentido.** Una parada bloquea a los de atrás; en la vida real se adelantan. Sobreestima las colas. Mejora posible: carriles y cambio de carril (MOBIL).
- **Sin conflictos en cruces.** Dos flujos que se cruzan no se bloquean entre sí; solo la prioridad por id al confluir y el semáforo del Obelisco.
- **Un solo semáforo**, con tiempos supuestos.
- **Demanda no calibrada.** La hora punta es un experimento (50 unidades en 90 s), no una curva de demanda medida. No hay datos de aforo.
- **Líneas simuladas.** Son rutas plausibles, no las reales. Los choferes y placas son ficticios.
- **Retención de posiciones** de 30 min y sin particionar; suficiente para una demo.
- **Escala de la simulación.** O(n²) en la búsqueda de líder: con ~300 vehículos son ~90.000 pares por tick (despreciable); con miles habría que usar una malla espacial.
- **Posición exagerada.** Los vehículos se dibujan ×1,6 y con un marcador de tamaño ~constante en pantalla para que se lean a escala ciudad.

## 13. Guion para explicarlo (5 minutos)

1. **Qué es** (30 s). Gemelo digital del Centro de La Paz: ciudad real en 3D, flota y tráfico simulados, alertas espaciales en PostGIS.
2. **De dónde sale la ciudad** (45 s). OpenStreetMap y SRTM, descargados una vez por un script con caché, proyectados a metros locales. Las rutas de OSM se encadenan y se validan (saltos, contramanos).
3. **Cómo se mueven los buses** (60 s). Tick de 1 s. Cada bus sigue al de delante (Krauss), se para en el carril en las paradas y obedece un semáforo. Al terminar su tramo espera 40 s fuera y vuelve en sentido contrario.
4. **Cómo aparece la congestión** (60 s). No se programa: 50 unidades de refuerzo llegan en 90 s a un cruce que deja pasar ~12 por minuto. La cola se mide por la velocidad real de los vehículos en cada tramo (media móvil + histéresis) y por calle se abre la alerta.
5. **Cómo se detectan incidentes** (45 s). Una consulta SQL por segundo con `ST_DWithin` / `ST_Intersects` sobre las posiciones: fuera de ruta, detenido, geocerca. La cola no cuenta como «detenido».
6. **Cómo llega a la pantalla** (45 s). SSE a 1 Hz; los vehículos se interpolan por frame fuera de React; un clic en una congestión vuela la cámara al lugar.
7. **Qué es de verdad y qué no** (15 s). Relieve, calles, edificios y 3 líneas son reales; todo lo demás es simulación, y está marcado.

### Preguntas probables

- **¿Por qué no usar datos reales de tráfico?** No hay una fuente abierta de aforo ni de posiciones de minibuses en La Paz. Por eso el tráfico es simulado y la interfaz lo declara.
- **¿Por qué la congestión se mide en vez de ponerla a mano?** Porque así las alertas y los desvíos se prueban contra un fenómeno real del modelo (un cuello de botella saturado), no contra un número que fijamos. Si cambias el semáforo o las paradas, la congestión cambia sola.
- **¿Por qué SQL espacial para las alertas?** Para que las reglas sean consultas declarativas y auditables sobre datos persistidos, con índices GiST, y no lógica dispersa en código. El simulador solo mueve cosas; no «sabe» qué es una alerta.
- **¿Por qué SSE y no WebSocket?** Flujo unidireccional, reconexión automática y funciona detrás de nginx con una línea de configuración.
- **¿Es determinista?** El movimiento sí (funciones hash en vez de `Math.random`). Lo que depende del reloj real son las ventanas de SQL, por eso la comprobación corre en tiempo real.
- **¿Escala?** Para esta demo sí (~100 ms por tick con ~300 vehículos). Los cuellos de botella conocidos son la búsqueda de líder O(n²) y la inserción de posiciones; ambos tienen solución directa (malla espacial, `COPY`).
