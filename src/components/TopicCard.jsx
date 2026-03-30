export default function TopicCard({ topic, onSelect }) {
  const categoryColors = {
    trending: { bg: 'rgba(238,79,0,0.1)', border: 'rgba(238,79,0,0.3)', color: '#ee4f00', label: 'Trending' },
    gap: { bg: 'rgba(96,165,250,0.1)', border: 'rgba(96,165,250,0.3)', color: '#60a5fa', label: 'Content-Gap' },
    evergreen: { bg: 'rgba(74,222,128,0.1)', border: 'rgba(74,222,128,0.3)', color: '#4ade80', label: 'Evergreen' },
    personal: { bg: 'rgba(250,204,21,0.1)', border: 'rgba(250,204,21,0.3)', color: '#facc15', label: 'Dein Stil' },
  }
  const style = categoryColors[topic.category] || categoryColors.trending

  return (
    <div
      onClick={() => onSelect(topic)}
      style={{
        background: style.bg,
        border: `1px solid ${style.border}`,
        borderRadius: 12,
        padding: '14px 16px',
        cursor: 'pointer',
        transition: 'transform 0.15s ease, opacity 0.15s ease',
        animation: 'fadeUp 0.2s ease forwards',
      }}
      onMouseDown={e => e.currentTarget.style.transform = 'scale(0.98)'}
      onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
      onTouchStart={e => e.currentTarget.style.opacity = '0.7'}
      onTouchEnd={e => e.currentTarget.style.opacity = '1'}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: style.color
            }}>
              {style.label}
            </span>
            {topic.potential_views && (
              <span style={{ fontSize: 10, color: '#606060' }}>
                ~{topic.potential_views} Views möglich
              </span>
            )}
          </div>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#ffffff', marginBottom: 4, lineHeight: 1.3 }}>
            {topic.title}
          </p>
          <p style={{ fontSize: 12, color: '#808080', lineHeight: 1.45 }}>
            {topic.reason}
          </p>
        </div>
        <div style={{
          flexShrink: 0, width: 32, height: 32,
          background: 'rgba(255,255,255,0.05)',
          borderRadius: 8,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: style.color, fontSize: 16
        }}>
          →
        </div>
      </div>
      {topic.suggested_types && (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {topic.suggested_types.map(t => (
            <span key={t} style={{
              fontSize: 10, background: 'rgba(255,255,255,0.06)',
              color: '#808080', borderRadius: 100, padding: '2px 8px', fontWeight: 500
            }}>{t}</span>
          ))}
        </div>
      )}
    </div>
  )
}
