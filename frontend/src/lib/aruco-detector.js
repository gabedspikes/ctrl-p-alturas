/**
 * aruco-detector.js — v3 (false-positive hardening)
 * Reliable browser-based marker detector.
 * Uses canvas-based sampling after finding candidate quads via edge detection.
 *
 * Cambios respecto a v2 (para evitar falsos positivos, p. ej. teclas):
 *   Capa 1:
 *     - validateAndExtract() rechaza interiores casi uniformes (cuadrados
 *       sólidos como una tecla o el hueco negro entre teclas).
 *     - matchDict() baja ACCEPT_MAX de 3 a 2 (≈8× menos aceptaciones al azar,
 *       sin perder lecturas reales, que caen a distancia 0–1).
 *   Capa 2:
 *     - detect() exige geometría más estricta (aspecto casi cuadrado + relleno
 *       mínimo) y una "zona de silencio" clara alrededor del candidato.
 *
 * Si alguna tarjeta real dejara de leerse en ángulos muy oblicuos, los dos
 * knobs a relajar primero son: el rango de aspecto (0.7–1.4) y el factor de la
 * zona de silencio (1.2). Todo lo demás tiene margen de sobra.
 */

import { MARKERS as MARKER_DICT } from './markers.js'

// ── Grayscale ─────────────────────────────────────────────
function toGray(imageData) {
  const { data, width, height } = imageData
  const gray = new Uint8Array(width * height)
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i] * 77 + data[i+1] * 150 + data[i+2] * 29) >> 8
  }
  return { data: gray, width, height }
}

// ── Fast adaptive threshold (integral image based) ────────
function adaptiveThreshold(gray, blockSize = 25, C = 10) {
  const { data, width, height } = gray
  const out = new Uint8Array(width * height)
  const half = blockSize >> 1

  // Build integral image
  const integral = new Float64Array((width+1) * (height+1))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      integral[(y+1)*(width+1)+(x+1)] = data[y*width+x]
        + integral[y*(width+1)+(x+1)]
        + integral[(y+1)*(width+1)+x]
        - integral[y*(width+1)+x]
    }
  }

  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - half)
    const y1 = Math.min(height - 1, y + half)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - half)
      const x1 = Math.min(width - 1, x + half)
      const count = (x1 - x0) * (y1 - y0)
      const sum = integral[(y1+1)*(width+1)+(x1+1)]
        - integral[y0*(width+1)+(x1+1)]
        - integral[(y1+1)*(width+1)+x0]
        + integral[y0*(width+1)+x0]
      out[y*width+x] = data[y*width+x] * count < sum - C * count ? 0 : 255
    }
  }
  return { data: out, width, height }
}

// ── Connected components to find black regions ─────────────
function findBlackRegions(bin) {
  const { data, width, height } = bin
  const label = new Int32Array(width * height)
  const regions = [] // [{pixels, minX, maxX, minY, maxY}]
  let nextLabel = 1

  for (let y = 1; y < height-1; y++) {
    for (let x = 1; x < width-1; x++) {
      const idx = y * width + x
      if (data[idx] !== 0 || label[idx] !== 0) continue

      // BFS
      const pixels = []
      let minX = x, maxX = x, minY = y, maxY = y
      const queue = [idx]
      label[idx] = nextLabel

      let qi = 0
      while (qi < queue.length) {
        const ci = queue[qi++]
        const cx = ci % width, cy = Math.floor(ci / width)
        pixels.push({ x: cx, y: cy })
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy

        for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const ni = ci + dy * width + dx
          if (ni < 0 || ni >= data.length) continue
          if (data[ni] === 0 && label[ni] === 0) {
            label[ni] = nextLabel
            queue.push(ni)
          }
        }
      }

      const w = maxX - minX, h = maxY - minY
      // Filter: must be roughly square-ish and large enough
      if (pixels.length > 200 && w > 20 && h > 20) {
        regions.push({ pixels, minX, maxX, minY, maxY, w, h })
      }
      nextLabel++
    }
  }
  return regions
}

