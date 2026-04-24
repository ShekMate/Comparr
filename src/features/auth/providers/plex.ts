// src/features/auth/providers/plex.ts
// Plex PIN-based OAuth flow.
// 1. Call requestPlexPin() to get a pin ID + auth URL.
// 2. Direct the user to the auth URL (popup window).
// 3. Poll pollPlexPin() until authToken is set or pin expires.
// 4. Use the returned authToken to call getPlexUserInfo().

import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../../../infra/http/fetch-with-timeout.ts'

const PLEX_API_BASE = 'https://plex.tv/api/v2'
const PLEX_AUTH_URL = 'https://app.plex.tv/auth'
const PIN_POLL_TTL_MS = 5 * 60 * 1000 // Plex pins are valid for ~5 min
const getPlexAuthDebugFlag = (): boolean => {
  try {
    return Deno.env.get('PLEX_AUTH_DEBUG') === 'true'
  } catch {
    // In restricted runtimes (no --allow-env), default to non-debug behavior.
    return false
  }
}
const PLEX_AUTH_DEBUG = getPlexAuthDebugFlag()

export interface PlexPin {
  id: number
  code: string
  expiresAt: string
}

export interface PlexUserInfo {
  id: string
  username: string
  email: string
  thumb: string // avatar URL
}

export interface PlexPinStatus {
  pending: boolean // still waiting for user approval
  authToken: string | null // set once approved
  expired: boolean
}

