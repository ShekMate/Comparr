// integrations/emby/cache.ts - Fast Emby availability checking
import * as log from 'jsr:@std/log'
import { getEmbyApiKey, getEmbyUrl } from '../../core/config.ts'
import { fetchWithTimeout } from '../../infra/http/fetch-with-timeout.ts'

interface EmbyMovieEntry {
  title: string
  year: number | null
  tmdbId?: number
  imdbId?: string
}

interface EmbyAvailabilityCache {
  byTitleYear: Map<string, EmbyMovieEntry[]>
  byTmdbId: Map<number, EmbyMovieEntry>
  byImdbId: Map<string, EmbyMovieEntry>
  lastUpdated: number
}

const cache: EmbyAvailabilityCache = {
  byTitleYear: new Map(),
  byTmdbId: new Map(),
  byImdbId: new Map(),
  lastUpdated: 0,
}

const CACHE_REFRESH_INTERVAL = 60 * 60 * 1000 // 1 hour

let refreshTimerStarted = false
let initialBuildPromise: Promise<void> | null = null

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
}

export async function buildEmbyCache(): Promise<void> {
  const url = getEmbyUrl()
  const apiKey = getEmbyApiKey()

  if (!url || !apiKey) {
    log.debug('Emby not configured, skipping cache build')
    return
  }

  try {
    log.info('🔄 Building Emby availability cache...')
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
      log.error(`Emby API error: ${response.status}`)
      return
    }

    const data: { Items?: Array<{ Name?: string; ProductionYear?: number; ProviderIds?: { Tmdb?: string; Imdb?: string } }> } = await response.json()
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

      const entry: EmbyMovieEntry = { title, year, tmdbId, imdbId }

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
      `✅ Emby cache built: ${processedCount} movies (${tmdbIdCount} TMDb, ${imdbIdCount} IMDb) in ${duration}ms`
    )
  } catch (err) {
    log.error(`Failed to build Emby cache: ${err}`)
  }
}

export async function initEmbyCache(): Promise<void> {
  const url = getEmbyUrl()
  const apiKey = getEmbyApiKey()

  if (!url || !apiKey) return

  if (!initialBuildPromise) {
    initialBuildPromise = (async () => {
      await buildEmbyCache()
      ensureRefreshTimer()
    })().catch(err => {
      initialBuildPromise = null
      throw err
    })
  }

  await initialBuildPromise
}

function ensureRefreshTimer() {
  if (refreshTimerStarted) return
  refreshTimerStarted = true

  setInterval(async () => {
    try {
      await buildEmbyCache()
    } catch (err) {
      log.error(`Background Emby cache refresh failed: ${err}`)
    }
  }, CACHE_REFRESH_INTERVAL)

  log.info('⏰ Emby cache auto-refresh scheduled for every hour')
}

export function isMovieInEmby(params: {
  tmdbId?: number
  imdbId?: string
  title?: string
  year?: number | null
}): boolean {
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

export async function refreshEmbyCache(): Promise<void> {
  await buildEmbyCache()
}

export function getAllEmbyMovies(): { tmdbId: number; title: string; year: number | null }[] {
  return Array.from(cache.byTmdbId.entries()).map(([tmdbId, entry]) => ({
    tmdbId,
    title: entry.title,
    year: entry.year,
  }))
}
