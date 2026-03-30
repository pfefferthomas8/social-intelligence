import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://shrsluxbrazqscgiwfpu.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNocnNsdXhicmF6cXNjZ2l3ZnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4ODk4MjEsImV4cCI6MjA5MDQ2NTgyMX0.8hQITokKKhVCfdVTHoGiyUzsHggfD7i13IFumsOfnuo'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
