// cache/posterCache.ts - Local poster storage and serving
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'

const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
const POSTER_CACHE_DIR = `${DATA_DIR}/poster-cache`
const MAX_CACHE_SIZE_MB = 500 // 500MB max cache size
const CACHE_METADATA_FILE = `${POSTER_CACHE_DIR}/cache-metadata.json`

interface PosterCacheMetadata {
  entries: {
    [key: string]: {
      filename: string
      size: number
      lastAccessed: number
      source: 'plex' | 'tmdb'
    }
  }
  totalSize: number
}

let cacheMetadata: PosterCacheMetadata = { entries: {}, totalSize: 0 }

const pendingPrefetches = new Map<string, Promise<void>>()

/**
 * Initialize poster cache directory and load metadata
 */
export async function initPosterCache(): Promise<void> {
  try {
    await Deno.mkdir(POSTER_CACHE_DIR, { recursive: true })

    // Load existing metadata
    try {
      const data = await Deno.readTextFile(CACHE_METADATA_FILE)
      cacheMetadata = JSON.parse(data)
      log.info(
        `📦 Loaded poster cache: ${
          Object.keys(cacheMetadata.entries).length
        } posters, ${(cacheMetadata.totalSize / 1024 / 1024).toFixed(2)}MB`
      )
    } catch {
      log.info('📦 Initialized new poster cache')
      await saveMetadata()
    }
  } catch (err) {
    log.error(`Failed to initialize poster cache: ${err}`)
  }
}

/**
 * Save cache metadata to disk
 */
async function saveMetadata(): Promise<void> {
  try {
    const tmp = `${CACHE_METADATA_FILE}.tmp.${Date.now()}`
    await Deno.writeTextFile(tmp, JSON.stringify(cacheMetadata, null, 2))
    await Deno.rename(tmp, CACHE_METADATA_FILE)
  } catch (err) {
    log.error(`Failed to save cache metadata: ${err}`)
  }
}

/**
 * Generate cache key from poster path
 */
function getCacheKey(posterPath: string, source: 'plex' | 'tmdb'): string {
  return `${source}-${posterPath.replace(/[^a-zA-Z0-9]/g, '_')}`
}

/**
 * Get filename for cached poster
 */
function getCacheFilename(cacheKey: string): string {
  return `${cacheKey}.jpg`
}

/**
 * Evict old posters if cache is too large
 */
async function evictIfNeeded(): Promise<void> {
  const maxSizeBytes = MAX_CACHE_SIZE_MB * 1024 * 1024

  if (cacheMetadata.totalSize <= maxSizeBytes) {
    return
  }

  log.info(
    `🗑️ Cache size ${(cacheMetadata.totalSize / 1024 / 1024).toFixed(
      2
    )}MB exceeds limit, evicting old posters...`
  )

  // Sort by last accessed (oldest first)
  const entries = Object.entries(cacheMetadata.entries).sort(
    ([, a], [, b]) => a.lastAccessed - b.lastAccessed
  )

  let freedSpace = 0
  let evictedCount = 0

  for (const [key, entry] of entries) {
    if (cacheMetadata.totalSize - freedSpace <= maxSizeBytes * 0.8) {
      break // Reduce to 80% of max to avoid frequent evictions
    }

    try {
      await Deno.remove(`${POSTER_CACHE_DIR}/${entry.filename}`)
      freedSpace += entry.size
      delete cacheMetadata.entries[key]
      evictedCount++
    } catch (err) {
      log.error(`Failed to evict ${entry.filename}: ${err}`)
    }
  }

  cacheMetadata.totalSize -= freedSpace
  await saveMetadata()

  log.info(
    `✅ Evicted ${evictedCount} posters, freed ${(
      freedSpace /
      1024 /
      1024
    ).toFixed(2)}MB`
  )
}

/**
 * Cache a poster from a URL
 */
