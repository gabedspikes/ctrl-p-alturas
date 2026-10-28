import { useSyncExternalStore } from 'react'

// Modo claro/oscuro de la página. La fuente de verdad es el atributo
// data-theme de <html>, que fija el botón LM/DM del menú (main.jsx).
// Las slides lo usan para su fondo: oscuro en dark mode, blanco en light mode.

export const SLIDE_BG = { dark: '#1a1a20', light: '#ffffff' }

export function getTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
}

function subscribe(onChange) {
  const obs = new MutationObserver(onChange)
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => obs.disconnect()
}

export function useTheme() {
  return useSyncExternalStore(subscribe, getTheme, () => 'dark')
}
