// src/index.ts
// Global error handlers - log before process exits so Docker logs capture the crash reason
globalThis.addEventListener('error', event => {
  console.error('[FATAL] Uncaught error:', event.error ?? event.message)
})
globalThis.addEventListener('unhandledrejection', event => {
  console.error('[FATAL] Unhandled promise rejection:', event.reason)
})

import * as log from 'jsr:@std/log'
import { clearAllMoviesCache, getServerId } from './api/plex.ts'
import type { CompatRequest } from './infra/http/compat-request.ts'
import {
  getHost,
  getLinkType,
  getEmbyLibraryName,
  getJellyfinLibraryName,
  getPlexLibraryName,
  getPlexUrl,
  getPort,
  getMaxBodySize,
  getAccessPassword,
} from './core/config.ts'
import { getDataDir } from './core/env.ts'
import { getSettings, updateSettings, resetSettings } from './core/settings.ts'
import { timingSafeEqual, verifyPassword } from './core/security.ts'
import {
  validateAccessSession,
} from './core/access-session-store.ts'
import { getUserSession } from './core/user-session-store.ts'
import { handleAuthRoutes, getUserTokenFromCookie } from './infra/http/routes/auth.ts'
import { getLinkTypeForRequest } from './core/i18n.ts'
import {
  handleLogin,
  activeSessions,
  getAllRooms,
  clearAllRooms,
  clearRooms,
  clearUsersFromRoom,
} from './features/session/session.ts'
import { serveFile } from './infra/http/staticFileServer.ts'
import {
  isLocalRequest,
  isValidHost,
  isValidStateChangingOrigin,
} from './infra/http/network-access.ts'
import { handleSettingsRoutes } from './infra/http/routes/settings.ts'
import { handleRoutes } from './infra/http/router.ts'
import { handleMatchesRoute } from './infra/http/routes/matches.ts'
import { handleCompareRoutes } from './infra/http/routes/compare.ts'
import { handleRequestServiceRoutes } from './infra/http/routes/request-service.ts'
import { handleRoomRoutes } from './infra/http/routes/rooms.ts'
import { handleRequestMovieRoute } from './infra/http/routes/request-movie.ts'
import { handleMovieRefreshRoute } from './infra/http/routes/movie-refresh.ts'
import { handleRecommendationsRoute } from './infra/http/routes/recommendations.ts'
import { handleStreamingRoutes } from './infra/http/routes/streaming.ts'
import { handleImdbImportRoutes } from './infra/http/routes/imdb-import.ts'
import { handleSystemRoutes } from './infra/http/routes/system.ts'
import { WebSocketServer } from './infra/ws/websocketServer.ts'
import { makeHeaders } from './infra/http/security-headers.ts'
import { appendAuditLog } from './infra/http/audit.ts'
import { fetchWithTimeout } from './infra/http/fetch-with-timeout.ts'
import { refreshRadarrCache } from './api/radarr.ts'
import {
  getCachedPosterPath,
  serveCachedPoster,
} from './services/cache/poster-cache.ts'
import {
  closeIMDbDatabase,
  startBackgroundUpdateJob,
  stopBackgroundUpdateJob,
} from './features/catalog/imdb-datasets.ts'
import { buildPlexCache } from './integrations/plex/cache.ts'
import { bootstrapApplication } from './app/bootstrap.ts'

// --- Server state
const CSRF_COOKIE_NAME = 'comparr_csrf'
const ACCESS_PASSWORD_COOKIE_NAME = 'comparr_access'
let activeRequests = 0
let isShuttingDown = false
let shuttingDownPromise: Promise<void> | null = null

/** tiny helper to send a file from disk */
async function respondFile(
  req: CompatRequest,
  filePath: string,
  contentType?: string
): Promise<Response | null> {
  try {
    const body = await Deno.readFile(filePath)
    return new Response(body, {
      status: 200,
      headers: makeHeaders(req, contentType),
    })
  } catch (_) {
    return null
  }
}

