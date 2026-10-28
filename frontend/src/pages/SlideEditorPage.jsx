import React, { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SlideRenderer from '../components/SlideRenderer'
import { ArrowLeft, Plus, Trash2, ImageIcon, Save, X } from 'lucide-react'
import imageCompression from 'browser-image-compression'
import { logError, friendlyError } from '../lib/errorLog'
import { getTheme, SLIDE_BG } from '../lib/theme'

const ANS_COLORS = { A:'#22c55e', B:'#3b82f6', C:'#f97316', D:'#ef4444' }

// Tamaños de texto. Los pasos crecen hacia arriba (L y XL) para que en un
// televisor la diferencia se note. Antes: S 0.85, M 1, L 1.2, XL 1.4.
const TEXT_SIZES = [['S', 0.85], ['M', 1], ['L', 1.4], ['XL', 1.8]]
// Slides guardadas con valores antiguos (1.2) marcan el botón más cercano
function nearestTextSize(v = 1) {
  return TEXT_SIZES.reduce((best, [, val]) => Math.abs(val - v) < Math.abs(best - v) ? val : best, 1)
}
// Tamaño máximo de la imagen original elegida (antes de comprimir).
const MAX_IMAGE_MB = 10

// ── Campos editables de una slide ─────────────────────────
const EMPTY_SLIDE_FIELDS = {
  question_text: '',
  answer_a: '', answer_b: '', answer_c: '', answer_d: '',
  answer_a_image: null, answer_b_image: null, answer_c_image: null, answer_d_image: null,
  correct_answer: null,
  image_url: null,
  text_scale: 1,
  answer_layout: 'list',
}
const FIELD_NAMES = Object.keys(EMPTY_SLIDE_FIELDS)
const IMAGE_FIELDS = ['image_url', 'answer_a_image', 'answer_b_image', 'answer_c_image', 'answer_d_image']

let tempCounter = 0
const newKey = () => `new-${Date.now()}-${tempCounter++}`

// Slide de la base → slide en memoria. `_key` identifica la slide en la lista
// (las nuevas todavía no tienen id de la base).
function fromDb(row) {
  const s = { id: row.id, _key: row.id }
  for (const f of FIELD_NAMES) s[f] = row[f] ?? EMPTY_SLIDE_FIELDS[f]
  s.text_scale    = row.text_scale    || 1
  s.answer_layout = row.answer_layout || 'list'
  return s
}
const newSlide = () => ({ id: null, _key: newKey(), ...EMPTY_SLIDE_FIELDS })

const isBlob = url => typeof url === 'string' && url.startsWith('blob:')

// URL pública del bucket → ruta interna que espera storage.remove()
function bucketPath(publicUrl) {
  const marker = '/slide-images/'
  const i = publicUrl?.indexOf(marker) ?? -1
  return i === -1 ? null : publicUrl.slice(i + marker.length)
}

export default function SlideEditorPage() {
  const { id: presentationId } = useParams()
  const navigate = useNavigate()

  // Todo el test vive en memoria mientras se edita; Supabase recibe el estado
  // final recién al presionar Guardar (o al confirmar la salida).
  const [presentation, setPresentation] = useState(null)
  const [slides, setSlides] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [ansUploading, setAnsUploading] = useState({})   // { A:true } mientras se comprime
  const [saveErr, setSaveErr] = useState('')
  const [loadErr, setLoadErr] = useState('')
  const [leaveOpen, setLeaveOpen] = useState(false)       // diálogo de salida

  const slidesRef = useRef(slides)
  const activeIdxRef = useRef(0)
  const dirtyRef = useRef(false)
  slidesRef.current = slides
  activeIdxRef.current = activeIdx
  dirtyRef.current = dirty

  // Imágenes elegidas pero aún no subidas: URL blob: → File comprimido
  const pendingFiles = useRef(new Map())
  // Ya subidas en un intento de guardado que falló: URL blob: → URL pública
  // (al reintentar no se vuelven a subir)
  const uploadedCache = useRef(new Map())
  // Imágenes del bucket que usa la versión guardada en la base
  const savedImages = useRef(new Set())

  const activeSlide = slides[activeIdx]
  const draft = activeSlide || EMPTY_SLIDE_FIELDS

  // ── Load ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: pres, error: pErr } = await supabase
        .from('presentations').select('*, courses(name), subjects(name)').eq('id', presentationId).single()
      if (pErr || !pres) {
        logError('editor.loadPresentation', pErr || new Error('no encontrado'), { presentationId })
        setLoadErr(friendlyError(pErr, 'No se encontró este test.'))
        return
      }

      const { data: sl, error: sErr } = await supabase
        .from('slides').select('*')
        .eq('presentation_id', presentationId).order('slide_order')
      if (sErr) {
        logError('editor.loadSlides', sErr)
        setLoadErr(friendlyError(sErr, 'No se pudieron cargar las diapositivas.'))
        return
      }

      const list = sl?.length ? sl.map(fromDb) : [newSlide()]   // test vacío: slide nueva solo en memoria
      savedImages.current = collectImages(list)
      setPresentation(pres)
      setSlides(list)
      setActiveIdx(0)
      setDirty(false)
    }
    init()
  }, [presentationId])

  // Libera las URLs blob: al salir del editor
  useEffect(() => () => {
    for (const url of pendingFiles.current.keys()) URL.revokeObjectURL(url)
  }, [])

  function collectImages(list) {
    const set = new Set()
    for (const s of list) for (const f of IMAGE_FIELDS) if (s[f]) set.add(s[f])
    return set
  }

  // ── Editar ───────────────────────────────────────────────
  // Siempre con actualización funcional sobre la slide activa: no hay una copia
  // "borrador" aparte que se pueda desincronizar de la lista.
  function updateSlide(key, field, value) {
    setSlides(prev => prev.map(s => s._key === key ? { ...s, [field]: value } : s))
    setDirty(true)
  }
  function updateDraft(field, value) {
    const s = slidesRef.current[activeIdxRef.current]
    if (s) updateSlide(s._key, field, value)
  }
  const slideByKey = key => slidesRef.current.find(s => s._key === key)

  // Si una URL blob: deja de usarse, se suelta el archivo de la memoria
  function releaseIfBlob(url) {
    if (!isBlob(url)) return
    pendingFiles.current.delete(url)
    uploadedCache.current.delete(url)
    URL.revokeObjectURL(url)
  }

  // ── Slides ───────────────────────────────────────────────
  function switchSlide(idx) {
    setActiveIdx(idx)   // los cambios ya están en `slides`, no hay nada que guardar
  }

  function addSlide() {
    const n = slidesRef.current.length
    setSlides(prev => [...prev, newSlide()])
    setActiveIdx(n)
    setDirty(true)
  }

  async function deleteSlide(idx) {
    const list = slidesRef.current
    if (list.length === 1) return alert('No se puede borrar la única diapositiva.')
    const removed = list[idx]
    // Una slide con respuestas de alumnos no se puede borrar (la base lo
    // impide). Se avisa ahora y no al guardar, cuando ya no hay cómo deshacer.
    if (removed.id) {
      const { count, error } = await supabase.from('responses')
        .select('id', { count: 'exact', head: true }).eq('slide_id', removed.id)
      if (error) { logError('editor.checkResponses', error); return alert(friendlyError(error, 'No se pudo verificar la diapositiva. Revisa la conexión.')) }
      if (count > 0) return alert('Esta diapositiva ya tiene respuestas de alumnos en una sesión, así que no se puede borrar.')
    }
    if (!confirm('¿Borrar esta diapositiva?')) return
    // Tras los await la lista pudo cambiar: se recalcula con la actual
    const current = slidesRef.current
    const pos = current.findIndex(s => s._key === removed._key)
    if (pos === -1 || current.length === 1) return
    for (const f of IMAGE_FIELDS) releaseIfBlob(current[pos][f])
    setSlides(prev => prev.filter(s => s._key !== removed._key))
    const active = activeIdxRef.current
    if (pos < active || (pos === active && active === current.length - 1)) setActiveIdx(active - 1)
    setDirty(true)
  }

  // ── Imágenes (en memoria hasta guardar) ──────────────────
  async function compressImage(file) {
    // Reduce el peso 5–15× sin pérdida visible: máx 1600px, calidad ~0.8.
    // Los SVG y GIF se dejan tal cual (comprimirlos los rompe/anima mal).
    if (/svg|gif/i.test(file.type)) return file
    try {
      const out = await imageCompression(file, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1600,
        useWebWorker: true,
        initialQuality: 0.8,
        fileType: 'image/webp',
      })
      // Conserva el nombre original para armar la ruta al subir
      return new File([out], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: out.type })
    } catch (err) {
      console.warn('Compresión falló, se usa el original:', err)
      return file
    }
  }

  // Devuelve una URL blob: para la vista previa, o null si se rechaza
  async function pickImage(file) {
    if (!file) return null
    if (!file.type.startsWith('image/')) { alert('El archivo debe ser una imagen.'); return null }
    if (file.size > MAX_IMAGE_MB * 1024 * 1024) {
      alert(`La imagen pesa ${(file.size / 1024 / 1024).toFixed(1)} MB. El máximo es ${MAX_IMAGE_MB} MB.`)
      return null
    }
    const compressed = await compressImage(file)
    const url = URL.createObjectURL(compressed)
    pendingFiles.current.set(url, compressed)
    return url
  }

  // Se identifica la slide por `_key` antes de comprimir: si el profesor cambia
  // de slide mientras tanto, la imagen igual queda en la slide correcta.
  async function setImage(key, field, file) {
    const url = await pickImage(file)
    if (!url) return false
    const s = slideByKey(key)
    if (!s) { releaseIfBlob(url); return false }   // la slide se borró entretanto
    releaseIfBlob(s[field])   // la anterior, si nunca se subió
    updateSlide(key, field, url)
    return true
  }

  function removeImage(field) {
    releaseIfBlob(draft[field])
    updateDraft(field, null)
  }

  async function handleAnswerImageUpload(letter, file) {
    if (!file || !activeSlide) return
    const l = letter.toLowerCase()
    const key = activeSlide._key
    setAnsUploading(u => ({ ...u, [letter]: true }))
    const ok = await setImage(key, `answer_${l}_image`, file)
    if (ok && !slideByKey(key)?.[`answer_${l}`]) {
      updateSlide(key, `answer_${l}`, 'Porfavor agregar un texto descriptivo de la imagen')
    }
    setAnsUploading(u => ({ ...u, [letter]: false }))
  }

  function removeAnswerImage(letter) {
    removeImage(`answer_${letter.toLowerCase()}_image`)
  }

  async function uploadFile(file) {
    const ext  = file.name.split('.').pop() || 'webp'
    const base = file.name.replace(/\.[^.]+$/, '').replace(/[^\w-]/g, '_')
    const path = `slides/${presentationId}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}_${base}.${ext}`
    const { error } = await supabase.storage.from('slide-images').upload(path, file, { contentType: file.type })
    if (error) throw error
    return supabase.storage.from('slide-images').getPublicUrl(path).data.publicUrl
  }

  // ── Guardar ──────────────────────────────────────────────
  // 1) sube solo las imágenes que siguen en uso, 2) envía todas las slides en
  // una transacción (RPC save_slides), 3) recién ahí borra del bucket las
  // imágenes que ya no se usan. Si algo falla, nada se pierde de la memoria.
  async function saveAll() {
    if (saving) return false
    setSaving(true); setSaveErr('')
    const snapshot = slidesRef.current
    try {
      // 1. Subir imágenes nuevas
      const urlMap = new Map()
      for (const s of snapshot) for (const f of IMAGE_FIELDS) {
        const url = s[f]
        if (!isBlob(url) || urlMap.has(url)) continue
        let pub = uploadedCache.current.get(url)
        if (!pub) {
          const file = pendingFiles.current.get(url)
          if (!file) throw new Error('Falta una imagen en memoria; vuelve a elegirla.')
          pub = await uploadFile(file)
          uploadedCache.current.set(url, pub)
        }
        urlMap.set(url, pub)
      }

      // 2. Enviar el estado final
      const payload = snapshot.map(s => {
        const row = { id: s.id }
        for (const f of FIELD_NAMES) {
          const v = s[f]
          row[f] = urlMap.get(v) ?? (v === '' ? null : v)
        }
        // Registra el modo (claro/oscuro) en que el profesor guardó la slide
        row.bg_color      = SLIDE_BG[getTheme()]
        row.text_scale    = row.text_scale    || 1
        row.answer_layout = row.answer_layout || 'list'
        return row
      })
      const { data: rows, error } = await supabase.rpc('save_slides', {
        p_presentation_id: presentationId,
        p_slides: payload,
      })
      if (error) throw error

      // 3. Limpiar el bucket: imágenes guardadas antes que ya no se usan
      const saved = rows.map(fromDb)
      const nowUsed = collectImages(saved)
      const orphans = [...savedImages.current].filter(u => !nowUsed.has(u)).map(bucketPath).filter(Boolean)
      if (orphans.length) {
        const { error: rmErr } = await supabase.storage.from('slide-images').remove(orphans)
        if (rmErr) console.warn('No se pudieron borrar imágenes huérfanas:', orphans, rmErr)
      }
      savedImages.current = nowUsed

      for (const url of urlMap.keys()) releaseIfBlob(url)
      setSlides(saved)
      setActiveIdx(i => Math.min(i, saved.length - 1))
      setDirty(false)
      setSaving(false)
      return true
    } catch (error) {
      logError('editor.saveAll', error, { presentationId })
      const msg = error?.code === '23503'
        ? 'No se pudo guardar: una diapositiva borrada tiene respuestas de alumnos registradas mientras editabas.'
        : friendlyError(error, 'No se pudo guardar. Revisa la conexión y vuelve a presionar Guardar.')
      setSaveErr(msg)
      setSaving(false)
      return false
    }
  }

  // ── Salir ────────────────────────────────────────────────
  // Aviso del navegador si se cierra o recarga con cambios sin guardar
  // (el navegador muestra su propio mensaje; el texto no se puede cambiar).
  useEffect(() => {
    if (!dirty) return
    const h = e => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Botón "atrás" del navegador: con cambios sin guardar se agrega una entrada
  // extra al historial (misma URL); al volver atrás se repone y se abre el
  // diálogo de salida en vez de perder el trabajo.
  const guardRef = useRef(false)
  useEffect(() => {
    if (dirty && !guardRef.current) {
      window.history.pushState(window.history.state, '', window.location.href)
      guardRef.current = true
    }
  }, [dirty])
  useEffect(() => {
    function onPop() {
      if (!guardRef.current) return
      guardRef.current = false
      if (dirtyRef.current) {
        window.history.pushState(window.history.state, '', window.location.href)
        guardRef.current = true
        setLeaveOpen(true)
      } else {
        window.history.back()   // ya se guardó: seguir hacia atrás de verdad
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function leave() {
    setLeaveOpen(false)
    setDirty(false)
    navigate('/presentations', { replace: guardRef.current })
  }

  function onBack() {
    if (dirty) setLeaveOpen(true)
    else leave()
  }

  async function saveAndLeave() {
    if (await saveAll()) leave()
  }

  if (!presentation || loadErr) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex', flexDirection:'column', gap:'1rem',
      alignItems:'center', justifyContent:'center', color: loadErr ? 'var(--danger)' : 'var(--muted)' }}>
      {loadErr || 'Cargando…'}
      {loadErr && <button className="btn btn-ghost btn-sm" onClick={() => navigate('/presentations')}>Volver</button>}
    </div>
  )

  const previewSlide = activeSlide || null

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh', display:'flex', flexDirection:'column' }}>

      {/* ── Top bar ─────────────────────────────────────── */}
      <div style={{
        display:'flex', alignItems:'center', gap:'1rem', padding:'.75rem 1.25rem',
        background:'var(--surface)', borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:50, flexShrink:0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack} disabled={saving}>
          <ArrowLeft size={14}/> Back
        </button>
        <div>
          <span style={{ fontWeight:700, fontSize:'1rem' }}>{presentation.title}</span>
          <span className="badge badge-blue" style={{ marginLeft:'.5rem' }}>
            {presentation.courses?.name}
          </span>
          {presentation.subjects?.name && (
            <span className="badge badge-accent" style={{ marginLeft:'.35rem' }}>
              {presentation.subjects.name}
            </span>
          )}
        </div>
    
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem', alignItems:'center' }}>
          {saveErr && (
            <span style={{ fontSize:'.75rem', color:'var(--danger)' }}>{saveErr}</span>
          )}
          {dirty && !saveErr && (
            <span style={{ fontSize:'.75rem', color:'var(--muted)', fontStyle:'italic' }}>
              Cambios no guardados
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={saveAll} disabled={saving || !dirty}>
            <Save size={13}/> {saving ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────── */}
      <div style={{
        flex: 1, display:'grid',
        gridTemplateColumns: '200px 1fr 300px',
        gap: 0, overflow:'hidden',
        height: 'calc(100vh - 57px)',
        // Mientras se guarda no se puede editar: lo que llega de la base
        // reemplaza la lista en memoria.
        pointerEvents: saving ? 'none' : undefined, opacity: saving ? .6 : 1,
      }}>

        {/* ── Left: slide list ─────────────────────────── */}
        <div style={{
          background:'var(--surface)', borderRight:'1px solid var(--border)',
          display:'flex', flexDirection:'column', overflow:'hidden',
        }}>
          <div style={{
            padding:'.75rem', borderBottom:'1px solid var(--border)',
            display:'flex', alignItems:'center', justifyContent:'space-between',
          }}>
            <span style={{ fontSize:'.7rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.1em' }}>
              SLIDES ({slides.length})
            </span>
            <button className="btn btn-ghost btn-sm" onClick={addSlide} title="Add slide">
              <Plus size={12}/>
            </button>
          </div>

          <div style={{ flex:1, overflowY:'auto', padding:'.5rem', display:'flex', flexDirection:'column', gap:'.4rem' }}>
            {slides.map((s, i) => (
              <div key={s._key}
                onClick={() => switchSlide(i)}
                style={{
                  cursor:'pointer', borderRadius:6, overflow:'hidden',
                  border: activeIdx === i ? '2px solid var(--accent)' : '2px solid var(--border)',
                  transition:'border-color .15s', position:'relative',
                }}>
                {/* Thumbnail */}
                <div style={{ pointerEvents:'none', transform:'scale(0.236)', transformOrigin:'top left',
                  width: 720, height: 405, marginBottom: -340 }}>
                  <SlideRenderer slide={s} width={720} height={405} showCorrect={false} compact={false}/>
                </div>
                {/* Slide number */}
                <div style={{
                  position:'absolute', bottom:4, left:6,
                  fontSize:'.65rem', color: activeIdx===i ? 'var(--accent)' : 'var(--muted)',
                  fontFamily:'var(--mono)', fontWeight:700,
                }}>
                  {i+1}
                </div>
                {/* Delete button */}
                {slides.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); deleteSlide(i) }}
                    style={{
                      position:'absolute', top:3, right:3,
                      background:'rgba(0,0,0,.5)', border:'none', borderRadius:3,
                      color:'#fff', cursor:'pointer', padding:'1px 4px', fontSize:10,
                      opacity: activeIdx===i ? 1 : 0, transition:'opacity .15s',
                    }}
                    className="slide-delete-btn"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Center: live preview ─────────────────────── */}
        <div style={{
          display:'flex', flexDirection:'column', alignItems:'center',
          justifyContent:'center', gap:'1rem', padding:'1.5rem',
          background: 'var(--bg)', overflow:'auto',
        }}>
          <div style={{
            boxShadow:'0 8px 40px rgba(0,0,0,.4)',
            borderRadius:8, overflow:'hidden', width:'100%', maxWidth:720,
          }}>
            <SlideRenderer slide={previewSlide} width={720} height={405} showCorrect={true}/>
          </div>
          <p style={{ fontSize:'.75rem', color:'var(--muted)', textAlign:'center' }}>
            Live preview — updates as you type in the sidebar
          </p>
        </div>

        {/* ── Right: edit panel ────────────────────────── */}
        <div style={{
          background:'var(--surface)', borderLeft:'1px solid var(--border)',
          overflowY:'auto', display:'flex', flexDirection:'column', gap:0,
        }}>

          {/* Question */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.5rem' }}>
              QUESTION
            </label>
            <textarea
              rows={4}
              value={draft.question_text}
              onChange={e => updateDraft('question_text', e.target.value)}
              placeholder="Type your question here…"
              style={{ resize:'vertical', fontSize:'.875rem', lineHeight:1.5 }}
            />
          </div>

          {/* Answers */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              RESPUESTAS — selecciona la letra correcta
            </label>
           {['A','B','C','D'].map(l => {
              const field = `answer_${l.toLowerCase()}`
              const isCorrect = draft.correct_answer === l
              const imgUrl = draft[`answer_${l.toLowerCase()}_image`]
              return (
                <div key={l} style={{ marginBottom:'.6rem' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'.5rem' }}>
                    <button
                      onClick={() => updateDraft('correct_answer', isCorrect ? null : l)}
                      title={isCorrect ? 'Click to unset correct answer' : 'Click to set as correct answer'}
                      style={{
                        width:32, height:32, borderRadius:6, flexShrink:0,
                        border: `2px solid ${ANS_COLORS[l]}`,
                        background: isCorrect ? ANS_COLORS[l] : 'transparent',
                        color: isCorrect ? '#fff' : ANS_COLORS[l],
                        fontWeight:800, fontSize:'.85rem', fontFamily:'var(--mono)',
                        cursor:'pointer', transition:'all .15s',
                        display:'flex', alignItems:'center', justifyContent:'center',
                      }}>
                      {isCorrect ? '✓' : l}
                    </button>
                    <input
                      value={draft[field]}
                      onChange={e => updateDraft(field, e.target.value)}
                      placeholder={`Respuesta ${l} (obligatoria)…`}
                      required
                      style={{
                        fontSize:'.85rem',
                        borderColor: isCorrect ? ANS_COLORS[l] : undefined,
                        boxShadow: isCorrect ? `0 0 0 2px ${ANS_COLORS[l]}33` : undefined,
                      }}
                    />
                  </div>

                  {/* Imagen de respuesta (opcional) */}
                  <div style={{ display:'flex', alignItems:'center', gap:'.5rem', marginTop:'.35rem', marginLeft:'2.5rem' }}>
                    {imgUrl ? (
                      <>
                        <img src={imgUrl} alt={`Answer ${l}`}
                          style={{ height:34, borderRadius:4, border:'1px solid var(--border)' }}/>
                        <button className="btn btn-ghost btn-sm" onClick={() => removeAnswerImage(l)}
                          style={{ fontSize:'.7rem', padding:'.2rem .4rem' }}>
                          <X size={11}/> Quitar
                        </button>
                      </>
                    ) : (
                      <label style={{
                        display:'inline-flex', alignItems:'center', gap:'.3rem',
                        fontSize:'.7rem', color:'var(--muted)', cursor:'pointer',
                      }}>
                        <ImageIcon size={13} style={{ opacity:.6 }}/>
                        {ansUploading[l] ? 'Subiendo…' : 'Imagen'}
                        <input type="file" accept="image/*" style={{ display:'none' }}
                          disabled={ansUploading[l]}
                          onChange={e => handleAnswerImageUpload(l, e.target.files?.[0])}/>
                      </label>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
      {/* Answer layout */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              DISPOSICIÓN DE RESPUESTAS
            </label>
            <div style={{ display:'flex', gap:'.4rem' }}>
              {[['Lista','list'],['Cuadrícula 2×2','grid']].map(([label, val]) => {
                const active = (draft.answer_layout || 'list') === val
                return (
                  <button key={val} onClick={() => updateDraft('answer_layout', val)}
                    style={{
                      flex:1, padding:'.4rem 0', borderRadius:6, cursor:'pointer',
                      fontWeight:700, fontSize:'.75rem',
                      border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: active ? 'rgba(46,157,242,.12)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text)',
                    }}>
                    {label}
                  </button>
                )
              })}
            </div>
            <p style={{ fontSize:'.7rem', color:'var(--muted)', marginTop:'.5rem' }}>
              La cuadrícula muestra la imagen grande con el texto debajo — ideal para respuestas con imagen.
            </p>
          </div>
{/* Text size */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              TAMAÑO DE TEXTO
            </label>
            <div style={{ display:'flex', gap:'.4rem' }}>
                            {TEXT_SIZES.map(([label, val]) => {
                const active = nearestTextSize(draft.text_scale) === val
                return (
                  <button key={label} onClick={() => updateDraft('text_scale', val)}
                    style={{
                      flex:1, padding:'.4rem 0', borderRadius:6, cursor:'pointer',
                      fontWeight:700, fontSize:'.8rem',
                      border: active ? '2px solid var(--accent)' : '1px solid var(--border)',
                      background: active ? 'rgba(46,157,242,.12)' : 'transparent',
                      color: active ? 'var(--accent)' : 'var(--text)',
                    }}>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

        </div>
      </div>

      {/* ── Diálogo de salida con cambios sin guardar ───── */}
      {leaveOpen && (
        <div className="modal-backdrop" onClick={() => !saving && setLeaveOpen(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Cambios sin guardar</h2>
            <p style={{ color:'var(--muted)', fontSize:'.875rem', marginBottom:'1rem' }}>
              Tienes cambios en este test que todavía no se han guardado. ¿Qué quieres hacer?
            </p>
            {saveErr && <p style={{ color:'var(--danger)', fontSize:'.82rem', marginBottom:'.5rem' }}>{saveErr}</p>}
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setLeaveOpen(false)} disabled={saving}>Cancelar</button>
              <button className="btn btn-ghost" style={{ color:'var(--danger)' }} disabled={saving}
                onClick={() => confirm('Se perderán todos los cambios sin guardar. ¿Salir igual?') && leave()}>
                Salir sin guardar
              </button>
              <button className="btn btn-primary" onClick={saveAndLeave} disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar y salir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hover show delete on slide thumbs */}
      <style>{`
        .slide-delete-btn { opacity: 0 !important; }
        div:hover > .slide-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}