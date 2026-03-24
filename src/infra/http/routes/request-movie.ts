// routes/request-movie.ts - /api/request-movie handler
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { isValidStateChangingOrigin } from '../network-access.ts'
import { requestMovie } from '../../../api/jellyseerr.ts'
import { isMovieInRadarr } from '../../../api/radarr.ts'
import {
  isMovieInPlex,
  waitForPlexCacheReady,
} from '../../../integrations/plex/cache.ts'
import { isMovieInEmby } from '../../../integrations/emby/cache.ts'
import { isMovieInJellyfin } from '../../../integrations/jellyfin/cache.ts'

export async function handleRequestMovieRoute(
  req: CompatRequest,
  path: string,
  maxBodySize: number
): Promise<Response | null> {
  if (path !== '/api/request-movie' || req.method !== 'POST') return null

  try {
    if (!isValidStateChangingOrigin(req)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request origin.' }),
        { status: 403, headers: makeHeaders(req, 'application/json') }
      )
    }

    const contentLength = Number(req.headers.get('content-length') || '0')
    if (Number.isFinite(contentLength) && contentLength > maxBodySize) {
      return new Response(JSON.stringify({ error: 'Payload too large' }), {
        status: 413,
        headers: makeHeaders(req, 'application/json'),
      })
    }

    const body = await req.text()
    const { tmdbId } = JSON.parse(body)

    if (!tmdbId || typeof tmdbId !== 'number') {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid TMDb ID' }),
        { status: 400, headers: makeHeaders(req, 'application/json') }
      )
    }

    try {
      await waitForPlexCacheReady()
    } catch (err) {
      log.warn(
        `Plex cache not ready when handling request-movie: ${
          err?.message || err
        }`
      )
    }

    const inRadarr = isMovieInRadarr(tmdbId)
    const inPlex = isMovieInPlex({ tmdbId })
    const inEmby = isMovieInEmby({ tmdbId })
    const inJellyfin = isMovieInJellyfin({ tmdbId })
    if (inRadarr || inPlex || inEmby || inJellyfin) {
      return new Response(
        JSON.stringify({
          success: false,
          message: inRadarr
            ? 'This title is already in your Radarr library.'
            : inPlex
            ? 'This title is already available in your Plex library.'
            : inEmby
            ? 'This title is already available in your Emby library.'
            : 'This title is already available in your Jellyfin library.',
        }),
        { status: 200, headers: makeHeaders(req, 'application/json') }
      )
    }

    const result = await requestMovie(tmdbId)
    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: makeHeaders(req, 'application/json'),
    })
  } catch (err) {
    log.error(`Error handling movie request: ${err}`)
    let errorMessage = 'Internal server error'
    if (err.message?.includes('ECONNREFUSED')) {
      errorMessage =
        'Unable to connect to Seerr. Please check if the service is running.'
    } else if (err.message?.includes('401') || err.message?.includes('403')) {
      errorMessage =
        'Authentication failed. Please check your API key configuration.'
    } else if (err.message) {
      errorMessage = err.message
    }
    return new Response(
      JSON.stringify({ success: false, message: errorMessage }),
      { status: 500, headers: makeHeaders(req, 'application/json') }
    )
  }
}
