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

  // Thomas DNA für Stil-Kontext laden
  const thomasDna = await dbQuery('thomas_dna?select=category,insight,confidence&order=confidence.desc&limit=25')
  const dnaByCategory: Record<string, any[]> = {}
  for (const d of thomasDna) {
    if (!dnaByCategory[d.category]) dnaByCategory[d.category] = []
    dnaByCategory[d.category].push(d)
  }
  const dna = (cat: string) => (dnaByCategory[cat] || []).map((d: any) => `• ${d.insight}`).join('\n')

  const systemPrompt = `Du schreibst ausschließlich für Thomas Pfeffer — Fitness-Coach, DACH-Markt, Männer 30+.

Du bekommst Screenshots von Karussell-Slides eines anderen Creators.
Deine einzige Aufgabe: Den Inhalt dieser Slides 1:1 in Thomas' Schreibstil und Sprache neu formulieren.

REGELN:
• GLEICHE Message — keine Aussage verändern, weglassen oder hinzufügen
• GLEICHE Struktur — gleiche Anzahl Slides, gleiche Slide-Reihenfolge
• NUR die Formulierung ändert sich — in Thomas' Deutsch, Thomas' Rhythmus
• Nicht kreativ werden — es geht ums Übersetzen in seinen Stil, nicht ums Neuerfinden
• Gib NUR den Slide-Text aus — kein Kommentar, keine Erklärung, keine Meta-Infos

THOMAS' SCHREIBSTIL:
${dna('style_rule') || '• Kurze, klare Sätze als Stilmittel\n• Sachlich, kein Hype, keine leere Motivation\n• Du-Ansprache, direkt\n• Fakten und Mechanismen statt Phrasen'}

THOMAS' ZIELGRUPPE:
${dna('audience_pattern') || '• Männer 30–55, beruflich erfolgreich\n• Wollen Effizienz bei Training und Ernährung\n• Smarte Lösungen, keine Extremmethoden'}

THOMAS' HOOK-MUSTER:
${dna('hook_pattern') || '• Du-Ansprache + Paradoxon\n• Validierung vor Lösung\n• Konkrete Zahlen statt vage Aussagen'}

FORMAT der Ausgabe (exakt so, keine Abweichungen):
SLIDE [Nummer]:
[Text der Slide]`

  // Vision content blocks — jedes Bild als eigener Block
  const imageBlocks = (slides as any[]).map((s: any) => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: s.mediaType || 'image/jpeg',
      data: s.base64,
    }
  }))

  const userPrompt = `Das sind ${slides.length} Slides eines Karussells (Slide 1 bis Slide ${slides.length} in der angezeigten Reihenfolge).

Lies den Text auf jeder Slide genau. Schreibe ihn dann 1:1 in Thomas' Schreibstil um — gleiche Botschaft, gleiche Slide-Anzahl.
${additional_info ? `\nKontext / Hinweis: ${additional_info}` : ''}

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

  const topic = label || `Karussell-Kopie (${slides.length} Slides)`
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
