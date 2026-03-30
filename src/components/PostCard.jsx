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
  if (d > 30) return new Date(dateStr).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' })
  if (d > 0) return `${d}d`
  if (h > 0) return `${h}h`
  return 'neu'
}

export default function PostCard({ post, compact = false }) {
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const sourceLabel = post.source === 'own' ? 'Eigen'
    : post.source === 'custom' ? 'Import'
    : `@${post.competitor_username || 'Competitor'}`

  const sourceBadgeColor = {
    own: '#ee4f00',
    competitor: '#60a5fa',
    custom: '#4ade80'
  }[post.source] || '#606060'

  const hasMedia = post.thumbnail_url
  const isVideo = post.post_type === 'reel' || post.post_type === 'video'

  return (
    <div style={{
      background: '#161616',
      border: '1px solid #1e1e1e',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', gap: 0 }}>
        {/* Thumbnail — kompaktes Quadrat links */}
        {hasMedia && (
          <div style={{
            position: 'relative', flexShrink: 0,
            width: 80, height: 80, background: '#111', overflow: 'hidden'
          }}>
            <img
              src={post.thumbnail_url} alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              loading="lazy"
              onError={e => (e.target.style.display = 'none')}
            />
            {isVideo && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,0,0,0.3)'
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <polygon points="5,3 19,12 5,21"/>
                </svg>
              </div>
            )}
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, padding: '10px 12px', minWidth: 0 }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sourceBadgeColor,
              background: `${sourceBadgeColor}18`, borderRadius: 4,
              padding: '2px 6px', letterSpacing: '0.02em', flexShrink: 0
            }}>{sourceLabel}</span>
            {post.post_type && (
              <span style={{ fontSize: 10, color: '#404040', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {post.post_type}
              </span>
            )}
            <span style={{ fontSize: 10, color: '#404040', marginLeft: 'auto', flexShrink: 0 }}>
              {timeAgo(post.published_at || post.scraped_at)}
            </span>
          </div>

          {/* Caption */}
          {post.caption && (
            <p style={{
              fontSize: 12, lineHeight: 1.5, color: '#b0b0b0',
              display: '-webkit-box',
              WebkitLineClamp: expanded ? 'none' : 2,
              WebkitBoxOrient: 'vertical',
              overflow: expanded ? 'visible' : 'hidden',
              marginBottom: 6,
            }}>
              {post.caption}
            </p>
          )}

          {/* Stats row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {post.likes_count > 0 && (
              <span style={{ fontSize: 12, color: '#606060', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="#606060" strokeWidth="2"/>
                </svg>
                {formatNumber(post.likes_count)}
              </span>
            )}
            {post.views_count > 0 && (
              <span style={{ fontSize: 12, color: '#606060', display: 'flex', alignItems: 'center', gap: 3 }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="#606060" strokeWidth="2"/>
                  <circle cx="12" cy="12" r="3" stroke="#606060" strokeWidth="2"/>
                </svg>
                {formatNumber(post.views_count)}
              </span>
            )}
            {post.transcript && (
              <button onClick={() => setTranscriptOpen(!transcriptOpen)} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: '#60a5fa', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', padding: 0, fontFamily: 'var(--font)', flexShrink: 0
              }}>
                {transcriptOpen ? 'Text ▲' : '🎤 Text'}
              </button>
            )}
            {!post.transcript && post.caption && post.caption.length > 80 && (
              <button onClick={() => setExpanded(!expanded)} style={{
                marginLeft: 'auto', background: 'none', border: 'none',
                color: '#505050', fontSize: 11, cursor: 'pointer',
                padding: 0, fontFamily: 'var(--font)', flexShrink: 0
              }}>
                {expanded ? '▲' : '▼'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Transcript */}
      {transcriptOpen && post.transcript && (
        <div style={{
          borderTop: '1px solid #1e1e1e',
          padding: '10px 12px',
          fontSize: 12, lineHeight: 1.6, color: '#808080',
          fontStyle: 'italic', background: '#111'
        }}>
          {post.transcript}
        </div>
      )}
    </div>
  )
}
