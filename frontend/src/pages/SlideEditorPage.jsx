import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import SlideRenderer from '../components/SlideRenderer'
import { ArrowLeft, Plus, Trash2, ImageIcon, Save, X } from 'lucide-react'

const ANS_COLORS = { A:'#22c55e', B:'#3b82f6', C:'#f97316', D:'#ef4444' }

const BG_PRESETS = [
  { color: '#1a1a20', label: 'Dark'        },
  { color: '#ffffff', label: 'White'       },
  { color: '#f8f9fa', label: 'Light grey'  },
  { color: '#0f172a', label: 'Navy'        },
  { color: '#1e3a5f', label: 'Blue'        },
  { color: '#14532d', label: 'Green'       },
  { color: '#450a0a', label: 'Dark red'    },
]

function isColorDark(hex = '#1a1a20') {
  try {
    const r = parseInt(hex.slice(1,3),16)
    const g = parseInt(hex.slice(3,5),16)
    const b = parseInt(hex.slice(5,7),16)
    return (r*299 + g*587 + b*114) / 1000 < 128
  } catch { return true }
}

// ── Empty slide template ──────────────────────────────────
const EMPTY_SLIDE_FIELDS = {
  question_text: '',
  answer_a: '', answer_b: '', answer_c: '', answer_d: '',
  answer_a_image: null, answer_b_image: null, answer_c_image: null, answer_d_image: null,
  correct_answer: null,
  bg_color: '#1a1a20',
  image_url: null,
  text_scale: 1,
}

