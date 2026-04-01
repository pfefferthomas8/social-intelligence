// trend-process — verarbeitet Apify Dataset unabhängig vom Webhook-Timing
// Wird vom Dashboard aufgerufen (nicht von Apify direkt)
// Kann auch manuell ausgelöst werden

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
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

function parseTimestamp(ts: unknown): string | null {
  if (!ts) return null
  try {
    const n = Number(ts)
    if (isNaN(n)) return new Date(String(ts)).toISOString()
    const d = new Date(n > 1e12 ? n : n * 1000)
    return isNaN(d.getTime()) ? null : d.toISOString()
  } catch { return null }
}

function clean(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 500)
}

function detectPostType(post: Record<string, unknown>): string {
  if (post.productType === 'clips' || post.type === 'Reel') return 'reel'
  if (post.isVideo && (Number(post.videoViewCount) > 0 || Number(post.videoPlayCount) > 0)) return 'reel'
  if (post.type === 'Video' || post.isVideo) return 'video'
  if (Array.isArray(post.childPosts) && (post.childPosts as any[]).length > 0) return 'carousel'
  if (post.type === 'Sidecar') return 'carousel'
  return 'image'
}

function calcViralScore(post: Record<string, unknown>): number {
  const views = Number(post.videoViewCount) || Number(post.videoPlayCount) || 0
  const likes = Number(post.likesCount) || 0
  const comments = Number(post.commentsCount) || 0
  const followers = Number(post.ownerFollowersCount) || 0

  const viewsPts = (views / 10000) * 10
  const likesPts = (likes / 1000) * 15
  const commentsPts = (comments / 100) * 25
  let base = viewsPts + likesPts + commentsPts

  if (followers > 0 && followers < 100000) {
    const reach = views / followers
    if (reach > 10) base *= 1.8
    else if (reach > 5) base *= 1.4
    else if (reach > 2) base *= 1.15
  }

  const published = parseTimestamp(post.timestamp || post.takenAt)
  let freshness = 1.0
  if (published) {
    const daysOld = (Date.now() - new Date(published).getTime()) / 86400000
    freshness = daysOld <= 2 ? 1.8 : daysOld <= 5 ? 1.5 : daysOld <= 10 ? 1.2 : daysOld <= 14 ? 1.05 : 1.0
  }

  return Math.round(base * freshness)
}

async function extractVisualText(thumbnailUrl: string): Promise<string | null> {
  try {
    const imgRes = await fetch(thumbnailUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
      signal: AbortSignal.timeout(8000)
    })
    if (!imgRes.ok) return null
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
    const mediaType = contentType.split(';')[0].trim()
    const buffer = await imgRes.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    const b64 = btoa(binary)

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Extrahiere ALLE sichtbaren Texte aus diesem Instagram-Frame. Ignoriere Instagram-UI. Kein Text → antworte nur: KEIN TEXT. Nur extrahierten Text, keine Erklärungen.' }
          ]
        }]
      })
    })
    if (!claudeRes.ok) return null
    const data = await claudeRes.json()
    const raw = data.content?.[0]?.text?.trim() || ''
    return raw && raw !== 'KEIN TEXT' ? raw.substring(0, 500) : null
  } catch { return null }
}

