# LA PAZ 2050 · Smart City Control

Gemelo digital de La Paz con dos vistas:

1. **Ciudad**: visión conceptual de toda la ciudad (simulación en el navegador).
2. **Centro**: el Centro reconstruido con datos reales de OpenStreetMap y elevación SRTM. Muestra el seguimiento de 3 líneas reales de minibús y trufi y de una flota simulada de ~250 minibuses, con alertas espaciales en PostGIS, congestión que se forma sola en El Prado, el Obelisco y la Av. Camacho, y desvíos sugeridos dentro de la zona.

Todos los datos de flota, tráfico y alertas son **simulados**. Ver [docs/caso-estudio-rutas.md](docs/caso-estudio-rutas.md), [docs/explicacion-tecnica.md](docs/explicacion-tecnica.md) (cómo funciona todo, de punta a punta) y [CHANGELOG.md](CHANGELOG.md).

## Ejecutar

Todo con Docker (web en http://localhost:8080):

```sh
docker compose up --build
```

Desarrollo:

```sh
pnpm install && pnpm --dir server install
docker compose up -d db          # PostGIS en el puerto 5433
pnpm --dir server dev            # API + simulador en :3001 (migra y carga datos al iniciar)
pnpm dev                         # web en :5173 (redirige /api a :3001)
```

La vista ciudad funciona sin la API. La vista del Centro muestra el mapa 3D sin la API, pero los vehículos y las alertas vienen del servidor.

## Comprobaciones

```sh
pnpm exec tsc -b && pnpm lint && pnpm build
pnpm check:sim                   # motor de la vista ciudad
pnpm --dir server check          # escenarios contra PostGIS real (base aparte: lapaz_check)
```

## Datos

`node scripts/centro/fetch.ts` regenera `public/centro/` desde OpenStreetMap (Overpass) y AWS Terrain Tiles (usa caché en `scripts/centro/.cache`; con `--refresh` descarga de nuevo).
© OpenStreetMap contributors, ODbL.
