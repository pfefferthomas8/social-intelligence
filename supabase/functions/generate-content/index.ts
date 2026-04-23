const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
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

  carousel_mehrwert: `Erstelle einen MEHRWERT-Karussell-Post mit 7-9 Slides. Ziel: Der Leser SPEICHERT diesen Post.
Nur reiner Text. Keine Design-Tags, keine Layout-Labels.

ABSOLUTES VERBOT: KEINE Gedankenstriche (—), KEINE Bindestriche als Satzzeichen.

══════════════════════════════════════════════════════════
SLIDE 1 — NEUGIER-LÜCKE: Thema benennen, Antwort verbergen
══════════════════════════════════════════════════════════
Genau zwei Zeilen. Kein Insight, kein Bold Claim, keine Antwort.
Starter: "Warum..." / "Der Grund warum..." / "Das Problem mit..." / "Eine Sache über..."
Zeile 2 nur wenn sie echten Sog erzeugt: "Den die meisten nie erkennen." / "Über die kaum jemand spricht."

SLIDE 2 — DAS PROBLEM
Warum die meisten das falsch machen. Konkret, erkennbar, fühlbar.
Ein konkretes Alltagsszenario mit innerem Monolog in Anführungszeichen.

SLIDES 3 bis (N-2) — JE EIN KONKRETER TIPP ODER INSIGHT
Jede Slide = eine Sache. Spezifisch. Umsetzbar. Mit kurzem "Warum" dahinter.
Keine Aufzählungen innerhalb einer Slide. Eine Aussage, eine Erklärung, fertig.
Texte können kurz (2-4 Wörter, Impact) oder länger (Erklärung, Tiefe) sein.

SLIDE (N-1) — DER ÜBERRASCHENDE ÜBERBLICK
Der eine Satz den der Leser screenshot-t. Die Kernbotschaft in ihrer klarsten Form.

LETZTE SLIDE — CTA
Kurz. Eine Handlung. Direkt.

FORMAT:
SLIDE [Nummer]:
[Text]`,

  carousel_transformation: `Erstelle einen TRANSFORMATION-Karussell-Post mit 7-9 Slides. Ziel: Der Leser TEILT oder SENDET diesen Post.
Nur reiner Text. Keine Design-Tags, keine Layout-Labels.

ABSOLUTES VERBOT: KEINE Gedankenstriche (—), KEINE Bindestriche als Satzzeichen.

Kann Thomas' eigene Geschichte sein ODER eine Kunden-Transformation (dann "er"/"sie").
Immer konkrete Zahlen: Wochen, Kilo, Kalorien, Trainingshäufigkeit.

SLIDE 1 — AUSGANGSSITUATION
Wer war die Person? Wo stand sie? Ein konkretes Bild. Kein Spoiler auf das Ergebnis.
Kein "Vor 12 Wochen war ich fett." Stattdessen: Spezifische Situation die der Leser kennt.

SLIDE 2 — DAS KONKRETE PROBLEM
Was hat nicht funktioniert? Welcher Versuch ist gescheitert? Spezifisch und fühlbar.
Der Leser denkt: "Genau das kenne ich."

SLIDES 3-5 — DER WEG
Was hat sich verändert? Welche Entscheidung wurde getroffen?
Je eine konkrete Veränderung pro Slide. Methode, Mindset-Shift, oder Erkenntnis.
Keine Aufzählung, jede Slide eine Aussage mit Tiefe.

SLIDE 6 — DAS ERGEBNIS
Konkret und messbar. Zahlen. Zeitraum. Was sich außer dem Körper noch verändert hat.

SLIDE 7 — WAS DAS FÜR DEN LESER BEDEUTET
Der Transfer. "Wenn das möglich war, dann..." — Direkte Ansprache des Lesers.

LETZTE SLIDE — CTA
Eine Handlung. Direkt. Ohne Druck.

FORMAT:
SLIDE [Nummer]:
[Text]`,

  carousel_haltung: `Erstelle einen HALTUNGS-Karussell-Post mit 7-9 Slides. Ziel: Kommentare und Identifikation.
Nur reiner Text. Keine Design-Tags, keine Layout-Labels.

ABSOLUTES VERBOT: KEINE Gedankenstriche (—), KEINE Bindestriche als Satzzeichen.

══════════════════════════════════════════════════════════
SLIDE 1 — PROVOKANTER KONTRAST: Kein Insight, nur Spannung
══════════════════════════════════════════════════════════
Zwei Zeilen. Erster Satz = eine alltägliche Wahrheit. Zweiter Satz = der Bruch.
Bewährtes Thomas-Muster: "Die meisten Männer [alltägliches Verhalten]." / "Aber [ihr Körper / ihr Leben / die Realität]? [Punch in 3-5 Wörtern]."
Kein Insight, keine Antwort, nur die Spannung die zwingt weiterzulesen.

SLIDE 2 — DAS UNBEQUEME SZENARIO
Konkretes Alltagsbild. Innerer Monolog in Anführungszeichen.
Der Leser erkennt sich. Kein Urteil, nur Spiegelung.

SLIDES 3-5 — DIE WAHRHEIT HINTER DEM PROBLEM
Jede Slide ein Reframing oder eine tiefere Erkenntnis.
Nicht moralisieren, sondern aufzeigen. Kurze, präzise Sätze.
Jede Slide endet offen oder mit einer Frage.

SLIDE 6 — DIE ENTSCHEIDUNG
Der Wendepunkt. Was trennt die, die es schaffen, von denen die es nicht schaffen.
Eine klare, provokante Aussage. Kein "Du kannst es schaffen" — das ist leer.

SLIDE 7 — DER PAYOFF
Die Erkenntnis in ihrer direktesten Form. Der Satz den man speichert oder zitiert.

LETZTE SLIDE — CTA
Kurz. Direkt. Eine Handlung.

FORMAT:
SLIDE [Nummer]:
[Text]`,

  carousel_verkauf: `Erstelle einen SALES-Karussell-Post mit 7-9 Slides. Ziel: Direkte Coaching-Anfragen.
Nur reiner Text. Keine Design-Tags, keine Layout-Labels.

ABSOLUTES VERBOT: KEINE Gedankenstriche (—), KEINE Bindestriche als Satzzeichen.

WICHTIG: Kein aggressives Verkaufen. Thomas verkauft durch Vertrauen und Spezifität, nicht durch Druck.
Der Leser soll denken: "Das ist genau für mich." und von selbst fragen.

SLIDE 1 — DER SCHMERZPUNKT
Benennt das genaue Problem des Idealkunden. Spezifisch: Alter, Situation, Symptom.
Kein Spoiler auf die Lösung. Nur Identifikation.
Beispiel-Starter: "Mein Coaching ist nicht für jeden." / "Es gibt einen Punkt an dem Training nicht mehr reicht."

SLIDE 2 — DAS SZENARIO
Konkretes Alltagsbild des Idealkunden. Innerer Monolog in Anführungszeichen.
Der Leser denkt: "Woher weiß der das?"

SLIDES 3-4 — WARUM DIE MEISTEN LÖSUNGEN SCHEITERN
Was hat er schon probiert? Warum hat es nicht funktioniert?
Keine Konkurrenten angreifen. Den Mechanismus erklären der zum Scheitern führt.

SLIDE 5 — DER UNTERSCHIED
Was Thomas anders macht. Konkret. Kein Marketing-Sprech, keine leeren Versprechen.
Eine Methode, ein Prinzip, ein konkreter Unterschied.

SLIDE 6 — BEWEIS
Ein konkretes Kunden-Ergebnis mit Zahlen und Zeitraum.
Oder: Was nach X Wochen im Coaching passiert.

SLIDE 7 — FÜR WEN ES IST
Die genaue Beschreibung des Idealkunden. Wer genau passt. Wer NICHT passt (schafft Vertrauen).

LETZTE SLIDE — CTA
Eine einzige Handlung. Klar und direkt. Kommentieren, DM, Link.

FORMAT:
SLIDE [Nummer]:
[Text]`,

  carousel: `Erstelle einen Karussel-Post mit 7-9 Slides. Nur den reinen Text. Keine Design-Tags, keine Layout-Labels.

ABSOLUTES VERBOT: KEINE Gedankenstriche (—), KEINE Bindestriche als Satzzeichen. Punkt. Komma. Das war's.

══════════════════════════════════════════════════════════
SLIDE 1 — EISERNE REGEL: NUR THEMA + NEUGIER. NIEMALS AUSSAGE.
══════════════════════════════════════════════════════════
Slide 1 besteht aus genau zwei Zeilen.

ZEILE 1: Ein starker Neugier-Satz. Stellt eine Frage oder benennt ein Paradoxon, ohne die Antwort zu geben.
Erlaubte Starter: "Warum..." / "Der Grund warum..." / "Das Problem mit..." / "Eine Sache über..." / "Der Fehler den..."
NICHT: "Die meisten Männer denken..." / "X. Aber in Wahrheit..." / "Das stimmt nicht." / "Aber"-Konstruktionen

ZEILE 2: Optional. Nur wenn sie echten Sog erzeugt. Wenn Zeile 1 alleine stark genug ist, weglassen.
Wenn sie kommt: Reine Neugier-Phrase, kein Inhalt. "Den die meisten nie erkennen." / "Über die kaum jemand spricht."

GOLDSTANDARD (Thomas' eigenes Beispiel):
"Warum Männer mit einer Elite-Form oft nur durchschnittliche Disziplin haben."
→ Eine Zeile. Kein Spoiler. Sofortiger Widerspruch zur Erwartung. Leser muss wissen wie das geht.

WEITERE RICHTIGE BEISPIELE:
"Eine der größten Selbstsabotagen beim Abnehmen."
"Über die fast niemand spricht..."

"Der Grund warum Männer nach 4 Wochen aufhören."
"Er hat nichts mit Motivation zu tun."

FALSCH — alle diese Varianten sind verboten weil sie ein Urteil oder Insight enthalten:
"Die meisten Männer denken, sie hätten ein Disziplin-Problem. Das stimmt nicht." → verrät die Antwort
"Die meisten Männer mit den besten Körpern sind nicht disziplinierter als du." → verrät den Punkt komplett
"X. Aber das ist falsch." / "X. Das stimmt nicht." → jede Gegenaussage gibt das Insight preis

SLIDE 2 — SZENARIO + CLIFFHANGER
Muss eigenständig funktionieren OHNE Slide 1 (Instagram zeigt sie als Preview).
Kein abstrakter Einstieg. Stattdessen: Ein konkretes, erkennbares Alltagsszenario.

PFLICHT-MUSTER:
[Konkrete Situation schildern — Ort, Zeit, Kontext]
[Innerer Monolog in Anführungszeichen — so denkt die Zielgruppe wirklich]
[Cliffhanger-Satz: "Die Wahrheit sieht anders aus." / "Genau hier passiert es." / "Und das ist das Problem."]

RICHTIG:
"Du bist seit 10 Tagen in der Diät. Deine Kollegen bestellen Pizza und du denkst: 'Einmal cheaten wird ja nicht schaden...'
Die Wahrheit sieht anders aus."

"Sonntag, 20 Uhr. Die Woche war stressig. Du schaffst es nicht ins Gym und sagst dir: 'Nächste Woche starte ich richtig.'
Nächste Woche kommt nie."

FALSCH:
"In diesem Karussell erkläre ich dir warum..."
"Viele Menschen kennen das Problem..."

SLIDES 3 bis (N-2) — INHALT
Je ein konkretes Insight. Texte können kurz (2-4 Wörter, großer Impact) oder länger (Erklärung, Tiefe) sein, je nach was die Slide braucht. Jede Slide endet offen, mit Frage oder Ellipse.

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

  b_roll: `Erstelle 4 B-Roll Text-Overlays für das angegebene Thema.

