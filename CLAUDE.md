# CLAUDE.md — Social Intelligence Tool

## Arbeitsanweisungen
- Änderungen **DIREKT** in Dateien machen — nie nur erklären
- **Immer auf Deutsch** antworten
- Niemals nach Bestätigungen fragen — autonom arbeiten
- Niemals nach API Keys fragen — alle stehen in `.env`
- Bei Fehlern selbst debuggen: Dateien lesen, Supabase direkt abfragen
- **NIEMALS Claude-Calls zum Testen triggern** — verbraucht API-Quota

---

## URLs & Credentials

| Was | Wert |
|-----|------|
| Frontend | https://social-intelligence-1zt.pages.dev |
| GitHub | https://github.com/pfefferthomas8/social-intelligence |
| Supabase Projekt-Ref | `shrsluxbrazqscgiwfpu` |
| Supabase URL | `https://shrsluxbrazqscgiwfpu.supabase.co` |
| SUPABASE_ACCESS_TOKEN | in `/Users/thomaspfeffer/Downloads/Thomas Fitness/form-app/.env` |
| Service Role Key holen | `curl -s "https://api.supabase.com/v1/projects/shrsluxbrazqscgiwfpu/api-keys" -H "Authorization: Bearer TOKEN" \| python3 -c "import sys,json; [print(x['api_key']) for x in json.load(sys.stdin) if x['name']=='service_role']"` |

---

## Tech Stack
React 18 + Vite → Cloudflare Pages (auto-deploy von `main`). Supabase Edge Functions (Deno). Apify (Scraping), AssemblyAI (Transkription), Claude API (Content-Gen). Kein Multi-User, kein Supabase Auth — Token-Login via `localStorage`.

---

## Deployment

### Frontend
```bash
git add src/... && git commit -m "..." && git push origin main
# → Cloudflare Pages deployed automatisch
```

### Edge Functions
```bash
cd "/Users/thomaspfeffer/Downloads/Thomas Fitness/social-intelligence"
SUPABASE_ACCESS_TOKEN=sbp_727ee91236fdf36aca8f9bed7d06bddbb9fa70fd \
npx supabase functions deploy FUNKTIONSNAME --project-ref shrsluxbrazqscgiwfpu --no-verify-jwt
```
**Alle Functions brauchen `--no-verify-jwt`** — Apify/AssemblyAI rufen Webhooks ohne JWT auf, und `generate-content` nutzt eigenen DASHBOARD_TOKEN.

---

## Kritische Eigenheiten

### SERVICE_ROLE_KEY vs SUPABASE_SERVICE_ROLE_KEY
`SUPABASE_SERVICE_ROLE_KEY` ist in Supabase Secrets falsch gesetzt (Hash statt JWT) und kann nicht geändert werden. Alle Functions nutzen:
```typescript
const SERVICE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
```
`SERVICE_ROLE_KEY` ist korrekt. Dieses Pattern bei jeder neuen Function verwenden.

### Apify Webhooks
Webhooks als Base64 URL-Parameter (`?webhooks=...`), NICHT im Body. `scrape-webhook` validiert `ownerUsername === job.target` — verhindert falschen Account in DB. Dataset-Retry: 6 × 10s, erster Versuch nach 15s (Apify meldet SUCCEEDED bevor Dataset bereit ist).

### Username-Sanitierung
Usernames vor Apify-Call bereinigen: `.trim().replace('@', '').replace(/\s+/g, '').toLowerCase()`. Leerzeichen → kaputte Apify-URL → falscher Account wird gescrapet.

### Transkriptions-Pipeline
Instagram CDN → Supabase Storage → AssemblyAI. Umweg nötig weil AssemblyAI Instagram CDN-URLs nicht direkt laden kann (Meta-Block). Storage Bucket: `instagram-videos`, nach Transkription gelöscht.

---

## Datenbank — Key Tables