async function analyzeWithClaude(posts: any[]): Promise<Record<string, any>> {
  if (posts.length === 0) return {}

  const postList = posts.map((p: any, i: number) => {
    const caption = clean(p.caption || '')
    const visualText = p.visual_text ? `\nText im Video: ${p.visual_text.substring(0, 150)}` : ''
    return `[${i}] @${p.username} | ${p.post_type} | ${p.views_count?.toLocaleString() || 0} Views | Score ${p.viral_score}
Caption: ${caption || '(kein Text)'}${visualText}`
  }).join('\n\n')

  const prompt = `Du analysierst viral gehende Instagram-Posts für Thomas Pfeffer (österreichischer Fitness-Coach, Männer 30+, Kraft + Körperfett).

POSTS:
${postList}

Für jeden Post JSON-Array:
[{
  "index": 0,
  "hook_strength": 8,
  "dach_gap": true,
  "thomas_fit": true,
  "recommendation": "sofort",
  "content_pillar": "mehrwert",
  "claude_notes": "Warum viral + wie Thomas das auf Deutsch umsetzen kann (2-3 Sätze)"
}]

- hook_strength: 1-10
- dach_gap: true wenn Thema im DACH-Raum noch kaum vorhanden
- thomas_fit: true wenn zu Männern 30+, Kraft, Körperfett oder Mindset passt
- recommendation: sofort | beobachten | skip
- content_pillar: haltung | transformation | mehrwert | verkauf

NUR JSON-Array.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] })
  })

  if (!res.ok) return {}
  const data = await res.json()
  const rawText = data.content?.[0]?.text || '[]'
  try {
    const match = rawText.match(/\[[\s\S]*\]/)
    if (!match) return {}
    const results: any[] = JSON.parse(match[0])
    return Object.fromEntries(results.map((r: any) => [r.index, r]))
  } catch { return {} }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response('Unauthorized', { status: 401, headers: CORS })
  }

  const body = await req.json().catch(() => ({}))
  const { job_id, run_id } = body

  // Wenn run_id gegeben → direkt verarbeiten
  // Sonst: letzten offenen Job suchen
  let targetJob: any = null
  let targetRunId = run_id

  if (job_id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}&limit=1`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    })
    const jobs = await res.json()
    targetJob = jobs?.[0]
    targetRunId = run_id || targetJob?.apify_run_id
  } else {
    // Letzten trend_discovery Job laden (egal ob done oder running)
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/scrape_jobs?job_type=eq.trend_discovery&select=*&order=started_at.desc&limit=1`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    )
    const jobs = await res.json()
    targetJob = jobs?.[0]
    targetRunId = run_id || targetJob?.apify_run_id
  }

  if (!targetRunId) {
    return new Response(JSON.stringify({ error: 'Kein run_id gefunden' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Dataset von Apify laden — kein Retry nötig, wird nur manuell nach >3 Min aufgerufen
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${targetRunId}/dataset/items?token=${APIFY_KEY}&limit=1000`
  )

  if (!datasetRes.ok) {
    return new Response(JSON.stringify({ error: `Apify Dataset Error: ${datasetRes.status}` }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  let allItems: Record<string, unknown>[]
  try {
    allItems = await datasetRes.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Dataset Parse Error' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Nur echte Post-Items (haben shortCode oder id)
  const items = allItems.filter((it: any) => it.shortCode || it.id)

  if (items.length === 0) {
    return new Response(JSON.stringify({
      ok: false,
      message: 'Dataset noch nicht bereit — bitte in 1-2 Minuten nochmal versuchen',
      raw_count: allItems.length
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Competitors ausschließen
  const compRes = await fetch(
    `${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const competitors: any[] = await compRes.json()
  const knownHandles = new Set((competitors || []).map((c: any) => c.username.toLowerCase()))

  // Scoring & Filterung
  const scored = items
    .filter((post: any) => {
      const username = (post.ownerUsername || '').toLowerCase()
      const views = Number(post.videoViewCount) || Number(post.videoPlayCount) || 0
      const likes = Number(post.likesCount) || 0
      const published = parseTimestamp(post.timestamp || post.takenAt)
      const daysOld = published ? (Date.now() - new Date(published).getTime()) / 86400000 : 99

      return (
        !knownHandles.has(username) &&
        username.length > 0 &&
        (views >= 5000 || likes >= 300) &&
        daysOld <= 21 &&
        (post.isVideo || post.type === 'Sidecar')
      )
    })
    .map((post: any) => ({
      ...post,
      _viralScore: calcViralScore(post),
      _postType: detectPostType(post),
      _published: parseTimestamp(post.timestamp || post.takenAt),
    }))
    .filter((p: any) => p._viralScore >= 20)
    .sort((a: any, b: any) => b._viralScore - a._viralScore)

  const seen = new Set<string>()
  const unique = scored.filter((p: any) => {
    const id = String(p.shortCode || p.id || '')
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  })

  const topCandidates = unique.slice(0, 40)

  if (topCandidates.length === 0) {
    if (targetJob?.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${targetJob.id}`, {
        method: 'PATCH', headers: dbHeaders(),
        body: JSON.stringify({ status: 'done', result_count: 0, completed_at: new Date().toISOString(), error_msg: `${items.length} Posts gescrapt, keiner mit ausreichend Engagement` })
      })
    }
    return new Response(JSON.stringify({ ok: true, saved: 0, total: items.length, filtered: 0 }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Visual Text Extraktion
  const visualTexts = await Promise.all(
    topCandidates.map(async (p: any) => {
      const thumbUrl = p.displayUrl || p.thumbnailUrl
      if (!thumbUrl) return null
      return extractVisualText(thumbUrl)
    })
  )

  const forAnalysis = topCandidates.map((p: any, i: number) => ({
    username: p.ownerUsername || '',
    post_type: p._postType,
    views_count: Number(p.videoViewCount) || Number(p.videoPlayCount) || 0,
    likes_count: Number(p.likesCount) || 0,
    comments_count: Number(p.commentsCount) || 0,
    viral_score: p._viralScore,
    caption: (p.caption || '').substring(0, 300),
    visual_text: visualTexts[i] || null,
  }))

  const analysisMap = await analyzeWithClaude(forAnalysis)

  // In DB speichern
  let savedCount = 0
  const toInsert = topCandidates.map((post: any, i: number) => {
    const analysis = analysisMap[i] || {}
    const postId = String(post.shortCode || post.id || '')
    if (!postId) return null

    return {
      instagram_post_id: postId,
      username: post.ownerUsername || 'unknown',
      follower_count: Number(post.ownerFollowersCount) || 0,
      post_type: post._postType,
      caption: post.caption || null,
      thumbnail_url: post.displayUrl || post.thumbnailUrl || null,
      video_url: post.videoUrl || post.videoPlaybackUrl || null,
      url: post.url || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null),
      views_count: Number(post.videoViewCount) || Number(post.videoPlayCount) || 0,
      likes_count: Number(post.likesCount) || 0,
      comments_count: Number(post.commentsCount) || 0,
      viral_score: post._viralScore,
      published_at: post._published,
      discovered_at: new Date().toISOString(),
      visual_text: visualTexts[i] || null,
      visual_text_status: 'done',
      hook_strength: analysis.hook_strength || null,
      dach_gap: analysis.dach_gap ?? null,
      thomas_fit: analysis.thomas_fit ?? null,
      recommendation: analysis.recommendation || 'beobachten',
      claude_notes: analysis.claude_notes || null,
      content_pillar: analysis.content_pillar || null,
      analysis_status: 'done',
    }
  }).filter(Boolean)

  if (toInsert.length > 0) {
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/trend_posts`, {
      method: 'POST',
      headers: { ...dbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal', 'On-Conflict': 'instagram_post_id' },
      body: JSON.stringify(toInsert)
    })
    if (insertRes.ok) savedCount = toInsert.length

    // Alte Posts aufräumen (>30 Tage)
    const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
    await fetch(`${SUPABASE_URL}/rest/v1/trend_posts?discovered_at=lt.${cutoff}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Prefer': 'return=minimal' }
    })
  }

  if (targetJob?.id) {
    await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${targetJob.id}`, {
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({
        status: 'done',
        result_count: savedCount,
        completed_at: new Date().toISOString(),
        error_msg: `${items.length} Posts gescrapt → ${unique.length} unique → ${savedCount} gespeichert`
      })
    })
  }

  return new Response(JSON.stringify({
    ok: true,
    saved: savedCount,
    total: items.length,
    filtered: topCandidates.length,
    run_id: targetRunId
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
