// Comprobación mínima del motor: `pnpm check:sim`
import { createSim, DETECT_TICKS, RECOVER_TICKS } from './simulationEngine.ts'

const ok = (c: boolean, msg: string) => { if (!c) throw new Error(`FALLO: ${msg}`) }
const s = createSim()
const base = s.getView().metrics

s.dispatch({ type: 'incident' })
let v = s.getView()
ok(v.state.incident?.districtId === 'centro', 'primer incidente en Centro')
ok(v.metrics.mobility < base.mobility, 'el incidente reduce la movilidad')
ok(v.metrics.alerts > 0 && v.districts[0].level === 'critical', 'alerta y zona crítica')
ok(v.state.incident!.altRoute.length > 2 && !v.state.incident!.altRoute.includes('centro'), 'ruta alterna evita la zona')

for (let i = 0; i < DETECT_TICKS; i++) s.dispatch({ type: 'tick' })
ok(s.getView().state.incident?.phase === 'responding', 'pasa a respuesta')

s.dispatch({ type: 'resolve' })
for (let i = 0; i < RECOVER_TICKS; i++) s.dispatch({ type: 'tick' })
v = s.getView()
ok(v.state.incident === null && v.metrics.alerts === 0, 'incidente cerrado sin alertas')
ok(v.state.events[0].level === 'ok', 'el registro refleja la normalización')

s.dispatch({ type: 'reset' })
ok(s.getView().state.events.length === 3 && s.getView().state.tick === 0, 'reset')
console.log('simulación OK')
