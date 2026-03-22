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

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleRequestServiceRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path === '/api/request-service-status') {
    return new Response(
      JSON.stringify({ configured: isRequestServiceConfigured() }),
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

      const inRadarr = isMovieInRadarr(tmdbId)
      const inPlex = isMovieInPlex({ tmdbId })
      const inEmby = isMovieInEmby({ tmdbId })
      const inJellyfin = isMovieInJellyfin({ tmdbId })
      const inLibrary = inRadarr || inPlex || inEmby || inJellyfin

      return new Response(
        JSON.stringify({ inLibrary, inPlex, inEmby, inJellyfin, inRadarr, tmdbId }),
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
