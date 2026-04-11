import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'

const CONTENT_TYPES = [
  { key: 'video_script', label: 'Video Script', icon: '🎬', desc: 'Hook, Body & CTA' },
  { key: 'carousel', label: 'Karussell', icon: '📋', desc: 'Slide-für-Slide' },
  { key: 'single_post', label: 'Single Post', icon: '📝', desc: 'Caption für Einzelbild' },
  { key: 'b_roll', label: 'B-Roll', icon: '⚡', desc: 'Hook + Caption' },
]

// Parsed eine B-Roll Idee aus dem Claude-Output
function parseBRolls(text) {
  const blocks = text.split(/B-ROLL\s+\d+:/i).filter(b => b.trim())
  return blocks.map(block => {
    const get = (key) => {
      const regex = new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'si')
      const m = block.match(regex)
      return m ? m[1].trim() : ''
    }
    return {
      szene: get('SZENE'),
      hook: get('HOOK'),
      subheadline: get('SUBHEADLINE'),
      caption: get('CAPTION'),
    }
  }).filter(b => b.hook)
}

function BRollCard({ roll, index, fullContent }) {
  const [captionOpen, setCaptionOpen] = useState(false)
  const [copiedHook, setCopiedHook] = useState(false)
  const [copiedCaption, setCopiedCaption] = useState(false)

  function copyText(text, setter) {
    navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      marginBottom: 14,
    }}>
      {/* Header mit Nummer + Szene */}
      <div style={{
        padding: '12px 16px',
        background: 'rgba(238,79,0,0.06)',
        borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'flex-start', gap: 10,
      }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
          color: '#ee4f00', background: 'rgba(238,79,0,0.12)',
          padding: '2px 8px', borderRadius: 100, flexShrink: 0, marginTop: 1,
        }}>
          B-ROLL {index + 1}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>
            <span style={{ color: 'rgba(255,255,255,0.35)', marginRight: 4 }}>SZENE</span>
            {roll.szene}
          </div>
        </div>
      </div>

      {/* Hook Overlay Preview */}
      <div style={{ padding: '18px 16px 14px' }}>
        <div style={{
          background: '#000',
          borderRadius: 10,
          padding: '28px 20px',
          textAlign: 'center',
          position: 'relative',
          marginBottom: 12,
          minHeight: 90,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 6,
        }}>
          {/* Simuliertes Video-Frame */}
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 10,
            background: 'linear-gradient(135deg, #111 0%, #0a0a0a 100%)',
            opacity: 0.9,
          }} />
          <p style={{
            fontSize: 19, fontWeight: 900, color: '#fff',
            margin: 0, lineHeight: 1.2, position: 'relative',
            textShadow: '0 2px 8px rgba(0,0,0,0.8)',
            letterSpacing: '-0.01em',
          }}>
            {roll.hook}
          </p>
          {roll.subheadline && (
            <p style={{
              fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.75)',
              margin: 0, position: 'relative',
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            }}>
              {roll.subheadline}
            </p>
          )}
          {/* 7s Badge */}
          <div style={{
            position: 'absolute', top: 8, right: 10,
            fontSize: 9, color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Mono, monospace',
          }}>
            7s
          </div>
        </div>

        {/* Hook kopieren */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <button
            onClick={() => copyText(roll.subheadline ? `${roll.hook}\n${roll.subheadline}` : roll.hook, setCopiedHook)}
            className="btn btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {copiedHook ? <span style={{ color: '#22c55e' }}>✓ Kopiert</span> : '⚡ Hook kopieren'}
          </button>
          <button
            onClick={() => setCaptionOpen(o => !o)}
            className="btn btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {captionOpen ? '▲ Caption' : '▼ Caption anzeigen'}
          </button>
        </div>

        {/* Caption aufklappbar */}
        {captionOpen && (
          <div style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.08em' }}>CAPTION</span>
              <button onClick={() => copyText(roll.caption, setCopiedCaption)} className="btn btn-sm">
                {copiedCaption ? <span style={{ color: '#22c55e' }}>✓ Kopiert</span> : 'Kopieren'}
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>
              {roll.caption}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}


function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="btn btn-sm" style={{ gap: 5 }}>
      {copied ? (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
          <span style={{ color: '#22c55e' }}>Kopiert</span>
        </>
      ) : (
        <>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
          Kopieren
        </>
      )}
    </button>
  )
}

