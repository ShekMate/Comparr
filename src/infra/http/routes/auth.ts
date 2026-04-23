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
  isPlexRestrictedToServer,
} from '../../../core/config.ts'
import { updateSettings } from '../../../core/settings.ts'
import { getDataDir } from '../../../core/env.ts'
import {
  upsertUser,
  findUserById,
  getOrCreateInviteCode,
} from '../../../features/auth/user-db.ts'
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
const PLEX_LOGIN_NONCE_COOKIE = 'comparr_plex_login'
const PIN_TTL_MS = 6 * 60 * 1000

// Active Plex PIN requests (memory cache mirrored to DATA_DIR).
const _pendingPins = new Map<
  number,
  { clientId: string; code: string; nonce: string; expiresAt: number }
>()
const PENDING_PINS_FILE = `${getDataDir()}/pending-plex-pins.json`

const loadPendingPinsFromDisk = (): void => {
  try {
    const text = Deno.readTextFileSync(PENDING_PINS_FILE)
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return
    _pendingPins.clear()
    const now = Date.now()
    for (const [rawPinId, value] of Object.entries(parsed)) {
      const pinId = Number(rawPinId)
      if (!Number.isFinite(pinId)) continue
      if (!value || typeof value !== 'object') continue
      const record = value as {
        clientId?: string
        code?: string
        nonce?: string
        expiresAt?: number
      }
      const expiresAt = Number(record.expiresAt || 0)
      if (!record.clientId || !record.code || !record.nonce || now > expiresAt) {
        continue
      }
      _pendingPins.set(pinId, {
        clientId: String(record.clientId),
        code: String(record.code),
        nonce: String(record.nonce),
        expiresAt,
      })
    }
  } catch {
    // ignore file-read/parse errors; continue with in-memory cache
  }
}

const persistPendingPinsToDisk = (): void => {
  try {
    Deno.mkdirSync(getDataDir(), { recursive: true })
    const tmp = `${PENDING_PINS_FILE}.tmp.${Date.now()}`
    const payload = Object.fromEntries(_pendingPins.entries())
    Deno.writeTextFileSync(tmp, JSON.stringify(payload))
    Deno.renameSync(tmp, PENDING_PINS_FILE)
  } catch {
    // ignore persistence failures; best-effort durability
  }
}

function pruneExpiredPins(): void {
  loadPendingPinsFromDisk()
  const now = Date.now()
  let changed = false
  for (const [id, pin] of _pendingPins) {
    if (now > pin.expiresAt) {
      _pendingPins.delete(id)
      changed = true
    }
  }
  if (changed) persistPendingPinsToDisk()
}

const makeJson = (req: CompatRequest) => makeHeaders(req, 'application/json')

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
  return String(req.url || '')
    .toLowerCase()
    .startsWith('https://')
}

const getRequestOrigin = (req: CompatRequest): string => {
  const forwardedProto = String(req.headers?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  const forwardedHost = String(req.headers?.get?.('x-forwarded-host') || '')
    .split(',')[0]
    .trim()
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`
  }

  try {
    return new URL(req.url).origin
  } catch {
    const proto = forwardedProto || 'http'
    const host =
      forwardedHost ||
      String(req.headers?.get?.('host') || '').trim() ||
      'localhost'
    return `${proto}://${host}`
  }
}

const getForwardedPrefix = (req: CompatRequest): string =>
  String(req.headers?.get?.('x-forwarded-prefix') || '')
    .split(',')[0]
    .trim()
    .replace(/\/$/, '')

const setUserSessionCookie = (
  headers: Headers,
  token: string,
  req: CompatRequest,
  maxAge?: number
): void => {
  const secure = shouldUseSecureCookies(req) ? '; Secure' : ''
  const age = maxAge !== undefined ? `; Max-Age=${maxAge}` : ''
  headers.append(
    'set-cookie',
    `${USER_SESSION_COOKIE}=${token}; Path=/; SameSite=Strict; HttpOnly${secure}${age}`
  )
  log.info(
    `[auth] Set user session cookie (secure=${Boolean(secure)}, maxAge=${
      maxAge ?? 'session'
    })`
  )
}

