# Caso de estudio: 3 líneas reales en el Centro de La Paz

Fase 2 del proyecto. En lugar de cargar las 111 rutas de transporte que OpenStreetMap tiene en el Centro, se eligieron **tres líneas reales** que cruzan la zona por corredores distintos. Se documentaron a fondo para poder comparar los desvíos entre ellas.

> El recorrido, las calles y los operadores son reales (OpenStreetMap y fuentes públicas).
> **Los choferes, placas, licencias y teléfonos son ficticios**, generados por `server/src/db.ts`, para no usar datos personales.
> El movimiento de los vehículos, la congestión y las alertas son **simulados**.

## Zona de estudio

| Dato | Valor |
|---|---|
| Recuadro | S −16.512, O −68.150, N −16.488, E −68.120 (≈ 3,2 × 2,7 km) |
| Abarca | San Sebastián, Casco Viejo, Plaza Murillo, El Prado, San Pedro, Sopocachi bajo y la Av. Arce hasta Plaza Isabel la Católica |
| Origen de coordenadas locales | Plaza Murillo (−16.4958, −68.1336) |
| Elevación | 3.441–4.087 m s. n. m. (mosaicos Terrarium z15, derivados de SRTM) |
| Red vial | 2.489 vías dibujadas · 2.343 tramos en el grafo de desvíos |
| Edificios | 2.180 huellas reales de OSM (525 con pisos o altura) + 22.970 estimados para rellenar manzanas sin datos |

Los datos se regeneran con `node scripts/centro/fetch.ts` (`--refresh` para volver a descargarlos) y quedan en `public/centro/`.

## Criterios de selección

1. **Corredores distintos**: eje troncal del Prado, Casco Viejo/Garita y barrio de San Pedro. Así un mismo incidente afecta a unas líneas y a otras no.
2. **Relación OSM completa**, con ida y vuelta como relaciones separadas (PTv2) y operador identificado.
3. **Respaldo en fuentes públicas** fuera de OSM.

Se descartaron:
- las líneas 18 y 54 del Sindicato Simón Bolívar, porque dentro del Centro repiten el trazado de la 212;
- el trufi 408, que comparte el trazado de la 453 pero no tiene operador en OSM;
- las rutas PumaKatari, porque son municipales y no de un sindicato.

## Fichas

### Línea 212 · Minibús · Sindicato COTRANSTUR

