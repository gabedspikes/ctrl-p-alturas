import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { FileSliders, Plus, Pencil, Trash2, Play } from 'lucide-react'

function PresentationModal({ onClose, onSave, initial }) {
  const { user } = useAuth()
  const [title, setTitle] = useState(initial?.title || '')
  const [subject, setSubject] = useState(initial?.subject || '')
  const [courseId, setCourseId] = useState(initial?.course_id || '')
  const [courses, setCourses] = useState([])

  useEffect(() => {
    supabase.from('courses').select('id,name').order('name')
      .then(({ data }) => { setCourses(data || []); if (!courseId && data?.[0]) setCourseId(data[0].id) })
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (initial?.id) {
      await supabase.from('presentations').update({ title, subject: subject || null, course_id: courseId }).eq('id', initial.id)
    } else {
      await supabase.from('presentations').insert({ title, subject: subject || null, course_id: courseId, teacher_id: user.id })
    }
    onSave()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit Test' : 'New Test'}</h2>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>TEST TITLE</label>
            <input value={title} onChange={e => setTitle(e.target.value)} required placeholder="e.g. Chapter 5 Quiz" />
          </div>
          <div className="form-group">
            <label>SUBJECT (optional)</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="e.g. Mathematics, Science, History"
            />
          </div>
          <div className="form-group">
            <label>CLASS</label>
            <select value={courseId} onChange={e => setCourseId(e.target.value)} required>
              {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function StartSessionModal({ presentation, onClose }) {
  const navigate = useNavigate()
  async function start() {
    // get first slide
    const { data: slides } = await supabase
      .from('slides').select('id').eq('presentation_id', presentation.id)
      .order('slide_order').limit(1)
    const { data: session } = await supabase.from('sessions').insert({
      presentation_id: presentation.id,
      course_id: presentation.course_id,
      current_slide_id: slides?.[0]?.id || null,
      status: 'active'
    }).select().single()
    navigate(`/sessions/${session.id}`)
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Start Session</h2>
        <p style={{ color:'var(--muted)', fontSize:'.875rem', marginBottom:'1.5rem' }}>
          Launch <strong style={{color:'var(--text)'}}>{presentation.title}</strong> as a live session.
          Students will use their printed cards to answer.
        </p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={start}><Play size={13}/> Start</button>
        </div>
      </div>
    </div>
  )
}

export default function PresentationsPage() {
  const [presentations, setPresentations] = useState([])
  const [modal, setModal] = useState(null)
  const [sessionModal, setSessionModal] = useState(null)
  const navigate = useNavigate()

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase
      .from('presentations')
      .select('*, courses(name)')
      .order('created_at', { ascending: false })
    setPresentations(data || [])
  }

  async function deletePresentation(id) {
    if (!confirm('Delete this test and all its slides?')) return
    await supabase.from('presentations').delete().eq('id', id)
    load()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1><FileSliders size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>Tests</h1>
          <p>Create slide-based tests and launch live scanning sessions.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('new')}>
          <Plus size={14}/> New Test
        </button>
      </div>

      {presentations.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <h3>No tests yet</h3>
          <p>Create your first test to build slides and questions.</p>
        </div>
      ) : (
        <div className="card-grid">
          {presentations.map(p => (
            <div key={p.id} className="card" style={{ display:'flex', flexDirection:'column', gap:'.75rem' }}>
              <div>
                <h3>{p.title}</h3>
                <div style={{ display:'flex', gap:'.35rem', marginTop:'.35rem', flexWrap:'wrap' }}>
                  <span className="badge badge-blue">{p.courses?.name || 'No class'}</span>
                  {p.subject && <span className="badge badge-accent">{p.subject}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:'.5rem', marginTop:'auto' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/presentations/${p.id}/edit`)}>
                  <Pencil size={12}/> Edit Slides
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setSessionModal(p)}>
                  <Play size={12}/> Run
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal(p)}>Edit</button>
                <button className="btn btn-danger btn-sm" onClick={() => deletePresentation(p.id)}>
                  <Trash2 size={12}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <PresentationModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}

      {sessionModal && (
        <StartSessionModal
          presentation={sessionModal}
          onClose={() => setSessionModal(null)}
        />
      )}
    </>
  )
}