const setPlexLoginNonceCookie = (
  headers: Headers,
  nonce: string,
  req: CompatRequest,
  maxAgeSeconds: number
): void => {
  const secure = shouldUseSecureCookies(req) ? '; Secure' : ''
  headers.append(
    'set-cookie',
    `${PLEX_LOGIN_NONCE_COOKIE}=${nonce}; Path=/; SameSite=Strict; HttpOnly${secure}; Max-Age=${maxAgeSeconds}`
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
      log.info(
        `[auth] /api/auth/me no active session (hasCookie=${Boolean(token)})`
      )
      return new Response(JSON.stringify({ user: null }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    log.info(
      `[auth] /api/auth/me active session found (userId=${session.userId}, username=${session.username})`
    )
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
    log.info(`[auth] Logout requested (hasCookie=${Boolean(token)})`)
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
    const requestOrigin = getRequestOrigin(req)
    log.info(
      `[auth] Plex PIN start requested (ip=${ip}, origin=${requestOrigin})`
    )
    if (!loginRateLimiter.check(ip)) {
      log.warn(`[auth] Plex PIN start rate-limited (ip=${ip})`)
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const clientId = await ensurePlexClientId()
      log.info(
        `[auth] Using Plex client ID for PIN start (clientId=${clientId})`
      )
      let forwardUrl: string | undefined
      try {
        const parsedOrigin = new URL(requestOrigin)
        const isSecure = parsedOrigin.protocol === 'https:'
        const isLoopback =
          parsedOrigin.hostname === 'localhost' ||
          parsedOrigin.hostname === '127.0.0.1' ||
          parsedOrigin.hostname === '::1'
        if (isSecure || isLoopback) {
          forwardUrl = `${requestOrigin}${getForwardedPrefix(
            req
          )}/auth/plex-callback.html`
        } else {
          log.info(
            `[auth] Skipping forwardUrl for non-HTTPS/non-loopback origin (origin=${requestOrigin})`
          )
        }
      } catch {
        log.warn(
          `[auth] Could not parse request origin for forwardUrl: ${requestOrigin}`
        )
      }
      let pinPayload:
        | { pin: { id: number; code: string; expiresAt?: string }; authUrl: string }
        | null = null

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
      if (typeof authUrl !== 'string' || !authUrl.trim()) {
        log.error(
          `[auth] Invalid Plex authUrl returned from provider: ${JSON.stringify(
            authUrl
          )}`
        )
        return new Response(
          JSON.stringify({
            error: 'Invalid Plex auth URL returned from provider.',
          }),
          { status: 502, headers: makeJson(req) }
        )
      }

      const parsedPinExpiresAt = Date.parse(String(pin.expiresAt || ''))
      const pinExpiresAt =
        Number.isFinite(parsedPinExpiresAt) && parsedPinExpiresAt > Date.now()
          ? parsedPinExpiresAt
          : Date.now() + PIN_TTL_MS
      const maxAgeSeconds = Math.max(
        1,
        Math.ceil((pinExpiresAt - Date.now()) / 1000)
      )
      const loginNonce = crypto.randomUUID()

      pruneExpiredPins()
      _pendingPins.set(pin.id, {
        clientId,
        code: pin.code,
        nonce: loginNonce,
        expiresAt: pinExpiresAt,
      })
      persistPendingPinsToDisk()
      log.info(
        `[auth] Plex PIN created: pinId=${pin.id} codeLength=${
          pin.code?.length ?? 0
        } expiresInMs=${Math.max(0, pinExpiresAt - Date.now())}`
      )

      const headers = makeJson(req)
      setPlexLoginNonceCookie(headers, loginNonce, req, maxAgeSeconds)
      return new Response(JSON.stringify({ pinId: pin.id, authUrl }), {
        status: 200,
        headers,
      })
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
    const traceId = `pin-${pinId}-${Date.now().toString(36)}`
    loadPendingPinsFromDisk()
    const pending = _pendingPins.get(pinId)
    const loginNonce = parseCookies(req).get(PLEX_LOGIN_NONCE_COOKIE) || ''
    log.info(
      `[auth][${traceId}] [step 1] Plex PIN poll request received (pinId=${pinId})`
    )

    if (!pending || !loginNonce || pending.nonce !== loginNonce) {
      log.warn(
        `[auth][${traceId}] [step 2] pinId=${pinId} missing or nonce mismatch`
      )
      const headers = makeJson(req)
      setPlexLoginNonceCookie(headers, '', req, 0)
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers,
      })
    }

    if (Date.now() > pending.expiresAt) {
      _pendingPins.delete(pinId)
      persistPendingPinsToDisk()
      log.warn(`[auth][${traceId}] [step 3] pinId=${pinId} expired by TTL`)
      const headers = makeJson(req)
      setPlexLoginNonceCookie(headers, '', req, 0)
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers,
      })
    }
    log.info(
      `[auth][${traceId}] [step 4] Pending entry loaded (pinId=${pinId}, expiresInMs=${Math.max(
        0,
        pending.expiresAt - Date.now()
      )}, hasCode=${Boolean(pending.code)})`
    )

    try {
      log.info(`[auth][${traceId}] [step 5] Checking status with plex.tv`)
      const status = await pollPlexPin(pinId, pending.clientId, pending.code)
      log.info(
        `[auth][${traceId}] [step 6] Poll evaluated (pinId=${pinId}, expired=${
          status.expired
        }, hasAuthToken=${Boolean(status.authToken)})`
      )

      if (status.expired) {
        _pendingPins.delete(pinId)
        persistPendingPinsToDisk()
        log.warn(
          `[auth][${traceId}] [step 7] pinId=${pinId} reported expired by Plex`
        )
        const headers = makeJson(req)
        setPlexLoginNonceCookie(headers, '', req, 0)
        return new Response(JSON.stringify({ status: 'expired' }), {
          status: 200,
          headers,
        })
      }

      if (!status.authToken) {
        log.info(`[auth][${traceId}] [step 8] pinId=${pinId} still pending`)
        return new Response(JSON.stringify({ status: 'pending' }), {
          status: 200,
          headers: makeJson(req),
        })
      }
      log.info(`[auth][${traceId}] [step 9] pinId=${pinId} received auth token`)

      const plexUser = await getPlexUserInfo(status.authToken, pending.clientId)
      log.info(
        `[auth] Plex user info fetched from auth token (pinId=${pinId}, plexUserId=${plexUser.id}, username=${plexUser.username})`
      )

      // Determine whether this Plex user has access to the configured Plex server.
      // Users without server access may still sign in, but server-backed features
      // (library filtering/requests) are restricted.
      let hasServerAccess = true
      if (getPlexUrl() && getPlexToken()) {
        log.info(`[auth] Checking Plex server access for user (pinId=${pinId})`)
        hasServerAccess = await isUserOnPlexServer(
          status.authToken,
          getPlexUrl(),
          getPlexToken()
        )
        log.info(
          `[auth] Plex server access check complete (pinId=${pinId}, hasServerAccess=${hasServerAccess})`
        )
      }
      if (isPlexRestrictedToServer() && !hasServerAccess) {
        _pendingPins.delete(pinId)
        persistPendingPinsToDisk()
        const headers = makeJson(req)
        setPlexLoginNonceCookie(headers, '', req, 0)
        return new Response(
          JSON.stringify({
            status: 'denied',
            error: 'You do not have access to this Plex server.',
          }),
          { status: 200, headers }
        )
      }

      const user = upsertUser({
        provider: 'plex',
        providerUserId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        avatarUrl: plexUser.thumb,
      })
      log.info(`[auth] Upserted auth user (pinId=${pinId}, userId=${user.id})`)

      // Ensure user has an invite code
      const inviteCode = getOrCreateInviteCode(user.id)
      log.info(
        `[auth] Resolved invite code for user (pinId=${pinId}, userId=${user.id})`
      )

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
      setPlexLoginNonceCookie(headers, '', req, 0)
      log.info(
        `[auth][${traceId}] [step 10] User session established (pinId=${pinId}, userId=${user.id}, username=${user.username}, hasServerAccess=${hasServerAccess})`
      )

      log.info(`[auth] Plex login: ${user.username} (id=${user.id})`)
      // Delete only after the full login + session creation path succeeds.
      // If another poll arrives while we're still creating the user/session,
      // keeping the pin prevents false "expired" responses.
      _pendingPins.delete(pinId)
      persistPendingPinsToDisk()
      log.info(
        `[auth][${traceId}] [step 11] pinId=${pinId} completed successfully`
      )

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
      log.error(
        `[auth][${traceId}] [step X] Plex PIN poll error: pinId=${pinId} err=${err}`
      )
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
      try {
        allowedOrigins.push(new URL(plexUrl).origin)
      } catch {
        /* ignore */
      }
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
