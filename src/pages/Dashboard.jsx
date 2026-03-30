import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'
import TopicCard from '../components/TopicCard.jsx'
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
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `vor ${d}d`
  if (h > 0) return `vor ${h}h`
  return 'Gerade eben'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [ownProfile, setOwnProfile] = useState(null)
  const [topOwnPosts, setTopOwnPosts] = useState([])
  const [trendingPosts, setTrendingPosts] = useState([])
  const [competitors, setCompetitors] = useState([])
  const [topics, setTopics] = useState([])
  const [stats, setStats] = useState({ totalPosts: 0, generatedContent: 0 })
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [scrapeLoading, setScrapeLoading] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadProfile(), loadPosts(), loadCompetitors(), loadTopics(), loadStats()])
    setLoading(false)
  }

  async function loadProfile() {
    const { data } = await supabase.from('own_profile').select('*').limit(1).maybeSingle()
    setOwnProfile(data)
  }

  async function loadPosts() {
    const { data: own } = await supabase.from('instagram_posts').select('*').eq('source', 'own').order('views_count', { ascending: false }).limit(6)
    setTopOwnPosts(own || [])
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: trending } = await supabase.from('instagram_posts').select('*, competitor_profiles(username)').eq('source', 'competitor').gte('scraped_at', since).order('views_count', { ascending: false }).limit(6)
    setTrendingPosts((trending || []).map(p => ({ ...p, competitor_username: p.competitor_profiles?.username })))
  }

  async function loadCompetitors() {
    const { data } = await supabase.from('competitor_profiles').select('*').eq('is_active', true).order('followers_count', { ascending: false })
    setCompetitors(data || [])
  }

  async function loadTopics() {
    const { data } = await supabase.from('topic_suggestions').select('*').eq('used', false).order('created_at', { ascending: false }).limit(8)
    setTopics(data || [])
  }

  async function loadStats() {
    const [postsRes, contentRes] = await Promise.all([
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }),
      supabase.from('generated_content').select('id', { count: 'exact', head: true })
    ])
    setStats({ totalPosts: postsRes.count || 0, generatedContent: contentRes.count || 0 })
  }

  async function generateTopics() {
    setTopicsLoading(true)
    try {
      const result = await apiFetch('topic-suggestions', { method: 'POST' })
      if (result.topics) setTopics(result.topics)
      else await loadTopics()
    } catch (e) { console.error(e) }
    finally { setTopicsLoading(false) }
  }

  async function refreshOwnProfile() {
    if (!ownProfile?.username) return
    setScrapeLoading(true)
    try {
      await apiFetch('scrape-profile', { method: 'POST', body: JSON.stringify({ username: ownProfile.username, source: 'own' }) })
      setTimeout(loadAll, 2000)
    } catch (e) { alert('Scrape fehlgeschlagen: ' + e.message) }
    finally { setScrapeLoading(false) }
  }

  function handleTopicSelect(topic) {
    navigate('/generator', { state: { topic: topic.title } })
  }

  const engRate = ownProfile && topOwnPosts.length > 0
    ? (topOwnPosts.reduce((s, p) => s + ((p.likes_count || 0) + (p.comments_count || 0)), 0) / topOwnPosts.length / (ownProfile.followers_count || 1) * 100).toFixed(2)
    : null

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">{ownProfile ? `@${ownProfile.username}` : 'Kein Profil konfiguriert'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate('/konkurrenten')} className="btn btn-sm">
            + Competitor
          </button>
          <button
            onClick={refreshOwnProfile}
            disabled={scrapeLoading || !ownProfile}
            className="btn btn-sm"
          >
            {scrapeLoading ? <span className="spinner" /> : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            )}
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="page-body">
        {/* Stats Row */}
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Follower</div>
            <div className="stat-value">{formatNumber(ownProfile?.followers_count)}</div>
            <div className="stat-sub">@{ownProfile?.username || '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Engagement Rate</div>
            <div className="stat-value" style={{ color: engRate ? '#22c55e' : 'var(--text3)', fontSize: 24 }}>
              {engRate ? `${engRate}%` : '—'}
            </div>
            <div className="stat-sub">Ø letzte Posts</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Posts in DB</div>
            <div className="stat-value">{formatNumber(stats.totalPosts)}</div>
            <div className="stat-sub">{competitors.length} Competitors</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Content generiert</div>
            <div className="stat-value">{stats.generatedContent}</div>
            <div className="stat-sub">
              <span
                onClick={() => navigate('/generator')}
                style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}
              >
                Neu erstellen →
              </span>
            </div>
          </div>
        </div>

        {/* Two Column Layout */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {/* Topics */}
          <div>
            <div className="section-header">
              <span className="section-title">Themenvorschläge</span>
              <button onClick={generateTopics} disabled={topicsLoading} className="btn btn-xs">
                {topicsLoading ? <span className="spinner" style={{ width: 10, height: 10 }} /> : '+ Generieren'}
              </button>
            </div>
            {topics.length === 0 ? (
              <div style={{
                background: 'var(--bg-card)', border: '1px dashed var(--border-strong)',
                borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center'
              }}>
                <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                  Analysiere erst dein Profil und Competitors.
                </p>
                <button onClick={generateTopics} className="btn btn-sm btn-primary">Jetzt analysieren</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {topics.map((t, i) => (
                  <TopicCard key={t.id || i} topic={t} onSelect={handleTopicSelect} />
                ))}
              </div>
            )}
          </div>

          {/* Trending Posts */}
          <div>
            <div className="section-header">
              <span className="section-title">Trending bei Competitors</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>letzte 30 Tage</span>
            </div>
            {trendingPosts.length === 0 ? (
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center'
              }}>
                <p style={{ fontSize: 13, color: 'var(--text3)' }}>Keine Trending Posts. Füge Competitors hinzu.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {trendingPosts.map(post => (
                  <PostCard key={post.id} post={post} compact />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Competitors Table */}
        {competitors.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="section-title">Competitors</span>
              <button onClick={() => navigate('/konkurrenten')} className="btn btn-xs btn-ghost">
                Alle anzeigen →
              </button>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Handle</th>
                  <th>Nische</th>
                  <th>Follower</th>
                  <th>Letzter Scrape</th>
                </tr>
              </thead>
              <tbody>
                {competitors.slice(0, 6).map(c => (
                  <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => navigate('/konkurrenten')}>
                    <td style={{ fontWeight: 600, color: 'var(--text)' }}>@{c.username}</td>
                    <td style={{ color: 'var(--text3)' }}>{c.niche || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{formatNumber(c.followers_count)}</td>
                    <td style={{ color: 'var(--text3)', fontSize: 12 }}>{timeAgo(c.last_scraped_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* No profile notice */}
        {!ownProfile && (
          <div style={{
            background: 'var(--accent-dim)', border: '1px solid rgba(238,79,0,0.2)',
            borderRadius: 'var(--r-lg)', padding: '24px', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between'
          }}>
            <div>
              <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>Profil noch nicht eingerichtet</p>
              <p style={{ fontSize: 13, color: 'var(--text3)' }}>Trag deinen Instagram-Handle ein um zu starten.</p>
            </div>
            <button onClick={() => navigate('/konkurrenten')} className="btn btn-primary">Profil einrichten →</button>
          </div>
        )}
      </div>
    </div>
  )
}
