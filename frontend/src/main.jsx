import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { useIsMobile } from './lib/useIsMobile.js'
import { useIsPWA } from './lib/useIsPWA'
import AuthPage from './pages/AuthPage'
import CoursesPage from './pages/CoursesPage'
import PresentationsPage from './pages/PresentationsPage'
import SlideEditorPage from './pages/SlideEditorPage'
import SessionPage from './pages/SessionPage'
import ScanPage from './pages/ScanPage'
import CardGeneratorPage from './pages/CardGeneratorPage'
import './styles.css'
import InstallPrompt from './components/InstallPrompt'
import ScanEntryPage from './pages/ScanEntryPage'

// ── Protected route ───────────────────────────────────────
function Protected({ children }) {
  const { user } = useAuth()
  const location = useLocation()
  if (user === undefined) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      alignItems:'center', justifyContent:'center', color:'var(--muted)' }}>
      Loading…
    </div>
  )
  if (user === null)
    return <Navigate to="/auth" replace state={{ from: location.pathname + location.search }} />
  return children
}

// ── Nav layout ────────────────────────────────────────────
function Layout({ children }) {
  const { user, signOut } = useAuth()
  const [theme, setTheme] = React.useState(
    () => localStorage.getItem('theme') || 'dark'
  )
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">◈ CTRL-ALT</span>
        <div className="nav-links">
          <NavLink to="/" end className={({isActive}) => isActive ? 'active' : ''}>Cursos</NavLink>
          <NavLink to="/presentations" className={({isActive}) => isActive ? 'active' : ''}>Slides</NavLink>
          <NavLink to="/cards" className={({isActive}) => isActive ? 'active' : ''}>Tarjetas</NavLink>
          <NavLink to="/scan" className={({isActive}) => isActive ? 'active' : ''}>Escanear</NavLink>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'.75rem' }}>
          <button className="btn btn-ghost btn-sm"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title="Cambiar modo Oscuro/Modo Claro"
            style={{ fontSize:'1rem', padding:'.3rem .5rem' }}>
            {theme === 'dark' ? 'LM' : 'DM'}
          </button>
          <span style={{ fontSize:'.75rem', color:'var(--muted)', maxWidth:180,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {user?.email}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={signOut} title="Cerrar sesión">
            Cerrar sesión
          </button>
        </div>
      </nav>
      <main className="main">{children}</main>
      <InstallPrompt />
    </div>
  )
}

// ── Router ────────────────────────────────────────────────
function AppRoutes() {
  // PWA instalada en un teléfono → "modo escáner": la app solo escanea y
  // controla las slides. El mismo teléfono en el navegador normal, o el
  // computador (aunque tenga la PWA), siguen viendo la app completa.
  const scannerMode = useIsMobile() && useIsPWA()

  return (
    <AuthProvider>
      {scannerMode ? (
        <Routes>
          <Route path="/auth" element={<AuthGate />} />
          <Route path="/scan" element={<Protected><ScanEntryPage /></Protected>} />
          <Route path="/scan/:sessionId" element={<Protected><ScanPage /></Protected>} />
          <Route path="*" element={<Navigate to="/scan" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/auth" element={<AuthGate />} />
          <Route path="/scan" element={<Protected><Layout><ScanEntryPage /></Layout></Protected>} />
          <Route path="/scan/:sessionId" element={<Protected><ScanPage /></Protected>} />
          <Route path="/" element={<Protected><Layout><CoursesPage /></Layout></Protected>} />
          <Route path="/presentations" element={<Protected><Layout><PresentationsPage /></Layout></Protected>} />
          <Route path="/presentations/:id/edit" element={<Protected><SlideEditorPage /></Protected>} />
          <Route path="/sessions/:id" element={<Protected><SessionPage /></Protected>} />
          <Route path="/cards" element={<Protected><CardGeneratorPage /></Protected>} />
        </Routes>
      )}
    </AuthProvider>
  )
}

function AuthGate() {
  const { user } = useAuth()
  const location = useLocation()
  const dest = location.state?.from || '/'
  if (user) return <Navigate to={dest} replace />
  return <AuthPage />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AppRoutes />
  </BrowserRouter>
)