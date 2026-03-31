import { useState } from 'react'

function formatNumber(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

export default function PostCard({ post, compact, onClick }) {
  const sourceLabel = post.source === 'own' ? 'Eigener Post' : post.competitor_username ? `@${post.competitor_username}` : 'Import'
  const sourceColor = post.source === 'own' ? 'var(--green)' : post.source === 'custom' ? 'var(--blue)' : 'var(--text3)'

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: compact ? '10px 14px' : '14px',
        display: 'flex',
        gap: 12,
        transition: 'border-color 0.12s',
        cursor: onClick ? 'pointer' : 'default',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; if (onClick) e.currentTarget.style.background = 'var(--bg-card-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)' }}
    >
      {/* Thumbnail */}
      {post.thumbnail_url && !compact && (
        <div style={{
          width: 64, height: 64, borderRadius: 6, overflow: 'hidden',
          background: '#1a1a1a', flexShrink: 0
        }}>
          <img
            src={post.thumbnail_url}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={e => e.target.style.display = 'none'}
          />
        </div>
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: sourceColor }}>{sourceLabel}</span>
          {post.post_type && (
            <span style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {post.post_type}
            </span>
          )}
        </div>

        {post.caption && (
          <p style={{
            fontSize: 12, color: 'var(--text2)', lineHeight: 1.4,
            overflow: 'hidden', display: '-webkit-box',
            WebkitLineClamp: compact ? 1 : 2, WebkitBoxOrient: 'vertical',
            marginBottom: 6
          }}>
            {post.caption}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {post.views_count > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" strokeWidth="2"/>
                <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2"/>
              </svg>
              {formatNumber(post.views_count)}
            </span>
          )}
          {post.likes_count > 0 && (
            <span style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" stroke="currentColor" strokeWidth="2"/>
              </svg>
              {formatNumber(post.likes_count)}
            </span>
          )}
          {post.transcript && (
            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>Transkript</span>
          )}
          {onClick && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--accent)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 3 }}>
              In Generator
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
