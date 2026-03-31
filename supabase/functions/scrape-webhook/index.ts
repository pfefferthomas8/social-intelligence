import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

Deno.serve(async (req) => {
  try {
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

    const { data: job } = await supabase
      .from('scrape_jobs')
      .select('*')
      .eq('id', job_id)
      .maybeSingle()

    if (!job) return new Response('job not found', { status: 404 })

    if (status === 'ACTOR.RUN.FAILED' || status === 'ACTOR.RUN.TIMED_OUT') {
      await supabase.from('scrape_jobs').update({
        status: 'error', error_msg: status, completed_at: new Date().toISOString()
      }).eq('id', job_id)
      return new Response('error noted', { status: 200 })
    }

    const APIFY_KEY = Deno.env.get('APIFY_API_KEY')!
    const datasetUrl = `https://api.apify.com/v2/actor-runs/${run_id}/dataset/items?token=${APIFY_KEY}&limit=200`

    const datasetRes = await fetch(datasetUrl)
    const datasetText = await datasetRes.text()

    let items: any[]
    try {
      items = JSON.parse(datasetText)
    } catch {
      await supabase.from('scrape_jobs').update({
        status: 'error',
        error_msg: `JSON parse error: ${datasetText.substring(0, 200)}`,
        completed_at: new Date().toISOString()
      }).eq('id', job_id)
      return new Response(JSON.stringify({ ok: false, error: 'json parse failed', raw: datasetText.substring(0, 200) }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    if (!Array.isArray(items) || items.length === 0) {
      await supabase.from('scrape_jobs').update({
        status: 'error',
        error_msg: `empty/invalid dataset, status=${datasetRes.status}, type=${typeof items}`,
        completed_at: new Date().toISOString()
      }).eq('id', job_id)
      return new Response(JSON.stringify({ ok: true, saved: 0, reason: 'empty dataset', http_status: datasetRes.status }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Log structure of first item
    const firstItem = items[0]
    const keys = Object.keys(firstItem)
    console.log(`Dataset: ${items.length} items. First item keys: ${keys.join(', ')}`)
    console.log(`Has latestPosts: ${!!firstItem.latestPosts}, count: ${firstItem.latestPosts?.length || 0}`)
    console.log(`followersCount: ${firstItem.followersCount}, username: ${firstItem.username}`)

    let savedCount = 0
    const isOwn = job.job_type === 'own_profile'

    for (const item of items) {
      // Profil speichern — top-level fields
      if (item.username) {
        const profileData = {
          username: item.username,
          display_name: item.fullName || null,
          bio: item.biography || null,
          followers_count: Number(item.followersCount) || 0,
          following_count: Number(item.followingCount) || 0,
          posts_count: Number(item.postsCount) || 0,
          profile_pic_url: item.profilePicUrl || item.profilePicUrlHD || null,
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
          await supabase.from('competitor_profiles').update(profileData).eq('username', item.username)
        }
      }

      // Posts speichern — in item.latestPosts[] verschachtelt
      const posts: any[] = item.latestPosts || item.posts || []
      if (!Array.isArray(posts) || posts.length === 0) continue

      const competitorId = isOwn ? null : await getCompetitorId(supabase, item.username || job.target)

      for (const post of posts) {
        const postId = post.id || post.shortCode || post.pk
        if (!postId) continue

        const videoUrl = post.videoUrl || post.videoPlaybackUrl || null
        const thumbUrl = post.displayUrl || post.thumbnailUrl || post.imageUrl || null

        const postData = {
          source: isOwn ? 'own' : 'competitor',
          competitor_id: competitorId,
          instagram_post_id: String(postId),
          post_type: detectPostType(post),
          caption: post.caption || post.description || null,
          likes_count: Number(post.likesCount) || Number(post.likes) || 0,
          comments_count: Number(post.commentsCount) || Number(post.comments) || 0,
          views_count: Number(post.videoViewCount) || Number(post.videoPlayCount) || Number(post.views) || 0,
          video_url: videoUrl,
          thumbnail_url: thumbUrl,
          published_at: (() => {
            const ts = post.timestamp || post.takenAt
            if (!ts) return null
            try {
              // timestamp kann Sekunden (Unix) oder Millisekunden sein, oder ISO-String
              const n = Number(ts)
              if (isNaN(n)) return new Date(ts).toISOString() // ISO-String
              const d = new Date(n > 1e12 ? n : n * 1000) // Sekunden → ms
              return isNaN(d.getTime()) ? null : d.toISOString()
            } catch { return null }
          })(),
          url: post.url || (post.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null),
          transcript_status: videoUrl ? 'pending' : 'none',
          visual_text_status: thumbUrl ? 'pending' : 'none'
        }

        const { data: saved, error: upsertError } = await supabase
          .from('instagram_posts')
          .upsert(postData, { onConflict: 'instagram_post_id,source', ignoreDuplicates: false })
          .select('id, video_url, thumbnail_url, transcript_status, visual_text_status')
          .maybeSingle()

        if (!upsertError && saved) {
          savedCount++
          if (saved.video_url && saved.transcript_status === 'pending') {
            triggerTranscription(saved.id, saved.video_url, supabase)
          }
          if (saved.thumbnail_url && saved.visual_text_status === 'pending') {
            triggerVisualExtraction(saved.id, saved.thumbnail_url)
          }
        }
      }
    }

    await supabase.from('scrape_jobs').update({
      status: 'done',
      result_count: savedCount,
      completed_at: new Date().toISOString()
    }).eq('id', job_id)

    // Auto-refresh topics if last generation was > 2 hours ago
    const { data: lastTopic } = await supabase
      .from('topic_suggestions')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const shouldRefreshTopics = !lastTopic ||
      (Date.now() - new Date(lastTopic.created_at).getTime()) > 2 * 60 * 60 * 1000

    if (shouldRefreshTopics && savedCount > 0) {
      fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/topic-suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}`
        },
        body: JSON.stringify({})
      }).catch(() => {})
    }

    return new Response(JSON.stringify({ ok: true, saved: savedCount, items_in_dataset: items.length }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('scrape-webhook error:', err)
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

function detectPostType(post: any): string {
  if (post.productType === 'clips' || post.type === 'Reel') return 'reel'
  if (post.isVideo && (post.videoViewCount > 0 || post.videoPlayCount > 0)) return 'reel'
  if (post.type === 'Video' || post.isVideo) return 'video'
  if (post.type === 'Sidecar' || post.childPosts?.length > 0) return 'carousel'
  return 'image'
}

async function getCompetitorId(supabase: any, username: string): Promise<string | null> {
  const { data } = await supabase.from('competitor_profiles').select('id').eq('username', username).maybeSingle()
  return data?.id || null
}

function triggerTranscription(postId: string, videoUrl: string, supabase: any) {
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}` },
    body: JSON.stringify({ post_id: postId, video_url: videoUrl })
  }).catch(() => {})
}

function triggerVisualExtraction(postId: string, thumbnailUrl: string) {
  fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/extract-visual-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('DASHBOARD_TOKEN')}` },
    body: JSON.stringify({ post_id: postId, thumbnail_url: thumbnailUrl })
  }).catch(() => {})
}
