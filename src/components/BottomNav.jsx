import { useLocation, useNavigate } from 'react-router-dom'

const tabs = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="8" height="8" rx="2" fill={active ? '#ee4f00' : 'none'} stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <rect x="13" y="3" width="8" height="8" rx="2" fill="none" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <rect x="3" y="13" width="8" height="8" rx="2" fill="none" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <rect x="13" y="13" width="8" height="8" rx="2" fill="none" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
      </svg>
    )
  },
  {
    path: '/konkurrenten',
    label: 'Profile',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <circle cx="9" cy="8" r="3" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <circle cx="17" cy="8" r="3" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M17 14c1.7 0 4 .8 4 3" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    )
  },
  {
    path: '/wissensdatenbank',
    label: 'Datenbank',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="6" rx="8" ry="3" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
        <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8"/>
      </svg>
    )
  },
  {
    path: '/generator',
    label: 'Generator',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L15 9H22L16.5 13.5L18.5 21L12 17L5.5 21L7.5 13.5L2 9H9L12 2Z"
          fill={active ? '#ee4f00' : 'none'}
          stroke={active ? '#ee4f00' : '#505050'}
          strokeWidth="1.8" strokeLinejoin="round"/>
      </svg>
    )
  },
  {
    path: '/import',
    label: 'Import',
    icon: (active) => (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2v13M8 11l4 4 4-4" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M3 18v1a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1" stroke={active ? '#ee4f00' : '#505050'} strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
    )
  }
]

export default function BottomNav() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav style={{
      position: 'fixed',
      bottom: 0, left: 0, right: 0,
      zIndex: 100,
      background: 'rgba(8,8,8,0.97)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderTop: '1px solid #191919',
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      display: 'flex',
    }}>
      {tabs.map(tab => {
        const active = location.pathname === tab.path
        return (
          <button
            key={tab.path}
            onClick={() => navigate(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              padding: '9px 0 7px',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              transition: 'opacity 0.15s ease',
            }}
          >
            {tab.icon(active)}
            <span style={{
              fontSize: 9,
              fontFamily: 'var(--font)',
              fontWeight: 600,
              color: active ? '#ee4f00' : '#404040',
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}>
              {tab.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
