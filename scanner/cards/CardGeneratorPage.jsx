import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, Download } from 'lucide-react'

// ── ARUCO Original dictionary — 5x5 bit patterns ─────────
// Each marker is 7x7: 1px black border + 5x5 data + 1px black border
// These are the actual ARUCO original marker bit patterns
const ARUCO_BITS = {
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

function drawMarker(id, cellSize = 20) {
  const bits = ARUCO_BITS[id]
  if (!bits) return null
  const total = 7 // 1 border + 5 data + 1 border
  const size = total * cellSize

  const cells = []
  // border: all black
  for (let i = 0; i < 7; i++) {
    cells.push({ r: 0, c: i, black: true })
    cells.push({ r: 6, c: i, black: true })
    cells.push({ r: i, c: 0, black: true })
    cells.push({ r: i, c: 6, black: true })
  }
  // inner 5x5 data
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      cells.push({ r: row+1, c: col+1, black: bits[row*5+col] === 1 })
    }
  }

  return { cells, size, cellSize }
}

function MarkerSVG({ id, cellSize = 24 }) {
  const marker = drawMarker(id, cellSize)
  if (!marker) return null
  const { cells, size } = marker

  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}>
      <rect width={size} height={size} fill="white"/>
      {cells.map((c, i) => (
        <rect key={i}
          x={c.c * cellSize} y={c.r * cellSize}
          width={cellSize} height={cellSize}
          fill={c.black ? 'black' : 'white'}
        />
      ))}
    </svg>
  )
}

function CardSVG({ id, name, size = 300 }) {
  const markerSize = Math.floor(size * 0.55)
  const cellSize = Math.floor(markerSize / 7)
  const actualMarker = cellSize * 7
  const offset = Math.floor((size - actualMarker) / 2)
  const marker = drawMarker(id, cellSize)
  if (!marker) return null
  const { cells } = marker

  const labelSize = 18
  const mid = size / 2

  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg"
      style={{ border: '2px solid black', borderRadius: 8, display: 'block' }}>
      {/* White background */}
      <rect width={size} height={size} fill="white" rx="8"/>
      {/* Outer border */}
      <rect x="3" y="3" width={size-6} height={size-6}
        fill="none" stroke="black" strokeWidth="3" rx="6"/>

      {/* ArUco marker */}
      {cells.map((c, i) => (
        <rect key={i}
          x={offset + c.c * cellSize}
          y={offset + c.r * cellSize}
          width={cellSize} height={cellSize}
          fill={c.black ? 'black' : 'white'}
        />
      ))}

      {/* Answer labels */}
      <text x={mid} y={20} textAnchor="middle" fontSize={labelSize}
        fontWeight="bold" fontFamily="Arial" fill="black">A</text>
      <text x={mid} y={size-6} textAnchor="middle" fontSize={labelSize}
        fontWeight="bold" fontFamily="Arial" fill="black">C</text>
      <text x={size-8} y={mid+6} textAnchor="middle" fontSize={labelSize}
        fontWeight="bold" fontFamily="Arial" fill="black">B</text>
      <text x={8} y={mid+6} textAnchor="middle" fontSize={labelSize}
        fontWeight="bold" fontFamily="Arial" fill="black">D</text>

      {/* Card ID corners */}
      <text x={8} y={12} fontSize={9} fontFamily="Arial" fill="#999">{id}</text>
      <text x={size-8} y={12} textAnchor="end" fontSize={9} fontFamily="Arial" fill="#999">{id}</text>

      {/* Student name */}
      {name && (
        <text x={mid} y={size-20} textAnchor="middle" fontSize={10}
          fontFamily="Arial" fill="#555">{name}</text>
      )}
    </svg>
  )
}

export default function CardGeneratorPage() {
  const navigate = useNavigate()
  const printRef = useRef()
  const availableIds = Object.keys(ARUCO_BITS).map(Number)

  function printCards() {
    const svgs = printRef.current.querySelectorAll('svg')
    const svgContents = Array.from(svgs).map(s => s.outerHTML).join('')

    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head><title>Cards</title>
    <style>
      body { margin: 0; background: white; }
      .grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 24px; }
      .card-wrap { page-break-inside: avoid; }
      .label { font-size: 10px; color: #888; text-align: center; margin-top: 4px; font-family: Arial; }
      @media print { body { margin: 0; } }
    </style></head><body>
    <div class="grid">
      ${Array.from(svgs).map((s, i) => `
        <div class="card-wrap">
          ${s.outerHTML}
          <div class="label">A=up B=right C=down D=left</div>
        </div>
      `).join('')}
    </div>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
    </body></html>`)
    win.document.close()
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: '1.5rem' }}>
      <div style={{ maxWidth: 900, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={14}/> Back
          </button>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '1.5rem' }}>Card Generator</h1>
            <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginTop: '.2rem' }}>
              Print these cards and cut them out. Rotate so your answer points UP.
            </p>
          </div>
          <button className="btn btn-primary" onClick={printCards}>
            <Printer size={14}/> Print All Cards
          </button>
        </div>

        {/* Instructions */}
        <div style={{
          background: 'rgba(232,255,71,.06)', border: '1px solid rgba(232,255,71,.2)',
          borderRadius: 8, padding: '1rem', marginBottom: '2rem',
          fontSize: '.85rem', color: 'var(--muted)', lineHeight: 1.8
        }}>
          <strong style={{ color: 'var(--accent)' }}>How to use:</strong> Each card has a unique pattern.
          Hold the card up to the phone camera. Rotate it so your chosen answer letter points toward the top of the camera view.
          <br/>
          <strong style={{ color: 'var(--text)' }}>A = top · B = right · C = bottom · D = left</strong>
        </div>

        {/* Card grid */}
        <div ref={printRef} style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '1.5rem'
        }}>
          {availableIds.map(id => (
            <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '.5rem' }}>
              <CardSVG id={id} size={200}/>
              <div style={{ fontSize: '.75rem', color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                Card #{id}
              </div>
              <div style={{ fontSize: '.65rem', color: 'var(--muted)' }}>
                A↑ B→ C↓ D←
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}