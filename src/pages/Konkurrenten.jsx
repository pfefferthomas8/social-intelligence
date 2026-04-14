import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'
import PostCard from '../components/PostCard.jsx'

function formatNumber(n) {
  if (n === null || n === undefined || n === 0 && n !== 0) return '—'
  if (!n && n !== 0) return '—'
  if (n === 0) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function formatFollowers(n) {
  if (n === null || n === undefined) return '—'
  if (n === 0) return 'Noch nicht gescrapt'
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
  const [scraping, setScraping] = useState({})
  const [selectedCompetitor, setSelectedCompetitor] = useState(null)
  const [competitorPosts, setCompetitorPosts] = useState([])
  const [postsLoading, setPostsLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [activeJobs, setActiveJobs] = useState(() => {
    try { return JSON.parse(localStorage.getItem('si_active_jobs') || '{}') } catch { return {} }
  })

  useEffect(() => {
    loadData()
    const savedJobs = JSON.parse(localStorage.getItem('si_active_jobs') || '{}')
    if (Object.keys(savedJobs).length > 0) {
      const restoredScraping = {}
      Object.entries(savedJobs).forEach(([jobId, key]) => { restoredScraping[key] = jobId })
      setScraping(restoredScraping)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('si_active_jobs', JSON.stringify(activeJobs))
  }, [activeJobs])

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
      const { data } = await supabase.from('scrape_jobs').select('*').eq('id', jobId).maybeSingle()
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
      const username = addingUsername.trim().replace('@', '').replace(/\s+/g, '').toLowerCase()
      const { data: existing } = await supabase.from('competitor_profiles').select('id').eq('username', username).maybeSingle()
      let competitorId
      if (existing) {
        competitorId = existing.id
      } else {
        const { data: newComp, error } = await supabase.from('competitor_profiles').insert({ username, niche: addingNiche || null }).select('id').single()
        if (error) throw error
        competitorId = newComp.id
      }
      await startScrape(username, 'competitor', competitorId)
      setAddingUsername('')
      setAddingNiche('')
      setShowAddModal(false)
      await loadData()
    } catch (e) {
      alert('Fehler: ' + e.message)
    } finally {
      setAdding(false)
    }
  }

  async function saveOwnProfile() {
    if (!ownUsername.trim()) return
    const username = ownUsername.trim().replace('@', '').replace(/\s+/g, '').toLowerCase()
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
    await supabase.from('competitor_profiles').update({ is_active: !competitor.is_active }).eq('id', competitor.id)
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
    const { data } = await supabase.from('instagram_posts').select('*').eq('competitor_id', competitor.id).order('views_count', { ascending: false }).limit(20)
    setCompetitorPosts(data || [])
    setPostsLoading(false)
  }

  const isScrapingNow = (id) => !!scraping[id || 'own']

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Profile & Competitors</div>
          <div className="page-subtitle">{competitors.length} Competitors getrackt</div>
        </div>
        <button onClick={() => setShowAddModal(true)} className="btn btn-primary btn-sm">
          + Competitor hinzufügen
        </button>
      </div>

      {/* Add Competitor Modal */}
      {showAddModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        onClick={e => { if (e.target === e.currentTarget) setShowAddModal(false) }}
        >
          <div style={{
            background: '#141414', borderRadius: 16,
            border: '1px solid var(--border-strong)', padding: '28px', width: 400,
            animation: 'fadeUp 0.2s ease forwards'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>Competitor hinzufügen</h2>
              <button onClick={() => setShowAddModal(false)} className="btn btn-ghost btn-sm">✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div className="section-label">Instagram Handle</div>
                <input
                  className="input"
                  placeholder="@username"
                  value={addingUsername}
                  onChange={e => setAddingUsername(e.target.value)}
                  autoFocus
                />
              </div>
              <div>
                <div className="section-label">Nische <span style={{ textTransform: 'none', color: 'var(--text4)' }}>(optional)</span></div>
                <input
                  className="input"
                  placeholder="z.B. Fitness Coach, Bodybuilding"
                  value={addingNiche}
                  onChange={e => setAddingNiche(e.target.value)}
                />
              </div>
              <button
                onClick={addCompetitor}
                disabled={!addingUsername.trim() || adding}
                className="btn btn-primary"
                style={{ width: '100%', marginTop: 4 }}
              >
                {adding ? <span className="spinner" style={{ width: 16, height: 16, borderColor: 'rgba(255,255,255,0.2)', borderTopColor: '#fff' }} /> : 'Hinzufügen & Scrapen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Posts Slide-over Panel */}
      {selectedCompetitor && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'flex-end',
        }}
        onClick={e => { if (e.target === e.currentTarget) setSelectedCompetitor(null) }}
        >
          <div style={{
            width: 500, background: 'var(--bg-sidebar)', borderLeft: '1px solid var(--border)',
            display: 'flex', flexDirection: 'column', height: '100%',
            animation: 'slideIn 0.2s ease forwards'
          }}>
            <div style={{
              padding: '20px 24px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>@{selectedCompetitor.username}</p>
                <p style={{ fontSize: 12, color: 'var(--text3)' }}>{formatNumber(selectedCompetitor.followers_count)} Follower</p>
              </div>
              <button onClick={() => setSelectedCompetitor(null)} className="btn btn-ghost btn-sm">✕ Schließen</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        </div>
      )}

      {/* Body: split layout */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Competitors Table (left, main) */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px' }}>
          {loading ? (
            <div className="empty-state"><div className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : competitors.length === 0 ? (
            <div className="empty-state" style={{ paddingTop: 80 }}>
              <div className="empty-state-icon">👥</div>
              <p className="empty-state-title">Keine Competitors</p>
              <p className="empty-state-text">Füge erfolgreiche Coaches in deiner Nische hinzu um Trends zu erkennen.</p>
              <button onClick={() => setShowAddModal(true)} className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
                + Competitor hinzufügen
              </button>
            </div>
          ) : (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Handle</th>
                    <th>Nische</th>
                    <th>Follower</th>
                    <th>Status</th>
                    <th>Letzter Scrape</th>
                    <th style={{ textAlign: 'right' }}>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {competitors.map(c => (
                    <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.45 }}>
                      <td>
                        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 13 }}>@{c.username}</span>
                      </td>
                      <td style={{ color: 'var(--text3)' }}>{c.niche || '—'}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 13 }}>
                        {c.followers_count
                          ? formatNumber(c.followers_count)
                          : <span style={{ color: 'var(--text4)', fontSize: 11, fontFamily: 'var(--font)', fontWeight: 400 }}>Scrape ausstehend</span>
                        }
                      </td>
                      <td>
                        {isScrapingNow(c.id) ? (
                          <span className="badge badge-orange">
                            <span className="spinner" style={{ width: 8, height: 8, borderColor: 'rgba(238,79,0,0.3)', borderTopColor: 'var(--accent)' }} />
                            Scraping
                          </span>
                        ) : c.is_active ? (
                          <span className="badge badge-green">Aktiv</span>
                        ) : (
                          <span className="badge badge-gray">Pausiert</span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text3)', fontSize: 12 }}>{timeAgo(c.last_scraped_at)}</td>
                      <td>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button onClick={() => openPosts(c)} className="btn btn-xs">Posts</button>
                          <button
                            onClick={() => startScrape(c.username, 'competitor', c.id)}
                            disabled={isScrapingNow(c.id)}
                            className="btn btn-xs"
                            title="Neu scrapen"
                          >
                            {isScrapingNow(c.id) ? <span className="spinner" style={{ width: 10, height: 10 }} /> : (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                                <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            )}
                          </button>
                          <button onClick={() => toggleActive(c)} className="btn btn-xs" title={c.is_active ? 'Pausieren' : 'Aktivieren'}>
                            {c.is_active ? '⏸' : '▶'}
                          </button>
                          <button
                            onClick={() => deleteCompetitor(c.id)}
                            className="btn btn-xs"
                            style={{ color: 'var(--red)' }}
                            title="Löschen"
                          >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                              <polyline points="3 6 5 6 21 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              <path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Own Profile Panel (right, fixed 280px) */}
        <div style={{
          width: 280, flexShrink: 0, borderLeft: '1px solid var(--border)',
          padding: '24px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div className="section-title" style={{ marginBottom: 4 }}>Eigenes Profil</div>

          <div>
            <div className="section-label">Instagram Handle</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                className="input"
                placeholder="@deinhandle"
                value={ownUsername}
                onChange={e => setOwnUsername(e.target.value)}
              />
              <button
                onClick={saveOwnProfile}
                disabled={!ownUsername.trim() || isScrapingNow()}
                className="btn btn-primary btn-sm"
                style={{ width: '100%' }}
              >
                {isScrapingNow() ? (
                  <><span className="spinner" style={{ width: 12, height: 12, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} /> Scraping…</>
                ) : 'Speichern & Scrapen'}
              </button>
            </div>
          </div>

          {ownProfile && (
            <div style={{
              background: 'var(--bg-elevated)', border: '1px solid var(--border)',
              borderRadius: 'var(--r-lg)', padding: '16px'
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <div className="stat-label">Follower</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                    {formatNumber(ownProfile.followers_count)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Posts</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                    {formatNumber(ownProfile.posts_count)}
                  </div>
                </div>
                <div>
                  <div className="stat-label">Following</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                    {formatNumber(ownProfile.following_count)}
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                Letzter Scrape: {timeAgo(ownProfile.last_scraped_at)}
              </div>
            </div>
          )}

          {!ownProfile && (
            <div style={{
              background: 'var(--accent-dim)', border: '1px dashed rgba(238,79,0,0.3)',
              borderRadius: 'var(--r)', padding: '14px'
            }}>
              <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                Trag deinen Handle ein und klick "Speichern" — wir scrapen dein Profil und deine Posts automatisch.
              </p>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
