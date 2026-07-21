// routes/plex-sync.ts - /api/plex-sync handler
import * as log from 'jsr:@std/log'
import type { CompatRequest } from '../compat-request.ts'
import { makeHeaders } from '../security-headers.ts'
import { isValidStateChangingOrigin } from '../network-access.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { getUserPlexAuthToken, getUserSettings } from '../../../features/auth/user-db.ts'
import {
  processPlexWatchlistSyncBackground,
  processPlexSeenSyncBackground,
} from '../../../features/session/session.ts'
import { errorMessage } from '../../../core/errors.ts'

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

    // Watchlist sync needs a Plex ACCOUNT authorized (cloud-only Discover action) — either via
    // Plex login or a separate account connection. Seen sync needs the user's own personal Plex
    // SERVER connection instead — scrobbling only makes sense for a movie that's actually in
    // that library, and that's independent of how they logged in.
    if (syncType === 'watchlist') {
      const userPlexToken =
        getUserPlexAuthToken(userSession.userId) || getUserSettings(userSession.userId)?.plexAccountToken
      if (!userPlexToken) {
        return new Response(
          JSON.stringify({ error: 'No Plex account connected. Connect one in Advanced Settings first.' }),
          { status: 400, headers: makeHeaders(req, 'application/json') }
        )
      }
      const job = {
        roomCode: String(roomCode),
        userName: String(userName),
        userId: userSession.userId,
        userPlexToken,
        serverUrl: '',
      }
      processPlexWatchlistSyncBackground(job).catch(err =>
        log.error(`[plex-sync] Watchlist sync failed for ${userName}: ${err?.message || err}`)
      )
    } else {
      const settings = getUserSettings(userSession.userId)
      if (!settings?.plexUrl || !settings?.plexToken) {
        return new Response(
          JSON.stringify({ error: 'No personal Plex server connected. Connect one in Advanced Settings first.' }),
          { status: 400, headers: makeHeaders(req, 'application/json') }
        )
      }
      const job = {
        roomCode: String(roomCode),
        userName: String(userName),
        userId: userSession.userId,
        userPlexToken: settings.plexToken,
        serverUrl: settings.plexUrl,
      }
      processPlexSeenSyncBackground(job).catch(err =>
        log.error(`[plex-sync] Seen sync failed for ${userName}: ${err?.message || err}`)
      )
    }

    log.info(`[plex-sync] ${syncType} sync started for ${userName} in ${roomCode}`)

    return new Response(JSON.stringify({ status: 'started' }), {
      status: 202,
      headers: makeHeaders(req, 'application/json'),
    })
  } catch (err) {
    log.error(`[plex-sync] Route error: ${errorMessage(err)}`)
    return new Response(JSON.stringify({ error: 'Internal error' }), {
      status: 500,
      headers: makeHeaders(req, 'application/json'),
    })
  }
}
