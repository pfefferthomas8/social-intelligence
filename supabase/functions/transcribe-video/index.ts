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

  const { post_id, video_url } = await req.json()
  if (!post_id || !video_url) {
    return new Response(JSON.stringify({ error: 'post_id + video_url required' }), { status: 400, headers: CORS })
  }

  const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY')!

  // Transkription starten
  const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      'Authorization': ASSEMBLYAI_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      audio_url: video_url,
      language_detection: true, // Auto-Sprachdetection (DE/EN)
      punctuate: true,
      format_text: true,
    })
  })

  if (!submitRes.ok) {
    const err = await submitRes.text()
    await supabase.from('instagram_posts')
      .update({ transcript_status: 'error' })
      .eq('id', post_id)
    return new Response(JSON.stringify({ error: 'AssemblyAI error: ' + err }), { status: 502, headers: CORS })
  }

  const { id: transcriptId } = await submitRes.json()

  // Polling bis fertig (max 5 Minuten, alle 6 Sekunden)
  for (let i = 0; i < 50; i++) {
    await new Promise(r => setTimeout(r, 6000))

    const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
      headers: { 'Authorization': ASSEMBLYAI_KEY }
    })
    const pollData = await pollRes.json()

    if (pollData.status === 'completed') {
      await supabase.from('instagram_posts')
        .update({ transcript: pollData.text, transcript_status: 'done' })
        .eq('id', post_id)
      return new Response(JSON.stringify({ success: true, transcript: pollData.text }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    if (pollData.status === 'error') {
      await supabase.from('instagram_posts')
        .update({ transcript_status: 'error' })
        .eq('id', post_id)
      return new Response(JSON.stringify({ error: 'AssemblyAI: ' + pollData.error }), { status: 502, headers: CORS })
    }

    // status === 'processing' oder 'queued' → weiter warten
  }

  // Timeout
  await supabase.from('instagram_posts').update({ transcript_status: 'error' }).eq('id', post_id)
  return new Response(JSON.stringify({ error: 'Timeout' }), { status: 504, headers: CORS })
})
