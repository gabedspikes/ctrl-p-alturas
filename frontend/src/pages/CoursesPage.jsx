import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { MAX_CARD } from '../lib/markers'
import { parseRutInput } from '../lib/rut'
import { logError, friendlyError } from '../lib/errorLog'
import { useSchoolYear } from '../lib/schoolYear'
import {
  Users, Plus, Trash2, Printer, ChevronDown, ChevronRight,
  Upload, UserMinus, UserCheck, AlertCircle
} from 'lucide-react'


// ── CSV helpers ──────────────────────────────────────────
// El Excel chileno guarda CSV en Windows-1252 (no UTF-8): leído como UTF-8,
// "Peña" queda "Pe�a". Se intenta UTF-8 estricto y si falla, Windows-1252.
function decodeFile(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

// Parser con soporte de comillas: "Pérez, Juan" no se parte en dos columnas
function parseCSV(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], cell = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') inQuotes = false
      else cell += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === delim) { row.push(cell.trim()); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell.trim()); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row) }
  const clean = rows.filter(r => r.some(c => c))
  if (clean.length < 2) return { headers: [], rows: [] }
  return { headers: clean[0], rows: clean.slice(1) }
}

// Busca alumnos existentes por RUT (en bloques, por el largo de la URL)
async function findStudentsByRut(ruts) {
  const map = new Map()
  for (let i = 0; i < ruts.length; i += 100) {
    const chunk = ruts.slice(i, i + 100)
    const { data, error } = await supabase.from('students').select('id, name, rut').in('rut', chunk)
    if (error) throw error
    for (const s of data || []) map.set(s.rut, s)
  }
  return map
}

// Inscribe filas {name, rut} en la generación. Reutiliza al alumno si su
// RUT ya existe (así Juanito de 5° en 2025 es el MISMO registro en 6° 2026),
// salta a los que ya están en el curso y asigna tarjetas libres 1..MAX_CARD.
// La inscripción se hace en un solo insert: o entran todos o ninguno.
async function enrollRows(generationId, rows, fixedCard = null) {
  const { data: current, error: curErr } = await supabase
    .from('generation_students').select('student_id, card_id').eq('generation_id', generationId)
  if (curErr) throw curErr
  const enrolled = new Set((current || []).map(r => r.student_id))
  const usedCards = new Set((current || []).map(r => r.card_id))

  const existing = await findStudentsByRut(rows.filter(r => r.rut).map(r => r.rut))

  const newStudents = []
  const links = []
  let skipped = 0
  let nextCard = 1
  for (const r of rows) {
    let student = r.rut ? existing.get(r.rut) : null
    if (!student) {
      student = { id: crypto.randomUUID(), name: r.name, rut: r.rut }
      newStudents.push(student)
    }
    if (enrolled.has(student.id)) { skipped++; continue }
    let card = fixedCard
    if (card == null) {
      while (usedCards.has(nextCard) && nextCard <= MAX_CARD) nextCard++
      if (nextCard > MAX_CARD) throw new Error(`No quedan tarjetas libres (máximo ${MAX_CARD} por curso).`)
      card = nextCard
    }
    usedCards.add(card)
    enrolled.add(student.id)
    links.push({ generation_id: generationId, student_id: student.id, card_id: card })
  }

  if (newStudents.length) {
    const { error } = await supabase.from('students').insert(newStudents)
    if (error) throw error
  }
  if (links.length) {
    const { error } = await supabase.from('generation_students').insert(links)
    if (error) throw error
  }
  return { added: links.length, reused: rows.length - newStudents.length - skipped, skipped }
}

