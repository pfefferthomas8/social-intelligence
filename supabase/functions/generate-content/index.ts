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

  carousel: `Erstelle einen Karussel-Post mit 7-9 Slides. Nur den reinen Text — keine Design-Tags, keine Layout-Labels.

PFLICHT-STRUKTUR:

SLIDE 1 — HOOK
Ein Problem oder Paradoxon das sofort triggert. Kurz. Kein Spoiler der Lösung.

SLIDE 2 — SECOND-CHANCE-SLIDE
Muss eigenständig funktionieren OHNE Slide 1 (Instagram zeigt sie als Preview). Eigener Cliffhanger der zu Slide 3 zieht.

SLIDES 3 bis (N-2) — INHALT
Je ein konkretes Insight. Texte können kurz (2-4 Wörter, großer Impact) oder länger (Erklärung, Tiefe) sein — je nach was die Slide braucht. Jede Slide endet offen — Frage oder Ellipse.

SLIDE (N-1) — AUFLÖSUNG
Der Payoff. Die Lösung oder Erkenntnis.

LETZTE SLIDE — CTA
Kurz, direkt, eine klare Handlung.

FORMAT:
SLIDE [Nummer]:
[Text]`,

  single_post: `Erstelle eine starke Instagram-Caption mit:
- Erster Satz: Hook der zum Lesen zwingt (Frage, Provokation oder Zahl)
- 2-3 Absätze: Kernaussage, persönliche Perspektive, Mehrwert
- CTA am Ende: einfach, direkt, eine Handlung
- Max 300 Wörter. Kein Hashtag-Spam. Authentisch.`,

  b_roll: `Erstelle 4 B-Roll Text-Overlays — jede mit einem anderen Hook-Schema.

B-Rolls: zufälliges Footage von mir (im Gym, gehen, trainieren). Der visuelle Inhalt ist EGAL.
Allein der Text-Overlay muss den Scroll stoppen und erzwingen, dass die Caption gelesen wird.
KEINE Szenenbeschreibung — die wähle ich selbst.

═══════════════════════════════════════════
ABSOLUT VERBOTEN — WIRD VOR AUSGABE GEPRÜFT:
═══════════════════════════════════════════
✗ KEINE erfundenen persönlichen Fakten über Thomas. "Ich hab X Jahre Y falsch gemacht" ist VERBOTEN wenn es nicht aus den Daten belegt ist. Thomas ist ein erfolgreicher, fitter Coach — Hooks die das Gegenteil implizieren zerstören seine Glaubwürdigkeit.
✗ KEINE Satzfragmente die grammatikalisch mehrdeutig sind. "Ich hab falsch gegessen. Und meinen Klienten auch." klingt als würde er Klienten essen. Jeder Satz muss für sich allein stehen und eindeutig verständlich sein.
✗ KEINE Verben die sich ungewollt auf das folgende Substantiv beziehen. Vor jedem Hook laut vorlesen und fragen: Kann dieser Satz falsch verstanden werden?
✗ KEIN Schema C (Geständnis) mit erfundenen Niederlagen — nur Aussagen die zu einem erfolgreichen Coach passen.

═══════════════════════════════════
5 HOOK-SCHEMATA — je eine pro B-Roll:
═══════════════════════════════════

[A] DIE THESE
Provokante Aussage, die 90% der Zuschauer für falsch halten werden.
Kurz. Brutal direkt. Keine Erklärung.
Stark: "Dein Training bringt dir nichts."
Stark: "Weniger Protein. Mehr Muskeln."
Schwach: "So trainierst du besser" (zu harmlos, kein Widerspruch)

[B] DAS PARADOX
Zwei Dinge die sich zu widersprechen scheinen — aber beide stimmen.
Erzeugt sofort Verwirrung → zwingt zum Stoppen.
Stark: "Mehr essen. Trotzdem abnehmen."
Stark: "Weniger trainieren. Schneller Ergebnisse."
Schwach: "Trainiere klüger, nicht härter" (Klischee, kein echter Widerspruch)

[C] DAS GESTÄNDNIS
Eine Einsicht oder Erkenntnis die Thomas als Coach gewonnen hat — kein erfundener persönlicher Fehler.
Darf keine Aussagen enthalten die seine Kompetenz oder seinen Körper infrage stellen.
Stark: "Der häufigste Fehler meiner Klienten."
Stark: "Was ich Männern über 35 immer sage."
Schwach: "Ich hab X Jahre falsch Y gemacht." (erfundene Niederlage — VERBOTEN)
GRAMMATIK-PFLICHT: Wenn zwei Sätze, muss der zweite Satz grammatikalisch vollständig sein — kein impliziertes Verb aus Satz 1.

[D] DER DIREKTANGRIFF
Direkt an den Zuschauer — trifft einen Nerv. Kein "man". Immer "du".
Stark: "Du machst Cardio. Das ist das Problem."
Stark: "Du trainierst hart. Du schläfst falsch."
Schwach: "Viele machen diesen Fehler" (zu distanziert, kein Treffer)

[E] DIE ZAHL
Überraschende, konkrete Zahl die sofort Glaubwürdigkeit und Neugier erzeugt.
Keine runden Zahlen (10, 100%) — die wirken gelogen.
Stark: "37% mehr Kraft. Kein einziges Extra-Set."
Stark: "9kg runter. Kein Cardio."
Schwach: "Doppelt so schnell Ergebnisse" (keine konkrete Zahl, kein Beweis)

═══════════════════════════════════
PFLICHT-REGELN:
═══════════════════════════════════
• HOOK: 5–18 Wörter. Thomas schreibt KEINE generisch kurzen 3-Wort-Hooks. Seine Stärke ist Spezifität. Siehe [10] für seinen echten Stil.
• GRAMMATIK: Jeden Hook laut vorlesen — klingt er seltsam oder doppeldeutig? Neu schreiben.
• SUBHEADLINE: optional, 3–8 Wörter, verstärkt den Sog ohne die Antwort zu geben. Oder "–".
• CAPTION: Erster Satz = Hook der nicht loslässt → 2-3 Absätze mit echtem Inhalt → klarer CTA. Ca. 150 Wörter.
• Jede der 4 B-Rolls nutzt ein ANDERES Schema (A, B, C, D oder E).

Gib EXAKT dieses Format aus:

B-ROLL [Nummer]:
SCHEMA: [A/B/C/D/E]
HOOK: [Text-Overlay, max 7 Wörter]
SUBHEADLINE: [3-5 Wörter — oder –]
CAPTION: [Volle Caption]`
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

  const [ownPosts, topCompPosts, customPosts, thomasDna, trendPosts, topRated, externalSignals, topRatedBroll] = await Promise.all([
    dbQuery('instagram_posts?select=caption,transcript,visual_text,post_type,likes_count,views_count&source=eq.own&order=views_count.desc&limit=30'),
    dbQuery('instagram_posts?select=caption,transcript,visual_text,post_type,likes_count,views_count&source=eq.competitor&order=views_count.desc&limit=20'),
    dbQuery('instagram_posts?select=caption,transcript,visual_text,post_type&source=eq.custom&limit=10'),
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=35'),
    dbQuery('trend_posts?select=caption,visual_text,username,viral_score,recommendation&order=viral_score.desc&limit=20'),
    dbQuery('generated_content?select=topic,content_type,content,content_pillar&user_rating=eq.1&order=created_at.desc&limit=8'),
    dbQuery('external_signals?select=title,body,signal_type,source,relevance_score,claude_insight&relevance_score=gte.70&order=fetched_at.desc&limit=10'),
    content_type === 'b_roll'
      ? dbQuery('generated_content?select=topic,content&user_rating=eq.1&content_type=eq.b_roll&order=created_at.desc&limit=5')
      : Promise.resolve([]),
  ])

  // ── DNA nach Kategorie gruppieren ──────────────────────────────────────────
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  // ── Viral Trigger aus Competitor-Posts extrahieren ─────────────────────────
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
        const parts: string[] = []
        // Visual text (Overlay-Text) separat hervorheben — das ist der eigentliche Hook-Text
        const vt = (t.visual_text || '').trim()
        if (vt && !vt.includes('@') && vt.length < 200) {
          parts.push(`OVERLAY: "${vt.split('\n').slice(0, 2).join(' / ')}"`)
        }
        if (t.caption) parts.push(`Caption: "${clean(t.caption).substring(0, 100)}"`)
        return `@${t.username} [Score ${Math.round(t.viral_score || 0)}]\n${parts.join('\n')}`
      }).join('\n\n')
    : ''

  // ── B-Roll spezifische Daten aufbereiten ─────────────────────────────────
  let brollSection = ''
  if (content_type === 'b_roll') {

    // Helper: ersten Satz extrahieren (bis . ! ? — max 120 Zeichen)
    const firstLine = (text: string) =>
      text.replace(/\n/g, ' ').match(/^.{10,120}?[.!?…]/)?.[0]?.trim()
      || text.replace(/\n/g, ' ').substring(0, 90).trim()

    // 1. Erste Sätze der Top-Competitor-Posts — das SIND B-Roll Hooks
    // Deduplizieren (gleiche Caption nur einmal), nur sinnvolle Hooks (kein Workout-Listing)
    const seenCaptions = new Set<string>()
    const competitorHooks = topCompPosts
      .filter((p: any) => {
        const text = (p.caption || p.transcript || '').trim()
        if (!text || text.length < 10) return false
        const key = text.substring(0, 50)
        if (seenCaptions.has(key)) return false
        seenCaptions.add(key)
        return true
      })
      .map((p: any) => {
        const text = (p.caption || p.transcript || '').replace(/\n/g, ' ').trim()
        const hook = firstLine(text)
        if (!hook || hook.length < 8) return null
        // Transcript-Opener als gesprochener Hook (falls verfügbar und anders als Caption)
        const trans = (p.transcript || '').replace(/\n/g, ' ').trim()
        const transHook = trans && trans.substring(0, 40) !== text.substring(0, 40) ? firstLine(trans) : null
        const lines = [`[${(p.views_count || 0).toLocaleString()} Views] CAPTION-HOOK: "${hook}"`]
        if (transHook && transHook.length > 8) lines.push(`  GESPROCHEN: "${transHook}"`)
        return lines.join('\n')
      })
      .filter(Boolean)
      .slice(0, 10)

    // 2. Saubere Text-Overlays aus viralen Reels (Trend Posts)
    const cleanVisualHooks = trendPosts
      .filter((t: any) => {
        const vt = (t.visual_text || '').trim()
        return vt.length >= 8 && vt.length <= 130
          && !vt.includes('@')
          && !/^\d+[A-Z.]/.test(vt)   // keine Übungslisten
          && vt.split('\n').length <= 4
      })
      .map((t: any) => {
        const lines = (t.visual_text as string).trim().split('\n')
          .map((l: string) => l.trim()).filter((l: string) => l && !l.includes('@'))
        const hookText = lines.slice(0, 2).join(' / ')
        return hookText.length >= 8
          ? `[Viral Score ${Math.round(t.viral_score || 0)}] "${hookText}"`
          : null
      })
      .filter(Boolean)
      .slice(0, 6)

    // 3. Thomas' eigene Caption-Einstiege aus Top Posts
    const ownHooks = ownPosts
      .filter((p: any) => (p.views_count || 0) > 0)
      .slice(0, 12)
      .map((p: any) => {
        const text = (p.caption || p.transcript || '').trim()
        const hook = firstLine(text)
        return hook && hook.length >= 10
          ? `[${(p.views_count || 0).toLocaleString()} Views] "${hook}"`
          : null
      })
      .filter(Boolean)
      .slice(0, 6)

    // 4. Positiv bewertete B-Roll Hooks
    const ratedHooks = (topRatedBroll as any[])
      .map((r: any) => {
        const m = r.content?.match(/HOOK:\s*(.+?)(?:\n|$)/i)
        return m ? `[Thomas: gut bewertet] "${m[1].trim()}" (Thema: ${r.topic})` : null
      })
      .filter(Boolean)

    // Thomas' eigene visual_text Hooks — das ist sein tatsächlicher Stil
    const ownVisualHooks = ownPosts
      .filter((p: any) => p.visual_text && p.visual_text.trim().length > 10)
      .map((p: any) => `[${(p.views_count || 0).toLocaleString()} Views] "${p.visual_text.trim().replace(/\n/g, ' ')}"`)
      .slice(0, 10)

    const parts: string[] = []

    // WICHTIGSTE QUELLE ZUERST: Thomas' echte Hooks aus seinen eigenen Reels
    if (ownVisualHooks.length > 0) {
      parts.push(`THOMAS' EIGENE REEL-HOOKS — DAS IST SEIN ECHTER STIL (nach Views sortiert):
Das sind die tatsächlichen Text-Overlays auf Thomas' eigenen Videos. Sein Stil ist erkennbar:
spezifisch, substanzreich, klare Aussage mit Mehrwert — NICHT generisch kurz.
Schreibe neue Hooks die sich genauso anfühlen wie diese hier.

${ownVisualHooks.join('\n')}`)
    }

    if (competitorHooks.length > 0) {
      parts.push(`COMPETITOR HOOKS (nach Views) — Muster erkennen, auf Deutsch adaptieren:
${competitorHooks.join('\n\n')}`)
    }

    if (cleanVisualHooks.length > 0) {
      parts.push(`WEITERE TEXT-OVERLAYS AUS VIRALEN REELS:
${cleanVisualHooks.join('\n')}`)
    }

    if (ratedHooks.length > 0) {
      parts.push(`THOMAS HAT DIESE B-ROLL HOOKS GUT BEWERTET:
${ratedHooks.join('\n')}`)
    }

    parts.push(`SCHEMA → KONKRETE HOOK-VORLAGE (Beispiele aus der DB):
[A] THESE      → "Bringing your own food isn't weird." (561k) | Thomas: "Würdest du 20 IQ gegen +20 kg Muskelmasse tauschen?"
[B] PARADOX    → "Didn't feel like it, but did it anyway." | Thomas: spezifische Aussage mit unerwartetem Kontrast
[C] COACH-INSIGHT → Thomas: "Das sage ich meinen Coaching Klienten, wenn sie trotz Training 6 Wochen das gleiche Gewicht sehen..."
[D] DIREKTANGRIFF → "Listen to this if you have 30 seconds." | Thomas: direkte Ansprache mit "du"
[E] ZAHL       → Thomas: "10 ungewöhnliche Zeichen, dass dein Körper Fett verbrennt" (23k Views)`)

    brollSection = `
═══════════════════════════════════════════════════════
[10] B-ROLL HOOKS — ECHTE VORBILDER AUS DER DATENBANK
═══════════════════════════════════════════════════════
${parts.join('\n\n')}`
  }

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
      const vt = p.visual_text ? `HOOK (Video-Text): "${p.visual_text.trim().replace(/\n/g, ' ')}"` : ''
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
      return `[${(p.views_count || 0).toLocaleString()} Views]\n${vt ? vt + '\n' : ''}Caption: ${text}`
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

