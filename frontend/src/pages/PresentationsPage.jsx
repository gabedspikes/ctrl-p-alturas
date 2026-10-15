import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { logError, friendlyError } from '../lib/errorLog'
import { useSchoolYear } from '../lib/schoolYear'
import { FileSliders, Plus, Pencil, Trash2, Play, AlertCircle } from 'lucide-react'


// ── Modal: Create / Edit Presentation ───────────────────
function PresentationModal({ onClose, onSave, initial }) {
  const { user } = useAuth()
  const CURRENT_YEAR = useSchoolYear()
  const [saveErr, setSaveErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [title, setTitle]           = useState(initial?.title || '')
  const [courseId, setCourseId]     = useState(initial?.course_id || '')
  const [subjectId, setSubjectId]   = useState(initial?.subject_id || '')
  const [assignments, setAssignments] = useState([]) // teacher_courses rows
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    if (!CURRENT_YEAR) return
    async function load() {
      const { data, error } = await supabase
        .from('teacher_courses')
        .select('id, course_id, subject_id, courses(name, grade_level, section), subjects(name)')
        .eq('teacher_id', user.id)
        .eq('year', CURRENT_YEAR)
        .order('course_id')

      if (error) { logError('presentation.assignments', error); setSaveErr(friendlyError(error, 'No se pudieron cargar tus cursos.')) }
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
  }, [CURRENT_YEAR])

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

    setSaving(true); setSaveErr('')
    const { error } = initial?.id
      ? await supabase.from('presentations').update(payload).eq('id', initial.id)
      : await supabase.from('presentations').insert(payload)
    setSaving(false)
    if (error) {
      logError('presentation.save', error)
      setSaveErr(friendlyError(error, 'No se pudo guardar. Intenta de nuevo.'))
      return
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

            {initial?.course_id && !courses.some(([id]) => id === initial.course_id) && (
              <p style={{ color:'var(--muted)', fontSize:'.78rem', marginBottom:'.5rem' }}>
                Este test era de un curso que no tienes asignado en {CURRENT_YEAR}. Elige el curso de este año.
              </p>
            )}
            {saveErr && <p style={{ color:'var(--danger)', fontSize:'.82rem', marginBottom:'.5rem' }}>{saveErr}</p>}
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!courseId || !subjectId || saving}
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
// ── Modal: Start Session ─────────────────────────────────
// Antes de crear la sesión se verifica todo lo que haría fallar la clase en
// silencio: test sin slides, slides sin respuesta correcta, curso sin
// alumnos este año, o una sesión del mismo test que quedó abierta.
function StartSessionModal({ presentation, onClose }) {
  const navigate = useNavigate()
  const CURRENT_YEAR = useSchoolYear()
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function start() {
    setLoading(true); setErr('')
    try {
      const [{ data: slides, error: e1 }, { data: open, error: e2 }] = await Promise.all([
        supabase.from('slides').select('id, slide_order, correct_answer')
          .eq('presentation_id', presentation.id).order('slide_order'),
        supabase.from('sessions').select('id')
          .eq('presentation_id', presentation.id).eq('status', 'active').limit(1),
      ])
      if (e1 || e2) throw (e1 || e2)

      if (!slides?.length) { setErr('Este test no tiene diapositivas. Agrégalas en "Editar Diapositivas".'); return }

      if (open?.length) {
        if (confirm('Ya hay una sesión de este test abierta (quizá quedó sin finalizar). ¿Retomarla en vez de crear otra?')) {
          navigate(`/sessions/${open[0].id}`); return
        }
      }

      const sinCorrecta = slides.map((s, i) => s.correct_answer ? null : i + 1).filter(Boolean)
      if (sinCorrecta.length && !confirm(
        `Las diapositivas ${sinCorrecta.join(', ')} no tienen respuesta correcta marcada: ` +
        'sus respuestas no sumarán puntaje. ¿Iniciar de todas formas?')) return

      if (!presentation.course_id) { setErr('Este test no tiene curso asignado. Edítalo y elige un curso.'); return }

      const { data: gen, error: e3 } = await supabase
        .from('generations').select('id')
        .eq('course_id', presentation.course_id).eq('year', CURRENT_YEAR).maybeSingle()
      if (e3) throw e3
      let count = 0
      if (gen) {
        const { count: c, error: e4 } = await supabase.from('generation_students')
          .select('id', { count: 'exact', head: true })
          .eq('generation_id', gen.id).eq('active', true)
        if (e4) throw e4
        count = c || 0
      }
      if (!gen || count === 0) {
        setErr(`${presentation.courses?.name || 'El curso'} no tiene alumnos activos en ${CURRENT_YEAR}. ` +
               'Ve a Cursos, agrégalos o cópialos del año anterior, y vuelve a intentar.')
        return
      }

      // scan_code lo genera la base; si choca con otra sesión activa
      // (índice único) se reintenta.
      let session = null, lastErr = null
      for (let attempt = 0; attempt < 3 && !session; attempt++) {
        const { data, error } = await supabase.from('sessions').insert({
          presentation_id:  presentation.id,
          course_id:        presentation.course_id,
          generation_id:    gen.id,
          current_slide_id: slides[0].id,
          status:           'active',
        }).select().single()
        if (!error) session = data
        else if (error.code === '23505' && /scan_code/.test(error.message)) lastErr = error
        else throw error
      }
      if (!session) throw lastErr
      navigate(`/sessions/${session.id}`)
    } catch (error) {
      logError('session.start', error, { presentation: presentation.id })
      setErr(friendlyError(error, 'No se pudo iniciar la sesión. Intenta de nuevo.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Comenzar Sesión</h2>
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
        {err && <p style={{ color:'var(--danger)', fontSize:'.85rem', marginBottom:'.75rem' }}>{err}</p>}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={start} disabled={loading || !CURRENT_YEAR}>
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
    const { data, error } = await supabase
      .from('presentations')
      .select('*, courses(name), subjects(name)')
      .order('created_at', { ascending: false })
    if (error) { logError('presentations.load', error); alert(friendlyError(error, 'No se pudieron cargar los tests.')) }
    setPresentations(data || [])
  }

async function deletePresentation(id) {
  // 1. Traer las sesiones de este test, con su estado y si están archivadas.
  const { data: sessions, error } = await supabase
    .from('sessions')
    .select('id, status, finished_at, archived_at')
    .eq('presentation_id', id)

  if (error) {
    alert('No se pudo verificar el estado del test. Intenta de nuevo.')
    return
  }

  const total       = sessions?.length || 0
  const finished     = (sessions || []).filter(s => s.status === 'finished')
  // Terminadas pero todavía NO copiadas a Plickers: son las que se perderían.
  const sinArchivar  = finished.filter(s => !s.archived_at)
  const activas       = (sessions || []).filter(s => s.status === 'active')

  // 2. Armar el mensaje de confirmación según el caso.
  let mensaje

  if (total === 0) {
    // Sin sesiones: borrar solo elimina el slides y sus diapositivas. Bajo riesgo.
    mensaje = '¿Eliminar este slides y todas sus diapositivas?\n\n' +
              'Este slides no tiene sesiones registradas.'
  } else if (sinArchivar.length > 0) {
    // CASO CRÍTICO: hay resultados de evaluación que aún no se guardaron.
    mensaje =
      '⚠ ATENCIÓN — Este slides tiene datos que NO se han guardado en el histórico.\n\n' +
      `Sesiones terminadas sin archivar: ${sinArchivar.length}\n` +
      (activas.length > 0 ? `Sesiones aún activas (sin terminar): ${activas.length}\n` : '') +
      '\nSi eliminas el slides ahora, se perderán de forma permanente las respuestas ' +
      'de los alumnos de esas sesiones, porque todavía no fueron copiadas a Plickers.\n\n' +
      'Recomendación: espera a que el archivado automático se ejecute (corre en las ' +
      'noches de días de semana) y vuelve a intentarlo. Para entonces estas sesiones ' +
      'ya estarán guardadas y podrás borrar el slides sin perder nada.\n\n' +
      '¿Eliminar de todas formas y perder estos datos?'
  } else if (activas.length > 0) {
    // Hay sesiones activas (colgadas): no se pueden archivar hasta terminarlas.
    mensaje =
      '⚠ Este slides tiene ' + activas.length + ' sesión(es) todavía activa(s) (sin terminar).\n\n' +
      'Una sesión sin terminar no se archiva, así que sus datos se perderían al borrar.\n' +
      'Si esa sesión quedó abierta por error, conviene finalizarla primero desde el ' +
      'historial de sesiones, dejar que se archive, y luego borrar el slides.\n\n' +
      '¿Eliminar de todas formas?'
  } else {
    // Todas las sesiones terminadas y ya archivadas: borrar es seguro.
    mensaje =
      '¿Eliminar este slides y todas sus diapositivas?\n\n' +
      `Este slides tiene ${finished.length} sesión(es), todas ya archivadas en Historico Alturas. ` +
      'Sus resultados están guardados en el histórico y no se perderán.'
  }

  // 3. Confirmar y, solo si el profesor acepta, borrar.
  if (!confirm(mensaje)) return

  // También limpiamos las imágenes del bucket de las slides de este test,
  // para no dejar archivos huérfanos en Storage.
  // Primero se borra el test; las imágenes solo si eso funcionó (antes se
  // borraban primero: si el borrado del test fallaba, quedaba sin imágenes).
  const { error: delErr } = await supabase.from('presentations').delete().eq('id', id)
  if (delErr) {
    logError('presentation.delete', delErr, { id })
    alert(friendlyError(delErr, 'No se pudo eliminar el slides. Intenta de nuevo.'))
    return
  }

  const { data: files } = await supabase.storage
    .from('slide-images').list(`slides/${id}`, { limit: 1000 })
  if (files?.length) {
    const { error: stErr } = await supabase.storage.from('slide-images')
      .remove(files.map(f => `slides/${id}/${f.name}`))
    if (stErr) logError('presentation.deleteImages', stErr, { id })
  }
  load()
}

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <FileSliders size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>
            Slides
          </h1>
          <p>Crea slides basados en diapositivas y lanza sesiones de escaneo en vivo.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('new')}>
          <Plus size={14}/> Crear Slides
        </button>
      </div>

      {presentations.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">📋</div>
          <h3>No hay Slides creados</h3>
          <p>Crea tu primer slide para construir diapositivas y preguntas.</p>
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