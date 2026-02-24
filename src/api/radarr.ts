import { getRadarrApiKey, getRadarrUrl } from '../core/config.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

interface RadarrMovie {
  id: number
  title: string
  year: number
  tmdbId: number
  imdbId?: string
  hasFile: boolean
}

let movieCache: Map<number, RadarrMovie> = new Map()
let lastCacheUpdate = 0
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
const MAX_RADARR_CACHE_SIZE = 10000 // Supports libraries up to 10,000 movies

async function fetchRadarrMovies(): Promise<RadarrMovie[]> {
  const radarrUrl = getRadarrUrl()
  const radarrApiKey = getRadarrApiKey()
  if (!radarrUrl || !radarrApiKey) {
    log.warning('Radarr URL or API key not configured')
    return []
  }

  try {
    log.info('Fetching movie library from Radarr...')
    const response = await fetch(`${radarrUrl}/api/v3/movie`, {
      headers: {
        'X-Api-Key': radarrApiKey,
      },
    })

    if (!response.ok) {
      throw new Error(`Radarr API error: ${response.status}`)
    }

    const movies = await response.json()
    log.info(`Successfully loaded ${movies.length} movies from Radarr`)
    return movies
  } catch (error) {
    log.error(`Failed to fetch from Radarr: ${error}`)
    return []
  }
}

export async function refreshRadarrCache(): Promise<void> {
  const movies = await fetchRadarrMovies()
  const newCache = new Map<number, RadarrMovie>()

  let skippedCount = 0
  for (const movie of movies) {
    if (movie.tmdbId) {
      // Safety check: prevent cache from growing too large
      if (newCache.size >= MAX_RADARR_CACHE_SIZE) {
        skippedCount++
        continue
      }
      newCache.set(movie.tmdbId, movie)
    }
  }

  movieCache = newCache
  lastCacheUpdate = Date.now()
  log.info(`✅ Radarr cache updated with ${movieCache.size} movies`)

  if (skippedCount > 0) {
    log.warning(
      `⚠️ Radarr cache size limit reached. ${skippedCount} movies skipped. Consider increasing MAX_RADARR_CACHE_SIZE.`
    )
  }
}

export async function initializeRadarrCache(): Promise<void> {
  await refreshRadarrCache()

  // Set up daily refresh timer
  setInterval(async () => {
    try {
      await refreshRadarrCache()
    } catch (error) {
      log.error(`Background Radarr cache update failed: ${error}`)
    }
  }, CACHE_DURATION)

  log.info('⏰ Radarr background refresh scheduled for every 24 hours')
}

export function isMovieInRadarr(tmdbId: number): boolean {
  // Check if cache needs refresh (fallback safety)
  const now = Date.now()
  if (now - lastCacheUpdate > CACHE_DURATION) {
    log.warning('Radarr cache is stale, triggering refresh')
    updateCache().catch(err => log.error(`Cache refresh failed: ${err}`))
    return false // Return false for stale cache
  }

  const movie = movieCache.get(tmdbId)
  return movie ? movie.hasFile : false
}

export function getRadarrCacheStats(): {
  size: number
  lastUpdate: Date
  isStale: boolean
} {
  const now = Date.now()
  return {
    size: movieCache.size,
    lastUpdate: new Date(lastCacheUpdate),
    isStale: now - lastCacheUpdate > CACHE_DURATION,
  }
}
