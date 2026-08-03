import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { FileSliders, Plus, Pencil, Trash2, Play, AlertCircle } from 'lucide-react'

// ── Modal: Create / Edit Presentation ───────────────────
function PresentationModal({ onClose, onSave, initial }) {
  const { user } = useAuth()
  const [title, setTitle]         = useState(initial?.title || '')
  const [subjectId, setSubjectId] = useState(initial?.subject_id || '')
  const [courseId, setCourseId]   = useState(initial?.course_id || '')
  const [courses, setCourses]     = useState([])
  const [subjects, setSubjects]   = useState([]) // teacher's assigned subjects
  const [loading, setLoading]     = useState(true)

  useEffect(() => {
    async function load() {
      // Load courses and teacher's assigned subjects in parallel
      const [{ data: courseData }, { data: subjectData }] = await Promise.all([
        supabase.from('courses').select('id, name').order('name'),
        supabase
          .from('teacher_subjects')
          .select('subject_id, subjects(id, name, level_id, course_levels(name))')
          .eq('teacher_id', user.id)
          .eq('subjects.active', true)
          .order('subject_id')
      ])

      setCourses(courseData || [])

      // Flatten the joined subject data
      const flat = (subjectData || [])
        .map(row => row.subjects)
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'))

      setSubjects(flat)

      // Set defaults
      if (!courseId && courseData?.[0]) setCourseId(courseData[0].id)
      if (!subjectId && flat[0]) setSubjectId(flat[0].id)

      setLoading(false)
    }
    load()
  }, [])

  async function submit(e) {
    e.preventDefault()
    const selectedSubject = subjects.find(s => s.id === subjectId)
    const subjectName = selectedSubject?.name || null

    if (initial?.id) {
      await supabase.from('presentations').update({
        title,
        subject_id:   subjectId   || null,
        subject:      subjectName,  // keep text copy for display
        course_id:    courseId,
      }).eq('id', initial.id)
    } else {
      await supabase.from('presentations').insert({
        title,
        subject_id:   subjectId   || null,
        subject:      subjectName,
        course_id:    courseId,
        teacher_id:   user.id,
      })
    }
    onSave()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit Test' : 'New Test'}</h2>

        {loading ? (
          <p style={{ color:'var(--muted)', fontSize:'.875rem', padding:'1rem 0' }}>Loading…</p>
        ) : (
          <form onSubmit={submit}>

            <div className="form-group">
              <label>TEST TITLE</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="e.g. Prueba Capítulo 5"
              />
            </div>

            <div className="form-group">
              <label>SUBJECT</label>
              {subjects.length === 0 ? (
                <div style={{
                  display:'flex', alignItems:'flex-start', gap:'.5rem',
                  background:'rgba(255,71,87,.08)', border:'1px solid rgba(255,71,87,.25)',
                  borderRadius:'var(--radius)', padding:'.75rem', fontSize:'.82rem',
                  color:'var(--danger)', lineHeight: 1.5,
                }}>
                  <AlertCircle size={16} style={{ flexShrink:0, marginTop:2 }}/>
                  <span>
                    No subjects assigned to your account yet. Ask your administrator
                    to add your subjects in the Supabase dashboard
                    (teacher_subjects table).
                  </span>
                </div>
              ) : (
                <select
                  value={subjectId}
                  onChange={e => setSubjectId(e.target.value)}
                  required
                >
                  <option value="">— Select a subject —</option>
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                      {s.course_levels?.name ? ` (${s.course_levels.name})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="form-group">
              <label>CLASS</label>
              <select
                value={courseId}
                onChange={e => setCourseId(e.target.value)}
                required
              >
                {courses.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={subjects.length === 0}
              >
                Save
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Modal: Start Session ─────────────────────────────────
function StartSessionModal({ presentation, onClose }) {
  const navigate = useNavigate()

  async function start() {
    const { data: slides } = await supabase
      .from('slides').select('id')
      .eq('presentation_id', presentation.id)
      .order('slide_order').limit(1)

    const { data: session } = await supabase.from('sessions').insert({
      presentation_id:  presentation.id,
      course_id:        presentation.course_id,
      current_slide_id: slides?.[0]?.id || null,
      status:           'active',
    }).select().single()

    navigate(`/sessions/${session.id}`)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Start Session</h2>
        <p style={{ color:'var(--muted)', fontSize:'.875rem', marginBottom:'1.5rem' }}>
          Launch <strong style={{ color:'var(--text)' }}>{presentation.title}</strong> as a live session.
          Students will use their printed cards to answer.
        </p>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={start}>
            <Play size={13}/> Start
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────
export default function PresentationsPage() {
  const [presentations, setPresentations] = useState([])
  const [modal, setModal]               = useState(null)
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
          <h1>
            <FileSliders size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>
            Tests
          </h1>
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
                <div style={{ display:'flex', gap:'.35rem', marginTop:'.5rem', flexWrap:'wrap' }}>
                  <span className="badge badge-blue">{p.courses?.name || 'No class'}</span>
                  {p.subject && <span className="badge badge-accent">{p.subject}</span>}
                </div>
              </div>
              <div style={{ display:'flex', gap:'.5rem', marginTop:'auto', flexWrap:'wrap' }}>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/presentations/${p.id}/edit`)}>
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