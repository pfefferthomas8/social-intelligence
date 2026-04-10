import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// German/Austrian female name list for detection
const FEMALE_NAMES = new Set([
  'anna','maria','laura','julia','sarah','lisa','katharina','sandra','andrea','stefanie',
  'nicole','petra','claudia','martina','jessica','jennifer','christina','melanie','franziska',
  'barbara','susanne','monika','bianca','sabrina','vanessa','lena','lea','emma','mia','hannah',
  'sophie','charlotte','marie','kathrin','michaela','daniela','verena','simone','marina',
  'magdalena','theresa','teresa','eva','jasmin','nina','carina','natalie','tanja','sonja',
  'britta','silvia','gabi','gabriele','renate','ursula','hilde','hildegard','elke','inge',
  'helga','gisela','christa','karin','bettina','nadine','manuela','anja','anne','antonia',
  'alina','amelie','emilia','luisa','louisa','valentina','viktoria','victoria','nathalie',
  'anika','annika','jana','jana','kim','tina','vera','yvonne','zoe','zoé','stella','isabella'
])

const MALE_NAMES = new Set([
  'thomas','michael','stefan','christian','daniel','martin','alexander','andreas','markus',
  'florian','tobias','sebastian','patrick','philipp','david','simon','manuel','lukas','jakob',
  'felix','maximilian','max','moritz','jonas','jan','tim','tom','kevin','marco','mario',
  'dominic','dominik','fabian','gabriel','georg','gerald','günter','hans','heinz','helmut',
  'herbert','horst','joachim','johannes','jürgen','karl','kurt','lars','leo','leopold','louis',
  'luis','matthias','niklas','nikolaus','oliver','oskar','paul','peter','rafael','rainer',
  'reinhard','robert','roland','roman','rudi','rudolf','siegfried','stefan','stephan',
  'tobias','ulrich','uwe','valentin','walter','werner','wilhelm','wolfang','christoph',
  'ben','leon','noah','luca','luka','elias','erik','erik','finn','julian','kevin','nico',
  'nicolas','oliver','pascal','raphael','robin','sven','timo','vincent'
])

function detectGender(name: string, manychatGender?: string): string {
  // ManyChat sometimes provides gender directly
  if (manychatGender) {
    const g = manychatGender.toLowerCase()
    if (g === 'female' || g === 'f') return 'female'
    if (g === 'male' || g === 'm') return 'male'
  }

  if (!name) return 'unknown'

  const firstName = name.trim().split(' ')[0].toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove diacritics

  if (FEMALE_NAMES.has(firstName)) return 'female'
  if (MALE_NAMES.has(firstName)) return 'male'
  return 'unknown'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } })
  }

  try {
    const body = await req.json()
    console.log('ManyChat webhook received:', JSON.stringify(body))

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
      const manychatGender = contact?.gender || null

      if (!contactId || !messageText) {
        return new Response(JSON.stringify({ ok: true, skipped: true }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Detect gender
      const gender = detectGender(displayName, manychatGender)

      // Upsert conversation — only set gender if not already known
      const { data: existingConv } = await supabase
        .from('dm_conversations')
        .select('id, claude_enabled, autonomy_mode, lead_score, gender, claude_blocked')
        .eq('manychat_contact_id', contactId)
        .single()

      const finalGender = (existingConv?.gender && existingConv.gender !== 'unknown')
        ? existingConv.gender
        : gender

      // Auto-block females: claude_blocked = true if female
      const autoBlocked = finalGender === 'female'

      const { data: conv, error: convErr } = await supabase
        .from('dm_conversations')
        .upsert({
          manychat_contact_id: contactId,
          instagram_username: username,
          display_name: displayName,
          profile_pic_url: profilePic,
          gender: finalGender,
          claude_blocked: existingConv ? existingConv.claude_blocked : autoBlocked,
          last_message_at: new Date().toISOString(),
          last_message_preview: messageText.slice(0, 100),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'manychat_contact_id', ignoreDuplicates: false })
        .select('id, claude_enabled, autonomy_mode, lead_score, claude_blocked, gender')
        .single()

      if (convErr) {
        console.error('Conv upsert error:', convErr)
        throw convErr
      }

      // Insert message
      await supabase.from('dm_messages').insert({
        conversation_id: conv.id,
        manychat_message_id: messageId,
        direction,
        content: messageText,
        sent_by: direction === 'inbound' ? 'user' : 'thomas',
      })

      // Update lead score
      const scoreIncrease = calculateScoreIncrease(messageText)
      if (scoreIncrease > 0) {
        const newScore = Math.min(100, (conv.lead_score || 0) + scoreIncrease)
        const heat = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold'
        await supabase.from('dm_conversations').update({
          lead_score: newScore,
          lead_heat: heat,
        }).eq('id', conv.id)
      }

      // Skip Claude if blocked (female) or not enabled
      if (conv.claude_blocked) {
        console.log(`Claude blocked for ${displayName} (${finalGender}) — skipping`)
        return new Response(JSON.stringify({ ok: true, conversation_id: conv.id, claude_skipped: 'blocked' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      }

      // Check global config
      const { data: config } = await supabase
        .from('dm_config')
        .select('key, value')
        .in('key', ['global_claude_enabled', 'default_autonomy_mode'])

      const configMap: Record<string, string> = {}
      config?.forEach(c => { configMap[c.key] = c.value })

      const globalEnabled = configMap['global_claude_enabled'] === 'true'
      const claudeEnabled = conv.claude_enabled || globalEnabled

      if (claudeEnabled && direction === 'inbound') {
        const autonomyMode = conv.autonomy_mode || configMap['default_autonomy_mode'] || 'B'
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

      return new Response(JSON.stringify({ ok: true, conversation_id: conv.id, gender: finalGender }), {
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
  if (/preis|kosten|was kostet|wie viel|invest/i.test(lower)) score += 20
  if (/interesse|interessiert|würde gerne|möchte|will/i.test(lower)) score += 15
  if (/abnehm|gewicht|kilo|kg|fett|muskel|training|coaching/i.test(lower)) score += 10
  if (/wann|start|anfangen|beginnen|wie geht/i.test(lower)) score += 15
  if (/hilf|helfen|brauche|problem/i.test(lower)) score += 10
  if (text.length > 100) score += 5
  if (text.includes('?')) score += 5
  return score
}
