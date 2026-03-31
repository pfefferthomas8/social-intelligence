import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'

const W = 900
const H = 360
const CX = 450
const CY = 178

function formatNum(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const m = Math.floor(diff / 60000)
  const h = Math.floor(diff / 3600000)
  const d = Math.floor(diff / 86400000)
  if (d > 0) return `vor ${d}d`
  if (h > 0) return `vor ${h}h`
  if (m > 0) return `vor ${m}m`
  return 'gerade eben'
}

// Competitor-Positionen entlang des unteren Bogens
function getCompetitorPositions(count) {
  const RX = 265, RY = 132
  const startAngle = 38 * Math.PI / 180
  const endAngle = 142 * Math.PI / 180
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1)
    const angle = startAngle + (endAngle - startAngle) * t
    return {
      x: Math.round(CX + Math.cos(angle) * RX),
      y: Math.round(CY + Math.sin(angle) * RY),
    }
  })
}

// Abstand zwischen zwei Punkten → Particle-Geschwindigkeit
function edgeDuration(x1, y1, x2, y2, base = 1.6) {
  const d = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
  return (base + d / 400).toFixed(2)
}

// ─── SVG: Einzelner Outer-Node ───────────────────────────────────────────────
function OuterNode({ id, x, y, label, sublabel, color, isActive }) {
  const r = 22
  const isHandle = label.startsWith('@')
  // Handles: Initiale im Kreis, voller Name darunter
  // Zahlen: direkt im Kreis (kurz genug)
  const innerText = isHandle ? label[1].toUpperCase() : (label.length > 5 ? label.slice(0, 5) : label)
  return (
    <g>
      {/* Aktiv-Pulsring */}
      {isActive && (
        <circle cx={x} cy={y} r={r + 4} fill="none" stroke="#ee4f00" strokeWidth="1.5">
          <animate attributeName="r" values={`${r + 4};${r + 16};${r + 4}`} dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.8;0;0.8" dur="1.8s" repeatCount="indefinite" />
        </circle>
      )}
      {/* Glow */}
      <circle cx={x} cy={y} r={r + 10} fill={color} opacity="0.07" />
      {/* Ring */}
      <circle cx={x} cy={y} r={r} fill="#0e0e14" stroke={color} strokeWidth="1.5" opacity={isActive ? 1 : 0.75} />
      {/* Initiale oder Zahl im Kreis */}
      <text x={x} y={y + 4} textAnchor="middle" fill={color} fontSize={isHandle ? '12' : '11'} fontWeight="700" fontFamily="DM Mono, monospace">
        {innerText}
      </text>
      {/* Handle (@name) unterhalb des Kreises */}
      {isHandle && (
        <text x={x} y={y + r + 13} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize="9.5" fontFamily="DM Sans, sans-serif" fontWeight="600">
          {label.length > 14 ? label.slice(0, 13) + '…' : label}
        </text>
      )}
      {/* Sublabel */}
      <text
        x={x} y={isHandle ? y + r + 25 : y + r + 13}
        textAnchor="middle"
        fill="rgba(255,255,255,0.3)"
        fontSize="8.5"
        fontFamily="DM Sans, sans-serif"
        fontWeight="500"
      >
        {sublabel}
      </text>
    </g>
  )
}

