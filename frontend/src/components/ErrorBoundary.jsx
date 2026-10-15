import React from 'react'
import { logError } from '../lib/errorLog'

// Si un componente explota al renderizar, en vez de pantalla en blanco se
// muestra esto, y el error queda registrado en client_errors.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    logError('react-render', error, { componentStack: info?.componentStack?.slice(0, 2000) })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg, #0d0d0f)', color: 'var(--text, #e8e8ec)', padding: '1.5rem',
      }}>
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ marginBottom: '.75rem' }}>Algo salió mal</h2>
          <p style={{ color: 'var(--muted, #888)', fontSize: '.9rem', lineHeight: 1.6, marginBottom: '1.25rem' }}>
            El error quedó registrado. Tus datos guardados no se perdieron.
            Recarga la página para continuar.
          </p>
          <button className="btn btn-primary" onClick={() => location.reload()}>
            Recargar
          </button>
        </div>
      </div>
    )
  }
}
