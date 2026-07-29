import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import {
  ArrowLeft, Plus, Trash2, Type, ImageIcon,
  Square, Save, ChevronUp, ChevronDown
} from 'lucide-react'

const CANVAS_W = 720
const CANVAS_H = 405

// ── Answer color map ─────────────────────────────────────
const ANS_COLORS = { A:'#e8ff47', B:'#47c8ff', C:'#ffa500', D:'#ff4757' }

export default function SlideEditorPage() {
  const { id: presentationId } = useParams()
  const navigate = useNavigate()

  const [presentation, setPresentation] = useState(null)
  const [slides, setSlides] = useState([])
  const [activeSlide, setActiveSlide] = useState(null)
  const [saving, setSaving] = useState(false)

  // props panel state
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [answerA, setAnswerA] = useState('')
  const [answerB, setAnswerB] = useState('')
  const [answerC, setAnswerC] = useState('')
  const [answerD, setAnswerD] = useState('')

  const canvasRef = useRef(null)
  const fabricRef = useRef(null)
  const activeSlideRef = useRef(null)

  // keep ref in sync so callbacks don't capture stale value
  useEffect(() => { activeSlideRef.current = activeSlide }, [activeSlide])

  // ── Load presentation + slides ──────────────────────────
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
        setActiveSlide(sl[0])
      } else {
        // create first blank slide
        const { data: newSlide } = await supabase.from('slides').insert({
          presentation_id: presentationId,
          slide_order: 0,
          question_text: '',
          correct_answer: null,
          canvas_json: null
        }).select().single()
        setSlides([newSlide])
        setActiveSlide(newSlide)
      }
    }
    init()
  }, [presentationId])

  // ── Init Fabric when active slide changes ───────────────
  useEffect(() => {
    if (!activeSlide || !canvasRef.current) return

    // dynamic import to avoid SSR issues
    import('fabric').then(({ fabric }) => {
      // destroy previous canvas
      if (fabricRef.current) {
        fabricRef.current.dispose()
        fabricRef.current = null
      }

      const canvas = new fabric.Canvas(canvasRef.current, {
        width: CANVAS_W, height: CANVAS_H,
        backgroundColor: '#1a1a20',
        selection: true
      })
      fabricRef.current = canvas

      // load saved JSON if exists
      if (activeSlide.canvas_json) {
        canvas.loadFromJSON(activeSlide.canvas_json, () => canvas.renderAll())
      }

      // sync props panel
      setCorrectAnswer(activeSlide.correct_answer || '')
      setQuestionText(activeSlide.question_text || '')
      setAnswerA(activeSlide.answer_a || '')
      setAnswerB(activeSlide.answer_b || '')
      setAnswerC(activeSlide.answer_c || '')
      setAnswerD(activeSlide.answer_d || '')
    })

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose()
        fabricRef.current = null
      }
    }
  }, [activeSlide?.id])

  // ── Save current slide to Supabase ──────────────────────
  const saveSlide = useCallback(async () => {
    if (!fabricRef.current || !activeSlideRef.current) return
    setSaving(true)
    const json = fabricRef.current.toJSON()
    await supabase.from('slides').update({
      canvas_json: json,
      question_text: questionText,
      correct_answer: correctAnswer || null
    }).eq('id', activeSlideRef.current.id)

    // refresh slides list
    const { data } = await supabase
      .from('slides').select('*')
      .eq('presentation_id', presentationId).order('slide_order')
    setSlides(data || [])
    setSaving(false)
  }, [questionText, correctAnswer, answerA, answerB, answerC, answerD, presentationId])

  // ── Switch slide (auto-save current first) ──────────────
  async function switchSlide(slide) {
    await saveSlide()
    setActiveSlide(slide)
  }

  // ── Add new slide ────────────────────────────────────────
  async function addSlide() {
    await saveSlide()
    const nextOrder = slides.length
    const { data: newSlide } = await supabase.from('slides').insert({
      presentation_id: presentationId,
      slide_order: nextOrder,
      question_text: '',
      correct_answer: null,
      canvas_json: null
    }).select().single()
    setSlides(s => [...s, newSlide])
    setActiveSlide(newSlide)
  }

  // ── Delete slide ─────────────────────────────────────────
  async function deleteSlide(slideId) {
    if (slides.length === 1) return alert("Can't delete the last slide.")
    await supabase.from('slides').delete().eq('id', slideId)
    const remaining = slides.filter(s => s.id !== slideId)
    setSlides(remaining)
    if (activeSlide?.id === slideId) setActiveSlide(remaining[0])
  }

  // ── Canvas tools ─────────────────────────────────────────
  function addText() {
    import('fabric').then(({ fabric }) => {
      const t = new fabric.IText('Question text here', {
        left: 60, top: 60, fontSize: 28, fill: '#e8e8ec',
        fontFamily: 'Syne, sans-serif', fontWeight: '700'
      })
      fabricRef.current.add(t)
      fabricRef.current.setActiveObject(t)
    })
  }

  function addRect() {
    import('fabric').then(({ fabric }) => {
      const r = new fabric.Rect({
        left: 100, top: 100, width: 200, height: 80,
        fill: 'rgba(232,255,71,0.15)', stroke: '#e8ff47',
        strokeWidth: 1, rx: 6, ry: 6
      })
      fabricRef.current.add(r)
    })
  }

  function addAnswerLabels() {
    import('fabric').then(({ fabric }) => {
      const labels = ['A', 'B', 'C', 'D']
      labels.forEach((l, i) => {
        const rect = new fabric.Rect({
          left: 60 + i * 160, top: 300, width: 140, height: 70,
          fill: `${ANS_COLORS[l]}22`, stroke: ANS_COLORS[l],
          strokeWidth: 1.5, rx: 6, ry: 6, selectable: false
        })
        const text = new fabric.Text(l, {
          left: 60 + i * 160 + 12, top: 315,
          fontSize: 30, fill: ANS_COLORS[l],
          fontFamily: 'DM Mono, monospace', fontWeight: '700', selectable: false
        })
        fabricRef.current.add(rect, text)
      })
      fabricRef.current.renderAll()
    })
  }

  function addImage() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return

      // upload to supabase storage
      const path = `slides/${presentationId}/${Date.now()}_${file.name}`
      const { data, error } = await supabase.storage
        .from('slide-images')
        .upload(path, file)
      if (error) {
        // fallback: use local data URL
        const reader = new FileReader()
        reader.onload = (ev) => {
          import('fabric').then(({ fabric }) => {
            fabric.Image.fromURL(ev.target.result, img => {
              img.scaleToWidth(300)
              img.set({ left: 200, top: 60 })
              fabricRef.current.add(img)
            })
          })
        }
        reader.readAsDataURL(file)
        return
      }

      const { data: urlData } = supabase.storage.from('slide-images').getPublicUrl(path)
      import('fabric').then(({ fabric }) => {
        fabric.Image.fromURL(urlData.publicUrl, img => {
          img.scaleToWidth(300)
          img.set({ left: 200, top: 60 })
          fabricRef.current.add(img)
        })
      })
    }
    input.click()
  }

  function deleteSelected() {
    const obj = fabricRef.current?.getActiveObject()
    if (obj) { fabricRef.current.remove(obj); fabricRef.current.renderAll() }
  }

  if (!presentation) return <div style={{ padding:'2rem', color:'var(--muted)' }}>Loading…</div>

  return (
    <div style={{ background:'var(--bg)', minHeight:'100vh' }}>
      {/* Top bar */}
      <div style={{
        display:'flex', alignItems:'center', gap:'1rem',
        padding:'.75rem 1.25rem', background:'var(--surface)',
        borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50
      }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/presentations')}>
          <ArrowLeft size={14}/> Back
        </button>
        <span style={{ fontWeight:700, fontSize:'1rem' }}>{presentation.title}</span>
        <span className="badge badge-blue">{presentation.courses?.name}</span>
        <div style={{ marginLeft:'auto', display:'flex', gap:'.5rem' }}>
          <button className="btn btn-primary btn-sm" onClick={saveSlide} disabled={saving}>
            <Save size={13}/> {saving ? 'Saving…' : 'Save Slide'}
          </button>
        </div>
      </div>

      <div className="editor-layout">
        {/* Left: slide list */}
        <div className="slide-list">
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'.5rem' }}>
            <span style={{ fontSize:'.7rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.1em' }}>SLIDES</span>
            <button className="btn btn-ghost btn-sm" onClick={addSlide}><Plus size={12}/></button>
          </div>
          {slides.map((s, i) => (
            <div key={s.id} className={`slide-thumb ${activeSlide?.id === s.id ? 'active' : ''}`}
              onClick={() => switchSlide(s)}>
              <span style={{ fontFamily:'var(--mono)', fontSize:'.75rem' }}>{i + 1}</span>
              <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'.75rem' }}>
                {s.question_text || '—'}
              </span>
              {s.correct_answer && (
                <span style={{ fontSize:'.65rem', fontWeight:800, color: ANS_COLORS[s.correct_answer] }}>
                  {s.correct_answer}
                </span>
              )}
              {slides.length > 1 && (
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding:'.1rem', minWidth:0 }}
                  onClick={e => { e.stopPropagation(); deleteSlide(s.id) }}>
                  <Trash2 size={10}/>
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Center: canvas */}
        <div className="canvas-area">
          <div className="slide-tools">
            <button className="btn btn-ghost btn-sm" onClick={addText}><Type size={13}/> Text</button>
            <button className="btn btn-ghost btn-sm" onClick={addRect}><Square size={13}/> Shape</button>
            <button className="btn btn-ghost btn-sm" onClick={addAnswerLabels}>A B C D</button>
            <button className="btn btn-ghost btn-sm" onClick={addImage}><ImageIcon size={13}/> Image</button>
            <button className="btn btn-danger btn-sm" onClick={deleteSelected}><Trash2 size={13}/> Delete</button>
          </div>
          <div className="canvas-wrap">
            <canvas ref={canvasRef} />
          </div>
          <p style={{ fontSize:'.7rem', color:'var(--muted)' }}>
            Click objects to select · Double-click text to edit · Drag to move
          </p>
        </div>

        {/* Right: props panel */}
        <div className="props-panel">
          <div className="card">
            <h3>Question Label</h3>
            <p style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:'.6rem' }}>
              Plain-text label for results export (not shown on slide)
            </p>
            <textarea
              rows={3}
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
              placeholder="e.g. What is the powerhouse of the cell?"
            />
          </div>


          <div className="card">
            <h3>Answer Text</h3>
            <p style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:'.75rem' }}>
              Text shown next to each answer in results. Saved separately from the canvas.
            </p>
            {[['A',answerA,setAnswerA],['B',answerB,setAnswerB],['C',answerC,setAnswerC],['D',answerD,setAnswerD]].map(([l,val,setter]) => (
              <div key={l} style={{display:'flex',alignItems:'center',gap:'.5rem',marginBottom:'.4rem'}}>
                <span style={{fontWeight:800,fontFamily:'var(--mono)',fontSize:'.9rem',color:ANS_COLORS[l],minWidth:16}}>{l}</span>
                <input
                  value={val}
                  onChange={e => setter(e.target.value)}
                  placeholder={`Answer ${l} text…`}
                  style={{fontSize:'.8rem',padding:'.35rem .6rem'}}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Correct Answer</h3>
            <p style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:'.75rem' }}>
              Used to mark responses as correct/incorrect
            </p>
            <div style={{ display:'flex', gap:'.5rem' }}>
              {['A','B','C','D'].map(l => (
                <button
                  key={l}
                  onClick={() => setCorrectAnswer(correctAnswer === l ? '' : l)}
                  style={{
                    flex:1, height:40, fontWeight:800, fontFamily:'var(--mono)',
                    fontSize:'1rem', borderRadius:'var(--radius)', border:'2px solid',
                    borderColor: correctAnswer === l ? ANS_COLORS[l] : 'var(--border)',
                    background: correctAnswer === l ? `${ANS_COLORS[l]}22` : 'transparent',
                    color: correctAnswer === l ? ANS_COLORS[l] : 'var(--muted)',
                    cursor:'pointer', transition:'all .15s'
                  }}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <h3>Tips</h3>
            <ul style={{ fontSize:'.75rem', color:'var(--muted)', paddingLeft:'1rem', lineHeight:1.8 }}>
              <li>Add question text to the canvas</li>
              <li>Click "A B C D" to add answer boxes</li>
              <li>Set the correct answer above</li>
              <li>Add images directly to slides</li>
              <li>Save before switching slides</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}