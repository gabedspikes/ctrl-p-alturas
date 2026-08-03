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
        <h2 style={{ marginBottom: '.5rem' }}>Open Scanner on Phone</h2>
        <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginBottom: '1.5rem' }}>
          Scan this QR code with your phone camera to open the scanner.
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

  useEffect(() => {
    async function load() {
      const { data: sess } = await supabase
        .from('sessions').select('*, presentations(title, subject), courses(id,name), generations(id, year)')
        .eq('id', sessionId).single()
      setSession(sess)

      const { data: sl } = await supabase
        .from('slides').select('*')
        .eq('presentation_id', sess.presentation_id).order('slide_order')
      setSlides(sl || [])

      // Load students from generation if available, else fall back to course students
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
      } else if (sess.course_id) {
        const { data: stu } = await supabase
          .from('students').select('*')
          .eq('course_id', sess.course_id).order('card_id')
        students = stu || []
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
    if (!confirm('Mark this session as finished?')) return
    await supabase.from('sessions')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', sessionId)
    navigate('/')
  }

  async function simulateScan(answer) {
    const slide = slides[currentIdx]
    if (!slide) return
    const unresponded = students.filter(st =>
      !responses.find(r => r.student_id === st.id && r.slide_id === slide.id)
    )
    if (unresponded.length === 0) return alert('All students already answered.')
    const student = unresponded[Math.floor(Math.random() * unresponded.length)]
    const is_correct = slide.correct_answer ? answer === slide.correct_answer : null
    await supabase.from('responses').insert({
      session_id: sessionId, slide_id: slide.id,
      student_id: student.id, answer, is_correct
    })
    const { data } = await supabase.from('responses').select('*').eq('session_id', sessionId)
    setResponses(data || [])
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
        {session.presentations?.subject && (
          <span className="badge badge-accent">{session.presentations.subject}</span>
        )}
        <span className={`badge ${session.status === 'active' ? 'badge-success' : 'badge-danger'}`}>
          {session.status === 'active' ? '● LIVE' : '■ FINISHED'}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem' }}>
          {session.status === 'active' && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowQR(true)}>
                <Smartphone size={13}/> Open on Phone
              </button>
              <button className="btn btn-danger btn-sm" onClick={finishSession}>Finish</button>
            </>
          )}
        </div>
      </div>

      <div className="session-layout">
        {/* Left: slide + controls */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div style={{ border:'1px solid var(--border)', borderRadius:'var(--radius)', overflow:'hidden' }}>
            <SlideRenderer slide={slides[currentIdx]} width={720} height={405} showCorrect={false}/>
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

          {/* Simulate scan — testing only */}
          <div className="card">
            <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.6rem' }}>
              SIMULATE SCAN (testing only)
            </h3>
            <div style={{ display:'flex', gap:'.5rem' }}>
              {['A','B','C','D'].map(l => (
                <button key={l} className="btn btn-ghost" style={{ flex:1, borderColor:ANS_COLORS[l], color:ANS_COLORS[l] }}
                  onClick={() => simulateScan(l)}>{l}</button>
              ))}
            </div>
            <p style={{ fontSize:'.7rem', color:'var(--muted)', marginTop:'.5rem' }}>
              Assigns answer to a random unresponded student.
            </p>
          </div>

          {/* Answer bars */}
          {currentSlide && (
            <div className="card">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'.5rem' }}>
                <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)' }}>RESPONSES</h3>
                <span style={{ fontFamily:'var(--mono)', fontSize:'.8rem', color:'var(--muted)' }}>
                  {slideResponses.length} / {totalStudents}
                </span>
              </div>
              <div className="answer-bars">
                {['A','B','C','D'].map(l => {
                  const count = tally[l]
                  const pct = totalStudents ? Math.round(count / totalStudents * 100) : 0
                  const isCorrect = currentSlide.correct_answer === l
                  const answerText = currentSlide[`answer_${l.toLowerCase()}`]
                  return (
                    <div key={l} className="answer-bar-row">
                      <span className={`answer-pill pill-${l}`}>{l}</span>
                      <div style={{flex:1,display:'flex',flexDirection:'column',gap:'2px'}}>
                        {answerText && (
                          <span style={{fontSize:'.72rem',color:'var(--text)',lineHeight:1.2}}>{answerText}</span>
                        )}
                        <div className="bar-track">
                          <div className="bar-fill" style={{
                            width: `${pct}%`,
                            background: isCorrect ? BAR_COLORS[l] : `${BAR_COLORS[l]}66`
                          }}/>
                        </div>
                      </div>
                      <span style={{ fontFamily:'var(--mono)', fontSize:'.75rem', color:'var(--muted)', minWidth:'2.5rem', textAlign:'right' }}>
                        {count} ({pct}%)
                      </span>
                      {isCorrect && <CheckCircle size={14} color="var(--success)"/>}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: student list */}
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          <div className="card" style={{ flex:1 }}>
            <h3 style={{ fontSize:'.75rem', letterSpacing:'.1em', color:'var(--muted)', marginBottom:'.75rem' }}>
              STUDENT RESPONSES
            </h3>
            <div className="student-list">
              {students.map(st => {
                const resp = slideResponses.find(r => r.student_id === st.id)
                return (
                  <div key={st.id} className="student-row">
                    <div style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                      <span className="badge badge-accent" style={{ fontSize:'.65rem' }}>#{st.card_id}</span>
                      <span style={{ fontSize:'.8rem' }}>{st.name}</span>
                    </div>
                    {resp
                      ? <div style={{ display:'flex', alignItems:'center', gap:'.4rem' }}>
                          <span className={`answer-pill pill-${resp.answer}`}>{resp.answer}</span>
                          {resp.is_correct === true  && <CheckCircle size={14} color="var(--success)"/>}
                          {resp.is_correct === false && <XCircle size={14} color="var(--danger)"/>}
                        </div>
                      : <span style={{ color:'var(--muted)', fontSize:'.75rem' }}>waiting…</span>
                    }
                  </div>
                )
              })}
            </div>
          </div>

          {slides.length > 1 && (
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