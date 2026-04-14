# CLAUDE.md — Social Intelligence Tool

## Arbeitsanweisungen

- **Änderungen DIREKT in Dateien machen** — nicht erklären was zu tun wäre
- **Immer auf Deutsch antworten**
- **Niemals nach Bestätigungen fragen** — autonom arbeiten
- **Niemals nach API Keys fragen** — alle stehen in der `.env` Datei
- **Bei Fehlern selbst debuggen**: Logs lesen, Supabase direkt abfragen
- **Kein Raten** — immer erst relevante Dateien lesen bevor Änderungen gemacht werden
- **Deployment**: Frontend-Änderungen pushen → Cloudflare Pages deployed auto von `main`. Edge Functions manuell via Supabase Management API deployen.
- **NIEMALS eigene Claude-Calls zum Testen triggern** — verbraucht API-Quota

---

## Projekt-Übersicht

**Was:** Social Intelligence Tool für Thomas (Fitness Coach). Scrapt Instagram automatisch, analysiert Trends, generiert auf Knopfdruck professionellen Content für DACH-Markt.

**Kein Multi-User** — nur für Thomas, kein Supabase Auth, einfacher Token-Login.

---

## URLs & Deployment

| Was | URL |
|-----|-----|
| Frontend (Cloudflare Pages) | https://social-intelligence-1zt.pages.dev |
| GitHub Repo | https://github.com/pfefferthomas8/social-intelligence |
| Supabase Projekt | shrsluxbrazqscgiwfpu |
| Supabase URL | https://shrsluxbrazqscgiwfpu.supabase.co |

---

## Tech Stack

| Layer | Tool |
|-------|------|
| Frontend | React 18, React Router v6, Vite |
| PWA | vite-plugin-pwa |
| Backend DB | Supabase (PostgreSQL) |
| Edge Functions | Supabase Edge Functions (Deno) |
| Scraping | Apify (`apify~instagram-scraper`) |
| Transkription | AssemblyAI |
| AI | Anthropic Claude API (`claude-sonnet-4-5` oder via `CLAUDE_MODEL` env) |
| Deployment | Cloudflare Pages (Frontend), Supabase (Backend) |

---

## Auth

Einfacher Token-Login — kein Supabase Auth.
- Passwort: in `.env` / hardcoded in `Login.jsx`
- Token wird in `localStorage` gespeichert
- `src/lib/auth.js`: `setToken()`, `getToken()`, `removeToken()`

---

## Design System

- **Farben:** `--bg: #0a0a0a`, `--surface: #111`, `--border: #1e1e1e`, `--accent: #ee4f00`
- **Font:** DM Sans
- **Stil:** Desktop-first SaaS Tool (wie Linear/Vercel), Dark Mode, Sidebar-Navigation, multi-column Layouts
- **Layout:** `.app-shell` (flex row) → `Sidebar` (220px) + `.main-content` (flex: 1)

---

## Routing

| Route | Seite |
|-------|-------|
| `/` | Login |
| `/dashboard` | Dashboard (Stats, Content Intelligence, Pillars, Competitors) |
| `/competitors` | Konkurrenten (Scraping, Posts) |
| `/knowledge` | Wissensdatenbank (Filter, Suche) |
| `/generate` | Content Generator |
| `/import` | Reel Import |

---

## Datenbank (Supabase)

### own_profile
Eigenes Instagram-Profil von Thomas.

| Spalte | Typ |
|--------|-----|
| id | uuid PK |
| username | text |
| display_name | text |
| bio | text |
| followers_count | int |
| following_count | int |
| posts_count | int |
| profile_pic_url | text |
| last_scraped_at | timestamptz |

### competitor_profiles
| Spalte | Typ |
|--------|-----|
| id | uuid PK |
| username | text UNIQUE |
| display_name | text |
| followers_count | int |
| niche | text |
| is_active | bool |
| last_scraped_at | timestamptz |
| added_at | timestamptz |

### instagram_posts
Alle Posts — eigen, Competitor, Custom Imports.

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| source | text | `own` \| `competitor` \| `custom` |
| competitor_id | uuid | FK → competitor_profiles |
| instagram_post_id | text | |
| post_type | text | `image` \| `video` \| `carousel` \| `reel` |
| caption | text | |
| likes_count | int | |
| comments_count | int | |
| views_count | int | |
| video_url | text | |
| thumbnail_url | text | |
| transcript | text | Von AssemblyAI |
| transcript_status | text | `pending` \| `done` \| `none` \| `error` |
| visual_text | text | Text aus Thumbnail (Claude Vision) |
| visual_text_status | text | `pending` \| `done` \| `none` \| `error` |
| content_pillar | text | `haltung` \| `transformation` \| `mehrwert` \| `verkauf` |
| published_at | timestamptz | |
| scraped_at | timestamptz | |
| url | text | |

