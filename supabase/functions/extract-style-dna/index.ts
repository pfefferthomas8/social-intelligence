import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.27.0'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! })

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const { messages_sample } = await req.json()

    // messages_sample = Array of strings (Thomas's sent messages from ManyChat export)
    // or we use existing dm_messages from our DB (sent_by = 'thomas')

    let sampleMessages = messages_sample || []

    if (sampleMessages.length === 0) {
      // Pull from our own DB — Thomas's sent messages
      const { data } = await supabase
        .from('dm_messages')
        .select('content')
        .eq('sent_by', 'thomas')
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(100)

      sampleMessages = data?.map(m => m.content) || []
    }

    if (sampleMessages.length < 5) {
      return new Response(JSON.stringify({
        error: 'Zu wenige Nachrichten für Style-Analyse. Mindestens 5 eigene Nachrichten nötig.'
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
    }

    const sample = sampleMessages.slice(0, 80).join('\n---\n')

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Analysiere diese echten Instagram DM-Nachrichten von Thomas Pfeffer (Fitness Coach, DACH-Markt). Extrahiere sein genaues Schreibstil-Profil.

NACHRICHTEN:
${sample}

Erstelle ein kompaktes Style-DNA Profil (max. 300 Wörter) mit:
1. Satzbau & Länge (kurz/lang, Struktur)
2. Tonalität (locker/formal, Nähe zum Lead)
3. Typische Phrasen & Formulierungen die er verwendet
4. Emoji-Nutzung (ob, welche, wie oft)
5. Wie er Fragen stellt
6. Wie er auf Interesse reagiert
7. Was er NIE schreibt / vermeidet

Format: Fließtext, direkt als Schreibanweisung formuliert ("Thomas schreibt...").`
      }],
    })

    const styleDna = response.content[0].type === 'text' ? response.content[0].text : ''

    // Save to config
    await supabase.from('dm_config')
      .update({ value: styleDna, updated_at: new Date().toISOString() })
      .eq('key', 'style_dna')

    return new Response(JSON.stringify({ ok: true, style_dna: styleDna }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('extract-style-dna error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
