// AR Quick Look (iPad / iPhone): Apple no implementa WebXR en iOS ni iPadOS, en ningún navegador (todos usan WebKit).
// La alternativa nativa es Quick Look: se exporta la maqueta a USDZ y el sistema la coloca sobre una mesa real.
// Es una foto del momento: la ciudad y los vehículos donde están al tocar el botón (sin datos en vivo ni clics).
import * as THREE from 'three'
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { ribbon } from '../city/shared'
import { FILLER_BUS, getTheme } from '../theme'
import { makeHeight, project, type CentroData } from './data'
import { VEHICLE_SCALE } from './FleetLayers'
import { drape } from './geometry'
import { minibusGeometry, SPECS, trufiGeometry } from './minibus'
import { fleet, vehiclePos } from './useFleet'
import { request, unpack } from './useZoneGeometry'

/** Quick Look disponible: Safari (y los demás navegadores) de iOS / iPadOS. */
export const quickLookSupported = () => {
  try { return document.createElement('a').relList.supports('ar') } catch { return false }
}

const solid = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0 })

/** Construye la maqueta (~1 m de ancho), la exporta a USDZ y la abre en Quick Look. */
export async function openQuickLook(data: CentroData) {
  const light = getTheme() === 'light'
  const r = await request({ zone: data.meta.zone, light, minH: 0, extra: false, ql: true })
  if (r.error) throw new Error(r.error)
  const g = Object.fromEntries(Object.entries(r.geos).map(([k, p]) => [k, unpack(p)]))
  for (const geo of Object.values(g)) geo.deleteAttribute('aWin') // atributo propio del shader de ventanas: no va al USDZ

  const city = new THREE.Group()
  const add = (geo: THREE.BufferGeometry | undefined, color: string) => { if (geo?.getAttribute('position')) city.add(new THREE.Mesh(geo, solid(color))) }
  add(g.terrain, light ? '#cdbf9f' : '#5d6f68')
  add(g.parks, '#6fae6a')
  add(g.plazas, '#d8d2bf')
  add(g.asphalt, '#4b5563')
  add(g.buildings, light ? '#e4e7ec' : '#9fb3c8')

  // rutas de las 3 líneas reales, un color por línea
  const height = makeHeight(data.elevation)
  for (const l of data.lines) {
    const parts = data.routes.filter((rt) => rt.code === l.code).map((rt) => ribbon(drape(rt.pts, height, 3, 6), 10, 0))
    if (parts.length) add(mergeGeometries(parts)!, l.color)
  }

  // vehículos en su posición actual: una malla por color (USDZ no tiene instancias)
  const lineColor = new Map(data.lines.map((l) => [l.code, l.color]))
  // USDZ va sin comprimir: el modelo detallado solo para las 3 líneas reales; la flota simulada, una caja con sus medidas
  const models = { van: minibusGeometry(), car: trufiGeometry(), box: new THREE.BoxGeometry(SPECS.minibus.W, SPECS.minibus.H, SPECS.minibus.L).translate(0, SPECS.minibus.H / 2, 0) }
  const byColor = new Map<string, THREE.BufferGeometry[]>()
  const o = new THREE.Object3D()
  for (const { v } of fleet.cur.values()) {
    const p = vehiclePos(v.id)
    if (!p) continue
    o.position.set(p.x, height(p.x, p.z), p.z)
    o.rotation.set(0, -p.h, 0)
    o.scale.setScalar(VEHICLE_SCALE)
    o.updateMatrix()
    const color = v.state === 'alerta' ? '#ff5470' : lineColor.get(v.code) ?? FILLER_BUS[light ? 'light' : 'dark']
    const geo = (v.sim ? models.box.toNonIndexed() : (v.kind === 'trufi' ? models.car : models.van).clone()).applyMatrix4(o.matrix)
    for (const a of ['color', 'uv']) if (geo.getAttribute(a)) geo.deleteAttribute(a)
    byColor.set(color, [...(byColor.get(color) ?? []), geo])
  }
  for (const [color, list] of byColor) add(mergeGeometries(list)!, color)

  // centrada y a ~1 m de ancho, apoyada en el plano (y = 0 es el punto más bajo del terreno)
  const { bbox } = data.meta
  const [x0, z0] = project([bbox.w, bbox.n]), [x1, z1] = project([bbox.e, bbox.s])
  const s = 1 / Math.max(x1 - x0, z1 - z0)
  city.position.set(-(x0 + x1) / 2, 0, -(z0 + z1) / 2)
  const root = new THREE.Group()
  root.scale.setScalar(s)
  root.add(city)
  root.updateMatrixWorld(true)

  const usdz = await new USDZExporter().parseAsync(root, {
    quickLookCompatible: true,
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  })
  for (const m of city.children) (m as THREE.Mesh).geometry.dispose()
  const url = URL.createObjectURL(new Blob([usdz as BlobPart], { type: 'model/vnd.usdz+zip' }))
  // Quick Look se abre con un enlace rel="ar" que contiene una imagen (requisito de Safari)
  const a = document.createElement('a')
  a.rel = 'ar'
  a.href = url
  a.download = `${data.meta.zone}-maqueta.usdz`
  a.appendChild(document.createElement('img'))
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return usdz.byteLength
}
