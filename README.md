# LA PAZ 2050 · Smart City Control

Gemelo digital de La Paz con dos vistas:

1. **Ciudad**: visión conceptual de toda la ciudad (simulación en el navegador).
2. **Zonas en detalle**: el Centro, El Alto, Sopocachi y Calacoto, reconstruidos con datos reales de OpenStreetMap y elevación SRTM. Cada zona muestra el seguimiento de 3 líneas reales y de una flota simulada de minibuses, con alertas espaciales en PostGIS, una hora punta que congestiona sola su cruce principal y desvíos sugeridos dentro de la zona. Se puede ver como maqueta en VR, en realidad mixta (Quest, Android) o con AR Quick Look (iPad, iPhone).

Todos los datos de flota, tráfico y alertas son **simulados**. Ver [docs/fuentes.md](docs/fuentes.md) (de dónde sale cada dato), [docs/caso-estudio-rutas.md](docs/caso-estudio-rutas.md), [docs/explicacion-tecnica.md](docs/explicacion-tecnica.md) (cómo funciona todo, de punta a punta) y [CHANGELOG.md](CHANGELOG.md).

## Ejecutar

Todo con Docker (web en http://localhost:8080):

```sh
docker compose up --build
```

Desarrollo:

```sh
pnpm install && pnpm --dir server install
# PostGIS local (el docker-compose.yml no publica puertos: está pensado para producción)
docker run -d --name lapaz-dev-db -e POSTGRES_USER=lapaz -e POSTGRES_PASSWORD=lapaz -e POSTGRES_DB=lapaz \
  -p 127.0.0.1:5434:5432 -v lapaz-dev-pgdata:/var/lib/postgresql/data postgis/postgis:17-3.5
DATABASE_URL=postgres://lapaz:lapaz@localhost:5434/lapaz pnpm --dir server dev   # API + simulador en :3001
pnpm dev                         # web en :5173 (redirige /api a :3001)
```

La primera vez la API carga los datos y la flota de cada zona (una tras otra, en segundo plano). Cada zona simula solo mientras alguien la mira. La vista ciudad funciona sin la API; las zonas muestran el mapa 3D sin la API, pero los vehículos y las alertas vienen del servidor.

Calidad de la ciudad: selector en la cabecera de cada zona (Automática, Alta, Media, Baja), con lo que descarga cada nivel. «Automática» se elige según el dispositivo y baja si caen los FPS; la calidad baja descarga ~40 % de los edificios. También se puede forzar con `?calidad=alta|media|baja`.

### Mapa unificado

`#metropolitano` abre La Paz y El Alto juntas. Los datos (≈90 MB, no se versionan) se generan con `node scripts/metro/fetch.ts` (Node 24+; con `python scripts/metro/from-pbf.py <bolivia.osm.pbf>` antes si Overpass no responde) y la API los lee de `public/metro/current.json`. La primera apertura crea el esquema `metro` (≈1 min) y calienta el simulador vial (≈20 s). Si ya tienes otra API en :3001, `API_URL=http://localhost:3002 pnpm dev`. Prueba del motor de teleféricos: `node --test server/src/cable.test.ts`.

## Comprobaciones

```sh
pnpm exec tsc -b && pnpm lint && pnpm build
pnpm check:sim                   # motor de la vista ciudad
ADMIN_URL=postgres://lapaz:lapaz@localhost:5434/lapaz pnpm --dir server check [zona]   # escenarios contra PostGIS real (base aparte: lapaz_check)
```

## Datos

`node scripts/zonas/fetch.ts <zona…|--all>` regenera `public/zonas/<zona>/` desde OpenStreetMap (Overpass) y AWS Terrain Tiles (usa caché en `scripts/zonas/.cache`; con `--refresh` descarga de nuevo; con `--discover` lista las rutas de transporte de la zona). Las zonas se definen en `shared/zones.ts`. Fuentes y licencias: [docs/fuentes.md](docs/fuentes.md).
© OpenStreetMap contributors, ODbL.
