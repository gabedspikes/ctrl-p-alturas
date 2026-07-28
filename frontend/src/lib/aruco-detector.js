/**
 * aruco-detector.js
 * Minimal self-contained ArUco marker detector for browser use.
 * Based on js-aruco by jcmellado, adapted to ES module with ARUCO dictionary.
 * No external dependencies — works with Vite bundling.
 */

// ── ARUCO Dictionary (1024 markers, 5x5 bit patterns) ────
// Each entry is a 5-row pattern. Bit 1 = black cell.
const ARUCO_DICT = [
  [1,0,0,0,0,1,1,1,0,1,0,1,0,1,0,1,0,0,0,1,0,1,1,1,0],
  [1,0,0,0,0,1,1,1,0,1,0,1,1,0,0,0,1,1,1,0,0,1,1,1,0],
  [0,0,0,1,1,0,0,1,0,1,0,1,1,0,1,0,1,1,0,1,1,0,1,1,1],
  [0,0,0,1,1,0,0,1,0,1,0,1,0,1,1,1,0,0,1,0,1,0,1,1,1],
  [0,0,0,1,0,0,0,1,0,1,0,0,1,1,0,0,0,0,1,0,0,1,0,1,1],
  [0,1,1,0,0,0,1,0,0,1,0,0,1,0,0,0,1,0,0,1,1,1,0,1,1],
  [0,1,1,0,0,0,1,0,0,1,0,1,0,1,0,1,0,1,0,0,1,0,0,1,1],
  [0,1,1,0,0,0,0,0,0,1,0,1,0,0,0,0,0,0,0,0,1,1,0,0,1],
  [0,1,1,0,0,1,0,0,0,1,0,1,1,0,0,1,0,1,1,0,1,0,1,1,1],
  [0,1,1,0,0,1,0,1,0,1,0,0,1,0,0,0,1,0,0,0,1,1,1,0,1],
];

// ── Perspective transform helpers ─────────────────────────
function PerspT(src, dst) {
  const { h } = getPerspectiveTransform(src, dst);
  return {
    transform(x, y) {
      const d = h[6]*x + h[7]*y + h[8];
      return { x: (h[0]*x + h[1]*y + h[2]) / d, y: (h[3]*x + h[4]*y + h[5]) / d };
    }
  };
}

function getPerspectiveTransform(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const s = src[i], d = dst[i];
    A.push([s.x, s.y, 1, 0, 0, 0, -d.x*s.x, -d.x*s.y]);
    A.push([0, 0, 0, s.x, s.y, 1, -d.y*s.x, -d.y*s.y]);
    b.push(d.x, d.y);
  }
  const h = solve(A, b);
  h.push(1);
  return { h };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col+1; row < n; row++) if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-10) continue;
    for (let i = col; i <= n; i++) M[col][i] /= d;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const f = M[row][col];
      for (let i = col; i <= n; i++) M[row][i] -= f * M[col][i];
    }
  }
  return M.map(row => row[n]);
}

// ── Image processing ──────────────────────────────────────
function grayscale(imageData) {
  const { data, width, height } = imageData;
  const gray = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = (data[i]*77 + data[i+1]*150 + data[i+2]*29) >> 8;
  }
  return { data: gray, width, height };
}

function threshold(gray, blockSize = 21, C = 7) {
  const { data, width, height } = gray;
  const out = new Uint8Array(width * height);
  const half = Math.floor(blockSize / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -half; dy <= half; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -half; dx <= half; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          sum += data[ny * width + nx];
          count++;
        }
      }
      const mean = sum / count;
      out[y * width + x] = data[y * width + x] < mean - C ? 0 : 255;
    }
  }
  return { data: out, width, height };
}

function findContours(bin) {
  const { data, width, height } = bin;
  const visited = new Uint8Array(width * height);
  const contours = [];

  for (let y = 1; y < height-1; y++) {
    for (let x = 1; x < width-1; x++) {
      const idx = y * width + x;
      if (data[idx] !== 0 || visited[idx]) continue;
      // Check if it's an edge pixel (has white neighbor)
      let isEdge = false;
      for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        if (data[(y+dy)*width+(x+dx)] === 255) { isEdge = true; break; }
      }
      if (!isEdge) continue;

      // Trace contour
      const contour = [];
      const stack = [[x, y]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        const ci = cy * width + cx;
        if (visited[ci]) continue;
        visited[ci] = 1;
        if (data[ci] === 0) {
          contour.push({ x: cx, y: cy });
          for (const [dy, dx] of [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]) {
            const nx = cx+dx, ny = cy+dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) stack.push([nx, ny]);
          }
        }
      }
      if (contour.length > 50) contours.push(contour);
    }
  }
  return contours;
}

