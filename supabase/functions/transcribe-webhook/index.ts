// AssemblyAI ruft diese Function auf wenn Transkription fertig ist.
// Speichert Transcript in DB und löscht Video aus Storage (temporärer Speicher).

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }
}

async function deleteFromStorage(storagePath: string) {
  try {
    await fetch(`${SUPABASE_URL}/storage/v1/object/instagram-videos/${storagePath}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}` }
    })
    console.log(`Storage gelöscht: ${storagePath}`)
  } catch (e) {
    console.error('Storage-Löschung fehlgeschlagen:', e)
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const post_id = url.searchParams.get('post_id')

  if (token !== DASHBOARD_TOKEN) return new Response('Unauthorized', { status: 401 })
  if (!post_id) return new Response('no post_id', { status: 400 })

  const payload = await req.json()
  const { status, text } = payload

  // Post laden um storage_video_path zu kennen
  const postRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}&select=storage_video_path&limit=1`,
    { headers: dbHeaders() }
  )
  const posts: any[] = await postRes.json().catch(() => [])
  const storagePath = posts?.[0]?.storage_video_path

  if (status === 'completed' && text) {
    // Transcript speichern
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({
        transcript: text,
        transcript_status: 'done',
        storage_video_path: null // Pfad aus DB löschen
      })
    })
    // Video aus Storage löschen (spart Platz)
    if (storagePath) await deleteFromStorage(storagePath)

  } else if (status === 'error') {
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({ transcript_status: 'error' })
    })
    // Video auch bei Fehler löschen
    if (storagePath) await deleteFromStorage(storagePath)
  }

  return new Response('ok', { status: 200 })
})
