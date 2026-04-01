// Apify Test — liest Dataset von letztem Run + probiert neue Inputs
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''

Deno.serve(async (req: Request) => {
  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response('Unauthorized', { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const mode = body.mode || 'fetch' // 'fetch' | 'run'
  const runId = body.run_id || 'yMdjOQ978TKfKMVzz'

  if (mode === 'fetch') {
    // Dataset vom letzten Run lesen
    const res = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=5`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const text = await res.text()
    let parsed: any = null
    try { parsed = JSON.parse(text) } catch {}

    return new Response(JSON.stringify({
      status: res.status,
      raw_length: text.length,
      raw_preview: text.substring(0, 2000),
      parsed_count: Array.isArray(parsed) ? parsed.length : null,
      first_item: Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : null,
    }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  if (mode === 'run') {
    // Neuen Run mit angepassten Parametern starten
    const actor = body.actor || 'easyapi~instagram-hashtag-scraper'
    const input = body.input || {
      hashtags: ['krafttraining'],
      maxResults: 5,
      resultsType: 'posts'
    }

    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    )
    const data = await res.json()
    return new Response(JSON.stringify({
      ok: res.ok,
      status: res.status,
      run_id: data?.data?.id,
      run_status: data?.data?.status,
      data
    }, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  // Actor-Info lesen
  if (mode === 'actor_info') {
    const actor = body.actor || 'easyapi~instagram-hashtag-scraper'
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}?token=${APIFY_KEY}`,
      { headers: { 'Content-Type': 'application/json' } }
    )
    const data = await res.json()
    return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ error: 'unknown mode' }), { status: 400 })
})
