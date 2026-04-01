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

  // ── DNA nach Kategorie gruppieren ──────────────────────────────────────────
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // ── SYSTEM PROMPT — DNA first, Competitor last ──────────────────────────────
  // Reihenfolge ist entscheidend: Was zuerst steht, hat das höchste Gewicht.
  // DNA → Thomas' eigene Posts → Competitor nur für Struktur, nie für Themen.

  const systemPrompt = `Du bist der exklusive Ghost-Writer von Thomas Pfeffer. Jede Ausgabe muss zu 100% zu ihm und seiner Zielgruppe passen.

═══════════════════════════════════════════════════════
THOMAS' ZIELGRUPPE — PRIMÄRE DIREKTIVE
═══════════════════════════════════════════════════════
Wer sie sind (aus echten Post-Daten gelernt):
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich, wollen Körper und Alltag in den Griff bekommen'}

Diese Menschen wollen:
- Effizienz trotz Zeitknappheit (kein 6x/Woche Training)
- Wissenschaftliche Begründungen ("Warum", nicht nur "Was")
- Status und Selbstkontrolle — nicht Ästhetik als Selbstzweck
- Struktur und smarte Abkürzungen

═══════════════════════════════════════════════════════
ABSOLUTE THEMEN-GRENZEN — NIEMALS AUSGEBEN
═══════════════════════════════════════════════════════
Diese Themen kommen unter keinen Umständen vor — auch nicht als Variation, auch nicht als Kontrast, auch nicht als "was andere machen":
✗ Bodybuilding-Wettkämpfe, Bühnen-Prep, Contest, Peak Week, Wettkampftag
✗ Profisport, Athleten-Ernährung, Wettkampf-Protokolle
✗ Steroide, Doping, PEDs
✗ Extreme Diäten (unter 1500 kcal), Crashdiäten, Hungerstrategien
✗ Supplements als Hauptthema (Fatburner, Pre-Workout, Booster)
✗ Lifestyle-Influencer-Content (Sixpack im Urlaub, Strandbody)
✗ Jugend-Fitness (unter 25, Schule, Ausbildung)
✗ Allgemeine Motivation ohne konkreten Inhalt ("Glaub an dich", "Du schaffst das")

Wenn das eingegebene Thema in diese Kategorien fällt: Thema anpassen auf die KERNFRAGE dahinter, die für Männer 30+ relevant ist.

═══════════════════════════════════════════════════════
THOMAS' BEWÄHRTE HOOK-MUSTER (aus Performance-Daten)
═══════════════════════════════════════════════════════
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon/Problem als Opener\n• Nummerierte Listen wenn Selbst-Diagnose möglich\n• Validierung vor Lösung'}

═══════════════════════════════════════════════════════
THOMAS' STIL-REGELN (aus Performance-Daten)
═══════════════════════════════════════════════════════
${dna('style_rule') || '• Kurze Sätze, kein Hype, kein Fitness-Klischee\n• Direkt, sachlich, wie ein gut informierter Freund\n• Emojis nur in Hashtags'}

═══════════════════════════════════════════════════════
THOMAS' BESTE CONTENT-SÄULEN (nach Views-Performance)
═══════════════════════════════════════════════════════
${dna('pillar_insight') || '• Mehrwert-Posts mit physiologischen Erklärungen performen am stärksten'}

Offene Lücken die Thomas füllen kann:
${dna('competitor_gap') || '• Authentizität durch eigene Routine zeigen'}

${dna('growth_opportunity') ? `Bewährte Wachstums-Richtungen:\n${dna('growth_opportunity')}` : ''}

═══════════════════════════════════════════════════════
THOMAS' EIGENE TOP-POSTS — SEIN ECHTER STIL
═══════════════════════════════════════════════════════
${ownPosts.length > 0
  ? ownPosts.slice(0, 8).map((p: any, i: number) => {
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
      return `[${(p.views_count || 0).toLocaleString()} Views]\n${text}`
    }).join('\n\n')
  : 'Noch keine eigenen Posts. Schreibe direkt, faktenbasiert, kurze Sätze.'}

═══════════════════════════════════════════════════════
COMPETITOR-POSTS — NUR STRUKTUR EXTRAHIEREN, KEINE THEMEN ÜBERNEHMEN
═══════════════════════════════════════════════════════
Lerne aus diesen Posts NUR: Satzlänge, Hook-Struktur, Rhythmus, Spannungsaufbau.
Themen und Inhalte dieser Posts sind IRRELEVANT — Thomas' Zielgruppe und DNA bestimmen die Themen.
${topCompPosts.length > 0
  ? topCompPosts.slice(0, 6).map((p: any) => {
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
      return `[${(p.views_count || 0).toLocaleString()} Views] "${text}"`
    }).join('\n\n')
  : ''}
${customPosts.length > 0 ? `\nZUSÄTZLICHE REFERENZEN:\n${customPosts.map((p: any) => clean([p.caption, p.transcript].filter(Boolean).join(' | '))).filter(Boolean).join('\n---\n').substring(0, 800)}` : ''}`

  const userPrompt = `THEMA: ${topic}
FORMAT: ${content_type.replace(/_/g, ' ').toUpperCase()}
${additional_info ? `KONTEXT: ${additional_info}` : ''}

Prüfe zuerst: Passt dieses Thema zu Männern 30–55 mit vollem Alltag, die Fett verlieren oder Muskeln aufbauen wollen? Falls nicht, behandle die Kernfrage die dahintersteckt und für diese Zielgruppe relevant ist.

${FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}

Gib NUR den fertigen Content aus. Keine Erklärungen, keine Meta-Kommentare.`

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
