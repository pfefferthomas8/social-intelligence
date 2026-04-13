import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'
import TopicCard from '../components/TopicCard.jsx'
import PostCard from '../components/PostCard.jsx'

function formatNumber(n) {
  if (n === null || n === undefined) return '—'
  if (n === 0) return '0'
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
  const [trendScoutPool, setTrendScoutPool] = useState([])
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendStatus, setTrendStatus] = useState('')
  const [trendElapsed, setTrendElapsed] = useState(0)
  const [lastTrendRun, setLastTrendRun] = useState(null)
  const trendPollRef = useRef(null)
  const trendTimerRef = useRef(null)
  const trendJobIdRef = useRef(null)

  // Remix-State: welcher Post wird gerade remixed + Ergebnis
  const [remixing, setRemixing] = useState({}) // postId → true/false
  const [remixResults, setRemixResults] = useState({}) // postId → {why, thomas_version, format}
  const [remixOpen, setRemixOpen] = useState({}) // postId → bool (aufgeklappt)

  // Competitor Remix (per-post, wie Trend Scout)
  const [compRemixing, setCompRemixing] = useState({})    // postId → bool
  const [compRemixResults, setCompRemixResults] = useState({}) // postId → result
  const [compRemixOpen, setCompRemixOpen] = useState({})  // postId → bool

  // Dashboard Posts (12 datengetriebene Content-Ideen)
  const [dashPosts, setDashPosts] = useState([])
  const [dashLoading, setDashLoading] = useState(false)
  const [dashCopied, setDashCopied] = useState({}) // postIndex → bool
  const [dashExpanded, setDashExpanded] = useState({}) // postIndex → bool

  // Quick-Generator Panel
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickTopic, setQuickTopic] = useState('')
  const [quickType, setQuickType] = useState('b_roll')
  const [quickGenerating, setQuickGenerating] = useState(false)
  const [quickResult, setQuickResult] = useState(null)
  const [quickCopied, setQuickCopied] = useState(false)
  const quickInputRef = useRef(null)

  // Daily Brief
  const [dailyBrief, setDailyBrief] = useState(null)
  const [briefLoading, setBriefLoading] = useState(false)

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadProfile(), loadPosts(), loadCompetitors(), loadTopics(), loadStats(), loadPillars(), loadTrendScout()])
    setLoading(false)
  }

  async function generateDashboardPosts() {
    setDashLoading(true)
    try {
      const data = await apiFetch('generate-dashboard-posts', { method: 'POST' })
      setDashPosts(data.posts || [])
      setDashCopied({})
      setDashExpanded({})
    } catch (e) {
      alert('Fehler: ' + e.message)
    } finally {
      setDashLoading(false)
    }
  }

  async function remixPost(post) {
    const id = post.id || post.instagram_post_id
    setRemixing(prev => ({ ...prev, [id]: true }))
    setRemixOpen(prev => ({ ...prev, [id]: true }))
    try {
      const data = await apiFetch('remix-post', {
        method: 'POST',
        body: JSON.stringify({
          caption: post.caption,
          visual_text: post.visual_text,
          username: post.username,
          views_count: post.views_count,
          likes_count: post.likes_count,
          post_type: post.post_type,
          content_pillar: post.content_pillar,
          claude_notes: post.claude_notes,
          viral_score: post.viral_score,
          source: 'trend',
          preferred_format: post.post_type === 'reel' ? 'video_script' : 'single_post',
        })
      })
      setRemixResults(prev => ({ ...prev, [id]: data }))
    } catch (e) {
      setRemixResults(prev => ({ ...prev, [id]: { error: e.message } }))
    } finally {
      setRemixing(prev => ({ ...prev, [id]: false }))
    }
  }

  async function remixCompetitorPost(post) {
    const id = post.id
    setCompRemixing(prev => ({ ...prev, [id]: true }))
    setCompRemixOpen(prev => ({ ...prev, [id]: true }))
    try {
      const data = await apiFetch('remix-post', {
        method: 'POST',
        body: JSON.stringify({
          caption: post.caption,
          visual_text: null,
          username: post.competitor_username || post.competitor_profiles?.username,
          views_count: post.views_count,
          likes_count: post.likes_count,
          post_type: post.post_type,
          content_pillar: post.content_pillar,
          claude_notes: null,
          viral_score: null,
          source: 'competitor',
          preferred_format: post.post_type === 'reel' ? 'video_script' : 'single_post',
        })
      })
      setCompRemixResults(prev => ({ ...prev, [id]: data }))
    } catch (e) {
      setCompRemixResults(prev => ({ ...prev, [id]: { error: e.message } }))
    } finally {
      setCompRemixing(prev => ({ ...prev, [id]: false }))
    }
  }

  function shuffleTrendScout() {
    if (trendScoutPool.length === 0) return
    const shuffled = [...trendScoutPool].sort(() => Math.random() - 0.5)
    setTrendScout(shuffled.slice(0, 12))
    // Remix-States zurücksetzen für neue Posts
    setRemixResults({})
    setRemixOpen({})
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
      await apiFetch('topic-suggestions', { method: 'POST' })
      await loadTopics()
    } catch (e) {
      console.error(e)
      alert('Fehler beim Generieren: ' + (e.message || e))
    } finally {
      setTopicsLoading(false)
    }
  }

  async function loadTrendScout(shuffleNew = false) {
    const [{ data: all }, { data: lastJob }] = await Promise.all([
      supabase
        .from('trend_posts')
        .select('*')
        .in('recommendation', ['sofort', 'beobachten'])
        .order('viral_score', { ascending: false })
        .limit(60), // Mehr laden → Rotation möglich
      supabase
        .from('scrape_jobs')
        .select('completed_at, started_at')
        .eq('job_type', 'trend_discovery')
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ])
    const posts = all || []
    // Shuffle für Rotation — immer andere Posts zeigen
    const shuffled = shuffleNew
      ? [...posts].sort(() => Math.random() - 0.5)
      : posts
    setTrendScout(shuffled.slice(0, 12))
    setTrendScoutPool(posts) // Alle verfügbaren Posts merken
    setLastTrendRun(lastJob?.completed_at || lastJob?.started_at || null)
  }

  async function generateQuick() {
    if (!quickTopic.trim()) return
    setQuickGenerating(true)
    setQuickResult(null)
    setQuickCopied(false)
    try {
      const data = await apiFetch('generate-content', {
        method: 'POST',
        body: JSON.stringify({ topic: quickTopic.trim(), content_type: quickType })
      })
      setQuickResult(data)
    } catch (e) {
      alert('Fehler: ' + e.message)
    } finally {
      setQuickGenerating(false)
    }
  }

  function openQuick(prefillTopic = '', prefillType = 'b_roll') {
    setQuickTopic(prefillTopic)
    setQuickType(prefillType)
    setQuickResult(null)
    setQuickOpen(true)
    setTimeout(() => quickInputRef.current?.focus(), 100)
  }

  async function generateDailyBrief(pillar) {
    setBriefLoading(true)
    setDailyBrief(null)
    try {
      const data = await apiFetch('daily-brief', {
        method: 'POST',
        body: JSON.stringify(pillar ? { pillar } : {})
      })
      setDailyBrief(data)
    } catch (e) {
      alert('Daily Brief Fehler: ' + e.message)
    } finally {
      setBriefLoading(false)
    }
  }

  function stopTrendPolling() {
    if (trendPollRef.current) clearInterval(trendPollRef.current)
    if (trendTimerRef.current) clearInterval(trendTimerRef.current)
    trendPollRef.current = null
    trendTimerRef.current = null
    trendJobIdRef.current = null
  }

  async function runTrendDiscovery() {
    setTrendLoading(true)
    setTrendStatus('waiting')
    setTrendElapsed(0)
    stopTrendPolling()

    try {
      const data = await apiFetch('trend-discovery', { method: 'POST' })
      const jobId = data?.job_id
      trendJobIdRef.current = jobId

      // Sekunden-Timer für Anzeige
      let elapsed = 0
      trendTimerRef.current = setInterval(() => {
        elapsed += 1
        setTrendElapsed(elapsed)
      }, 1000)

      // Echtes Polling alle 20s — prüft scrape_jobs Status
      trendPollRef.current = setInterval(async () => {
        try {
          // Neuesten trend_discovery Job prüfen
          const { data: job } = await supabase
            .from('scrape_jobs')
            .select('status, error_msg, completed_at')
            .eq('job_type', 'trend_discovery')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()

          if (!job) return

          if (job.status === 'done') {
            setTrendStatus('done')
            stopTrendPolling()
            await loadTrendScout()
            setTrendLoading(false)
          } else if (job.status === 'error') {
            setTrendStatus('error')
            stopTrendPolling()
            setTrendLoading(false)
            alert('Trend Discovery Fehler: ' + (job.error_msg || 'Unbekannter Fehler'))
          } else if (job.status === 'running') {
            setTrendStatus('processing')
          }

          // Timeout nach 12 Minuten
          if (elapsed >= 720) {
            stopTrendPolling()
            setTrendLoading(false)
            setTrendStatus('error')
            alert('Trend Discovery hat zu lange gedauert. Versuche es erneut.')
          }
        } catch { /* Polling-Fehler ignorieren, weiter versuchen */ }
      }, 20000)

    } catch (e) {
      stopTrendPolling()
      setTrendLoading(false)
      setTrendStatus('')
      alert('Trend Discovery Fehler: ' + e.message)
    }
  }

  // Cleanup bei Unmount
  useEffect(() => () => stopTrendPolling(), [])

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

  // Pillar Rotation Label für Daily Brief Button
  const PILLAR_ROTATION = ['haltung', 'mehrwert', 'transformation', 'verkauf', 'haltung', 'mehrwert', 'transformation']
  const PILLAR_LABELS = { haltung: 'Haltung', mehrwert: 'Mehrwert', transformation: 'Transformation', verkauf: 'Verkauf' }
  const PILLAR_COLORS = { haltung: '#ee4f00', mehrwert: '#22c55e', transformation: '#3b82f6', verkauf: '#a855f7' }
  const todayPillar = PILLAR_ROTATION[new Date().getDay()]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', minWidth: 0 }}>
      {/* Quick-Generator Overlay */}
      {quickOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.85)',
            display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          }}
          onClick={e => { if (e.target === e.currentTarget) { setQuickOpen(false); setQuickResult(null) } }}
        >
          <div style={{
            background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
            padding: '24px 24px 32px', width: '100%', maxWidth: 600,
            borderTop: '1px solid var(--border)',
            boxShadow: '0 -20px 60px rgba(0,0,0,0.6)',
          }}>
            {/* Handle */}
            <div style={{ width: 32, height: 3, background: 'var(--border)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Quick Generator</span>
              <button onClick={() => { setQuickOpen(false); setQuickResult(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
            </div>

            {!quickResult ? (
              <>
                {/* Type Buttons */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {[
                    { key: 'b_roll', label: '⚡ B-Roll' },
                    { key: 'single_post', label: '📝 Single Post' },
                    { key: 'video_script', label: '🎬 Video Script' },
                    { key: 'carousel', label: '📋 Karussell' },
                  ].map(t => (
                    <button
                      key={t.key}
                      onClick={() => setQuickType(t.key)}
                      className="btn btn-sm"
                      style={{
                        background: quickType === t.key ? 'var(--accent)' : 'var(--bg)',
                        color: quickType === t.key ? '#fff' : 'var(--text3)',
                        border: `1px solid ${quickType === t.key ? 'var(--accent)' : 'var(--border)'}`,
                        flex: 1, justifyContent: 'center', fontSize: 11,
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <input
                  ref={quickInputRef}
                  value={quickTopic}
                  onChange={e => setQuickTopic(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && generateQuick()}
                  placeholder="Thema eingeben… z.B. Protein-Timing"
                  style={{
                    width: '100%', background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '12px 14px', color: 'var(--text)',
                    fontSize: 14, marginBottom: 12, boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={generateQuick}
                  disabled={quickGenerating || !quickTopic.trim()}
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
                >
                  {quickGenerating ? (
                    <><span className="spinner" style={{ width: 14, height: 14 }} /> Generiert…</>
                  ) : '⚡ Generieren'}
                </button>
              </>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Fertig</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setQuickResult(null)} className="btn btn-sm">Neu</button>
                    <button
                      onClick={() => { navigate('/generator', { state: { topic: quickTopic, suggestedType: quickType } }); setQuickOpen(false) }}
                      className="btn btn-sm"
                    >Im Generator öffnen →</button>
                  </div>
                </div>
                <div style={{
                  background: 'var(--bg)', borderRadius: 10, padding: 14,
                  fontSize: 13, color: 'var(--text2)', lineHeight: 1.7,
                  whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto',
                  border: '1px solid var(--border)',
                }}>
                  {quickResult.content}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(quickResult.content)
                    setQuickCopied(true)
                    setTimeout(() => setQuickCopied(false), 2000)
                  }}
                  className="btn btn-sm"
                  style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
                >
                  {quickCopied ? '✓ Kopiert' : 'Kopieren'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Quick-Generator Button */}
      <button
        onClick={() => openQuick()}
        style={{
          position: 'fixed', bottom: 28, right: 24, zIndex: 100,
          width: 52, height: 52, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          border: 'none', cursor: 'pointer', fontSize: 24,
          boxShadow: '0 4px 20px rgba(238,79,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'transform 0.15s, box-shadow 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(238,79,0,0.65)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(238,79,0,0.5)' }}
        title="Quick Generator"
      >
        ⚡
      </button>

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

        {/* ── DAILY BRIEF ─────────────────────────────────────────────────────── */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(238,79,0,0.08) 0%, rgba(0,0,0,0) 60%)',
          border: '1px solid rgba(238,79,0,0.2)',
          borderRadius: 'var(--r-lg)',
          padding: '20px 24px',
          marginBottom: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: dailyBrief ? 16 : 0 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16, fontWeight: 700 }}>Daily Brief</span>
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                  color: PILLAR_COLORS[todayPillar], background: `${PILLAR_COLORS[todayPillar]}18`,
                  padding: '2px 7px', borderRadius: 100,
                }}>
                  {PILLAR_LABELS[todayPillar]?.toUpperCase()}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                3 fertige Content-Ideen auf Knopfdruck — Video Script + B-Roll + Caption
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Säulen-Override */}
              <div style={{ display: 'flex', gap: 4 }}>
                {['haltung', 'mehrwert', 'transformation', 'verkauf'].map(p => (
                  <button
                    key={p}
                    onClick={() => generateDailyBrief(p)}
                    disabled={briefLoading}
                    className="btn btn-xs"
                    style={{
                      color: PILLAR_COLORS[p],
                      border: `1px solid ${PILLAR_COLORS[p]}40`,
                      background: dailyBrief?.pillar === p ? `${PILLAR_COLORS[p]}15` : 'transparent',
                      fontSize: 10,
                    }}
                    title={PILLAR_LABELS[p]}
                  >
                    {p[0].toUpperCase()}
                  </button>
                ))}
              </div>
              <button
                onClick={() => generateDailyBrief()}
                disabled={briefLoading}
                className="btn btn-sm btn-primary"
                style={{ minWidth: 130 }}
              >
                {briefLoading ? (
                  <><span className="spinner" style={{ width: 12, height: 12 }} /> Generiert…</>
                ) : '⚡ Brief generieren'}
              </button>
            </div>
          </div>

          {dailyBrief && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                { key: 'video_script', label: '🎬 Video Script', content: dailyBrief.video_script, type: 'video_script' },
                { key: 'b_roll', label: '⚡ B-Roll', content: dailyBrief.b_roll, type: 'b_roll' },
                { key: 'single_post', label: '📝 Single Post', content: dailyBrief.single_post, type: 'single_post' },
              ].map(item => {
                const lines = item.content?.split('\n') || []
                const thema = lines.find(l => l.startsWith('THEMA:'))?.replace('THEMA:', '').trim()
                return (
                  <div key={item.key} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r-lg)', padding: '14px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.05em' }}>
                      {item.label}
                    </div>
                    {thema && (
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                        {thema}
                      </div>
                    )}
                    <div style={{
                      fontSize: 11, color: 'var(--text3)', lineHeight: 1.55,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
                    }}>
                      {item.content?.replace(/^THEMA:.*\n?/m, '').trim()}
                    </div>
                    <button
                      onClick={() => navigate('/generator', { state: { topic: thema || '', suggestedType: item.type } })}
                      className="btn btn-xs btn-primary"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      Im Generator öffnen →
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── DASHBOARD POSTS ──────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="section-title">Content Intelligence</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#ee4f00', background: 'rgba(238,79,0,0.1)', padding: '2px 7px', borderRadius: 100 }}>DATENGETRIEBEN</span>
            </div>
            <button
              onClick={generateDashboardPosts}
              disabled={dashLoading}
              className="btn btn-sm btn-primary"
            >
              {dashLoading
                ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Analysiert alle Daten…</>
                : dashPosts.length > 0 ? '↺ Neue 12 generieren' : '⚡ 12 Post-Ideen generieren'
              }
            </button>
          </div>

          {dashPosts.length === 0 && !dashLoading && (
            <div style={{
              background: 'var(--bg-card)', border: '1px dashed var(--border-strong)',
              borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center'
            }}>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                Claude analysiert Trends, Competitors und Community-Signale und erstellt 12 datengetriebene Content-Ideen speziell für Thomas.
              </p>
              <button onClick={generateDashboardPosts} className="btn btn-sm btn-primary">
                ⚡ Jetzt generieren
              </button>
            </div>
          )}

          {dashPosts.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {dashPosts.map((post, i) => {
                const PILLAR_C = { haltung: '#ee4f00', transformation: '#3b82f6', mehrwert: '#22c55e', verkauf: '#a855f7' }
                const FORMAT_ICON = { video_script: '🎬', b_roll: '⚡', single_post: '📝', carousel: '📋' }
                const pc = PILLAR_C[post.pillar] || 'var(--text3)'
                const isExp = dashExpanded[i]
                const isCopied = dashCopied[i]
                const scoreColor = post.score >= 80 ? '#22c55e' : post.score >= 60 ? '#ee4f00' : 'var(--text3)'
                return (
                  <div key={i} style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderTop: `2px solid ${pc}`,
                    borderRadius: 'var(--r-lg)',
                    overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                  }}>
                    <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Header: Format + Pillar + Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{FORMAT_ICON[post.format]} {post.format?.replace(/_/g,' ')}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: pc, background: `${pc}18`, padding: '2px 6px', borderRadius: 100, marginLeft: 'auto' }}>{post.pillar?.toUpperCase()}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: 'var(--font-mono)' }}>{post.score}</span>
                      </div>

                      {/* Hook */}
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, margin: 0 }}>
                        {post.hook}
                      </p>

                      {/* Preview */}
                      <p style={{
                        fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.55, margin: 0,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: isExp ? 20 : 3, WebkitBoxOrient: 'vertical',
                      }}>
                        {post.preview}
                      </p>

                      {/* Datengrundlage */}
                      {post.sources && post.sources.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text4)', letterSpacing: '0.08em' }}>DATENGRUNDLAGE</div>
                          {post.sources.map((s, si) => (
                            <div key={si} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                              <span style={{
                                fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4,
                                background: s.ref?.startsWith('T') ? 'rgba(238,79,0,0.12)' : s.ref?.startsWith('S') ? 'rgba(255,69,0,0.12)' : 'rgba(59,130,246,0.12)',
                                color: s.ref?.startsWith('T') ? '#ee4f00' : s.ref?.startsWith('S') ? '#ff4500' : '#3b82f6',
                                flexShrink: 0, marginTop: 1,
                              }}>
                                {s.ref?.startsWith('T') ? 'TREND' : s.ref?.startsWith('S') ? 'COMMUNITY' : 'COMP'}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.4 }}>{s.label}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Why it works */}
                      {post.why_it_works && (
                        <div style={{ padding: '7px 9px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, borderLeft: '2px solid var(--accent)' }}>
                          <p style={{ fontSize: 10.5, color: 'var(--text3)', lineHeight: 1.5, margin: 0 }}>{post.why_it_works}</p>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div style={{ padding: '8px 12px 12px', display: 'flex', gap: 5 }}>
                      <button
                        onClick={() => navigate('/generator', {
                          state: { topic: post.hook, suggestedType: post.format, additionalInfo: post.preview }
                        })}
                        className="btn btn-xs btn-primary"
                        style={{ flex: 1, justifyContent: 'center' }}
                      >Im Generator →</button>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(`${post.hook}\n\n${post.preview}`)
                          setDashCopied(prev => ({ ...prev, [i]: true }))
                          setTimeout(() => setDashCopied(prev => ({ ...prev, [i]: false })), 2000)
                        }}
                        className="btn btn-xs"
                      >{isCopied ? '✓' : 'Copy'}</button>
                      <button
                        onClick={() => setDashExpanded(prev => ({ ...prev, [i]: !prev[i] }))}
                        className="btn btn-xs"
                      >{isExp ? '▲' : '▼'}</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#ee4f00', background: 'rgba(238,79,0,0.1)', padding: '2px 7px', borderRadius: 100 }}>
                KI-GEFILTERT
              </span>
              {trendScoutPool.length > 12 && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>{trendScoutPool.length} Posts im Pool</span>
              )}
              {lastTrendRun && (
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {(() => { const d = new Date(lastTrendRun); const pad = n => String(n).padStart(2,'0'); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}. ${pad(d.getHours())}:${pad(d.getMinutes())}` })()}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {trendLoading && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
                  <span style={{ fontSize: 10, color: 'var(--text3)' }}>
                    {trendStatus === 'waiting' && 'Apify startet…'}
                    {trendStatus === 'processing' && 'Analysiert Posts…'}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text4)', fontFamily: 'var(--font-mono)' }}>
                    {Math.floor(trendElapsed / 60)}:{String(trendElapsed % 60).padStart(2, '0')}
                  </span>
                </div>
              )}
              {trendScoutPool.length > 12 && !trendLoading && (
                <button onClick={shuffleTrendScout} className="btn btn-xs" title="Andere Posts zeigen">
                  🔀 Andere zeigen
                </button>
              )}
              <button onClick={runTrendDiscovery} disabled={trendLoading} className="btn btn-xs">
                {trendLoading ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Läuft…</> : '⚡ Neu scannen'}
              </button>
            </div>
          </div>

          {trendScout.length === 0 ? (
            <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center' }}>
              <p style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                Noch keine Trend-Daten. Starte den Scan um viral performende Posts aus 40 kuratierten Fitness-Accounts zu analysieren.
              </p>
              <button onClick={runTrendDiscovery} disabled={trendLoading} className="btn btn-sm btn-primary">
                {trendLoading ? 'Läuft…' : '⚡ Jetzt scannen'}
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, minWidth: 0 }}>
              {trendScout.map(post => {
                const id = post.id
                const isHot = post.recommendation === 'sofort'
                const PILLAR_C = { haltung: '#ee4f00', transformation: '#3b82f6', mehrwert: '#22c55e', verkauf: '#a855f7' }
                const pc = PILLAR_C[post.content_pillar] || 'var(--text3)'
                const isOpen = remixOpen[id]
                const isRemixing = remixing[id]
                const remix = remixResults[id]

                return (
                  <div key={id} style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${isHot ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                    borderTop: `2px solid ${isHot ? '#ee4f00' : 'var(--border-strong)'}`,
                    borderRadius: 'var(--r-lg)', minWidth: 0,
                    overflow: 'hidden',
                  }}>
                    {/* ─ ORIGINAL PART ─ */}
                    <div style={{ padding: '14px 14px 10px' }}>
                      {/* Badges */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                        {isHot && <span style={{ fontSize: 8, fontWeight: 800, color: '#ee4f00', background: 'rgba(238,79,0,0.12)', padding: '2px 6px', borderRadius: 100, letterSpacing: '0.08em' }}>SOFORT</span>}
                        {post.dach_gap && <span style={{ fontSize: 8, fontWeight: 800, color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 6px', borderRadius: 100, letterSpacing: '0.08em' }}>DACH-LÜCKE</span>}
                        {post.content_pillar && <span style={{ fontSize: 8, fontWeight: 700, color: pc, background: `${pc}18`, padding: '2px 6px', borderRadius: 100, marginLeft: 'auto' }}>{post.content_pillar.toUpperCase()}</span>}
                      </div>

                      {/* Account + Stats */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>@{post.username}</span>
                          {post.hook_strength && <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 6 }}>Hook {post.hook_strength}/10</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          {post.views_count > 0 && <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>{formatNumber(post.views_count)}</span>}
                          <span style={{ fontSize: 11, fontWeight: 700, color: isHot ? '#ee4f00' : 'var(--text2)', fontFamily: 'var(--font-mono)' }}>#{post.viral_score}</span>
                        </div>
                      </div>

                      {/* Original Caption */}
                      {(post.caption || post.visual_text) && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text4)', letterSpacing: '0.08em', marginBottom: 4 }}>ORIGINAL</div>
                          <p style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: isOpen ? 20 : 2, WebkitBoxOrient: 'vertical' }}>
                            {post.caption || post.visual_text}
                          </p>
                        </div>
                      )}

                      {/* KI-Analyse */}
                      {post.claude_notes && (
                        <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, borderLeft: '2px solid var(--accent)' }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 3 }}>WARUM ES FUNKTIONIERT</div>
                          <p style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, margin: 0 }}>{post.claude_notes}</p>
                        </div>
                      )}

                      {/* Buttons */}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => { if (!remix && !isRemixing) remixPost(post); else setRemixOpen(prev => ({ ...prev, [id]: !prev[id] })) }}
                          disabled={isRemixing}
                          className="btn btn-xs btn-primary"
                          style={{ flex: 1, justifyContent: 'center' }}
                        >
                          {isRemixing ? <><span className="spinner" style={{ width: 9, height: 9 }} /> Baut um…</> :
                           remix ? (isOpen ? '▲ Meine Version' : '▼ Meine Version') : '⚡ Für meinen Feed'}
                        </button>
                        <button
                          onClick={() => navigate('/generator', { state: { topic: (post.caption || '').split(/[\n.!?]/)[0].trim().substring(0, 80) || `Trending @${post.username}`, additionalInfo: `Viral @${post.username} | ${formatNumber(post.views_count)} Views\n${post.caption || ''}`, suggestedType: post.post_type === 'reel' ? 'video_script' : 'single_post' } })}
                          className="btn btn-xs"
                        >Generator</button>
                      </div>
                    </div>

                    {/* ─ THOMAS VERSION (aufklappbar) ─ */}
                    {isOpen && (
                      <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(238,79,0,0.04)' }}>
                        {isRemixing ? (
                          <div style={{ padding: '20px', textAlign: 'center' }}>
                            <span className="spinner" style={{ width: 18, height: 18 }} />
                            <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Claude analysiert & schreibt um…</p>
                          </div>
                        ) : remix?.error ? (
                          <div style={{ padding: '12px 14px' }}>
                            <p style={{ fontSize: 11, color: '#ef4444' }}>Fehler: {remix.error}</p>
                            <button onClick={() => { setRemixResults(prev => { const n = {...prev}; delete n[id]; return n }); remixPost(post) }} className="btn btn-xs" style={{ marginTop: 6 }}>Nochmal</button>
                          </div>
                        ) : remix ? (
                          <div style={{ padding: '14px' }}>
                            <div style={{ fontSize: 9, fontWeight: 800, color: '#ee4f00', letterSpacing: '0.1em', marginBottom: 10 }}>
                              THOMAS' VERSION — {(remix.format || '').replace(/_/g,' ').toUpperCase()}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                              {remix.thomas_version}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button
                                onClick={() => navigator.clipboard.writeText(remix.thomas_version)}
                                className="btn btn-xs btn-primary"
                                style={{ flex: 1, justifyContent: 'center' }}
                              >Kopieren</button>
                              <button
                                onClick={() => navigate('/generator', { state: { topic: (post.caption || '').substring(0, 80), additionalInfo: remix.thomas_version, suggestedType: remix.format } })}
                                className="btn btn-xs"
                              >Im Generator →</button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
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
            <div className="section-header" style={{ marginBottom: 10 }}>
              <span className="section-title">Trending bei Competitors</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>letzte 30 Tage</span>
            </div>
            {trendingPosts.length === 0 ? (
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', padding: '32px', textAlign: 'center'
              }}>
                <p style={{ fontSize: 13, color: 'var(--text3)' }}>Keine Trending Posts. Füge Competitors hinzu und scrape sie.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trendingPosts.map(post => {
                  const id = post.id
                  const isOpen = compRemixOpen[id]
                  const isRemixing = compRemixing[id]
                  const remix = compRemixResults[id]
                  const PILLAR_C = { haltung: '#ee4f00', transformation: '#3b82f6', mehrwert: '#22c55e', verkauf: '#a855f7' }
                  const pc = PILLAR_C[post.content_pillar] || 'var(--text3)'
                  const caption = post.caption || post.transcript || ''
                  return (
                    <div key={id} style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      borderTop: '2px solid var(--border-strong)',
                      borderRadius: 'var(--r-lg)',
                      overflow: 'hidden',
                    }}>
                      {/* Post Info */}
                      <div style={{ padding: '12px 14px 10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                            @{post.competitor_username || '?'}
                          </span>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {post.views_count > 0 && (
                              <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
                                {formatNumber(post.views_count)}
                              </span>
                            )}
                            {post.content_pillar && (
                              <span style={{ fontSize: 8, fontWeight: 700, color: pc, background: `${pc}18`, padding: '2px 6px', borderRadius: 100 }}>
                                {post.content_pillar.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                        {caption && (
                          <p style={{
                            fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.5,
                            overflow: 'hidden', display: '-webkit-box',
                            WebkitLineClamp: isOpen ? 20 : 2, WebkitBoxOrient: 'vertical',
                            marginBottom: 10,
                          }}>
                            {caption}
                          </p>
                        )}
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            onClick={() => {
                              if (!remix && !isRemixing) remixCompetitorPost(post)
                              else setCompRemixOpen(prev => ({ ...prev, [id]: !prev[id] }))
                            }}
                            disabled={isRemixing}
                            className="btn btn-xs btn-primary"
                            style={{ flex: 1, justifyContent: 'center' }}
                          >
                            {isRemixing
                              ? <><span className="spinner" style={{ width: 9, height: 9 }} /> Baut um…</>
                              : remix
                                ? (isOpen ? '▲ Meine Version' : '▼ Meine Version')
                                : '⚡ Für meinen Feed'
                            }
                          </button>
                          <button
                            onClick={() => navigate('/generator', {
                              state: {
                                topic: caption.split(/[\n.!?]/)[0].trim().substring(0, 80) || `Post von @${post.competitor_username}`,
                                additionalInfo: `Top Post von @${post.competitor_username} | ${formatNumber(post.views_count)} Views\n${caption}`,
                                suggestedType: post.post_type === 'reel' ? 'video_script' : 'single_post',
                              }
                            })}
                            className="btn btn-xs"
                          >Generator</button>
                        </div>
                      </div>

                      {/* Thomas-Version aufgeklappt */}
                      {isOpen && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'rgba(238,79,0,0.04)' }}>
                          {isRemixing ? (
                            <div style={{ padding: '16px', textAlign: 'center' }}>
                              <span className="spinner" style={{ width: 16, height: 16 }} />
                              <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>Claude analysiert & schreibt um…</p>
                            </div>
                          ) : remix?.error ? (
                            <div style={{ padding: '12px 14px' }}>
                              <p style={{ fontSize: 11, color: '#ef4444' }}>Fehler: {remix.error}</p>
                              <button
                                onClick={() => { setCompRemixResults(prev => { const n = {...prev}; delete n[id]; return n }); remixCompetitorPost(post) }}
                                className="btn btn-xs" style={{ marginTop: 6 }}
                              >Nochmal</button>
                            </div>
                          ) : remix ? (
                            <div style={{ padding: '12px 14px' }}>
                              {remix.why_it_works && (
                                <div style={{ marginBottom: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 6, borderLeft: '2px solid var(--accent)' }}>
                                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 3 }}>WARUM ES FUNKTIONIERT</div>
                                  <p style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5, margin: 0 }}>{remix.why_it_works}</p>
                                </div>
                              )}
                              <div style={{ fontSize: 9, fontWeight: 800, color: '#ee4f00', letterSpacing: '0.1em', marginBottom: 8 }}>
                                THOMAS' VERSION — {(remix.format || '').replace(/_/g, ' ').toUpperCase()}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 10 }}>
                                {remix.thomas_version}
                              </div>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button
                                  onClick={() => navigator.clipboard.writeText(remix.thomas_version)}
                                  className="btn btn-xs btn-primary"
                                  style={{ flex: 1, justifyContent: 'center' }}
                                >Kopieren</button>
                                <button
                                  onClick={() => navigate('/generator', {
                                    state: { topic: caption.substring(0, 80), additionalInfo: remix.thomas_version, suggestedType: remix.format }
                                  })}
                                  className="btn btn-xs"
                                >Im Generator →</button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )
                })}
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
