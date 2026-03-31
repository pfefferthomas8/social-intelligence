const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { url } = await req.json()
  if (!url) return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: CORS })

  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directUrls: [url], resultsLimit: 1 })
    }
  )

  if (!apifyRes.ok) {
    const err = await apifyRes.text()
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), { status: 502, headers: CORS })
  }

  const run = await apifyRes.json()
  const runId = run.data?.id

  // Auf Ergebnis warten (max 90s)
  let item = null
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`)
    const statusData = await statusRes.json()
    if (statusData.data?.status === 'SUCCEEDED') {
      const dataRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=1`)
      const items = await dataRes.json()
      if (Array.isArray(items) && items.length > 0) { item = items[0]; break }
    }
    if (statusData.data?.status === 'FAILED') break
  }

  if (!item) {
    return new Response(JSON.stringify({ error: 'Scraping fehlgeschlagen oder Timeout.' }), { status: 502, headers: CORS })
  }

  const videoUrl = item.videoUrl || item.videoPlaybackUrl || null
  const postData = {
    source: 'custom',
    instagram_post_id: item.id || item.shortCode || url,
    post_type: item.type === 'Reel' || item.productType === 'clips' ? 'reel'
      : item.isVideo ? 'video'
      : item.type === 'Sidecar' ? 'carousel'
      : 'image',
    caption: item.caption || item.description || null,
    likes_count: item.likesCount || item.likes || 0,
    comments_count: item.commentsCount || item.comments || 0,
    views_count: item.videoViewCount || item.videoPlayCount || item.views || 0,
    video_url: videoUrl,
    thumbnail_url: item.displayUrl || item.thumbnailUrl || item.imageUrl || null,
    published_at: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : null,
    url: item.url || url,
    transcript_status: videoUrl ? 'pending' : 'none'
  }

  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=representation,resolution=merge-duplicates', 'On-Conflict': 'instagram_post_id,source' },
    body: JSON.stringify(postData)
  })
  const savedArr = await saveRes.json()
  const saved = Array.isArray(savedArr) ? savedArr[0] : savedArr

  if (saved?.video_url) {
    fetch(`${SUPABASE_URL}/functions/v1/transcribe-video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DASHBOARD_TOKEN}` },
      body: JSON.stringify({ post_id: saved.id, video_url: saved.video_url })
    }).catch(() => {})
  }

  return new Response(JSON.stringify({ post: saved }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
