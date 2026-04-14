-- Video Storage für Transkription
-- Instagram CDN URLs laufen ab → Videos temporär in Supabase Storage speichern

-- Neue Spalte: Pfad der gespeicherten Video-Datei in Supabase Storage
ALTER TABLE instagram_posts ADD COLUMN IF NOT EXISTS storage_video_path text;

-- Storage Bucket für temporäre Video-Dateien (privat, max 150MB pro Datei)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'instagram-videos',
  'instagram-videos',
  false,
  157286400,  -- 150MB
  ARRAY['video/mp4', 'video/quicktime', 'video/webm', 'video/*']
)
ON CONFLICT (id) DO NOTHING;
