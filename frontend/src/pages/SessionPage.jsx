import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, ChevronRight, Smartphone } from 'lucide-react'
import SlideRenderer from '../components/SlideRenderer'

// ── QR Code modal ────────────────────────────────────────
function ScanQRModal({ sessionId, onClose }) {
  const scanUrl = `${window.location.origin}/scan/${sessionId}`

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '.5rem' }}>Abrir Escáner en el Móvil</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
          Escanea este código QR con la cámara de tu teléfono para abrir el escáner.
        </p>
        <img
          src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(scanUrl)}`}
          alt="Scan QR"
          style={{ width: 200, height: 200, borderRadius: 8, border: '4px solid var(--accent)', marginBottom: '1rem' }}
        />
        <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginBottom: '.5rem' }}>Or open this URL manually:</p>
        <code style={{
          display: 'block', background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '.6rem', fontSize: '.75rem',
          color: 'var(--accent)', wordBreak: 'break-all', marginBottom: '1.25rem'
        }}>
          {scanUrl}
        </code>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

export default function SessionPage() {
  const { id: sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession]       = useState(null)
  const [slides, setSlides]         = useState([])
  const [students, setStudents]     = useState([])
  const [responses, setResponses]   = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showQR, setShowQR]         = useState(false)
  const [showStats, setShowStats]   = useState(true)   // live % overlay, per session
  const [showResults, setShowResults] = useState(false) // final results reveal, hidden by default

  // Measure the slide stage to keep the slide big but proportional (16:9)
  const stageRef = useRef(null)
  const [stageWidth, setStageWidth] = useState(720)

  useEffect(() => {
    if (!stageRef.current) return
    const el = stageRef.current
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        setStageWidth(Math.round(entry.contentRect.width))
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    async function load() {
      const { data: sess, error: sessErr } = await supabase
        .from('sessions')
        .select('*, presentations(title, subject_id), courses(id,name), generations(id, year)')
        .eq('id', sessionId).single()
      if (sessErr || !sess) { console.error('Session load failed:', sessErr); return }
      setSession(sess)

      // Traer el nombre del subject por separado (evita join anidado frágil)
      if (sess.presentations?.subject_id) {
        const { data: subj } = await supabase
          .from('subjects').select('name')
          .eq('id', sess.presentations.subject_id).single()
        sess.presentations.subject_name = subj?.name || null
        setSession({ ...sess })
      }

      const { data: sl } = await supabase
        .from('slides').select('*')
        .eq('presentation_id', sess.presentation_id).order('slide_order')
      setSlides(sl || [])

      // Students always come from the generation (course fallback removed)
      let studs = []
      if (sess.generation_id) {
        const { data: genStu } = await supabase
          .from('generation_students')
          .select('card_id, students(id, name, rut)')
          .eq('generation_id', sess.generation_id)
          .eq('active', true)
          .order('card_id')
        studs = (genStu || []).map(gs => ({
          id: gs.students.id,
          name: gs.students.name,
          rut: gs.students.rut,
          card_id: gs.card_id,
        }))
      }
      setStudents(studs)

      const { data: resp } = await supabase
        .from('responses').select('*').eq('session_id', sessionId)
      setResponses(resp || [])

      if (sess.current_slide_id && sl) {
        const idx = sl.findIndex(s => s.id === sess.current_slide_id)
        if (idx >= 0) setCurrentIdx(idx)
      }
    }
    load()
  }, [sessionId])

  // Realtime: new responses from phone scanner
  useEffect(() => {
    const channel = supabase.channel(`session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'responses',
        filter: `session_id=eq.${sessionId}`
      }, payload => {
        setResponses(prev => prev.find(r => r.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [sessionId])

  async function goTo(idx) {
    if (idx < 0 || idx >= slides.length) return
    setCurrentIdx(idx)
    await supabase.from('sessions')
      .update({ current_slide_id: slides[idx].id })
      .eq('id', sessionId)
  }

  async function finishSession() {
    if (!confirm('¿Finalizar la sesión? Podrás revelar los resultados después.')) return
    await supabase.from('sessions')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', sessionId)
    setSession(prev => ({ ...prev, status: 'finished' }))
  }

  if (!session) return <div style={{ padding:'2rem', color:'var(--muted)' }}>Loading session…</div>

  const currentSlide  = slides[currentIdx]
  const totalStudents = students.length
  const isFinished    = session.status === 'finished'
  const revealCorrect = isFinished && showResults

  // Tally for the current slide (drives the live percentage overlay)
  const tally = { A:0, B:0, C:0, D:0 }
  responses.forEach(r => {
    if (r.slide_id === currentSlide?.id && tally[r.answer] !== undefined) tally[r.answer]++
  })

  const stageHeight = Math.round(stageWidth * 9 / 16)

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh' }}>
      {/* Top bar */}
      <div style={{
        display:'flex', alignItems:'center', gap:'1rem', padding:'.75rem 1.25rem',
        background:'var(--surface)', borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:50
      }}>
        <span style={{ fontWeight:800, fontSize:'1rem' }}>{session.presentations?.title}</span>
        <span className="badge badge-blue">{session.courses?.name}</span>
        {session.presentations?.subject_name && (
          <span className="badge badge-accent">{session.presentations.subject_name}</span>
        )}
        <span className={`badge ${isFinished ? 'badge-danger' : 'badge-success'}`}>
          {isFinished ? '■ FINISHED' : '● LIVE'}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem' }}>
          {!isFinished ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowQR(true)}>
                <Smartphone size={13}/> Abrir en Telefono
              </button>
              <button className="btn btn-danger btn-sm" onClick={finishSession}>Finish</button>
            </>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/presentations')}>
              Finalizar y volver a Tests
            </button>
          )}
        </div>
      </div>

      <div className="session-layout">
        {/* Slide stage — grows to fill width, stays 16:9 */}
        <div
          ref={stageRef}
          style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', position:'relative', width:'100%' }}
        >
          <SlideRenderer
            slide={currentSlide}
            width={stageWidth}
            height={stageHeight}
            showCorrect={revealCorrect}
            tally={showStats ? tally : null}
            totalStudents={totalStudents}
          />
          <button
            onClick={() => setShowStats(v => !v)}
            title={showStats ? 'Ocultar porcentajes' : 'Mostrar porcentajes'}
            style={{
              position:'absolute', top:8, right:8, zIndex:2,
              background:'rgba(0,0,0,.55)', border:'1px solid rgba(255,255,255,.15)',
              borderRadius:6, color:'#fff', cursor:'pointer',
              padding:'.35rem .5rem', fontSize:'.7rem', fontWeight:700,
              display:'flex', alignItems:'center', gap:'.3rem',
            }}
          >
            {showStats ? 'Ocultar %' : 'Mostrar %'}
          </button>
        </div>

        {/* Navigation */}
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', justifyContent:'center' }}>
          <button className="btn btn-ghost" onClick={() => goTo(currentIdx - 1)} disabled={currentIdx === 0}>
            <ChevronLeft size={16}/>
          </button>
          <span style={{ fontFamily:'var(--mono)', fontSize:'.85rem', color:'var(--muted)' }}>
            Slide {currentIdx + 1} / {slides.length}
          </span>
          <button className="btn btn-ghost" onClick={() => goTo(currentIdx + 1)} disabled={currentIdx === slides.length - 1}>
            <ChevronRight size={16}/>
          </button>
        </div>

        {/* Student grid — 4 fixed columns, whole cell highlights when read */}
        <div className="card">
          <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.5rem' }}>
            ALUMNOS ({totalStudents})
          </h3>
          <div className="student-grid">
            {students.map(st => {
              const answered = responses.some(r => r.student_id === st.id && r.slide_id === currentSlide?.id)
              return (
                <div key={st.id} className={`student-cell${answered ? ' answered' : ''}`}>
                  <span className="card-no">#{st.card_id}</span>
                  <span className="student-name">{st.name}</span>
                </div>
              )
            })}
          </div>
        </div>

        {/* Results — hidden by default, professor decides when to reveal */}
        {isFinished && (
          <div className="card">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showResults ? '.75rem' : 0 }}>
              <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)' }}>RESULTADOS</h3>
              <button className="btn btn-primary btn-sm" onClick={() => setShowResults(v => !v)}>
                {showResults ? 'Ocultar resultados' : 'Ver resultados'}
              </button>
            </div>

            {showResults && (() => {
              const rows = [...students]
                .sort((a, b) => a.card_id - b.card_id)
                .map(st => ({
                  card_id:  st.card_id,
                  name:     st.name,
                  correct:  responses.filter(r => r.student_id === st.id && r.is_correct).length,
                  answered: responses.filter(r => r.student_id === st.id).length,
                }))
              const mid = Math.ceil(rows.length / 2)
              const halves = [rows.slice(0, mid), rows.slice(mid)]

              const renderTable = (half, key) => (
                <table key={key} style={{ flex: 1, borderCollapse: 'collapse', fontSize: '.8rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
                      <th style={{ padding: '.4rem .5rem', fontWeight: 700, width: 44 }}>#</th>
                      <th style={{ padding: '.4rem .5rem', fontWeight: 700 }}>Nombre</th>
                      <th style={{ padding: '.4rem .5rem', fontWeight: 700, width: 70, textAlign: 'right' }}>Aciertos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {half.map(r => (
                      <tr key={r.card_id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '.4rem .5rem', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                          {r.card_id}
                        </td>
                        <td style={{ padding: '.4rem .5rem' }}>{r.name}</td>
                        <td style={{ padding: '.4rem .5rem', fontFamily: 'var(--mono)', color: 'var(--accent)', textAlign: 'right' }}>
                          {r.correct}/{r.answered}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )

              return (
                <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>
                  {renderTable(halves[0], 'left')}
                  {halves[1].length > 0 && renderTable(halves[1], 'right')}
                </div>
              )
            })()}
          </div>
        )}
      </div>

      {showQR && <ScanQRModal sessionId={sessionId} onClose={() => setShowQR(false)} />}
    </div>
  )
}