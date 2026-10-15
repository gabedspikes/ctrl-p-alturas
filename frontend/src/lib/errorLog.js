import { supabase } from './supabase'

// ── Registro de errores ──────────────────────────────────
// Todo error inesperado (excepciones de React, promesas rechazadas, fallos
// de Supabase) se guarda en la tabla public.client_errors. Durante el
// piloto basta revisar esa tabla cada día para ver qué les falla a los
// profesores, sin que tengan que reportarlo.

const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'
const recent = new Map()          // evita inundar la tabla con el mismo error
const DEDUPE_MS = 60_000
let currentEmail = null

export function setErrorUser(email) { currentEmail = email || null }

export async function logError(context, error, extra = {}) {
  try {
    const message = String(error?.message || error || 'Error desconocido').slice(0, 1000)
    const key = `${context}|${message}`
    const now = Date.now()
    if (recent.has(key) && now - recent.get(key) < DEDUPE_MS) return
    recent.set(key, now)

    console.error(`[${context}]`, error, extra)

    if (!navigator.onLine) return     // sin red no tiene sentido intentarlo
    await supabase.from('client_errors').insert({
      context,
      message,
      page: location.pathname + location.search,
      user_email: currentEmail,
      user_agent: navigator.userAgent.slice(0, 300),
      app_version: APP_VERSION,
      detail: {
        code: error?.code ?? null,
        details: error?.details ?? null,
        hint: error?.hint ?? null,
        stack: error?.stack ? String(error.stack).slice(0, 2000) : null,
        ...extra,
      },
    })
  } catch {
    // El registro de errores nunca debe romper la app
  }
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', e => {
    // Errores de carga de recursos (img rota, etc.) no son de código
    if (!e.error) return
    logError('window.onerror', e.error)
  })
  window.addEventListener('unhandledrejection', e => {
    logError('unhandledrejection', e.reason)
  })
}

// ── Mensajes para el profesor ────────────────────────────
// Traduce errores de red / Postgres / triggers a algo accionable.
export function friendlyError(error, fallback = 'Ocurrió un error. Intenta de nuevo.') {
  if (!error) return fallback
  const msg = String(error.message || error)
  if (!navigator.onLine || /Failed to fetch|NetworkError|network/i.test(msg))
    return 'Sin conexión a internet. Revisa el WiFi e intenta de nuevo.'
  // Mensajes propios de los triggers de la base: ya vienen en español
  if (/RUT inválido|ya está activo en|Solo un profesor asignado|Solo se puede copiar|no tiene alumnos registrados|sesión ya está finalizada|no está inscrito|no pertenece a este test/i.test(msg))
    return msg
  if (error.code === '23505') {
    if (/students_rut_unique/.test(msg)) return 'Ya existe un alumno con ese RUT.'
    if (/generation_students_card_unique/.test(msg)) return 'Esa tarjeta ya está asignada en este curso.'
    if (/generation_students_student_unique/.test(msg)) return 'Ese alumno ya está en este curso.'
    return 'Ese registro ya existe.'
  }
  if (error.code === '23514' && /card_range/.test(msg)) return 'El número de tarjeta debe estar entre 1 y 40.'
  if (error.code === '42501' || /row-level security|permission denied/i.test(msg))
    return 'No tienes permiso para hacer esto. Contacta al administrador.'
  if (error.code === 'PGRST301' || /JWT|expired/i.test(msg))
    return 'Tu sesión expiró. Vuelve a iniciar sesión.'
  return fallback
}