UNIQUE: `(instagram_post_id, source)`

### scrape_jobs
| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| job_type | text | `own_profile` \| `competitor` \| `reel` |
| target | text | Instagram Username |
| status | text | `pending` \| `running` \| `done` \| `error` |
| apify_run_id | text | |
| result_count | int | |
| error_msg | text | |
| started_at | timestamptz | |
| completed_at | timestamptz | |

### generated_content
| Spalte | Typ |
|--------|-----|
| id | uuid PK |
| content_type | text | `carousel` \| `single_post` \| `b_roll` \| `video_script` |
| topic | text |
| content | text |
| content_pillar | text |
| user_rating | int | 0 = dislike, 1 = like (für Feedback-Loop) |
| created_at | timestamptz |

### thomas_dna
Thomas' analysierter Content-Stil. Wird von `analyze-thomas` befüllt.

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| category | text | `hook_pattern` \| `style_rule` \| `audience_pattern` \| `topic_pattern` \| `format_preference` |
| insight | text | Konkrete Erkenntnis aus Posts |
| confidence | numeric | 0.0–1.0 |
| source_post_ids | text[] | Posts auf denen die Erkenntnis basiert |
| created_at | timestamptz | |

### trend_posts
Trend-Posts aus dem `trend-discovery` Scrape (Online-Coaches, dynamische Pool).

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| username | text | Instagram-Account |
| instagram_post_id | text | |
| caption | text | |
| visual_text | text | Text auf Thumbnail |
| views_count | int | |
| likes_count | int | |
| post_type | text | |
| viral_score | numeric | Berechneter Score |
| content_pillar | text | |
| dach_gap | bool | True wenn ähnliches fehlt im DACH-Markt |
| recommendation | text | `sofort` \| `beobachten` \| `skip` |
| claude_notes | text | Kurze AI-Notiz |
| discovered_at | timestamptz | |
| url | text | |

Automatische Löschung: `trend-webhook` löscht Posts älter als 7 Tage vor jedem Insert.

### external_signals
Externe Community-Signale (Reddit, YouTube, etc.) — fließen in Content Intelligence.
Wird von `fetch-external-signals` befüllt.

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| source | text | `reddit` \| `google_trends` \| `youtube` \| `news` |
| signal_type | text | z.B. `subreddit_post` \| `trending_topic` |
| title | text | |
| body | text | |
| url | text | |
| keywords | text[] | |
| relevance_score | int | 0–100 (Claude-bewertet) |
| claude_insight | text | Kurze AI-Interpretation |
| fetched_at | timestamptz | |
| used | bool | |

### discovered_coaches
Dynamischer Pool von Online-Fitness-Coaches (≥10K Follower), wird von `discover-coaches` befüllt.
`trend-discovery` rotiert durch diese Tabelle (älteste zuerst).

| Spalte | Typ | Beschreibung |
|--------|-----|-------------|
| id | uuid PK | |
| username | text UNIQUE | |
| followers_count | int | |
| bio | text | |
| full_name | text | |
| posts_count | int | |
| discovered_at | timestamptz | |
| last_scraped_at | timestamptz | Wann zuletzt in trend-discovery genutzt |
| last_discovery_run | timestamptz | |
| is_active | bool | |
| discovery_source | text | Welcher Hashtag hat ihn gefunden |

20 Seed-Accounts vorgefüllt (jeff nippard, layne norton, james smith pt, syatt fitness, usw.).
Filter: ≥10K Follower + Coach-Keyword im Username/Bio + KEIN Wettkampf/Bühnen-Keyword.

### topic_suggestions
Themenvorschläge, auto-generiert nach Scrape.

| Spalte | Typ |
|--------|-----|
| id | uuid PK |
| title | text |
| why | text |
| suggested_types | text[] |
| category | text |
| used | bool |
| created_at | timestamptz |

**RLS:** Deaktiviert — Tool ist nur für Thomas.

---

## Edge Functions

Deployment via Supabase Management API:
```bash
curl -s -X PATCH "https://api.supabase.com/v1/projects/shrsluxbrazqscgiwfpu/functions/FUNKTIONSNAME" \
  -H "Authorization: Bearer SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"FUNKTIONSNAME\", \"verify_jwt\": false, \"body\": $(python3 -c "import json; print(json.dumps(open('supabase/functions/FUNKTIONSNAME/index.ts').read()))")}"
```

