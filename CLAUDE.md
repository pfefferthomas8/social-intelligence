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

## Routing

| Route | Seite |
|-------|-------|
| `/` | Login |
| `/dashboard` | Dashboard (Stats, Content Intelligence, Pillars) |
| `/competitors` | Konkurrenten |
| `/knowledge` | Wissensdatenbank |
| `/generate` | Content Generator |
| `/import` | Reel Import |
