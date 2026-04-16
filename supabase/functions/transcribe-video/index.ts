// Lädt Video von Instagram CDN → direkt zu AssemblyAI hochladen → Transkription starten
// Kein Supabase Storage mehr nötig: AssemblyAI hat eigenen Upload-Endpoint (/v2/upload)
// Vorteil: kein Größenlimit durch Storage, einfachere Pipeline, kein Storage-Aufwand

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') || ''

// Größenlimit: Instagram Reels max 90s → typisch 10-80MB, großzügig auf 200MB gesetzt
// Darüber: zu groß für Edge Function Memory → 'skipped' statt 'error' (nicht unser Fehler)
const MAX_VIDEO_BYTES = 200 * 1024 * 1024

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

async function dbPatch(filter: string, body: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?${filter}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify(body)
  })
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

  // 1. Content-Length vorab prüfen (HEAD request) — verhindert riesige Downloads
  try {
    const headRes = await fetch(video_url, {
      method: 'HEAD',
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15' },
      signal: AbortSignal.timeout(10000)
    })
    const contentLength = headRes.headers.get('content-length')
    if (contentLength && Number(contentLength) > MAX_VIDEO_BYTES) {
      console.log(`Video zu groß (${Math.round(Number(contentLength)/1024/1024)}MB) für ${post_id} → skipped`)
      await dbPatch(`id=eq.${post_id}`, { transcript_status: 'skipped' })
      return new Response(JSON.stringify({ skipped: true, reason: 'video_too_large', size_mb: Math.round(Number(contentLength)/1024/1024) }), { headers: CORS })
    }
  } catch (_) { /* HEAD fehlgeschlagen → trotzdem versuchen */ }

  // 2. Von Instagram CDN laden
  let videoData: ArrayBuffer | null = null
  try {
    const downloadRes = await fetch(video_url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(90000)
    })
    if (!downloadRes.ok) {
      console.error(`Download fehlgeschlagen: HTTP ${downloadRes.status} für ${post_id}`)
      // Bei 403/410: URL abgelaufen → pending lassen damit Re-Scrape hilft
      if (downloadRes.status === 403 || downloadRes.status === 410) {
        await dbPatch(`id=eq.${post_id}`, { transcript_status: 'pending' })
        return new Response(JSON.stringify({ error: 'url_expired', status: downloadRes.status }), { status: 502, headers: CORS })
      }
      await dbPatch(`id=eq.${post_id}`, { transcript_status: 'error' })
      return new Response(JSON.stringify({ error: `download_failed_${downloadRes.status}` }), { status: 502, headers: CORS })
    }
    videoData = await downloadRes.arrayBuffer()
  } catch (e) {
    console.error(`Download exception für ${post_id}:`, String(e))
    await dbPatch(`id=eq.${post_id}`, { transcript_status: 'error' })
    return new Response(JSON.stringify({ error: 'download_exception', detail: String(e) }), { status: 502, headers: CORS })
  }

  if (!videoData || videoData.byteLength < 1000) {
    await dbPatch(`id=eq.${post_id}`, { transcript_status: 'error' })
    return new Response(JSON.stringify({ error: 'video_empty' }), { status: 502, headers: CORS })
  }

  if (videoData.byteLength > MAX_VIDEO_BYTES) {
    console.log(`Video im Speicher zu groß (${Math.round(videoData.byteLength/1024/1024)}MB) → skipped`)
    await dbPatch(`id=eq.${post_id}`, { transcript_status: 'skipped' })
    return new Response(JSON.stringify({ skipped: true, reason: 'video_too_large' }), { headers: CORS })
  }

  console.log(`Download OK für ${post_id}: ${Math.round(videoData.byteLength/1024/1024)}MB`)

  // 3. Direkt zu AssemblyAI hochladen (kein Supabase Storage nötig)
  // AssemblyAI /v2/upload gibt eine interne URL zurück die sie selbst lesen können
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      'Authorization': ASSEMBLYAI_KEY,
      'Content-Type': 'application/octet-stream',
      'Transfer-Encoding': 'chunked',
    },
    body: videoData
  })

  if (!uploadRes.ok) {
    const err = await uploadRes.text()
    console.error(`AssemblyAI Upload fehlgeschlagen für ${post_id}:`, err.substring(0, 200))
    await dbPatch(`id=eq.${post_id}`, { transcript_status: 'error' })
    return new Response(JSON.stringify({ error: 'upload_failed', detail: err.substring(0, 200) }), { status: 502, headers: CORS })
  }

  const { upload_url } = await uploadRes.json()
  console.log(`AssemblyAI Upload OK für ${post_id}`)

  // 4. Transkription mit der AssemblyAI-internen URL starten
  const transcriptRes = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: upload_url,
      speech_models: ['universal-2'],
      language_detection: true,
      webhook_url: webhookUrl,
    })
  })

  if (!transcriptRes.ok) {
    const err = await transcriptRes.text()
    console.error(`AssemblyAI Transkription fehlgeschlagen für ${post_id}:`, err.substring(0, 200))
    await dbPatch(`id=eq.${post_id}`, { transcript_status: 'error' })
    return new Response(JSON.stringify({ error: 'transcript_failed', detail: err.substring(0, 200) }), { status: 502, headers: CORS })
  }

  const { id: transcriptId } = await transcriptRes.json()
  // storage_video_path nicht mehr nötig — kein Storage verwendet
  await dbPatch(`id=eq.${post_id}`, { transcript_status: 'transcribing', storage_video_path: null })
  console.log(`AssemblyAI Transkription gestartet für ${post_id}: ${transcriptId}`)

  return new Response(JSON.stringify({ ok: true, transcript_id: transcriptId }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
