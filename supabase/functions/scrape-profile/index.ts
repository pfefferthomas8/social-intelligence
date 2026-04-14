const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''

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

  const body = await req.json()
  const source = body.source
  const competitor_id = body.competitor_id
  // Leerzeichen + Sonderzeichen entfernen — verhindert kaputte Apify-URLs
  const username = (body.username || '').trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase()
  if (!username || !source) {
    return new Response(JSON.stringify({ error: 'username + source required' }), { status: 400, headers: CORS })
  }

  // Job in DB anlegen
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      job_type: source === 'own' ? 'own_profile' : 'competitor',
      target: username,
      status: 'pending'
    })
  })
  const jobData = await jobRes.json()
  const job = Array.isArray(jobData) ? jobData[0] : jobData
  if (!job?.id) {
    return new Response(JSON.stringify({ error: 'Job konnte nicht angelegt werden' }), { status: 500, headers: CORS })
  }

  const webhookUrl = `${SUPABASE_URL}/functions/v1/scrape-webhook`

  // Webhooks als Base64 URL-Parameter — NICHT im Body (wird dort als Actor-Input ignoriert)
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: webhookUrl,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // Apify Run starten — instagram-profile-scraper ist stabiler für Profil+Posts (~3-8 Min)
  // instagram-scraper mit directUrls+resultsType:'posts' schlägt seit April 2026 für Einzelprofile fehl
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: [username],
        resultsLimit: 50,
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL']
        }
      })
    }
  )

  if (!apifyRes.ok) {
    const err = await apifyRes.text()
    await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({ status: 'error', error_msg: err })
    })
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), { status: 502, headers: CORS })
  }

  const apifyData = await apifyRes.json()
  const runId = apifyData.data?.id

  await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({ status: 'running', apify_run_id: runId })
  })

  return new Response(JSON.stringify({
    job_id: job.id,
    run_id: runId,
    status: 'running',
    message: `Scraping @${username} gestartet.`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
