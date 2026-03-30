import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Lädt ein Bild als base64
async function fetchImageAsBase64(url: string): Promise<{ data: string; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15' }
    })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'image/jpeg'
    const mediaType = contentType.split(';')[0].trim()
    const buffer = await res.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i])
    return { data: btoa(binary), mediaType }
  } catch {
    return null
  }
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

  const { post_id, thumbnail_url } = await req.json()
  if (!post_id || !thumbnail_url) {
    return new Response(JSON.stringify({ error: 'post_id + thumbnail_url required' }), { status: 400, headers: CORS })
  }

  await supabase.from('instagram_posts')
    .update({ visual_text_status: 'pending' })
    .eq('id', post_id)

  // Thumbnail als base64 laden
  const imageData = await fetchImageAsBase64(thumbnail_url)
  if (!imageData) {
    await supabase.from('instagram_posts').update({ visual_text_status: 'error' }).eq('id', post_id)
    return new Response(JSON.stringify({ error: 'Thumbnail nicht ladbar' }), { status: 422, headers: CORS })
  }

  // Claude Vision — extrahiert sichtbaren Text aus dem Frame
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: imageData.mediaType,
              data: imageData.data,
            }
          },
          {
            type: 'text',
            text: `Extrahiere ALLE sichtbaren Texte aus diesem Instagram-Video-Frame. 
Dazu gehören: Untertitel, Text-Overlays, B-Roll Texte, eingeblendete Sätze, Captions im Video, Hashtags im Bild.
Ignoriere: Profilnamen, UI-Elemente von Instagram selbst.
Wenn kein Text sichtbar ist, antworte mit: KEIN TEXT
Gib nur den extrahierten Text aus, keine Erklärungen.`
          }
        ]
      }]
    })
  })

  if (!claudeRes.ok) {
    await supabase.from('instagram_posts').update({ visual_text_status: 'error' }).eq('id', post_id)
    return new Response(JSON.stringify({ error: 'Claude error' }), { status: 502, headers: CORS })
  }

  const claudeData = await claudeRes.json()
  const extractedText = claudeData.content?.[0]?.text?.trim()

  const visualText = extractedText && extractedText !== 'KEIN TEXT' ? extractedText : null

  await supabase.from('instagram_posts').update({
    visual_text: visualText,
    visual_text_status: 'done'
  }).eq('id', post_id)

  return new Response(JSON.stringify({ ok: true, visual_text: visualText }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
