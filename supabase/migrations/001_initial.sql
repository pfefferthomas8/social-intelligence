-- Social Intelligence Tool — Initial Schema
-- Ausführen im Supabase Dashboard → SQL Editor

-- Eigenes Profil
CREATE TABLE IF NOT EXISTS own_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text,
  bio text,
  followers_count int DEFAULT 0,
  following_count int DEFAULT 0,
  posts_count int DEFAULT 0,
  profile_pic_url text,
  last_scraped_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Competitor Profile
CREATE TABLE IF NOT EXISTS competitor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text UNIQUE NOT NULL,
  display_name text,
  bio text,
  followers_count int DEFAULT 0,
  following_count int DEFAULT 0,
  posts_count int DEFAULT 0,
  profile_pic_url text,
  niche text,
  is_active bool DEFAULT true,
  last_scraped_at timestamptz,
  added_at timestamptz DEFAULT now()
);

-- Alle Posts (eigene + Competitors + Custom Imports)
CREATE TABLE IF NOT EXISTS instagram_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK (source IN ('own', 'competitor', 'custom')),
  competitor_id uuid REFERENCES competitor_profiles(id) ON DELETE SET NULL,
  instagram_post_id text,
  post_type text CHECK (post_type IN ('image', 'video', 'carousel', 'reel')),
  caption text,
  likes_count int DEFAULT 0,
  comments_count int DEFAULT 0,
  views_count int DEFAULT 0,
  video_url text,
  thumbnail_url text,
  transcript text,
  transcript_status text DEFAULT 'none' CHECK (transcript_status IN ('none', 'pending', 'done', 'error')),
  published_at timestamptz,
  scraped_at timestamptz DEFAULT now(),
  url text,
  UNIQUE(instagram_post_id, source)
);

CREATE INDEX IF NOT EXISTS idx_posts_source ON instagram_posts(source);
CREATE INDEX IF NOT EXISTS idx_posts_competitor ON instagram_posts(competitor_id);
CREATE INDEX IF NOT EXISTS idx_posts_scraped ON instagram_posts(scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_views ON instagram_posts(views_count DESC);
CREATE INDEX IF NOT EXISTS idx_posts_likes ON instagram_posts(likes_count DESC);

-- Generierter Content
CREATE TABLE IF NOT EXISTS generated_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('carousel', 'single_post', 'b_roll', 'video_script')),
  topic text,
  tone text,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_generated_created ON generated_content(created_at DESC);

-- Themenvorschläge (von KI generiert)
CREATE TABLE IF NOT EXISTS topic_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  reason text,
  category text CHECK (category IN ('trending', 'gap', 'evergreen', 'personal')),
  potential_views text,
  suggested_types text[], -- ['video_script', 'carousel', etc.]
  used bool DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_topics_used ON topic_suggestions(used, created_at DESC);

-- Scrape Jobs (Status-Tracking)
CREATE TABLE IF NOT EXISTS scrape_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('own_profile', 'competitor', 'reel')),
  target text NOT NULL,
  apify_run_id text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  result_count int DEFAULT 0,
  error_msg text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

-- RLS komplett deaktivieren (Single-User Tool, kein Supabase Auth)
ALTER TABLE own_profile DISABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_posts DISABLE ROW LEVEL SECURITY;
ALTER TABLE generated_content DISABLE ROW LEVEL SECURITY;
ALTER TABLE topic_suggestions DISABLE ROW LEVEL SECURITY;
ALTER TABLE scrape_jobs DISABLE ROW LEVEL SECURITY;
