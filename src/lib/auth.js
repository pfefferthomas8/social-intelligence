const TOKEN_KEY = 'si_token'
const SUPABASE_URL = 'https://shrsluxbrazqscgiwfpu.supabase.co'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function isAuthenticated() {
  return !!getToken()
}

export async function apiFetch(path, options = {}) {
  const token = getToken()
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {})
    }
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(err || `HTTP ${res.status}`)
  }
  return res.json()
}
