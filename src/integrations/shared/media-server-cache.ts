// integrations/shared/media-server-cache.ts
// Generic availability cache factory for Emby/Jellyfin-compatible media servers
import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../../infra/http/fetch-with-timeout.ts'

interface MovieEntry {
  title: string
  year: number | null
  tmdbId?: number
  imdbId?: string
}

interface AvailabilityCache {
  byTitleYear: Map<string, MovieEntry[]>
  byTmdbId: Map<number, MovieEntry>
  byImdbId: Map<string, MovieEntry>
  lastUpdated: number
}

type LookupParams = {
  tmdbId?: number
  imdbId?: string
  title?: string
  year?: number | null
}

const CACHE_REFRESH_INTERVAL = 60 * 60 * 1000 // 1 hour

// ---------------------------------------------------------------------------
// On-demand, per-user fetch — for a user's own personal Emby/Jellyfin server or a
// friend's server shared with them (see src/features/session/personal-media-sources.ts).
// Both Emby and Jellyfin expose the same Items API shape (Jellyfin is an Emby fork), so one
// function serves both. Deliberately independent of the getUrl()/getApiKey() closures above,
// which read the single instance-wide admin config used by the legacy web/Docker flow — this
// takes url/apiKey explicitly and does no persistent caching (caller wraps with a short-lived
// TTL cache) — always a live fetch when called.
// ---------------------------------------------------------------------------

export interface OnDemandMediaServerMovie {
  title: string
  year: number | null
  tmdbId?: number
  imdbId?: string
}

export async function fetchMediaServerLibraryOnDemand(
  name: string,
  url: string,
  apiKey: string
): Promise<OnDemandMediaServerMovie[]> {
  const response = await fetchWithTimeout(
    `${url}/Items?IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds,Name,ProductionYear`,
    {
      headers: {
        'X-Emby-Token': apiKey,
        Accept: 'application/json',
      },
    }
  )

  if (!response.ok) {
    throw new Error(`${name} API error: ${response.status}`)
  }

  const data: {
    Items?: Array<{
      Name?: string
      ProductionYear?: number
      ProviderIds?: { Tmdb?: string; Imdb?: string }
    }>
  } = await response.json()

  return (data.Items || []).map(item => {
    const tmdbId = item.ProviderIds?.Tmdb
      ? parseInt(item.ProviderIds.Tmdb)
      : undefined
    return {
      title: item.Name || '',
      year: item.ProductionYear ?? null,
      tmdbId: tmdbId != null && !Number.isNaN(tmdbId) ? tmdbId : undefined,
      imdbId: item.ProviderIds?.Imdb || undefined,
    }
  })
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

export function createMediaServerCache(
  name: string,
  getUrl: () => string | undefined,
  getApiKey: () => string | undefined
) {
  const cache: AvailabilityCache = {
    byTitleYear: new Map(),
    byTmdbId: new Map(),
    byImdbId: new Map(),
    lastUpdated: 0,
  }

  let refreshTimerStarted = false
  let initialBuildPromise: Promise<void> | null = null

  async function buildCache(): Promise<void> {
    const url = getUrl()
    const apiKey = getApiKey()

    if (!url || !apiKey) {
      log.debug(`${name} not configured, skipping cache build`)
      return
    }

    try {
      log.info(`🔄 Building ${name} availability cache...`)
      const startTime = Date.now()

      const response = await fetchWithTimeout(
        `${url}/Items?IncludeItemTypes=Movie&Recursive=true&Fields=ProviderIds,Name,ProductionYear`,
        {
          headers: {
            'X-Emby-Token': apiKey,
            Accept: 'application/json',
          },
        }
      )

      if (!response.ok) {
        log.error(`${name} API error: ${response.status}`)
        return
      }

      const data: {
        Items?: Array<{
          Name?: string
          ProductionYear?: number
          ProviderIds?: { Tmdb?: string; Imdb?: string }
        }>
      } = await response.json()
      const movies = data.Items || []

      cache.byTitleYear.clear()
      cache.byTmdbId.clear()
      cache.byImdbId.clear()

      let processedCount = 0
      let tmdbIdCount = 0
      let imdbIdCount = 0

      for (const movie of movies) {
        const tmdbId = movie.ProviderIds?.Tmdb
          ? parseInt(movie.ProviderIds.Tmdb)
          : undefined
        const imdbId = movie.ProviderIds?.Imdb || undefined
        const title = movie.Name || ''
        const year = movie.ProductionYear ?? null

        const entry: MovieEntry = { title, year, tmdbId, imdbId }

        const titleYearKey = `${normalizeTitle(title)}|${year ?? 'unknown'}`
        if (!cache.byTitleYear.has(titleYearKey)) {
          cache.byTitleYear.set(titleYearKey, [])
        }
        cache.byTitleYear.get(titleYearKey)!.push(entry)

        if (tmdbId && !Number.isNaN(tmdbId)) {
          cache.byTmdbId.set(tmdbId, entry)
          tmdbIdCount++
        }

        if (imdbId) {
          cache.byImdbId.set(imdbId, entry)
          imdbIdCount++
        }

        processedCount++
      }

      cache.lastUpdated = Date.now()
      const duration = Date.now() - startTime
      log.info(
        `✅ ${name} cache built: ${processedCount} movies (${tmdbIdCount} TMDb, ${imdbIdCount} IMDb) in ${duration}ms`
      )
    } catch (err) {
      log.error(`Failed to build ${name} cache: ${err}`)
    }
  }

  function ensureRefreshTimer() {
    if (refreshTimerStarted) return
    refreshTimerStarted = true

    setInterval(async () => {
      try {
        await buildCache()
      } catch (err) {
        log.error(`Background ${name} cache refresh failed: ${err}`)
      }
    }, CACHE_REFRESH_INTERVAL)

    log.info(`⏰ ${name} cache auto-refresh scheduled for every hour`)
  }

  async function initCache(): Promise<void> {
    const url = getUrl()
    const apiKey = getApiKey()

    if (!url || !apiKey) return

    if (!initialBuildPromise) {
      initialBuildPromise = (async () => {
        await buildCache()
        ensureRefreshTimer()
      })().catch(err => {
        initialBuildPromise = null
        throw err
      })
    }

    await initialBuildPromise
  }

  function isMovieIn(params: LookupParams): boolean {
    if (params.tmdbId && cache.byTmdbId.has(params.tmdbId)) return true
    if (params.imdbId && cache.byImdbId.has(params.imdbId)) return true

    if (params.title) {
      const normalizedTitle = normalizeTitle(params.title)
      const year = params.year

      if (year) {
        for (let offset = -1; offset <= 1; offset++) {
          if (cache.byTitleYear.has(`${normalizedTitle}|${year + offset}`)) {
            return true
          }
        }
      }

      for (const key of cache.byTitleYear.keys()) {
        if (key.startsWith(`${normalizedTitle}|`)) return true
      }
    }

    return false
  }

  function getAllMovies(): {
    tmdbId: number
    title: string
    year: number | null
  }[] {
    return Array.from(cache.byTmdbId.entries()).map(([tmdbId, entry]) => ({
      tmdbId,
      title: entry.title,
      year: entry.year,
    }))
  }

  return { buildCache, initCache, isMovieIn, getAllMovies }
}
