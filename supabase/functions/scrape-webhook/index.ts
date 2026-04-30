// Supabase REST API direkt via fetch — kein Import nötig

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') || ''
const IG_COOKIES_RAW = Deno.env.get('INSTAGRAM_SESSION_COOKIES') || ''
let IG_COOKIES: Record<string, unknown>[] = []
try { if (IG_COOKIES_RAW) IG_COOKIES = JSON.parse(IG_COOKIES_RAW) } catch { /* ignored */ }

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

async function dbGet(table: string, filter: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}&limit=1`, {
    headers: dbHeaders()
  })
  const data = await res.json()
  return Array.isArray(data) ? data[0] || null : null
}

async function dbUpdate(table: string, filter: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify(body)
  })
}

async function dbInsert(table: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  return Array.isArray(data) ? data[0] || null : data
}

async function dbUpsert(table: string, body: Record<string, unknown>, onConflict: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      ...dbHeaders(),
      'Prefer': `return=minimal,resolution=merge-duplicates`,
      'On-Conflict': onConflict
    },
    body: JSON.stringify(body)
  })
  return res.ok
}

async function startRun(actor: string, input: Record<string, unknown>, webhooksParam: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }
    )
    if (!res.ok) { console.error(`${actor} start failed: ${res.status}`); return null }
    const data = await res.json()
    return data.data?.id || null
  } catch (e) { console.error(`${actor} error:`, e); return null }
}

// Startet den nächsten Fallback-Actor wenn der vorherige fehlschlug (leer oder FAILED)
// Liest "fallback:N" aus error_msg um zu wissen welchen Actor als nächstes starten
async function tryFallbackActor(job: Record<string, unknown>, jobId: string): Promise<boolean> {
  const msg = String(job.error_msg || '')
  const fallbackMatch = msg.match(/fallback:(\d)/)
  if (!fallbackMatch) return false

  const nextActorNum = parseInt(fallbackMatch[1])
  if (nextActorNum > 4) return false

  const username = String(job.target || '')
  if (!username) return false

  const proxyConfig = { useApifyProxy: true }
  const profileUrl = `https://www.instagram.com/${username}/`
  const hasCookies = IG_COOKIES.length > 0
  const cookiesParam = hasCookies ? { cookies: IG_COOKIES } : {}
  const loginCookiesParam = hasCookies ? { loginCookies: IG_COOKIES } : {}

  const actors: Record<number, { actor: string; input: Record<string, unknown> }> = {
    2: { actor: 'apify~instagram-scraper', input: { directUrls: [profileUrl], resultsType: 'posts', resultsLimit: 100, proxyConfiguration: proxyConfig, loginRequired: true, ...cookiesParam } },
    3: { actor: 'apify~instagram-api-scraper', input: { startUrls: [{ url: profileUrl }], resultsLimit: 100, proxyConfiguration: proxyConfig, ...cookiesParam } },
    4: { actor: 'instagram-scraper~fast-instagram-post-scraper', input: { username, resultsLimit: 100, proxyConfiguration: proxyConfig, ...cookiesParam } },
  }

  const call = actors[nextActorNum]
  if (!call) return false

  // Webhook-Param für denselben Job neu aufbauen
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/scrape-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${jobId}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  const newRunId = await startRun(call.actor, call.input, webhooksParam)
  if (!newRunId) {
    console.log(`Fallback Actor ${nextActorNum} konnte nicht gestartet werden`)
    return false
  }

  // Alle bisherigen Run-IDs aus error_msg extrahieren + neue anhängen
  const existingRunIds = (msg.match(/\b[A-Za-z0-9]{17,18}\b/g) || [])
  const allRunIds = [...new Set([...existingRunIds, newRunId])].join(',')
  const afterNext = nextActorNum < 4 ? nextActorNum + 1 : null
  const newErrorMsg = afterNext ? `fallback:${afterNext} ${allRunIds}` : `exhausted ${allRunIds}`

  await dbUpdate('scrape_jobs', `id=eq.${jobId}`, {
    status: 'running',
    apify_run_id: newRunId,
    error_msg: newErrorMsg
  })

  console.log(`Fallback: Actor ${nextActorNum} (${call.actor}) gestartet: ${newRunId}`)
  return true
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

