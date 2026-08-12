import { useEffect, useState } from 'react'

// Devuelve true en pantallas de teléfono. Se usa para mostrar el prompt de
// instalación y la pantalla de escaneo SOLO en celular. Ajusta el ancho si
// quieres incluir/excluir tablets.
export function useIsMobile(query = '(max-width: 820px)') {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const handler = e => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', handler)
  }, [query])

  return isMobile
}