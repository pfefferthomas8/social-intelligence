# CLAUDE.md — Social Intelligence Tool

## Arbeitsanweisungen

- **Änderungen DIREKT in Dateien machen** — nicht erklären was zu tun wäre
- **Immer auf Deutsch antworten**
- **Niemals nach Bestätigungen fragen** — autonom arbeiten
- **Niemals nach API Keys fragen** — alle stehen in der `.env` Datei
- **Bei Fehlern selbst debuggen**: Logs lesen, Supabase direkt abfragen
- **Kein Raten** — immer erst relevante Dateien lesen bevor Änderungen gemacht werden
- **Deployment**: Frontend-Änderungen pushen → Cloudflare Pages deployed auto von `main`. Edge Functions manuell via Supabase Management API deployen.

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
| Scraping | Apify (`apify~instagram-profile-scraper`) |
| Transkription | AssemblyAI |
| AI | Anthropic Claude API |
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
| `/dashboard` | Dashboard (Stats, Topics, Trending) |
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
| visual_text_status | text | `pending` \| `done` \| `none` \| `error` |
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
| content_type | text |
| topic | text |
| content | text |
| created_at | timestamptz |

### topic_suggestions
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
| `scrape-profile` | Startet Apify-Run für Instagram-Profil (resultsType: "posts", resultsLimit: 50) |
| `scrape-webhook` | Apify-Webhook — speichert Posts in DB, triggert Transkription/Visual |
| `import-reel` | Einzelner Reel-Import via Apify |
| `transcribe-video` | AssemblyAI Transkription |
| `extract-visual-text` | Visuellen Text aus Thumbnail extrahieren |
| `generate-content` | Content-Generierung via Claude (kein Ton-Selector, Style aus eigenen Posts) |
| `topic-suggestions` | Themenvorschläge generieren, auto-refresh nach Scrape |

---

## Apify Integration

- Actor: `apify~instagram-profile-scraper`
- `resultsType: "posts"` → scrapt Grid, 50 Posts pro Profil (~5-10 Min)
- Webhook-basiert: kein Frontend-Polling, Apify ruft `scrape-webhook` auf wenn fertig
- `scrape-webhook` erkennt automatisch zwei Datenstrukturen:
  - **Posts-Modus** (neu): jedes Dataset-Item ist ein Post direkt
  - **Profile-Modus** (legacy): jedes Dataset-Item ist Profil mit `latestPosts[]`
- Concurrent: mehrere Profile gleichzeitig scrapbar, jeder Job unabhängig

---

## AI-Logik (generate-content)

**Kein Ton-Selector** — Style wird automatisch aus Thomas' eigenen Posts analysiert.

Drei-Schritt-Analyse:
1. Thomas' Stil aus seinen Top-Posts (Engagement) extrahieren
2. Virale Prinzipien aus EN-Competitor-Posts ableiten
3. Für DACH-Markt adaptieren (Thomas' Stimme + bewährte Prinzipien)

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
curl -s -X PATCH "https://api.supabase.com/v1/projects/shrsluxbrazqscgiwfpu/functions/FNAME" \
  -H "Authorization: Bearer $(grep SUPABASE_ACCESS_TOKEN /Users/thomaspfeffer/Downloads/Thomas\ Fitness/form-app/.env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"FNAME\", \"verify_jwt\": false, \"body\": $(python3 -c "import json; print(json.dumps(open('supabase/functions/FNAME/index.ts').read()))")}"
```

---

## Wichtige Hinweise

- **SUPABASE_ACCESS_TOKEN** steht in `/Users/thomaspfeffer/Downloads/Thomas Fitness/form-app/.env`
- **Supabase Projekt-Ref:** `shrsluxbrazqscgiwfpu`
- **Cloudflare Pages** deployed automatisch von `main` branch
- **Kein `supabase` CLI** installiert — Deployment über Management API (curl)
- **Keine Form App Logik** — komplett separates Projekt, andere DB, andere Functions
