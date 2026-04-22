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
    `[plex-auth][${traceId}] [step 1] Requesting Plex PIN (clientId=${clientId}, forwardUrlSet=${Boolean(forwardUrl)})`
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
    log.info(`[plex-auth][${traceId}] [step 2] Primary PIN request returned status=${res.status}`)
  } catch (err) {
    log.error(`[plex-auth][${traceId}] [step 2] Primary PIN request failed: ${err}`)
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
    log.info(`[plex-auth][${traceId}] [step 4] Fallback PIN request returned status=${res.status}`)
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
    `[plex-auth][${traceId}] [step 6] PIN created (id=${pin.id}, codeLength=${pin.code?.length ?? 0}, expiresAt=${pin.expiresAt})`
  )

  const fallbackAuthUrl =
    `${PLEX_AUTH_URL}#?` +
    `clientID=${encodeURIComponent(clientId)}` +
    `&code=${encodeURIComponent(pin.code)}` +
    `&context%5Bdevice%5D%5Bproduct%5D=Comparr` +
    (forwardUrl
      ? `&forwardUrl=${encodeURIComponent(forwardUrl)}`
      : '')

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
    `[plex-auth][${traceId}] [step 7] Using auth URL source=${plexLocation ? 'plex-location' : 'constructed'}`
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
  const pinUrl = new URL(`${PLEX_API_BASE}/pins/${pinId}`)
  if (code) pinUrl.searchParams.set('code', code)
  log.info(
    `[plex-auth][${traceId}] [step 1] Polling PIN status (pinId=${pinId}, hasCode=${Boolean(code)})`
  )

  const res = await fetchWithTimeout(pinUrl.toString(), {
    headers: plexHeaders(clientId),
  })
  log.info(`[plex-auth][${traceId}] [step 2] PIN poll returned status=${res.status}`)

  if (!res.ok) {
    log.warn(`[plex-auth] PIN poll returned ${res.status}`)
    return { pending: false, authToken: null, expired: true }
  }

  const data = await res.json()
  const authToken: string | null = data.authToken || data.auth_token || null
  log.info(
    `[plex-auth][${traceId}] [step 3] PIN poll response (pinId=${pinId}, hasAuthToken=${Boolean(authToken)}, expiresAt=${data.expiresAt || data.expires_at || 'n/a'}, keys=${Object.keys(data).join(',')})`
  )

  if (authToken) {
    return { pending: false, authToken, expired: false }
  }

  const rawExpiresAt = data.expiresAt || data.expires_at || ''
  const expiresAt = rawExpiresAt ? new Date(rawExpiresAt).getTime() : 0
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