${topRated.length > 0 ? `═══════════════════════════════════════════════════════
[8] THOMAS HAT DIESE OUTPUTS POSITIV BEWERTET — STIL BEIBEHALTEN
═══════════════════════════════════════════════════════
Das ist Feedback aus der Praxis — diese Art von Content hat Thomas als "gut" markiert.
Orientiere dich an Ton, Struktur und Stil dieser Beispiele:

${topRated.map((r: any) => {
  const preview = clean(r.content).substring(0, 200)
  return `[${r.content_type}${r.content_pillar ? ' · ' + r.content_pillar : ''}] Thema: "${r.topic}"\n"${preview}…"`
}).join('\n\n')}` : ''}

${externalSignals.length > 0 ? `═══════════════════════════════════════════════════════
[9] AKTUELLE COMMUNITY-SIGNALE (Reddit + Social) — WAS DIE ZIELGRUPPE GERADE BESCHÄFTIGT
═══════════════════════════════════════════════════════
Diese Themen werden in Fitness-Communities GERADE aktiv diskutiert — das sind echte Pain Points und Fragen der Zielgruppe.
Wenn das Thema des Nutzers damit zusammenhängt, nutze diese Insights um den Content relevanter zu machen.

${externalSignals.map((s: any) => {
  const type = s.signal_type?.replace(/_/g, ' ') || 'signal'
  const body = clean(s.body).substring(0, 150)
  const insight = s.claude_insight ? ` → ${s.claude_insight}` : ''
  return `[${s.source?.toUpperCase()} · ${type.toUpperCase()}] "${clean(s.title)}"${body ? `\n${body}` : ''}${insight}`
}).join('\n\n')}` : ''}
${brollSection}

