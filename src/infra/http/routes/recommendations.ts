import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { tmdbFetch } from '../../../api/tmdb.ts'
import { getTmdbApiKey } from '../../../core/config.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleRecommendationsRoute(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path !== '/api/recommendations') {
    return null
  }

  const url = new URL(req.url, 'http://local')
  const tmdbIdStr = url.searchParams.get('tmdbId') || ''
  const tmdbId = Number(tmdbIdStr)

  if (!tmdbId || !Number.isFinite(tmdbId)) {
    return new Response(JSON.stringify({ error: 'Missing or invalid tmdbId' }), {
      status: 400,
      headers: makeJsonHeaders(req),
    })
  }

  const apiKey = getTmdbApiKey()
  if (!apiKey) {
    return new Response(JSON.stringify({ movies: [] }), {
      status: 200,
      headers: makeJsonHeaders(req),
    })
  }

  try {
    const data = await tmdbFetch(`/movie/${tmdbId}/recommendations`, apiKey, {
      page: '1',
    }).then(r => r.json())

    const movies = (data?.results ?? []).slice(0, 20).map((m: any) => ({
      tmdbId: m.id,
      guid: `tmdb://${m.id}`,
      title: m.title || '',
      year: m.release_date ? String(m.release_date).slice(0, 4) : '',
      art: m.poster_path ? `/tmdb-poster${m.poster_path}` : '',
      summary: m.overview || '',
      rating_tmdb: typeof m.vote_average === 'number'
        ? Number(m.vote_average.toFixed(1))
        : null,
      genres: [],
      type: 'movie',
    }))

    return new Response(JSON.stringify({ movies }), {
      status: 200,
      headers: makeJsonHeaders(req),
    })
  } catch {
    return new Response(JSON.stringify({ movies: [] }), {
      status: 200,
      headers: makeJsonHeaders(req),
    })
  }
}
