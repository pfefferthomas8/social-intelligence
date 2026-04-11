// Daily Brief — generiert 3 fertige Content-Ideen auf Knopfdruck
// 1× Video Script + 1× B-Roll + 1× Single Post
// Rotiert Content-Säule automatisch basierend auf Wochentag

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
  return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 300)
}

// Content-Säule basierend auf Wochentag rotieren
function getPillarForDay(): { pillar: string; label: string; color: string } {
  const day = new Date().getDay() // 0=So, 1=Mo, 2=Di, 3=Mi, 4=Do, 5=Fr, 6=Sa
  const rotation = [
    { pillar: 'haltung', label: 'Haltung & Mindset', color: '#ee4f00' },      // So
    { pillar: 'mehrwert', label: 'Mehrwert & Tipps', color: '#22c55e' },       // Mo
    { pillar: 'transformation', label: 'Transformation', color: '#3b82f6' }, // Di
    { pillar: 'verkauf', label: 'Coaching & Angebot', color: '#a855f7' },      // Mi
    { pillar: 'haltung', label: 'Haltung & Mindset', color: '#ee4f00' },      // Do
    { pillar: 'mehrwert', label: 'Mehrwert & Tipps', color: '#22c55e' },       // Fr
    { pillar: 'transformation', label: 'Transformation', color: '#3b82f6' }, // Sa
  ]
  return rotation[day]
}