B-Rolls: zufälliges Footage von mir (im Gym, gehen, trainieren). Der visuelle Inhalt ist EGAL.
Allein der Text-Overlay muss den Scroll stoppen und erzwingen, dass die Caption gelesen wird.
KEINE Szenenbeschreibung — die wähle ich selbst.

══════════════════════════════════════════════════
SCHRITT 1 — ANALYSIERE ZUERST DIE ECHTEN HOOKS AUS [10]
══════════════════════════════════════════════════
Lies Abschnitt [10] komplett. Erkenne INTERN (nicht ausgeben):
• Was ist das Muster hinter Thomas' eigenen Visual-Text-Hooks? Länge? Spezifität? Zielgruppen-Ansprache?
• Was macht die stärksten Competitor-Overlays unwiderstehlich? Countdown? Paradox? Zahl? Direktangriff?
• Welche 2-3 Muster passen am besten zu diesem konkreten Thema?
ERST DANN mit Schritt 2 beginnen.

══════════════════════════════════════════════════
SCHRITT 2 — SCHREIBE 4 HOOKS NACH DIESEN MUSTERN:
══════════════════════════════════════════════════

SZENARIO-HOOK — Spricht direkt die Situation der Zielgruppe an. Spezifisch, nicht generisch.
Thomas' echter Stil: "Warum du dir niemals Sorgen machen musst, wenn du als Mann gerade 10 Kilo zu viel hast."
Thomas' echter Stil: "Das sage ich meinen Klienten, wenn sie trotz Training 6 Wochen kein Ergebnis sehen."

