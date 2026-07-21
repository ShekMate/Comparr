// src/infra/http/routes/auth.ts
// Identity auth: Plex OAuth and email magic-link (OTP).
// A personal Plex server is NOT required — any free plex.tv account works.

import type { CompatRequest } from '../compat-request.ts'
import * as log from 'jsr:@std/log'
import { makeHeaders } from '../security-headers.ts'
import { loginRateLimiter } from '../ip-rate-limiter.ts'
import { resolveClientIp } from '../network-access.ts'
import {
  getPlexUrl,
  getPlexToken,
  getPlexClientId,
  isPlexRestrictedToServer,
} from '../../../core/config.ts'
import { updateSettings, getSetting } from '../../../core/settings.ts'
import { getDataDir } from '../../../core/env.ts'
import {
  upsertUser,
  findUserById,
  getOrCreateInviteCode,
  updateUsername,
} from '../../../features/auth/user-db.ts'
import {
  createUserSession,
  getUserSession,
  invalidateUserSession,
  updateSessionUsername,
} from '../../../core/user-session-store.ts'
import {
  requestPlexPin,
  pollPlexPin,
  getPlexUserInfo,
  isUserOnPlexServer,
} from '../../../features/auth/providers/plex.ts'
import {
  generateOtp,
  storeOtp,
  verifyAndConsumeOtp,
  sendOtpEmail,
  loadOtpsFromDisk,
} from '../../../features/auth/providers/email-otp.ts'
import {
  requestTraktDeviceCode,
  pollTraktDeviceToken,
  getTraktUserSettings,
} from '../../../api/trakt.ts'
import { setUserTraktLoginTokens } from '../../../features/auth/user-db.ts'

const USER_SESSION_COOKIE = 'comparr_user'
const PIN_TTL_MS = 6 * 60 * 1000
// Trakt device codes are short-lived (Trakt sets expires_in, typically ~10 min) and this is a
// lower-stakes flow than Plex login's disk-persisted pins — in-memory only is fine, a server
// restart mid-flow just means the user retries.
const _pendingTraktDeviceLogins = new Map<string, { expiresAt: number }>()

// Active Plex PIN requests (memory cache mirrored to DATA_DIR).
const _pendingPins = new Map<
  number,
  { clientId: string; expiresAt: number }
>()
const PENDING_PINS_FILE = `${getDataDir()}/pending-plex-pins.json`
const PENDING_PINS_LOCK_DIR = `${getDataDir()}/pending-plex-pins.lock`
const PENDING_PINS_LOCK_STALE_MS = 30_000

const sleepSync = (ms: number): void => {
  const signal = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(signal, 0, 0, ms)
}

