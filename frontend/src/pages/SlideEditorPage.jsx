import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ArrowLeft, Plus, Trash2, Type, ImageIcon, Square, Save } from 'lucide-react'

const CANVAS_W = 720
const CANVAS_H = 405
const ANS_COLORS = { A:'#e8ff47', B:'#47c8ff', C:'#ffa500', D:'#ff4757' }
const ANS_BG     = { A:'rgba(232,255,71,0.15)', B:'rgba(71,200,255,0.15)', C:'rgba(255,165,0,0.15)', D:'rgba(255,71,87,0.15)' }

// IDs for the auto-managed canvas objects so we can find and update them
const FABRIC_IDS = {
  questionText: '__question_text__',
  answerBoxA: '__answer_box_A__', answerLabelA: '__answer_label_A__', answerTextA: '__answer_text_A__',
  answerBoxB: '__answer_box_B__', answerLabelB: '__answer_label_B__', answerTextB: '__answer_text_B__',
  answerBoxC: '__answer_box_C__', answerLabelC: '__answer_label_C__', answerTextC: '__answer_text_C__',
  answerBoxD: '__answer_box_D__', answerLabelD: '__answer_label_D__', answerTextD: '__answer_text_D__',
}

export default function SlideEditorPage() {
  const { id: presentationId } = useParams()
  const navigate = useNavigate()

  const [presentation, setPresentation] = useState(null)
  const [slides, setSlides] = useState([])
  const [activeSlide, setActiveSlide] = useState(null)
  const [saving, setSaving] = useState(false)

  // Props panel state — use refs as well so saveSlide always sees current values
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [questionText, setQuestionText] = useState('')
  const [answerA, setAnswerA] = useState('')
  const [answerB, setAnswerB] = useState('')
  const [answerC, setAnswerC] = useState('')
  const [answerD, setAnswerD] = useState('')

  const correctAnswerRef = useRef('')
  const questionTextRef  = useRef('')
  const answerARef = useRef('')
  const answerBRef = useRef('')
  const answerCRef = useRef('')
  const answerDRef = useRef('')

  // Keep refs in sync
  useEffect(() => { correctAnswerRef.current = correctAnswer }, [correctAnswer])
  useEffect(() => { questionTextRef.current  = questionText  }, [questionText])
  useEffect(() => { answerARef.current = answerA }, [answerA])
  useEffect(() => { answerBRef.current = answerB }, [answerB])
  useEffect(() => { answerCRef.current = answerC }, [answerC])
  useEffect(() => { answerDRef.current = answerD }, [answerD])

  const canvasRef    = useRef(null)
  const fabricRef    = useRef(null)
  const activeSlideRef = useRef(null)
  useEffect(() => { activeSlideRef.current = activeSlide }, [activeSlide])

  // ── Load presentation + slides ───────────────────────────
  useEffect(() => {
    async function init() {
      const { data: pres } = await supabase
        .from('presentations').select('*, courses(name)').eq('id', presentationId).single()
      setPresentation(pres)

      const { data: sl } = await supabase
        .from('slides').select('*')
        .eq('presentation_id', presentationId).order('slide_order')

      if (sl && sl.length > 0) {
        setSlides(sl); setActiveSlide(sl[0])
      } else {
        const { data: newSlide } = await supabase.from('slides').insert({
          presentation_id: presentationId, slide_order: 0,
          question_text: '', correct_answer: null, canvas_json: null
        }).select().single()
        setSlides([newSlide]); setActiveSlide(newSlide)
      }
    }
    init()
  }, [presentationId])

  // ── Init Fabric when active slide changes ────────────────
  useEffect(() => {
    if (!activeSlide || !canvasRef.current) return
    import('fabric').then(({ fabric }) => {
      if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null }
      const canvas = new fabric.Canvas(canvasRef.current, {
        width: CANVAS_W, height: CANVAS_H,
        backgroundColor: '#1a1a20', selection: true
      })
      fabricRef.current = canvas

      if (activeSlide.canvas_json) {
        canvas.loadFromJSON(activeSlide.canvas_json, () => canvas.renderAll())
      }

      setCorrectAnswer(activeSlide.correct_answer || '')
      setQuestionText(activeSlide.question_text || '')
      setAnswerA(activeSlide.answer_a || '')
      setAnswerB(activeSlide.answer_b || '')
      setAnswerC(activeSlide.answer_c || '')
      setAnswerD(activeSlide.answer_d || '')
    })
    return () => { if (fabricRef.current) { fabricRef.current.dispose(); fabricRef.current = null } }
  }, [activeSlide?.id])

  // ── Save slide ────────────────────────────────────────────
  const saveSlide = useCallback(async () => {
    if (!fabricRef.current || !activeSlideRef.current) return
    setSaving(true)
    const json = fabricRef.current.toJSON(['customId'])
    await supabase.from('slides').update({
      canvas_json:    json,
      question_text:  questionTextRef.current,
      correct_answer: correctAnswerRef.current || null,
      answer_a:       answerARef.current || null,
      answer_b:       answerBRef.current || null,
      answer_c:       answerCRef.current || null,
      answer_d:       answerDRef.current || null,
    }).eq('id', activeSlideRef.current.id)

    const { data } = await supabase.from('slides').select('*')
      .eq('presentation_id', presentationId).order('slide_order')
    setSlides(data || [])
    setSaving(false)
  }, [presentationId])

  async function switchSlide(slide) { await saveSlide(); setActiveSlide(slide) }
  async function addSlide() {
    await saveSlide()
    const { data: newSlide } = await supabase.from('slides').insert({
      presentation_id: presentationId, slide_order: slides.length,
      question_text: '', correct_answer: null, canvas_json: null
    }).select().single()
    setSlides(s => [...s, newSlide]); setActiveSlide(newSlide)
  }
  async function deleteSlide(slideId) {
    if (slides.length === 1) return alert("Can't delete the last slide.")
    await supabase.from('slides').delete().eq('id', slideId)
    const remaining = slides.filter(s => s.id !== slideId)
    setSlides(remaining)
    if (activeSlide?.id === slideId) setActiveSlide(remaining[0])
  }

  // ── Canvas sync helpers ───────────────────────────────────
  function getFabricObj(customId) {
    return fabricRef.current?.getObjects().find(o => o.customId === customId)
  }

  // Sync question text to canvas
  useEffect(() => {
    if (!fabricRef.current) return
    import('fabric').then(({ fabric }) => {
      const existing = getFabricObj(FABRIC_IDS.questionText)
      if (existing) {
        existing.set('text', questionText || 'Question text here')
        fabricRef.current.renderAll()
      }
    })
  }, [questionText])

  // Sync answer texts to canvas
  function syncAnswerText(letter, text, setter) {
    if (!fabricRef.current) return
    const textId = FABRIC_IDS[`answerText${letter}`]
    const existing = getFabricObj(textId)
    if (existing) {
      existing.set('text', text || letter)
      fabricRef.current.renderAll()
    }
    setter(text)
  }

  // ── Canvas tools ─────────────────────────────────────────
  function addText() {
    import('fabric').then(({ fabric }) => {
      const t = new fabric.IText(questionText || 'Question text here', {
        left: 40, top: 40, fontSize: 28, fill: '#e8e8ec',
        fontFamily: 'Syne, sans-serif', fontWeight: '700',
        customId: FABRIC_IDS.questionText
      })
      // Remove existing question text object if any
      const old = getFabricObj(FABRIC_IDS.questionText)
      if (old) fabricRef.current.remove(old)
      fabricRef.current.add(t)
      fabricRef.current.setActiveObject(t)
    })
  }

  function addRect() {
    import('fabric').then(({ fabric }) => {
      const r = new fabric.Rect({
        left: 100, top: 100, width: 200, height: 80,
        fill: 'rgba(232,255,71,0.15)', stroke: '#e8ff47', strokeWidth: 1, rx: 6, ry: 6
      })
      fabricRef.current.add(r)
    })
  }

  function addAnswerLabels() {
    import('fabric').then(({ fabric }) => {
      const answers = { A: answerARef.current, B: answerBRef.current, C: answerCRef.current, D: answerDRef.current }
      // Remove existing answer objects
      Object.values(FABRIC_IDS).forEach(id => {
        if (id.startsWith('__answer_')) {
          const obj = getFabricObj(id)
          if (obj) fabricRef.current.remove(obj)
        }
      })

      const colW = 160, startX = 40, startY = 290, boxH = 80

      ;['A','B','C','D'].forEach((l, i) => {
        const x = startX + i * colW
        const ansText = answers[l] || l

        const box = new fabric.Rect({
          left: x, top: startY, width: colW - 10, height: boxH,
          fill: ANS_BG[l], stroke: ANS_COLORS[l], strokeWidth: 1.5, rx: 6, ry: 6,
          customId: FABRIC_IDS[`answerBox${l}`]
        })
        const label = new fabric.Text(l, {
          left: x + 10, top: startY + 10,
          fontSize: 22, fill: ANS_COLORS[l],
          fontFamily: 'DM Mono, monospace', fontWeight: '700',
          customId: FABRIC_IDS[`answerLabel${l}`], selectable: false, evented: false
        })
        const text = new fabric.IText(ansText, {
          left: x + 10, top: startY + 38,
          fontSize: 14, fill: '#e8e8ec',
          fontFamily: 'Syne, sans-serif', width: colW - 25,
          customId: FABRIC_IDS[`answerText${l}`]
        })
        fabricRef.current.add(box, label, text)
      })
      fabricRef.current.renderAll()
    })
  }

  function addImage() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = 'image/*'
    input.onchange = (e) => {
      const file = e.target.files[0]; if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        import('fabric').then(({ fabric }) => {
          fabric.Image.fromURL(ev.target.result, img => {
            img.scaleToWidth(300); img.set({ left: 200, top: 60 })
            fabricRef.current.add(img)
          })
        })
      }
      reader.readAsDataURL(file)
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
        display:'flex', alignItems:'center', gap:'1rem', padding:'.75rem 1.25rem',
        background:'var(--surface)', borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:50
      }}>
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/presentations')}>
          <ArrowLeft size={14}/> Back
        </button>
        <span style={{ fontWeight:700, fontSize:'1rem' }}>{presentation.title}</span>
        <span className="badge badge-blue">{presentation.courses?.name}</span>
        <div style={{ marginLeft:'auto' }}>
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
            <div key={s.id}
              className={`slide-thumb ${activeSlide?.id === s.id ? 'active' : ''}`}
              onClick={() => switchSlide(s)}>
              <span style={{ fontFamily:'var(--mono)', fontSize:'.75rem' }}>{i+1}</span>
              <span style={{ flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', fontSize:'.75rem' }}>
                {s.question_text || '—'}
              </span>
              {s.correct_answer && (
                <span style={{ fontSize:'.65rem', fontWeight:800, color: ANS_COLORS[s.correct_answer] }}>
                  {s.correct_answer}
                </span>
              )}
              {slides.length > 1 && (
                <button className="btn btn-ghost btn-sm" style={{ padding:'.1rem', minWidth:0 }}
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
            <button className="btn btn-ghost btn-sm" onClick={addText}><Type size={13}/> Question</button>
            <button className="btn btn-ghost btn-sm" onClick={addRect}><Square size={13}/> Shape</button>
            <button className="btn btn-ghost btn-sm" onClick={addAnswerLabels}>A B C D</button>
            <button className="btn btn-ghost btn-sm" onClick={addImage}><ImageIcon size={13}/> Image</button>
            <button className="btn btn-danger btn-sm" onClick={deleteSelected}><Trash2 size={13}/> Delete</button>
          </div>
          <div className="canvas-wrap"><canvas ref={canvasRef}/></div>
          <p style={{ fontSize:'.7rem', color:'var(--muted)' }}>
            Click to select · Double-click text to edit · Drag to move ·
            <strong style={{ color:'var(--accent)' }}> Sidebar text syncs to canvas automatically</strong>
          </p>
        </div>

        {/* Right: props panel */}
        <div className="props-panel">
          <div className="card">
            <h3>Question Label</h3>
            <p style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:'.6rem' }}>
              Type here to update the question on the canvas.
            </p>
            <textarea
              rows={3}
              value={questionText}
              onChange={e => setQuestionText(e.target.value)}
              placeholder="e.g. Is the sky blue?"
            />
          </div>

          <div className="card">
            <h3>Answer Text</h3>
            <p style={{ fontSize:'.72rem', color:'var(--muted)', marginBottom:'.75rem' }}>
              Updates canvas answer boxes automatically when "A B C D" is placed.
            </p>
            {[
              ['A', answerA, v => syncAnswerText('A', v, setAnswerA)],
              ['B', answerB, v => syncAnswerText('B', v, setAnswerB)],
              ['C', answerC, v => syncAnswerText('C', v, setAnswerC)],
              ['D', answerD, v => syncAnswerText('D', v, setAnswerD)],
            ].map(([l, val, handler]) => (
              <div key={l} style={{ display:'flex', alignItems:'center', gap:'.5rem', marginBottom:'.4rem' }}>
                <span style={{ fontWeight:800, fontFamily:'var(--mono)', fontSize:'.9rem',
                  color:ANS_COLORS[l], minWidth:16 }}>{l}</span>
                <input
                  value={val}
                  onChange={e => handler(e.target.value)}
                  placeholder={`Answer ${l}…`}
                  style={{ fontSize:'.8rem', padding:'.35rem .6rem' }}
                />
              </div>
            ))}
          </div>

          <div className="card">
            <h3>Correct Answer</h3>
            <div style={{ display:'flex', gap:'.5rem' }}>
              {['A','B','C','D'].map(l => (
                <button key={l}
                  onClick={() => setCorrectAnswer(correctAnswer === l ? '' : l)}
                  style={{
                    flex:1, height:40, fontWeight:800, fontFamily:'var(--mono)',
                    fontSize:'1rem', borderRadius:'var(--radius)', border:'2px solid',
                    borderColor: correctAnswer === l ? ANS_COLORS[l] : 'var(--border)',
                    background:  correctAnswer === l ? `${ANS_COLORS[l]}22` : 'transparent',
                    color:       correctAnswer === l ? ANS_COLORS[l] : 'var(--muted)',
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
              <li>Click "Question" to add the question box</li>
              <li>Click "A B C D" to add answer boxes</li>
              <li>Type in the sidebar — canvas updates live</li>
              <li>Set the correct answer above</li>
              <li>Save before switching slides</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}