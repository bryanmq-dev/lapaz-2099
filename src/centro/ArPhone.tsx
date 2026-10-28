import { useRef } from 'react'
import * as THREE from 'three'
import { useXRHitTest, XRDomOverlay } from '@react-three/xr'
import { MapPin, X } from 'lucide-react'
import { PALETTE } from '../city/shared'
import { ScenarioBar, type VehicleDetail } from './CentroPanel'
import { STATE_LABEL } from './labels'
import type { LineInfo } from './data'
import type { FleetVehicle, Snapshot } from './useFleet'
import { xrStore } from './xr'

const m = new THREE.Matrix4()

/**
 * Realidad mixta en el teléfono (Android con ARCore): una retícula sigue la superficie que mira la cámara (hit-test) y
 * `onHit` recibe el último punto encontrado. La maqueta se coloca ahí con el botón del panel.
 */
export function Reticle({ onHit }: { onHit: (p: THREE.Vector3 | null) => void }) {
  const ring = useRef<THREE.Mesh>(null)
  useXRHitTest((results, getWorldMatrix) => {
    const r = ring.current
    if (!r) return
    if (!results.length || !getWorldMatrix(m, results[0])) { r.visible = false; onHit(null); return }
    r.visible = true
    r.position.setFromMatrixPosition(m)
    onHit(r.position)
  }, 'viewer')
  return (
    <mesh ref={ring} rotation-x={-Math.PI / 2} visible={false} raycast={() => null}>
      <ringGeometry args={[0.07, 0.09, 40]} />
      <meshBasicMaterial color={PALETTE.cyan} toneMapped={false} />
    </mesh>
  )
}

/**
 * Panel en HTML sobre la imagen de la cámara (dom-overlay): en un teléfono el panel 3D de los visores sería ilegible.
 * Antes de colocar la maqueta solo muestra cómo hacerlo.
 */
export function ArPhonePanel({ placed, canPlace, onPlace, onReplace, hotspot, snap, busy, message, onRun, lines, hidden, onToggle, detail, live, onRelease }: {
  placed: boolean; canPlace: boolean; onPlace: () => void; onReplace: () => void
  hotspot: string; snap: Snapshot | null; busy: boolean; message: string; onRun: (id: string) => void
  lines: LineInfo[]; hidden: Set<string>; onToggle: (code: string) => void
  detail: VehicleDetail | null; live: FleetVehicle | null; onRelease: () => void
}) {
  return (
    <XRDomOverlay className="ar-overlay">
      <button className="icon-btn ar-exit" aria-label="Salir de la realidad mixta" onClick={() => void xrStore.getState().session?.end()}><X size={18} /></button>
      {!placed ? (
        <div className="ar-place panel">
          <p>{canPlace ? 'Superficie encontrada.' : 'Mueve el teléfono despacio apuntando a una mesa o al piso…'}</p>
          <button className="cta cta-recover" disabled={!canPlace} onClick={onPlace}><MapPin size={16} />Colocar la maqueta aquí</button>
        </div>
      ) : (
        <div className="ar-dock">
          {detail && live && (
            <div className="ar-veh panel">
              <b>{detail.plate} · línea {detail.code}</b>
              <span>{STATE_LABEL[live.state]} · {live.speedKmh.toFixed(0)} km/h · {detail.direction === 'ida' ? 'Ida' : 'Vuelta'}</span>
              <button className="icon-btn sm" aria-label="Soltar el vehículo" onClick={onRelease}><X size={14} /></button>
            </div>
          )}
          <div className="ar-lines">
            {lines.map((l) => (
              <button key={l.code} className="ar-line" aria-pressed={!hidden.has(l.code)} style={{ '--lc': l.color } as React.CSSProperties} onClick={() => onToggle(l.code)}>{l.code}</button>
            ))}
            <button className="ar-line" onClick={onReplace}>Recolocar</button>
          </div>
          <ScenarioBar hotspot={hotspot} snap={snap} busy={busy} message={message} onRun={onRun} onHome={onReplace} />
        </div>
      )}
    </XRDomOverlay>
  )
}
