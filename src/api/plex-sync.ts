// src/api/plex-sync.ts
// Plex Watchlist and scrobble API calls for per-user sync.
import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'
import { getPlexClientId } from '../core/config.ts'

const PLEX_DISCOVER_BASE = 'https://discover.provider.plex.tv'

function plexSyncHeaders(userToken: string): HeadersInit {
  return {
    Accept: 'application/json',
    'X-Plex-Token': userToken,
    'X-Plex-Product': 'Comparr',
    'X-Plex-Version': '1.0',
    'X-Plex-Device': 'Web',
    'X-Plex-Platform': 'Web',
    'X-Plex-Client-Identifier': getPlexClientId() || 'comparr',
  }
}

/**
 * Extract the Plex metadata key from a plex://movie/{key} GUID.
 * Returns undefined if the GUID is not in Plex format.
 */
export function extractPlexMetadataKey(guid: string): string | undefined {
  const match = guid.match(/^plex:\/\/movie\/([a-f0-9]+)$/i)
  return match ? match[1] : undefined
}

/**
 * Add a movie to the user's Plex Watchlist via the Discover service.
 * metadataKey is the bare hex ID from plex://movie/{key}.
 */
export async function addToPlexWatchlist(
  userToken: string,
  metadataKey: string
): Promise<boolean> {
  try {
    const url = `${PLEX_DISCOVER_BASE}/actions/addToWatchlist?ratingKey=${encodeURIComponent(metadataKey)}`
    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: plexSyncHeaders(userToken),
    })
    if (!res.ok && res.status !== 409) {
      const body = await res.text().catch(() => '')
      log.warn(`[plex-sync] addToWatchlist failed for ${metadataKey}: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[plex-sync] addToWatchlist error for ${metadataKey}: ${err}`)
    return false
  }
}

/**
 * Remove a movie from the user's Plex Watchlist via the Discover service.
 */
export async function removeFromPlexWatchlist(
  userToken: string,
  metadataKey: string
): Promise<boolean> {
  try {
    const url = `${PLEX_DISCOVER_BASE}/actions/removeFromWatchlist?ratingKey=${encodeURIComponent(metadataKey)}`
    const res = await fetchWithTimeout(url, {
      method: 'PUT',
      headers: plexSyncHeaders(userToken),
    })
    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => '')
      log.warn(`[plex-sync] removeFromWatchlist failed for ${metadataKey}: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[plex-sync] removeFromWatchlist error for ${metadataKey}: ${err}`)
    return false
  }
}

/**
 * Mark a movie as watched (scrobble) on the Plex server.
 * ratingKey is the local server item ID (numeric string).
 */
export async function scrobbleOnServer(
  serverUrl: string,
  userToken: string,
  ratingKey: string
): Promise<boolean> {
  try {
    const url = `${serverUrl}/:/scrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}&X-Plex-Token=${encodeURIComponent(userToken)}`
    const res = await fetchWithTimeout(url, { method: 'GET' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`[plex-sync] scrobble failed for ratingKey=${ratingKey}: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[plex-sync] scrobble error for ratingKey=${ratingKey}: ${err}`)
    return false
  }
}

/**
 * Mark a movie as unwatched (unscrobble) on the Plex server.
 */
export async function unscrobbleOnServer(
  serverUrl: string,
  userToken: string,
  ratingKey: string
): Promise<boolean> {
  try {
    const url = `${serverUrl}/:/unscrobble?identifier=com.plexapp.plugins.library&key=${ratingKey}&X-Plex-Token=${encodeURIComponent(userToken)}`
    const res = await fetchWithTimeout(url, { method: 'GET' })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(`[plex-sync] unscrobble failed for ratingKey=${ratingKey}: ${res.status} ${body.slice(0, 300)}`)
      return false
    }
    return true
  } catch (err) {
    log.error(`[plex-sync] unscrobble error for ratingKey=${ratingKey}: ${err}`)
    return false
  }
}
