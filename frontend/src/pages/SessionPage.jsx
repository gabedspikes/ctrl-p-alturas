import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, Smartphone } from 'lucide-react'
import SlideRenderer from '../components/SlideRenderer'

const ANS_COLORS = { A:'#e8ff47', B:'#47c8ff', C:'#ffa500', D:'#ff4757' }
const BAR_COLORS = { A:'#e8ff47', B:'#47c8ff', C:'#ffa500', D:'#ff4757' }

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

  const [session, setSession]     = useState(null)
  const [slides, setSlides]       = useState([])
  const [students, setStudents]   = useState([])
  const [responses, setResponses] = useState([])
  const [currentIdx, setCurrentIdx] = useState(0)
  const [showQR, setShowQR]       = useState(false)
  const [showStats, setShowStats] = useState(true)  // percentage overlay, per session

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
      let students = []
      if (sess.generation_id) {
        const { data: genStu } = await supabase
          .from('generation_students')
          .select('card_id, students(id, name, rut)')
          .eq('generation_id', sess.generation_id)
          .eq('active', true)
          .order('card_id')
        students = (genStu || []).map(gs => ({
          id: gs.students.id,
          name: gs.students.name,
          rut: gs.students.rut,
          card_id: gs.card_id,
        }))
      }
      setStudents(students)

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
    if (!confirm('¿Finalizar la sesión y mostrar los resultados?')) return
    await supabase.from('sessions')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', sessionId)
    setSession(prev => ({ ...prev, status: 'finished' }))
  }


  if (!session) return <div style={{ padding:'2rem', color:'var(--muted)' }}>Loading session…</div>

  const currentSlide    = slides[currentIdx]
  const slideResponses  = responses.filter(r => r.slide_id === currentSlide?.id)
  const totalStudents   = students.length
  const tally = { A:0, B:0, C:0, D:0 }
  slideResponses.forEach(r => { if (tally[r.answer] !== undefined) tally[r.answer]++ })

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
        <span className={`badge ${session.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
          {session.status === 'active' ? '● LIVE' : '■ FINISHED'}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem' }}>
          {session.status === 'active' ? (
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
        {/* Left: slide + controls */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden', position:'relative' }}>
            <SlideRenderer
              slide={slides[currentIdx]}
              width={720}
              height={405}
              showCorrect={session.status === 'finished'}
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
              {showStats ? '👁 %' : '⃠ %'}
            </button>
          </div>

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
          </div>

        {/* Right: student list */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div className="card" style={{ flex:1 }}>
            <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.75rem' }}>
              STUDENT RESPONSES
            </h3>
            <div className="student-list">
              {students.map(st => {
          const resp = responses.find(r => r.student_id === st.id && r.slide_id === currentSlide?.id)
          const answered = !!resp
          return (
            <div key={st.id} className="student-row">
              <span>#{st.card_id} {st.name}</span>
              <span
                className="answer-badge"
                style={{
                  background: answered ? 'var(--success)' : 'transparent',
                  color: answered ? '#0d0d0f' : 'var(--muted)',
                  border: answered ? 'none' : '1px solid var(--border)',
                }}
                title={answered ? 'Respondió' : 'Pendiente'}
              >
                {answered ? '✓' : '·'}
              </span>
            </div>
          )
        })}
            </div>
          </div>

          {session.status === 'finished' && slides.length > 1 && (
            <div className="card">
              <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.75rem' }}>
                RUNNING SCORES
              </h3>
              <div className="student-list">
                {students.map(st => {
                  const correct  = responses.filter(r => r.student_id === st.id && r.is_correct).length
                  const answered = responses.filter(r => r.student_id === st.id).length
                  return (
                    <div key={st.id} className="student-row">
                      <span style={{ fontSize:'.8rem' }}>{st.name}</span>
                      <span style={{ fontFamily:'var(--mono)', fontSize:'.8rem', color:'var(--accent)' }}>
                        {correct}/{answered}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {showQR && <ScanQRModal sessionId={sessionId} onClose={() => setShowQR(false)} />}
    </div>
  )
}