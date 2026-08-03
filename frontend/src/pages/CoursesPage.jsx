import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  Users, Plus, Trash2, Printer, ChevronDown, ChevronRight,
  Upload, UserMinus, UserCheck, AlertCircle
} from 'lucide-react'

const CURRENT_YEAR = new Date().getFullYear()

// ── CSV Import Modal ─────────────────────────────────────
function ImportModal({ generationId, existingCardIds, onClose, onSave }) {
  const [headers, setHeaders]   = useState([])
  const [rawRows, setRawRows]   = useState([])
  const [nameCol, setNameCol]   = useState('')
  const [rutCol, setRutCol]     = useState('')
  const [preview, setPreview]   = useState([])
  const [errors, setErrors]     = useState([])
  const [importing, setImporting] = useState(false)
  const [done, setDone]         = useState(false)

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) return { headers: [], rows: [] }
    const delim = lines[0].includes(';') ? ';' : ','
    const hdrs = lines[0].split(delim).map(h => h.trim().replace(/^"|"$/g, ''))
    const rows = lines.slice(1)
      .map(l => l.split(delim).map(c => c.trim().replace(/^"|"$/g, '')))
      .filter(r => r.some(c => c))
    return { headers: hdrs, rows }
  }

  function onFile(e) {
    const file = e.target.files[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers: hdrs, rows } = parseCSV(ev.target.result)
      setHeaders(hdrs); setRawRows(rows); setPreview([]); setErrors([])
      const nameguess = hdrs.find(h => /nombre|name/i.test(h)) || hdrs[0] || ''
      const rutguess  = hdrs.find(h => /rut|id|dni/i.test(h)) || ''
      setNameCol(nameguess); setRutCol(rutguess)
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
      while (used.has(nextCard) && nextCard <= 50) nextCard++
      if (nextCard > 50) { errs.push(`Row ${i+2}: no card IDs left`); return null }
      const card_id = nextCard++; used.add(card_id)
      return { name, rut: rut || null, card_id }
    }).filter(Boolean)
    setPreview(rows); setErrors(errs)
  }, [nameCol, rutCol, rawRows])

  async function doImport() {
    if (preview.length === 0) return
    setImporting(true)
    // Insert students then link to generation
    for (const row of preview) {
      const { data: student } = await supabase
        .from('students').insert({ name: row.name, rut: row.rut }).select().single()
      if (student) {
        await supabase.from('generation_students').insert({
          generation_id: generationId,
          student_id: student.id,
          card_id: row.card_id,
        })
      }
    }
    setImporting(false); setDone(true)
    setTimeout(() => onSave(), 800)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2>Import Students from CSV</h2>
        <div style={{ background:'rgba(232,255,71,.06)', border:'1px solid rgba(232,255,71,.2)', borderRadius:'var(--radius)', padding:'.75rem 1rem', marginBottom:'1rem', fontSize:'.8rem', color:'var(--muted)', lineHeight:1.7 }}>
          <strong style={{ color:'var(--accent)' }}>Accepted:</strong> .csv from Excel or Google Sheets.
          Chilean Excel uses <strong style={{ color:'var(--text)' }}>semicolons (;)</strong> — both supported.
          Card IDs assigned automatically.
        </div>
        <div className="form-group">
          <label>SELECT CSV FILE</label>
          <input type="file" accept=".csv,.txt" onChange={onFile} style={{ padding:'.4rem', cursor:'pointer' }}/>
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
                  PREVIEW — {preview.length} students
                </div>
                <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
                  <table className="table">
                    <thead><tr><th>NAME</th><th>RUT</th><th>CARD #</th></tr></thead>
                    <tbody>
                      {preview.slice(0,20).map((r,i) => (
                        <tr key={i}>
                          <td>{r.name}</td>
                          <td>{r.rut || '—'}</td>
                          <td><span className="badge badge-accent">#{r.card_id}</span></td>
                        </tr>
                      ))}
                      {preview.length > 20 && <tr><td colSpan={3} style={{ color:'var(--muted)', textAlign:'center' }}>…and {preview.length-20} more</td></tr>}
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
          <button className="btn btn-primary" onClick={doImport} disabled={preview.length===0||importing||done}>
            {importing ? 'Importing…' : `Import ${preview.length} Students`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Add Single Student Modal ─────────────────────────────
function AddStudentModal({ generationId, existingCardIds, onClose, onSave }) {
  const [name, setName] = useState('')
  const [rut, setRut]   = useState('')
  const [cardId, setCardId] = useState('')

  useEffect(() => {
    const used = new Set(existingCardIds)
    for (let i = 1; i <= 50; i++) { if (!used.has(i)) { setCardId(String(i)); break } }
  }, [existingCardIds])

  async function submit(e) {
    e.preventDefault()
    const num = parseInt(cardId)
    if (isNaN(num) || num < 1 || num > 50) return alert('Card ID must be 1–50')
    if (existingCardIds.includes(num)) return alert(`Card #${num} is already assigned`)
    const { data: student } = await supabase
      .from('students').insert({ name, rut: rut || null }).select().single()
    if (student) {
      await supabase.from('generation_students').insert({
        generation_id: generationId,
        student_id: student.id,
        card_id: num,
      })
    }
    onSave()
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Add Student</h2>
        <form onSubmit={submit}>
          <div className="form-group"><label>STUDENT NAME</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Full name"/>
          </div>
          <div className="form-group"><label>RUT (optional)</label>
            <input value={rut} onChange={e => setRut(e.target.value)} placeholder="e.g. 12345678-9"/>
          </div>
          <div className="form-group"><label>CARD ID (1–50)</label>
            <input type="number" min="1" max="50" value={cardId} onChange={e => setCardId(e.target.value)} required/>
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

// ── Print Cards ──────────────────────────────────────────
function printCards(students, courseName) {
  const win = window.open('', '_blank')
  const cards = students.map(s => `
    <div class="card">
      <div class="marker-placeholder">#${s.card_id}</div>
      <div class="info">
        <strong>#${s.card_id}</strong>
        <span>${s.students?.name || s.name}</span>
        ${(s.students?.rut || s.rut) ? `<span class="rut">${s.students?.rut || s.rut}</span>` : ''}
      </div>
      <div class="answers"><span class="a">A ↑</span><span class="b">B →</span><span class="c">C ↓</span><span class="d">D ←</span></div>
      <p class="note">Rotate so your answer points UP</p>
    </div>`).join('')
  win.document.write(`<!DOCTYPE html><html><head><title>Cards — ${courseName}</title>
  <style>
    body{font-family:sans-serif;background:#fff;margin:0}
    .page{display:flex;flex-wrap:wrap;gap:16px;padding:24px}
    .card{width:180px;border:2px solid #222;border-radius:8px;padding:12px;display:flex;flex-direction:column;align-items:center;gap:8px;page-break-inside:avoid}
    .marker-placeholder{width:160px;height:160px;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:bold;color:#999;border-radius:4px}
    .info{display:flex;flex-direction:column;align-items:center}.info strong{font-size:1.4rem}.info span{font-size:.8rem;color:#555}.info .rut{font-size:.7rem;color:#888}
    .answers{display:flex;gap:10px;font-weight:bold;font-size:.9rem}.a{color:#22c55e}.b{color:#3b82f6}.c{color:#f97316}.d{color:#ef4444}
    .note{font-size:.65rem;color:#888;text-align:center}@media print{body{margin:0}}
  </style></head><body><div class="page">${cards}</div>
  <script>window.onload=()=>window.print()</script></body></html>`)
  win.document.close()
}

// ── Course Card ──────────────────────────────────────────
function CourseCard({ course }) {
  const navigate = useNavigate()
  const [open, setOpen]             = useState(false)
  const [generation, setGeneration] = useState(null)
  const [genStudents, setGenStudents] = useState([])
  const [showAdd, setShowAdd]       = useState(false)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => { if (open) loadGeneration() }, [open])

  async function loadGeneration() {
    // Find or create the generation for current year
    let { data: gen } = await supabase
      .from('generations').select('*')
      .eq('course_id', course.id).eq('year', CURRENT_YEAR).single()

    if (!gen) {
      const { data: newGen } = await supabase.from('generations').insert({
        course_id: course.id, year: CURRENT_YEAR, active: true
      }).select().single()
      gen = newGen
    }
    setGeneration(gen)
    if (gen) loadStudents(gen.id)
  }

  async function loadStudents(genId) {
    const { data } = await supabase
      .from('generation_students')
      .select('*, students(id, name, rut)')
      .eq('generation_id', genId)
      .order('card_id')
    setGenStudents(data || [])
  }

  async function toggleActive(gs) {
    await supabase.from('generation_students').update({
      active: !gs.active,
      left_at: !gs.active ? null : new Date().toISOString().split('T')[0]
    }).eq('id', gs.id)
    loadStudents(generation.id)
  }

  async function removeStudent(gs) {
    if (!confirm(`Remove ${gs.students?.name} from this class?`)) return
    await supabase.from('generation_students').delete().eq('id', gs.id)
    loadStudents(generation.id)
  }

  const activeStudents   = genStudents.filter(s => s.active)
  const inactiveStudents = genStudents.filter(s => !s.active)
  const cardIds          = genStudents.map(s => s.card_id)

  return (
    <div className="card">
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3>{course.name}</h3>
          <div style={{ display:'flex', gap:'.35rem', marginTop:'.25rem', flexWrap:'wrap' }}>
            <span className="badge badge-blue">{course.grade_level}</span>
            <span className="badge badge-accent">Sección {course.section}</span>
            <span className="badge" style={{ background:'rgba(255,255,255,.08)', color:'var(--muted)' }}>
              {CURRENT_YEAR}
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(o => !o)}>
          {open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
        </button>
      </div>

      {/* Expanded student roster */}
      {open && (
        <div style={{ marginTop:'1rem' }}>
          <hr className="divider"/>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'.75rem' }}>
            <span style={{ fontSize:'.75rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.08em' }}>
              STUDENTS {CURRENT_YEAR} ({activeStudents.length} active{inactiveStudents.length > 0 ? `, ${inactiveStudents.length} inactive` : ''})
            </span>
            <div style={{ display:'flex', gap:'.4rem', flexWrap:'wrap' }}>
              {genStudents.length > 0 && (
                <button className="btn btn-ghost btn-sm"
                  onClick={() => navigate(`/cards?course=${course.id}`)}>
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

          {genStudents.length === 0 ? (
            <p style={{ fontSize:'.8rem', color:'var(--muted)' }}>No students yet for {CURRENT_YEAR}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>NAME</th><th>RUT</th><th>CARD #</th><th>STATUS</th><th></th></tr>
              </thead>
              <tbody>
                {genStudents.map(gs => (
                  <tr key={gs.id} style={{ opacity: gs.active ? 1 : 0.5 }}>
                    <td style={{ fontFamily:'var(--font)' }}>{gs.students?.name}</td>
                    <td>{gs.students?.rut || '—'}</td>
                    <td><span className="badge badge-accent">#{gs.card_id}</span></td>
                    <td>
                      {gs.active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-danger">Inactive</span>
                      }
                    </td>
                    <td>
                      <div style={{ display:'flex', gap:'.25rem' }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          title={gs.active ? 'Mark inactive (left school)' : 'Reactivate'}
                          onClick={() => toggleActive(gs)}>
                          {gs.active ? <UserMinus size={11}/> : <UserCheck size={11}/>}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => removeStudent(gs)}>
                          <Trash2 size={11}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showAdd && generation && (
        <AddStudentModal
          generationId={generation.id}
          existingCardIds={cardIds}
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); loadStudents(generation.id) }}
        />
      )}
      {showImport && generation && (
        <ImportModal
          generationId={generation.id}
          existingCardIds={cardIds}
          onClose={() => setShowImport(false)}
          onSave={() => { setShowImport(false); loadStudents(generation.id) }}
        />
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────
export default function CoursesPage() {
  const { user } = useAuth()
  const [courses, setCourses]         = useState([])
  const [allCourses, setAllCourses]   = useState([])
  const [filterLevel, setFilterLevel] = useState('')
  const [levels, setLevels]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [myCoursesOnly, setMyCoursesOnly] = useState(true)
  const [myCourseIds, setMyCourseIds] = useState(new Set())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: courseData }, { data: levelData }, { data: tcData }] = await Promise.all([
      supabase.from('courses').select('*').order('grade_level').order('section'),
      supabase.from('course_levels').select('*'),
      supabase.from('teacher_courses')
        .select('course_id').eq('teacher_id', user.id).eq('year', CURRENT_YEAR)
    ])
    setAllCourses(courseData || [])
    setLevels(levelData || [])
    const ids = new Set((tcData || []).map(tc => tc.course_id))
    setMyCourseIds(ids)
    setLoading(false)
  }

  // Filter courses
  const filtered = allCourses.filter(c => {
    if (myCoursesOnly && myCourseIds.size > 0 && !myCourseIds.has(c.id)) return false
    if (filterLevel && c.level_id !== filterLevel) return false
    return true
  })

  return (
    <>
      <div className="page-header">
        <div>
          <h1><Users size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>Classes</h1>
          <p>View your assigned classes and manage student rosters for {CURRENT_YEAR}.</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{
        display:'flex', gap:'.75rem', marginBottom:'1.5rem',
        flexWrap:'wrap', alignItems:'center'
      }}>
        <select
          value={filterLevel}
          onChange={e => setFilterLevel(e.target.value)}
          style={{ minWidth:200 }}
        >
          <option value="">All levels</option>
          {levels.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>

        <label style={{
          display:'flex', alignItems:'center', gap:'.4rem',
          fontSize:'.82rem', color:'var(--muted)', cursor:'pointer', margin:0
        }}>
          <input
            type="checkbox"
            checked={myCoursesOnly}
            onChange={e => setMyCoursesOnly(e.target.checked)}
            style={{ width:'auto' }}
          />
          Show only my assigned classes
        </label>

        {myCourseIds.size === 0 && myCoursesOnly && (
          <div style={{
            display:'flex', alignItems:'center', gap:'.4rem',
            fontSize:'.8rem', color:'var(--danger)',
            background:'rgba(255,71,87,.08)', border:'1px solid rgba(255,71,87,.2)',
            borderRadius:'var(--radius)', padding:'.4rem .75rem'
          }}>
            <AlertCircle size={14}/>
            No courses assigned to you for {CURRENT_YEAR}. Ask your admin to add them in teacher_courses.
          </div>
        )}
      </div>

      {loading ? (
        <p style={{ color:'var(--muted)' }}>Loading classes…</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🏫</div>
          <h3>No classes found</h3>
          <p>{myCoursesOnly ? 'Try unchecking "my assigned classes" to see all.' : 'No classes match the current filter.'}</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          {filtered.map(c => <CourseCard key={c.id} course={c}/>)}
        </div>
      )}
    </>
  )
}