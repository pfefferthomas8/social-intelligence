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

  const { url } = await req.json()
  if (!url) return new Response(JSON.stringify({ error: 'url required' }), { status: 400, headers: CORS })

  const APIFY_KEY = Deno.env.get('APIFY_API_KEY')!

  // Apify Instagram Scraper für einzelne URL starten
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: [url],
        resultsLimit: 1,
        extendOutputFunction: `($) => { return {} }`,
      })
    }
  )

  if (!apifyRes.ok) {
    const err = await apifyRes.text()
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), { status: 502, headers: CORS })
  }

  const run = await apifyRes.json()
  const runId = run.data?.id

  // Auf Ergebnis warten (max 90s, polling alle 5s)
  let item = null
  for (let i = 0; i < 18; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`)
    const statusData = await statusRes.json()
    if (statusData.data?.status === 'SUCCEEDED') {
      const dataRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=1`)
      const items = await dataRes.json()
      if (items.length > 0) { item = items[0]; break }
    }
    if (statusData.data?.status === 'FAILED') break
  }

  if (!item) {
    return new Response(JSON.stringify({ error: 'Scraping fehlgeschlagen oder Timeout.' }), { status: 502, headers: CORS })
  }

  // Post in DB speichern
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
    video_url: item.videoUrl || item.videoPlaybackUrl || null,
    thumbnail_url: item.displayUrl || item.thumbnailUrl || item.imageUrl || null,
    published_at: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : null,
    url: item.url || url,
    transcript_status: (item.videoUrl || item.videoPlaybackUrl) ? 'pending' : 'none'
  }

  const { data: saved, error: dbErr } = await supabase
    .from('instagram_posts')
    .upsert(postData, { onConflict: 'instagram_post_id,source' })
    .select('*')
    .single()

  if (dbErr) {
    return new Response(JSON.stringify({ error: 'DB error: ' + dbErr.message }), { status: 500, headers: CORS })
  }

  // Transkription starten (fire-and-forget)
  if (saved.video_url) {
    fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}`
      },
      body: JSON.stringify({ post_id: saved.id, video_url: saved.video_url })
    }).catch(() => {})
  }

  return new Response(JSON.stringify({ post: saved }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
