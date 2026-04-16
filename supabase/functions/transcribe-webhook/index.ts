// AssemblyAI ruft diese Function auf wenn Transkription fertig ist.
// WICHTIG: AssemblyAI sendet NUR {transcript_id, status} im Webhook — KEIN text!
// Wir müssen den Transcript separat von der AssemblyAI API holen.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ASSEMBLYAI_KEY = Deno.env.get('ASSEMBLYAI_API_KEY') || ''

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
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
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
  // AssemblyAI sendet: { transcript_id: "...", status: "completed" | "error" }
  // KEIN text im Payload — muss separat abgerufen werden
  const { transcript_id, status } = payload

  console.log(`Webhook für post ${post_id}: status=${status}, transcript_id=${transcript_id}`)

  // Post laden um storage_video_path zu kennen
  const postRes = await fetch(
    `${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}&select=storage_video_path&limit=1`,
    { headers: dbHeaders() }
  )
  const posts: any[] = await postRes.json().catch(() => [])
  const storagePath = posts?.[0]?.storage_video_path

  if (status === 'completed' && transcript_id) {
    // Transcript von AssemblyAI API holen
    let transcriptText = ''
    try {
      const transcriptRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcript_id}`, {
        headers: { 'Authorization': ASSEMBLYAI_KEY }
      })
      if (transcriptRes.ok) {
        const data = await transcriptRes.json()
        transcriptText = data.text || ''
        console.log(`Transcript abgerufen für ${post_id}: ${transcriptText.substring(0, 80)}...`)
      } else {
        console.error(`AssemblyAI API Fehler: ${transcriptRes.status}`)
      }
    } catch (e) {
      console.error('Transcript-Abruf fehlgeschlagen:', String(e))
    }

    // Transcript in DB speichern — auch wenn text leer (z.B. stilles Video)
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({
        transcript: transcriptText || null,
        transcript_status: 'done',
        storage_video_path: null
      })
    })
    if (storagePath) await deleteFromStorage(storagePath)

  } else if (status === 'error') {
    console.error(`AssemblyAI Fehler für post ${post_id}`)
    await fetch(`${SUPABASE_URL}/rest/v1/instagram_posts?id=eq.${post_id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({ transcript_status: 'error', storage_video_path: null })
    })
    if (storagePath) await deleteFromStorage(storagePath)

  } else {
    // Unbekannter Status — loggen aber ok zurückgeben
    console.warn(`Unbekannter Status für post ${post_id}: ${status}`)
  }

  return new Response('ok', { status: 200 })
})
