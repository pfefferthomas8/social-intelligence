// Apify Test + Account-Analyse Tool
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

Deno.serve(async (req: Request) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const mode = body.mode || 'fetch'

  if (mode === 'fetch') {
    const runId = body.run_id || 'yMdjOQ978TKfKMVzz'
    const limit = body.limit || 5
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=${limit}`
    )
    const text = await res.text()
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}
    return new Response(JSON.stringify({
      status: res.status,
      raw_length: text.length,
      raw_preview: text.substring(0, 2000),
      parsed_count: Array.isArray(parsed) ? parsed.length : null,
      first_item: Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null,
    }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  if (mode === 'run') {
    const actor = body.actor || 'easyapi~instagram-hashtag-scraper'
    const input = body.input || { hashtags: ['krafttraining'], maxResults: 5 }
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    )
    const data = await res.json()
    return new Response(JSON.stringify({ ok: res.ok, run_id: data?.data?.id, data }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  // mode === 'find_accounts' — Claude analysiert Profil + Competitors und empfiehlt passende IG Accounts
  if (mode === 'find_accounts') {
    // 1. Eigenes Profil laden
    const ownRes = await fetch(`${SUPABASE_URL}/rest/v1/own_profile?select=*&limit=1`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    })
    const ownProfile = await ownRes.json()
    const own = ownProfile[0]

    // 2. Competitors laden
    const compRes = await fetch(`${SUPABASE_URL}/rest/v1/competitor_profiles?is_active=eq.true&select=*`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    })
    const competitors = await compRes.json()

    // 3. Top Posts eigene laden
    const ownPostsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_posts?source=eq.own&select=post_type,caption,likes_count,views_count,content_pillar&order=views_count.desc&limit=8`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    )
    const ownPosts = await ownPostsRes.json()

    // 4. Top Competitor Posts laden
    const compPostsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/instagram_posts?source=eq.competitor&select=post_type,caption,likes_count,views_count,content_pillar&order=likes_count.desc&limit=10`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    )
    const compPosts = await compPostsRes.json()

    // 5. Claude-Prompt bauen
    const ownBio = `@${own?.username} — "${own?.bio?.replace(/\n/g, ' ')}" | ${own?.followers_count} Followers | ${own?.posts_count} Posts`

    const competitorSummary = competitors.map((c: any) =>
      `@${c.username} — "${(c.bio || '').replace(/\n/g, ' ')}" | ${c.followers_count} Followers`
    ).join('\n')

    const ownPostSummary = ownPosts.slice(0, 5).map((p: any) =>
      `[${p.post_type}] ${p.views_count}v ${p.likes_count}l [${p.content_pillar}]: ${(p.caption || '').substring(0, 100).replace(/\n/g, ' ')}`
    ).join('\n')

    const compPostSummary = compPosts.slice(0, 8).map((p: any) =>
      `[${p.post_type}] ${p.views_count}v ${p.likes_count}l [${p.content_pillar}]: ${(p.caption || '').substring(0, 100).replace(/\n/g, ' ')}`
    ).join('\n')

    const prompt = `Du bist ein Social-Media-Stratege. Analysiere diese Profile und empfiehl EXAKTE Instagram-Accounts für Trend-Scouting.

EIGENES PROFIL:
${ownBio}

TOP EIGENE POSTS (Reels performen am besten):
${ownPostSummary}

COMPETITORS:
${competitorSummary}

TOP COMPETITOR POSTS (viral, 10K-65K Likes):
${compPostSummary}

AUFGABE: Finde Instagram-Accounts die INHALTLICH zu diesem Profil passen.

Muster erkennen:
- Thomas: Österreichischer Online Fitness Coach, Männer 30+, "kein Verzicht, effektive Struktur", 1:1 Coaching, Deutsch
- Competitor @ryanfisch: "I build disciplined humans", 700K Followers, Reels über Disziplin/Struktur
- Competitor @jossmooney: "Helping driven men stay lethal over 30", 1.3M Followers
- Competitor Dan Go (coachdango): Busy Professionals, praktische Health-Tipps

GESUCHT: 30-40 Instagram-Accounts die ALLE drei Kriterien erfüllen:
1. Ähnliche Zielgruppe: Männer 30+, Alltag, Fitness, Körpertransformation
2. Ähnlicher Content-Stil: Numbered Lists, Mindset-Posts, Transformation Reels, Education
3. Ähnliches Business-Modell: Online Coaching, Direct-to-Consumer

INCLUDE:
- Englischsprachige Coaches mit 100K-5M Followers (zum Trends entdecken bevor sie in DE ankommen)
- DACH-Coaches die EXAKT in der Nische Männer 30+ / Körpertransformation / Online Coaching sind
- Coaches mit ähnlichem "no-excuse" / "structure" / "results" Messaging

EXCLUDE:
- Profisportler, Bodybuilder-Wettkämpfer, MMA Fighter
- Wissenschaftler/Doktoren ohne Coaching-Business
- Lifestyle/Travel Accounts
- Frauen-Fitness Accounts
- Extreme Athletes (military, ultramarathon etc.)

Antworte NUR mit JSON:
{
  "accounts": [
    {"username": "exakter_ig_handle", "reason": "1 Satz warum relevant"},
    ...
  ]
}`

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      })
    })

    if (!claudeRes.ok) {
      const err = await claudeRes.text()
      return new Response(JSON.stringify({ error: err }), { status: 502 })
    }

    const claudeData = await claudeRes.json()
    const rawText = claudeData.content?.[0]?.text || '{}'

    return new Response(JSON.stringify({
      raw: rawText,
      own_profile: own?.username,
      competitors: competitors.map((c: any) => c.username)
    }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ error: 'unknown mode' }), { status: 400 })
})
