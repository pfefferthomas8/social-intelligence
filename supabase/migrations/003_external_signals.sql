-- Migration 003: External Signals (Reddit, Google Trends, etc.)

CREATE TABLE IF NOT EXISTS external_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('reddit', 'google_trends', 'youtube', 'news')),
  title text NOT NULL,
  body text,
  url text,
  score int DEFAULT 0,
  signal_type text CHECK (signal_type IN ('pain_point', 'question', 'trending_topic', 'success_story', 'controversy')),
  relevance_score int CHECK (relevance_score BETWEEN 0 AND 100),
  claude_insight text,
  keywords text[],
  fetched_at timestamptz DEFAULT now(),
  used bool DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_signals_relevance ON external_signals(relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_signals_source ON external_signals(source);
CREATE INDEX IF NOT EXISTS idx_signals_fetched ON external_signals(fetched_at DESC);