export default function ContentGenerator() {
  const location = useLocation()
  const [topic, setTopic] = useState(location.state?.topic || '')
  const [contentType, setContentType] = useState(location.state?.suggestedType || 'video_script')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [confirmed, setConfirmed] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [deletingId, setDeletingId] = useState(null)
  const [ratings, setRatings] = useState({}) // id → 1 | -1
  const progressRef = useRef(null)

  useEffect(() => { loadHistory() }, [])
  useEffect(() => {
    if (location.state?.topic) setTopic(location.state.topic)
    if (location.state?.suggestedType) setContentType(location.state.suggestedType)
    if (location.state?.additionalInfo) setAdditionalInfo(location.state.additionalInfo)
  }, [location.state])

  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase.from('generated_content').select('*').order('created_at', { ascending: false }).limit(20)
    setHistory(data || [])
    // Ratings aus geladenen Items laden
    if (data?.length) {
      const r = {}
      data.forEach(item => { if (item.user_rating) r[item.id] = item.user_rating })
      setRatings(r)
    }
    setHistoryLoading(false)
  }

  async function rateContent(id, rating) {
    const newRating = ratings[id] === rating ? null : rating // Toggle: nochmal klicken entfernt Bewertung
    setRatings(prev => ({ ...prev, [id]: newRating }))
    await supabase.from('generated_content').update({ user_rating: newRating }).eq('id', id)
  }

  async function generate() {
    if (!topic.trim()) return
    setGenerating(true)
    setResult(null)
    setProgress(0)
    let p = 0
    progressRef.current = setInterval(() => {
      p = Math.min(p + Math.random() * 8, 88)
      setProgress(p)
    }, 400)
    try {
      const data = await apiFetch('generate-content', {
        method: 'POST',
        body: JSON.stringify({ topic: topic.trim(), content_type: contentType, additional_info: additionalInfo })
      })
      setProgress(100)
      setResult(data)
      setConfirmed(false)
      await loadHistory()
    } catch (e) {
      alert('Fehler: ' + e.message)
    } finally {
      clearInterval(progressRef.current)
      setGenerating(false)
    }
  }

  async function deleteItem(e, id) {
    e.stopPropagation()
    setDeletingId(id)
    await supabase.from('generated_content').delete().eq('id', id)
    setHistory(prev => prev.filter(h => h.id !== id))
    setDeletingId(null)
  }

  function openFromHistory(item) {
    setTopic(item.topic)
    setContentType(item.content_type)
    setResult({ content: item.content })
    setConfirmed(true)
  }

  const selectedType = CONTENT_TYPES.find(t => t.key === contentType)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Content Generator</div>
          <div className="page-subtitle">KI-generierter Content basierend auf deinen Top Posts & Competitor Trends</div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)', fontFamily: 'var(--font-mono)' }}>
          {history.length} generiert
        </span>
      </div>

      {/* Two Column Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'grid', gridTemplateColumns: '420px 1fr' }}>
        {/* Left: Form */}
        <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '24px' }}>
          {/* Content Type */}
          <div style={{ marginBottom: 20 }}>
            <div className="section-label">Format</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {CONTENT_TYPES.map(type => (
                <button
                  key={type.key}
                  onClick={() => setContentType(type.key)}
                  style={{
                    background: contentType === type.key ? 'var(--accent-dim)' : 'var(--bg-card)',
                    border: `1px solid ${contentType === type.key ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                    borderRadius: 'var(--r)',
                    padding: '10px 12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontFamily: 'var(--font)',
                    display: 'flex', gap: 8, alignItems: 'center',
                    transition: 'all 0.12s'
                  }}
                >
                  <span style={{ fontSize: 16 }}>{type.icon}</span>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: contentType === type.key ? 'var(--accent)' : 'var(--text2)' }}>
                      {type.label}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)' }}>{type.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Topic */}
          <div style={{ marginBottom: 16 }}>
            <div className="section-label">Thema / Idee</div>
            <textarea
              className="input"
              placeholder="z.B. Warum Cardio Muskeln NICHT killt"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              style={{ minHeight: 72 }}
            />
          </div>

          {/* Additional Info */}
          <div style={{ marginBottom: 20 }}>
            <div className="section-label">
              Zusatzinfos{' '}
              <span style={{ color: 'var(--text4)', textTransform: 'none', fontSize: 10 }}>(optional)</span>
            </div>
            <textarea
              className="input"
              placeholder="Zielgruppe, Fokus, besondere Anforderungen…"
              value={additionalInfo}
              onChange={e => setAdditionalInfo(e.target.value)}
              style={{ minHeight: 60 }}
            />
          </div>

          {/* Generate */}
          <button
            onClick={generate}
            disabled={!topic.trim() || generating}
            className="btn btn-primary"
            style={{ width: '100%', padding: '11px', fontSize: 14, fontWeight: 700 }}
          >
            {generating ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{ width: 15, height: 15, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                Generiert…
              </span>
            ) : (
              `${selectedType?.icon} ${selectedType?.label} generieren`
            )}
          </button>

          {generating && (
            <div className="progress-bar" style={{ marginTop: 10 }}>
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>

        {/* Right: Result or History */}
        <div style={{ overflowY: 'auto', padding: '24px' }}>
          {result ? (
            <div className="fade-in">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                    {CONTENT_TYPES.find(t => t.key === result.content_type || t.key === contentType)?.icon} Ergebnis
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{topic}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {contentType !== 'b_roll' && <CopyButton text={result.content} />}
                  <button onClick={generate} className="btn btn-sm">↻ Neu</button>
                  <button onClick={() => setResult(null)} className="btn btn-sm" title="Schließen">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* B-Roll: spezielle Karten-Ansicht */}
              {contentType === 'b_roll' ? (
                <div>
                  {parseBRolls(result.content).map((roll, i) => (
                    <BRollCard key={i} roll={roll} index={i} fullContent={result.content} />
                  ))}
                </div>
              ) : (
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--r-lg)', padding: '20px',
                fontSize: 14, lineHeight: 1.8, color: 'var(--text2)',
                whiteSpace: 'pre-wrap', minHeight: 300
              }}>
                {result.content}
              </div>
              )}
              {/* Feedback Buttons */}
              {result.id && (
                <div style={{
                  marginTop: 14, display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 16px', background: 'var(--bg-card)',
                  border: '1px solid var(--border)', borderRadius: 'var(--r)',
                }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)', flex: 1 }}>
                    War das gut? KI lernt aus deinem Feedback.
                  </span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => rateContent(result.id, 1)}
                      className="btn btn-sm"
                      style={{
                        background: ratings[result.id] === 1 ? 'rgba(34,197,94,0.15)' : 'transparent',
                        border: `1px solid ${ratings[result.id] === 1 ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                        color: ratings[result.id] === 1 ? '#22c55e' : 'var(--text3)',
                        fontSize: 16, padding: '5px 10px',
                      }}
                      title="Gut"
                    >👍</button>
                    <button
                      onClick={() => rateContent(result.id, -1)}
                      className="btn btn-sm"
                      style={{
                        background: ratings[result.id] === -1 ? 'rgba(239,68,68,0.1)' : 'transparent',
                        border: `1px solid ${ratings[result.id] === -1 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                        color: ratings[result.id] === -1 ? '#ef4444' : 'var(--text3)',
                        fontSize: 16, padding: '5px 10px',
                      }}
                      title="Nicht gut"
                    >👎</button>
                  </div>
                </div>
              )}
              {confirmed ? (
                <div style={{
                  marginTop: 12, padding: '10px 16px',
                  background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                  borderRadius: 'var(--r)', color: '#22c55e', fontSize: 13, fontWeight: 600
                }}>
                  Gespeichert — KI lernt aus dieser Auswahl
                </div>
              ) : (
                <button
                  onClick={async () => {
                    if (location.state?.topicId) {
                      await supabase.from('topic_suggestions').update({ used: true }).eq('id', location.state.topicId)
                    }
                    setConfirmed(true)
                  }}
                  className="btn btn-primary"
                  style={{ marginTop: 12, width: '100%' }}
                >
                  Bestätigen & speichern
                </button>
              )}
            </div>
          ) : (
            <div>
              <div className="section-header" style={{ marginBottom: 16 }}>
                <span className="section-title">Verlauf</span>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>{history.length} Einträge</span>
              </div>
              {historyLoading ? (
                <div className="empty-state"><div className="spinner" /></div>
              ) : history.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">✨</div>
                  <p className="empty-state-title">Noch nichts generiert</p>
                  <p className="empty-state-text">Wähle ein Format, gib ein Thema ein und klick "Generieren".</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {history.map(item => (
                    <div
                      key={item.id}
                      style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r)', padding: '14px',
                        cursor: 'pointer', transition: 'border-color 0.12s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-strong)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                      onClick={() => openFromHistory(item)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {CONTENT_TYPES.find(t => t.key === item.content_type)?.icon} {CONTENT_TYPES.find(t => t.key === item.content_type)?.label}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text3)' }}>
                              {new Date(item.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                            {item.topic}
                          </p>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexShrink: 0, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
                          {/* Feedback Buttons */}
                          <button
                            onClick={e => { e.stopPropagation(); rateContent(item.id, 1) }}
                            className="btn btn-sm"
                            style={{
                              padding: '4px 7px', fontSize: 13,
                              background: ratings[item.id] === 1 ? 'rgba(34,197,94,0.15)' : 'transparent',
                              border: `1px solid ${ratings[item.id] === 1 ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`,
                              color: ratings[item.id] === 1 ? '#22c55e' : 'var(--text4)',
                            }}
                            title="Gut"
                          >👍</button>
                          <button
                            onClick={e => { e.stopPropagation(); rateContent(item.id, -1) }}
                            className="btn btn-sm"
                            style={{
                              padding: '4px 7px', fontSize: 13,
                              background: ratings[item.id] === -1 ? 'rgba(239,68,68,0.1)' : 'transparent',
                              border: `1px solid ${ratings[item.id] === -1 ? 'rgba(239,68,68,0.3)' : 'var(--border)'}`,
                              color: ratings[item.id] === -1 ? '#ef4444' : 'var(--text4)',
                            }}
                            title="Nicht gut"
                          >👎</button>
                          <CopyButton text={item.content} />
                          <button
                            onClick={e => deleteItem(e, item.id)}
                            disabled={deletingId === item.id}
                            className="btn btn-sm"
                            style={{ color: 'var(--text3)', padding: '5px 8px' }}
                            title="Löschen"
                          >
                            {deletingId === item.id ? (
                              <span className="spinner" style={{ width: 11, height: 11 }} />
                            ) : (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                                <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