NEUGIER-ZAHL — Unrunde konkrete Zahl + überraschende Aussage. KEINE runden Zahlen (10, 100%).
Thomas' echter Stil: "10 ungewöhnliche Zeichen, dass dein Körper gerade Fett verbrennt."
Competitor-Muster: "THE BIGGEST CHEAT CODE IS GOING TO BED ON AN EMPTY STOMACH." [161k Views]

COUNTER-INTUITIVE — Validierung einer negativen Situation → Reframing ins Positive.
Thomas' echter Stil: "Warum du dir NIEMALS Sorgen machen musst, wenn [negatives Szenario des Zuschauers]."
Competitor-Muster: "If you wanna be in the top one percent, just do the opposite of what 99% do." [98k Views]

DIREKTANGRIFF — Direkt an den Zuschauer. Trifft einen Nerv. Kein "man". Immer "du".
Stark: Zwei kurze Sätze. Erster = Ist-Zustand. Zweiter = der Nerv-Treffer.
Competitor-Muster: "10 hours before bed... 3 hours before bed... 2 hours before bed..." (Countdown-Protokoll) [110k Views]

WEITERE MUSTER falls sie besser passen: Paradox / Cheat-Code / Coaching-Kontext / Reframing

══════════════════════════════════════════════════
SCHRITT 3 — LOGIK-CHECK: Jeden Hook vor Ausgabe prüfen
══════════════════════════════════════════════════
Stelle dir für jeden fertigen Hook diese 3 Fragen. Wenn eine mit JA beantwortet wird → Hook neu schreiben.

