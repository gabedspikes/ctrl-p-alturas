// Nombre corto para listas: iniciales de los nombres + primer apellido.
//   "Tomás Baltazar Toledo Stuardo" → "T. B. Toledo"
//   "Antonia Sofía Aedo Dunn"       → "A. S. Aedo"
//   "Juan Pérez"                    → "J. Pérez"
//   "María José de la Fuente Soto"  → "M. J. de la Fuente"
// Supone el formato que usa el colegio: nombres primero y luego los dos
// apellidos. Las partículas (de, del, la, san…) se unen al apellido que sigue.
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'san', 'santa', 'y', 'van', 'von', 'da', 'di', 'mc'])

function groupSurnameParticles(words) {
  // Une "de la Fuente" en una sola pieza para que cuente como un apellido
  const out = []
  let pending = []
  for (const w of words) {
    if (PARTICLES.has(w.toLowerCase())) { pending.push(w); continue }
    out.push([...pending, w].join(' '))
    pending = []
  }
  if (pending.length) out.push(pending.join(' '))
  return out
}

export function shortName(full) {
  const words = String(full || '').trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return words[0] || ''
  const parts = groupSurnameParticles(words)
  if (parts.length <= 1) return parts[0]
  // 2 piezas: nombre + apellido. 3 o más: los dos últimos son apellidos.
  const surnameIdx = parts.length === 2 ? 1 : parts.length - 2
  // "de los Ángeles" → inicial de la palabra principal (Á), no de la partícula
  const initials = parts.slice(0, surnameIdx).map(p => p.split(' ').pop()[0].toUpperCase() + '.')
  return [...initials, parts[surnameIdx]].join(' ')
}