import React, { useRef, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { MARKERS } from '../lib/markers.js'
import { supabase } from '../lib/supabase'

// ── Single card SVG ───────────────────────────────────────
// El nombre del alumno YA NO se dibuja dentro del SVG: se imprime grande
// debajo de la tarjeta (ver triggerPrint) y ya se muestra en la grilla de
// pantalla. El SVG solo lleva el marcador, las letras A/B/C/D y el número.
function Card({ id, cardSize = 200 }) {
  const bits = MARKERS[id]
  const total = cardSize

  if (!bits) return (
    <svg width={total} height={total} viewBox={`0 0 ${total} ${total}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display:'block', border:'2px dashed #ccc', borderRadius:8 }}>
      <rect width={total} height={total} fill="#f5f5f5"/>
      <text x={total/2} y={total/2} textAnchor="middle"
        fontSize={14} fill="#aaa" fontFamily="monospace">
        No pattern for #{id}
      </text>
    </svg>
  )

  const pad = Math.round(cardSize * 0.10)   // margen para que las letras respiren
  const markerPx = cardSize - pad * 2
  const cell = markerPx / 7
  const mid = total / 2
  const labelSize = Math.max(13, Math.floor(cardSize * 0.075))

  const cells = []
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const black = (r === 0 || r === 6 || c === 0 || c === 6)
        ? true
        : bits[(r-1)*5+(c-1)] === 1
      cells.push(
        <rect key={`${r}-${c}`}
          x={pad + c*cell} y={pad + r*cell}
          width={cell+0.5} height={cell+0.5}
          fill={black ? '#000' : '#fff'}
        />
      )
    }
  }

  return (
    <svg width={total} height={total} viewBox={`0 0 ${total} ${total}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display:'block', border:'2px solid #000', borderRadius:8 }}>
      <rect width={total} height={total} fill="#fff" rx="7"/>
      <rect x="2" y="2" width={total-4} height={total-4}
        fill="none" stroke="#000" strokeWidth="2.5" rx="5"/>
      {cells}

      {/* Etiquetas de orientación, centradas en el margen de cada lado
          (antes B y D quedaban recortadas por el borde) */}
      <text x={mid} y={Math.round(pad*0.80)} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial" fill="#1a7a1a">A</text>
      <text x={mid} y={total - Math.round(pad*0.32)} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial" fill="#c87000">C</text>
      <text x={total - Math.round(pad*0.5)} y={mid + labelSize*0.35} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial" fill="#1a4a9a">B</text>
      <text x={Math.round(pad*0.5)} y={mid + labelSize*0.35} textAnchor="middle"
        fontSize={labelSize} fontWeight="bold" fontFamily="Arial" fill="#9a1a1a">D</text>

      {/* Número de tarjeta en las esquinas superiores */}
      <text x={6} y={13} fontSize={9} fontFamily="monospace" fill="#bbb">{id}</text>
      <text x={total-6} y={13} textAnchor="end" fontSize={9} fontFamily="monospace" fill="#bbb">{id}</text>
    </svg>
  )
}

