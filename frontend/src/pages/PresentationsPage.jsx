import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { FileSliders, Plus, Pencil, Trash2, Play, AlertCircle } from 'lucide-react'

const CURRENT_YEAR = new Date().getFullYear()

// ── Modal: Create / Edit Presentation ───────────────────
function PresentationModal({ onClose, onSave, initial }) {
  const { user } = useAuth()
  const [title, setTitle]           = useState(initial?.title || '')
  const [teacherCourseId, setTeacherCourseId] = useState(initial?.teacher_course_id || '')
  const [assignments, setAssignments] = useState([]) // teacher_courses rows
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('teacher_courses')
        .select('id, course_id, subject_id, courses(name, grade_level, section), subjects(name)')
        .eq('teacher_id', user.id)
        .eq('year', CURRENT_YEAR)
        .order('course_id')

      setAssignments(data || [])
      if (!teacherCourseId && data?.[0]) setTeacherCourseId(data[0].id)
      setLoading(false)
    }
    load()
  }, [])

  async function submit(e) {
    e.preventDefault()
    const assignment = assignments.find(a => a.id === teacherCourseId)

    const payload = {
      title,
      teacher_course_id: teacherCourseId || null,
      course_id:  assignment?.course_id  || null,
      subject_id: assignment?.subject_id || null,
      subject:    assignment?.subjects?.name || null,
      teacher_id: user.id,
    }

    if (initial?.id) {
      await supabase.from('presentations').update(payload).eq('id', initial.id)
    } else {
      await supabase.from('presentations').insert(payload)
    }
    onSave()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit Test' : 'New Test'}</h2>

        {loading ? (
          <p style={{ color:'var(--muted)', padding:'1rem 0' }}>Cargando...</p>
        ) : (
          <form onSubmit={submit}>
            <div className="form-group">
              <label>TÍTULO DE TEST</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                placeholder="e.g. Prueba Unidad 2"
              />
            </div>

            <div className="form-group">
              <label>CLASS & SUBJECT</label>
              {assignments.length === 0 ? (
                <div style={{
                  display:'flex', alignItems:'flex-start', gap:'.5rem',
                  background:'rgba(255,71,87,.08)', border:'1px solid rgba(255,71,87,.25)',
                  borderRadius:'var(--radius)', padding:'.75rem', fontSize:'.82rem',
                  color:'var(--danger)', lineHeight:1.5,
                }}>
                  <AlertCircle size={16} style={{ flexShrink:0, marginTop:2 }}/>
                  <span>
                    No se encontraron tests para {CURRENT_YEAR}.
                  </span>
                </div>
              ) : (
                <>
                  <select
                    value={teacherCourseId}
                    onChange={e => setTeacherCourseId(e.target.value)}
                    required
                  >
                    <option value="">— Selecciona Curso y Asignatura —</option>
                    {assignments.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.courses?.name} — {a.subjects?.name}
                      </option>
                    ))}
                  </select>
                  <p style={{ fontSize:'.72rem', color:'var(--muted)', marginTop:'.35rem' }}>
                    Cada opción muestra el curso y la asignatura juntos.
                    Contacta a tu administrador para agregar combinaciones faltantes.
                  </p>
                </>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={assignments.length === 0}
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
  const [loading, setLoading] = useState(false)

  async function start() {
    setLoading(true)

    // Get first slide
    const { data: slides } = await supabase
      .from('slides').select('id')
      .eq('presentation_id', presentation.id)
      .order('slide_order').limit(1)

    // Find the generation for this course + current year
    let generationId = null
    if (presentation.course_id) {
      const { data: gen } = await supabase
        .from('generations').select('id')
        .eq('course_id', presentation.course_id)
        .eq('year', CURRENT_YEAR)
        .single()
      generationId = gen?.id || null
    }

    const { data: session } = await supabase.from('sessions').insert({
      presentation_id:  presentation.id,
      course_id:        presentation.course_id,
      generation_id:    generationId,
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
          Los estudiantes responderán usando sus tarjetas impresas.
        </p>
        {presentation.subject && (
          <div style={{ display:'flex', gap:'.4rem', marginBottom:'1.25rem' }}>
            <span className="badge badge-blue">{presentation.course_name || 'Class'}</span>
            <span className="badge badge-accent">{presentation.subject}</span>
          </div>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={start} disabled={loading}>
            <Play size={13}/> {loading ? 'Starting…' : 'Start'}
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
          <p>Crea tests basados en diapositivas y lanza sesiones de escaneo en vivo.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('new')}>
          <Plus size={14}/> New Test
        </button>
      </div>

      {presentations.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <h3>No hay Tests creados</h3>
          <p>Crea tu primer test para construir diapositivas y preguntas.</p>
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
                  <Pencil size={12}/> Editar Diapositivas
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setSessionModal(p)}>
                  <Play size={12}/> Ejecutar
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal(p)}>Editar</button>
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