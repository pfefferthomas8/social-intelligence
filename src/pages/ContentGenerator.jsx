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

const CAROUSEL_SUBTYPES = [
  { key: 'mehrwert', label: 'Mehrwert', icon: '💡', desc: 'Tipps & Wissen — wird gespeichert' },
  { key: 'transformation', label: 'Transformation', icon: '⚡', desc: 'Geschichte & Ergebnis — wird geteilt' },
  { key: 'haltung', label: 'Haltung', icon: '🧠', desc: 'Mindset & Identität — erzeugt Kommentare' },
  { key: 'verkauf', label: 'Sales', icon: '🎯', desc: 'Coaching-Angebot — erzeugt Anfragen' },
]

// Muster-Labels und Farben
const MUSTER_COLORS = {
  'szenario':       '#ee4f00',
  'neugier':        '#22c55e',
  'counter':        '#3b82f6',
  'coaching':       '#a855f7',
  'cheat':          '#f59e0b',
  'countdown':      '#06b6d4',
  'paradox':        '#3b82f6',
  'direktangriff':  '#ef4444',
  'reframing':      '#8b5cf6',
  'zahl':           '#22c55e',
}

function getMusterColor(muster) {
  if (!muster) return '#666'
  const lower = muster.toLowerCase()
  for (const [key, color] of Object.entries(MUSTER_COLORS)) {
    if (lower.includes(key)) return color
  }
  return '#ee4f00'
}

function parseBRolls(text) {
  const blocks = text.split(/B-ROLL\s+\d+:/i).filter(b => b.trim())
  return blocks.map(block => {
    const get = (key) => {
      const regex = new RegExp(`${key}:\\s*(.+?)(?=\\n[A-Z]+:|$)`, 'si')
      const m = block.match(regex)
      return m ? m[1].trim() : ''
    }
    const subh = get('SUBHEADLINE')
    const muster = get('MUSTER') || get('SCHEMA')
    return {
      muster,
      hook: get('HOOK'),
      subheadline: subh === '–' || subh === '-' ? '' : subh,
      caption: get('CAPTION'),
    }
  }).filter(b => b.hook)
}

