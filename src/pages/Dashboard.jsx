import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { fetchWithCache } from '../lib/cache.js'
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
  const [stats, setStats] = useState({ totalPosts: 0, totalCompetitors: 0, generatedContent: 0 })
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [scrapeLoading, setScrapeLoading] = useState(false)
  const [activeSection, setActiveSection] = useState('overview')

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
    // Eigene Top Posts
    const { data: own } = await supabase
      .from('instagram_posts')
      .select('*')
      .eq('source', 'own')
      .order('views_count', { ascending: false })
      .limit(6)
    setTopOwnPosts(own || [])

    // Trending Competitor Posts (letzte 30 Tage, meiste Views)
    const since = new Date(Date.now() - 30 * 86400000).toISOString()
    const { data: trending } = await supabase
      .from('instagram_posts')
      .select('*, competitor_profiles(username)')
      .eq('source', 'competitor')
      .gte('scraped_at', since)
      .order('views_count', { ascending: false })
      .limit(5)

    // Competitor-Username in Post mergen
    setTrendingPosts((trending || []).map(p => ({
      ...p,
      competitor_username: p.competitor_profiles?.username
    })))
  }

  async function loadCompetitors() {
    const { data } = await supabase
      .from('competitor_profiles')
      .select('*')
      .eq('is_active', true)
      .order('followers_count', { ascending: false })
    setCompetitors(data || [])
  }

  async function loadTopics() {
    const { data } = await supabase
      .from('topic_suggestions')
      .select('*')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(8)
    setTopics(data || [])
  }

  async function loadStats() {
    const [postsRes, contentRes] = await Promise.all([
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }),
      supabase.from('generated_content').select('id', { count: 'exact', head: true })
    ])
    setStats({
      totalPosts: postsRes.count || 0,
      generatedContent: contentRes.count || 0,
    })
  }

  async function generateTopics() {
    setTopicsLoading(true)
    try {
      const result = await apiFetch('topic-suggestions', { method: 'POST' })
      if (result.topics) setTopics(result.topics)
      else await loadTopics()
    } catch (e) {
      console.error(e)
    } finally {
      setTopicsLoading(false)
    }
  }

  async function refreshOwnProfile() {
    if (!ownProfile?.username) return
    setScrapeLoading(true)
    try {
      await apiFetch('scrape-profile', {
        method: 'POST',
        body: JSON.stringify({ username: ownProfile.username, source: 'own' })
      })
      setTimeout(loadAll, 2000)
    } catch (e) {
      alert('Scrape fehlgeschlagen: ' + e.message)
    } finally {
      setScrapeLoading(false)
    }
  }

  function handleTopicSelect(topic) {
    // Zum Generator navigieren mit vorausgefülltem Thema
    navigate('/generator', { state: { topic: topic.title } })
  }

  const engRate = ownProfile && topOwnPosts.length > 0
    ? (topOwnPosts.reduce((s, p) => s + ((p.likes_count || 0) + (p.comments_count || 0)), 0) / topOwnPosts.length / (ownProfile.followers_count || 1) * 100).toFixed(2)
    : null

  return (
    <div className="screen">
      {/* Header */}
      <div className="page-header" style={{ background: '#0a0a0a' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff' }}>Dashboard</h1>
            <p style={{ fontSize: 13, color: '#505050', marginTop: 2 }}>
              {ownProfile ? `@${ownProfile.username}` : 'Kein Profil konfiguriert'}
            </p>
          </div>
          <button
            onClick={refreshOwnProfile}
            disabled={scrapeLoading || !ownProfile}
            className="btn btn-sm"
            style={{ gap: 6 }}
          >
            {scrapeLoading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
            Aktualisieren
          </button>
        </div>
      </div>

      <div className="screen-content">
        {loading ? (
          <div className="empty-state"><div className="spinner" style={{ width: 28, height: 28 }} /></div>
        ) : (
          <>
            {/* Stats-Reihe */}
            <div className="grid-3" style={{ marginBottom: 20 }}>
              <div className="stat-card">
                <span className="stat-value">{formatNumber(ownProfile?.followers_count)}</span>
                <span className="stat-label">Follower</span>
              </div>
              <div className="stat-card">
                <span className="stat-value" style={{ color: '#4ade80' }}>{engRate ? `${engRate}%` : '—'}</span>
                <span className="stat-label">Ø Engagement</span>
              </div>
              <div className="stat-card">
                <span className="stat-value">{stats.totalPosts}</span>
                <span className="stat-label">Posts in DB</span>
              </div>
            </div>

            {/* Themenvorschläge */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="section-label" style={{ marginBottom: 0 }}>Themenvorschläge</span>
                <button
                  onClick={generateTopics}
                  disabled={topicsLoading}
                  className="btn btn-sm"
                  style={{ fontSize: 12, padding: '6px 12px' }}
                >
                  {topicsLoading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : '+ Neue generieren'}
                </button>
              </div>

              {topics.length === 0 ? (
                <div style={{
                  background: '#111', border: '1px dashed #2a2a2a', borderRadius: 12,
                  padding: '20px', textAlign: 'center'
                }}>
                  <p style={{ fontSize: 13, color: '#505050', marginBottom: 10 }}>
                    Noch keine Vorschläge. Scrap erst dein Profil + Competitors.
                  </p>
                  <button onClick={generateTopics} className="btn btn-sm btn-primary">
                    Jetzt analysieren
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {topics.map((t, i) => (
                    <TopicCard key={t.id || i} topic={t} onSelect={handleTopicSelect} />
                  ))}
                </div>
              )}
            </div>

            {/* Trending bei Competitors */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                <span className="section-label" style={{ marginBottom: 0 }}>Trending bei Competitors</span>
                <span style={{ fontSize: 12, color: '#505050' }}>Letzte 30 Tage</span>
              </div>
              {trendingPosts.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>
                  <span className="empty-state-title" style={{ fontSize: 14 }}>Keine Daten</span>
                  <p className="empty-state-text" style={{ fontSize: 12 }}>Füge Competitors hinzu und scrap ihre Profile.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {trendingPosts.map(post => (
                    <PostCard key={post.id} post={post} compact />
                  ))}
                </div>
              )}
            </div>

            {/* Eigene Top Posts */}
            <div style={{ marginBottom: 24 }}>
              <span className="section-label">Deine Top Posts</span>
              {topOwnPosts.length === 0 ? (
                <div className="empty-state" style={{ padding: '24px' }}>
                  <span className="empty-state-title" style={{ fontSize: 14 }}>Noch keine Posts</span>
                  <p className="empty-state-text" style={{ fontSize: 12 }}>Klick auf "Aktualisieren" oben um dein Profil zu scrapen.</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {topOwnPosts.map(post => (
                    <PostCard key={post.id} post={post} />
                  ))}
                </div>
              )}
            </div>

            {/* Competitor Übersicht */}
            {competitors.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span className="section-label" style={{ marginBottom: 0 }}>Competitors</span>
                  <button onClick={() => navigate('/konkurrenten')} className="btn-ghost btn btn-sm" style={{ fontSize: 12 }}>
                    Alle anzeigen
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {competitors.slice(0, 5).map(c => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', padding: '12px 0',
                      borderBottom: '1px solid #1a1a1a'
                    }}>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0' }}>@{c.username}</p>
                        {c.niche && <p style={{ fontSize: 12, color: '#505050' }}>{c.niche}</p>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <p style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-mono)', color: '#fff' }}>
                          {formatNumber(c.followers_count)}
                        </p>
                        <p style={{ fontSize: 11, color: '#505050' }}>
                          {c.last_scraped_at ? timeAgo(c.last_scraped_at) : 'Nie gescrapt'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Kein Profil — Onboarding Prompt */}
            {!ownProfile && (
              <div style={{
                background: 'rgba(238,79,0,0.08)', border: '1px solid rgba(238,79,0,0.25)',
                borderRadius: 12, padding: '20px', textAlign: 'center'
              }}>
                <p style={{ fontSize: 15, fontWeight: 600, color: '#fff', marginBottom: 8 }}>
                  Profil noch nicht eingerichtet
                </p>
                <p style={{ fontSize: 13, color: '#808080', marginBottom: 16 }}>
                  Geh zu Einstellungen und trag deinen Instagram-Handle ein um zu starten.
                </p>
                <button onClick={() => navigate('/konkurrenten')} className="btn btn-primary btn-sm">
                  Profil einrichten
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
