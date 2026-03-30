import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import PostCard from '../components/PostCard.jsx'

const SOURCES = [
  { key: 'all', label: 'Alle Quellen' },
  { key: 'own', label: 'Eigene Posts' },
  { key: 'competitor', label: 'Competitors' },
  { key: 'custom', label: 'Imports' },
]
const TYPES = [
  { key: 'all', label: 'Alle Typen' },
  { key: 'reel', label: 'Reels' },
  { key: 'video', label: 'Videos' },
  { key: 'image', label: 'Bilder' },
  { key: 'carousel', label: 'Karussell' },
]
const SORTS = [
  { key: 'scraped_at', label: 'Neueste zuerst' },
  { key: 'views_count', label: 'Meiste Views' },
  { key: 'likes_count', label: 'Meiste Likes' },
]

export default function Wissensdatenbank() {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [source, setSource] = useState('all')
  const [postType, setPostType] = useState('all')
  const [sort, setSort] = useState('scraped_at')
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 20

  useEffect(() => {
    setPosts([]); setPage(0); setHasMore(true); loadPosts(0, true)
  }, [source, postType, sort, search])

  async function loadPosts(pageNum = 0, reset = false) {
    setLoading(true)
    let query = supabase.from('instagram_posts').select('*, competitor_profiles(username)', { count: 'exact' })
      .order(sort, { ascending: false }).range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)
    if (source !== 'all') query = query.eq('source', source)
    if (postType !== 'all') query = query.eq('post_type', postType)
    if (search) query = query.or(`caption.ilike.%${search}%,transcript.ilike.%${search}%`)
    const { data, count, error } = await query
    if (!error) {
      const enriched = (data || []).map(p => ({ ...p, competitor_username: p.competitor_profiles?.username }))
      reset ? setPosts(enriched) : setPosts(prev => [...prev, ...enriched])
      setTotalCount(count || 0)
      setHasMore((data || []).length === PAGE_SIZE)
    }
    setLoading(false)
  }

  function loadMore() { const next = page + 1; setPage(next); loadPosts(next) }
  function handleSearch(e) { e.preventDefault(); setSearch(searchInput) }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="page-title">Wissensdatenbank</div>
          <div className="page-subtitle">Alle gescrapten Posts, Transkripte und Imports</div>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text3)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
          {totalCount.toLocaleString()} Posts
        </span>
      </div>

      {/* Body: Filter Sidebar + Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Filter Sidebar */}
        <div style={{
          width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
          padding: '20px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24
        }}>
          {/* Search */}
          <div>
            <div className="section-label">Suche</div>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                placeholder="Caption, Transkript…"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                style={{ fontSize: 12, padding: '7px 10px' }}
              />
              <button type="submit" className="btn btn-sm btn-primary" style={{ padding: '7px 9px', flexShrink: 0 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2.2"/>
                  <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
                </svg>
              </button>
            </form>
            {search && (
              <button
                onClick={() => { setSearch(''); setSearchInput('') }}
                style={{
                  background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11, cursor: 'pointer',
                  fontFamily: 'var(--font)', marginTop: 6, padding: 0, fontWeight: 600
                }}
              >
                ✕ "{search}" löschen
              </button>
            )}
          </div>

          {/* Source Filter */}
          <div>
            <div className="section-label">Quelle</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {SOURCES.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                    borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font)', fontSize: 13, fontWeight: source === s.key ? 600 : 500,
                    background: source === s.key ? 'var(--accent-dim)' : 'transparent',
                    color: source === s.key ? 'var(--accent)' : 'var(--text3)',
                    transition: 'all 0.12s', textAlign: 'left', width: '100%'
                  }}
                >
                  {source === s.key && <div style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 }} />}
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filter */}
          <div>
            <div className="section-label">Typ</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {TYPES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setPostType(t.key)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                    borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font)', fontSize: 13, fontWeight: postType === t.key ? 600 : 500,
                    background: postType === t.key ? 'rgba(59,130,246,0.1)' : 'transparent',
                    color: postType === t.key ? 'var(--blue)' : 'var(--text3)',
                    transition: 'all 0.12s', textAlign: 'left', width: '100%'
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
          <div>
            <div className="section-label">Sortierung</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {SORTS.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  style={{
                    padding: '7px 10px', borderRadius: 'var(--r-sm)', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font)', fontSize: 13, fontWeight: sort === s.key ? 600 : 500,
                    background: sort === s.key ? 'rgba(255,255,255,0.05)' : 'transparent',
                    color: sort === s.key ? 'var(--text2)' : 'var(--text3)',
                    transition: 'all 0.12s', textAlign: 'left', width: '100%'
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Posts Area */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
          {loading && posts.length === 0 ? (
            <div className="empty-state"><div className="spinner" style={{ width: 24, height: 24 }} /></div>
          ) : posts.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">🗄️</div>
              <p className="empty-state-title">Keine Posts gefunden</p>
              <p className="empty-state-text">
                {search ? `Keine Ergebnisse für "${search}"` : 'Füge Competitors hinzu und scrap ihre Profile.'}
              </p>
            </div>
          ) : (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                {posts.map(post => <PostCard key={post.id} post={post} />)}
              </div>
              {hasMore && (
                <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
                  <button onClick={loadMore} disabled={loading} className="btn btn-sm">
                    {loading ? <span className="spinner" style={{ width: 14, height: 14 }} /> : 'Mehr laden'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