const _bodyTooLarge = (req: CompatRequest) => {
  const max = getMaxBodySize()
  const contentLength = Number(req.headers.get('content-length') || '0')
  return Number.isFinite(contentLength) && contentLength > max
}

const isStateChangingMethod = (method: string) =>
  method === 'POST' ||
  method === 'PUT' ||
  method === 'PATCH' ||
  method === 'DELETE'

const EXEMPT_ORIGIN_CHECK_PATHS = new Set([
  '/api/access-password/verify',
  '/api/access-password/status',
])

const EXEMPT_GLOBAL_ACCESS_PASSWORD_PATHS = new Set([
  '/api/access-password/verify',
  '/api/access-password/status',
  '/api/settings-access',
  '/api/client-config',
  '/api/health',
])

// Paths that bypass the user-auth gate (auth endpoints + pre-login essentials).
const EXEMPT_USER_AUTH_PATHS = new Set([
  '/api/auth/providers',
  '/api/auth/me',
  '/api/auth/logout',
  '/api/access-password/verify',
  '/api/access-password/status',
  '/api/settings-access',
  '/api/client-config',
  '/api/health',
  '/api/csrf-token',
])
const EXEMPT_CSRF_PATHS = new Set(['/api/csrf-token'])

// Reads the session token stored in the access-password cookie.
// After login the cookie holds a random token, not the raw password.
const getAccessTokenFromCookie = (req: CompatRequest): string => {
  const rawCookieHeader = String(req?.headers?.get?.('cookie') || '')
  for (const cookiePair of rawCookieHeader.split(';')) {
    const [rawKey, ...rest] = cookiePair.split('=')
    const key = String(rawKey || '').trim()
    if (key !== ACCESS_PASSWORD_COOKIE_NAME) continue
    return decodeURIComponent(rest.join('=').trim())
  }
  return ''
}

// Reads a raw password from explicit request headers only.
// Used as a fallback for API/script clients that don't hold a session cookie.
const getAccessPasswordFromHeaders = (req: CompatRequest): string => {
  const header = req.headers?.get?.('x-access-password')
  if (typeof header === 'string' && header.trim()) return header.trim()
  const auth = req.headers?.get?.('authorization')
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim()
  }
  return ''
}

// Used by the WebSocket upgrade path to pass whichever credential is present
// (session token from cookie, or raw password from a header) to handleLogin,
// which validates each case appropriately.
const parseAccessPassword = (req: CompatRequest): string => {
  const cookieToken = getAccessTokenFromCookie(req)
  if (cookieToken) return cookieToken
  return getAccessPasswordFromHeaders(req)
}

const isAccessPasswordAuthorized = async (req: CompatRequest) => {
  const configuredPassword = getAccessPassword()
  if (!configuredPassword) return true
  // Fast path: valid session token from cookie — no PBKDF2 needed
  const cookieToken = getAccessTokenFromCookie(req)
  if (cookieToken && validateAccessSession(cookieToken)) return true
  // Fallback: raw password from an explicit header (API / script clients)
  const headerPassword = getAccessPasswordFromHeaders(req)
  if (headerPassword) return verifyPassword(headerPassword, configuredPassword)
  return false
}

const isSetupWizardActive = () =>
  String(getSettings().SETUP_WIZARD_COMPLETED ?? '').toLowerCase() !== 'true'

const shouldRequireAccessPassword = (path: string) => {
  if (!getAccessPassword()) return false
  if (!path.startsWith('/api/')) return false
  if (isSetupWizardActive()) return false
  return !EXEMPT_GLOBAL_ACCESS_PASSWORD_PATHS.has(path)
}

const parseCookies = (req: CompatRequest) => {
  const rawCookieHeader = String(req?.headers?.get?.('cookie') || '')
  const cookies = new Map<string, string>()
  for (const cookiePair of rawCookieHeader.split(';')) {
    const [rawKey, ...rest] = cookiePair.split('=')
    const key = String(rawKey || '').trim()
    if (!key) continue
    cookies.set(key, rest.join('=').trim())
  }
  return cookies
}

