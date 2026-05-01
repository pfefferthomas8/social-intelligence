import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNocnNsdXhicmF6cXNjZ2l3ZnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODk4MjEsImV4cCI6MjA5MDQ2NTgyMX0.8hQITokKKhVCfdVTHoGiyUzsHggfD7i13IFumsOfnuo'
const SUPABASE_URL = 'https://shrsluxbrazqscgiwfpu.supabase.co'
const VAPID_PUBLIC_KEY = 'BHJ_oOt0muwFnWs2sIx6fPiV0Gur503OChysdYajVFPaUnKANSM3N5-l7KKaDeNFrYhPFpPdR710z5OLqLqKPxY'

const HEAT_COLORS = {
  hot: '#ee4f00',
  warm: '#eab308',
  cold: '#555',
  archived: '#333',
}

const STAGE_LABELS = {
  discovery: 'Discovery',
  rapport: 'Rapport',
  pitch_ready: 'Pitch-Ready',
  pitched: 'Gepitcht',
  won: 'Gewonnen',
  lost: 'Verloren',
}

const AUTONOMY_LABELS = {
  A: 'Vorschlag (du bestätigst)',
  B: 'Vorschlag + Benachrichtigung',
  C: 'Vollautomatisch',
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

export default function DMCenter() {
  const [conversations, setConversations] = useState([])
  const [archivedConvs, setArchivedConvs] = useState([])
  const [selectedConv, setSelectedConv] = useState(null)
  const [messages, setMessages] = useState([])
  const [config, setConfig] = useState({})
  const [tab, setTab] = useState('inbox') // inbox | archive | config
  const [mobileScreen, setMobileScreen] = useState('list') // list | chat | info
  const [filter, setFilter] = useState('all')
  const [sending, setSending] = useState(false)
  const [generateError, setGenerateError] = useState(null)
  const [customReply, setCustomReply] = useState('')
  const [editingOriginal, setEditingOriginal] = useState(null)
  const [styleDnaLoading, setStyleDnaLoading] = useState(false)
  const [savedKey, setSavedKey] = useState(null)
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768)
  const messagesEndRef = useRef(null)
  const selectedConvRef = useRef(null)
  const textareaRef = useRef(null)

  useEffect(() => {
    const handle = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])

  useEffect(() => {
    selectedConvRef.current = selectedConv
  }, [selectedConv])

  useEffect(() => {
    loadConversations()
    loadConfig()

    const channel = supabase
      .channel('dm_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_conversations' }, () => {
        loadConversations()
        if (tab === 'archive') loadArchivedConvs()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, (payload) => {
        const current = selectedConvRef.current
        if (current && payload.new?.conversation_id === current.id) {
          loadMessages(current.id)
        }
        loadConversations()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  // Push Permission Registration
  useEffect(() => {
    async function registerPush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return
      try {
        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (existing) {
          // Bereits subscribed — sicherstellen dass in DB gespeichert
          await savePushSubscription(existing)
          return
        }
        if (Notification.permission === 'denied') return
        const permission = await Notification.requestPermission()
        if (permission !== 'granted') return
        const subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        })
        await savePushSubscription(subscription)
        console.log('Push subscription registriert')
      } catch (e) {
        console.warn('Push registration fehlgeschlagen:', e.message)
      }
    }
    registerPush()
  }, [])

  async function savePushSubscription(subscription) {
    const json = JSON.stringify(subscription.toJSON())
    await supabase.from('dm_config').upsert({ key: 'push_subscription', value: json }, { onConflict: 'key' })
  }

  async function loadConversations() {
    const { data } = await supabase
      .from('dm_conversations')
      .select('*')
      .neq('lead_heat', 'archived')
      .order('last_message_at', { ascending: false })
    setConversations(data || [])
    if (selectedConvRef.current) {
      const updated = (data || []).find(c => c.id === selectedConvRef.current.id)
      if (updated) setSelectedConv(updated)
    }
  }

  async function loadArchivedConvs() {
    const { data } = await supabase
      .from('dm_conversations')
      .select('*')
      .eq('lead_heat', 'archived')
      .order('last_message_at', { ascending: false })
    setArchivedConvs(data || [])
  }

  useEffect(() => {
    if (tab === 'archive') loadArchivedConvs()
  }, [tab])

  async function loadMessages(convId) {
    const { data } = await supabase
      .from('dm_messages')
      .select('*')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function loadConfig() {
    const { data } = await supabase.from('dm_config').select('key, value')
    const map = {}
    data?.forEach(c => { map[c.key] = c.value })
    setConfig(map)
  }

  useEffect(() => {
    if (selectedConv) loadMessages(selectedConv.id)
  }, [selectedConv])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function updateConfig(key, value) {
    await supabase.from('dm_config').update({ value, updated_at: new Date().toISOString() }).eq('key', key)
    setConfig(prev => ({ ...prev, [key]: value }))
    setSavedKey(key)
    setTimeout(() => setSavedKey(null), 2000)
  }

  async function toggleGlobalClaude() {
    const newVal = config['global_claude_enabled'] === 'true' ? 'false' : 'true'
    await updateConfig('global_claude_enabled', newVal)
  }

  async function toggleConvClaude(convId, current) {
    await supabase.from('dm_conversations').update({ claude_enabled: !current }).eq('id', convId)
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, claude_enabled: !current } : c))
    if (selectedConv?.id === convId) setSelectedConv(prev => ({ ...prev, claude_enabled: !current }))
  }

  async function sendReply(text, sentBy = 'thomas', originalSuggestion = null) {
    if (!selectedConv || !text.trim()) return
    setSending(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dm-send`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation_id: selectedConv.id,
          text,
          sent_by: sentBy,
          original_suggestion: originalSuggestion,
        }),
      })
      const data = await res.json()
      if (data.manychat_error) console.warn('ManyChat:', data.manychat_error)
      setCustomReply('')
      setEditingOriginal(null)
      await loadMessages(selectedConv.id)
    } finally {
      setSending(false)
    }
  }

  async function approveClaudeSuggestion(message) {
    if (!message.claude_suggestion) return
    await sendReply(message.claude_suggestion, 'claude', message.claude_suggestion)
  }

  async function updateConvStage(stage) {
    await supabase.from('dm_conversations').update({ stage }).eq('id', selectedConv.id)
    setSelectedConv(prev => ({ ...prev, stage }))
  }

  async function archiveConv() {
    await supabase.from('dm_conversations').update({ lead_heat: 'archived' }).eq('id', selectedConv.id)
    setSelectedConv(null)
    if (isMobile) setMobileScreen('list')
    loadConversations()
  }

  async function reactivateConv(conv) {
    await supabase.from('dm_conversations').update({ lead_heat: 'cold' }).eq('id', conv.id)
    loadArchivedConvs()
    loadConversations()
    if (selectedConv?.id === conv.id) {
      setSelectedConv(prev => ({ ...prev, lead_heat: 'cold' }))
    }
  }

  async function toggleBlocked(convId, current) {
    await supabase.from('dm_conversations').update({ claude_blocked: !current }).eq('id', convId)
    setConversations(prev => prev.map(c => c.id === convId ? { ...c, claude_blocked: !current } : c))
    if (selectedConv?.id === convId) setSelectedConv(prev => ({ ...prev, claude_blocked: !current }))
  }

  async function runStyleDna() {
    setStyleDnaLoading(true)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/extract-style-dna`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.style_dna) setConfig(prev => ({ ...prev, style_dna: data.style_dna }))
    } finally {
      setStyleDnaLoading(false)
    }
  }

  async function generateSuggestion() {
    const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound')
    if (!lastInbound) return
    setSending(true)
    setGenerateError(null)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dm-reply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: selectedConv.id,
          autonomy_mode: 'B',
          trigger_message: lastInbound.content,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setGenerateError(data.error || `HTTP ${res.status}`)
      } else if (!data.suggestion) {
        setGenerateError('Claude hat keinen Vorschlag zurückgegeben')
      } else {
        setGenerateError(null)
      }
      await loadMessages(selectedConv.id)
    } catch (err) {
      setGenerateError(err.message || 'Netzwerkfehler')
    } finally {
      setSending(false)
    }
  }

  function selectConv(conv) {
    setSelectedConv(conv)
    setGenerateError(null)
    if (isMobile) setMobileScreen('chat')
    if (conv.has_unread) {
      supabase.from('dm_conversations').update({ has_unread: false }).eq('id', conv.id)
      setConversations(prev => prev.map(c => c.id === conv.id ? { ...c, has_unread: false } : c))
    }
  }

  const hotCount = conversations.filter(c => c.lead_heat === 'hot').length
  const filtered = conversations.filter(c => filter === 'all' || c.lead_heat === filter)

  // ─── Mobile Layout ───────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg)', overflow: 'hidden' }}>
        {/* Mobile Content */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>

          {/* Screen: List (Inbox oder Archiv) */}
          {(mobileScreen === 'list') && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Header */}
              <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>DM Center</div>
                    {hotCount > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--accent)', marginTop: 2 }}>
                        {hotCount} heißer Lead{hotCount > 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  <Toggle value={config['global_claude_enabled'] === 'true'} onChange={toggleGlobalClaude} />
                </div>
                {tab === 'inbox' && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['all', 'hot', 'warm', 'cold'].map(f => (
                      <button key={f} onClick={() => setFilter(f)} style={{
                        flex: 1, padding: '6px 4px', borderRadius: 6, fontSize: 11, border: 'none',
                        cursor: 'pointer', fontFamily: 'var(--font)',
                        background: filter === f ? 'var(--accent)' : 'var(--bg-card)',
                        color: filter === f ? '#fff' : 'var(--text2)',
                      }}>
                        {f === 'all' ? 'Alle' : f === 'hot' ? '🔥' : f === 'warm' ? '🟡' : '❄️'}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Conversation List */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {tab === 'inbox' && (
                  filtered.length === 0
                    ? <div style={{ padding: 32, color: 'var(--text3)', textAlign: 'center', fontSize: 14 }}>Keine Chats</div>
                    : filtered.map(conv => (
                      <ConvItem
                        key={conv.id}
                        conv={conv}
                        selected={selectedConv?.id === conv.id}
                        onClick={() => selectConv(conv)}
                        onToggleClaude={() => toggleConvClaude(conv.id, conv.claude_enabled)}
                        onArchive={async () => {
                          await supabase.from('dm_conversations').update({ lead_heat: 'archived' }).eq('id', conv.id)
                          if (selectedConv?.id === conv.id) setSelectedConv(null)
                          loadConversations()
                        }}
                      />
                    ))
                )}
                {tab === 'archive' && (
                  archivedConvs.length === 0
                    ? <div style={{ padding: 32, color: 'var(--text3)', textAlign: 'center', fontSize: 14 }}>Kein Archiv</div>
                    : archivedConvs.map(conv => (
                      <ConvItem
                        key={conv.id}
                        conv={conv}
                        selected={selectedConv?.id === conv.id}
                        onClick={() => selectConv(conv)}
                        onToggleClaude={() => {}}
                        onArchive={() => {}}
                        isArchived
                        onReactivate={() => reactivateConv(conv)}
                      />
                    ))
                )}
                {tab === 'config' && (
                  <SettingsPanel config={config} onUpdate={updateConfig} onStyleDna={runStyleDna} styleDnaLoading={styleDnaLoading} savedKey={savedKey} />
                )}
              </div>
            </div>
          )}

          {/* Screen: Chat */}
          {mobileScreen === 'chat' && selectedConv && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {/* Chat Header */}
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
                background: 'var(--bg)',
              }}>
                <button onClick={() => setMobileScreen('list')} style={{
                  background: 'none', border: 'none', color: 'var(--accent)', fontSize: 20,
                  cursor: 'pointer', padding: '0 4px', minWidth: 32, minHeight: 44,
                  display: 'flex', alignItems: 'center',
                }}>←</button>
                <Avatar name={selectedConv.display_name} pic={selectedConv.profile_pic_url} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedConv.display_name || selectedConv.instagram_username}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                    Score: {selectedConv.lead_score}/100 · {STAGE_LABELS[selectedConv.stage] || 'Discovery'}
                  </div>
                </div>
                {selectedConv.lead_heat === 'archived' && (
                  <button onClick={() => reactivateConv(selectedConv)} style={{
                    fontSize: 11, padding: '6px 10px', borderRadius: 6, cursor: 'pointer',
                    background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                    border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font)',
                  }}>↑ Reaktivieren</button>
                )}
                <button onClick={() => setMobileScreen('info')} style={{
                  background: 'none', border: 'none', color: 'var(--text2)', fontSize: 20,
                  cursor: 'pointer', padding: '0 4px', minWidth: 32, minHeight: 44,
                  display: 'flex', alignItems: 'center',
                }}>ⓘ</button>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
                {messages.map((msg, i) => (
                  <MessageBubble key={msg.id || i} msg={msg} onApprove={() => approveClaudeSuggestion(msg)} />
                ))}
                <div ref={messagesEndRef} />
              </div>

              {/* Input Area */}
              <MobileInputArea
                messages={messages}
                conv={selectedConv}
                sending={sending}
                generateError={generateError}
                customReply={customReply}
                setCustomReply={setCustomReply}
                editingOriginal={editingOriginal}
                setEditingOriginal={setEditingOriginal}
                onSend={sendReply}
                onApprove={approveClaudeSuggestion}
                onGenerate={generateSuggestion}
                onEdit={(text) => { setCustomReply(text); setEditingOriginal(text) }}
                textareaRef={textareaRef}
              />
            </div>
          )}

          {/* Screen: Lead Info */}
          {mobileScreen === 'info' && selectedConv && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{
                padding: '10px 14px', borderBottom: '1px solid var(--border)',
                display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
              }}>
                <button onClick={() => setMobileScreen('chat')} style={{
                  background: 'none', border: 'none', color: 'var(--accent)', fontSize: 20,
                  cursor: 'pointer', padding: '0 4px', minWidth: 32, minHeight: 44,
                  display: 'flex', alignItems: 'center',
                }}>←</button>
                <div style={{ fontWeight: 600, fontSize: 15 }}>Lead Info</div>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                <LeadInfoPanel
                  conv={selectedConv}
                  onUpdateStage={updateConvStage}
                  onToggleClaude={toggleConvClaude}
                  onToggleBlocked={toggleBlocked}
                  onArchive={archiveConv}
                  onReactivate={() => reactivateConv(selectedConv)}
                  setSelectedConv={setSelectedConv}
                />
              </div>
            </div>
          )}
        </div>

        {/* Bottom Navigation */}
        {mobileScreen === 'list' && (
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0,
            background: 'var(--bg)', borderTop: '1px solid var(--border)',
            display: 'flex',
            paddingBottom: 'env(safe-area-inset-bottom)',
            zIndex: 100,
          }}>
            {[
              { key: 'inbox', icon: '📥', label: 'Chats' },
              { key: 'archive', icon: '🗄️', label: 'Archiv' },
              { key: 'config', icon: '⚙️', label: 'Config' },
            ].map(({ key, icon, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 3, padding: '10px 4px', background: 'none', border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font)',
                color: tab === key ? 'var(--accent)' : 'var(--text2)',
                minHeight: 56,
              }}>
                <span style={{ fontSize: 20 }}>{icon}</span>
                <span style={{ fontSize: 10, fontWeight: tab === key ? 600 : 400 }}>{label}</span>
              </button>
            ))}
          </div>
        )}
        {/* Spacer for bottom nav */}
        {mobileScreen === 'list' && <div style={{ height: 56 }} />}
      </div>
    )
  }

  // ─── Desktop Layout ──────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: 'var(--bg)' }}>

      {/* LEFT: 300px */}
      <div style={{
        width: 300, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>DM Center</div>
              {hotCount > 0 && (
                <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 2 }}>
                  {hotCount} heißer Lead{hotCount > 1 ? 's' : ''}
                </div>
              )}
            </div>
            <Toggle value={config['global_claude_enabled'] === 'true'} onChange={toggleGlobalClaude} />
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
            {[
              { key: 'inbox', label: '📥 Inbox' },
              { key: 'archive', label: '🗄️ Archiv' },
              { key: 'config', label: '⚙️ Config' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                flex: 1, padding: '5px 4px', borderRadius: 6, fontSize: 11, border: 'none',
                cursor: 'pointer', fontFamily: 'var(--font)',
                background: tab === key ? 'var(--accent)' : 'var(--bg-card)',
                color: tab === key ? '#fff' : 'var(--text2)',
              }}>{label}</button>
            ))}
          </div>

          {tab === 'inbox' && (
            <div style={{ display: 'flex', gap: 4, paddingBottom: 12 }}>
              {['all', 'hot', 'warm', 'cold'].map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '3px 8px', borderRadius: 4, fontSize: 11, border: 'none',
                  cursor: 'pointer', fontFamily: 'var(--font)',
                  background: filter === f ? 'var(--accent)' : 'var(--bg-card)',
                  color: filter === f ? '#fff' : 'var(--text2)',
                }}>
                  {f === 'all' ? 'Alle' : f === 'hot' ? '🔥 Heiß' : f === 'warm' ? '🟡 Warm' : '❄️ Kalt'}
                </button>
              ))}
            </div>
          )}
        </div>

        {savedKey && (
          <div style={{
            margin: '0 12px 8px', padding: '6px 10px', borderRadius: 'var(--r-sm)',
            background: 'var(--green-dim)', border: '1px solid rgba(34,197,94,0.2)',
            fontSize: 11, color: 'var(--green)', textAlign: 'center',
          }}>✓ Gespeichert</div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {tab === 'inbox' && (
            filtered.length === 0
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>Keine Conversations</div>
              : filtered.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  selected={selectedConv?.id === conv.id}
                  onClick={() => selectConv(conv)}
                  onToggleClaude={() => toggleConvClaude(conv.id, conv.claude_enabled)}
                  onArchive={async () => {
                    await supabase.from('dm_conversations').update({ lead_heat: 'archived' }).eq('id', conv.id)
                    if (selectedConv?.id === conv.id) setSelectedConv(null)
                    loadConversations()
                  }}
                />
              ))
          )}
          {tab === 'archive' && (
            archivedConvs.length === 0
              ? <div style={{ padding: 24, color: 'var(--text3)', fontSize: 13, textAlign: 'center' }}>Kein Archiv</div>
              : archivedConvs.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  selected={selectedConv?.id === conv.id}
                  onClick={() => selectConv(conv)}
                  onToggleClaude={() => {}}
                  onArchive={() => {}}
                  isArchived
                  onReactivate={() => reactivateConv(conv)}
                />
              ))
          )}
          {tab === 'config' && (
            <SettingsPanel config={config} onUpdate={updateConfig} onStyleDna={runStyleDna} styleDnaLoading={styleDnaLoading} savedKey={savedKey} />
          )}
        </div>
      </div>

      {/* MIDDLE: Chat */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedConv ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
              <div style={{ fontSize: 14 }}>Wähle einen Chat aus</div>
            </div>
          </div>
        ) : (
          <>
            {/* Conv Header */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <Avatar name={selectedConv.display_name} pic={selectedConv.profile_pic_url} size={36} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {selectedConv.display_name || selectedConv.instagram_username}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text2)' }}>
                  @{selectedConv.instagram_username} · Score: {selectedConv.lead_score}/100
                </div>
              </div>
              <HeatBadge heat={selectedConv.lead_heat} />
              <select
                value={selectedConv.stage || 'discovery'}
                onChange={e => updateConvStage(e.target.value)}
                style={{
                  background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
                  borderRadius: 'var(--r)', padding: '4px 8px', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'var(--font)',
                }}
              >
                {Object.entries(STAGE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              {selectedConv.lead_heat === 'archived' && (
                <button onClick={() => reactivateConv(selectedConv)} style={{
                  fontSize: 11, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
                  background: 'rgba(34,197,94,0.15)', color: '#22c55e',
                  border: '1px solid rgba(34,197,94,0.3)', fontFamily: 'var(--font)',
                }}>↑ Reaktivieren</button>
              )}
            </div>

            {/* Messages */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {messages.map((msg, i) => (
                <MessageBubble key={msg.id || i} msg={msg} onApprove={() => approveClaudeSuggestion(msg)} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <DesktopInputArea
              messages={messages}
              conv={selectedConv}
              sending={sending}
              generateError={generateError}
              customReply={customReply}
              setCustomReply={setCustomReply}
              editingOriginal={editingOriginal}
              setEditingOriginal={setEditingOriginal}
              onSend={sendReply}
              onApprove={approveClaudeSuggestion}
              onGenerate={generateSuggestion}
              onEdit={(text) => { setCustomReply(text); setEditingOriginal(text) }}
            />
          </>
        )}
      </div>

      {/* RIGHT: Lead Info */}
      {selectedConv && (
        <div style={{
          width: 260, flexShrink: 0, borderLeft: '1px solid var(--border)',
          overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <LeadInfoPanel
            conv={selectedConv}
            onUpdateStage={updateConvStage}
            onToggleClaude={toggleConvClaude}
            onToggleBlocked={toggleBlocked}
            onArchive={archiveConv}
            onReactivate={() => reactivateConv(selectedConv)}
            setSelectedConv={setSelectedConv}
          />
        </div>
      )}
    </div>
  )
}

// ─── Input Area Desktop ──────────────────────────────────────────────────────

function DesktopInputArea({ messages, conv, sending, generateError, customReply, setCustomReply, editingOriginal, setEditingOriginal, onSend, onApprove, onGenerate, onEdit }) {
  return (
    <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
      <WindowWarning messages={messages} />
      <ClaudeBanner
        messages={messages}
        conv={conv}
        sending={sending}
        generateError={generateError}
        onApprove={onApprove}
        onEdit={onEdit}
        onGenerate={onGenerate}
      />
      <div style={{ marginBottom: 6, display: 'flex', gap: 6 }}>
        <button onClick={() => {
          const note = prompt('Was hast du in der Sprachnachricht gesagt? (Kurze Zusammenfassung)')
          if (note?.trim()) onSend(`🎤 [Sprachnachricht: ${note.trim()}]`, 'thomas', null)
        }} style={{
          fontSize: 11, padding: '4px 10px', borderRadius: 4, cursor: 'pointer',
          background: 'var(--bg-card)', color: 'var(--text2)',
          border: '1px solid var(--border)', fontFamily: 'var(--font)',
        }}>🎤 Sprachnotiz</button>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <textarea
          value={customReply}
          onChange={e => setCustomReply(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend(customReply, 'thomas', editingOriginal)
            }
          }}
          placeholder={editingOriginal ? '✏ Bearbeitest Claude-Vorschlag...' : 'Antwort schreiben... (Enter = senden)'}
          rows={2}
          style={{
            flex: 1, background: 'var(--bg-input)', color: 'var(--text)',
            border: `1px solid ${editingOriginal ? 'rgba(238,79,0,0.5)' : 'var(--border)'}`,
            borderRadius: 'var(--r)',
            padding: '8px 12px', fontSize: 13, fontFamily: 'var(--font)',
            resize: 'none', outline: 'none',
          }}
        />
        <button
          onClick={() => onSend(customReply, 'thomas', editingOriginal)}
          disabled={sending || !customReply.trim()}
          style={{
            background: customReply.trim() ? 'var(--accent)' : 'var(--bg-card)',
            color: customReply.trim() ? '#fff' : 'var(--text3)',
            border: 'none', borderRadius: 'var(--r)', padding: '0 16px',
            cursor: customReply.trim() ? 'pointer' : 'default',
            fontSize: 18, transition: 'all 0.15s',
            opacity: sending ? 0.5 : 1,
          }}
        >{sending ? '⏳' : '↑'}</button>
      </div>
    </div>
  )
}

// ─── Input Area Mobile ───────────────────────────────────────────────────────

function MobileInputArea({ messages, conv, sending, generateError, customReply, setCustomReply, editingOriginal, setEditingOriginal, onSend, onApprove, onGenerate, onEdit, textareaRef }) {
  function autoResize(e) {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg)',
      flexShrink: 0,
      paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
    }}>
      <WindowWarning messages={messages} />
      <ClaudeBanner
        messages={messages}
        conv={conv}
        sending={sending}
        generateError={generateError}
        onApprove={onApprove}
        onEdit={onEdit}
        onGenerate={onGenerate}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          ref={textareaRef}
          value={customReply}
          onChange={e => { setCustomReply(e.target.value); autoResize(e) }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSend(customReply, 'thomas', editingOriginal)
            }
          }}
          placeholder={editingOriginal ? '✏ Bearbeitest...' : 'Antwort...'}
          rows={1}
          style={{
            flex: 1, background: 'var(--bg-input)', color: 'var(--text)',
            border: `1px solid ${editingOriginal ? 'rgba(238,79,0,0.5)' : 'var(--border)'}`,
            borderRadius: 'var(--r)',
            padding: '10px 12px', fontSize: 14, fontFamily: 'var(--font)',
            resize: 'none', outline: 'none',
            minHeight: 44, maxHeight: 120, overflowY: 'auto',
          }}
        />
        <button
          onClick={() => onSend(customReply, 'thomas', editingOriginal)}
          disabled={sending || !customReply.trim()}
          style={{
            background: customReply.trim() ? 'var(--accent)' : 'var(--bg-card)',
            color: customReply.trim() ? '#fff' : 'var(--text3)',
            border: 'none', borderRadius: 'var(--r)',
            width: 44, height: 44, flexShrink: 0,
            cursor: customReply.trim() ? 'pointer' : 'default',
            fontSize: 20, opacity: sending ? 0.5 : 1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >{sending ? '⏳' : '↑'}</button>
      </div>
    </div>
  )
}

// ─── Lead Info Panel (shared Desktop + Mobile) ──────────────────────────────

function LeadInfoPanel({ conv, onUpdateStage, onToggleClaude, onToggleBlocked, onArchive, onReactivate, setSelectedConv }) {
  const isArchived = conv.lead_heat === 'archived'
  return (
    <>
      {/* Lead Profile */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 10 }}>
          LEAD INFO
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Avatar name={conv.display_name} pic={conv.profile_pic_url} size={52} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{conv.display_name}</div>
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>@{conv.instagram_username}</div>
          </div>
        </div>

        {/* Score Bar */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text2)', marginBottom: 4 }}>
            <span>Lead Score</span>
            <span style={{ color: HEAT_COLORS[conv.lead_heat] }}>{conv.lead_score}/100</span>
          </div>
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 2 }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${conv.lead_score}%`,
              background: HEAT_COLORS[conv.lead_heat],
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <HeatBadge heat={conv.lead_heat} />
          <GenderBadge gender={conv.gender} />
          <span style={{ fontSize: 11, color: 'var(--text2)', padding: '2px 8px', background: 'var(--bg-card)', borderRadius: 4 }}>
            {STAGE_LABELS[conv.stage] || 'Discovery'}
          </span>
          {conv.claude_blocked && (
            <span style={{ fontSize: 11, color: '#ef4444', padding: '2px 8px', background: 'rgba(239,68,68,0.1)', borderRadius: 4, border: '1px solid rgba(239,68,68,0.3)' }}>
              Claude gesperrt
            </span>
          )}
        </div>

        {/* Deal Status */}
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>DEAL STATUS</div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'open', label: '⏳ Offen', color: '#555' },
              { key: 'won', label: '✅ Gekauft', color: '#22c55e' },
              { key: 'lost', label: '❌ Verloren', color: '#ef4444' },
              { key: 'nurture', label: '🌱 Nurture', color: '#eab308' },
            ].map(({ key, label, color }) => {
              const isActive = (conv.deal_status || 'open') === key
              return (
                <button key={key} onClick={async () => {
                  await supabase.from('dm_conversations').update({ deal_status: key }).eq('id', conv.id)
                  setSelectedConv(prev => ({ ...prev, deal_status: key }))
                }} style={{
                  flex: 1, fontSize: 10, padding: '4px 2px', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'var(--font)', fontWeight: isActive ? 700 : 400,
                  border: isActive ? `1px solid ${color}` : '1px solid var(--border)',
                  background: isActive ? `${color}18` : 'var(--bg-card)',
                  color: isActive ? color : 'var(--text3)',
                  minHeight: 32,
                }}>{label}</button>
              )
            })}
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Stage Selector */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>STAGE</div>
        <select
          value={conv.stage || 'discovery'}
          onChange={e => onUpdateStage(e.target.value)}
          style={{
            width: '100%', background: 'var(--bg-card)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            padding: '8px 10px', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)',
            minHeight: 44,
          }}
        >
          {Object.entries(STAGE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Claude per Chat Toggle */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 10 }}>
          CLAUDE EINSTELLUNGEN
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>Claude aktiv</div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>Für diesen Chat</div>
          </div>
          <Toggle value={conv.claude_enabled} onChange={() => onToggleClaude(conv.id, conv.claude_enabled)} />
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Modus</div>
          {['A', 'B', 'C'].map(mode => (
            <button key={mode} onClick={async () => {
              await supabase.from('dm_conversations').update({ autonomy_mode: mode }).eq('id', conv.id)
              setSelectedConv(prev => ({ ...prev, autonomy_mode: mode }))
            }} style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '6px 10px', borderRadius: 'var(--r-sm)', marginBottom: 4,
              border: `1px solid ${conv.autonomy_mode === mode ? 'var(--accent)' : 'var(--border)'}`,
              background: conv.autonomy_mode === mode ? 'var(--accent-dim)' : 'var(--bg-card)',
              color: conv.autonomy_mode === mode ? 'var(--accent)' : 'var(--text2)',
              cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 11, minHeight: 36,
            }}>
              <strong>{mode}</strong> — {AUTONOMY_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Notes */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>NOTIZEN</div>
        <textarea
          key={conv.id}
          defaultValue={conv.notes || ''}
          onBlur={async e => {
            await supabase.from('dm_conversations').update({ notes: e.target.value }).eq('id', conv.id)
          }}
          placeholder="Interne Notizen..."
          rows={4}
          style={{
            width: '100%', background: 'var(--bg-input)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)',
            resize: 'none', outline: 'none',
          }}
        />
      </div>

      {/* Gender / Claude Block */}
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 8 }}>
          GESCHLECHT / CLAUDE
        </div>
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 6 }}>
            Erkannt: <GenderBadge gender={conv.gender} inline /> — korrigieren:
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { key: 'male', label: '♂ Männlich', color: '#3b82f6' },
              { key: 'female', label: '♀ Weiblich', color: '#ec4899' },
              { key: 'unknown', label: '? Unbekannt', color: '#555' },
            ].map(({ key, label, color }) => {
              const isActive = conv.gender === key
              return (
                <button key={key} onClick={async () => {
                  await supabase.from('dm_conversations').update({ gender: key }).eq('id', conv.id)
                  setSelectedConv(prev => ({ ...prev, gender: key }))
                }} style={{
                  flex: 1, fontSize: 10, padding: '4px 2px', borderRadius: 4, cursor: 'pointer',
                  fontFamily: 'var(--font)', fontWeight: isActive ? 700 : 400,
                  border: isActive ? `1px solid ${color}` : '1px solid var(--border)',
                  background: isActive ? `${color}18` : 'var(--bg-card)',
                  color: isActive ? color : 'var(--text3)',
                  minHeight: 36,
                }}>{label}</button>
              )
            })}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: conv.claude_blocked ? '#ef4444' : 'var(--text)' }}>
              {conv.claude_blocked ? '🚫 Claude gesperrt' : '✓ Claude erlaubt'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text2)' }}>Manuell sperren</div>
          </div>
          <Toggle value={!conv.claude_blocked} onChange={() => onToggleBlocked(conv.id, conv.claude_blocked)} />
        </div>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      {/* Archive / Reaktivieren */}
      {isArchived ? (
        <button onClick={onReactivate} style={{
          background: 'rgba(34,197,94,0.15)', color: '#22c55e',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 'var(--r)', padding: '8px 12px', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font)', width: '100%', minHeight: 44,
        }}>↑ Reaktivieren</button>
      ) : (
        <button onClick={onArchive} style={{
          background: 'transparent', color: 'var(--text3)', border: '1px solid var(--border)',
          borderRadius: 'var(--r)', padding: '8px 12px', cursor: 'pointer',
          fontSize: 12, fontFamily: 'var(--font)', width: '100%', minHeight: 44,
        }}>Archivieren</button>
      )}
    </>
  )
}

// ─── 24h Window Warning ──────────────────────────────────────────────────────

function WindowWarning({ messages }) {
  const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound')
  if (!lastInbound) return null
  const hoursAgo = (Date.now() - new Date(lastInbound.created_at).getTime()) / 36e5
  if (hoursAgo < 20) return null
  const expired = hoursAgo >= 24
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
      padding: '6px 10px', borderRadius: 'var(--r-sm)',
      background: expired ? 'rgba(239,68,68,0.08)' : 'rgba(234,179,8,0.08)',
      border: `1px solid ${expired ? 'rgba(239,68,68,0.25)' : 'rgba(234,179,8,0.25)'}`,
      fontSize: 11, color: expired ? '#ef4444' : '#eab308',
    }}>
      {expired ? '⛔' : '⚠️'}
      {expired
        ? ` 24h-Fenster abgelaufen (${Math.round(hoursAgo)}h) — Instagram blockiert ausgehende Nachrichten.`
        : ` Noch ${Math.round(24 - hoursAgo)}h im 24h-Fenster`
      }
    </div>
  )
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function ConvItem({ conv, selected, onClick, onToggleClaude, onArchive, isArchived = false, onReactivate }) {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 16px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
        background: selected ? 'var(--bg-card)' : 'transparent',
        transition: 'background 0.1s',
        position: 'relative',
      }}
    >
      {!isArchived && (
        <button
          onClick={e => { e.stopPropagation(); onArchive() }}
          title="Kein Lead — ausblenden"
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '1px 6px', fontSize: 10,
            color: 'var(--text3)', cursor: 'pointer', fontFamily: 'var(--font)',
            opacity: 0, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = 1}
          onMouseLeave={e => e.currentTarget.style.opacity = 0}
          onFocus={e => e.currentTarget.style.opacity = 1}
          onBlur={e => e.currentTarget.style.opacity = 0}
        >kein Lead ✕</button>
      )}
      {isArchived && onReactivate && (
        <button
          onClick={e => { e.stopPropagation(); onReactivate() }}
          style={{
            position: 'absolute', top: 8, right: 8,
            background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: 4, padding: '2px 8px', fontSize: 10,
            color: '#22c55e', cursor: 'pointer', fontFamily: 'var(--font)',
          }}
        >↑ Reaktivieren</button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ position: 'relative' }}>
          <Avatar name={conv.display_name} pic={conv.profile_pic_url} size={36} />
          <div style={{
            position: 'absolute', bottom: -1, right: -1,
            width: 8, height: 8, borderRadius: '50%',
            background: HEAT_COLORS[conv.lead_heat],
            border: '1.5px solid var(--bg-sidebar)',
          }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: conv.has_unread ? 700 : 500, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {conv.display_name || conv.instagram_username}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              {conv.has_unread && (
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--accent)', flexShrink: 0,
                  boxShadow: '0 0 6px rgba(238,79,0,0.6)',
                }} />
              )}
              <div style={{ fontSize: 10, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                {formatTime(conv.last_message_at)}
              </div>
            </div>
          </div>
          <div style={{
            fontSize: 12, color: conv.has_unread ? 'var(--text)' : 'var(--text2)',
            fontWeight: conv.has_unread ? 500 : 400,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2,
          }}>
            {conv.last_message_preview || '—'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: HEAT_COLORS[conv.lead_heat] }}>{conv.lead_score}pts</span>
            {conv.gender === 'female' && <span style={{ fontSize: 10, color: '#ec4899' }}>♀</span>}
            {conv.gender === 'male' && <span style={{ fontSize: 10, color: '#3b82f6' }}>♂</span>}
            {conv.claude_blocked && <span style={{ fontSize: 10, color: '#ef4444' }}>🚫</span>}
            {!isArchived && (
              <span
                onClick={e => { e.stopPropagation(); onToggleClaude() }}
                style={{
                  marginLeft: 'auto', fontSize: 10,
                  color: conv.claude_blocked ? '#ef4444' : conv.claude_enabled ? 'var(--accent)' : 'var(--text3)',
                  cursor: 'pointer',
                }}
              >
                {conv.claude_blocked ? '🚫 gesperrt' : conv.claude_enabled ? '● Claude' : '○ Claude'}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg, onApprove }) {
  const isInbound = msg.direction === 'inbound'
  return (
    <div style={{
      display: 'flex', justifyContent: isInbound ? 'flex-start' : 'flex-end',
      marginBottom: 12,
    }}>
      <div style={{ maxWidth: '75%' }}>
        <div style={{
          padding: '8px 12px', borderRadius: isInbound ? '4px 12px 12px 12px' : '12px 4px 12px 12px',
          background: isInbound ? 'var(--bg-card)' : msg.sent_by === 'claude' ? 'rgba(238,79,0,0.15)' : 'var(--accent)',
          color: 'var(--text)', fontSize: 14, lineHeight: 1.5,
          border: msg.sent_by === 'claude' ? '1px solid rgba(238,79,0,0.3)' : 'none',
        }}>
          {msg.content}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 3, textAlign: isInbound ? 'left' : 'right' }}>
          {msg.sent_by === 'claude' ? '🤖 Claude · ' : msg.sent_by === 'thomas' ? '✓ Du · ' : ''}
          {formatTime(msg.created_at)}
        </div>
      </div>
    </div>
  )
}

function SettingsPanel({ config, onUpdate, onStyleDna, styleDnaLoading }) {
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 10 }}>
          STANDARD MODUS
        </div>
        {['A', 'B', 'C'].map(mode => (
          <button key={mode} onClick={() => onUpdate('default_autonomy_mode', mode)} style={{
            display: 'block', width: '100%', textAlign: 'left',
            padding: '8px 10px', borderRadius: 'var(--r-sm)', marginBottom: 4,
            border: `1px solid ${config['default_autonomy_mode'] === mode ? 'var(--accent)' : 'var(--border)'}`,
            background: config['default_autonomy_mode'] === mode ? 'var(--accent-dim)' : 'var(--bg-card)',
            color: config['default_autonomy_mode'] === mode ? 'var(--accent)' : 'var(--text2)',
            cursor: 'pointer', fontFamily: 'var(--font)', fontSize: 12, minHeight: 44,
          }}>
            <strong>{mode}</strong> — {AUTONOMY_LABELS[mode]}
          </button>
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
          BLOCKLIST — CLAUDE ANTWORTET NIE
        </div>
        <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8 }}>
          Instagram Usernames (einer pro Zeile, ohne @).
        </div>
        <textarea
          key="blocked_usernames"
          defaultValue={config['blocked_usernames'] || ''}
          onBlur={e => onUpdate('blocked_usernames', e.target.value)}
          placeholder={'max.mustermann\nanna.fitness'}
          rows={5}
          style={{
            width: '100%', background: 'var(--bg-input)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)',
            resize: 'vertical', outline: 'none',
          }}
        />
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 10 }}>
          MANYCHAT API
        </div>
        <input
          type="password"
          defaultValue={config['manychat_api_key'] || ''}
          onBlur={e => onUpdate('manychat_api_key', e.target.value)}
          placeholder="ManyChat API Key..."
          style={{
            width: '100%', background: 'var(--bg-input)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 'var(--r)',
            padding: '8px 10px', fontSize: 13, fontFamily: 'var(--font)', outline: 'none',
            minHeight: 44,
          }}
        />
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
          ERÖFFNUNGSTEXTE
        </div>
        {[1, 2, 3].map(i => (
          <textarea
            key={i}
            defaultValue={config['opening_msg_' + i] || ''}
            onBlur={e => onUpdate('opening_msg_' + i, e.target.value)}
            placeholder={i === 1 ? 'z.B. "Hey, hab gesehen du hast mein Reel geliked 💪🏽"' : 'Variante ' + i + ' (optional)'}
            rows={2}
            style={{
              width: '100%', background: 'var(--bg-input)', color: 'var(--text)',
              border: '1px solid var(--border)', borderRadius: 'var(--r)',
              padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none',
              resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box', marginBottom: 6,
            }}
          />
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 6 }}>
          STYLE DNA
        </div>
        {config['style_dna'] && (
          <div style={{
            background: 'var(--bg-card)', borderRadius: 'var(--r)', padding: 10,
            fontSize: 11, color: 'var(--text2)', lineHeight: 1.6, marginBottom: 8,
            maxHeight: 120, overflowY: 'auto',
          }}>
            {config['style_dna']}
          </div>
        )}
        <button
          onClick={onStyleDna}
          disabled={styleDnaLoading}
          style={{
            width: '100%', background: 'var(--accent)', color: '#fff', border: 'none',
            borderRadius: 'var(--r)', padding: '10px 12px', fontSize: 12,
            cursor: styleDnaLoading ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font)', fontWeight: 500, opacity: styleDnaLoading ? 0.6 : 1,
            minHeight: 44,
          }}
        >
          {styleDnaLoading ? 'Analysiere...' : '✦ Style DNA extrahieren'}
        </button>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div>
        <div style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600, letterSpacing: '0.05em', marginBottom: 10 }}>
          PRODUKTE
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 500, marginBottom: 6 }}>Hauptprodukt (1:1 Coaching)</div>
          <input
            key={`pname_${config['primary_product_name'] !== undefined}`}
            defaultValue={config['primary_product_name'] || ''}
            onBlur={e => onUpdate('primary_product_name', e.target.value)}
            placeholder="Name..."
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', marginBottom: 4, boxSizing: 'border-box', minHeight: 44 }}
          />
          <input
            key={`purl_${config['primary_product_url'] !== undefined}`}
            defaultValue={config['primary_product_url'] || ''}
            onBlur={e => onUpdate('primary_product_url', e.target.value)}
            placeholder="URL..."
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', marginBottom: 4, boxSizing: 'border-box', minHeight: 44 }}
          />
          <textarea
            key={`pdesc_${config['primary_product_desc'] !== undefined}`}
            defaultValue={config['primary_product_desc'] || ''}
            onBlur={e => onUpdate('primary_product_desc', e.target.value)}
            placeholder="Kurzbeschreibung für Claude..."
            rows={3}
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }}
          />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text2)', fontWeight: 500, marginBottom: 6 }}>Fallback-Produkt (App)</div>
          <input
            key={`sname_${config['secondary_product_name'] !== undefined}`}
            defaultValue={config['secondary_product_name'] || ''}
            onBlur={e => onUpdate('secondary_product_name', e.target.value)}
            placeholder="Name..."
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', marginBottom: 4, boxSizing: 'border-box', minHeight: 44 }}
          />
          <input
            key={`surl_${config['secondary_product_url'] !== undefined}`}
            defaultValue={config['secondary_product_url'] || ''}
            onBlur={e => onUpdate('secondary_product_url', e.target.value)}
            placeholder="URL..."
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '8px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', marginBottom: 4, boxSizing: 'border-box', minHeight: 44 }}
          />
          <textarea
            key={`sdesc_${config['secondary_product_desc'] !== undefined}`}
            defaultValue={config['secondary_product_desc'] || ''}
            onBlur={e => onUpdate('secondary_product_desc', e.target.value)}
            placeholder="Kurzbeschreibung für Claude..."
            rows={2}
            style={{ width: '100%', background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '7px 10px', fontSize: 12, fontFamily: 'var(--font)', outline: 'none', resize: 'vertical', lineHeight: 1.5, boxSizing: 'border-box' }}
          />
        </div>
      </div>
    </div>
  )
}

function GenderBadge({ gender, inline = false }) {
  const map = {
    male: { label: '♂ Mann', color: '#3b82f6' },
    female: { label: '♀ Frau', color: '#ec4899' },
    unknown: { label: '? Unbekannt', color: '#555' },
  }
  const g = map[gender] || map.unknown
  if (inline) return <span style={{ color: g.color, fontSize: 12 }}>{g.label}</span>
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: `${g.color}18`, color: g.color,
      border: `1px solid ${g.color}40`,
    }}>{g.label}</span>
  )
}

function Toggle({ value, onChange }) {
  return (
    <div onClick={onChange} style={{
      width: 36, height: 20, borderRadius: 10, cursor: 'pointer',
      background: value ? 'var(--accent)' : 'var(--border)',
      position: 'relative', transition: 'background 0.2s', flexShrink: 0,
    }}>
      <div style={{
        position: 'absolute', top: 2,
        left: value ? 18 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: '#fff', transition: 'left 0.2s',
      }} />
    </div>
  )
}

function Avatar({ name, pic, size = 36 }) {
  if (pic) return <img src={pic} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: 'var(--accent-dim)', border: '1px solid rgba(238,79,0,0.3)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.4, fontWeight: 600, color: 'var(--accent)', flexShrink: 0,
    }}>
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

function HeatBadge({ heat }) {
  const labels = { hot: '🔥 Heiß', warm: '🟡 Warm', cold: '❄️ Kalt', archived: '🗄 Archiv' }
  return (
    <span style={{
      fontSize: 11, padding: '2px 8px', borderRadius: 4,
      background: `${HEAT_COLORS[heat]}20`,
      color: HEAT_COLORS[heat],
      border: `1px solid ${HEAT_COLORS[heat]}40`,
    }}>{labels[heat] || heat}</span>
  )
}

function ClaudeBanner({ messages, conv, sending, generateError, onApprove, onEdit, onGenerate }) {
  const lastInbound = [...messages].reverse().find(m => m.direction === 'inbound')
  if (!lastInbound) return null

  const lastInboundTime = lastInbound.created_at
  const alreadyReplied = messages.some(m => m.direction === 'outbound' && m.created_at > lastInboundTime)

  const btnBase = {
    borderRadius: 'var(--r-sm)', padding: '6px 14px', fontSize: 12,
    cursor: 'pointer', fontFamily: 'var(--font)', fontWeight: 600,
    transition: 'opacity 0.15s, transform 0.1s', border: 'none',
  }

  if (alreadyReplied) {
    return (
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)',
        borderRadius: 'var(--r)', padding: '7px 12px', marginBottom: 10,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 11, color: 'var(--text3)', flex: 1, overflow: 'hidden', marginRight: 8 }}>
          {lastInbound.claude_suggestion
            ? `✦ "${lastInbound.claude_suggestion.slice(0, 60)}${lastInbound.claude_suggestion.length > 60 ? '…' : ''}"`
            : '✦ Kein Claude-Vorschlag vorhanden'
          }
        </div>
        <button onClick={onGenerate} disabled={sending} style={{
          ...btnBase,
          background: 'transparent', color: 'var(--text3)',
          border: '1px solid var(--border)', fontSize: 11,
          padding: '4px 10px', opacity: sending ? 0.5 : 1, flexShrink: 0,
        }}>{sending ? '⏳' : '↻ Neu'}</button>
      </div>
    )
  }

  if (conv?.claude_blocked) return null

  if (generateError) {
    return (
      <div style={{
        background: 'rgba(220,50,50,0.08)', border: '1px solid rgba(220,50,50,0.35)',
        borderRadius: 'var(--r)', padding: '10px 12px', marginBottom: 10,
      }}>
        <div style={{ fontSize: 11, color: '#e05', marginBottom: 6 }}>
          ⚠ Generierung fehlgeschlagen: {generateError}
        </div>
        <button onClick={onGenerate} disabled={sending} style={{
          ...btnBase,
          background: sending ? '#333' : 'var(--accent)',
          color: '#fff', opacity: sending ? 0.7 : 1,
        }}>{sending ? '⏳ Generiert...' : '↻ Nochmal versuchen'}</button>
      </div>
    )
  }

  if (lastInbound.claude_suggestion) {
    return (
      <div style={{
        background: 'rgba(238,79,0,0.08)', border: '1px solid rgba(238,79,0,0.3)',
        borderRadius: 'var(--r)', padding: '10px 12px', marginBottom: 10,
      }}>
        <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginBottom: 6, letterSpacing: '0.05em' }}>
          ✦ CLAUDE SCHLÄGT VOR
        </div>
        <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.5, marginBottom: 8 }}>
          {lastInbound.claude_suggestion}
        </div>
        {lastInbound.claude_reasoning && (
          <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10, fontStyle: 'italic' }}>
            💡 {lastInbound.claude_reasoning}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => onApprove(lastInbound)} disabled={sending} style={{
            ...btnBase,
            background: sending ? '#555' : 'var(--accent)',
            color: '#fff', opacity: sending ? 0.7 : 1, minWidth: 90, minHeight: 40,
          }}>{sending ? '⏳ Sendet...' : '✓ Senden'}</button>
          <button onClick={() => onEdit(lastInbound.claude_suggestion)} disabled={sending} style={{
            ...btnBase,
            background: 'var(--bg-card)', color: 'var(--text)',
            border: '1px solid var(--border)', opacity: sending ? 0.5 : 1, minHeight: 40,
          }}>✏ Bearbeiten</button>
          <button onClick={onGenerate} disabled={sending} style={{
            ...btnBase,
            background: 'var(--bg-card)', color: 'var(--accent)',
            border: '1px solid rgba(238,79,0,0.4)',
            opacity: sending ? 0.5 : 1, minWidth: 80, minHeight: 40,
          }}>{sending ? '⏳' : '↻ Neu'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'rgba(238,79,0,0.05)', border: '1px solid rgba(238,79,0,0.25)',
      borderRadius: 'var(--r)', padding: '10px 12px', marginBottom: 10,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <div style={{ fontSize: 12, color: 'var(--text2)' }}>Kein Vorschlag für diese Nachricht</div>
      <button onClick={onGenerate} disabled={sending} style={{
        ...btnBase,
        background: sending ? '#333' : 'var(--accent)',
        color: '#fff', opacity: sending ? 0.7 : 1, minWidth: 160, minHeight: 44,
      }}>{sending ? '⏳ Generiert...' : '✦ Vorschlag generieren'}</button>
    </div>
  )
}

function formatTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const diff = now - d
  if (diff < 60000) return 'Gerade eben'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
}
