// Resolves which personal Plex/Emby/Jellyfin servers are available to a user right now — their
// own connected server(s), plus any accepted friends' servers shared with them — and fetches
// each on demand with a short-lived cache. Deliberately separate from the instance-wide admin
// config (core/config.ts) and its persistent singleton caches (integrations/*/cache.ts), which
// remain untouched for the legacy web/Docker flow. See src/features/session/session.ts's
// sendNextBatch for how this plugs into the swipe-deck attempt loop.

import { getSharedServersForUser, getUserSettings } from '../auth/user-db.ts'
import { fetchPlexLibraryOnDemand } from '../../api/plex.ts'
import {
  fetchMediaServerLibraryOnDemand,
  OnDemandMediaServerMovie,
} from '../../integrations/shared/media-server-cache.ts'
import { PlexVideo } from '../../api/plex.types.ts'

const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry<T> {
  data: T
  fetchedAt: number
}

const plexCache = new Map<string, CacheEntry<PlexVideo['Metadata']>>()
const mediaServerCache = new Map<string, CacheEntry<OnDemandMediaServerMovie[]>>()

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function cacheKey(provider: string, url: string, token: string): Promise<string> {
  return `${provider}:${url}:${await hashToken(token)}`
}

export async function getPersonalPlexLibrary(
  url: string,
  token: string,
  libraryFilter?: string
): Promise<PlexVideo['Metadata']> {
  const key = await cacheKey('plex', url, token)
  const hit = plexCache.get(key)
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data

  const data = await fetchPlexLibraryOnDemand(url, token, { libraryFilter })
  plexCache.set(key, { data, fetchedAt: Date.now() })
  return data
}

export async function getPersonalMediaServerLibrary(
  name: 'Emby' | 'Jellyfin',
  url: string,
  apiKey: string
): Promise<OnDemandMediaServerMovie[]> {
  const key = await cacheKey(name.toLowerCase(), url, apiKey)
  const hit = mediaServerCache.get(key)
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.data

  const data = await fetchMediaServerLibraryOnDemand(name, url, apiKey)
  mediaServerCache.set(key, { data, fetchedAt: Date.now() })
  return data
}

export type PersonalSourceOwner =
  | { type: 'own' }
  | { type: 'friend'; friendName: string }

export interface PersonalSourceDescriptor {
  provider: 'plex' | 'emby' | 'jellyfin'
  owner: PersonalSourceOwner
  url: string
  token: string
  libraryName: string
}

/**
 * All personal media sources available to a user right now. Does not fetch anything — just
 * resolves which (provider, url, token) combinations are active; callers fetch on demand via
 * getPersonalPlexLibrary/getPersonalMediaServerLibrary above.
 */
export function resolvePersonalSourcesForUser(userId: number): PersonalSourceDescriptor[] {
  const sources: PersonalSourceDescriptor[] = []
  const mine = getUserSettings(userId)

  if (mine?.plexUrl && mine?.plexToken) {
    sources.push({
      provider: 'plex',
      owner: { type: 'own' },
      url: mine.plexUrl,
      token: mine.plexToken,
      libraryName: mine.plexLibraryName,
    })
  }
  if (mine?.embyUrl && mine?.embyApiKey) {
    sources.push({
      provider: 'emby',
      owner: { type: 'own' },
      url: mine.embyUrl,
      token: mine.embyApiKey,
      libraryName: mine.embyLibraryName,
    })
  }
  if (mine?.jellyfinUrl && mine?.jellyfinApiKey) {
    sources.push({
      provider: 'jellyfin',
      owner: { type: 'own' },
      url: mine.jellyfinUrl,
      token: mine.jellyfinApiKey,
      libraryName: mine.jellyfinLibraryName,
    })
  }

  for (const shared of getSharedServersForUser(userId)) {
    if (shared.plexUrl && shared.plexToken) {
      sources.push({
        provider: 'plex',
        owner: { type: 'friend', friendName: shared.friendUsername },
        url: shared.plexUrl,
        token: shared.plexToken,
        libraryName: shared.plexLibraryName,
      })
    }
    if (shared.embyUrl && shared.embyApiKey) {
      sources.push({
        provider: 'emby',
        owner: { type: 'friend', friendName: shared.friendUsername },
        url: shared.embyUrl,
        token: shared.embyApiKey,
        libraryName: shared.embyLibraryName,
      })
    }
    if (shared.jellyfinUrl && shared.jellyfinApiKey) {
      sources.push({
        provider: 'jellyfin',
        owner: { type: 'friend', friendName: shared.friendUsername },
        url: shared.jellyfinUrl,
        token: shared.jellyfinApiKey,
        libraryName: shared.jellyfinLibraryName,
      })
    }
  }

  return sources
}