FRAGE 1 — IST DAS OFFENSICHTLICH?
"Würde irgendjemand der Zielgruppe diesen Satz lesen und denken: Ja, logisch, und weiter?"
→ Beispiel VERBOTEN: "Du isst im Defizit und hast trotzdem Hunger." — Natürlich hat man Hunger im Defizit. Das IST das Defizit. Keine Überraschung. Kein Sog.
→ Ein guter Hook sagt etwas, das der Zuschauer NICHT erwartet hat, NICHT kennt, oder NICHT für möglich hielt.

FRAGE 2 — FEHLT DIE SPANNUNG?
"Würde der Zuschauer aufhören zu scrollen weil er die Antwort DRINGEND wissen will?"
→ Ein Hook der eine bekannte Tatsache bestätigt erzeugt keine Spannung.
→ Ein Hook muss eine Lücke öffnen: "Das weiß ich noch nicht" oder "Das kann nicht stimmen — ich will mehr wissen."

FRAGE 3 — IST "DAS IST DER GRUND" ODER "DAS IST DAS PROBLEM" DAS EINZIGE VERSPRECHEN?
→ Diese Formulierungen sind Platzhalter ohne Inhalt. Sie sagen nichts über den Mehrwert.
→ Der Hook muss selbst schon eine überraschende Information oder ein Paradoxon enthalten.

══════════════════════════════════════════════════
ABSOLUT VERBOTEN:
══════════════════════════════════════════════════
✗ KEINE Hooks die logisch selbstverständlich sind. Teste jeden Hook: "Würde jemand denken: Ja, natürlich, so what?"
✗ KEINE erfundenen persönlichen Fehler von Thomas. Er ist ein erfolgreicher, fitter Coach.
✗ KEINE grammatikalisch mehrdeutigen Sätze. Jeden Hook laut vorlesen vor der Ausgabe.
✗ KEIN impliziertes Verb das sich auf ein folgendes Nomen beziehen könnte.
✗ KEINE generisch kurzen 3-5 Wort Hooks. Thomas' Stärke ist Spezifität und Substanz.
✗ KEIN "Das ist der Grund." oder "Das ist das Problem." ohne konkrete überraschende Aussage davor.

══════════════════════════════════════════════════
PFLICHT-REGELN:
══════════════════════════════════════════════════
• HOOK: 8–20 Wörter. Spezifisch. Zielgruppe direkt angesprochen.
• MUSTER: Name des verwendeten Musters aus Schritt 2.
• SUBHEADLINE: 3–8 Wörter die den Sog verstärken ohne die Antwort zu geben. Oder "–".
• CAPTION: Erster Satz = Hook der nicht loslässt → 2-3 Absätze mit echtem Inhalt → klarer CTA. Ca. 150 Wörter.
• Jede der 4 B-Rolls nutzt ein ANDERES Muster.

