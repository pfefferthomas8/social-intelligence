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
    const { conversation_id, autonomy_mode, trigger_message } = await req.json()

    // Load conversation + last 20 messages
    const { data: conv } = await supabase
      .from('dm_conversations')
      .select('*')
      .eq('id', conversation_id)
      .single()

    const { data: messages } = await supabase
      .from('dm_messages')
      .select('*')
      .eq('conversation_id', conversation_id)
      .order('created_at', { ascending: true })
      .limit(20)

    // Load config
    const { data: configRows } = await supabase
      .from('dm_config')
      .select('key, value')

    const config: Record<string, string> = {}
    configRows?.forEach(c => { config[c.key] = c.value })

    const styleDna = config['style_dna'] || ''
    const primaryUrl = config['primary_product_url'] || 'https://www.thomas-pfeffer.com'
    const secondaryUrl = config['secondary_product_url'] || 'https://www.form-training.at'

    // Build conversation history for Claude
    const chatHistory = messages?.map(m => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    })) || []

    // System prompt
    const systemPrompt = `Du bist Thomas Pfeffer, ein erfolgreicher Fitness Coach aus dem DACH-Raum. Du antwortest auf Instagram DMs von potenziellen Kunden.

DEINE SCHREIBWEISE (basierend auf echten Chats):
${styleDna || 'Locker, direkt, authentisch. Kurze Sätze. Kein Marketing-Speak. Du bist Profi aber bodenständig.'}

DEINE PRODUKTE:
- Hauptprodukt: 1:1 Coaching (${primaryUrl}) — das ist IMMER dein primäres Ziel
- Sekundär: Form Training App (${secondaryUrl}) — nur wenn Coaching wirklich nicht passt (Budget, Situation)

VERKAUFSPHILOSOPHIE:
- Socratic Selling: Stelle gezielte Fragen damit der Lead selbst erkennt dass er Hilfe braucht
- Niemals pushen oder aufdränglich wirken
- Erst Vertrauen aufbauen, dann Offer
- Maximal 1-2 Fragen pro Nachricht
- Halte Nachrichten kurz — Instagram ist kein Email
- Einwände behandeln ohne zu drängen
- Den Link zu thomas-pfeffer.com erst schicken wenn der Moment reif ist (nicht zu früh)
- App nur pitchen wenn es wirklich Sinn macht (wenig Budget + hohe Motivation, keine Zeit für Intensivcoaching)

LEAD STATUS:
- Username: ${conv?.instagram_username}
- Aktuelle Stage: ${conv?.stage || 'qualification'}
- Lead Score: ${conv?.lead_score || 0}/100
- Heat: ${conv?.lead_heat || 'cold'}

WICHTIG:
- Antworte IMMER auf Deutsch (oder in der Sprache die der Lead verwendet)
- Sei Thomas — kein Roboter, kein Copy-Paste
- Kein "Als KI..." oder ähnliches
- Deine Antwort ist eine echte Instagram DM`

    // Get Claude's response
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 300,
      system: systemPrompt,
      messages: chatHistory.length > 0 ? chatHistory : [
        { role: 'user', content: trigger_message }
      ],
    })

    const suggestion = response.content[0].type === 'text' ? response.content[0].text : ''

    // Get Claude's reasoning separately
    const reasoningResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 150,
      system: 'Du bist ein Sales-Stratege. Erkläre in 1-2 Sätzen auf Deutsch warum diese Antwort die richtige Strategie ist.',
      messages: [
        { role: 'user', content: `Chat-Verlauf: ${chatHistory.slice(-4).map(m => `${m.role}: ${m.content}`).join('\n')}\n\nMeine vorgeschlagene Antwort: ${suggestion}` }
      ],
    })

    const reasoning = reasoningResponse.content[0].type === 'text' ? reasoningResponse.content[0].text : ''

    // Save suggestion to latest inbound message
    const lastInbound = messages?.filter(m => m.direction === 'inbound').pop()
    if (lastInbound) {
      await supabase.from('dm_messages').update({
        claude_suggestion: suggestion,
        claude_reasoning: reasoning,
      }).eq('id', lastInbound.id)
    }

    // Update conversation stage based on content
    const newStage = detectStage(trigger_message, conv?.stage)
    if (newStage !== conv?.stage) {
      await supabase.from('dm_conversations').update({ stage: newStage }).eq('id', conversation_id)
    }

    // Autonomy Mode A = suggest only, B = suggest + notify, C = auto-send
    if (autonomy_mode === 'C') {
      // Auto-send via ManyChat API
      const manychatKey = config['manychat_api_key']
      if (manychatKey && conv?.manychat_contact_id) {
        await sendViaManyChat(manychatKey, conv.manychat_contact_id, suggestion)

        // Log as outbound
        await supabase.from('dm_messages').insert({
          conversation_id,
          direction: 'outbound',
          content: suggestion,
          sent_by: 'claude',
          status: 'sent',
        })
      }
    }

    return new Response(JSON.stringify({ ok: true, suggestion, reasoning }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('dm-reply error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

async function sendViaManyChat(apiKey: string, subscriberId: string, text: string) {
  return fetch('https://api.manychat.com/fb/sending/sendContent', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [{ type: 'text', text }],
        },
      },
      message_tag: 'ACCOUNT_UPDATE',
    }),
  })
}

function detectStage(message: string, currentStage: string): string {
  const lower = message.toLowerCase()

  if (/preis|kosten|was kostet|wie viel|invest/i.test(lower)) return 'offer'
  if (/wann|start|anfangen|wie geht|nächste schritt/i.test(lower)) return 'closing'
  if (/interesse|würde gerne|klingt gut|cool|mega/i.test(lower)) return 'interest'
  if (/aber|trotzdem|nicht sicher|überlegen|teuer/i.test(lower)) return 'objection'

  return currentStage || 'qualification'
}
