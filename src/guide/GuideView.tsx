import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { ArrowLeft, List, Map as MapIcon, Play } from 'lucide-react'
import { driver, type Driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { ThemeToggle } from '../components/ThemeToggle'
import { setView } from '../view'
import type { Department } from './GuideScene'
import { STEPS, stepHtml } from './steps'
import './guide.css'

const GuideScene = lazy(() => import('./GuideScene').then((m) => ({ default: m.GuideScene })))

const hasWebGL = () => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } }
const anchor = (i: number) => (i === 0 || i === STEPS.length - 1 ? '#guia-st-robot' : `#guia-st-${STEPS[i].id}`)
const ROBOT = '<svg class="guia-bot" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="7" width="14" height="10" rx="3"/><circle cx="9.5" cy="12" r="1.4"/><circle cx="14.5" cy="12" r="1.4"/><path d="M12 7V4"/><circle cx="12" cy="3.2" r="1"/></svg>'

/** Guía interactiva (#guia): recorrido por la investigación sobre un mapa 3D de Bolivia, con driver.js y el robot Wayra. */
export function GuideView() {
  const [deps, setDeps] = useState<Department[] | null>(null)
  const [error, setError] = useState('')
  const [step, setStep] = useState(0)
  const [list, setList] = useState(() => !hasWebGL()) // sin WebGL la guía es una lista de tarjetas
  const [touring, setTouring] = useState(true)
  const drv = useRef<Driver | null>(null)
  const stepRef = useRef(0)
  const touringRef = useRef(true)
  const traveling = useRef(true) // la escena arranca con un vuelo hasta la primera parada

  useEffect(() => {
    fetch('/guia/bolivia.json').then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setDeps(d.departments)).catch((e: Error) => setError(e.message))
  }, [])

  // driver.js resalta la etiqueta de cada parada; la cámara y el robot se mueven con el paso de React
  useEffect(() => {
    const d = driver({
      showProgress: true, progressText: '{{current}} de {{total}}',
      nextBtnText: 'Siguiente', prevBtnText: 'Anterior', doneBtnText: 'Entrar al mapa 3D', closeBtnLabel: 'Salir de la guía',
      popoverClass: 'guia-pop', overlayOpacity: 0.12, stagePadding: 8, stageRadius: 10,
      smoothScroll: false, allowScroll: false, overlayClickBehavior: 'none', waitForElement: 4000,
      steps: STEPS.map((s, i) => ({ element: anchor(i), popover: { title: s.title, description: stepHtml(s), side: 'top', align: 'center' } })),
      onPopoverRender: (p) => { p.title.insertAdjacentHTML('afterbegin', ROBOT) },
      onNextClick: (_el, _s, { driver: x }) => travel((x.getActiveIndex() ?? 0) + 1),
      onPrevClick: (_el, _s, { driver: x }) => travel((x.getActiveIndex() ?? 0) - 1),
      onDoneClick: () => { d.destroy(); setView('centro') },
      onDestroyed: () => { touringRef.current = false; setTouring(false) },
    })
    drv.current = d
    return () => { d.destroy(); drv.current = null; document.body.classList.remove('guia-travel') }
  // travel solo usa refs y setters estables
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Empieza el viaje a otra parada: la tarjeta se oculta hasta que la cámara llega (onArrive). */
  function travel(i: number) {
    if (traveling.current || i < 0 || i >= STEPS.length || i === stepRef.current) return
    traveling.current = true
    stepRef.current = i
    document.body.classList.add('guia-travel')
    setStep(i)
  }
  const arrive = (i: number) => {
    traveling.current = false
    document.body.classList.remove('guia-travel')
    const d = drv.current
    if (!d || !touringRef.current) return
    if (d.isActive()) d.moveTo(i); else d.drive(i)
  }
  const resume = () => { touringRef.current = true; setTouring(true); drv.current?.drive(stepRef.current) }
  const openList = () => { drv.current?.destroy(); setList(true) }
  const closeList = () => { traveling.current = true; touringRef.current = true; setTouring(true); setList(false) } // la escena vuelve a montarse y vuela a la parada

  return (
    <div className="stage guia-stage">
      {deps && !list && (
        <Suspense fallback={<div className="loading">Preparando el mapa de Bolivia…</div>}>
          <GuideScene deps={deps} step={step} onPick={travel} onArrive={arrive} />
        </Suspense>
      )}
      {!deps && !list && <div className="loading">{error ? `No se pudo cargar el mapa: ${error}` : 'Cargando la guía…'}</div>}

      <header className="guia-header panel">
        <button className="icon-btn" aria-label="Volver a la vista ciudad" title="Volver a la vista ciudad" onClick={() => setView('city')}><ArrowLeft size={17} /></button>
        <div className="guia-title"><h1>Guía · LA PAZ 2050</h1><span>Investigación paso a paso</span></div>
        {list
          ? hasWebGL() && <button className="icon-btn" aria-label="Ver en el mapa" title="Ver en el mapa" onClick={closeList}><MapIcon size={17} /></button>
          : <button className="icon-btn" aria-label="Ver como lista" title="Ver como lista" onClick={openList}><List size={17} /></button>}
        <ThemeToggle />
      </header>

      {!list && !touring && (
        <button className="cta guia-resume" onClick={resume}><Play size={16} />Reanudar la guía</button>
      )}

      {list && (
        <main className="guia-list" aria-label="Guía como lista">
          {STEPS.map((s, i) => (
            <article key={s.id} className="panel guia-card">
              <small>{i === 0 ? 'Inicio' : `${i} de ${STEPS.length - 1}`} · {s.place}</small>
              <h2>{s.title}</h2>
              <p>{s.body}</p>
              {s.points && <ul>{s.points.map((p) => <li key={p}>{p}</li>)}</ul>}
            </article>
          ))}
          <button className="cta cta-recover guia-enter" onClick={() => setView('centro')}><MapIcon size={16} />Entrar al mapa 3D del Centro</button>
        </main>
      )}
      <p className="guia-attr">Límites: Natural Earth · Tráfico simulado</p>
    </div>
  )
}
