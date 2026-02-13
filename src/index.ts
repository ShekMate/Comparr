// src/index.ts
import { serve } from 'https://deno.land/std@0.79.0/http/server.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { clearAllMoviesCache, getServerId, proxyPoster } from './api/plex.ts'
import {
  getJellyseerrApiKey,
  getJellyseerrUrl,
  getLinkType,
  getOverseerrApiKey,
  getOverseerrUrl,
  getPlexLibraryName,
  getPlexToken,
  getPlexUrl,
  getPort,
  getRadarrApiKey,
  getRadarrUrl,
  getRootPath,
  getTmdbApiKey,
  getOmdbApiKey,
} from './core/config.ts'
import { getSettings, updateSettings } from './core/settings.ts'
import { getLinkTypeForRequest } from './core/i18n.ts'
import {
  handleLogin,
  ensurePlexHydrationReady,
  processImdbImportBackground,
  getMatchesForUser,
} from './features/session/session.ts'
import { parseImdbCsv } from './features/session/imdb-import.ts'
import { serveFile } from './infra/http/staticFileServer.ts'
import { isLocalRequest } from './infra/http/network-access.ts'
import { handleSettingsRoutes } from './infra/http/routes/settings.ts'
import { WebSocketServer } from './infra/ws/websocketServer.ts'
import {
  initializeRadarrCache,
  isMovieInRadarr,
  refreshRadarrCache,
} from './api/radarr.ts'
import {
  requestMovie,
  isRequestServiceConfigured,
  getMediaStatus,
} from './api/jellyseerr.ts'
import { serveCachedPoster } from './services/cache/poster-cache.ts'
import {
  initIMDbDatabase,
  startBackgroundUpdateJob,
} from './features/catalog/imdb-datasets.ts'
import { buildPlexCache } from './integrations/plex/cache.ts'

