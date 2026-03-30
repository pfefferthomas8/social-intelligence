import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// Apify ruft diese Function auf wenn ein Scrape-Run abgeschlossen ist.
// Läuft vollständig im Backend — kein Frontend nötig.

Deno.serve(async (req) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== Deno.env.get('DASHBOARD_TOKEN')) {
    return new Response('Unauthorized', { status: 401 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const payload = await req.json()
  const { job_id, run_id, status } = payload

  if (!job_id) return new Response('no job_id', { status: 400 })

  // Job laden
  const { data: job } = await supabase
    .from('scrape_jobs')
    .select('*')
    .eq('id', job_id)
    .maybeSingle()

  if (!job) return new Response('job not found', { status: 404 })

  // Bei Fehler/Timeout
  if (status === 'ACTOR.RUN.FAILED' || status === 'ACTOR.RUN.TIMED_OUT') {
    await supabase.from('scrape_jobs').update({
      status: 'error',
      error_msg: status,
      completed_at: new Date().toISOString()
    }).eq('id', job_id)
    return new Response('error noted', { status: 200 })
  }

  // Results aus Apify Dataset laden
  const APIFY_KEY = Deno.env.get('APIFY_API_KEY')!
  const datasetRes = await fetch(
    `https://api.apify.com/v2/actor-runs/${run_id}/dataset/items?token=${APIFY_KEY}&limit=200`
  )
  const items = await datasetRes.json()

  if (!Array.isArray(items)) {
    await supabase.from('scrape_jobs').update({ status: 'error', error_msg: 'invalid dataset' }).eq('id', job_id)
    return new Response('invalid dataset', { status: 200 })
  }

  let savedCount = 0
  const isOwn = job.job_type === 'own_profile'

  for (const item of items) {
    // Profil-Daten speichern
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
        const { data: existing } = await supabase.from('own_profile').select('id').limit(1).maybeSingle()
        if (existing) {
          await supabase.from('own_profile').update(profileData).eq('id', existing.id)
        } else {
          await supabase.from('own_profile').insert(profileData)
        }
      } else {
        await supabase.from('competitor_profiles')
          .update({ ...profileData, last_scraped_at: new Date().toISOString() })
          .eq('username', item.username)
      }
    }

    // Posts speichern
    if (item.shortCode || item.type === 'Post' || item.type === 'Video' || item.type === 'Reel') {
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
        transcript_status: (item.videoUrl || item.videoPlaybackUrl) ? 'pending' : 'none',
        visual_text_status: (item.displayUrl || item.thumbnailUrl || item.imageUrl) ? 'pending' : 'none'
      }

      const { data: saved, error } = await supabase
        .from('instagram_posts')
        .upsert(postData, { onConflict: 'instagram_post_id,source', ignoreDuplicates: false })
        .select('id, video_url, thumbnail_url, transcript_status, visual_text_status')
        .maybeSingle()

      if (!error && saved) {
        savedCount++
        // Audio-Transkription (AssemblyAI) — für Videos/Reels
        if (saved.video_url && saved.transcript_status === 'pending') {
          triggerTranscription(saved.id, saved.video_url, supabase)
        }
        // Visual Text Extraction (Claude Vision) — für alle Posts mit Thumbnail
        if (saved.thumbnail_url && saved.visual_text_status === 'pending') {
          triggerVisualExtraction(saved.id, saved.thumbnail_url)
        }
      }
    }
  }

  // Job als done markieren
  await supabase.from('scrape_jobs').update({
    status: 'done',
    result_count: savedCount,
    completed_at: new Date().toISOString()
  }).eq('id', job_id)

  return new Response(JSON.stringify({ ok: true, saved: savedCount }), {
    headers: { 'Content-Type': 'application/json' }
  })
})

function detectPostType(item: any): string {
  if (item.type === 'Reel' || item.productType === 'clips') return 'reel'
  if (item.isVideo && (item.videoViewCount > 0 || item.videoPlayCount > 0)) return 'reel'
  if (item.type === 'Video' || item.isVideo) return 'video'
  if (item.type === 'Sidecar' || item.childPosts?.length > 0) return 'carousel'
  return 'image'
}

async function getCompetitorId(supabase: any, username: string): Promise<string | null> {
  const { data } = await supabase.from('competitor_profiles').select('id').eq('username', username).maybeSingle()
  return data?.id || null
}

function triggerTranscription(postId: string, videoUrl: string, supabase: any) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-video`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}`
    },
    body: JSON.stringify({ post_id: postId, video_url: videoUrl })
  }).catch(() => {})
}

function triggerVisualExtraction(postId: string, thumbnailUrl: string) {
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-visual-text`
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}`
    },
    body: JSON.stringify({ post_id: postId, thumbnail_url: thumbnailUrl })
  }).catch(() => {})
}
