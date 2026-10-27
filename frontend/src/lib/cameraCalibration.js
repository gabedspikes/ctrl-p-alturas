/**
 * cameraCalibration.js — corrige cámaras que entregan la imagen espejada o girada.
 *
 * Algunos teléfonos (o navegadores) entregan el video espejado o rotado. Para el
 * escáner eso es grave:
 *   - Girada: la rotación de la tarjeta se lee corrida → A/B/C/D equivocadas.
 *   - Espejada: la mayoría de las tarjetas no se detectan, y 3 de las 40 se leen
 *     como OTRA tarjeta (respuesta a nombre del alumno equivocado).
 *
 * La calibración se guarda por navegador/teléfono en localStorage:
 *   { mirror: bool, rot: 0-3, camera: <nombre de la cámara>, skipped?: bool, at }
 * rot = cuántos pasos de rotación devuelve el detector para una tarjeta con la A
 * arriba (0 = cámara normal).
 */

const KEY = 'ctrlp.cameraCalibration.v1'

export const DEFAULT_CALIBRATION = { mirror: false, rot: 0 }

export function loadCalibration() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (c && typeof c.mirror === 'boolean' && [0, 1, 2, 3].includes(c.rot)) return c
  } catch { /* storage bloqueado o dato corrupto: se trata como sin calibrar */ }
  return null
}

export function saveCalibration(c) {
  const value = { ...c, at: new Date().toISOString() }
  try { localStorage.setItem(KEY, JSON.stringify(value)) } catch { /* modo privado: dura solo esta vez */ }
  return value
}

// La rotación de 180° se corrige girando el cuadro antes de detectar (así la
// vista y las flechas también quedan derechas). Las de 90° se corrigen solo en
// la lectura de la letra, para no deformar la vista.
export function frameTransform(c) {
  const cal = c || DEFAULT_CALIBRATION
  return { mirror: cal.mirror, rot180: cal.rot === 2, offset: cal.rot === 2 ? 0 : cal.rot }
}

// Dibuja el cuadro del video en el canvas aplicando espejo y/o giro de 180°.
export function drawFrame(ctx, video, w, h, { mirror = false, rot180 = false } = {}) {
  const sx = (mirror ? -1 : 1) * (rot180 ? -1 : 1)
  const sy = rot180 ? -1 : 1
  ctx.setTransform(sx, 0, 0, sy, sx < 0 ? w : 0, sy < 0 ? h : 0)
  ctx.drawImage(video, 0, 0, w, h)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
}

// Transformación CSS para mostrar el video igual que lo que se analiza.
export function videoCss(c) {
  const t = frameTransform(c)
  const parts = []
  if (t.mirror) parts.push('scaleX(-1)')
  if (t.rot180) parts.push('rotate(180deg)')
  return parts.length ? parts.join(' ') : undefined
}

// ── Acumulador de la calibración ──────────────────────────
// Durante la calibración cada cuadro se analiza dos veces (normal y espejado).
// La variante correcta lee la tarjeta de forma estable; la incorrecta casi nunca.
export const CALIB_FRAMES_NEEDED = 12

export function newCalibrationRun() {
  return { normal: new Map(), mirrored: new Map(), multi: 0 }
}

function bump(map, markers) {
  if (markers.length !== 1) return
  const k = `${markers[0].id}:${markers[0].rotation}`
  map.set(k, (map.get(k) || 0) + 1)
}

function best(map) {
  let key = null, count = 0
  for (const [k, n] of map) if (n > count) { key = k; count = n }
  return { key, count }
}

/**
 * Agrega un cuadro y devuelve el estado:
 *   { state: 'progress', progress: 0-1 }
 *   { state: 'multi' }       → hay más de una tarjeta a la vista
 *   { state: 'ambiguous' }   → la tarjeta se lee en ambas variantes: usar otra
 *   { state: 'done', mirror, rot, card }
 */
export function addCalibrationFrame(run, normalMarkers, mirroredMarkers) {
  if (normalMarkers.length > 1 || mirroredMarkers.length > 1) {
    run.multi++
    if (run.multi > 8) { run.multi = 0; return { state: 'multi' } }
  }
  bump(run.normal, normalMarkers)
  bump(run.mirrored, mirroredMarkers)

  const n = best(run.normal), m = best(run.mirrored)
  if (n.count >= 4 && m.count >= 4) return { state: 'ambiguous' }

  const win = n.count >= m.count ? { ...n, mirror: false } : { ...m, mirror: true }
  if (win.count >= CALIB_FRAMES_NEEDED) {
    const [card, rot] = win.key.split(':').map(Number)
    return { state: 'done', mirror: win.mirror, rot, card }
  }
  return { state: 'progress', progress: win.count / CALIB_FRAMES_NEEDED }
}
