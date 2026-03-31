import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== Deno.env.get('DASHBOARD_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { username, source, competitor_id } = await req.json()
  if (!username || !source) {
    return new Response(JSON.stringify({ error: 'username + source required' }), { status: 400, headers: CORS })
  }

  const APIFY_KEY = Deno.env.get('APIFY_API_KEY')!
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN')!

  // Job in DB anlegen
  const { data: job } = await supabase
    .from('scrape_jobs')
    .insert({
      job_type: source === 'own' ? 'own_profile' : 'competitor',
      target: username,
      status: 'pending'
    })
    .select('id')
    .single()

  // Webhook URL — Apify ruft diese auf wenn Run fertig ist (kein Frontend-Polling nötig)
  const webhookUrl = `${SUPABASE_URL}/functions/v1/scrape-webhook`

  // Apify Run starten mit Webhook
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        usernames: [username],
        resultsLimit: 100,
        webhooks: [{
          eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
          requestUrl: webhookUrl,
          headersTemplate: `{"Authorization":"Bearer ${DASHBOARD_TOKEN}"}`,
          payloadTemplate: `{"job_id":"${job!.id}","run_id":"{{resource.id}}","status":"{{eventType}}"}`
        }]
      })
    }
  )

  if (!apifyRes.ok) {
    const err = await apifyRes.text()
    await supabase.from('scrape_jobs').update({ status: 'error', error_msg: err }).eq('id', job!.id)
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), { status: 502, headers: CORS })
  }

  const apifyData = await apifyRes.json()
  const runId = apifyData.data?.id

  await supabase
    .from('scrape_jobs')
    .update({ status: 'running', apify_run_id: runId })
    .eq('id', job!.id)

  return new Response(JSON.stringify({
    job_id: job!.id,
    run_id: runId,
    status: 'running',
    message: `Scraping @${username} gestartet — läuft vollständig im Hintergrund.`
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