// ── Print helper — 2 tarjetas por hoja carta, nombre grande abajo ──
function triggerPrint(items, title) {
  const win = window.open('', '_blank')

  // Agrupar de a 2 por página
  const pages = []
  for (let i = 0; i < items.length; i += 2) pages.push(items.slice(i, i + 2))

  const pagesHtml = pages.map(pair => `
    <div class="page">
      ${pair.map(it => `
        <div class="card-wrap">
          <div class="card-svg">${it.svg}</div>
          <div class="hint">A↑ B→ C↓ D← · rotar para que la respuesta esté arriba</div>
          <div class="name">${it.name || `Tarjeta #${it.id}`}</div>
          ${it.rut ? `<div class="rut">${it.rut}</div>` : ''}
        </div>`).join('')}
    </div>`).join('')

  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: white; font-family: Arial, sans-serif; }
    .page {
      height: 100vh;
      display: flex; flex-direction: column;
      justify-content: space-evenly; align-items: center;
      padding: 0.4in;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .card-wrap {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      page-break-inside: avoid;
    }
    .card-svg svg { width: 4in !important; height: 4in !important; }
    .hint { font-size: 10px; color: #888; }
    .name { font-size: 26px; font-weight: bold; color: #111; text-align: center; margin-top: 4px; }
    .rut  { font-size: 13px; color: #666; font-family: monospace; }
    @media print {
      @page { size: letter portrait; margin: 0; }
    }
  </style></head><body>
    ${pagesHtml}
  <script>window.onload = () => setTimeout(() => window.print(), 400)</script>
  </body></html>`)
  win.document.close()
}

// ── Page ──────────────────────────────────────────────────
export default function CardGeneratorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const courseId = searchParams.get('course')  // optional: ?course=uuid

  const [courses, setCourses] = useState([])
  const [selectedCourse, setSelectedCourse] = useState(courseId || '')
  const [students, setStudents] = useState([])
  const [loading, setLoading] = useState(false)
  const printRef = useRef()

  const availableIds = Object.keys(MARKERS).map(Number)  // 1–50

  // Load courses
  useEffect(() => {
    supabase.from('courses').select('id, name').order('name')
      .then(({ data }) => {
        setCourses(data || [])
        if (courseId && !selectedCourse) setSelectedCourse(courseId)
      })
  }, [])

  // Load students from current year generation when course selected
  useEffect(() => {
    if (!selectedCourse) { setStudents([]); return }
    setLoading(true)
    const year = new Date().getFullYear()
    supabase.from('generations').select('id')
      .eq('course_id', selectedCourse).eq('year', year).single()
      .then(({ data: gen }) => {
        if (!gen) { setStudents([]); setLoading(false); return }
        supabase.from('generation_students')
          .select('card_id, students(id, name, rut)')
          .eq('generation_id', gen.id)
          .eq('active', true)
          .order('card_id')
          .then(({ data }) => {
            const flat = (data || []).map(gs => ({
              id: gs.students.id,
              name: gs.students.name,
              rut: gs.students.rut,
              card_id: gs.card_id,
            }))
            setStudents(flat)
            setLoading(false)
          })
      })
  }, [selectedCourse])

  // Which card IDs to show: if class selected, show only assigned cards;
  // otherwise show all 50
  const cardsToShow = selectedCourse && students.length > 0
    ? students.map(s => ({ id: s.card_id, name: s.name, rut: s.rut }))
    : availableIds.map(id => ({ id, name: null, rut: null }))

  function printCards() {
    const svgs = Array.from(printRef.current.querySelectorAll('svg')).map(s => s.outerHTML)
    const title = selectedCourse
      ? `Tarjetas — ${courses.find(c => c.id === selectedCourse)?.name || 'Cursos'}`
      : 'Todas las tarjetas'
    // Emparejar cada SVG con el nombre/RUT de su tarjeta (mismo orden que cardsToShow)
    const items = cardsToShow.map((c, i) => ({ svg: svgs[i], name: c.name, rut: c.rut, id: c.id }))
    triggerPrint(items, title)
  }

  const courseName = courses.find(c => c.id === selectedCourse)?.name

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh', padding:'1.5rem' }}>
      <div style={{ maxWidth:1000, margin:'0 auto' }}>

        {/* Header */}
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1.5rem', flexWrap:'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/')}>
            <ArrowLeft size={14}/> Atras
          </button>
          <div style={{ flex:1 }}>
            <h1>Tarjetas</h1>
            <p style={{ color:'var(--muted)', fontSize:'.85rem', marginTop:'.2rem' }}>
              {selectedCourse && students.length > 0
                ? `Mostrando ${students.length} tarjetas para ${courseName}`
                : `Mostrando las ${availableIds.length} tarjetas disponibles`}
            </p>
          </div>
          <button className="btn btn-primary" onClick={printCards}>
            <Printer size={14}/> Imprimir tarjetas
          </button>
        </div>

        {/* Class filter */}
        <div style={{
          background:'var(--surface)', border:'1px solid var(--border)',
          borderRadius:8, padding:'1rem', marginBottom:'1.5rem',
          display:'flex', alignItems:'center', gap:'1rem', flexWrap:'wrap'
        }}>
          <label style={{ color:'var(--muted)', fontSize:'.8rem', fontWeight:700, letterSpacing:'.08em', whiteSpace:'nowrap' }}>
            FILTRAR POR CLASE
          </label>
          <select
            value={selectedCourse}
            onChange={e => setSelectedCourse(e.target.value)}
            style={{ flex:1, minWidth:200 }}
          >
            <option value="">— Todas las tarjetas (1–{availableIds.length}) —</option>
            {courses.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          {selectedCourse && students.length === 0 && !loading && (
            <span style={{ color:'var(--danger)', fontSize:'.8rem' }}>
              No hay alumnos en esta clase para el año actual. Selecciona otra clase o muestra todas las tarjetas.
            </span>
          )}
        </div>

        {/* Instructions */}
        <div style={{
          background:'rgba(232,255,71,.06)', border:'1px solid rgba(232,255,71,.2)',
          borderRadius:8, padding:'.75rem 1rem', marginBottom:'1.5rem',
          fontSize:'.82rem', color:'var(--muted)', lineHeight:1.7
        }}>
          <strong style={{ color:'var(--accent)' }}>A = top · B = right · C = bottom · D = left</strong>
          {' '}— Usar camara del telefono. Rotar para que la respuesta esté arriba.
        </div>

        {/* Card grid */}
        {loading ? (
          <p style={{ color:'var(--muted)', padding:'2rem' }}>Cargando alumnos…</p>
        ) : (
          <div ref={printRef} style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))',
            gap:'1.25rem'
          }}>
            {cardsToShow.map(({ id, name, rut }) => (
              <div key={id} style={{
                display:'flex', flexDirection:'column', alignItems:'center', gap:'.5rem',
                padding:'.75rem', background:'var(--surface)',
                border:'1px solid var(--border)', borderRadius:8
              }}>
                <Card id={id} cardSize={360}/>
                <div style={{ textAlign:'center' }}>
                  <div style={{ fontSize:'.75rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>
                    Tarjeta #{id}
                  </div>
                  {name && (
                    <div style={{ fontSize:'.8rem', color:'var(--text)', fontWeight:600, marginTop:'.15rem' }}>
                      {name}
                    </div>
                  )}
                  {rut && (
                    <div style={{ fontSize:'.72rem', color:'var(--muted)', fontFamily:'var(--mono)' }}>
                      {rut}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}