// ── Find corners of a region using convex hull extremes ───
function findCorners(region) {
  const { pixels, minX, maxX, minY, maxY } = region
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  // Find extreme points in each quadrant
  let tl = null, tr = null, bl = null, br = null
  let tlD = -1, trD = -1, blD = -1, brD = -1

  for (const p of pixels) {
    const dx = p.x - cx, dy = p.y - cy
    const d = dx*dx + dy*dy
    if (dx <= 0 && dy <= 0 && d > tlD) { tl = p; tlD = d }
    if (dx >= 0 && dy <= 0 && d > trD) { tr = p; trD = d }
    if (dx <= 0 && dy >= 0 && d > blD) { bl = p; blD = d }
    if (dx >= 0 && dy >= 0 && d > brD) { br = p; brD = d }
  }

  if (!tl || !tr || !bl || !br) return null
  return [tl, tr, br, bl]
}

// ── Perspective transform ─────────────────────────────────
function getPerspMatrix(src) {
  // src: [tl, tr, br, bl]
  const [tl, tr, br, bl] = src
  const W = Math.max(
    Math.hypot(tr.x-tl.x, tr.y-tl.y),
    Math.hypot(br.x-bl.x, br.y-bl.y)
  )
  const H = Math.max(
    Math.hypot(bl.x-tl.x, bl.y-tl.y),
    Math.hypot(br.x-tr.x, br.y-tr.y)
  )
  return { W: Math.round(W), H: Math.round(H), src }
}

// Sample the marker using bilinear interpolation
function sampleMarker(gray, corners, gridSize = 7) {
  const [tl, tr, br, bl] = corners
  const bits = []

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      // Normalized position (center of cell)
      const u = (col + 0.5) / gridSize
      const v = (row + 0.5) / gridSize

      // Bilinear interpolation across the quad
      const x = tl.x*(1-u)*(1-v) + tr.x*u*(1-v) + br.x*u*v + bl.x*(1-u)*v
      const y = tl.y*(1-u)*(1-v) + tr.y*u*(1-v) + br.y*u*v + bl.y*(1-u)*v

      const px = Math.round(x), py = Math.round(y)
      if (px < 0 || px >= gray.width || py < 0 || py >= gray.height) {
        bits.push(1)
      } else {
        bits.push(gray.data[py * gray.width + px] < 128 ? 1 : 0)
      }
    }
  }
  return bits
}

// ── Validate border and extract inner bits ────────────────
function validateAndExtract(bits) {
  // All 4 border rows/cols must be >= 80% black
  let borderOk = 0
  for (let i = 0; i < 7; i++) {
    if (bits[i] === 1) borderOk++          // top row
    if (bits[42+i] === 1) borderOk++       // bottom row
    if (bits[i*7] === 1) borderOk++        // left col
    if (bits[i*7+6] === 1) borderOk++      // right col
  }
  // 24 border cells, need 19+
  if (borderOk < 19) return null

  const inner = []
  for (let r = 1; r <= 5; r++)
    for (let c = 1; c <= 5; c++)
      inner.push(bits[r*7+c])

  // ── Capa 1: rechazo de interiores casi uniformes ──
  // Los marcadores reales son 36–64% negros por diseño (ver markers.js). Un
  // cuadrado sólido (una tecla, o el hueco negro entre teclas) llega hasta aquí
  // con el borde negro pero un interior casi uniforme → lo descartamos antes de
  // tocar el diccionario. Rango holgado (7–18 de 25 ≈ 28–72%) para tolerar ruido
  // de muestreo sin perder marcadores reales.
  const black = inner.reduce((s, b) => s + b, 0)
  if (black < 7 || black > 18) return null

  return inner
}

// ── Rotate 5x5 ────────────────────────────────────────────
function rotate5x5(bits, times) {
  let b = [...bits]
  for (let t = 0; t < times; t++) {
    const r = new Array(25)
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        r[j*5+(4-i)] = b[i*5+j]
    b = r
  }
  return b
}

