// download-videos — lädt Instagram-Videos in Supabase Storage, übergibt URL an AssemblyAI
//
// Warum: Instagram CDN URLs laufen in Stunden ab → AssemblyAI kann sie nicht direkt nutzen.
// Lösung: Video sofort nach Scrape runterladen → in Storage speichern → AssemblyAI liest von dort.
// Nach erfolgter Transkription löscht transcribe-webhook das Video wieder aus Storage.
//
// Status-Flow: pending → downloading → uploaded → transcribing → done/error

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

async function patchPost(id: string, data: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify(data)
  })
}

// Video von Instagram CDN runterladen (mit Browser-Headers)
async function downloadVideo(videoUrl: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'video/mp4,video/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'de-AT,de;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(60000) // 60s pro Video
    })
    if (!res.ok) {
      console.error(`Download fehlgeschlagen: HTTP ${res.status}`)
      return null
    }
    const contentLength = res.headers.get('content-length')
    if (contentLength && Number(contentLength) > 150 * 1024 * 1024) {
      console.error(`Video zu groß: ${contentLength} bytes`)
      return null
    }
    return await res.arrayBuffer()
  } catch (e) {
    console.error('Download error:', String(e))
    return null
  }
}

// In Supabase Storage hochladen
async function uploadToStorage(postId: string, videoData: ArrayBuffer): Promise<string | null> {
  const path = `${postId}.mp4`
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/instagram-videos/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'video/mp4',
      'x-upsert': 'true', // Überschreiben wenn schon vorhanden
    },
    body: videoData
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Storage Upload fehlgeschlagen:', err.substring(0, 200))
    return null
  }
  return path
}

// Temporäre Signed URL (2 Stunden) — AssemblyAI lädt Video davon
async function getSignedUrl(path: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/instagram-videos/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 7200 }) // 2h — AssemblyAI braucht max 1h
  })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.signedURL) return null
  return `${SUPABASE_URL}/storage/v1${data.signedURL}`
}

// An AssemblyAI schicken
async function submitToAssemblyAI(postId: string, audioUrl: string): Promise<boolean> {
  const webhookUrl = `${SUPABASE_URL}/functions/v1/transcribe-webhook?token=${DASHBOARD_TOKEN}&post_id=${postId}`
  const res = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: { 'Authorization': ASSEMBLYAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_detection: true,
      punctuate: true,
      format_text: true,
      webhook_url: webhookUrl,
    })
  })
  if (!res.ok) {
    console.error('AssemblyAI Fehler:', await res.text())
  }
  return res.ok
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
  const limit = Math.min(Number(body.limit) || 5, 10) // max 10 Videos pro Aufruf

  // Posts holen die noch nicht transkribiert wurden und eine Video-URL haben
  // 'pending' = neu gescrapet, noch nie versucht
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?transcript_status=eq.pending&video_url=not.is.null&select=id,video_url&limit=${limit}`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const posts: any[] = await postsRes.json().catch(() => [])

  if (!Array.isArray(posts) || posts.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'Keine ausstehenden Videos' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  let downloaded = 0
  let submitted = 0
  let errors = 0

  for (const post of posts) {
    console.log(`Verarbeite ${post.id}...`)

    // Als 'downloading' markieren → verhindert parallele Doppelverarbeitung
    await patchPost(post.id, { transcript_status: 'downloading' })

    // 1. Von Instagram CDN runterladen
    const videoData = await downloadVideo(post.video_url)
    if (!videoData || videoData.byteLength < 1000) {
      console.error(`Download fehlgeschlagen für ${post.id}`)
      await patchPost(post.id, { transcript_status: 'error' })
      errors++
      continue
    }
    downloaded++
    console.log(`Heruntergeladen: ${(videoData.byteLength / 1024 / 1024).toFixed(1)}MB`)

    // 2. In Supabase Storage hochladen
    const storagePath = await uploadToStorage(post.id, videoData)
    if (!storagePath) {
      await patchPost(post.id, { transcript_status: 'error' })
      errors++
      continue
    }
    await patchPost(post.id, { storage_video_path: storagePath, transcript_status: 'uploaded' })

    // 3. Signed URL holen
    const signedUrl = await getSignedUrl(storagePath)
    if (!signedUrl) {
      await patchPost(post.id, { transcript_status: 'error' })
      errors++
      continue
    }

    // 4. An AssemblyAI übergeben
    const ok = await submitToAssemblyAI(post.id, signedUrl)
    if (ok) {
      submitted++
      await patchPost(post.id, { transcript_status: 'transcribing' })
      console.log(`Transkription gestartet für ${post.id}`)
    } else {
      await patchPost(post.id, { transcript_status: 'error' })
      errors++
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    found: posts.length,
    downloaded,
    submitted_to_assemblyai: submitted,
    errors
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
