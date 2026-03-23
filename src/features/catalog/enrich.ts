// src/features/catalog/enrich.ts
// Enriches Plex/TMDb movies with ratings, plot, and metadata.
// Priority: 1) Local IMDb database, 2) TMDb API

import { getIMDbRating } from './imdb-datasets.ts'
import { getPlexLibraryName, getEmbyLibraryName, getJellyfinLibraryName, getTmdbApiKey, getDataDir } from '../../core/config.ts'
import { tmdbFetch } from '../../api/tmdb.ts'
import * as log from 'jsr:@std/log'

const getTmdbKey = () => getTmdbApiKey()
const tmdbCache = new Map<string, any>()
const tmdbSearchCache = new Map<string, any>()

type EnrichmentPayload = {
  plot: string | null
  imdbId: string | null
  rating_imdb: number | null
  rating_tmdb: number | null
  rating_comparr: number | null
  genres: string[]
  streamingServices: { subscription: any[]; free: any[] }
  watchProviders: any[]
  contentRating: string | null
  tmdbPosterPath: string | null
  cast: string[]
  castMembers: Array<{
    name: string
    character: string
    profilePath: string | null
  }>
  writers: string[]
  director: string | null
  runtime: number | null
  original_language: string | null
  originalLanguage: string | null
  streamingLink: string | null
  voteCount: number | null
  tmdbId: number | null
}

type PersistedEnrichmentEntry = {
  value: EnrichmentPayload
  updatedAt: number
}

const ENRICH_CACHE_TTL_MS = Number(
  Deno.env.get('ENRICH_CACHE_TTL_MS') ?? `${7 * 24 * 60 * 60 * 1000}`
)
const ENRICH_CACHE_MAX_ENTRIES = Number(
  Deno.env.get('ENRICH_CACHE_MAX_ENTRIES') ?? '5000'
)
const ENRICH_CACHE_FILE = `${getDataDir()}/enrichment-cache.json`
const enrichmentCache = new Map<string, PersistedEnrichmentEntry>()
let enrichmentCacheLoaded = false
let persistPromise: Promise<void> | null = null
let persistRequested = false

