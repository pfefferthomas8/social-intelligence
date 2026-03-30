import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== Deno.env.get('DASHBOARD_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // 1. Trending Competitor Posts der letzten 21 Tage (nach Views)
  const since21d = new Date(Date.now() - 21 * 86400000).toISOString()
  const { data: trendingPosts } = await supabase
    .from('instagram_posts')
    .select('caption, transcript, post_type, views_count, likes_count, published_at, competitor_profiles(username)')
    .eq('source', 'competitor')
    .gte('scraped_at', since21d)
    .order('views_count', { ascending: false })
    .limit(30)

  // 2. Eigene Posts — welche Themen hat Thomas schon covered
  const { data: ownPosts } = await supabase
    .from('instagram_posts')
    .select('caption, transcript, post_type, views_count')
    .eq('source', 'own')
    .order('scraped_at', { ascending: false })
    .limit(50)

  // 3. Bereits verwendete Themenvorschläge (nicht doppelt vorschlagen)
  const { data: usedTopics } = await supabase
    .from('topic_suggestions')
    .select('title')
    .order('created_at', { ascending: false })
    .limit(20)

  // Context aufbauen
  const trendingContext = (trendingPosts || [])
    .map(p => {
      const username = (p as any).competitor_profiles?.username || 'unknown'
      const text = [p.caption, p.transcript].filter(Boolean).join(' ').substring(0, 200)
      return `@${username} | ${p.post_type} | ${p.views_count || 0} Views: ${text}`
    })
    .join('\n')
    .substring(0, 5000)

  const ownContext = (ownPosts || [])
    .map(p => [p.caption, p.transcript].filter(Boolean).join(' ').substring(0, 150))
    .filter(Boolean)
    .join('\n')
    .substring(0, 2000)

  const usedTitles = (usedTopics || []).map(t => t.title).join(', ')

  const hasData = trendingPosts && trendingPosts.length > 0

  const prompt = hasData
    ? `Du analysierst Instagram-Daten für Thomas, einen Fitness Coach (Männer 30+).

TRENDING BEI COMPETITOR COACHES (letzte 21 Tage, nach Views sortiert):
${trendingContext}

THOMAS' EIGENE POSTS (was er schon gemacht hat):
${ownContext || 'Noch keine eigenen Posts.'}

BEREITS VORGESCHLAGENE THEMEN (nicht wiederholen):
${usedTitles || 'Keine.'}

Analysiere die Daten und generiere 8 Themenvorschläge für Thomas.

Für jeden Vorschlag:
- title: Konkretes Thema als Aussage oder Frage (max 12 Wörter, deutsch)
- reason: Warum das gerade funktioniert (1-2 Sätze, basierend auf den Daten)
- category: "trending" (explodiert gerade bei Competitors), "gap" (Competitors machen's, Thomas noch nicht), "evergreen" (immer relevant), oder "personal" (passt zu Thomas' Stil)
- potential_views: Schätzung basierend auf ähnlichen Posts (z.B. "50K-200K")
- suggested_types: Welche Formate passen — Array aus: "video_script", "carousel", "single_post", "b_roll"

Antworte NUR mit einem validen JSON-Array:
[{"title":"...","reason":"...","category":"trending","potential_views":"50K-200K","suggested_types":["video_script","carousel"]}]`
    : `Du bist ein Social-Media-Experte für Fitness-Coaches (Männer 30+).

Thomas hat noch keine Competitor-Daten in seiner Datenbank. Generiere 8 zeitlose, bewährte Themenvorschläge für einen Fitness Coach der Männer 30+ anspricht. Fokus auf Kraft, Körperfett, Ernährung, Mindset, Lifestyle.

Antworte NUR mit einem validen JSON-Array:
[{"title":"...","reason":"...","category":"evergreen","potential_views":"20K-100K","suggested_types":["video_script","carousel"]}]`

  // Claude API
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',  // Haiku reicht für strukturierte Analyse
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: CORS })
  }

  const claudeData = await claudeRes.json()
  const rawText = claudeData.content?.[0]?.text || '[]'

  // JSON aus Antwort extrahieren
  let topics = []
  try {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (match) topics = JSON.parse(match[0])
  } catch (e) {
    return new Response(JSON.stringify({ error: 'JSON parse error', raw: rawText }), { status: 500, headers: CORS })
  }

  if (!Array.isArray(topics) || topics.length === 0) {
    return new Response(JSON.stringify({ error: 'Keine Vorschläge generiert', raw: rawText }), { status: 500, headers: CORS })
  }

  // Alte ungenutzte Vorschläge löschen + neue einfügen
  await supabase.from('topic_suggestions').delete().eq('used', false)
  const { data: saved } = await supabase
    .from('topic_suggestions')
    .insert(topics.map(t => ({
      title: t.title,
      reason: t.reason,
      category: t.category || 'trending',
      potential_views: t.potential_views,
      suggested_types: t.suggested_types || [],
      used: false
    })))
    .select('*')

  return new Response(JSON.stringify({ topics: saved || topics }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
