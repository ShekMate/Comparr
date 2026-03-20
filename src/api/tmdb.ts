import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'

const TMDB_API_BASE = 'https://api.themoviedb.org/3'

export const tmdbFetch = async (
  path: string,
  apiKeyOrToken: string,
  searchParams?: Record<string, string | number | boolean | undefined>
) => {
  const url = new URL(`${TMDB_API_BASE}${path}`)
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
  }

  return await fetchWithTimeout(url.toString(), {
    headers: {
      accept: 'application/json',
      Authorization: `Bearer ${apiKeyOrToken}`,
    },
  })
}

