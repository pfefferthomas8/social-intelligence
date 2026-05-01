const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:thomas@thomas-pfeffer.com'

function dbHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'apikey': SERVICE_KEY,
  }
}

// Base64url encode a Uint8Array
function base64urlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// Base64url decode to Uint8Array
function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '=='.slice(0, (4 - base64.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function buildVapidJwt(endpointOrigin: string): Promise<string> {
  const header = base64urlEncode(new TextEncoder().encode(JSON.stringify({ alg: 'ES256', typ: 'JWT' })))
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: endpointOrigin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: VAPID_SUBJECT,
  })))

  const signingInput = `${header}.${payload}`

  // Import VAPID private key (pkcs8 base64url)
  const keyBytes = base64urlDecode(VAPID_PRIVATE_KEY)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  )

  const sigBytes = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    cryptoKey,
    new TextEncoder().encode(signingInput)
  )

  const sig = base64urlEncode(new Uint8Array(sigBytes))
  return `${signingInput}.${sig}`
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { title = 'DM Center', body = 'Neue Nachricht', url = '/dm-center' } = await req.json()

    // Lade push_subscription aus dm_config
    const res = await fetch(`${SUPABASE_URL}/rest/v1/dm_config?key=eq.push_subscription&select=value`, {
      headers: dbHeaders(),
    })
    const rows = await res.json()
    if (!rows?.length || !rows[0]?.value) {
      console.log('Keine push_subscription in dm_config gespeichert')
      return new Response(JSON.stringify({ ok: false, error: 'no_subscription' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    let subscription: any
    try {
      subscription = typeof rows[0].value === 'string' ? JSON.parse(rows[0].value) : rows[0].value
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'invalid_subscription_json' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const endpoint = subscription.endpoint
    if (!endpoint) {
      return new Response(JSON.stringify({ ok: false, error: 'missing_endpoint' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    const endpointOrigin = new URL(endpoint).origin

    // Baue VAPID Auth Header
    let authHeader: string
    if (VAPID_PRIVATE_KEY && VAPID_PUBLIC_KEY) {
      try {
        const jwt = await buildVapidJwt(endpointOrigin)
        authHeader = `vapid t=${jwt},k=${VAPID_PUBLIC_KEY}`
      } catch (e: any) {
        console.error('VAPID JWT Fehler:', e.message)
        authHeader = `vapid t=invalid,k=${VAPID_PUBLIC_KEY}`
      }
    } else {
      console.warn('VAPID keys nicht gesetzt — Push ohne Auth (wird wahrscheinlich scheitern)')
      authHeader = ''
    }

    // Payload als JSON-String (unverschlüsselt — für Chrome/Android ausreichend)
    const pushPayload = JSON.stringify({ title, body, url })
    const payloadBytes = new TextEncoder().encode(pushPayload)

    const pushHeaders: Record<string, string> = {
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    }
    if (authHeader) pushHeaders['Authorization'] = authHeader

    const pushRes = await fetch(endpoint, {
      method: 'POST',
      headers: pushHeaders,
      body: payloadBytes,
    })

    if (!pushRes.ok) {
      const text = await pushRes.text()
      console.error(`Push fehlgeschlagen: ${pushRes.status} ${text}`)
      return new Response(JSON.stringify({ ok: false, error: `push_failed_${pushRes.status}`, detail: text }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    console.log(`Push erfolgreich: "${title}" → ${endpoint.slice(0, 60)}...`)
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...CORS, 'Content-Type': 'application/json' }
    })

  } catch (err: any) {
    console.error('send-push error:', err)
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
