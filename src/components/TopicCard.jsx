export default function TopicCard({ topic, onSelect }) {
  const categoryConfig = {
    trending: { color: '#ee4f00', label: 'Trending' },
    gap: { color: '#3b82f6', label: 'Content Gap' },
    evergreen: { color: '#22c55e', label: 'Evergreen' },
    personal: { color: '#eab308', label: 'Persönlich' },
  }
  const cfg = categoryConfig[topic.category] || categoryConfig.trending

  return (
    <div
      onClick={() => onSelect(topic)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--r)',
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        transition: 'all 0.12s ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-strong)'; e.currentTarget.style.background = 'var(--bg-card-hover)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)' }}
    >
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.color, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
            {cfg.label}
          </span>
          {topic.potential_views && (
            <span style={{ fontSize: 10, color: 'var(--text3)' }}>~{topic.potential_views}</span>
          )}
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          {topic.title}
        </p>
        {topic.reason && (
          <p style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {topic.reason}
          </p>
        )}
      </div>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.25 }}>
        <path d="M9 18l6-6-6-6" stroke="var(--text)" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    </div>
  )
}
