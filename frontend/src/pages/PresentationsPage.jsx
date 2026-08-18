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
  const [courseId, setCourseId]     = useState(initial?.course_id || '')
  const [subjectId, setSubjectId]   = useState(initial?.subject_id || '')
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

      const rows = data || []
      setAssignments(rows)

      // Prefill: en edición usa lo guardado; si no, primer curso (y su materia
      // si es la única).
      if (initial?.course_id) {
        setCourseId(initial.course_id)
        setSubjectId(initial.subject_id || '')
      } else if (rows[0]) {
        setCourseId(rows[0].course_id)
        const subs = rows.filter(a => a.course_id === rows[0].course_id)
        if (subs.length === 1) setSubjectId(subs[0].subject_id)
      }
      setLoading(false)
    }
    load()
  }, [])

  // Cursos únicos (para el primer dropdown)
  const courses = React.useMemo(() => {
    const m = new Map()
    for (const a of assignments) if (!m.has(a.course_id)) m.set(a.course_id, a.courses)
    return [...m.entries()]   // [ [course_id, {name,...}], ... ]
  }, [assignments])

  // Materias del curso seleccionado (segundo dropdown, se puebla al elegir curso)
  const subjectsForCourse = React.useMemo(() => {
    if (!courseId) return []
    const m = new Map()
    for (const a of assignments) {
      if (a.course_id === courseId && !m.has(a.subject_id)) m.set(a.subject_id, a.subjects)
    }
    return [...m.entries()]   // [ [subject_id, {name}], ... ]
  }, [assignments, courseId])

  function onCourseChange(id) {
    setCourseId(id)
    const subs = assignments.filter(a => a.course_id === id)
    setSubjectId(subs.length === 1 ? subs[0].subject_id : '')  // auto si es única
  }

  async function submit(e) {
    e.preventDefault()
    // La fila teacher_courses que corresponde al par curso+materia elegido
    const assignment = assignments.find(
      a => a.course_id === courseId && a.subject_id === subjectId
    )

    const payload = {
      title,
      teacher_course_id: assignment?.id || null,
      course_id:  courseId  || null,
      subject_id: subjectId || null,
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

            {assignments.length === 0 ? (
              <p style={{ color:'var(--muted)', fontSize:'.85rem', padding:'.5rem 0' }}>
                No tienes cursos asignados este año. Contacta a tu administrador para
                agregar combinaciones de curso y materia.
              </p>
            ) : (
              <>
                <div className="form-group">
                  <label>CURSO</label>
                  <select value={courseId} onChange={e => onCourseChange(e.target.value)} required>
                    <option value="" disabled>Selecciona un curso…</option>
                    {courses.map(([id, c]) => (
                      <option key={id} value={id}>{c?.name || 'Curso'}</option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>MATERIA</label>
                  <select
                    value={subjectId}
                    onChange={e => setSubjectId(e.target.value)}
                    required
                    disabled={!courseId}
                  >
                    <option value="" disabled>
                      {courseId ? 'Selecciona una materia…' : 'Primero elige un curso'}
                    </option>
                    {subjectsForCourse.map(([id, s]) => (
                      <option key={id} value={id}>{s?.name || 'Materia'}</option>
                    ))}
                  </select>
                </div>
              </>
            )}

            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!courseId || !subjectId}
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
        {presentation.subjects?.name && (
          <div style={{ display:'flex', gap:'.4rem', marginBottom:'1.25rem' }}>
            <span className="badge badge-blue">{presentation.courses?.name || 'Class'}</span>
            <span className="badge badge-accent">{presentation.subjects.name}</span>
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
      .select('*, courses(name), subjects(name)')
      .order('created_at', { ascending: false })
    setPresentations(data || [])
  }


  async function deletePresentation(id) {
    if (!confirm('Delete this test and all its slides?')) return
    // Borrar todas las imágenes del bucket bajo la carpeta de este test
    const { data: files } = await supabase.storage
      .from('slide-images').list(`slides/${id}`)
    if (files?.length) {
      await supabase.storage.from('slide-images')
        .remove(files.map(f => `slides/${id}/${f.name}`))
    }
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
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:'.5rem' }}>
                <div>
                  <h3>{p.title}</h3>
                  <div style={{ display:'flex', gap:'.35rem', marginTop:'.5rem', flexWrap:'wrap' }}>
                    <span className="badge badge-blue">{p.courses?.name || 'No class'}</span>
                    {p.subjects?.name && <span className="badge badge-accent">{p.subjects.name}</span>}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setModal(p)}>Editar</button>
              </div>
              <div style={{ display:'flex', gap:'.5rem', marginTop:'auto', flexWrap:'wrap' }}>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/presentations/${p.id}/edit`)}>
                  <Pencil size={12}/> Editar Diapositivas
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setSessionModal(p)}>
                  <Play size={12}/> Ejecutar
                </button>
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