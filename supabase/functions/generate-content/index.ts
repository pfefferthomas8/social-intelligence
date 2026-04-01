const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const DASHBOARD_TOKEN = Deno.env.get('DASHBOARD_TOKEN') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
// Modell zentral über Secret steuerbar — Update: Supabase Secret CLAUDE_MODEL ändern
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

const FORMAT_INSTRUCTIONS: Record<string, string> = {
  video_script: `Erstelle ein vollständiges Video-Script mit:
- HOOK (erste 3 Sekunden — stoppt den Scroll)
- INTRO (Warum das Thema relevant ist, 10-15 Sek)
- HAUPTTEIL (3-5 klare Punkte/Argumente)
- OUTRO & CTA (was der Zuschauer jetzt tun soll)
Markiere jeden Abschnitt klar. Schreibe so wie man spricht, keine Fachsprache.`,

  carousel: `Erstelle einen Karussel-Post mit:
- SLIDE 1: Hook-Überschrift (max 8 Wörter, neugierig machend)
- SLIDE 2-7: Je eine klare Aussage/Tipp pro Slide (kurz, prägnant)
- SLIDE 8 (FINAL): CTA — was soll der Leser jetzt tun?
Format: "SLIDE 1: [Text]" usw.`,

  single_post: `Erstelle eine starke Instagram-Caption mit:
- Erster Satz: Hook der zum Lesen zwingt (Frage, Provokation oder Zahl)
- 2-3 Absätze: Kernaussage, persönliche Perspektive, Mehrwert
- CTA am Ende: einfach, direkt, eine Handlung
- Max 300 Wörter. Kein Hashtag-Spam. Authentisch.`,

  b_roll: `Erstelle 4 verschiedene B-Roll Ideen für dasselbe Thema.

Ein B-Roll ist ein 7-Sekunden-Video das eine Person bei einer Tätigkeit zeigt (z.B. im Gym, beim Kochen, beim Aufwachen). Darauf liegt ein starkes Text-Overlay das die Aufmerksamkeit stoppt. Die Infos kommen in der Caption.

Für jede B-Roll Idee, gib EXAKT dieses Format aus:

B-ROLL [Nummer]:
SZENE: [Was ist zu sehen? 7 Sekunden. Konkret und visuell. Z.B. "Person zieht sich beim Aufwachen hoch und schaut in die Kamera"]
HOOK: [Haupttext-Overlay — max 6-7 Wörter, stoppt den Scroll, provoziert oder überrascht]
SUBHEADLINE: [Optionaler zweiter Text darunter — ergänzt den Hook, max 5 Wörter]
CAPTION: [Starke Caption für den Post: Hook-Satz der zum Lesen zwingt, dann 2-3 Absätze mit dem Mehrwert/Detail, dann ein klarer CTA. Ca. 150-200 Wörter.]

Regeln:
- HOOK muss ohne Kontext sofort verstanden werden und Neugier wecken
- SZENE muss realistisch filmbar sein — keine aufwändige Produktion
- CAPTION holt den eigentlichen Inhalt rein — Hook zieht die Aufmerksamkeit, Caption liefert den Wert
- Variiere die 4 Ideen: unterschiedliche Hooks (Frage, These, Zahl, Provokation) und Szenen`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { topic, content_type, additional_info } = await req.json()
  if (!topic || !content_type) {
    return new Response(JSON.stringify({ error: 'topic + content_type required' }), { status: 400, headers: CORS })
  }

  const [ownPosts, topCompPosts, customPosts, thomasDna] = await Promise.all([
    dbQuery('instagram_posts?select=caption,transcript,post_type,likes_count,views_count&source=eq.own&caption=not.is.null&order=views_count.desc&limit=30'),
    dbQuery('instagram_posts?select=caption,transcript,post_type,likes_count,views_count,competitor_profiles(username)&source=eq.competitor&order=views_count.desc&limit=15'),
    dbQuery('instagram_posts?select=caption,transcript,post_type&source=eq.custom&limit=10'),
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20')
  ])

  const SYSTEM_PROMPT_BASE = `Du bist der exklusive Ghost-Writer von Thomas Pfeffer, einem Fitness-Coach für Männer 30+ in der DACH-Region.

AUFGABE:
1. Analysiere Thomas' eigenen Schreibstil aus seinen Top-Posts
2. Extrahiere die psychologischen Prinzipien hinter viralen Competitor-Posts (NICHT die Worte — die dahinterstehende Idee)
3. Erstelle Content der sich zu 100% nach Thomas anfühlt, aber auf bewährten Viral-Prinzipien basiert

THOMAS' PROFIL:
- Zielgruppe: Männer 30+, wollen Muskeln aufbauen oder Fett verlieren
- Markt: DACH (Österreich, Deutschland, Schweiz)
- Kompetitor-Coaches sind meist englischsprachig und dem DACH-Markt 3-5 Jahre voraus
- Thomas' Content soll diese Erkenntnisse als ERSTER in den deutschsprachigen Raum bringen

WICHTIGE REGELN:
- Schreibe EXAKT wie Thomas — sein Rhythmus, seine Direktheit, seine Ausdrucksweise
- Englische Competitor-Posts NICHT übersetzen — das Prinzip dahinter auf Deutsch neu erfinden
- Kein Fitness-Coach-Klischee ("Du schaffst das!", "Believe in yourself") — Thomas ist direkt und faktenbasiert
- Formuliere so wie ein gut informierter Freund spricht, nicht wie ein Verkäufer
- Deutsche Sprache, außer gängige englische Fachbegriffe die Thomas selbst nutzt (z.B. "Gains", "Bulk", "Cut")`

  const styleAnalysis = ownPosts.length > 0
    ? `THOMAS' SCHREIBSTIL (aus seinen ${ownPosts.length} Top-Posts nach Engagement):
${ownPosts.slice(0, 10).map((p: any, i: number) => {
  const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
  return `[Post ${i+1} | ${(p.views_count || 0).toLocaleString()} Views]\n${text}`
}).join('\n\n')}`
    : 'Thomas hat noch keine eigenen Posts gescrapt. Schreibe in einem direkten, faktenbasierten Stil für einen österreichischen Fitness-Coach.'

  const viralPrinciples = topCompPosts.length > 0
    ? `ERFOLGREICHE COMPETITOR-POSTS — ANALYSIERE DAS ZUGRUNDELIEGENDE PRINZIP:
${topCompPosts.slice(0, 10).map((p: any) => {
  const username = p.competitor_profiles?.username || 'unknown'
  const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
  return `@${username} | ${(p.views_count || 0).toLocaleString()} Views:\n"${text}"`
}).join('\n\n')}`
    : ''

  const customContext = customPosts
    .map((p: any) => clean([p.caption, p.transcript].filter(Boolean).join(' | ')))
    .filter(Boolean).join('\n---\n').substring(0, 1500)

  // Thomas DNA — akkumuliertes Wissen über seinen Stil und sein Publikum
  // Wächst mit jedem Scrape automatisch. Das ist das Herzstück des lernenden Systems.
  const dnaContext = thomasDna.length > 0
    ? `THOMAS' DNA — GELERNTE ERKENNTNISSE (Confidence-gewichtet, höchste zuerst):
${thomasDna.map((d: any) => {
  const categoryLabel: Record<string, string> = {
    hook_pattern: '🎯 HOOK-MUSTER',
    style_rule: '✍️ STIL-REGEL',
    pillar_insight: '📊 SÄULEN-INSIGHT',
    audience_pattern: '👥 PUBLIKUM',
    competitor_gap: '🚀 LÜCKE',
    growth_opportunity: '💡 CHANCE'
  }
  return `${categoryLabel[d.category] || d.category} [${d.confidence}% Konfidenz]: ${d.insight}`
}).join('\n\n')}

WICHTIG: Diese DNA ist aus echten Performance-Daten destilliert. Halte dich strikt daran — sie macht den Unterschied zwischen generischem Content und echtem Thomas-Content.`
    : ''

  const systemPrompt = [SYSTEM_PROMPT_BASE, dnaContext, styleAnalysis, viralPrinciples,
    customContext ? `ZUSÄTZLICHE REFERENZ-INHALTE:\n${customContext}` : ''
  ].filter(Boolean).join('\n\n---\n\n')

  const userPrompt = `Erstelle jetzt diesen Content:

THEMA: ${topic}
FORMAT: ${content_type.replace('_', ' ').toUpperCase()}
${additional_info ? `ZUSATZINFO: ${additional_info}` : ''}

SCHRITT 1: Welche viralen Prinzipien aus den Competitor-Posts passen zu diesem Thema?
SCHRITT 2: Wie würde Thomas dieses Thema mit seinem Stil behandeln?
SCHRITT 3: Erstelle den finalen Content:

${FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}

Gib NUR den fertigen Content aus (kein "Schritt 1/2/3" im Output, keine Meta-Kommentare).`

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, messages: [{ role: 'user', content: userPrompt }], system: systemPrompt })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: CORS })
  }

  const claudeData = await claudeRes.json()
  const content = claudeData.content?.[0]?.text
  if (!content) return new Response(JSON.stringify({ error: 'Leere Antwort von Claude.' }), { status: 500, headers: CORS })

  // Content-Säule klassifizieren (Haiku — günstig, schnell)
  let content_pillar: string | null = null
  try {
    const pillarRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 5,
        messages: [{ role: 'user', content: `Thema: "${topic}". Kategorie (nur ein Wort): haltung | transformation | mehrwert | verkauf` }]
      })
    })
    const pd = await pillarRes.json()
    const raw = (pd.content?.[0]?.text || '').toLowerCase().trim()
    if (['haltung', 'transformation', 'mehrwert', 'verkauf'].includes(raw)) content_pillar = raw
  } catch { /* ignorieren */ }

  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/generated_content`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ topic, content_type, content, content_pillar })
  })
  const saved = await saveRes.json()
  const savedItem = Array.isArray(saved) ? saved[0] : saved

  return new Response(JSON.stringify({ content, id: savedItem?.id, content_pillar }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
