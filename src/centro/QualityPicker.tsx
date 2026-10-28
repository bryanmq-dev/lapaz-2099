import { Gauge } from 'lucide-react'
import { autoTier, filesFor, setChoice, useChoice, useTier, type Choice, type Tier } from './quality'
import { useDownload } from './useZoneGeometry'

const NAME: Record<Tier, string> = { alta: 'Alta', media: 'Media', baja: 'Baja', rutas: 'Solo rutas' }
const mb = (bytes: number) => `${(bytes / 1e6).toLocaleString('es-BO', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`

/** Selector de calidad de la ciudad, con lo que descarga cada nivel (tamaños de meta.json). */
export function QualityPicker({ sizes }: { sizes?: Record<string, number> }) {
  const choice = useChoice()
  useTier() // se vuelve a pintar cuando «Automática» baja de nivel
  const weight = (t: Tier) => (sizes ? ` · ${mb(filesFor(t).reduce((a, f) => a + (sizes[f] ?? 0), 0))}` : '')
  return (
    <label className="quality-pick" title="Calidad de la ciudad: resolución, edificios y descarga">
      <Gauge size={15} aria-hidden="true" />
      <select value={choice} autoComplete="off" onChange={(e) => setChoice(e.target.value as Choice)} aria-label="Calidad de la ciudad">
        <option value="auto">Automática ({NAME[autoTier()]}{weight(autoTier())})</option>
        {(['alta', 'media', 'baja', 'rutas'] as const).map((t) => <option key={t} value={t}>{NAME[t]}{weight(t)}</option>)}
      </select>
    </label>
  )
}

/** Avance de la descarga de la ciudad (edificios, calles, terreno), mientras dura. */
export function DownloadBar() {
  const d = useDownload()
  if (!d) return null
  const pct = d.total ? Math.min(100, (d.loaded / d.total) * 100) : 0
  return (
    <div className="download panel" role="status" aria-live="polite">
      <span>{d.building ? 'Construyendo la ciudad…' : `Descargando la ciudad · ${mb(d.loaded)} de ${mb(d.total)}`}</span>
      <progress max={100} value={d.building ? undefined : pct} aria-label="Avance de la descarga" />
    </div>
  )
}