// ── CSV Import Modal ─────────────────────────────────────
function ImportModal({ generationId, existingCardIds, onClose, onSave }) {
  const [headers, setHeaders]   = useState([])
  const [rawRows, setRawRows]   = useState([])
  const [nameCol, setNameCol]   = useState('')
  const [rutCol, setRutCol]     = useState('')
  const [preview, setPreview]   = useState([])
  const [errors, setErrors]     = useState([])
  const [warnings, setWarnings] = useState([])
  const [importing, setImporting] = useState(false)
  const [result, setResult]     = useState(null)
  const [fatal, setFatal]       = useState('')

  function onFile(e) {
    const file = e.target.files[0]; if (!file) return
    setFatal(''); setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers: hdrs, rows } = parseCSV(decodeFile(ev.target.result))
      if (hdrs.length === 0) { setFatal('El archivo está vacío o no tiene encabezados.'); return }
      setHeaders(hdrs); setRawRows(rows); setPreview([]); setErrors([])
      const nameguess = hdrs.find(h => /nombre|name/i.test(h)) || hdrs[0] || ''
      const rutguess  = hdrs.find(h => /\brut\b|run|dni/i.test(h)) || ''
      setNameCol(nameguess); setRutCol(rutguess)
    }
    reader.onerror = () => setFatal('No se pudo leer el archivo.')
    reader.readAsArrayBuffer(file)
  }

  useEffect(() => {
    if (!nameCol || rawRows.length === 0) return
    const nameIdx = headers.indexOf(nameCol)
    const rutIdx  = rutCol ? headers.indexOf(rutCol) : -1
    const errs = [], warns = []
    const seenRuts = new Map()
    const free = MAX_CARD - new Set(existingCardIds).size
    const rows = []
    rawRows.forEach((r, i) => {
      const line = i + 2
      const name = (r[nameIdx] || '').replace(/\s+/g, ' ').trim()
      if (!name) { errs.push(`Fila ${line}: nombre vacío, se omite`); return }
      let rut = null
      if (rutIdx >= 0 && r[rutIdx]) {
        const parsed = parseRutInput(r[rutIdx])
        if (parsed.error) { errs.push(`Fila ${line} (${name}): ${parsed.error}, se omite`); return }
        rut = parsed.rut
        if (seenRuts.has(rut)) { errs.push(`Fila ${line} (${name}): RUT repetido con la fila ${seenRuts.get(rut)}, se omite`); return }
        seenRuts.set(rut, line)
      } else {
        warns.push(`${name}: sin RUT — sus respuestas no se archivarán en Plickers`)
      }
      rows.push({ name, rut })
    })
    if (rows.length > free) errs.push(`Hay ${rows.length} alumnos pero solo ${free} tarjetas libres (máximo ${MAX_CARD}). Los que excedan no se importarán.`)
    setPreview(rows); setErrors(errs); setWarnings(warns)
  }, [nameCol, rutCol, rawRows])

  async function doImport() {
    if (preview.length === 0) return
    setImporting(true); setFatal('')
    try {
      const res = await enrollRows(generationId, preview)
      setResult(res)
      setTimeout(() => onSave(), 1500)
    } catch (err) {
      logError('import-csv', err, { rows: preview.length })
      setFatal(friendlyError(err, err.message || 'No se pudo importar. No se inscribió a nadie; intenta de nuevo.'))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <h2>Importar alumnos desde CSV</h2>
        <div style={{ background:'rgba(232,255,71,.06)', border:'1px solid rgba(232,255,71,.2)', borderRadius:'var(--radius)', padding:'.75rem 1rem', marginBottom:'1rem', fontSize:'.8rem', color:'var(--muted)', lineHeight:1.7 }}>
          <strong style={{ color:'var(--accent)' }}>Acepta:</strong> .csv de Excel o Google Sheets (con <strong style={{ color:'var(--text)' }}>;</strong> o <strong style={{ color:'var(--text)' }}>,</strong>).
          Si un alumno ya existe (mismo RUT) se reutiliza su ficha, no se duplica. Las tarjetas se asignan solas (1–{MAX_CARD}).
        </div>
        <div className="form-group">
          <label>ARCHIVO CSV</label>
          <input type="file" accept=".csv,.txt" onChange={onFile} style={{ padding:'.4rem', cursor:'pointer' }}/>
        </div>
        {headers.length > 0 && (
          <>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
              <div className="form-group">
                <label>COLUMNA DE NOMBRE</label>
                <select value={nameCol} onChange={e => setNameCol(e.target.value)}>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>COLUMNA DE RUT</label>
                <select value={rutCol} onChange={e => setRutCol(e.target.value)}>
                  <option value="">— sin RUT —</option>
                  {headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            </div>
            {errors.length > 0 && (
              <div style={{ fontSize:'.75rem', color:'var(--danger)', marginBottom:'.75rem', maxHeight:110, overflowY:'auto' }}>
                {errors.map((e,i) => <div key={i}>⚠ {e}</div>)}
              </div>
            )}
            {warnings.length > 0 && (
              <details style={{ fontSize:'.75rem', color:'var(--muted)', marginBottom:'.75rem' }}>
                <summary>{warnings.length} alumno(s) sin RUT</summary>
                {warnings.map((w,i) => <div key={i}>• {w}</div>)}
              </details>
            )}
            {preview.length > 0 && (
              <div style={{ marginBottom:'1rem' }}>
                <div style={{ fontSize:'.75rem', color:'var(--muted)', fontWeight:700, letterSpacing:'.08em', marginBottom:'.5rem' }}>
                  VISTA PREVIA — {preview.length} alumnos
                </div>
                <div style={{ maxHeight:180, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)' }}>
                  <table className="table">
                    <thead><tr><th>NOMBRE</th><th>RUT</th></tr></thead>
                    <tbody>
                      {preview.slice(0,20).map((r,i) => (
                        <tr key={i}><td>{r.name}</td><td>{r.rut || '—'}</td></tr>
                      ))}
                      {preview.length > 20 && <tr><td colSpan={2} style={{ color:'var(--muted)', textAlign:'center' }}>…y {preview.length-20} más</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
        {fatal && <p style={{ color:'var(--danger)', fontSize:'.85rem', marginBottom:'.5rem' }}>{fatal}</p>}
        {result && (
          <p style={{ color:'var(--success)', fontWeight:700, marginBottom:'.5rem' }}>
            ✓ {result.added} inscritos
            {result.reused > 0 && ` (${result.reused} ya existían y se reutilizó su ficha)`}
            {result.skipped > 0 && ` · ${result.skipped} ya estaban en el curso`}
          </p>
        )}
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn-primary" onClick={doImport} disabled={preview.length===0||importing||!!result}>
            {importing ? 'Importando…' : `Importar ${preview.length} alumnos`}
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
  const [err, setErr]   = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const used = new Set(existingCardIds)
    for (let i = 1; i <= MAX_CARD; i++) { if (!used.has(i)) { setCardId(String(i)); break } }
  }, [existingCardIds])

  async function submit(e) {
    e.preventDefault()
    setErr('')
    const num = parseInt(cardId)
    if (isNaN(num) || num < 1 || num > MAX_CARD) return setErr(`La tarjeta debe estar entre 1 y ${MAX_CARD}.`)
    if (existingCardIds.includes(num)) return setErr(`La tarjeta #${num} ya está asignada en este curso.`)
    const parsed = parseRutInput(rut)
    if (parsed.error) return setErr(parsed.error)
    const cleanName = name.replace(/\s+/g, ' ').trim()
    if (!cleanName) return setErr('Escribe el nombre.')

    setSaving(true)
    try {
      const res = await enrollRows(generationId, [{ name: cleanName, rut: parsed.rut }], num)
      if (res.skipped) { setErr('Ese alumno (mismo RUT) ya está en este curso.'); return }
      onSave()
    } catch (error) {
      logError('add-student', error)
      setErr(friendlyError(error, error.message || 'No se pudo agregar. Intenta de nuevo.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h2>Agregar Estudiante</h2>
        <form onSubmit={submit}>
          <div className="form-group"><label>NOMBRE</label>
            <input value={name} onChange={e => setName(e.target.value)} required placeholder="Nombre completo"/>
          </div>
          <div className="form-group"><label>RUT (necesario para archivar en Plickers)</label>
            <input value={rut} onChange={e => setRut(e.target.value)}
              onBlur={() => { const p = parseRutInput(rut); if (p.rut) setRut(p.rut) }}
              placeholder="12.345.678-9"/>
          </div>
          <div className="form-group"><label>ID DE TARJETA (1–{MAX_CARD})</label>
            <input type="number" min="1" max={MAX_CARD} value={cardId} onChange={e => setCardId(e.target.value)} required/>
          </div>
          {err && <p style={{ color:'var(--danger)', fontSize:'.82rem', marginBottom:'.5rem' }}>{err}</p>}
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Guardando…' : 'Agregar Estudiante'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Promote from previous year ───────────────────────────
// Cambio de año: la ficha de cada alumno (nombre + RUT) se cargó una vez y
// se reutiliza. Aquí se elige el curso del año anterior, se revisa la lista
// y se desmarca a quien no corresponde (repite, cambia de sección). Los que
// ya están activos en otro curso de este año aparecen bloqueados.
function PromoteBox({ course, year, courses, onDone }) {
  const [fromCourse, setFromCourse] = useState('')
  const [keepCards, setKeepCards]   = useState(true)
  const [rows, setRows]       = useState(null)      // vista previa
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg]   = useState('')

  useEffect(() => {
    setRows(null); setMsg('')
    if (!fromCourse) return
    let cancelled = false
    supabase.rpc('preview_promotion', {
      p_from_course: fromCourse, p_from_year: year - 1,
      p_to_course: course.id, p_to_year: year,
    }).then(({ data, error }) => {
      if (cancelled) return
      if (error) {
        logError('preview_promotion', error, { fromCourse, to: course.id, year })
        setMsg(friendlyError(error, error.message)); return
      }
      setRows(data || [])
      setSelected(new Set((data || []).filter(r => r.estado === 'listo').map(r => r.student_id)))
    })
    return () => { cancelled = true }
  }, [fromCourse])

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  async function promote() {
    if (!selected.size) return
    const src = courses.find(c => c.id === fromCourse)
    if (!confirm(`¿Inscribir ${selected.size} alumno(s) de ${src?.name} ${year - 1} en ${course.name} ${year}?`)) return
    setBusy(true); setMsg('')
    const { data, error } = await supabase.rpc('promote_generation', {
      p_from_course: fromCourse, p_from_year: year - 1,
      p_to_course: course.id, p_to_year: year,
      p_keep_cards: keepCards, p_student_ids: [...selected],
    })
    setBusy(false)
    if (error) {
      logError('promote_generation', error, { fromCourse, to: course.id, year })
      setMsg(friendlyError(error, error.message))
      return
    }
    const r = Array.isArray(data) ? data[0] : data
    setMsg(`✓ ${r?.copiados ?? 0} alumnos inscritos${r?.omitidos ? ` · ${r.omitidos} omitidos (ya estaban en otro curso o sin tarjetas libres)` : ''}.`)
    onDone()
  }

  return (
    <div style={{ border:'1px dashed var(--border)', borderRadius:'var(--radius)', padding:'.75rem', marginBottom:'.75rem', fontSize:'.8rem' }}>
      <div style={{ marginBottom:'.5rem', color:'var(--muted)' }}>
        <strong style={{ color:'var(--text)' }}>¿Alumnos que vienen del año pasado?</strong> Elige su curso de {year - 1}, revisa la lista y desmarca a quien no corresponde (repite o cambia de sección).
      </div>
      <div style={{ display:'flex', gap:'.5rem', flexWrap:'wrap', alignItems:'center' }}>
        <select value={fromCourse} onChange={e => setFromCourse(e.target.value)} style={{ minWidth:180, flex:1 }}>
          <option value="">Curso de origen ({year - 1})…</option>
          {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label style={{ display:'flex', alignItems:'center', gap:'.3rem', margin:0, color:'var(--muted)' }}>
          <input type="checkbox" checked={keepCards} onChange={e => setKeepCards(e.target.checked)} style={{ width:'auto' }}/>
          Mantener números de tarjeta
        </label>
      </div>

      {rows && rows.length === 0 && (
        <div style={{ marginTop:'.5rem', color:'var(--muted)' }}>Ese curso no tiene alumnos activos en {year - 1}.</div>
      )}
      {rows && rows.length > 0 && (
        <>
          <div style={{ maxHeight:220, overflowY:'auto', border:'1px solid var(--border)', borderRadius:'var(--radius)', marginTop:'.6rem' }}>
            <table className="table">
              <thead><tr><th style={{ width:28 }}></th><th>NOMBRE</th><th>RUT</th><th>TARJETA</th><th></th></tr></thead>
              <tbody>
                {rows.map(r => {
                  const ok = r.estado === 'listo'
                  return (
                    <tr key={r.student_id} style={{ opacity: ok ? 1 : .5 }}>
                      <td><input type="checkbox" style={{ width:'auto' }} disabled={!ok}
                        checked={selected.has(r.student_id)} onChange={() => toggle(r.student_id)}/></td>
                      <td>{r.name}</td>
                      <td>{r.rut || '—'}</td>
                      <td>#{r.card_id}</td>
                      <td style={{ color:'var(--muted)' }}>{ok ? '' : r.estado}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'.5rem' }}>
            <button className="btn btn-primary btn-sm" disabled={!selected.size || busy} onClick={promote}>
              {busy ? 'Inscribiendo…' : `Inscribir ${selected.size} alumno(s)`}
            </button>
          </div>
        </>
      )}
      {msg && <div style={{ marginTop:'.5rem', color: msg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{msg}</div>}
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
function CourseCard({ course, year: CURRENT_YEAR, courses }) {
  const navigate = useNavigate()
  const [open, setOpen]             = useState(false)
  const [generation, setGeneration] = useState(null)
  const [genStudents, setGenStudents] = useState([])
  const [showAdd, setShowAdd]       = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [loadErr, setLoadErr]       = useState('')
  const [showPromote, setShowPromote] = useState(false)

  useEffect(() => { if (open) loadGeneration() }, [open])

  async function loadGeneration() {
    setLoadErr('')
    // Busca la generación del año escolar vigente; si no existe la crea.
    // upsert + ignoreDuplicates: si dos profes abren el curso a la vez no se
    // crean dos generaciones (la base además lo impide con un índice único).
    let { data: gen, error } = await supabase
      .from('generations').select('*')
      .eq('course_id', course.id).eq('year', CURRENT_YEAR).maybeSingle()

    if (!error && !gen) {
      const ins = await supabase.from('generations')
        .upsert({ course_id: course.id, year: CURRENT_YEAR, active: true },
                { onConflict: 'course_id,year', ignoreDuplicates: true })
      if (ins.error) error = ins.error
      else {
        const again = await supabase.from('generations').select('*')
          .eq('course_id', course.id).eq('year', CURRENT_YEAR).maybeSingle()
        gen = again.data; error = again.error
      }
    }
    if (error) {
      logError('loadGeneration', error, { course: course.id })
      setLoadErr(friendlyError(error, 'No se pudo cargar el curso.'))
      return
    }
    setGeneration(gen)
    if (gen) loadStudents(gen.id)
  }

  async function loadStudents(genId) {
    const { data, error } = await supabase
      .from('generation_students')
      .select('*, students(id, name, rut)')
      .eq('generation_id', genId)
      .order('card_id')
    if (error) {
      logError('loadStudents', error)
      setLoadErr(friendlyError(error, 'No se pudo cargar la lista de alumnos.'))
      return
    }
    setGenStudents(data || [])
  }

  async function toggleActive(gs) {
    const { error } = await supabase.from('generation_students').update({
      active: !gs.active,
      left_at: !gs.active ? null : new Date().toISOString().split('T')[0]
    }).eq('id', gs.id)
    if (error) { logError('toggleActive', error); alert(friendlyError(error)) }
    loadStudents(generation.id)
  }

  async function removeStudent(gs) {
    if (!confirm(`¿Quitar a ${gs.students?.name} de este curso? Si ya respondió evaluaciones, mejor márcalo como inactivo.`)) return
    const { error } = await supabase.from('generation_students').delete().eq('id', gs.id)
    if (error) { logError('removeStudent', error); alert(friendlyError(error)) }
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
                  <Printer size={12}/> Imprimir Tarjetas
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => setShowImport(true)}>
                <Upload size={12}/> Importar CSV
              </button>
              {genStudents.length > 0 && (
                <button className="btn btn-ghost btn-sm" onClick={() => setShowPromote(v => !v)}>
                  <UserCheck size={12}/> {showPromote ? 'Ocultar' : `Traer de ${CURRENT_YEAR - 1}`}
                </button>
              )}
              <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>
                <Plus size={12}/> Agregar Estudiante
              </button>
            </div>
          </div>

          {loadErr && <p style={{ fontSize:'.8rem', color:'var(--danger)', marginBottom:'.5rem' }}>{loadErr} <button className="btn btn-ghost btn-sm" onClick={loadGeneration}>Reintentar</button></p>}
          {generation && (genStudents.length === 0 || showPromote) && (
            <PromoteBox course={course} year={CURRENT_YEAR} courses={courses}
              onDone={() => loadStudents(generation.id)} />
          )}
          {genStudents.length === 0 ? (
            <p style={{ fontSize:'.8rem', color:'var(--muted)' }}>Aún no hay alumnos para {CURRENT_YEAR}.</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>NOMBRE</th><th>RUT</th><th>TARJETA #</th><th>STATUS</th><th></th></tr>
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
  const CURRENT_YEAR = useSchoolYear()
  const [courses, setCourses]         = useState([])
  const [allCourses, setAllCourses]   = useState([])
  const [filterLevel, setFilterLevel] = useState('')
  const [levels, setLevels]           = useState([])
  const [loading, setLoading]         = useState(true)
  const [myCoursesOnly, setMyCoursesOnly] = useState(true)
  const [myCourseIds, setMyCourseIds] = useState(new Set())

  const [loadErr, setLoadErr] = useState('')
  useEffect(() => { if (CURRENT_YEAR) load() }, [CURRENT_YEAR])

  async function load() {
    setLoading(true); setLoadErr('')
    const [{ data: courseData, error: e1 }, { data: levelData, error: e2 }, { data: tcData, error: e3 }] = await Promise.all([
      supabase.from('courses').select('*').order('grade_level').order('section'),
      supabase.from('course_levels').select('*'),
      supabase.from('teacher_courses')
        .select('course_id').eq('teacher_id', user.id).eq('year', CURRENT_YEAR)
    ])
    const firstErr = e1 || e2 || e3
    if (firstErr) { logError('courses.load', firstErr); setLoadErr(friendlyError(firstErr, 'No se pudieron cargar los cursos.')) }
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
          <h1><Users size={20} style={{ verticalAlign:'middle', marginRight:'.4rem' }}/>Cursos</h1>
          <p>Ver cursos para {CURRENT_YEAR}.</p>
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
          <option value="">Todos los cursos</option>
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
          Mostrar solo mis clases asignadas
        </label>

        {myCourseIds.size === 0 && myCoursesOnly && (
          <div style={{
            display:'flex', alignItems:'center', gap:'.4rem',
            fontSize:'.8rem', color:'var(--danger)',
            background:'rgba(255,71,87,.08)', border:'1px solid rgba(255,71,87,.2)',
            borderRadius:'var(--radius)', padding:'.4rem .75rem'
          }}>
            <AlertCircle size={14}/>
            No tienes cursos asignados para {CURRENT_YEAR}. Pregunta a tu administrador que te agregue en teacher_courses.
          </div>
        )}
      </div>

      {loadErr && (
        <p style={{ color:'var(--danger)', fontSize:'.85rem', marginBottom:'1rem' }}>
          {loadErr} <button className="btn btn-ghost btn-sm" onClick={load}>Reintentar</button>
        </p>
      )}
      {loading || !CURRENT_YEAR ? (
        <p style={{ color:'var(--muted)' }}>Cargando Cursos…</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">🏫</div>
          <h3>No se han encontrado cursos</h3>
          <p>{myCoursesOnly ? 'Try unchecking "my assigned classes" to see all.' : 'No classes match the current filter.'}</p>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:'1rem' }}>
          {filtered.map(c => <CourseCard key={c.id} course={c} year={CURRENT_YEAR} courses={allCourses}/>)}
        </div>
      )}
    </>
  )
}