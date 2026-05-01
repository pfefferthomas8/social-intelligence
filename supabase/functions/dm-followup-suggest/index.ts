const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }
}

async function dbGet(path: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  return res.json()
}

async function callClaude(system: string, messages: any[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 200, system, messages }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { conversation_id } = await req.json()
    if (!conversation_id) throw new Error('conversation_id fehlt')

    // Konversation laden
    const convArr = await dbGet(`dm_conversations?id=eq.${conversation_id}&limit=1`)
    const conv = Array.isArray(convArr) ? convArr[0] : null
    if (!conv) throw new Error('Conversation not found')

    // Letzte 30 Nachrichten laden
    const msgs = await dbGet(
      `dm_messages?conversation_id=eq.${conversation_id}&order=created_at.asc&limit=30`
    )
    const messages: any[] = Array.isArray(msgs) ? msgs : []

    // Config laden
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    if (Array.isArray(configRows)) configRows.forEach((c: any) => { config[c.key] = c.value })

    const styleDna = config['style_dna'] || 'Locker, direkt, authentisch. Kurze Sätze.'
    const primaryProduct = config['primary_product_name'] || 'Form Training App'
    const primaryUrl = config['primary_product_url'] || ''

    // Stunden seit letzter Nachricht
    const lastMsgAt = conv.last_message_at ? new Date(conv.last_message_at) : new Date()
    const hoursSince = Math.round((Date.now() - lastMsgAt.getTime()) / 36e5)

    // Chatprotokoll aufbauen
    const chatHistory = messages.map((m: any) => {
      const role = m.direction === 'inbound' ? 'Lead' : 'Thomas'
      return `${role}: ${m.content}`
    }).join('\n')

    const lastInbound = [...messages].reverse().find((m: any) => m.direction === 'inbound')
    const lastInboundText = lastInbound?.content || ''
    const stage = conv.stage || 'discovery'

    const systemPrompt = `Du bist Thomas Pfeffer, Fitness Coach aus Österreich.

DEIN SCHREIBSTIL:
${styleDna}

PRODUKT: ${primaryProduct}${primaryUrl ? ` — ${primaryUrl}` : ''}

AUFGABE: Schreibe eine kurze, natürliche Nachfass-Nachricht für Instagram DM.

KONTEXT:
- Der Lead hat seit ${hoursSince} Stunden nicht geantwortet
- Gesprächsphase: ${stage}
- Letzte Nachricht des Leads: "${lastInboundText}"

REGELN:
- Maximal 1-2 Sätze
- Keine Verkaufsansprache — nur Interesse wecken
- Nicht aufdringlich, eher neugierig und locker
- Kein "Ich wollte nur nachfragen ob..." — das klingt verzweifelt
- Stattdessen: kurze, echte Frage ODER kurzer Mehrwert-Impuls
- Passend zur Gesprächsphase: ${stage === 'discovery' ? 'noch kein Produkt erwähnen, nur Neugier wecken' : stage === 'pitched' ? 'sanft ans Angebot erinnern ohne Druck' : 'natürlich weiterführen'}
- NUR die Nachricht ausgeben, keine Erklärung`

    const claudeMessages = [
      {
        role: 'user',
        content: `Hier ist unser bisheriger Chat:\n\n${chatHistory}\n\nSchreib jetzt die Nachfass-Nachricht.`,
      },
    ]

    const suggestion = await callClaude(systemPrompt, claudeMessages)

    return new Response(JSON.stringify({ suggestion, hours_since: hoursSince }), {
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('dm-followup-suggest error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
    })
  }
})
