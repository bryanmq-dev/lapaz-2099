# Fuentes de datos, modelos y supuestos

Este documento reúne **de dónde sale cada dato** del proyecto, con su licencia, el método y el script que lo genera. Sirve para la defensa: cualquier número o forma que aparezca en pantalla se puede rastrear hasta aquí.

> **Regla general.** Las calles, los edificios, el relieve, los lugares y los recorridos de las líneas son **reales** (OpenStreetMap y elevación satelital).
> Los **choferes, placas, licencias y teléfonos son ficticios**. El **movimiento de los vehículos, la congestión y las alertas son simulados**.
> Todo lo que no tiene una fuente se marca como **supuesto**.

## 1. Zonas con vista detallada

Configuración en [`shared/zones.ts`](../shared/zones.ts). Los datos se generan con `node scripts/zonas/fetch.ts <zona>` y quedan en `public/zonas/<zona>/`.

| Zona | Recuadro (S, O, N, E) | Origen de coordenadas | Hotspot de hora punta | Detalle |
|---|---|---|---|---|
| Centro | −16.512, −68.150, −16.488, −68.120 | Plaza Murillo | El Prado (Obelisco) | [caso-estudio-rutas.md](caso-estudio-rutas.md) |
| El Alto | −16.522, −68.182, −16.498, −68.152 | La Ceja | La Ceja | [zonas/alto.md](zonas/alto.md) |
| Sopocachi | −16.526, −68.142, −16.502, −68.112 | Plaza Abaroa | Plaza Abaroa | [zonas/sopocachi.md](zonas/sopocachi.md) |
| Calacoto | −16.552, −68.096, −16.528, −68.066 | Calle 21 de Calacoto | Av. Ballivián y Calle 21 | [zonas/calacoto.md](zonas/calacoto.md) |

Cada recuadro mide unos 3,2 × 2,7 km, como el del Centro. Los hotspots son una **elección del proyecto**: un cruce de avenidas troncales donde convergen varias líneas. No vienen de un estudio de tráfico.

## 2. Datos geográficos

Una fila por archivo de `public/zonas/<zona>/`. Todos los genera [`scripts/zonas/fetch.ts`](../scripts/zonas/fetch.ts). La fecha de cada zona está en su `meta.json` (`generated`).