// Helper: fetch & persist TMDb providers for a TMDb ID, returning the same shape your UI expects
async function updateStreamingForTmdbId(tmdbId: number) {
  const TMDB_KEY = getTmdbApiKey()
  if (!TMDB_KEY || !tmdbId || Number.isNaN(tmdbId)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'Missing TMDb API key or invalid ID' },
    }
  }

  // Fetch fresh data from TMDb
  const providerData = await fetch(
    `https://api.themoviedb.org/3/movie/${tmdbId}/watch/providers?api_key=${TMDB_KEY}`
  ).then(r => r.json())

  const providers = providerData?.results?.US

  // Import normalization function on demand
  const { normalizeProviderName } = await import(
    './infra/constants/streamingProvidersMapping.ts'
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

  const result = {
    streamingServices: {
      subscription: Array.from(subscriptionMap.values()),
      free: Array.from(freeMap.values()),
    },
    streamingLink: providers?.link || null,
  }

  // Persist to /data/session-state.json if present
  try {
    const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
    const STATE_FILE = `${DATA_DIR}/session-state.json`
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

// --- Persisted state helpers (robust to missing files)
const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
const STATE_FILE = `${DATA_DIR}/session-state.json`

async function loadPersistedState(): Promise<any> {
  try {
    const text = await Deno.readTextFile(STATE_FILE)
    return JSON.parse(text)
  } catch (err) {
    // If file doesn't exist or is invalid, start with empty structure
    if (err?.name === 'NotFound' || err?.code === 'ENOENT') {
      return { movieIndex: {} }
    }
    // If JSON is corrupt, also reset
    return { movieIndex: {} }
  }
}

async function savePersistedState(state: any) {
  await Deno.mkdir(DATA_DIR, { recursive: true }).catch(() => {})
  const tmp = `${STATE_FILE}.tmp.${Date.now()}`
  await Deno.writeTextFile(tmp, JSON.stringify(state, null, 2))
  await Deno.rename(tmp, STATE_FILE)
}

/** tiny helper to send a file from disk */
async function respondFile(req: any, filePath: string, contentType?: string) {
  try {
    const body = await Deno.readFile(filePath)
    const headers = new Headers()
    if (contentType) headers.set('content-type', contentType)
    await req.respond({ status: 200, headers, body })
    return true
  } catch (_) {
    return false
  }
}

const server = serve({ port: Number(getPort()) })

const wss = new WebSocketServer({
  onConnection: handleLogin,
  onError: err => log.error(err),
})

if (Deno.build.os !== 'windows') {
  const sigintHandler = () => {
    log.info('Shutting down')
    server.close()
    Deno.exit(0)
  }

  Deno.addSignalListener('SIGINT', sigintHandler)
}

log.info(`Listening on port ${getPort()}`)

// Initialize Radarr cache in background
initializeRadarrCache().catch(err =>
  log.error(`Failed to initialize Radarr cache: ${err}`)
)

// Initialize IMDb ratings database and start background update job
initIMDbDatabase()
startBackgroundUpdateJob()

// Initialize Plex availability cache
import {
  initPlexCache,
  isMovieInPlex,
  waitForPlexCacheReady,
} from './integrations/plex/cache.ts'
const plexCacheReady = initPlexCache()
plexCacheReady.catch(err =>
  log.error(`Failed to initialize Plex cache: ${err}`)
)
ensurePlexHydrationReady().catch(err =>
  log.error(`Failed to hydrate persisted watch list: ${err?.message || err}`)
)

// Initialize poster cache
import { initPosterCache } from './services/cache/poster-cache.ts'
initPosterCache().catch(err =>
  log.error(`Failed to initialize poster cache: ${err}`)
)

// DEBUG: Log environment check on startup
log.info(`🔍 Config check:`)
log.info(`  TMDB_API_KEY: ${getTmdbApiKey() ? '✅ Set' : '❌ Missing'}`)
log.info(`  OMDB_API_KEY: ${getOmdbApiKey() ? '✅ Set' : '❌ Missing'}`)
log.info(`  PLEX_URL: ${getPlexUrl() ? '✅ Set' : '❌ Missing'}`)
log.info(`  PLEX_TOKEN: ${getPlexToken() ? '✅ Set' : '❌ Missing'}`)

for await (const req of server) {
  try {
    const url = new URL(req.url, 'http://local')
    const p = url.pathname

    // --- DEBUG: Config check endpoint
    if (p === '/api/debug/config') {
      await req.respond({
        status: 200,
        body: JSON.stringify(
          {
            tmdb_configured: !!getTmdbApiKey(),
            omdb_configured: !!getOmdbApiKey(),
            plex_configured: !!(getPlexUrl() && getPlexToken()),
            radarr_configured: !!(getRadarrUrl() && getRadarrApiKey()),
            jellyseerr_configured: !!(
              getJellyseerrUrl() && getJellyseerrApiKey()
            ),
            overseerr_configured: !!(getOverseerrUrl() && getOverseerrApiKey()),
          },
          null,
          2
        ),
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      continue
    }

    if (
      await handleSettingsRoutes(req, p, {
        buildPlexCache,
        clearAllMoviesCache,
        getPlexLibraryName,
        getSettings,
        isLocalRequest,
        refreshRadarrCache,
        updateSettings,
      })
    ) {
      continue
    }

    // --- API: Check if request service is configured
    if (p === '/api/request-service-status') {
      await req.respond({
        status: 200,
        body: JSON.stringify({ configured: isRequestServiceConfigured() }),
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      continue
    }

    if (p === '/api/matches') {
      const url = new URL(req.url, 'http://local')
      const roomCode = url.searchParams.get('code') || ''
      const userName = url.searchParams.get('user') || ''

      if (!roomCode || !userName) {
        await req.respond({
          status: 400,
          body: JSON.stringify({ error: 'Missing room code or user' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
        continue
      }

      const matches = getMatchesForUser(roomCode, userName)
      if (matches === null) {
        await req.respond({
          status: 404,
          body: JSON.stringify({ error: 'Room not found' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
        continue
      }

      await req.respond({
        status: 200,
        body: JSON.stringify({ matches }),
        headers: new Headers({ 'content-type': 'application/json' }),
      })
      continue
    }

    // --- API: Check if a movie is in Radarr/Plex by TMDb ID
    if (p.startsWith('/api/check-movie-status')) {
      try {
        const url = new URL(req.url, 'http://local')
        const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

        if (!tmdbId || isNaN(tmdbId)) {
          await req.respond({
            status: 400,
            body: JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Check if movie is in Radarr (which means it's in Plex or downloading)
        const inPlex = isMovieInRadarr(tmdbId)

        await req.respond({
          status: 200,
          body: JSON.stringify({
            inPlex,
            tmdbId,
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Error checking movie status: ${err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({ error: 'Failed to check status' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Check if a movie is already requested in Jellyseerr/Overseerr
    if (p.startsWith('/api/check-request-status')) {
      try {
        const url = new URL(req.url, 'http://local')
        const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

        if (!tmdbId || isNaN(tmdbId)) {
          await req.respond({
            status: 400,
            body: JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Check request status in Jellyseerr/Overseerr
        const status = await getMediaStatus(tmdbId)

        await req.respond({
          status: 200,
          body: JSON.stringify({
            available: status?.available || false,
            pending: status?.pending || false,
            processing: status?.processing || false,
            tmdbId,
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Error checking request status: ${err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({ error: 'Failed to check request status' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Request movie via Jellyseerr/Overseerr
    if (p === '/api/request-movie' && req.method === 'POST') {
      try {
        const decoder = new TextDecoder()
        const body = decoder.decode(await Deno.readAll(req.body))
        const { tmdbId } = JSON.parse(body)

        if (!tmdbId || typeof tmdbId !== 'number') {
          await req.respond({
            status: 400,
            body: JSON.stringify({
              success: false,
              message: 'Invalid TMDb ID',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        try {
          await waitForPlexCacheReady()
        } catch (err) {
          log.warning(
            `Plex cache not ready when handling request-movie: ${
              err?.message || err
            }`
          )
        }

        const inRadarr = isMovieInRadarr(tmdbId)
        const inPlex = isMovieInPlex({ tmdbId })
        if (inRadarr || inPlex) {
          await req.respond({
            status: 200,
            body: JSON.stringify({
              success: false,
              message: inRadarr
                ? 'This title is already in your Radarr library.'
                : 'This title is already available in Plex.',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        const result = await requestMovie(tmdbId)
        await req.respond({
          status: result.success ? 200 : 500,
          body: JSON.stringify(result),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Error handling movie request: ${err}`)

        // Provide more specific error message
        let errorMessage = 'Internal server error'
        if (err.message?.includes('ECONNREFUSED')) {
          errorMessage =
            'Unable to connect to request service (Jellyseerr/Overseerr). Please check if the service is running.'
        } else if (
          err.message?.includes('401') ||
          err.message?.includes('403')
        ) {
          errorMessage =
            'Authentication failed. Please check your API key configuration.'
        } else if (err.message) {
          errorMessage = err.message
        }

        await req.respond({
          status: 500,
          body: JSON.stringify({ success: false, message: errorMessage }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Manually refresh Radarr cache
    if (p === '/api/refresh-radarr-cache' && req.method === 'POST') {
      try {
        log.info('Radarr cache refresh requested')
        await refreshRadarrCache()
        await req.respond({
          status: 200,
          body: JSON.stringify({ ok: true }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Radarr cache refresh failed: ${err?.message || err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({
            ok: false,
            error: err?.message || String(err),
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Refresh JustWatch streaming data for a movie
    if (p.startsWith('/api/refresh-streaming/')) {
      try {
        const tmdbId = parseInt(p.split('/').pop() || '')
        const res = await updateStreamingForTmdbId(tmdbId)
        await req.respond({
          status: res.status,
          body: JSON.stringify(res.body),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Error refreshing streaming data: ${err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({ error: 'Failed to refresh' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }
    // --- API: Update persisted movie (used by main.js refreshWatchListStatus)
    if (p.startsWith('/api/update-persisted-movie/') && req.method === 'POST') {
      try {
        const tmdbId = parseInt(p.split('/').pop() || '')
        const res = await updateStreamingForTmdbId(tmdbId)
        await req.respond({
          status: res.status,
          body: JSON.stringify({
            updated: res.ok,
            tmdbId,
            ...res.body, // includes streamingServices + streamingLink for the card dropdowns
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Error updating persisted movie: ${err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({ error: 'Failed to update persisted movie' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Refresh movie data (ratings + Plex status)
    if (p.startsWith('/api/refresh-movie/')) {
      // correlation id per call
      const rid = `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`
      try {
        const rawParam = decodeURIComponent(p.split('/').pop() || '')
        const idParam = rawParam.trim()
        log.info(`[refresh ${rid}] start idParam="${idParam}"`)

        // Parse the identifier
        let tmdbId: number | null = null
        let imdbId: string | null = null
        let guidParam: string | null = null

        if (/^tmdb:\/\/(\d+)$/.test(idParam)) {
          tmdbId = parseInt(idParam.match(/^tmdb:\/\/(\d+)$/)![1])
        } else if (/^imdb:\/\/(tt\d+)$/.test(idParam)) {
          imdbId = idParam.match(/^imdb:\/\/(tt\d+)$/)![1]
          guidParam = idParam
        } else if (idParam.startsWith('tt')) {
          imdbId = idParam
        } else if (/^plex:\/\//.test(idParam)) {
          guidParam = idParam
        } else {
          const maybe = parseInt(idParam, 10)
          if (!Number.isNaN(maybe)) {
            tmdbId = maybe
          } else {
            log.warning(`[refresh ${rid}] invalid idParam`)
            await req.respond({
              status: 400,
              body: JSON.stringify({ error: 'Invalid ID', rid }),
              headers: new Headers({ 'content-type': 'application/json' }),
            })
            continue
          }
        }
        log.info(
          `[refresh ${rid}] parsed -> tmdbId=${tmdbId ?? ''} imdbId=${
            imdbId ?? ''
          } guid=${guidParam ?? ''}`
        )

        // Load persisted state from disk
        const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
        const STATE_FILE = `${DATA_DIR}/session-state.json`
        let persistedState: any = null
        try {
          const stateText = await Deno.readTextFile(STATE_FILE)
          persistedState = JSON.parse(stateText)
          log.debug(`[refresh ${rid}] state loaded ok`)
        } catch (e) {
          log.error(`[refresh ${rid}] read state failed: ${e?.message || e}`)
        }

        const { enrich } = await import('./features/catalog/enrich.ts')

        // Find the movie by tmdbId, imdbId, or guid
        let movieGuid: string | null = null
        let movieData: any = null

        const searchMatches = (mv: any): boolean => {
          const mvTmdbId =
            mv?.tmdbId ||
            mv?.tmdb_id ||
            mv?.guid?.match?.(/tmdb:\/\/(\d+)/)?.[1] ||
            mv?.streamingLink?.match?.(/themoviedb\.org\/movie\/(\d+)/)?.[1] ||
            null
          if (tmdbId && String(mvTmdbId) === String(tmdbId)) return true

          const mvImdb =
            mv?.imdbId ||
            mv?.guid?.match?.(/imdb:\/\/(tt\d+)/)?.[1] ||
            (Array.isArray(mv?.Guid)
              ? mv.Guid.find((g: any) => /^imdb:\/\//.test(g?.id))?.id?.match(
                  /imdb:\/\/(tt\d+)/
                )?.[1] || null
              : null)
          if (imdbId && mvImdb && String(mvImdb) === String(imdbId)) return true

          if (guidParam) {
            if (mv?.guid === guidParam) return true
            if (
              Array.isArray(mv?.Guid) &&
              mv.Guid.some((g: any) => g?.id === guidParam)
            )
              return true
          }
          return false
        }

        if (persistedState?.movieIndex) {
          for (const [guid, mv] of Object.entries(persistedState.movieIndex)) {
            if (searchMatches(mv)) {
              movieGuid = guid
              movieData = mv
              break
            }
          }
        }

        if (!movieData) {
          if (tmdbId || imdbId) {
            movieGuid = tmdbId ? `tmdb://${tmdbId}` : `imdb://${imdbId}`
            movieData = {
              guid: movieGuid,
              tmdbId: tmdbId ?? undefined,
              imdbId: imdbId ?? undefined,
            }
            log.info(`[refresh ${rid}] fabricated movieData for enrichment`)
          } else {
            log.warning(
              `[refresh ${rid}] not found in state and no ids to fabricate`
            )
            await req.respond({
              status: 404,
              body: JSON.stringify({ error: 'Movie not found', rid }),
              headers: new Headers({ 'content-type': 'application/json' }),
            })
            continue
          }
        }

        log.info(
          `[refresh ${rid}] calling enrich title="${
            movieData.title || ''
          }" year=${movieData.year || ''} tmdbId=${
            movieData.tmdbId || tmdbId || ''
          } imdbId=${movieData.imdbId || imdbId || ''}`
        )
        let enriched: any
        try {
          enriched = await enrich({
            title: movieData.title,
            year: movieData.year,
            plexGuid: movieData.guid,
            imdbId: movieData.imdbId || imdbId,
            tmdbId: movieData.tmdbId || tmdbId,
          })
        } catch (e) {
          log.error(`[refresh ${rid}] enrich() failed: ${e?.message || e}`)
          await req.respond({
            status: 500,
            body: JSON.stringify({
              error: 'enrich failed',
              detail: e?.message || String(e),
              rid,
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Format rating string with logos (matching session.ts format)
        const basePath = getRootPath() || ''
        const ratingParts: string[] = []
        if (enriched.rating_comparr)
          ratingParts.push(
            `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> ${enriched.rating_comparr}`
          )
        if (enriched.rating_imdb)
          ratingParts.push(
            `<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> ${enriched.rating_imdb}`
          )
        if (enriched.rating_rt)
          ratingParts.push(
            `<img src="${basePath}/assets/logos/rottentomatoes.svg" alt="RT" class="rating-logo"> ${enriched.rating_rt}%`
          )
        if (enriched.rating_tmdb)
          ratingParts.push(
            `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${enriched.rating_tmdb}`
          )
        const rating =
          ratingParts.length > 0
            ? ratingParts.join(' <span class="rating-separator">&bull;</span> ')
            : ''

        // Check if movie is in Plex from streamingServices (already computed during enrich)
        const plexLibraryName = getPlexLibraryName() || 'Plex'
        const inPlex =
          enriched.streamingServices?.subscription?.some(
            (s: any) => s.name === plexLibraryName
          ) || false

        // Persist updates if we have state
        if (persistedState?.movieIndex) {
          if (!(movieGuid in persistedState.movieIndex)) {
            persistedState.movieIndex[movieGuid] = movieData
          }
          persistedState.movieIndex[movieGuid] = {
            ...persistedState.movieIndex[movieGuid],
            ...movieData,
            rating_imdb: enriched.rating_imdb,
            rating_rt: enriched.rating_rt,
            rating_tmdb: enriched.rating_tmdb,
            rating_comparr: enriched.rating_comparr,
            rating,
            streamingServices: enriched.streamingServices,
            streamingLink: enriched.streamingLink,
            genres: enriched.genres,
            contentRating: enriched.contentRating,
            cast: enriched.cast,
            writers: enriched.writers,
            director: enriched.director,
            runtime: enriched.runtime,
            voteCount: enriched.voteCount,
            imdbId: enriched.imdbId || movieData.imdbId,
            tmdbId: enriched.tmdbId || movieData.tmdbId,
            guid: enriched.guid || movieData.guid,
          }

          try {
            const tmp = `${STATE_FILE}.tmp.${Date.now()}`
            await Deno.writeTextFile(
              tmp,
              JSON.stringify(persistedState, null, 2)
            )
            await Deno.rename(tmp, STATE_FILE)
            log.debug(`[refresh ${rid}] state persisted`)
          } catch (e) {
            log.error(`[refresh ${rid}] persist failed: ${e?.message || e}`)
          }
        } else {
          log.warning(
            `[refresh ${rid}] no persistedState.movieIndex; skipping persist`
          )
        }

        await req.respond({
          status: 200,
          body: JSON.stringify({
            rating_imdb: enriched.rating_imdb,
            rating_rt: enriched.rating_rt,
            rating_tmdb: enriched.rating_tmdb,
            rating_comparr: enriched.rating_comparr,
            rating,
            inPlex,
            streamingServices: enriched.streamingServices,
            streamingLink: enriched.streamingLink,
            tmdbId: movieData.tmdbId || tmdbId,
            imdbId: enriched.imdbId || movieData.imdbId || imdbId,
            rid,
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
        log.info(`[refresh ${rid}] OK`)
      } catch (err) {
        log.error(
          `[refresh ${rid}] unhandled: ${err?.stack || err?.message || err}`
        )
        await req.respond({
          status: 500,
          body: JSON.stringify({
            error: 'Failed to refresh movie data',
            detail: err?.message || String(err),
            rid,
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Import IMDb watched movies as "seen" (background processing)
    if (p === '/api/imdb-import' && req.method === 'POST') {
      try {
        const TMDB_KEY = getTmdbApiKey()
        if (!TMDB_KEY) {
          await req.respond({
            status: 400,
            body: JSON.stringify({
              error: 'TMDb API key is required for IMDb import',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        const decoder = new TextDecoder()
        const body = decoder.decode(await Deno.readAll(req.body))
        const { csvContent, roomCode, userName } = JSON.parse(body)

        if (!csvContent || !roomCode || !userName) {
          await req.respond({
            status: 400,
            body: JSON.stringify({
              error: 'Missing required fields: csvContent, roomCode, userName',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        log.info(`IMDb CSV import requested by ${userName} in room ${roomCode}`)

        // Parse the CSV
        const rows = parseImdbCsv(csvContent)
        log.info(`IMDb CSV parsed: ${rows.length} movie entries found`)

        if (rows.length === 0) {
          await req.respond({
            status: 200,
            body: JSON.stringify({ status: 'completed', total: 0 }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Convert to the format expected by background processor
        const imdbRows = rows.map(r => ({
          imdbId: r.imdbId,
          title: r.title,
          year: r.year,
        }))

        // Start background processing (non-blocking)
        processImdbImportBackground({ roomCode, userName, imdbRows }).catch(
          err => {
            log.error(`Background IMDb import failed: ${err?.message || err}`)
          }
        )

        // Return immediately - movies will arrive via WebSocket
        await req.respond({
          status: 202,
          body: JSON.stringify({ status: 'started', total: rows.length }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })

        log.info(
          `IMDb CSV import started in background: ${rows.length} movies to process`
        )
      } catch (err) {
        log.error(`IMDb import failed: ${err?.message || err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({
            error: 'IMDb import failed',
            detail: err?.message || String(err),
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- API: Import from a public IMDb list URL (background processing)
    if (p === '/api/imdb-import-url' && req.method === 'POST') {
      try {
        const TMDB_KEY = getTmdbApiKey()
        if (!TMDB_KEY) {
          await req.respond({
            status: 400,
            body: JSON.stringify({
              error: 'TMDb API key is required for IMDb import',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        const decoder = new TextDecoder()
        const body = decoder.decode(await Deno.readAll(req.body))
        const { imdbUrl, roomCode, userName } = JSON.parse(body)

        if (!imdbUrl || !roomCode || !userName) {
          await req.respond({
            status: 400,
            body: JSON.stringify({
              error: 'Missing required fields: imdbUrl, roomCode, userName',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Extract list ID from various IMDb URL formats
        // More lenient regex patterns to handle various URL formats
        const listMatch = imdbUrl.match(/\/list\/(ls\d+)/i)
        const ratingsMatch = imdbUrl.match(/\/user\/(ur\d+)\/ratings/i)
        const watchlistMatch = imdbUrl.match(/\/user\/(ur\d+)\/watchlist/i)
        // Also match just the user profile URL (assume ratings)
        const userOnlyMatch = imdbUrl.match(/\/user\/(ur\d+)\/?(?:\?|$)/i)

        log.info(
          `IMDb URL parsing: url="${imdbUrl}" list=${!!listMatch} ratings=${!!ratingsMatch} watchlist=${!!watchlistMatch} userOnly=${!!userOnlyMatch}`
        )

        let exportUrl: string
        if (listMatch) {
          exportUrl = `https://www.imdb.com/list/${listMatch[1]}/export`
        } else if (ratingsMatch) {
          exportUrl = `https://www.imdb.com/user/${ratingsMatch[1]}/ratings/export`
        } else if (watchlistMatch) {
          exportUrl = `https://www.imdb.com/user/${watchlistMatch[1]}/watchlist/export`
        } else if (userOnlyMatch) {
          // User just pasted their profile URL, assume they want ratings
          exportUrl = `https://www.imdb.com/user/${userOnlyMatch[1]}/ratings/export`
          log.info(
            `IMDb URL: User profile URL detected, assuming ratings export`
          )
        } else {
          log.warning(`IMDb URL: No pattern matched for "${imdbUrl}"`)
          await req.respond({
            status: 400,
            body: JSON.stringify({
              error:
                'Invalid IMDb URL. Please provide a public list URL (e.g. https://www.imdb.com/list/ls123456789/) or ratings URL (e.g. https://www.imdb.com/user/ur12345678/ratings/).',
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        log.info(
          `IMDb URL import requested by ${userName} in room ${roomCode}: ${exportUrl}`
        )

        // Fetch CSV from IMDb (do this synchronously so we can return error if URL is bad)
        const imdbResponse = await fetch(exportUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Comparr/1.0)',
            Accept: 'text/csv, */*',
          },
        })

        if (!imdbResponse.ok) {
          const hint =
            imdbResponse.status === 403 || imdbResponse.status === 404
              ? ' Make sure the list is set to public on IMDb.'
              : ''
          await req.respond({
            status: 502,
            body: JSON.stringify({
              error: `Failed to fetch from IMDb (HTTP ${imdbResponse.status}).${hint}`,
            }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        const csvContent = await imdbResponse.text()
        log.info(`IMDb CSV fetched: ${csvContent.length} bytes`)

        // Debug: log first 500 chars to see what we got
        log.info(
          `IMDb CSV preview: ${csvContent
            .substring(0, 500)
            .replace(/\n/g, '\\n')}`
        )

        // Parse the CSV
        const rows = parseImdbCsv(csvContent)
        log.info(`IMDb CSV parsed: ${rows.length} movie entries found`)

        if (rows.length === 0) {
          await req.respond({
            status: 200,
            body: JSON.stringify({ status: 'completed', total: 0 }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Convert to the format expected by background processor
        const imdbRows = rows.map(r => ({
          imdbId: r.imdbId,
          title: r.title,
          year: r.year,
        }))

        // Start background processing (non-blocking)
        processImdbImportBackground({ roomCode, userName, imdbRows }).catch(
          err => {
            log.error(
              `Background IMDb URL import failed: ${err?.message || err}`
            )
          }
        )

        // Return immediately - movies will arrive via WebSocket
        await req.respond({
          status: 202,
          body: JSON.stringify({ status: 'started', total: rows.length }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })

        log.info(
          `IMDb URL import started in background: ${rows.length} movies to process`
        )
      } catch (err) {
        log.error(`IMDb URL import failed: ${err?.message || err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({
            error: 'IMDb URL import failed',
            detail: err?.message || String(err),
          }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- WebSocket for app events/login
    if (p === '/ws') {
      wss.connect(req)
      continue
    }

    // --- Deep link to Plex for a movie
    if (p.startsWith('/movie/')) {
      const serverId = await getServerId()
      const key = p.replace('/movie', '')

      let location: string
      if (getLinkTypeForRequest(req.headers) === 'app') {
        location = `plex://preplay/?metadataKey=${encodeURIComponent(
          key
        )}&metadataType=1&server=${serverId}`
      } else if (getLinkType() == 'plex.tv') {
        location = `https://app.plex.tv/desktop#!/server/${serverId}/details?key=${encodeURIComponent(
          key
        )}`
      } else {
        location = `${getPlexUrl()}/web/index.html#!/server/${serverId}/details?key=${encodeURIComponent(
          key
        )}`
      }

      await req.respond({
        status: 302,
        headers: new Headers({ Location: location }),
      })
      continue
    }

    // --- Proxy TMDb posters
    if (p.startsWith('/tmdb-poster/')) {
      const posterPath = p.replace('/tmdb-poster', '')
      const tmdbUrl = `https://image.tmdb.org/t/p/w500${posterPath}`

      try {
        const posterReq = await fetch(tmdbUrl)
        if (posterReq.ok) {
          const imageData = new Uint8Array(await posterReq.arrayBuffer())

          // Cache the downloaded poster
          const { cachePoster } = await import(
            './services/cache/poster-cache.ts'
          )
          cachePoster(posterPath, 'tmdb', tmdbUrl).catch(err =>
            log.error(`Failed to cache TMDb poster: ${err}`)
          )

          await req.respond({
            status: 200,
            body: imageData,
            headers: new Headers({
              'content-type': 'image/jpeg',
              'cache-control': 'public, max-age=604800, immutable', // Cache for 7 days
            }),
          })
        } else {
          await req.respond({ status: 404 })
        }
      } catch {
        await req.respond({ status: 404 })
      }
      continue
    }

    // Handle match actions (seen/pass)
    if (p === '/api/match-action' && req.method === 'POST') {
      try {
        const body = await req.body()
        const { guid, action, roomCode, userName } = body as {
          guid: string
          action: 'seen' | 'pass'
          roomCode: string
          userName: string
        }

        log.info(
          `Match action: ${userName} in ${roomCode} marked ${guid} as ${action}`
        )

        // Get the session
        const session = activeSessions.get(roomCode)
        if (!session) {
          await req.respond({
            status: 404,
            body: JSON.stringify({ error: 'Room not found' }),
            headers: new Headers({ 'content-type': 'application/json' }),
          })
          continue
        }

        // Remove the match for the acting user
        const removedCount = session.removeMatch(guid, userName, action)

        log.info(`Removed ${removedCount} match(es) for movie ${guid}`)

        await req.respond({
          status: 200,
          body: JSON.stringify({ success: true, removedCount }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      } catch (err) {
        log.error(`Failed to process match action: ${err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({ error: 'Failed to process match action' }),
          headers: new Headers({ 'content-type': 'application/json' }),
        })
      }
      continue
    }

    // --- Serve favicon quickly if present
    if (p === '/favicon.ico') {
      const served = await respondFile(
        req,
        'public/favicon.ico',
        'image/x-icon'
      )
      if (!served) {
        await req.respond({ status: 404 })
      }
      continue
    }

    // --- Serve SPA + static files from ./public (explicit fast-paths)
    // Serve index.html through the templated static server so ${...} variables resolve
    if (p === '/' || p === '/index.html') {
      await serveFile(req, '/public')
      continue
    }

    if (p.startsWith('/js/')) {
      await respondFile(
        req,
        'public' + p,
        'application/javascript; charset=utf-8'
      )
      continue
    }
    //if (p.startsWith('/assets/')) {
    // await respondFile(req, 'public' + p)
    //continue
    //}

    // Serve cached posters from DATA_DIR/poster-cache
    if (p.startsWith('/cached-poster/')) {
      const filename = p.slice('/cached-poster/'.length)
      const served = await serveCachedPoster(filename, req)
      if (!served) {
        await req.respond({ status: 404, body: 'Not Found' })
      }
      continue // handled
    }

    // --- Fallback: generic static server rooted at /public
    // This will handle anything else that actually exists under public/
    // (and 404 if it truly doesn't exist).
    // Serve cached posters from DATA_DIR/poster-cache
    if (p.startsWith('/cached-poster/')) {
      const filename = p.slice('/cached-poster/'.length)
      const served = await serveCachedPoster(filename, req)
      if (!served) {
        await req.respond({ status: 404, body: 'Not Found' })
      }
      continue // handled
    }

    await serveFile(req, '/public')
  } catch (err) {
    log.error(`Error handling request: ${err?.message ?? err}`)
    try {
      await req.respond({ status: 500, body: new TextEncoder().encode('500') })
    } catch {}
  }
}
