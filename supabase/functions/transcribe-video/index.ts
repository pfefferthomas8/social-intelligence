const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') || ''

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

  const { post_id, video_url } = await req.json()
  if (!post_id || !video_url) {
    return new Response(JSON.stringify({ error: 'post_id + video_url required' }), { status: 400, headers: CORS })
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/transcribe-webhook?token=${DASHBOARD_TOKEN}&post_id=${post_id}`

  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: video_url,
      speech_models: ['universal-2'],
      language_detection: true,
      webhook_url: webhookUrl,
    })
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
      method: 'PATCH', headers: dbHeaders(), body: JSON.stringify({ transcript_status: 'error' })
    })
    return new Response(JSON.stringify({ error: 'AssemblyAI error: ' + err }), { status: 502, headers: CORS })
  }

  const { id: transcriptId } = await submitRes.json()
  await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
    method: 'PATCH', headers: dbHeaders(), body: JSON.stringify({ transcript_status: 'transcribing' })
  })

  return new Response(JSON.stringify({ ok: true, transcript_id: transcriptId }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