| Archivo | Contenido | Fuente | Licencia | Método |
|---|---|---|---|---|
| `elevation.json` | Grilla de alturas cada 15 m (+450 m de margen) | [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/), formato Terrarium, zoom 15. Fuentes de origen: SRTM, ASTER GDEM y otras ([atribución](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)) | Datos abiertos (ver atribución) | Interpolación bilineal de los mosaicos; alturas en decímetros sobre el punto más bajo |
| `streets.json` | Vías con nombre, jerarquía, sentido único y carriles | [OpenStreetMap](https://www.openstreetmap.org/copyright) vía [Overpass API](https://overpass-api.de/) | ODbL | `way["highway"](recuadro)` |
| `roads.json` | Grafo vial (tramos entre intersecciones) para la congestión y los desvíos | OpenStreetMap | ODbL | Cada vía transitable se corta en los nodos que comparte con otras vías |
| `buildings.json` y `buildings-extra.json` | Huellas de edificios con altura (el segundo: lotes estimados de menos de 11 m, que la calidad baja no descarga) | OpenStreetMap + **estimación** | ODbL | Altura: `height` o `building:levels × 3 m + 1 m` si existen en OSM. Si no hay dato, se **estima**: más alto cerca del eje principal de la zona (`tall` en `zones.ts`) y más bajo en las laderas. Los edificios con `e: 1` son **lotes estimados** que rellenan manzanas sin datos en OSM (ver `infill()`) |
| `areas.json` | Parques, plazas, canchas y áreas peatonales | OpenStreetMap | ODbL | `leisure`, `place=square`, `highway=pedestrian` + `area=yes`, `landuse=grass/recreation_ground` |
| `landmarks.json` | Hitos rotulados en el mapa | OpenStreetMap | ODbL | Centro: lista fija. Demás zonas: plazas, mercados y parques con nombre, separados ≥ 350 m, hasta 12 |
| `schools.json` | Unidades educativas (geocercas escolares de 20 km/h) | OpenStreetMap | ODbL | `amenity=school` con nombre |
| `routes.json` | Recorrido de las 3 líneas reales dentro del recuadro | OpenStreetMap (relaciones de ruta PTv2) | ODbL | Las vías de cada relación se encadenan en una sola línea orientada; los saltos se reparan por la red vial y se anotan en `issues` |
| `lines.json` | Ficha de cada línea (sindicato, tarifa, horario, frecuencia) | Fuentes públicas citadas en el documento de cada zona | — | Escrito a mano; los campos sin fuente se listan en `assumed` |
| `meta.json` | Recuadro, origen, hotspot, fecha y atribución | — | — | Generado |

**Atribución que muestra la app:** «© OpenStreetMap contributors (ODbL) · Elevación: AWS Terrain Tiles (SRTM y otras fuentes)».

**Consultas Overpass** (con `(recuadro)` = `S,O,N,E` de la zona):
- Calles: `way["highway"](recuadro); out body geom;`
- Edificios: `way["building"](recuadro); out tags geom;`
- Áreas: `(way["leisure"~"^(park|garden|pitch|playground)$"]; way["place"="square"]; way["highway"="pedestrian"]["area"="yes"]; way["landuse"~"^(grass|recreation_ground)$"];)(recuadro); out tags geom;`
- Hitos: `nwr["name"](recuadro)["name"~"<palabras de la zona>",i]; out center tags;`
- Escuelas: `nwr["amenity"="school"]["name"](recuadro); out center tags;`
- Rutas: `relation(id:<ida>,<vuelta>,…); out geom;`
- Descubrimiento de líneas: `rel(recuadro)[type=route][route~"^(bus|minibus|share_taxi)$"]; out tags;` y, por lotes, `rel(id:…); out tags geom(recuadro);`

## 3. Líneas de transporte

Por zona se eligieron **3 líneas reales de minibús** (o de trufi si OSM no tiene 3 minibuses completos), con estos criterios:
1. Relación OSM en formato PTv2, con **ida y vuelta** como relaciones separadas.
2. **Mayor recorrido dentro del recuadro**, para que la línea sea propia de la zona y no solo la cruce.
3. Corredores distintos entre sí, cuando es posible.
4. Respaldo en fuentes públicas fuera de OSM para el operador, el horario o la frecuencia.

Las fichas, con un enlace a cada relación OSM, están en el documento de cada zona (tabla de la sección 1). El Centro está documentado en [caso-estudio-rutas.md](caso-estudio-rutas.md).

**Tarifas de La Paz** (minibús Bs 3,00 tramo corto · Bs 3,50 tramo largo, diurna): [Correo del Sur, 25-dic-2025](https://correodelsur.com/sociedad/20251225/en-la-paz-rigen-nuevas-tarifas-de-transporte-publico.html). Las líneas que nacen en El Alto pueden regirse por tarifas de ese municipio; en ese caso se marca en la ficha.

**Lo que es simulado:** la cantidad de vehículos por línea (8 por defecto; en el Centro, 10/8/8), los choferes y las placas, y la **flota de relleno** (líneas `S01…`): rutas calculadas como el camino más corto por la red vial real entre hitos de la zona y los bordes del recuadro. **No son líneas reales.**

## 4. Modelos 3D

| Modelo | Qué representa | Fuente | Método |
|---|---|---|---|
| Minibús | Toyota HiAce H200 de techo alto («Super Long», carrocería ancha), la van más común en las líneas de minibús de La Paz | Medidas: largo 5.380 mm, ancho 1.880 mm, alto 2.285 mm, distancia entre ejes 3.110 mm ([auto-data.net, HiAce H200 Super Long](https://www.auto-data.net/en/toyota-hiace-v-h200-facelift-2013-van-super-long-2.7l-160hp-4wd-super-ect-56559)). El ancho de 1.880 mm de las versiones largas lo confirma [Toyota](https://www.toyota-global.com/company/history_of_toyota/75years/vehicle_lineage/car/id60015464/index.html). Llanta 195/80 R15 (Ø ≈ 0,69 m) | **Modelo propio**, procedural ([`src/centro/minibus.ts`](../src/centro/minibus.ts)): silueta lateral extruida, banda de ventanas, parabrisas, ventana trasera, 4 ruedas, faros, luces traseras y parachoques. ~430 triángulos, sin texturas |
| Trufi | Automóvil tipo station wagon | Medidas aproximadas de un station wagon compacto (≈ 4,3 × 1,7 × 1,5 m): **supuesto** | Mismo método (~380 triángulos) |
| Edificios, terreno, calles | Ver la sección 2 | OSM + elevación | Geometría generada en el navegador (Web Worker) |

La **imagen de referencia** del minibús que se usó para las proporciones es de un banco de imágenes (con marca de agua). **No se incluye en el proyecto ni se reprodujo**: el modelo solo toma las medidas de la ficha técnica y la forma general del vehículo.

En la escena los vehículos se dibujan **2,2 veces más grandes** que su tamaño real (`VEHICLE_SCALE`), para que se distingan a escala de ciudad.

## 5. Modelos de simulación

| Modelo | Uso | Referencia |
|---|---|---|
| Seguimiento de vehículo de Krauss | Velocidad segura detrás del vehículo de adelante (minibús ≈ 9 m con holgura, 1,2 m/s² de aceleración, 3 m/s² de frenada, vacilación 0,3) | S. Krauß, *Microscopic Modeling of Traffic Flow: Investigation of Collision Free Vehicle Dynamics*, tesis doctoral, DLR, 1998. Es el modelo por defecto de [SUMO](https://sumo.dlr.de/docs/Definition_of_Vehicles%2C_Vehicle_Types%2C_and_Routes.html#car-following_models) |
| Detección de congestión con histéresis | Un tramo se marca congestionado con nivel ≥ 0,55 y se libera con < 0,35 (media móvil de la velocidad medida); la alerta exige ≥ 150 m de tramos y ≤ 9 km/h | Parámetros propios (**supuestos**, calibrados en la simulación) |
| Desvíos | Camino más corto (Dijkstra) por la red vial real, respetando sentidos únicos y evitando tramos congestionados | Grafo de `roads.json` |
| Alertas espaciales | Fuera de ruta (> 40 m), detenido (> 45 s fuera de paradas), ingreso a geocerca | Consultas SQL de PostGIS (`ST_DWithin`, `ST_Intersects`, `::geography`) en `server/src/sim.ts` |
| Semáforo del hotspot | Dos fases (30 s / 26 s, con 3 s de despeje) | **Supuesto** de la simulación |
| Hora punta | ~50 unidades de refuerzo que llegan al hotspot en una ventana de 90 s, cada 8 min | **Supuesto** de la simulación |

## 6. Software y licencias

| Componente | Uso | Licencia |
|---|---|---|
| [three.js](https://threejs.org/) | Gráficos 3D, exportador USDZ | MIT |
| [React Three Fiber](https://r3f.docs.pmnd.rs/) y [drei](https://drei.docs.pmnd.rs/) | Escena declarativa, controles, texto 3D, monitor de rendimiento | MIT |
| [@react-three/xr](https://pmndrs.github.io/xr/docs/) y @react-three/handle | WebXR (VR, realidad mixta, hit-test, dom-overlay) y manipulación de la maqueta | MIT |
| [Fastify](https://fastify.dev/) | API y stream SSE | MIT |
| [PostgreSQL](https://www.postgresql.org/) + [PostGIS](https://postgis.net/) | Base de datos espacial | PostgreSQL License / GPL-2.0 |
| [Noto Sans](https://fonts.google.com/noto/specimen/Noto+Sans) | Rótulos en VR | SIL Open Font License |
| [lucide](https://lucide.dev/) | Iconos | ISC |

## 7. Compatibilidad de XR (investigación)

| Plataforma | Qué ofrece | Fuente |
|---|---|---|
| Meta Quest (navegador del visor) | `immersive-vr` y `immersive-ar` (passthrough) | [caniuse: WebXR](https://caniuse.com/webxr) |
| Android con Chrome y ARCore | `immersive-ar` con hit-test y dom-overlay; `immersive-vr` | caniuse |
| Chrome / Edge de escritorio con un visor de PC (OpenXR) | `immersive-vr` | caniuse |
| Safari en visionOS | `immersive-vr` | [WebXR compatible browsers 2026](https://threejsresources.com/webxr/browsers) |
| **iPad y iPhone (Safari, Chrome, cualquier navegador)** | **Sin WebXR.** Todos los navegadores de iOS/iPadOS usan WebKit, y Apple no lo implementa. Alternativa nativa: **AR Quick Look** con un modelo USDZ | caniuse; [WebXR browser support 2026](https://www.testmuai.com/learning-hub/webxr-compatible-browsers/) |
| Firefox de escritorio | Sin WebXR | caniuse |

El iPad se presenta como Mac en el *user agent* («Macintosh»). Por eso la app antes lo trataba como un escritorio. Ahora lo reconoce por ser táctil (`navigator.maxTouchPoints > 1`).
