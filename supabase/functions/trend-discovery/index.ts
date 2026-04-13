// Trend Discovery — scrapt kuratierte DACH-Fitness-Accounts nach viral performenden Posts
// Zielgruppe: Accounts die für Männer 30+, Kraft, Körperfett, Online-Coaching stehen
// Strategie: Pool von 30 Accounts, pro Run 8 zufällig auswählen → Rotation ohne DB-Abhängigkeit
// Ausschluss: Thomas' eigene Competitors (werden separat getrackt)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

// Kuratierter Pool: Fitness-Coaches + Lifestyle-Accounts für Männer 30+
// Fokus: DACH-Markt + internationale Accounts mit übertragbaren Inhalten
// KEIN Wettkampf/Bodybuilding/Steroid-Content
// Rotation: 8 zufällige pro Run → nach 4 Runs alle gesehen
const TREND_ACCOUNT_POOL = [
  // DACH Fitness-Coaches (Kraft + Körper + Lifestyle)
  'arnekindler',
  'philippjahns',
  'maximilian.goetz',
  'coach_frankklopper',
  'stefl.fitness',
  'nils.langemann',
  'david_kosmala',
  'the.bodybuilder.diet',
  'fitnesstrainer.luca',
  'jensjakob.fitness',

  // Internationale Coaches (übertragbare Inhalte, kein US-Bro-Culture)
  'jamessmithpt',       // UK — evidenzbasiert, Anti-Extreme, Männer 30+
  'drjohnrusin',        // Performance-orientiert, keine Wettkampf-Inhalte
  'syattfitness',       // Anti-Bullshit, Fakten, Männer
  'mindpumpsal',        // Podcast-Coach, 30+ Zielgruppe
  'jeffnippard',        // Wissenschaftlich, kein Wettkampf-Fokus
  'bradschoenfeld',     // Wissenschaft Muskelaufbau
  'drhenrytihenry',     // Performance + Lifestyle
  'hubermanlab',        // Wissenschaft, Life Performance, 30+ Zielgruppe
  'laynebiorton',       // Faktenbasiert, Anti-Hype
  'drchristinahibbert', // Mindset + Performance

  // Lifestyle + Effizienz (für Thomas' Zielgruppe: Unternehmer + Fitness)
  'chriswillx',         // High Performance, Männer 30+
  'maxlugavere',        // Longevity + Performance
  'peterattiamd',       // Longevity, 35+ Zielgruppe
  'andrewdgilmore',     // Biohacking + Effizienz
  'timsuper',           // Lifestyle + Fitness

  // Weitere bewährte Accounts
  'coachkyledobbs',
  'tommycreason',
  'coachkevmarr',
  'thomasadler_fitness',
  'marksmellybell',
]

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Competitor-Handles laden → vom Trend-Scrape ausschließen
  const compRes = await fetch(
    `${SUPABASE_URL}/rest/v1/competitor_profiles?select=username&is_active=eq.true`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const competitors: any[] = await compRes.json()
  const knownHandles = new Set((competitors || []).map((c: any) => c.username.toLowerCase()))

  // Thomas' eigene Profile auch ausschließen
  const ownRes = await fetch(
    `${SUPABASE_URL}/rest/v1/own_profile?select=username`,
    { headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY } }
  )
  const ownProfiles: any[] = await ownRes.json()
  for (const p of ownProfiles) knownHandles.add(p.username?.toLowerCase() || '')

  // Pool filtern + 8 zufällig auswählen
  const available = TREND_ACCOUNT_POOL.filter(u => !knownHandles.has(u.toLowerCase()))
  const selected = pickRandom(available, Math.min(8, available.length))
  const directUrls = selected.map(u => `https://www.instagram.com/${u}/`)

  if (selected.length === 0) {
    return new Response(JSON.stringify({ error: 'Keine verfügbaren Trend-Accounts' }), {
      status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Scrape-Job anlegen
  const jobRes = await fetch(`${SUPABASE_URL}/rest/v1/scrape_jobs`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({
      job_type: 'trend_discovery',
      target: selected.join(','),
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

  // Apify Webhook-Config
  const webhooksParam = btoa(JSON.stringify([{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
    requestUrl: `${SUPABASE_URL}/functions/v1/trend-webhook`,
    headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
    payloadTemplate: `{"job_id":"${job.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
  }]))

  // instagram-scraper — bewährt, 100% funktionsfähig für Account-URLs
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}&webhooks=${webhooksParam}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls,
        resultsType: 'posts',
        resultsLimit: 15,   // 15 Posts × 8 Accounts = max 120 Kandidaten
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
    accounts: selected,
    message: `Trend Discovery — ${selected.length} Accounts: ${selected.join(', ')}`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