═══════════════════════════════════════════════════════
SYNTHESE-PRINZIP
═══════════════════════════════════════════════════════
Für jeden Content-Output:
1. Wähle den stärksten TRIGGER aus [6] der zum Thema passt
2. Überprüfe ob ein Trend-Signal aus [7] das Thema verstärkt
3. Forme den Trigger durch Thomas' Hook-Formeln aus [2] und seinen Stil aus [3]
4. Stelle sicher dass es zu seiner Zielgruppe aus [1] passt
5. Das Ergebnis klingt nach Thomas — und schlägt wie ein viraler Post
${content_type === 'carousel' && dna('carousel_rule') ? `
═══════════════════════════════════════════════════════
[CAROUSEL-SPEZIFISCHE REGELN — ZWINGEND EINHALTEN]
═══════════════════════════════════════════════════════
${dna('carousel_rule')}` : ''}`

  const userPrompt = `THEMA: ${topic}
FORMAT: ${content_type.replace(/_/g, ' ').toUpperCase()}
${additional_info ? `ZUSATZINFO: ${additional_info}` : ''}

${FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}
${content_type === 'b_roll' ? `
PFLICHT für B-Roll Hooks: Analysiere die realen Beispiele aus [10] — erkenne welches Prinzip die Hooks stoppend macht (Kürze? Widerspruch? Direktheit?) und wende exakt dieses Prinzip auf "${topic}" an. Nicht kopieren — das Muster adaptieren.` : ''}

Gib NUR den fertigen Content aus — keine Analyse, keine Erklärungen, keine Meta-Kommentare.`

  // Claude-Call mit Retry bei Overloaded
  const claudeBody = JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, messages: [{ role: 'user', content: userPrompt }], system: systemPrompt })
  let content = ''
  let lastErrContent = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 8000 : 20000))
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: claudeBody
    })
    if (claudeRes.ok) {
      const claudeData = await claudeRes.json()
      content = claudeData.content?.[0]?.text || ''
      break
    }
    const errText = await claudeRes.text()
    lastErrContent = errText
    let errType = ''
    try { errType = JSON.parse(errText)?.error?.type || '' } catch { /* */ }
    if (errType !== 'overloaded_error' && claudeRes.status !== 529) {
      return new Response(JSON.stringify({ error: 'Claude error: ' + errText }), { status: 502, headers: CORS })
    }
  }
  if (!content) return new Response(JSON.stringify({ error: 'Claude überlastet. Bitte nochmal versuchen.', detail: lastErrContent }), { status: 503, headers: CORS })

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
