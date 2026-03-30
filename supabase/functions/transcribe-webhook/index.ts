import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

// AssemblyAI ruft diese Function auf wenn Transkription fertig ist.

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const post_id = url.searchParams.get('post_id')

  if (token !== Deno.env.get('DASHBOARD_TOKEN')) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (!post_id) return new Response('no post_id', { status: 400 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const payload = await req.json()
  // AssemblyAI webhook payload: { status, transcript_id, text, ... }
  const { status, text, transcript_id } = payload

  if (status === 'completed' && text) {
    await supabase.from('instagram_posts')
      .update({ transcript: text, transcript_status: 'done' })
      .eq('id', post_id)
  } else if (status === 'error') {
    await supabase.from('instagram_posts')
      .update({ transcript_status: 'error' })
      .eq('id', post_id)
  }

  return new Response('ok', { status: 200 })
})
