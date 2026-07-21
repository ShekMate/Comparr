// routes/trakt-account-connect.ts
// POST /api/profile/connections/trakt/device
// GET  /api/profile/connections/trakt/device/:deviceCode
//
// Lets an already-logged-in Comparr user authorize a Trakt account for sync without that being
// how they log into Comparr — parallel to plex-account-connect.ts. Without this, Trakt could
// only ever be *the* login method, and a user couldn't have both Plex login/connection and
// Trakt connected simultaneously.

import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { makeHeaders } from '../security-headers.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { requestTraktDeviceCode, pollTraktDeviceToken, getTraktUserSettings } from '../../../api/trakt.ts'
import { upsertUserSettings } from '../../../features/auth/user-db.ts'

interface PendingConnection {
  userId: number
  expiresAt: number
}

const _pendingConnections = new Map<string, PendingConnection>()

function makeJson(req: CompatRequest): HeadersInit {
  return makeHeaders(req, 'application/json')
}

function pruneExpired(): void {
  const now = Date.now()
  for (const [code, entry] of _pendingConnections) {
    if (now > entry.expiresAt) _pendingConnections.delete(code)
  }
}

export async function handleTraktAccountConnectRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path === '/api/profile/connections/trakt/device' && req.method === 'POST') {
    const userToken = getUserTokenFromCookie(req)
    const session = userToken ? getUserSession(userToken) : null
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: makeJson(req),
      })
    }

    try {
      const device = await requestTraktDeviceCode()
      pruneExpired()
      _pendingConnections.set(device.deviceCode, {
        userId: session.userId,
        expiresAt: Date.now() + device.expiresIn * 1000,
      })
      log.info(`[trakt-account-connect] Device code created for userId=${session.userId}`)
      return new Response(
        JSON.stringify({
          deviceCode: device.deviceCode,
          userCode: device.userCode,
          verificationUrl: device.verificationUrl,
          interval: device.interval,
        }),
        { status: 200, headers: makeJson(req) }
      )
    } catch (err) {
      log.error(`[trakt-account-connect] Device code request failed: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Could not contact Trakt. Please try again.' }),
        { status: 502, headers: makeJson(req) }
      )
    }
  }

  const match = path.match(/^\/api\/profile\/connections\/trakt\/device\/([^/]+)$/)
  if (match && req.method === 'GET') {
    const userToken = getUserTokenFromCookie(req)
    const session = userToken ? getUserSession(userToken) : null
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: makeJson(req),
      })
    }

    const deviceCode = match[1]
    const pending = _pendingConnections.get(deviceCode)
    if (!pending || pending.userId !== session.userId) {
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    if (Date.now() > pending.expiresAt) {
      _pendingConnections.delete(deviceCode)
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers: makeJson(req),
      })
    }

    try {
      const result = await pollTraktDeviceToken(deviceCode)
      if (result.status === 'pending' || result.status === 'slow_down') {
        return new Response(JSON.stringify({ status: 'pending' }), {
          status: 200,
          headers: makeJson(req),
        })
      }
      if (result.status !== 'success') {
        _pendingConnections.delete(deviceCode)
        return new Response(JSON.stringify({ status: result.status }), {
          status: 200,
          headers: makeJson(req),
        })
      }

      const traktUser = await getTraktUserSettings(result.tokens.accessToken)
      upsertUserSettings(session.userId, {
        traktAccessToken: result.tokens.accessToken,
        traktRefreshToken: result.tokens.refreshToken,
        traktTokenExpiresAt: result.tokens.expiresAt,
      })
      _pendingConnections.delete(deviceCode)

      log.info(
        `[trakt-account-connect] Connected Trakt account for userId=${session.userId} (${traktUser.username})`
      )
      return new Response(JSON.stringify({ status: 'success', username: traktUser.username }), {
        status: 200,
        headers: makeJson(req),
      })
    } catch (err) {
      log.error(`[trakt-account-connect] Poll failed for deviceCode=${deviceCode}: ${err}`)
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
  }

  return null
}
