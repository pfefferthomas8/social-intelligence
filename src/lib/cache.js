const cache = new Map()
const TTL = 5 * 60 * 1000 // 5 Minuten

export function getCached(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.ts > TTL) { cache.delete(key); return null }
  return entry.data
}

export function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() })
}

export function invalidate(key) {
  cache.delete(key)
}

export function invalidatePattern(pattern) {
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key)
  }
}

export async function fetchWithCache(key, fetcher) {
  const cached = getCached(key)
  if (cached) return cached
  const data = await fetcher()
  setCached(key, data)
  return data
}
