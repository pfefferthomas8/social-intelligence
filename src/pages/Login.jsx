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
      const expected = import.meta.env.VITE_DASHBOARD_TOKEN
      if (password === expected) {
        setToken(password)
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
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100dvh',
      padding: '24px', background: '#0a0a0a'
    }}>
      <div style={{ width: '100%', maxWidth: 380, animation: 'fadeUp 0.3s ease forwards' }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 56, height: 56, background: '#ee4f00',
            borderRadius: 16, marginBottom: 16
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L15 9H22L16.5 13.5L18.5 21L12 17L5.5 21L7.5 13.5L2 9H9L12 2Z" fill="#fff" strokeLinejoin="round"/>
            </svg>
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 6 }}>
            Social Intelligence
          </h1>
          <p style={{ fontSize: 14, color: '#606060' }}>
            Dein KI-gestütztes Instagram-Team
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: '#606060', fontWeight: 600, display: 'block', marginBottom: 8 }}>
              PASSWORT
            </label>
            <input
              type="password"
              className="input"
              placeholder="••••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              autoFocus
            />
          </div>

          {error && (
            <div style={{
              padding: '10px 14px', background: 'rgba(248,113,113,0.1)',
              border: '1px solid rgba(248,113,113,0.3)',
              borderRadius: 8, fontSize: 13, color: '#f87171'
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!password || loading}
            style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 600 }}
          >
            {loading ? <span className="spinner" style={{ width: 18, height: 18 }} /> : 'Einloggen'}
          </button>
        </form>
      </div>
    </div>
  )
}
