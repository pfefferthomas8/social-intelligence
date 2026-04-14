const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
// Instagram Session-Cookie (optional) — wird als JSON-Array gespeichert
// Format: '[{"name":"sessionid","value":"...","domain":".instagram.com"},...]'
const IG_COOKIES_RAW = Deno.env.get('INSTAGRAM_SESSION_COOKIES') || ''
let IG_COOKIES: Record<string, unknown>[] = []
try { if (IG_COOKIES_RAW) IG_COOKIES = JSON.parse(IG_COOKIES_RAW) } catch { /* ignored */ }

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

async function startRun(actor: string, input: Record<string, unknown>, webhooksParam: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/${actor}/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input)
      }
    )
    if (!res.ok) {
      console.error(`${actor} start failed: ${res.status}`)
      return null
    }
    const data = await res.json()
    return data.data?.id || null
  } catch (e) {
    console.error(`${actor} error:`, e)
    return null
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

  // Beide Actors bekommen denselben Webhook → scrape-webhook nimmt wer zuerst Daten liefert
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: webhookUrl,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  const proxyConfig = { useApifyProxy: true }
  const profileUrl = `https://www.instagram.com/${username}/`

  // Cookies-Input wenn vorhanden → übergibt Instagram-Session an alle Actors
  const cookieInput = IG_COOKIES.length > 0 ? { loginCookies: IG_COOKIES } : {}

  // 4 Actors parallel — wer zuerst valide Posts liefert, gewinnt
  // scrape-webhook ignoriert alle weiteren Webhooks sobald result_count > 0
  // WICHTIG: loginCookies erforderlich seit Instagram Login-Wall (ab April 2026)
  const [runId1, runId2, runId3, runId4] = await Promise.all([
    // Actor 1: Instagram Profile Scraper (mit optional. Cookies)
    startRun('apify~instagram-profile-scraper', {
      usernames: [username],
      resultsLimit: 50,
      proxyConfiguration: proxyConfig,
      ...cookieInput
    }, webhooksParam),
    // Actor 2: Instagram Scraper (directUrls + posts mode, mit optional. Cookies)
    startRun('apify~instagram-scraper', {
      directUrls: [profileUrl],
      resultsType: 'posts',
      resultsLimit: 50,
      proxyConfiguration: proxyConfig,
      ...cookieInput
    }, webhooksParam),
    // Actor 3: Instagram API Scraper (7M Runs)
    startRun('apify~instagram-api-scraper', {
      startUrls: [{ url: profileUrl }],
      resultsLimit: 50,
      proxyConfiguration: proxyConfig,
      ...cookieInput
    }, webhooksParam),
    // Actor 4: Fast Instagram Post Scraper (178K+ Runs)
    startRun('instagram-scraper~fast-instagram-post-scraper', {
      username: username,
      resultsLimit: 50,
      proxyConfiguration: proxyConfig,
      ...cookieInput
    }, webhooksParam),
  ])

  const startedRuns = [runId1, runId2, runId3, runId4].filter(Boolean)
  if (startedRuns.length === 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({ status: 'error', error_msg: 'Beide Apify-Actors konnten nicht gestartet werden' })
    })
    return new Response(JSON.stringify({ error: 'Apify actors failed to start' }), { status: 502, headers: CORS })
  }

  await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({
      status: 'running',
      apify_run_id: startedRuns[0],
      // Beide Run-IDs im error_msg für Debugging
      error_msg: startedRuns.length > 1 ? `dual: ${startedRuns.join(', ')}` : null
    })
  })

  return new Response(JSON.stringify({
    job_id: job.id,
    run_ids: startedRuns,
    actors_started: startedRuns.length,
    status: 'running',
    message: `Scraping @${username} gestartet (${startedRuns.length} Actor${startedRuns.length > 1 ? 's' : ''}).`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
