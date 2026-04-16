import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'

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
  const [competitors, setCompetitors] = useState([])
  const [stats, setStats] = useState({ totalPosts: 0, generatedContent: 0 })
  const [pillars, setPillars] = useState({ haltung: 0, transformation: 0, mehrwert: 0, verkauf: 0 })
  const [loading, setLoading] = useState(true)
  const [scrapeLoading, setScrapeLoading] = useState(false)

  // Trend Scout Scan (nur noch als Hintergrund-Trigger)
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendStatus, setTrendStatus] = useState('')
  const [trendElapsed, setTrendElapsed] = useState(0)
  const [lastTrendRun, setLastTrendRun] = useState(null)
  const trendPollRef = useRef(null)
  const trendTimerRef = useRef(null)

  // Content Intelligence — 6 datengetriebene Posts (persistent via localStorage)
  const [dashPosts, setDashPosts] = useState(() => {
    try { return JSON.parse(localStorage.getItem('si_dashPosts') || '[]') } catch { return [] }
  })
  const [dashLoading, setDashLoading] = useState(false)
  const [dashCopied, setDashCopied] = useState({})
  const [dashExpanded, setDashExpanded] = useState({})
  const [genSteps, setGenSteps] = useState(() => {
    try { return JSON.parse(localStorage.getItem('si_genSteps') || '[]') } catch { return [] }
  })
  const genStepsRef = useRef(genSteps)

  // Quick-Generator
  const [quickOpen, setQuickOpen] = useState(false)
  const [quickTopic, setQuickTopic] = useState('')
  const [quickType, setQuickType] = useState('b_roll')
  const [quickGenerating, setQuickGenerating] = useState(false)
  const [quickResult, setQuickResult] = useState(null)
  const [quickCopied, setQuickCopied] = useState(false)
  const quickInputRef = useRef(null)


  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    await Promise.all([loadProfile(), loadPosts(), loadCompetitors(), loadStats(), loadPillars(), loadLastTrendRun()])
    setLoading(false)
  }

  async function loadProfile() {
    const { data } = await supabase.from('own_profile').select('*').limit(1).maybeSingle()
    setOwnProfile(data)
  }

  async function loadPosts() {
    const { data } = await supabase.from('instagram_posts').select('*').eq('source', 'own').order('views_count', { ascending: false }).limit(6)
    setTopOwnPosts(data || [])
  }

  async function loadCompetitors() {
    const { data } = await supabase.from('competitor_profiles').select('*').eq('is_active', true).order('followers_count', { ascending: false })
    setCompetitors(data || [])
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
    const results = await Promise.all(
      names.map(p => supabase.from('instagram_posts').select('id', { count: 'exact', head: true }).eq('source', 'own').eq('content_pillar', p))
    )
    setPillars(Object.fromEntries(names.map((n, i) => [n, results[i].count || 0])))
  }

  async function loadLastTrendRun() {
    const { data } = await supabase
      .from('scrape_jobs')
      .select('completed_at, started_at')
      .eq('job_type', 'trend_discovery')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setLastTrendRun(data?.completed_at || data?.started_at || null)
  }

  function stopTrendPolling() {
    if (trendPollRef.current) clearInterval(trendPollRef.current)
    if (trendTimerRef.current) clearInterval(trendTimerRef.current)
    trendPollRef.current = null
    trendTimerRef.current = null
  }

  useEffect(() => () => stopTrendPolling(), [])

  async function runTrendScan() {
    setTrendLoading(true)
    setTrendStatus('waiting')
    setTrendElapsed(0)
    stopTrendPolling()
    try {
      await apiFetch('trend-discovery', { method: 'POST' })
      let elapsed = 0
      trendTimerRef.current = setInterval(() => { elapsed += 1; setTrendElapsed(elapsed) }, 1000)
      trendPollRef.current = setInterval(async () => {
        try {
          const { data: job } = await supabase
            .from('scrape_jobs').select('status, error_msg, completed_at')
            .eq('job_type', 'trend_discovery').order('started_at', { ascending: false }).limit(1).maybeSingle()
          if (!job) return
          if (job.status === 'done') {
            stopTrendPolling(); setTrendLoading(false); setTrendStatus('done')
            setLastTrendRun(job.completed_at || new Date().toISOString())
          } else if (job.status === 'error') {
            stopTrendPolling(); setTrendLoading(false); setTrendStatus('error')
            alert('Trend Scan Fehler: ' + (job.error_msg || 'Unbekannt'))
          } else if (job.status === 'running') {
            setTrendStatus('processing')
          }
          if (elapsed >= 720) { stopTrendPolling(); setTrendLoading(false); setTrendStatus('error') }
        } catch { /* weiter */ }
      }, 20000)
    } catch (e) {
      stopTrendPolling(); setTrendLoading(false); setTrendStatus('')
      alert('Fehler: ' + e.message)
    }
  }

  function pushStep(text) {
    const id = Date.now() + Math.random()
    genStepsRef.current = [...genStepsRef.current, { id, text, status: 'running', detail: '' }]
    setGenSteps([...genStepsRef.current])
    localStorage.setItem('si_genSteps', JSON.stringify(genStepsRef.current))
    return id
  }
  function doneStep(id, detail = '') {
    genStepsRef.current = genStepsRef.current.map(s => s.id === id ? { ...s, status: 'done', detail } : s)
    setGenSteps([...genStepsRef.current])
    localStorage.setItem('si_genSteps', JSON.stringify(genStepsRef.current))
  }
  function errorStep(id, detail = '') {
    genStepsRef.current = genStepsRef.current.map(s => s.id === id ? { ...s, status: 'error', detail } : s)
    setGenSteps([...genStepsRef.current])
    localStorage.setItem('si_genSteps', JSON.stringify(genStepsRef.current))
  }

  async function generateDashboardPosts() {
    setDashLoading(true)
    setDashPosts([])
    setDashCopied({})
    setDashExpanded({})
    localStorage.removeItem('si_dashPosts')
    localStorage.removeItem('si_genSteps')
    genStepsRef.current = []
    setGenSteps([])

    try {
      // Schritt 1: Datenstand aus DB laden
      const s1 = pushStep('Daten aus Datenbank laden…')
      const [trendR, compR, ownR, dnaR, sigR, transcriptR, pendingR] = await Promise.all([
        supabase.from('trend_posts').select('*', { count: 'exact', head: true }),
        supabase.from('instagram_posts').select('*', { count: 'exact', head: true }).eq('source', 'competitor'),
        supabase.from('instagram_posts').select('*', { count: 'exact', head: true }).eq('source', 'own'),
        supabase.from('thomas_dna').select('*', { count: 'exact', head: true }),
        supabase.from('external_signals').select('*', { count: 'exact', head: true }).gte('relevance_score', 70),
        supabase.from('instagram_posts').select('*', { count: 'exact', head: true }).eq('transcript_status', 'done'),
        supabase.from('instagram_posts').select('*', { count: 'exact', head: true }).eq('transcript_status', 'pending'),
      ])
      doneStep(s1,
        `${trendR.count || 0} Trend-Posts · ${compR.count || 0} Competitor-Posts · ${ownR.count || 0} eigene Posts · ${dnaR.count || 0} DNA-Insights · ${sigR.count || 0} Signale`)

      // Schritt 2: Transcript-Status anzeigen
      const transcriptDone = transcriptR.count || 0
      const transcriptPending = pendingR.count || 0
      const s2 = pushStep('Video-Transkripte prüfen…')
      doneStep(s2, `${transcriptDone} Reels transkribiert · ${transcriptPending} Videos ausstehend`)

      // Schritt 3: Videos herunterladen wenn ausstehend (fire & forget)
      if (transcriptPending > 0) {
        const s3 = pushStep(`${Math.min(transcriptPending, 10)} Videos für Transkription herunterladen…`)
        apiFetch('download-videos', { method: 'POST', body: JSON.stringify({ limit: 10 }) })
          .then(r => doneStep(s3, `${r.downloaded || 0} heruntergeladen · ${r.submitted_to_assemblyai || 0} an AssemblyAI übergeben`))
          .catch(() => doneStep(s3, 'läuft im Hintergrund'))
      }

      // Schritt 4: Claude
      const s4 = pushStep('Claude analysiert alle Daten und generiert 6 Ideen…')
      const data = await apiFetch('generate-dashboard-posts', { method: 'POST' })
      doneStep(s4, `6 Ideen generiert · ${new Date().toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })} Uhr`)

      const posts = data.posts || []
      setDashPosts(posts)
      localStorage.setItem('si_dashPosts', JSON.stringify(posts))
    } catch (e) {
      const lastStep = genStepsRef.current.findLast?.(s => s.status === 'running')
      if (lastStep) errorStep(lastStep.id, e.message)
      else alert('Fehler: ' + e.message)
    } finally {
      setDashLoading(false)
    }
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

  async function refreshOwnProfile() {
    if (!ownProfile?.username) return
    setScrapeLoading(true)
    try {
      await apiFetch('scrape-profile', { method: 'POST', body: JSON.stringify({ username: ownProfile.username, source: 'own' }) })
      setTimeout(loadAll, 2000)
    } catch (e) { alert('Scrape fehlgeschlagen: ' + e.message) }
    finally { setScrapeLoading(false) }
  }

  const engRate = ownProfile && topOwnPosts.length > 0
    ? (topOwnPosts.reduce((s, p) => s + ((p.likes_count || 0) + (p.comments_count || 0)), 0) / topOwnPosts.length / (ownProfile.followers_count || 1) * 100).toFixed(2)
    : null

  const PILLAR_LABELS = { haltung: 'Haltung', mehrwert: 'Mehrwert', transformation: 'Transformation', verkauf: 'Verkauf' }
  const PILLAR_COLORS = { haltung: '#ee4f00', mehrwert: '#22c55e', transformation: '#3b82f6', verkauf: '#a855f7' }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', minWidth: 0 }}>

      {/* Quick-Generator Overlay */}
      {quickOpen && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setQuickOpen(false); setQuickResult(null) } }}
        >
          <div style={{ background: 'var(--bg-card)', borderRadius: '16px 16px 0 0', padding: '24px 24px 32px', width: '100%', maxWidth: 600, borderTop: '1px solid var(--border)', boxShadow: '0 -20px 60px rgba(0,0,0,0.6)' }}>
            <div style={{ width: 32, height: 3, background: 'var(--border)', borderRadius: 2, margin: '0 auto 20px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>Quick Generator</span>
              <button onClick={() => { setQuickOpen(false); setQuickResult(null) }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
            {!quickResult ? (
              <>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                  {[{ key: 'b_roll', label: '⚡ B-Roll' }, { key: 'single_post', label: '📝 Single Post' }, { key: 'video_script', label: '🎬 Script' }, { key: 'carousel', label: '📋 Karussell' }].map(t => (
                    <button key={t.key} onClick={() => setQuickType(t.key)} className="btn btn-sm"
                      style={{ background: quickType === t.key ? 'var(--accent)' : 'var(--bg)', color: quickType === t.key ? '#fff' : 'var(--text3)', border: `1px solid ${quickType === t.key ? 'var(--accent)' : 'var(--border)'}`, flex: 1, justifyContent: 'center', fontSize: 11 }}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <input ref={quickInputRef} value={quickTopic} onChange={e => setQuickTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && generateQuick()}
                  placeholder="Thema eingeben…"
                  style={{ width: '100%', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', color: 'var(--text)', fontSize: 14, marginBottom: 12, boxSizing: 'border-box', outline: 'none' }} />
                <button onClick={generateQuick} disabled={quickGenerating || !quickTopic.trim()} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '12px' }}>
                  {quickGenerating ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Generiert…</> : '⚡ Generieren'}
                </button>
              </>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Fertig</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setQuickResult(null)} className="btn btn-sm">Neu</button>
                    <button onClick={() => { navigate('/generator', { state: { topic: quickTopic, suggestedType: quickType } }); setQuickOpen(false) }} className="btn btn-sm">Im Generator →</button>
                  </div>
                </div>
                <div style={{ background: 'var(--bg)', borderRadius: 10, padding: 14, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)' }}>
                  {quickResult.content}
                </div>
                <button onClick={() => { navigator.clipboard.writeText(quickResult.content); setQuickCopied(true); setTimeout(() => setQuickCopied(false), 2000) }}
                  className="btn btn-sm" style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}>
                  {quickCopied ? '✓ Kopiert' : 'Kopieren'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Quick-Generator Button */}
      <button onClick={() => openQuick()} style={{ position: 'fixed', bottom: 28, right: 24, zIndex: 100, width: 52, height: 52, borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 24, boxShadow: '0 4px 20px rgba(238,79,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(238,79,0,0.65)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(238,79,0,0.5)' }}
        title="Quick Generator">⚡</button>

      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-subtitle">{ownProfile ? `@${ownProfile.username}` : 'Kein Profil konfiguriert'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={() => navigate('/konkurrenten')} className="btn btn-sm">+ Competitor</button>
          <button onClick={refreshOwnProfile} disabled={scrapeLoading || !ownProfile} className="btn btn-sm">
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

        {/* Stats */}
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Follower</div>
            <div className="stat-value">{formatNumber(ownProfile?.followers_count)}</div>
            <div className="stat-sub">@{ownProfile?.username || '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Engagement Rate</div>
            <div className="stat-value" style={{ color: engRate ? '#22c55e' : 'var(--text3)', fontSize: 24 }}>{engRate ? `${engRate}%` : '—'}</div>
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
              <span onClick={() => navigate('/generator')} style={{ color: 'var(--accent)', cursor: 'pointer', fontSize: 11 }}>Neu erstellen →</span>
            </div>
          </div>
        </div>

        {/* Content Intelligence — 6 datengetriebene Posts */}
        <div style={{ marginBottom: 24 }}>
          <div className="section-header" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="section-title">Content Intelligence</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#ee4f00', background: 'rgba(238,79,0,0.1)', padding: '2px 7px', borderRadius: 100 }}>DATENGETRIEBEN</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {/* Trend Scan als kleiner Hintergrund-Button */}
              <button onClick={runTrendScan} disabled={trendLoading} className="btn btn-xs"
                title={lastTrendRun ? `Letzter Scan: ${timeAgo(lastTrendRun)}` : 'Noch kein Scan'}>
                {trendLoading
                  ? <><span className="spinner" style={{ width: 9, height: 9 }} /> {Math.floor(trendElapsed / 60)}:{String(trendElapsed % 60).padStart(2, '0')}</>
                  : `↺ Trends${lastTrendRun ? ' · ' + timeAgo(lastTrendRun) : ''}`
                }
              </button>
              <button onClick={generateDashboardPosts} disabled={dashLoading} className="btn btn-sm btn-primary">
                {dashLoading
                  ? <><span className="spinner" style={{ width: 12, height: 12 }} /> Analysiert…</>
                  : dashPosts.length > 0 ? '↺ Neu generieren' : '⚡ 6 Posts generieren'
                }
              </button>
            </div>
          </div>

          {/* Status-Log: läuft während Generierung und bleibt danach stehen */}
          {genSteps.length > 0 && (
            <div style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 14, fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              {genSteps.map(step => (
                <div key={step.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                  <span style={{ flexShrink: 0, width: 14, color: step.status === 'done' ? '#22c55e' : step.status === 'error' ? '#ef4444' : 'var(--accent)', marginTop: 1 }}>
                    {step.status === 'done' ? '✓' : step.status === 'error' ? '✗' : <span className="spinner" style={{ width: 9, height: 9, display: 'inline-block' }} />}
                  </span>
                  <span style={{ color: step.status === 'done' ? 'var(--text3)' : step.status === 'error' ? '#ef4444' : 'var(--text2)', flex: 1 }}>
                    {step.text}
                    {step.detail && <span style={{ color: step.status === 'error' ? '#ef4444' : 'var(--text4)', marginLeft: 6 }}>— {step.detail}</span>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {dashPosts.length === 0 && !dashLoading && genSteps.length === 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-strong)', borderRadius: 'var(--r-lg)', padding: '40px', textAlign: 'center' }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text2)', marginBottom: 6 }}>6 datengetriebene Content-Ideen</p>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, maxWidth: 420, margin: '0 auto 16px' }}>
                Claude analysiert Trends, Competitor-Posts und Community-Signale und erstellt 12 Post-Ideen mit Quellenangabe und Viral-Score.
              </p>
              <button onClick={generateDashboardPosts} className="btn btn-sm btn-primary">⚡ Jetzt generieren</button>
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
                  <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderTop: `2px solid ${pc}`, borderRadius: 'var(--r-lg)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '12px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Format + Pillar + Score */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{FORMAT_ICON[post.format]} {post.format?.replace(/_/g, ' ')}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: pc, background: `${pc}18`, padding: '2px 6px', borderRadius: 100, marginLeft: 'auto' }}>{post.pillar?.toUpperCase()}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor, fontFamily: 'var(--font-mono)' }}>{post.score}</span>
                      </div>
                      {/* Hook */}
                      <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, margin: 0 }}>{post.hook}</p>
                      {/* Preview */}
                      <p style={{ fontSize: 11.5, color: 'var(--text2)', lineHeight: 1.55, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: isExp ? 20 : 3, WebkitBoxOrient: 'vertical' }}>
                        {post.preview}
                      </p>
                      {/* Datengrundlage */}
                      {post.sources?.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text4)', letterSpacing: '0.08em' }}>DATENGRUNDLAGE</div>
                          {post.sources.map((s, si) => {
                            const isTrend = s.ref?.startsWith('T')
                            const isSignal = s.ref?.startsWith('S')
                            const bg = isTrend ? 'rgba(238,79,0,0.12)' : isSignal ? 'rgba(255,69,0,0.12)' : 'rgba(59,130,246,0.12)'
                            const color = isTrend ? '#ee4f00' : isSignal ? '#ff6b35' : '#3b82f6'
                            const label = isTrend ? 'TREND' : isSignal ? 'COMMUNITY' : 'COMP'
                            return (
                              <div key={si} style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
                                <span style={{ fontSize: 8, fontWeight: 700, padding: '2px 5px', borderRadius: 4, background: bg, color, flexShrink: 0, marginTop: 1 }}>{label}</span>
                                <span style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.4 }}>{s.label}</span>
                              </div>
                            )
                          })}
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
                      <button onClick={() => navigate('/generator', { state: { topic: post.hook, suggestedType: post.format, additionalInfo: post.preview } })}
                        className="btn btn-xs btn-primary" style={{ flex: 1, justifyContent: 'center' }}>Im Generator →</button>
                      <button onClick={() => { navigator.clipboard.writeText(`${post.hook}\n\n${post.preview}`); setDashCopied(prev => ({ ...prev, [i]: true })); setTimeout(() => setDashCopied(prev => ({ ...prev, [i]: false })), 2000) }}
                        className="btn btn-xs">{isCopied ? '✓' : 'Copy'}</button>
                      <button onClick={() => setDashExpanded(prev => ({ ...prev, [i]: !prev[i] }))} className="btn btn-xs">{isExp ? '▲' : '▼'}</button>
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
            { key: 'haltung', label: 'Haltung', sub: 'Mindset · Werte', color: '#ee4f00' },
            { key: 'transformation', label: 'Transformation', sub: 'Story · Vorher/Nachher', color: '#3b82f6' },
            { key: 'mehrwert', label: 'Mehrwert', sub: 'Tipps · Wissen', color: '#22c55e' },
            { key: 'verkauf', label: 'Verkauf', sub: 'Coaching · USPs', color: '#a855f7' },
          ]
          return (
            <div style={{ marginBottom: 24 }}>
              <div className="section-header" style={{ marginBottom: 14 }}>
                <span className="section-title">Content Säulen</span>
                <span style={{ fontSize: 11, color: 'var(--text3)' }}>eigene Posts</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                {PILLAR_CONFIG.map(p => {
                  const count = pillars[p.key] || 0
                  const pct = total > 0 ? Math.round(count / total * 100) : 0
                  const isWeak = total > 10 && pct < 15
                  return (
                    <div key={p.key} style={{ background: 'var(--bg-card)', border: `1px solid ${isWeak ? 'rgba(239,68,68,0.25)' : 'var(--border)'}`, borderRadius: 'var(--r-lg)', padding: '16px', position: 'relative', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: p.color, opacity: 0.7 }} />
                      <div style={{ fontSize: 11, fontWeight: 700, color: p.color, letterSpacing: '0.04em', marginBottom: 2 }}>{p.label.toUpperCase()}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginBottom: 10 }}>{p.sub}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text)', lineHeight: 1, marginBottom: 8 }}>
                        {count}<span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 4 }}>Posts</span>
                      </div>
                      <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 6 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: p.color, borderRadius: 2, transition: 'width 0.6s ease', opacity: 0.8 }} />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: 'var(--text3)' }}>{pct}%</span>
                        {isWeak && <span style={{ fontSize: 9, fontWeight: 700, color: '#ef4444', letterSpacing: '0.05em' }}>AUFHOLEN</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {/* Competitors Tabelle */}
        {competitors.length > 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="section-title">Competitors</span>
              <button onClick={() => navigate('/konkurrenten')} className="btn btn-xs btn-ghost">Alle anzeigen →</button>
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

        {/* Kein Profil */}
        {!ownProfile && (
          <div style={{ background: 'var(--accent-dim)', border: '1px solid rgba(238,79,0,0.2)', borderRadius: 'var(--r-lg)', padding: '24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
