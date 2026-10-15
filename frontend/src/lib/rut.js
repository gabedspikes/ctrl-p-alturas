// RUT chileno: limpieza, validación (módulo 11) y formato canónico
// "12.345.678-9" — el mismo que usa Plickers y que exige el pipeline para
// cruzar alumnos. La base de datos aplica la misma regla (trigger), esto es
// para avisar al profesor ANTES de enviar.

export function cleanRut(rut) {
  return String(rut ?? '').toUpperCase().replace(/[^0-9K]/g, '')
}

export function isValidRut(rut) {
  const c = cleanRut(rut)
  if (c.length < 2) return false
  const body = c.slice(0, -1)
  const dv = c.slice(-1)
  if (!/^\d+$/.test(body)) return false
  let sum = 0, mult = 2
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * mult
    mult = mult === 7 ? 2 : mult + 1
  }
  const r = 11 - (sum % 11)
  const expected = r === 11 ? '0' : r === 10 ? 'K' : String(r)
  return expected === dv
}

export function formatRut(rut) {
  const c = cleanRut(rut)
  if (c.length < 2) return ''
  const body = c.slice(0, -1).replace(/^0+/, '')
  const dv = c.slice(-1)
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}

// Para formularios: devuelve { rut: string|null, error: string|null }
export function parseRutInput(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return { rut: null, error: null }
  if (!isValidRut(t)) return { rut: null, error: `RUT inválido: "${t}" (revisa el dígito verificador)` }
  return { rut: formatRut(t), error: null }
}
