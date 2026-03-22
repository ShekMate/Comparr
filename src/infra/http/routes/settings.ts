import type { CompatRequest } from '../compat-request.ts'
import { SettingsValidationError } from '../../../core/settings.ts'
import * as log from 'jsr:@std/log'
import { timingSafeEqual } from '../../../core/security.ts'
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

const parseAdminPassword = (req: CompatRequest) => {
  const header = req.headers?.get?.('x-admin-password')
  if (typeof header === 'string') return header.trim()
  return ''
}

const hasAdminPasswordConfigured = (settings: Record<string, unknown>) =>
  Boolean(String(settings.ADMIN_PASSWORD ?? '').trim())

const isRemoteBootstrapEnabled = () =>
  String(Deno.env.get('ALLOW_REMOTE_BOOTSTRAP') ?? '')
    .trim()
    .toLowerCase() === 'true'

const isBootstrappingAdminPassword = (
  settings: Record<string, unknown>,
  incomingSettings: Record<string, unknown>
) => {
  if (hasAdminPasswordConfigured(settings)) return false
  if (String(settings.ACCESS_PASSWORD ?? '').trim()) return false
  if (!isLocalRequest(req) && !isRemoteBootstrapEnabled()) return false

  const keys = Object.keys(incomingSettings)
  if (keys.length === 0) return false
  if (!keys.every(key => key === 'ADMIN_PASSWORD' || key === 'ACCESS_PASSWORD'))
    return false

  const candidate = String(incomingSettings.ADMIN_PASSWORD ?? '').trim()
  return candidate.length > 0
}

// While SETUP_WIZARD_COMPLETED is false the server operates in setup mode.
// All admin-gated actions are permitted so the wizard can configure everything
// (including the admin password itself) without a chicken-and-egg auth problem.
const isSetupWizardActive = (settings: Record<string, unknown>) =>
  String(settings.SETUP_WIZARD_COMPLETED ?? '').toLowerCase() !== 'true'

const isAdminAuthorized = (
  req: CompatRequest,
  settings: Record<string, unknown>,
  isLocalRequest: (req: CompatRequest) => boolean
) => {
  const configuredPassword = String(settings.ADMIN_PASSWORD ?? '').trim()
  if (!configuredPassword) {
    return isLocalRequest(req)
  }

  return timingSafeEqual(parseAdminPassword(req), configuredPassword)
}

const getAdminAuthFailureMessage = (
  req: CompatRequest,
  settings: Record<string, unknown>,
  isLocalRequest: (req: CompatRequest) => boolean
) => {
  if (hasAdminPasswordConfigured(settings)) {
    return 'Admin password required. Enter the configured admin password and retry.'
  }

  return isLocalRequest(req)
    ? 'Admin access is unavailable. Please retry.'
    : 'Admin access is limited to local/private-network requests when ADMIN_PASSWORD is not configured. If you are behind a reverse proxy, forward client IP headers (X-Forwarded-For or X-Real-IP), or set ADMIN_PASSWORD.'
}

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
  'ADMIN_PASSWORD',
])

const sanitizeSettingsForClient = (
  settings: Record<string, unknown>,
  isAdmin: boolean
) => {
  const sanitized = { ...settings, ADMIN_PASSWORD: '' }

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
  } = deps

  if (pathname === '/api/settings-access') {
    const settings = getSettings()
    const hasAdminPassword = hasAdminPasswordConfigured(settings)
    const canAccess = true

    return new Response(
      JSON.stringify({
        canAccess,
        requiresAdminPassword: hasAdminPassword,
      }),
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
      const cookiePassword =
        parseCookies(req).get(ACCESS_PASSWORD_COOKIE_NAME) || ''
      const candidatePassword = providedPassword || cookiePassword

      const isValid =
        !configuredPassword ||
        timingSafeEqual(candidatePassword, configuredPassword)

      const headers = makeJsonHeaders(req)
      const secureFlag = shouldUseSecureCookies(req) ? '; Secure' : ''
      if (isValid && configuredPassword) {
        headers.set(
          'set-cookie',
          `${ACCESS_PASSWORD_COOKIE_NAME}=${encodeURIComponent(
            configuredPassword
          )}; Path=/; SameSite=Strict; HttpOnly${secureFlag}`
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
        adminPasswordSet: Boolean(
          String(settings.ADMIN_PASSWORD ?? '').trim()
        ),
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
    // During initial setup the wizard must be able to test connections before
    // (or while) configuring the admin password — skip auth for both guards.
    if (!isSetupWizardActive(settings)) {
      if (!hasAdminPasswordConfigured(settings)) {
        return new Response(
          JSON.stringify({
            ok: false,
            message:
              'Admin password is not configured. Set ADMIN_PASSWORD before running connection tests.',
          }),
          { status: 403, headers: makeJsonHeaders(req) }
        )
      }

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
    } catch (err) {
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
    const isAdmin = isAdminAuthorized(req, settings, isLocalRequest)

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
    const isAdmin =
      isSetupWizardActive(currentSettings) ||
      isAdminAuthorized(req, currentSettings, isLocalRequest)

    try {
      const body = await req.text()
      const { settings } = JSON.parse(body)
      const incomingSettings =
        ((settings ?? {}) as Record<string, unknown>) || {}

      const isAdminPasswordBootstrap = isBootstrappingAdminPassword(
        currentSettings,
        incomingSettings
      )

      if (!isAdmin && !isAdminPasswordBootstrap) {
        const attemptedAdminOnlySettings = Object.keys(
          incomingSettings
        ).filter(key => ADMIN_ONLY_SETTINGS.has(key))

        if (
          attemptedAdminOnlySettings.length > 0 &&
          attemptedAdminOnlySettings.length ===
            Object.keys(incomingSettings).length
        ) {
          return new Response(
            JSON.stringify({
              error: getAdminAuthFailureMessage(
                req,
                currentSettings,
                isLocalRequest
              ),
            }),
            { status: 403, headers: makeJsonHeaders(req) }
          )
        }

        for (const key of attemptedAdminOnlySettings) {
          delete incomingSettings[key]
        }
      }
      if (
        isAdmin &&
        Object.prototype.hasOwnProperty.call(
          incomingSettings,
          'ADMIN_PASSWORD'
        ) &&
        String(incomingSettings.ADMIN_PASSWORD ?? '').trim() === ''
      ) {
        incomingSettings.ADMIN_PASSWORD = String(
          currentSettings.ADMIN_PASSWORD ?? ''
        )
      }

      const hasUpdates = Object.keys(incomingSettings).length > 0
      const updated = hasUpdates
        ? await updateSettings(incomingSettings)
        : currentSettings

      if (hasUpdates) {
        clearAllMoviesCache()
        await refreshRadarrCache().catch(err =>
          log.error(
            `Failed to refresh Radarr cache after settings update: ${err}`
          )
        )
        await buildPlexCache().catch(err =>
          log.error(
            `Failed to refresh Plex cache after settings update: ${err}`
          )
        )
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
    if (
      !isSetupWizardActive(settings) &&
      !isAdminAuthorized(req, settings, isLocalRequest)
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
        JSON.stringify({ success: false, message: 'Failed to reset settings.' }),
        { status: 500, headers: makeJsonHeaders(req) }
      )
    }
  }

  if (pathname === '/api/admin/user-history' && req.method === 'GET') {
    const settings = getSettings()
    if (
      !isSetupWizardActive(settings) &&
      !isAdminAuthorized(req, settings, isLocalRequest)
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
    if (
      !isSetupWizardActive(settings) &&
      !isAdminAuthorized(req, settings, isLocalRequest)
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
