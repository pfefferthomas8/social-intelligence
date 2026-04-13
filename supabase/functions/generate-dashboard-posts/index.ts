// generate-dashboard-posts — 12 datengetriebene Content-Ideen auf Knopfdruck
// Lädt alle Datenquellen und lässt Claude 12 Ideen mit Quellenangabe generieren

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }
}

async function dbQuery(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function clean(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 400)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  // Alle Datenquellen parallel laden
  const [thomasDna, ownTopPosts, competitorPosts, trendPosts, externalSignals, topRated] = await Promise.all([
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,views_count,likes_count,post_type&source=eq.own&caption=not.is.null&order=views_count.desc&limit=10'),
    dbQuery('instagram_posts?select=caption,transcript,views_count,post_type,content_pillar&source=eq.competitor&order=views_count.desc&limit=15'),
    dbQuery('trend_posts?select=username,caption,visual_text,viral_score,claude_notes,content_pillar,dach_gap,recommendation,views_count&in=(recommendation,("sofort","beobachten"))&order=viral_score.desc&limit=12'),
    dbQuery('external_signals?select=title,body,signal_type,source,relevance_score,claude_insight&relevance_score=gte.70&order=fetched_at.desc&limit=8'),
    dbQuery('generated_content?select=topic,content_type,content,content_pillar&user_rating=eq.1&order=created_at.desc&limit=5'),
  ])

  // DNA nach Kategorie
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // Trend Posts aufbereiten
  const trendBlock = trendPosts.length > 0
    ? trendPosts.map((t: any, i: number) => {
        const text = clean([t.caption, t.visual_text].filter(Boolean).join(' | '))
        const dach = t.dach_gap ? ' [DACH-LÜCKE]' : ''
        return `T${i+1}: @${t.username} | ${(t.views_count||0).toLocaleString()} Views | Score ${Math.round(t.viral_score||0)} | ${t.content_pillar?.toUpperCase()||''}${dach}\n"${text}"\n→ ${t.claude_notes || ''}`
      }).join('\n\n')
    : 'Noch keine Trend-Daten'

  // Competitor Posts aufbereiten
  const compBlock = competitorPosts.length > 0
    ? competitorPosts.slice(0, 8).map((p: any, i: number) => {
        const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
        return `C${i+1}: [${(p.views_count||0).toLocaleString()} Views] ${p.post_type||'post'}: "${text}"`
      }).join('\n\n')
    : 'Keine Competitor-Posts'

  // Reddit/Community Signale
  const signalBlock = externalSignals.length > 0
    ? externalSignals.map((s: any, i: number) => {
        return `S${i+1}: [${s.source?.toUpperCase()} · ${s.signal_type?.replace(/_/g,' ')} · ${s.relevance_score}%]\n"${clean(s.title)}"\n${s.body ? clean(s.body).substring(0,120) : ''}\n→ ${s.claude_insight || ''}`
      }).join('\n\n')
    : 'Keine Community-Signale'

  // Top-rated Content
  const ratedBlock = topRated.length > 0
    ? topRated.map((r: any) => `[${r.content_type}] "${r.topic}": ${clean(r.content).substring(0,100)}…`).join('\n')
    : ''

  const systemPrompt = `Du bist die Content-KI die ausschließlich für Thomas Pfeffer arbeitet.

THOMAS' ZIELGRUPPE:
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich, wollen Muskeln aufbauen und Körperfett reduzieren'}
✗ KEIN Wettkampf/Bühnen-Content
✗ KEIN US-Lifestyle-Content (Zielmarkt: DACH)
✗ KEINE leeren Motivationssprüche

THOMAS' HOOK-FORMELN:
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Schockierende Realität'}

THOMAS' STIL:
${dna('style_rule') || '• Kurze Sätze\n• Sachlich, faktenbasiert\n• Keine Fachsprache'}

${ratedBlock ? `THOMAS' POSITIV-BEWERTETER CONTENT (Stilreferenz):\n${ratedBlock}` : ''}`

  const userPrompt = `Erstelle 12 fertige Content-Ideen für Thomas. Jede basiert auf den gegebenen Daten.

VERFÜGBARE DATEN:

[TREND-POSTS AUS INSTAGRAM]
${trendBlock}

[COMPETITOR-POSTS TOP VIEWS]
${compBlock}

[COMMUNITY-SIGNALE (REDDIT + SOCIAL)]
${signalBlock}

Gib EXAKT dieses JSON-Array zurück — 12 Objekte, kein anderer Text:
[
  {
    "hook": "Der erste Satz der den Scroll stoppt (max 12 Wörter, konkret, auf Deutsch)",
    "format": "video_script",
    "pillar": "mehrwert",
    "preview": "Die ersten 3-4 Sätze des Contents (auf Deutsch, Thomas' Stil, echte Substanz)",
    "score": 87,
    "sources": [
      {"ref": "T3", "label": "@username · 2.1M Views · DACH-Lücke"},
      {"ref": "S2", "label": "Reddit pain_point 91% · Männer klagen über Plateau"}
    ],
    "why_it_works": "1-2 Sätze: welcher psychologische Trigger + warum für Thomas' Zielgruppe"
  }
]

format: "video_script" | "b_roll" | "single_post" | "carousel"
pillar: "haltung" | "transformation" | "mehrwert" | "verkauf"
score: 1-100 (geschätzte Viral-Wahrscheinlichkeit für Thomas)
sources: max 3 Quellen — referenziere T1-T12 (Trends), C1-C8 (Competitors), S1-S8 (Signale)
Verteile gleichmäßig über alle 4 Säulen und alle 4 Formate.
NUR JSON — kein erklärender Text davor oder danach.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  const data = await res.json()
  const raw = data.content?.[0]?.text || ''

  let posts: any[] = []
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (match) posts = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'Parse error', raw: raw.substring(0, 500) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ posts, generated_at: new Date().toISOString() }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
