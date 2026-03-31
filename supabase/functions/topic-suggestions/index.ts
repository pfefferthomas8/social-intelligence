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

async function dbQuery(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function clean(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 300)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const since21d = new Date(Date.now() - 21 * 86400000).toISOString()

  const [trendingPosts, ownPosts, usedTopics] = await Promise.all([
    dbQuery(`instagram_posts?select=caption,transcript,post_type,views_count,likes_count,published_at,competitor_profiles(username)&source=eq.competitor&scraped_at=gte.${since21d}&order=views_count.desc&limit=30`),
    dbQuery('instagram_posts?select=caption,transcript,post_type,views_count&source=eq.own&order=scraped_at.desc&limit=50'),
    dbQuery('topic_suggestions?select=title&order=created_at.desc&limit=20')
  ])

  const trendingContext = trendingPosts
    .map((p: any) => {
      const username = p.competitor_profiles?.username || 'unknown'
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
      return `@${username} | ${p.post_type} | ${p.views_count || 0} Views: ${text}`
    }).join('\n').substring(0, 5000)

  const ownContext = ownPosts
    .map((p: any) => clean([p.caption, p.transcript].filter(Boolean).join(' ')))
    .filter(Boolean).join('\n').substring(0, 2000)

  const usedTitles = usedTopics.map((t: any) => t.title).join(', ')
  const hasData = trendingPosts.length > 0

  const prompt = hasData
    ? `Du analysierst Instagram-Performance-Daten für Thomas Pfeffer, Fitness-Coach für Männer 30+ (DACH).

DIE WICHTIGSTEN VIRAL-POSTS DER LETZTEN 21 TAGE (englischsprachige Competitors):
${trendingContext}

THOMAS' EIGENE POSTS:
${ownContext || 'Noch keine eigenen Posts gescrapt.'}

BEREITS VORGESCHLAGENE THEMEN (nicht wiederholen):
${usedTitles || 'Keine.'}

ANALYSE-AUFGABE:
1. Was sind die übergeordneten THEMEN/MUSTER die bei den englischen Coaches gerade viral gehen?
2. Welche davon gibt es im deutschsprachigen Raum noch NICHT oder kaum?
3. Welche Themen passen zu Thomas' Profil (Männer 30+, Kraft, Ernährung, Lifestyle)?

GENERIERE 8 konkrete Themenvorschläge auf Deutsch.

Für jeden Vorschlag:
- title: Konkretes Thema als starke Aussage oder Frage (max 10 Wörter, auf Deutsch)
- reason: Warum das gerade Potenzial hat (2-3 Sätze)
- category: "trending", "gap", "evergreen", oder "personal"
- potential_views: Schätzung für DACH-Markt (z.B. "30K-150K")
- suggested_types: Array aus: "video_script", "carousel", "single_post", "b_roll"

Antworte NUR mit einem validen JSON-Array:
[{"title":"...","reason":"...","category":"gap","potential_views":"30K-150K","suggested_types":["video_script","carousel"]}]`
    : `Du bist ein Social-Media-Experte für Fitness-Coaches (Männer 30+).

Thomas hat noch keine Competitor-Daten. Generiere 8 zeitlose Themenvorschläge für einen Fitness Coach der Männer 30+ anspricht. Fokus auf Kraft, Körperfett, Ernährung, Mindset, Lifestyle.

Antworte NUR mit einem validen JSON-Array:
[{"title":"...","reason":"...","category":"evergreen","potential_views":"20K-100K","suggested_types":["video_script","carousel"]}]`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 2000, messages: [{ role: 'user', content: prompt }] })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: CORS })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text || '[]'

  let topics: any[] = []
  try {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (match) topics = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'JSON parse error', raw: rawText }), { status: 500, headers: CORS })
  }

  if (!Array.isArray(topics) || topics.length === 0) {
    return new Response(JSON.stringify({ error: 'Keine Vorschläge generiert', raw: rawText }), { status: 500, headers: CORS })
  }

  // Alte ungenutzte löschen
  await fetch(`${SUPABASE_URL}/rest/v1/topic_suggestions?used=eq.false`, {
    method: 'DELETE', headers: dbHeaders()
  })

  // Neue einfügen
  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/topic_suggestions`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify(topics.map((t: any) => ({
      title: t.title, reason: t.reason, category: t.category || 'trending',
      potential_views: t.potential_views, suggested_types: t.suggested_types || [], used: false
    })))
  })
  const saved = await saveRes.json()

  return new Response(JSON.stringify({ topics: Array.isArray(saved) ? saved : topics }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
