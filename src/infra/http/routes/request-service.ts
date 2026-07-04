import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { addSecurityHeaders } from '../security-headers.ts'
import {
  getMediaStatus,
  isRequestServiceConfigured,
} from '../../../api/jellyseerr.ts'
import { isMovieInRadarr } from '../../../api/radarr.ts'
import { isMovieInPlex } from '../../../integrations/plex/cache.ts'
import { isMovieInEmby } from '../../../integrations/emby/cache.ts'
import { isMovieInJellyfin } from '../../../integrations/jellyfin/cache.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { extractTmdbIdFromGuid } from '../../../features/session/session.ts'
import {
  getPersonalMediaServerLibrary,
  getPersonalPlexLibrary,
  resolvePersonalSourcesForUser,
} from '../../../features/session/personal-media-sources.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

// Checks a user's own connected server plus any friends' servers shared with them — distinct
// from isMovieInPlex/Emby/Jellyfin below, which check the instance-wide admin library. Personal
// library access here is inherently consent-based (your own server, or a friend who explicitly
// shared theirs), so this deliberately does not respect the admin hasServerAccess gate.
async function isTmdbIdInPersonalLibrary(
  userId: number,
  tmdbId: number
): Promise<boolean> {
  for (const source of resolvePersonalSourcesForUser(userId)) {
    try {
      if (source.provider === 'plex') {
        const movies = await getPersonalPlexLibrary(
          source.url,
          source.token,
          source.libraryName || undefined
        )
        if (movies.some(m => extractTmdbIdFromGuid(m.guid) === tmdbId)) {
          return true
        }
      } else {
        const providerLabel = source.provider === 'emby' ? 'Emby' : 'Jellyfin'
        const movies = await getPersonalMediaServerLibrary(
          providerLabel,
          source.url,
          source.token
        )
        if (movies.some(m => m.tmdbId === tmdbId)) {
          return true
        }
      }
    } catch (err) {
      log.debug(`Personal library check failed for ${source.provider}: ${err}`)
    }
  }
  return false
}

export async function handleRequestServiceRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  const userToken = getUserTokenFromCookie(req)
  const userSession = userToken ? getUserSession(userToken) : null
  const hasServerAccess = userSession?.hasServerAccess !== false

  if (path === '/api/request-service-status') {
    return new Response(
      JSON.stringify({
        configured: isRequestServiceConfigured() && hasServerAccess,
        available: hasServerAccess,
      }),
      { status: 200, headers: makeJsonHeaders(req) }
    )
  }

  if (path.startsWith('/api/check-movie-status')) {
    try {
      const url = new URL(req.url, 'http://local')
      const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

      if (!tmdbId || Number.isNaN(tmdbId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
          { status: 400, headers: makeJsonHeaders(req) }
        )
      }

      // Personal/shared-friend libraries are checked regardless of hasServerAccess — that flag
      // only gates the instance-wide admin library below, and personal access here is already
      // consent-based (your own server, or a friend who explicitly shared theirs with you).
      const inPersonalLibrary = userSession
        ? await isTmdbIdInPersonalLibrary(userSession.userId, tmdbId)
        : false

      if (!hasServerAccess) {
        return new Response(
          JSON.stringify({
            inLibrary: inPersonalLibrary,
            inPlex: false,
            inEmby: false,
            inJellyfin: false,
            inRadarr: false,
            inPersonalLibrary,
            tmdbId,
          }),
          { status: 200, headers: makeJsonHeaders(req) }
        )
      }

      const inRadarr = isMovieInRadarr(tmdbId)
      const inPlex = isMovieInPlex({ tmdbId })
      const inEmby = isMovieInEmby({ tmdbId })
      const inJellyfin = isMovieInJellyfin({ tmdbId })
      const inLibrary = inRadarr || inPlex || inEmby || inJellyfin || inPersonalLibrary

      return new Response(
        JSON.stringify({
          inLibrary,
          inPlex,
          inEmby,
          inJellyfin,
          inRadarr,
          inPersonalLibrary,
          tmdbId,
        }),
        { status: 200, headers: makeJsonHeaders(req) }
      )
    } catch (err) {
      log.error(`Error checking movie status: ${err}`)
      return new Response(JSON.stringify({ error: 'Failed to check status' }), {
        status: 500,
        headers: makeJsonHeaders(req),
      })
    }
  }

  if (path.startsWith('/api/check-request-status')) {
    if (!hasServerAccess) {
      return new Response(
        JSON.stringify({
          available: false,
          pending: false,
          processing: false,
          configured: false,
        }),
        { status: 200, headers: makeJsonHeaders(req) }
      )
    }

    try {
      const url = new URL(req.url, 'http://local')
      const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

      if (!tmdbId || Number.isNaN(tmdbId)) {
        return new Response(
          JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
          { status: 400, headers: makeJsonHeaders(req) }
        )
      }

      const status = await getMediaStatus(tmdbId)
      return new Response(
        JSON.stringify({
          available: status?.available || false,
          pending: status?.pending || false,
          processing: status?.processing || false,
          tmdbId,
        }),
        {
          status: 200,
          headers: makeJsonHeaders(req),
        }
      )
    } catch (err) {
      log.error(`Error checking request status: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to check request status' }),
        {
          status: 500,
          headers: makeJsonHeaders(req),
        }
      )
    }
  }

  return null
}
