import { SettingsValidationError } from '../../../core/settings.ts'
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { timingSafeEqual } from '../../../core/security.ts'
import { apiRateLimiter, loginRateLimiter } from '../ip-rate-limiter.ts'
import { addSecurityHeaders } from '../security-headers.ts'
import { isValidOrigin } from '../network-access.ts'

export type SettingsRouteDeps = {
  buildPlexCache: () => Promise<void>
  clearAllMoviesCache: () => void
  getPlexLibraryName: () => string
  getSettings: () => Record<string, unknown>
  isLocalRequest: (req: any) => boolean
  refreshRadarrCache: () => Promise<void>
  updateSettings: (
    settings: Record<string, unknown>
  ) => Promise<Record<string, unknown>>
}


const getClientIp = (req: any) => {
  const hostname = req?.conn?.remoteAddr?.hostname
  return String(hostname || 'unknown')
}

const makeJsonHeaders = () => {
  const headers = new Headers({ 'content-type': 'application/json' })
  addSecurityHeaders(headers)
  return headers
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

  if (
    normalizedTarget !== 'tmdb' &&
    normalizedTarget !== 'omdb' &&
    !isValidHttpUrl(serviceUrl)
  ) {
    return { ok: false, message: 'Invalid URL.' }
  }

  if (!normalizedToken) {
    return { ok: false, message: 'API key/token is required.' }
  }

  let endpoint = serviceUrl
  let headers: HeadersInit = {}

  if (normalizedTarget === 'plex') {
    endpoint = `${serviceUrl}/library/sections?X-Plex-Token=${encodeURIComponent(
      normalizedToken
    )}`
  } else if (normalizedTarget === 'radarr') {
    endpoint = `${serviceUrl}/api/v3/system/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (
    normalizedTarget === 'jellyseerr' ||
    normalizedTarget === 'overseerr'
  ) {
    endpoint = `${serviceUrl}/api/v1/status`
    headers = { 'X-Api-Key': normalizedToken }
  } else if (normalizedTarget === 'tmdb') {
    endpoint = `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(
      normalizedToken
    )}`
  } else if (normalizedTarget === 'omdb') {
    endpoint = `https://www.omdbapi.com/?apikey=${encodeURIComponent(
      normalizedToken
    )}&i=tt0133093`
  } else {
    return { ok: false, message: 'Unknown service target.' }
  }

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers,
    })

    if (!response.ok) {
      return {
        ok: false,
        message: `Connection failed with status ${response.status}.`,
      }
    }

    if (normalizedTarget === 'omdb') {
      const payload = await response.json().catch(() => ({}))
      if (payload?.Response === 'False') {
        return {
          ok: false,
          message: payload?.Error || 'OMDb API key validation failed.',
        }
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

const parseAdminPassword = (req: any) => {
  const header = req.headers?.get?.('x-admin-password')
  if (typeof header === 'string') return header.trim()
  return ''
}

const hasAdminPasswordConfigured = (settings: Record<string, unknown>) =>
  Boolean(String(settings.ADMIN_PASSWORD ?? '').trim())

const isAdminAuthorized = (
  req: any,
  settings: Record<string, unknown>,
  isLocalRequest: (req: any) => boolean
) => {
  const configuredPassword = String(settings.ADMIN_PASSWORD ?? '').trim()
  if (!configuredPassword) {
    return isLocalRequest(req)
  }

  return timingSafeEqual(parseAdminPassword(req), configuredPassword)
}

const getAdminAuthFailureMessage = (
  req: any,
  settings: Record<string, unknown>,
  isLocalRequest: (req: any) => boolean
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
  'LIBRARY_FILTER',
  'COLLECTION_FILTER',
  'STREAMING_PROFILE_MODE',
  'LINK_TYPE',
  'PERSONAL_MEDIA_SOURCES',
  'TMDB_API_KEY',
  'OMDB_API_KEY',
  'MOVIE_BATCH_SIZE',
  'RADARR_URL',
  'RADARR_API_KEY',
  'JELLYSEERR_URL',
  'JELLYSEERR_API_KEY',
  'OVERSEERR_URL',
  'OVERSEERR_API_KEY',
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
  req: any,
  pathname: string,
  deps: SettingsRouteDeps
): Promise<boolean> {
  const {
    buildPlexCache,
    clearAllMoviesCache,
    getPlexLibraryName,
    getSettings,
    isLocalRequest,
    refreshRadarrCache,
    updateSettings,
  } = deps

  if (pathname === '/api/settings-access') {
    const settings = getSettings()
    const hasAdminPassword = hasAdminPasswordConfigured(settings)
    const canAccess = true

    await req.respond({
      status: 200,
      body: JSON.stringify({
        canAccess,
        requiresAdminPassword: hasAdminPassword,
      }),
      headers: makeJsonHeaders(),
    })
    return true
  }

  if (pathname === '/api/access-password/verify' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!loginRateLimiter.check(ip)) {
      await req.respond({
        status: 429,
        body: JSON.stringify({
          success: false,
          message: 'Too many attempts. Please wait and retry.',
        }),
        headers: makeJsonHeaders(),
      })
      return true
    }

    try {
      const decoder = new TextDecoder()
      const bodyText = decoder.decode(await Deno.readAll(req.body))
      const body = bodyText ? JSON.parse(bodyText) : {}
      const providedPassword = String(body?.accessPassword ?? '')
      const settings = getSettings()
      const configuredPassword = String(settings.ACCESS_PASSWORD ?? '').trim()

      const isValid =
        !configuredPassword || timingSafeEqual(providedPassword, configuredPassword)

      await req.respond({
        status: isValid ? 200 : 401,
        body: JSON.stringify({
          success: isValid,
          message: isValid
            ? 'Access password verified.'
            : 'Incorrect access password. Please try again.',
        }),
        headers: makeJsonHeaders(),
      })
    } catch (err) {
      log.error(`Failed to verify access password: ${err}`)
      await req.respond({
        status: 400,
        body: JSON.stringify({
          success: false,
          message: 'Could not verify access password. Please try again.',
        }),
        headers: makeJsonHeaders(),
      })
    }
    return true
  }

  if (pathname === '/api/client-config') {
    const settings = getSettings()
    await req.respond({
      status: 200,
      body: JSON.stringify({
        plexLibraryName: getPlexLibraryName(),
        paidStreamingServices: settings.PAID_STREAMING_SERVICES,
        personalMediaSources: settings.PERSONAL_MEDIA_SOURCES,
      }),
      headers: makeJsonHeaders(),
    })
    return true
  }

  if (pathname === '/api/settings-test' && req.method === 'POST') {
    const ip = getClientIp(req)
    if (!apiRateLimiter.check(ip)) {
      await req.respond({
        status: 429,
        body: JSON.stringify({ ok: false, message: 'Too many requests. Please wait.' }),
        headers: makeJsonHeaders(),
      })
      return true
    }

    if (!isValidOrigin(req)) {
      await req.respond({
        status: 403,
        body: JSON.stringify({ ok: false, message: 'Invalid request origin.' }),
        headers: makeJsonHeaders(),
      })
      return true
    }

    const settings = getSettings()
    if (!isAdminAuthorized(req, settings, isLocalRequest)) {
      await req.respond({
        status: 403,
        body: JSON.stringify({
          ok: false,
          message: getAdminAuthFailureMessage(req, settings, isLocalRequest),
        }),
        headers: makeJsonHeaders(),
      })
      return true
    }

    try {
      const decoder = new TextDecoder()
      const body = decoder.decode(await Deno.readAll(req.body))
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

      await req.respond({
        status: result.ok ? 200 : 400,
        body: JSON.stringify(result),
        headers: makeJsonHeaders(),
      })
    } catch (err) {
      await req.respond({
        status: 500,
        body: JSON.stringify({
          ok: false,
          message: 'An internal error occurred.'`,
        }),
        headers: makeJsonHeaders(),
      })
    }

    return true
  }

  if (pathname === '/api/settings' && req.method === 'GET') {
    const settings = getSettings()
    const isAdmin = isAdminAuthorized(req, settings, isLocalRequest)

    await req.respond({
      status: 200,
      body: JSON.stringify({
        settings: sanitizeSettingsForClient(settings, isAdmin),
      }),
      headers: makeJsonHeaders(),
    })
    return true
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    if (!isValidOrigin(req)) {
      await req.respond({
        status: 403,
        body: JSON.stringify({ error: 'Invalid request origin.' }),
        headers: makeJsonHeaders(),
      })
      return true
    }

    const currentSettings = getSettings()
    const isAdmin = isAdminAuthorized(req, currentSettings, isLocalRequest)

    try {
      const decoder = new TextDecoder()
      const body = decoder.decode(await Deno.readAll(req.body))
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
          await req.respond({
            status: 403,
            body: JSON.stringify({
              error: getAdminAuthFailureMessage(
                req,
                currentSettings,
                isLocalRequest
              ),
            }),
            headers: makeJsonHeaders(),
          })
          return true
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

      await req.respond({
        status: 200,
        body: JSON.stringify({
          settings: sanitizeSettingsForClient(updated, isAdmin),
        }),
        headers: makeJsonHeaders(),
      })
    } catch (err) {
      if (err instanceof SettingsValidationError) {
        await req.respond({
          status: 400,
          body: JSON.stringify({
            error: 'Invalid settings payload',
            details: err.details,
          }),
          headers: makeJsonHeaders(),
        })
        return true
      }

      log.error(`Settings update failed: ${err}`)
      await req.respond({
        status: 500,
        body: JSON.stringify({ error: 'Failed to update settings' }),
        headers: makeJsonHeaders(),
      })
    }

    return true
  }

  return false
}
