import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, ChevronRight, Smartphone } from 'lucide-react'
import SlideRenderer from '../components/SlideRenderer'

import QRCode from 'qrcode'

// ── Código de sesión (para escanear desde el móvil) ──────
function ScanCodeModal({ scanCode, onClose }) {
  const pretty = scanCode ? `${scanCode.slice(0, 3)} ${scanCode.slice(3)}` : '––– –––'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 400, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ marginBottom: '.5rem' }}>Abrir Escáner en el Móvil</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
          En tu teléfono, abre la app, entra a <strong style={{ color: 'var(--text)' }}>Escanear</strong> e
          ingresa este código:
        </p>

        <div style={{
          fontSize: '2.75rem', fontWeight: 700, fontFamily: 'monospace',
          letterSpacing: '.35rem', color: 'var(--accent)',
          background: 'var(--bg)', border: '2px solid var(--accent)',
          borderRadius: 12, padding: '1rem', marginBottom: '1.25rem',
        }}>
          {pretty}
        </div>

        <p style={{ fontSize: '.75rem', color: 'var(--muted)', marginBottom: '1.25rem' }}>
          El código funciona mientras la sesión esté en vivo y sirve en el navegador o en la PWA instalada.
        </p>
        <button className="btn btn-ghost" onClick={onClose}>Cerrar</button>
      </div>
    </div>
  )
}

export default function SessionPage() {
  const { id: sessionId } = useParams()
  const navigate = useNavigate()

  const [session, setSession]         = useState(null)
  const [slides, setSlides]           = useState([])
  const [students, setStudents]       = useState([])
  const [responses, setResponses]     = useState([])
  const [currentIdx, setCurrentIdx]   = useState(0)
  const [showQR, setShowQR]           = useState(false)
  const [showStats, setShowStats]     = useState(true)   // live % overlay, per session
  const [showResults, setShowResults] = useState(false)  // final results reveal, hidden by default

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

  // Realtime: keeps in sync with the phone scanner in both directions —
  // new responses (INSERT) coming from a scan, and slide changes (UPDATE)
  // made from the phone's own Prev/Next controls. One channel, two listeners,
  // instead of two separate websocket subscriptions.
  useEffect(() => {
    const channel = supabase.channel(`session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'responses',
        filter: `session_id=eq.${sessionId}`
      }, payload => {
        setResponses(prev => prev.find(r => r.id === payload.new.id) ? prev : [...prev, payload.new])
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sessions',
        filter: `id=eq.${sessionId}`
      }, payload => {
        // Finalización desde el teléfono → reflejar el estado aquí también
        if (payload.new.status === 'finished') {
          setSession(prev => prev ? { ...prev, status: 'finished', finished_at: payload.new.finished_at } : prev)
        }
        const newSlideId = payload.new.current_slide_id
        if (newSlideId) {
          const idx = slides.findIndex(s => s.id === newSlideId)
          if (idx >= 0) setCurrentIdx(idx)
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [sessionId, slides])

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

  // Sorted-by-card-id student list, reused by both the sidebar and the results grid
  const sortedStudents = [...students].sort((a, b) => a.card_id - b.card_id)

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
        {/* Left: slide + controls + optional results */}
        <div style={{ display:'flex', flexDirection:'column', gap:'.75rem', minWidth:0 }}>

          {/* Slim toolbar above the slide — keeps the canvas itself free of overlays */}
          <div style={{ display:'flex', justifyContent:'flex-end' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowStats(v => !v)}
            >
              {showStats ? 'Ocultar %' : 'Mostrar %'}
            </button>
          </div>

          <div
            ref={stageRef}
            style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', width:'100%' }}
          >
            <SlideRenderer
              slide={currentSlide}
              width={stageWidth}
              height={stageHeight}
              showCorrect={revealCorrect}
              tally={showStats ? tally : null}
              totalStudents={totalStudents}
            />
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

          {/* Results — hidden by default, professor decides when to reveal.
              Lives in the space below the canvas, reusing the same card-grid
              look as the student sidebar. Being optional, a bit of scroll
              here is fine — it's a deliberate action per professor. */}
          {isFinished && (
            <div className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: showResults ? '.6rem' : 0 }}>
                <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)' }}>RESULTADOS</h3>
                <button className="btn btn-primary btn-sm" onClick={() => setShowResults(v => !v)}>
                  {showResults ? 'Ocultar resultados' : 'Ver resultados'}
                </button>
              </div>

              {showResults && (
                <div className="results-grid">
                  {sortedStudents.map(st => {
                    const correct  = responses.filter(r => r.student_id === st.id && r.is_correct).length
                    const answered = responses.filter(r => r.student_id === st.id).length
                    return (
                      <div key={st.id} className="student-cell">
                        <span className="card-no">#{st.card_id}</span>
                        <span className="student-name">{st.name}</span>
                        <span className="score">{correct}/{answered}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: compact, always-visible student status sidebar */}
        {/* Right: sidebar fijado a la altura del viewport para usar todo el vertical */}
        <div style={{display:'flex', flexDirection:'column', minHeight:0, position:'sticky', top:'calc(57px + 1.5rem)', height:'calc(100vh - 57px - 3rem)'}}>
          <div className="card" style={{ flex:1, display:'flex', flexDirection:'column', minHeight:0 }}>
            <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.5rem', flexShrink:0 }}>
              ALUMNOS ({totalStudents})
            </h3>
            <div className="student-grid-compact">
              {sortedStudents.map(st => {
                const answered = responses.some(r => r.student_id === st.id && r.slide_id === currentSlide?.id)
                return (
                  <div key={st.id} className={`student-cell compact${answered ? ' answered' : ''}`}>
                    <span className="card-no">#{st.card_id}</span>
                    <span className="student-name">{st.name}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {showQR && <ScanCodeModal scanCode={session?.scan_code} onClose={() => setShowQR(false)} />}
    </div>
  )
}