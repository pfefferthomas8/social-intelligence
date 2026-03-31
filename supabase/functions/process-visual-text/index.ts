// Verarbeitet alle Posts mit visual_text_status='pending' in Batches
// Ruft Claude Haiku Vision auf um Text-Overlays aus Thumbnails zu extrahieren
// Wird automatisch nach jedem Scrape angestoßen (fire & forget)

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=minimal'
  }
}

async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const mediaType = contentType.split(';')[0].trim()
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return { data: btoa(binary), mediaType }
  } catch { return null }
}

async function extractVisualText(postId: string, thumbnailUrl: string): Promise<void> {
  // Sofort auf 'processing' setzen damit andere Läufe nicht doppelt verarbeiten
  await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${postId}`, {
    method: 'PATCH', headers: dbHeaders(),
    body: JSON.stringify({ visual_text_status: 'processing' })
  })

  const imageData = await fetchImageAsBase64(thumbnailUrl)
  if (!imageData) {
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${postId}`, {
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({ visual_text_status: 'error' })
    })
    return
  }

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.data } },
            {
              type: 'text',
              text: `Extrahiere ALLE sichtbaren Texte aus diesem Instagram-Frame.
Dazu gehören: Untertitel, Text-Overlays, B-Roll Texte, eingeblendete Sätze, Hashtags im Bild.
Ignoriere: Instagram-UI-Elemente, Profilnamen in der App-UI.
Kein Text sichtbar → antworte nur mit: KEIN TEXT
Gib nur den extrahierten Text aus, keine Erklärungen.`
            }
          ]
        }]
      })
    })

    if (!claudeRes.ok) {
      await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${postId}`, {
        method: 'PATCH', headers: dbHeaders(),
        body: JSON.stringify({ visual_text_status: 'error' })
      })
      return
    }

    const data = await claudeRes.json()
    const raw = data.content?.[0]?.text?.trim() || ''
    const visualText = raw && raw !== 'KEIN TEXT' ? raw.substring(0, 1000) : null

    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${postId}`, {
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({ visual_text: visualText, visual_text_status: 'done' })
    })
  } catch {
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${postId}`, {
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({ visual_text_status: 'error' })
    })
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Nur Reels/Videos/Carousels — Images haben oft keinen relevanten Text
  // Eigene Posts priorisiert (source=own zuerst)
  const postsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?visual_text_status=eq.pending&thumbnail_url=not.is.null&select=id,thumbnail_url,source,post_type&order=source.asc&limit=15`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const posts: any[] = await postsRes.json()

  if (!Array.isArray(posts) || posts.length === 0) {
    return new Response(JSON.stringify({ ok: true, processed: 0, message: 'Keine pending Posts' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Parallel verarbeiten (max 15 gleichzeitig)
  await Promise.all(
    posts.map((p: any) => extractVisualText(p.id, p.thumbnail_url))
  )

  return new Response(JSON.stringify({ ok: true, processed: posts.length }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
