import { useState } from 'react'

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const d = Math.floor(diff / 86400000)
  const h = Math.floor(diff / 3600000)
  const m = Math.floor(diff / 60000)
  if (d > 30) return new Date(dateStr).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })
  if (d > 0) return `vor ${d}d`
  if (h > 0) return `vor ${h}h`
  if (m > 0) return `vor ${m}m`
  return 'gerade eben'
}

export default function PostCard({ post, compact = false }) {
  const [expanded, setExpanded] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  const sourceLabel = post.source === 'own'
    ? 'Eigener Post'
    : post.source === 'custom'
    ? 'Import'
    : `@${post.competitor_username || 'Competitor'}`

  const sourceBadgeStyle = {
    own: { background: 'rgba(238,79,0,0.12)', color: '#ee4f00' },
    competitor: { background: 'rgba(96,165,250,0.12)', color: '#60a5fa' },
    custom: { background: 'rgba(74,222,128,0.12)', color: '#4ade80' }
  }[post.source] || {}

  const engagementRate = post.followers_count && post.likes_count
    ? (((post.likes_count + (post.comments_count || 0)) / post.followers_count) * 100).toFixed(2)
    : null

  return (
    <div style={{
      background: '#161616',
      border: '1px solid #1e1e1e',
      borderRadius: 12,
      overflow: 'hidden',
      animation: 'fadeUp 0.2s ease forwards',
    }}>
      {/* Thumbnail */}
      {post.thumbnail_url && (
        <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: '#111' }}>
          <img
            src={post.thumbnail_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
            onError={e => e.target.style.display = 'none'}
          />
          {post.post_type === 'reel' || post.post_type === 'video' ? (
            <div style={{
              position: 'absolute', top: 8, right: 8,
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 100
            }}>REEL</div>
          ) : null}
        </div>
      )}

      <div style={{ padding: compact ? '12px' : '16px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="badge" style={{ fontSize: 11, ...sourceBadgeStyle }}>{sourceLabel}</span>
          {post.post_type && (
            <span style={{ fontSize: 11, color: '#505050', marginLeft: 'auto' }}>{post.post_type}</span>
          )}
          <span style={{ fontSize: 11, color: '#505050' }}>{timeAgo(post.published_at || post.scraped_at)}</span>
        </div>

        {/* Caption */}
        {post.caption && (
          <div style={{ marginBottom: 12 }}>
            <p style={{
              fontSize: 13, lineHeight: 1.55, color: '#c0c0c0',
              display: '-webkit-box', WebkitLineClamp: expanded ? 'none' : 3,
              WebkitBoxOrient: 'vertical', overflow: expanded ? 'visible' : 'hidden',
            }}>
              {post.caption}
            </p>
            {post.caption.length > 120 && (
              <button onClick={() => setExpanded(!expanded)} style={{
                background: 'none', border: 'none', color: '#ee4f00',
                fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0 0', fontFamily: 'var(--font)'
              }}>
                {expanded ? 'Weniger' : 'Mehr lesen'}
              </button>
            )}
          </div>
        )}

        {/* Stats */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#808080' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="#808080" strokeWidth="1.8" strokeLinejoin="round"/>
            </svg>
            {formatNumber(post.likes_count)}
          </span>
          {post.comments_count > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#808080' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="#808080" strokeWidth="1.8" strokeLinejoin="round"/>
              </svg>
              {formatNumber(post.comments_count)}
            </span>
          )}
          {post.views_count > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#808080' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="#808080" strokeWidth="1.8"/>
                <circle cx="12" cy="12" r="3" stroke="#808080" strokeWidth="1.8"/>
              </svg>
              {formatNumber(post.views_count)}
            </span>
          )}
          {engagementRate && (
            <span style={{ fontSize: 12, color: '#4ade80', marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              {engagementRate}% ER
            </span>
          )}
        </div>

        {/* Transcript Toggle */}
        {post.transcript && (
          <div style={{ marginTop: 12, borderTop: '1px solid #1e1e1e', paddingTop: 12 }}>
            <button onClick={() => setTranscriptOpen(!transcriptOpen)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'none', border: 'none', color: '#60a5fa',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'var(--font)'
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke="#60a5fa" strokeWidth="1.8"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke="#60a5fa" strokeWidth="1.8" strokeLinecap="round"/>
              </svg>
              Transkript {transcriptOpen ? 'schließen' : 'anzeigen'}
            </button>
            {transcriptOpen && (
              <p style={{
                marginTop: 8, fontSize: 12, lineHeight: 1.6,
                color: '#909090', fontStyle: 'italic',
                background: '#111', borderRadius: 8, padding: '10px 12px'
              }}>
                {post.transcript}
              </p>
            )}
          </div>
        )}

        {/* Instagram Link */}
        {post.url && (
          <a href={post.url} target="_blank" rel="noopener noreferrer" style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            marginTop: 10, fontSize: 11, color: '#505050', textDecoration: 'none'
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="#505050" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Instagram öffnen
          </a>
        )}
      </div>
    </div>
  )
}