function BRollCard({ roll, index }) {
  const [captionOpen, setCaptionOpen] = useState(false)
  const [copiedHook, setCopiedHook] = useState(false)
  const [copiedCaption, setCopiedCaption] = useState(false)

  function copyText(text, setter) {
    navigator.clipboard.writeText(text)
    setter(true)
    setTimeout(() => setter(false), 2000)
  }

  const musterColor = getMusterColor(roll.muster)

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-lg)',
      overflow: 'hidden',
      marginBottom: 14,
    }}>
      <div style={{ padding: '16px 16px 14px' }}>
        <div style={{
          background: '#050505',
          borderRadius: 10,
          padding: '32px 24px',
          textAlign: 'center',
          position: 'relative',
          marginBottom: 12,
          minHeight: 110,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 8,
          border: '1px solid rgba(255,255,255,0.06)',
        }}>
          <div style={{
            position: 'absolute', top: 10, left: 12,
            display: 'flex', gap: 5, alignItems: 'center',
          }}>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
              color: 'rgba(255,255,255,0.4)',
              fontFamily: 'var(--font-mono)',
            }}>
              #{index + 1}
            </span>
            {roll.muster && (
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: '0.07em',
                color: musterColor,
                background: `${musterColor}18`,
                border: `1px solid ${musterColor}35`,
                padding: '1px 7px', borderRadius: 100,
                textTransform: 'uppercase',
                maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {roll.muster}
              </span>
            )}
          </div>
          <div style={{
            position: 'absolute', top: 10, right: 12,
            fontSize: 9, color: 'rgba(255,255,255,0.2)', fontFamily: 'var(--font-mono)',
          }}>
            7s
          </div>
          <p style={{
            fontSize: 22, fontWeight: 900, color: '#fff',
            margin: 0, lineHeight: 1.15,
            textShadow: '0 2px 12px rgba(0,0,0,0.9)',
            letterSpacing: '-0.02em',
            maxWidth: '85%',
          }}>
            {roll.hook}
          </p>
          {roll.subheadline && (
            <p style={{
              fontSize: 12, fontWeight: 500, color: 'rgba(255,255,255,0.6)',
              margin: 0,
              textShadow: '0 1px 4px rgba(0,0,0,0.8)',
              letterSpacing: '0.01em',
            }}>
              {roll.subheadline}
            </p>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => copyText(roll.subheadline ? `${roll.hook}\n${roll.subheadline}` : roll.hook, setCopiedHook)}
            className="btn btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {copiedHook
              ? <span style={{ color: '#22c55e' }}>✓ Kopiert</span>
              : <span>Hook kopieren</span>}
          </button>
          <button
            onClick={() => setCaptionOpen(o => !o)}
            className="btn btn-sm"
            style={{ flex: 1, justifyContent: 'center' }}
          >
            {captionOpen ? '▲ Caption' : '▼ Caption'}
          </button>
        </div>
        {captionOpen && (
          <div style={{
            marginTop: 10,
            background: 'rgba(255,255,255,0.025)',
            border: '1px solid rgba(255,255,255,0.07)',
            borderRadius: 8, padding: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text3)', letterSpacing: '0.08em' }}>CAPTION</span>
              <button onClick={() => copyText(roll.caption, setCopiedCaption)} className="btn btn-sm">
                {copiedCaption ? <span style={{ color: '#22c55e' }}>✓ Kopiert</span> : 'Kopieren'}
              </button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
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
  const [carouselSubtype, setCarouselSubtype] = useState('mehrwert')
  const [confirmed, setConfirmed] = useState(false)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [progress, setProgress] = useState(0)
  const [deletingId, setDeletingId] = useState(null)
  const [ratings, setRatings] = useState({})
  const [errorMsg, setErrorMsg] = useState('')
  // Karussell-Kopie
  const [slides, setSlides] = useState([])
  const [slideLabel, setSlideLabel] = useState('')
  const [copyMode, setCopyMode] = useState(false)
  const progressRef = useRef(null)
  const fileInputRef = useRef(null)

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
    if (data?.length) {
      const r = {}
      data.forEach(item => { if (item.user_rating) r[item.id] = item.user_rating })
      setRatings(r)
    }
    setHistoryLoading(false)
  }

  async function rateContent(id, rating) {
    const newRating = ratings[id] === rating ? null : rating
    setRatings(prev => ({ ...prev, [id]: newRating }))
    await supabase.from('generated_content').update({ user_rating: newRating }).eq('id', id)
  }

  function handleSlideFiles(files) {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    const validFiles = Array.from(files).filter(f => allowed.includes(f.type)).slice(0, 12 - slides.length)
    if (!validFiles.length) return
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target.result
        const base64 = dataUrl.split(',')[1]
        setSlides(prev => [...prev, { id: Date.now() + Math.random(), name: file.name, preview: dataUrl, base64, mediaType: file.type }])
      }
      reader.readAsDataURL(file)
    })
  }

  function removeSlide(id) {
    setSlides(prev => prev.filter(s => s.id !== id))
  }

  async function generate() {
    setGenerating(true)
    setResult(null)
    setProgress(0)
    setErrorMsg('')
    let p = 0
    progressRef.current = setInterval(() => {
      p = Math.min(p + Math.random() * 8, 88)
      setProgress(p)
    }, 400)

    try {
      let data
      if (copyMode) {
        data = await apiFetch('copy-carousel', {
          method: 'POST',
          body: JSON.stringify({
            slides: slides.map(s => ({ base64: s.base64, mediaType: s.mediaType })),
            additional_info: additionalInfo,
            label: slideLabel.trim() || undefined,
          })
        })
        if (data.topic) setTopic(data.topic)
      } else {
        data = await apiFetch('generate-content', {
          method: 'POST',
          body: JSON.stringify({
            topic: topic.trim(),
            content_type: contentType,
            additional_info: additionalInfo,
            ...(contentType === 'carousel' ? { carousel_subtype: carouselSubtype } : {})
          })
        })
      }
      setProgress(100)
      setResult({ ...data, _copyMode: copyMode })
      setConfirmed(false)
      await loadHistory()
    } catch (e) {
      setErrorMsg(e.message || 'Unbekannter Fehler beim Generieren.')
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
    if (item.content_type === 'carousel_copy') {
      setCopyMode(true)
    } else {
      setCopyMode(false)
      setContentType(item.content_type)
    }
    setResult({ content: item.content, _copyMode: item.content_type === 'carousel_copy' })
    setConfirmed(true)
  }

  const selectedType = CONTENT_TYPES.find(t => t.key === contentType)
  const canGenerate = copyMode ? slides.length > 0 : topic.trim().length > 0

  // Alle Content-Types für History-Anzeige (inkl. carousel_copy)
  const ALL_CONTENT_TYPES = [
    ...CONTENT_TYPES,
    { key: 'carousel_copy', label: 'Karussell-Kopie', icon: '🔄' },
  ]

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

          {/* Mode Toggle: Generator vs. Kopieren */}
          <div style={{ marginBottom: 20 }}>
            <div className="section-label">Modus</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              <button
                onClick={() => setCopyMode(false)}
                style={{
                  background: !copyMode ? 'var(--accent-dim)' : 'var(--bg-card)',
                  border: `1px solid ${!copyMode ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                  borderRadius: 'var(--r)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font)',
                  display: 'flex', gap: 8, alignItems: 'center',
                  transition: 'all 0.12s'
                }}
              >
                <span style={{ fontSize: 16 }}>✨</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: !copyMode ? 'var(--accent)' : 'var(--text2)' }}>
                    Generieren
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>Aus Thema erstellen</div>
                </div>
              </button>
              <button
                onClick={() => setCopyMode(true)}
                style={{
                  background: copyMode ? 'rgba(99,102,241,0.12)' : 'var(--bg-card)',
                  border: `1px solid ${copyMode ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`,
                  borderRadius: 'var(--r)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontFamily: 'var(--font)',
                  display: 'flex', gap: 8, alignItems: 'center',
                  transition: 'all 0.12s'
                }}
              >
                <span style={{ fontSize: 16 }}>🔄</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: copyMode ? '#818cf8' : 'var(--text2)' }}>
                    Karussell kopieren
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text3)' }}>Bilder → deine Sprache</div>
                </div>
              </button>
            </div>
          </div>

          {copyMode ? (
            /* ── KARUSSELL-KOPIE MODUS ── */
            <>
              {/* Slide Upload */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="section-label" style={{ margin: 0 }}>Slides hochladen</div>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{slides.length}/12 Slides</span>
                </div>

                {/* Drop Zone */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#818cf8' }}
                  onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  onDrop={e => {
                    e.preventDefault()
                    e.currentTarget.style.borderColor = 'var(--border)'
                    handleSlideFiles(e.dataTransfer.files)
                  }}
                  style={{
                    border: '2px dashed var(--border)',
                    borderRadius: 'var(--r-lg)',
                    padding: '20px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  <div style={{ fontSize: 24, marginBottom: 6 }}>🖼️</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text2)', marginBottom: 3 }}>
                    Slides hier ablegen oder klicken
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                    JPG, PNG, WebP · mehrere auswählbar · max 12 Slides
                  </div>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  style={{ display: 'none' }}
                  onChange={e => { handleSlideFiles(e.target.files); e.target.value = '' }}
                />
              </div>

              {/* Slide Vorschau */}
              {slides.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {slides.map((slide, idx) => (
                      <div key={slide.id} style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 'var(--r)', padding: '8px 10px',
                      }}>
                        <span style={{
                          fontSize: 10, fontWeight: 800, color: 'var(--text3)',
                          fontFamily: 'var(--font-mono)', minWidth: 18, textAlign: 'center',
                        }}>
                          {idx + 1}
                        </span>
                        <img
                          src={slide.preview}
                          alt={`Slide ${idx + 1}`}
                          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }}
                        />
                        <span style={{
                          fontSize: 11, color: 'var(--text3)', flex: 1, minWidth: 0,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          {slide.name}
                        </span>
                        <button
                          onClick={() => removeSlide(slide.id)}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text4)', padding: '2px 4px', flexShrink: 0,
                            fontSize: 14, lineHeight: 1,
                          }}
                          title="Slide entfernen"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  {slides.length < 12 && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-sm"
                      style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}
                    >
                      + Weitere Slides hinzufügen
                    </button>
                  )}
                </div>
              )}

              {/* Bezeichnung (optional) */}
              <div style={{ marginBottom: 16 }}>
                <div className="section-label">
                  Bezeichnung{' '}
                  <span style={{ color: 'var(--text4)', textTransform: 'none', fontSize: 10 }}>(optional)</span>
                </div>
                <input
                  type="text"
                  className="input"
                  placeholder="z.B. Protein-Karussell von @coach_xyz"
                  value={slideLabel}
                  onChange={e => setSlideLabel(e.target.value)}
                  style={{ fontSize: 13 }}
                />
              </div>

              {/* Kontext (optional) */}
              <div style={{ marginBottom: 20 }}>
                <div className="section-label">
                  Hinweis{' '}
                  <span style={{ color: 'var(--text4)', textTransform: 'none', fontSize: 10 }}>(optional)</span>
                </div>
                <textarea
                  className="input"
                  placeholder="z.B. Zielgruppe anpassen, bestimmten Ton beibehalten…"
                  value={additionalInfo}
                  onChange={e => setAdditionalInfo(e.target.value)}
                  style={{ minHeight: 56 }}
                />
              </div>
            </>
          ) : (
            /* ── GENERATOR MODUS ── */
            <>
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

              {/* Karussell Subtyp */}
              {contentType === 'carousel' && (
                <div style={{ marginBottom: 20 }}>
                  <div className="section-label">Karussell-Typ</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {CAROUSEL_SUBTYPES.map(sub => (
                      <button
                        key={sub.key}
                        onClick={() => setCarouselSubtype(sub.key)}
                        style={{
                          background: carouselSubtype === sub.key ? 'var(--accent-dim)' : 'var(--bg-card)',
                          border: `1px solid ${carouselSubtype === sub.key ? 'rgba(238,79,0,0.3)' : 'var(--border)'}`,
                          borderRadius: 'var(--r)',
                          padding: '10px 12px',
                          cursor: 'pointer',
                          textAlign: 'left',
                          fontFamily: 'var(--font)',
                          display: 'flex', gap: 8, alignItems: 'center',
                          transition: 'all 0.12s'
                        }}
                      >
                        <span style={{ fontSize: 16 }}>{sub.icon}</span>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: carouselSubtype === sub.key ? 'var(--accent)' : 'var(--text2)' }}>
                            {sub.label}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--text3)', lineHeight: 1.3 }}>{sub.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
            </>
          )}

          {/* Generate Button */}
          <button
            onClick={generate}
            disabled={!canGenerate || generating}
            className="btn btn-primary"
            style={{
              width: '100%', padding: '11px', fontSize: 14, fontWeight: 700,
              ...(copyMode ? { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', borderColor: '#4f46e5' } : {})
            }}
          >
            {generating ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="spinner" style={{ width: 15, height: 15, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                {copyMode ? 'Wird umgeschrieben…' : 'Generiert…'}
              </span>
            ) : copyMode ? (
              `🔄 Karussell in meiner Sprache umschreiben`
            ) : (
              `${selectedType?.icon} ${selectedType?.label} generieren`
            )}
          </button>

          {generating && (
            <div style={{ marginTop: 10 }}>
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, textAlign: 'center' }}>
                {copyMode
                  ? (progress < 30 ? 'Slides werden analysiert…' : progress < 70 ? 'Claude schreibt in Thomas\' Stil…' : 'Fast fertig…')
                  : (progress < 30 ? 'Daten werden geladen…' : progress < 70 ? 'Claude analysiert & schreibt…' : 'Fast fertig…')
                }
              </div>
            </div>
          )}

          {errorMsg && !generating && (
            <div style={{
              marginTop: 10, padding: '10px 14px',
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 'var(--r)', display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <span style={{ color: '#ef4444', fontSize: 14, flexShrink: 0 }}>✗</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#ef4444', marginBottom: 2 }}>Fehler beim Generieren</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', lineHeight: 1.5 }}>{errorMsg}</div>
              </div>
              <button onClick={() => setErrorMsg('')} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', fontSize: 14, padding: 0 }}>×</button>
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
                    {result._copyMode
                      ? '🔄 Karussell-Kopie'
                      : `${ALL_CONTENT_TYPES.find(t => t.key === (result.content_type || contentType))?.icon} Ergebnis`}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                    {result._copyMode ? (slideLabel || topic || 'Karussell-Kopie') : topic}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {(contentType !== 'b_roll' || result._copyMode) && <CopyButton text={result.content} />}
                  <button onClick={generate} className="btn btn-sm" disabled={!canGenerate}>↻ Neu</button>
                  <button onClick={() => setResult(null)} className="btn btn-sm" title="Schließen">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>

              {/* B-Roll: spezielle Karten-Ansicht */}
              {!result._copyMode && contentType === 'b_roll' ? (
                <div>
                  {parseBRolls(result.content).map((roll, i) => (
                    <BRollCard key={i} roll={roll} index={i} />
                  ))}
                </div>
              ) : (
                <div style={{
                  background: result._copyMode ? 'rgba(139,92,246,0.06)' : 'var(--bg-card)',
                  border: `1px solid ${result._copyMode ? 'rgba(139,92,246,0.25)' : 'var(--border)'}`,
                  borderRadius: 'var(--r-lg)', padding: '20px',
                  fontSize: 14, lineHeight: 1.8,
                  color: result._copyMode ? '#c4b5fd' : 'var(--text2)',
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
                        background: item.content_type === 'carousel_copy' ? 'rgba(139,92,246,0.05)' : 'var(--bg-card)',
                        border: `1px solid ${item.content_type === 'carousel_copy' ? 'rgba(139,92,246,0.2)' : 'var(--border)'}`,
                        borderRadius: 'var(--r)', padding: '14px',
                        cursor: 'pointer', transition: 'border-color 0.12s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = item.content_type === 'carousel_copy' ? 'rgba(139,92,246,0.45)' : 'var(--border-strong)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = item.content_type === 'carousel_copy' ? 'rgba(139,92,246,0.2)' : 'var(--border)'}
                      onClick={() => openFromHistory(item)}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 10, color: item.content_type === 'carousel_copy' ? '#818cf8' : 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                              {ALL_CONTENT_TYPES.find(t => t.key === item.content_type)?.icon} {ALL_CONTENT_TYPES.find(t => t.key === item.content_type)?.label}
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
