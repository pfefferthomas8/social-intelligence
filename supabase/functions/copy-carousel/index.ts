const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const token = req.headers.get('Authorization')?.replace('Bearer ', '')
  if (token !== DASHBOARD_TOKEN) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: CORS })
  }

  const { slides, additional_info, label } = await req.json()
  if (!slides?.length) {
    return new Response(JSON.stringify({ error: 'slides required' }), { status: 400, headers: CORS })
  }
  if (slides.length > 12) {
    return new Response(JSON.stringify({ error: 'Max 12 Slides' }), { status: 400, headers: CORS })
  }

  // Thomas DNA + eigene Posts + positiv bewertete Outputs laden
  const [thomasDna, ownPosts, topRatedCarousels] = await Promise.all([
    dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=25'),
    dbQuery('instagram_posts?select=caption,transcript,views_count&source=eq.own&order=views_count.desc&limit=12'),
    dbQuery('generated_content?select=topic,content&user_rating=eq.1&content_type=in.(carousel,carousel_copy)&order=created_at.desc&limit=4'),
  ])

  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  function clean(text: unknown): string {
    if (!text) return ''
    return String(text).replace(/[\uD800-\uDFFF]/g, '').replace(/\0/g, '').substring(0, 400)
  }

  // Thomas' echte Post-Texte als Stil-Referenz
  const ownPostExamples = ownPosts
    .filter((p: any) => (p.caption || p.transcript))
    .slice(0, 8)
    .map((p: any) => {
      const text = clean([p.caption, p.transcript].filter(Boolean).join(' | '))
      return `[${(p.views_count || 0).toLocaleString()} Views]\n"${text}"`
    }).join('\n\n')

  // Positiv bewertete Karussell-Outputs
  const ratedExamples = topRatedCarousels
    .map((r: any) => {
      const preview = clean(r.content).substring(0, 300)
      return `Thema: "${r.topic}"\n${preview}…`
    }).join('\n\n---\n\n')

  const systemPrompt = `Du schreibst ausschließlich für Thomas Pfeffer — Fitness-Coach, DACH-Markt, Männer 30+.

Du bekommst Screenshots von Karussell-Slides. Deine Aufgabe: Den Inhalt dieser Slides 1:1 inhaltlich übernehmen und in Thomas' Schreibstil auf Deutsch neu formulieren.

══════════════════════════════════════════════════
PFLICHT-REGELN
══════════════════════════════════════════════════
• GLEICHE Message — keine Aussage verändern, weglassen oder hinzufügen
• GLEICHE Struktur — gleiche Anzahl Slides, gleiche Reihenfolge
• NUR die Formulierung ändert sich — in Thomas' Sprache, Thomas' Rhythmus
• Gib NUR den Slide-Text aus — kein Kommentar, keine Erklärung

══════════════════════════════════════════════════
SPRACHLICHE QUALITÄT — ABSOLUT KRITISCH
══════════════════════════════════════════════════
• Jeder Satz muss auf DEUTSCH grammatikalisch einwandfrei sein
• KEIN wörtlich übersetzter Satzbau aus dem Englischen
  VERBOTEN: "Das ist nicht, was du denkst." → RICHTIG: "Das meinst du falsch."
  VERBOTEN: "Hier ist, was du tun musst:" → RICHTIG: "Das musst du tun:"
  VERBOTEN: "Das ist nicht der Fall." → RICHTIG: "Das stimmt nicht."
• Englische Ausdrücke NUR wenn Thomas sie nachweislich nutzt (z.B. "Coaching", "Mindset")
• Kein Denglisch, kein aufgesetzter Influencer-Stil
• Lies jeden fertigen Satz laut durch: Klingt das wie ein Österreicher/Deutscher, der erklärt? Dann ist es richtig.

══════════════════════════════════════════════════
THOMAS' SCHREIBSTIL
══════════════════════════════════════════════════
${dna('style_rule') || '• Kurze, klare Sätze\n• Sachlich, kein Hype, keine leere Motivation\n• Du-Ansprache, direkt\n• Fakten und Mechanismen statt Phrasen'}

THOMAS' ZIELGRUPPE:
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich\n• Wollen Effizienz, keine Extremmethoden'}

THOMAS' HOOK-MUSTER:
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Konkrete Zahlen statt vage Aussagen'}

══════════════════════════════════════════════════
SO SCHREIBT THOMAS IN DER PRAXIS — LERNE SEINEN RHYTHMUS
══════════════════════════════════════════════════
Das sind echte Texte von Thomas. Sein Satzbau, seine Wortwahl, sein Rhythmus — das ist der Standard:

${ownPostExamples || 'Keine eigenen Posts verfügbar — schreibe sachlich, direkt, kurze Sätze, Du-Ansprache.'}

${ratedExamples ? `══════════════════════════════════════════════════
THOMAS HAT DIESE OUTPUTS GUT BEWERTET — SO KLINGT ES RICHTIG
══════════════════════════════════════════════════
${ratedExamples}` : ''}

FORMAT der Ausgabe (exakt so):
SLIDE [Nummer]:
[Text]`

  // Vision content blocks — jedes Bild als eigener Block
  const imageBlocks = (slides as any[]).map((s: any) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: s.mediaType || 'image/jpeg',
      data: s.base64,
    }
  }))

  const userPrompt = `Das sind ${slides.length} Slides eines Karussells (in der gezeigten Reihenfolge: Slide 1 bis Slide ${slides.length}).

SCHRITT 1 — Lies den Text auf jeder Slide genau. Verstehe die vollständige Message.
SCHRITT 2 — Formuliere jeden Slide-Text neu: gleiche Botschaft, Thomas' Stil, grammatikalisch einwandfreies Deutsch.
SCHRITT 3 — Lies jeden fertigen Satz durch: Klingt er natürlich auf Deutsch? Nicht wie eine Übersetzung?
${additional_info ? `\nKontext: ${additional_info}` : ''}

SLIDE [Nummer]:
[Text]`

  const messages = [{
    role: 'user',
    content: [
      ...imageBlocks,
      { type: 'text', text: userPrompt }
    ]
  }]

  let content = ''
  let lastErrContent = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt === 1 ? 8000 : 20000))
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 3000, system: systemPrompt, messages })
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

  // Titel aus SLIDE 1 ableiten — das ist der Hook, prägnant und aussagekräftig
  function extractTitle(text: string): string {
    const slide1Match = text.match(/SLIDE\s*1\s*:\s*\n?([\s\S]+?)(?=\nSLIDE\s*2|$)/i)
    if (!slide1Match) return ''
    const slide1 = slide1Match[1].trim()
    // Erste nicht-leere Zeile nehmen
    const firstLine = slide1.split('\n').map(l => l.trim()).find(l => l.length > 3) || ''
    // Max 70 Zeichen, an Wortgrenze kürzen
    if (firstLine.length <= 70) return firstLine
    const cut = firstLine.substring(0, 67)
    const lastSpace = cut.lastIndexOf(' ')
    return (lastSpace > 30 ? cut.substring(0, lastSpace) : cut) + '…'
  }

  const topic = label || extractTitle(content) || `Karussell-Kopie (${slides.length} Slides)`
  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/generated_content`, {
    method: 'POST',
    headers: dbHeaders(),
    body: JSON.stringify({ topic, content_type: 'carousel_copy', content, content_pillar: null })
  })
  const saved = await saveRes.json()
  const savedItem = Array.isArray(saved) ? saved[0] : saved

  return new Response(JSON.stringify({ content, id: savedItem?.id, topic }), {
    headers: { ...CORS, 'Content-Type': 'application/json' }
  })
})
