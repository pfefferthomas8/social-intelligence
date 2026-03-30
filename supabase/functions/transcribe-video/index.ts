import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

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

  const { post_id, video_url } = await req.json()
  if (!post_id || !video_url) {
    return new Response(JSON.stringify({ error: 'post_id + video_url required' }), { status: 400, headers: CORS })
  }

  const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN')!

  // Webhook URL — AssemblyAI ruft uns auf wenn fertig (kein Polling, kein Timeout-Problem)
  const webhookUrl = `${SUPABASE_URL}/functions/v1/transcribe-webhook?token=${DASHBOARD_TOKEN}&post_id=${post_id}`

  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': ASSEMBLYAI_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: video_url,
      language_detection: true,
      punctuate: true,
      format_text: true,
      webhook_url: webhookUrl,
    })
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    await supabase.from('instagram_posts').update({ transcript_status: 'error' }).eq('id', post_id)
    return new Response(JSON.stringify({ error: 'AssemblyAI error: ' + err }), { status: 502, headers: CORS })
  }

  const { id: transcriptId } = await submitRes.json()
  await supabase.from('instagram_posts').update({ transcript_status: 'pending' }).eq('id', post_id)

  return new Response(JSON.stringify({ ok: true, transcript_id: transcriptId }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
