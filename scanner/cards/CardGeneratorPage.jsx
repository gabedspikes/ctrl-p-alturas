import React, { useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'

// ── Marker bit patterns (5x5, 1=black 0=white) ───────────
const MARKERS = {
  1:  [0,1,0,0,0, 0,1,1,0,1, 0,0,0,1,1, 1,0,1,0,1, 0,0,1,0,0],
  2:  [0,1,1,0,0, 0,1,0,0,1, 0,0,1,0,0, 1,1,0,0,1, 0,0,0,0,1],
  3:  [0,0,1,1,0, 0,0,0,1,1, 0,1,0,1,0, 0,1,1,0,0, 0,1,0,1,1],
  4:  [0,0,0,1,0, 1,0,0,0,1, 0,1,0,0,0, 0,0,0,1,1, 1,1,0,0,0],
  5:  [0,0,0,0,1, 1,1,0,0,0, 0,0,1,0,1, 1,0,0,1,0, 0,0,1,1,0],
  6:  [0,1,0,1,0, 1,0,1,0,0, 0,0,0,0,1, 0,1,0,0,1, 1,0,1,0,0],
  7:  [1,0,0,1,0, 0,1,0,1,0, 0,0,0,0,0, 0,1,0,1,0, 1,0,0,1,1],
  8:  [1,0,1,0,0, 0,0,1,0,0, 0,1,0,0,0, 0,0,1,0,1, 0,1,0,0,1],
  9:  [0,1,1,1,0, 1,0,0,0,1, 1,0,1,0,1, 1,0,0,0,1, 0,1,1,1,0],
  10: [1,1,0,0,1, 0,0,0,1,1, 0,1,0,0,0, 1,1,0,0,0, 0,0,1,1,0],
}

// Renders a single card as SVG
// Layout: 7x7 grid (1px black border + 5x5 data + 1px black border)
function Card({ id, studentName, rut, cardSize = 220 }) {
  const bits = MARKERS[id]
  if (!bits) return null

  const pad = 28          // space around marker for A/B/C/D labels
  const markerPx = cardSize - pad * 2
  const cell = markerPx / 7   // each of the 7x7 cells
  const total = cardSize

  // Build 7x7 grid: border=black, inner 5x5=data
  const cells = []
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      let black
      if (r === 0 || r === 6 || c === 0 || c === 6) {
        black = true  // border always black
      } else {
        black = bits[(r - 1) * 5 + (c - 1)] === 1
      }
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={pad + c * cell}
          y={pad + r * cell}
          width={cell + 0.5}   // +0.5 prevents thin white gaps
          height={cell + 0.5}
          fill={black ? '#000' : '#fff'}
        />
      )
    }
  }

  const mid = total / 2
  const labelSize = 15

  return (
    <svg
      width={total} height={total}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', border: '2px solid #000', borderRadius: 8 }}
    >
      {/* White background */}
      <rect width={total} height={total} fill="#fff" rx="7"/>

      {/* Outer border line */}
      <rect x="2" y="2" width={total-4} height={total-4}
        fill="none" stroke="#000" strokeWidth="2.5" rx="5"/>

      {/* Marker cells */}
      {cells}

      {/* Answer labels on each edge */}
      <text x={mid} y={16} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#1a7a1a">A</text>
      <text x={mid} y={total-4} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#c87000">C</text>
      <text x={total-4} y={mid+5} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#1a4a9a">B</text>
      <text x={4} y={mid+5} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial, sans-serif" fill="#9a1a1a">D</text>

      {/* Card number — top corners */}
      <text x={6} y={11} fontSize={8} fontFamily="monospace" fill="#aaa">{id}</text>
      <text x={total-6} y={11} textAnchor="end" fontSize={8} fontFamily="monospace" fill="#aaa">{id}</text>

      {/* Student info below marker */}
      {studentName && (
        <text x={mid} y={total-14} textAnchor="middle"
          fontSize={9} fontFamily="Arial, sans-serif" fill="#444">{studentName}</text>
      )}
      {rut && (
        <text x={mid} y={total-5} textAnchor="middle"
          fontSize={8} fontFamily="monospace" fill="#888">{rut}</text>
      )}
    </svg>
  )
}

export default function CardGeneratorPage() {
  const navigate = useNavigate()
  const printRef = useRef()
  const ids = Object.keys(MARKERS).map(Number)

  function printCards() {
    const svgs = printRef.current.querySelectorAll('svg')
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head><title>Cards</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: white; font-family: Arial, sans-serif; }
      .grid { display: flex; flex-wrap: wrap; gap: 12px; padding: 20px; }
      .card-wrap { page-break-inside: avoid; display: flex; flex-direction: column; align-items: center; gap: 4px; }
      .hint { font-size: 9px; color: #888; text-align: center; }
      @media print { 
        body { margin: 0; }
        .grid { gap: 8px; padding: 10px; }
      }
    </style></head><body>
    <div class="grid">
      ${Array.from(svgs).map(s => `
        <div class="card-wrap">
          ${s.outerHTML}
          <div class="hint">A↑ B→ C↓ D← · rotate so answer points UP</div>
        </div>
      `).join('')}
    </div>
    <script>window.onload = () => setTimeout(() => window.print(), 400)</script>
    </body></html>`)
    win.document.close()
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: '1.5rem' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>

        <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={14}/> Back
          </button>
          <div style={{ flex: 1 }}>
            <h1>Student Cards</h1>
            <p style={{ color:'var(--muted)', fontSize:'.85rem', marginTop:'.2rem' }}>
              Print and cut. Rotate card so your answer letter points toward the camera.
            </p>
          </div>
          <button className="btn btn-primary" onClick={printCards}>
            <Printer size={14}/> Print All Cards
          </button>
        </div>

        <div style={{
          background:'rgba(232,255,71,.06)', border:'1px solid rgba(232,255,71,.2)',
          borderRadius:8, padding:'.75rem 1rem', marginBottom:'1.5rem',
          fontSize:'.82rem', color:'var(--muted)', lineHeight:1.7
        }}>
          <strong style={{color:'var(--accent)'}}>A = top · B = right · C = bottom · D = left</strong>
          {' '}— Hold card up to the phone camera. Rotate so your chosen answer points toward the top of the screen.
        </div>

        {/* Preview grid */}
        <div ref={printRef} style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))',
          gap:'1.25rem'
        }}>
          {ids.map(id => (
            <div key={id} style={{
              display:'flex', flexDirection:'column', alignItems:'center',
              gap:'.4rem', padding:'.75rem',
              background:'var(--surface)', border:'1px solid var(--border)', borderRadius:8
            }}>
              <Card id={id} cardSize={200}/>
              <div style={{ fontSize:'.75rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>
                Card #{id}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}