async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  })
  if (!res.ok) throw new Error(`Claude error: ${await res.text()}`)
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { pillar: forcedPillar } = await req.json().catch(() => ({}))
  const pillarInfo = forcedPillar
    ? { pillar: forcedPillar, label: forcedPillar, color: '#ee4f00' }
    : getPillarForDay()

  // Alle Daten parallel laden
  const [ownPosts, topCompPosts, thomasDna, trendPosts, topicSuggestions] = await Promise.all([
    dbQuery('instagram_posts?select=caption,transcript,post_type,views_count&source=eq.own&caption=not.is.null&order=views_count.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,views_count&source=eq.competitor&order=views_count.desc&limit=15'),
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20'),
    dbQuery('trend_posts?select=caption,visual_text,username,viral_score,recommendation&in=(recommendation.sofort,recommendation.beobachten)&order=viral_score.desc&limit=8'),
    dbQuery(`topic_suggestions?select=title,reason,content_pillar&content_pillar=eq.${pillarInfo.pillar}&used=eq.false&order=created_at.desc&limit=3`),
  ])

  // DNA nach Kategorie
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // Kompakter Context für System-Prompt
  const ownContext = ownPosts.slice(0, 6).map((p: any) =>
    `[${(p.views_count || 0).toLocaleString()} Views] ${clean([p.caption, p.transcript].filter(Boolean).join(' | '))}`
  ).join('\n')

  const compContext = topCompPosts.slice(0, 8).map((p: any) =>
    `[${(p.views_count || 0).toLocaleString()} Views] ${clean([p.caption, p.transcript].filter(Boolean).join(' | '))}`
  ).join('\n')

  const trendContext = trendPosts.map((t: any) =>
    `@${t.username} [Score ${Math.round(t.viral_score || 0)}]: ${clean([t.caption, t.visual_text].filter(Boolean).join(' | '))}`
  ).join('\n')

  // Thema: aus Vorschlägen nehmen oder generisch aus Säule
  const suggestionText = topicSuggestions.length > 0
    ? topicSuggestions[0].title
    : `${pillarInfo.label} — passend zu Thomas' Zielgruppe`

  const systemPrompt = `Du bist die KI-Instanz die ausschließlich für Thomas Pfeffer arbeitet — Fitness-Coach, DACH-Markt, Männer 30+.

[ZIELGRUPPE]
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich, wollen Effizienz bei Training und Ernährung'}
✗ Kein Wettkampf/Contest/Bühnen-Content — das ist nicht ihre Welt
✗ Keine Profisport-Extreme — smarte Lösungen, nicht Hardcore

[HOOK-FORMELN AUS PERFORMANCE-DATEN]
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Nummerierte Selbst-Diagnose'}

[THOMAS' STIL-DNA]
${dna('style_rule') || '• Kurze Sätze als Stilmittel\n• Sachlich, kein Hype\n• Fakten statt Motivation'}

[THOMAS' EIGENE POSTS — REFERENZ-STIL]
${ownContext || 'Noch keine Posts verfügbar.'}

[VIRALE COMPETITOR-POSTS — NUR TRIGGER VERWENDEN, NICHT THEMEN]
${compContext || 'Keine Competitor-Daten.'}

[AKTUELLE TREND-SIGNALE]
${trendContext || 'Keine Trend-Daten.'}

[HEUTIGE CONTENT-SÄULE: ${pillarInfo.label.toUpperCase()}]
Alle 3 Formate heute zu dieser Säule erstellen.`

  const userPrompt = `Erstelle heute's Daily Brief für Thomas — 3 fertige Content-Ideen zur Säule "${pillarInfo.label}".

Thema-Inspiration: "${suggestionText}"
(Du kannst dieses Thema nehmen oder ein besseres wählen wenn du eins erkennst — aber immer Säule ${pillarInfo.pillar} und Thomas' Zielgruppe)

Gib EXAKT dieses Format aus (keine Abweichungen):

=== VIDEO SCRIPT ===
THEMA: [Das konkrete Thema]
HOOK: [Erste 3 Sekunden — stoppt den Scroll]
INTRO: [Warum das relevant ist, 10-15 Sek]
HAUPTTEIL:
• [Punkt 1]
• [Punkt 2]
• [Punkt 3]
OUTRO: [CTA — was der Zuschauer jetzt tun soll]

=== B-ROLL ===
THEMA: [Das konkrete Thema]
SZENE: [Was ist zu sehen? 7 Sekunden, konkret filmbar]
HOOK: [Haupttext-Overlay — max 6-7 Wörter, stoppt den Scroll]
SUBHEADLINE: [Zweiter Text, max 5 Wörter]
CAPTION: [Starke Caption: Hook-Satz + 2-3 Absätze + CTA, ~150 Wörter]

=== SINGLE POST ===
THEMA: [Das konkrete Thema]
CAPTION: [Vollständige Caption: starker erster Satz, 2-3 Absätze, CTA, max 280 Wörter]

Gib NUR den Content aus — keine Meta-Kommentare.`

  const rawContent = await callClaude(systemPrompt, userPrompt)

  // Parsen
  function extractSection(text: string, marker: string): string {
    const regex = new RegExp(`===\\s*${marker}\\s*===([\\s\\S]*?)(?===\\s|$)`, 'i')
    const m = text.match(regex)
    return m ? m[1].trim() : ''
  }

  const videoScript = extractSection(rawContent, 'VIDEO SCRIPT')
  const bRoll = extractSection(rawContent, 'B-ROLL')
  const singlePost = extractSection(rawContent, 'SINGLE POST')

  // In DB speichern
  const extractThema = (section: string) => {
    const m = section.match(/^THEMA:\s*(.+)/m)
    return m ? m[1].trim() : suggestionText
  }

  const savePromises = [
    videoScript && fetch(`${SUPABASE_URL}/rest/v1/generated_content`, {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({
        topic: extractThema(videoScript),
        content_type: 'video_script',
        content: videoScript,
        content_pillar: pillarInfo.pillar,
        source: 'daily_brief'
      })
    }),
    bRoll && fetch(`${SUPABASE_URL}/rest/v1/generated_content`, {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({
        topic: extractThema(bRoll),
        content_type: 'b_roll',
        content: bRoll,
        content_pillar: pillarInfo.pillar,
        source: 'daily_brief'
      })
    }),
    singlePost && fetch(`${SUPABASE_URL}/rest/v1/generated_content`, {
      method: 'POST',
      headers: dbHeaders(),
      body: JSON.stringify({
        topic: extractThema(singlePost),
        content_type: 'single_post',
        content: singlePost,
        content_pillar: pillarInfo.pillar,
        source: 'daily_brief'
      })
    }),
  ].filter(Boolean)

  await Promise.all(savePromises)

  return new Response(JSON.stringify({
    pillar: pillarInfo.pillar,
    pillar_label: pillarInfo.label,
    pillar_color: pillarInfo.color,
    video_script: videoScript,
    b_roll: bRoll,
    single_post: singlePost,
    raw: rawContent,
  }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
