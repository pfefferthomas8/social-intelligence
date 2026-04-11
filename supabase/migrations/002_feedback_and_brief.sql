-- Migration 002: Feedback Loop + Daily Brief Spalten

-- Feedback-Bewertung auf generated_content (1 = positiv, -1 = negativ, NULL = nicht bewertet)
ALTER TABLE generated_content
  ADD COLUMN IF NOT EXISTS user_rating smallint CHECK (user_rating IN (-1, 1)),
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'manual'; -- 'manual' | 'daily_brief'

-- Index für schnelle Abfrage hoch bewerteter Posts im generate-content Prompt
CREATE INDEX IF NOT EXISTS idx_content_rating ON generated_content(user_rating) WHERE user_rating IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_pillar ON generated_content(content_pillar) WHERE content_pillar IS NOT NULL;