| Campo | Dato | Fuente |
|---|---|---|
| Extremos | Plaza Isabel la Católica ↔ Aeropuerto Internacional El Alto | OSM [9381528](https://www.openstreetmap.org/relation/9381528), [9393419](https://www.openstreetmap.org/relation/9393419) |
| Ida en el Centro (3,34 km) | Av. Arce → Av. Villazón → Plaza Franz Tamayo (del Estudiante) → Av. 16 de Julio (El Prado) → Av. Mcal. Santa Cruz → Av. Montes → Autopista | OSM |
| Vuelta en el Centro (3,59 km) | Autopista → Av. Montes → Av. Mcal. Santa Cruz → Av. 16 de Julio → Plaza Franz Tamayo → Av. Villazón → Av. 6 de Agosto → Calle Pedro Salazar → Av. Arce | OSM |
| Recorrido completo | 15,7 km (ida) / 16,0 km (vuelta) | OSM |
| Horario | 05:30–22:30 aprox. Moovit registra en Plaza Isabel la Católica la primera pasada a las 05:26 y la última a las 23:24 | [Relatos Nómadas (2024)](https://relatosnomadas.com/aeropuerto-de-la-paz-al-centro/), [Moovit](https://moovitapp.com/index/es-419/transporte_p%C3%BAblico-Plaza_Isabel_La_Cat%C3%B3lica-La_Paz-stop_46463279-2961) |
| Frecuencia | 8–12 min (Relatos Nómadas); cada 15 min según Rome2rio | [Rome2rio](https://www.rome2rio.com/es/s/Aeropuerto-Internacional-El-Alto-LPB/Plaza-Isabel-La-Cat%C3%B3lica-La-Paz) |
| Operador | “Sindicato Cotranstur” aparece entre los operadores de La Paz | [Moovit](https://moovitapp.com/index/en/public_transit-La_Paz-2961) |
| Paradas de referencia (ida) | Plaza Isabel la Católica → Plaza del Estudiante → Obelisco → Basílica de San Francisco → Plaza San Francisco → Mercado Lanza | Calculadas con PostGIS (ver abajo) |

### Línea 204 · Minibús · Sindicato Pedro Domingo Murillo

| Campo | Dato | Fuente |
|---|---|---|
| Extremos | Jurisdicción El Alto ↔ Calle 8, Villa El Carmen | OSM [19447024](https://www.openstreetmap.org/relation/19447024), [19422164](https://www.openstreetmap.org/relation/19422164) |
| Ida en el Centro (5,27 km) | Av. Mariano Baptista → Garita de Lima → Av. Tumusla → Plaza Eguino → Nicasio Cardozo → Murillo → Oruro → Ayacucho → Av. Camacho → Av. Simón Bolívar → Miraflores (Bautista Saavedra, Héroes del Pacífico, Av. Busch) | OSM |
| Vuelta en el Centro (3,91 km) | Av. Tejada Sorzano → Yungas → Ballivián → Ingavi → Genaro Sanjinés → Viaducto San Francisco → Santa Cruz → Max Paredes → Garita de Lima → Av. Mariano Baptista | OSM |
| Operador en la zona | Una nota de 2015 nombra a Pedro Domingo Murillo entre los grupos que sirven Villa El Carmen | [eju.tv (2015)](https://eju.tv/2015/09/26-grupos-son-duenos-de-las-rutas-en-la-paz/) |
| Horario / frecuencia | 06:00–22:00 y 10–15 min | **Supuesto**: no hay fuente pública |
| Observación | Pasa por las calles Ballivián, Ingavi y Ayacucho, junto a Plaza Murillo. Por eso sirve para el escenario de geocerca | — |

### Línea 453 · Trufi · Sindicato de Transporte Eduardo Avaroa

| Campo | Dato | Fuente |
|---|---|---|
| Extremos | San Pedro (Calle México / Otero de la Vega) ↔ Cruce Viacha | OSM [17767401](https://www.openstreetmap.org/relation/17767401), [17675641](https://www.openstreetmap.org/relation/17675641) |
| Ida en el Centro (1,94 km) | Otero de la Vega → Plaza Israel → Boquerón → Plaza José Martí → Plaza El Cóndor → Av. Landaeta → Av. Jaimes Freyre | OSM |
| Vuelta en el Centro (2,42 km) | Av. Buenos Aires → Av. Julio Téllez → Av. Landaeta → Plaza El Cóndor → Boquerón → Canónigo Ayllón → Santos Machicado → Héroes del Acre → Capitán Castrillo → Cañada Strongest → Nicolás Acosta → México | OSM |
| Respaldo | Un directorio de calles lista el “Trufi 453 San Pedro – Cruce Viacha” con parada en Calle Otero de la Vega. Moovit registra un trufi del Sindicato Eduardo Avaroa que termina en Calle México / Otero de la Vega, lo que coincide con OSM | [openalfa](https://bolivia-streets.openalfa.com/streets/santos-machicado-municipio-nuestra-senora-de-la-paz-provincia-murillo), [Moovit](https://moovitapp.com/index/en/public_transit-line-TRUFI-La_Paz-2961-877004-1947293-1) |
| Horario / frecuencia | 06:00–21:30 y 6–10 min | **Supuesto** |

### Tarifas (vigentes desde el 24-dic-2025)

| Modo | Diurna | Nocturna (desde 21:00) | Preferencial |
|---|---|---|---|
| Minibús | Bs 3,00 tramo corto · Bs 3,50 largo | Bs 3,30 / 3,80 | Bs 2,50 / 3,00 |
| Trufi | Bs 2,50 zonal corto · Bs 3,00 zonal · Bs 4,00 largo · Bs 4,50 extra largo | — | — |

Fuente: [Correo del Sur, 25-dic-2025](https://correodelsur.com/sociedad/20251225/en-la-paz-rigen-nuevas-tarifas-de-transporte-publico.html).

## OSM frente a otras fuentes: diferencias y cómo se resolvieron

| Hallazgo | Resolución |
|---|---|
| La relación de vuelta de la 204 (19422164) tiene `ref=208`, pero su nombre dice “MiniBus 204” y sus extremos son los inversos de la ida | Se trata como 204 vuelta y se anota en la ficha |
| La vuelta de la 212 tiene un **salto de 274 m** entre dos vías, dentro del Centro (Av. Villazón, cerca de Plaza del Estudiante) | `fetch.ts` lo repara con el camino más corto por la red vial OSM, respetando el sentido de circulación. Queda registrado en `routes.json → issues` |
| Relatos Nómadas dice que la 212 termina en Plaza San Francisco; OSM la extiende hasta Plaza Isabel la Católica | Se usa OSM (coincide con Moovit, que la registra en Plaza Isabel la Católica) |
| Sentido de circulación | Todas las vías de sentido único que usan las 6 relaciones se recorren en el sentido permitido (sin contramano detectada) |
| Nombres de lugares | En OSM la Plaza del Estudiante es “Plaza Franz Tamayo” y la de San Pedro es “Plaza Mariscal Sucre”; se mapearon a sus nombres de uso común |

## Cómo se modela en PostGIS

- **`routes`**: una fila por sentido. La geometría es una `LINESTRING` continua (no multilínea): un vehículo sigue una ruta de ida o una de vuelta.
- **`stops`**: “Ingreso al Centro” y “Salida del Centro”, más cada lugar conocido a ≤ 120 m de la ruta (`ST_DWithin` + `ST_ClosestPoint`), ordenados con `ST_LineLocatePoint`. Son **puntos de referencia**, no paradas oficiales (los minibuses de La Paz paran a demanda).
- **`geofences`**:
  - Plaza Murillo, con su polígono real de OSM, como zona restringida;
  - una geocerca de parada o terminal por cada parada de cada ruta;
  - las 3 unidades educativas reales más cercanas a las rutas, como zonas escolares.
- **Reglas de alerta**, evaluadas cada segundo en una sola consulta SQL (`server/src/sim.ts`):
  - *fuera de ruta*: 3 muestras seguidas a más de 40 m de la ruta asignada (`ST_DWithin` sobre `geography`), salvo en un desvío autorizado;
  - *detenido*: < 2 km/h durante 45 s fuera de paradas y terminales;
  - *geocerca*: `ST_Intersects` con una geocerca restringida.
- **Desvíos**: Dijkstra sobre `road_segments`, con coste = longitud × (1 + 8·congestión). Respeta el sentido único y no sale del recuadro del Centro.

## Supuestos de la simulación

- Flota: 10 vehículos en la 212, 8 en la 204 y 8 en la 453, repartidos entre ida y vuelta.
- Velocidad de crucero: 20 km/h (minibús) y 18 km/h (trufi), reducida por la congestión de cada tramo.
- Al terminar su tramo dentro del Centro, el vehículo pasa 40 s fuera de la zona (el resto del recorrido, que no se dibuja) y vuelve en el sentido contrario.
- Las alturas de los edificios sin dato en OSM y los 22.970 lotes de relleno son estimaciones, más altas junto al eje del Prado.

## Contexto

- Según el perfil de ciudad de TUMI, cerca del 75 % de los viajes diarios del área metropolitana se hacen en minibús, bus o trufi de ruta fija ([TUMI](https://transformative-mobility.org/wp-content/uploads/2023/03/5.-TUMI-City-profile-and-story-La-Paz-x9dgiO.pdf)).
- La cobertura de rutas en OSM es parcial y poco coordinada. Un análisis de las rutas PumaKatari encontró en OSM 5 de 10 rutas y 288 de 603 paradas ([diario OSM](https://api.openstreetmap.org/user/SilvEsth/diary/407953)).
- En 2021 la Alcaldía empezó el primer registro de trufis, de unos 15 sindicatos ([infodiez](https://www.infodiez.com/alcaldia-de-la-paz-inicia-por-primera-vez-el-registro-de-trufis-de-los-15-sindicatos/)).
