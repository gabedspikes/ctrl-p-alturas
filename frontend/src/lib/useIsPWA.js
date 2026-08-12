import { useEffect, useState } from 'react'

// true cuando la app corre instalada (standalone / pantalla completa), no en
// una pestaña normal del navegador. Combínalo con useIsMobile para el "modo
// escáner": PWA instalada en teléfono → solo escanear + controlar slides.
export function useIsPWA() {
  const check = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true   // iOS Safari (Agregar a inicio)

  const [isPWA, setIsPWA] = useState(check)

  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)')
    const handler = () => setIsPWA(check())
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return isPWA
}