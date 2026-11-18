import { supabase } from './supabase'

// ── Estados de una sesión ────────────────────────────────
//   active   → en curso: el teléfono escanea y registra respuestas.
//   paused   → el profesor la detuvo antes de la última slide para retomarla
//              otro día. NO se archiva: el pipeline a Plickers solo copia
//              sesiones con status = 'finished', así que una pausada espera
//              sin cambios hasta que se retome y se finalice.
//   finished → terminada. El pipeline la archiva en su siguiente ejecución,
//              con la fecha de finished_at (el día en que se terminó).

export async function finishSessionRow(sessionId) {
  return supabase.from('sessions')
    .update({ status: 'finished', finished_at: new Date().toISOString() })
    .eq('id', sessionId)
}

export async function pauseSessionRow(sessionId) {
  return supabase.from('sessions')
    .update({ status: 'paused', finished_at: null })
    .eq('id', sessionId)
}

// Retomar: vuelve a 'active'. El código de 6 dígitos solo es único entre
// sesiones activas; si mientras estaba pausada otra sesión tomó el mismo
// código, se le asigna uno nuevo y se reintenta.
export async function resumeSessionRow(sessionId) {
  let res = await supabase.from('sessions').update({ status: 'active' }).eq('id', sessionId)
  for (let attempt = 0; attempt < 3 && res.error?.code === '23505' && /scan_code/.test(res.error.message); attempt++) {
    const code = String(Math.floor(Math.random() * 1e6)).padStart(6, '0')
    res = await supabase.from('sessions').update({ status: 'active', scan_code: code }).eq('id', sessionId)
  }
  return res
}
