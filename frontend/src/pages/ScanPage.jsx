import { ArucoDetector } from '../lib/aruco-detector.js'
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logError, friendlyError } from '../lib/errorLog'
import { useOnline } from '../lib/useOnline'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import SlideRenderer from '../components/SlideRenderer'
import {
  loadCalibration, saveCalibration, frameTransform, drawFrame, videoCss,
  newCalibrationRun, addCalibrationFrame, DEFAULT_CALIBRATION,
} from '../lib/cameraCalibration'

// ── Answer from ArUco rotation ───────────────────────────
// El detector devuelve cuántos giros de 90° HORARIOS necesita la grilla leída
// para coincidir con el patrón del diccionario. Si hay que girarla 1 vez en
// sentido horario, la tarjeta está girada 90° ANTIHORARIO: la B (lado derecho
// impreso) queda arriba. Por eso el orden es A,B,C,D.
// (Entre el 06-08-2026 y esta corrección era A,D,C,B, lo que invertía B y D
// en cámaras normales: tarjeta con B arriba se registraba como D y viceversa.)
// `offset` viene de la calibración de la cámara (0 en una cámara normal).
function cornersToAnswer(rotation, offset = 0) {
  return ['A', 'B', 'C', 'D'][(((rotation ?? 0) - offset) % 4 + 4) % 4]
}

// ── Answer colors ────────────────────────────────────────
const ANS_COLORS = { A: '#2E9DF2', B: '#47c8ff', C: '#ffa500', D: '#ff4757' }

