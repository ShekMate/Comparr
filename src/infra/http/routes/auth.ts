// src/infra/http/routes/auth.ts
// Plex-only identity auth. Plex account is the sole login method.
// A personal Plex server is NOT required — any free plex.tv account works.

import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { makeHeaders } from '../security-headers.ts'
import { loginRateLimiter } from '../ip-rate-limiter.ts'
import {
  getPlexUrl,
  getPlexToken,
  getPlexClientId,
} from '../../../core/config.ts'
import { updateSettings } from '../../../core/settings.ts'
import { upsertUser, findUserById, getOrCreateInviteCode } from '../../../features/auth/user-db.ts'
import {
  createUserSession,
  getUserSession,
  invalidateUserSession,
} from '../../../core/user-session-store.ts'
import {
  requestPlexPin,
  pollPlexPin,
  getPlexUserInfo,
  isUserOnPlexServer,
} from '../../../features/auth/providers/plex.ts'

const USER_SESSION_COOKIE = 'comparr_user'
const PIN_TTL_MS = 6 * 60 * 1000

// In-memory store of active Plex PIN requests.
const _pendingPins = new Map<number, { clientId: string; expiresAt: number }>()

function pruneExpiredPins(): void {
  const now = Date.now()
  for (const [id, pin] of _pendingPins) {
    if (now > pin.expiresAt) _pendingPins.delete(id)
  }
}

const makeJson = (req: CompatRequest) =>
  makeHeaders(req, 'application/json')

const getClientIp = (req: CompatRequest) =>
  String(req?.conn?.remoteAddr?.hostname || 'unknown')

const parseCookies = (req: CompatRequest): Map<string, string> => {
  const cookies = new Map<string, string>()
  const raw = String(req.headers?.get?.('cookie') || '')
  for (const pair of raw.split(';')) {
    const [k, ...v] = pair.split('=')
    const key = String(k || '').trim()
    if (key) cookies.set(key, v.join('=').trim())
  }
  return cookies
}

