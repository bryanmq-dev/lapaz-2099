import { useSyncExternalStore } from 'react'

/** Tema de la app: oscuro (por defecto) o claro. Se guarda en localStorage y se aplica como data-theme en <html>. */
export type Theme = 'dark' | 'light'

const KEY = 'lapaz-theme'
const read = (): Theme => {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark') return v } catch { /* modo privado o sin acceso: se usa el oscuro */ }
  return 'dark'
}

let current: Theme = read()
const subs = new Set<() => void>()
const apply = () => { document.documentElement.dataset.theme = current }
apply()

export const getTheme = () => current

export function setTheme(t: Theme) {
  if (t === current) return
  current = t
  apply()
  try { localStorage.setItem(KEY, t) } catch { /* no es crítico */ }
  subs.forEach((fn) => fn())
}

export const useTheme = () =>
  useSyncExternalStore((fn) => { subs.add(fn); return () => { subs.delete(fn) } }, getTheme)

/** Colores del ambiente 3D (cielo, niebla, luces) por tema. */
export const SCENE = {
  dark: {
    bg: '#07111F', horizon: '#0d2a40', zenith: '#040a14', hemiSky: '#5b8fcf', hemiGround: '#08111d',
    sun: '#a9ccff', rim: '#00d5ff', stars: true,
  },
  light: {
    bg: '#cfe3f3', horizon: '#dbe8f2', zenith: '#86b8e6', hemiSky: '#ffffff', hemiGround: '#b3a88f',
    sun: '#fff1d6', rim: '#cfe6ff', stars: false,
  },
} as const

/** Flota simulada: gris en oscuro (se lee sobre el mapa oscuro) y negro en claro. Las líneas reales conservan su color. */
export const FILLER_BUS = { dark: '#9db4c8', light: '#0b0f14' } as const
