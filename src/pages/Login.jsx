import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { setToken } from '../lib/auth.js'

export default function Login() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const API_TOKEN = '1gmbsxqvG6ImxKk5zFyGguUMNXy-guFlAJmSbEo2CeI'
      if (password === 'thomas2026') {
        setToken(API_TOKEN)
        navigate('/dashboard')
      } else {
        setError('Falsches Passwort.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      height: '100dvh',
      background: '#080808',
      backgroundImage: 'radial-gradient(ellipse 80% 50% at 50% -20%, rgba(238,79,0,0.08), transparent)',
    }}>
      {/* Left Panel - Branding (nur Desktop) */}
      <div className="login-branding">
        <div style={{ maxWidth: 440 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, background: '#ee4f00',
            borderRadius: 12, marginBottom: 32
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="#fff"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', marginBottom: 12, lineHeight: 1.1 }}>
            Social Intelligence
          </h1>
          <p style={{ fontSize: 16, color: '#666', lineHeight: 1.6, marginBottom: 40 }}>
            Dein KI-gestütztes Instagram-Analyse Tool.<br/>
            Erkenne Trends, analysiere Competitors,<br/>
            generiere Content auf Knopfdruck.
          </p>
          {[
            ['Automatisches Scraping', 'Profile & Posts werden täglich aktualisiert'],
            ['KI Content Generator', 'Skripte, Karussells, Captions — in Sekunden'],
            ['Trend Analyse', 'Erkenne was bei deiner Zielgruppe viral geht'],
          ].map(([title, desc]) => (
            <div key={title} style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ee4f00', marginTop: 6, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>{title}</div>
                <div style={{ fontSize: 13, color: '#555' }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Login Form Panel */}
      <div className="login-form-panel">
        <div style={{ width: '100%', maxWidth: 340, animation: 'fadeUp 0.3s ease forwards' }}>
          {/* Mobile: Logo oben */}
          <div className="login-mobile-logo">
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, background: '#ee4f00', borderRadius: 10, marginBottom: 20,
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" fill="#fff"/>
              </svg>
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Social Intelligence</div>
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            Willkommen zurück
          </h2>
          <p style={{ fontSize: 14, color: '#555', marginBottom: 32 }}>
            Gib dein Passwort ein um fortzufahren.
          </p>

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#555', display: 'block', marginBottom: 6, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Passwort
              </label>
              <input
                type="password"
                className="input"
                placeholder="••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                style={{ fontSize: 16, padding: '14px 16px' }}
              />
            </div>

            {error && (
              <div style={{
                padding: '10px 14px',
                background: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: 8, fontSize: 13, color: '#ef4444'
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!password || loading}
              style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 600, marginTop: 4, minHeight: 52 }}
            >
              {loading
                ? <span className="spinner" style={{ width: 16, height: 16, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} />
                : 'Einloggen →'
              }
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
