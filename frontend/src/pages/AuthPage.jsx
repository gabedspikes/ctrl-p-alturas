import React, { useState } from 'react'
import { useAuth } from '../lib/auth'

export default function AuthPage() {
  const { signIn, signUp } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(''); setMessage('')

    if (mode === 'signup' && password !== confirm) {
      setError('Passwords do not match.'); return
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.'); return
    }

    setLoading(true)
    if (mode === 'login') {
      const err = await signIn(email, password)
      if (err) setError(err.message)
    } else {
      const err = await signUp(email, password)
      if (err) setError(err.message)
      else setMessage('Account created! Check your email to confirm, then log in.')
    }
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
            ◈ CTRL-P-ALT
          </div>
          <p style={{ color: 'var(--muted)', fontSize: '.85rem', marginTop: '.4rem' }}>
            Sistema de respuestas interactivas para clases
          </p>
        </div>

        {/* Card */}
        <div className="card" style={{ padding: '2rem' }}>
          <h2 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create a teacher account'}
          </h2>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>EMAIL</label>
              <input
                type="email" value={email} required
                onChange={e => setEmail(e.target.value)}
                placeholder="teacher@school.cl"
                autoComplete="email"
              />
            </div>

            <div className="form-group">
              <label>CONTRASEÑA</label>
              <input
                type="password" value={password} required
                onChange={e => setPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            {mode === 'signup' && (
              <div className="form-group">
                <label>CONFIRMAR CONTRASEÑA</label>
                <input
                  type="password" value={confirm} required
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password"
                  autoComplete="new-password"
                />
              </div>
            )}

            {error && (
              <div style={{
                background: 'rgba(255,71,87,.1)', border: '1px solid rgba(255,71,87,.3)',
                borderRadius: 'var(--radius)', padding: '.6rem .75rem',
                color: 'var(--danger)', fontSize: '.82rem', marginBottom: '1rem'
              }}>
                {error}
              </div>
            )}

            {message && (
              <div style={{
                background: 'rgba(46,213,115,.1)', border: '1px solid rgba(46,213,115,.3)',
                borderRadius: 'var(--radius)', padding: '.6rem .75rem',
                color: 'var(--success)', fontSize: '.82rem', marginBottom: '1rem'
              }}>
                {message}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{ width: '100%', justifyContent: 'center', padding: '.65rem' }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div style={{
            marginTop: '1.25rem', textAlign: 'center',
            fontSize: '.82rem', color: 'var(--muted)'
          }}>
            {mode === 'login' ? (
              <>
                ¿Aun no estas registrado?{' '}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ border: 'none', color: 'var(--accent)', padding: '0 .25rem' }}
                  onClick={() => { setMode('signup'); setError(''); setMessage('') }}
                >
                  Unirse
                </button>
              </>
            ) : (
              <>
                ¿Ya tienes una cuenta?{' '}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ border: 'none', color: 'var(--accent)', padding: '0 .25rem' }}
                  onClick={() => { setMode('login'); setError(''); setMessage('') }}
                >
                  Entrar
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
