# Zona El Alto (La Ceja)

> Las calles, los edificios reales, el relieve y los recorridos de las líneas son **reales** (OpenStreetMap y elevación satelital).
> Los choferes, placas y teléfonos son **ficticios**; el movimiento, la congestión y las alertas son **simulados**.
> Fuentes y licencias generales: [../fuentes.md](../fuentes.md).

## Zona de estudio

| Dato | Valor |
|---|---|
| Recuadro | S −16.522, O −68.182, N −16.498, E −68.152 (≈ 3,2 × 2,7 km) |
| Abarca | La Ceja, la Av. 6 de Marzo, la Av. Héroes del Km 7 hacia el aeropuerto, la bajada de la Autopista y los barrios en cuadrícula al sur |
| Origen de coordenadas locales | La Ceja (−16.5045, −68.1630) |
| Elevación | 3.747–4.117 m s. n. m. (mosaicos Terrarium z15, derivados de SRTM): incluye el borde del altiplano y la ladera hacia La Paz |
| Red vial | 1.446 vías dibujadas · 1.682 tramos en el grafo de desvíos |
| Edificios | 902 huellas reales de OSM (445 con pisos o altura) + 20.124 lotes estimados para rellenar manzanas sin datos |
| Hitos | Plazas, mercados, la Terminal Metropolitana y la Terminal Aérea Presidencial (selección automática, ver `landmarks.json`) |
| Hotspot de hora punta | **La Ceja** (Av. 6 de Marzo y Av. Héroes del Km 7). Elección del proyecto: es el cruce donde convergen las líneas que suben de La Paz y las que van al aeropuerto |
| Geocerca restringida | Plaza Juana Azurduy Bermúdez de Padilla (polígono de OSM), la plaza con nombre más cercana a las líneas reales |

Se regenera con `node scripts/zonas/fetch.ts alto`.

## Líneas

Elegidas con `node scripts/zonas/fetch.ts --discover alto` (47 relaciones de transporte en el recuadro, 35 líneas), según los criterios de [fuentes.md §3](../fuentes.md#3-líneas-de-transporte): minibús, ida y vuelta en PTv2 y mayor recorrido dentro del recuadro.

| Línea | Relaciones OSM | En la zona | Recorrido completo | Corredor en la zona |
|---|---|---|---|---|
| **212** · COTRANSTUR | [9381528](https://www.openstreetmap.org/relation/9381528) ida, [9393419](https://www.openstreetmap.org/relation/9393419) vuelta | 2,45 / 2,51 km | 15,7 / 16,0 km | Autopista → La Ceja (Av. 6 de Marzo) → Av. Héroes del Km 7 |
| **731** · sin operador en OSM | [9394021](https://www.openstreetmap.org/relation/9394021) ida, [9394239](https://www.openstreetmap.org/relation/9394239) vuelta | 1,59 / 1,51 km | 15,0 / 14,3 km | Ida: Calle Alfredo Franco Valle → Calle 3 · Vuelta: Calle 3 → Calle Jorge Carrasco → Calle 5 → Av. 6 de Marzo |
| **267** · Sindicato de transporte mixto «Simón Bolívar» | [19980924](https://www.openstreetmap.org/relation/19980924) ida, [20619663](https://www.openstreetmap.org/relation/20619663) vuelta | 0,69 / 0,69 km | 16,6 / 17,0 km | Av. Naciones Unidas (hacia Tiquina) |

**Por qué estas y no otras:**
- La **212** es la línea con más recorrido dentro de la zona y la misma del caso del Centro: une las dos zonas por La Ceja.
- La **731** es la línea propia de El Alto con más recorrido dentro del recuadro.
- La **267** es la siguiente en recorrido. La 453 tiene más, pero es trufi, y las 150, 349 y 880 son microbuses.

**Fichas** (`public/zonas/alto/lines.json`):

| Línea | Tarifa | Horario | Frecuencia | Supuestos |
|---|---|---|---|---|
| 212 | Bs 3,00 / 3,50 diurna, Bs 3,30 / 3,80 nocturna ([Correo del Sur, 25-dic-2025](https://correodelsur.com/sociedad/20251225/en-la-paz-rigen-nuevas-tarifas-de-transporte-publico.html)) | 05:30–22:30 aprox. | 8–12 min | — (ver [caso-estudio-rutas.md](../caso-estudio-rutas.md)) |
| 731 | Bs 1,50–2,00 | 06:00–21:30 | 8–12 min | **Operador, tarifa, horario y frecuencia** |
| 267 | Interprovincial por tramo | 05:00–20:00 | 15–20 min | **Tarifa, horario y frecuencia** |

## Lo que dice OSM y cómo se trató

Las observaciones están en `routes.json` (`issues`):
- **212 vuelta:** un salto de 274 m que no se pudo reparar por la red vial, porque queda fuera del recuadro. No afecta: se usa el tramo continuo más largo dentro de la zona.
- **731 ida:** tres saltos; uno de 294 m se repara por la red vial y los otros quedan fuera del tramo usado. Además, contramano en la Calle Alfredo Franco Valle.
- **731 vuelta:** recorre la Av. 6 de Marzo en un sentido que OSM marca como contrario. Es habitual en relaciones mal orientadas o con calzadas separadas. Se respeta el recorrido de la relación tal como está.

## Simulación

- **Flota:** 26 minibuses de las 3 líneas reales (10 + 8 + 8) y una flota simulada de 22 líneas con 136 minibuses en servicio y 48 de refuerzo. Hasta 12 líneas cortas (1,2–3,5 km) cruzan La Ceja y llevan el refuerzo de hora punta; las demás recorren la zona.
- **Hora punta:** el refuerzo converge en La Ceja y la cola se forma sola en la **Av. Héroes del Km 7** (en la comprobación, a los ~50 s simulados).
- **Desvíos:** esa cola llega hasta el borde del recuadro, por donde *entran* las rutas, así que **no hay rodeo dentro de la zona**. El simulador lo informa («Sin desvío disponible para Línea 212»). Es coherente con La Ceja, un cuello de botella al borde de la ladera.
- **Escenarios:**
  - Desvío no autorizado: lo hace la **731**.
  - Avería: la **267**.
  - Ingreso a geocerca: la línea más cercana a Plaza Juana Azurduy, que es la **731**.
- **Comprobación:** `pnpm --dir server check alto` pasa completa: línea base sin alertas, hora punta y congestión, control de tránsito y fin de la hora punta (~810 s simulados), desvío no autorizado, avería y geocerca.
