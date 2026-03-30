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
    const { data } = await supabase
      .from('instagram_posts')
      .select('*')
      .eq('source', 'custom')
      .order('scraped_at', { ascending: false })
      .limit(20)
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
      // Wenn Video → Transkription läuft im Hintergrund, wir pollen
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
      const { data } = await supabase
        .from('instagram_posts')
        .select('transcript')
        .eq('id', postId)
        .maybeSingle()
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
    <div className="screen">
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>Reel Import</h1>
        <p style={{ fontSize: 13, color: '#505050', marginTop: 4 }}>
          Füge beliebige Instagram Reels oder Posts zur Wissensdatenbank hinzu
        </p>
      </div>

      <div className="screen-content">
        {/* Import Form */}
        <div className="card" style={{ marginBottom: 24 }}>
          <p className="section-label">Instagram Link einfügen</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              className="input"
              placeholder="https://www.instagram.com/reel/..."
              value={url}
              onChange={e => { setUrl(e.target.value); setError('') }}
              onPaste={handlePaste}
            />

            {error && (
              <div style={{
                padding: '10px 14px', background: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8,
                fontSize: 13, color: '#f87171'
              }}>
                {error}
              </div>
            )}

            <button
              onClick={handleImport}
              disabled={!url.trim() || importing}
              className="btn btn-primary"
              style={{ width: '100%' }}
            >
              {importing ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  Wird importiert…
                </span>
              ) : 'Importieren & Transkribieren'}
            </button>
          </div>

          {/* Was passiert */}
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              ['1', 'Link scrapen', 'Apify holt Caption, Likes, Views, Video-URL'],
              ['2', 'Transkribieren', 'AssemblyAI wandelt gesprochenen Text in Text um'],
              ['3', 'In DB speichern', 'Landet in der Wissensdatenbank für Content-Generierung'],
            ].map(([num, title, desc]) => (
              <div key={num} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%', background: 'rgba(238,79,0,0.15)',
                  color: '#ee4f00', fontSize: 11, fontWeight: 700, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>{num}</div>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0' }}>{title}</p>
                  <p style={{ fontSize: 12, color: '#606060' }}>{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Import Result */}
        {importedPost && (
          <div style={{ marginBottom: 24, animation: 'fadeUp 0.3s ease forwards' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <p className="section-label" style={{ marginBottom: 0, color: '#4ade80' }}>
                ✓ Importiert
              </p>
              {transcribing && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#60a5fa' }}>
                  <span className="spinner" style={{ width: 12, height: 12, borderColor: '#1a3a5c', borderTopColor: '#60a5fa' }} />
                  Transkribiert…
                </span>
              )}
            </div>
            <PostCard post={importedPost} />
          </div>
        )}

        {/* Recent Imports */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <p className="section-label" style={{ marginBottom: 0 }}>Zuletzt importiert</p>
            <span style={{ fontSize: 12, color: '#505050', fontFamily: 'var(--font-mono)' }}>
              {recentImports.length} Posts
            </span>
          </div>

          {loading ? (
            <div className="empty-state"><div className="spinner" style={{ width: 22, height: 22 }} /></div>
          ) : recentImports.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 24px' }}>
              <div className="empty-state-icon">🎬</div>
              <p className="empty-state-title">Noch keine Imports</p>
              <p className="empty-state-text">Füge deinen ersten Instagram Reel Link ein um zu starten.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
