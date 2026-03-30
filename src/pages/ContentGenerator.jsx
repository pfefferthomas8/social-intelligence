import { useState, useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { apiFetch } from '../lib/auth.js'

const CONTENT_TYPES = [
  {
    key: 'video_script',
    label: 'Video Script',
    icon: '🎬',
    desc: 'Vollständiges Skript mit Hook, Body & CTA',
  },
  {
    key: 'carousel',
    label: 'Karussell',
    icon: '📋',
    desc: 'Slide-für-Slide Texte inkl. Hook & CTA',
  },
  {
    key: 'single_post',
    label: 'Single Post',
    icon: '📝',
    desc: 'Starke Caption für ein Einzelbild',
  },
  {
    key: 'b_roll',
    label: 'B-Roll Hook',
    icon: '⚡',
    desc: 'Kurze Text-Overlays für B-Roll Clips',
  },
]

const TONE_OPTIONS = [
  { key: 'direct', label: 'Direkt & provokant' },
  { key: 'educational', label: 'Lehrreich & informativ' },
  { key: 'motivational', label: 'Motivierend & energetisch' },
  { key: 'story', label: 'Story-basiert & persönlich' },
]

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={copy} className="btn btn-sm" style={{ gap: 6, fontSize: 12 }}>
      {copied ? (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <path d="M20 6L9 17l-5-5" stroke="#4ade80" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span style={{ color: '#4ade80' }}>Kopiert!</span>
        </>
      ) : (
        <>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
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
  const [contentType, setContentType] = useState('video_script')
  const [tone, setTone] = useState('direct')
  const [additionalInfo, setAdditionalInfo] = useState('')
  const [generating, setGenerating] = useState(false)
  const [result, setResult] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('generate')
  const [progress, setProgress] = useState(0)
  const progressRef = useRef(null)

  useEffect(() => { loadHistory() }, [])

  // Wenn Thema vom Dashboard übergeben wird → sofort anzeigen
  useEffect(() => {
    if (location.state?.topic) {
      setTopic(location.state.topic)
      setActiveTab('generate')
    }
  }, [location.state])

  async function loadHistory() {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('generated_content')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    setHistory(data || [])
    setHistoryLoading(false)
  }

  async function generate() {
    if (!topic.trim()) return
    setGenerating(true)
    setResult(null)
    setProgress(0)

    // Fake progress animation während generiert wird
    let p = 0
    progressRef.current = setInterval(() => {
      p = Math.min(p + Math.random() * 8, 88)
      setProgress(p)
    }, 400)

    try {
      const data = await apiFetch('generate-content', {
        method: 'POST',
        body: JSON.stringify({ topic: topic.trim(), content_type: contentType, tone, additional_info: additionalInfo })
      })
      setProgress(100)
      setResult(data)
      await loadHistory()
    } catch (e) {
      alert('Fehler beim Generieren: ' + e.message)
    } finally {
      clearInterval(progressRef.current)
      setGenerating(false)
    }
  }

  const selectedType = CONTENT_TYPES.find(t => t.key === contentType)

  return (
    <div className="screen">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Content Generator</h1>
          <span style={{ fontSize: 13, color: '#505050' }}>{history.length} generiert</span>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginTop: 14 }}>
          {[['generate', 'Generieren'], ['history', 'Historie']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: '7px 18px', borderRadius: 100, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                background: activeTab === key ? '#ee4f00' : '#1a1a1a',
                color: activeTab === key ? '#fff' : '#707070',
                transition: 'all 0.15s'
              }}
            >{label}</button>
          ))}
        </div>
      </div>

      <div className="screen-content">
        {activeTab === 'history' ? (
          historyLoading ? (
            <div className="empty-state"><div className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : history.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">✨</div>
              <p className="empty-state-title">Noch nichts generiert</p>
              <p className="empty-state-text">Dein Content-Verlauf erscheint hier.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {history.map(item => (
                <div key={item.id} style={{
                  background: '#161616', border: '1px solid #1e1e1e',
                  borderRadius: 12, padding: '16px'
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                        <span className="badge badge-orange">
                          {CONTENT_TYPES.find(t => t.key === item.content_type)?.icon} {CONTENT_TYPES.find(t => t.key === item.content_type)?.label}
                        </span>
                        <span style={{ fontSize: 11, color: '#505050' }}>
                          {new Date(item.created_at).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#c0c0c0' }}>{item.topic}</p>
                    </div>
                    <CopyButton text={item.content} />
                  </div>
                  <div style={{
                    background: '#0f0f0f', borderRadius: 8, padding: '12px',
                    fontSize: 13, lineHeight: 1.65, color: '#909090',
                    whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto'
                  }}>
                    {item.content}
                  </div>
                  <button
                    onClick={() => { setTopic(item.topic); setContentType(item.content_type); setActiveTab('generate') }}
                    className="btn btn-sm btn-ghost"
                    style={{ marginTop: 10, fontSize: 12, padding: '6px 12px' }}
                  >
                    ↗ Nochmal generieren
                  </button>
                </div>
              ))}
            </div>
          )
        ) : (
          /* Generator */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Content Type Auswahl */}
            <div>
              <p className="section-label">Format</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {CONTENT_TYPES.map(type => (
                  <button
                    key={type.key}
                    onClick={() => setContentType(type.key)}
                    style={{
                      background: contentType === type.key ? 'rgba(238,79,0,0.1)' : '#141414',
                      border: `1px solid ${contentType === type.key ? 'rgba(238,79,0,0.35)' : '#1e1e1e'}`,
                      borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
                      textAlign: 'left', transition: 'all 0.15s', fontFamily: 'var(--font)',
                      display: 'flex', alignItems: 'center', gap: 10
                    }}
                  >
                    <span style={{ fontSize: 18, flexShrink: 0 }}>{type.icon}</span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: contentType === type.key ? '#ee4f00' : '#c0c0c0' }}>
                        {type.label}
                      </div>
                      <div style={{ fontSize: 10, color: '#505050', lineHeight: 1.3 }}>{type.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Ton */}
            <div>
              <p className="section-label">Ton</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {TONE_OPTIONS.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setTone(t.key)}
                    style={{
                      padding: '6px 12px', borderRadius: 100,
                      border: `1px solid ${tone === t.key ? '#3a3a3a' : '#1e1e1e'}`,
                      cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, fontWeight: 600,
                      background: tone === t.key ? '#222' : '#141414',
                      color: tone === t.key ? '#fff' : '#555',
                      transition: 'all 0.15s'
                    }}
                  >{t.label}</button>
                ))}
              </div>
            </div>

            {/* Thema */}
            <div>
              <p className="section-label">Thema / Idee</p>
              <textarea
                className="input"
                placeholder="z.B. Warum Cardio Muskeln NICHT killt"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                style={{ minHeight: 68 }}
              />
            </div>

            {/* Zusatzinfos */}
            <div>
              <p className="section-label">Zusatzinfos (optional)</p>
              <textarea
                className="input"
                placeholder="Zielgruppe, Fokus, Besonderheiten…"
                value={additionalInfo}
                onChange={e => setAdditionalInfo(e.target.value)}
                style={{ minHeight: 52 }}
              />
            </div>

            {/* Generieren Button */}
            <button
              onClick={generate}
              disabled={!topic.trim() || generating}
              className="btn btn-primary"
              style={{ width: '100%', padding: '13px', fontSize: 14, fontWeight: 700 }}
            >
              {generating ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                  Wird generiert…
                </span>
              ) : (
                `${selectedType?.icon} ${selectedType?.label} generieren`
              )}
            </button>

            {/* Progress Bar */}
            {generating && (
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }} />
              </div>
            )}

            {/* Result */}
            {result && (
              <div style={{ animation: 'fadeUp 0.3s ease forwards' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <p className="section-label" style={{ marginBottom: 0 }}>
                    {CONTENT_TYPES.find(t => t.key === contentType)?.icon} Ergebnis
                  </p>
                  <CopyButton text={result.content} />
                </div>
                <div style={{
                  background: '#0f0f0f', border: '1px solid #2a2a2a',
                  borderRadius: 12, padding: '20px',
                  fontSize: 14, lineHeight: 1.8, color: '#d0d0d0',
                  whiteSpace: 'pre-wrap', minHeight: 200
                }}>
                  {result.content}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button onClick={generate} className="btn btn-sm" style={{ flex: 1 }}>
                    ↻ Neu generieren
                  </button>
                  <button onClick={() => setActiveTab('history')} className="btn btn-sm" style={{ flex: 1 }}>
                    Verlauf anzeigen
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
