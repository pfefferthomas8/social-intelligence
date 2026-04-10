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
  }
}

async function callClaude(prompt: string, maxTokens = 800): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json().catch(() => ({}))
    let sampleMessages: string[] = body.messages_sample || []
    let sourceUsed = ''

    if (sampleMessages.length >= 5) {
      sourceUsed = 'manual'
    }

    // Prio 2: Thomas's sent DMs from DB
    if (sampleMessages.length < 5) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/dm_messages?sent_by=eq.thomas&direction=eq.outbound&select=content&order=created_at.desc&limit=100`, { headers: dbHeaders() })
      const dmMessages = await res.json()
      if (Array.isArray(dmMessages) && dmMessages.length >= 5) {
        sampleMessages = dmMessages.map((m: any) => m.content)
        sourceUsed = 'dm_messages'
      }
    }

    // Prio 3: Own Instagram posts
    if (sampleMessages.length < 5) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?source=eq.own&caption=not.is.null&select=caption,transcript&order=likes_count.desc&limit=50`, { headers: dbHeaders() })
      const posts = await res.json()
      if (Array.isArray(posts) && posts.length > 0) {
        const captions = posts.map((p: any) => p.caption || p.transcript || '').filter((c: string) => c.length > 20)
        sampleMessages = [...sampleMessages, ...captions]
        sourceUsed = 'instagram_posts'
      }
    }

    // Prio 4: Fallback
    if (sampleMessages.length < 3) {
      const fallbackDna = `Thomas schreibt sehr direkt und authentisch. Kurze Sätze, maximal 2-3 pro Nachricht. Kein Marketing-Speak. Er redet auf Augenhöhe, stellt gezielte Einzelfragen. Nutzt Emojis regelmäßig (😊 🙏🏼 💪🏽 😅 😂 😏 🤩 🙌🏻). Österreichisch-deutsch, locker aber professionell.`

      await fetch(`${SUPABASE_URL}/rest/v1/dm_config?key=eq.style_dna`, {
        method: 'PATCH',
        headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ value: fallbackDna, updated_at: new Date().toISOString() }),
      })

      return new Response(JSON.stringify({ ok: true, style_dna: fallbackDna, source: 'fallback' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const sample = sampleMessages.slice(0, 150).join('\n---\n')
    const sourceLabel = sourceUsed === 'instagram_posts' ? 'Instagram Posts/Captions' : 'echte Instagram DM-Nachrichten'

    const styleDna = await callClaude(`Analysiere diese ${sourceLabel} von Thomas Pfeffer (Fitness Coach, Österreich/DACH).

NACHRICHTEN:
${sample}

Erstelle ein kompaktes Style-DNA Profil (max. 280 Wörter) als direkte Schreibanweisung für eine KI die Thomas in DMs imitieren soll. Sei sehr spezifisch — keine generischen Aussagen.

Analysiere und dokumentiere:
1. Satzbau & Länge (exakte Beobachtungen)
2. Tonalität & wie er Nähe aufbaut
3. Konkrete Phrasen & Formulierungen die er wiederholt verwendet
4. Emoji-Nutzung (welche genau, wie häufig, wo im Satz)
5. Wie er Fragen stellt (Stil, Formulierung)
6. Wie er auf positive Signale reagiert
7. Was er NICHT schreibt / aktiv vermeidet
8. Regionale/sprachliche Besonderheiten

Schreibe alles als Anweisung: "Thomas schreibt..." / "Er verwendet..." / "Er vermeidet..."`, 800)

    await fetch(`${SUPABASE_URL}/rest/v1/dm_config?key=eq.style_dna`, {
      method: 'PATCH',
      headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ value: styleDna, updated_at: new Date().toISOString() }),
    })

    return new Response(JSON.stringify({
      ok: true,
      style_dna: styleDna,
      source: sourceUsed,
      samples_used: sampleMessages.length
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('extract-style-dna error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
