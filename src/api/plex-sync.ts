// src/api/plex-sync.ts
// Plex Watchlist and scrobble API calls for per-user sync.
import * as log from 'jsr:@std/log'
import { fetchWithTimeout } from '../infra/http/fetch-with-timeout.ts'
import { getPlexClientId } from '../core/config.ts'
import { normalizeTitle } from '../integrations/plex/cache.ts'

const PLEX_DISCOVER_BASE = 'https://discover.provider.plex.tv'
const PLEX_METADATA_BASE = 'https://metadata.provider.plex.tv'

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

interface DiscoverCandidate {
  ratingKey: string
  title: string
  year: number | null
}

/**
 * Recursively collect every movie result from a parsed Plex Discover search response. The tree
 * shape isn't documented and varies (SearchResults > SearchResult > Metadata), so this walks the
 * whole response instead of assuming one exact path.
 */
function collectMovieCandidates(node: unknown, depth = 0): DiscoverCandidate[] {
  if (!node || typeof node !== 'object' || depth > 8) return []
  if (Array.isArray(node)) {
    return node.flatMap(item => collectMovieCandidates(item, depth + 1))
  }
  const obj = node as Record<string, unknown>
  const found: DiscoverCandidate[] = []
  if (typeof obj.ratingKey === 'string' && obj.ratingKey && obj.type === 'movie' && typeof obj.title === 'string') {
    found.push({
      ratingKey: obj.ratingKey,
      title: obj.title,
      year: typeof obj.year === 'number' ? obj.year : null,
    })
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      found.push(...collectMovieCandidates(value, depth + 1))
    }
  }
  return found
}

/**
 * Fetch full metadata for a Discover ratingKey and check whether its external-id list (Guid)
 * contains the given TMDb id. Search results never carry external ids (confirmed by inspecting
 * real responses) — only this per-item detail endpoint does — so this is the only way to verify
 * a candidate with certainty instead of trusting title/year matching alone, which can collide
 * (same-titled remakes, franchise re-releases, etc).
 */
async function verifyRatingKeyMatchesTmdbId(
  userToken: string,
  ratingKey: string,
  tmdbId: number
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${PLEX_METADATA_BASE}/library/metadata/${ratingKey}`, {
      headers: plexSyncHeaders(userToken),
    })
    if (!res.ok) return false
    const data = await res.json().catch(() => null)
    const guidList = data?.MediaContainer?.Metadata?.[0]?.Guid
    if (!Array.isArray(guidList)) return false
    return guidList.some((g: any) => g?.id === `tmdb://${tmdbId}`)
  } catch {
    return false
  }
}

/**
 * Resolve a Plex Discover ratingKey for an arbitrary TMDb movie, verified by exact TMDb id —
 * not just title/year — so a Watchlist add can never land on the wrong movie (e.g. same-titled
 * remakes). Needed because extractPlexMetadataKey/getPlexEntryForSync only resolve movies
 * already present in the user's own Plex library, which is the wrong source for most Watchlist
 * entries (TMDb-catalog swipes the user may not own).
 *
 * Two-step because Plex's search API doesn't expose external ids: search by title to get
 * title/year candidates, then fetch each candidate's full metadata (which does carry a Guid
 * list) until one verifies against tmdbId. Almost always resolves on the first candidate since
 * search results are relevance-ranked.
 */
export async function resolvePlexDiscoverRatingKey(
  userToken: string,
  tmdbId: number,
  title: string,
  year: number | null
): Promise<string | undefined> {
  try {
    const url = `${PLEX_DISCOVER_BASE}/library/search?query=${encodeURIComponent(title)}&searchTypes=movies&searchProviders=discover&limit=20`
    const res = await fetchWithTimeout(url, { headers: plexSyncHeaders(userToken) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      log.warn(
        `[plex-sync] Discover search failed for title="${title}": ${res.status} ${body.slice(0, 300)}`
      )
      return undefined
    }
    const data = await res.json().catch(() => null)
    if (!data) return undefined

    // Rank by title/year closeness for efficiency (fewer detail fetches in the common case), but
    // don't exclude anything by title text — Plex's own catalog title for a movie can differ
    // from TMDb's (franchise prefixes, subtitle differences, etc), so the tmdbId verification
    // below is the actual source of truth, not this ranking.
    const normalizedTitle = normalizeTitle(title)
    const candidates = collectMovieCandidates(data).sort((a, b) => {
      const scoreOf = (c: DiscoverCandidate) => {
        let s = 0
        if (normalizeTitle(c.title) === normalizedTitle) s -= 10
        if (year != null && c.year != null) s += Math.abs(c.year - year)
        return s
      }
      return scoreOf(a) - scoreOf(b)
    })

    for (const candidate of candidates.slice(0, 10)) {
      if (await verifyRatingKeyMatchesTmdbId(userToken, candidate.ratingKey, tmdbId)) {
        return candidate.ratingKey
      }
    }

    log.warn(
      `[plex-sync] Discover search found no tmdbId-verified match for tmdbId=${tmdbId} title="${title}" year=${year} (${candidates.length} candidates checked)`
    )
    return undefined
  } catch (err) {
    log.error(`[plex-sync] Discover search error for title="${title}": ${err}`)
    return undefined
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
