// features/streaming/streaming-update.ts
// Fetches fresh TMDb watch provider data and persists it to session-state.json
import * as log from 'jsr:@std/log'
import { getTmdbApiKey } from '../../core/config.ts'
import { getStateFile } from '../../core/state.ts'
import { tmdbFetch } from '../../api/tmdb.ts'

export async function updateStreamingForTmdbId(tmdbId: number) {
  const TMDB_KEY = getTmdbApiKey()
  if (!TMDB_KEY || !tmdbId || Number.isNaN(tmdbId)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Missing TMDb API key or invalid ID' },
    }
  }

  // Fetch fresh data from TMDb
  const providerData = await tmdbFetch(
    `/movie/${tmdbId}/watch/providers`,
    TMDB_KEY
  ).then(r => r.json())

  const providers = providerData?.results?.US

  // Import normalization function on demand
  const { normalizeProviderName } = await import(
    '../../infra/constants/streamingProvidersMapping.ts'
  )

  // Build result in your expected shape
  const subscriptionMap = new Map<string, any>()
  const freeMap = new Map<string, any>()

  if (providers?.flatrate) {
    for (const p of providers.flatrate) {
      log.info(`🔍 DEBUG: Raw provider name from TMDb: "${p.provider_name}"`)
      const normalizedName = normalizeProviderName(p.provider_name)
      log.info(`🔍 DEBUG: Normalized to: "${normalizedName}"`)
      if (!subscriptionMap.has(normalizedName)) {
        subscriptionMap.set(normalizedName, {
          id: p.provider_id,
          name: normalizedName,
          logo_path: p.logo_path || null,
          type: 'subscription',
        })
      }
    }
  }

  const freeCandidates = [...(providers?.free || []), ...(providers?.ads || [])]
  for (const p of freeCandidates) {
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

  const allProviderMap = new Map<string, any>()
  const providerGroups = [
    ['subscription', providers?.flatrate || []],
    ['free', providers?.free || []],
    ['free', providers?.ads || []],
    ['rent', providers?.rent || []],
    ['buy', providers?.buy || []],
  ] as const

  for (const [type, group] of providerGroups) {
    for (const p of group) {
      const normalizedName = normalizeProviderName(p.provider_name)
      if (!allProviderMap.has(normalizedName)) {
        allProviderMap.set(normalizedName, {
          id: p.provider_id,
          name: normalizedName,
          logo_path: p.logo_path || null,
          type,
        })
      }
    }
  }

  const result = {
    streamingServices: {
      subscription: Array.from(subscriptionMap.values()),
      free: Array.from(freeMap.values()),
    },
    watchProviders: Array.from(allProviderMap.values()),
    streamingLink: providers?.link || null,
  }

  // Persist to session-state.json if present
  try {
    const STATE_FILE = getStateFile()
    const stateText = await Deno.readTextFile(STATE_FILE)
    const persistedState = JSON.parse(stateText)

    let updatedCount = 0
    if (persistedState?.movieIndex) {
      for (const [guid, movie] of Object.entries(persistedState.movieIndex)) {
        const movieTmdbId =
          (movie as any).guid?.match(/tmdb:\/\/(\d+)/)?.[1] ||
          (movie as any).streamingLink?.match(
            /themoviedb\.org\/movie\/(\d+)/
          )?.[1]

        if (movieTmdbId === String(tmdbId)) {
          persistedState.movieIndex[guid] = {
            ...(movie as any),
            streamingServices: result.streamingServices,
            watchProviders: result.watchProviders,
            streamingLink: result.streamingLink,
          }
          updatedCount++
        }
      }
    }

    if (updatedCount > 0) {
      const tmp = `${STATE_FILE}.tmp.${Date.now()}`
      await Deno.writeTextFile(tmp, JSON.stringify(persistedState, null, 2))
      await Deno.rename(tmp, STATE_FILE)
      log.info(
        `✅ Updated ${updatedCount} persisted movie(s) with consolidated providers for TMDb ID ${tmdbId}`
      )
    }
  } catch (persistErr) {
    // Non-fatal: still return fresh data
    log.error(`Failed to update persisted state: ${persistErr}`)
  }

  return { ok: true, status: 200, body: result }
}
