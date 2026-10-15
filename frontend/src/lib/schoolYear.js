import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { logError } from './errorLog'

// Año escolar vigente, definido por el admin en la tabla school_years
// (función current_school_year()). Ya no depende del reloj del navegador:
// el 1 de enero no se "vacían" los cursos, y el admin decide cuándo pasar
// al año siguiente.
let cached = null
let pending = null

export function fetchSchoolYear() {
  if (cached) return Promise.resolve(cached)
  if (!pending) {
    pending = supabase.rpc('current_school_year').then(({ data, error }) => {
      if (error || !data) {
        if (error) logError('current_school_year', error)
        cached = new Date().getFullYear()       // respaldo si la función no existe aún
      } else {
        cached = Number(data)
      }
      return cached
    })
  }
  return pending
}

export function useSchoolYear() {
  const [year, setYear] = useState(cached)
  useEffect(() => {
    if (!cached) fetchSchoolYear().then(setYear)
  }, [])
  return year   // null mientras carga
}
