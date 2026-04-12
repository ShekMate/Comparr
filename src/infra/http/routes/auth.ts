// src/infra/http/routes/auth.ts
// Media-server identity auth routes.
// Supports Plex (PIN OAuth), Jellyfin (local username/password), Emby (local username/password).

import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { makeHeaders } from '../security-headers.ts'
import { loginRateLimiter } from '../ip-rate-limiter.ts'
import {
  isUserAuthEnabled,
  getPlexUrl,
  getPlexToken,
  getPlexClientId,
  getEmbyUrl,
  getJellyfinUrl,
  isPlexRestrictedToServer,
} from '../../../core/config.ts'
import { getSetting, updateSettings } from '../../../core/settings.ts'
import { upsertUser, findUserById } from '../../../features/auth/user-db.ts'
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
import { authenticateJellyfinUser } from '../../../features/auth/providers/jellyfin.ts'
import { authenticateEmbyUser } from '../../../features/auth/providers/emby.ts'

const USER_SESSION_COOKIE = 'comparr_user'
const PIN_TTL_MS = 6 * 60 * 1000 // 6 minutes — slightly over Plex's 5-min pin TTL

// In-memory store of active Plex PIN requests so polling can verify them.
// Map<pinId, { clientId, expiresAt }>
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
    await updateSettings({ PLEX_CLIENT_ID: clientId })
    log.info('[auth] Generated new Plex client ID')
  }
  return clientId
}

function isPlexConfigured(): boolean {
  return Boolean(getPlexUrl()) && Boolean(getPlexToken())
}

function isJellyfinConfigured(): boolean {
  return Boolean(getJellyfinUrl()) && Boolean(getSetting('JELLYFIN_API_KEY'))
}