export async function cachePoster(
  posterPath: string,
  source: 'plex' | 'tmdb',
  url: string
): Promise<string | null> {
  const cacheKey = getCacheKey(posterPath, source)
  const filename = getCacheFilename(cacheKey)
  const filepath = `${POSTER_CACHE_DIR}/${filename}`

  // Check if already cached
  if (cacheMetadata.entries[cacheKey]) {
    cacheMetadata.entries[cacheKey].lastAccessed = Date.now()
    await saveMetadata()
    return `/cached-poster/${filename}`
  }

  try {
    // Download poster
    const response = await fetch(url)
    if (!response.ok) {
      log.error(`Failed to download poster from ${url}: ${response.status}`)
      return null
    }

    const imageData = new Uint8Array(await response.arrayBuffer())

    // Save to disk
    await Deno.writeFile(filepath, imageData)

    // Update metadata
    cacheMetadata.entries[cacheKey] = {
      filename,
      size: imageData.length,
      lastAccessed: Date.now(),
      source,
    }
    cacheMetadata.totalSize += imageData.length

    await saveMetadata()

    // Check if eviction is needed
    await evictIfNeeded()

    log.debug(
      `✅ Cached poster: ${filename} (${(imageData.length / 1024).toFixed(
        2
      )}KB)`
    )
    return `/cached-poster/${filename}`
  } catch (err) {
    log.error(`Failed to cache poster ${posterPath}: ${err}`)
    return null
  }
}

/**
 * Get cached poster path if it exists
 */
export function getCachedPosterPath(
  posterPath: string,
  source: 'plex' | 'tmdb'
): string | null {
  const cacheKey = getCacheKey(posterPath, source)
  const entry = cacheMetadata.entries[cacheKey]

  if (!entry) {
    return null
  }

  // Update last accessed time
  entry.lastAccessed = Date.now()
  saveMetadata() // Fire and forget

  return `/cached-poster/${entry.filename}`
}

function normalizePosterPath(posterPath: string): string {
  let tmdbPath = posterPath
  if (tmdbPath.startsWith('/tmdb-poster/')) {
    tmdbPath = tmdbPath.slice('/tmdb-poster'.length)
  } else if (tmdbPath.startsWith('/poster/')) {
    tmdbPath = tmdbPath.slice('/poster'.length)
  }

  if (!tmdbPath.startsWith('/')) tmdbPath = `/${tmdbPath}`
  return tmdbPath
}

export function prefetchPoster(
  posterPath: string,
  source: 'plex' | 'tmdb'
): void {
  if (!posterPath || posterPath.startsWith('/cached-poster/')) return
  if (source !== 'tmdb') return

  const normalizedPath = normalizePosterPath(posterPath)

  if (getCachedPosterPath(normalizedPath, source)) {
    return
  }

  const cacheKey = `${source}:${normalizedPath}`
  if (pendingPrefetches.has(cacheKey)) {
    return
  }

  const url = `https://image.tmdb.org/t/p/w500${normalizedPath}`

  const task = cachePoster(normalizedPath, source, url)
    .then(() => {
      log.debug(`✅ Prefetched poster ${normalizedPath}`)
    })
    .catch(err => {
      log.debug(`⚠️ Poster prefetch failed for ${normalizedPath}: ${err}`)
    })
    .finally(() => {
      pendingPrefetches.delete(cacheKey)
    })

  pendingPrefetches.set(
    cacheKey,
    task.then(() => undefined)
  )
}

/**
 * Serve a cached poster
 */
export async function serveCachedPoster(
  filename: string,
  req: any
): Promise<boolean> {
  const filepath = `${POSTER_CACHE_DIR}/${filename}`

  try {
    const imageData = await Deno.readFile(filepath)
    await req.respond({
      status: 200,
      body: imageData,
      headers: new Headers({
        'content-type': 'image/jpeg',
        'cache-control': 'public, max-age=31536000, immutable', // Cache for 1 year
      }),
    })
    return true
  } catch (err) {
    log.error(`Failed to serve cached poster ${filename}: ${err}`)
    return false
  }
}

export function getBestPosterUrl(
  posterPath: string,
  source: 'plex' | 'tmdb'
): string {
  if (!posterPath) return posterPath

  // Already final?
  if (posterPath.startsWith('/cached-poster/')) return posterPath

  // Normalize to a pure TMDB path by stripping known local prefixes
  const tmdbPath = normalizePosterPath(posterPath)

  // Try cached file first
  const cachedPath = getCachedPosterPath(tmdbPath, source)
  if (cachedPath) return cachedPath

  // Fall back to canonical local proxy
  return `/tmdb-poster${tmdbPath}`
}
