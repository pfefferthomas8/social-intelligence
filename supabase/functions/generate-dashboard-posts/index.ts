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

  // Rotation-Index: verhindert dass immer dieselben Posts genommen werden
  // Jeder Aufruf nimmt eine andere "Scheibe" aus den verfügbaren Posts
  const rotationSeed = Math.floor(Date.now() / 1000) // ändert sich jede Sekunde
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor((rotationSeed * (i + 1) * 2654435761) % (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  // Alle Datenquellen parallel laden — mehr Posts laden, dann rotierend auswählen
  const [thomasDna, ownTopPosts, competitorPostsAll, trendPosts, externalSignals, topRated, recentlyGenerated] = await Promise.all([
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,visual_text,views_count,likes_count,post_type&source=eq.own&order=views_count.desc&limit=15'),
    // Mehr laden → rotierend auswählen → jedes Mal andere Posts sichtbar für Claude
    dbQuery('instagram_posts?select=caption,transcript,visual_text,views_count,post_type,content_pillar&source=eq.competitor&views_count=gt.0&order=views_count.desc&limit=60'),
    dbQuery('trend_posts?select=username,caption,visual_text,viral_score,claude_notes,content_pillar,dach_gap,recommendation,views_count&order=viral_score.desc&limit=20'),
    dbQuery('external_signals?select=title,body,signal_type,source,relevance_score,claude_insight&relevance_score=gte.60&order=fetched_at.desc&limit=12'),
    dbQuery('generated_content?select=topic,content_type,content,content_pillar&user_rating=eq.1&order=created_at.desc&limit=5'),
    // Zuletzt generierte Hooks/Themen — damit Claude sie VERMEIDET
    dbQuery('generated_content?select=topic,hook&order=created_at.desc&limit=20'),
  ])

  // DNA nach Kategorie
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // Bereits generierte Themen/Hooks für Anti-Repetition
  const usedTopics = recentlyGenerated
    .map((r: any) => r.hook ? `"${r.hook}"` : `"${r.topic}"`)
    .filter(Boolean)
    .slice(0, 15)

  // Competitor Posts: shufflen und 10 auswählen → jedes Mal andere Auswahl
  const competitorPosts = shuffle(competitorPostsAll).slice(0, 10)

  // Trend Posts: shufflen und 10 nehmen
  const selectedTrends = shuffle(trendPosts).slice(0, 10)

  // Trend Posts aufbereiten
  const trendBlock = selectedTrends.length > 0
    ? selectedTrends.map((t: any, i: number) => {
        const text = clean([t.caption, t.visual_text].filter(Boolean).join(' | '))
        const dach = t.dach_gap ? ' [DACH-LÜCKE]' : ''
        return `T${i+1}: @${t.username} | ${(t.views_count||0).toLocaleString()} Views | Score ${Math.round(t.viral_score||0)} | ${t.content_pillar?.toUpperCase()||''}${dach}\n"${text}"\n→ ${t.claude_notes || ''}`
      }).join('\n\n')
    : 'Noch keine Trend-Daten'

  // Eigene Top Posts (Stilreferenz)
  const ownBlock = ownTopPosts.length > 0
    ? shuffle(ownTopPosts).slice(0, 5).map((p: any, i: number) => {
        const text = clean([p.caption, p.visual_text].filter(Boolean).join(' | '))
        return `E${i+1}: [${(p.views_count||0).toLocaleString()} Views] ${p.post_type||'post'}: "${text}"`
      }).join('\n\n')
    : ''

  // Competitor Posts aufbereiten
  const compBlock = competitorPosts.length > 0
    ? competitorPosts.map((p: any, i: number) => {
        const text = clean([p.caption, p.transcript, p.visual_text].filter(Boolean).join(' | '))
        return `C${i+1}: [${(p.views_count||0).toLocaleString()} Views] ${p.post_type||'post'}: "${text}"`
      }).join('\n\n')
    : 'Keine Competitor-Posts'

  // Reddit/Community Signale
  const signalBlock = externalSignals.length > 0
    ? shuffle(externalSignals).slice(0, 6).map((s: any, i: number) => {
        return `S${i+1}: [${s.source?.toUpperCase()} · ${s.signal_type?.replace(/_/g,' ')} · ${s.relevance_score}%]\n"${clean(s.title)}"\n${s.body ? clean(s.body).substring(0,120) : ''}\n→ ${s.claude_insight || ''}`
      }).join('\n\n')
    : 'Keine Community-Signale'

  // Top-rated Content (Stilreferenz)
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

  const avoidBlock = usedTopics.length > 0
    ? `\n⚠️ DIESE THEMEN/HOOKS WURDEN BEREITS GENERIERT — NICHT WIEDERVERWENDEN:\n${usedTopics.join('\n')}\nWähle komplett andere Themen, Winkel und Hooks.`
    : ''

  const userPrompt = `Erstelle 6 Content-Ideen für Thomas basierend auf den heutigen Daten.
${avoidBlock}

VERFÜGBARE DATEN:

[TREND-POSTS — Zufällige Auswahl aus aktuellem Pool]
${trendBlock}

[COMPETITOR TOP POSTS — Rotierend ausgewählt]
${compBlock}

${ownBlock ? `[THOMAS' EIGENE TOP POSTS]\n${ownBlock}\n` : ''}
[COMMUNITY-SIGNALE]
${signalBlock}

Antworte NUR mit diesem JSON-Array — 6 Objekte, kein anderer Text, keine Markdown-Blöcke:
[{"hook":"max 10 Wörter auf Deutsch","format":"video_script","pillar":"mehrwert","preview":"2 Sätze Kern-Aussage auf Deutsch","score":87,"sources":[{"ref":"T3","label":"@username · 2.1M Views"}],"why_it_works":"1 Satz Trigger + warum für Thomas"}]

format: video_script | b_roll | single_post | carousel
pillar: haltung | transformation | mehrwert | verkauf
score: 1-100
sources: max 2 — T1-T10 (Trends), C1-C10 (Competitors), S1-S6 (Signale)
Verteile über alle 4 Säulen. Jede Idee braucht einen ANDEREN Winkel und Hook. KEIN Text außerhalb des JSON-Arrays.`

  // Claude-Call mit Retry bei Overloaded (max 3 Versuche, exponentielles Backoff)
  const claudeBody = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  })

  let raw = ''
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      const delay = attempt === 1 ? 8000 : 20000  // 8s, dann 20s
      await new Promise(r => setTimeout(r, delay))
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: claudeBody
    })

    if (res.ok) {
      const data = await res.json()
      raw = data.content?.[0]?.text || ''
      break
    }

    const errText = await res.text()
    lastErr = errText

    // Nur bei Overloaded oder 529 retry — bei anderen Fehlern sofort abbrechen
    let errType = ''
    try { errType = JSON.parse(errText)?.error?.type || '' } catch { /* */ }
    if (errType !== 'overloaded_error' && res.status !== 529 && res.status !== 529) {
      return new Response(JSON.stringify({ error: 'Claude error: ' + errText }), {
        status: 502, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }
  }

  if (!raw) {
    return new Response(JSON.stringify({ error: 'Claude überlastet. Bitte in 1-2 Minuten nochmal versuchen.', detail: lastErr }), {
      status: 503, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // Markdown-Code-Blöcke wegstreifen (```json ... ```)
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let posts: any[] = []
  try {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) posts = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'Parse error', raw: raw.substring(0, 300) }), { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ posts, generated_at: new Date().toISOString() }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
