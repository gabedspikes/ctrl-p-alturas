import React, { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { Users, Plus, Trash2, Printer, ChevronDown, ChevronRight, Upload } from 'lucide-react'

// ── Modal: Create / Edit Course ──────────────────────────
function CourseModal({ onClose, onSave, initial }) {
  const { user } = useAuth()
  const [name, setName] = useState(initial?.name || '')
  const [desc, setDesc] = useState(initial?.description || '')
  async function submit(e) {
    e.preventDefault()
    if (initial?.id) {
      await supabase.from('courses').update({ name, description: desc }).eq('id', initial.id)
    } else {
      await supabase.from('courses').insert({ name, description: desc, teacher_id: user.id })
    }
    onSave()
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>{initial ? 'Edit Class' : 'New Class'}</h2>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>CLASS NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. Biology 101" />
          </div>
          <div className="form-group">
            <label>DESCRIPTION (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Period 3, Room 204" />
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

// ── Modal: Add Single Student ────────────────────────────
function StudentModal({ courseId, existingCardIds, onClose, onSave }) {
  const [name, setName] = useState('')
  const [rut, setRut] = useState('')
  const [cardId, setCardId] = useState('')

  useEffect(() => {
    const used = new Set(existingCardIds)
    for (let i = 1; i <= 50; i++) {
      if (!used.has(i)) { setCardId(String(i)); break }
    }
  }, [existingCardIds])

  async function submit(e) {
    e.preventDefault()
    const num = parseInt(cardId)
    if (isNaN(num) || num < 1 || num > 50) return alert('Card ID must be 1–50')
    if (existingCardIds.includes(num)) return alert(`Card #${num} is already assigned`)
    await supabase.from('students').insert({ course_id: courseId, name, rut: rut || null, card_id: num })
    onSave()
  }
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Student</h2>
        <form onSubmit={submit}>
          <div className="form-group">
            <label>STUDENT NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Full name" />
          </div>
          <div className="form-group">
            <label>RUT (optional)</label>
            <input value={rut} onChange={e => setRut(e.target.value)} placeholder="e.g. 12345678-9" />
          </div>
          <div className="form-group">
            <label>CARD ID (1–50) — must match printed ArUco card</label>
            <input type="number" min="1" max="50" value={cardId} onChange={e => setCardId(e.target.value)} required />
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary">Add Student</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Modal: CSV Import ────────────────────────────────────
function ImportModal({ courseId, existingCardIds, onClose, onSave }) {
  const [preview, setPreview] = useState([])   // parsed rows ready to import
  const [errors, setErrors] = useState([])
  const [nameCol, setNameCol] = useState('')
  const [rutCol, setRutCol] = useState('')
  const [headers, setHeaders] = useState([])
  const [rawRows, setRawRows] = useState([])
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const fileRef = useRef()

  function parseCSV(text) {
    // handle both comma and semicolon delimiters (Excel Spanish default is semicolon)
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return { headers: [], rows: [] }
    const delim = lines[0].includes(';') ? ';' : ','
    const hdrs = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''))
    const rows = lines.slice(1).map(l =>
      l.split(delim).map(c => c.trim().replace(/^"|"$/g, ''))
    ).filter(r => r.some(c => c))  // skip empty lines
    return { headers: hdrs, rows }
  }

  function onFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers: hdrs, rows } = parseCSV(ev.target.result)
      setHeaders(hdrs)
      setRawRows(rows)
      setPreview([])
      setErrors([])
      // auto-detect likely columns
      const nameguess = hdrs.find(h => /nombre|name/i.test(h)) || hdrs[0] || ''
      const rutguess  = hdrs.find(h => /rut|id|dni/i.test(h)) || ''
      setNameCol(nameguess)
      setRutCol(rutguess)
    }
    reader.readAsText(file, 'UTF-8')
  }

  useEffect(() => {
    if (!nameCol || rawRows.length === 0) return
    const nameIdx = headers.indexOf(nameCol)
    const rutIdx  = headers.indexOf(rutCol)
    const used = new Set(existingCardIds)
    const errs = []
    let nextCard = 1

    const rows = rawRows.map((r, i) => {
      const name = r[nameIdx]?.trim()
      const rut  = rutIdx >= 0 ? r[rutIdx]?.trim() : ''
      if (!name) { errs.push(`Row ${i+2}: empty name, skipped`); return null }
      // find next available card
      while (used.has(nextCard) && nextCard <= 50) nextCard++
      if (nextCard > 50) { errs.push(`Row ${i+2}: no card IDs left (max 50)`); return null }
      const card_id = nextCard++
      used.add(card_id)
      return { name, rut: rut || null, card_id }
    }).filter(Boolean)

    setPreview(rows)
    setErrors(errs)
  }, [nameCol, rutCol, rawRows])

  async function doImport() {
    if (preview.length === 0) return
    setImporting(true)
    const toInsert = preview.map(r => ({ ...r, course_id: courseId }))
    await supabase.from('students').insert(toInsert)
    setImporting(false)
    setDone(true)
    setTimeout(() => { onSave() }, 1000)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2>Import Students from CSV</h2>

        {/* Instructions */}
        <div style={{ background:'rgba(232,255,71,.06)', border:'1px solid rgba(232,255,71,.2)', borderRadius:'var(--radius)', padding:'.75rem 1rem', marginBottom:'1rem', fontSize:'.8rem', color:'var(--muted)', lineHeight:1.7 }}>
          <strong style={{ color:'var(--accent)' }}>Accepted formats:</strong> .csv exported from Excel or Google Sheets.<br/>
          Excel Chilean default uses <strong style={{ color:'var(--text)' }}>semicolons (;)</strong> — both are supported.<br/>
          The file needs at least a <strong style={{ color:'var(--text)' }}>name column</strong>. RUT is optional.<br/>
          Card IDs are assigned automatically starting from the next available number.
        </div>

        <div className="form-group">
          <label>SELECT CSV FILE</label>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFile}
            style={{ padding:'.4rem', cursor:'pointer' }} />
        </div>

        {headers.length > 0 && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div className="form-group">
                <label>NAME COLUMN</label>
                <select value={nameCol} onChange={e => setNameCol(e.target.value)}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>RUT COLUMN (optional)</label>
                <select value={rutCol} onChange={e => setRutCol(e.target.value)}>
                  <option value="">— none —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>

            {errors.length > 0 && (
              <div style={{ fontSize:'.75rem', color:'var(--danger)', marginBottom:'.75rem' }}>
                {errors.map((e,i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}

            {preview.length > 0 && (
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ fontSize:'.75rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.08em', marginBottom:'.5rem' }}>
                  PREVIEW — {preview.length} students will be imported
                </div>
                <div style={{ maxHeight: 180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
                  <table className="table">
                    <thead><tr><th>NAME</th><th>RUT</th><th>CARD #</th></tr></thead>
                    <tbody>
                      {preview.slice(0, 20).map((r, i) => (
                        <tr key={i}>
                          <td>{r.name}</td>
                          <td>{r.rut || '—'}</td>
                          <td><span className="badge badge-accent">#{r.card_id}</span></td>
                        </tr>
                      ))}
                      {preview.length > 20 && (
                        <tr><td colSpan={3} style={{ color:'var(--muted)', textAlign:'center' }}>…and {preview.length - 20} more</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {done && <p style={{ color:'var(--success)', fontWeight:700, marginBottom:'.5rem' }}>✓ {preview.length} students imported!</p>}

        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={doImport}
            disabled={preview.length === 0 || importing || done}>
            {importing ? 'Importing…' : `Import ${preview.length} Students`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Print Cards ──────────────────────────────────────────
function printCards(students) {
  const win = window.open('', '_blank')
  const cards = students.map(s => `
    <div class="card">
      <div class="marker-placeholder">#${s.card_id}</div>
      <div class="info">
        <strong>#${s.card_id}</strong>
        <span>${s.name}</span>
        ${s.rut ? `<span class="rut">${s.rut}</span>` : ''}
      </div>
      <div class="answers">
        <span class="a">A ↑</span><span class="b">B →</span>
        <span class="c">C ↓</span><span class="d">D ←</span>
      </div>
      <p class="note">Rotate so your answer points UP</p>
    </div>`).join('')

  win.document.write(`<!DOCTYPE html><html><head><title>Student Cards</title>
  <style>
    body{font-family:sans-serif;background:#fff;margin:0}
    .page{display:flex;flex-wrap:wrap;gap:16px;padding:24px}
    .card{width:180px;border:2px solid #222;border-radius:8px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;page-break-inside:avoid}
    .marker-placeholder{width:160px;height:160px;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:bold;color:#999;border-radius:4px}
    .info{display:flex;flex-direction:column;align-items:center}
    .info strong{font-size:1.4rem}.info span{font-size:.8rem;color:#555}
    .info .rut{font-size:.7rem;color:#888}
    .answers{display:flex;gap:10px;font-weight:bold;font-size:.9rem}
    .a{color:#7bc642}.b{color:#4a9cdf}.c{color:#e07b39}.d{color:#e04040}
    .note{font-size:.65rem;color:#888;text-align:center}
    @media print{body{margin:0}}
  </style></head><body>
  <div class="page">${cards}</div>
  <script>window.onload=()=>window.print()</script>
  </body></html>`)
  win.document.close()
}

// ── Course Card component ────────────────────────────────
function CourseCard({ course, onEdit, onDelete }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [students, setStudents] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => { if (open) loadStudents() }, [open])

  async function loadStudents() {
    const { data } = await supabase.from('students').select('*').eq('course_id', course.id).order('card_id')
    setStudents(data || [])
  }

  async function removeStudent(id) {
    if (!confirm('Remove student?')) return
    await supabase.from('students').delete().eq('id', id)
    loadStudents()
  }

  const cardIds = students.map(s => s.card_id)

  return (
    <div className="card">
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3>{course.name}</h3>
          {course.description && <p style={{ fontSize:'.8rem', color:'var(--muted)', marginTop:'.2rem' }}>{course.description}</p>}
        </div>
        <div style={{ display:'flex', gap:'.5rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onEdit(course)}>Edit</button>
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(course.id)}><Trash2 size={12}/></button>
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
            {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
          </button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop:'1rem' }}>
          <hr className="divider" />
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'.75rem' }}>
            <span style={{ fontSize:'.75rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.08em' }}>
              STUDENTS ({students.length})
            </span>
            <div style={{ display:'flex', gap:'.5rem' }}>
              {students.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => navigate(`/cards?course=${course.id}`)}>
                  <Printer size={12}/> Print Cards
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}>
                <Upload size={12}/> Import CSV
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
                <Plus size={12}/> Add
              </button>
            </div>
          </div>

          {students.length === 0 ? (
            <p style={{ fontSize:'.8rem', color:'var(--muted)', padding:'.5rem 0' }}>
              No students yet — add one or import from CSV.
            </p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>NAME</th><th>RUT</th><th>CARD #</th><th></th></tr>
              </thead>
              <tbody>
                {students.map(s => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td style={{ color:'var(--muted)' }}>{s.rut || '—'}</td>
                    <td><span className="badge badge-accent">#{s.card_id}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => removeStudent(s.id)}>
                        <Trash2 size={11}/>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showAdd && (
        <StudentModal
          courseId={course.id}
          existingCardIds={cardIds}
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); loadStudents() }}
        />
      )}

      {showImport && (
        <ImportModal
          courseId={course.id}
          existingCardIds={cardIds}
          onClose={() => setShowImport(false)}
          onSave={() => { setShowImport(false); loadStudents() }}
        />
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────
export default function CoursesPage() {
  const [courses, setCourses] = useState([])
  const [modal, setModal] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const { data } = await supabase.from('courses').select('*').order('created_at', { ascending: false })
    setCourses(data || [])
  }

  async function deleteCourse(id) {
    if (!confirm('Delete class and all its students?')) return
    await supabase.from('courses').delete().eq('id', id)
    load()
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1><Users size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>Classes</h1>
          <p>Create classes and assign ArUco cards to students.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setModal('new')}>
          <Plus size={14}/> New Class
        </button>
      </div>

      {courses.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🏫</div>
          <h3>No classes yet</h3>
          <p>Create your first class to get started.</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          {courses.map(c => (
            <CourseCard key={c.id} course={c} onEdit={setModal} onDelete={deleteCourse} />
          ))}
        </div>
      )}

      {modal && (
        <CourseModal
          initial={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); load() }}
        />
      )}
    </>
  )
}