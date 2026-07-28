import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import CoursesPage from './pages/CoursesPage'
import PresentationsPage from './pages/PresentationsPage'
import SlideEditorPage from './pages/SlideEditorPage'
import SessionPage from './pages/SessionPage'
import ScanPage from './pages/ScanPage'
import './styles.css'

function Layout({ children }) {
  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo">◈ PLICKERS</span>
        <div className="nav-links">
          <NavLink to="/" end className={({isActive}) => isActive ? 'active' : ''}>Classes</NavLink>
          <NavLink to="/presentations" className={({isActive}) => isActive ? 'active' : ''}>Tests</NavLink>
        </div>
      </nav>
      <main className="main">{children}</main>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Layout><CoursesPage /></Layout>} />
      <Route path="/presentations" element={<Layout><PresentationsPage /></Layout>} />
      <Route path="/presentations/:id/edit" element={<SlideEditorPage />} />
      <Route path="/sessions/:id" element={<SessionPage />} />
      <Route path="/scan/:sessionId" element={<ScanPage />} />
    </Routes>
  </BrowserRouter>
)