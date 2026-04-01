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
  const [pillars, setPillars] = useState({ haltung: 0, transformation: 0, mehrwert: 0, verkauf: 0 })
  const [topicsLoading, setTopicsLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [scrapeLoading, setScrapeLoading] = useState(false)
  const [trendScout, setTrendScout] = useState([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [lastTrendRun, setLastTrendRun] = useState(null)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadProfile(), loadPosts(), loadCompetitors(), loadTopics(), loadStats(), loadPillars(), loadTrendScout()])
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
    const { data } = await supabase.from('topic_suggestions').select('*').eq('used', false).order('created_at', { ascending: false }).limit(40)
    if (!data || data.length === 0) { setTopics([]); return }
    // Sicherstellen: mind. 2 pro Säule, insgesamt 8 anzeigen
    const pillars = ['haltung', 'transformation', 'mehrwert', 'verkauf']
    const byPillar = Object.fromEntries(pillars.map(p => [p, data.filter(t => t.content_pillar === p)]))
    const noPillar = data.filter(t => !t.content_pillar || !pillars.includes(t.content_pillar))
    const result = []
    // 2 pro Säule zuerst
    for (const p of pillars) result.push(...byPillar[p].slice(0, 2))
    // Auffüllen mit Rest bis 8
    const used = new Set(result.map(t => t.id))
    for (const t of [...data, ...noPillar]) {
      if (result.length >= 8) break
      if (!used.has(t.id)) { result.push(t); used.add(t.id) }
    }
    setTopics(result.slice(0, 8))
  }

  async function loadStats() {
    const [postsRes, contentRes] = await Promise.all([
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }),
      supabase.from('generated_content').select('id', { count: 'exact', head: true })
    ])
    setStats({ totalPosts: postsRes.count || 0, generatedContent: contentRes.count || 0 })
  }

  async function loadPillars() {
    const names = ['haltung', 'transformation', 'mehrwert', 'verkauf']
    // Nur eigene Posts — zeigt Thomas' persönliche Content-Verteilung
    const results = await Promise.all(
      names.map(p => supabase.from('instagram_posts').select('id', { count: 'exact', head: true }).eq('source', 'own').eq('content_pillar', p))
    )
    setPillars(Object.fromEntries(names.map((n, i) => [n, results[i].count || 0])))
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

  async function loadTrendScout() {
    const [{ data }, { data: lastJob }] = await Promise.all([
      supabase
        .from('trend_posts')
        .select('*')
        .in('recommendation', ['sofort', 'beobachten'])
        .order('viral_score', { ascending: false })
        .limit(12),
      supabase
        .from('scrape_jobs')
        .select('completed_at, started_at')
        .eq('job_type', 'trend_discovery')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ])
    setTrendScout(data || [])
    setLastTrendRun(lastJob?.completed_at || lastJob?.started_at || null)
  }

  async function runTrendDiscovery() {
    setTrendLoading(true)
    try {
      await apiFetch('trend-discovery', { method: 'POST' })
      // Apify-Dataset braucht ~4 Minuten nach Run-Ende bis es vollständig verfügbar ist
      // Nach 5 Minuten trend-process aufrufen (verarbeitet Dataset unabhängig vom Webhook-Timing)
      setTimeout(async () => {
        try {
          await apiFetch('trend-process', { method: 'POST', body: JSON.stringify({}) })
          await loadTrendScout()
        } catch (e) { console.warn('trend-process auto-retry failed:', e) }
        setTrendLoading(false)
      }, 5 * 60 * 1000) // 5 Minuten warten
    } catch (e) {
      alert('Trend Discovery Fehler: ' + e.message)
      setTrendLoading(false)
    }
  }

  function handleTrendScoutSelect(post) {
    const caption = (post.caption || '').substring(0, 300)
    const firstLine = caption.split(/[\n.!?]/)[0].trim().substring(0, 80)
    navigate('/generator', {
      state: {
        topic: firstLine || `Trending von @${post.username}`,
        additionalInfo: `Viral Post von @${post.username} | ${formatNumber(post.views_count)} Views | Viral Score: ${post.viral_score}\n\nCaption: ${caption || '(kein Text)'}\n\n${post.claude_notes ? 'KI-Analyse: ' + post.claude_notes : ''}\n\nAnalysiere das Prinzip und erstelle Thomas-spezifischen DACH-Content auf Deutsch.`,
        suggestedType: post.post_type === 'reel' ? 'video_script' : post.post_type === 'carousel' ? 'carousel' : 'single_post',
      }
    })
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
    navigate('/generator', {
      state: {
        topic: topic.title,
        topicId: topic.id,
        suggestedType: topic.suggested_types?.[0],
        additionalInfo: topic.reason || '',
      }
    })
  }

  function handleTrendingSelect(post) {
    const handle = post.competitor_username ? `@${post.competitor_username}` : 'Competitor'
    const views = post.views_count > 0 ? ` (${formatNumber(post.views_count)} Views)` : ''
    const caption = (post.caption || '').substring(0, 400)
    const transcript = (post.transcript || '').substring(0, 400)
    const textContext = [caption, transcript].filter(Boolean).join(' | ')
    navigate('/generator', {
      state: {
        topic: caption ? caption.split(/[\n.!?]/)[0].trim().substring(0, 80) : `Trending Post von ${handle}`,
        additionalInfo: `Trending Post von ${handle}${views} — ${post.post_type || 'Post'}\n\nInhalt: ${textContext || '(kein Text)'}\n\nAnalysiere das zugrundeliegende Prinzip und erstelle daraus Thomas-spezifischen DACH-Content auf Deutsch.`,
        suggestedType: post.post_type === 'reel' ? 'video_script' : post.post_type === 'carousel' ? 'carousel' : 'single_post',
      }
    })
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', minWidth: 0 }}>
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

        {/* Content Säulen */}
        {(() => {
          const total = Object.values(pillars).reduce((a, b) => a + b, 0)
          const PILLAR_CONFIG = [
            { key: 'haltung', label: 'Haltung', sub: 'Mindset · Werte · Shift', color: '#ee4f00', desc: 'Denken ändern' },
            { key: 'transformation', label: 'Transformation', sub: 'Story · Vorher/Nachher', color: '#3b82f6', desc: 'Ergebnisse zeigen' },
            { key: 'mehrwert', label: 'Mehrwert', sub: 'Tipps · Wissen · Praxis', color: '#22c55e', desc: 'Helfen & lehren' },
            { key: 'verkauf', label: 'Verkauf', sub: 'Coaching · App · USPs', color: '#a855f7', desc: 'Angebote pushen' },
          ]
          return (
            <div style={{ marginBottom: 24 }}>
              <div className="section-header" style={{ marginBottom: 14 }}>
                <span className="section-title">Content Säulen</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>wird beim Scrape aktualisiert</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {PILLAR_CONFIG.map(p => {
                  const count = pillars[p.key] || 0
                  const pct = total > 0 ? Math.round(count / total * 100) : 0
                  const isWeak = total > 10 && pct < 15
                  return (
                    <div key={p.key} style={{
                      background: 'var(--bg-card)',
                      border: `1px solid ${isWeak ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-lg)', padding: '16px',
                      position: 'relative', overflow: 'hidden',
                    }}>
                      {/* Farbige Akzentlinie oben */}
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: p.color, opacity: 0.7 }} />
                      <div style={{ fontSize: 11, fontWeight: 700, color: p.color, letterSpacing: '0.04em', marginBottom: 2 }}>
                        {p.label.toUpperCase()}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>{p.sub}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1, marginBottom: 8 }}>
                        {count}
                        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 4 }}>Posts</span>
                      </div>
                      {/* Progress Bar */}
                      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 6 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: p.color, borderRadius: 2, transition: 'width 0.6s ease', opacity: 0.8 }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{pct}% des Inhalts</span>
                        {isWeak && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', letterSpacing: '0.05em' }}>AUFHOLEN</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {total === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 10, textAlign: 'center' }}>
                  Klick "Klassifizieren" um deine Posts den 4 Säulen zuzuordnen.
                </p>
              )}
            </div>
          )
        })()}

        {/* ── TREND SCOUT ─────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="section-title">Trend Scout</span>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
                color: '#ee4f00', background: 'rgba(238,79,0,0.1)',
                padding: '2px 7px', borderRadius: 100,
              }}>
                KI-GEFILTERT
              </span>
              {lastTrendRun && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {(() => {
                    const d = new Date(lastTrendRun)
                    const pad = n => String(n).padStart(2, '0')
                    return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`
                  })()}
                </span>
              )}
            </div>
            <button onClick={runTrendDiscovery} disabled={trendLoading} className="btn btn-xs">
              {trendLoading
                ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Läuft…</>
                : '⚡ Discovery starten'
              }
            </button>
          </div>

          {trendScout.length === 0 ? (
            <div style={{
              background: 'var(--bg-card)', border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center',
            }}>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                Noch keine Trend-Daten. Starte die Discovery um viral performende Posts aus 50 kuratierten Fitness-Accounts zu analysieren.
              </p>
              <button onClick={runTrendDiscovery} disabled={trendLoading} className="btn btn-sm btn-primary">
                {trendLoading ? 'Läuft…' : '⚡ Jetzt starten'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, minWidth: 0 }}>
              {trendScout.map(post => {
                const isHot = post.recommendation === 'sofort'
                const pillarColors = { haltung: '#ee4f00', transformation: '#3b82f6', mehrwert: '#22c55e', verkauf: '#a855f7' }
                const pillarColor = pillarColors[post.content_pillar] || 'var(--text3)'
                return (
                  <div
                    key={post.id}
                    onClick={() => handleTrendScoutSelect(post)}
                    style={{
                      background: 'var(--bg-card)',
                      border: `1px solid ${isHot ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                      borderRadius: 'var(--r-lg)',
                      padding: '14px',
                      cursor: 'pointer',
                      minWidth: 0,
                      borderTop: `2px solid ${isHot ? '#ee4f00' : 'var(--border)'}`,
                      transition: 'all 0.12s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--bg-card-hover)' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = isHot ? 'rgba(238,79,0,0.3)' : 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)' }}
                  >
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      {isHot && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#ee4f00', background: 'rgba(238,79,0,0.1)', padding: '1px 6px', borderRadius: 100, letterSpacing: '0.07em' }}>
                          SOFORT
                        </span>
                      )}
                      {post.dach_gap && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '1px 6px', borderRadius: 100, letterSpacing: '0.07em' }}>
                          DACH-LÜCKE
                        </span>
                      )}
                      {post.content_pillar && (
                        <span style={{ fontSize: 9, fontWeight: 700, color: pillarColor, background: `${pillarColor}18`, padding: '1px 6px', borderRadius: 100, letterSpacing: '0.06em', marginLeft: 'auto' }}>
                          {post.content_pillar.toUpperCase()}
                        </span>
                      )}
                    </div>

                    {/* Account + Score */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)' }}>@{post.username}</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>Score</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: isHot ? '#ee4f00' : 'var(--text)', fontFamily: 'var(--font-mono)' }}>
                          {post.viral_score}
                        </span>
                      </div>
                    </div>

                    {/* Caption */}
                    {post.caption && (
                      <p style={{
                        fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.45,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        marginBottom: 8,
                      }}>
                        {post.caption}
                      </p>
                    )}

                    {/* Claude Notes */}
                    {post.claude_notes && (
                      <p style={{
                        fontSize: 10.5, color: 'var(--text3)', lineHeight: 1.4,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        marginBottom: 8, fontStyle: 'italic',
                      }}>
                        {post.claude_notes}
                      </p>
                    )}

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      {post.views_count > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/>
                            <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
                          </svg>
                          {formatNumber(post.views_count)}
                        </span>
                      )}
                      {post.likes_count > 0 && (
                        <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 3 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" strokeWidth="2"/>
                          </svg>
                          {formatNumber(post.likes_count)}
                        </span>
                      )}
                      {post.hook_strength && (
                        <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 'auto' }}>
                          Hook {post.hook_strength}/10
                        </span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2, marginLeft: post.hook_strength ? 0 : 'auto' }}>
                        In Generator →
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Two Column Layout: Themenvorschläge + Trending bei Competitors */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24, minWidth: 0 }}>
          {/* Topics */}
          <div style={{ minWidth: 0 }}>
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

          {/* Trending bei Competitors */}
          <div style={{ minWidth: 0 }}>
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
                  <PostCard key={post.id} post={post} compact onClick={() => handleTrendingSelect(post)} />
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
