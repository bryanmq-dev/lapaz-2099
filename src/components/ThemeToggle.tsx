import { Moon, Sun } from 'lucide-react'
import { setTheme, useTheme } from '../theme'

/** Alterna entre modo oscuro y claro. */
export function ThemeToggle() {
  const theme = useTheme()
  const light = theme === 'light'
  return (
    <button className="icon-btn" aria-pressed={light} title={light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'}
      aria-label={light ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro'} onClick={() => setTheme(light ? 'dark' : 'light')}>
      {light ? <Moon size={17} /> : <Sun size={17} />}
    </button>
  )
}
