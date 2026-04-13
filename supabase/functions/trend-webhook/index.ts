// Trend Webhook — verarbeitet Apify Ergebnisse vom Trend Discovery Run
// 1. Berechnet Viral Score für jeden Post
// 2. Filtert Top-Kandidaten
// 3. Claude analysiert: Hook, DACH-Lücke, Thomas-Fit, Empfehlung
// 4. Speichert in trend_posts

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

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

// ─── Viral Score Formel ────────────────────────────────────────────────────────
// Normalisiert: funktioniert ohne Follower-Zahl (nicht immer verfügbar bei Hashtag-Posts)
// Berücksichtigt Views, Likes, Comments + Frische des Posts
function calcViralScore(post: Record<string, unknown>): number {
  const views = Number(post.videoViewCount) || Number(post.videoPlayCount) || 0
  const likes = Number(post.likesCount) || 0
  const comments = Number(post.commentsCount) || 0
  const followers = Number(post.ownerFollowersCount) || 0

  // Absolute Engagement-Punkte
  const viewsPts = (views / 10000) * 10      // 100K Views = 100 Pts
  const likesPts = (likes / 1000) * 15       // 10K Likes = 150 Pts
  const commentsPts = (comments / 100) * 25  // 1K Comments = 250 Pts
  let base = viewsPts + likesPts + commentsPts

  // Follower-Normalisierungs-Bonus: kleiner Account + große Reichweite = starkes Signal
  // Gilt als "Entdeckung bevor mainstream" — Multiplikator
  if (followers > 0 && followers < 100000) {
    const reach = (views / followers)  // z.B. 5x = 5fache Reichweite vs Follower
    if (reach > 10) base *= 1.8        // 10× Reichweite: signifikanter Bonus
    else if (reach > 5) base *= 1.4   // 5× Reichweite: moderater Bonus
    else if (reach > 2) base *= 1.15  // 2× Reichweite: leichter Bonus
  }

  // Frische-Multiplikator (neuere Posts ranken höher — Trend-Signal)
  const published = parseTimestamp(post.timestamp || post.takenAt)
  let freshness = 1.0
  if (published) {
    const daysOld = (Date.now() - new Date(published).getTime()) / 86400000
    freshness = daysOld <= 2 ? 1.8 : daysOld <= 5 ? 1.5 : daysOld <= 10 ? 1.2 : daysOld <= 14 ? 1.05 : 1.0
  }

  return Math.round(base * freshness)
}

// ─── Visual Text Extraktion aus Thumbnail ────────────────────────────────────
async function extractVisualText(thumbnailUrl: string, anthropicKey: string): Promise<string | null> {
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
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: b64 } },
            { type: 'text', text: 'Extrahiere ALLE sichtbaren Texte aus diesem Instagram-Frame (Untertitel, Text-Overlays, B-Roll Texte, eingeblendete Sätze). Ignoriere Instagram-UI. Kein Text → antworte nur: KEIN TEXT. Nur extrahierten Text, keine Erklärungen.' }
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