| Funktion | Zweck |
|----------|-------|
| `scrape-profile` | Startet Apify-Run für Instagram-Profil (resultsType: "posts", resultsLimit: 50, webhook-basiert) |
| `scrape-webhook` | Apify-Webhook — speichert Posts in DB, triggert Transkription/Visual/Klassifizierung. **Validiert ownerUsername vs. job.target** (verhindert falschen Account zu speichern) |
| `import-reel` | Einzelner Reel-Import via Apify |
| `transcribe-video` | AssemblyAI Transkription |
| `process-visual-text` | Visuellen Text aus Thumbnail extrahieren (Claude Vision, batch) |
| `classify-pillars` | Klassifiziert Posts in Content-Säulen (haltung/transformation/mehrwert/verkauf) |
| `analyze-thomas` | Analysiert Thomas' eigene Posts → befüllt `thomas_dna` Tabelle |
| `generate-content` | Content-Generierung via Claude (style aus thomas_dna, externe Signale als Layer 9) |
| `generate-dashboard-posts` | 6 datengetriebene Content-Ideen auf Knopfdruck (lädt alle Quellen parallel, Claude Sonnet, retry bei overloaded) |
| `trend-discovery` | Scrapt 8 Accounts aus `discovered_coaches` Pool (älteste zuerst), rotiert dynamisch |
| `trend-webhook` | Verarbeitet Trend-Scrape-Ergebnisse, berechnet viral_score, speichert in trend_posts |
| `discover-coaches` | Sucht neue Online-Fitness-Coaches via Hashtag-Discovery (≥10K Follower), befüllt discovered_coaches |
| `fetch-external-signals` | Holt externe Signale (Reddit etc.), bewertet Relevanz, speichert in external_signals |
| `topic-suggestions` | Themenvorschläge generieren, auto-refresh nach Scrape (max 1× pro Tag) |

---

## Content Intelligence (Dashboard)

Das Herzstück des Dashboards — 6 datengetriebene Post-Ideen per Knopfdruck.

**Datenquellen** (parallel geladen in `generate-dashboard-posts`):
1. `thomas_dna` — Thomas' analysierter Stil (Hook-Formeln, Stil-Regeln, Zielgruppen-Patterns)
2. `instagram_posts` (source=own) — Thomas' Top-Posts nach Views
3. `instagram_posts` (source=competitor) — Competitor Top-Posts
4. `trend_posts` — Trending bei Online-Coaches (recommendation: sofort/beobachten)
5. `external_signals` — Reddit/Community-Signale (relevance_score ≥ 70)
6. `generated_content` (user_rating=1) — Thomas' positiv bewerteter Content als Stilreferenz

**Output-Format** (6 JSON-Objekte):
```json
{
  "hook": "max 10 Wörter auf Deutsch",
  "format": "video_script|b_roll|single_post|carousel",
  "pillar": "haltung|transformation|mehrwert|verkauf",
  "preview": "2 Sätze Kern-Aussage auf Deutsch",
  "score": 87,
  "sources": [{"ref": "T3", "label": "@username · 2.1M Views"}],
  "why_it_works": "1 Satz Trigger + warum für Thomas"
}
```

Source-Referenzen: T1-T12 (Trends), C1-C8 (Competitors), S1-S8 (Signale)

**Retry-Logik** bei Claude overloaded: 3 Versuche, 8s / 20s Backoff.

---

## Apify Integration

- Actor: `apify~instagram-scraper` (Posts-Modus)
- `resultsType: "posts"`, `resultsLimit: 50`, ~5-10 Min pro Profil
- Webhook-basiert: kein Frontend-Polling, Apify ruft `scrape-webhook` auf wenn fertig
- Webhooks als Base64 URL-Parameter (`?webhooks=...`), NICHT im Body
- `scrape-webhook` erkennt automatisch zwei Datenstrukturen:
  - **Posts-Modus** (neu): jedes Dataset-Item ist ein Post direkt (hat `shortCode` + `ownerUsername`)
  - **Profile-Modus** (legacy): jedes Dataset-Item ist Profil mit `latestPosts[]`
- **Wichtig:** `scrape-webhook` validiert `firstItem.ownerUsername === job.target` im Posts-Modus — lehnt ab wenn falscher Account gescrapet wurde (verhindert Datenmüll)
- Dataset-Retry: 6 Versuche × 10s (Apify meldet SUCCEEDED oft bevor Dataset bereit ist), erster Versuch nach 15s

### Username-Sanitierung (kritisch!)
Sowohl Frontend als auch Backend bereinigen Usernames:
```javascript
// Konkurrenten.jsx (Frontend):
const username = addingUsername.trim().replace('@', '').replace(/\s+/g, '').toLowerCase()

// scrape-profile/index.ts (Backend):
const username = (body.username || '').trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9_.]/g, '').toLowerCase()
```
**Warum:** Leerzeichen im Username → kaputte Apify-URL → Apify scrapt Instagram-Empfehlungen statt Ziel-Account.

---

## Dynamic Coach Discovery

