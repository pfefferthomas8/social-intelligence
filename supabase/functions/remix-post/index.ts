// remix-post — Analysiert einen viralen Post und baut ihn für Thomas' Feed um
// Input: beliebiger Post (trend oder competitor)
// Output: Warum es funktioniert + Thomas-spezifische Version (Hook + Script + Caption)

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
    'Prefer': 'return=representation'
  }
}

async function dbQuery(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

function clean(text: unknown): string {
  if (!text) return ''
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 600)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const {
    caption,
    visual_text,
    username,
    views_count,
    likes_count,
    post_type,
    content_pillar,
    claude_notes,
    viral_score,
    source, // 'trend' | 'competitor'
    preferred_format, // 'video_script' | 'b_roll' | 'single_post' — optional
  } = await req.json()

  if (!caption && !visual_text) {
    return new Response(JSON.stringify({ error: 'caption oder visual_text erforderlich' }), { status: 400, headers: CORS })
  }

  // Thomas' DNA + eigene Top-Posts laden für Referenz
  const [thomasDna, ownPosts, externalSignals] = await Promise.all([
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=25'),
    dbQuery('instagram_posts?select=caption,transcript,views_count&source=eq.own&caption=not.is.null&order=views_count.desc&limit=10'),
    dbQuery('external_signals?select=title,body,signal_type,source,relevance_score&relevance_score=gte.70&order=fetched_at.desc&limit=10'),
  ])

  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  const ownRef = ownPosts.slice(0, 5).map((p: any) =>
    `[${(p.views_count || 0).toLocaleString()} Views] ${clean([p.caption, p.transcript].filter(Boolean).join(' | '))}`
  ).join('\n')

  const externalRef = externalSignals.length > 0
    ? externalSignals.map((s: any) => `[${s.source?.toUpperCase()} · ${s.signal_type}] ${clean(s.title)}: ${clean(s.body)?.substring(0, 150)}`).join('\n')
    : ''

  const originalText = clean([caption, visual_text].filter(Boolean).join(' | '))
  const viewsFormatted = views_count >= 1000000 ? `${(views_count / 1000000).toFixed(1)}M` : views_count >= 1000 ? `${(views_count / 1000).toFixed(0)}K` : String(views_count || 0)

  const systemPrompt = `Du bist die KI-Instanz die ausschließlich für Thomas Pfeffer arbeitet — Fitness-Coach, DACH-Markt, Männer 30+, Online Coaching.

[THOMAS' ZIELGRUPPE]
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich, wollen Effizienz bei Training und Ernährung ohne Extreme'}
✗ Kein Wettkampf/Contest/Bühnen-Content
✗ Keine Profisport-Extreme

[THOMAS' HOOK-FORMELN]
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Nummerierte Selbst-Diagnose'}

[THOMAS' STIL-DNA]
${dna('style_rule') || '• Kurze Sätze\n• Sachlich, kein Hype\n• Fakten statt leere Motivation'}

[THOMAS' EIGENE TOP-POSTS ALS STIL-REFERENZ]
${ownRef || 'Noch keine Posts verfügbar.'}

${externalRef ? `[AKTUELLE EXTERNE SIGNALE — WAS GERADE DISKUTIERT WIRD]
${externalRef}` : ''}`

  const format = preferred_format || (post_type === 'reel' ? 'video_script' : post_type === 'carousel' ? 'carousel' : 'single_post')

  const userPrompt = `Analysiere diesen ${source === 'trend' ? 'viral' : 'erfolgreichen Competitor'}-Post und erstelle eine Thomas-spezifische Version.

ORIGINAL POST:
Von: @${username || 'unknown'} | ${viewsFormatted} Views | Typ: ${post_type || 'reel'}${content_pillar ? ` | Säule: ${content_pillar}` : ''}
Text: "${originalText}"
${claude_notes ? `KI-Analyse: ${claude_notes}` : ''}

Gib EXAKT dieses Format aus:

WARUM ES FUNKTIONIERT:
[2-3 Sätze: Welcher psychologische Trigger steckt dahinter? Warum stoppt das die Zielgruppe? Konkret benennen — z.B. "SOZIALE ERLAUBNIS", "SCHOCKIERENDE REALITÄT", "UNTERSCHÄTZTER HEBEL". Dann erklären wie der Mechanismus funktioniert.]

THOMAS' VERSION — ${format.replace(/_/g, ' ').toUpperCase()}:
${format === 'video_script' ? `HOOK: [Erste 3 Sekunden — identischer psychologischer Trigger, aber Thomas' Welt + Stil]
INTRO: [10-15 Sek — warum das für Männer 30+ relevant ist]
HAUPTTEIL:
• [Punkt 1]
• [Punkt 2]
• [Punkt 3]
OUTRO & CTA: [Was soll der Zuschauer jetzt tun?]
CAPTION: [Caption für den Post, ~150 Wörter, starker Einstieg, CTA am Ende]` : ''}
${format === 'b_roll' ? `SZENE: [Was zeigt das Video, 7 Sekunden, konkret filmbar in Thomas' Umgebung]
HOOK: [Text-Overlay — max 6-7 Wörter, gleicher psychologischer Trigger wie Original]
SUBHEADLINE: [Zweiter Text, max 5 Wörter]
CAPTION: [Starke Caption: Hook + 2-3 Absätze + CTA, ~150 Wörter]` : ''}
${format === 'single_post' || format === 'carousel' ? `HOOK: [Erster Satz — gleicher Trigger wie Original, Thomas' Stil]
BODY:
[2-3 Absätze mit dem Kern-Mehrwert]
CTA: [Konkrete Handlung]
CAPTION KOMPLETT: [Alles am Stück, bereit zum Posten]` : ''}

Gib NUR diesen Output aus — keine Meta-Kommentare.`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })

  if (!res.ok) {
    const err = await res.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: CORS })
  }

  const data = await res.json()
  const raw = data.content?.[0]?.text || ''

  // Parse: WARUM ES FUNKTIONIERT + THOMAS' VERSION
  const whyMatch = raw.match(/WARUM ES FUNKTIONIERT:\n([\s\S]*?)(?=\nTHOMAS' VERSION|$)/i)
  const versionMatch = raw.match(/THOMAS' VERSION[^:]*:([\s\S]*?)$/i)

  const why = whyMatch ? whyMatch[1].trim() : ''
  const thomasVersion = versionMatch ? versionMatch[1].trim() : raw

  return new Response(JSON.stringify({
    why_it_works: why,
    thomas_version: thomasVersion,
    format,
    raw,
  }), { headers: { ...CORS, 'Content-Type': 'application/json' } })
})
