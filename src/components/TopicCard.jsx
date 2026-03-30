export default function TopicCard({ topic, onSelect }) {
  const categoryConfig = {
    trending: { color: '#ee4f00', bg: 'rgba(238,79,0,0.08)', label: 'Trending' },
    gap: { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', label: 'Gap' },
    evergreen: { color: '#4ade80', bg: 'rgba(74,222,128,0.08)', label: 'Evergreen' },
    personal: { color: '#facc15', bg: 'rgba(250,204,21,0.08)', label: 'Persönlich' },
  }
  const cfg = categoryConfig[topic.category] || categoryConfig.trending

  return (
    <div
      onClick={() => onSelect(topic)}
      style={{
        background: '#161616',
        border: '1px solid #1e1e1e',
        borderRadius: 10,
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onTouchStart={e => { e.currentTarget.style.background = '#1a1a1a'; e.currentTarget.style.borderColor = '#2a2a2a' }}
      onTouchEnd={e => { e.currentTarget.style.background = '#161616'; e.currentTarget.style.borderColor = '#1e1e1e' }}
    >
      {/* Category dot */}
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: cfg.color, flexShrink: 0, marginTop: 1
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: cfg.color,
            textTransform: 'uppercase', letterSpacing: '0.08em'
          }}>{cfg.label}</span>
          {topic.potential_views && (
            <span style={{ fontSize: 10, color: '#505050' }}>~{topic.potential_views}</span>
          )}
        </div>
        <p style={{
          fontSize: 13, fontWeight: 600, color: '#e8e8e8',
          lineHeight: 1.3, marginBottom: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
        }}>
          {topic.title}
        </p>
        {topic.reason && (
          <p style={{ fontSize: 11, color: '#606060', lineHeight: 1.4 }}>
            {topic.reason}
          </p>
        )}
      </div>

      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0, opacity: 0.3 }}>
        <path d="M9 18l6-6-6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  )
}
