// Trend Discovery — scrapt kuratierte Fitness-Accounts nach viral performenden Posts
// Nutzt denselben bewährten instagram-scraper wie Competitor-Scrapes (funktioniert 100%)
// Strategie: 8 Accounts pro Run, rotierend nach ältestem Scrape
// Webhook → trend-webhook → Viral Score + Claude-Analyse → trend_posts

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

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
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Competitor-Usernames laden → vom Trend-Scrape ausschließen (werden separat getrackt)
  const compRes = await fetch(
    `${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const competitors: any[] = await compRes.json()
  const knownHandles = new Set((competitors || []).map((c: any) => c.username.toLowerCase()))

  // Trend-Accounts laden — älteste Scrapes zuerst (Rotation)
  const accountsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/trend_accounts?is_active=eq.true&select=username,last_scraped_at&order=last_scraped_at.asc.nullsfirst&limit=12`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const accounts: any[] = await accountsRes.json()

  if (!Array.isArray(accounts) || accounts.length === 0) {
    return new Response(JSON.stringify({ error: 'Keine Trend-Accounts konfiguriert' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Bereits bekannte Competitors aus der Liste filtern
  const toScrape = accounts.filter((a: any) => !knownHandles.has(a.username.toLowerCase()))
  if (toScrape.length === 0) {
    return new Response(JSON.stringify({ error: 'Alle Accounts bereits als Competitors erfasst' }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const usernames = toScrape.map((a: any) => a.username)
  const directUrls = usernames.map((u: string) => `https://www.instagram.com/${u}/`)

  // Job anlegen
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      job_type: 'trend_discovery',
      target: usernames.join(','),
      status: 'pending',
    })
  })
  const jobData = await jobRes.json()
  const job = Array.isArray(jobData) ? jobData[0] : jobData
  if (!job?.id) {
    return new Response(JSON.stringify({ error: 'Job konnte nicht angelegt werden' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // last_scraped_at für alle Accounts sofort aktualisieren (verhindert Doppelscrape)
  await Promise.all(usernames.map((u: string) =>
    fetch(`${SUPABASE_URL}/rest/v1/trend_accounts?username=eq.${u}`, {
      method: 'PATCH',
      headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ last_scraped_at: new Date().toISOString() })
    })
  ))

  // Webhook-Config
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/trend-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // instagram-scraper — identisch mit scrape-profile (bewährt, funktioniert)
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'posts',
        resultsLimit: 15,   // 15 Posts pro Account × 12 Accounts = max 180 Kandidaten
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
      method: 'PATCH', headers: dbHeaders(),
      body: JSON.stringify({ status: 'error', error_msg: err })
    })
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const apifyData = await apifyRes.json()
  const runId = apifyData.data?.id

  await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
    method: 'PATCH', headers: dbHeaders(),
    body: JSON.stringify({ status: 'running', apify_run_id: runId })
  })

  return new Response(JSON.stringify({
    ok: true,
    job_id: job.id,
    run_id: runId,
    accounts: usernames,
    message: `Trend Discovery gestartet — ${usernames.length}/50 Accounts werden gescrapt: ${usernames.join(', ')}`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
