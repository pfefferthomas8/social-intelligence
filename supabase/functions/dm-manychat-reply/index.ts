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

async function dbGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

async function dbPost(table: string, body: any): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation', 'on-conflict': 'manychat_contact_id' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return Array.isArray(data) ? data[0] : data
}

async function dbInsert(table: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function dbPatch(table: string, filter: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function callClaude(system: string, messages: any[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 300, system, messages }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

const FEMALE_NAMES = new Set([
  'anna','maria','laura','julia','sarah','lisa','katharina','sandra','andrea','stefanie',
  'nicole','petra','claudia','martina','jessica','jennifer','christina','melanie','franziska',
  'barbara','susanne','monika','bianca','sabrina','vanessa','lena','lea','emma','mia','hannah',
  'sophie','charlotte','marie','kathrin','michaela','daniela','verena','simone','marina',
  'magdalena','theresa','teresa','eva','jasmin','nina','carina','natalie','tanja','sonja',
  'britta','silvia','gabi','gabriele','renate','ursula','hilde','elke','inge','helga','gisela',
  'christa','karin','bettina','nadine','manuela','anja','anne','antonia','alina','amelie',
  'emilia','luisa','louisa','valentina','viktoria','victoria','nathalie','anika','annika',
  'jana','kim','tina','vera','yvonne','zoe','stella','isabella','johanna','veronika',
])

function detectGender(name: string, username: string): string {
  const combined = `${name} ${username}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (/\bmrs[\.\s]|^mrs$|\bms[\.\s]|^ms$|\bfrau\b|\blady\b|\bgirl\b/.test(combined)) return 'female'
  if (/girl|woman|women|lady|mama|mami|queen|princess|babygirl/.test(combined)) return 'female'
  const firstName = name.trim().split(/[\s\.\_]/)[0].toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (FEMALE_NAMES.has(firstName)) return 'female'
  return 'unknown'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      subscriber_id,
      trigger_message,
      display_name = '',
      ig_username = '',
    } = body

    if (!subscriber_id || !trigger_message) {
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    console.log(`dm-manychat-reply: ${ig_username} (${subscriber_id}): ${trigger_message.slice(0, 80)}`)

    // Load config
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    configRows.forEach((c: any) => { config[c.key] = c.value })

    // Check global Claude toggle
    if (config['global_claude_enabled'] !== 'true') {
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Gender check
    const gender = detectGender(display_name, ig_username)
    if (gender === 'female') {
      console.log(`Skipping female: ${display_name}`)
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Upsert conversation
    const conv = await dbPost('dm_conversations', {
      manychat_contact_id: String(subscriber_id),
      instagram_username: ig_username || String(subscriber_id),
      display_name: display_name || ig_username || 'Unbekannt',
      gender,
      last_message_at: new Date().toISOString(),
      last_message_preview: trigger_message.slice(0, 100),
      updated_at: new Date().toISOString(),
    })

    if (!conv?.id) throw new Error('Failed to upsert conversation')

    // Check if manually blocked
    if (conv.claude_blocked) {
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Save inbound message
    await dbInsert('dm_messages', {
      conversation_id: conv.id,
      direction: 'inbound',
      content: trigger_message,
      sent_by: 'user',
    })

    // Load last 20 messages for context
    const msgs = await dbGet(`dm_messages?conversation_id=eq.${conv.id}&order=created_at.asc&limit=20`)

    // Build chat history
    const chatHistory = msgs.map((m: any) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }))

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
    const styleDna = config['style_dna'] || 'Locker, direkt, authentisch. Kurze Sätze. Kein Marketing-Speak.'

    const systemPrompt = `Du bist Thomas Pfeffer, Fitness Coach aus Österreich. Du antwortest auf Instagram DMs von potenziellen männlichen Kunden.

DEIN EXAKTER SCHREIBSTIL (aus echten Chats analysiert):
${styleDna}

${openingContext}

DEINE PRODUKTE:
- Hauptprodukt: ${primaryName} → ${primaryUrl}${primaryDesc ? '\n  ' + primaryDesc : ''}
  (IMMER primäres Ziel)
- Fallback: ${secondaryName} → ${secondaryUrl}${secondaryDesc ? '\n  ' + secondaryDesc : ''}
  (nur wenn Coaching wirklich nicht passt)

VERKAUFSPHILOSOPHIE — Socratic Selling:
- Stelle gezielte Fragen damit der Lead selbst erkennt dass er Hilfe braucht
- Nie pushen oder aufdränglich wirken
- Erst Vertrauen aufbauen durch echtes Interesse an seiner Situation
- Max. 1 Frage pro Nachricht
- Nachrichten kurz halten — max. 2-3 Sätze
- Link erst schicken wenn der Moment wirklich reif ist

LEAD INFO:
- Stage: ${conv.stage || 'qualification'}
- Score: ${conv.lead_score || 0}/100

ABSOLUT WICHTIG:
- Sei Thomas — schreib exakt wie er, nicht wie ein Bot
- Kein "Als Coach..." oder formelle Sprache
- Niemals Bindestriche als Gedankenstrich
- Antworte auf Deutsch (außer der Lead schreibt klar auf Englisch)`

    const history = chatHistory.length > 0
      ? chatHistory
      : [{ role: 'user', content: trigger_message }]

    const reply = await callClaude(systemPrompt, history)

    if (!reply) throw new Error('Claude returned empty reply')

    // Save outbound message to DB (for DM Center monitoring)
    await dbInsert('dm_messages', {
      conversation_id: conv.id,
      direction: 'outbound',
      content: reply,
      sent_by: 'claude',
      status: 'sent',
    })

    // Update conversation
    await dbPatch('dm_conversations', `id=eq.${conv.id}`, {
      last_message_at: new Date().toISOString(),
      last_message_preview: reply.slice(0, 100),
      updated_at: new Date().toISOString(),
    })

    // Update lead score
    let scoreIncrease = 0
    if (/preis|kosten|was kostet|wie viel|invest/i.test(trigger_message)) scoreIncrease += 20
    if (/interesse|interessiert|würde gerne|möchte|will/i.test(trigger_message)) scoreIncrease += 15
    if (/abnehm|gewicht|kilo|kg|fett|muskel|training|coaching/i.test(trigger_message)) scoreIncrease += 10
    if (/wann|start|anfangen|beginnen|wie geht/i.test(trigger_message)) scoreIncrease += 15
    if (trigger_message.length > 100) scoreIncrease += 5
    if (scoreIncrease > 0) {
      const newScore = Math.min(100, (conv.lead_score || 0) + scoreIncrease)
      const heat = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold'
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { lead_score: newScore, lead_heat: heat })
    }

    console.log(`Reply generated for ${ig_username}: ${reply.slice(0, 60)}...`)

    return new Response(JSON.stringify({ reply }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('dm-manychat-reply error:', err)
    return new Response(JSON.stringify({ reply: '', error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
