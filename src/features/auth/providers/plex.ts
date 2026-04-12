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
  }
}

/** Request a new PIN from plex.tv. Returns the pin and the URL to send the user to. */
export async function requestPlexPin(clientId: string): Promise<{ pin: PlexPin; authUrl: string }> {
  const res = await fetchWithTimeout(`${PLEX_API_BASE}/pins`, {
    method: 'POST',
    headers: {
      ...plexHeaders(clientId),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'strong=true',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`[plex-auth] Failed to request PIN: ${res.status} ${body}`)
  }

  const data = await res.json()
  const pin: PlexPin = {
    id: data.id,
    code: data.code,
    expiresAt: data.expiresAt,
  }

  const authUrl =
    `${PLEX_AUTH_URL}#?` +
    `clientID=${encodeURIComponent(clientId)}` +
    `&code=${encodeURIComponent(pin.code)}` +
    `&context%5Bdevice%5D%5Bproduct%5D=Comparr`

  return { pin, authUrl }
}

/** Poll plex.tv for the status of a PIN. Returns pending, expired, or an authToken. */
export async function pollPlexPin(pinId: number, clientId: string): Promise<PlexPinStatus> {
  const res = await fetchWithTimeout(`${PLEX_API_BASE}/pins/${pinId}`, {
    headers: plexHeaders(clientId),
  })

  if (!res.ok) {
    log.warn(`[plex-auth] PIN poll returned ${res.status}`)
    return { pending: false, authToken: null, expired: true }
  }

  const data = await res.json()
  const authToken: string | null = data.authToken || null

  if (authToken) {
    return { pending: false, authToken, expired: false }
  }

  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0
  if (expiresAt && Date.now() > expiresAt) {
    return { pending: false, authToken: null, expired: true }
  }

  return { pending: true, authToken: null, expired: false }
}

/** Fetch the Plex user associated with a given auth token. */
export async function getPlexUserInfo(authToken: string, clientId: string): Promise<PlexUserInfo> {
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
    return accounts.some((a: { id: number | string }) => String(a.id) === userId)
  } catch (err) {
    log.warn(`[plex-auth] isUserOnPlexServer error: ${err}`)
    return false
  }
}