Gib EXAKT dieses Format aus:

B-ROLL [Nummer]:
MUSTER: [Muster-Name]
HOOK: [Text-Overlay, 8–20 Wörter]
SUBHEADLINE: [3-8 Wörter — oder –]
CAPTION: [Volle Caption]`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { topic, content_type, additional_info, carousel_subtype } = await req.json()
  if (!topic || !content_type) {
    return new Response(JSON.stringify({ error: 'topic + content_type required' }), { status: 400, headers: CORS })
  }
  const validSubtypes = ['mehrwert', 'transformation', 'haltung', 'verkauf']
  const activeSubtype = content_type === 'carousel' && validSubtypes.includes(carousel_subtype) ? carousel_subtype : null

  const [ownPosts, topCompPosts, customPosts, thomasDna, trendPosts, topRated, externalSignals, topRatedBroll, compCarousels, ownCarousels] = await Promise.all([
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
    content_type === 'carousel'
      ? (activeSubtype
          ? dbQuery(`instagram_posts?select=caption,visual_text,likes_count&source=eq.competitor&post_type=eq.carousel&content_pillar=eq.${activeSubtype}&order=likes_count.desc&limit=15`)
              .then(rows => rows.length >= 3 ? rows : dbQuery('instagram_posts?select=caption,visual_text,likes_count&source=eq.competitor&post_type=eq.carousel&order=likes_count.desc&limit=15'))
          : dbQuery('instagram_posts?select=caption,visual_text,likes_count&source=eq.competitor&post_type=eq.carousel&order=likes_count.desc&limit=20'))
      : Promise.resolve([]),
    content_type === 'carousel'
      ? (activeSubtype
          ? dbQuery(`instagram_posts?select=caption,likes_count,content_pillar&source=eq.own&post_type=eq.carousel&content_pillar=eq.${activeSubtype}&order=likes_count.desc&limit=8`)
              .then(rows => rows.length >= 2 ? rows : dbQuery('instagram_posts?select=caption,likes_count,content_pillar&source=eq.own&post_type=eq.carousel&order=likes_count.desc&limit=10'))
          : dbQuery('instagram_posts?select=caption,likes_count&source=eq.own&post_type=eq.carousel&order=likes_count.desc&limit=10'))
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

  const seenCompCaptions = new Set<string>()
  const compWithTriggers = topCompPosts
    .filter((p: any) => {
      const key = (p.caption || '').substring(0, 40)
      if (seenCompCaptions.has(key)) return false
      seenCompCaptions.add(key)
      return true
    })
    .slice(0, 12).map((p: any) => {
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' '))
      const lc = text.toLowerCase()
      const matchedTrigger = Object.entries(compTriggerMap).find(([key]) => lc.includes(key.toLowerCase()))
      const trigger = matchedTrigger ? matchedTrigger[1] : 'MUSTER: Konkrete Aussage + Kontrast + Lösung'
      const vt = (p.visual_text || '').trim()
      const vtLine = vt && vt.length > 10 && vt.split(/\s+/).length >= 3
        ? `\nB-ROLL OVERLAY: "${vt.replace(/\n/g, ' ').substring(0, 150)}"`
        : ''
      return `[${(p.views_count || 0).toLocaleString()} Views]\nTRIGGER: ${trigger}${vtLine}\nPOST: "${text}"`
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

    // ── Thomas' eigene visual_text Hooks ──────────────────────────────────────
    const ownVisualHooks = ownPosts
      .filter((p: any) => {
        const vt = (p.visual_text || '').trim()
        return vt.length >= 15 && vt.split(/\s+/).length >= 3
      })
      .map((p: any) => `[${(p.views_count || 0).toLocaleString()} Views] "${(p.visual_text as string).trim().replace(/\n/g, ' ')}"`)
      .slice(0, 10)

    // ── Competitor visual_text — die echten B-Roll Overlays aus ihren Reels ──
    const seenVt = new Set<string>()
    const competitorVisualHooks = topCompPosts
      .filter((p: any) => {
        const vt = (p.visual_text || '').trim()
        if (!vt || vt.length < 25) return false
        if (vt.split(/\s+/).length < 5) return false        // zu wenig Wörter = nur Label
        if (/^[A-Z\s]{1,15}$/.test(vt)) return false       // nur Großbuchstaben-Label wie "THE AVERAGE"
        if (/^\d|^[A-Z]{1,2}\n/.test(vt)) return false     // OCR-Müll
        const key = vt.substring(0, 40)
        if (seenVt.has(key)) return false
        seenVt.add(key)
        return true
      })
      .map((p: any) => {
        const vt = (p.visual_text as string).trim().replace(/\n/g, ' ')
        return `[${(p.views_count || 0).toLocaleString()} Views] "${vt.substring(0, 200)}"`
      })
      .slice(0, 10)

    // ── Trend Posts visual_text ─────────────────────────────────────────────
    const trendVisualHooks = trendPosts
      .filter((t: any) => {
        const vt = (t.visual_text || '').trim()
        return vt.length >= 20 && !vt.includes('@') && vt.split(/\s+/).length >= 4
      })
      .map((t: any) => {
        const vt = (t.visual_text as string).trim().replace(/\n/g, ' ')
        return `[Viral Score ${Math.round(t.viral_score || 0)}] "${vt.substring(0, 160)}"`
      })
      .slice(0, 5)

    const parts: string[] = []

    if (ownVisualHooks.length > 0) {
      parts.push(`━━━ THOMAS' EIGENE REEL-HOOKS — SEIN ECHTER STIL ━━━
