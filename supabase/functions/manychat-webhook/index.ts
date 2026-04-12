const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
    'Prefer': 'return=representation',
  }
}

async function dbGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: dbHeaders() })
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

async function dbUpsert(table: string, body: any, onConflict: string): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': `resolution=merge-duplicates,return=representation`, 'on-conflict': onConflict },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return Array.isArray(data) ? data[0] : data
}

async function dbPost(table: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function dbPatch(table: string, filter: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

// AT/DE female names for gender detection
const FEMALE_NAMES = new Set([
  'anna','maria','laura','julia','sarah','lisa','katharina','sandra','andrea','stefanie',
  'nicole','petra','claudia','martina','jessica','jennifer','christina','melanie','franziska',
  'barbara','susanne','monika','bianca','sabrina','vanessa','lena','lea','emma','mia','hannah',
  'sophie','charlotte','marie','kathrin','michaela','daniela','verena','simone','marina',
  'magdalena','theresa','teresa','eva','jasmin','nina','carina','natalie','tanja','sonja',
  'britta','silvia','gabi','gabriele','renate','ursula','hilde','elke','inge','helga','gisela',
  'christa','karin','bettina','nadine','manuela','anja','anne','antonia','alina','amelie',
  'emilia','luisa','louisa','valentina','viktoria','victoria','nathalie','anika','annika',
  'jana','kim','tina','vera','yvonne','zoe','stella','isabella','johanna','veronika','stefania',
  'sabine','sandra','miriam','steffi','anni','leni','nora','pia','rosi','trudi','liesel',
])

function detectGender(name: string, username: string, manychatGender?: string): string {
  if (manychatGender) {
    const g = manychatGender.toLowerCase()
    if (g === 'female' || g === 'f') return 'female'
    if (g === 'male' || g === 'm') return 'male'
  }

  const combined = `${name} ${username}`.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  if (/\bmrs[\.\s]|^mrs$|\bms[\.\s]|^ms$|\bfrau\b|\blady\b|\bgirl\b|\bshe\b|\bher\b/.test(combined)) return 'female'
  if (/\bmr[\.\s]|^mr$|\bherr\b|\bsir\b|\bhe\b|\bhim\b/.test(combined)) return 'male'
  if (/girl|woman|women|lady|mama|mami|mutti|mutter|queen|princess|beautymom|babygirl/.test(combined)) return 'female'
  if (/guy|man|boy|papa|daddy|king|prince|bro|bruder/.test(combined)) return 'male'

  if (!name) return 'unknown'
  const firstName = name.trim().split(/[\s\.\_]/)[0].toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  if (FEMALE_NAMES.has(firstName)) return 'female'

  return 'unknown'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    // Extract campaign ID from URL query params
    const url = new URL(req.url)
    const campaignId = url.searchParams.get('campaign') || null

    const body = await req.json()
    console.log('ManyChat webhook:', JSON.stringify(body).slice(0, 300), 'campaign:', campaignId)

    const { type, data } = body
    if (type !== 'message' && type !== 'new_message') {
      return new Response(JSON.stringify({ ok: true, skipped: 'not a message event' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const contact = data?.contact || data?.subscriber
    const message = data?.message || data

    const contactId = String(contact?.id || contact?.subscriber_id || '')
    const displayName = contact?.name || 'Unbekannt'
    const username = contact?.instagram_username || displayName.toLowerCase().replace(/\s+/g, '_')
    const profilePic = contact?.profile_pic || null
    const messageText = message?.text || message?.content || ''
    const messageId = String(message?.id || '')
    const direction = data?.direction || 'inbound'
    const manychatGender = contact?.gender || null

    if (!contactId || !messageText) {
      return new Response(JSON.stringify({ ok: true, skipped: 'missing contactId or text' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Detect gender
    const gender = detectGender(displayName, username, manychatGender)
    const autoBlocked = gender === 'female'

    // Load existing conversation
    const existing = await dbGet(`dm_conversations?manychat_contact_id=eq.${contactId}&limit=1`)
    const existingConv = existing[0] || null

    const finalGender = existingConv?.gender && existingConv.gender !== 'unknown'
      ? existingConv.gender : gender
    const claudeBlocked = existingConv !== null
      ? existingConv.claude_blocked
      : autoBlocked

    // Upsert conversation — tag with campaign_id if new and campaign present
    const convData: any = {
      manychat_contact_id: contactId,
      instagram_username: username,
      display_name: displayName,
      profile_pic_url: profilePic,
      gender: finalGender,
      claude_blocked: claudeBlocked,
      last_message_at: new Date().toISOString(),
      last_message_preview: messageText.slice(0, 100),
      updated_at: new Date().toISOString(),
    }
    // Only set campaign_id on new conversations (don't overwrite on existing)
    if (!existingConv && campaignId) {
      convData.campaign_id = campaignId
    }

    const conv = await dbUpsert('dm_conversations', convData, 'manychat_contact_id')
    if (!conv?.id) throw new Error('Failed to upsert conversation')

    // If NEW conversation + inbound: look up opening message
    // Priority: campaign opening message > no opening message (organic inbound)
    if (!existingConv && direction === 'inbound') {
      let openingMsg = ''

      if (campaignId) {
        // Load campaign-specific opening message
        const campaigns = await dbGet(`dm_campaigns?id=eq.${campaignId}&limit=1`)
        const campaign = campaigns[0]
        if (campaign?.opening_message?.trim()) {
          openingMsg = campaign.opening_message.trim()
        }
      }
      // No campaignId = organic inbound = no opening message (they wrote first)

      if (openingMsg) {
        await dbPost('dm_messages', {
          conversation_id: conv.id,
          direction: 'outbound',
          content: openingMsg,
          sent_by: 'thomas',
          status: 'sent',
        })
      }
    }

    // Insert the actual message
    await dbPost('dm_messages', {
      conversation_id: conv.id,
      manychat_message_id: messageId || null,
      direction,
      content: messageText,
      sent_by: direction === 'inbound' ? 'user' : 'thomas',
    })

    // Update lead score
    const scoreIncrease = calculateScore(messageText)
    if (scoreIncrease > 0) {
      const newScore = Math.min(100, (conv.lead_score || 0) + scoreIncrease)
      const heat = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold'
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { lead_score: newScore, lead_heat: heat })
    }

    // Skip Claude if blocked
    if (claudeBlocked) {
      console.log(`Blocked (${finalGender}): ${displayName}`)
      return new Response(JSON.stringify({ ok: true, conversation_id: conv.id, claude_skipped: 'blocked' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Load config
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    configRows.forEach((c: any) => { config[c.key] = c.value })

    const globalEnabled = config['global_claude_enabled'] === 'true'
    const claudeEnabled = conv.claude_enabled || globalEnabled

    if (claudeEnabled && direction === 'inbound') {
      const autonomyMode = conv.autonomy_mode || config['default_autonomy_mode'] || 'B'
      fetch(`${SUPABASE_URL}/functions/v1/dm-reply`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: conv.id, autonomy_mode: autonomyMode, trigger_message: messageText }),
      }).catch(console.error)
    }

    return new Response(JSON.stringify({ ok: true, conversation_id: conv.id, gender: finalGender, campaign_id: campaignId }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})

function calculateScore(text: string): number {
  let score = 0
  if (/preis|kosten|was kostet|wie viel|invest/i.test(text)) score += 20
  if (/interesse|interessiert|würde gerne|möchte|will/i.test(text)) score += 15
  if (/abnehm|gewicht|kilo|kg|fett|muskel|training|coaching/i.test(text)) score += 10
  if (/wann|start|anfangen|beginnen|wie geht/i.test(text)) score += 15
  if (/hilf|helfen|brauche|problem/i.test(text)) score += 10
  if (text.length > 100) score += 5
  if (text.includes('?')) score += 5
  return score
}
