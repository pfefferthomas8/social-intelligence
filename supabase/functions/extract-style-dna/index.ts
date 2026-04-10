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
    const body = await req.json().catch(() => ({}))
    let sampleMessages: string[] = body.messages_sample || []
    let sourceUsed = ''

    // Prio 1: Manually provided messages
    if (sampleMessages.length >= 5) {
      sourceUsed = 'manual'
    }

    // Prio 2: Thomas's sent DMs from our DB
    if (sampleMessages.length < 5) {
      const { data: dmMessages } = await supabase
        .from('dm_messages')
        .select('content')
        .eq('sent_by', 'thomas')
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(100)

      if (dmMessages && dmMessages.length >= 5) {
        sampleMessages = dmMessages.map(m => m.content)
        sourceUsed = 'dm_messages'
      }
    }

    // Prio 3: Thomas's own Instagram posts/captions
    if (sampleMessages.length < 5) {
      const { data: posts } = await supabase
        .from('instagram_posts')
        .select('caption, transcript')
        .eq('source', 'own')
        .not('caption', 'is', null)
        .order('likes_count', { ascending: false })
        .limit(50)

      if (posts && posts.length > 0) {
        const captions = posts
          .map(p => p.caption || p.transcript || '')
          .filter(c => c.length > 20)
        sampleMessages = [...sampleMessages, ...captions]
        sourceUsed = sampleMessages.length >= 5 ? 'instagram_posts' : 'instagram_posts_partial'
      }
    }

    if (sampleMessages.length < 3) {
      // Fallback: use hardcoded base style for Thomas
      const fallbackDna = `Thomas schreibt sehr direkt und authentisch. Kurze, klare Sätze — maximal 2-3 Sätze pro Nachricht. Kein Marketing-Speak, keine leeren Phrasen. Er redet Männer auf Augenhöhe an, nicht von oben herab. Er stellt gezielte Fragen um die Situation zu verstehen, nie mehrere Fragen auf einmal. Bei Interesse zeigt er echtes Engagement, ohne sofort zu pitchen. Er nutzt gelegentlich Emojis aber sparsam (🔥 💪 wenn es passt). Seine Sprache ist österreichisch-deutsch, keine Anglizismen außer Fitness-Begriffe (Training, Coaching, Reps). Er schreibt wie er spricht — locker aber professionell. Er sagt nie "als Coach würde ich empfehlen" sondern eher "schreib mir kurz was dein Ziel ist" oder "was hast du bisher probiert?"`

      await supabase.from('dm_config')
        .update({ value: fallbackDna, updated_at: new Date().toISOString() })
        .eq('key', 'style_dna')

      return new Response(JSON.stringify({
        ok: true,
        style_dna: fallbackDna,
        source: 'fallback',
        message: 'Basis-Stil eingesetzt. Wird präziser wenn erste DMs über das System laufen.'
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const sample = sampleMessages.slice(0, 80).join('\n---\n')

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Analysiere diese Texte von Thomas Pfeffer (Fitness Coach, DACH-Markt, Österreich). Quelle: ${sourceUsed === 'instagram_posts' ? 'Instagram Posts/Captions' : 'DM-Nachrichten'}.

TEXTE:
${sample}

Erstelle ein kompaktes Style-DNA Profil (max. 250 Wörter) als direkte Schreibanweisung für eine KI die Thomas imitieren soll. Fokus auf:
1. Satzbau & Länge (wie kurz/lang, Struktur)
2. Tonalität & Nähe zum Leser
3. Typische Phrasen & Formulierungen die er nutzt
4. Emoji-Nutzung (welche, wie oft)
5. Wie er Fragen stellt
6. Was er NICHT schreibt / vermeidet
7. Regionale Eigenheiten (österreichisches Deutsch?)

Formuliere alles als Anweisung: "Thomas schreibt..." / "Er verwendet..." / "Er vermeidet..."`
      }],
    })

    const styleDna = response.content[0].type === 'text' ? response.content[0].text : ''

    await supabase.from('dm_config')
      .update({ value: styleDna, updated_at: new Date().toISOString() })
      .eq('key', 'style_dna')

    return new Response(JSON.stringify({
      ok: true,
      style_dna: styleDna,
      source: sourceUsed,
      samples_used: sampleMessages.length
    }), { headers: { 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('extract-style-dna error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})
