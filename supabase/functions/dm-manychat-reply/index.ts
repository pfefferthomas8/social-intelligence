const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || ''
const CLAUDE_MODEL = Deno.env.get('CLAUDE_MODEL') || 'claude-sonnet-4-5'

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

async function dbUpsertConversation(body: any): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/dm_conversations`, {
    method: 'POST',
    headers: {
      ...dbHeaders(),
      'Prefer': 'resolution=merge-duplicates,return=representation',
      'on-conflict': 'manychat_contact_id',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  console.log('upsert conv response status:', res.status, 'data:', JSON.stringify(data).slice(0, 200))
  return Array.isArray(data) ? data[0] : data
}

async function dbInsert(table: string, body: any): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    console.error(`dbInsert ${table} failed:`, res.status, text)
  }
}

async function dbPatch(table: string, filter: string, body: any): Promise<void> {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...dbHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(body),
  })
}

async function callClaude(system: string, messages: any[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 300, system, messages }),
  })
  const data = await res.json()
  return data.content?.[0]?.text || ''
}

const FEMALE_NAMES = new Set([
  // Deutsch/Österreich
  'anna','marie','maria','laura','julia','sarah','lisa','katharina','sandra','andrea','stefanie',
  'nicole','petra','claudia','martina','jessica','jennifer','christina','melanie','franziska',
  'barbara','susanne','monika','bianca','sabrina','vanessa','lena','lea','emma','mia','hannah',
  'sophie','charlotte','kathrin','michaela','daniela','verena','simone','marina','magdalena',
  'theresa','teresa','eva','jasmin','nina','carina','natalie','tanja','sonja','britta','silvia',
  'gabi','gabriele','renate','ursula','hilde','elke','inge','helga','gisela','christa','karin',
  'bettina','nadine','manuela','anja','anne','antonia','alina','amelie','emilia','luisa','louisa',
  'valentina','viktoria','victoria','nathalie','anika','annika','jana','kim','tina','vera',
  'yvonne','zoe','stella','isabella','johanna','veronika','lisa','kathrin','steffi','susi',
  'rosi','trudi','heidi','elli','uta','ina','ida','pia','mia','lea','nea','fea',
  // International/English
  'jennifer','jessica','ashley','amanda','stephanie','nicole','melissa','michelle','kimberly',
  'amy','angela','helen','diana','linda','patricia','margaret','elizabeth','mary','barbara',
  'susan','dorothy','karen','betty','ruth','sharon','deborah','carol','virginia','patricia',
  'chloe','madison','olivia','sophia','isabella','ava','mia','abigail','emily','charlotte',
  'harper','amelia','evelyn','sofia','scarlett','victoria','camila','aria','penelope','luna',
  'layla','riley','zoey','nora','lily','eleanor','hannah','lillian','addison','aubrey','grace',
  'leah','savannah','natalie','audrey','brooklyn','bella','claire','skylar','lucy','anna','aaliyah',
  // Türkisch/Arabisch/Südeuropäisch
  'fatima','fatme','ayse','zeynep','elif','merve','selin','melis','esra','nour','sara','lara',
  'yasmin','yasmina','amira','laila','leila','nadia','sofia','giulia','chiara','francesca',
  'valentina','alessia','martina','beatrice','elena','paola','silvia','roberta','cristina',
  // Osteuropäisch
  'katerina','katarina','katarzyna','monika','agnieszka','joanna','anna','marta','natalia',
  'olga','tatiana','irina','svetlana','elena','ekaterina','anastasia','daria','maria','oksana',
])

const FEMALE_USERNAME_PATTERNS = /girl|woman|women|lady|mama|mami|queen|princess|babygirl|itsgirl|shes|girly|babe|she_|_she|her_|_her|ms\.|mrs\.|frau|madame|señorita|belle|femme|dame|miss|goddess/i
const FEMALE_NAME_PATTERNS = /\b(mrs|ms|miss|frau|lady|signora|madame|señora)\b/i

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[_.\-]/g, ' ').trim()
}

function detectGender(name: string, username: string): string {
  const normName = normalize(name)
  const normUser = normalize(username)
  const combined = `${normName} ${normUser}`

  // Klare weibliche Indikatoren im Username oder Namen
  if (FEMALE_NAME_PATTERNS.test(combined)) return 'female'
  if (FEMALE_USERNAME_PATTERNS.test(combined)) return 'female'

  // Klare männliche Indikatoren
  if (/\b(mr|herr|señor|signor)\b|boy|guy|man_|_man|bro_|_bro|lad_/.test(combined)) return 'male'

  // Vorname gegen Liste prüfen — alle Wortteile des Namens
  const nameParts = normName.split(/\s+/)
  for (const part of nameParts) {
    if (part.length > 2 && FEMALE_NAMES.has(part)) return 'female'
  }

  // Username-Teile prüfen (z.B. "laura.fit" → "laura")
  const userParts = normUser.split(/\s+/)
  for (const part of userParts) {
    if (part.length > 2 && FEMALE_NAMES.has(part)) return 'female'
  }

  return 'unknown'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const body = await req.json()
    const {
      subscriber_id,
      trigger_message,
      display_name = '',
      ig_username = '',
    } = body

    if (!subscriber_id || !trigger_message) {
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    console.log(`dm-manychat-reply: ${ig_username} (${subscriber_id}): "${trigger_message.slice(0, 80)}"`)

    // Load config
    const configRows = await dbGet('dm_config?select=key,value')
    const config: Record<string, string> = {}
    configRows.forEach((c: any) => { config[c.key] = c.value })

    // ── Platzhalter erkennen und echte Daten von ManyChat holen ───────────────
    let resolvedName = display_name
    let resolvedUsername = ig_username
    const isPlaceholder = (v: string) => !v || v.includes('{{') || v === 'Unbekannt'

    if (isPlaceholder(resolvedName) || isPlaceholder(resolvedUsername)) {
      try {
        const mcKey = config['manychat_api_key']
        if (mcKey) {
          const mcRes = await fetch(
            `https://api.manychat.com/fb/subscriber/getInfo?subscriber_id=${subscriber_id}`,
            { headers: { 'Authorization': `Bearer ${mcKey}` } }
          )
          const mcData = await mcRes.json()
          if (mcData.data) {
            resolvedName = mcData.data.name || resolvedName
            resolvedUsername = mcData.data.ig_username || resolvedUsername
            console.log(`ManyChat lookup: name="${resolvedName}" ig="${resolvedUsername}"`)
          }
        }
      } catch (e: any) {
        console.error('ManyChat getInfo failed:', e.message)
      }
    }

    // Fallback wenn immer noch leer
    if (isPlaceholder(resolvedName)) resolvedName = resolvedUsername || String(subscriber_id)
    if (isPlaceholder(resolvedUsername)) resolvedUsername = String(subscriber_id)

    // Gender check
    const gender = detectGender(resolvedName, resolvedUsername)

    // ── Schritt 1: Konversation upserten ──────────────────────────────────────
    let conv: any = null
    try {
      conv = await dbUpsertConversation({
        manychat_contact_id: String(subscriber_id),
        instagram_username: resolvedUsername,
        display_name: resolvedName,
        gender,
        last_message_at: new Date().toISOString(),
        last_message_preview: trigger_message.slice(0, 100),
        updated_at: new Date().toISOString(),
      })
    } catch (e: any) {
      console.error('Conv upsert threw:', e.message)
    }

    // Fallback: Konversation per manychat_contact_id nachschlagen
    if (!conv?.id) {
      console.log('Upsert gab kein id zurück — suche per manychat_contact_id')
      const existing = await dbGet(
        `dm_conversations?manychat_contact_id=eq.${encodeURIComponent(String(subscriber_id))}&limit=1`
      )
      conv = existing[0] || null
      console.log('Fallback lookup:', conv ? `gefunden id=${conv.id}` : 'NICHT gefunden')
    }

    if (!conv?.id) {
      console.error('Konversation konnte nicht erstellt/gefunden werden für subscriber_id:', subscriber_id)
      return new Response(JSON.stringify({ reply: '', error: 'conv_not_found' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // ── Schritt 2: Duplikat & Anti-Loop Check ────────────────────────────────
    const recentMsgs = await dbGet(
      `dm_messages?conversation_id=eq.${conv.id}&order=created_at.desc&limit=5`
    )

    // 2a: Exaktes Duplikat innerhalb 30s
    const isDuplicate = recentMsgs.some((m: any) => {
      const ageSec = (Date.now() - new Date(m.created_at).getTime()) / 1000
      return m.direction === 'inbound' && m.content === trigger_message && ageSec < 30
    })
    if (isDuplicate) {
      console.log(`Duplikat <30s: "${trigger_message.slice(0, 40)}"`)
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // 2b: Anti-Loop für Mode C — wenn dieselbe Nachricht bereits existiert
    // UND danach eine Outbound gespeichert wurde → sendFlow hat uns getriggert, kein echter User-Message
    // Fenster: 90s (sendFlow-Round-Trip dauert max ~30s, also genug Puffer ohne legitime Msgs zu blockieren)
    const lastInboundSame = recentMsgs.find((m: any) => m.direction === 'inbound' && m.content === trigger_message)
    if (lastInboundSame) {
      const ageSec = (Date.now() - new Date(lastInboundSame.created_at).getTime()) / 1000
      if (ageSec < 90) { // 90s Fenster statt 10 Minuten
        const outboundAfter = recentMsgs.find((m: any) =>
          m.direction === 'outbound' &&
          new Date(m.created_at) > new Date(lastInboundSame.created_at)
        )
        if (outboundAfter) {
          console.log(`Anti-Loop (90s): sendFlow-Trigger erkannt für "${trigger_message.slice(0, 30)}", überspringe`)
          return new Response(JSON.stringify({ reply: '' }), {
            headers: { ...CORS, 'Content-Type': 'application/json' }
          })
        }
      }
    }

    // ── Schritt 3: Nachricht IMMER speichern ──────────────────────────────────
    await dbInsert('dm_messages', {
      conversation_id: conv.id,
      direction: 'inbound',
      content: trigger_message,
      sent_by: 'user',
    })
    // Unread Flag setzen
    await dbPatch('dm_conversations', `id=eq.${conv.id}`, {
      has_unread: true,
      last_message_at: new Date().toISOString(),
      last_message_preview: trigger_message.slice(0, 100),
      updated_at: new Date().toISOString(),
    })
    console.log(`Nachricht gespeichert für conv ${conv.id}: "${trigger_message.slice(0, 40)}"`)

    // ── Schritt 4: Lead Score Update ──────────────────────────────────────────
    let scoreIncrease = 0
    if (/preis|kosten|was kostet|wie viel|invest/i.test(trigger_message)) scoreIncrease += 20
    if (/interesse|interessiert|würde gerne|möchte|will/i.test(trigger_message)) scoreIncrease += 15
    if (/abnehm|gewicht|kilo|kg|fett|muskel|training|coaching/i.test(trigger_message)) scoreIncrease += 10
    if (/wann|start|anfangen|beginnen|wie geht/i.test(trigger_message)) scoreIncrease += 15
    if (trigger_message.length > 100) scoreIncrease += 5
    if (scoreIncrease > 0) {
      const newScore = Math.min(100, (conv.lead_score || 0) + scoreIncrease)
      const heat = newScore >= 70 ? 'hot' : newScore >= 40 ? 'warm' : 'cold'
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { lead_score: newScore, lead_heat: heat })
    }

    // Auto-archive weibliche Leads
    if (gender === 'female' && conv.lead_heat !== 'archived') {
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { lead_heat: 'archived' })
      conv = { ...conv, lead_heat: 'archived' }
    }

    // ── Schritt 5: Claude nur wenn aktiv und nicht gesperrt ───────────────────
    // Blocklist aus Config prüfen
    const blockedUsernames = (config['blocked_usernames'] || '')
      .split(/[\n,]/).map((u: string) => u.trim().toLowerCase().replace('@', '')).filter(Boolean)
    const isBlocked = blockedUsernames.includes(resolvedUsername.toLowerCase())

    // Push Notification: bei hot lead oder Sprachnachricht
    const leadScore = Math.min(100, (conv.lead_score || 0) + (scoreIncrease || 0))
    if (trigger_message.includes('Sprachnachricht') || leadScore >= 70) {
      fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Neue Nachricht von ${resolvedName}`,
          body: trigger_message.slice(0, 80),
          url: '/dm-center'
        })
      }).catch(() => {})
    }

    if (
      config['global_claude_enabled'] !== 'true' ||
      conv.claude_blocked ||
      conv.lead_heat === 'archived' ||
      isBlocked ||
      gender === 'female'
    ) {
      console.log(`Claude skipped for ${resolvedUsername} (reason: ${
        config['global_claude_enabled'] !== 'true' ? 'global_off' :
        conv.claude_blocked ? 'manually_blocked' :
        conv.lead_heat === 'archived' ? 'archived' :
        isBlocked ? 'blocklist' : 'female'
      })`)
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

    // Load last 20 messages for context
    const msgs = await dbGet(`dm_messages?conversation_id=eq.${conv.id}&order=created_at.asc&limit=20`)

    // Build chat history
    const chatHistory = msgs.map((m: any) => ({
      role: m.direction === 'inbound' ? 'user' : 'assistant',
      content: m.content,
    }))

    // Opening message templates
    const openingMsgs = [
      config['opening_msg_1'],
      config['opening_msg_2'],
      config['opening_msg_3'],
    ].filter(m => m?.trim())
    const openingContext = openingMsgs.length > 0
      ? `THOMAS' TYPISCHE ERÖFFNUNGSNACHRICHTEN BEI KALTAKQUISE:\n${openingMsgs.map((m, i) => `${i + 1}. "${m}"`).join('\n')}\n(Falls die erste Nachricht im Chat fehlt, wurde wahrscheinlich eine dieser Varianten gesendet.)`
      : ''

    const styleDna = config['style_dna'] || 'Locker, direkt, authentisch. Kurze Sätze. Kein Marketing-Speak.'
    const testimonials = config['testimonials'] || ''
    const currentStage = conv.stage || 'discovery'

    const systemPrompt = `Du bist Thomas Pfeffer, Fitness Coach aus Österreich. Du antwortest auf Instagram DMs von potenziellen männlichen Kunden.

DEIN EXAKTER SCHREIBSTIL (aus echten Chats analysiert):
${styleDna}

${openingContext}

═══════════════════════════════════════
DEIN ZIEL: Form Training App verkaufen
Preis: €49/Monat | Link: https://www.form-training.at/start
═══════════════════════════════════════

Du führst jeden Lead durch 5 Phasen. Der aktuelle Stand dieses Leads: "${currentStage}"

──────────────────────────────────────
PHASE 1 — DISCOVERY  [stage: discovery]
──────────────────────────────────────
Finde heraus was sein größtes Problem ist.
→ Frag nach Training, Ernährung oder wo er gerade feststeckt
→ Sei echt neugierig, keine Checkliste
→ Typische Fragen: "Was ist bei dir gerade das größte Thema?" / "Wie läuft dein Training aktuell?" / "Trainierst du schon regelmäßig?"

──────────────────────────────────────
PHASE 2 — TIEFE  [stage: rapport]
──────────────────────────────────────
Er soll seinen Schmerz mit eigenen Worten beschreiben.
→ Frag nach: Seit wann? Was hat er schon probiert? Was hat nicht funktioniert?
→ Zeig echtes Interesse, gib kurze persönliche Einblicke ("hatte ich auch mal", "kenn ich gut")
→ Er committet sich durch seine eigenen Antworten — das ist der Kern

──────────────────────────────────────
PHASE 3 — VISION  [stage: rapport → pitch_ready]
──────────────────────────────────────
Er soll das Ergebnis selbst formulieren.
→ "Was würde sich bei dir ändern wenn das endlich klappt?"
→ Kurz eigene Energie reinbringen: "Das ist genau der Punkt wo's richtig abgeht 💪🏽"
→ Wenn er sein Ziel klar beschrieben hat → weiter zu Phase 4

──────────────────────────────────────
PHASE 4 — PITCH  [stage: pitch_ready → pitched]
──────────────────────────────────────
Erst pitchen wenn du weißt: sein Ziel, seinen Pain, was er schon probiert hat.
AUSNAHME: Wenn er schon nach Msg 1-2 klar kaufbereit wirkt ("was kostet das", "wie kann ich starten") → direkt pitchen, Phasen nicht künstlich strecken.

Schick GENAU diese Frage (nicht abändern):
"Wäre das was für dich wenn du für €49 im Monat Zugang zu einer App bekommst, die dir einen kompletten Trainings- und Ernährungsplan erstellt, der sich zu 100% an dich und deinen Alltag anpasst?"

→ NUR diese Frage. Nichts hinzufügen, nichts erklären.
→ KEIN LINK. Auf sein Ja warten.

──────────────────────────────────────
PHASE 5 — CLOSE  [stage: pitched → won]
──────────────────────────────────────
Klares Ja = "ja", "klar", "mach das", "wie geht das", "was muss ich tun", "auf jeden Fall", "würd mich interessieren"
→ "Perfekt 💪🏽 Hier ist der Link direkt zum Start: https://www.form-training.at/start"

Wenn er nachfragt was die App genau macht:
→ "Die App erstellt dir deinen persönlichen Plan, du hast Push-Reminder damit du dranbleibst, und der Plan passt sich an dich an. Du musst nichts mehr selbst ausdenken, einfach umsetzen."
→ Danach den Link schicken.

STAGE-HINWEIS für diesen Chat:
${currentStage === 'pitched' ? '⚠️ Du hast die Pitch-Frage bereits gestellt. WARTE auf sein Ja/Nein. Nicht nachverkaufen, keine neuen Fragen.' : ''}
${currentStage === 'won' ? '✅ Er hat bereits gekauft. Supportiv bleiben, kein Verkaufen.' : ''}
${currentStage === 'lost' ? '❌ Hat nicht gekauft. Locker im Kontakt bleiben, kein Druck.' : ''}

──────────────────────────────────────
PREIS-FRAGE VOR DEM PITCH
──────────────────────────────────────
Wenn er fragt "was kostet das" / "wie teuer" und du noch nicht genug weißt (Ziel, Pain, Situation):
→ Satz 1: "Kommt drauf an was du brauchst 😊"
→ Satz 2: Frag das Nächste das du noch nicht weißt. Schau dir den Verlauf an — was fehlt noch?
  · Kein Ziel gehört? → "Was ist bei dir gerade das größte Thema, Training oder Ernährung?"
  · Kein Pain? → "Was läuft da gerade nicht so wie du willst?"
  · Noch nie gefragt seit wann? → "Seit wann kämpfst du damit?"
  · Plan/Struktur unklar? → "Trainierst du gerade nach einem Plan oder eher freestyle?"
→ Immer nur eine Frage, die im Verlauf noch nicht gestellt wurde.

──────────────────────────────────────
EINWAND-HANDLING nach Pitch
──────────────────────────────────────

"klingt nach nem Abo das ich wieder nicht nutze":
→ "Die App schickt dir Push-Reminder damit du dranbleibst, und du hast einen fertigen Plan den du nur noch umsetzen musst ohne nachzudenken. Die Motivation kommt von alleine wenn du die ersten Resultate siehst 💪🏽"
→ Danach warten. Pitch NICHT wiederholen.

"zu teuer" / "€49 ist viel" / "zu viel Geld":
→ "Ein Personal Trainer kostet €60-100 pro Einheit, also €300-500 im Monat. Du bekommst für €49 im Monat einen kompletten Plan der zu 100% auf dich zugeschnitten ist. Das sind €1,60 am Tag."
→ Danach warten.

"brauch ich nicht" / "nein danke" / "interessiert mich nicht":
→ "Was hast du dir anders vorgestellt? Oder was ist der Hauptgrund dass es nicht für dich passt?"
→ Auf seine Antwort eingehen. Wenn er dann immer noch nein sagt: "Alles gut, meld dich wenn sich was ändert 👍🏽"

"ich hab schon eine App" (MyFitnessPal, Nike Training, etc.):
→ ERST loben: "Das ist auch eine sehr gute App für Tracking."
→ DANN Unterschied: "Meine App ist wie ein Coach in einer App. Du bekommst nicht nur Tracking, sondern einen Plan der speziell für dich erstellt wird, Feedback und Push-Reminder. Kein Vergleich zu reinem Tracking 😊"
→ NIEMALS eine andere App schlecht machen oder abwerten.

"bin mir nicht sicher" / "muss ich überlegen" / "weiß nicht":
→ Zuerst fragen: "Was ist bei dir noch unklar?"
→ Auf seine Antwort eingehen.
→ Danach Testimonials schicken als Entscheidungshilfe:
${testimonials ? `"Schau mal was andere sagen die das schon nutzen:\n${testimonials}"` : '"Schau mal, andere die damit gestartet sind haben in den ersten 4-6 Wochen schon klare Ergebnisse gesehen 💪🏽"'}

Regel: NUR EIN Nachhaken pro Einwand. Wenn danach immer noch nein: "Alles gut, meld dich wenn sich was ändert 👍🏽"

NATÜRLICHKEIT — KRITISCH:
Diese Phrasen sind für Thomas VERBOTEN — niemals verwenden:
✗ "Ah verstehe" / "Ich verstehe" / "Das verstehe ich"
✗ "Ja das macht Sinn" / "Das macht Sinn"
✗ "Interessant" / "Ah interessant"
✗ "Das ist wirklich [adjektiv]" (z.B. "Das ist wirklich schwierig")
✗ "Absolut" / "Genau richtig" / "Super Frage"
✗ "Als Coach..." oder irgendwas Formelles

Stattdessen: kurz spiegeln ODER direkt einsteigen ODER nur fragen.
Typische Einstiege von Thomas: "Das kenn ich.", "Mega.", "Stark.", "Ja klar.", direkt eine Frage ohne Einleitung.

SCHREIBSTIL-DETAILS — Thomas' Fingerabdruck:
- Schreibt "ein par" statt "ein paar" (durchgehend, bewusst beibehalten)
- Kurze Reaktion + eine Frage — nicht Reaktion + Erklärung + Frage
- Wenn er sich einbringt: "hatte das auch mal früher" statt "ich kenn das als Coach"
- Emojis: 💪🏽 😊 🙌🏻 😎 — maximal einer pro Nachricht, nicht bei jeder

SATZLÄNGE — hart:
- Max. 2 Sätze. Oft nur einer.
- Keine erklärenden Zusätze nach der Reaktion. Reagieren + fragen. Fertig.

REGELN:
- Max. 1 Frage pro Nachricht
- NIEMALS den Link schicken bevor ein klares Ja kommt
- Niemals Bindestriche als Gedankenstrich
- Antworte auf Deutsch (außer der Lead schreibt klar auf Englisch)

LEAD INFO:
- Name: ${resolvedName}
- Score: ${conv.lead_score || 0}/100
- Deal Status: ${conv.deal_status === 'won' ? '✅ Hat bereits gekauft' : conv.deal_status === 'lost' ? '❌ Hat nicht gekauft' : conv.deal_status === 'nurture' ? '🌱 Nurture' : '⏳ Noch offen'}
${conv.notes ? `\nNOTIZEN (höchste Priorität, von Thomas hinterlegt):\n${conv.notes}` : ''}`

    const history = chatHistory.length > 0
      ? chatHistory
      : [{ role: 'user', content: trigger_message }]

    const autonomyMode = conv.autonomy_mode || config['default_autonomy_mode'] || 'B'
    const autoSend = autonomyMode === 'C'

    const reply = await callClaude(systemPrompt, history)
    if (!reply) throw new Error('Claude returned empty reply')

    // Stage-Tracking: automatisch updaten basierend auf dem was Claude geschrieben hat
    const pitchSignal = /wäre das was für dich wenn du für €49/i.test(reply) || /zugang zu einer app bekommst/i.test(reply)
    const closeSignal = /form-training\.at\/start/i.test(reply)
    if (pitchSignal && currentStage !== 'pitched' && currentStage !== 'won') {
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { stage: 'pitched' })
      console.log(`Stage → pitched für ${resolvedUsername}`)
    } else if (closeSignal && currentStage !== 'won') {
      await dbPatch('dm_conversations', `id=eq.${conv.id}`, { stage: 'won', deal_status: 'won' })
      console.log(`Stage → won für ${resolvedUsername}`)
    }

    if (autoSend) {
      // Modus C: verzögertes Senden (1-3 Minuten zufällig)
      const delaySeconds = 60 + Math.floor(Math.random() * 120) // 60–180s
      const delayMs = delaySeconds * 1000
      console.log(`Mode C: sende in ${delaySeconds}s für ${resolvedUsername}: "${reply.slice(0, 40)}..."`)

      const sendDelayed = async () => {
        await new Promise(r => setTimeout(r, delayMs))
        try {
          const mcKey = config['manychat_api_key']
          const flowNs = config['manychat_flow_ns']
          if (!mcKey || !flowNs) throw new Error('ManyChat config fehlt')

          // ERST in DB speichern — damit Anti-Loop greift wenn sendFlow uns wieder aufruft
          await dbInsert('dm_messages', {
            conversation_id: conv.id,
            direction: 'outbound',
            content: reply,
            sent_by: 'claude',
            status: 'sent',
          })
          await dbPatch('dm_conversations', `id=eq.${conv.id}`, {
            last_message_at: new Date().toISOString(),
            last_message_preview: reply.slice(0, 100),
            updated_at: new Date().toISOString(),
          })

          // DANN via ManyChat senden
          const fieldRes = await fetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${mcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriber_id: String(subscriber_id), field_name: 'claude_reply', field_value: reply }),
          })
          const fieldData = await fieldRes.json()
          if (fieldData.status !== 'success') throw new Error(`setCustomField: ${fieldData.message}`)

          await fetch('https://api.manychat.com/fb/sending/sendFlow', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${mcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriber_id: String(subscriber_id), flow_ns: flowNs }),
          })

          // Feld nach 2s zurücksetzen
          await new Promise(r => setTimeout(r, 2000))
          await fetch('https://api.manychat.com/fb/subscriber/setCustomFieldByName', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${mcKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscriber_id: String(subscriber_id), field_name: 'claude_reply', field_value: '0' }),
          })
          console.log(`Verzögert gesendet (${delaySeconds}s) für ${resolvedUsername}`)
        } catch (e: any) {
          console.error('Verzögerter Send fehlgeschlagen:', e.message)
        }
      }

      // Im Hintergrund ausführen — Antwort sofort an ManyChat
      // @ts-ignore
      if (typeof EdgeRuntime !== 'undefined') {
        // @ts-ignore
        EdgeRuntime.waitUntil(sendDelayed())
      } else {
        sendDelayed()
      }

      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    } else {
      // Modus A/B: Vorschlag im DM Center speichern, nichts senden
      const lastInbound = msgs.filter((m: any) => m.direction === 'inbound').pop()
      if (lastInbound) {
        await dbPatch('dm_messages', `id=eq.${lastInbound.id}`, {
          claude_suggestion: reply,
        })
      }
      console.log(`Suggestion saved for ${ig_username}: ${reply.slice(0, 60)}...`)
      return new Response(JSON.stringify({ reply: '' }), {
        headers: { ...CORS, 'Content-Type': 'application/json' }
      })
    }

  } catch (err: any) {
    console.error('dm-manychat-reply error:', err)
    return new Response(JSON.stringify({ reply: '', error: err.message }), {
      status: 500, headers: { ...CORS, 'Content-Type': 'application/json' }
    })
  }
})