// ─── SVG: Kern ────────────────────────────────────────────────────────────────
function CoreNode({ hasActiveJobs }) {
  return (
    <g>
      {/* Ambient Glow */}
      <circle cx={CX} cy={CY} r="110" fill="url(#glowGrad)" />
      {/* Pulse Rings */}
      {[0, 0.75, 1.5].map((delay, i) => (
        <circle key={i} cx={CX} cy={CY} r="36" fill="none" stroke="#ee4f00" strokeWidth="1">
          <animate attributeName="r" values="36;80;36" dur="2.4s" begin={`${delay}s`} repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.45;0;0.45" dur="2.4s" begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ))}
      {/* Outer ring */}
      <circle cx={CX} cy={CY} r="38" fill="#0e0e14" stroke="#ee4f00" strokeWidth="1.5" opacity="0.9" />
      {/* Inner ring */}
      <circle cx={CX} cy={CY} r="30" fill="none" stroke="#ee4f00" strokeWidth="0.5" opacity="0.35" />
      {/* Spinning dashes */}
      <circle
        cx={CX} cy={CY} r="34"
        fill="none"
        stroke="#ee4f00"
        strokeWidth="1"
        strokeDasharray="6 18"
        opacity="0.4"
      >
        <animateTransform attributeName="transform" type="rotate" from={`0 ${CX} ${CY}`} to={`360 ${CX} ${CY}`} dur="8s" repeatCount="indefinite" />
      </circle>
      {/* Core label */}
      <text x={CX} y={CY - 3} textAnchor="middle" fill="#ee4f00" fontSize="8" fontWeight="700" fontFamily="DM Mono, monospace" letterSpacing="2">
        AI CORE
      </text>
      <text x={CX} y={CY + 9} textAnchor="middle" fill="rgba(238,79,0,0.55)" fontSize="7" fontFamily="DM Sans, sans-serif" letterSpacing="1">
        {hasActiveJobs ? 'PROCESSING' : 'ACTIVE'}
      </text>
    </g>
  )
}

// ─── SVG: Verbindung + Partikel ───────────────────────────────────────────────
function Edge({ id, x1, y1, color, isActive }) {
  const dur1 = edgeDuration(x1, y1, CX, CY, 1.5)
  const dur2 = edgeDuration(x1, y1, CX, CY, 2.2)
  const pathId = `edge-${id}`
  return (
    <g>
      {/* Linie */}
      <path
        id={pathId}
        d={`M ${x1} ${y1} L ${CX} ${CY}`}
        stroke={color}
        strokeWidth={isActive ? 1.2 : 0.7}
        opacity={isActive ? 0.45 : 0.2}
        fill="none"
        strokeDasharray={isActive ? '4 3' : 'none'}
      >
        {isActive && (
          <animate attributeName="stroke-dashoffset" from="0" to="-14" dur="0.4s" repeatCount="indefinite" />
        )}
      </path>
      {/* Partikel 1 */}
      <circle r="2.5" fill={color} opacity="0.85">
        <animateMotion dur={`${dur1}s`} repeatCount="indefinite" begin="0s">
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>
      {/* Partikel 2 (kleiner, versetzt) */}
      <circle r="1.5" fill="white" opacity="0.5">
        <animateMotion dur={`${dur2}s`} repeatCount="indefinite" begin={`-${(parseFloat(dur2) * 0.55).toFixed(2)}s`}>
          <mpath href={`#${pathId}`} />
        </animateMotion>
      </circle>
      {/* Aktiv: extra schneller Partikel */}
      {isActive && (
        <circle r="3" fill="#ee4f00" opacity="0.9">
          <animateMotion dur="0.9s" repeatCount="indefinite" begin="0.2s">
            <mpath href={`#${pathId}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  )
}

// ─── SVG: Das Netz ────────────────────────────────────────────────────────────
function NeuralNetwork({ nodes, activeJobTargets }) {
  const hasActiveJobs = activeJobTargets.length > 0
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ee4f00" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#ee4f00" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Dot-Grid Hintergrund */}
      <defs>
        <pattern id="dotgrid" x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="14" cy="14" r="0.7" fill="rgba(255,255,255,0.055)" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#dotgrid)" />

      {/* Edges (zuerst, damit Nodes drüber liegen) */}
      {nodes.map(node => (
        <Edge
          key={node.id}
          id={node.id}
          x1={node.x}
          y1={node.y}
          color={node.color}
          isActive={node.isActive}
        />
      ))}

      {/* Outer Nodes */}
      {nodes.map(node => (
        <OuterNode key={node.id} {...node} />
      ))}

      {/* Core */}
      <CoreNode hasActiveJobs={hasActiveJobs} />
    </svg>
  )
}

// ─── Activity-Icon ────────────────────────────────────────────────────────────
function ActivityDot({ type }) {
  const colors = { scrape: '#3b82f6', content: '#a855f7', topic: '#eab308', job: '#ee4f00' }
  return (
    <div style={{
      width: 7, height: 7, borderRadius: '50%',
      background: colors[type] || '#555',
      flexShrink: 0, marginTop: 5
    }} />
  )
}

// ─── Brain Page ───────────────────────────────────────────────────────────────
export default function Brain() {
  const [stats, setStats] = useState({ posts: 0, topics: 0, content: 0, ownPosts: 0, competitorPosts: 0 })
  const [ownProfile, setOwnProfile] = useState(null)
  const [competitors, setCompetitors] = useState([])
  const [activeJobs, setActiveJobs] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    const interval = setInterval(loadJobs, 5000)
    return () => clearInterval(interval)
  }, [])

  async function loadAll() {
    await Promise.all([loadStats(), loadProfiles(), loadJobs(), loadActivity()])
    setLoading(false)
  }

  async function loadStats() {
    const [total, own, comp, topics, content] = await Promise.all([
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }),
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }).eq('source', 'own'),
      supabase.from('instagram_posts').select('id', { count: 'exact', head: true }).eq('source', 'competitor'),
      supabase.from('topic_suggestions').select('id', { count: 'exact', head: true }),
      supabase.from('generated_content').select('id', { count: 'exact', head: true }),
    ])
    setStats({
      posts: total.count || 0,
      ownPosts: own.count || 0,
      competitorPosts: comp.count || 0,
      topics: topics.count || 0,
      content: content.count || 0,
    })
  }

  async function loadProfiles() {
    const { data: own } = await supabase.from('own_profile').select('*').limit(1).maybeSingle()
    setOwnProfile(own)
    const { data: comp } = await supabase
      .from('competitor_profiles').select('*')
      .eq('is_active', true).order('followers_count', { ascending: false })
    setCompetitors(comp || [])
  }

  async function loadJobs() {
    const { data } = await supabase
      .from('scrape_jobs').select('*')
      .eq('status', 'running').order('started_at', { ascending: false })
    setActiveJobs(data || [])
  }

  async function loadActivity() {
    const [jobs, content, topics] = await Promise.all([
      supabase.from('scrape_jobs').select('target, result_count, completed_at, job_type')
        .eq('status', 'done').order('completed_at', { ascending: false }).limit(6),
      supabase.from('generated_content').select('topic, content_type, created_at')
        .order('created_at', { ascending: false }).limit(4),
      supabase.from('topic_suggestions').select('title, created_at')
        .order('created_at', { ascending: false }).limit(4),
    ])
    const events = []
    for (const j of (jobs.data || [])) {
      if (j.completed_at) events.push({ type: 'scrape', label: `${j.result_count} Posts von @${j.target} analysiert`, time: j.completed_at, icon: '⬇' })
    }
    for (const c of (content.data || [])) {
      events.push({ type: 'content', label: `Content erstellt: „${c.topic}"`, time: c.created_at, icon: '✦' })
    }
    for (const t of (topics.data || [])) {
      events.push({ type: 'topic', label: `Thema erkannt: „${t.title}"`, time: t.created_at, icon: '◎' })
    }
    events.sort((a, b) => new Date(b.time) - new Date(a.time))
    setActivity(events.slice(0, 10))
  }

  // Nodes aufbauen
  const compPositions = getCompetitorPositions(competitors.length)
  const activeJobTargets = activeJobs.map(j => j.target)

  const nodes = [
    {
      id: 'own',
      x: 155, y: 72,
      label: ownProfile ? `@${ownProfile.username}` : '—',
      sublabel: 'Eigenes Profil',
      color: '#3b82f6',
      isActive: activeJobTargets.includes(ownProfile?.username),
    },
    {
      id: 'posts',
      x: 450, y: 35,
      label: String(stats.posts),
      sublabel: 'Posts in DB',
      color: '#22c55e',
      isActive: false,
    },
    {
      id: 'topics',
      x: 745, y: 72,
      label: String(stats.topics),
      sublabel: 'Themenvorschläge',
      color: '#eab308',
      isActive: false,
    },
    {
      id: 'content',
      x: 828, y: 178,
      label: String(stats.content),
      sublabel: 'Generierter Content',
      color: '#a855f7',
      isActive: false,
    },
    ...competitors.map((c, i) => ({
      id: `comp-${c.id}`,
      x: compPositions[i]?.x ?? CX,
      y: compPositions[i]?.y ?? CY + 140,
      label: `@${c.username}`,
      sublabel: formatNum(c.followers_count) + ' Follower',
      color: '#ee4f00',
      isActive: activeJobTargets.includes(c.username),
    })),
  ]

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
          <div className="page-title">Brain</div>
          <div className="page-subtitle">Wie das System denkt, lernt und Verbindungen zieht</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeJobs.length > 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px',
              background: 'rgba(238,79,0,0.1)',
              border: '1px solid rgba(238,79,0,0.3)',
              borderRadius: 100,
            }}>
              <span className="spinner" style={{ width: 8, height: 8, borderColor: 'rgba(238,79,0,0.3)', borderTopColor: '#ee4f00' }} />
              <span style={{ fontSize: 11, color: '#ee4f00', fontWeight: 700, letterSpacing: '0.04em' }}>
                {activeJobs.length} WORKFLOW AKTIV
              </span>
            </div>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '4px 12px',
              background: 'rgba(34,197,94,0.08)',
              border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 100,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
              </div>
              <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, letterSpacing: '0.04em' }}>IDLE</span>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="page-body">

        {/* ── NEURAL NETWORK ─────────────────────────────────────────────── */}
        <div style={{
          height: 'calc(50vh - 28px)',
          minHeight: 280,
          maxHeight: 440,
          background: '#08080e',
          border: '1px solid #1a1a2e',
          borderRadius: 'var(--r-xl)',
          overflow: 'hidden',
          marginBottom: 24,
          position: 'relative',
        }}>
          {/* Subtle corner label */}
          <div style={{
            position: 'absolute', top: 12, left: 16,
            fontSize: 9, fontWeight: 700, letterSpacing: '0.15em',
            color: 'rgba(255,255,255,0.12)', fontFamily: 'DM Mono, monospace',
            zIndex: 1,
          }}>
            NEURAL MAP v1
          </div>
          <div style={{
            position: 'absolute', top: 12, right: 16,
            fontSize: 9, color: 'rgba(238,79,0,0.4)', fontFamily: 'DM Mono, monospace',
            letterSpacing: '0.1em', zIndex: 1,
          }}>
            {nodes.length} NODES · {nodes.length} EDGES
          </div>
          <NeuralNetwork nodes={nodes} activeJobTargets={activeJobTargets} />
        </div>

        {/* ── STATS ROW ──────────────────────────────────────────────────── */}
        <div className="stat-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-label">Posts analysiert</div>
            <div className="stat-value" style={{ color: '#22c55e' }}>{formatNum(stats.posts)}</div>
            <div className="stat-sub">{stats.ownPosts} eigene · {stats.competitorPosts} Competitor</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Themenvorschläge</div>
            <div className="stat-value" style={{ color: '#eab308' }}>{stats.topics}</div>
            <div className="stat-sub">aus Pattern-Analyse</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Content generiert</div>
            <div className="stat-value" style={{ color: '#a855f7' }}>{stats.content}</div>
            <div className="stat-sub">Scripts, Karussells, Posts</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Datenquellen</div>
            <div className="stat-value">{1 + competitors.length}</div>
            <div className="stat-sub">1 eigenes · {competitors.length} Competitors</div>
          </div>
        </div>

        {/* ── ZWEI SPALTEN ───────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, minWidth: 0 }}>

          {/* Lernquellen */}
          <div style={{ minWidth: 0 }}>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <span className="section-title">Lernquellen</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>{1 + competitors.length} Profile</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

              {/* Eigenes Profil */}
              {ownProfile && (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid #1e2340',
                  borderRadius: 'var(--r)', padding: '12px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(59,130,246,0.1)', border: '1.5px solid rgba(59,130,246,0.4)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 14, flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4" fill="#3b82f6" />
                      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#3b82f6" opacity="0.6" />
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#3b82f6' }}>@{ownProfile.username}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                      {formatNum(ownProfile.followers_count)} Follower · {stats.ownPosts} Posts
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: 'rgba(59,130,246,0.7)', fontWeight: 700, background: 'rgba(59,130,246,0.1)', padding: '2px 7px', borderRadius: 100 }}>
                    EIGENES
                  </div>
                </div>
              )}

              {/* Competitors */}
              {competitors.map(c => {
                const isActive = activeJobTargets.includes(c.username)
                return (
                  <div key={c.id} style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${isActive ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                    borderRadius: 'var(--r)', padding: '12px 14px',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      background: isActive ? 'rgba(238,79,0,0.15)' : 'rgba(238,79,0,0.07)',
                      border: `1.5px solid ${isActive ? 'rgba(238,79,0,0.5)' : 'rgba(238,79,0,0.25)'}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0, fontSize: 12, color: '#ee4f00', fontWeight: 700,
                    }}>
                      {c.username[0].toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        @{c.username}
                        {isActive && <span className="spinner" style={{ width: 8, height: 8, borderColor: 'rgba(238,79,0,0.3)', borderTopColor: '#ee4f00' }} />}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                        {formatNum(c.followers_count)} Follower · zuletzt {timeAgo(c.last_scraped_at)}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10, fontWeight: 700,
                      color: isActive ? '#ee4f00' : 'var(--text3)',
                      background: isActive ? 'rgba(238,79,0,0.1)' : 'rgba(255,255,255,0.04)',
                      padding: '2px 7px', borderRadius: 100,
                    }}>
                      {isActive ? 'SCRAPING' : 'IDLE'}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Was das Brain versteht */}
            <div style={{ marginTop: 20 }}>
              <div className="section-header" style={{ marginBottom: 12 }}>
                <span className="section-title">Was das Brain versteht</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { label: 'Hook-Formate & Opener', detail: 'aus Captions & Transcripts', color: '#ee4f00' },
                  { label: 'Engagement-Muster', detail: 'Likes, Views, Comments', color: '#22c55e' },
                  { label: 'Content-Lücken', detail: 'was Competitors nicht posten', color: '#3b82f6' },
                  { label: 'Trending Themen', detail: 'letzte 30 Tage', color: '#eab308' },
                  { label: 'Bild & Reel Inhalte', detail: 'via OCR & Transkription', color: '#a855f7' },
                ].map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '9px 12px',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                  }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)' }}>{item.label}</span>
                      <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>{item.detail}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Aktivitäts-Log */}
          <div style={{ minWidth: 0 }}>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <span className="section-title">Aktivitäts-Log</span>
              <span style={{ fontSize: 11, color: 'var(--text3)' }}>letzte Ereignisse</span>
            </div>

            {/* Aktive Jobs */}
            {activeJobs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {activeJobs.map(job => (
                  <div key={job.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 14px', marginBottom: 6,
                    background: 'rgba(238,79,0,0.06)',
                    border: '1px solid rgba(238,79,0,0.25)',
                    borderRadius: 'var(--r)',
                  }}>
                    <span className="spinner" style={{ width: 10, height: 10, borderColor: 'rgba(238,79,0,0.25)', borderTopColor: '#ee4f00', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#ee4f00' }}>
                        Scraping @{job.target}
                      </span>
                      <span style={{ fontSize: 11, color: 'rgba(238,79,0,0.6)', marginLeft: 8 }}>
                        läuft seit {timeAgo(job.started_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Timeline */}
            <div style={{ position: 'relative' }}>
              {/* Vertikale Linie */}
              <div style={{
                position: 'absolute', left: 15, top: 0, bottom: 0,
                width: 1, background: 'var(--border)',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {activity.length === 0 ? (
                  <div className="empty-state">
                    <p className="empty-state-text">Noch keine Aktivität</p>
                  </div>
                ) : activity.map((event, i) => (
                  <div key={i} style={{
                    display: 'flex', gap: 12, paddingLeft: 2,
                    paddingBottom: i < activity.length - 1 ? 16 : 0,
                  }}>
                    {/* Dot auf der Linie */}
                    <div style={{
                      width: 28, flexShrink: 0, display: 'flex',
                      justifyContent: 'center', paddingTop: 4, position: 'relative',
                    }}>
                      <ActivityDot type={event.type} />
                    </div>
                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{
                        fontSize: 12, color: 'var(--text2)', lineHeight: 1.45,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                      }}>
                        {event.label}
                      </p>
                      <span style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, display: 'block' }}>
                        {timeAgo(event.time)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Bottom padding */}
        <div style={{ height: 24 }} />
      </div>
    </div>
  )
}
