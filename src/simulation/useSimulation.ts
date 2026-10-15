import { useEffect, useSyncExternalStore } from 'react'
import { createSim } from './simulationEngine.ts'

/** Estado único de la simulación; la escena 3D lo lee por frame sin re-renderizar React. */
export const sim = createSim()

export const useSimulation = () => useSyncExternalStore(sim.subscribe, sim.getView)

/** 1 s reales = 1 min simulado. Un único temporizador, limpiado al desmontar. */
export function useSimClock() {
  useEffect(() => {
    const id = setInterval(() => sim.dispatch({ type: 'tick' }), 1000)
    return () => clearInterval(id)
  }, [])
}

if (import.meta.env.DEV) Object.assign(globalThis, { __sim: sim }) // depuración en consola
