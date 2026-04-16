// generate-dashboard-posts — 9 datengetriebene Content-Ideen: je 3 Haltung, Mehrwert, Transformation
// Themenfeld-Rotation pro Säule — garantiert Vielfalt und vollständige Säulen-Abdeckung

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

// ── Themenfelder nach Säule — je 10 pro Säule, insgesamt 30 ─────────────────
// Pro Session: 3 zufällige aus jeder Säule → 9 Posts total
const TOPIC_AREAS_BY_PILLAR: Record<string, Array<{id: string, label: string, desc: string}>> = {
  haltung: [
    { id: 'konsistenz',      label: 'Konsistenz & Identität',       desc: 'Warum Motivation eine Lüge ist — und welches System wirklich funktioniert' },
    { id: 'struktur',        label: 'Struktur schlägt Motivation',   desc: 'Warum Spontantraining nie zu Ergebnissen führt' },
    { id: 'selbstbild',      label: 'Männer & Körperbild',           desc: 'Warum Männer ihren Körper falsch einschätzen und was das mit Ergebnissen macht' },
    { id: 'genetik',         label: 'Genetik & Eigenverantwortung',  desc: 'Was du wirklich nicht ändern kannst — und was du als Ausrede benutzt' },
    { id: 'ziel_fehler',     label: 'Das falsche Ziel verfolgen',    desc: 'Warum die meisten Männer das falsche Körperziel haben' },
    { id: 'mindset_40',      label: 'Mindset ab 40',                 desc: 'Warum Männer ab 40 ein anderes Mindset brauchen als mit 25' },
    { id: 'social_life',     label: 'Fitness & Social Life',         desc: 'Restaurants, Alkohol, Reisen — ohne Rückschritt und ohne Obsession' },
    { id: 'coaching_vs_solo',label: 'Coaching vs. Solo-Training',    desc: 'Was du alleine immer falsch machst und warum die meisten auf der Stelle treten' },
    { id: 'disziplin',       label: 'Disziplin als System',          desc: 'Wie du Disziplin aufbaust ohne dich auf Willenskraft zu verlassen' },
    { id: 'warum_scheitern', label: 'Warum Diäten scheitern',        desc: 'Nicht mangelnde Disziplin — das ist der echte Grund' },
  ],
  mehrwert: [
    { id: 'schlaf',           label: 'Schlaf & Recovery',              desc: 'Wie Schlafqualität Körperzusammensetzung, Testosteron und Hunger direkt beeinflusst' },
    { id: 'protein_praxis',   label: 'Protein im Alltag',              desc: 'Wie viel wirklich nötig, wann, woher — für Berufstätige ohne Meal Prep Obsession' },
    { id: 'progressive_load', label: 'Progressive Overload',           desc: 'Das eine Prinzip das alle erfolgreichen Transformationen gemeinsam haben' },
    { id: 'trainingsfreq',    label: 'Trainingsfrequenz',              desc: 'Wie oft ist wirklich optimal — 3x oder 5x die Woche' },
    { id: 'supplements',      label: 'Supplements & Marketing',        desc: 'Was wissenschaftlich bewiesen wirkt vs. was die Industrie dir verkauft' },
    { id: 'mahlzeitentiming', label: 'Mahlzeitentiming',               desc: 'Wann du isst ist fast so wichtig wie was — Insulin, Wachstumshormon, Cortisol' },
    { id: 'kardio_wahrheit',  label: 'Kardio — die Wahrheit',          desc: 'Wann Kardio hilft, wann er Muskeln frisst und wann er Cortisol explodieren lässt' },
    { id: 'deload',           label: 'Deload & aktive Pause',          desc: 'Warum weniger Training in den richtigen Momenten mehr Ergebnis bringt' },
    { id: 'testosteron',      label: 'Testosteron & Lebensweise',      desc: 'Was du täglich tust das Testosteron sabotiert — ohne es zu wissen' },
    { id: 'wasser',           label: 'Hydration & Performance',        desc: 'Der am meisten unterschätzte Hebel für Energie, Kraft und Körperzusammensetzung' },
  ],
  transformation: [
    { id: 'koerperfett',      label: 'Körperfett & die Waage',         desc: 'Warum die Waage lügt und welche Metriken wirklich wichtig sind' },
    { id: 'kalorien_clever',  label: 'Kaloriendefizit ohne Hunger',    desc: 'Sättigung, Nahrungsdichte, Volumen — abnehmen ohne die ganze Zeit hungrig zu sein' },
    { id: 'transformation',   label: 'Transformation-Wahrheit',        desc: 'Was echte Transformationen wirklich kosten — und was Instagram-Fotos verschweigen' },
    { id: 'muskelaufbau_40',  label: 'Muskelaufbau ab 40',             desc: 'Was sich verändert (Testosteron, Recovery) und wie man es trotzdem nutzt' },
    { id: 'cortisol',         label: 'Stress & Bauchfett',             desc: 'Warum Bauchfett oft kein Trainingsproblem ist — chronischer Stress als Ursache' },
    { id: 'koerper_reset',    label: 'Neustart nach Pause',            desc: 'Was passiert wenn du 2-4 Wochen nicht trainierst und wie du schnell zurückkommst' },
    { id: 'schlank_vs_stark', label: 'Schlank vs. Stark',              desc: 'Warum der Unterschied dieser zwei Ziele Training und Ernährung komplett verändert' },
    { id: 'cheat_meal',       label: 'Cheat Meals & Refeed',           desc: 'Wann sie psychologisch und metabolisch sinnvoll sind — und wann sie alles zerstören' },
    { id: 'meal_prep',        label: 'Alltagsernährung simpel',        desc: '80/20 Ernährung für Berufstätige — ohne Obsession, mit echten Ergebnissen' },
    { id: 'mobilitaet',       label: 'Mobilität & Verletzungsprävention', desc: 'Was Männer ab 30 ignorieren bis der erste Schaden kommt' },
  ],
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  // Echter Zufall — Fisher-Yates
  const shuffle = <T>(arr: T[]): T[] => {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  // Alle Datenquellen parallel laden
  const [thomasDna, ownTopPosts, competitorPostsAll, trendPosts, externalSignals, topRated, recentlySuggested] = await Promise.all([
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,visual_text,views_count,likes_count,post_type&source=eq.own&order=views_count.desc&limit=15'),
    // Alle Posts laden — nicht nur Top — damit Themen breiter werden
    dbQuery('instagram_posts?select=caption,transcript,visual_text,views_count,post_type,content_pillar&source=eq.competitor&order=scraped_at.desc&limit=80'),
    dbQuery('trend_posts?select=username,caption,visual_text,viral_score,claude_notes,content_pillar,dach_gap,recommendation,views_count&order=viral_score.desc&limit=20'),
    dbQuery('external_signals?select=title,body,signal_type,source,relevance_score,claude_insight&relevance_score=gte.60&order=fetched_at.desc&limit=12'),
    dbQuery('generated_content?select=topic,content_type,content,content_pillar&user_rating=eq.1&order=created_at.desc&limit=5'),
    // Zuletzt vorgeschlagene Themenfelder (gespeichert im reason-Feld als "area_id|...")
    dbQuery('topic_suggestions?select=title,reason&order=created_at.desc&limit=60'),
  ])

  // ── Kürzlich verwendete Themenfelder extrahieren (aus reason-Feld: "area_id|...") ──
  const recentlyUsedAreaIds = new Set(
    recentlySuggested
      .map((r: any) => r.reason?.split('|')[0]?.trim())
      .filter(Boolean)
      .slice(0, 27) // Letzte 3 Sessions (9 Ideen × 3) sperren
  )

  // ── Pro Säule 3 zufällige Themenfelder auswählen — bevorzugt unbenutzte ──
  const pickThreeForPillar = (pillar: string) => {
    const all = TOPIC_AREAS_BY_PILLAR[pillar] || []
    const fresh = all.filter(a => !recentlyUsedAreaIds.has(a.id))
    const stale = all.filter(a => recentlyUsedAreaIds.has(a.id))
    const pool = fresh.length >= 3 ? fresh : [...fresh, ...stale]
    return shuffle(pool).slice(0, 3)
  }

  // Garantiert: 3 Haltung + 3 Mehrwert + 3 Transformation = 9 Posts
  const selectedByPillar = {
    haltung:        pickThreeForPillar('haltung'),
    mehrwert:       pickThreeForPillar('mehrwert'),
    transformation: pickThreeForPillar('transformation'),
  }
  // Alle 9 in Reihenfolge: Haltung → Mehrwert → Transformation
  const selectedAreas = [
    ...selectedByPillar.haltung,
    ...selectedByPillar.mehrwert,
    ...selectedByPillar.transformation,
  ]

  // DNA nach Kategorie
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // Competitor Posts: neueste + zufällig gemischt (nicht mehr nur nach Views sortiert)
  const competitorPosts = shuffle(competitorPostsAll).slice(0, 10)

  // Trend Posts: zufällig gemischt
  const selectedTrends = shuffle(trendPosts).slice(0, 8)

  // Datenblöcke aufbereiten
  const trendBlock = selectedTrends.length > 0
    ? selectedTrends.map((t: any, i: number) => {
        const text = clean([t.caption, t.visual_text].filter(Boolean).join(' | '))
        const dach = t.dach_gap ? ' [DACH-LÜCKE]' : ''
        return `T${i+1}: @${t.username} | Score ${Math.round(t.viral_score||0)}${dach}\n"${text}"\n→ ${t.claude_notes || ''}`
      }).join('\n\n')
    : 'Noch keine Trend-Daten'

  const ownBlock = ownTopPosts.length > 0
    ? shuffle(ownTopPosts).slice(0, 4).map((p: any, i: number) => {
        const text = clean([p.caption, p.visual_text].filter(Boolean).join(' | '))
        return `E${i+1}: [${(p.views_count||0).toLocaleString()} Views] "${text}"`
      }).join('\n\n')
    : ''

  const compBlock = competitorPosts.length > 0
    ? competitorPosts.map((p: any, i: number) => {
        const text = clean([p.caption, p.transcript, p.visual_text].filter(Boolean).join(' | '))
        return `C${i+1}: [${(p.views_count||0).toLocaleString()} Views] "${text}"`
      }).join('\n\n')
    : 'Keine Competitor-Posts'

  const signalBlock = externalSignals.length > 0
    ? shuffle(externalSignals).slice(0, 5).map((s: any, i: number) => {
        return `S${i+1}: [${s.source?.toUpperCase()} · ${s.relevance_score}%] "${clean(s.title)}"\n→ ${s.claude_insight || ''}`
      }).join('\n\n')
    : 'Keine Community-Signale'

  const ratedBlock = topRated.length > 0
    ? topRated.map((r: any) => `[${r.content_type}] "${r.topic}": ${clean(r.content).substring(0,100)}…`).join('\n')
    : ''

  // ── Die 9 Themenfelder für Claude aufbereiten — mit Säulen-Zuweisung ────
  const PILLAR_LABELS: Record<string, string> = {
    haltung: 'HALTUNG', mehrwert: 'MEHRWERT', transformation: 'TRANSFORMATION'
  }
  const pillarOrder = ['haltung', 'haltung', 'haltung', 'mehrwert', 'mehrwert', 'mehrwert', 'transformation', 'transformation', 'transformation']
  const topicAreasBlock = selectedAreas.map((a, i) => {
    const pillar = pillarOrder[i]
    return `THEMA ${i+1} [SÄULE: ${PILLAR_LABELS[pillar]}]: ${a.label}\n  → ${a.desc}`
  }).join('\n\n')

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

  const userPrompt = `Erstelle genau 9 Content-Ideen für Thomas — EINE pro Themenfeld, exakt in dieser Reihenfolge.

PFLICHT:
• Themen 1-3 bekommen pillar: "haltung"
• Themen 4-6 bekommen pillar: "mehrwert"
• Themen 7-9 bekommen pillar: "transformation"
Kein Themenfeld überspringen. Keine eigene Themenwahl. Die Säulen-Zuweisung ist fix.

${topicAreasBlock}

VERFÜGBARE DATEN (Inspiration für Winkel, Trigger, Quellenangaben):

[TREND-POSTS]
${trendBlock}

[COMPETITOR POSTS]
${compBlock}

${ownBlock ? `[THOMAS' EIGENE POSTS]\n${ownBlock}\n` : ''}
[COMMUNITY-SIGNALE]
${signalBlock}

Antworte NUR mit diesem JSON-Array — 9 Objekte in der exakten Reihenfolge der Themenfelder, kein anderer Text:
[{"hook":"max 10 Wörter auf Deutsch","format":"video_script","pillar":"haltung","preview":"2 Sätze Kern-Aussage","score":87,"sources":[{"ref":"T3","label":"@username · 2.1M Views"}],"why_it_works":"1 Satz warum das für Thomas' Zielgruppe funktioniert"}]

format: video_script | b_roll | single_post | carousel
pillar: haltung | mehrwert | transformation (wie oben zugewiesen — NICHT ändern)
score: 1-100 (Viral-Potenzial für DACH Männer 30+)
sources: max 2 aus den obigen Daten
KEIN Text außerhalb des JSON-Arrays.`

  const claudeBody = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 3500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  })

  let raw = ''
  let lastErr = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 8000 : 20000))

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
    let errType = ''
    try { errType = JSON.parse(errText)?.error?.type || '' } catch { /* */ }
    if (errType !== 'overloaded_error' && res.status !== 529) {
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

  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let posts: any[] = []
  try {
    const match = cleaned.match(/\[[\s\S]*\]/)
    if (match) posts = JSON.parse(match[0])
  } catch {
    return new Response(JSON.stringify({ error: 'Parse error', raw: raw.substring(0, 300) }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }

  // ── Verwendete Themenfelder in topic_suggestions speichern ───────────────
  // reason-Format: "area_id|why_it_works text" → wird beim nächsten Aufruf gelesen
  if (posts.length > 0) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/topic_suggestions`, {
        method: 'POST',
        headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
        body: JSON.stringify(posts.map((p: any, i: number) => {
          const area = selectedAreas[i]
          return {
            title: p.hook,
            reason: `${area?.id || 'unknown'}|${p.why_it_works || p.preview || ''}`,
            category: p.pillar === 'haltung' ? 'personal' : p.pillar === 'transformation' ? 'gap' : 'trending',
            potential_views: p.score ? `Score ${p.score}` : null,
            suggested_types: p.format ? [p.format] : [],
            used: false,
          }
        }))
      })
    } catch { /* Nicht kritisch */ }
  }

  return new Response(JSON.stringify({ posts, generated_at: new Date().toISOString() }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
