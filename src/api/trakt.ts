// src/api/trakt.ts
// Trakt.tv API v2 client — device code OAuth (for a device-input-limited client like a mobile
// app, no redirect URI needed, mirrors Plex's PIN flow) plus Watchlist/History (seen) sync.
// Endpoint shapes verified against Trakt's real API (docs.trakt.tv + a working open-source
// client, since Trakt's own Apiary docs render via JS and aren't fetchable directly).

import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'
import { getTraktClientId, getTraktClientSecret } from '../core/config.ts'

const TRAKT_BASE = 'https://api.trakt.tv'

function traktHeaders(accessToken?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': getTraktClientId(),
  }
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`
  return headers
}

export interface TraktDeviceCode {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresIn: number
  interval: number
}

export async function requestTraktDeviceCode(): Promise<TraktDeviceCode> {
  const res = await fetchWithTimeout(`${TRAKT_BASE}/oauth/device/code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: getTraktClientId() }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Trakt device code request failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_url,
    expiresIn: data.expires_in,
    interval: data.interval,
  }
}

export interface TraktTokens {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO timestamp
}

export type TraktDeviceTokenResult =
  | { status: 'success'; tokens: TraktTokens }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'denied' }
  | { status: 'expired' }

/**
 * Poll once for the device token. Per Trakt's device flow: 200 = approved, 400 = still pending
 * (keep polling), 429 = polling too fast (back off), 418 = user explicitly denied, 404/409/410 =
 * invalid/already-used/expired code (start over).
 */
export async function pollTraktDeviceToken(deviceCode: string): Promise<TraktDeviceTokenResult> {
  const res = await fetchWithTimeout(`${TRAKT_BASE}/oauth/device/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: deviceCode,
      client_id: getTraktClientId(),
      client_secret: getTraktClientSecret(),
    }),
  })

  if (res.status === 200) {
    const data = await res.json()
    return {
      status: 'success',
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date((Number(data.created_at) + Number(data.expires_in)) * 1000).toISOString(),
      },
    }
  }
  if (res.status === 400) return { status: 'pending' }
  if (res.status === 429) return { status: 'slow_down' }
  if (res.status === 418) return { status: 'denied' }
  if (res.status === 404 || res.status === 409 || res.status === 410) return { status: 'expired' }

  const body = await res.text().catch(() => '')
  log.warn(`[trakt] Unexpected device token response: ${res.status} ${body.slice(0, 300)}`)
  return { status: 'expired' }
}

export async function refreshTraktToken(refreshToken: string): Promise<TraktTokens | null> {
  try {
    const res = await fetchWithTimeout(`${TRAKT_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refresh_token: refreshToken,
        client_id: getTraktClientId(),
        client_secret: getTraktClientSecret(),
        grant_type: 'refresh_token',
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`[trakt] Token refresh failed: ${res.status} ${body.slice(0, 300)}`)
      return null
    }
    const data = await res.json()
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date((Number(data.created_at) + Number(data.expires_in)) * 1000).toISOString(),
    }
  } catch (err) {
    log.error(`[trakt] Token refresh error: ${err}`)
    return null
  }
}

export interface TraktUserInfo {
  id: string
  username: string
  avatarUrl: string
}

/** Fetch the authenticated user's profile — used to create/update the Comparr account on login. */
export async function getTraktUserSettings(accessToken: string): Promise<TraktUserInfo> {
  const res = await fetchWithTimeout(`${TRAKT_BASE}/users/settings`, {
    headers: traktHeaders(accessToken),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Trakt user settings request failed: ${res.status} ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const user = data?.user ?? {}
  return {
    id: String(user?.ids?.slug ?? user?.username ?? ''),
    username: String(user?.username ?? user?.name ?? 'Trakt User'),
    avatarUrl: String(data?.images?.avatar?.full ?? ''),
  }
}

/** Trakt's sync endpoints accept a batch of movies per call (unlike Plex's one-at-a-time API). */
async function syncMovies(accessToken: string, endpoint: string, tmdbIds: number[]): Promise<boolean> {
  if (tmdbIds.length === 0) return true
  try {
    const res = await fetchWithTimeout(`${TRAKT_BASE}${endpoint}`, {
      method: 'POST',
      headers: traktHeaders(accessToken),
      body: JSON.stringify({ movies: tmdbIds.map(id => ({ ids: { tmdb: id } })) }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`[trakt] ${endpoint} failed: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[trakt] ${endpoint} error: ${err}`)
    return false
  }
}

export const addToTraktWatchlist = (accessToken: string, tmdbIds: number[]) =>
  syncMovies(accessToken, '/sync/watchlist', tmdbIds)
export const removeFromTraktWatchlist = (accessToken: string, tmdbIds: number[]) =>
  syncMovies(accessToken, '/sync/watchlist/remove', tmdbIds)
// Trakt calls "watched" history — same concept as Comparr/Plex's "Seen".
export const addToTraktHistory = (accessToken: string, tmdbIds: number[]) =>
  syncMovies(accessToken, '/sync/history', tmdbIds)
export const removeFromTraktHistory = (accessToken: string, tmdbIds: number[]) =>
  syncMovies(accessToken, '/sync/history/remove', tmdbIds)
