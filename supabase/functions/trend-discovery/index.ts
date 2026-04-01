// Trend Discovery — scrapet Fitness-Hashtags auf Instagram
// Kombiniert DE + EN Hashtags → findet viral gehende Posts von unbekannten Creators
// Wird wöchentlich getriggert + nach Ersteinrichtung manuell anstoßbar

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

// Hashtags — DE + EN Fitness, Männer 30+, Kraft, Körper, Mindset
const HASHTAGS = [
  // Deutsch
  'krafttraining', 'muskelaufbau', 'abnehmen', 'fitnessdeutschland',
  'maennerfitness', 'koerpertransformation', 'personaltrainer',
  'abnehmentipps', 'gesundleben', 'fitnesscoach',
  // Englisch (globale Trends, oft 3-5 Jahre voraus)
  'strengthtraining', 'musclebuilding', 'fatlosstips',
  'over30fitness', 'bodytransformation', 'fitover30', 'mensphysique',
  'personaltrainerlife', 'fitnessmotivation', 'musclegain',
]

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

  // Competitor-Usernames laden → vom Trend-Scrape ausschließen (die haben wir schon)
  const compRes = await fetch(
    `${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const competitors: any[] = await compRes.json()
  const knownHandles = new Set((competitors || []).map((c: any) => c.username.toLowerCase()))

  // Job anlegen
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      job_type: 'trend_discovery',
      target: `hashtags:${HASHTAGS.slice(0, 5).join(',')}`,
      status: 'pending',
      error_msg: JSON.stringify({ excluded_handles: [...knownHandles] })
    })
  })
  const jobData = await jobRes.json()
  const job = Array.isArray(jobData) ? jobData[0] : jobData
  if (!job?.id) {
    return new Response(JSON.stringify({ error: 'Job konnte nicht angelegt werden' }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Webhook-Config als Base64
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/trend-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // Apify Run starten
  // instagram-scraper mit searchType='hashtag' — derselbe bewährte Actor wie für Profile
  // Sucht nach top/recent Posts pro Hashtag — algorithmisch gerankt by Instagram
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        searchType: 'hashtag',
        searchQueries: HASHTAGS,     // Hashtag-Namen ohne #
        resultsLimit: 30,            // 30 Posts pro Hashtag = max 600 Kandidaten
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
    hashtags: HASHTAGS.length,
    message: `Trend Discovery gestartet — ${HASHTAGS.length} Hashtags werden gescrapt.`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
