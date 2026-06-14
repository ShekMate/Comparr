// routes/plex-sync.ts - /api/plex-sync handler
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { isValidStateChangingOrigin } from '../network-access.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { getUserPlexAuthToken } from '../../../features/auth/user-db.ts'
import { getPlexUrl } from '../../../core/config.ts'
import {
  processPlexWatchlistSyncBackground,
  processPlexSeenSyncBackground,
} from '../../../features/session/session.ts'

export async function handlePlexSyncRoutes(
  req: CompatRequest,
  path: string,
  maxBodySize: number
): Promise<Response | null> {
  if (path !== '/api/plex-sync' || req.method !== 'POST') return null

  if (!isValidStateChangingOrigin(req)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: makeHeaders(req, 'application/json'),
    })
  }

  const contentLength = Number(req.headers.get('content-length') || '0')
  if (Number.isFinite(contentLength) && contentLength > maxBodySize) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: makeHeaders(req, 'application/json'),
    })
  }

  try {
    const userToken = getUserTokenFromCookie(req)
    const userSession = userToken ? getUserSession(userToken) : null
    if (!userSession) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401,
        headers: makeHeaders(req, 'application/json'),
      })
    }

    const body = await req.text()
    const { syncType, roomCode, userName } = JSON.parse(body)

    if (!['watchlist', 'seen'].includes(syncType)) {
      return new Response(JSON.stringify({ error: 'Invalid syncType' }), {
        status: 400,
        headers: makeHeaders(req, 'application/json'),
      })
    }
    if (!roomCode || !userName) {
      return new Response(JSON.stringify({ error: 'Missing roomCode or userName' }), {
        status: 400,
        headers: makeHeaders(req, 'application/json'),
      })
    }

    const userPlexToken = getUserPlexAuthToken(userSession.userId)
    if (!userPlexToken) {
      return new Response(
        JSON.stringify({ error: 'No Plex auth token on file. Please log out and back in.' }),
        { status: 400, headers: makeHeaders(req, 'application/json') }
      )
    }

    const serverUrl = getPlexUrl()
    const job = {
      roomCode: String(roomCode),
      userName: String(userName),
      userId: userSession.userId,
      userPlexToken,
      serverUrl,
    }

    if (syncType === 'watchlist') {
      processPlexWatchlistSyncBackground(job).catch(err =>
        log.error(`[plex-sync] Watchlist sync failed: ${err?.message || err}`)
      )
    } else {
      processPlexSeenSyncBackground(job).catch(err =>
        log.error(`[plex-sync] Seen sync failed: ${err?.message || err}`)
      )
    }

    log.info(`[plex-sync] ${syncType} sync started for ${userName} in ${roomCode}`)

    return new Response(JSON.stringify({ status: 'started' }), {
      status: 202,
      headers: makeHeaders(req, 'application/json'),
    })
  } catch (err) {
    log.error(`[plex-sync] Route error: ${err?.message || err}`)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: makeHeaders(req, 'application/json'),
    })
  }
}
