import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { addSecurityHeaders } from '../security-headers.ts'
import {
  getMediaStatus,
  isRequestServiceConfigured,
} from '../../../api/jellyseerr.ts'
import { isMovieInRadarr } from '../../../api/radarr.ts'

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

export async function handleRequestServiceRoutes(req: CompatRequest, path: string) {
  if (path === '/api/request-service-status') {
    await req.respond({
      status: 200,
      body: JSON.stringify({ configured: isRequestServiceConfigured() }),
      headers: makeJsonHeaders(req),
    })
    return true
  }

  if (path.startsWith('/api/check-movie-status')) {
    try {
      const url = new URL(req.url, 'http://local')
      const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

      if (!tmdbId || Number.isNaN(tmdbId)) {
        await req.respond({
          status: 400,
          body: JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
          headers: makeJsonHeaders(req),
        })
        return true
      }

      const inPlex = isMovieInRadarr(tmdbId)
      await req.respond({
        status: 200,
        body: JSON.stringify({ inPlex, tmdbId }),
        headers: makeJsonHeaders(req),
      })
    } catch (err) {
      log.error(`Error checking movie status: ${err}`)
      await req.respond({
        status: 500,
        body: JSON.stringify({ error: 'Failed to check status' }),
        headers: makeJsonHeaders(req),
      })
    }

    return true
  }

  if (path.startsWith('/api/check-request-status')) {
    try {
      const url = new URL(req.url, 'http://local')
      const tmdbId = parseInt(url.searchParams.get('tmdbId') || '')

      if (!tmdbId || Number.isNaN(tmdbId)) {
        await req.respond({
          status: 400,
          body: JSON.stringify({ error: 'Invalid or missing TMDb ID' }),
          headers: makeJsonHeaders(req),
        })
        return true
      }

      const status = await getMediaStatus(tmdbId)
      await req.respond({
        status: 200,
        body: JSON.stringify({
          available: status?.available || false,
          pending: status?.pending || false,
          processing: status?.processing || false,
          tmdbId,
        }),
        headers: makeJsonHeaders(req),
      })
    } catch (err) {
      log.error(`Error checking request status: ${err}`)
      await req.respond({
        status: 500,
        body: JSON.stringify({ error: 'Failed to check request status' }),
        headers: makeJsonHeaders(req),
      })
    }

    return true
  }

  return false
}