Text-Overlays von Thomas' eigenen Videos. Das ist seine Stimme, sein Rhythmus, seine Stärke.
NICHT generisch kurz — spezifisch, substanzreich, mit echtem Mehrwert.
Neue Hooks müssen sich EXAKT so anfühlen:

${ownVisualHooks.join('\n')}`)
    }

    if (competitorVisualHooks.length > 0) {
      parts.push(`━━━ COMPETITOR B-ROLL OVERLAYS — AUS DER DATENBANK ━━━
Das sind die echten Text-Overlays auf den B-Rolls deiner Competitors mit den meisten Views.
Das Thema ist irrelevant — das MUSTER ist alles. Wie ist es aufgebaut? Was macht es unwiderstehlich?
Auf Thomas' Themen + Stil anwenden:

${competitorVisualHooks.join('\n')}`)
    }

    if (trendVisualHooks.length > 0) {
      parts.push(`━━━ TREND-REEL OVERLAYS (nach Viral Score) ━━━
${trendVisualHooks.join('\n')}`)
    }

    if (competitorHooks.length > 0) {
      parts.push(`━━━ COMPETITOR CAPTION-HOOKS (erste Sätze, nach Views) ━━━
${competitorHooks.join('\n\n')}`)
    }

    if (ratedHooks.length > 0) {
      parts.push(`━━━ THOMAS HAT DIESE HOOKS GUT BEWERTET ━━━
${ratedHooks.join('\n')}`)
    }

    brollSection = `
═══════════════════════════════════════════════════════
[10] B-ROLL HOOKS — ALLE DATENPUNKTE AUS DER DATENBANK
═══════════════════════════════════════════════════════
SYNTHESE-AUFTRAG: Kombiniere Thomas' eigenen Stil mit den stärksten Mustern der Competitors.
Das Ziel: Hooks die sich nach Thomas anfühlen UND so stark sind wie die Competitor-Overlays.

${parts.join('\n\n')}`
  }

  // ── Karussell-spezifischer Datenbankabschnitt ──────────────────────────────
  let carouselSection = ''
  if (content_type === 'carousel') {
    const carouselParts: string[] = []

    // Helper: ersten sinnvollen Satz aus Caption
    const firstSentence = (cap: string) =>
      cap.replace(/\n/g, ' ').match(/^.{5,120}?[.!?…]/)?.[0]?.trim()
      || cap.replace(/\n/g, ' ').substring(0, 90).trim()

    // Competitor Slide-1-Hooks mit Likes
    const seenComp = new Set<string>()
    const compSlide1 = (compCarousels as any[])
      .filter((p: any) => {
        const cap = (p.caption || '').trim()
        if (!cap || cap.length < 10) return false
        const key = cap.substring(0, 40)
        if (seenComp.has(key)) return false
        seenComp.add(key)
        return true
      })
      .map((p: any) => {
        const cap = (p.caption || '').trim()
        const slide1 = firstSentence(cap)
        if (!slide1 || slide1.length < 5) return null
        const vt = (p.visual_text || '').trim()
        const vtLine = vt && vt.length > 10 && vt.split(/\s+/).length >= 3
          ? `\n  VISUAL TEXT: "${vt.replace(/\n/g, ' ').substring(0, 120)}"`
          : ''
        const wc = slide1.split(/\s+/).length
        return `[${(p.likes_count || 0).toLocaleString()} Likes] [${wc}W] "${slide1}"${vtLine}`
      })
      .filter(Boolean)

    if (compSlide1.length > 0) {
      carouselParts.push(`━━━ COMPETITOR SLIDE 1 — NUR FÜR THEMEN UND TONALITÄT ━━━