| Tabelle | Zweck |
|---------|-------|
| `instagram_posts` | Alle Posts (source: own/competitor/custom). **Wichtig:** `visual_text` = Text aus Thumbnail (Claude Vision), `transcript` = Gesprochenes (AssemblyAI) |
| `thomas_dna` | Thomas' analysierter Stil (hook_pattern, style_rule, audience_pattern, pillar_insight, competitor_gap, carousel_rule) |
| `trend_posts` | Virale Posts aus dynamischem Coach-Pool, 7-Tage TTL |
| `external_signals` | Reddit/Community-Signale, relevance_score 0–100 |
| `generated_content` | Generierter Content, `user_rating` 1=gut / -1=schlecht für Feedback-Loop |
| `discovered_coaches` | Pool von 20+ Online-Fitness-Coaches, befüllt von `discover-coaches` |
| `competitor_profiles` | Manuell hinzugefügte Competitors |
| `scrape_jobs` | Status-Tracking für Apify-Runs |

**RLS deaktiviert** — nur Thomas nutzt das Tool.

---

## Edge Functions

| Funktion | Zweck |
|----------|-------|
| `scrape-profile` | Startet Apify-Run für Instagram-Profil |
| `scrape-webhook` | Apify-Webhook → speichert Posts, triggert Transkription + Visual-Extraktion |
| `import-reel` | Einzelner Reel-Import |
| `transcribe-video` | Download → Storage → AssemblyAI submit |
| `transcribe-webhook` | AssemblyAI Callback → Transcript in DB |
| `process-visual-text` | Text aus Thumbnails via Claude Vision (batch) |
| `classify-pillars` | Posts → haltung/transformation/mehrwert/verkauf |
| `analyze-thomas` | Thomas' Posts analysieren → befüllt `thomas_dna` |
| `generate-content` | Content-Generierung (B-Roll, Carousel, Script, Single Post) |
| `generate-dashboard-posts` | 6 datengetriebene Content-Ideen für Dashboard |
| `trend-discovery` | Scrapt 8 Coaches aus `discovered_coaches` Pool (älteste zuerst) |
| `trend-webhook` | Trend-Scrape Ergebnisse → `trend_posts` |
| `discover-coaches` | Neue Coaches via Hashtag-Discovery suchen |
| `fetch-external-signals` | Reddit etc. → `external_signals` |

---

## GitHub Actions (daily-scrape.yml)

| Wann | Was |
|------|-----|
| 06:00 UTC täglich | Eigenes Profil (auto-scrape mode=own) |
| 06:30 UTC täglich | Competitors (auto-scrape mode=competitors) |
| Mo + Do 07:00 UTC | Trend Scout (auto-scrape mode=trends) |
| Sonntag 05:00 UTC | Coach Discovery |

**Hinweis:** GitHub Actions Crons feuern oft 4-5h später als geplant — normal.

---

## Content Generator — B-Roll Hooks (kritisch)

