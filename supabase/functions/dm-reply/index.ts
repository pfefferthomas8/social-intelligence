const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation',
  }
}

async function dbGet(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  return res.json()
}

async function dbPatch(path: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function dbPost(path: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function callClaude(system: string, messages: any[], maxTokens = 300): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: maxTokens, system, messages }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { conversation_id, autonomy_mode, trigger_message } = await req.json()

    // Load conversation
    const convArr = await dbGet(`dm_conversations?id=eq.${conversation_id}&limit=1`)
    const conv = Array.isArray(convArr) ? convArr[0] : null
    if (!conv) throw new Error('Conversation not found')

    // Load last 20 messages
    const msgs = await dbGet(`dm_messages?conversation_id=eq.${conversation_id}&order=created_at.asc&limit=20`)
    const messages: any[] = Array.isArray(msgs) ? msgs : []

    // Load config
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    if (Array.isArray(configRows)) configRows.forEach((c: any) => { config[c.key] = c.value })

    const styleDna = config['style_dna'] || 'Locker, direkt, authentisch. Kurze Sätze. Kein Marketing-Speak.'

    // Opening message templates
    const openingMsgs = [
      config['opening_msg_1'],
      config['opening_msg_2'],
      config['opening_msg_3'],
    ].filter(m => m?.trim())
    const openingContext = openingMsgs.length > 0
      ? `THOMAS' TYPISCHE ERÖFFNUNGSNACHRICHTEN BEI KALTAKQUISE:\n${openingMsgs.map((m, i) => `${i + 1}. "${m}"`).join('\n')}\n(Falls die erste Nachricht im Chat fehlt, wurde wahrscheinlich eine dieser Varianten gesendet.)`
      : ''

    // Product info
    const primaryName = config['primary_product_name'] || '1:1 Online Coaching'
    const primaryUrl = config['primary_product_url'] || 'https://www.thomas-pfeffer.com'
    const primaryDesc = config['primary_product_desc'] || ''
    const secondaryName = config['secondary_product_name'] || 'Form Training App'
    const secondaryUrl = config['secondary_product_url'] || 'https://www.form-training.at'
    const secondaryDesc = config['secondary_product_desc'] || ''

    // Build chat history
    const chatHistory = messages.map((m: any) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }))

    const systemPrompt = `Du bist Thomas Pfeffer, Fitness Coach aus Österreich. Du antwortest auf Instagram DMs von potenziellen männlichen Kunden.

DEIN EXAKTER SCHREIBSTIL (aus echten Chats analysiert):
${styleDna}

${openingContext}

DEINE PRODUKTE:
- Hauptprodukt: ${primaryName} → ${primaryUrl}${primaryDesc ? `\n  ${primaryDesc}` : ''}
  (IMMER primäres Ziel — hier liegt der Fokus)
- Fallback: ${secondaryName} → ${secondaryUrl}${secondaryDesc ? `\n  ${secondaryDesc}` : ''}
  (nur wenn Coaching wirklich nicht passt — z.B. klares Budget-Problem)

VERKAUFSPHILOSOPHIE — Socratic Selling:
- Stelle gezielte Fragen damit der Lead selbst erkennt dass er Hilfe braucht
- Nie pushen oder aufdränglich wirken — der Lead soll sich selbst überzeugen
- Erst Vertrauen aufbauen durch echtes Interesse an seiner Situation
- Max. 1 Frage pro Nachricht
- Nachrichten kurz halten — max. 2-3 Sätze
- Link erst schicken wenn der Moment wirklich reif ist
- App nur wenn Budget/Zeit klar dagegen spricht

LEAD INFO:
- Stage: ${conv.stage || 'qualification'}
- Score: ${conv.lead_score || 0}/100

ABSOLUT WICHTIG:
- Sei Thomas — schreib exakt wie er, nicht wie ein Bot
- Kein "Als Coach..." oder formelle Sprache
- Antworte auf Deutsch`

    const suggestion = await callClaude(
      systemPrompt,
      chatHistory.length > 0 ? chatHistory : [{ role: 'user', content: trigger_message }],
      300
    )

    const reasoning = await callClaude(
      'Du bist Sales-Stratege. Erkläre in 1-2 Sätzen warum diese DM-Antwort strategisch richtig ist.',
      [{ role: 'user', content: `Chat:\n${chatHistory.slice(-4).map((m: any) => `${m.role}: ${m.content}`).join('\n')}\n\nAntwort: ${suggestion}` }],
      120
    )

    // Save suggestion to last inbound message
    const lastInbound = messages.filter((m: any) => m.direction === 'inbound').pop()
    if (lastInbound) {
      await dbPatch(`dm_messages?id=eq.${lastInbound.id}`, {
        claude_suggestion: suggestion,
        claude_reasoning: reasoning,
      })
    }

    // Update stage
    const newStage = detectStage(trigger_message, conv.stage)
    if (newStage !== conv.stage) {
      await dbPatch(`dm_conversations?id=eq.${conversation_id}`, { stage: newStage })
    }

    // Mode C: auto-send
    if (autonomy_mode === 'C') {
      const manychatKey = config['manychat_api_key']
      if (manychatKey && conv.manychat_contact_id) {
        await sendViaManyChat(manychatKey, conv.manychat_contact_id, suggestion)
        await dbPost('dm_messages', {
          conversation_id,
          direction: 'outbound',
          content: suggestion,
          sent_by: 'claude',
          status: 'sent',
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, suggestion, reasoning }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('dm-reply error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})

async function sendViaManyChat(apiKey: string, subscriberId: string, text: string) {
  const res = await fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: { version: 'v2', content: { messages: [{ type: 'text', text }] } },
    }),
  })
  const data = await res.json()
  console.log('ManyChat sendViaManyChat response:', JSON.stringify(data))
  return data
}

function detectStage(message: string, currentStage: string): string {
  if (/preis|kosten|was kostet|wie viel|invest/i.test(message)) return 'offer'
  if (/wann|start|anfangen|wie geht|nächste schritt/i.test(message)) return 'closing'
  if (/interesse|würde gerne|klingt gut|cool|mega/i.test(message)) return 'interest'
  if (/aber|trotzdem|nicht sicher|überlegen|teuer/i.test(message)) return 'objection'
  return currentStage || 'qualification'
}
