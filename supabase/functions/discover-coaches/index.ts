// discover-coaches — findet neue Online Fitness Coaches für Männer auf Instagram
//
// Strategie: Scrape Posts aus Hashtags rund um Online Coaching für Männer.
// Aus jedem Post wird der Autor extrahiert und geprüft ob er passt:
//   - Follower >= 10.000
//   - Bio/Username enthält Coaching-Keywords
//   - Kein Wettkampf/Bodybuilding-Fokus
// Qualifizierende Accounts werden in discovered_coaches gespeichert.
//
// Läuft wöchentlich via GitHub Actions Cron.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const APIFY_KEY = Deno.env.get('APIFY_API_KEY') || ''

// Hashtags die Online Fitness Coaches für Männer posten
// Bewusst spezifisch gewählt: "online coach" + "men/männer" Kontext
const DISCOVERY_HASHTAGS = [
  'https://www.instagram.com/explore/tags/onlinefitnesscoachenformen/',
  'https://www.instagram.com/explore/tags/mensfitnesscoach/',
  'https://www.instagram.com/explore/tags/onlinecoachformen/',
  'https://www.instagram.com/explore/tags/fitnesscoachformen/',
  'https://www.instagram.com/explore/tags/mensphysiquecoach/',
  'https://www.instagram.com/explore/tags/onlinepersonaltrainer/',
  'https://www.instagram.com/explore/tags/fitnesscoachenformen/',
  'https://www.instagram.com/explore/tags/menscoach/',
  'https://www.instagram.com/explore/tags/strengthcoachformen/',
  'https://www.instagram.com/explore/tags/bodyrecomposition/',
]

// Keywords die auf einen Online Fitness Coach für Männer hinweisen (Bio/Username)
const COACH_KEYWORDS = [
  'coach', 'coaching', 'trainer', 'training', 'fitness', 'online', 'personal',
  'nutrition', 'strength', 'physique', 'body', 'transformation', 'muscle',
  'fat loss', 'weight loss', 'body recomp', 'coach for men', 'men coach',
]

// Ausschlusskriterien — Wettkampf/Bühne/Bodybuilding-Contest-Fokus
const EXCLUDE_KEYWORDS = [
  'bodybuilder', 'ifbb', 'npc', 'bikini', 'figure', 'physique competitor',
  'contest prep', 'stage', 'classic physique', 'mr olympia', 'powerlifting',
]

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation'
  }
}

function lc(s: unknown): string {
  return String(s || '').toLowerCase()
}

function isCoachAccount(username: string, bio: string, followers: number): boolean {
  if (followers < 10000) return false

  const combined = `${lc(username)} ${lc(bio)}`

  // Muss mindestens ein Coach-Keyword enthalten
  const hasCoachKeyword = COACH_KEYWORDS.some(kw => combined.includes(kw))
  if (!hasCoachKeyword) return false

  // Darf keinen Ausschluss-Keyword enthalten
  const hasExclude = EXCLUDE_KEYWORDS.some(kw => combined.includes(kw))
  if (hasExclude) return false

  return true
}

