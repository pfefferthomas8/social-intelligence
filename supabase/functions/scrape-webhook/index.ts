// Supabase REST API direkt via fetch — kein Import nötig

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

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
  if (post.productType === 'clips' || post.type === 'Reel') return 'reel'
  if (post.isVideo && (Number(post.videoViewCount) > 0 || Number(post.videoPlayCount) > 0)) return 'reel'
  if (post.type === 'Video' || post.isVideo) return 'video'
  if (Array.isArray(post.childPosts) && post.childPosts.length > 0) return 'carousel'
  if (post.type === 'Sidecar') return 'carousel'
  return 'image'
}

async function getCompetitorId(username: string): Promise<string | null> {
  const row = await dbGet('competitor_profiles', `username=eq.${encodeURIComponent(username)}`)
  return row?.id || null
}

async function upsertPost(post: Record<string, unknown>, isOwn: boolean, competitorId: string | null): Promise<boolean> {
  const videoUrl = (post.videoUrl || post.videoPlaybackUrl || null) as string | null
  const thumbUrl = (post.displayUrl || post.thumbnailUrl || null) as string | null
  // shortCode bevorzugen — stabil und kein Integer-Precision-Problem
  const postId = (post.shortCode || post.id) ? String(post.shortCode || post.id) : null
  if (!postId) return false

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?on_conflict=instagram_post_id,source`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey': SERVICE_KEY,
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        source: isOwn ? 'own' : 'competitor',
        competitor_id: competitorId,
        instagram_post_id: postId,
        post_type: detectPostType(post),
        caption: (post.caption as string) || null,
        likes_count: Number(post.likesCount) || 0,
        comments_count: Number(post.commentsCount) || 0,
        views_count: Number(post.videoViewCount) || Number(post.videoPlayCount) || 0,
        video_url: videoUrl,
        thumbnail_url: thumbUrl,
        published_at: parseTimestamp(post.timestamp || post.takenAt),
        url: (post.url as string) || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null),
        transcript_status: videoUrl ? 'pending' : 'none',
        visual_text_status: thumbUrl ? 'pending' : 'none'
      })
    }
  )

  if (!res.ok) {
    const errText = await res.text()
    console.error(`upsert error ${res.status}:`, errText.substring(0, 200))
    return false
  }
  return true
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
      await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
        status: 'error', error_msg: status, completed_at: new Date().toISOString()
      })
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } })
    }

    // Job laden
    const job = await dbGet('scrape_jobs', `id=eq.${job_id}`)
    if (!job) return new Response('job not found', { status: 404 })

    // Dataset von Apify holen — mit Retry (Race Condition: Apify meldet SUCCEEDED bevor Dataset ready ist)
    async function fetchDataset(): Promise<Record<string, unknown>[] | null> {
      const res = await fetch(
        `https://api.apify.com/v2/actor-runs/${run_id}/dataset/items?token=${APIFY_KEY}&limit=200`
      )
      const text = await res.text()
      try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed) ? parsed : null
      } catch { return null }
    }

    // Bis zu 6 Versuche: erst 15s warten (Apify Dataset braucht Zeit), dann alle 10s
    // Apify meldet SUCCEEDED oft bevor das Dataset vollständig geschrieben ist
    let items: Record<string, unknown>[] | null = null
    await new Promise(r => setTimeout(r, 15000)) // Immer 15s warten bevor erster Versuch
    for (let attempt = 0; attempt < 6; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 10000))
      items = await fetchDataset()
      const valid = (items || []).filter((it: any) => it.shortCode || it.id || it.latestPosts)
      if (valid.length > 0) { items = valid as Record<string, unknown>[]; break }
      console.log(`Dataset attempt ${attempt + 1}/6: ${items?.length ?? 'null'} items`)
    }

    if (!items || items.length === 0) {
      const now = new Date().toISOString()
      await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
        status: 'done', result_count: 0, error_msg: 'empty dataset after retries', completed_at: now
      })
      // last_scraped_at auch bei leerem Ergebnis setzen — damit UI nicht "Nie" zeigt
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
    // Posts-Modus: instagram-scraper gibt direkte Post-Items (haben shortCode + ownerUsername, KEIN latestPosts[])
    // Profile-Modus: instagram-profile-scraper gibt Profil-Objekte mit latestPosts[]
    const isPostsMode = !!(firstItem.shortCode || firstItem.id) && !firstItem.latestPosts && !!(firstItem.ownerUsername || firstItem.ownerId)
    console.log(`Mode: ${isPostsMode ? 'posts (instagram-scraper)' : 'profile (profile-scraper)'}, items: ${items.length}, isOwn: ${isOwn}`)

    let savedCount = 0

    if (isPostsMode) {
      // Posts-Modus — job.target ist zuverlässiger als ownerUsername (exakt wie in DB gespeichert)
      const username = (job.target || firstItem.ownerUsername) as string
      if (isOwn) {
        const own = await dbGet('own_profile', 'limit=1')
        if (own) await dbUpdate('own_profile', `id=eq.${own.id}`, { last_scraped_at: new Date().toISOString() })
      } else {
        await dbUpdate('competitor_profiles', `username=eq.${encodeURIComponent(username)}`, {
          last_scraped_at: new Date().toISOString()
        })
      }
      const competitorId = await getCompetitorId(username)
      for (const post of items) {
        if (await upsertPost(post, isOwn, competitorId)) savedCount++
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
        for (const post of posts) {
          if (await upsertPost(post, isOwn, competitorId)) savedCount++
        }
      }
    }

    await dbUpdate('scrape_jobs', `id=eq.${job_id}`, {
      status: 'done', result_count: savedCount, completed_at: new Date().toISOString()
    })

    if (savedCount > 0) {
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
