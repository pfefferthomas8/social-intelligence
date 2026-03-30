
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

  const { topic, content_type, tone, additional_info } = await req.json()
  if (!topic || !content_type) {
    return new Response(JSON.stringify({ error: 'topic + content_type required' }), { status: 400, headers: CORS })
  }

  // 1. Eigene Posts laden — Thomas' Stimme lernen
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

  // Kontext bauen
  const ownContext = (ownPosts || [])
    .map(p => [p.caption, p.transcript].filter(Boolean).join(' | ').substring(0, 300))
    .filter(Boolean)
    .join('\n---\n')
    .substring(0, 4000)

  const competitorContext = (topCompPosts || [])
    .map(p => {
      const username = (p as any).competitor_profiles?.username || 'unknown'
      const text = [p.caption, p.transcript].filter(Boolean).join(' | ').substring(0, 200)
      return `@${username} (${p.views_count || 0} Views): ${text}`
    })
    .filter(Boolean)
    .join('\n---\n')
    .substring(0, 3000)

  const customContext = (customPosts || [])
    .map(p => [p.caption, p.transcript].filter(Boolean).join(' | ').substring(0, 300))
    .filter(Boolean)
    .join('\n---\n')
    .substring(0, 1500)

  // Ton-Beschreibung
  const toneDescriptions: Record<string, string> = {
    direct: 'direkt, provokant, keine Umschweife, klare Meinung',
    educational: 'lehrreich, strukturiert, gibt echten Mehrwert, erklärt komplexes einfach',
    motivational: 'energetisch, mitreißend, baut Feuer auf, inspiriert zu handeln',
    story: 'persönlich, erzählt eine Geschichte, verbindet Emotion mit Message'
  }

  const systemPrompt = `Du bist der Ghost-Writer und Social-Media-Stratege von Thomas, einem Fitness Coach für Männer 30+.

THOMAS' SCHREIBSTIL (aus seinen eigenen Posts lernen):
${ownContext || 'Noch keine eigenen Posts verfügbar.'}

WAS BEI ERFOLGREICHEN COACHES GERADE GUT PERFORMT:
${competitorContext || 'Noch keine Competitor-Daten verfügbar.'}

${customContext ? `ZUSÄTZLICHE REFERENZ-INHALTE:\n${customContext}` : ''}

REGELN:
- Schreibe GENAU wie Thomas — sein Stil, seine Sprache, seine Ausdrucksweise
- Nutze was bei Competitors funktioniert als Inspiration, nicht als Kopie
- Ton: ${toneDescriptions[tone] || 'direkt und klar'}
- Kein generisches Fitness-Coach-Blabla — Thomas hat eine klare Meinung
- Deutsch, außer englische Fachbegriffe die Thomas nutzt
- Kein "Als KI..." oder ähnliches — du bist Thomas`

  const userPrompt = `Erstelle folgenden Content:

THEMA: ${topic}
FORMAT: ${content_type.replace('_', ' ').toUpperCase()}
${additional_info ? `ZUSÄTZLICHE INFO: ${additional_info}` : ''}

FORMATVORGABE:
${FORMAT_INSTRUCTIONS[content_type] || 'Freie Form.'}`

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
      max_tokens: 2000,
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
    .insert({ topic, content_type, tone, content })
    .select('*')
    .single()

  return new Response(JSON.stringify({ content, id: saved?.id }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