ACHTUNG: Diese Competitors nutzen Bold-Claim-Hooks die sofort das Insight verraten.
Das ist NICHT der Stil den wir wollen. Ignoriere ihre Slide-1-Struktur komplett.
Nutze diese Daten NUR für: Welche Themen performen? Welchen Ton treffen sie?
Die Slide-1-STRUKTUR ist immer: Neugier-Lücke. Kein Insight. Kein Spoiler. (Siehe Pflicht-Regeln oben.)

${compSlide1.join('\n\n')}`)
    }

    // Thomas' eigene Slide-1-Hooks
    const seenOwn = new Set<string>()
    const ownSlide1 = (ownCarousels as any[])
      .filter((p: any) => {
        const cap = (p.caption || '').trim()
        if (!cap) return false
        const key = cap.substring(0, 40)
        if (seenOwn.has(key)) return false
        seenOwn.add(key)
        return true
      })
      .map((p: any) => {
        const cap = (p.caption || '').trim()
        const lines = cap.split('\n').map((l: string) => l.trim()).filter(Boolean)
        const slide1 = lines[0] || ''
        const slide2 = lines[1] || ''
        if (!slide1) return null
        return `[${(p.likes_count || 0).toLocaleString()} Likes] "${slide1}"${slide2 ? `\n  Zeile 2: "${slide2}"` : ''}`
      })
      .filter(Boolean)

    if (ownSlide1.length > 0) {
      carouselParts.push(`━━━ THOMAS' EIGENE KARUSSELL-HOOKS ━━━
Sein stärkstes Muster: Kurze Behauptung + sofortiger Kontrast in Zeile 2.
"Die meisten Männer checken ihren Kontostand täglich."
"Aber ihren Körper?" [Kontrast] "Einmal im Jahr." [Punch]
Diesen Rhythmus bei Slide 1 + 2 imitieren:

${ownSlide1.join('\n\n')}`)
    }

    if (carouselParts.length > 0) {
      const subtypeContext = activeSubtype ? {
        mehrwert: 'KARUSSELL-TYP: MEHRWERT — Ziel ist Speichern. Jede Slide liefert einen konkreten, umsetzbaren Mehrwert.',
        transformation: 'KARUSSELL-TYP: TRANSFORMATION — Ziel ist Teilen. Narrative Struktur, konkrete Zahlen, emotionale Identifikation.',
        haltung: 'KARUSSELL-TYP: HALTUNG — Ziel ist Kommentare. Provokanter Kontrast, Reframing, Identitäts-Trigger.',
        verkauf: 'KARUSSELL-TYP: SALES — Ziel ist Anfragen. Spezifischer Schmerzpunkt, Vertrauen durch Konkretheit, ein klarer CTA.',
      }[activeSubtype] : ''

      carouselSection = `
═══════════════════════════════════════════════════════
[10] KARUSSELL-DATEN AUS DER DATENBANK
═══════════════════════════════════════════════════════
${subtypeContext ? subtypeContext + '\n' : ''}SYNTHESE-AUFTRAG: Erkenne das Muster hinter den performenden Slide-1-Hooks INTERN.
Wende Thomas' Rhythmus auf das konkrete Thema an. Kein Copy-Paste, das Prinzip adaptieren.

${carouselParts.join('\n\n')}`
    }
  }

  // ── SYSTEM PROMPT ───────────────────────────────────────────────────────────
  const systemPrompt = `Du bist die KI-Instanz die ausschließlich für Thomas Pfeffer arbeitet. Fitness-Coach, DACH-Markt, Männer 30+.

Deine Aufgabe: Alle verfügbaren Datenpunkte synthetisieren und den perfekten Content erstellen.
Nicht einen Datenpunkt priorisieren. ALLE gleichzeitig aktivieren.

ABSOLUTES SCHREIBVERBOT IN JEDEM OUTPUT:
Keine Gedankenstriche (—). Keine Bindestriche als Satzzeichen (–). Niemals.
Erlaubt: Punkt, Komma, Ausrufezeichen, Fragezeichen, Doppelpunkt, Ellipse (…).
Wenn du einen Gedankenstrich setzen willst, nutze stattdessen einen Punkt oder ein Komma.

