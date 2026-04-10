import { useLocation, useNavigate } from 'react-router-dom'
import { clearToken } from '../lib/auth.js'

const NAV_ITEMS = [
  {
    path: '/brain',
    label: 'Brain',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C8 2 5 5 5 8.5c0 1.5.5 2.8 1.3 3.8C5.5 13.2 5 14.5 5 16c0 3 2.5 5 5 5h4c2.5 0 5-2 5-5 0-1.5-.5-2.8-1.3-3.7.8-1 1.3-2.3 1.3-3.8C19 5 16 2 12 2z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/>
        <path d="M9 9c0-1.1.9-2 2-2M12 7v1M8.5 13.5C9.5 14 10.7 14 12 14s2.5 0 3.5-.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M12 14v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    path: '/dm-center',
    label: 'DM Center',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
        <circle cx="9" cy="10" r="1" fill="currentColor"/>
        <circle cx="12" cy="10" r="1" fill="currentColor"/>
        <circle cx="15" cy="10" r="1" fill="currentColor"/>
      </svg>
    ),
  },
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" opacity=".9"/>
        <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
        <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
        <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.8"/>
      </svg>
    ),
  },
  {
    path: '/konkurrenten',
    label: 'Profile & Competitors',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M3 19c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <circle cx="17" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" opacity=".6"/>
        <path d="M17 13c1.5 0 4 .7 4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity=".6"/>
      </svg>
    ),
  },
  {
    path: '/wissensdatenbank',
    label: 'Wissensdatenbank',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="5" rx="8" ry="2.5" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M4 5v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M4 10v5c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-5" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M4 15v3c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-3" stroke="currentColor" strokeWidth="1.8"/>
      </svg>
    ),
  },
  {
    path: '/generator',
    label: 'Content Generator',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"
          fill="currentColor" opacity=".9"/>
      </svg>
    ),
  },
  {
    path: '/import',
    label: 'Reel Import',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
        <path d="M12 3v12M8 11l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    ),
  },
]

export default function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  function logout() {
    clearToken()
    navigate('/login')
  }

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"
              fill="#fff"/>
          </svg>
        </div>
        <div>
          <div className="sidebar-logo-text">Social Intel</div>
          <div className="sidebar-logo-sub">by Thomas Fitness</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Navigation</div>
        {NAV_ITEMS.map(item => {
          const active = location.pathname === item.path
          return (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`nav-item ${active ? 'active' : ''}`}
            >
              {item.icon}
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-avatar">T</div>
          <div>
            <div className="sidebar-user-name">Thomas</div>
          </div>
        </div>
        <button
          onClick={logout}
          className="nav-item btn-ghost"
          style={{ width: '100%', marginTop: 2, color: 'var(--text4)', fontSize: 12 }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Abmelden
        </button>
      </div>
    </aside>
  )
}
