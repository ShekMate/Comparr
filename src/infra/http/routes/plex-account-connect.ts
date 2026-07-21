// routes/plex-account-connect.ts
// POST /api/profile/connections/plex-account/pin
// GET  /api/profile/connections/plex-account/pin/:pinId
//
// Lets an already-logged-in Comparr user authorize their Plex ACCOUNT (for Watchlist sync)
// without that being how they log into Comparr — independent of routes/auth.ts's login-only
// Plex PIN flow. Reuses the same Plex PIN primitives (requestPlexPin/pollPlexPin/
// getPlexUserInfo), but on success stores the token in user_settings.plex_account_token
// instead of creating/switching a Comparr identity.
//
// Pending pins here are in-memory only (no disk persistence, unlike auth.ts's login pins) —
// if the server restarts mid-connect, the user just retries. Lower stakes than login, which
// disk-persists specifically so an in-flight sign-in survives a deploy.

import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { makeHeaders } from '../security-headers.ts'
import { getUserTokenFromCookie, ensurePlexClientId } from './auth.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { requestPlexPin, pollPlexPin, getPlexUserInfo } from '../../../features/auth/providers/plex.ts'
import { upsertUserSettings } from '../../../features/auth/user-db.ts'

const PIN_TTL_MS = 6 * 60 * 1000

interface PendingConnection {
  clientId: string
  userId: number
  expiresAt: number
}

const _pendingConnections = new Map<number, PendingConnection>()

function makeJson(req: CompatRequest): HeadersInit {
  return makeHeaders(req, 'application/json')
}

function pruneExpired(): void {
  const now = Date.now()
  for (const [id, entry] of _pendingConnections) {
    if (now > entry.expiresAt) _pendingConnections.delete(id)
  }
}

export async function handlePlexAccountConnectRoutes(
  req: CompatRequest,
  path: string
): Promise<Response | null> {
  if (path === '/api/profile/connections/plex-account/pin' && req.method === 'POST') {
    const userToken = getUserTokenFromCookie(req)
    const session = userToken ? getUserSession(userToken) : null
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: makeJson(req),
      })
    }

    try {
      const clientId = await ensurePlexClientId()
      const { pin, authUrl } = await requestPlexPin(clientId)
      if (typeof authUrl !== 'string' || !authUrl.trim()) {
        log.error(`[plex-account-connect] Invalid authUrl from provider: ${JSON.stringify(authUrl)}`)
        return new Response(
          JSON.stringify({ error: 'Invalid Plex auth URL returned from provider.' }),
          { status: 502, headers: makeJson(req) }
        )
      }

      const parsedExpiresAt = Date.parse(String(pin.expiresAt || ''))
      const expiresAt =
        Number.isFinite(parsedExpiresAt) && parsedExpiresAt > Date.now()
          ? parsedExpiresAt
          : Date.now() + PIN_TTL_MS

      pruneExpired()
      _pendingConnections.set(pin.id, { clientId, userId: session.userId, expiresAt })

      log.info(`[plex-account-connect] PIN created: pinId=${pin.id} userId=${session.userId}`)
      return new Response(JSON.stringify({ pinId: pin.id, authUrl }), {
        status: 200,
        headers: makeJson(req),
      })
    } catch (err) {
      log.error(`[plex-account-connect] PIN request failed: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Could not contact Plex. Please try again.' }),
        { status: 502, headers: makeJson(req) }
      )
    }
  }

  const pinMatch = path.match(/^\/api\/profile\/connections\/plex-account\/pin\/(\d+)$/)
  if (pinMatch && req.method === 'GET') {
    const userToken = getUserTokenFromCookie(req)
    const session = userToken ? getUserSession(userToken) : null
    if (!session) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: makeJson(req),
      })
    }

    const pinId = Number(pinMatch[1])
    const pending = _pendingConnections.get(pinId)
    // Also guards against one user polling another's pending pinId.
    if (!pending || pending.userId !== session.userId) {
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    if (Date.now() > pending.expiresAt) {
      _pendingConnections.delete(pinId)
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers: makeJson(req),
      })
    }

    try {
      const status = await pollPlexPin(pinId, pending.clientId)
      if (status.expired) {
        _pendingConnections.delete(pinId)
        return new Response(JSON.stringify({ status: 'expired' }), {
          status: 200,
          headers: makeJson(req),
        })
      }
      if (!status.authToken) {
        return new Response(JSON.stringify({ status: 'pending' }), {
          status: 200,
          headers: makeJson(req),
        })
      }

      // Confirm the token actually resolves to a real account (and get a display name for the
      // UI) before saving it.
      const plexUser = await getPlexUserInfo(status.authToken, pending.clientId)
      upsertUserSettings(session.userId, { plexAccountToken: status.authToken })
      _pendingConnections.delete(pinId)

      log.info(
        `[plex-account-connect] Connected Plex account for userId=${session.userId} (${plexUser.username})`
      )
      return new Response(JSON.stringify({ status: 'success', username: plexUser.username }), {
        status: 200,
        headers: makeJson(req),
      })
    } catch (err) {
      log.error(`[plex-account-connect] Poll failed for pinId=${pinId}: ${err}`)
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
  }

  return null
}