function detectPostType(post: Record<string, unknown>): string {
  const t = String(post.type || post.media_type || '').toLowerCase()
  const pt = String(post.productType || post.product_type || '').toLowerCase()
  if (pt === 'clips' || t === 'reel' || t === 'reels') return 'reel'
  if (post.isVideo && (Number(post.videoViewCount) > 0 || Number(post.videoPlayCount) > 0)) return 'reel'
  if (t === 'video' || post.isVideo || post.is_video) return 'video'
  // fast-post-scraper: carousel_media_count > 1 oder carousel_media Array
  if (Number(post.carousel_media_count) > 1 || (Array.isArray(post.carousel_media) && (post.carousel_media as unknown[]).length > 1)) return 'carousel'
  if (Array.isArray(post.childPosts) && post.childPosts.length > 0) return 'carousel'
  if (t === 'sidecar' || t === 'carousel' || t === 'album') return 'carousel'
  return 'image'
}

async function getCompetitorId(username: string): Promise<string | null> {
  const row = await dbGet('competitor_profiles', `username=eq.${encodeURIComponent(username)}`)
  return row?.id || null
}

type UpsertResult = { saved: boolean, id: string | null, videoUrl: string | null }
type ExistingMap = Map<string, { id: string, transcript_status: string }>

// Batch-Fetch: alle bekannten Posts für diese Quelle in einer einzigen DB-Anfrage laden
// → verhindert N SELECT-Calls im Post-Loop (Perf-Optimierung)
async function fetchExistingPosts(source: string, competitorId: string | null): Promise<ExistingMap> {
  const filter = competitorId
    ? `source=eq.${source}&competitor_id=eq.${encodeURIComponent(competitorId)}&select=id,instagram_post_id,transcript_status&limit=500`
    : `source=eq.${source}&select=id,instagram_post_id,transcript_status&limit=500`
  const res = await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?${filter}`, {
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
  })
  const rows = res.ok ? await res.json().catch(() => []) : []
  const map: ExistingMap = new Map()
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.instagram_post_id) map.set(row.instagram_post_id, { id: row.id, transcript_status: row.transcript_status })
    }
  }
  return map
}

async function upsertPost(post: Record<string, unknown>, isOwn: boolean, competitorId: string | null, existingMap: ExistingMap): Promise<UpsertResult> {
  // Video-URL: verschiedene Feldnamen je nach Actor
  // fast-post-scraper: video_versions[0].url
  const videoVersions = Array.isArray(post.video_versions) ? post.video_versions : []
  const videoFromVersions = videoVersions.length > 0 ? (videoVersions[0] as Record<string, unknown>)?.url as string : null
  const videoUrl = (post.videoUrl || post.videoPlaybackUrl || post.video_url || videoFromVersions || null) as string | null

  // Thumbnail: fast-post-scraper nutzt 'image' Feld
  const thumbUrl = (post.displayUrl || post.thumbnailUrl || post.thumbnail_url || post.image_url || post.image || null) as string | null

  // PostID: shortCode (camelCase) | shortcode (lowercase, fast-scraper) | code | id | pk
  const rawId = post.shortCode || post.shortcode || post.code || post.id || post.pk
  const postId = rawId ? String(rawId) : null
  if (!postId) return { saved: false, id: null, videoUrl: null }

  // URL: post_url (fast-scraper) | url | aus shortCode/shortcode ableiten
  const shortCodeForUrl = (post.shortCode || post.shortcode || post.code) as string | undefined
  const postUrl = (post.url || post.post_url) as string | null
    || (shortCodeForUrl ? `https://www.instagram.com/p/${shortCodeForUrl}/` : null)

  // Aus vorgeladenem Batch-Map prüfen ob Post bereits in Endzustand (kein Extra-SELECT nötig)
  const existing = existingMap.get(postId) || null
  const alreadyProcessed = existing?.transcript_status === 'done' || existing?.transcript_status === 'transcribing'
  const source = isOwn ? 'own' : 'competitor'

  // Upsert-Body: transcript_status nur setzen wenn noch nicht in Endzustand
  const upsertBody: Record<string, unknown> = {
    source,
    competitor_id: competitorId,
    instagram_post_id: postId,
    post_type: detectPostType(post),
    caption: (post.caption || post.text || null) as string | null,
    // fast-post-scraper: like_count, view_count, comment_count (snake_case)
    likes_count: Number(post.likesCount || post.likes_count || post.like_count || post.edge_media_preview_like?.count || 0),
    comments_count: Number(post.commentsCount || post.comments_count || post.comment_count || 0),
    views_count: Number(post.videoViewCount || post.videoPlayCount || post.video_view_count || post.view_count || post.plays || 0),
    video_url: videoUrl,
    thumbnail_url: thumbUrl,
    // fast-post-scraper: 'date' Feld statt 'timestamp'
    published_at: parseTimestamp(post.timestamp || post.takenAt || post.taken_at || post.created_at || post.date),
    url: postUrl,
    scraped_at: new Date().toISOString(),
  }

  // transcript_status nur setzen wenn Post neu oder noch nicht in Endzustand
  if (!alreadyProcessed) {
    upsertBody.transcript_status = videoUrl ? 'pending' : 'none'
    upsertBody.visual_text_status = thumbUrl ? 'pending' : 'none'
  }

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?on_conflict=instagram_post_id,source&select=id`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(upsertBody)
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    console.error(`upsert error ${res.status}:`, errText.substring(0, 200))
    return { saved: false, id: null, videoUrl: null }
  }
  const rows = await res.json().catch(() => [])
  const row = Array.isArray(rows) ? rows[0] : rows
  const dbId = row?.id || existing?.id || null

  return { saved: true, id: dbId, videoUrl: (videoUrl && !alreadyProcessed) ? videoUrl : null }
}

// Startet Transkription für ein Video — fire-and-forget Call an transcribe-video Function
// Jede Transkription läuft in eigener Edge Function Invocation → kein Timeout im scrape-webhook
function triggerTranscription(postId: string, videoUrl: string): void {
  fetch(`${SUPABASE_URL}/functions/v1/transcribe-video`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${DASHBOARD_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: postId, video_url: videoUrl })
  }).catch(e => console.error(`transcribe-video trigger fehlgeschlagen für ${postId}:`, String(e)))
}

Deno.serve(async (req: Request) => {
  try {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '')
    if (token !== DASHBOARD_TOKEN) {
      return new Response('Unauthorized', { status: 401 })
    }

    const payload = await req.json()
    const { job_id, run_id: webhookRunId, status } = payload
    if (!job_id) return new Response('no job_id', { status: 400 })

    // Fehler-Events — NUR wenn Apify korrekt substituiert (nicht "{{eventType}}")
    if (status === 'ACTOR.RUN.FAILED' || status === 'ACTOR.RUN.TIMED_OUT') {
      const failedJob = await dbGet('scrape_jobs', `id=eq.${job_id}`)
      if (failedJob) {
        const started = await tryFallbackActor(failedJob, job_id)
        if (started) {
          return new Response(JSON.stringify({ ok: true, fallback: 'started' }), { headers: { 'Content-Type': 'application/json' } })
        }
      }
      await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
        status: 'error', error_msg: `${status} (alle Actors erschöpft)`, completed_at: new Date().toISOString()
      })
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Job laden
    const job = await dbGet('scrape_jobs', `id=eq.${job_id}`)
    if (!job) return new Response('job not found', { status: 404 })

    // Multi-Actor: Auch wenn Job bereits done ist, Posts vom zweiten/dritten Actor noch verarbeiten
    // → mehr Posts durch merge-duplicates upsert, kein Datenverlust
    // Nur überspringen wenn wirklich nichts mehr zu holen ist (z.B. vierter Actor identische Daten)
    const alreadyDoneWithManyPosts = job.status === 'done' && (job.result_count || 0) >= 40
    if (alreadyDoneWithManyPosts) {
      console.log(`Job ${job_id} bereits mit ${job.result_count} Posts abgeschlossen, überspringe`)
      return new Response(JSON.stringify({ ok: true, skipped: 'already_done' }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Run-IDs ermitteln: Apify substituiert {{resource.id}} nicht zuverlässig im payloadTemplate.
    // Daher: Alle bekannten Run-IDs aus der DB lesen (apify_run_id + error_msg "dual: id1,id2,...")
    function parseStoredRunIds(j: any): string[] {
      const ids: string[] = []
      // Zuerst den Webhook-run_id versuchen (falls Apify es mal korrekt substituiert)
      if (webhookRunId && webhookRunId !== '{{resource.id}}' && webhookRunId.length > 10) {
        ids.push(webhookRunId)
      }
      // apify_run_id aus DB
      if (j.apify_run_id && !ids.includes(j.apify_run_id)) {
        ids.push(j.apify_run_id)
      }
      // Alle Run-IDs aus error_msg — Apify Run-IDs sind 17-18 alphanumerische Zeichen
      // Funktioniert für alle error_msg Formate: "dual: id1, id2", "empty (tried: id1,id2)", usw.
      const msg = j.error_msg || ''
      const apifyIdRegex = /\b[A-Za-z0-9]{17,18}\b/g
      const matches = msg.match(apifyIdRegex) || []
      for (const id of matches) {
        if (!ids.includes(id)) ids.push(id)
      }
      return ids
    }

    const allRunIds = parseStoredRunIds(job)
    console.log(`Job ${job_id}: ${allRunIds.length} Run-IDs zu prüfen: ${allRunIds.join(', ')}`)

    // Dataset von Apify holen — probiert alle bekannten Run-IDs
    async function fetchDataset(runId: string): Promise<Record<string, unknown>[] | null> {
      const res = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=200`
      )
      const text = await res.text()
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : null
      } catch { return null }
    }

    // Datasets aller bekannten Run-IDs holen — erst direkt, dann mit Retries
    // Apify substituiert {{resource.id}} nicht zuverlässig → wir nutzen gespeicherte IDs
    let items: Record<string, unknown>[] | null = null
    let successfulRunId = ''

    // Hilfsfunktion: alle Run-IDs einmalig direkt abrufen (kein Wait)
    async function tryAllRunIds(): Promise<Record<string, unknown>[] | null> {
      for (const rid of allRunIds) {
        const data = await fetchDataset(rid)
        const valid = (data || []).filter((it: any) =>
          it.shortCode || it.shortcode || it.code || it.id || it.pk || it.latestPosts || it.username
        )
        if (valid.length > 0) {
          console.log(`Dataset gefunden: run_id=${rid}, ${valid.length} Items`)
          successfulRunId = rid
          return valid as Record<string, unknown>[]
        }
      }
      return null
    }

    // Sofort versuchen (kein Wait bei erstem Versuch), dann bis zu 5 Retries mit 10s Pause
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 10000))

      // Race-Condition Guard: nur abbrechen wenn ein anderer Actor bereits viele Posts hat
      const freshJob = await dbGet('scrape_jobs', `id=eq.${job_id}`)
      if (freshJob && (freshJob.result_count || 0) >= 40) {
        console.log(`Job ${job_id} bereits mit ${freshJob.result_count} Posts abgeschlossen, Retry abgebrochen`)
        return new Response(JSON.stringify({ ok: true, skipped: 'other_actor_succeeded', count: freshJob.result_count }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      items = await tryAllRunIds()
      if (items && items.length > 0) break
      console.log(`Attempt ${attempt + 1}/6: Alle ${allRunIds.length} Datasets leer, RunIDs: ${allRunIds.join(',')}`)
    }

    if (!items || items.length === 0) {
      const now = new Date().toISOString()
      // Nochmals prüfen ob ein anderer Webhook-Call inzwischen Erfolg hatte
      const freshJob = await dbGet('scrape_jobs', `id=eq.${job_id}`)
      if (freshJob && (freshJob.result_count || 0) > 0) {
        console.log(`Job ${job_id} bereits erfolgreich (${freshJob.result_count} Posts), kein Überschreiben`)
        return new Response(JSON.stringify({ ok: true, skipped: 'already_succeeded' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }
      // Fallback: nächsten Actor versuchen
      if (freshJob) {
        const started = await tryFallbackActor(freshJob, job_id)
        if (started) {
          return new Response(JSON.stringify({ ok: true, fallback: 'started' }), {
            headers: { 'Content-Type': 'application/json' }
          })
        }
      }
      // Alle Actors erschöpft → als done markieren
      await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
        status: 'done', result_count: 0, error_msg: `empty dataset (alle Actors erschöpft, tried: ${allRunIds.join(',')})`, completed_at: now
      })
      if (job.job_type === 'own_profile') {
        const own = await dbGet('own_profile', 'limit=1')
        if (own) await dbUpdate('own_profile', `id=eq.${own.id}`, { last_scraped_at: now })
      } else if (job.job_type === 'competitor' && job.target) {
        await dbUpdate('competitor_profiles', `username=eq.${encodeURIComponent(job.target)}`, { last_scraped_at: now })
      }
      return new Response(JSON.stringify({ ok: true, saved: 0 }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    const isOwn = job.job_type === 'own_profile'
    const firstItem = items[0]
    // Posts-Modus: direkte Post-Items (shortCode/id vorhanden, KEIN latestPosts-Array)
    // Profile-Modus: Profil-Objekte mit latestPosts[]
    // Fast-Scraper kann ownerUsername weglassen → nicht mehr als Pflichtfeld prüfen
    // Posts-Modus: direkte Post-Items (shortCode/shortcode/id/pk vorhanden, KEIN latestPosts-Array)
    // Achtung: fast-post-scraper nutzt 'shortcode' (lowercase) statt 'shortCode'
    const isPostsMode = !!(firstItem.shortCode || firstItem.shortcode || firstItem.id || firstItem.pk || firstItem.code) && !firstItem.latestPosts
    console.log(`Mode: ${isPostsMode ? 'posts (instagram-scraper)' : 'profile (profile-scraper)'}, items: ${items.length}, isOwn: ${isOwn}`)

    let savedCount = 0
    const videoPostsForTranscription: { id: string, videoUrl: string }[] = []

    if (isPostsMode) {
      // Posts-Modus — job.target ist zuverlässiger als ownerUsername (exakt wie in DB gespeichert)
      const username = (job.target || firstItem.ownerUsername) as string

      // Sicherheits-Check: Apify hat den richtigen Account gescrapet?
      // Passiert wenn Username-URL kaputt ist → Apify scrapt empfohlene Accounts statt Ziel-Account
      // fast-post-scraper: ownerUsername in user.username oder owner.username
      if (!isOwn) {
        const fastUser = (firstItem.user as any)?.username || (firstItem.owner as any)?.username || ''
        const scrapedUsername = ((firstItem.ownerUsername as string) || fastUser || '').toLowerCase().trim()
        const targetUsername = ((job.target as string) || '').toLowerCase().trim()
        if (scrapedUsername && targetUsername && scrapedUsername !== targetUsername) {
          console.error(`Wrong account scraped: got @${scrapedUsername}, expected @${targetUsername}`)
          await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
            status: 'error',
            error_msg: `Wrong account scraped: got @${scrapedUsername}, expected @${targetUsername}`,
            completed_at: new Date().toISOString()
          })
          return new Response(JSON.stringify({
            ok: false,
            error: 'wrong_account',
            got: scrapedUsername,
            expected: targetUsername
          }), { headers: { 'Content-Type': 'application/json' } })
        }
      }

      if (isOwn) {
        const own = await dbGet('own_profile', 'limit=1')
        if (own) await dbUpdate('own_profile', `id=eq.${own.id}`, { last_scraped_at: new Date().toISOString() })
      } else {
        await dbUpdate('competitor_profiles', `username=eq.${encodeURIComponent(username)}`, {
          last_scraped_at: new Date().toISOString()
        })
      }
      const competitorId = await getCompetitorId(username)
      // Einmaliger Batch-SELECT aller bekannten Posts → kein SELECT pro Post im Loop
      const existingMap = await fetchExistingPosts(isOwn ? 'own' : 'competitor', competitorId)
      for (const post of items) {
        const result = await upsertPost(post, isOwn, competitorId, existingMap)
        if (result.saved) {
          savedCount++
          if (result.id && result.videoUrl) videoPostsForTranscription.push({ id: result.id, videoUrl: result.videoUrl })
        }
      }

    } else {
      // Profile-Modus
      for (const item of items) {
        if (!item.username) continue
        const username = item.username as string
        const profileData = {
          display_name: (item.fullName as string) || null,
          bio: (item.biography as string) || null,
          followers_count: Number(item.followersCount) || 0,
          following_count: Number(item.followingCount) || 0,
          posts_count: Number(item.postsCount) || 0,
          profile_pic_url: (item.profilePicUrl as string) || null,
          last_scraped_at: new Date().toISOString()
        }
        if (isOwn) {
          const own = await dbGet('own_profile', 'limit=1')
          if (own) await dbUpdate('own_profile', `id=eq.${own.id}`, profileData)
          else await dbInsert('own_profile', { username, ...profileData })
        } else {
          await dbUpdate('competitor_profiles', `username=eq.${encodeURIComponent(username)}`, profileData)
        }
        const posts = (item.latestPosts || item.posts || []) as Record<string, unknown>[]
        const competitorId = await getCompetitorId(username)
        // Einmaliger Batch-SELECT pro Profil → kein SELECT pro Post im Loop
        const existingMap = await fetchExistingPosts(isOwn ? 'own' : 'competitor', competitorId)
        for (const post of posts) {
          const result = await upsertPost(post, isOwn, competitorId, existingMap)
          if (result.saved) {
            savedCount++
            if (result.id && result.videoUrl) videoPostsForTranscription.push({ id: result.id, videoUrl: result.videoUrl })
          }
        }
      }
    }

    // Race-Condition Guard: nicht überschreiben wenn ein anderer Actor mehr Posts gespeichert hat
    const jobBeforeFinish = await dbGet('scrape_jobs', `id=eq.${job_id}`)
    const currentCount = jobBeforeFinish?.result_count || 0
    const finalCount = Math.max(savedCount, currentCount)
    if (savedCount > 0 || currentCount === 0) {
      await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
        status: 'done', result_count: finalCount, completed_at: new Date().toISOString()
      })
    }
    console.log(`Job ${job_id} abgeschlossen: savedCount=${savedCount}, currentCount=${currentCount}, finalCount=${finalCount}`)

    if (finalCount > 0) {
      // Visuelle Texte aus Thumbnails extrahieren (fire & forget)
      fetch(`${SUPABASE_URL}/functions/v1/process-visual-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHBOARD_TOKEN}` }
      }).catch(() => {})

      // Auto-Klassifizierung neuer Posts (fire & forget)
      fetch(`${SUPABASE_URL}/functions/v1/classify-pillars`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHBOARD_TOKEN}` }
      }).catch(() => {})

      // Videos transkribieren — jeder Call läuft in eigener Edge Function (kein Timeout-Problem)
      // scrape-webhook kehrt sofort zurück, transcribe-video übernimmt Download+Upload+AssemblyAI
      if (videoPostsForTranscription.length > 0) {
        console.log(`Triggere Transkription für ${videoPostsForTranscription.length} Videos (fire-and-forget)...`)
        for (const { id, videoUrl } of videoPostsForTranscription) {
          triggerTranscription(id, videoUrl)
        }
        console.log(`${videoPostsForTranscription.length} Transkriptions-Calls abgeschickt`)
      }

      // Nach eigenem Profil-Scrape: Thomas DNA neu analysieren (fire & forget)
      if (job.job_type === 'own_profile') {
        fetch(`${SUPABASE_URL}/functions/v1/analyze-thomas`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHBOARD_TOKEN}` }
        }).catch(() => {})
      }

      // Topics auto-refresh: max 1x pro Tag (nicht nach jedem Scrape-Job)
      const lastTopic = await dbGet('topic_suggestions', 'order=created_at.desc')
      const topicAge = lastTopic ? Date.now() - new Date(lastTopic.created_at).getTime() : Infinity
      if (topicAge > 24 * 60 * 60 * 1000) {
        fetch(`${SUPABASE_URL}/functions/v1/topic-suggestions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHBOARD_TOKEN}` },
          body: JSON.stringify({})
        }).catch(() => {})
      }
    }

    return new Response(JSON.stringify({ ok: true, saved: savedCount, total: items.length }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('error:', msg)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
})