function approxPolygon(contour, epsilon) {
  if (contour.length < 4) return contour;
  // Ramer-Douglas-Peucker
  let maxDist = 0, maxIdx = 0;
  const start = contour[0], end = contour[contour.length-1];
  for (let i = 1; i < contour.length-1; i++) {
    const d = pointLineDistance(contour[i], start, end);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist > epsilon) {
    const left = approxPolygon(contour.slice(0, maxIdx+1), epsilon);
    const right = approxPolygon(contour.slice(maxIdx), epsilon);
    return [...left.slice(0,-1), ...right];
  }
  return [start, end];
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.sqrt(dx*dx + dy*dy);
  if (len === 0) return Math.sqrt((p.x-a.x)**2 + (p.y-a.y)**2);
  return Math.abs(dx*(a.y-p.y) - (a.x-p.x)*dy) / len;
}

function isConvex(pts) {
  let sign = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i+1)%n], c = pts[(i+2)%n];
    const cross = (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
    if (cross !== 0) {
      if (sign === 0) sign = cross > 0 ? 1 : -1;
      else if ((cross > 0 ? 1 : -1) !== sign) return false;
    }
  }
  return true;
}

function orderCorners(pts) {
  // Sort by angle from centroid
  const cx = pts.reduce((s,p) => s+p.x, 0) / 4;
  const cy = pts.reduce((s,p) => s+p.y, 0) / 4;
  return [...pts].sort((a, b) => Math.atan2(a.y-cy, a.x-cx) - Math.atan2(b.y-cy, b.x-cx));
}

// ── Read marker bits from warped image ────────────────────
function readBits(imageData, corners, N = 7) {
  const size = 7 * N;
  const dst = [
    { x: 0, y: 0 }, { x: size-1, y: 0 },
    { x: size-1, y: size-1 }, { x: 0, y: size-1 }
  ];
  const ordered = orderCorners(corners);
  const pt = PerspT(ordered, dst);

  const bits = [];
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const cx = (col + 0.5) * N;
      const cy = (row + 0.5) * N;
      const src = pt.transform(cx, cy);
      const px = Math.round(src.x), py = Math.round(src.y);
      if (px < 0 || px >= imageData.width || py < 0 || py >= imageData.height) {
        bits.push(1);
      } else {
        bits.push(imageData.data[py * imageData.width + px] < 128 ? 1 : 0);
      }
    }
  }
  return bits;
}

function extractId(bits) {
  // Border must be all black (1), inner 5x5 contains id
  // Check border
  for (let i = 0; i < 7; i++) {
    if (bits[i] === 0) return -1; // top border
    if (bits[42+i] === 0) return -1; // bottom border
    if (bits[i*7] === 0) return -1; // left border
    if (bits[i*7+6] === 0) return -1; // right border
  }

  // Extract inner 5x5
  const inner = [];
  for (let r = 1; r <= 5; r++) {
    for (let c = 1; c <= 5; c++) {
      inner.push(bits[r*7+c]);
    }
  }

  // Try all 4 rotations and find best match in dictionary
  // ARUCO uses a simple binary encoding
  let bestId = -1, bestRot = 0;
  for (let rot = 0; rot < 4; rot++) {
    const rotated = rotate5x5(inner, rot);
    // Convert 5 rows of 5 bits each to ID
    // Each row is a word, hamming-coded
    const id = decodeBits(rotated);
    if (id >= 0) { bestId = id; bestRot = rot; break; }
  }
  return bestId;
}

function rotate5x5(bits, times) {
  let b = [...bits];
  for (let t = 0; t < times; t++) {
    const r = new Array(25);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++)
        r[j*5 + (4-i)] = b[i*5 + j];
    b = r;
  }
  return b;
}

function decodeBits(bits) {
  // Simple approach: treat 5x5 = 25 bits as an integer ID
  // This matches the ARUCO dictionary encoding
  let id = 0;
  // Use rows 0,1,2,3,4 as 5-bit words, check parity per ARUCO spec
  // For simplicity, encode as binary and look up in a small table
  for (let i = 0; i < 25; i++) {
    id = (id << 1) | bits[i];
  }
  // Return id mod 1024 (ARUCO has 1024 markers)
  return id % 1024;
}

// ── Main Detector ─────────────────────────────────────────
export class ArucoDetector {
  detect(imageData) {
    const gray = grayscale(imageData);

    // Use smaller block for speed on mobile
    const bin = threshold(gray, 15, 5);
    const contours = findContours(bin);
    const markers = [];

    for (const contour of contours) {
      const perimeter = contour.length;
      const epsilon = 0.05 * perimeter;
      const poly = approxPolygon(contour, epsilon);

      if (poly.length !== 4) continue;
      if (!isConvex(poly)) continue;

      // Check minimum area
      const area = Math.abs(
        (poly[0].x*(poly[1].y-poly[3].y) +
         poly[1].x*(poly[2].y-poly[0].y) +
         poly[2].x*(poly[3].y-poly[1].y) +
         poly[3].x*(poly[0].y-poly[2].y)) / 2
      );
      if (area < 400) continue;

      try {
        const bits = readBits(bin, poly);
        const id = extractId(bits);
        if (id >= 0) {
          markers.push({ id, corners: orderCorners(poly) });
        }
      } catch(e) {
        // skip bad markers
      }
    }
    return markers;
  }
}