KARUSSELL-SLIDE-1-GESETZ (unverhandelbar, gilt vor allem anderen):
Slide 1 eines Karussells darf NIEMALS ein Insight, eine Erklärung oder eine Antwort enthalten.
Slide 1 benennt nur das Thema und öffnet eine Neugier-Lücke. Fertig.
Prüfung: Kann der Leser nach Slide 1 die Kernaussage erraten? Wenn ja, ist Slide 1 falsch.

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
${carouselSection}

═══════════════════════════════════════════════════════
SYNTHESE-PRINZIP
═══════════════════════════════════════════════════════
Für jeden Content-Output:
1. Wähle den stärksten TRIGGER aus [6] der zum Thema passt
2. Überprüfe ob ein Trend-Signal aus [7] das Thema verstärkt
3. Forme den Trigger durch Thomas' Hook-Formeln aus [2] und seinen Stil aus [3]
4. Stelle sicher dass es zu seiner Zielgruppe aus [1] passt
5. Das Ergebnis klingt nach Thomas — und schlägt wie ein viraler Post

FÜR KARUSSELL GILT ZUSÄTZLICH — NICHT VERHANDELBAR:
Schritt 0 vor allem anderen: Schreibe Slide 1 nach dem NEUGIER-LÜCKE-Prinzip.
Zwei Zeilen. Kein Insight. Kein Bold Claim. Kein "Aber in Wahrheit...".
Wenn du nach dem Schreiben von Slide 1 merkst dass der Leser die Antwort ahnen kann: Lösche Slide 1 und schreibe neu.
${content_type === 'carousel' && dna('carousel_rule') ? `
═══════════════════════════════════════════════════════
[CAROUSEL-SPEZIFISCHE REGELN — ZWINGEND EINHALTEN]
═══════════════════════════════════════════════════════
${dna('carousel_rule')}` : ''}`

  const carouselFormatKey = content_type === 'carousel' && activeSubtype ? `carousel_${activeSubtype}` : content_type
  const carouselSubtypeLabel = activeSubtype ? { mehrwert: 'MEHRWERT', transformation: 'TRANSFORMATION', haltung: 'HALTUNG', verkauf: 'SALES' }[activeSubtype] : ''

  const userPrompt = `THEMA: ${topic}
FORMAT: ${content_type === 'carousel' && carouselSubtypeLabel ? `KARUSSELL (${carouselSubtypeLabel})` : content_type.replace(/_/g, ' ').toUpperCase()}
${additional_info ? `ZUSATZINFO: ${additional_info}` : ''}

${FORMAT_INSTRUCTIONS[carouselFormatKey] || FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}
${content_type === 'b_roll' ? `
PFLICHT für B-Roll Hooks: Analysiere die realen Beispiele aus [10]. Erkenne welches Prinzip die Hooks stoppend macht (Kürze? Widerspruch? Direktheit?) und wende exakt dieses Prinzip auf "${topic}" an. Nicht kopieren, das Muster adaptieren.` : ''}
${content_type === 'carousel' ? `
PFLICHT für Karussell: Lies zuerst Abschnitt [10] komplett. Erkenne INTERN welcher Hook-Typ bei den Competitors am stärksten performt und wie Thomas' Kontrast-Muster aufgebaut ist. Wende das auf "${topic}" an. Slide 1 ist EINE starke Aussage, kein Absatz.${activeSubtype === 'mehrwert' ? ' Jeder Tipp muss spezifisch und direkt umsetzbar sein. Keine vagen Aussagen.' : ''}${activeSubtype === 'transformation' ? ' Nutze konkrete Zahlen und Zeiträume. Keine abstrakten Beschreibungen.' : ''}${activeSubtype === 'haltung' ? ' Jede Slide spiegelt, provoziert oder reframet. Keine leere Motivation.' : ''}${activeSubtype === 'verkauf' ? ' Kein Druck, kein Hype. Vertrauen durch Spezifität.' : ''}` : ''}

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
      // Em/En-Dashes als Satzzeichen entfernen (KI-typische Stilmittel die Thomas nicht will)
      content = content
        .replace(/ — /g, ' ')
        .replace(/ – /g, ' ')
        .replace(/—/g, ' ')
        .replace(/–/g, ' ')
        .replace(/  +/g, ' ')
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