function parsePlexExpiresAt(raw: unknown): number {
  if (typeof raw !== 'string' || !raw.trim()) return 0
  const normalized = raw.includes(' UTC')
    ? raw.replace(' UTC', 'Z').replace(' ', 'T')
    : raw
  const parsed = new Date(normalized).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function redactAuthToken(value: string): string {
  if (!value) return value
  if (value.length <= 8) return '***'
  return `${value.slice(0, 4)}...${value.slice(-4)}`
}

function plexHeaders(clientId: string): HeadersInit {
  return {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientId,
    'X-Plex-Product': 'Comparr',
    'X-Plex-Version': '1.0',
    'X-Plex-Device': 'Web',
    'X-Plex-Platform': 'Web',
    'User-Agent': 'Comparr/1.0',
  }
}

/** Request a new PIN from plex.tv. Returns the pin and the URL to send the user to. */
export async function requestPlexPin(
  clientId: string,
  forwardUrl?: string
): Promise<{ pin: PlexPin; authUrl: string }> {
  const traceId = crypto.randomUUID().slice(0, 8)
  log.info(
    `[plex-auth][${traceId}] [step 1] Requesting Plex PIN (clientId=${clientId}, forwardUrlSet=${Boolean(
      forwardUrl
    )})`
  )
  // Plex currently accepts `strong=true` as a query parameter.
  // Keep this canonical call first, then fall back to form-body mode for
  // compatibility with older plex.tv behavior.
  let res: Response
  try {
    res = await fetchWithTimeout(`${PLEX_API_BASE}/pins?strong=true`, {
      method: 'POST',
      headers: plexHeaders(clientId),
    })
    log.info(
      `[plex-auth][${traceId}] [step 2] Primary PIN request returned status=${res.status}`
    )
  } catch (err) {
    log.error(
      `[plex-auth][${traceId}] [step 2] Primary PIN request failed: ${err}`
    )
    throw new Error(`[plex-auth] PIN request network failure: ${err}`)
  }

  if (!res.ok) {
    log.warn(
      `[plex-auth][${traceId}] [step 3] Primary PIN request failed with ${res.status}; retrying form-body mode`
    )
    res = await fetchWithTimeout(`${PLEX_API_BASE}/pins`, {
      method: 'POST',
      headers: {
        ...plexHeaders(clientId),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'strong=true',
    })
    log.info(
      `[plex-auth][${traceId}] [step 4] Fallback PIN request returned status=${res.status}`
    )
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[plex-auth] Failed to request PIN: ${res.status} ${body}`)
  }

  const data = await res.json()
  log.info(`[plex-auth][${traceId}] [step 5] Parsed PIN response payload`)
  const pin: PlexPin = {
    id: data.id,
    code: data.code,
    expiresAt: data.expiresAt || data.expires_at || '',
  }
  log.info(
    `[plex-auth][${traceId}] [step 6] PIN created (id=${pin.id}, codeLength=${
      pin.code?.length ?? 0
    }, expiresAt=${pin.expiresAt})`
  )

  const authFragmentParams = new URLSearchParams({
    clientID: clientId,
    code: pin.code,
    'context[device][product]': 'Comparr',
    'context[device][platform]': 'Web',
    'context[device][device]': 'Browser',
    'context[device][layout]': 'desktop',
  })
  if (forwardUrl) authFragmentParams.set('forwardUrl', forwardUrl)
  const fallbackAuthUrl = `${PLEX_AUTH_URL}/#!?${authFragmentParams.toString()}`
  log.info(
    `[plex-auth][${traceId}] [step 6b] Constructed fallback auth URL (includesForwardUrl=${Boolean(
      forwardUrl
    )})`
  )

  // Normalize Plex-provided location. Some responses may provide this as a
  // structured object instead of a plain string.
  let plexLocation = ''
  if (typeof data.location === 'string') {
    plexLocation = data.location.trim()
  } else if (data.location && typeof data.location === 'object') {
    if (typeof data.location.href === 'string') {
      plexLocation = data.location.href.trim()
    } else if (typeof data.location.url === 'string') {
      plexLocation = data.location.url.trim()
    }
  }

  // Prefer Plex-provided URL when valid; otherwise fall back.
  let authUrl = plexLocation || fallbackAuthUrl
  try {
    authUrl = String(authUrl)
    new URL(authUrl)
  } catch {
    log.warn(
      `[plex-auth][${traceId}] Invalid Plex location payload; falling back to constructed URL`
    )
    authUrl = fallbackAuthUrl
  }
  log.info(
    `[plex-auth][${traceId}] [step 7] Using auth URL source=${
      plexLocation ? 'plex-location' : 'constructed'
    }`
  )

  return { pin, authUrl }
}

/** Poll plex.tv for the status of a PIN. Returns pending, expired, or an authToken. */
export async function pollPlexPin(
  pinId: number,
  clientId: string,
  code?: string
): Promise<PlexPinStatus> {
  const traceId = `${pinId}-${Date.now().toString(36)}`
  const pollOnce = async (
    useCode: boolean
  ): Promise<{
    authToken: string | null
    rawExpiresAt: string
    statusOk: boolean
    status: number
    contentType: string
  }> => {
    const pinUrl = new URL(`${PLEX_API_BASE}/pins/${pinId}`)
    if (useCode && code) pinUrl.searchParams.set('code', code)
    const res = await fetchWithTimeout(pinUrl.toString(), {
      headers: {
        ...plexHeaders(clientId),
        Accept: 'application/json',
      },
    })
    const contentType = res.headers.get('content-type') || ''
    if (PLEX_AUTH_DEBUG) {
      log.info(
        `[plex-auth][${traceId}] [debug] pollOnce request (pinId=${pinId}, useCode=${useCode}, url=${pinUrl.toString()})`
      )
    }
    if (!res.ok) {
      return {
        authToken: null,
        rawExpiresAt: '',
        statusOk: false,
        status: res.status,
        contentType,
      }
    }
    if (contentType.includes('application/json')) {
      const data = await res.json().catch(() => ({}))
      if (PLEX_AUTH_DEBUG) {
        const token =
          (typeof data?.authToken === 'string' && data.authToken) ||
          (typeof data?.auth_token === 'string' && data.auth_token) ||
          ''
        log.info(
          `[plex-auth][${traceId}] [debug] pollOnce JSON payload (pinId=${pinId}, useCode=${useCode}, hasAuthToken=${Boolean(
            token
          )}, authToken=${redactAuthToken(token)}, expiresAt=${
            data?.expiresAt || data?.expires_at || ''
          })`
        )
      }
      const authToken =
        typeof data?.authToken === 'string' && data.authToken.trim()
          ? data.authToken
          : typeof data?.auth_token === 'string' && data.auth_token.trim()
          ? data.auth_token
          : null
      const rawExpiresAt =
        (typeof data?.expiresAt === 'string' && data.expiresAt) ||
        (typeof data?.expires_at === 'string' && data.expires_at) ||
        ''
      return {
        authToken,
        rawExpiresAt,
        statusOk: true,
        status: res.status,
        contentType,
      }
    }
    const text = await res.text()
    if (PLEX_AUTH_DEBUG) {
      const redactedText = text.replace(
        /(authToken|auth_token)=\"([^\"]*)\"/gi,
        (_m, key, token) => `${key}="${redactAuthToken(token)}"`
      )
      log.info(
        `[plex-auth][${traceId}] [debug] pollOnce non-JSON payload (pinId=${pinId}, useCode=${useCode}, body=${redactedText})`
      )
    }
    const getAttr = (name: string): string => {
      const match = text.match(new RegExp(`${name}="([^"]*)"`, 'i'))
      return match?.[1] || ''
    }
    return {
      authToken: getAttr('authToken') || getAttr('auth_token') || null,
      rawExpiresAt: getAttr('expiresAt') || getAttr('expires_at') || '',
      statusOk: true,
      status: res.status,
      contentType,
    }
  }

  log.info(
    `[plex-auth][${traceId}] [step 1] Polling PIN status (pinId=${pinId}, hasCode=${Boolean(
      code
    )})`
  )
  let pollResult = await pollOnce(Boolean(code))
  log.info(
    `[plex-auth][${traceId}] [step 2] PIN poll returned status=${pollResult.status}`
  )

  if (!pollResult.statusOk) {
    log.warn(`[plex-auth] PIN poll returned ${pollResult.status}`)
    if (pollResult.status === 404 || pollResult.status === 410) {
      return { pending: false, authToken: null, expired: true }
    }
    throw new Error(
      `[plex-auth] transient PIN poll failure: ${pollResult.status}`
    )
  }

  // Some Plex environments return token data only when code is omitted.
  if (!pollResult.authToken && code) {
    log.info(
      `[plex-auth][${traceId}] [step 2b] Retrying PIN poll without code parameter`
    )
    const noCodeResult = await pollOnce(false)
    if (noCodeResult.statusOk && noCodeResult.authToken) {
      pollResult = noCodeResult
    } else if (noCodeResult.statusOk && !pollResult.rawExpiresAt) {
      pollResult = noCodeResult
    }
  }

  const { authToken, rawExpiresAt, contentType } = pollResult
  if (!authToken) {
    if (contentType.includes('application/json')) {
      log.info(
        `[plex-auth][${traceId}] [debug] PIN poll missing authToken in JSON payload`
      )
    } else {
      log.info(
        `[plex-auth][${traceId}] [debug] PIN poll missing authToken in non-JSON payload`
      )
    }
  }

  log.info(
    `[plex-auth][${traceId}] [step 3] PIN poll parsed (pinId=${pinId}, hasAuthToken=${Boolean(
      authToken
    )}, expiresAt=${rawExpiresAt || 'n/a'}, contentType=${
      contentType || 'unknown'
    })`
  )

  if (authToken) {
    return { pending: false, authToken, expired: false }
  }

  const expiresAt = parsePlexExpiresAt(rawExpiresAt)
  if (expiresAt && Date.now() > expiresAt) {
    return { pending: false, authToken: null, expired: true }
  }

  return { pending: true, authToken: null, expired: false }
}

/** Fetch the Plex user associated with a given auth token. */
export async function getPlexUserInfo(
  authToken: string,
  clientId: string
): Promise<PlexUserInfo> {
  const res = await fetchWithTimeout(`${PLEX_API_BASE}/user`, {
    headers: {
      ...plexHeaders(clientId),
      'X-Plex-Token': authToken,
    },
  })

  if (!res.ok) {
    throw new Error(`[plex-auth] Failed to get user info: ${res.status}`)
  }

  const data = await res.json()
  return {
    id: String(data.id),
    username: data.username || data.title || 'Plex User',
    email: data.email || '',
    thumb: data.thumb || '',
  }
}

/**
 * Check whether a given Plex user (identified by their auth token) has access
 * to the locally configured Plex server.
 * Uses the server admin token to list server users, then checks for a match.
 */
export async function isUserOnPlexServer(
  userAuthToken: string,
  serverUrl: string,
  serverToken: string
): Promise<boolean> {
  try {
    // Get the user's account ID via their own token
    const userRes = await fetchWithTimeout(`${PLEX_API_BASE}/user`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': userAuthToken,
        'X-Plex-Client-Identifier': 'comparr-server-check',
      },
    })
    if (!userRes.ok) return false
    const userData = await userRes.json()
    const userId = String(userData.id)

    // Fetch all users from the Plex server using the server admin token
    const serverRes = await fetchWithTimeout(`${serverUrl}/accounts`, {
      headers: {
        Accept: 'application/json',
        'X-Plex-Token': serverToken,
      },
    })
    if (!serverRes.ok) {
      log.warn(`[plex-auth] Server accounts check returned ${serverRes.status}`)
      return false
    }

    const serverData = await serverRes.json()
    const accounts = serverData?.MediaContainer?.Account ?? []
    return accounts.some(
      (a: { id: number | string }) => String(a.id) === userId
    )
  } catch (err) {
    log.warn(`[plex-auth] isUserOnPlexServer error: ${err}`)
    return false
  }
}
