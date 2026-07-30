import { ArucoDetector } from '../lib/aruco-detector.js'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SlideRenderer from '../components/SlideRenderer'

// ── Answer from ArUco corner rotation ───────────────────
// corners are sorted clockwise by angle from centroid: [tl, tr, br, bl]
// The detector also returns the rotation index (0-3) indicating how many
// 90° CW rotations were applied to match the canonical pattern.
// We use the physical position of the topmost edge to determine answer.
//
// The key insight: corners come sorted clockwise from the detector.
// corners[0] = top-left in the CANONICAL (unrotated) orientation.
// When the card is rotated, corners[0] moves to a different screen position.
// Whichever corner is physically highest on screen (lowest y) is corners[0].
// That tells us which label is pointing up:
//   corners[0] at top-left  → A is up (0° rotation, normal)
//   corners[0] at top-right → B is up (90° CW rotation)
//   corners[0] at bot-right → C is up (180° rotation)
//   corners[0] at bot-left  → D is up (270° CW rotation)
//
// But since we sort clockwise, corners[0] is always the top-left of the
// detected quad. Instead we use rotation from the detector directly.
// Fallback: use the centroid of the top edge (average of 2 highest corners).
function cornersToAnswer(corners, rotation) {
  // If detector provided rotation, use it directly
  if (rotation !== undefined) {
    return ['A', 'B', 'C', 'D'][rotation % 4]
  }

  // Fallback: find which edge is highest (lowest y on screen)
  // corners are in clockwise order [0,1,2,3]
  // edges: 0-1=top, 1-2=right, 2-3=bottom, 3-0=left IN CANONICAL ORIENTATION
  // But after rotation we need to find which edge is physically at top

  // Find the two corners with the lowest y values (highest on screen)
  const sorted = [...corners].sort((a, b) => a.y - b.y)
  const topTwo = sorted.slice(0, 2)

  // Find which edge these two corners belong to
  const idx0 = corners.indexOf(topTwo[0])
  const idx1 = corners.indexOf(topTwo[1])
  const diff = Math.abs(idx0 - idx1)

  // Adjacent corners (diff=1 or diff=3) form an edge
  const minIdx = Math.min(idx0, idx1)

  // Map edge index to answer
  // Edge 0-1 = first edge of canonical quad
  // Rotation 0: edge 0-1 is top → A
  // Rotation 1: edge 1-2 is top → B  
  // Rotation 2: edge 2-3 is top → C
  // Rotation 3: edge 3-0 is top → D
  if (diff === 1) return ['A', 'B', 'C', 'D'][minIdx]
  if (diff === 3) return 'D' // edge 3-0
  
  // Diagonal corners — use the average y of top edge as tiebreaker
  const cx = corners.reduce((s, c) => s + c.x, 0) / 4
  const cy = corners.reduce((s, c) => s + c.y, 0) / 4
  // Which quadrant is the topmost corner in?
  const top = sorted[0]
  if (top.x < cx && top.y < cy) return 'A' // top-left
  if (top.x > cx && top.y < cy) return 'B' // top-right
  if (top.x > cx && top.y > cy) return 'C' // bottom-right
  return 'D'
}

// ── Answer colors ────────────────────────────────────────
const ANS_COLORS = { A: '#2E9DF2', B: '#47c8ff', C: '#ffa500', D: '#ff4757' }
const ANS_HEX    = { A: '#2E9DF2', B: '#47c8ff', C: '#ffa500', D: '#ff4757' }

