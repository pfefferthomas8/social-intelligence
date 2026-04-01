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

  const [ownPosts, topCompPosts, customPosts, thomasDna, trendPosts] = await Promise.all([
    dbQuery('instagram_posts?select=caption,transcript,post_type,likes_count,views_count&source=eq.own&caption=not.is.null&order=views_count.desc&limit=30'),
    dbQuery('instagram_posts?select=caption,transcript,post_type,likes_count,views_count&source=eq.competitor&order=views_count.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,post_type&source=eq.custom&limit=10'),
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=20'),
    dbQuery('trend_posts?select=caption,visual_text,username,viral_score,recommendation&order=viral_score.desc&limit=10'),
  ])

  // ── DNA nach Kategorie gruppieren ──────────────────────────────────────────
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // ── Viral Trigger aus Competitor-Posts extrahieren ─────────────────────────
  // Jeder erfolgreiche Post hat einen psychologischen Trigger dahinter.
  // Diese Trigger sind universell — nur die Themen sind nicht übertragbar.
  const compTriggerMap: Record<string, string> = {
    'Bringing your own food': 'SOZIALE ERLAUBNIS — "Deine Disziplin ist nicht weird, sie ist Intelligenz"',
    'average': 'SCHOCKIERENDE REALITÄT — Statistik die zeigt wie weit der Durchschnitt hinten liegt',
    '1000 calor': 'EXTREMER BEWEIS — Ich zeige dir was möglich ist, wenn du es wirklich willst',
    'didn\'t feel like': 'AUTHENTIZITÄT — Ich tu es auch wenn ich keine Lust habe',
    'client': 'SOCIAL PROOF — Konkrete Transformation eines echten Menschen mit konkreten Zahlen',
    'sleep': 'UNTERSCHÄTZTER HEBEL — Das tust du jeden Tag, aber weißt nicht wie viel Potenzial darin steckt',
    'potato': 'ÜBERRASCHENDE WAHRHEIT — Was du für schlecht hältst ist eigentlich dein stärkster Verbündeter',
    'secret': 'EXKLUSIVES WISSEN — Das wissen die wenigsten, obwohl es offensichtlich ist',
    'nobody quits': 'RADIKALE KLARHEIT — Wer diesen Schritt macht, bereut ihn nie',
    'pov': 'REFRAMING — Es ist nicht Genetik. Es ist Entscheidung.',
  }

  const compWithTriggers = topCompPosts.slice(0, 10).map((p: any) => {
    const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
    const lc = text.toLowerCase()
    const matchedTrigger = Object.entries(compTriggerMap).find(([key]) => lc.includes(key.toLowerCase()))
    const trigger = matchedTrigger ? matchedTrigger[1] : 'MUSTER: Konkrete Aussage + Kontrast + Lösung'
    return `[${(p.views_count || 0).toLocaleString()} Views]\nTRIGGER: ${trigger}\nPOST: "${text}"`
  }).join('\n\n')

  // ── Trend-Signale aufbereiten ──────────────────────────────────────────────
  const trendSignals = trendPosts.length > 0
    ? trendPosts.map((t: any) => {
        const text = clean([t.caption, t.visual_text].filter(Boolean).join(' | '))
        return `@${t.username} [Score ${Math.round(t.viral_score || 0)}] ${t.recommendation?.toUpperCase() || ''}: "${text}"`
      }).join('\n')
    : ''

  // ── SYSTEM PROMPT ───────────────────────────────────────────────────────────
  const systemPrompt = `Du bist die KI-Instanz die ausschließlich für Thomas Pfeffer arbeitet — Fitness-Coach, DACH-Markt, Männer 30+.

Deine Aufgabe: Alle verfügbaren Datenpunkte synthetisieren und den perfekten Content erstellen.
Nicht einen Datenpunkt priorisieren — ALLE gleichzeitig aktivieren.

═══════════════════════════════════════════════════════
[1] THOMAS' ZIELGRUPPE — wer sie wirklich sind
═══════════════════════════════════════════════════════
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich, wollen Effizienz bei Training und Ernährung'}

Niemals für diese Zielgruppe erstellen:
✗ Wettkampf/Bühne/Contest-Content — das ist nicht ihre Welt
✗ Profisport-Inhalte — sie sind keine Athleten, sie sind Unternehmer mit Körper-Zielen
✗ Extreme Methoden — sie wollen smarte Abkürzungen, nicht Hardcore
✗ Supplement-Fokus — echte Lösungen, nicht Produkte
✗ Leere Motivation — Fakten und Mechanismen, nicht "Glaub an dich"

═══════════════════════════════════════════════════════
[2] THOMAS' BEWIESENE HOOK-FORMELN (aus Performance-Daten)
═══════════════════════════════════════════════════════
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Nummerierte Selbst-Diagnose'}

═══════════════════════════════════════════════════════
[3] THOMAS' STIL-DNA (aus Performance-Daten)
═══════════════════════════════════════════════════════
${dna('style_rule') || '• Kurze Sätze als Stilmittel\n• Negation + Wiederholung als Rhythmus\n• Sachlich, kein Hype'}

═══════════════════════════════════════════════════════
[4] CONTENT-STRATEGIE (was wirklich funktioniert)
═══════════════════════════════════════════════════════
${dna('pillar_insight') || '• Physiologische Erklärungen performen am stärksten'}

Lücken die noch unbesetzt sind:
${dna('competitor_gap') || '• Authentizität durch eigene Routine'}

Wachstums-Richtungen mit höchstem Potenzial:
${dna('growth_opportunity') || '• Kontroverse Eröffnungen mit Nuance in Satz 2-3'}

═══════════════════════════════════════════════════════
[5] THOMAS' EIGENE POSTS — REFERENZ FÜR SEINEN ECHTEN STIL
═══════════════════════════════════════════════════════
${ownPosts.length > 0
  ? ownPosts.slice(0, 8).map((p: any) => {
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
      return `[${(p.views_count || 0).toLocaleString()} Views] ${text}`
    }).join('\n\n')
  : 'Noch keine Posts verfügbar — schreibe direkt, faktenbasiert, kurze Sätze.'}

═══════════════════════════════════════════════════════
[6] VIRALE COMPETITOR-POSTS — PSYCHOLOGISCHE TRIGGER EXTRAHIEREN
═══════════════════════════════════════════════════════
WICHTIG: Nicht die Themen dieser Posts verwenden — den dahinterliegenden TRIGGER.
Jeder Trigger funktioniert auch in Thomas' Welt, wenn er mit Thomas' Themen + Stil kombiniert wird.

${compWithTriggers || 'Keine Competitor-Posts verfügbar.'}

${customPosts.length > 0
  ? `\nEIGENE REFERENZ-UPLOADS:\n${customPosts.map((p: any) => clean([p.caption, p.transcript].filter(Boolean).join(' | '))).filter(Boolean).join('\n---\n').substring(0, 800)}`
  : ''}

═══════════════════════════════════════════════════════
[7] AKTUELLE TREND-SIGNALE — WAS GERADE IM MARKT FUNKTIONIERT
═══════════════════════════════════════════════════════
${trendSignals || 'Noch keine Trend-Daten verfügbar.'}

═══════════════════════════════════════════════════════
SYNTHESE-PRINZIP
═══════════════════════════════════════════════════════
Für jeden Content-Output:
1. Wähle den stärksten TRIGGER aus [6] der zum Thema passt
2. Überprüfe ob ein Trend-Signal aus [7] das Thema verstärkt
3. Forme den Trigger durch Thomas' Hook-Formeln aus [2] und seinen Stil aus [3]
4. Stelle sicher dass es zu seiner Zielgruppe aus [1] passt
5. Das Ergebnis klingt nach Thomas — und schlägt wie ein viraler Post`

  const userPrompt = `THEMA: ${topic}
FORMAT: ${content_type.replace(/_/g, ' ').toUpperCase()}
${additional_info ? `ZUSATZINFO: ${additional_info}` : ''}

${FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}

Gib NUR den fertigen Content aus — keine Analyse, keine Erklärungen, keine Meta-Kommentare.`

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