export default function SlideEditorPage() {
  const { id: presentationId } = useParams()
  const navigate = useNavigate()

  const [presentation, setPresentation] = useState(null)
  const [slides, setSlides] = useState([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [draft, setDraft] = useState(EMPTY_SLIDE_FIELDS) // local editable copy
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [dirty, setDirty] = useState(false) // unsaved changes flag
  const [ansUploading, setAnsUploading] = useState({})   // { A:true, ... }

  const draftRef  = useRef(draft)
  const activeIdxRef = useRef(0)
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { activeIdxRef.current = activeIdx }, [activeIdx])

  const activeSlide = slides[activeIdx]

  // ── Load ─────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const { data: pres } = await supabase
        .from('presentations').select('*, courses(name)').eq('id', presentationId).single()
      setPresentation(pres)

      const { data: sl } = await supabase
        .from('slides').select('*')
        .eq('presentation_id', presentationId).order('slide_order')

      if (sl && sl.length > 0) {
        setSlides(sl)
        loadDraft(sl[0])
        setActiveIdx(0)
      } else {
        const { data: newSlide } = await supabase.from('slides').insert({
          presentation_id: presentationId,
          slide_order: 0,
          ...EMPTY_SLIDE_FIELDS,
        }).select().single()
        setSlides([newSlide])
        loadDraft(newSlide)
        setActiveIdx(0)
      }
    }
    init()
  }, [presentationId])

  function loadDraft(slide) {
    setDraft({
      question_text:  slide.question_text  || '',
      answer_a:       slide.answer_a       || '',
      answer_b:       slide.answer_b       || '',
      answer_c:       slide.answer_c       || '',
      answer_d:       slide.answer_d       || '',
      correct_answer: slide.correct_answer || null,
      bg_color:       slide.bg_color       || '#1a1a20',
      image_url:      slide.image_url      || null,
      answer_a_image: slide.answer_a_image || null,
      answer_b_image: slide.answer_b_image || null,
      answer_c_image: slide.answer_c_image || null,
      answer_d_image: slide.answer_d_image || null,
      text_scale:     slide.text_scale     || 1,
    })
    setDirty(false)
  }

  function updateDraft(field, value) {
    setDraft(d => ({ ...d, [field]: value }))
    setDirty(true)
  }

  // ── Save ─────────────────────────────────────────────────
  const saveSlide = useCallback(async () => {
    const slide = slides[activeIdxRef.current]
    if (!slide) return
    setSaving(true)
    const d = draftRef.current
    await supabase.from('slides').update({
      question_text:  d.question_text  || null,
      answer_a:       d.answer_a       || null,
      answer_b:       d.answer_b       || null,
      answer_c:       d.answer_c       || null,
      answer_d:       d.answer_d       || null,
      correct_answer: d.correct_answer || null,
      bg_color:       d.bg_color       || '#1a1a20',
      image_url:      d.image_url      || null,
      answer_a_image: d.answer_a_image || null,
      answer_b_image: d.answer_b_image || null,
      answer_c_image: d.answer_c_image || null,
      answer_d_image: d.answer_d_image || null,
      text_scale:     d.text_scale     || 1,
    }).eq('id', slide.id)

    // refresh list
    const { data } = await supabase.from('slides').select('*')
      .eq('presentation_id', presentationId).order('slide_order')
    setSlides(data || [])
    setSaving(false)
    setDirty(false)
  }, [slides, presentationId])

  // ── Switch slide ─────────────────────────────────────────
  async function switchSlide(idx) {
    if (dirty) await saveSlide()
    setActiveIdx(idx)
    loadDraft(slides[idx])
  }

  // ── Add / Delete slides ──────────────────────────────────
  async function addSlide() {
    if (dirty) await saveSlide()
    const { data: newSlide } = await supabase.from('slides').insert({
      presentation_id: presentationId,
      slide_order: slides.length,
      ...EMPTY_SLIDE_FIELDS,
    }).select().single()
    const newSlides = [...slides, newSlide]
    setSlides(newSlides)
    setActiveIdx(newSlides.length - 1)
    loadDraft(newSlide)
  }

  async function deleteSlide(idx) {
    if (slides.length === 1) return alert("Can't delete the last slide.")
    if (!confirm('Delete this slide?')) return
    await supabase.from('slides').delete().eq('id', slides[idx].id)
    const remaining = slides.filter((_, i) => i !== idx)
    setSlides(remaining)
    const newIdx = Math.min(idx, remaining.length - 1)
    setActiveIdx(newIdx)
    loadDraft(remaining[newIdx])
  }

  // ── Image upload (shared) ────────────────────────────────
  async function uploadToBucket(file) {
    const path = `slides/${presentationId}/${Date.now()}_${file.name.replace(/\s/g,'_')}`
    const { error } = await supabase.storage.from('slide-images').upload(path, file)
    if (error) return URL.createObjectURL(file)   // fallback local (no persiste tras recargar)
    const { data } = supabase.storage.from('slide-images').getPublicUrl(path)
    return data.publicUrl
  }

  async function handleImageUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    updateDraft('image_url', await uploadToBucket(file))
    setUploading(false)
  }

  function removeImage() {
    updateDraft('image_url', null)
  }

  async function handleAnswerImageUpload(letter, file) {
    if (!file) return
    setAnsUploading(u => ({ ...u, [letter]: true }))
    updateDraft(`answer_${letter.toLowerCase()}_image`, await uploadToBucket(file))
    setAnsUploading(u => ({ ...u, [letter]: false }))
  }

  function removeAnswerImage(letter) {
    updateDraft(`answer_${letter.toLowerCase()}_image`, null)
  }

  if (!presentation) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      alignItems:'center', justifyContent:'center', color:'var(--muted)' }}>
      Loading…
    </div>
  )

  // Build a merged slide for the live preview
  const previewSlide = activeSlide ? { ...activeSlide, ...draft } : null

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh', display:'flex', flexDirection:'column' }}>

      {/* ── Top bar ─────────────────────────────────────── */}
      <div style={{
        display:'flex', alignItems:'center', gap:'1rem', padding:'.75rem 1.25rem',
        background:'var(--surface)', borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:50, flexShrink:0,
      }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/presentations')}>
          <ArrowLeft size={14}/> Back
        </button>
        <div>
          <span style={{ fontWeight:700, fontSize:'1rem' }}>{presentation.title}</span>
          <span className="badge badge-blue" style={{ marginLeft:'.5rem' }}>
            {presentation.courses?.name}
          </span>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem', alignItems:'center' }}>
          {dirty && (
            <span style={{ fontSize:'.75rem', color:'var(--muted)', fontStyle:'italic' }}>
              Cambios no guardados
            </span>
          )}
          <button className="btn btn-primary btn-sm" onClick={saveSlide} disabled={saving}>
            <Save size={13}/> {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────── */}
      <div style={{
        flex: 1, display:'grid',
        gridTemplateColumns: '200px 1fr 300px',
        gap: 0, overflow:'hidden',
        height: 'calc(100vh - 57px)',
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
              <div key={s.id}
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
                      placeholder={`Answer ${l}…`}
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
{/* Text size */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              TAMAÑO DE TEXTO
            </label>
            <div style={{ display:'flex', gap:'.4rem' }}>
              {[['S',0.85],['M',1],['L',1.2],['XL',1.4]].map(([label, val]) => {
                const active = (draft.text_scale || 1) === val
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
          {/* Image */}
          <div style={{ padding:'1rem', borderBottom:'1px solid var(--border)' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              IMAGE (optional)
            </label>
            {draft.image_url ? (
              <div style={{ position:'relative' }}>
                <img src={draft.image_url} alt="Slide"
                  style={{ width:'100%', borderRadius:6, border:'1px solid var(--border)', display:'block' }}/>
                <button onClick={removeImage} style={{
                  position:'absolute', top:6, right:6,
                  background:'rgba(0,0,0,.7)', border:'none', borderRadius:4,
                  color:'#fff', cursor:'pointer', padding:'3px 6px', fontSize:12,
                  display:'flex', alignItems:'center', gap:3,
                }}>
                  <X size={11}/> Quitar
                </button>
              </div>
            ) : (
              <label style={{
                display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                gap:'.4rem', padding:'1.25rem', border:'2px dashed var(--border)',
                borderRadius:8, cursor:'pointer', color:'var(--muted)', fontSize:'.8rem',
                transition:'border-color .15s',
              }}
                onMouseEnter={e => e.currentTarget.style.borderColor='var(--accent)'}
                onMouseLeave={e => e.currentTarget.style.borderColor='var(--border)'}
              >
                <ImageIcon size={22} style={{ opacity:.5 }}/>
                {uploading ? 'Uploading…' : 'Click to upload image'}
                <input type="file" accept="image/*" style={{ display:'none' }}
                  onChange={handleImageUpload} disabled={uploading}/>
              </label>
            )}
          </div>

          {/* Background color */}
          <div style={{ padding:'1rem' }}>
            <label style={{ display:'block', fontSize:'.7rem', color:'var(--muted)',
              fontWeight:700, letterSpacing:'.1em', marginBottom:'.75rem' }}>
              FONDO
            </label>
            <div style={{ display:'flex', gap:'.4rem', flexWrap:'wrap' }}>
              {BG_PRESETS.map(({ color, label }) => (
                <button
                  key={color}
                  onClick={() => updateDraft('bg_color', color)}
                  title={label}
                  style={{
                    width:28, height:28, borderRadius:5, cursor:'pointer',
                    background:color, flexShrink:0,
                    border: draft.bg_color === color
                      ? '3px solid var(--accent)'
                      : '2px solid var(--border)',
                    transition:'border .1s',
                  }}
                />
              ))}
              <input
                type="color"
                value={draft.bg_color}
                onChange={e => updateDraft('bg_color', e.target.value)}
                style={{ width:28, height:28, padding:0, border:'2px solid var(--border)',
                  borderRadius:5, cursor:'pointer', background:'none' }}
                title="Custom color"
              />
            </div>
            <p style={{ fontSize:'.7rem', color:'var(--muted)', marginTop:'.5rem' }}>
              {isColorDark(draft.bg_color) ? '🌙 Dark background' : '☀️ Light background'}
            </p>
          </div>
        </div>
      </div>

      {/* Hover show delete on slide thumbs */}
      <style>{`
        .slide-delete-btn { opacity: 0 !important; }
        div:hover > .slide-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  )
}