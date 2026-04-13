// fetch-reddit — Holt aktuelle Fitness-Diskussionen von Reddit
// Subreddits: r/fitness, r/malefitnessadvice, r/bodybuilding, r/loseit, r/intermittentfasting
// Extrakt: Pain Points, Fragen, Trending Topics → external_signals Tabelle
// Claude bewertet Relevanz für Thomas' Nische (Männer 30+, DACH, Online Coaching)

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

// Reddit JSON API — kein Auth-Token nötig für öffentliche Subreddits
async function fetchSubreddit(sub: string, sort: 'hot' | 'top' = 'hot', limit = 25): Promise<any[]> {
  const url = `https://www.reddit.com/r/${sub}/${sort}.json?limit=${limit}&t=week`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ContentResearchBot/1.0 (research purposes)' }
  })
  if (!res.ok) return []
  const data = await res.json()
  return data?.data?.children?.map((c: any) => c.data) || []
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  // Alte Signale löschen (>14 Tage)
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()
  await fetch(`${SUPABASE_URL}/rest/v1/external_signals?fetched_at=lt.${cutoff}`, {
    method: 'DELETE',
    headers: dbHeaders()
  })

  // Subreddits parallel abrufen
  const subreddits = [
    { sub: 'fitness', label: 'r/fitness' },
    { sub: 'malefitnessadvice', label: 'r/malefitnessadvice' },
    { sub: 'bodybuilding', label: 'r/bodybuilding' },
    { sub: 'loseit', label: 'r/loseit' },
    { sub: 'intermittentfasting', label: 'r/intermittentfasting' },
    { sub: 'gainit', label: 'r/gainit' },
  ]

  const allPosts = await Promise.all(subreddits.map(async ({ sub, label }) => {
    const posts = await fetchSubreddit(sub, 'hot', 20)
    return posts.map((p: any) => ({
      subreddit: label,
      title: (p.title || '').substring(0, 300),
      body: (p.selftext || '').substring(0, 400),
      score: p.score || 0,
      num_comments: p.num_comments || 0,
      url: p.permalink ? `https://reddit.com${p.permalink}` : '',
      flair: p.link_flair_text || '',
    }))
  }))

  const posts = allPosts.flat()
    .filter(p => p.score > 50) // Nur Posts mit Upvotes
    .sort((a, b) => (b.score + b.num_comments * 5) - (a.score + a.num_comments * 5))
    .slice(0, 40)

  if (posts.length === 0) {
    return new Response(JSON.stringify({ ok: true, saved: 0, message: 'Keine Reddit Posts gefunden' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Claude bewertet: Welche Posts sind relevant für Thomas? Was ist der Inhalt-Typ?
  const postsForAnalysis = posts.map((p, i) => `[${i}] r/${p.subreddit} | Score: ${p.score} | Kommentare: ${p.num_comments}\nTITEL: "${p.title}"\n${p.body ? `BODY: "${p.body.substring(0, 200)}"` : ''}`).join('\n\n')

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Du analysierst Reddit-Posts für einen deutschen Fitness-Coach (Thomas Pfeffer). Seine Zielgruppe: Männer 30-55, beruflich erfolgreich, wollen effizient Muskeln aufbauen und Fett verlieren, Online Coaching, DACH-Markt.

Analysiere diese ${posts.length} Posts und gib NUR ein JSON-Array zurück. Bewerte jeden Post:

${postsForAnalysis}

Gib NUR dieses JSON-Array zurück — keine anderen Texte:
[
  {
    "index": 0,
    "relevance_score": 85,
    "signal_type": "pain_point",
    "german_insight": "Kurze deutsche Zusammenfassung was das Publikum bewegt (1-2 Sätze)",
    "content_angle": "Wie kann Thomas das als Content nutzen? (1 Satz)"
  }
]

signal_type: "pain_point" | "question" | "trending_topic" | "success_story" | "controversy"
relevance_score: 0-100 (>70 = relevant für Thomas)
Nur Posts mit relevance_score >= 60 einschließen.`
      }]
    })
  })

  let analysis: any[] = []
  if (claudeRes.ok) {
    const claudeData = await claudeRes.json()
    const raw = claudeData.content?.[0]?.text || ''
    try {
      const match = raw.match(/\[[\s\S]*\]/)
      if (match) analysis = JSON.parse(match[0])
    } catch { /* ignorieren */ }
  }

  // Relevante Posts in DB speichern
  const toSave = analysis
    .filter((a: any) => a.relevance_score >= 60 && posts[a.index])
    .map((a: any) => {
      const p = posts[a.index]
      return {
        source: 'reddit',
        title: p.title,
        body: a.german_insight || p.body?.substring(0, 200) || '',
        url: p.url,
        score: p.score,
        signal_type: a.signal_type || 'trending_topic',
        relevance_score: a.relevance_score,
        claude_insight: a.content_angle || '',
        keywords: [],
        fetched_at: new Date().toISOString(),
      }
    })

  let saved = 0
  if (toSave.length > 0) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/external_signals`, {
      method: 'POST',
      headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify(toSave)
    })
    if (res.ok) saved = toSave.length
  }

  return new Response(JSON.stringify({
    ok: true,
    fetched: posts.length,
    analyzed: analysis.length,
    saved,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