const withPendingPinsLock = <T>(fn: () => T): T => {
  const maxAttempts = 200
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      Deno.mkdirSync(PENDING_PINS_LOCK_DIR)
      try {
        return fn()
      } finally {
        Deno.removeSync(PENDING_PINS_LOCK_DIR)
      }
    } catch (err) {
      const lockErr = err as { name?: string; code?: string }
      if (lockErr?.name !== 'AlreadyExists' && lockErr?.code !== 'EEXIST') {
        throw err
      }
      try {
        const stat = Deno.statSync(PENDING_PINS_LOCK_DIR)
        const lockAgeMs = stat.mtime ? Date.now() - stat.mtime.getTime() : 0
        if (lockAgeMs > PENDING_PINS_LOCK_STALE_MS) {
          Deno.removeSync(PENDING_PINS_LOCK_DIR, { recursive: true })
          continue
        }
      } catch {
        // Ignore races where another process removed/recreated the lock.
      }
      sleepSync(10)
    }
  }
  throw new Error('[auth] timed out waiting for pending PIN store lock')
}

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
        expiresAt?: number
      }
      const expiresAt = Number(record.expiresAt || 0)
      if (!record.clientId || now > expiresAt) {
        continue
      }
      _pendingPins.set(pinId, {
        clientId: String(record.clientId),
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

const makeJson = (req: CompatRequest) => makeHeaders(req, 'application/json')

const getClientIp = (req: CompatRequest) => resolveClientIp(req)

const MAX_DISPLAY_NAME_LENGTH = 30

// Guest/profile display names are user-typed, unlike Guest-xxxxxx (formerly auto-generated)
// or provider-derived names — strip line breaks so they can't break the room member list.
const sanitizeDisplayName = (raw: unknown): string =>
  String(raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)

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

/** Ensure a persistent PLEX_CLIENT_ID exists, generating one on first use. */
export async function ensurePlexClientId(): Promise<string> {
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
  if (pathname === '/api/auth/providers' && req.method === 'GET') {
    const emailEnabled = getSetting('EMAIL_LOGIN_ENABLED') === 'true'
    const providers: { id: string; name: string }[] = [
      { id: 'plex', name: 'Plex' },
      { id: 'trakt', name: 'Trakt' },
    ]
    if (emailEnabled) providers.push({ id: 'email', name: 'Email' })
    return new Response(
      JSON.stringify({ providers, userAuthEnabled: true }),
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

  // ── POST /api/auth/plex ──────────────────────────────────────────────────
  // Seerr-style flow: frontend completes Plex PIN polling and sends authToken.
  if (pathname === '/api/auth/plex' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(JSON.stringify({ error: 'Too many attempts. Please wait.' }), {
        status: 429,
        headers: makeJson(req),
      })
    }

    try {
      const body = await req.json<{ authToken?: string; clientId?: string }>()
      const authToken = String(body?.authToken || '').trim()
      const providedClientId = String(body?.clientId || '').trim()
      if (!authToken) {
        return new Response(JSON.stringify({ error: 'Missing Plex auth token.' }), {
          status: 400,
          headers: makeJson(req),
        })
      }

      const clientId = providedClientId || (await ensurePlexClientId())
      const plexUser = await getPlexUserInfo(authToken, clientId)

      let hasServerAccess = true
      if (getPlexUrl() && getPlexToken()) {
        hasServerAccess = await isUserOnPlexServer(
          authToken,
          getPlexUrl(),
          getPlexToken()
        )
      }
      if (isPlexRestrictedToServer() && !hasServerAccess) {
        return new Response(
          JSON.stringify({
            status: 'denied',
            error: 'You do not have access to this Plex server.',
          }),
          { status: 200, headers: makeJson(req) }
        )
      }

      const user = upsertUser({
        provider: 'plex',
        providerUserId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        avatarUrl: plexUser.thumb,
        plexAuthToken: authToken,
      })
      const inviteCode = getOrCreateInviteCode(user.id)
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
      log.warn(`[auth] Plex token login failed: ${err}`)
      return new Response(JSON.stringify({ error: 'Plex login failed.' }), {
        status: 401,
        headers: makeJson(req),
      })
    }
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
      withPendingPinsLock(() => {
        loadPendingPinsFromDisk()
        const now = Date.now()
        for (const [id, pendingPin] of _pendingPins) {
          if (now > pendingPin.expiresAt) _pendingPins.delete(id)
        }
        _pendingPins.set(pin.id, {
          clientId,
          expiresAt: pinExpiresAt,
        })
        persistPendingPinsToDisk()
      })
      log.info(
        `[auth] Plex PIN created: pinId=${pin.id} codeLength=${
          pin.code?.length ?? 0
        } expiresInMs=${Math.max(0, pinExpiresAt - Date.now())}`
      )

      return new Response(JSON.stringify({ pinId: pin.id, authUrl }), {
        status: 200,
        headers: makeJson(req),
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
    const pending = withPendingPinsLock(() => {
      loadPendingPinsFromDisk()
      const hit = _pendingPins.get(pinId)
      if (!hit) return null
      return { ...hit }
    })
    log.info(
      `[auth][${traceId}] [step 1] Plex PIN poll request received (pinId=${pinId})`
    )

    if (!pending) {
      log.warn(
        `[auth][${traceId}] [step 2] pinId=${pinId} missing from local pending store; falling back to Plex poll`
      )
    }

    const pollClientId = pending?.clientId || (await ensurePlexClientId())

    if (pending && Date.now() > pending.expiresAt) {
      withPendingPinsLock(() => {
        loadPendingPinsFromDisk()
        _pendingPins.delete(pinId)
        persistPendingPinsToDisk()
      })
      log.warn(`[auth][${traceId}] [step 3] pinId=${pinId} expired by TTL`)
      return new Response(JSON.stringify({ status: 'expired' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
    log.info(
      `[auth][${traceId}] [step 4] Pending entry loaded (pinId=${pinId}, expiresInMs=${Math.max(
        0,
        (pending?.expiresAt || Date.now()) - Date.now()
      )})`
    )

    try {
      log.info(`[auth][${traceId}] [step 5] Checking status with plex.tv`)
      const status = await pollPlexPin(pinId, pollClientId)
      log.info(
        `[auth][${traceId}] [step 6] Poll evaluated (pinId=${pinId}, expired=${
          status.expired
        }, hasAuthToken=${Boolean(status.authToken)})`
      )

      if (status.expired) {
        withPendingPinsLock(() => {
          loadPendingPinsFromDisk()
          _pendingPins.delete(pinId)
          persistPendingPinsToDisk()
        })
        log.warn(
          `[auth][${traceId}] [step 7] pinId=${pinId} reported expired by Plex`
        )
        return new Response(JSON.stringify({ status: 'expired' }), {
          status: 200,
          headers: makeJson(req),
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

      // Independent reads off the same auth token — run concurrently rather than
      // sequentially so the mobile app's login browser can dismiss sooner (each is a
      // real network round trip to plex.tv, and the mobile client polls this route
      // synchronously waiting on this response).
      const serverAccessCheckNeeded = Boolean(getPlexUrl() && getPlexToken())
      const [plexUser, hasServerAccess] = await Promise.all([
        getPlexUserInfo(status.authToken, pollClientId),
        serverAccessCheckNeeded
          ? isUserOnPlexServer(status.authToken, getPlexUrl(), getPlexToken())
          : Promise.resolve(true),
      ])
      log.info(
        `[auth] Plex user info fetched from auth token (pinId=${pinId}, plexUserId=${plexUser.id}, username=${plexUser.username})`
      )
      if (serverAccessCheckNeeded) {
        log.info(
          `[auth] Plex server access check complete (pinId=${pinId}, hasServerAccess=${hasServerAccess})`
        )
      }
      if (isPlexRestrictedToServer() && !hasServerAccess) {
        withPendingPinsLock(() => {
          loadPendingPinsFromDisk()
          _pendingPins.delete(pinId)
          persistPendingPinsToDisk()
        })
        return new Response(
          JSON.stringify({
            status: 'denied',
            error: 'You do not have access to this Plex server.',
          }),
          { status: 200, headers: makeJson(req) }
        )
      }

      const user = upsertUser({
        provider: 'plex',
        providerUserId: plexUser.id,
        username: plexUser.username,
        email: plexUser.email,
        avatarUrl: plexUser.thumb,
        plexAuthToken: status.authToken,
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
      log.info(
        `[auth][${traceId}] [step 10] User session established (pinId=${pinId}, userId=${user.id}, username=${user.username}, hasServerAccess=${hasServerAccess})`
      )

      log.info(`[auth] Plex login: ${user.username} (id=${user.id})`)
      // Delete only after the full login + session creation path succeeds.
      // If another poll arrives while we're still creating the user/session,
      // keeping the pin prevents false "expired" responses.
      withPendingPinsLock(() => {
        loadPendingPinsFromDisk()
        _pendingPins.delete(pinId)
        persistPendingPinsToDisk()
      })
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
        JSON.stringify({ status: 'pending' }),
        { status: 200, headers: makeJson(req) }
      )
    }
  }

  // ── POST /api/auth/trakt/device ──────────────────────────────────────────
  // Login via Trakt, mirroring the Plex PIN flow's shape (mobile opens a browser to the
  // verification URL, then polls us) but using Trakt's own OAuth device code flow.
  if (pathname === '/api/auth/trakt/device' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }
    try {
      const device = await requestTraktDeviceCode()
      const expiresAt = Date.now() + device.expiresIn * 1000
      for (const [code, entry] of _pendingTraktDeviceLogins) {
        if (Date.now() > entry.expiresAt) _pendingTraktDeviceLogins.delete(code)
      }
      _pendingTraktDeviceLogins.set(device.deviceCode, { expiresAt })
      log.info(`[auth] Trakt device code created: userCode=${device.userCode}`)
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
      log.error(`[auth] Trakt device code request failed: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Could not contact Trakt. Please try again.' }),
        { status: 502, headers: makeJson(req) }
      )
    }
  }

  // ── GET /api/auth/trakt/device/:deviceCode ───────────────────────────────
  const traktDeviceMatch = pathname.match(/^\/api\/auth\/trakt\/device\/([^/]+)$/)
  if (traktDeviceMatch && req.method === 'GET') {
    const deviceCode = traktDeviceMatch[1]
    const pending = _pendingTraktDeviceLogins.get(deviceCode)
    if (!pending || Date.now() > pending.expiresAt) {
      _pendingTraktDeviceLogins.delete(deviceCode)
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
        _pendingTraktDeviceLogins.delete(deviceCode)
        return new Response(JSON.stringify({ status: result.status }), {
          status: 200,
          headers: makeJson(req),
        })
      }

      const traktUser = await getTraktUserSettings(result.tokens.accessToken)
      const user = upsertUser({
        provider: 'trakt',
        providerUserId: traktUser.id,
        username: traktUser.username,
        email: '',
        avatarUrl: traktUser.avatarUrl,
      })
      setUserTraktLoginTokens(user.id, result.tokens)

      const inviteCode = getOrCreateInviteCode(user.id)
      const roomCode = `U${String(user.id).padStart(3, '0')}`

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        hasServerAccess: true,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)
      _pendingTraktDeviceLogins.delete(deviceCode)
      log.info(`[auth] Trakt login: ${user.username} (id=${user.id})`)

      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            hasServerAccess: true,
            provider: 'trakt',
            roomCode,
            inviteCode,
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      log.error(`[auth] Trakt device poll error: ${err}`)
      return new Response(JSON.stringify({ status: 'pending' }), {
        status: 200,
        headers: makeJson(req),
      })
    }
  }

  // ── POST /api/auth/email/request ─────────────────────────────────────────
  // Send a 6-digit OTP to the supplied email address.
  if (pathname === '/api/auth/email/request' && req.method === 'POST') {
    if (getSetting('EMAIL_LOGIN_ENABLED') !== 'true') {
      return new Response(
        JSON.stringify({ error: 'Email login is not enabled on this server.' }),
        { status: 403, headers: makeJson(req) }
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
      const body = await req.json<{ email?: string }>()
      const email = String(body?.email || '').trim().toLowerCase()
      if (!email || !email.includes('@')) {
        return new Response(
          JSON.stringify({ error: 'A valid email address is required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      const otp = generateOtp()
      await storeOtp(email, otp)
      await sendOtpEmail(email, otp)
      log.info(`[auth] Email OTP requested for ${email}`)
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: makeJson(req) }
      )
    } catch (err) {
      log.warn(`[auth] Email OTP request failed: ${err}`)
      const message = err instanceof Error ? err.message : 'Could not send login email.'
      return new Response(
        JSON.stringify({ error: message }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── POST /api/auth/email/verify ───────────────────────────────────────────
  // Verify the OTP, create a user session, and set the session cookie.
  if (pathname === '/api/auth/email/verify' && req.method === 'POST') {
    if (getSetting('EMAIL_LOGIN_ENABLED') !== 'true') {
      return new Response(
        JSON.stringify({ error: 'Email login is not enabled on this server.' }),
        { status: 403, headers: makeJson(req) }
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
      const body = await req.json<{ email?: string; otp?: string }>()
      const email = String(body?.email || '').trim().toLowerCase()
      const otp = String(body?.otp || '').trim()

      if (!email || !otp) {
        return new Response(
          JSON.stringify({ error: 'Email and code are required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      loadOtpsFromDisk()
      const valid = await verifyAndConsumeOtp(email, otp)
      if (!valid) {
        log.warn(`[auth] Email OTP verify failed for ${email}`)
        return new Response(
          JSON.stringify({ error: 'Invalid or expired code. Please request a new one.' }),
          { status: 401, headers: makeJson(req) }
        )
      }

      // Derive a display name from the email local-part
      const localPart = email.split('@')[0]
      const displayName = localPart.charAt(0).toUpperCase() + localPart.slice(1)

      const user = upsertUser({
        provider: 'email',
        providerUserId: email,
        username: displayName,
        email,
        avatarUrl: '',
      })

      const inviteCode = getOrCreateInviteCode(user.id)
      const roomCode = `U${String(user.id).padStart(3, '0')}`

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        hasServerAccess: true,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)
      log.info(`[auth] Email login: ${email} (userId=${user.id})`)

      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            hasServerAccess: true,
            provider: 'email',
            roomCode,
            inviteCode,
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      log.error(`[auth] Email OTP verify error: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Login failed. Please try again.' }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── POST /api/auth/device ────────────────────────────────────────────────
  // Silent, no-signup account: the client generates a random device ID once
  // (stored in Keychain/SecureStore) and re-sends it here on every app launch.
  // First call creates the account; every later call from the same device just
  // re-establishes a session for it — same upsertUser(provider, providerUserId)
  // pattern Plex/email use, just with the device ID standing in for a real
  // third-party identity. This is what lets someone use the app with zero
  // account-creation friction (see AGENTS notes on Comparr's auth model).
  // The client collects a first name up front (see GuestWarningModal) rather than
  // us auto-generating a "Guest-xxxxxx" name — that read as impersonal in a room
  // member list.
  if (pathname === '/api/auth/device' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many attempts. Please wait.' }),
        { status: 429, headers: makeJson(req) }
      )
    }

    try {
      const body = await req.json<{ deviceId?: string; displayName?: string }>()
      const deviceId = String(body?.deviceId || '').trim()

      if (!deviceId || deviceId.length < 16 || deviceId.length > 128) {
        return new Response(
          JSON.stringify({ error: 'Invalid device ID.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      const displayName = sanitizeDisplayName(body?.displayName)
      if (!displayName) {
        return new Response(
          JSON.stringify({ error: 'A name is required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      const user = upsertUser({
        provider: 'device',
        providerUserId: deviceId,
        username: displayName,
        email: '',
        avatarUrl: '',
      })

      const inviteCode = getOrCreateInviteCode(user.id)
      const roomCode = `U${String(user.id).padStart(3, '0')}`

      const sessionToken = createUserSession({
        userId: user.id,
        provider: user.provider,
        providerUserId: user.providerUserId,
        username: user.username,
        avatarUrl: user.avatarUrl,
        isAdmin: user.isAdmin,
        hasServerAccess: true,
      })

      const headers = makeJson(req)
      setUserSessionCookie(headers, sessionToken, req)
      log.info(`[auth] Device login: ${displayName} (userId=${user.id})`)

      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: user.id,
            username: user.username,
            avatarUrl: user.avatarUrl,
            isAdmin: user.isAdmin,
            hasServerAccess: true,
            provider: 'device',
            roomCode,
            inviteCode,
          },
        }),
        { status: 200, headers }
      )
    } catch (err) {
      log.error(`[auth] Device login error: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Login failed. Please try again.' }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── PATCH /api/auth/profile ──────────────────────────────────────────────
  // Lets the current user (any provider) change their display name later, e.g.
  // from Settings — same name field guests fill in at sign-up time.
  if (pathname === '/api/auth/profile' && req.method === 'PATCH') {
    const token = parseCookies(req).get(USER_SESSION_COOKIE) || ''
    const session = token ? getUserSession(token) : null
    if (!session) {
      return new Response(
        JSON.stringify({ error: 'Not signed in.' }),
        { status: 401, headers: makeJson(req) }
      )
    }

    try {
      const body = await req.json<{ displayName?: string }>()
      const displayName = sanitizeDisplayName(body?.displayName)
      if (!displayName) {
        return new Response(
          JSON.stringify({ error: 'A name is required.' }),
          { status: 400, headers: makeJson(req) }
        )
      }

      updateUsername(session.userId, displayName)
      updateSessionUsername(token, displayName)
      log.info(`[auth] Profile updated: userId=${session.userId} -> ${displayName}`)

      const roomCode = `U${String(session.userId).padStart(3, '0')}`
      return new Response(
        JSON.stringify({
          status: 'success',
          user: {
            id: session.userId,
            username: displayName,
            avatarUrl: session.avatarUrl,
            isAdmin: session.isAdmin,
            hasServerAccess: session.hasServerAccess,
            provider: session.provider,
            roomCode,
          },
        }),
        { status: 200, headers: makeJson(req) }
      )
    } catch (err) {
      log.error(`[auth] Profile update error: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Could not update profile. Please try again.' }),
        { status: 500, headers: makeJson(req) }
      )
    }
  }

  // ── GET /api/auth/avatar ─────────────────────────────────────────────────
  // Proxy avatar images from allowed origins to avoid CSP violations.
  if (pathname === '/api/auth/avatar' && req.method === 'GET') {
    let rawUrl = ''
    try {
      // CompatRequest.url is path-only (e.g. /api/auth/avatar?...), so we
      // parse from rawRequest.url first and fall back to a localhost base.
      rawUrl = new URL(req.rawRequest.url).searchParams.get('url') || ''
    } catch {
      try {
        rawUrl = new URL(req.url, 'http://localhost').searchParams.get('url') || ''
      } catch {
        rawUrl = ''
      }
    }
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