const getCsrfCookieToken = (req: CompatRequest) =>
  parseCookies(req).get(CSRF_COOKIE_NAME) || ''

const createCsrfToken = () =>
  `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`

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

const isValidCsrfRequest = (req: CompatRequest) => {
  const cookieToken = getCsrfCookieToken(req)
  const headerToken = String(req?.headers?.get?.('x-csrf-token') || '').trim()
  if (!cookieToken || !headerToken) return false
  return timingSafeEqual(cookieToken, headerToken)
}

const serveCompat = (options: { port: number; hostname?: string }) => {
  const queue: CompatRequest[] = []
  const waiters: Array<(value: IteratorResult<CompatRequest>) => void> = []
  const abortController = new AbortController()
  const hostname = options.hostname ?? '0.0.0.0'
  let closed = false

  const flush = () => {
    while (queue.length > 0 && waiters.length > 0) {
      const req = queue.shift()!
      const waiter = waiters.shift()!
      waiter({ value: req, done: false })
    }

    if (closed) {
      while (waiters.length > 0 && queue.length === 0) {
        const waiter = waiters.shift()!
        waiter({ value: undefined as never, done: true })
      }
    }
  }

  Deno.serve(
    { port: options.port, hostname, signal: abortController.signal },
    (request, info) => {
      if (closed) return new Response('Server shutting down', { status: 503 })

      return new Promise<Response>(resolve => {
        const parsedUrl = new URL(request.url)
        let responder: ((response: Response) => void) | null = resolve

        const req: CompatRequest = {
          method: request.method,
          url: `${parsedUrl.pathname}${parsedUrl.search}`,
          headers: request.headers,
          conn: { remoteAddr: info.remoteAddr },
          rawRequest: request,
          respond: (init): Promise<void> => {
            if (!responder) return Promise.resolve()
            const resolveResponse = responder
            responder = null
            resolveResponse(
              new Response(init.body ?? null, {
                status: init.status ?? 200,
                headers: init.headers,
              })
            )
            return Promise.resolve()
          },
          respondWith: (response): Promise<void> => {
            if (!responder) return Promise.resolve()
            const resolveResponse = responder
            responder = null
            resolveResponse(response)
            return Promise.resolve()
          },
          text: () => request.text(),
          json: <T = unknown>() => request.json() as Promise<T>,
        }

        queue.push(req)
        flush()
      })
    }
  )

  return {
    close() {
      if (closed) return
      closed = true
      abortController.abort()
      flush()
    },
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (queue.length > 0) {
            return Promise.resolve({ value: queue.shift()!, done: false })
          }
          if (closed) {
            return Promise.resolve({ value: undefined as never, done: true })
          }
          return new Promise(resolve => waiters.push(resolve))
        },
      }
    },
  }
}

const host = getHost()
const port = Number(getPort())

log.info(
  `[startup] Deno ${Deno.version.deno} | OS: ${Deno.build.os} ${Deno.build.arch}`
)
log.info(`[startup] Binding server to ${host}:${port}`)
log.info(`[startup] DATA_DIR=${getDataDir()}`)

let server: ReturnType<typeof serveCompat>
try {
  server = serveCompat({ port, hostname: host })
  log.info(`[startup] Server created successfully`)
} catch (err) {
  log.error(`[startup] FAILED to create server: ${err}`)
  throw err
}

const wss = new WebSocketServer({
  onConnection: (ws, req) => {
    const userToken = getUserTokenFromCookie(req)
    const userSession = userToken ? getUserSession(userToken) : null
    return handleLogin(
      ws,
      String((req.conn.remoteAddr as Deno.NetAddr)?.hostname || 'unknown'),
      parseAccessPassword(req),
      userSession?.hasServerAccess !== false
    )
  },
  onError: err => log.error(err),
})

