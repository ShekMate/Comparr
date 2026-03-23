// routes/movie-refresh.ts - /api/refresh-movie/:id handler
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { getStateFile, savePersistedState } from '../../../core/state.ts'
import { getRootPath, getPlexLibraryName, getEmbyLibraryName, getJellyfinLibraryName } from '../../../core/config.ts'

export async function handleMovieRefreshRoute(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (!path.startsWith('/api/refresh-movie/')) return null

  const rid = crypto.randomUUID()
  try {
    const rawParam = decodeURIComponent(path.split('/').pop() || '')
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
        log.warn(`[refresh ${rid}] invalid idParam`)
        return new Response(
          JSON.stringify({ error: 'Invalid ID', rid }),
          { status: 400, headers: makeHeaders(req, 'application/json') }
        )
      }
    }
    log.info(
      `[refresh ${rid}] parsed -> tmdbId=${tmdbId ?? ''} imdbId=${imdbId ?? ''} guid=${guidParam ?? ''}`
    )

    // Load persisted state from disk
    const STATE_FILE = getStateFile()
    let persistedState: any = null
    try {
      const stateText = await Deno.readTextFile(STATE_FILE)
      persistedState = JSON.parse(stateText)
      log.debug(`[refresh ${rid}] state loaded ok`)
    } catch (e) {
      log.error(`[refresh ${rid}] read state failed: ${e?.message || e}`)
    }

    const { enrich } = await import('../../features/catalog/enrich.ts')

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
        log.warn(`[refresh ${rid}] not found in state and no ids to fabricate`)
        return new Response(
          JSON.stringify({ error: 'Movie not found', rid }),
          { status: 404, headers: makeHeaders(req, 'application/json') }
        )
      }
    }

    log.info(
      `[refresh ${rid}] calling enrich title="${movieData.title || ''}" year=${movieData.year || ''} tmdbId=${movieData.tmdbId || tmdbId || ''} imdbId=${movieData.imdbId || imdbId || ''}`
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
      return new Response(
        JSON.stringify({ error: 'enrich failed', detail: e?.message || String(e), rid }),
        { status: 500, headers: makeHeaders(req, 'application/json') }
      )
    }

    // Format rating string with logos
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
    if (enriched.rating_tmdb)
      ratingParts.push(
        `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${enriched.rating_tmdb}`
      )
    const rating =
      ratingParts.length > 0
        ? ratingParts.join(' <span class="rating-separator">&bull;</span> ')
        : ''

    const personalLibraryNames = new Set(
      [getPlexLibraryName(), getEmbyLibraryName(), getJellyfinLibraryName()].filter(Boolean)
    )
    const inPlex =
      enriched.streamingServices?.subscription?.some(
        (s: any) => personalLibraryNames.has(s.name)
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
        rating_tmdb: enriched.rating_tmdb,
        rating_comparr: enriched.rating_comparr,
        rating,
        streamingServices: enriched.streamingServices,
        streamingLink: enriched.streamingLink,
        genres: enriched.genres,
        contentRating: enriched.contentRating,
        cast: enriched.cast,
        castMembers: enriched.castMembers,
        writers: enriched.writers,
        director: enriched.director,
        runtime: enriched.runtime,
        original_language: enriched.original_language || movieData.original_language || null,
        originalLanguage: enriched.originalLanguage || movieData.originalLanguage || null,
        voteCount: enriched.voteCount,
        imdbId: enriched.imdbId || movieData.imdbId,
        tmdbId: enriched.tmdbId || movieData.tmdbId,
        guid: enriched.guid || movieData.guid,
      }

      try {
        await savePersistedState(persistedState)
        log.debug(`[refresh ${rid}] state persisted`)
      } catch (e) {
        log.error(`[refresh ${rid}] persist failed: ${e?.message || e}`)
      }
    } else {
      log.warn(`[refresh ${rid}] no persistedState.movieIndex; skipping persist`)
    }

    return new Response(
      JSON.stringify({
        rating_imdb: enriched.rating_imdb,
        rating_tmdb: enriched.rating_tmdb,
        rating_comparr: enriched.rating_comparr,
        rating,
        inPlex,
        streamingServices: enriched.streamingServices,
        streamingLink: enriched.streamingLink,
        tmdbId: movieData.tmdbId || tmdbId,
        imdbId: enriched.imdbId || movieData.imdbId || imdbId,
        original_language: enriched.original_language || movieData.original_language || null,
        originalLanguage: enriched.originalLanguage || movieData.originalLanguage || null,
        rid,
      }),
      { status: 200, headers: makeHeaders(req, 'application/json') }
    )
  } catch (err) {
    log.error(`[refresh ${rid}] unhandled: ${err?.stack || err?.message || err}`)
    return new Response(
      JSON.stringify({ error: 'Failed to refresh movie data', detail: 'An internal error occurred.', rid }),
      { status: 500, headers: makeHeaders(req, 'application/json') }
    )
  }
}
