import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import AuthPage from './pages/AuthPage'
import CoursesPage from './pages/CoursesPage'
import PresentationsPage from './pages/PresentationsPage'
import SlideEditorPage from './pages/SlideEditorPage'
import SessionPage from './pages/SessionPage'
import ScanPage from './pages/ScanPage'
import CardGeneratorPage from './pages/CardGeneratorPage'
import './styles.css'

// ── Protected route — redirects to login if not authenticated ──
function Protected({ children }) {
  const { user } = useAuth()
  if (user === undefined) return (
    <div style={{ minHeight:'100vh', background:'var(--bg)', display:'flex',
      alignItems:'center', justifyContent:'center', color:'var(--muted)' }}>
      Loading…
    </div>
  )
  if (user === null) return <Navigate to="/auth" replace />
  return children
}

function Layout({ children }) {
  const { user, signOut } = useAuth()
  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">◈ CTRL-P-ALT</span>
        <div className="nav-links">
          <NavLink to="/" end className={({isActive}) => isActive ? 'active' : ''}>Classes</NavLink>
          <NavLink to="/presentations" className={({isActive}) => isActive ? 'active' : ''}>Tests</NavLink>
          <NavLink to="/cards" className={({isActive}) => isActive ? 'active' : ''}>Cards</NavLink>
        </div>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'.75rem' }}>
          <span style={{ fontSize:'.75rem', color:'var(--muted)', maxWidth:180,
            overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {user?.email}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  )
}

function App() {
  const { user } = useAuth()

  return (
    <Routes>
      {/* Public routes — no auth needed */}
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route path="/scan/:sessionId" element={<ScanPage />} />

      {/* Protected routes */}
      <Route path="/" element={<Protected><Layout><CoursesPage /></Layout></Protected>} />
      <Route path="/presentations" element={<Protected><Layout><PresentationsPage /></Layout></Protected>} />
      <Route path="/presentations/:id/edit" element={<Protected><SlideEditorPage /></Protected>} />
      <Route path="/sessions/:id" element={<Protected><SessionPage /></Protected>} />
      <Route path="/cards" element={<Protected><CardGeneratorPage /></Protected>} />
    </Routes>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
)