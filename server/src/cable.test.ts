import test from 'node:test'
import assert from 'node:assert/strict'
import { CableSimulator } from './cable.ts'
import { cableLoop } from '../../shared/cableMotion.ts'
import type { CableCatalog } from '../../shared/metro.ts'
const catalog: CableCatalog = { stations: [
  { id: 'a', name: 'A', at: [-68.15, -16.51], osm: 'node/1', lines: ['roja'] },
  { id: 'b', name: 'B', at: [-68.14, -16.51], osm: 'node/2', lines: ['roja'] },
], lines: ['roja', 'verde'].map((id) => ({ id, name: id, color: '#fff', osm: ['way/1'], stationIds: ['a', 'b'], pts: [[-68.15, -16.51], [-68.14, -16.51]], supports: [], issues: [], lengthM: 1067 })) }
const state = (s: CableSimulator, id = 'roja') => s.snapshot().lines.find((l) => l.id === id)!
test('a stopped line preserves position while other lines move; resume continues', () => {
  const sim = new CableSimulator(catalog); sim.setAutomatic(false); sim.step(10)
  const before = state(sim).phaseM
  sim.setState('roja', 'detenido'); sim.step(15)
  assert.equal(state(sim).phaseM, before); assert.ok(state(sim, 'verde').phaseM > before)
  sim.setState('roja', 'normal'); sim.step(); assert.equal(state(sim).phaseM, before + 5)
  assert.equal(sim.snapshot().events.length, 2)
})
test('manual maintenance cancels pending automatic recovery and emits once', () => {
  const sim = new CableSimulator(catalog); sim.setState('roja', 'detenido', 'auto')
  sim.step(20); sim.setState('roja', 'mantenimiento'); sim.setState('roja', 'mantenimiento'); sim.step(100)
  assert.equal(state(sim).state, 'mantenimiento'); assert.equal(state(sim).resumeAt, null)
  assert.equal(sim.snapshot().events.filter((e) => e.lineId === 'roja').length, 2)
})
test('automatic incidents are deterministic and recover; disabled automation does not start more', () => {
  const a = new CableSimulator(catalog), b = new CableSimulator(catalog)
  a.step(60); for (let i = 0; i < 60; i++) b.step()
  assert.deepEqual(a.snapshot().lines, b.snapshot().lines)
  assert.equal(a.snapshot().events.length, 1)
  a.setAutomatic(false); a.step(180)
  assert.ok(a.snapshot().lines.every((l) => l.state === 'normal')); assert.equal(a.snapshot().events.length, 2)
})
test('unknown identifiers/states fail and reset changes session', () => {
  const sim = new CableSimulator(catalog), session = sim.session
  assert.throws(() => sim.setState('unknown', 'normal'))
  assert.throws(() => sim.setState('roja', 'bad' as any))
  sim.step(60); sim.reset(); assert.notEqual(sim.session, session); assert.equal(sim.snapshot().events.length, 0); assert.equal(sim.elapsed, 0)
})
test('cabins follow a continuous closed loop including both terminal turns', () => {
  const loop = cableLoop(catalog.lines[0], catalog.stations)
  const a = loop.at(0).p, b = loop.at(loop.length).p
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01)
  for (let p = 0; p < loop.length; p += 5) {
    const x = loop.at(p).p, y = loop.at(p + 5).p
    assert.ok(Math.hypot(x[0] - y[0], x[1] - y[1]) <= 5.01)
  }
})
