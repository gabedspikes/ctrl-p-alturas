import React, { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function AuthPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const err = await signIn(email, password)
    if (err) setError('Correo o contraseña incorrectos.')
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font)', padding: '1.5rem'
    }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--accent)', letterSpacing: '.1em' }}>
            ◈ CTRL-ALT
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginTop: '.4rem' }}>
            Sistema de respuestas interactivas para clases
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '2rem' }}>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>
            Iniciar sesión
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>EMAIL</label>
              <input
                type="email" value={email} required
                onChange={e => setEmail(e.target.value)}
                placeholder="profesor@colegio.cl"
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label>CONTRASEÑA</label>
              <input
                type="password" value={password} required
                onChange={e => setPassword(e.target.value)}
                placeholder="Tu contraseña"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div style={{
                background: 'rgba(255,71,87,.1)', border: '1px solid rgba(255,71,87,.3)',
                borderRadius: 'var(--radius)', padding: '.6rem .75rem',
                color: 'var(--danger)', fontSize: '.82rem', marginBottom: '1rem'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '.65rem' }}
            >
              {loading ? 'Ingresando…' : 'Iniciar sesión'}
            </button>
          </form>

          <div style={{
            marginTop: '1.25rem', textAlign: 'center',
            fontSize: '.78rem', color: 'var(--muted)', lineHeight: 1.5
          }}>
            ¿Problemas para ingresar? Contacta al administrador del sistema.
          </div>
        </div>
      </div>
    </div>
  )
}