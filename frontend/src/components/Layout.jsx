import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import './Layout.css'

const TECHNICAL_PROFILES = ['technician', 'supervisor', 'super-admin']
const SUPERVISOR_PROFILES = ['supervisor', 'super-admin']

function isTechnical(profile) {
  return profile && TECHNICAL_PROFILES.includes(String(profile).toLowerCase())
}

function isSupervisor(profile) {
  return profile && SUPERVISOR_PROFILES.includes(String(profile).toLowerCase())
}

export default function Layout({ children }) {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const isActive = (path) => location.pathname === path

  return (
    <div className="layout">
      <header className="topbar">
        <button
          className="topbar-toggle"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Abrir menu"
        >
          <i className="fa-solid fa-bars"></i>
        </button>
        <div className="topbar-title-area">
          <h1 className="topbar-title">Portal</h1>
          <span className="topbar-subtitle">{user?.profile || 'Sem perfil'}</span>
        </div>
      </header>

      <aside className={`sidebar ${sidebarOpen ? 'show' : ''}`} id="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <i className="fa-solid fa-chart-column"></i>
          </div>
          <div className="brand-text">
            <strong>Portal</strong>
            <span>Integração GLPI</span>
          </div>
        </div>

        <div className="sidebar-user">
          <div className="user-avatar">
            {user?.picture ? (
              <img src={user.picture} alt="Usuário" />
            ) : (
              <i className="fa-solid fa-user" style={{ fontSize: 36, color: '#0b5ed7' }}></i>
            )}
          </div>
          <div className="user-info">
            <h2>{user?.name || user?.username}</h2>
            <p>{user?.profile || 'Sem perfil'}</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <p className="nav-section-title">Navegação</p>

          <Link
            to="/"
            className={`nav-link ${isActive('/') ? 'active' : ''}`}
            onClick={() => setSidebarOpen(false)}
          >
            <i className="fa-solid fa-house"></i>
            <span>Home</span>
          </Link>

          {isTechnical(user?.profile) && (
            <Link
              to="/portal/desempenho"
              className={`nav-link ${isActive('/portal/desempenho') ? 'active' : ''}`}
              onClick={() => setSidebarOpen(false)}
            >
              <i className="fa-solid fa-chart-line"></i>
              <span>Desempenho</span>
            </Link>
          )}

          {isSupervisor(user?.profile) && (
            <>
              <Link
                to="/portal/colaboradores"
                className={`nav-link ${location.pathname.startsWith('/portal/colaboradores') ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <i className="fa-solid fa-users"></i>
                <span>Colaboradores</span>
              </Link>
              <Link
                to="/relatorios"
                className={`nav-link ${isActive('/relatorios') ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <i className="fa-solid fa-file-lines"></i>
                <span>Relatórios</span>
              </Link>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-link nav-link-logout" onClick={handleLogout}>
            <i className="fa-solid fa-right-from-bracket"></i>
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <div
        className={`sidebar-overlay ${sidebarOpen ? 'show' : ''}`}
        onClick={() => setSidebarOpen(false)}
      />

      <main className="main-content">
        <div className="page-container">{children}</div>
      </main>
    </div>
  )
}
