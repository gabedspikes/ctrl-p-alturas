import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { logError, friendlyError } from '../lib/errorLog'

// Pantalla del teléfono: el profe teclea el código de 6 dígitos que muestra
// el computador y entra directo al escáner de esa sesión. Reemplaza al QR.
export default function ScanEntryPage() {
  const navigate = useNavigate()
  const [code, setCode]     = useState('')
  const [error, setError]   = useState('')
  const [loading, setLoad]  = useState(false)

  async function submit(e) {
    e?.preventDefault()
    const clean = code.replace(/\D/g, '')
    if (clean.length !== 6) { setError('El código tiene 6 dígitos.'); return }
    setError(''); setLoad(true)

    const { data, error: qErr } = await supabase
      .from('sessions')
      .select('id')
      .eq('scan_code', clean)
      .eq('status', 'active')
      .maybeSingle()

    setLoad(false)
    if (qErr) { logError('scanEntry', qErr); setError(friendlyError(qErr, 'Error de conexión. Intenta de nuevo.')); return }
    if (!data?.id) { setError('Código no válido, o la sesión está pausada o finalizada. Revisa el código en el computador.'); return }
    navigate(`/scan/${data.id}`)
  }

  return (
    <div style={{ maxWidth: 360, margin: '2rem auto', padding: '0 1rem', textAlign: 'center' }}>
      <h1 style={{ marginBottom: '.25rem' }}>Escanear tarjetas</h1>
      <p style={{ color: 'var(--muted)', fontSize: '.9rem', marginBottom: '1.5rem' }}>
        Ingresa el código de 6 dígitos que aparece en la pantalla de la sesión.
      </p>

      <form onSubmit={submit}>
        <input
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          placeholder="000000"
          autoFocus
          style={{
            width: '100%', textAlign: 'center', letterSpacing: '.5rem',
            fontSize: '2rem', fontFamily: 'monospace', padding: '.75rem',
            background: 'var(--bg)', color: 'var(--text)',
            border: '2px solid var(--border)', borderRadius: 10, marginBottom: '1rem',
          }}
        />
        {error && (
          <p style={{ color: 'var(--danger)', fontSize: '.85rem', marginBottom: '1rem' }}>{error}</p>
        )}
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading || code.length !== 6}
          style={{ width: '100%', fontSize: '1rem', padding: '.8rem' }}
        >
          {loading ? 'Buscando…' : 'Abrir escáner'}
        </button>
      </form>

      {/* Calibrar y probar la cámara antes de la clase, sin necesitar una sesión */}
      <div style={{ marginTop: '2rem', paddingTop: '1.25rem', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => navigate('/scan/camara')}
          style={{ width: '100%', fontSize: '.95rem', padding: '.7rem' }}
        >
          📷 Configurar cámara
        </button>
        <p style={{ color: 'var(--muted)', fontSize: '.78rem', marginTop: '.5rem' }}>
          Calibra la cámara y prueba la lectura de tarjetas sin iniciar una sesión.
        </p>
      </div>
    </div>
  )
}