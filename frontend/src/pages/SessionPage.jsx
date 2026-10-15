import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logError, friendlyError } from '../lib/errorLog'
import { useOnline } from '../lib/useOnline'
import { ChevronLeft, ChevronRight, Smartphone } from 'lucide-react'
import SlideRenderer from '../components/SlideRenderer'

import QRCode from 'qrcode'

// ── Código de sesión (para escanear desde el móvil) ──────
function ScanCodeModal({ scanCode, connected = false, onClose }) {
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
          borderRadius: 12, padding: '1rem', marginBottom: '1rem',
        }}>
          {pretty}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem',
          fontSize: '.85rem', fontWeight: 600, marginBottom: '1.25rem',
          color: connected ? 'var(--success)' : 'var(--muted)',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? 'var(--success)' : 'var(--muted)',
            boxShadow: connected ? '0 0 0 4px rgba(46,213,115,.2)' : 'none',
          }}/>
          {connected ? 'Teléfono conectado' : 'Esperando conexión del teléfono…'}
        </div>

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
  const [scannerConnected, setScannerConnected] = useState(false)
  const autoOpenedRef = useRef(false)
  const slidesRef = useRef([])
  const [loadErr, setLoadErr] = useState('')
  const [rtDown, setRtDown] = useState(false)
  const online = useOnline()

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
      if (sessErr || !sess) {
        logError('session.load', sessErr || new Error('Sesión no encontrada'), { sessionId })
        setLoadErr(sessErr && sessErr.code !== 'PGRST116'
          ? friendlyError(sessErr, 'No se pudo cargar la sesión.')
          : 'Sesión no encontrada.')
        return
      }
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
      slidesRef.current = sl || []
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

      await refetchResponses()

      if (sess.current_slide_id && sl) {
        const idx = sl.findIndex(s => s.id === sess.current_slide_id)
        if (idx >= 0) setCurrentIdx(idx)
      }
    }
    load()
  }, [sessionId])

  // Trae TODAS las respuestas de la sesión desde la base. Se usa al cargar y
  // cada vez que el canal realtime se reconecta: los eventos que llegan
  // mientras el WiFi está caído se pierden y sin esto los % quedan cortos.
  async function refetchResponses() {
    const { data, error } = await supabase
      .from('responses').select('*').eq('session_id', sessionId)
    if (error) { logError('session.responses', error); return }
    setResponses(data || [])
  }
  // Al comenzar la sesión, abre el código automáticamente (una sola vez).
useEffect(() => {
  if (session?.status === 'active' && !autoOpenedRef.current) {
    autoOpenedRef.current = true
    setShowQR(true)
  }
}, [session])

// Cuando el teléfono se conecta, cierra el código solo.
useEffect(() => {
  if (scannerConnected) setShowQR(false)
}, [scannerConnected])

// Presencia: detecta cuándo un teléfono entra al escáner de esta sesión.
useEffect(() => {
  const ch = supabase.channel(`presence-session-${sessionId}`, {
    config: { presence: { key: 'computer' } },
  })
  ch.on('presence', { event: 'sync' }, () => {
    const state = ch.presenceState()
    const hayScanner = Object.values(state).flat().some(p => p.role === 'scanner')
    setScannerConnected(hayScanner)
  })
  ch.subscribe(async s => {
    if (s === 'SUBSCRIBED') await ch.track({ role: 'computer' })
  })
  return () => { supabase.removeChannel(ch) }
}, [sessionId])

  // Realtime: keeps in sync with the phone scanner in both directions —
  // new responses (INSERT) coming from a scan, and slide changes (UPDATE)
  // made from the phone's own Prev/Next controls. One channel, two listeners.
  // Se suscribe una sola vez por sesión (lee las slides desde un ref) y al
  // reconectar re-sincroniza respuestas y slide actual.
  useEffect(() => {
    async function resyncSession() {
      await refetchResponses()
      const { data, error } = await supabase.from('sessions')
        .select('status, finished_at, current_slide_id').eq('id', sessionId).single()
      if (error) { logError('session.resync', error); return }
      setSession(prev => prev ? { ...prev, status: data.status, finished_at: data.finished_at } : prev)
      const idx = slidesRef.current.findIndex(s => s.id === data.current_slide_id)
      if (idx >= 0) setCurrentIdx(idx)
    }

    let subscribedOnce = false
    const channel = supabase.channel(`session-${sessionId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'responses',
        filter: `session_id=eq.${sessionId}`
      }, payload => {
        setResponses(prev => prev.some(r => r.id === payload.new.id) ? prev : [...prev, payload.new])
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
          const idx = slidesRef.current.findIndex(s => s.id === newSlideId)
          if (idx >= 0) setCurrentIdx(idx)
        }
      })
      .subscribe(st => {
        if (st === 'SUBSCRIBED') {
          setRtDown(false)
          if (subscribedOnce) resyncSession()
          subscribedOnce = true
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          setRtDown(true)
        }
      })
    const onVisible = () => { if (document.visibilityState === 'visible') resyncSession() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  async function goTo(idx) {
    if (idx < 0 || idx >= slides.length) return
    const prevIdx = currentIdx
    setCurrentIdx(idx)
    const { error } = await supabase.from('sessions')
      .update({ current_slide_id: slides[idx].id })
      .eq('id', sessionId)
    if (error) {
      // Si no se guardó, el teléfono seguiría registrando en la slide
      // anterior: se vuelve atrás y se avisa.
      setCurrentIdx(prevIdx)
      logError('session.goTo', error)
      alert(friendlyError(error, 'No se pudo cambiar de slide. Revisa la conexión e intenta de nuevo.'))
    }
  }

  async function finishSession() {
    if (!confirm('¿Finalizar la sesión? Podrás revelar los resultados después.')) return
    const { error } = await supabase.from('sessions')
      .update({ status: 'finished', finished_at: new Date().toISOString() })
      .eq('id', sessionId)
    if (error) {
      logError('session.finish', error)
      alert(friendlyError(error, 'No se pudo finalizar la sesión. Intenta de nuevo.'))
      return
    }
    setSession(prev => ({ ...prev, status: 'finished' }))
  }

  if (!session) return (
    <div style={{ padding:'2rem', color: loadErr ? 'var(--danger)' : 'var(--muted)' }}>
      {loadErr || 'Cargando sesión…'}
      {loadErr && <button className="btn btn-ghost btn-sm" style={{ marginLeft:'.75rem' }} onClick={() => location.reload()}>Reintentar</button>}
    </div>
  )

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

      {(!online || rtDown) && !isFinished && (
        <div style={{ background:'rgba(255,165,0,.12)', color:'#ffa500', fontSize:'.82rem',
          padding:'.5rem 1.25rem', borderBottom:'1px solid rgba(255,165,0,.3)' }}>
          {!online
            ? '⚠ Sin conexión a internet. Los resultados en pantalla pueden estar incompletos.'
            : '⚠ Reconectando… los porcentajes se actualizarán al volver la conexión.'}
        </div>
      )}
      {totalStudents === 0 && !isFinished && (
        <div style={{ background:'rgba(255,71,87,.1)', color:'var(--danger)', fontSize:'.82rem',
          padding:'.5rem 1.25rem', borderBottom:'1px solid rgba(255,71,87,.3)' }}>
          ⚠ Este curso no tiene alumnos activos para este año: el teléfono no registrará ninguna tarjeta.
          Agrega o copia los alumnos en Cursos y vuelve a iniciar la sesión.
        </div>
      )}

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

      {showQR && <ScanCodeModal scanCode={session?.scan_code} connected={scannerConnected} onClose={() => setShowQR(false)} />}
    </div>
  )
}