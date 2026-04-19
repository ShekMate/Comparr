import type { CompatRequest } from '../compat-request.ts'
import { SettingsValidationError } from '../../../core/settings.ts'
import * as log from 'jsr:@std/log'
import { verifyPassword } from '../../../core/security.ts'
import {
  createAccessSession,
  invalidateAccessSession,
  validateAccessSession,
} from '../../../core/access-session-store.ts'
import { getUserSession } from '../../../core/user-session-store.ts'
import { getUserTokenFromCookie } from './auth.ts'
import { apiRateLimiter, loginRateLimiter } from '../ip-rate-limiter.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { isValidStateChangingOrigin } from '../network-access.ts'
import { tmdbFetch } from '../../../api/tmdb.ts'
import { fetchWithTimeout } from '../fetch-with-timeout.ts'

export type SettingsRouteDeps = {
  buildPlexCache: () => Promise<void>
  clearAllMoviesCache: () => void
  getPlexLibraryName: () => string
  getEmbyLibraryName: () => string
  getJellyfinLibraryName: () => string
  getSettings: () => Record<string, unknown>
  isLocalRequest: (req: CompatRequest) => boolean
  refreshRadarrCache: () => Promise<void>
  updateSettings: (
    settings: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
  resetSettings: () => Promise<Record<string, unknown>>
  getAllRooms: () => Record<string, { users: Record<string, unknown> }>
  clearAllRooms: () => void
  clearRooms: (roomCodes: string[]) => void
  clearUsersFromRoom: (roomCode: string, userNames: string[]) => void
  onWizardComplete: () => Promise<void> | void
}

const getClientIp = (req: CompatRequest) => {
  const hostname = req?.conn?.remoteAddr?.hostname
  return String(hostname || 'unknown')
}

const makeJsonHeaders = (req?: CompatRequest) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers, req)
  return headers
}

const ACCESS_PASSWORD_COOKIE_NAME = 'comparr_access'

const parseCookies = (req: CompatRequest) => {
  const rawCookieHeader = String(req?.headers?.get?.('cookie') || '')
  const cookies = new Map<string, string>()
  for (const cookiePair of rawCookieHeader.split(';')) {
    const [rawKey, ...rest] = cookiePair.split('=')
    const key = String(rawKey || '').trim()
    if (!key) continue
    cookies.set(key, decodeURIComponent(rest.join('=').trim()))
  }
  return cookies
}

