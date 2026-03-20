import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'

const TMDB_API_BASE = 'https://api.themoviedb.org/3'
const TMDB_BEARER_TOKEN_LIKE_PATTERN = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/

type TmdbCredentialMode = 'bearer' | 'apiKey'

const detectTmdbCredentialMode = (credential: string): TmdbCredentialMode => {
  const value = String(credential || '').trim()
  if (!value) return 'apiKey'
  // TMDb v4 tokens are JWT-like. Keep auto-detection strict to avoid false positives.
  if (TMDB_BEARER_TOKEN_LIKE_PATTERN.test(value)) return 'bearer'
  return 'apiKey'
}

export const tmdbFetch = async (
  path: string,
  apiKeyOrToken: string,
  searchParams?: Record<string, string | number | boolean | undefined>
) => {
  const credential = String(apiKeyOrToken || '').trim()
  const mode = detectTmdbCredentialMode(credential)
  const url = new URL(`${TMDB_API_BASE}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }
  if (mode === 'apiKey') {
    // v3 compatibility path: TMDb expects api_key query param.
    url.searchParams.set('api_key', credential)
  }

  return await fetchWithTimeout(url.toString(), {
    headers: {
      accept: 'application/json',
      ...(mode === 'bearer' ? { Authorization: `Bearer ${credential}` } : {}),
    },
  })
}
