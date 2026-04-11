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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { conversation_id, text, sent_by = 'thomas' } = await req.json()

    if (!conversation_id || !text?.trim()) {
      return new Response(JSON.stringify({ error: 'conversation_id and text required' }), {
        status: 400, headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Load conversation
    const convArr = await dbGet(`dm_conversations?id=eq.${conversation_id}&limit=1`)
    const conv = convArr[0]
    if (!conv) throw new Error('Conversation not found')

    // Load ManyChat API key from config
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    configRows.forEach((c: any) => { config[c.key] = c.value })

    const manychatKey = config['manychat_api_key']
    const flowNs = config['manychat_flow_ns']
    let manychatSent = false
    let manychatError = null

    // Send via ManyChat: set custom field + trigger flow
    if (manychatKey && flowNs && conv.manychat_contact_id) {
      try {
        // Step 1: set claude_reply custom field
        const fieldRes = await fetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${manychatKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subscriber_id: conv.manychat_contact_id,
            field_name: 'claude_reply',
            field_value: text.trim(),
          }),
        })
        const fieldData = await fieldRes.json()
        if (fieldData.status !== 'success') throw new Error(`setCustomField failed: ${fieldData.message}`)

        // Step 2: trigger flow that sends {{claude_reply}}
        const flowRes = await fetch('https://api.manychat.com/fb/sending/sendFlow', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${manychatKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscriber_id: conv.manychat_contact_id, flow_ns: flowNs }),
        })
        const flowData = await flowRes.json()
        if (flowData.status === 'success') {
          manychatSent = true
        } else {
          manychatError = flowData.message || JSON.stringify(flowData)
          console.error('sendFlow error:', JSON.stringify(flowData))
        }
      } catch (err: any) {
        manychatError = err.message
        console.error('ManyChat send error:', err)
      }
    } else {
      manychatError = !manychatKey ? 'No ManyChat API key' : !flowNs ? 'No flow NS configured' : 'No manychat_contact_id'
    }

    // Save message to DB regardless of ManyChat result
    await dbPost('dm_messages', {
      conversation_id,
      direction: 'outbound',
      content: text.trim(),
      sent_by,
      status: manychatSent ? 'sent' : 'draft',
    })

    // Update conversation preview
    await dbPatch('dm_conversations', `id=eq.${conversation_id}`, {
      last_message_at: new Date().toISOString(),
      last_message_preview: text.trim().slice(0, 100),
      updated_at: new Date().toISOString(),
    })

    return new Response(JSON.stringify({
      ok: true,
      manychat_sent: manychatSent,
      manychat_error: manychatError,
    }), { headers: { ...CORS, 'Content-Type': 'application/json' } })

  } catch (err: any) {
    console.error('dm-send error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
