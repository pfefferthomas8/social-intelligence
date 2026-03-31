// analyze-thomas — Extrahiert Thomas' DNA aus seinen Posts und speichert Insights
// Läuft automatisch nach jedem Scrape des eigenen Profils
// Je mehr Posts → desto präziser wird das Modell

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 500)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Thomas' eigene Posts nach Engagement sortiert
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?source=eq.own&caption=not.is.null&order=views_count.desc&limit=50&select=caption,transcript,post_type,views_count,likes_count,comments_count,content_pillar`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const posts: any[] = await postsRes.json()

  if (!Array.isArray(posts) || posts.length < 3) {
    return new Response(JSON.stringify({ ok: false, message: 'Zu wenige eigene Posts für Analyse' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Competitor Top-Posts zum Vergleich
  const compRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?source=eq.competitor&caption=not.is.null&order=views_count.desc&limit=20&select=caption,post_type,views_count,content_pillar`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const compPosts: any[] = await compRes.json()

  // Bestehende DNA für Kontext
  const dnaRes = await fetch(
    `${SUPABASE_URL}/rest/v1/thomas_dna?order=confidence.desc&limit=20&select=category,insight,confidence`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const existingDna: any[] = await dnaRes.json()

  // Posts aufbereiten
  const topPosts = posts.slice(0, 20).map((p: any, i: number) => {
    const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
    return `[Post ${i+1} | ${(p.views_count || 0).toLocaleString()} Views | Säule: ${p.content_pillar || '?'}]\n${text}`
  }).join('\n\n')

  const lowPosts = posts.slice(20).map((p: any) => {
    const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
    return `[${(p.views_count || 0).toLocaleString()} Views] ${text.substring(0, 150)}`
  }).join('\n')

  const compContext = compPosts.slice(0, 10).map((p: any) =>
    `[${(p.views_count || 0).toLocaleString()} Views | ${p.post_type}] ${clean(p.caption).substring(0, 150)}`
  ).join('\n')

  const existingDnaContext = existingDna.length > 0
    ? `\nBEREITS BEKANNTE ERKENNTNISSE (erweitern oder korrigieren wenn nötig):\n${existingDna.map((d: any) => `[${d.category}|${d.confidence}%] ${d.insight}`).join('\n')}`
    : ''

  const prompt = `Du analysierst die Instagram-Posts von Thomas Pfeffer, Fitness-Coach für Männer 30+ (DACH), und extrahierst tiefgreifende Erkenntnisse über seinen Stil, seine Stärken und sein Publikum.

THOMAS' TOP-POSTS (nach Views, höchste zuerst):
${topPosts}

THOMAS' WEITERE POSTS:
${lowPosts}

ENGLISCHSPRACHIGE TOP-COMPETITOR-POSTS (Benchmark):
${compContext}
${existingDnaContext}

ANALYSEAUFGABE:
Extrahiere präzise, handlungsrelevante Erkenntnisse in diesen 6 Kategorien:

1. "hook_pattern" — Welche Satzanfänge, Strukturen und Formulierungen funktionieren am besten bei Thomas? Konkrete Muster, kein Allgemeinwissen.

2. "style_rule" — Wie schreibt Thomas? Satzbau, Rhythmus, Wortwahl, Direktheit, was er NICHT macht. So präzise wie ein Ghostwriter-Briefing.

3. "pillar_insight" — Was performt in welcher Säule (haltung/transformation/mehrwert/verkauf)? Wo liegen Stärken, wo Lücken?

4. "audience_pattern" — Womit resoniert seine Zielgruppe (Männer 30+) am stärksten? Konkrete Themen, Trigger, emotionale Anknüpfungspunkte.

5. "competitor_gap" — Was machen die englischen Coaches erfolgreich, das Thomas noch NICHT macht aber könnte? Spezifische Lücken.

6. "growth_opportunity" — Konkrete, umsetzbare Empfehlungen für die nächsten Wochen basierend auf den Daten.

Gib für jede Erkenntnis an:
- category: einer der 6 Typen oben
- insight: Die Erkenntnis (2-4 Sätze, sehr konkret und umsetzbar)
- confidence: 0-100 (wie sicher bist du basierend auf den Daten)
- source_count: Auf wie vielen Posts basiert diese Erkenntnis

Antworte NUR mit JSON-Array:
[{"category":"hook_pattern","insight":"...","confidence":85,"source_count":12}]`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text || '[]'

  let insights: any[] = []
  try {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (match) insights = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'Parse error', raw: rawText.substring(0, 500) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const validCategories = ['hook_pattern', 'style_rule', 'pillar_insight', 'audience_pattern', 'competitor_gap', 'growth_opportunity']

  // Alte DNA löschen und durch neue ersetzen (jede Analyse ist vollständig)
  await fetch(`${SUPABASE_URL}/rest/v1/thomas_dna`, {
    method: 'DELETE',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' }
  })

  const toInsert = insights
    .filter((i: any) => i.insight && validCategories.includes(i.category))
    .map((i: any) => ({
      category: i.category,
      insight: String(i.insight).substring(0, 1000),
      confidence: Math.min(100, Math.max(0, parseInt(i.confidence) || 50)),
      source_count: parseInt(i.source_count) || 1
    }))

  if (toInsert.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/thomas_dna`, {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify(toInsert)
    })
  }

  return new Response(JSON.stringify({ ok: true, insights_saved: toInsert.length, posts_analyzed: posts.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