// ─── Claude Batch-Analyse ──────────────────────────────────────────────────────
async function analyzeWithClaude(posts: any[]): Promise<Record<string, any>> {
  if (posts.length === 0) return {}

  const postList = posts.map((p: any, i: number) => {
    const caption = clean(p.caption || '')
    const visualText = p.visual_text ? `\nText im Video: ${p.visual_text.substring(0, 150)}` : ''
    return `[${i}] @${p.username} | ${p.post_type} | ${p.views_count?.toLocaleString() || 0} Views | Score ${p.viral_score}
Caption: ${caption || '(kein Text)'}${visualText}`
  }).join('\n\n')

  const prompt = `Du analysierst viral gehende Instagram-Posts aus der englischsprachigen Fitness-Szene für Thomas Pfeffer (österreichischer Fitness-Coach, Männer 30+, Kraft + Körperfett).

DEINE AUFGABE: Erkenne für jeden Post ob und wie Thomas davon profitieren kann.

POSTS:
${postList}

Antworte für jeden Post mit Index. JSON-Array:
[{
  "index": 0,
  "hook_strength": 8,
  "dach_gap": true,
  "thomas_fit": true,
  "recommendation": "sofort",
  "content_pillar": "mehrwert",
  "claude_notes": "Warum viral + wie Thomas das auf Deutsch umsetzen kann (2-3 Sätze)"
}]

Felder:
- hook_strength: 1-10 (Wie stark zieht der erste Satz/Frame?)
- dach_gap: true wenn es das Thema im DACH-Raum noch nicht oder kaum gibt
- thomas_fit: true wenn Thema zu Männern 30+, Kraft, Körperfett oder Mindset passt
- recommendation: "sofort" (umsetzen diese Woche) | "beobachten" (Trend im Auge behalten) | "skip" (nicht relevant)
- content_pillar: haltung | transformation | mehrwert | verkauf
- claude_notes: Konkrete Handlungsempfehlung für Thomas

Antworte NUR mit dem JSON-Array.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }]
    })
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
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (token !== DASHBOARD_TOKEN) {
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = await req.json()
    const { job_id, run_id, status } = payload
    if (!job_id) return new Response('no job_id', { status: 400 })

    // Fehler-Events
    if (status === 'ACTOR.RUN.FAILED' || status === 'ACTOR.RUN.TIMED_OUT') {
      await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}`, {
        method: 'PATCH', headers: dbHeaders(),
        body: JSON.stringify({ status: 'error', error_msg: status, completed_at: new Date().toISOString() })
      })
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Job laden (enthält excluded_handles in error_msg)
    const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}&limit=1`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    })
    const jobs: any[] = await jobRes.json()
    const job = jobs?.[0]
    if (!job) return new Response('job not found', { status: 404 })

    // Competitor-Handles laden (ausschließen)
    const compRes = await fetch(
      `${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`,
      { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
    )
    const competitors: any[] = await compRes.json()
    const knownHandles = new Set((competitors || []).map((c: any) => c.username.toLowerCase()))

    // Dataset von Apify holen — mit Retry
    async function fetchDataset(): Promise<Record<string, unknown>[] | null> {
      const res = await fetch(
        `https://api.apify.com/v2/actor-runs/${run_id}/dataset/items?token=${APIFY_KEY}&limit=1000`
      )
      try {
        const parsed = await res.json()
        return Array.isArray(parsed) ? parsed : null
      } catch { return null }
    }

    // Initialer Delay: Trend-Scrapes haben bis zu 180 Posts → Dataset-Flush dauert länger
    // Race Condition: Apify feuert Webhook wenn Run SUCCEEDED, Dataset aber noch nicht vollständig geschrieben
    await new Promise(r => setTimeout(r, 15000))

    let items: Record<string, unknown>[] | null = null
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 10000))
      items = await fetchDataset()
      // Echtdaten haben shortCode oder id — error-only Arrays ignorieren
      const realItems = (items || []).filter((it: any) => it.shortCode || it.id)
      if (realItems.length > 0) { items = realItems; break }
    }

    if (!items || items.length === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}`, {
        method: 'PATCH', headers: dbHeaders(),
        body: JSON.stringify({ status: 'done', result_count: 0, error_msg: 'empty dataset', completed_at: new Date().toISOString() })
      })
      return new Response(JSON.stringify({ ok: true, saved: 0 }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ── SCORING & FILTERUNG ────────────────────────────────────────────────────
    const scored = items
      .filter((post: any) => {
        const username = (post.ownerUsername || '').toLowerCase()
        const views = Number(post.videoViewCount) || Number(post.videoPlayCount) || 0
        const likes = Number(post.likesCount) || 0
        const published = parseTimestamp(post.timestamp || post.takenAt)
        const daysOld = published ? (Date.now() - new Date(published).getTime()) / 86400000 : 99

        return (
          !knownHandles.has(username) &&        // Keine bekannten Competitors
          username.length > 0 &&                 // Muss einen Autor haben
          (views >= 5000 || likes >= 300) &&     // Mindest-Engagement
          daysOld <= 21 &&                       // Max 21 Tage alt
          (post.isVideo || post.type === 'Sidecar') // Nur Reels + Carousels
        )
      })
      .map((post: any) => ({
        ...post,
        _viralScore: calcViralScore(post),
        _postType: detectPostType(post),
        _published: parseTimestamp(post.timestamp || post.takenAt),
      }))
      .filter((p: any) => p._viralScore >= 20)  // Mindest-Score
      .sort((a: any, b: any) => b._viralScore - a._viralScore)

    // Duplikate entfernen (gleicher Post kann aus mehreren Hashtags kommen)
    const seen = new Set<string>()
    const unique = scored.filter((p: any) => {
      const id = String(p.shortCode || p.id || '')
      if (!id || seen.has(id)) return false
      seen.add(id)
      return true
    })

    // Top 15 für Analyse — 40 war zu teuer (Haiku Vision × 40 pro Run)
    const topCandidates = unique.slice(0, 15)

    if (topCandidates.length === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}`, {
        method: 'PATCH', headers: dbHeaders(),
        body: JSON.stringify({ status: 'done', result_count: 0, completed_at: new Date().toISOString() })
      })
      return new Response(JSON.stringify({ ok: true, saved: 0, total: items.length }), { headers: { 'Content-Type': 'application/json' } })
    }

    // ── VISUAL TEXT EXTRAKTION (parallel, vor Claude-Analyse) ────────────────
    // Liest Text-Overlays aus Thumbnails → gibt Claude mehr Kontext (B-Roll Hooks etc.)
    const visualTexts = await Promise.all(
      topCandidates.map(async (p: any) => {
        const thumbUrl = p.displayUrl || p.thumbnailUrl
        if (!thumbUrl) return null
        return extractVisualText(thumbUrl, ANTHROPIC_KEY)
      })
    )

    // Für Claude-Analyse aufbereiten — inkl. visual_text
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

    // ── CLAUDE ANALYSE ────────────────────────────────────────────────────────
    const analysisMap = await analyzeWithClaude(forAnalysis)

    // ── IN DB SPEICHERN ───────────────────────────────────────────────────────
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
        caption: (post.caption || null),
        thumbnail_url: (post.displayUrl || post.thumbnailUrl || null),
        video_url: (post.videoUrl || post.videoPlaybackUrl || null),
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
      // Alte Trend-Posts aufräumen VOR dem Insert (älter als 7 Tage → löschen → frische Posts)
      const cutoff = new Date(Date.now() - 7 * 86400000).toISOString()
      await fetch(`${SUPABASE_URL}/rest/v1/trend_posts?discovered_at=lt.${cutoff}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY, 'Prefer': 'return=minimal' }
      })

      // Upsert — gleicher Post kann nicht doppelt landen
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/trend_posts`, {
        method: 'POST',
        headers: {
          ...dbHeaders(),
          'Prefer': 'resolution=merge-duplicates,return=minimal',
          'On-Conflict': 'instagram_post_id'
        },
        body: JSON.stringify(toInsert)
      })
      if (insertRes.ok) savedCount = toInsert.length
    }

    await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job_id}`, {
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({
        status: 'done',
        result_count: savedCount,
        completed_at: new Date().toISOString(),
        error_msg: `${items.length} Kandidaten gescrapt → ${unique.length} unique → ${savedCount} gespeichert`
      })
    })

    return new Response(JSON.stringify({
      ok: true, saved: savedCount, total: items.length,
      unique: unique.length, analyzed: topCandidates.length
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('trend-webhook error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }
})
