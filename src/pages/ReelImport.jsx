import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'
import PostCard from '../components/PostCard.jsx'

function isValidInstagramUrl(url) {
  return /instagram\.com\/(reel|p|tv)\//.test(url)
}

export default function ReelImport() {
  const [url, setUrl] = useState('')
  const [importing, setImporting] = useState(false)
  const [importedPost, setImportedPost] = useState(null)
  const [recentImports, setRecentImports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [transcribing, setTranscribing] = useState(false)

  useEffect(() => { loadRecentImports() }, [])

  async function loadRecentImports() {
    setLoading(true)
    const { data } = await supabase.from('instagram_posts').select('*').eq('source', 'custom').order('scraped_at', { ascending: false }).limit(20)
    setRecentImports(data || [])
    setLoading(false)
  }

  async function handleImport() {
    if (!url.trim()) return
    if (!isValidInstagramUrl(url)) {
      setError('Kein gültiger Instagram Reel/Post Link. Format: instagram.com/reel/...')
      return
    }
    setError('')
    setImporting(true)
    setImportedPost(null)
    try {
      const result = await apiFetch('import-reel', {
        method: 'POST',
        body: JSON.stringify({ url: url.trim() })
      })
      setImportedPost(result.post)
      setUrl('')
      if (result.post?.video_url && !result.post?.transcript) {
        setTranscribing(true)
        pollForTranscript(result.post.id)
      }
      await loadRecentImports()
    } catch (e) {
      setError('Import fehlgeschlagen: ' + e.message)
    } finally {
      setImporting(false)
    }
  }

  async function pollForTranscript(postId) {
    let attempts = 0
    const interval = setInterval(async () => {
      attempts++
      const { data } = await supabase.from('instagram_posts').select('transcript').eq('id', postId).maybeSingle()
      if (data?.transcript || attempts > 30) {
        clearInterval(interval)
        setTranscribing(false)
        if (data?.transcript) {
          setImportedPost(prev => prev ? { ...prev, transcript: data.transcript } : prev)
          await loadRecentImports()
        }
      }
    }, 6000)
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text')
    if (isValidInstagramUrl(pasted)) {
      setUrl(pasted)
      setError('')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Reel Import</div>
          <div className="page-subtitle">Instagram Reels zur Wissensdatenbank hinzufügen</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          {recentImports.length} importiert
        </span>
      </div>

      {/* Two Column Layout */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '400px 1fr' }}>
        {/* Left: Import form + pipeline */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px' }}>
          <div style={{ marginBottom: 20 }}>
            <div className="section-label">Instagram Link</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                className="input"
                placeholder="https://www.instagram.com/reel/..."
                value={url}
                onChange={e => { setUrl(e.target.value); setError('') }}
                onPaste={handlePaste}
              />

              {error && (
                <div style={{
                  padding: '10px 14px', background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8,
                  fontSize: 13, color: 'var(--red)'
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleImport}
                disabled={!url.trim() || importing}
                className="btn btn-primary"
                style={{ width: '100%', padding: '11px' }}
              >
                {importing ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="spinner" style={{ width: 15, height: 15, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                    Wird importiert…
                  </span>
                ) : 'Importieren & Transkribieren'}
              </button>
            </div>
          </div>

          {/* Pipeline Steps */}
          <div style={{ marginBottom: 24 }}>
            <div className="section-label">So funktioniert es</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['1', 'Link scrapen', 'Apify holt Caption, Likes, Views, Video-URL', '#ee4f00'],
                ['2', 'Transkribieren', 'AssemblyAI wandelt gesprochenen Text um', '#3b82f6'],
                ['3', 'In DB speichern', 'Landet in der Wissensdatenbank', '#22c55e'],
              ].map(([num, title, desc, color]) => (
                <div key={num} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: `${color}18`, color, fontSize: 11, fontWeight: 700,
                    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: `1px solid ${color}30`
                  }}>{num}</div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)' }}>{title}</p>
                    <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Import Result */}
          {importedPost && (
            <div className="fade-in">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Importiert
                </span>
                {transcribing && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--blue)' }}>
                    <span className="spinner" style={{ width: 12, height: 12, borderColor: '#1a3a5c', borderTopColor: 'var(--blue)' }} />
                    Transkribiert…
                  </span>
                )}
              </div>
              <PostCard post={importedPost} />
            </div>
          )}
        </div>

        {/* Right: Recent Imports */}
        <div style={{ overflowY: 'auto', padding: '24px' }}>
          <div className="section-header" style={{ marginBottom: 16 }}>
            <span className="section-title">Zuletzt importiert</span>
            <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
              {recentImports.length} Posts
            </span>
          </div>

          {loading ? (
            <div className="empty-state"><div className="spinner" style={{ width: 22, height: 22 }} /></div>
          ) : recentImports.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🎬</div>
              <p className="empty-state-title">Noch keine Imports</p>
              <p className="empty-state-text">Füge deinen ersten Instagram Reel Link ein um zu starten.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {recentImports.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
