const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

function clean(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 400)
}

const PILLAR_SYSTEM = `Du klassifizierst Instagram-Posts von Fitness-Coaches in 4 Content-Säulen:

1. "haltung" — Mindset, Werte, Denkmuster, Perspektiv-Shifts. Content der eine neue Sichtweise erzeugt. Oft philosophisch, provokant, oder meinungsstark.
2. "transformation" — Persönliche oder Kunden-Transformationsgeschichten, Vorher/Nachher, Storytelling. Auch fiktive aber nachvollziehbare Storys die die Zielgruppe (Männer 30+) bewegen.
3. "mehrwert" — Praktischer Mehrwert in kleinen Happen: Tipps, Anleitungen, Zahlen, Listen, Rezepte, Übungen. Direkt umsetzbar.
4. "verkauf" — Direkte Werbung: Coaching-Pakete, App-Bewerbung, Preise, Testimonials, Angebote, CTAs zum Kauf.

Gib NUR ein valides JSON-Array zurück. Keine Erklärungen.`

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Unklassifizierte Posts mit Caption holen (max 30)
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?content_pillar=is.null&caption=not.is.null&select=id,caption,transcript,post_type&limit=30`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const posts: any[] = await postsRes.json()

  if (!Array.isArray(posts) || posts.length === 0) {
    return new Response(JSON.stringify({ ok: true, classified: 0, message: 'Alle Posts bereits klassifiziert' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Batch-Prompt aufbauen
  const postList = posts.map((p: any, i: number) => {
    const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
    return `[${i}] id="${p.id}" type="${p.post_type}": ${text}`
  }).join('\n\n')

  const userPrompt = `Klassifiziere diese ${posts.length} Posts:\n\n${postList}\n\nAntworte NUR mit JSON-Array: [{"id":"...","pillar":"..."}]`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: PILLAR_SYSTEM,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text || '[]'

  let classified: { id: string; pillar: string }[] = []
  try {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (match) classified = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'JSON parse error', raw: rawText }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const validPillars = ['haltung', 'transformation', 'mehrwert', 'verkauf']
  let updated = 0

  // Alle validen Klassifizierungen updaten
  await Promise.all(
    classified
      .filter((c: any) => c.id && validPillars.includes(c.pillar))
      .map(async (c: any) => {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${c.id}`,
          {
            method: 'PATCH',
            headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
            body: JSON.stringify({ content_pillar: c.pillar })
          }
        )
        if (res.ok) updated++
      })
  )

  return new Response(JSON.stringify({ ok: true, classified: updated, total: posts.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