export default function ScanPage() {
  const { sessionId } = useParams()
  const [searchParams] = useSearchParams()
  const slideId = searchParams.get('slide')

  const videoRef   = useRef(null)
  const canvasRef  = useRef(null)
  const overlayRef = useRef(null)
  const rafRef     = useRef(null)
  const detectorRef = useRef(null)
  const cooldownRef = useRef({})   // card_id → last scan timestamp
  const scannedRef  = useRef({})   // card_id → answer (this slide)
  const confirmRef  = useRef({})   // card_id → { answer, count }  ← nuevo

  const [students, setStudents]     = useState({})  // card_id → student
  const [scanned, setScanned]       = useState({})  // card_id → answer
  const [slideInfo, setSlideInfo]   = useState(null)
  const [sessionInfo, setSessionInfo] = useState(null)
  const [status, setStatus]         = useState('init') // init|loading|ready|error
  const [error, setError]           = useState('')
  const [camReady, setCamReady]     = useState(false)
  const [currentSlideId, setCurrentSlideId] = useState(slideId)
  const [sessionEnded, setSessionEnded] = useState(false)
  const [slides, setSlides] = useState([])   // ordered list, for Prev/Next controls
  const [showList, setShowList] = useState(false)   // lista de alumnos oculta por defecto
  const [videoAspect, setVideoAspect] = useState(4/3)
  const [errorKind, setErrorKind] = useState('session')   // session | camera
  const [saveFailing, setSaveFailing] = useState(false)   // último guardado falló
  const [rtDown, setRtDown] = useState(false)             // canal realtime caído
  const online = useOnline()

  // Calibración de cámara (por teléfono, en localStorage)
  const calibRef     = useRef(loadCalibration())   // la que usa el escaneo
  const calibRunRef  = useRef(null)                // acumulador mientras se calibra
  const calibOpenRef = useRef(false)               // con el popup abierto no se registran respuestas
  const [calib, setCalib]         = useState(calibRef.current)
  const [calibOpen, setCalibOpen] = useState(false)
  const [calibUi, setCalibUi]     = useState({ phase: 'intro' })   // intro|running|done

  // Refs que leen los callbacks del bucle de cámara (que se crean una sola
  // vez). Antes el bucle usaba el submitAnswer del PRIMER render, con el
  // currentSlideId de ese momento.
  const currentSlideIdRef = useRef(null)
  const slideReadyRef = useRef(false)   // false mientras se carga la slide nueva
  const slideReqRef = useRef(0)         // descarta respuestas de cargas viejas
  const submitRef = useRef(null)
  const studentsRef   = useRef({})
  const slideInfoRef  = useRef(null)

  const COOLDOWN_MS = 2000
  const CONFIRM_FRAMES = 3   // frames coincidentes antes de registrar

// Presencia: avisa al computador que este teléfono se conectó a la sesión.
useEffect(() => {
  if (status !== 'ready') return
  const ch = supabase.channel(`presence-session-${sessionId}`, {
    config: { presence: { key: `scanner-${Math.random().toString(36).slice(2)}` } },
  })
  ch.subscribe(async s => {
    if (s === 'SUBSCRIBED') await ch.track({ role: 'scanner' })
  })
  return () => { supabase.removeChannel(ch) }
}, [sessionId, status])
  // ── Load session + students + slide ─────────────────────
  useEffect(() => {
    async function load() {
      setStatus('loading')

      const { data: sess, error: sessErr } = await supabase
        .from('sessions')
        .select('*, courses(id, name), presentations(title), generations(id, year)')
        .eq('id', sessionId).single()

      if (sessErr || !sess) {
        if (sessErr) logError('scan.loadSession', sessErr, { sessionId })
        setErrorKind('session')
        setError(sessErr && sessErr.code !== 'PGRST116'
          ? friendlyError(sessErr, 'No se pudo cargar la sesión.')
          : 'Sesión no encontrada. Revisa el código en el computador.')
        setStatus('error'); return
      }
      setSessionInfo(sess)
      if (sess.status !== 'active') { setSessionEnded(true); setStatus('ready'); return }

      // Ordered slide list so Prev/Next can be controlled from the phone too
      const { data: slideList } = await supabase
        .from('slides').select('id, slide_order')
        .eq('presentation_id', sess.presentation_id)
        .order('slide_order')
      setSlides(slideList || [])

      // Students always come from the generation (course fallback removed)
      let studs = []
      if (sess.generation_id) {
        const { data: genStu, error: gsErr } = await supabase
          .from('generation_students')
          .select('card_id, students(id, name, rut)')
          .eq('generation_id', sess.generation_id)
          .eq('active', true)
        if (gsErr) logError('scan.loadStudents', gsErr)
        studs = (genStu || []).map(gs => ({
          id: gs.students.id,
          name: gs.students.name,
          rut: gs.students.rut,
          card_id: gs.card_id,
        }))
      }
      const map = {}
      studs.forEach(s => { map[s.card_id] = s })
      studentsRef.current = map
      setStudents(map)
      if (studs.length === 0) {
        setErrorKind('session')
        setError('Este curso no tiene alumnos activos para este año. Revisa la lista del curso en el computador (Cursos) antes de escanear.')
        setStatus('error'); return
      }

      if (sess.current_slide_id) await applySlideChange(sess.current_slide_id)

      setStatus('ready')
    }
    load()
  }, [sessionId])

  // Applies a slide change locally: resets per-slide scan state and reloads
  // the slide's question/correct answer. Used both by the realtime listener
  // (when the computer changes slide) and by the Prev/Next buttons below.
  // Mientras carga, el escaneo queda en pausa (slideReadyRef = false) para
  // que ninguna lectura se registre en la slide equivocada. Además trae las
  // respuestas ya guardadas de esa slide: si el teléfono se recarga, no se
  // vuelve a pedir a los alumnos que levanten la tarjeta.
  async function applySlideChange(newSlideId) {
    const req = ++slideReqRef.current
    slideReadyRef.current = false
    currentSlideIdRef.current = newSlideId
    setCurrentSlideId(newSlideId)
    scannedRef.current = {}
    cooldownRef.current = {}
    confirmRef.current  = {}
    setScanned({})

    const [{ data: sl, error: slErr }, { data: prev, error: rErr }] = await Promise.all([
      supabase.from('slides').select('id, question_text, correct_answer').eq('id', newSlideId).single(),
      supabase.from('responses').select('student_id, answer').eq('session_id', sessionId).eq('slide_id', newSlideId),
    ])
    if (req !== slideReqRef.current) return       // llegó otro cambio mientras tanto
    if (slErr) { logError('scan.loadSlide', slErr); setSaveFailing(true); return }
    if (rErr) logError('scan.loadPrevResponses', rErr)

    const byStudent = {}
    for (const r of prev || []) byStudent[r.student_id] = r.answer
    const already = {}
    for (const st of Object.values(studentsRef.current)) {
      if (byStudent[st.id]) already[st.card_id] = byStudent[st.id]
    }
    scannedRef.current = already
    setScanned(already)
    slideInfoRef.current = sl
    setSlideInfo(sl)
    slideReadyRef.current = true
  }

  // Prev/Next from the phone — writes to the shared session row, same as
  // the computer's own navigation, so both devices stay in sync.
 async function goToSlide(delta) {
  if (!slides.length) return
  const idx = slides.findIndex(s => s.id === currentSlideId)
  const newIdx = idx + delta
  if (newIdx < 0 || newIdx >= slides.length) return
  const newSlideId = slides[newIdx].id

  const { error } = await supabase.from('sessions')
    .update({ current_slide_id: newSlideId })
    .eq('id', sessionId)

  if (error) {
    logError('scan.goToSlide', error)
    alert(friendlyError(error, 'No se pudo cambiar la slide. Intenta de nuevo.'))
    return
  }
  applySlideChange(newSlideId)
}
async function finishSession() {
  if (!confirm('¿Finalizar la sesión para todos? Esto cierra la presentación.')) return
  const { error } = await supabase.from('sessions')
    .update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', sessionId)
  if (error) {
    logError('scan.finishSession', error)
    alert(friendlyError(error, 'No se pudo finalizar la sesión. Intenta de nuevo.'))
  }
}
  // ── Realtime: follow slide changes from laptop (or from this phone) ──
  // Una sola suscripción por sesión (antes se recreaba en cada cambio de
  // slide). Si el canal se cae y vuelve, se re-sincroniza desde la base
  // porque los eventos perdidos durante el corte no se reenvían.
  useEffect(() => {
    function stopCamera() {
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop())
      }
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    function applyRow(row) {
      if (row.status === 'finished') { stopCamera(); setSessionEnded(true); return }
      if (row.current_slide_id && row.current_slide_id !== currentSlideIdRef.current) {
        applySlideChange(row.current_slide_id)
      }
    }
    async function resync() {
      const { data, error } = await supabase.from('sessions')
        .select('status, current_slide_id').eq('id', sessionId).single()
      if (error) { logError('scan.resync', error); return }
      applyRow(data)
    }

    let subscribedOnce = false
    const channel = supabase.channel(`scan-session-${sessionId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'sessions',
        filter: `id=eq.${sessionId}`
      }, payload => applyRow(payload.new))
      .subscribe(st => {
        if (st === 'SUBSCRIBED') {
          setRtDown(false)
          if (subscribedOnce) resync()
          subscribedOnce = true
        } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' || st === 'CLOSED') {
          setRtDown(true)
        }
      })
    // Al volver de segundo plano (pantalla bloqueada) también se re-sincroniza
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  // ── Start camera ─────────────────────────────────────────
  useEffect(() => {
    if (status !== 'ready' || sessionEnded) return
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
        logError('scan.camera', err, { name: err?.name })
        setErrorKind('camera')
        setError(
          err?.name === 'NotAllowedError'  ? 'Se negó el permiso de cámara. Actívalo en los ajustes del navegador para este sitio y recarga.' :
          err?.name === 'NotFoundError'    ? 'Este dispositivo no tiene cámara disponible.' :
          err?.name === 'NotReadableError' ? 'La cámara está siendo usada por otra app. Ciérrala y recarga.' :
          `No se pudo iniciar la cámara (${err?.message || err}).`)
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
      logError('scan.arucoInit', e)
      setErrorKind('camera')
      setError(`No se pudo iniciar el detector de tarjetas: ${e.message}`)
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
        // Redimensionar un canvas lo reinicia y reasigna memoria: hacerlo
        // solo cuando cambia el tamaño (antes era en cada frame).
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h
          overlay.width = w; overlay.height = h
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const oct = overlay.getContext('2d')
        oct.clearRect(0, 0, w, h)

        // Calibrando: se analiza el cuadro normal y espejado, sin registrar nada
        if (calibRunRef.current) {
          try { calibrationTick(ctx, video, w, h) } catch (e) { logError('scan.calibrate', e) }
          rafRef.current = requestAnimationFrame(tick)
          return
        }
        // Popup de calibración abierto (intro/resultado): escaneo en pausa
        if (calibOpenRef.current) {
          rafRef.current = requestAnimationFrame(tick)
          return
        }

        const t = frameTransform(calibRef.current)
        drawFrame(ctx, video, w, h, t)
        const imageData = ctx.getImageData(0, 0, w, h)

        try {
          const markers = detectorRef.current?.detect(imageData) || []
          markers.forEach(marker => {
            const cardId = marker.id
            const corners = marker.corners
            const answer  = cornersToAnswer(marker.rotation, t.offset)
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
              : ANS_COLORS[answer]
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

            // Submit only after N frames agree (filtra falsos positivos esporádicos)
if (student && cooled && !alreadyScanned && slideReadyRef.current) {
  const prev = confirmRef.current[cardId]
  if (prev && prev.answer === answer) prev.count++
  else confirmRef.current[cardId] = { answer, count: 1 }

  if (confirmRef.current[cardId].count >= CONFIRM_FRAMES) {
    cooldownRef.current[cardId] = now
    confirmRef.current[cardId] = null
    submitRef.current?.(cardId, answer, student.id)
  }
}
          })
        } catch (e) {
          // Un frame con error no es fatal: se salta. Se registra (con
          // deduplicación) para enterarnos si pasa seguido en algún teléfono.
          logError('scan.detectFrame', e)
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    let lastShown = null
    function calibrationTick(ctx, video, w, h) {
      const det = detectorRef.current
      if (!det) return
      drawFrame(ctx, video, w, h, { mirror: false })
      const normal = det.detect(ctx.getImageData(0, 0, w, h)) || []
      drawFrame(ctx, video, w, h, { mirror: true })
      const mirrored = det.detect(ctx.getImageData(0, 0, w, h)) || []
      if (!normal.length && !mirrored.length) return

      const res = addCalibrationFrame(calibRunRef.current, normal, mirrored)
      if (res.state === 'done') {
        calibRunRef.current = null
        lastShown = null
        setCalibUi({ phase: 'done', result: res })
      } else if (res.state === 'ambiguous') {
        calibRunRef.current = newCalibrationRun()
        setCalibUi({ phase: 'running', progress: 0,
          msg: 'Esta tarjeta no sirve para calibrar. Prueba con una tarjeta de otro número.' })
      } else if (res.state === 'multi') {
        setCalibUi(u => ({ ...u, msg: 'Se ven varias tarjetas. Deja solo una frente a la cámara.' }))
      } else {
        const p = Math.round(res.progress * 10) / 10
        if (p !== lastShown) { lastShown = p; setCalibUi(u => ({ ...u, progress: p })) }
      }
    }

    rafRef.current = requestAnimationFrame(tick)
  }, [])

  // ── Calibración de cámara ────────────────────────────────
  function cameraLabel() {
    return videoRef.current?.srcObject?.getVideoTracks?.()[0]?.label || ''
  }
  function openCalibration() {
    calibRunRef.current = null
    calibOpenRef.current = true
    setCalibUi({ phase: 'intro' })
    setCalibOpen(true)
  }
  function closeCalibration() {
    calibRunRef.current = null
    calibOpenRef.current = false
    setCalibOpen(false)
  }
  function startCalibration() {
    calibRunRef.current = newCalibrationRun()
    setCalibUi({ phase: 'running', progress: 0 })
  }
  function applyCalibration(c) {
    calibRef.current = saveCalibration({ ...c, camera: cameraLabel() })
    setCalib(calibRef.current)
    confirmRef.current = {}   // descartar lecturas a medio confirmar con la configuración anterior
    closeCalibration()
  }
  function skipCalibration() {
    // Sin calibración guardada, "Omitir" deja la cámara como normal y no vuelve a preguntar
    if (!calibRef.current) applyCalibration({ ...DEFAULT_CALIBRATION, skipped: true })
    else closeCalibration()
  }

  // Primera vez en este teléfono, o la cámara cambió: abrir la calibración
  useEffect(() => {
    if (!camReady) return
    const c = calibRef.current
    if (!c || (c.camera && cameraLabel() && c.camera !== cameraLabel())) openCalibration()
  }, [camReady])

  // ── Keep refs in sync so callbacks see latest state ──────
  useEffect(() => { studentsRef.current  = students  }, [students])

  // ── Submit answer to Supabase ────────────────────────────
  // upsert + ignoreDuplicates: si el teléfono se recargó o hay 2 teléfonos
  // en la misma sesión, la base guarda UNA respuesta por alumno y slide.
  // is_correct lo recalcula la base (trigger) con la respuesta correcta real.
  async function submitAnswer(cardId, answer, studentId) {
    const sid = currentSlideIdRef.current
    if (!sid || !slideReadyRef.current) return
    const correct = slideInfoRef.current?.correct_answer
    const is_correct = correct ? answer === correct : null

    const { error } = await supabase.from('responses').upsert({
      session_id:  sessionId,
      slide_id:    sid,
      student_id:  studentId,
      answer,
      is_correct,
      scanned_at:  new Date().toISOString()
    }, { onConflict: 'session_id,slide_id,student_id', ignoreDuplicates: true })

    if (sid !== currentSlideIdRef.current) return   // la slide cambió mientras se guardaba
    if (!error) {
      setSaveFailing(false)
      scannedRef.current[cardId] = answer
      setScanned(prev => ({ ...prev, [cardId]: answer }))
      return
    }
    if (/finalizada/i.test(error.message)) { setSessionEnded(true); return }
    // Otro error (red, etc.): no se marca como escaneado → se reintenta solo
    // al volver a ver la tarjeta tras el cooldown. Se avisa al profesor.
    setSaveFailing(true)
    logError('scan.submitAnswer', error, { cardId, slide: sid })
  }
  submitRef.current = submitAnswer

  // ── Count helpers ─────────────────────────────────────────
  const currentSlideIdx = slides.findIndex(s => s.id === currentSlideId)
  const totalStudents  = Object.keys(students).length
  const scannedCount   = Object.keys(scanned).length

  // ── Render ───────────────────────────────────────────────
  if (status === 'error') return (
    <div style={styles.errorScreen}>
      <div style={styles.errorBox}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{errorKind === 'camera' ? '📷' : '⚠'}</div>
        <h2 style={{ color: '#ff4757', marginBottom: '.75rem' }}>
          {errorKind === 'camera' ? 'Problema con la cámara' : 'No se puede escanear'}
        </h2>
        <p style={{ color: '#888', fontSize: '.9rem', lineHeight: 1.6 }}>{error}</p>
        <button style={{ ...styles.finishBtn, marginTop: '1.25rem', color: '#e8e8ec', borderColor: '#2a2a30', padding: '.5rem 1rem' }}
          onClick={() => location.reload()}>Reintentar</button>
      </div>
    </div>
  )
  if (sessionEnded) return (
    <div style={styles.loadingScreen}>
      <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>✓</div>
      <h2 style={{ color: '#2ed573', marginBottom: '.5rem' }}>Sesión finalizada</h2>
      <p style={{ color: '#888', fontSize: '.9rem', textAlign: 'center', maxWidth: 280 }}>
        El profesor cerró la sesión. Los resultados se muestran en el computador.
        Ya puedes cerrar esta pestaña.
      </p>
    </div>
  )

  if (status !== 'ready' && status !== 'init') return (
    <div style={styles.loadingScreen}>
      <div style={{ color: '#2E9DF2', fontSize: '1.5rem' }}>◈</div>
      <p style={{ color: '#888', marginTop: '.5rem' }}>Cargando sesión…</p>
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
        <button style={styles.calibBtn} onClick={openCalibration} title="Calibrar cámara">📷</button>
        <button style={styles.finishBtn} onClick={finishSession}>Finalizar</button>
      </div>

      {(!online || rtDown || saveFailing) && (
        <div style={styles.warnBar}>
          {!online
            ? '⚠ Sin conexión. Las lecturas no se están guardando.'
            : saveFailing
              ? '⚠ No se pudo guardar la última lectura. Se reintenta al volver a ver la tarjeta.'
              : '⚠ Reconectando con el computador…'}
        </div>
      )}

      {/* Slide navigation — lets the professor advance from the phone too */}
      {slides.length > 1 && (
        <div style={styles.slideNav}>
          <button
            style={{ ...styles.navBtn, opacity: currentSlideIdx <= 0 ? 0.35 : 1 }}
            onClick={() => goToSlide(-1)}
            disabled={currentSlideIdx <= 0}
          >
            <ChevronLeft size={16}/>
          </button>
          <span style={styles.slideNavLabel}>
            {currentSlideIdx >= 0 ? currentSlideIdx + 1 : '–'} / {slides.length}
          </span>
          <button
            style={{ ...styles.navBtn, opacity: (currentSlideIdx < 0 || currentSlideIdx >= slides.length - 1) ? 0.35 : 1 }}
            onClick={() => goToSlide(1)}
            disabled={currentSlideIdx < 0 || currentSlideIdx >= slides.length - 1}
          >
            <ChevronRight size={16}/>
          </button>
        </div>
      )}

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
      <div style={{ ...styles.viewfinder, aspectRatio: String(videoAspect) }}>
        <video ref={videoRef} style={{ ...styles.video, transform: calibOpen ? undefined : videoCss(calib) }} playsInline muted autoPlay
        onLoadedMetadata={e => {
        const v = e.currentTarget
       if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight) }}/>
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <canvas ref={overlayRef} style={styles.overlay} />

        {!camReady && (
          <div style={styles.camPrompt}>
            <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>📷</div>
            <p style={{ color: '#2E9DF2', fontWeight: 700 }}>
              {status === 'loading' ? 'Loading…' : 'Starting camera…'}
            </p>
            <p style={{ color: '#666', fontSize: '.8rem', marginTop: '.35rem' }}>
              Permite el acceso a la cámara para escanear tarjetas.
            </p>
          </div>
        )}
      </div>

      {/* ── Calibración de cámara ─────────────────────── */}
      {calibOpen && (
        <div style={styles.calibSheet}>
          <div style={{ fontWeight: 800, marginBottom: '.4rem' }}>Calibrar cámara</div>

          {calibUi.phase === 'intro' && (<>
            <p style={styles.calibText}>
              Algunos teléfonos entregan la imagen espejada o girada, y el escáner lee mal las
              respuestas. Sostén <b>una</b> tarjeta frente a la cámara con la letra <b>A arriba</b>,
              como la mostraría un alumno, y el teléfono en la posición en que vas a escanear.
            </p>
            <div style={styles.calibBtns}>
              <button style={styles.calibGhost} onClick={skipCalibration}>
                {calibRef.current ? 'Cancelar' : 'Omitir'}
              </button>
              <button style={styles.calibPrimary} onClick={startCalibration}>Comenzar</button>
            </div>
          </>)}

          {calibUi.phase === 'running' && (<>
            <p style={styles.calibText}>
              {calibUi.msg || 'Buscando la tarjeta… mantenla quieta con la A arriba.'}
            </p>
            <div style={styles.calibBar}>
              <div style={{ ...styles.calibFill, width: `${(calibUi.progress || 0) * 100}%` }}/>
            </div>
            <div style={styles.calibBtns}>
              <button style={styles.calibGhost} onClick={closeCalibration}>Cancelar</button>
            </div>
          </>)}

          {calibUi.phase === 'done' && (() => {
            const r = calibUi.result
            const normal = !r.mirror && r.rot === 0
            return (<>
              <p style={styles.calibText}>
                {normal
                  ? <>✓ Tu cámara funciona normal (tarjeta #{r.card} leída).</>
                  : <>Se detectó que la imagen de tu cámara está
                      {r.mirror ? <b> espejada</b> : null}
                      {r.mirror && r.rot ? ' y' : null}
                      {r.rot ? <b> girada {r.rot * 90}°</b> : null}
                      {' '}(tarjeta #{r.card}). Se corregirá en el escaneo.</>}
              </p>
              <div style={styles.calibBtns}>
                <button style={styles.calibGhost} onClick={startCalibration}>Repetir</button>
                <button style={styles.calibPrimary} onClick={() => applyCalibration({ mirror: r.mirror, rot: r.rot })}>
                  Guardar
                </button>
              </div>
            </>)
          })()}
        </div>
      )}

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

     {/* Toggle de lista (oculta por defecto para dar más espacio al escáner) */}
      <button style={styles.listToggle} onClick={() => setShowList(v => !v)}>
      {showList ? '▲ Ocultar alumnos' : `▼ Ver alumnos (${scannedCount}/${totalStudents})`}
      </button>
{showList && (
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
)}
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
  slideNav: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.75rem',
    padding: '.5rem 1rem', background: '#141417', borderBottom: '1px solid #2a2a30',
  },
  navBtn: {
    background: 'transparent', border: '1px solid #2a2a30', borderRadius: 6,
    color: '#e8e8ec', padding: '.3rem .5rem', display: 'flex', alignItems: 'center', cursor: 'pointer',
  },
  slideNavLabel: { fontFamily: 'monospace', fontSize: '.8rem', color: '#888' },
  viewfinder: {
    position: 'relative', width: '100%', aspectRatio: '4/3',
    background: '#000', overflow: 'hidden',
  },
  video: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
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
  finishBtn: {
  background: 'transparent', border: '1px solid #ff4757', color: '#ff4757',
  borderRadius: 6, padding: '.3rem .55rem', fontSize: '.7rem', fontWeight: 700,
  cursor: 'pointer', whiteSpace: 'nowrap',
},
calibBtn: {
  background: 'transparent', border: '1px solid #2a2a30', borderRadius: 6,
  padding: '.25rem .45rem', fontSize: '.8rem', cursor: 'pointer',
},
calibSheet: {
  background: '#141417', borderTop: '2px solid #2E9DF2', borderBottom: '1px solid #2a2a30',
  padding: '.85rem 1rem', fontSize: '.85rem',
},
calibText: { color: '#bbb', fontSize: '.8rem', lineHeight: 1.45, margin: '0 0 .7rem' },
calibBtns: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
calibPrimary: {
  background: '#2E9DF2', border: 'none', color: '#fff', borderRadius: 6,
  padding: '.45rem .9rem', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer',
},
calibGhost: {
  background: 'transparent', border: '1px solid #2a2a30', color: '#e8e8ec', borderRadius: 6,
  padding: '.45rem .9rem', fontSize: '.8rem', cursor: 'pointer',
},
calibBar: { height: 6, background: '#2a2a30', borderRadius: 3, overflow: 'hidden', marginBottom: '.7rem' },
calibFill: { height: '100%', background: '#2E9DF2', transition: 'width .2s' },
warnBar: {
  background: 'rgba(255,165,0,.15)', color: '#ffa500', fontSize: '.75rem',
  padding: '.45rem 1rem', borderBottom: '1px solid rgba(255,165,0,.3)', textAlign: 'center',
},
listToggle: {
  width: '100%', background: '#141417', border: 'none',
  borderBottom: '1px solid #2a2a30', color: '#e8e8ec',
  padding: '.5rem 1rem', fontSize: '.75rem', cursor: 'pointer',
},
}