function pickRandom<T>(arr: T[], n: number): T[] {
  return [...arr].sort(() => Math.random() - 0.5).slice(0, n)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  // Bereits bekannte Accounts laden (Competitors + eigenes Profil + bereits entdeckte)
  const [compRes, ownRes, existingRes] = await Promise.all([
    fetch(`${SUPABASE_URL}/rest/v1/competitor_profiles?select=username`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/own_profile?select=username`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    }),
    fetch(`${SUPABASE_URL}/rest/v1/discovered_coaches?select=username`, {
      headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'apikey': SERVICE_KEY }
    }),
  ])

  const [competitors, ownProfiles, existing] = await Promise.all([
    compRes.json(), ownRes.json(), existingRes.json()
  ])

  const knownHandles = new Set([
    ...(competitors || []).map((c: any) => lc(c.username)),
    ...(ownProfiles || []).map((p: any) => lc(p.username)),
    ...(existing || []).map((e: any) => lc(e.username)),
  ])

  // 3 zufällige Hashtags für diesen Discovery-Run
  const selectedHashtags = pickRandom(DISCOVERY_HASHTAGS, 3)
  const hashtagLabels = selectedHashtags.map(u => u.split('/tags/')[1]?.replace('/', '') || u)

  // Apify: Posts von Hashtags scrapen — wir brauchen nur die Account-Infos der Autoren
  const apifyRes = await fetch(
    `https://api.apify.com/v2/acts/apify~instagram-scraper/runs?token=${APIFY_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        directUrls: selectedHashtags,
        resultsType: 'posts',
        resultsLimit: 25,   // 25 Posts × 3 Hashtags = 75 potenzielle Account-Quellen
        proxyConfiguration: {
          useApifyProxy: true,
          apifyProxyGroups: ['RESIDENTIAL']
        }
      })
    }
  )

  if (!apifyRes.ok) {
    const err = await apifyRes.text()
    return new Response(JSON.stringify({ error: 'Apify error: ' + err }), {
      status: 502, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  const apifyData = await apifyRes.json()
  const runId = apifyData.data?.id

  if (!runId) {
    return new Response(JSON.stringify({ error: 'Kein Run-ID von Apify' }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Warten bis Run fertig (max 3 Minuten — Discovery ist nicht zeitkritisch)
  let items: any[] = []
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 18000)) // 18s warten

    const statusRes = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_KEY}`
    )
    const statusData = await statusRes.json()
    const status = statusData.data?.status

    if (status === 'SUCCEEDED' || status === 'FINISHED') {
      // Dataset laden
      await new Promise(r => setTimeout(r, 5000)) // kurz warten damit Dataset geflushed
      const dataRes = await fetch(
        `https://api.apify.com/v2/actor-runs/${runId}/dataset/items?token=${APIFY_KEY}&limit=500`
      )
      const rawData = await dataRes.json()
      items = Array.isArray(rawData) ? rawData : []
      break
    }

    if (status === 'FAILED' || status === 'TIMED_OUT' || status === 'ABORTED') {
      return new Response(JSON.stringify({ error: `Apify Run ${status}` }), {
        status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }
  }

  if (items.length === 0) {
    return new Response(JSON.stringify({ ok: true, saved: 0, message: 'Keine Daten von Apify (Hashtag-Scraping möglicherweise geblockt)' }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Accounts aus Posts extrahieren + filtern
  const coachMap = new Map<string, any>()

  for (const post of items) {
    const username = lc(post.ownerUsername || '')
    if (!username || knownHandles.has(username) || coachMap.has(username)) continue

    const followers = Number(post.ownerFollowersCount) || 0
    const bio = String(post.ownerBiography || '')
    const fullName = String(post.ownerFullName || '')

    if (isCoachAccount(username, bio, followers)) {
      coachMap.set(username, {
        username,
        followers_count: followers,
        bio: bio.substring(0, 500),
        full_name: fullName.substring(0, 100),
        posts_count: Number(post.ownerPostsCount) || 0,
        discovery_source: hashtagLabels.join(','),
      })
    }
  }

  const toSave = Array.from(coachMap.values())

  if (toSave.length === 0) {
    return new Response(JSON.stringify({
      ok: true, saved: 0,
      checked: items.length,
      message: 'Keine neuen Coaches gefunden (alle bereits bekannt oder Kriterien nicht erfüllt)',
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  // Neue Coaches speichern (Upsert — username ist UNIQUE)
  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/discovered_coaches`, {
    method: 'POST',
    headers: {
      ...dbHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=minimal',
      'On-Conflict': 'username'
    },
    body: JSON.stringify(toSave)
  })

  return new Response(JSON.stringify({
    ok: true,
    saved: toSave.length,
    checked: items.length,
    hashtags: hashtagLabels,
    coaches: toSave.map((c: any) => `@${c.username} (${c.followers_count.toLocaleString()} Follower)`),
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
