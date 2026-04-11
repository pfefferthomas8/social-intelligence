// Auto-Scrape Orchestrator — wird von GitHub Actions täglich aufgerufen
// Modi: "own" | "competitors" | "trends"
// Liest aktive Profiles aus DB und delegiert an bestehende Edge Functions

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

async function callFunction(name: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${DASHBOARD_TOKEN}`,
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  let data: unknown
  try { data = JSON.parse(text) } catch { data = text }
  return { ok: res.ok, data }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { mode } = await req.json().catch(() => ({ mode: 'own' }))

  const results: Record<string, unknown> = { mode, timestamp: new Date().toISOString() }

  try {
    if (mode === 'own') {
      // Eigenes Profil aus DB holen
      const res = await fetch(`${SUPABASE_URL}/rest/v1/own_profile?limit=1`, { headers: dbHeaders() })
      const data = await res.json()
      const profile = Array.isArray(data) ? data[0] : null
      if (!profile?.username) {
        return new Response(JSON.stringify({ error: 'Kein eigenes Profil konfiguriert' }), { status: 400, headers: CORS })
      }
      const r = await callFunction('scrape-profile', { username: profile.username, source: 'own' })
      results.own = r.data

    } else if (mode === 'competitors') {
      // Alle aktiven Competitors holen
      const res = await fetch(`${SUPABASE_URL}/rest/v1/competitor_profiles?is_active=eq.true&select=username,last_scraped_at`, {
        headers: dbHeaders()
      })
      const competitors = await res.json()
      if (!Array.isArray(competitors) || competitors.length === 0) {
        return new Response(JSON.stringify({ message: 'Keine aktiven Competitors', scraped: 0 }), { headers: CORS })
      }

      // Rotation: Nur Competitors die seit >20h nicht gescrapt wurden
      const cutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
      const due = competitors.filter((c: any) => !c.last_scraped_at || c.last_scraped_at < cutoff)

      // Max 3 pro Lauf — verhindert zu hohen Apify-Verbrauch
      const toScrape = due.slice(0, 3)
      const scraped = []

      for (const c of toScrape) {
        const r = await callFunction('scrape-profile', { username: c.username, source: 'competitor' })
        scraped.push({ username: c.username, ok: r.ok, result: r.data })
        // Kurze Pause zwischen Scrapes
        await new Promise(resolve => setTimeout(resolve, 2000))
      }

      results.competitors = { total: competitors.length, due: due.length, scraped }

    } else if (mode === 'trends') {
      // Trend Discovery starten (weekly)
      const r = await callFunction('trend-discovery', {})
      results.trends = r.data

    } else {
      return new Response(JSON.stringify({ error: `Unbekannter Modus: ${mode}` }), { status: 400, headers: CORS })
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('auto-scrape error:', msg)
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: CORS })
  }
})
