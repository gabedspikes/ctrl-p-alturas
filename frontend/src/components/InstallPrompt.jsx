import React, { useEffect, useState } from 'react'

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState(null)
  const [show, setShow] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true)
      return
    }

    // Capture the install prompt
    const handler = e => {
      e.preventDefault()
      setPrompt(e)
      setShow(true)
    }
    window.addEventListener('beforeinstallprompt', handler)

    // Listen for successful install
    window.addEventListener('appinstalled', () => {
      setInstalled(true)
      setShow(false)
    })

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  async function install() {
    if (!prompt) return
    prompt.prompt()
    const { outcome } = await prompt.userChoice
    if (outcome === 'accepted') setShow(false)
  }

  if (installed || !show) return null

  return (
    <div style={{
      position: 'fixed', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--surface)', border: '1px solid var(--accent)',
      borderRadius: 10, padding: '1rem 1.25rem', zIndex: 1000,
      display: 'flex', alignItems: 'center', gap: '1rem',
      boxShadow: '0 8px 32px rgba(0,0,0,.4)',
      maxWidth: 420, width: 'calc(100% - 2rem)',
    }}>
      <span style={{ fontSize: '1.5rem' }}>📲</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '.9rem' }}>Install CTRL-P-ALT</div>
        <div style={{ fontSize: '.78rem', color: 'var(--muted)', marginTop: '.1rem' }}>
          Install on your phone for faster access and camera scanning
        </div>
      </div>
      <div style={{ display: 'flex', gap: '.5rem', flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setShow(false)}>Later</button>
        <button className="btn btn-primary btn-sm" onClick={install}>Install</button>
      </div>
    </div>
  )
}