import type { CableCatalog, MetroManifest } from '../../shared/metro'
import type { Elevation, Street, RouteLine, LineInfo } from '../centro/data'
export interface MetroData { base: string; manifest: MetroManifest; cable: CableCatalog; elevation: Elevation; overview: Street[]; routes: RouteLine[]; lines: LineInfo[] }
export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal })
  if (!r.ok) throw new Error(`No se pudo cargar ${url.split('/').at(-1)} (${r.status})`)
  return r.json()
}
export async function loadMetro(signal: AbortSignal): Promise<MetroData> {
  const root = `${import.meta.env.BASE_URL}metro/`
  const { base: version } = await getJson<{ base: string }>(`${root}current.json`, signal)
  if (!/^v\d+$/.test(version)) throw new Error('Versión de mapa inválida')
  const base = `${root}${version}`
  const [manifest, cable, elevation, overview, routes, lines] = await Promise.all([
    getJson<MetroManifest>(`${base}/manifest.json`, signal), getJson<CableCatalog>(`${base}/cable.json`, signal),
    getJson<Elevation>(`${base}/elevation.json`, signal), getJson<Street[]>(`${base}/overview.json`, signal),
    getJson<RouteLine[]>(`${base}/routes.json`, signal), getJson<LineInfo[]>(`${base}/lines.json`, signal),
  ])
  return { base, manifest, cable, elevation, overview, routes, lines }
}