function isEmbyConfigured(): boolean {
  return Boolean(getEmbyUrl()) && Boolean(getSetting('EMBY_API_KEY'))
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleAuthRoutes(
  req: CompatRequest,
  pathname: string
): Promise<Response | null> {
  // ── GET /api/auth/providers ──────────────────────────────────────────────
  // Returns which auth providers are available (based on configured servers).
  if (pathname === '/api/auth/providers' && req.method === 'GET') {
    const providers: Array<{ id: string; name: string }> = []
    if (isPlexConfigured()) providers.push({ id: 'plex', name: 'Plex' })
    if (isJellyfinConfigured()) providers.push({ id: 'jellyfin', name: 'Jellyfin' })
    if (isEmbyConfigured()) providers.push({ id: 'emby', name: 'Emby' })

    return new Response(
      JSON.stringify({ providers, userAuthEnabled: isUserAuthEnabled() }),
      { status: 200, headers: makeJson(req) }
    )
  }

  // ── GET /api/auth/me ─────────────────────────────────────────────────────
  // Returns the current authenticated user, or null if not logged in.
  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const token = parseCookies(req).get(USER_SESSION_COOKIE) || ''
    const session = token ? getUserSession(token) : null
    if (!session) {
      return new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    return new Response(
      JSON.stringify({
        user: {
          id: session.userId,
          username: session.username,
          avatarUrl: session.avatarUrl,
          isAdmin: session.isAdmin,
          provider: session.provider,
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
  // Request a new Plex PIN and return it with the auth URL for the popup.
  if (pathname === '/api/auth/plex/pin' && req.method === 'POST') {
    if (!isPlexConfigured()) {
      return new Response(
        JSON.stringify({ error: 'Plex is not configured.' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const clientId = await ensurePlexClientId()
      const { pin, authUrl } = await requestPlexPin(clientId)

      pruneExpiredPins()
      _pendingPins.set(pin.id, {
        clientId,
        expiresAt: Date.now() + PIN_TTL_MS,
      })

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
  // Poll for PIN approval. On success, complete the login and set the session cookie.
  const plexPinMatch = pathname.match(/^\/api\/auth\/plex\/pin\/(\d+)$/)
  if (plexPinMatch && req.method === 'GET') {
    const pinId = Number(plexPinMatch[1])
    const pending = _pendingPins.get(pinId)

    if (!pending) {
      return new Response(
        JSON.stringify({ status: 'expired' }),
        { status: 200, headers: makeJson(req) }
      )
    }

    if (Date.now() > pending.expiresAt) {
      _pendingPins.delete(pinId)
      return new Response(
        JSON.stringify({ status: 'expired' }),
        { status: 200, headers: makeJson(req) }
      )
    }

    try {
      const status = await pollPlexPin(pinId, pending.clientId)

      if (status.expired) {
        _pendingPins.delete(pinId)
        return new Response(
          JSON.stringify({ status: 'expired' }),
          { status: 200, headers: makeJson(req) }
        )
      }

      if (!status.authToken) {
        return new Response(
          JSON.stringify({ status: 'pending' }),
          { status: 200, headers: makeJson(req) }
        )
      }

      // User approved — get their info
      _pendingPins.delete(pinId)
      const plexUser = await getPlexUserInfo(status.authToken, pending.clientId)

      // Server-restriction check
      if (isPlexRestrictedToServer()) {
        const hasAccess = await isUserOnPlexServer(
          status.authToken,
          getPlexUrl(),
          getPlexToken()
        )
        if (!hasAccess) {
          return new Response(
            JSON.stringify({
              status: 'denied',
              error: 'You do not have access to this Plex server.',
            }),
            { status: 403, headers: makeJson(req) }
          )
        }
      }

      const user = upsertUser({
        provider: 'plex',
        providerUserId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        avatarUrl: plexUser.thumb,
      })

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)

      log.info(`[auth] Plex login: ${user.username} (admin=${user.isAdmin})`)

      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            provider: 'plex',
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      log.error(`[auth] Plex PIN poll error: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Authentication failed. Please try again.' }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── POST /api/auth/jellyfin ──────────────────────────────────────────────
  if (pathname === '/api/auth/jellyfin' && req.method === 'POST') {
    if (!isJellyfinConfigured()) {
      return new Response(
        JSON.stringify({ error: 'Jellyfin is not configured.' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const body = await req.json<{ username?: string; password?: string }>()
      const username = String(body?.username ?? '').trim()
      const password = String(body?.password ?? '')

      if (!username) {
        return new Response(
          JSON.stringify({ error: 'Username is required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      const jellyfinUser = await authenticateJellyfinUser(
        getJellyfinUrl(),
        username,
        password
      )

      const user = upsertUser({
        provider: 'jellyfin',
        providerUserId: jellyfinUser.id,
        username: jellyfinUser.username,
        email: '',
        avatarUrl: jellyfinUser.avatarUrl,
      })

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)

      log.info(`[auth] Jellyfin login: ${user.username} (admin=${user.isAdmin})`)

      return new Response(
        JSON.stringify({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            provider: 'jellyfin',
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.'
      log.warn(`[auth] Jellyfin login failed: ${message}`)
      return new Response(
        JSON.stringify({ error: message }),
        { status: 401, headers: makeJson(req) }
      )
    }
  }

  // ── POST /api/auth/emby ──────────────────────────────────────────────────
  if (pathname === '/api/auth/emby' && req.method === 'POST') {
    if (!isEmbyConfigured()) {
      return new Response(
        JSON.stringify({ error: 'Emby is not configured.' }),
        { status: 400, headers: makeJson(req) }
      )
    }

    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const body = await req.json<{ username?: string; password?: string }>()
      const username = String(body?.username ?? '').trim()
      const password = String(body?.password ?? '')

      if (!username) {
        return new Response(
          JSON.stringify({ error: 'Username is required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      const embyUser = await authenticateEmbyUser(
        getEmbyUrl(),
        username,
        password
      )

      const user = upsertUser({
        provider: 'emby',
        providerUserId: embyUser.id,
        username: embyUser.username,
        email: '',
        avatarUrl: embyUser.avatarUrl,
      })

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)

      log.info(`[auth] Emby login: ${user.username} (admin=${user.isAdmin})`)

      return new Response(
        JSON.stringify({
          success: true,
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            provider: 'emby',
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed.'
      log.warn(`[auth] Emby login failed: ${message}`)
      return new Response(
        JSON.stringify({ error: message }),
        { status: 401, headers: makeJson(req) }
      )
    }
  }

  // ── GET /api/auth/avatar ─────────────────────────────────────────────────
  // Proxy an avatar image from an allowed media-server origin so the browser
  // can load it without CSP violations (img-src 'self' only).
  // Query param: url (URL-encoded absolute avatar URL from Plex/Jellyfin/Emby)
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

    // Only proxy from configured media server origins to prevent SSRF abuse.
    const allowedOrigins: string[] = []
    const plexUrl = getPlexUrl()
    const embyUrl = getEmbyUrl()
    const jellyfinUrl = getJellyfinUrl()
    if (plexUrl) {
      try { allowedOrigins.push(new URL(plexUrl).origin) } catch { /* ignore */ }
      // Plex avatars are served from plex.tv CDN
      allowedOrigins.push('https://plex.direct')
      allowedOrigins.push('https://metadata.provider.plex.tv')
    }
    if (embyUrl) {
      try { allowedOrigins.push(new URL(embyUrl).origin) } catch { /* ignore */ }
    }
    if (jellyfinUrl) {
      try { allowedOrigins.push(new URL(jellyfinUrl).origin) } catch { /* ignore */ }
    }

    const targetOrigin = targetUrl.origin
    if (!allowedOrigins.some(o => targetOrigin === o || targetOrigin.endsWith(o.replace(/^https?:\/\//, '.')))) {
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
      // Only proxy image content types
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
