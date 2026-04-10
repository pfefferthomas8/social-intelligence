import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const body = await req.json()
    console.log('ManyChat webhook received:', JSON.stringify(body))

    // ManyChat sends different event types
    const { type, data } = body

    if (type === 'message' || type === 'new_message') {
      const contact = data?.contact || data?.subscriber
      const message = data?.message || data

      const contactId = contact?.id?.toString() || contact?.subscriber_id?.toString()
      const username = contact?.instagram_username || contact?.name || 'unknown'
      const displayName = contact?.name || username
      const profilePic = contact?.profile_pic || null
      const messageText = message?.text || message?.content || ''
      const messageId = message?.id?.toString() || null
      const direction = data?.direction || 'inbound'

      if (!contactId || !messageText) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Upsert conversation
      const { data: conv, error: convErr } = await supabase
        .from('dm_conversations')
        .upsert({
          manychat_contact_id: contactId,
          instagram_username: username,
          display_name: displayName,
          profile_pic_url: profilePic,
          last_message_at: new Date().toISOString(),
          last_message_preview: messageText.slice(0, 100),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'manychat_contact_id', ignoreDuplicates: false })
        .select('id, claude_enabled, autonomy_mode, lead_score')
        .single()

      if (convErr) {
        console.error('Conv upsert error:', convErr)
        throw convErr
      }

      // Insert message
      await supabase.from('dm_messages').insert({
        conversation_id: conv.id,
        manychat_message_id: messageId,
        direction: direction,
        content: messageText,
        sent_by: direction === 'inbound' ? 'user' : 'thomas',
      })

      // Update lead score based on message content
      const scoreIncrease = calculateScoreIncrease(messageText)
      if (scoreIncrease > 0) {
        const newScore = Math.min(100, (conv.lead_score || 0) + scoreIncrease)
        const heat = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold'
        await supabase.from('dm_conversations').update({
          lead_score: newScore,
          lead_heat: heat,
        }).eq('id', conv.id)
      }

      // Check global config & per-chat claude_enabled
      const { data: config } = await supabase
        .from('dm_config')
        .select('key, value')
        .in('key', ['global_claude_enabled', 'default_autonomy_mode'])

      const configMap: Record<string, string> = {}
      config?.forEach(c => { configMap[c.key] = c.value })

      const globalEnabled = configMap['global_claude_enabled'] === 'true'
      const claudeEnabled = conv.claude_enabled || globalEnabled

      // Only trigger Claude reply for inbound messages
      if (claudeEnabled && direction === 'inbound') {
        const autonomyMode = conv.autonomy_mode || configMap['default_autonomy_mode'] || 'B'

        // Trigger dm-reply function
        await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/dm-reply`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            conversation_id: conv.id,
            autonomy_mode: autonomyMode,
            trigger_message: messageText,
          }),
        })
      }

      return new Response(JSON.stringify({ ok: true, conversation_id: conv.id }), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
})

function calculateScoreIncrease(text: string): number {
  const lower = text.toLowerCase()
  let score = 0

  // High intent signals
  if (/preis|kosten|was kostet|wie viel|invest/i.test(lower)) score += 20
  if (/interesse|interessiert|würde gerne|möchte|will/i.test(lower)) score += 15
  if (/abnehm|gewicht|kilo|kg|fett|muskel|training|coaching/i.test(lower)) score += 10
  if (/wann|start|anfangen|beginnen|wie geht/i.test(lower)) score += 15
  if (/hilf|helfen|brauche|problem/i.test(lower)) score += 10

  // Engagement signals
  if (text.length > 100) score += 5
  if (text.includes('?')) score += 5

  return score
}