function extractTmdbIdFromGuid(guid?: string | null): number | null {
  if (!guid) return null
  const match = guid.match(/tmdb:\/\/(\d+)/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function buildEnrichmentCacheKey({
  title,
  year,
  imdbId,
  tmdbId,
}: {
  title: string
  year?: number | null
  imdbId?: string | null
  tmdbId?: number | null
}) {
  if (imdbId) return `imdb:${imdbId}`
  if (tmdbId != null) return `tmdb:${tmdbId}`
  return `title:${title.trim().toLowerCase()}::${year ?? 'noyear'}`
}

function buildCandidateCacheKeys({
  title,
  year,
  imdbId,
  tmdbId,
}: {
  title: string
  year?: number | null
  imdbId?: string | null
  tmdbId?: number | null
}): string[] {
  const keys: string[] = []
  if (imdbId) keys.push(`imdb:${imdbId}`)
  if (tmdbId != null) keys.push(`tmdb:${tmdbId}`)
  keys.push(`title:${title.trim().toLowerCase()}::${year ?? 'noyear'}`)
  return [...new Set(keys)]
}

function sanitizeEnrichmentPayload(value: any): EnrichmentPayload {
  return {
    plot: value?.plot ?? null,
    imdbId: value?.imdbId ?? null,
    rating_imdb: value?.rating_imdb ?? null,
    rating_tmdb: value?.rating_tmdb ?? null,
    rating_comparr: value?.rating_comparr ?? null,
    genres: Array.isArray(value?.genres) ? value.genres : [],
    streamingServices: {
      subscription: Array.isArray(value?.streamingServices?.subscription)
        ? value.streamingServices.subscription
        : [],
      free: Array.isArray(value?.streamingServices?.free)
        ? value.streamingServices.free
        : [],
    },
    watchProviders: Array.isArray(value?.watchProviders)
      ? value.watchProviders
      : [],
    contentRating: value?.contentRating ?? null,
    tmdbPosterPath: value?.tmdbPosterPath ?? null,
    cast: Array.isArray(value?.cast) ? value.cast : [],
    castMembers: Array.isArray(value?.castMembers)
      ? value.castMembers
          .map((member: any) => ({
            name: typeof member?.name === 'string' ? member.name : '',
            character:
              typeof member?.character === 'string' ? member.character : '',
            profilePath:
              typeof member?.profilePath === 'string'
                ? member.profilePath
                : null,
          }))
          .filter((member: any) => member.name)
      : [],
    writers: Array.isArray(value?.writers) ? value.writers : [],
    director: value?.director ?? null,
    runtime: value?.runtime ?? null,
    original_language:
      value?.original_language ?? value?.originalLanguage ?? null,
    originalLanguage:
      value?.originalLanguage ?? value?.original_language ?? null,
    streamingLink: value?.streamingLink ?? null,
    voteCount: value?.voteCount ?? null,
    tmdbId: value?.tmdbId ?? null,
  }
}

async function loadPersistentEnrichmentCache() {
  if (enrichmentCacheLoaded) return
  enrichmentCacheLoaded = true
  try {
    const raw = await Deno.readTextFile(ENRICH_CACHE_FILE)
    const parsed = JSON.parse(raw) as Record<string, PersistedEnrichmentEntry>
    const now = Date.now()
    for (const [key, entry] of Object.entries(parsed)) {
      if (
        !entry ||
        typeof entry.updatedAt !== 'number' ||
        now - entry.updatedAt > ENRICH_CACHE_TTL_MS
      ) {
        continue
      }
      enrichmentCache.set(key, {
        updatedAt: entry.updatedAt,
        value: sanitizeEnrichmentPayload(entry.value),
      })
    }
    log.info(
      `[enrich] loaded ${enrichmentCache.size} persisted enrichment cache entries`
    )
  } catch {
    // no persisted cache yet
  }
}

function trimPersistentCacheIfNeeded() {
  if (enrichmentCache.size <= ENRICH_CACHE_MAX_ENTRIES) return
  const sorted = [...enrichmentCache.entries()].sort(
    (a, b) => a[1].updatedAt - b[1].updatedAt
  )
  const deleteCount = enrichmentCache.size - ENRICH_CACHE_MAX_ENTRIES
  for (let i = 0; i < deleteCount; i++) {
    enrichmentCache.delete(sorted[i][0])
  }
}

function schedulePersistEnrichmentCache() {
  persistRequested = true
  if (persistPromise) return
  persistPromise = (async () => {
    await new Promise(resolve => setTimeout(resolve, 250))
    if (!persistRequested) return
    persistRequested = false
    try {
      trimPersistentCacheIfNeeded()
      await Deno.mkdir(ENRICH_DATA_DIR, { recursive: true })
      const payload = Object.fromEntries(enrichmentCache.entries())
      const tmp = `${ENRICH_CACHE_FILE}.tmp`
      await Deno.writeTextFile(tmp, JSON.stringify(payload))
      await Deno.rename(tmp, ENRICH_CACHE_FILE)
    } catch (err) {
      log.error(
        `[enrich] failed to persist enrichment cache: ${err?.message || err}`
      )
    }
  })().finally(() => {
    persistPromise = null
    if (persistRequested) {
      schedulePersistEnrichmentCache()
    }
  })
}

function getCachedEnrichmentByKeys(keys: string[]): EnrichmentPayload | null {
  const now = Date.now()
  for (const key of keys) {
    const cached = enrichmentCache.get(key)
    if (!cached) continue
    if (now - cached.updatedAt > ENRICH_CACHE_TTL_MS) {
      enrichmentCache.delete(key)
      continue
    }

    cached.updatedAt = now
    return sanitizeEnrichmentPayload(cached.value)
  }
  return null
}

function storeEnrichmentForKeys(
  keys: string[],
  value: EnrichmentPayload
): void {
  const sanitized = sanitizeEnrichmentPayload(value)
  const updatedAt = Date.now()
  for (const key of keys) {
    enrichmentCache.set(key, { value: sanitized, updatedAt })
  }
  schedulePersistEnrichmentCache()
}

function extractUsContentRating(releaseDates: any): string | null {
  const us = releaseDates?.results?.find((r: any) => r?.iso_3166_1 === 'US')
  if (!us?.release_dates) return null

  const preferredTypes = new Set([3, 2, 1]) // Theatrical limited, Theatrical, Premiere
  for (const rd of us.release_dates) {
    const cert = String(rd?.certification || '').trim()
    if (cert && preferredTypes.has(Number(rd?.type))) return cert
  }

  const anyWithCert = us.release_dates.find((rd: any) =>
    String(rd?.certification || '').trim()
  )
  return anyWithCert ? String(anyWithCert.certification).trim() : null
}

async function tmdbSearchMovie(title: string, year?: number | null) {
  const TMDB = getTmdbKey()
  if (!TMDB || !title) return null as any

  const cacheKey = `search-${title}-${year || 'noyear'}`
  if (tmdbSearchCache.has(cacheKey)) {
    return tmdbSearchCache.get(cacheKey)
  }

  const q = new URLSearchParams({
    query: title,
    include_adult: 'false',
  })
  if (year) q.set('year', String(year))

  const data = await tmdbFetch(
    '/search/movie',
    TMDB,
    Object.fromEntries(q.entries())
  ).then(r => r.json())
  const result = data?.results?.[0] ?? null
  if (result) tmdbSearchCache.set(cacheKey, result)
  return result
}

async function tmdbMovieDetails(id: number) {
  const TMDB = getTmdbKey()
  if (!TMDB || !id) return null as any

  const cacheKey = `details-${id}`
  if (tmdbCache.has(cacheKey)) {
    return tmdbCache.get(cacheKey)
  }

  const result = await tmdbFetch(`/movie/${id}`, TMDB, {
    append_to_response: 'external_ids,watch/providers,credits,release_dates',
  }).then(r => r.json())
  if (result) tmdbCache.set(cacheKey, result)
  return result
}

const imdbFromGuid = (guid?: string | null) => {
  if (!guid) return null
  const m = guid.match(/imdb:\/\/(tt\d{7,})/i)
  return m ? m[1] : null
}

export async function enrich({
  title,
  year,
  plexGuid,
  imdbId: providedImdbId,
  tmdbId: providedTmdbId,
}: {
  title: string
  year?: number | null
  plexGuid?: string | null
  imdbId?: string | null
  tmdbId?: number | null
}) {
  await loadPersistentEnrichmentCache()

  let plot: string | null = null
  let imdbId: string | null = providedImdbId || imdbFromGuid(plexGuid)
  const tmdbIdFromGuid = extractTmdbIdFromGuid(plexGuid)
  const requestedTmdbId = providedTmdbId ?? tmdbIdFromGuid
  let rating_imdb: number | null = null
  let rating_tmdb: number | null = null
  let rating_comparr: number | null = null
  let genres: string[] = []
  let streamingServices: { subscription: any[]; free: any[] } = {
    subscription: [],
    free: [],
  }
  let watchProviders: any[] = []
  let contentRating: string | null = null
  let cast: string[] = []
  let castMembers: Array<{
    name: string
    character: string
    profilePath: string | null
  }> = []
  let writers: string[] = []
  let director: string | null = null
  let runtime: number | null = null
  let original_language: string | null = null
  let originalLanguage: string | null = null
  let streamingLink: string | null = null
  let voteCount: number | null = null

  const cacheKey = buildEnrichmentCacheKey({
    title,
    year,
    imdbId,
    tmdbId: requestedTmdbId,
  })
  const candidateCacheKeys = buildCandidateCacheKeys({
    title,
    year,
    imdbId,
    tmdbId: requestedTmdbId,
  })
  const cached = getCachedEnrichmentByKeys([cacheKey, ...candidateCacheKeys])
  if (cached) {
    storeEnrichmentForKeys([cacheKey, ...candidateCacheKeys], cached)
    return cached
  }

  if (imdbId) {
    const localRating = getIMDbRating(imdbId)
    if (localRating !== null) {
      rating_imdb = localRating
    }
  }

  const initialDetails =
    requestedTmdbId != null ? await tmdbMovieDetails(requestedTmdbId) : null
  const hit =
    initialDetails || (await tmdbSearchMovie(title, year ?? undefined))
  let det = initialDetails
  if (hit && !det) {
    det = await tmdbMovieDetails(hit.id)
  }

  if (det || hit) {
    plot = det?.overview || hit?.overview || null
    rating_tmdb =
      typeof det?.vote_average === 'number'
        ? Number(det.vote_average.toFixed(1))
        : typeof hit?.vote_average === 'number'
        ? Number(hit.vote_average.toFixed(1))
        : null

    imdbId = det?.external_ids?.imdb_id || imdbId || null
    if (rating_imdb == null && imdbId) {
      const localRating = getIMDbRating(imdbId)
      if (localRating !== null) rating_imdb = localRating
    }

    genres = (det?.genres || []).map((g: any) => g.name)
    runtime = det?.runtime || null
    original_language = det?.original_language || hit?.original_language || null
    originalLanguage = original_language
    voteCount = det?.vote_count || null
    contentRating = extractUsContentRating(det?.release_dates)

    const providers = det?.['watch/providers']?.results?.US
    if (providers) {
      const { normalizeProviderName } = await import(
        '../../infra/constants/streamingProvidersMapping.ts'
      )

      streamingLink = providers.link || null

      const subscriptionMap = new Map()
      ;(providers.flatrate || []).forEach((p: any) => {
        const normalizedName = normalizeProviderName(p.provider_name)
        if (!subscriptionMap.has(normalizedName)) {
          subscriptionMap.set(normalizedName, {
            id: p.provider_id,
            name: normalizedName,
            logo_path: p.logo_path || null,
            type: 'subscription',
          })
        }
      })

      const freeMap = new Map()
      ;[...(providers.free || []), ...(providers.ads || [])].forEach(
        (p: any) => {
          const normalizedName = normalizeProviderName(p.provider_name)
          if (!freeMap.has(normalizedName)) {
            freeMap.set(normalizedName, {
              id: p.provider_id,
              name: normalizedName,
              logo_path: p.logo_path || null,
              type: 'free',
            })
          }
        }
      )

      streamingServices = {
        subscription: Array.from(subscriptionMap.values()),
        free: Array.from(freeMap.values()),
      }

      const allProviderMap = new Map()
      const providerGroups = [
        ['subscription', providers.flatrate || []],
        ['free', providers.free || []],
        ['free', providers.ads || []],
        ['rent', providers.rent || []],
        ['buy', providers.buy || []],
      ] as const

      providerGroups.forEach(([type, group]) => {
        group.forEach((p: any) => {
          const normalizedName = normalizeProviderName(p.provider_name)
          if (!allProviderMap.has(normalizedName)) {
            allProviderMap.set(normalizedName, {
              id: p.provider_id,
              name: normalizedName,
              logo_path: p.logo_path || null,
              type,
            })
          }
        })
      })

      watchProviders = Array.from(allProviderMap.values())
    }

    if (det?.credits) {
      castMembers = (det.credits.cast || [])
        .slice(0, 12)
        .map((c: any) => ({
          name: c?.name || '',
          character: c?.character || '',
          profilePath: c?.profile_path || null,
        }))
        .filter((member: any) => member.name)

      cast = (det.credits.cast || [])
        .slice(0, 5)
        .map((c: any) => c.name)
        .filter((name: string) => name)

      const crew = det.credits.crew || []
      const directorData = crew.find((c: any) => c.job === 'Director')
      if (directorData?.name) {
        director = directorData.name
      }

      writers = crew
        .filter(
          (c: any) =>
            c.job === 'Writer' || c.job === 'Screenplay' || c.job === 'Story'
        )
        .map((c: any) => c.name)
        .filter((name: string) => name)
        .slice(0, 3)
    }
  }

  try {
    const { isMovieInPlex } = await import('../../integrations/plex/cache.ts')
    const { isMovieInEmby } = await import('../../integrations/emby/cache.ts')
    const { isMovieInJellyfin } = await import('../../integrations/jellyfin/cache.ts')

    const tmdbId = det?.id || hit?.id
    const imdbFromTmdb = det?.external_ids?.imdb_id
    const params = {
      tmdbId,
      imdbId: imdbFromTmdb || imdbId || undefined,
      title,
      year,
    }

    const addLibraryBadge = (libraryName: string) => {
      if (!streamingServices.subscription.some(s => s.name === libraryName)) {
        streamingServices.subscription.unshift({
          id: 0,
          name: libraryName,
          logo_path: '/assets/logos/allvids.svg',
          type: 'subscription',
        })
      }
    }

    if (isMovieInPlex(params)) {
      addLibraryBadge(getPlexLibraryName() || 'Plex')
    } else if (isMovieInEmby(params)) {
      addLibraryBadge(getEmbyLibraryName() || 'Emby')
    } else if (isMovieInJellyfin(params)) {
      addLibraryBadge(getJellyfinLibraryName() || 'Jellyfin')
    }
  } catch (err) {
    log.error(`[enrich] Failed to check personal library status: ${err?.message || err}`)
  }

  const result: EnrichmentPayload = {
    plot,
    imdbId,
    rating_imdb,
    rating_tmdb,
    rating_comparr,
    genres,
    streamingServices,
    watchProviders,
    contentRating,
    tmdbPosterPath: hit?.poster_path || null,
    cast,
    castMembers,
    writers,
    director,
    runtime,
    original_language,
    originalLanguage,
    streamingLink,
    voteCount,
    tmdbId: hit?.id || null,
  }

  storeEnrichmentForKeys(
    buildCandidateCacheKeys({
      title,
      year,
      imdbId: result.imdbId,
      tmdbId: result.tmdbId,
    }),
    result
  )

  return result
}
