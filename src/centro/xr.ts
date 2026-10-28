import { createXRStore } from '@react-three/xr'

/** Perillas de la maqueta VR/MR. Se ajustan en el visor: el Quest 3 renderiza dos ojos con GPU móvil. */
export const VR = {
  scale: 0.00025, // metros de la maqueta por metro de ciudad: 4.1 km → ~1 m
  at: [0, 0.9, -0.8] as [number, number, number], // centro de la maqueta respecto al origen del piso: sobre una mesa, frente al usuario
  minBuildingH: 6, // edificios más bajos (y sin nombre) no se dibujan en VR: a esta escala miden milímetros
  phoneScale: 0.5, // en el teléfono la maqueta mide la mitad (~50 cm): cabe en una mesa y en la pantalla
  beacon: 2.5, // las balizas de los vehículos se agrandan para poder apuntarlas con el rayo
  foveation: 0.6, // 0-1: más alto = más borrosa la periferia y menos costo
  frameBufferScaling: 1 as number, // <1 baja la resolución si no se llega a 72 FPS
  font: `${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`, // local: troika descargaría una de un CDN y la red de la clase puede no llegar
}

export const xrStore = createXRStore({
  offerSession: false, // la sesión solo se pide con los botones de la cabecera
  emulate: false, // ponytail: sin emulador en escritorio; los botones solo aparecen en un navegador con WebXR
  foveation: VR.foveation,
  frameBufferScaling: VR.frameBufferScaling,
})
