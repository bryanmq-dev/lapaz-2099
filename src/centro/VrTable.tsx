import { useEffect, useRef, type ReactNode } from 'react'
import * as THREE from 'three'
import { Handle } from '@react-three/handle'
import { useTheme } from '../theme'
import { VR } from './xr'

/**
 * Mesa de la maqueta: escala la ciudad a ~1 m (`scale`) y la centra sobre `at` (en el teléfono, donde se colocó).
 * La base es el único asa: con un control se mueve y gira en Y, con los dos se escala.
 * (El asa no puede ser la ciudad entera: cada clic sobre un bus también arrastraría la maqueta.)
 * `resetSeq` devuelve la maqueta a su sitio sin volver a montar la escena.
 */
export function VrTable({ children, center, size, resetSeq, at = VR.at, scale = VR.scale }: {
  children: ReactNode; center: THREE.Vector3; size: [number, number]; resetSeq: number; at?: [number, number, number]; scale?: number
}) {
  const table = useRef<THREE.Group>(null)
  const light = useTheme() === 'light'

  useEffect(() => {
    const t = table.current
    if (!t) return
    t.position.set(...at); t.quaternion.identity(); t.scale.set(1, 1, 1)
  }, [resetSeq, at])

  return (
    <group ref={table} position={at}>
      <group scale={scale}>
        <Handle targetRef={table} rotate={{ x: false, y: true, z: false }} scale={{ uniform: true }}>
          <mesh position={[0, -25, 0]}>
            <boxGeometry args={[size[0] + 120, 50, size[1] + 120]} />
            <meshStandardMaterial color={light ? '#8a94a3' : '#0e1b2c'} roughness={0.8} />
          </mesh>
        </Handle>
        <group position={[-center.x, 0, -center.z]}>{children}</group>
      </group>
    </group>
  )
}
