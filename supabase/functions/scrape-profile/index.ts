const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
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

// Actor-Reihenfolge: 1→2→3→4 (sequenziell, Fallback im Webhook)
function buildActorCall(actorNum: number, username: string): { actor: string; input: Record<string, unknown> } | null {
  const proxyConfig = { useApifyProxy: true }
  const profileUrl = `https://www.instagram.com/${username}/`
  const hasCookies = IG_COOKIES.length > 0
  const cookiesParam = hasCookies ? { cookies: IG_COOKIES } : {}
  const loginCookiesParam = hasCookies ? { loginCookies: IG_COOKIES } : {}

  switch (actorNum) {
    case 1: return {
      actor: 'apify~instagram-profile-scraper',
      input: { usernames: [username], resultsLimit: 100, proxyConfiguration: proxyConfig, ...loginCookiesParam }
    }
    case 2: return {
      actor: 'apify~instagram-scraper',
      input: { directUrls: [profileUrl], resultsType: 'posts', resultsLimit: 100, proxyConfiguration: proxyConfig, loginRequired: true, ...cookiesParam }
    }
    case 3: return {
      actor: 'apify~instagram-api-scraper',
      input: { startUrls: [{ url: profileUrl }], resultsLimit: 100, proxyConfiguration: proxyConfig, ...cookiesParam }
    }
    case 4: return {
      actor: 'instagram-scraper~fast-instagram-post-scraper',
      input: { username, resultsLimit: 100, proxyConfiguration: proxyConfig, ...cookiesParam }
    }
    default: return null
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
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: webhookUrl,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // Sequenziell: Actor 1 starten. Falls nicht startbar → Actor 2, usw.
  // Async-Fallback (Actor läuft, liefert aber leeres Dataset) → scrape-webhook übernimmt
  let runId: string | null = null
  let startedActorNum = 0

  for (let actorNum = 1; actorNum <= 4; actorNum++) {
    const call = buildActorCall(actorNum, username)
    if (!call) break
    runId = await startRun(call.actor, call.input, webhooksParam)
    if (runId) {
      startedActorNum = actorNum
      console.log(`Actor ${actorNum} (${call.actor}) gestartet: ${runId}`)
      break
    }
    console.log(`Actor ${actorNum} konnte nicht gestartet werden, versuche nächsten...`)
  }

  if (!runId) {
    await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
      method: 'PATCH',
      headers: dbHeaders(),
      body: JSON.stringify({ status: 'error', error_msg: 'Alle Actors konnten nicht gestartet werden' })
    })
    return new Response(JSON.stringify({ error: 'Alle Apify-Actors fehlgeschlagen' }), { status: 502, headers: CORS })
  }

  // error_msg speichert: welcher Actor als nächstes bei Fallback dran ist + bereits gestartete Run-IDs
  // scrape-webhook liest "fallback:N" um zu wissen welchen Actor er als nächstes starten soll
  const nextFallback = startedActorNum < 4 ? startedActorNum + 1 : null
  const errorMsg = nextFallback ? `fallback:${nextFallback} ${runId}` : null

  await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs?id=eq.${job.id}`, {
    method: 'PATCH',
    headers: dbHeaders(),
    body: JSON.stringify({
      status: 'running',
      apify_run_id: runId,
      error_msg: errorMsg
    })
  })

  return new Response(JSON.stringify({
    job_id: job.id,
    run_id: runId,
    actor_num: startedActorNum,
    next_fallback: nextFallback,
    status: 'running',
    message: `Scraping @${username} gestartet (Actor ${startedActorNum}/4).`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
