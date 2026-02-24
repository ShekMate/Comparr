// cache/plexCache.ts - Fast Plex availability checking
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { getAllMovies } from '../../api/plex.ts'

interface PlexMovieEntry {
  title: string
  year: number | null
  guid: string
  tmdbId?: number
  imdbId?: string
}

interface PlexAvailabilityCache {
  byTitleYear: Map<string, PlexMovieEntry[]> // key: "title|year"
  byTmdbId: Map<number, PlexMovieEntry>
  byImdbId: Map<string, PlexMovieEntry>
  lastUpdated: number
}

const cache: PlexAvailabilityCache = {
  byTitleYear: new Map(),
  byTmdbId: new Map(),
  byImdbId: new Map(),
  lastUpdated: 0,
}

const CACHE_REFRESH_INTERVAL = 60 * 60 * 1000 // 1 hour

let refreshTimerStarted = false
let initialBuildPromise: Promise<void> | null = null

/**
 * Normalize title for comparison
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ') // Normalize spaces
}

/**
 * Extract TMDb ID from various guid formats
 */
function extractTmdbId(guid?: string): number | undefined {
  if (!guid) return undefined

  const patterns = [
    /tmdb:\/\/(\d+)/,
    /themoviedb:\/\/(\d+)/,
    /themoviedb\.org\/movie\/(\d+)/,
  ]

  for (const pattern of patterns) {
    const match = guid.match(pattern)
    if (match) return parseInt(match[1])
  }

  return undefined
}

/**
 * Extract IMDb ID from guid
 */
function extractImdbId(guid?: string): string | undefined {
  if (!guid) return undefined
  const match = guid.match(/imdb:\/\/(tt\d+)/)
  return match ? match[1] : undefined
}

/**
 * Build the Plex availability cache from library
 */
export async function buildPlexCache(): Promise<void> {
  try {
    log.info('🔄 Building Plex availability cache...')
    const startTime = Date.now()

    const movies = await getAllMovies()

    // Clear existing cache
    cache.byTitleYear.clear()
    cache.byTmdbId.clear()
    cache.byImdbId.clear()

    let processedCount = 0
    let tmdbIdCount = 0
    let imdbIdCount = 0

    for (const movie of movies) {
      const entry: PlexMovieEntry = {
        title: movie.title,
        year: movie.year || null,
        guid: movie.guid,
        tmdbId: extractTmdbId(movie.guid),
        imdbId: extractImdbId(movie.guid),
      }

      // Index by title+year
      const titleYearKey = `${normalizeTitle(movie.title)}|${
        movie.year || 'unknown'
      }`
      if (!cache.byTitleYear.has(titleYearKey)) {
        cache.byTitleYear.set(titleYearKey, [])
      }
      cache.byTitleYear.get(titleYearKey)!.push(entry)

      // Index by TMDb ID
      if (entry.tmdbId) {
        cache.byTmdbId.set(entry.tmdbId, entry)
        tmdbIdCount++
      }

      // Index by IMDb ID
      if (entry.imdbId) {
        cache.byImdbId.set(entry.imdbId, entry)
        imdbIdCount++
      }

      processedCount++
    }

    cache.lastUpdated = Date.now()

    const duration = Date.now() - startTime
    log.info(
      `✅ Plex cache built: ${processedCount} movies (${tmdbIdCount} TMDb, ${imdbIdCount} IMDb) in ${duration}ms`
    )
  } catch (err) {
    log.error(`Failed to build Plex cache: ${err}`)
  }
}

/**
 * Initialize and start auto-refresh
 */
export async function initPlexCache(): Promise<void> {
  if (!initialBuildPromise) {
    initialBuildPromise = (async () => {
      await buildPlexCache()
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
      await buildPlexCache()
    } catch (err) {
      log.error(`Background Plex cache refresh failed: ${err}`)
    }
  }, CACHE_REFRESH_INTERVAL)

  log.info('⏰ Plex cache auto-refresh scheduled for every hour')
}

export function waitForPlexCacheReady(): Promise<void> {
  return initPlexCache()
}

/**
 * Check if a movie is in Plex by TMDb ID (fastest)
 */
export function isInPlexByTmdbId(tmdbId: number): boolean {
  return cache.byTmdbId.has(tmdbId)
}

/**
 * Check if a movie is in Plex by IMDb ID
 */
export function isInPlexByImdbId(imdbId: string): boolean {
  return cache.byImdbId.has(imdbId)
}

/**
 * Check if a movie is in Plex by title and year
 */
export function isInPlexByTitleYear(
  title: string,
  year?: number | null
): boolean {
  const normalizedTitle = normalizeTitle(title)

  // Check with year first (more accurate)
  if (year) {
    const key = `${normalizedTitle}|${year}`
    if (cache.byTitleYear.has(key)) {
      return true
    }

    // Also check year +/- 1 (sometimes release years differ)
    for (let offset = -1; offset <= 1; offset++) {
      const nearKey = `${normalizedTitle}|${year + offset}`
      if (cache.byTitleYear.has(nearKey)) {
        return true
      }
    }
  }

  // Fallback: check without year (less accurate)
  for (const [key, entries] of cache.byTitleYear.entries()) {
    if (key.startsWith(`${normalizedTitle}|`)) {
      return true
    }
  }

  return false
}

/**
 * Check if a movie is in Plex (tries multiple methods)
 */
export function isMovieInPlex(params: {
  tmdbId?: number
  imdbId?: string
  title?: string
  year?: number | null
}): boolean {
  // Try TMDb ID first (fastest and most accurate)
  if (params.tmdbId && isInPlexByTmdbId(params.tmdbId)) {
    return true
  }

  // Try IMDb ID
  if (params.imdbId && isInPlexByImdbId(params.imdbId)) {
    return true
  }

  // Fallback to title + year
  if (params.title) {
    return isInPlexByTitleYear(params.title, params.year)
  }

  return false
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return {
    totalMovies: cache.byTitleYear.size,
    moviesWithTmdbId: cache.byTmdbId.size,
    moviesWithImdbId: cache.byImdbId.size,
    lastUpdated: cache.lastUpdated,
    isStale: Date.now() - cache.lastUpdated > CACHE_REFRESH_INTERVAL,
  }
}

/**
 * Force a cache refresh
 */
export async function refreshPlexCache(): Promise<void> {
  await buildPlexCache()
}
