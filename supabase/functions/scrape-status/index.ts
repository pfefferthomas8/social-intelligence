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

  const { job_id } = await req.json()
  const APIFY_KEY = Deno.env.get('APIFY_API_KEY')!

  // Job aus DB laden
  const { data: job } = await supabase
    .from('scrape_jobs')
    .select('*')
    .eq('id', job_id)
    .single()

  if (!job) return new Response(JSON.stringify({ error: 'Job not found' }), { status: 404, headers: CORS })
  if (job.status === 'done' || job.status === 'error') {
    return new Response(JSON.stringify({ status: job.status, result_count: job.result_count }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Apify Run Status prüfen
  const statusRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${job.apify_run_id}?token=${APIFY_KEY}`
  )
  const statusData = await statusRes.json()
  const runStatus = statusData.data?.status // RUNNING, SUCCEEDED, FAILED, etc.

  if (runStatus === 'RUNNING' || runStatus === 'CREATED') {
    return new Response(JSON.stringify({ status: 'running' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  if (runStatus !== 'SUCCEEDED') {
    await supabase.from('scrape_jobs').update({ status: 'error', error_msg: runStatus, completed_at: new Date().toISOString() }).eq('id', job.id)
    return new Response(JSON.stringify({ status: 'error', error: runStatus }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Results aus Apify Dataset laden
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${job.apify_run_id}/dataset/items?token=${APIFY_KEY}&limit=200`
  )
  const items = await datasetRes.json()

  let savedCount = 0
  const isOwn = job.job_type === 'own_profile'

  for (const item of items) {
    // Profil-Daten (erstes Item ist oft das Profil)
    if (item.followersCount !== undefined && item.username) {
      const profileData = {
        username: item.username,
        display_name: item.fullName || null,
        bio: item.biography || null,
        followers_count: item.followersCount || 0,
        following_count: item.followingCount || 0,
        posts_count: item.postsCount || 0,
        profile_pic_url: item.profilePicUrl || null,
        last_scraped_at: new Date().toISOString()
      }

      if (isOwn) {
        // Upsert eigenes Profil
        const { data: existing } = await supabase.from('own_profile').select('id').limit(1).maybeSingle()
        if (existing) {
          await supabase.from('own_profile').update(profileData).eq('id', existing.id)
        } else {
          await supabase.from('own_profile').insert(profileData)
        }
      } else {
        // Competitor Profil aktualisieren
        const { data: comp } = await supabase
          .from('competitor_profiles')
          .select('id')
          .eq('username', item.username)
          .maybeSingle()
        if (comp) {
          await supabase.from('competitor_profiles')
            .update({ ...profileData, last_scraped_at: new Date().toISOString() })
            .eq('id', comp.id)
        }
      }
    }

    // Posts verarbeiten
    if (item.type === 'Post' || item.type === 'Video' || item.type === 'Reel' || item.shortCode) {
      const competitorId = isOwn ? null : await getCompetitorId(supabase, item.username || job.target)

      const postData = {
        source: isOwn ? 'own' : 'competitor',
        competitor_id: competitorId,
        instagram_post_id: item.id || item.shortCode,
        post_type: detectPostType(item),
        caption: item.caption || item.description || null,
        likes_count: item.likesCount || item.likes || 0,
        comments_count: item.commentsCount || item.comments || 0,
        views_count: item.videoViewCount || item.videoPlayCount || item.views || 0,
        video_url: item.videoUrl || item.videoPlaybackUrl || null,
        thumbnail_url: item.displayUrl || item.thumbnailUrl || item.imageUrl || null,
        published_at: item.timestamp ? new Date(item.timestamp * 1000).toISOString() : null,
        url: item.url || `https://www.instagram.com/p/${item.shortCode}/`,
        transcript_status: (item.videoUrl || item.videoPlaybackUrl) ? 'pending' : 'none'
      }

      // Upsert — nicht doppelt einfügen
      const { data: saved, error: upsertErr } = await supabase
        .from('instagram_posts')
        .upsert(postData, { onConflict: 'instagram_post_id,source', ignoreDuplicates: false })
        .select('id, video_url, transcript_status')
        .maybeSingle()

      if (!upsertErr && saved) {
        savedCount++
        // Transkription anstarten wenn Video vorhanden
        if (saved.video_url && saved.transcript_status === 'pending') {
          triggerTranscription(saved.id, saved.video_url, supabase)
        }
      }
    }
  }

  // Job als done markieren
  await supabase.from('scrape_jobs').update({
    status: 'done',
    result_count: savedCount,
    completed_at: new Date().toISOString()
  }).eq('id', job.id)

  return new Response(JSON.stringify({ status: 'done', result_count: savedCount }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})

function detectPostType(item: any): string {
  if (item.type === 'Reel' || item.productType === 'clips' || item.isVideo && item.videoViewCount > 0) return 'reel'
  if (item.type === 'Video' || item.isVideo) return 'video'
  if (item.type === 'Sidecar' || item.childPosts?.length > 0) return 'carousel'
  return 'image'
}

async function getCompetitorId(supabase: any, username: string): Promise<string | null> {
  const { data } = await supabase.from('competitor_profiles').select('id').eq('username', username).maybeSingle()
  return data?.id || null
}

// Fire-and-forget Transkription
function triggerTranscription(postId: string, videoUrl: string, supabase: any) {
  const transcribeUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-video`
  fetch(transcribeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}`
    },
    body: JSON.stringify({ post_id: postId, video_url: videoUrl })
  }).catch(() => {}) // Ignore errors — läuft im Hintergrund
}