const shouldUseSecureCookies = (req: CompatRequest) => {
  const xfProto = String(req?.headers?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
  if (xfProto) return xfProto === 'https'
  return String(req?.url || '')
    .toLowerCase()
    .startsWith('https://')
}

const isValidHttpUrl = (value: string) => {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

// Block loopback and link-local ranges from the connection tester.
// Private LAN ranges (192.168.x.x, 10.x.x.x, 172.16-31.x.x) are intentionally
// allowed — Plex, Radarr etc. legitimately live there.
// We only block ranges that have no legitimate target:
//   127.0.0.0/8  — loopback
//   169.254.0.0/16 — link-local / cloud IMDS (AWS, GCP, Azure metadata)
//   ::1           — IPv6 loopback
//   fe80::/10     — IPv6 link-local
const isSsrfBlockedHostname = (hostname: string): boolean => {
  const h = hostname.trim().toLowerCase()
  if (h === 'localhost' || h === '0.0.0.0') return true
  // IPv6 loopback / link-local
  if (h === '::1' || h === '[::1]') return true
  if (h.startsWith('fe80:') || h.startsWith('[fe80:')) return true
  // IPv4 loopback
  if (/^127\./.test(h)) return true
  // Cloud IMDS link-local (AWS/GCP/Azure/OCI all use 169.254.169.254)
  if (/^169\.254\./.test(h)) return true
  return false
}

const normalizePlexToken = (token: string) =>
  String(token || '')
    .trim()
    .replace(/^X-Plex-Token=/i, '')

const normalizePlexUrl = (value: string) => {
  const trimmed = String(value || '')
    .trim()
    .replace(/\/$/, '')
  if (!trimmed) return ''

  try {
    const parsed = new URL(trimmed)
    const normalizedPath = parsed.pathname
      .replace(/\/$/, '')
      .replace(/\/web$/i, '')
      .replace(/\/web\/index\.html$/i, '')

    return `${parsed.origin}${normalizedPath}`.replace(/\/$/, '')
  } catch {
    return trimmed
      .replace(/\/web\/index\.html$/i, '')
      .replace(/\/web$/i, '')
      .replace(/\/$/, '')
  }
}

const runConnectionCheck = async (
  target: string,
  url: string,
  token: string
): Promise<{ ok: boolean; message: string }> => {
  const normalizedTarget = String(target || '')
    .trim()
    .toLowerCase()
  const normalizedUrl = String(url || '')
    .trim()
    .replace(/\/$/, '')
  const serviceUrl =
    normalizedTarget === 'plex'
      ? normalizePlexUrl(normalizedUrl)
      : normalizedUrl
  const normalizedToken =
    normalizedTarget === 'plex'
      ? normalizePlexToken(token)
      : String(token || '').trim()

  if (normalizedTarget !== 'tmdb' && !isValidHttpUrl(serviceUrl)) {
    return { ok: false, message: 'Invalid URL.' }
  }

  if (normalizedTarget !== 'tmdb') {
    try {
      const { hostname } = new URL(serviceUrl)
      if (isSsrfBlockedHostname(hostname)) {
        return { ok: false, message: 'URL targets a blocked address.' }
      }
    } catch {
      return { ok: false, message: 'Invalid URL.' }
    }
  }

  if (!normalizedToken) {
    return { ok: false, message: 'API key/token is required.' }
  }

  let endpoint = serviceUrl
  let headers: HeadersInit = {}

  if (normalizedTarget === 'plex') {
    endpoint = `${serviceUrl}/library/sections`
    headers = { 'X-Plex-Token': normalizedToken }
  } else if (normalizedTarget === 'radarr') {
    endpoint = `${serviceUrl}/api/v3/system/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (normalizedTarget === 'emby') {
    endpoint = `${serviceUrl}/System/Info`
    headers = { 'X-Emby-Token': normalizedToken }
  } else if (normalizedTarget === 'jellyfin') {
    endpoint = `${serviceUrl}/System/Info`
    headers = { 'X-Emby-Token': normalizedToken }
  } else if (normalizedTarget === 'seerr') {
    endpoint = `${serviceUrl}/api/v1/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (normalizedTarget === 'tmdb') {
    endpoint = 'https://api.themoviedb.org/3/configuration'
  } else {
    return { ok: false, message: 'Unknown service target.' }
  }

  try {
    const response =
      normalizedTarget === 'tmdb'
        ? await tmdbFetch('/configuration', normalizedToken)
        : await fetchWithTimeout(endpoint, {
            method: 'GET',
            headers,
          })

    if (!response.ok) {
      return {
        ok: false,
        message: `Connection failed with status ${response.status}.`,
      }
    }

    return { ok: true, message: 'Connection successful.' }
  } catch (err) {
    return {
      ok: false,
      message: `Connection failed: ${err?.message || err}`,
    }
  }
}

const isRemoteBootstrapEnabled = () =>
  String(Deno.env.get('ALLOW_REMOTE_BOOTSTRAP') ?? '')
    .trim()
    .toLowerCase() === 'true'

// While SETUP_WIZARD_COMPLETED is false the server operates in setup mode.
// All admin-gated actions are permitted so the wizard can configure the
// access password without a chicken-and-egg auth problem.
const isSetupWizardActive = (settings: Record<string, unknown>) =>
  String(settings.SETUP_WIZARD_COMPLETED ?? '').toLowerCase() !== 'true'

// Admin access: valid Plex session with is_admin=1, or local network request as fallback.
const isAdminAuthorized = (
  req: CompatRequest,
  _settings: Record<string, unknown>,
  isLocalRequest: (req: CompatRequest) => boolean
) => {
  const token = getUserTokenFromCookie(req)
  if (token) {
    const session = getUserSession(token)
    if (session?.isAdmin) {
      log.debug(`[admin-auth] Authorized via Plex session (user=${session.username})`)
      return true
    }
  }
  const local = isLocalRequest(req)
  log.debug(`[admin-auth] No admin session — falling back to isLocal=${local}`)
  return local
}

const getAdminAuthFailureMessage = (
  _req: CompatRequest,
  _settings: Record<string, unknown>,
  _isLocalRequest: (req: CompatRequest) => boolean
) => 'Admin access requires signing in with an admin Plex account.'

const getSetupModeFailureMessage = () =>
  'Setup mode changes are limited to local/private-network requests. Complete setup locally, or set ALLOW_REMOTE_BOOTSTRAP=true for remote initial setup.'

const ADMIN_ONLY_SETTINGS = new Set([
  'PORT',
  'ROOT_PATH',
  'LOG_LEVEL',
  'PLEX_URL',
  'PLEX_TOKEN',
  'PLEX_LIBRARY_NAME',
  'EMBY_URL',
  'EMBY_API_KEY',
  'EMBY_LIBRARY_NAME',
  'JELLYFIN_URL',
  'JELLYFIN_API_KEY',
  'JELLYFIN_LIBRARY_NAME',
  'LIBRARY_FILTER',
  'COLLECTION_FILTER',
  'STREAMING_PROFILE_MODE',
  'LINK_TYPE',
  'PERSONAL_MEDIA_SOURCES',
  'TMDB_API_KEY',
  'MOVIE_BATCH_SIZE',
  'RADARR_URL',
  'RADARR_API_KEY',
  'SEERR_URL',
  'SEERR_API_KEY',
  'ACCESS_PASSWORD',
  // Wizard completion state is admin-only: a regular user must not be able to
  // reopen setup mode by setting this back to 'false'.
  'SETUP_WIZARD_COMPLETED',
  'PLEX_RESTRICT_TO_SERVER',
  // PLEX_CLIENT_ID is managed automatically; prevent user modification
  'PLEX_CLIENT_ID',
])

const sanitizeSettingsForClient = (
  settings: Record<string, unknown>,
  isAdmin: boolean
) => {
  const sanitized = { ...settings, ACCESS_PASSWORD: '' }

  if (!isAdmin) {
    for (const key of ADMIN_ONLY_SETTINGS) {
      sanitized[key] = ''
    }
  }

  return sanitized
}

export async function handleSettingsRoutes(
  req: CompatRequest,
  pathname: string,
  deps: SettingsRouteDeps
): Promise<Response | null> {
  const {
    buildPlexCache,
    clearAllMoviesCache,
    getPlexLibraryName,
    getEmbyLibraryName,
    getJellyfinLibraryName,
    getSettings,
    isLocalRequest,
    refreshRadarrCache,
    updateSettings,
    resetSettings,
    getAllRooms,
    clearAllRooms,
    clearRooms,
    clearUsersFromRoom,
    onWizardComplete,
  } = deps

  if (pathname === '/api/settings-access') {
    return new Response(
      JSON.stringify({ canAccess: true, requiresAdminPassword: false }),
      { status: 200, headers: makeJsonHeaders(req) }
    )
  }

  if (pathname === '/api/access-password/verify' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Too many attempts. Please wait and retry.',
        }),
        { status: 429, headers: makeJsonHeaders(req) }
      )
    }

    try {
      const bodyText = await req.text()
      const body = bodyText ? JSON.parse(bodyText) : {}
      const providedPassword = String(body?.accessPassword ?? '').trim()
      const settings = getSettings()
      const configuredPassword = String(settings.ACCESS_PASSWORD ?? '').trim()
      const cookieToken =
        parseCookies(req).get(ACCESS_PASSWORD_COOKIE_NAME) || ''
      const hasValidAccessSession =
        !providedPassword && validateAccessSession(cookieToken)
      const isValid =
        !configuredPassword ||
        hasValidAccessSession ||
        (providedPassword
          ? await verifyPassword(providedPassword, configuredPassword)
          : false)

      const headers = makeJsonHeaders(req)
      const secureFlag = shouldUseSecureCookies(req) ? '; Secure' : ''
      if (isValid && configuredPassword) {
        // Issue a random session token so the raw password never lives in a
        // cookie. validateAccessSession() checks this token on subsequent requests.
        const sessionToken = createAccessSession()
        headers.set(
          'set-cookie',
          `${ACCESS_PASSWORD_COOKIE_NAME}=${sessionToken}; Path=/; SameSite=Strict; HttpOnly${secureFlag}`
        )
      } else if (!isValid) {
        headers.set(
          'set-cookie',
          `${ACCESS_PASSWORD_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly${secureFlag}`
        )
      }

      return new Response(
        JSON.stringify({
          success: isValid,
          message: isValid
            ? 'Access password verified.'
            : 'Incorrect access password. Please try again.',
        }),
        { status: isValid ? 200 : 401, headers }
      )
    } catch (err) {
      log.error(`Failed to verify access password: ${err}`)
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Could not verify access password. Please try again.',
        }),
        { status: 400, headers: makeJsonHeaders(req) }
      )
    }
  }

  if (pathname === '/api/access-password/logout' && req.method === 'POST') {
    const cookieToken = parseCookies(req).get(ACCESS_PASSWORD_COOKIE_NAME) || ''
    if (cookieToken) {
      invalidateAccessSession(cookieToken)
    }
    const headers = makeJsonHeaders(req)
    const secureFlag = shouldUseSecureCookies(req) ? '; Secure' : ''
    headers.append(
      'set-cookie',
      `${ACCESS_PASSWORD_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly${secureFlag}`
    )
    // Also clear the per-user auth session cookie so the user identity is
    // wiped whenever the access-password gate is re-engaged.
    headers.append(
      'set-cookie',
      `comparr_user=; Path=/; Max-Age=0; SameSite=Strict; HttpOnly${secureFlag}`
    )
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers,
    })
  }

  if (pathname === '/api/access-password/status' && req.method === 'GET') {
    return new Response(
      JSON.stringify({
        message: 'Not Found',
      }),
      { status: 404, headers: makeJsonHeaders(req) }
    )
  }

  if (pathname === '/api/client-config') {
    const settings = getSettings()
    const plexConfigured =
      Boolean(String(settings.PLEX_URL || '').trim()) &&
      Boolean(String(settings.PLEX_TOKEN || '').trim())
    const embyConfigured =
      Boolean(String(settings.EMBY_URL || '').trim()) &&
      Boolean(String(settings.EMBY_API_KEY || '').trim())
    const jellyfinConfigured =
      Boolean(String(settings.JELLYFIN_URL || '').trim()) &&
      Boolean(String(settings.JELLYFIN_API_KEY || '').trim())
    const tmdbConfigured = Boolean(String(settings.TMDB_API_KEY || '').trim())
    return new Response(
      JSON.stringify({
        plexLibraryName: getPlexLibraryName(),
        embyLibraryName: getEmbyLibraryName(),
        jellyfinLibraryName: getJellyfinLibraryName(),
        plexConfigured,
        embyConfigured,
        jellyfinConfigured,
        tmdbConfigured,
        paidStreamingServices: settings.PAID_STREAMING_SERVICES,
        personalMediaSources: settings.PERSONAL_MEDIA_SOURCES,
        setupWizardCompleted:
          String(settings.SETUP_WIZARD_COMPLETED || '').toLowerCase() ===
          'true',
        accessPasswordSet: Boolean(
          String(settings.ACCESS_PASSWORD ?? '').trim()
        ),
        plexRestrictToServer:
          String(settings.PLEX_RESTRICT_TO_SERVER || '').toLowerCase() ===
          'true',
      }),
      { status: 200, headers: makeJsonHeaders(req) }
    )
  }

  if (pathname === '/api/settings-test' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!apiRateLimiter.check(ip)) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: 'Too many requests. Please wait.',
        }),
        { status: 429, headers: makeJsonHeaders(req) }
      )
    }

    if (!isValidStateChangingOrigin(req)) {
      return new Response(
        JSON.stringify({ ok: false, message: 'Invalid request origin.' }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }

    const settings = getSettings()
    if (!isSetupWizardActive(settings)) {
      if (!isAdminAuthorized(req, settings, isLocalRequest)) {
        return new Response(
          JSON.stringify({
            ok: false,
            message: getAdminAuthFailureMessage(req, settings, isLocalRequest),
          }),
          { status: 403, headers: makeJsonHeaders(req) }
        )
      }
    }

    try {
      const body = await req.text()
      const payload = JSON.parse(body) as {
        target?: string
        url?: string
        token?: string
      }

      const result = await runConnectionCheck(
        payload?.target || '',
        payload?.url || '',
        payload?.token || ''
      )

      return new Response(JSON.stringify(result), {
        status: result.ok ? 200 : 400,
        headers: makeJsonHeaders(req),
      })
    } catch (_err) {
      return new Response(
        JSON.stringify({
          ok: false,
          message: 'An internal error occurred.',
        }),
        { status: 500, headers: makeJsonHeaders(req) }
      )
    }
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const settings = getSettings()
    const isAdmin = await isAdminAuthorized(req, settings, isLocalRequest)

    return new Response(
      JSON.stringify({
        settings: sanitizeSettingsForClient(settings, isAdmin),
        isAdmin,
      }),
      { status: 200, headers: makeJsonHeaders(req) }
    )
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!isValidStateChangingOrigin(req)) {
      return new Response(
        JSON.stringify({ error: 'Invalid request origin.' }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }

    const currentSettings = getSettings()
    const setupWizardActive = isSetupWizardActive(currentSettings)
    const isAdmin =
      setupWizardActive ||
      (await isAdminAuthorized(req, currentSettings, isLocalRequest))

    try {
      const body = await req.text()
      const { settings } = JSON.parse(body)
      const incomingSettings =
        ((settings ?? {}) as Record<string, unknown>) || {}

      if (!isAdmin) {
        const attemptedAdminOnlySettings = Object.keys(
          incomingSettings
        ).filter(key => ADMIN_ONLY_SETTINGS.has(key))

        if (
          attemptedAdminOnlySettings.length > 0 &&
          attemptedAdminOnlySettings.length ===
            Object.keys(incomingSettings).length
        ) {
          const message = setupWizardActive
            ? getSetupModeFailureMessage()
            : getAdminAuthFailureMessage(req, currentSettings, isLocalRequest)
          return new Response(
            JSON.stringify({
              error: message,
            }),
            { status: 403, headers: makeJsonHeaders(req) }
          )
        }

        for (const key of attemptedAdminOnlySettings) {
          delete incomingSettings[key]
        }
      }
      // ACCESS_PASSWORD preservation: a blank submission means
      // "keep existing" — the client never receives the hash, so an empty field
      // simply means the user didn't type a new password.
      if (
        Object.prototype.hasOwnProperty.call(
          incomingSettings,
          'ACCESS_PASSWORD'
        ) &&
        String(incomingSettings.ACCESS_PASSWORD ?? '').trim() === ''
      ) {
        incomingSettings.ACCESS_PASSWORD = String(
          currentSettings.ACCESS_PASSWORD ?? ''
        )
      }

      const hasUpdates = Object.keys(incomingSettings).length > 0
      const setupWasCompleted =
        String(currentSettings.SETUP_WIZARD_COMPLETED ?? '').toLowerCase() ===
        'true'
      const updated = hasUpdates
        ? await updateSettings(incomingSettings)
        : currentSettings
      const setupIsCompleted =
        String(updated.SETUP_WIZARD_COMPLETED ?? '').toLowerCase() === 'true'

      if (hasUpdates) {
        clearAllMoviesCache()
        // Rebuild caches in background — do NOT await so the HTTP response
        // is not held open waiting for Plex/Radarr network calls (each has a
        // 10-second fetch timeout, and a reverse proxy may time out and return
        // 502 before the response is sent if both are awaited sequentially).
        refreshRadarrCache().catch(err =>
          log.error(
            `Failed to refresh Radarr cache after settings update: ${err}`
          )
        )
        buildPlexCache().catch(err =>
          log.error(
            `Failed to refresh Plex cache after settings update: ${err}`
          )
        )
      }

      if (!setupWasCompleted && setupIsCompleted) {
        try {
          await Promise.resolve(onWizardComplete())
        } catch (err) {
          log.error(
            `Failed to run setup completion follow-up job: ${
              err?.message || err
            }`
          )
        }
      }

      return new Response(
        JSON.stringify({
          settings: sanitizeSettingsForClient(updated, isAdmin),
        }),
        { status: 200, headers: makeJsonHeaders(req) }
      )
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        return new Response(
          JSON.stringify({
            error: 'Invalid settings payload',
            details: err.details,
          }),
          { status: 400, headers: makeJsonHeaders(req) }
        )
      }

      log.error(`Settings update failed: ${err}`)
      return new Response(
        JSON.stringify({ error: 'Failed to update settings' }),
        { status: 500, headers: makeJsonHeaders(req) }
      )
    }
  }

  if (pathname === '/api/admin/reset-settings' && req.method === 'POST') {
    if (!isValidStateChangingOrigin(req)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid request origin.' }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    const settings = getSettings()
    if (isSetupWizardActive(settings) && !isLocalRequest(req)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getSetupModeFailureMessage(),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    if (
      !isSetupWizardActive(settings) &&
      !(await isAdminAuthorized(req, settings, isLocalRequest))
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getAdminAuthFailureMessage(req, settings, isLocalRequest),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    try {
      await resetSettings()
      clearAllMoviesCache()
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: makeJsonHeaders(req),
      })
    } catch (err) {
      log.error(`Reset settings failed: ${err}`)
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to reset settings.',
        }),
        { status: 500, headers: makeJsonHeaders(req) }
      )
    }
  }

  if (pathname === '/api/admin/user-history' && req.method === 'GET') {
    const settings = getSettings()
    if (isSetupWizardActive(settings) && !isLocalRequest(req)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getSetupModeFailureMessage(),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    if (
      !isSetupWizardActive(settings) &&
      !(await isAdminAuthorized(req, settings, isLocalRequest))
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getAdminAuthFailureMessage(req, settings, isLocalRequest),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    const rooms = getAllRooms()
    const summary = Object.entries(rooms).map(([roomCode, room]) => ({
      roomCode,
      users: Object.keys(room.users),
    }))
    return new Response(JSON.stringify({ success: true, rooms: summary }), {
      status: 200,
      headers: makeJsonHeaders(req),
    })
  }

  if (pathname === '/api/admin/clear-user-history' && req.method === 'POST') {
    if (!isValidStateChangingOrigin(req)) {
      return new Response(
        JSON.stringify({ success: false, message: 'Invalid request origin.' }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    const settings = getSettings()
    if (isSetupWizardActive(settings) && !isLocalRequest(req)) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getSetupModeFailureMessage(),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    if (
      !isSetupWizardActive(settings) &&
      !(await isAdminAuthorized(req, settings, isLocalRequest))
    ) {
      return new Response(
        JSON.stringify({
          success: false,
          message: getAdminAuthFailureMessage(req, settings, isLocalRequest),
        }),
        { status: 403, headers: makeJsonHeaders(req) }
      )
    }
    try {
      const bodyText = await req.text()
      const body = bodyText ? JSON.parse(bodyText) : {}
      // body.clearAll = true → wipe everything
      // body.rooms = [{ roomCode, users?: string[] }] → partial clear
      if (body.clearAll === true) {
        clearAllRooms()
      } else if (Array.isArray(body.rooms)) {
        for (const entry of body.rooms as Array<{
          roomCode: string
          users?: string[]
        }>) {
          const code = String(entry.roomCode || '').trim()
          if (!code) continue
          if (!entry.users || entry.users.length === 0) {
            clearRooms([code])
          } else {
            clearUsersFromRoom(code, entry.users)
          }
        }
      }
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: makeJsonHeaders(req),
      })
    } catch (err) {
      log.error(`Clear user history failed: ${err}`)
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Failed to clear user history.',
        }),
        { status: 500, headers: makeJsonHeaders(req) }
      )
    }
  }

  return null
}