export default function ScanPage() {
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const slideId = searchParams.get('slide')

  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const overlayRef = useRef(null)
  const rafRef     = useRef(null)
  const detectorRef = useRef(null)
  const cooldownRef = useRef({})   // card_id → last scan timestamp
  const scannedRef  = useRef({})   // card_id → answer (this slide)

  const [students, setStudents]     = useState({})  // card_id → student
  const [scanned, setScanned]       = useState({})  // card_id → answer
  const [slideInfo, setSlideInfo]   = useState(null)
  const [sessionInfo, setSessionInfo] = useState(null)
  const [status, setStatus]         = useState('init') // init|loading|ready|error
  const [error, setError]           = useState('')
  const [camReady, setCamReady]     = useState(false)
  const [currentSlideId, setCurrentSlideId] = useState(slideId)

  const COOLDOWN_MS = 2000

  // ── Load session + students + slide ─────────────────────
  useEffect(() => {
    async function load() {
      setStatus('loading')

      const { data: sess, error: sessErr } = await supabase
        .from('sessions')
        .select('*, courses(id, name), presentations(title)')
        .eq('id', sessionId).single()

      if (sessErr || !sess) { setError('Session not found.'); setStatus('error'); return }
      setSessionInfo(sess)
      setCurrentSlideId(sess.current_slide_id)

      // load students keyed by card_id
      const { data: studs } = await supabase
        .from('students').select('*').eq('course_id', sess.course_id)
      const map = {}
      studs?.forEach(s => { map[s.card_id] = s })
      setStudents(map)

      // load slide info for correct answer
      if (sess.current_slide_id) {
        const { data: sl } = await supabase
          .from('slides').select('id, question_text, correct_answer')
          .eq('id', sess.current_slide_id).single()
        setSlideInfo(sl)
      }

      setStatus('ready')
    }
    load()
  }, [sessionId])

  // ── Realtime: follow slide changes from laptop ───────────
  useEffect(() => {
    const channel = supabase.channel(`scan-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sessions',
        filter: `id=eq.${sessionId}`
      }, async payload => {
        // If session finished, stop camera and redirect
        if (payload.new.status === 'finished') {
          if (videoRef.current?.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(t => t.stop())
          }
          if (rafRef.current) cancelAnimationFrame(rafRef.current)
          navigate('/')
          return
        }
        const newSlideId = payload.new.current_slide_id
        if (newSlideId && newSlideId !== currentSlideId) {
          setCurrentSlideId(newSlideId)
          scannedRef.current = {}
          cooldownRef.current = {}
          setScanned({})
          // reload slide info
          const { data: sl } = await supabase
            .from('slides').select('id, question_text, correct_answer')
            .eq('id', newSlideId).single()
          setSlideInfo(sl)
        }
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [sessionId, currentSlideId])

  // ── Start camera ─────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready') return
    async function startCamera() {
      try {
        // prefer rear camera on phones
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width:  { ideal: 1280 },
            height: { ideal: 720 }
          }
        })
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCamReady(true)
      } catch (err) {
        setError(`Camera error: ${err.message}. Make sure you allow camera access.`)
        setStatus('error')
      }
    }
    startCamera()
    return () => {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      }
    }
  }, [status])

  // ── Load ArUco detector (local ES module — no CDN needed) ──
  useEffect(() => {
    if (!camReady) return
    try {
      detectorRef.current = new ArucoDetector()
      startDetectionLoop()
    } catch(e) {
      setError(`ArUco init failed: ${e.message}`)
      setStatus('error')
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [camReady])

  // ── Detection loop ───────────────────────────────────────
  const startDetectionLoop = useCallback(() => {
    const video   = videoRef.current
    const canvas  = canvasRef.current
    const overlay = overlayRef.current
    if (!video || !canvas || !overlay) return

    function tick() {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth
        const h = video.videoHeight
        canvas.width  = w
        canvas.height = h
        overlay.width  = w
        overlay.height = h

        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, w, h)
        const imageData = ctx.getImageData(0, 0, w, h)

        const oct = overlay.getContext('2d')
        oct.clearRect(0, 0, w, h)

        try {
          const markers = detectorRef.current?.detect(imageData) || []
          markers.forEach(marker => {
            const cardId = marker.id
            const corners = marker.corners
            const answer  = cornersToAnswer(corners, marker.rotation)
            const student = studentsRef.current[cardId]
            const alreadyScanned = scannedRef.current[cardId]
            const now = Date.now()
            const cooled = (now - (cooldownRef.current[cardId] || 0)) > COOLDOWN_MS

            // Draw corner box
            oct.beginPath()
            oct.moveTo(corners[0].x, corners[0].y)
            corners.forEach(c => oct.lineTo(c.x, c.y))
            oct.closePath()
            const col = alreadyScanned
              ? (alreadyScanned === slideInfoRef.current?.correct_answer ? '#2ed573' : '#ff4757')
              : ANS_HEX[answer]
            oct.strokeStyle = col
            oct.lineWidth = 3
            oct.stroke()

            // Fill label background
            const cx = corners.reduce((s,c) => s + c.x, 0) / 4
            const cy = corners.reduce((s,c) => s + c.y, 0) / 4
            const label = alreadyScanned
              ? `#${cardId} ${alreadyScanned} ✓`
              : `#${cardId} → ${answer}`
            oct.fillStyle = 'rgba(0,0,0,0.65)'
            oct.fillRect(cx - 60, cy - 20, 120, 28)
            oct.fillStyle = col
            oct.font = 'bold 18px monospace'
            oct.textAlign = 'center'
            oct.fillText(label, cx, cy)

            // draw arrow showing detected direction
            const arrowTips = {
              A: { x: cx,      y: cy - 60 },
              B: { x: cx + 60, y: cy      },
              C: { x: cx,      y: cy + 60 },
              D: { x: cx - 60, y: cy      },
            }
            oct.beginPath()
            oct.moveTo(cx, cy)
            oct.lineTo(arrowTips[answer].x, arrowTips[answer].y)
            oct.strokeStyle = col
            oct.lineWidth = 2
            oct.stroke()

            // Submit if new and cooled down
            if (student && cooled && !alreadyScanned) {
              cooldownRef.current[cardId] = now
              submitAnswer(cardId, answer, student.id)
            }
          })
        } catch (e) {
          // detection errors are non-fatal, just skip frame
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ── Keep refs in sync so callbacks see latest state ──────
  const studentsRef   = useRef({})
  const slideInfoRef  = useRef(null)
  useEffect(() => { studentsRef.current  = students  }, [students])
  useEffect(() => { slideInfoRef.current = slideInfo }, [slideInfo])

  // ── Submit answer to Supabase ────────────────────────────
  async function submitAnswer(cardId, answer, studentId) {
    const sid = currentSlideId || slideInfoRef.current?.id
    if (!sid) return

    const correct = slideInfoRef.current?.correct_answer
    const is_correct = correct ? answer === correct : null

    const { error } = await supabase.from('responses').insert({
      session_id:  sessionId,
      slide_id:    sid,
      student_id:  studentId,
      answer,
      is_correct,
      scanned_at:  new Date().toISOString()
    })

    if (!error) {
      scannedRef.current[cardId] = answer
      setScanned(prev => ({ ...prev, [cardId]: answer }))
    }
  }

  // ── Count helpers ─────────────────────────────────────────
  const totalStudents  = Object.keys(students).length
  const scannedCount   = Object.keys(scanned).length
  const pendingStudents = Object.values(students).filter(s => !scanned[s.card_id])

  // ── Render ───────────────────────────────────────────────
  if (status === 'error') return (
    <div style={styles.errorScreen}>
      <div style={styles.errorBox}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>📷</div>
        <h2 style={{ color: '#ff4757', marginBottom: '.75rem' }}>Camera Error</h2>
        <p style={{ color: '#888', fontSize: '.9rem', lineHeight: 1.6 }}>{error}</p>
        <p style={{ color: '#555', fontSize: '.8rem', marginTop: '1rem' }}>
          Make sure you opened this page over HTTP (not HTTPS) and allowed camera permissions.
        </p>
      </div>
    </div>
  )

  if (status !== 'ready' && status !== 'init') return (
    <div style={styles.loadingScreen}>
      <div style={{ color: '#2E9DF2', fontSize: '1.5rem' }}>◈</div>
      <p style={{ color: '#888', marginTop: '.5rem' }}>Loading session…</p>
    </div>
  )

  return (
    <div style={styles.page}>
      {/* Header */}
      <div style={styles.header}>
        <span style={styles.logo}>◈ SCAN</span>
        <div style={styles.headerInfo}>
          <span style={styles.sessionName}>{sessionInfo?.presentations?.title || 'Session'}</span>
          <span style={styles.className}>{sessionInfo?.courses?.name}</span>
        </div>
        <div style={styles.counter}>
          <span style={{ color: '#2E9DF2', fontWeight: 800, fontSize: '1.2rem' }}>{scannedCount}</span>
          <span style={{ color: '#555', fontSize: '.75rem' }}>/ {totalStudents}</span>
        </div>
      </div>

      {/* Slide preview — compact */}
      {slideInfo && (
        <div style={{ flexShrink:0 }}>
          <SlideRenderer
            slide={slideInfo}
            width={480}
            height={120}
            showCorrect={false}
            compact={true}
          />
        </div>
      )}

      {/* Camera viewfinder */}
      <div style={styles.viewfinder}>
        <video ref={videoRef} style={styles.video} playsInline muted autoPlay />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <canvas ref={overlayRef} style={styles.overlay} />

        {!camReady && (
          <div style={styles.camPrompt}>
            <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>📷</div>
            <p style={{ color: '#2E9DF2', fontWeight: 700 }}>
              {status === 'loading' ? 'Loading…' : 'Starting camera…'}
            </p>
            <p style={{ color: '#666', fontSize: '.8rem', marginTop: '.35rem' }}>
              Allow camera access when prompted
            </p>
          </div>
        )}
      </div>

      {/* Answer legend */}
      <div style={styles.legend}>
        {['A','B','C','D'].map(l => (
          <div key={l} style={{ ...styles.legendItem, borderColor: ANS_COLORS[l] }}>
            <span style={{ color: ANS_COLORS[l], fontWeight: 800 }}>{l}</span>
            <span style={{ color: '#444', fontSize: '.65rem' }}>
              {l==='A'?'↑ top':l==='B'?'→ right':l==='C'?'↓ bottom':'← left'}
            </span>
          </div>
        ))}
      </div>

      {/* Scanned / Pending students */}
      <div style={styles.studentPanel}>
        {Object.values(students).map(st => {
          const ans = scanned[st.card_id]
          const correct = slideInfo?.correct_answer
          return (
            <div key={st.id} style={{
              ...styles.studentRow,
              borderColor: ans
                ? (correct && ans === correct ? '#2ed573' : correct ? '#ff4757' : '#333')
                : '#222'
            }}>
              <span style={styles.cardBadge}>#{st.card_id}</span>
              <span style={styles.studentName}>{st.name}</span>
              {ans
                ? <span style={{ color: ANS_COLORS[ans], fontWeight: 800, fontSize: '.9rem' }}>{ans}</span>
                : <span style={{ color: '#333', fontSize: '.75rem' }}>—</span>
              }
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────
const styles = {
  page: {
    background: '#0d0d0f', minHeight: '100vh', display: 'flex',
    flexDirection: 'column', fontFamily: "'Syne', sans-serif", color: '#e8e8ec',
    // lock to portrait-like on phone
    maxWidth: 480, margin: '0 auto',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: '.75rem',
    padding: '.75rem 1rem', background: '#141417',
    borderBottom: '1px solid #2a2a30', position: 'sticky', top: 0, zIndex: 10,
  },
  logo: { color: '#2E9DF2', fontWeight: 800, fontSize: '.9rem', letterSpacing: '.1em' },
  headerInfo: { flex: 1, display: 'flex', flexDirection: 'column' },
  sessionName: { fontSize: '.8rem', fontWeight: 700 },
  className: { fontSize: '.7rem', color: '#555' },
  counter: { display: 'flex', flexDirection: 'column', alignItems: 'center' },
  questionBar: {
    padding: '.5rem 1rem', background: '#1a1a20',
    borderBottom: '1px solid #2a2a30', fontSize: '.8rem', color: '#aaa',
  },
  viewfinder: {
    position: 'relative', width: '100%', aspectRatio: '4/3',
    background: '#000', overflow: 'hidden',
  },
  video: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
  overlay: {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
  },
  camPrompt: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)',
  },
  legend: {
    display: 'flex', gap: '.5rem', padding: '.6rem 1rem',
    background: '#141417', borderBottom: '1px solid #2a2a30',
  },
  legendItem: {
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
    padding: '.3rem', border: '1px solid', borderRadius: 6,
    background: 'rgba(255,255,255,.03)',
  },
  studentPanel: {
    flex: 1, overflowY: 'auto', padding: '.75rem 1rem',
    display: 'flex', flexDirection: 'column', gap: '.4rem',
  },
  studentRow: {
    display: 'flex', alignItems: 'center', gap: '.6rem',
    padding: '.45rem .6rem', borderRadius: 6,
    background: 'rgba(255,255,255,.02)', border: '1px solid',
    transition: 'border-color .2s',
  },
  cardBadge: {
    fontSize: '.65rem', fontWeight: 700, padding: '.15rem .4rem',
    borderRadius: 99, background: 'rgba(232,255,71,.12)',
    color: '#2E9DF2', fontFamily: 'monospace',
  },
  studentName: { flex: 1, fontSize: '.8rem' },
  errorScreen: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#0d0d0f', padding: '2rem',
  },
  errorBox: {
    background: '#141417', border: '1px solid #2a2a30', borderRadius: 10,
    padding: '2rem', maxWidth: 360, textAlign: 'center',
  },
  loadingScreen: {
    minHeight: '100vh', display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: '#0d0d0f',
  },
}