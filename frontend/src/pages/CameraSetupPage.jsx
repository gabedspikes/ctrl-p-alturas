import { ArucoDetector } from '../lib/aruco-detector.js'
import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { logError } from '../lib/errorLog'
import {
  loadCalibration, saveCalibration, frameTransform, drawFrame, videoCss,
  newCalibrationRun, addCalibrationFrame, DEFAULT_CALIBRATION,
} from '../lib/cameraCalibration'

// ── Configurar cámara (sin sesión) ───────────────────────
// Permite calibrar la cámara del teléfono y probar la lectura de tarjetas
// antes de la clase, sin tener que iniciar una sesión de slides. La
// calibración se guarda en este teléfono (localStorage), así que el escáner
// de la sesión la usa directamente y no vuelve a pedirla.

// Mismo cálculo que ScanPage: rotación del detector → letra
function cornersToAnswer(rotation, offset = 0) {
  return ['A', 'B', 'C', 'D'][(((rotation ?? 0) - offset) % 4 + 4) % 4]
}
const ANS_COLORS = { A: '#2E9DF2', B: '#47c8ff', C: '#ffa500', D: '#ff4757' }

export default function CameraSetupPage() {
  const navigate = useNavigate()
  const videoRef    = useRef(null)
  const canvasRef   = useRef(null)
  const overlayRef  = useRef(null)
  const rafRef      = useRef(null)
  const detectorRef = useRef(null)

  const calibRef     = useRef(loadCalibration())
  const calibRunRef  = useRef(null)
  const calibOpenRef = useRef(false)   // con el popup abierto no se hace la lectura de prueba
  const [calib, setCalib]         = useState(calibRef.current)
  const [calibOpen, setCalibOpen] = useState(false)
  const [calibUi, setCalibUi]     = useState({ phase: 'intro' })   // intro|running|done
  const [camReady, setCamReady]   = useState(false)
  const [error, setError]         = useState('')
  const [videoAspect, setVideoAspect] = useState(4 / 3)
  const [reading, setReading]     = useState(null)   // { card, answer } lectura de prueba
  const [saved, setSaved]         = useState(false)

  // ── Cámara ──
  useEffect(() => {
    let stream
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCamReady(true)
      } catch (err) {
        logError('cameraSetup.camera', err, { name: err?.name })
        setError(
          err?.name === 'NotAllowedError'  ? 'Se negó el permiso de cámara. Actívalo en los ajustes del navegador para este sitio y recarga.' :
          err?.name === 'NotFoundError'    ? 'Este dispositivo no tiene cámara disponible.' :
          err?.name === 'NotReadableError' ? 'La cámara está siendo usada por otra app. Ciérrala y recarga.' :
          `No se pudo iniciar la cámara (${err?.message || err}).`)
      }
    }
    start()
    return () => stream?.getTracks().forEach(t => t.stop())
  }, [])

  function cameraLabel() {
    return videoRef.current?.srcObject?.getVideoTracks?.()[0]?.label || ''
  }

  // ── Detector + bucle ──
  useEffect(() => {
    if (!camReady) return
    try { detectorRef.current = new ArucoDetector() }
    catch (e) { logError('cameraSetup.arucoInit', e); setError(`No se pudo iniciar el detector de tarjetas: ${e.message}`); return }

    // Primera vez en este teléfono, o la cámara cambió: abrir la calibración
    const c = calibRef.current
    if (!c || (c.camera && cameraLabel() && c.camera !== cameraLabel())) openCalibration()

    const video = videoRef.current, canvas = canvasRef.current, overlay = overlayRef.current
    let lastShown = null, lastKey = '', lastSeen = 0

    function calibrationTick(ctx, w, h) {
      const det = detectorRef.current
      drawFrame(ctx, video, w, h, { mirror: false })
      const normal = det.detect(ctx.getImageData(0, 0, w, h)) || []
      drawFrame(ctx, video, w, h, { mirror: true })
      const mirrored = det.detect(ctx.getImageData(0, 0, w, h)) || []
      if (!normal.length && !mirrored.length) return
      const res = addCalibrationFrame(calibRunRef.current, normal, mirrored)
      if (res.state === 'done') {
        calibRunRef.current = null; lastShown = null
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

    // Lectura de prueba con la calibración guardada (no registra nada)
    function testTick(ctx, oct, w, h) {
      const t = frameTransform(calibRef.current)
      drawFrame(ctx, video, w, h, t)
      const markers = detectorRef.current.detect(ctx.getImageData(0, 0, w, h)) || []
      markers.forEach(m => {
        const answer = cornersToAnswer(m.rotation, t.offset)
        const col = ANS_COLORS[answer]
        oct.beginPath()
        oct.moveTo(m.corners[0].x, m.corners[0].y)
        m.corners.forEach(c => oct.lineTo(c.x, c.y))
        oct.closePath()
        oct.strokeStyle = col; oct.lineWidth = 4; oct.stroke()
        const cx = m.corners.reduce((s, c) => s + c.x, 0) / 4
        const cy = m.corners.reduce((s, c) => s + c.y, 0) / 4
        oct.fillStyle = 'rgba(0,0,0,0.65)'; oct.fillRect(cx - 60, cy - 20, 120, 28)
        oct.fillStyle = col; oct.font = 'bold 18px monospace'; oct.textAlign = 'center'
        oct.fillText(`#${m.id} → ${answer}`, cx, cy)
      })
      const now = Date.now()
      if (markers.length === 1) {
        const key = `${markers[0].id}:${cornersToAnswer(markers[0].rotation, t.offset)}`
        lastSeen = now
        if (key !== lastKey) { lastKey = key; setReading({ card: markers[0].id, answer: key.split(':')[1] }) }
      } else if (lastKey && now - lastSeen > 1200) {
        lastKey = ''; setReading(null)
      }
    }

    function tick() {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        const w = video.videoWidth, h = video.videoHeight
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h; overlay.width = w; overlay.height = h
        }
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const oct = overlay.getContext('2d')
        oct.clearRect(0, 0, w, h)
        try {
          if (calibRunRef.current) calibrationTick(ctx, w, h)
          else if (!calibOpenRef.current) testTick(ctx, oct, w, h)
        } catch (e) { logError('cameraSetup.frame', e) }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [camReady])

  // ── Calibración ──
  function openCalibration() {
    calibRunRef.current = null; calibOpenRef.current = true
    setCalibUi({ phase: 'intro' }); setCalibOpen(true); setSaved(false)
  }
  function closeCalibration() {
    calibRunRef.current = null; calibOpenRef.current = false
    setCalibOpen(false)
  }
  function startCalibration() {
    calibRunRef.current = newCalibrationRun()
    setCalibUi({ phase: 'running', progress: 0 })
  }
  function applyCalibration(c) {
    calibRef.current = saveCalibration({ ...c, camera: cameraLabel() })
    setCalib(calibRef.current)
    setSaved(true)
    closeCalibration()
  }
  function skipCalibration() {
    if (!calibRef.current) applyCalibration({ ...DEFAULT_CALIBRATION, skipped: true })
    else closeCalibration()
  }

  const calibDesc = !calib ? 'Sin calibrar'
    : calib.skipped ? 'Sin calibrar (se omitió)'
    : (!calib.mirror && !calib.rot) ? 'Cámara normal'
    : [calib.mirror && 'espejada', calib.rot && `girada ${calib.rot * 90}°`].filter(Boolean).join(' y ') + ' (corregida)'

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <button style={styles.ghost} onClick={() => navigate('/scan')}>← Volver</button>
        <span style={{ fontWeight: 800, fontSize: '.95rem' }}>Configurar cámara</span>
        <span style={{ width: 70 }}/>
      </div>

      {error ? (
        <div style={{ padding: '2rem 1.25rem', textAlign: 'center' }}>
          <p style={{ color: '#ff4757', marginBottom: '1rem' }}>{error}</p>
          <button style={styles.primary} onClick={() => window.location.reload()}>Reintentar</button>
        </div>
      ) : (<>
        <div style={styles.status}>
          <span style={{ color: '#888' }}>Estado:</span>{' '}
          <b style={{ color: calib && !calib.skipped ? '#2ed573' : '#ffa500' }}>{calibDesc}</b>
          {saved && <span style={{ color: '#2ed573' }}> · guardado ✓</span>}
        </div>

        <div style={{ ...styles.viewfinder, aspectRatio: String(videoAspect) }}>
          <video ref={videoRef} style={{ ...styles.video, transform: calibOpen ? undefined : videoCss(calib) }}
            playsInline muted autoPlay
            onLoadedMetadata={e => {
              const v = e.currentTarget
              if (v.videoWidth && v.videoHeight) setVideoAspect(v.videoWidth / v.videoHeight)
            }}/>
          <canvas ref={canvasRef} style={{ display: 'none' }}/>
          <canvas ref={overlayRef} style={styles.overlay}/>
          {!camReady && (
            <div style={styles.camPrompt}>
              <div style={{ fontSize: '3rem', marginBottom: '.5rem' }}>📷</div>
              <p style={{ color: '#2E9DF2', fontWeight: 700 }}>Iniciando cámara…</p>
              <p style={{ color: '#666', fontSize: '.8rem', marginTop: '.35rem' }}>
                Permite el acceso a la cámara.
              </p>
            </div>
          )}
        </div>

        {calibOpen ? (
          <div style={styles.sheet}>
            <div style={{ fontWeight: 800, marginBottom: '.4rem' }}>Calibrar cámara</div>

            {calibUi.phase === 'intro' && (<>
              <p style={styles.text}>
                Algunos teléfonos entregan la imagen espejada o girada, y el escáner lee mal las
                respuestas. Sostén <b>una</b> tarjeta frente a la cámara con la letra <b>A arriba</b>,
                como la mostraría un alumno, y el teléfono en la posición en que vas a escanear.
              </p>
              <div style={styles.btns}>
                <button style={styles.ghost} onClick={skipCalibration}>{calibRef.current ? 'Cancelar' : 'Omitir'}</button>
                <button style={styles.primary} onClick={startCalibration}>Comenzar</button>
              </div>
            </>)}

            {calibUi.phase === 'running' && (<>
              <p style={styles.text}>{calibUi.msg || 'Buscando la tarjeta… mantenla quieta con la A arriba.'}</p>
              <div style={styles.bar}><div style={{ ...styles.fill, width: `${(calibUi.progress || 0) * 100}%` }}/></div>
              <div style={styles.btns}>
                <button style={styles.ghost} onClick={closeCalibration}>Cancelar</button>
              </div>
            </>)}

            {calibUi.phase === 'done' && (() => {
              const r = calibUi.result
              const normal = !r.mirror && r.rot === 0
              return (<>
                <p style={styles.text}>
                  {normal
                    ? <>✓ Tu cámara funciona normal (tarjeta #{r.card} leída).</>
                    : <>Se detectó que la imagen de tu cámara está
                        {r.mirror ? <b> espejada</b> : null}
                        {r.mirror && r.rot ? ' y' : null}
                        {r.rot ? <b> girada {r.rot * 90}°</b> : null}
                        {' '}(tarjeta #{r.card}). Se corregirá en el escaneo.</>}
                </p>
                <div style={styles.btns}>
                  <button style={styles.ghost} onClick={startCalibration}>Repetir</button>
                  <button style={styles.primary} onClick={() => applyCalibration({ mirror: r.mirror, rot: r.rot })}>Guardar</button>
                </div>
              </>)
            })()}
          </div>
        ) : (
          <div style={styles.sheet}>
            <div style={{ fontWeight: 800, marginBottom: '.4rem' }}>Probar lectura</div>
            <p style={styles.text}>
              Muestra una tarjeta y gírala: la letra que queda <b>arriba</b> debe coincidir con la que aparece aquí.
            </p>
            <div style={styles.reading}>
              {reading ? (<>
                <span style={{ color: '#888', fontSize: '.9rem' }}>Tarjeta #{reading.card}</span>
                <span style={{ color: ANS_COLORS[reading.answer], fontSize: '2.6rem', fontWeight: 800, lineHeight: 1 }}>
                  {reading.answer}
                </span>
              </>) : (
                <span style={{ color: '#555', fontSize: '.85rem' }}>Esperando una tarjeta…</span>
              )}
            </div>
            <div style={styles.btns}>
              <button style={styles.ghost} onClick={openCalibration}>Calibrar de nuevo</button>
              <button style={styles.primary} onClick={() => navigate('/scan')}>Listo</button>
            </div>
          </div>
        )}
      </>)}
    </div>
  )
}

// Misma paleta oscura que el escáner (ScanPage)
const styles = {
  page: { background: '#0d0d0f', color: '#e8e8ec', minHeight: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '.75rem 1rem', background: '#141417', borderBottom: '1px solid #2a2a30',
  },
  status: { padding: '.5rem 1rem', fontSize: '.8rem', background: '#141417', borderBottom: '1px solid #2a2a30' },
  viewfinder: { position: 'relative', width: '100%', background: '#000', overflow: 'hidden' },
  video: { width: '100%', height: '100%', objectFit: 'contain', display: 'block' },
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  camPrompt: {
    position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)',
  },
  sheet: { background: '#141417', borderTop: '2px solid #2E9DF2', padding: '.85rem 1rem', fontSize: '.85rem' },
  text: { color: '#bbb', fontSize: '.8rem', lineHeight: 1.45, margin: '0 0 .7rem' },
  btns: { display: 'flex', gap: '.5rem', justifyContent: 'flex-end' },
  primary: {
    background: '#2E9DF2', border: 'none', color: '#fff', borderRadius: 6,
    padding: '.45rem .9rem', fontWeight: 700, fontSize: '.8rem', cursor: 'pointer',
  },
  ghost: {
    background: 'transparent', border: '1px solid #2a2a30', color: '#e8e8ec', borderRadius: 6,
    padding: '.45rem .9rem', fontSize: '.8rem', cursor: 'pointer',
  },
  bar: { height: 6, background: '#2a2a30', borderRadius: 3, overflow: 'hidden', marginBottom: '.7rem' },
  fill: { height: '100%', background: '#2E9DF2', transition: 'width .2s' },
  reading: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem',
    minHeight: 64, marginBottom: '.7rem', borderRadius: 8, background: 'rgba(255,255,255,.03)',
    border: '1px solid #2a2a30',
  },
}
