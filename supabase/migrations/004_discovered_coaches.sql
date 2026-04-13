-- Migration 004: Discovered Coaches Pool
-- Dynamisch entdeckte Online Fitness Coaches für Männer (≥10K Follower)
-- Wird durch discover-coaches Edge Function befüllt und rotierend durch trend-discovery genutzt

CREATE TABLE IF NOT EXISTS discovered_coaches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  followers_count int DEFAULT 0,
  bio text,
  full_name text,
  posts_count int DEFAULT 0,
  discovered_at timestamptz DEFAULT now(),
  last_scraped_at timestamptz,           -- wann zuletzt für Trend-Posts gescrapt
  last_discovery_run timestamptz,        -- wann zuletzt als Quelle für Discovery genutzt
  is_active bool DEFAULT true,
  discovery_source text                  -- welcher Hashtag/Kanal hat ihn gefunden
);

CREATE INDEX IF NOT EXISTS idx_coaches_followers ON discovered_coaches(followers_count DESC);
CREATE INDEX IF NOT EXISTS idx_coaches_scraped ON discovered_coaches(last_scraped_at ASC NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_coaches_active ON discovered_coaches(is_active) WHERE is_active = true;
