# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). Versionado semántico.

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
