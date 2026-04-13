// Trend Discovery — scrapt DACH-relevante Fitness-Hashtags nach viral performenden Posts
// Statt fester US-Accounts: DACH-Hashtags für Männer 30+ (krafttraining, muskelaufbau etc.)
// Strategie: 5 zufällige Hashtags pro Run aus Pool von 10 → variierende Perspektiven

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

// DACH Fitness Hashtags für Männer 30+
const DACH_HASHTAGS = [
  'https://www.instagram.com/explore/tags/krafttraining/',
  'https://www.instagram.com/explore/tags/muskelaufbau/',
  'https://www.instagram.com/explore/tags/abnehmen/',
  'https://www.instagram.com/explore/tags/intermittierendesfasten/',
  'https://www.instagram.com/explore/tags/onlinecoaching/',
  'https://www.instagram.com/explore/tags/personaltrainer/',
  'https://www.instagram.com/explore/tags/fitnessover40/',
  'https://www.instagram.com/explore/tags/ernaehrung/',
  'https://www.instagram.com/explore/tags/krafttraining40/',
  'https://www.instagram.com/explore/tags/fitnessueber40/',
]

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

// Zufällig n Elemente aus Array auswählen
function pickRandom<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // 5 zufällige Hashtags aus Pool wählen → jeder Run bringt andere Perspektiven
  const directUrls = pickRandom(DACH_HASHTAGS, 5)
  const hashtagLabels = directUrls.map(u => u.split('/tags/')[1]?.replace('/', '') || u)

  // Job anlegen
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      job_type: 'trend_discovery',
      target: hashtagLabels.join(','),
      status: 'pending',
    })
  })
  const jobData = await jobRes.json()
  const job = Array.isArray(jobData) ? jobData[0] : jobData
  if (!job?.id) {
    return new Response(JSON.stringify({ error: 'Job konnte nicht angelegt werden' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Webhook-Config
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/trend-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // instagram-scraper — identisch mit scrape-profile (bewährt, funktioniert)
  // Hashtag-URLs werden als directUrls übergeben — identisches Setup wie Account-Scraping
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'posts',
        resultsLimit: 20,   // 20 Posts pro Hashtag × 5 Hashtags = max 100 Kandidaten
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
    hashtags: hashtagLabels,
    message: `Trend Discovery gestartet — ${hashtagLabels.length} DACH-Hashtags werden gescrapt: ${hashtagLabels.join(', ')}`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