// ── Match against dictionary — returns {id, rotation} or null ────
// Rejects ambiguous reads: only accepts a match that is clearly ONE pattern.
//   ACCEPT_MAX  — best match must differ by at most this many cells (read quality)
//   MIN_MARGIN  — the runner-up must be at least this much worse (no ambiguity)
// El diccionario de 40 patrones tiene distancia mínima 7, así que un decodificador
// de radio 2 sigue corrigiendo lecturas con 2 celdas mal (2·2+1 = 5 ≤ 7) sin
// riesgo de confundir dos alumnos, pero rechaza ~8× más ruido que con radio 3.
const ACCEPT_MAX = 2   // Capa 1: antes 3
const MIN_MARGIN = 3
function matchDict(inner) {
  let bestId = -1, bestDist = 99, bestRot = 0
  let secondDist = 99
  for (let rot = 0; rot < 4; rot++) {
    const rotated = rotate5x5(inner, rot)
    for (const [id, pattern] of Object.entries(MARKER_DICT)) {
      let dist = 0
      for (let i = 0; i < 25; i++) if (rotated[i] !== pattern[i]) dist++
      if (dist < bestDist) {
        secondDist = bestDist
        bestDist = dist; bestId = parseInt(id); bestRot = rot
      } else if (dist < secondDist) {
        secondDist = dist
      }
    }
  }
  // Quality gate: reject if the read is poor OR too close to a second candidate.
  if (bestDist > ACCEPT_MAX) return null
  if (secondDist - bestDist < MIN_MARGIN) return null
  return { id: bestId, rotation: bestRot }
}

// ── Quiet-zone check (Capa 2) ─────────────────────────────
// Muestrea un punto justo por fuera de cada esquina del candidato y exige que
// sea claro. Un marcador real tiene margen blanco alrededor; una tecla está
// pegada a sus vecinas y no lo tiene. Si el candidato está en el borde del
// cuadro y quedan menos de 3 muestras válidas, no bloqueamos (para no perder
// tarjetas legítimas parcialmente fuera de cámara).
function quietZoneOk(gray, corners) {
  const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4
  const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4
  let light = 0, total = 0
  for (const c of corners) {
    const x = Math.round(cx + (c.x - cx) * 1.2)
    const y = Math.round(cy + (c.y - cy) * 1.2)
    if (x < 0 || x >= gray.width || y < 0 || y >= gray.height) continue
    total++
    if (gray.data[y * gray.width + x] >= 128) light++
  }
  if (total < 3) return true          // muestras insuficientes → no bloquear
  return light >= total - 1           // permite 1 muestra oscura (borde de vecino)
}

// ── Main Detector class ───────────────────────────────────
export class ArucoDetector {
  detect(imageData) {
    const gray = toGray(imageData)
    const bin = adaptiveThreshold(gray, 25, 8)
    const regions = findBlackRegions(bin)
    const markers = []
    const seen = new Set()

    for (const region of regions) {
      const { w, h } = region

      // ── Capa 2: geometría más estricta ──
      // Aspecto: un marcador es casi cuadrado (antes 0.5–2.0, demasiado laxo).
      const ratio = w / h
      if (ratio < 0.7 || ratio > 1.4) continue

      // Relleno: la región negra debe ocupar una fracción razonable de su caja.
      // Descarta contornos finos y formas huecas (glifos impresos en teclas,
      // juntas en forma de L entre teclas). Umbral conservador (0.30) para no
      // perder marcadores reales, cuyo relleno ronda 0.5–0.75.
      const fill = region.pixels.length / (w * h)
      if (fill < 0.30) continue

      const corners = findCorners(region)
      if (!corners) continue

      // ── Capa 2: zona de silencio ──
      if (!quietZoneOk(gray, corners)) continue

      // Sample the 7x7 grid
      const bits = sampleMarker(gray, corners, 7)

      // Validate border + interior density, get inner bits
      const inner = validateAndExtract(bits)
      if (!inner) continue

      // Match against dictionary (null = read rejected as too uncertain)
      const match = matchDict(inner)
      if (!match || seen.has(match.id)) continue
      seen.add(match.id)

      markers.push({ id: match.id, rotation: match.rotation, corners })
    }

    return markers
  }
}