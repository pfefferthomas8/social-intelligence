
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  b_roll: `Erstelle 5-8 kurze B-Roll Text-Overlays (je max 8 Wörter):
- Jedes ist ein eigenständiger Satz/Aussage
- Perfekt für schnelle Schnitte über B-Roll Footage
- Abwechselnd: Statement, Frage, Zahl, provokante These
Format: Liste mit Nummerierung.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== Deno.env.get('DASHBOARD_TOKEN')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { topic, content_type, additional_info } = await req.json()
  if (!topic || !content_type) {
    return new Response(JSON.stringify({ error: 'topic + content_type required' }), { status: 400, headers: CORS })
  }

  // 1. Eigene Posts laden — Thomas' Stimme lernen (Top 10 nach Engagement)
  const { data: ownPosts } = await supabase
    .from('instagram_posts')
    .select('caption, transcript, post_type, likes_count, views_count')
    .eq('source', 'own')
    .not('caption', 'is', null)
    .order('views_count', { ascending: false })
    .limit(30)

  // 2. Top Competitor Posts laden — was performt gut
  const { data: topCompPosts } = await supabase
    .from('instagram_posts')
    .select('caption, transcript, post_type, likes_count, views_count, competitor_profiles(username)')
    .eq('source', 'competitor')
    .order('views_count', { ascending: false })
    .limit(15)

  // 3. Custom Imports
  const { data: customPosts } = await supabase
    .from('instagram_posts')
    .select('caption, transcript, post_type')
    .eq('source', 'custom')
    .limit(10)

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

  // Analyse Thomas' Stil aus Top-Posts
  const styleAnalysis = ownPosts && ownPosts.length > 0
    ? `THOMAS' SCHREIBSTIL (aus seinen ${ownPosts.length} Top-Posts nach Engagement):
${(ownPosts || []).slice(0, 10).map((p, i) => {
  const text = [p.caption, p.transcript].filter(Boolean).join(' | ').substring(0, 250)
  return `[Post ${i+1} | ${(p.views_count || 0).toLocaleString()} Views | ${(p.likes_count || 0).toLocaleString()} Likes]\n${text}`
}).join('\n\n')}

Typische Merkmale von Thomas' Stil (extrahiert):
- Satzlänge, Direktheit, Wortwahl aus den obigen Posts ableiten
- Wie er Hooks formuliert
- Wie er Argumente aufbaut`
    : 'Thomas hat noch keine eigenen Posts gescrapt. Schreibe in einem direkten, faktenbasierten Stil für einen österreichischen Fitness-Coach.'

  // Virale Prinzipien aus Competitor-Posts extrahieren
  const viralPrinciples = topCompPosts && topCompPosts.length > 0
    ? `ERFOLGREICHE COMPETITOR-POSTS (Englisch) — ANALYSIERE DAS ZUGRUNDELIEGENDE PRINZIP:
${(topCompPosts || []).slice(0, 10).map(p => {
  const username = (p as any).competitor_profiles?.username || 'unknown'
  const text = [p.caption, p.transcript].filter(Boolean).join(' ').substring(0, 300)
  return `@${username} | ${(p.views_count || 0).toLocaleString()} Views:\n"${text}"\n→ KERNPRINZIP: [Warum funktionierte das? Welche Emotion/Überzeugung/Curiosity-Gap nutzt es?]`
}).join('\n\n')}

ADAPTATION-ANWEISUNG: Nutze die psychologischen Prinzipien aus diesen Posts für Thomas' Content — auf Deutsch, in Thomas' Stil, für die DACH-Zielgruppe.`
    : ''

  const customContext = (customPosts || [])
    .map(p => [p.caption, p.transcript].filter(Boolean).join(' | ').substring(0, 300))
    .filter(Boolean)
    .join('\n---\n')
    .substring(0, 1500)

  const systemPrompt = [
    SYSTEM_PROMPT_BASE,
    styleAnalysis,
    viralPrinciples,
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

  // Claude API
  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 3000,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt
    })
  })

  if (!claudeRes.ok) {
    const err = await claudeRes.text()
    return new Response(JSON.stringify({ error: 'Claude error: ' + err }), { status: 502, headers: CORS })
  }

  const claudeData = await claudeRes.json()
  const content = claudeData.content?.[0]?.text

  if (!content) {
    return new Response(JSON.stringify({ error: 'Leere Antwort von Claude.' }), { status: 500, headers: CORS })
  }

  // In DB speichern
  const { data: saved } = await supabase
    .from('generated_content')
    .insert({ topic, content_type, content })
    .select('*')
    .single()

  return new Response(JSON.stringify({ content, id: saved?.id }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