if (Deno.build.os !== 'windows') {
  const shutdownHandler = async () => {
    if (shuttingDownPromise) {
      await shuttingDownPromise
      return
    }
    shuttingDownPromise = (async () => {
      log.info('Shutting down')
      isShuttingDown = true
      server.close()
      stopBackgroundUpdateJob()
      closeIMDbDatabase()
      await wss.close().catch(() => {})
      const startedAt = Date.now()
      while (activeRequests > 0 && Date.now() - startedAt < 5_000) {
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      Deno.exit(0)
    })()
    await shuttingDownPromise
  }

  Deno.addSignalListener('SIGINT', shutdownHandler)
  Deno.addSignalListener('SIGTERM', shutdownHandler)
}

log.info(`Listening on http://${host}:${port}`)

bootstrapApplication()

for await (const req of server) {
  activeRequests += 1
  const requestStartedAt = Date.now()
  const requestId = crypto.randomUUID()
  let responseStatus = 200
  let auditEvent = ''
  try {
    if (isShuttingDown) {
      responseStatus = 503
      await req.respond({
        status: responseStatus,
        body: JSON.stringify({ error: 'Server is shutting down.' }),
        headers: makeHeaders(req, 'application/json'),
      })
      continue
    }

    if (!isValidHost(req)) {
      responseStatus = 421
      await req.respond({
        status: responseStatus,
        headers: makeHeaders(req, 'application/json'),
        body: JSON.stringify({ error: 'Misdirected Request' }),
      })
      continue
    }

    const url = new URL(req.url, 'http://local')
    const p = url.pathname

    const systemRouteResponse = await handleSystemRoutes(req, p, {
      csrfCookieName: CSRF_COOKIE_NAME,
      createCsrfToken,
      shouldUseSecureCookies,
      activeSessions,
    })
    if (systemRouteResponse) {
      await req.respondWith(systemRouteResponse)
      continue
    }

    if (
      p.startsWith('/api/') &&
      isStateChangingMethod(req.method) &&
      !EXEMPT_ORIGIN_CHECK_PATHS.has(p) &&
      !isValidStateChangingOrigin(req)
    ) {
      await req.respond({
        status: 403,
        body: JSON.stringify({ error: 'Invalid request origin.' }),
        headers: makeHeaders(req, 'application/json'),
      })
      continue
    }

    if (
      p.startsWith('/api/') &&
      isStateChangingMethod(req.method) &&
      !EXEMPT_CSRF_PATHS.has(p) &&
      !isValidCsrfRequest(req)
    ) {
      await req.respond({
        status: 403,
        body: JSON.stringify({ error: 'Invalid CSRF token.' }),
        headers: makeHeaders(req, 'application/json'),
      })
      continue
    }

    if (
      p.startsWith('/api/') &&
      shouldRequireAccessPassword(p) &&
      !(await isAccessPasswordAuthorized(req))
    ) {
      responseStatus = 401
      auditEvent = 'access_password_denied'
      await req.respond({
        status: responseStatus,
        body: JSON.stringify({ error: 'Access password required.' }),
        headers: makeHeaders(req, 'application/json'),
      })
      continue
    }

    // User auth gate: always required after first-run setup is done.
    // Auth endpoints and access-password paths are exempt so login can proceed.
    if (
      p.startsWith('/api/') &&
      !isSetupWizardActive() &&
      !EXEMPT_USER_AUTH_PATHS.has(p) &&
      // Allow all /api/auth/* paths (PIN polling, logout, avatar proxy, etc.)
      !p.startsWith('/api/auth/')
    ) {
      const userToken = getUserTokenFromCookie(req)
      if (!userToken || !getUserSession(userToken)) {
        responseStatus = 401
        await req.respond({
          status: responseStatus,
          body: JSON.stringify({ error: 'Authentication required.', code: 'USER_AUTH_REQUIRED' }),
          headers: makeHeaders(req, 'application/json'),
        })
        continue
      }
    }

    // Auth routes (/api/auth/*)
    if (p.startsWith('/api/auth/')) {
      const authResponse = await handleAuthRoutes(req, p)
      if (authResponse) {
        await req.respondWith(authResponse)
        continue
      }
    }

    if (p.startsWith('/api/') && isStateChangingMethod(req.method)) {
      appendAuditLog('state_change_request', req, {
        method: req.method,
        path: p,
        requestId,
      }).catch(err =>
        log.error(
          `Failed to append state-change audit log: ${err?.message || err}`
        )
      )
    }

    const settingsRouteResponse = await handleSettingsRoutes(req, p, {
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
      onWizardComplete: () => {
        startBackgroundUpdateJob()
      },
    })
    if (settingsRouteResponse) {
      await req.respondWith(settingsRouteResponse)
      continue
    }

    const routeResponse = await handleRoutes(req, p, [
      handleRequestServiceRoutes,
      handleRoomRoutes,
      handleCompareRoutes,
      handleMatchesRoute,
      handleRecommendationsRoute,
    ])
    if (routeResponse) {
      await req.respondWith(routeResponse)
      continue
    }

    // --- API: Request movie via Jellyseerr/Overseerr
    const requestMovieResponse = await handleRequestMovieRoute(
      req,
      p,
      getMaxBodySize()
    )
    if (requestMovieResponse) {
      await req.respondWith(requestMovieResponse)
      continue
    }

    // --- API: Manually refresh Radarr cache
    if (p === '/api/refresh-radarr-cache' && req.method === 'POST') {
      try {
        log.info('Radarr cache refresh requested')
        await refreshRadarrCache()
        await req.respond({
          status: 200,
          body: JSON.stringify({ ok: true }),
          headers: makeHeaders(req, 'application/json'),
        })
      } catch (err) {
        log.error(`Radarr cache refresh failed: ${err?.message || err}`)
        await req.respond({
          status: 500,
          body: JSON.stringify({
            ok: false,
            error: 'An internal error occurred.',
          }),
          headers: makeHeaders(req, 'application/json'),
        })
      }
      continue
    }

    // --- API: Streaming data and persisted movie updates
    const streamingResponse = await handleStreamingRoutes(req, p)
    if (streamingResponse) {
      await req.respondWith(streamingResponse)
      continue
    }

    // --- API: Refresh movie data (ratings + library status)
    const movieRefreshResponse = await handleMovieRefreshRoute(req, p)
    if (movieRefreshResponse) {
      await req.respondWith(movieRefreshResponse)
      continue
    }

    // --- API: IMDb import routes
    const imdbResponse = await handleImdbImportRoutes(req, p, getMaxBodySize())
    if (imdbResponse) {
      await req.respondWith(imdbResponse)
      continue
    }

    // --- WebSocket for app events/login
    if (p === '/ws') {
      await req.respondWith(await wss.connect(req))
      continue
    }

    // --- Deep link to Plex for a movie
    if (p.startsWith('/movie/')) {
      const serverId = await getServerId()
      const key = p.replace('/movie', '')

      let location: string
      if (getLinkTypeForRequest(req.headers) === 'app') {
        location = `plex://preplay/?metadataKey=${encodeURIComponent(
          key
        )}&metadataType=1&server=${serverId}`
      } else if (getLinkType() == 'plex.tv') {
        location = `https://app.plex.tv/desktop#!/server/${serverId}/details?key=${encodeURIComponent(
          key
        )}`
      } else {
        location = `${getPlexUrl()}/web/index.html#!/server/${serverId}/details?key=${encodeURIComponent(
          key
        )}`
      }

      await req.respond({
        status: 302,
        headers: (() => {
          const h = makeHeaders(req)
          h.set('Location', location)
          return h
        })(),
      })
      continue
    }

    // --- Proxy TMDb posters
    if (p.startsWith('/tmdb-poster/')) {
      const posterPath = p.replace('/tmdb-poster', '')
      const normalizedPosterPath = posterPath.startsWith('/')
        ? posterPath
        : `/${posterPath}`

      // Serve from local disk cache first when available.
      const cachedPosterPath = getCachedPosterPath(normalizedPosterPath, 'tmdb')
      if (cachedPosterPath?.startsWith('/cached-poster/')) {
        const filename = cachedPosterPath.slice('/cached-poster/'.length)
        const served = await serveCachedPoster(filename, req)
        if (served) {
          await req.respondWith(served)
          continue
        }
      }

      const tmdbUrl = `https://image.tmdb.org/t/p/w500${normalizedPosterPath}`

      try {
        const posterReq = await fetchWithTimeout(tmdbUrl)
        if (posterReq.ok) {
          const imageData = new Uint8Array(await posterReq.arrayBuffer())

          // Cache the downloaded poster
          const { cachePoster } = await import(
            './services/cache/poster-cache.ts'
          )
          cachePoster(normalizedPosterPath, 'tmdb', tmdbUrl).catch(err =>
            log.error(`Failed to cache TMDb poster: ${err}`)
          )

          await req.respond({
            status: 200,
            body: imageData,
            headers: (() => {
              const h = makeHeaders(req, 'image/jpeg')
              h.set('cache-control', 'public, max-age=31536000, immutable')
              return h
            })(),
          })
        } else {
          await req.respond({ status: 404 })
        }
      } catch {
        await req.respond({ status: 404 })
      }
      continue
    }

    // --- Serve favicon quickly if present
    if (p === '/favicon.ico') {
      const served = await respondFile(
        req,
        'public/favicon.ico',
        'image/x-icon'
      )
      if (served) {
        await req.respondWith(served)
      } else {
        await req.respond({ status: 404 })
      }
      continue
    }

    // --- Serve SPA + static files from ./public (explicit fast-paths)
    // Serve index.html through the templated static server so ${...} variables resolve
    if (p === '/' || p === '/index.html') {
      await req.respondWith(await serveFile(req, '/public'))
      continue
    }

    if (p.startsWith('/js/')) {
      const served = await respondFile(
        req,
        'public' + p,
        'application/javascript; charset=utf-8'
      )
      if (served) {
        await req.respondWith(served)
      } else {
        await req.respond({ status: 404, body: 'Not Found' })
      }
      continue
    }
    // Serve cached posters from DATA_DIR/poster-cache
    if (p.startsWith('/cached-poster/')) {
      const filename = p.slice('/cached-poster/'.length)
      // Reject path traversal: filenames must be a single path component
      // with only safe characters. Any '..' or '/' is an attack attempt.
      if (!filename || filename.includes('..') || filename.includes('/') || filename.includes('\0')) {
        await req.respond({ status: 400, body: 'Bad Request' })
        continue
      }
      const served = await serveCachedPoster(filename, req)
      if (served) {
        await req.respondWith(served)
      } else {
        await req.respond({ status: 404, body: 'Not Found' })
      }
      continue // handled
    }

    // --- Fallback: generic static server rooted at /public
    await req.respondWith(await serveFile(req, '/public'))
  } catch (err) {
    log.error(`Error handling request: ${err?.message ?? err}`)
    responseStatus = 500
    try {
      await req.respond({ status: 500, body: new TextEncoder().encode('500') })
    } catch {
      /* secondary respond failure is ignored */
    }
  } finally {
    try {
      const reqPath = new URL(req.url, 'http://local').pathname
      if (reqPath.startsWith('/api/')) {
        appendAuditLog(auditEvent || 'api_request_complete', req, {
          requestId,
          status: responseStatus,
          durationMs: Date.now() - requestStartedAt,
        }).catch(err =>
          log.error(
            `Failed to append request audit log: ${err?.message || err}`
          )
        )
      }
    } catch {
      // ignore
    }
    activeRequests = Math.max(0, activeRequests - 1)
  }
}
