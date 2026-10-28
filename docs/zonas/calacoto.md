# Zona Calacoto (Zona Sur)

> Las calles, los edificios reales, el relieve y los recorridos de las líneas son **reales** (OpenStreetMap y elevación satelital).
> Los choferes, placas y teléfonos son **ficticios**; el movimiento, la congestión y las alertas son **simulados**.
> Fuentes y licencias generales: [../fuentes.md](../fuentes.md).

## Zona de estudio

| Dato | Valor |
|---|---|
| Recuadro | S −16.552, O −68.096, N −16.528, E −68.066 (≈ 3,2 × 2,7 km) |
| Abarca | Calacoto, San Miguel, la Av. José Ballivián, la Calle 21, la Av. Costanera y Los Pinos |
| Origen de coordenadas locales | Calle 21 de Calacoto (−16.5405, −68.0815) |
| Elevación | 3.212–3.682 m s. n. m. (mosaicos Terrarium z15, derivados de SRTM) |
| Red vial | 1.924 vías dibujadas · 2.070 tramos en el grafo de desvíos |
| Edificios | 3.011 huellas reales de OSM (560 con pisos o altura) + 16.048 lotes estimados. Los estimados son más altos junto a la Av. Ballivián (eje tomado de su traza en OSM) |
| Hotspot de hora punta | **Av. José Ballivián y Calle 21** (−16.53897, −68.07805), tomado del cruce en el grafo vial de OSM. La primera estimación quedaba ~650 m al oeste y se corrigió |
| Geocerca restringida | La plaza con nombre más cercana a las líneas reales que ninguna calle atraviesa (regla general, ver `server/src/db.ts`) |

Se regenera con `node scripts/zonas/fetch.ts calacoto`.

## Líneas

`--discover` encontró solo **14 relaciones** de transporte (10 líneas). Las únicas con ida y vuelta separadas son PumaKatari (buses municipales), que quedaron fuera porque se usan solo minibuses. **Los minibuses de Calacoto tienen una sola relación en OSM**, sin `from` ni `to`.

**Cómo se trató:** la línea se declara con la misma relación en ida y vuelta (`oneRelation` en `scripts/zonas/fetch.ts`).
- Si la ruta vuelve a su origen es un circuito, y se parte en el punto más lejano del inicio.
- Si no, la **vuelta se supone por el mismo corredor en sentido contrario**.

En las tres líneas elegidas ocurrió lo segundo: **la vuelta es un supuesto** y está anotada en `routes.json` (`issues`) y en `lines.json` (`assumed: vuelta`).

Candidatas evaluadas con `--try`:

| Candidata | En la zona | Decisión |
|---|---|---|
| 379 | 4,67 km | ✔ corredor del río (Costanera, Hernán Siles, Arequipa) |
| 922 | 4,20 km | ✔ Av. Ballivián y Calle 21 (pasa por el hotspot) |
| 838 | 3,74 km | ✘ repite la Av. Roma y la Ballivián de la 922 |
| 458 | 2,45 km | ✔ Calle 21 → Av. Fuerza Naval |
| 1 | 1,70 km | ✘ menos recorrido y mismo corredor que la 922 |

| Línea | Relación OSM | En la zona | Recorrido completo | Corredor en la zona |
|---|---|---|---|---|
| **922** · sin operador en OSM | [10259073](https://www.openstreetmap.org/relation/10259073) | 4,20 km | 17,8 km | Av. Roma → Av. José Ballivián → Calle 21 → Calle 3 → Los Pinos |
| **458** · sin operador en OSM | [9424671](https://www.openstreetmap.org/relation/9424671) | 2,45 km | 8,5 km | Calle 21 → Ballivián → Calle 12 → Av. Fuerza Naval → Av. Ovando Candia |
| **379** · Sindicato Río Abajo – Palca | [10253969](https://www.openstreetmap.org/relation/10253969) | 4,67 km | 26,3 km | Av. Hugo Ernst → Puente Amor de Dios → Hernán Siles → Costanera → Av. Arequipa → Ballivián |

**Observaciones de OSM** (`routes.json`):
- **922:** saltos fuera del tramo usado.
- **458:** tramos de la Ballivián en contramano. La relación parece mapear un sentido sobre la calzada contraria.
- **379:** un salto de 2,4 km reparado por la red vial (1,6 km).

**Fichas** (`public/zonas/calacoto/lines.json`):
- **Supuestos:** la vuelta, los extremos, la tarifa, el horario y la frecuencia. También el operador de la 922 y la 458, que OSM no registra.
- **Tarifa de referencia:** la de minibús de La Paz ([Correo del Sur, 25-dic-2025](https://correodelsur.com/sociedad/20251225/en-la-paz-rigen-nuevas-tarifas-de-transporte-publico.html)).

## Simulación

- **Flota:** 24 minibuses de las 3 líneas reales y una flota simulada de 22 líneas, con 136 minibuses en servicio y 48 de refuerzo.
- **Hora punta:** el refuerzo converge en la Ballivián y la Calle 21, y la cola se forma sola (a los ~30 s simulados en la comprobación).
- **Fin de la hora punta:** a los ~390 s simulados.
- **Escenarios:**
  - Desvío no autorizado: lo hace la **458**.
  - Avería: la **379**.
  - Ingreso a geocerca: la línea más cercana a la plaza, que es la **458**.
- **Comprobación:** `pnpm --dir server check calacoto` pasa completa.
