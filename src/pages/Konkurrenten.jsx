import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'
import PostCard from '../components/PostCard.jsx'

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Nie'
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  if (d > 0) return `vor ${d}d`
  if (h > 0) return `vor ${h}h`
  return 'gerade eben'
}

export default function Konkurrenten() {
  const [competitors, setCompetitors] = useState([])
  const [ownProfile, setOwnProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [addingUsername, setAddingUsername] = useState('')
  const [addingNiche, setAddingNiche] = useState('')
  const [ownUsername, setOwnUsername] = useState('')
  const [adding, setAdding] = useState(false)
  const [scraping, setScraping] = useState({}) // { [id]: true/false }
  const [selectedCompetitor, setSelectedCompetitor] = useState(null)
  const [competitorPosts, setCompetitorPosts] = useState([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [activeJobs, setActiveJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('si_active_jobs') || '{}') } catch { return {} }
  })
  const [tab, setTab] = useState('competitors') // 'competitors' | 'own'

  useEffect(() => {
    loadData()
    // Scraping-State aus aktiven Jobs wiederherstellen
    const savedJobs = JSON.parse(localStorage.getItem('si_active_jobs') || '{}')
    if (Object.keys(savedJobs).length > 0) {
      const restoredScraping = {}
      Object.entries(savedJobs).forEach(([jobId, key]) => { restoredScraping[key] = jobId })
      setScraping(restoredScraping)
    }
  }, [])

  // Jobs in localStorage speichern damit Tab-Wechsel sie nicht verliert
  useEffect(() => {
    localStorage.setItem('si_active_jobs', JSON.stringify(activeJobs))
  }, [activeJobs])

  // Poll active scrape jobs
  useEffect(() => {
    if (Object.keys(activeJobs).length === 0) return
    const interval = setInterval(pollJobs, 4000)
    return () => clearInterval(interval)
  }, [activeJobs])

  async function loadData() {
    setLoading(true)
    const [{ data: comps }, { data: own }] = await Promise.all([
      supabase.from('competitor_profiles').select('*').order('followers_count', { ascending: false }),
      supabase.from('own_profile').select('*').limit(1).maybeSingle()
    ])
    setCompetitors(comps || [])
    setOwnProfile(own)
    if (own) setOwnUsername(own.username || '')
    setLoading(false)
  }

  async function pollJobs() {
    const jobIds = Object.keys(activeJobs)
    for (const jobId of jobIds) {
      const { data } = await supabase
        .from('scrape_jobs')
        .select('*')
        .eq('id', jobId)
        .maybeSingle()
      if (data?.status === 'done' || data?.status === 'error') {
        setActiveJobs(prev => { const n = { ...prev }; delete n[jobId]; return n })
        setScraping(prev => {
          const n = { ...prev }
          Object.keys(n).forEach(k => { if (n[k] === jobId) delete n[k] })
          return n
        })
        await loadData()
      }
    }
  }

  async function addCompetitor() {
    if (!addingUsername.trim()) return
    setAdding(true)
    try {
      const username = addingUsername.trim().replace('@', '').toLowerCase()
      // In DB anlegen
      const { data: existing } = await supabase
        .from('competitor_profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle()

      let competitorId
      if (existing) {
        competitorId = existing.id
      } else {
        const { data: newComp, error } = await supabase
          .from('competitor_profiles')
          .insert({ username, niche: addingNiche || null })
          .select('id')
          .single()
        if (error) throw error
        competitorId = newComp.id
      }

      // Sofort Scrapen starten
      await startScrape(username, 'competitor', competitorId)
      setAddingUsername('')
      setAddingNiche('')
      setShowAddForm(false)
      await loadData()
    } catch (e) {
      alert('Fehler: ' + e.message)
    } finally {
      setAdding(false)
    }
  }

  async function saveOwnProfile() {
    if (!ownUsername.trim()) return
    const username = ownUsername.trim().replace('@', '').toLowerCase()
    if (ownProfile) {
      await supabase.from('own_profile').update({ username }).eq('id', ownProfile.id)
    } else {
      await supabase.from('own_profile').insert({ username })
    }
    await startScrape(username, 'own')
    await loadData()
  }

  async function startScrape(username, source, competitorId) {
    const key = competitorId || 'own'
    setScraping(prev => ({ ...prev, [key]: 'pending' }))
    try {
      const result = await apiFetch('scrape-profile', {
        method: 'POST',
        body: JSON.stringify({ username, source, competitor_id: competitorId })
      })
      if (result.job_id) {
        const newJobs = { ...JSON.parse(localStorage.getItem('si_active_jobs') || '{}'), [result.job_id]: key }
        localStorage.setItem('si_active_jobs', JSON.stringify(newJobs))
        setActiveJobs(newJobs)
        setScraping(prev => ({ ...prev, [key]: result.job_id }))
      }
    } catch (e) {
      alert('Scrape fehlgeschlagen: ' + e.message)
      setScraping(prev => { const n = { ...prev }; delete n[key]; return n })
    }
  }

  async function toggleActive(competitor) {
    await supabase
      .from('competitor_profiles')
      .update({ is_active: !competitor.is_active })
      .eq('id', competitor.id)
    setCompetitors(prev => prev.map(c => c.id === competitor.id ? { ...c, is_active: !c.is_active } : c))
  }

  async function deleteCompetitor(id) {
    if (!confirm('Wirklich löschen? Alle Posts dieses Competitors werden ebenfalls gelöscht.')) return
    await supabase.from('instagram_posts').delete().eq('competitor_id', id)
    await supabase.from('competitor_profiles').delete().eq('id', id)
    setCompetitors(prev => prev.filter(c => c.id !== id))
    if (selectedCompetitor?.id === id) setSelectedCompetitor(null)
  }

  async function openPosts(competitor) {
    setSelectedCompetitor(competitor)
    setPostsLoading(true)
    const { data } = await supabase
      .from('instagram_posts')
      .select('*')
      .eq('competitor_id', competitor.id)
      .order('views_count', { ascending: false })
      .limit(20)
    setCompetitorPosts(data || [])
    setPostsLoading(false)
  }

  const isScrapingNow = (id) => !!scraping[id || 'own']

  return (
    <div className="screen">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Profile & Competitors</h1>
          <button onClick={() => setShowAddForm(true)} className="btn btn-primary btn-sm">
            + Hinzufügen
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
          {[['competitors', 'Competitors'], ['own', 'Eigenes Profil']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                padding: '7px 16px', borderRadius: 100, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                background: tab === key ? '#ee4f00' : '#1a1a1a',
                color: tab === key ? '#fff' : '#707070',
                transition: 'all 0.15s'
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="screen-content">
        {/* Add Form Modal */}
        {showAddForm && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'flex-end', padding: '0'
          }}>
            <div style={{
              background: '#141414', borderRadius: '20px 20px 0 0',
              border: '1px solid #2a2a2a', padding: '24px', width: '100%',
              paddingBottom: 'calc(24px + env(safe-area-inset-bottom))',
              animation: 'fadeUp 0.2s ease forwards'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <h2 style={{ fontSize: 18, fontWeight: 700 }}>Competitor hinzufügen</h2>
                <button onClick={() => setShowAddForm(false)} className="btn-ghost btn btn-sm">✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <input
                  className="input"
                  placeholder="@username"
                  value={addingUsername}
                  onChange={e => setAddingUsername(e.target.value)}
                  autoFocus
                />
                <input
                  className="input"
                  placeholder="Nische (z.B. Fitness Coach, Bodybuilding)"
                  value={addingNiche}
                  onChange={e => setAddingNiche(e.target.value)}
                />
                <button
                  onClick={addCompetitor}
                  disabled={!addingUsername.trim() || adding}
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                >
                  {adding ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Hinzufügen & Scrapen'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Posts Modal */}
        {selectedCompetitor && (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: '#0a0a0a', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{
              padding: '16px', paddingTop: 'calc(var(--safe-top) + 16px)',
              borderBottom: '1px solid #1e1e1e', display: 'flex', alignItems: 'center', gap: 12
            }}>
              <button onClick={() => setSelectedCompetitor(null)} className="btn btn-sm btn-ghost">
                ← Zurück
              </button>
              <div>
                <p style={{ fontSize: 15, fontWeight: 700 }}>@{selectedCompetitor.username}</p>
                <p style={{ fontSize: 12, color: '#505050' }}>{formatNumber(selectedCompetitor.followers_count)} Follower</p>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {postsLoading ? (
                <div className="empty-state"><div className="spinner" style={{ width: 24, height: 24 }} /></div>
              ) : competitorPosts.length === 0 ? (
                <div className="empty-state">
                  <p className="empty-state-title">Keine Posts</p>
                  <p className="empty-state-text">Scrap diesen Competitor um seine Posts zu sehen.</p>
                </div>
              ) : (
                competitorPosts.map(post => (
                  <PostCard key={post.id} post={{ ...post, competitor_username: selectedCompetitor.username }} />
                ))
              )}
            </div>
          </div>
        )}

        {loading ? (
          <div className="empty-state"><div className="spinner" style={{ width: 24, height: 24 }} /></div>
        ) : tab === 'own' ? (
          /* Eigenes Profil */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="card">
              <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16 }}>Instagram Handle</h3>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  className="input"
                  placeholder="@deinhandle"
                  value={ownUsername}
                  onChange={e => setOwnUsername(e.target.value)}
                  style={{ flex: 1 }}
                />
                <button
                  onClick={saveOwnProfile}
                  disabled={!ownUsername.trim() || isScrapingNow()}
                  className="btn btn-primary"
                  style={{ flexShrink: 0 }}
                >
                  {isScrapingNow() ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Speichern & Scrapen'}
                </button>
              </div>
              {isScrapingNow() && (
                <p style={{ fontSize: 12, color: '#ee4f00', marginTop: 10 }}>
                  Wird gescrapt… dauert 1-2 Minuten.
                </p>
              )}
            </div>

            {ownProfile && (
              <div className="card">
                <div style={{ display: 'flex', gap: 20 }}>
                  <div>
                    <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatNumber(ownProfile.followers_count)}
                    </p>
                    <p style={{ fontSize: 12, color: '#505050' }}>Follower</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatNumber(ownProfile.posts_count)}
                    </p>
                    <p style={{ fontSize: 12, color: '#505050' }}>Posts</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                      {formatNumber(ownProfile.following_count)}
                    </p>
                    <p style={{ fontSize: 12, color: '#505050' }}>Following</p>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#505050', marginTop: 12 }}>
                  Letzter Scrape: {timeAgo(ownProfile.last_scraped_at)}
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Competitors Liste */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {competitors.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">👥</div>
                <p className="empty-state-title">Keine Competitors</p>
                <p className="empty-state-text">Füge erfolgreiche Coaches in deiner Nische hinzu um Trends zu erkennen.</p>
                <button onClick={() => setShowAddForm(true)} className="btn btn-primary btn-sm" style={{ marginTop: 8 }}>
                  + Competitor hinzufügen
                </button>
              </div>
            ) : competitors.map(c => (
              <div key={c.id} style={{
                background: '#161616', border: '1px solid #1e1e1e',
                borderRadius: 12, padding: '16px',
                opacity: c.is_active ? 1 : 0.5
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <p style={{ fontSize: 15, fontWeight: 700 }}>@{c.username}</p>
                      {isScrapingNow(c.id) && (
                        <span style={{
                          fontSize: 10, background: 'rgba(238,79,0,0.1)',
                          color: '#ee4f00', borderRadius: 100, padding: '2px 8px', fontWeight: 600
                        }}>Scraping…</span>
                      )}
                    </div>
                    {c.niche && <p style={{ fontSize: 12, color: '#606060', marginBottom: 8 }}>{c.niche}</p>}
                    <div style={{ display: 'flex', gap: 16 }}>
                      <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                        {formatNumber(c.followers_count)}
                        <span style={{ fontSize: 11, color: '#505050', fontFamily: 'var(--font)', fontWeight: 400, marginLeft: 4 }}>Follower</span>
                      </span>
                      <span style={{ fontSize: 12, color: '#505050' }}>{timeAgo(c.last_scraped_at)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => openPosts(c)} className="btn btn-sm" style={{ fontSize: 11 }}>Posts</button>
                    <button
                      onClick={() => startScrape(c.username, 'competitor', c.id)}
                      disabled={isScrapingNow(c.id)}
                      className="btn btn-sm"
                      style={{ fontSize: 11 }}
                    >
                      {isScrapingNow(c.id) ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '↻'}
                    </button>
                    <button onClick={() => deleteCompetitor(c.id)} className="btn btn-sm" style={{ fontSize: 11, color: '#f87171' }}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