**Zwei-Schicht-System für Trend-Discovery:**

1. **`discover-coaches`** (wöchentlich, Sonntag 05:00 UTC) — sucht neue Coaches via Hashtag-Scraping:
   - Discovery-Hashtags: `onlinefitnesscoachenformen`, `mensfitnesscoach`, `onlinecoachformen`, etc.
   - Filter: ≥10K Follower + Coach-Keyword + KEIN Wettkampf/Bühnen-Keyword
   - Schreibt in `discovered_coaches` Tabelle
   - 20 Seed-Accounts sind vorgeladen für sofortigen Start

2. **`trend-discovery`** (täglich, automatisch via GitHub Actions) — scrapt 8 Coaches aus dem Pool:
   - Query: `discovered_coaches?is_active=eq.true&followers_count=gte.10000&order=last_scraped_at.asc.nullsfirst&limit=20`
   - Nimmt die 8 ältesten (least recently scraped) → Rotation durch den Pool
   - Setzt `last_scraped_at` sofort → verhindert Doppel-Scraping
   - Gibt Fehler mit Hinweis zurück wenn Pool leer ist

---

## GitHub Actions Workflows

`.github/workflows/daily-scrape.yml`:
- **05:00 UTC täglich**: fetch-external-signals, trend-discovery, transcribe-pending, classify-pillars
- **06:00 UTC täglich**: analyze-thomas
- **Sonntag 05:00 UTC**: discover-coaches (Coach-Pool auffüllen)
- **manual `workflow_dispatch`**: alle Jobs einzeln triggerbar (inkl. `discover`)

---

## AI-Logik (generate-content)

**Kein Ton-Selector** — Style wird automatisch aus `thomas_dna` geladen.

Layer-Architektur:
1. Thomas' Stil aus `thomas_dna` (analyze-thomas generiert)
2. Thomas' eigene Top-Posts (Engagement-basiert)
3. Competitor Top-Posts (Views-basiert)
4. Trend-Posts aus dynamischem Coach-Pool
5. Positiv bewerteter eigener Content (user_rating=1)
6. Reddit/Community-Signale aus `external_signals` (Relevanz ≥ 70)

---

## Dashboard — Aktuelle Struktur

**Was angezeigt wird:**
- Stats-Row (Followers, Posts, Engagement Rate)
- Daily Brief (AI-generierte Tagesbriefing, 1× pro Tag)
- **Content Intelligence** (6 datengetriebene Post-Ideen mit Hook, Format, Pillar, Score, Datengrundlage, Why it works)
- Content-Säulen (Verteilung haltung/transformation/mehrwert/verkauf)
- Competitors-Tabelle

**Was entfernt wurde:**
- ~~Trend Scout~~ — Daten fließen automatisch in Content Intelligence
- ~~Themenvorschläge~~ — Daten fließen automatisch in Content Intelligence
- ~~Trending bei Competitors~~ — Daten fließen automatisch in Content Intelligence
- ~~Reddit Insights Bereich~~ — fließt still als Signal-Layer in Content Intelligence

---

## Deployment Workflow

### Frontend (React)
```bash
git add src/...
git commit -m "..."
git push origin main
# → Cloudflare Pages deployed automatisch
```

### Edge Functions
```bash
# In social-intelligence Verzeichnis:
FNAME=generate-dashboard-posts
curl -s -X PATCH "https://api.supabase.com/v1/projects/shrsluxbrazqscgiwfpu/functions/$FNAME" \
  -H "Authorization: Bearer $(grep SUPABASE_ACCESS_TOKEN /Users/thomaspfeffer/Downloads/Thomas\ Fitness/form-app/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$FNAME\", \"verify_jwt\": false, \"body\": $(python3 -c "import json; print(json.dumps(open('supabase/functions/$FNAME/index.ts').read()))")}"
```

---

## Wichtige Hinweise

- **SUPABASE_ACCESS_TOKEN** steht in `/Users/thomaspfeffer/Downloads/Thomas Fitness/form-app/.env`
- **Supabase Projekt-Ref:** `shrsluxbrazqscgiwfpu`
- **Cloudflare Pages** deployed automatisch von `main` branch
- **Kein `supabase` CLI** installiert — Deployment über Management API (curl)
- **Keine Form App Logik** — komplett separates Projekt, andere DB, andere Functions
- **`CLAUDE_MODEL` env** in Supabase Secrets setzen — default `claude-sonnet-4-5`
- **Reddit/externe Signale** haben keinen eigenen UI-Bereich — sie fließen still in Content Intelligence
- **Competitor-Usernames** müssen exakt mit Instagram übereinstimmen (kein @, kein Leerzeichen)
- **trend_posts** werden automatisch nach 7 Tagen gelöscht (frische Daten immer)
