import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import PostCard from '../components/PostCard.jsx'

const SOURCES = [
  { key: 'all', label: 'Alle' },
  { key: 'own', label: 'Eigene' },
  { key: 'competitor', label: 'Competitors' },
  { key: 'custom', label: 'Imports' },
]
const TYPES = [
  { key: 'all', label: 'Alle' },
  { key: 'reel', label: 'Reels' },
  { key: 'video', label: 'Videos' },
  { key: 'image', label: 'Bilder' },
  { key: 'carousel', label: 'Karussell' },
]
const SORTS = [
  { key: 'scraped_at', label: 'Neueste' },
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
  const PAGE_SIZE = 15

  useEffect(() => {
    setPosts([])
    setPage(0)
    setHasMore(true)
    loadPosts(0, true)
  }, [source, postType, sort, search])

  async function loadPosts(pageNum = 0, reset = false) {
    setLoading(true)
    let query = supabase
      .from('instagram_posts')
      .select('*, competitor_profiles(username)', { count: 'exact' })
      .order(sort, { ascending: false })
      .range(pageNum * PAGE_SIZE, (pageNum + 1) * PAGE_SIZE - 1)

    if (source !== 'all') query = query.eq('source', source)
    if (postType !== 'all') query = query.eq('post_type', postType)
    if (search) query = query.or(`caption.ilike.%${search}%,transcript.ilike.%${search}%`)

    const { data, count, error } = await query
    if (!error) {
      const enriched = (data || []).map(p => ({
        ...p,
        competitor_username: p.competitor_profiles?.username
      }))
      if (reset) {
        setPosts(enriched)
      } else {
        setPosts(prev => [...prev, ...enriched])
      }
      setTotalCount(count || 0)
      setHasMore((data || []).length === PAGE_SIZE)
    }
    setLoading(false)
  }

  function loadMore() {
    const next = page + 1
    setPage(next)
    loadPosts(next)
  }

  function handleSearch(e) {
    e.preventDefault()
    setSearch(searchInput)
  }

  return (
    <div className="screen">
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>Wissensdatenbank</h1>
          <span style={{ fontSize: 13, color: '#505050', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
            {totalCount} Posts
          </span>
        </div>

        {/* Search */}
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            className="input"
            placeholder="Caption oder Transkript durchsuchen…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn btn-sm btn-primary" style={{ flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </form>

        {/* Filter Row */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
          {SOURCES.map(s => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 100,
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                fontSize: 12, fontWeight: 600,
                background: source === s.key ? '#ee4f00' : '#1a1a1a',
                color: source === s.key ? '#fff' : '#707070',
                transition: 'all 0.15s'
              }}
            >{s.label}</button>
          ))}
          <div style={{ width: 1, background: '#2a2a2a', flexShrink: 0, margin: '4px 2px' }} />
          {TYPES.map(t => (
            <button
              key={t.key}
              onClick={() => setPostType(t.key)}
              style={{
                flexShrink: 0, padding: '6px 14px', borderRadius: 100,
                border: 'none', cursor: 'pointer', fontFamily: 'var(--font)',
                fontSize: 12, fontWeight: 600,
                background: postType === t.key ? '#1a3a5c' : '#1a1a1a',
                color: postType === t.key ? '#60a5fa' : '#707070',
                transition: 'all 0.15s'
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {SORTS.map(s => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              style={{
                padding: '4px 12px', borderRadius: 100,
                border: '1px solid', cursor: 'pointer', fontFamily: 'var(--font)',
                fontSize: 11, fontWeight: 600,
                background: sort === s.key ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderColor: sort === s.key ? '#3a3a3a' : '#1e1e1e',
                color: sort === s.key ? '#d0d0d0' : '#505050',
                transition: 'all 0.15s'
              }}
            >{s.label}</button>
          ))}
        </div>
      </div>

      <div className="screen-content">
        {search && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, color: '#606060' }}>Suche: "{search}"</span>
            <button onClick={() => { setSearch(''); setSearchInput('') }} style={{
              background: 'none', border: 'none', color: '#ee4f00', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)', fontWeight: 600
            }}>✕ löschen</button>
          </div>
        )}

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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {posts.map(post => (
                <PostCard key={post.id} post={post} />
              ))}
            </div>

            {hasMore && (
              <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center' }}>
                <button
                  onClick={loadMore}
                  disabled={loading}
                  className="btn"
                  style={{ width: '100%' }}
                >
                  {loading ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Mehr laden'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
