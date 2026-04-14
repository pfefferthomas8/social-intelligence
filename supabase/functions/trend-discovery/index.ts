// Trend Discovery — scrapt Online Fitness Coaches für Männer nach viral performenden Posts
//
// Account-Pool kommt aus discovered_coaches Tabelle (dynamisch durch discover-coaches befüllt).
// Rotation: Accounts mit ältestem last_scraped_at kommen zuerst → jeder Run zeigt neue Gesichter.
// Mindest-Follower: 10.000 (in DB bereits gefiltert bei Discovery).
// Ausschluss: Thomas' eigene Competitors (werden separat getrackt).

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

  // Competitor-Handles laden → ausschließen
  const [compRes, ownRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/own_profile?select=username`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    }),
  ])

  const [competitors, ownProfiles] = await Promise.all([compRes.json(), ownRes.json()])
  const excludeHandles = new Set([
    ...(competitors || []).map((c: any) => c.username.toLowerCase()),
    ...(ownProfiles || []).map((p: any) => p.username?.toLowerCase() || ''),
  ])

  // Coaches aus DB laden: ≥10K Follower, älteste last_scraped_at zuerst (Rotation)
  const coachRes = await fetch(
    `${SUPABASE_URL}/rest/v1/discovered_coaches?is_active=eq.true&followers_count=gte.10000&select=username,followers_count&order=last_scraped_at.asc.nullsfirst&limit=20`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const allCoaches: any[] = await coachRes.json()

  if (!Array.isArray(allCoaches) || allCoaches.length === 0) {
    return new Response(JSON.stringify({
      error: 'Kein Coach-Pool vorhanden. Zuerst discover-coaches ausführen.',
      hint: 'POST /functions/v1/discover-coaches'
    }), { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Bekannte Handles ausfiltern + 8 auswählen
  const available = allCoaches.filter((c: any) => !excludeHandles.has(c.username.toLowerCase()))
  const selected = available.slice(0, 8) // Bereits nach oldest-first sortiert
  const usernames = selected.map((c: any) => c.username)
  const directUrls = usernames.map((u: string) => `https://www.instagram.com/${u}/`)

  if (selected.length === 0) {
    return new Response(JSON.stringify({ error: 'Keine verfügbaren Coaches nach Filterung' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Scrape-Job anlegen
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
    return new Response(JSON.stringify({ error: 'Job konnte nicht angelegt werden' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // last_scraped_at sofort aktualisieren → verhindert Doppelscrape bei parallelen Runs
  await Promise.all(usernames.map((u: string) =>
    fetch(`${SUPABASE_URL}/rest/v1/discovered_coaches?username=eq.${u}`, {
      method: 'PATCH',
      headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ last_scraped_at: new Date().toISOString() })
    })
  ))

  // Apify Webhook-Config
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/trend-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // instagram-profile-scraper — stabiler als instagram-scraper für Profil-Posts
  // instagram-scraper mit directUrls+resultsType:'posts' gibt leere Datasets seit April 2026
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames,
        resultsLimit: 15,
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
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
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
    pool_size: allCoaches.length,
    message: `Trend Discovery — ${usernames.length} Coaches aus Pool von ${allCoaches.length}: ${usernames.join(', ')}`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