`generate-content` nutzt eine **Example-First** Architektur für B-Roll:
1. Claude liest zuerst Abschnitt `[10]` (Thomas' echte visual_text Hooks + Competitor-Overlays aus DB)
2. Analysiert das Muster INTERN
3. Schreibt danach Hooks nach erkanntem Muster

**Wichtig für DB-Queries in generate-content:** Alle `instagram_posts` Selects müssen `visual_text` enthalten — das sind die echten Hook-Texte die Claude als Vorlage braucht.

**B-Roll Logik-Check (Pflicht):**
- Ist der Hook offensichtlich/tautologisch? → Neu schreiben
  - VERBOTEN: "Du isst im Defizit und hast Hunger." — natürlich, das IST das Defizit
- Erzeugt der Hook Spannung? Würde der Zuschauer scrollen bleiben?
- Kein "Das ist der Grund." ohne überraschende Aussage davor

**Output-Format:** `MUSTER:` (nicht `SCHEMA:`), Hook 8-20 Wörter.

**Muster-Typen:** Szenario-Hook / Neugier-Zahl / Counter-Intuitive / Coaching-Kontext / Cheat-Code / Countdown / Paradox / Reframing / Direktangriff

---

## DM Center (Instagram Appointment Setter)

### Übersicht
Claude fungiert als KI-Appointment-Setter für Instagram DMs. ManyChat fängt eingehende Nachrichten ab, leitet sie an Supabase weiter, Claude generiert Antwortvorschläge, Thomas genehmigt oder sendet vollautomatisch.

### ManyChat Flow-Architektur
```
Lead schreibt → Default Reply → External Request (dm-manychat-reply) 
→ Condition: claude_reply is not 0 → Send Text ({{custom.claude_reply}}) → Set Field = "0"
```
- **Feld:** `claude_reply` (Custom Field in ManyChat)
- **Wichtig:** "Set Field = 0" kommt NACH dem Send-Step (nicht davor!)
- **Mode A/B:** dm-manychat-reply gibt `{ reply: "" }` zurück → Vorschlag nur im UI gespeichert
- **Mode C:** gibt auch `{ reply: "" }` zurück, sendet aber verzögert (60–180s) via `setCustomFieldByName` + `sendFlow` im Hintergrund (`EdgeRuntime.waitUntil`)

### DB-Tabellen DM Center

| Tabelle | Wichtiges |
|---------|-----------|
| `dm_conversations` | `manychat_contact_id`, `gender` (male/female/unknown), `lead_heat` (hot/warm/cold/archived), `autonomy_mode` (A/B/C), `lead_score` (0–100), `deal_status` (open/won/lost/nurture), `notes`, `has_unread`, `claude_blocked` |
| `dm_messages` | `direction` (inbound/outbound), `claude_suggestion`, `claude_reasoning`, `original_suggestion` (für KI-Learning), `sent_by` (user/claude/thomas) |
| `dm_config` | Key-Value: `global_claude_enabled`, `manychat_api_key`, `manychat_flow_ns`, `style_dna`, `blocked_usernames`, `opening_msg_1/2/3`, `primary/secondary_product_*`, `default_autonomy_mode` |

### Edge Functions DM

| Funktion | Zweck |
|----------|-------|
| `dm-manychat-reply` | ManyChat Webhook — speichert Inbound, generiert Claude-Vorschlag, Anti-Loop-Schutz (90s Fenster), blockiert Frauen + Blocklist + Archived |
| `dm-reply` | Manuell aus UI aufgerufen (Button "Vorschlag generieren") — generiert + speichert Suggestion auf lastInbound |
| `dm-send` | Sendet Nachricht via ManyChat (`setCustomFieldByName` + `sendFlow`), speichert `original_suggestion` für KI-Learning |

### KI-Learning-Loop
- Wenn Thomas einen Vorschlag **ohne Änderung** sendet → `original_suggestion = content` → gilt als ✓ Approval
- Wenn Thomas **bearbeitet** → `original_suggestion ≠ content` → gilt als Korrektur
- `dm-reply` lädt letzte 15 Feedback-Einträge und gibt Claude "So schreibt er NICHT / So schreibt er":

### Wichtige Eigenheiten & Bugs
- **Anti-Loop Mode C:** `sendFlow` re-triggert `dm-manychat-reply`. Fix: Outbound wird VOR `sendFlow` in DB gespeichert. Anti-Loop-Check: gleiche Nachricht in DB + Outbound danach → skip (90s Fenster)
- **Frauen-Filter:** `gender === 'female'` → kein Claude, aber Nachricht wird trotzdem gespeichert
- **Archived:** `lead_heat === 'archived'` → komplett übersprungen (weder Nachricht gespeichert noch Claude)
- **Gender-Detection:** Aus `display_name` + `instagram_username`. DB speichert `conv.gender`, aber dm-manychat-reply erkennt frisch bei jedem Aufruf. Override im UI möglich (♂/♀/? Buttons)
- **ManyChat Default Reply feuert NICHT** wenn Subscriber in aktivem Flow steckt → Fix: In ManyChat Kontakt prüfen → aus Sequence entfernen
- **Supabase Realtime:** Tabellen `dm_conversations` + `dm_messages` müssen in Publication sein: `ALTER PUBLICATION supabase_realtime ADD TABLE dm_conversations, dm_messages;`
- **ClaudeBanner:** Bleibt als kompakte Leiste sichtbar auch nach manueller Antwort ("alreadyReplied"). Zeigt Fehlermeldung wenn dm-reply scheitert.

### Route
`/dm-center` → `src/pages/DMCenter.jsx`

---

## Routing

| Route | Seite |
|-------|-------|
| `/` | Login |
| `/dashboard` | Dashboard (Stats, Content Intelligence, Pillars) |
| `/competitors` | Konkurrenten |
| `/knowledge` | Wissensdatenbank |
| `/generate` | Content Generator |
| `/import` | Reel Import |
