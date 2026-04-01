import type { CompatRequest } from '../compat-request.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { tmdbFetch } from '../../../api/tmdb.ts'
import { getTmdbApiKey } from '../../../core/config.ts'
import { getIMDbRating } from '../../../features/catalog/imdb-datasets.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

// Same genre map used by the frontend filterDisplayNames
const TMDB_GENRE_MAP: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy',
  80: 'Crime', 99: 'Documentary', 18: 'Drama', 10751: 'Family',
  14: 'Fantasy', 36: 'History', 27: 'Horror', 10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
  10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
}

function extractUsContentRating(releaseDates: any): string | null {
  const us = releaseDates?.results?.find((r: any) => r?.iso_3166_1 === 'US')
  if (!us?.release_dates) return null
  const preferredTypes = new Set([3, 2, 1])
  for (const rd of us.release_dates) {
    const cert = String(rd?.certification || '').trim()
    if (cert && preferredTypes.has(Number(rd?.type))) return cert
  }
  const anyWithCert = us.release_dates.find((rd: any) => String(rd?.certification || '').trim())
  return anyWithCert ? String(anyWithCert.certification).trim() : null
}

function extractWatchProviders(providers: any): any[] {
  const us = providers?.results?.US
  if (!us) return []
  const seen = new Set<number>()
  const result: any[] = []
  for (const p of [...(us.flatrate || []), ...(us.free || [])]) {
    if (!seen.has(p.provider_id)) {
      seen.add(p.provider_id)
      result.push({
        id: p.provider_id,
        name: p.provider_name,
        logo_path: p.logo_path || null,
        type: us.flatrate?.some((f: any) => f.provider_id === p.provider_id) ? 'subscription' : 'free',
      })
    }
  }
  return result
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

    const baseMovies = (data?.results ?? []).slice(0, 20).map((m: any) => ({
      tmdbId: m.id,
      guid: `tmdb://${m.id}`,
      title: m.title || '',
      year: m.release_date ? String(m.release_date).slice(0, 4) : '',
      art: m.poster_path ? `/tmdb-poster${m.poster_path}` : '',
      summary: m.overview || '',
      rating_tmdb: typeof m.vote_average === 'number'
        ? Number(m.vote_average.toFixed(1))
        : null,
      genres: (m.genre_ids ?? [])
        .map((id: number) => TMDB_GENRE_MAP[id])
        .filter(Boolean),
      original_language: m.original_language || null,
      originalLanguage: m.original_language || null,
      voteCount: m.vote_count || null,
      popularity: m.popularity || null,
      type: 'movie',
    }))

    // Enrich each movie with details (runtime, contentRating, watchProviders)
    const movies = await Promise.all(
      baseMovies.map(async (m: any) => {
        try {
          const details = await tmdbFetch(`/movie/${m.tmdbId}`, apiKey, {
            append_to_response: 'external_ids,release_dates,watch/providers',
          }).then(r => r.json())

          const imdbId: string | null = details?.external_ids?.imdb_id ?? null
          const rating_imdb = imdbId ? getIMDbRating(imdbId) : null

          return {
            ...m,
            runtime: details?.runtime ?? null,
            contentRating: extractUsContentRating(details?.release_dates),
            watchProviders: extractWatchProviders(details?.['watch/providers']),
            ...(rating_imdb !== null ? { rating_imdb } : {}),
          }
        } catch {
          return m
        }
      })
    )

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