const shouldUseSecureCookies = (req: CompatRequest): boolean => {
  const proto = String(req.headers?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (proto) return proto === 'https'
  return String(req.url || '').toLowerCase().startsWith('https://')
}

const getRequestOrigin = (req: CompatRequest): string => {
  try {
    return new URL(req.url).origin
  } catch {
    const protoHeader = String(req.headers?.get?.('x-forwarded-proto') || '')
      .split(',')[0]
      .trim()
      .toLowerCase()
    const proto = protoHeader || 'http'
    const host = String(req.headers?.get?.('x-forwarded-host') || '')
      .split(',')[0]
      .trim() ||
      String(req.headers?.get?.('host') || '').trim() ||
      'localhost'
    return `${proto}://${host}`
  }
}

const setUserSessionCookie = (
  headers: Headers,
  token: string,
  req: CompatRequest,
  maxAge?: number
): void => {
  const secure = shouldUseSecureCookies(req) ? '; Secure' : ''
  const age = maxAge !== undefined ? `; Max-Age=${maxAge}` : ''
  headers.set(
    'set-cookie',
    `${USER_SESSION_COOKIE}=${token}; Path=/; SameSite=Strict; HttpOnly${secure}${age}`
  )
}

/** Ensure a persistent PLEX_CLIENT_ID exists, generating one on first use. */
async function ensurePlexClientId(): Promise<string> {
  let clientId = getPlexClientId()
  if (!clientId) {
    clientId = crypto.randomUUID()
    updateSettings({ PLEX_CLIENT_ID: clientId }).catch(err =>
      log.warn(`[auth] Failed to persist Plex client ID: ${err}`)
    )
    log.info('[auth] Generated new Plex client ID')
  }
  return clientId
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleAuthRoutes(
  req: CompatRequest,
  pathname: string
): Promise<Response | null> {
  // ── GET /api/auth/providers ──────────────────────────────────────────────
  // Plex is always the only auth provider.
  if (pathname === '/api/auth/providers' && req.method === 'GET') {
    return new Response(
      JSON.stringify({
        providers: [{ id: 'plex', name: 'Plex' }],
        userAuthEnabled: true,
      }),
      { status: 200, headers: makeJson(req) }
    )
  }

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const token = parseCookies(req).get(USER_SESSION_COOKIE) || ''
    const session = token ? getUserSession(token) : null
    if (!session) {
      return new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    // Derive deterministic personal room code from user ID
    const roomCode = `U${String(session.userId).padStart(3, '0')}`
    return new Response(
      JSON.stringify({
        user: {
          id: session.userId,
          username: session.username,
          avatarUrl: session.avatarUrl,
          isAdmin: session.isAdmin,
          hasServerAccess: session.hasServerAccess,
          provider: session.provider,
          roomCode,
        },
      }),
      { status: 200, headers: makeJson(req) }
    )
  }

  // ── POST /api/auth/logout ────────────────────────────────────────────────
  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = parseCookies(req).get(USER_SESSION_COOKIE) || ''
    if (token) invalidateUserSession(token)
    const headers = makeJson(req)
    setUserSessionCookie(headers, '', req, 0)
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers,
    })
  }

  // ── POST /api/auth/plex/pin ──────────────────────────────────────────────
  // Plex auth always works — no server required, just a plex.tv account.
  if (pathname === '/api/auth/plex/pin' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const clientId = await ensurePlexClientId()
      const forwardUrl = `${getRequestOrigin(req)}/auth/plex-callback.html`
      let pinPayload: { pin: { id: number }; authUrl: string } | null = null

      // Prefer callback-enabled flow, but gracefully fall back to the
      // baseline Plex PIN auth URL if Plex rejects the forwardUrl.
      try {
        pinPayload = await requestPlexPin(clientId, forwardUrl)
      } catch (forwardErr) {
        log.warn(
          `[auth] Plex PIN request with forwardUrl failed, retrying without forwardUrl: ${forwardErr}`
        )
        pinPayload = await requestPlexPin(clientId)
      }
      const { pin, authUrl } = pinPayload

      pruneExpiredPins()
      _pendingPins.set(pin.id, {
        clientId,
        expiresAt: Date.now() + PIN_TTL_MS,
      })
      log.info(
        `[auth] Plex PIN created: pinId=${pin.id} expiresInMs=${PIN_TTL_MS}`
      )

      return new Response(
        JSON.stringify({ pinId: pin.id, authUrl }),
        { status: 200, headers: makeJson(req) }
      )
    } catch (err) {
      log.error(`[auth] Plex PIN request failed: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Could not contact Plex. Please try again.' }),
        { status: 502, headers: makeJson(req) }
      )
    }
  }

  // ── GET /api/auth/plex/pin/:pinId ────────────────────────────────────────
  const plexPinMatch = pathname.match(/^\/api\/auth\/plex\/pin\/(\d+)$/)
  if (plexPinMatch && req.method === 'GET') {
    const pinId = Number(plexPinMatch[1])
    const pending = _pendingPins.get(pinId)

    if (!pending) {
      log.warn(`[auth] Plex PIN poll: pinId=${pinId} not found (expired/missing)`)
      return new Response(
        JSON.stringify({ status: 'expired' }),
        { status: 200, headers: makeJson(req) }
      )
    }

    if (Date.now() > pending.expiresAt) {
      _pendingPins.delete(pinId)
      log.warn(`[auth] Plex PIN poll: pinId=${pinId} expired by TTL`)
      return new Response(
        JSON.stringify({ status: 'expired' }),
        { status: 200, headers: makeJson(req) }
      )
    }

    try {
      log.info(`[auth] Plex PIN poll: pinId=${pinId} checking status`)
      const status = await pollPlexPin(pinId, pending.clientId)

      if (status.expired) {
        _pendingPins.delete(pinId)
        log.warn(`[auth] Plex PIN poll: pinId=${pinId} reported expired by Plex`)
        return new Response(
          JSON.stringify({ status: 'expired' }),
          { status: 200, headers: makeJson(req) }
        )
      }

      if (!status.authToken) {
        log.info(`[auth] Plex PIN poll: pinId=${pinId} still pending`)
        return new Response(
          JSON.stringify({ status: 'pending' }),
          { status: 200, headers: makeJson(req) }
        )
      }
      log.info(`[auth] Plex PIN poll: pinId=${pinId} received auth token`)

      const plexUser = await getPlexUserInfo(status.authToken, pending.clientId)

      // Determine whether this Plex user has access to the configured Plex server.
      // Users without server access may still sign in, but server-backed features
      // (library filtering/requests) are restricted.
      let hasServerAccess = true
      if (getPlexUrl() && getPlexToken()) {
        hasServerAccess = await isUserOnPlexServer(
          status.authToken,
          getPlexUrl(),
          getPlexToken()
        )
      }

      const user = upsertUser({
        provider: 'plex',
        providerUserId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        avatarUrl: plexUser.thumb,
      })

      // Ensure user has an invite code
      const inviteCode = getOrCreateInviteCode(user.id)

      // Deterministic personal room code derived from user ID
      const roomCode = `U${String(user.id).padStart(3, '0')}`

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        hasServerAccess,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)

      log.info(`[auth] Plex login: ${user.username} (id=${user.id})`)
      // Delete only after the full login + session creation path succeeds.
      // If another poll arrives while we're still creating the user/session,
      // keeping the pin prevents false "expired" responses.
      _pendingPins.delete(pinId)
      log.info(`[auth] Plex PIN poll: pinId=${pinId} completed successfully`)

      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            hasServerAccess,
            provider: 'plex',
            roomCode,
            inviteCode,
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      log.error(`[auth] Plex PIN poll error: pinId=${pinId} err=${err}`)
      return new Response(
        JSON.stringify({ error: 'Authentication failed. Please try again.' }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── GET /api/auth/avatar ─────────────────────────────────────────────────
  // Proxy avatar images from allowed origins to avoid CSP violations.
  if (pathname === '/api/auth/avatar' && req.method === 'GET') {
    const rawUrl = new URL(req.url).searchParams.get('url') || ''
    if (!rawUrl) {
      return new Response('Missing url parameter', { status: 400 })
    }

    let targetUrl: URL
    try {
      targetUrl = new URL(rawUrl)
    } catch {
      return new Response('Invalid url parameter', { status: 400 })
    }

    // Always allow plex.tv and its CDN subdomains for Plex user avatars.
    const allowedOrigins: string[] = [
      'https://plex.tv',
      'https://www.gravatar.com',
      'https://metadata.provider.plex.tv',
    ]
    const plexUrl = getPlexUrl()
    if (plexUrl) {
      try { allowedOrigins.push(new URL(plexUrl).origin) } catch { /* ignore */ }
    }

    const targetOrigin = targetUrl.origin
    const originAllowed = allowedOrigins.some(o => {
      if (targetOrigin === o) return true
      const domain = o.replace(/^https?:\/\//, '')
      return targetOrigin.endsWith(`.${domain}`)
    })
    if (!originAllowed) {
      log.warn(`[auth] Avatar proxy blocked disallowed origin: ${targetOrigin}`)
      return new Response('Disallowed avatar origin', { status: 403 })
    }

    try {
      const upstream = await fetch(targetUrl.toString(), {
        headers: { 'User-Agent': 'Comparr/1.0' },
        signal: AbortSignal.timeout(8000),
      })

      if (!upstream.ok) {
        return new Response('Avatar fetch failed', { status: 502 })
      }

      const contentType = upstream.headers.get('content-type') || 'image/jpeg'
      if (!contentType.startsWith('image/')) {
        return new Response('Not an image', { status: 415 })
      }

      const body = await upstream.arrayBuffer()
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=86400',
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (err) {
      log.error(`[auth] Avatar proxy error: ${err}`)
      return new Response('Avatar proxy error', { status: 502 })
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Helpers exported for use in index.ts
// ---------------------------------------------------------------------------

/** Extract the user session token from the request cookie. */
export function getUserTokenFromCookie(req: CompatRequest): string {
  return parseCookies(req).get(USER_SESSION_COOKIE) || ''
}
