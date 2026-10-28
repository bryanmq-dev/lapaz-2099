# Zona Sopocachi

> Las calles, los edificios reales, el relieve y los recorridos de las líneas son **reales** (OpenStreetMap y elevación satelital).
> Los choferes, placas y teléfonos son **ficticios**; el movimiento, la congestión y las alertas son **simulados**.
> Fuentes y licencias generales: [../fuentes.md](../fuentes.md).

## Zona de estudio

| Dato | Valor |
|---|---|
| Recuadro | S −16.526, O −68.142, N −16.502, E −68.112 (≈ 3,2 × 2,7 km) |
| Abarca | Sopocachi, la Av. 6 de Agosto, la Av. Arce, la Plaza del Estudiante, el Montículo y el Puente de las Américas |
| Origen de coordenadas locales | Plaza Abaroa (−16.5104, −68.1268) |
| Elevación | 3.312–4.082 m s. n. m. (mosaicos Terrarium z15, derivados de SRTM) |
| Red vial | 2.167 vías dibujadas · 2.205 tramos en el grafo de desvíos |
| Edificios | 1.923 huellas reales de OSM (1.011 con pisos o altura) + 20.189 lotes estimados |
| Hotspot de hora punta | **Plaza Abaroa** (Av. 20 de Octubre y Belisario Salinas). Elección del proyecto: es el cruce por donde atraviesan Sopocachi las líneas del corredor central |
| Geocerca restringida | Atrio Universitario (polígono de OSM), la plaza con nombre más cercana a las líneas reales que ninguna calle atraviesa. Plaza Bicentenario queda descartada porque su polígono incluye calzada |

Se regenera con `node scripts/zonas/fetch.ts sopocachi`.

## Líneas

`--discover` encontró 62 relaciones de transporte en el recuadro (46 líneas). Las de más recorrido son PumaKatari (buses municipales), que quedaron fuera porque se usan solo minibuses.

Las candidatas de minibús se evaluaron con `--try`, que mide el tramo continuo dentro de la zona tal como queda en la simulación:

| Candidata | Ida / vuelta en la zona | Decisión |
|---|---|---|
| 906 | 3,23 / 2,76 km | ✔ |
| 847 | 2,92 / 2,76 km | ✔ |
| 830 | 2,76 / 2,76 km | ✘ repite el trazado de la 906 en la zona |
| 296 | 2,63 / 1,49 km | ✔ (pasa por el hotspot) |
| 852 | 0,89 / 3,11 km | ✘ la ida casi no entra a la zona |
| 212 | 1,20 / 1,46 km | ✘ ya está en el Centro y en El Alto |

| Línea | Relaciones OSM | En la zona | Recorrido completo | Corredor en la zona |
|---|---|---|---|---|
| **296** · Sindicato de transporte mixto «Simón Bolívar» | [19980960](https://www.openstreetmap.org/relation/19980960) ida, [20619577](https://www.openstreetmap.org/relation/20619577) vuelta | 2,63 / 1,49 km | 11,9 / 10,9 km | Ida: Av. Ecuador → Sánchez Lima → 20 de Octubre → Av. del Poeta · Vuelta: Av. del Ejército → 16 de Julio → Plaza del Estudiante |
| **847** · «Simón Bolívar» | [19982381](https://www.openstreetmap.org/relation/19982381) ida, [20108303](https://www.openstreetmap.org/relation/20108303) vuelta | 2,92 / 2,76 km | 11,9 / 11,0 km | Ida: Av. Ecuador → Sánchez Lima → Pedro Salazar → Puente de las Américas · Vuelta: Puente Gemelo → Belisario Salinas → Av. Arce → Villazón |
| **906** · «Simón Bolívar» | [10261371](https://www.openstreetmap.org/relation/10261371) ida, [20083458](https://www.openstreetmap.org/relation/20083458) vuelta | 3,23 / 2,76 km | 10,6 / 9,9 km | Ida: Calle México → Villazón → Av. 6 de Agosto → Pedro Salazar · Vuelta: Belisario Salinas → Av. Arce → Villazón |

Las tres líneas nacen en El Alto (Mariano Colodro, Eduardo Avaroa, Utapulpera) y bajan a La Paz cruzando Sopocachi por corredores distintos. Ninguna tiene observaciones de continuidad en OSM.

**Fichas** (`public/zonas/sopocachi/lines.json`): operador según OSM. **Supuestos:** tarifa (la de minibús de La Paz, [Correo del Sur, 25-dic-2025](https://correodelsur.com/sociedad/20251225/en-la-paz-rigen-nuevas-tarifas-de-transporte-publico.html)), horario y frecuencia, porque no hay fuente pública.

## Simulación

- **Flota:** 24 minibuses de las 3 líneas reales y una flota simulada de 22 líneas, con 136 minibuses en servicio y 48 de refuerzo.
- **Hora punta:** el refuerzo converge en Plaza Abaroa y la cola se forma sola (a los ~130 s simulados en la comprobación).
- **Fin de la hora punta:** con el agente de tránsito, a los ~850 s simulados.
- **Escenarios:**
  - Desvío no autorizado: lo hace la **847**.
  - Avería: la **906**.
  - Ingreso a geocerca: la línea más cercana al Atrio Universitario, que es la **847**.
- **Comprobación:** `pnpm --dir server check sopocachi` pasa completa.
