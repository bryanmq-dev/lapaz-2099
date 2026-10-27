import { useEffect, useState } from 'react'
import { Glasses, ScanEye } from 'lucide-react'
import { xrStore } from './xr'
import { quickLookSupported } from './quicklook'

type Support = { vr: boolean; ar: boolean; quickLook: boolean; touch: boolean; ios: boolean }

/**
 * Qué modos inmersivos ofrece este navegador:
 * - WebXR (`navigator.xr`): Quest (VR y mixta), Android con ARCore (mixta en el teléfono), Chrome/Edge con un visor de PC, visionOS (VR).
 * - AR Quick Look: iPad y iPhone, donde no existe WebXR en ningún navegador.
 * El iPad se presenta como Mac («Macintosh» en el UA): se reconoce porque es táctil.
 */
function useXrSupport(): Support {
  // lo que se sabe sin esperar (táctil, iOS, Quick Look) se calcula una vez; WebXR responde de forma asíncrona
  const [base] = useState(() => {
    const touch = navigator.maxTouchPoints > 1
    return { quickLook: quickLookSupported(), touch, ios: /iPad|iPhone|iPod/.test(navigator.userAgent) || (touch && /Macintosh/.test(navigator.userAgent)) }
  })
  const [xr, setXr] = useState({ vr: false, ar: false })
  useEffect(() => {
    const api = navigator.xr
    if (!api) return
    let alive = true
    const ask = (m: XRSessionMode) => api.isSessionSupported(m).catch(() => false)
    void Promise.all([ask('immersive-vr'), ask('immersive-ar')]).then(([vr, ar]) => alive && setXr({ vr, ar }))
    return () => { alive = false }
  }, [])
  return { ...base, ...xr }
}

/** Botones de la cabecera: VR, realidad mixta (WebXR) o AR Quick Look (iOS). En tabletas y teléfonos sin ninguno, se explica por qué. */
export function VrEnter({ onQuickLook }: { onQuickLook?: () => Promise<unknown> }) {
  const { vr, ar, quickLook, touch, ios } = useXrSupport()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [hint, setHint] = useState(false)
  const look = async () => {
    if (!onQuickLook) return
    setBusy(true); setErr('')
    try { await onQuickLook() } catch (e) { setErr((e as Error).message) }
    setBusy(false)
  }
  const why = ios
    ? 'Este navegador no abre AR Quick Look. Abre la página en Safari para ver la maqueta sobre la mesa.'
    : 'Este navegador no tiene WebXR. En Android usa Chrome (con Servicios de Google Play para RA); en un visor, su navegador.'
  return (
    <>
      {vr && <button className="icon-btn" title="Ver la maqueta en VR" aria-label="Ver la maqueta en VR" onClick={() => void xrStore.enterVR()}><Glasses size={17} /></button>}
      {ar && <button className="icon-btn" title="Ver la maqueta en realidad mixta" aria-label="Ver la maqueta en realidad mixta" onClick={() => void xrStore.enterAR()}><ScanEye size={17} /></button>}
      {!ar && quickLook && (
        <button className="icon-btn" title={err ? `No se pudo generar la maqueta: ${err}` : 'Ver la maqueta sobre la mesa (AR Quick Look)'} aria-label="Ver la maqueta en realidad aumentada"
          aria-busy={busy} disabled={busy} onClick={() => void look()}>
          <ScanEye size={17} />
        </button>
      )}
      {!vr && !ar && !quickLook && touch && (
        // en pantallas táctiles no hay tooltip: al tocar se explica por qué no hay modo inmersivo
        <button className="icon-btn xr-off" aria-disabled="true" aria-expanded={hint} aria-label="Realidad aumentada no disponible" onClick={() => setHint(!hint)}>
          <ScanEye size={17} />
        </button>
      )}
      {(hint || err) && <span className="xr-hint" role="status">{err ? `No se pudo generar la maqueta: ${err}` : why}</span>}
    </>
  )
}
