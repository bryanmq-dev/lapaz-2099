import { useEffect, useState } from 'react'
import { Glasses, ScanEye } from 'lucide-react'
import { xrStore } from './xr'

type Support = { vr: boolean; ar: boolean }

/** Qué sesiones soporta el navegador (el Quest 3 soporta las dos). */
function useXrSupport() {
  const [s, setS] = useState<Support>({ vr: false, ar: false })
  useEffect(() => {
    const xr = navigator.xr
    if (!xr) return
    let alive = true
    const ask = (m: XRSessionMode) => xr.isSessionSupported(m).catch(() => false)
    void Promise.all([ask('immersive-vr'), ask('immersive-ar')]).then(([vr, ar]) => alive && setS({ vr, ar }))
    return () => { alive = false }
  }, [])
  return s
}

/** Botones de la cabecera: VR inmersivo y realidad mixta (passthrough). No se muestran sin WebXR. */
export function VrEnter() {
  const { vr, ar } = useXrSupport()
  return (
    <>
      {vr && <button className="icon-btn" title="Ver la maqueta en VR" aria-label="Ver la maqueta en VR" onClick={() => void xrStore.enterVR()}><Glasses size={17} /></button>}
      {ar && <button className="icon-btn" title="Ver la maqueta en realidad mixta" aria-label="Ver la maqueta en realidad mixta" onClick={() => void xrStore.enterAR()}><ScanEye size={17} /></button>}
    </>
  )
}
