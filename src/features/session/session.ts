// deno-lint-ignore-file
import * as log from 'jsr:@std/log'
import { assert } from '../../core/assert.ts'
import { errorMessage } from '../../core/errors.ts'
import {
  getAllMovies,
  getRandomMovie,
  getFilteredRandomMovie,
  NoMoreMoviesError,
} from '../../api/plex.ts'
import { WebSocket } from '../../infra/ws/websocketServer.ts'
import { loginRateLimiter } from '../../infra/http/ip-rate-limiter.ts'
import { verifyPassword } from '../../core/security.ts'
import { validateAccessSession } from '../../core/access-session-store.ts'
import { enrich, EnrichmentPayload } from '../catalog/enrich.ts'
import { discoverMovies } from '../catalog/discover.ts'
import { isMovieInRadarr } from '../../api/radarr.ts'
import {
  isMovieInPlex,
  waitForPlexCacheReady,
  getPlexEntryForSync,
} from '../../integrations/plex/cache.ts'
import {
  isMovieInEmby,
  getAllEmbyMovies,
} from '../../integrations/emby/cache.ts'
import {
  isMovieInJellyfin,
  getAllJellyfinMovies,
} from '../../integrations/jellyfin/cache.ts'
import {
  getAccessPassword,
  getDataDir,
  getEmbyLibraryName,
  getJellyfinLibraryName,
  getMovieBatchSize,
  getPaidStreamingServices,
  getPersonalMediaSources,
  getPlexLibraryName,
  getRootPath,
  getTmdbApiKey,
} from '../../core/config.ts'
import { findSessionByUserId } from '../../core/user-session-store.ts'
import { tmdbFetch } from '../../api/tmdb.ts'
import {
  validateTMDbPoster,
  getBestPosterPath,
  isMovieValid,
} from '../media/poster-validation.ts'
import {
  getBestPosterUrl,
  prefetchPoster,
} from '../../services/cache/poster-cache.ts'
import { tmdbRateLimiter } from '../../core/rate-limiter.ts'
import {
  addToPlexWatchlist,
  removeFromPlexWatchlist,
  extractPlexMetadataKey,
  resolvePlexDiscoverRatingKey,
  scrobbleOnServer,
  unscrobbleOnServer,
} from '../../api/plex-sync.ts'
import {
  refreshTraktToken,
  addToTraktWatchlist,
  removeFromTraktWatchlist,
  addToTraktHistory,
  removeFromTraktHistory,
} from '../../api/trakt.ts'
import {
  getUserSettings,
  upsertUserSettings,
  getFriendConnections,
  getUserPlexAuthToken,
  getUserTraktLoginTokens,
  setUserTraktLoginTokens,
  UserSettings,
} from '../auth/user-db.ts'
import {
  resolvePersonalSourcesForUser,
  getPersonalPlexLibrary,
  getPersonalMediaServerLibrary,
  findInPersonalPlexLibrary,
  PersonalSourceDescriptor,
} from './personal-media-sources.ts'

// Genre ID to name mapping (TMDb genre IDs)
const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
}

// Helper function to convert genre IDs to names
function genreIdsToNames(genreIds: (number | string)[]): string[] {
  return genreIds.map(id => {
    if (typeof id === 'string') return id
    return GENRE_MAP[id] || String(id)
  })
}

// Helper function to ensure a movie has Comparr score calculated and rating HTML updated
function ensureComparrScore(movie: any): void {
  try {
    // Safety check - ensure movie exists
    if (!movie) {
      return
    }

    // Skip if movie doesn't have any ratings (null/undefined)
    const hasTmdb = typeof movie.rating_tmdb === 'number'

    if (!hasTmdb) {
      return
    }

    /*
    // Calculate Comparr score if missing (requires at least 2 ratings)
    const ratings = [];
    if (hasImdb) ratings.push(movie.rating_imdb);
    if (hasTmdb) ratings.push(movie.rating_tmdb);

    if (ratings.length >= 2 && (movie.rating_comparr === null || movie.rating_comparr === undefined)) {
      const sum = ratings.reduce((acc, val) => acc + val, 0);
      movie.rating_comparr = Math.round((sum / ratings.length) * 10) / 10;
    }
    */

    // Rebuild rating HTML string if we have a Comparr score
    if (movie.rating_comparr !== null && movie.rating_comparr !== undefined) {
      const basePath = getRootPath() || ''
      const parts: string[] = []

      parts.push(
        `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> <span class="rating-value">${movie.rating_comparr}</span>`
      )
      if (movie.rating_tmdb != null) {
        parts.push(
          `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> <span class="rating-value">${movie.rating_tmdb}</span>`
        )
      }

      if (parts.length > 0) {
        movie.rating = parts.join(' ')
      }
    }
  } catch (err) {
    log.error(`ensureComparrScore failed for movie: ${errorMessage(err)}`)
  }
}

// -------------------------
// Types
// -------------------------
interface Response {
  guid: string
  wantsToWatch: boolean | null // true = like, false = dislike, null = seen
  tmdbId?: number | null
}

interface User {
  name: string
  responses: Response[]
  hasServerAccess?: boolean
}

interface MediaItem {
  guid: string
  title: string
  summary: string
  year: string
  art: string
  director?: string
  cast?: string[]
  castMembers?: Array<{
    name: string
    character?: string
    profilePath?: string | null
  }>
  writers?: string[]
  genres?: string[]
  contentRating?: string
  runtime?: number
  rating: string
  rating_tmdb?: number | null
  key: string
  type: 'movie' | 'artist' | 'photo' | 'show'
  streamingServices?: { subscription: any[]; free: any[] }
  watchProviders?: any[]
  streamingLink?: string | null
  tmdbId?: number | null
  trailerKey?: string | null
  // Raw TMDb genre IDs, kept alongside the resolved `genres` names — the mobile client
  // (lib/media.ts) uses these as a fallback to resolve genre names via its own TMDb genre map.
  genre_ids?: number[]
  vote_count?: number
  original_language?: string | null
  countries?: string[]
  // Present when this candidate came from a user's own or a friend's personal Plex/Emby/
  // Jellyfin server (see personal-media-sources.ts), rather than the instance-wide admin
  // library or TMDb discovery. Ephemeral — not persisted beyond this response, used only to
  // drive the mobile client's "in your library" / "in <friend>'s library" swipe-card badge.
  personalSource?: {
    type: 'own' | 'friend'
    provider: 'plex' | 'emby' | 'jellyfin'
    friendName?: string
  }
}

interface DiscoverQueue {
  currentPage: number
  buffer: any[]
  exhausted: boolean
  prefetchPromise?: Promise<void>
}

type DiscoverFilters = {
  yearMin?: number
  yearMax?: number
  genres?: string[]
  tmdbRating?: number
  tmdbRatingMax?: number
  languages?: string[]
  countries?: string[]
  runtimeMin?: number
  runtimeMax?: number
  voteCount?: number
  sortBy?: string
  streamingServices?: string[]
  includeFreeStreaming?: boolean
  contentRatings?: string[]
  certificationCountry?: string
}

export function extractTmdbIdFromGuid(guid?: string | null): number | null {
  if (!guid) return null

  const tmdbMatch = guid.match(/tmdb:\/\/(?:[^/]+\/)?(\d+)/i)
  if (tmdbMatch) {
    const id = parseInt(tmdbMatch[1], 10)
    return Number.isFinite(id) ? id : null
  }

  const plexMatch = guid.match(
    /com\.plexapp\.agents\.themoviedb:\/\/(?:[^/]+\/)?(\d+)/i
  )
  if (plexMatch) {
    const id = parseInt(plexMatch[1], 10)
    return Number.isFinite(id) ? id : null
  }

  return null
}

function extractImdbIdFromGuid(guid?: string | null): string | null {
  if (!guid) return null

  const imdbMatch = guid.match(/imdb:\/\/(tt\d+)/i)
  if (imdbMatch) {
    return imdbMatch[1]
  }

  return null
}

function parseYear(year: string | number | null | undefined): number | null {
  if (typeof year === 'number') {
    return Number.isFinite(year) ? year : null
  }

  if (typeof year === 'string' && year.trim().length > 0) {
    const parsed = parseInt(year, 10)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function sortFilterValue(value: any): any {
  if (Array.isArray(value)) {
    return value.map(sortFilterValue)
  }
  if (value && typeof value === 'object') {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(value).sort()) {
      const nested = value[key]
      if (nested !== undefined) {
        sorted[key] = sortFilterValue(nested)
      }
    }
    return sorted
  }
  return value
}

function stableFiltersKey(filters?: DiscoverFilters): string {
  if (!filters) return 'default'
  return JSON.stringify(sortFilterValue(filters))
}

interface UserStreamingPrefs {
  paid: string[]
  includeFree: boolean
}

// Mirrors the mobile app's parseStoredSubscriptions (app/(tabs)/profile/index.tsx) — older
// stored values were a plain string[] of selected service names (no paid/free split); treat
// those as all-paid with free off, same as the client does.
function parseUserStreamingPrefs(raw: string | undefined): UserStreamingPrefs {
  if (!raw) return { paid: [], includeFree: false }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { paid: parsed.filter((s): s is string => typeof s === 'string'), includeFree: false }
    }
    const paid = Array.isArray(parsed?.paid)
      ? parsed.paid.filter((s: unknown): s is string => typeof s === 'string')
      : []
    return { paid, includeFree: Boolean(parsed?.includeFree) }
  } catch {
    return { paid: [], includeFree: false }
  }
}

const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_FILTERS_KEY = stableFiltersKey(undefined)
const DEFAULT_DISCOVER_PREFETCH_PAGES = Number(
  Deno.env.get('DISCOVER_CACHE_DEFAULT_PAGES') ?? '10'
)
const FILTERED_DISCOVER_PREFETCH_PAGES = Number(
  Deno.env.get('DISCOVER_CACHE_FILTERED_PAGES') ?? '2'
)
const SEND_BATCH_SOFT_TIMEOUT_MS = Number(
  Deno.env.get('SEND_BATCH_SOFT_TIMEOUT_MS') ?? '15000'
)
const SEND_BATCH_HARD_TIMEOUT_MS = Number(
  Deno.env.get('SEND_BATCH_HARD_TIMEOUT_MS') ?? '45000'
)
const INITIAL_BATCH_HARD_TIMEOUT_MS = Number(
  Deno.env.get('INITIAL_BATCH_HARD_TIMEOUT_MS') ?? '12000'
)
const LOGIN_PREFETCH_SOFT_TIMEOUT_MS = Number(
  Deno.env.get('LOGIN_PREFETCH_SOFT_TIMEOUT_MS') ?? '2500'
)
// The soft timeout above only applies once at least one movie has already been found: with
// zero movies found so far, sendNextBatch falls through to its hard timeout instead, which
// otherwise defaults to INITIAL_BATCH_HARD_TIMEOUT_MS (12s) for a brand new room — and this
// whole prefetch blocks the loginResponse, so the client's "Connecting…" screen would inherit
// that same 12s worst case. The mobile client already requests a follow-up batch right after
// login if it comes back short (see discover-store.ts's loginResponse handler), so it's safe
// to cap this well below that.
const LOGIN_PREFETCH_HARD_TIMEOUT_MS = Number(
  Deno.env.get('LOGIN_PREFETCH_HARD_TIMEOUT_MS') ?? '4000'
)
const ENRICHMENT_TIMEOUT_MS = Number(
  Deno.env.get('ENRICHMENT_TIMEOUT_MS') ?? '5000'
)
const DISCOVER_ENRICH_PREWARM_COUNT = Number(
  Deno.env.get('DISCOVER_ENRICH_PREWARM_COUNT') ?? '6'
)
const DISCOVER_ENRICH_PREWARM_CONCURRENCY = Math.max(
  1,
  Number(Deno.env.get('DISCOVER_ENRICH_PREWARM_CONCURRENCY') ?? '2')
)

interface DiscoverCacheEntry {
  pages: Map<number, any[]>
  lastFetchedPage: number
  lastRefreshed: number
  exhausted: boolean
  refreshPromise?: Promise<void>
}

const discoverCache: Map<string, DiscoverCacheEntry> = new Map()

function getOrCreateCacheEntry(key: string): DiscoverCacheEntry {
  let entry = discoverCache.get(key)
  if (!entry) {
    entry = {
      pages: new Map(),
      lastFetchedPage: 0,
      lastRefreshed: 0,
      exhausted: false,
    }
    discoverCache.set(key, entry)
  }
  return entry
}

function desiredPrefetchPages(key: string) {
  return key === DEFAULT_FILTERS_KEY
    ? DEFAULT_DISCOVER_PREFETCH_PAGES
    : FILTERED_DISCOVER_PREFETCH_PAGES
}

async function fetchDiscoverPage(
  filters: DiscoverFilters | undefined,
  page: number
): Promise<any[]> {
  const discovered = await discoverMovies({
    page,
    yearMin: filters?.yearMin,
    yearMax: filters?.yearMax,
    genres: filters?.genres,
    tmdbRating: filters?.tmdbRating,
    tmdbRatingMax: filters?.tmdbRatingMax,
    languages: filters?.languages,
    countries: filters?.countries,
    runtimeMin: filters?.runtimeMin,
    runtimeMax: filters?.runtimeMax,
    voteCount: filters?.voteCount,
    sortBy: filters?.sortBy,
    streamingServices: filters?.streamingServices,
    includeFreeStreaming: filters?.includeFreeStreaming,
    contentRatings: filters?.contentRatings,
    certificationCountry: filters?.certificationCountry,
  })

  const results = discovered.results ?? []

  // Vote count filtering now handled at TMDb API level (discover.ts)
  // No need for post-filtering or new release exemptions
  return results
}

async function warmDiscoverCache(
  key: string,
  filters: DiscoverFilters | undefined,
  pagesToFetch: number,
  { reset }: { reset: boolean }
) {
  const entry = getOrCreateCacheEntry(key)
  if (entry.refreshPromise) {
    return entry.refreshPromise
  }

  entry.refreshPromise = (async () => {
    if (reset) {
      entry.pages.clear()
      entry.lastFetchedPage = 0
      entry.exhausted = false
    }

    let page = reset ? 1 : entry.lastFetchedPage + 1
    let remaining = pagesToFetch

    while (remaining > 0 && !entry.exhausted) {
      const results = await fetchDiscoverPage(filters, page)
      if (!results.length) {
        entry.pages.set(page, [])
        entry.exhausted = true
        break
      }

      entry.pages.set(page, results)
      entry.lastFetchedPage = Math.max(entry.lastFetchedPage, page)
      page += 1
      remaining -= 1
    }

    entry.lastRefreshed = Date.now()
  })()
    .catch(err => {
      log.error('Failed to warm discover cache:', err)
    })
    .finally(() => {
      entry.refreshPromise = undefined
    })

  return entry.refreshPromise
}

async function ensureCachedDiscoverPage(
  filters: DiscoverFilters | undefined,
  page: number
): Promise<{ results: any[]; exhausted: boolean }> {
  const key = stableFiltersKey(filters)
  const entry = getOrCreateCacheEntry(key)
  const targetPrefetch = Math.max(desiredPrefetchPages(key), page)
  const stale = Date.now() - entry.lastRefreshed > DISCOVER_CACHE_TTL_MS

  if ((stale || entry.pages.size === 0) && !entry.refreshPromise) {
    await warmDiscoverCache(key, filters, targetPrefetch, { reset: true })
  } else if (entry.refreshPromise) {
    await entry.refreshPromise
  }

  if (!entry.pages.has(page) && !entry.exhausted) {
    const missingPages = Math.max(0, page - entry.lastFetchedPage)
    if (missingPages > 0) {
      await warmDiscoverCache(key, filters, missingPages, { reset: false })
    }

    if (!entry.pages.has(page) && !entry.exhausted) {
      const results = await fetchDiscoverPage(filters, page)
      if (!results.length) {
        entry.exhausted = true
      }
      entry.pages.set(page, results)
      entry.lastFetchedPage = Math.max(entry.lastFetchedPage, page)
      entry.lastRefreshed = Date.now()
    }
  }

  const results = entry.pages.get(page) ?? []
  const exhausted = entry.exhausted && page >= entry.lastFetchedPage

  return { results: results.slice(), exhausted }
}

async function prewarmDefaultDiscoverCache() {
  const key = DEFAULT_FILTERS_KEY
  try {
    await warmDiscoverCache(key, undefined, desiredPrefetchPages(key), {
      reset: true,
    })
  } catch (err) {
    log.error('Initial discover cache warm failed:', err)
  }
}

prewarmDefaultDiscoverCache()

const defaultWarmInterval = setInterval(() => {
  warmDiscoverCache(
    DEFAULT_FILTERS_KEY,
    undefined,
    desiredPrefetchPages(DEFAULT_FILTERS_KEY),
    { reset: true }
  ).catch(err => {
    log.error('Scheduled discover cache warm failed:', err)
  })
}, DISCOVER_CACHE_TTL_MS)

const denoWithUnref = Deno as typeof Deno & {
  unrefTimer?: (id: number) => void
}
if (typeof denoWithUnref.unrefTimer === 'function') {
  denoWithUnref.unrefTimer(defaultWarmInterval)
}

interface WebSocketLoginMessage {
  type: 'login'
  payload: {
    name: string
    roomCode: string
    accessPassword: string
    forceTakeover?: boolean
  }
}

// Sent to just the swiping user's own socket the moment their Like completes a match with an
// accepted friend (see checkForNewFriendMatch) — not broadcast to a room, since no client ever
// puts two real users in the same room anymore (every login connects to its own personal room).
interface WebSocketMatchMessage {
  type: 'match'
  payload: { movie: MediaItem; users: string[]; createdAt: number }
}

interface WebSocketLoginResponseMessage {
  type: 'loginResponse'
  payload:
    | { success: false; message?: string; code?: string }
    | {
        success: true
        hasServerAccess: boolean
        movies: MediaItem[]
        rated: RatedPayloadItem[]
        members: string[]
      }
}

interface WebSocketResponseMessage {
  type: 'response'
  payload: Response
}

// Retracts a previously-sent response (see lib/ws-client.ts's unrespond() on the client) —
// e.g. undoing a Like/Pass/Seen.
interface WebSocketUnrespondMessage {
  type: 'unrespond'
  payload: { guid: string }
}

interface WebSocketNextBatchMessage {
  type: 'nextBatch'
  payload?: {
    yearMin?: number
    yearMax?: number
    genres?: string[]
    streamingServices?: string[]
    showPlexOnly?: boolean
    availability?: {
      anywhere?: boolean
      roomPersonalMedia?: boolean
      paidSubscriptions?: boolean
      freeStreaming?: boolean
      freeStreamingServices?: string[]
      subscriptionServices?: string[]
    }
    contentRatings?: string[]
    certificationCountry?: string
    tmdbRating?: number
    tmdbRatingMax?: number
    languages?: string[]
    countries?: string[]
    directors?: Array<{ id: number; name: string }>
    actors?: Array<{ id: number; name: string }>
    runtimeMin?: number
    runtimeMax?: number
    voteCount?: number
    sortBy?: string
  }
}

// Items to send back to the client on login so it can hydrate Watch/Pass
interface RatedPayloadItem {
  guid: string
  wantsToWatch: boolean | null // true = like, false = dislike, null = seen
  tmdbId?: number | null
  movie?: MediaItem // omitted for Seen items to keep loginResponse payload small
}

type WebSocketMessage =
  | WebSocketLoginMessage
  | WebSocketResponseMessage
  | WebSocketNextBatchMessage
  | WebSocketUnrespondMessage

export interface ImdbImportHistoryEntry {
  id: string
  fileName: string
  uploadedAt: number
  movieCount: number
  status: 'successful' | 'failed'
}

// -------------------------
// Persistence (rooms + movie index) - ENHANCED VERSION
// -------------------------
type PersistedRoomUser = {
  name: string
  responses: Response[]
  importHistory?: ImdbImportHistoryEntry[]
}

type PersistedRooms = Record<
  string,
  {
    users: PersistedRoomUser[]
  }
>

interface PersistedState {
  rooms: PersistedRooms
  movieIndex: Record<string, MediaItem> // guid -> MediaItem (for rebuilding matches)
}

const DATA_DIR = getDataDir()
const STATE_FILE = `${DATA_DIR}/session-state.json`
const BACKUP_FILE = `${DATA_DIR}/session-state.backup.json`

async function ensureDataDir() {
  try {
    await Deno.mkdir(DATA_DIR, { recursive: true })

    // Test write permissions
    const testFile = `${DATA_DIR}/.write-test`
    await Deno.writeTextFile(testFile, 'test')
    try {
      await Deno.remove(testFile)
    } catch (err) {
      // If another process already cleaned up the probe file, that's okay.
      if (!(err instanceof Deno.errors.NotFound)) throw err
    }

    log.info(`Data directory confirmed: ${DATA_DIR}`)
  } catch (err) {
    log.error(`Failed to create or test data directory ${DATA_DIR}: ${err}`)
    throw err
  }
}

async function loadState(): Promise<PersistedState> {
  await ensureDataDir()
  try {
    const raw = await Deno.readTextFile(STATE_FILE)
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      log.warn(`Failed to parse persisted session state JSON: ${err}`)
      throw new Error('invalid session state json')
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('bad state')

    // Accept both shapes:
    // - new: rooms[code].users = Array<{name,responses}>
    // - old: rooms[code].users = Record<name, {responses}>
    const roomsIn: any = parsed.rooms || {}
    const roomsOut: PersistedRooms = {}

    for (const roomCode in roomsIn) {
      const roomVal: any = roomsIn[roomCode] || {}
      const usersRaw: any = roomVal.users

      let usersArr: PersistedRoomUser[] = []
      if (Array.isArray(usersRaw)) {
        usersArr = usersRaw.map((user: any) => ({
          name: String(user?.name || ''),
          responses: Array.isArray(user?.responses)
            ? user.responses
                .filter(
                  (r: any) => typeof r?.guid === 'string' && r.guid.length > 0
                )
                .map((r: any) => ({
                  guid: r.guid,
                  wantsToWatch: r?.wantsToWatch ?? null,
                  tmdbId:
                    typeof r?.tmdbId === 'number'
                      ? r.tmdbId
                      : r?.tmdbId == null
                      ? null
                      : Number.isFinite(Number(r.tmdbId))
                      ? Number(r.tmdbId)
                      : null,
                }))
            : [],
          importHistory: Array.isArray(user?.importHistory)
            ? user.importHistory
                .filter((entry: any) => typeof entry?.id === 'string')
                .map((entry: any) => ({
                  id: entry.id,
                  fileName:
                    typeof entry.fileName === 'string' &&
                    entry.fileName.trim().length > 0
                      ? entry.fileName.trim()
                      : 'IMDb CSV',
                  uploadedAt:
                    typeof entry.uploadedAt === 'number' &&
                    Number.isFinite(entry.uploadedAt)
                      ? entry.uploadedAt
                      : Date.now(),
                  movieCount:
                    typeof entry.movieCount === 'number' &&
                    Number.isFinite(entry.movieCount)
                      ? entry.movieCount
                      : 0,
                  status: entry.status === 'failed' ? 'failed' : 'successful',
                }))
            : [],
        }))
      } else if (usersRaw && typeof usersRaw === 'object') {
        usersArr = []
        for (const name in usersRaw) {
          const val: any = usersRaw[name]
          const responses: Response[] = Array.isArray(val?.responses)
            ? val.responses
                .filter(
                  (r: any) => typeof r?.guid === 'string' && r.guid.length > 0
                )
                .map((r: any) => ({
                  guid: r.guid,
                  wantsToWatch: r?.wantsToWatch ?? null,
                  tmdbId:
                    typeof r?.tmdbId === 'number'
                      ? r.tmdbId
                      : r?.tmdbId == null
                      ? null
                      : Number.isFinite(Number(r.tmdbId))
                      ? Number(r.tmdbId)
                      : null,
                }))
            : []
          usersArr.push({ name, responses, importHistory: [] })
        }
      }

      roomsOut[roomCode] = { users: usersArr }
    }

    return {
      rooms: roomsOut,
      movieIndex: parsed.movieIndex || {},
    }
  } catch {
    return { rooms: {}, movieIndex: {} }
  }
}

async function saveState(state: PersistedState) {
  await ensureDataDir()

  try {
    // Create backup of current file if it exists
    try {
      await Deno.copyFile(STATE_FILE, BACKUP_FILE)
    } catch {
      // Backup failed, but continue with save
    }

    // Atomic write using temporary file
    const tmp = `${STATE_FILE}.tmp.${Date.now()}`
    const stateJson = JSON.stringify(state, null, 2)

    await Deno.writeTextFile(tmp, stateJson)
    await Deno.rename(tmp, STATE_FILE)

    // Verify the write was successful
    const verification = await Deno.readTextFile(STATE_FILE)
    if (verification !== stateJson) {
      throw new Error('State verification failed after write')
    }

    log.info(
      `State saved successfully: ${Object.keys(state.rooms).length} rooms, ${
        Object.keys(state.movieIndex).length
      } movies`
    )
  } catch (err) {
    log.error(`Failed to save state: ${err}`)

    // Try to restore from backup if main file is corrupted
    try {
      await Deno.copyFile(BACKUP_FILE, STATE_FILE)
      log.info('Restored state from backup after save failure')
    } catch (restoreErr) {
      log.error(`Failed to restore from backup: ${restoreErr}`)
    }

    throw err
  }
}

// One in-memory copy we mutate, always saved after changes
const persistedState: PersistedState = await loadState()

const movieIndexByTmdbId = new Map<number, MediaItem>()
const movieIndexTmdbByGuid = new Map<string, number>()

function rebuildMovieIndexMaps() {
  movieIndexByTmdbId.clear()
  movieIndexTmdbByGuid.clear()
  for (const movie of Object.values(persistedState.movieIndex)) {
    const tmdbId = extractTmdbIdFromMovie(movie)
    if (tmdbId != null) {
      movieIndexByTmdbId.set(tmdbId, movie)
      movieIndexTmdbByGuid.set(movie.guid, tmdbId)
    }
  }
}

function updateMovieIndexEntry(movie: MediaItem) {
  const previous = movieIndexTmdbByGuid.get(movie.guid)
  if (
    previous != null &&
    movieIndexByTmdbId.get(previous)?.guid === movie.guid
  ) {
    movieIndexByTmdbId.delete(previous)
  }

  persistedState.movieIndex[movie.guid] = movie

  const tmdbId = extractTmdbIdFromMovie(movie)
  if (tmdbId != null) {
    movieIndexByTmdbId.set(tmdbId, movie)
    movieIndexTmdbByGuid.set(movie.guid, tmdbId)
  } else {
    movieIndexTmdbByGuid.delete(movie.guid)
  }
}

function findMovieByTmdbId(tmdbId: number): MediaItem | undefined {
  const existing = movieIndexByTmdbId.get(tmdbId)
  if (existing) return existing

  // Fallback in case the map is out of sync
  for (const movie of Object.values(persistedState.movieIndex)) {
    const extracted = extractTmdbIdFromMovie(movie)
    if (extracted === tmdbId) {
      updateMovieIndexEntry(movie)
      return movie
    }
  }

  return undefined
}

rebuildMovieIndexMaps()

function upsertRoomUser(roomCode: string, user: User) {
  const room = (persistedState.rooms[roomCode] ??= { users: [] })
  const idx = room.users.findIndex(u => u.name === user.name)
  if (idx >= 0) {
    // Preserve importHistory — it lives on PersistedRoomUser but not on the
    // in-memory User object, so we must not lose it when writing back.
    const existing = room.users[idx]
    room.users[idx] = {
      name: user.name,
      responses: user.responses,
      importHistory: existing.importHistory,
    }
  } else {
    room.users.push({ name: user.name, responses: user.responses })
  }
}

function removeRoomUser(roomCode: string, userName: string) {
  const room = persistedState.rooms[roomCode]
  if (!room) return
  room.users = room.users.filter(u => u.name !== userName)
}

function getRoomUser(roomCode: string, userName: string): PersistedRoomUser {
  const room = (persistedState.rooms[roomCode] ??= { users: [] })
  let user = room.users.find(u => u.name === userName)
  if (!user) {
    user = { name: userName, responses: [], importHistory: [] }
    room.users.push(user)
  }
  if (!Array.isArray(user.importHistory)) {
    user.importHistory = []
  }
  return user
}

export function recordImdbImportHistoryStart(
  roomCode: string,
  userName: string,
  fileName: string,
  movieCount: number
): string {
  const user = getRoomUser(roomCode, userName)
  const id = crypto.randomUUID()
  user.importHistory!.unshift({
    id,
    fileName: fileName.trim() || 'IMDb CSV',
    uploadedAt: Date.now(),
    movieCount,
    status: 'successful',
  })
  user.importHistory = user.importHistory!.slice(0, 25)
  return id
}

export function finalizeImdbImportHistory(
  roomCode: string,
  userName: string,
  importId: string,
  status: 'successful' | 'failed'
) {
  const user = getRoomUser(roomCode, userName)
  const entry = user.importHistory?.find(item => item.id === importId)
  if (entry) {
    entry.status = status
  }
}

export function getImdbImportHistory(
  roomCode: string,
  userName: string
): ImdbImportHistoryEntry[] {
  const room = persistedState.rooms[roomCode]
  if (!room) return []
  const user = room.users.find(u => u.name === userName)
  if (!user?.importHistory) return []
  return [...user.importHistory]
}

function addMoviesToIndex(movies: MediaItem[]) {
  for (const m of movies) {
    updateMovieIndexEntry(m)
  }
}

function normalizeStreamingServices(
  movie: MediaItem
): {
  subscription: any[]
  free: any[]
  changed: boolean
} {
  const existing: any = (movie as any).streamingServices
  let changed = false

  if (existing && !Array.isArray(existing)) {
    const subscription = Array.isArray(existing.subscription)
      ? existing.subscription.map((service: any) => ({ ...service }))
      : []
    const free = Array.isArray(existing.free)
      ? existing.free.map((service: any) => ({ ...service }))
      : []

    if (
      !Array.isArray(existing.subscription) ||
      !Array.isArray(existing.free)
    ) {
      changed = true
    }

    return { subscription, free, changed }
  }

  if (Array.isArray(existing)) {
    const subscription = existing.map((service: any) =>
      typeof service === 'string'
        ? { id: 0, name: service, logo_path: null, type: 'subscription' }
        : { ...service }
    )
    changed = true
    return { subscription, free: [], changed }
  }

  changed = true
  return { subscription: [], free: [], changed }
}

function extractTmdbIdFromMovie(movie: MediaItem): number | null {
  if (typeof movie.tmdbId === 'number' && Number.isFinite(movie.tmdbId)) {
    return movie.tmdbId
  }

  const fromGuid = extractTmdbIdFromGuid(movie.guid)
  if (fromGuid != null) return fromGuid

  const streamingLink = (movie as any).streamingLink
  if (typeof streamingLink === 'string') {
    const match = streamingLink.match(/themoviedb\.org\/movie\/(\d+)/)
    if (match) {
      const id = parseInt(match[1], 10)
      if (Number.isFinite(id)) return id
    }
  }

  return null
}

function extractImdbIdFromMovie(movie: MediaItem): string | null {
  if (
    movie &&
    typeof (movie as any).imdbId === 'string' &&
    (movie as any).imdbId.length > 0
  ) {
    return (movie as any).imdbId
  }

  const fromGuid = extractImdbIdFromGuid(movie.guid)
  if (fromGuid) return fromGuid

  const guidArray = (movie as any)?.Guid
  if (Array.isArray(guidArray)) {
    const imdbGuid = guidArray.find(
      (entry: any) =>
        typeof entry?.id === 'string' && /imdb:\/\//.test(entry.id)
    )
    if (imdbGuid?.id) {
      return extractImdbIdFromGuid(imdbGuid.id)
    }
  }

  return null
}

function dedupeUserResponses(user: User, session?: Session): boolean {
  const deduped: Response[] = []
  const indexByGuid = new Map<string, number>()
  const indexByTmdb = new Map<number, number>()
  let changed = false

  const resolveTmdbId = (response: Response): number | null => {
    const explicit =
      typeof response.tmdbId === 'number' && Number.isFinite(response.tmdbId)
        ? response.tmdbId
        : null
    if (explicit != null) return explicit

    const fromGuid = extractTmdbIdFromGuid(response.guid)
    if (fromGuid != null) return fromGuid

    if (session) {
      const movie = session.movieForGuid(response.guid)
      if (movie?.tmdbId != null) {
        return movie.tmdbId
      }
    }

    return null
  }

  const pickBestGuid = (
    candidate: string | undefined,
    fallback: string | undefined
  ): string => {
    const trimmedCandidate = typeof candidate === 'string' ? candidate : ''
    const trimmedFallback = typeof fallback === 'string' ? fallback : ''

    if (session) {
      if (trimmedCandidate && session.movieForGuid(trimmedCandidate)) {
        return trimmedCandidate
      }
      if (trimmedFallback && session.movieForGuid(trimmedFallback)) {
        return trimmedFallback
      }
    }

    return trimmedCandidate || trimmedFallback || ''
  }

  for (const response of user.responses) {
    const guid = typeof response.guid === 'string' ? response.guid : ''
    const tmdbId = resolveTmdbId(response)

    const guidIndex = guid ? indexByGuid.get(guid) : undefined
    const tmdbIndex = tmdbId != null ? indexByTmdb.get(tmdbId) : undefined
    const existingIndex = tmdbIndex ?? guidIndex

    if (existingIndex != null) {
      const existing = deduped[existingIndex]
      const mergedGuid = pickBestGuid(guid, existing.guid)
      const mergedTmdb = tmdbId != null ? tmdbId : existing.tmdbId ?? null
      if (
        existing.guid !== mergedGuid ||
        existing.wantsToWatch !== response.wantsToWatch ||
        (existing.tmdbId ?? null) !== (mergedTmdb ?? null)
      ) {
        deduped[existingIndex] = {
          guid: mergedGuid,
          wantsToWatch: response.wantsToWatch,
          tmdbId: mergedTmdb,
        }
        changed = true
      }

      if (guid) indexByGuid.set(guid, existingIndex)
      if (tmdbId != null) indexByTmdb.set(tmdbId, existingIndex)
      continue
    }

    const normalized: Response = {
      guid,
      wantsToWatch: response.wantsToWatch,
      tmdbId: tmdbId ?? null,
    }
    if (normalized.tmdbId !== response.tmdbId) {
      changed = true
    }

    deduped.push(normalized)
    const newIndex = deduped.length - 1
    if (guid) indexByGuid.set(guid, newIndex)
    if (tmdbId != null) indexByTmdb.set(tmdbId, newIndex)
  }

  if (deduped.length !== user.responses.length) {
    changed = true
  }

  if (changed) {
    user.responses = deduped
  }

  return changed
}

// -------------------------
// Session class
// -------------------------
class Session {
  users: Map<User, WebSocket | null> = new Map()
  roomCode: string

  // What the UI previously used to search for movie details when likes come in.
  // After a restart, movieList may be empty, so we fall back to the global movieIndex.
  movieList: MediaItem[] = []

  private discoverQueues: Map<string, DiscoverQueue> = new Map()
  private tmdbFormatCache: Map<number, any> = new Map()
  private tmdbFormatInFlight: Map<number, Promise<any>> = new Map()
  private enrichmentCache: Map<string, Promise<any | undefined>> = new Map()

  constructor(roomCode: string) {
    this.roomCode = roomCode

    // Rehydrate users from persisted state (if any)
    const room = persistedState.rooms[roomCode]
    if (room) {
      for (const u of room.users) {
        // Store users now with null ws; real sockets are added on login
        const hydratedUser: User = {
          name: u.name,
          responses: (u.responses ?? [])
            .filter(r => typeof r?.guid === 'string' && r.guid.length > 0)
            .map(r => ({
              guid: r.guid,
              wantsToWatch: r.wantsToWatch,
              tmdbId: r.tmdbId ?? null,
            })),
        }
        dedupeUserResponses(hydratedUser, this)
        this.users.set(hydratedUser, null)
      }
    }
  }

  private resolveDiscoverQueue(filters?: DiscoverFilters) {
    const key = stableFiltersKey(filters)
    let queue = this.discoverQueues.get(key)
    if (!queue) {
      const startPage =
        key === DEFAULT_FILTERS_KEY
          ? 1
          : Math.max(1, Math.floor(Math.random() * 5) + 1)
      queue = { currentPage: startPage, buffer: [], exhausted: false }
      this.discoverQueues.set(key, queue)
    }
    return { key, queue }
  }

  private async loadDiscoverPage(
    queue: DiscoverQueue,
    filters?: DiscoverFilters
  ): Promise<void> {
    if (queue.exhausted) return

    const page = queue.currentPage
    queue.currentPage += 1

    let fetched = await ensureCachedDiscoverPage(filters, page)

    // resolveDiscoverQueue starts non-default queues on a random page (1-5) for variety on
    // broad searches — but a narrow result set (e.g. 17 total matches, all on page 1) can have
    // that random start overshoot past the end before we've ever found anything. Retry from
    // page 1 (guaranteed to exist if there's anything at all) once before concluding the queue
    // is really exhausted, rather than reporting "no movies" when there actually are some.
    if (!fetched.results.length && queue.buffer.length === 0 && page !== 1) {
      fetched = await ensureCachedDiscoverPage(filters, 1)
      queue.currentPage = 2
    }

    if (!fetched.results.length) {
      queue.exhausted = true
      return
    }

    const shuffled = fetched.results.slice().sort(() => Math.random() - 0.5)
    queue.buffer.push(...shuffled)

    this.prewarmDiscoverEnrichment(shuffled)

    if (fetched.exhausted) {
      queue.exhausted = true
    }
  }

  private prewarmDiscoverEnrichment(tmdbMovies: any[]): void {
    if (DISCOVER_ENRICH_PREWARM_COUNT <= 0 || tmdbMovies.length === 0) {
      return
    }

    const candidates = tmdbMovies
      .filter(movie => movie && typeof movie.id === 'number')
      .slice(0, DISCOVER_ENRICH_PREWARM_COUNT)

    if (!candidates.length) return

    const workers = Array.from(
      {
        length: Math.min(
          DISCOVER_ENRICH_PREWARM_CONCURRENCY,
          candidates.length
        ),
      },
      (_, workerIndex) =>
        (async () => {
          for (
            let idx = workerIndex;
            idx < candidates.length;
            idx += DISCOVER_ENRICH_PREWARM_CONCURRENCY
          ) {
            const movie = candidates[idx]

            try {
              if (movie.poster_path) {
                prefetchPoster(movie.poster_path, 'tmdb')
              }

              await enrich({
                title: movie.title,
                year: parseYear(movie.release_date?.slice(0, 4)) ?? null,
                plexGuid: `tmdb://${movie.id}`,
                tmdbId: movie.id,
              })
            } catch (err) {
              log.debug(
                `Discover enrichment prewarm failed for ${
                  movie?.title ?? 'unknown movie'
                }: ${err}`
              )
            }
          }
        })()
    )

    Promise.allSettled(workers).catch(err => {
      log.debug(`Discover enrichment prewarm scheduling failed: ${err}`)
    })
  }

  private async ensureDiscoverBuffer(
    queue: DiscoverQueue,
    filters?: DiscoverFilters
  ) {
    while (queue.buffer.length === 0 && !queue.exhausted) {
      if (queue.prefetchPromise) {
        await queue.prefetchPromise
      } else {
        queue.prefetchPromise = this.loadDiscoverPage(queue, filters)
        try {
          await queue.prefetchPromise
        } finally {
          queue.prefetchPromise = undefined
        }
      }
    }
  }

  private prefetchDiscoverPage(
    queue: DiscoverQueue,
    filters?: DiscoverFilters
  ): void {
    if (queue.exhausted || queue.prefetchPromise) return
    queue.prefetchPromise = this.loadDiscoverPage(queue, filters)
      .catch(err => {
        log.error('Prefetch discover page failed:', err)
      })
      .finally(() => {
        queue.prefetchPromise = undefined
      })
  }

  movieForGuid(guid: string): MediaItem | undefined {
    // Prefer a movie we've sent in this session, else the global index
    return (
      this.movieList.find(m => m.guid === guid) ||
      persistedState.movieIndex[guid]
    )
  }

  private tmdbIdForGuid(guid: string): number | null {
    const parsed = extractTmdbIdFromGuid(guid)
    if (parsed != null) return parsed

    const movie = this.movieForGuid(guid)
    return movie?.tmdbId ?? null
  }

  add = (user: User, ws: WebSocket) => {
    this.users.set(user, ws)

    ws.addListener('message', msg => this.handleMessage(user, msg))
    ws.addListener('close', () => this.remove(user, ws))

    // persist presence (even if ws is null now)
    upsertRoomUser(this.roomCode, user)
    saveState(persistedState).catch(err =>
      log.warn(`Failed to save state on add(): ${err}`)
    )

  }

  remove = (user: User, ws: WebSocket) => {
    log.debug(`User ${user?.name} was removed`)
    ws.removeAllListeners()
    // Guard: if a forceTakeover registered a new socket for this user before
    // the old socket's close event fired, don't null out the new socket.
    if (this.users.get(user) !== ws) return

    this.users.set(user, null)
    const activeUsers = [...this.users.values()].filter(s => !s?.isClosed)
    if (activeUsers.length === 0) {
      this.destroy()
    }
  }

  handleMessage = async (user: User, msg: string) => {
    let decodedMessage: WebSocketMessage
    try {
      decodedMessage = JSON.parse(msg)
    } catch (err) {
      log.warn(
        `Received invalid WebSocket JSON from ${user.name}: ${errorMessage(err)}`
      )
      try {
        this.users.get(user)?.send(
          JSON.stringify({
            type: 'error',
            payload: { message: 'Invalid message format' },
          })
        )
      } catch {
        // no-op
      }
      this.users.get(user)?.close(1003, 'Invalid message format')
      return
    }

    try {
      log.debug(
        `Received WebSocket message from ${user.name}: type=${decodedMessage.type}`
      )
      switch (decodedMessage.type) {
        case 'nextBatch': {
          const filters = decodedMessage.payload || {}
          log.info(
            `${user.name} asked for the next batch of movies with filters: ${JSON.stringify(filters)}`
          )
          await this.sendNextBatch(filters, undefined, user)
          break
        }
        case 'response': {
          const { guid, wantsToWatch } = decodedMessage.payload
          log.info(`[response] ${user.name} rated guid=${guid} wantsToWatch=${wantsToWatch}`)
          assert(
            typeof guid === 'string' &&
              (typeof wantsToWatch === 'boolean' || wantsToWatch === null),
            'Response message was empty'
          )

          const movie = this.movieForGuid(guid)
          log.info(`[response] movieForGuid result: ${movie ? movie.title : 'NOT FOUND'}, movieListSize=${this.movieList.length}`)
          const resolvedTmdbId =
            movie?.tmdbId ??
            extractTmdbIdFromGuid(movie?.guid) ??
            extractTmdbIdFromGuid(guid) ??
            null

          let responsesMutated = false

          // Find existing response by guid or TMDb id
          const existingIndexByGuid = user.responses.findIndex(
            _ => _.guid === guid
          )
          let targetIndex = existingIndexByGuid

          if (targetIndex < 0 && resolvedTmdbId != null) {
            targetIndex = user.responses.findIndex(existing => {
              const existingTmdb =
                existing.tmdbId ??
                this.tmdbIdForGuid(existing.guid) ??
                extractTmdbIdFromGuid(existing.guid) ??
                null
              return existingTmdb === resolvedTmdbId
            })
          }

          if (targetIndex >= 0) {
            const prev = user.responses[targetIndex]
            const oldValue = prev.wantsToWatch
            log.debug(
              `${user.name} is updating rating for ${guid} from ${oldValue} to ${wantsToWatch}`
            )

            const preferredGuid = movie
              ? movie.guid
              : this.movieForGuid(prev.guid)?.guid ?? (guid || prev.guid)

            const nextResponse: Response = {
              guid: preferredGuid,
              wantsToWatch,
              tmdbId: resolvedTmdbId ?? prev.tmdbId ?? null,
            }

            if (
              prev.guid !== nextResponse.guid ||
              prev.wantsToWatch !== nextResponse.wantsToWatch ||
              (prev.tmdbId ?? null) !== (nextResponse.tmdbId ?? null)
            ) {
              responsesMutated = true
            }

            user.responses[targetIndex] = nextResponse
          } else {
            const action =
              wantsToWatch === true
                ? 'likes'
                : wantsToWatch === false
                ? 'dislikes'
                : 'marked as seen'
            log.debug(`${user.name} ${action} ${guid}`)
            user.responses.push({ guid, wantsToWatch, tmdbId: resolvedTmdbId })
            responsesMutated = true
          }

          if (dedupeUserResponses(user, this)) {
            responsesMutated = true
          }

          log.debug(`${user.name} now has ${user.responses.length} responses`)

          if (!movie) {
            log.error(
              `${user.name} rated a movie we can't resolve by guid: ${guid}`
            )
            // Still persist the response (e.g. rating a recommended movie that
            // isn't in the session's movie catalog yet)
            log.info(`[response] responsesMutated=${responsesMutated}, userResponses=${user.responses.length}`)
            if (responsesMutated) {
              log.info(`[response] persisting unresolved-movie response for guid=${guid}`)
              upsertRoomUser(this.roomCode, user)
              await saveState(persistedState).catch(err =>
                log.warn(`Failed to save state on response: ${err}`)
              )
              log.info(`[response] persisted OK`)
            }
            break
          }

          // Look up the canonical movie object for this guid
          const movieObj =
            this.movieList.find(m => m.guid === movie.guid) ||
            persistedState.movieIndex[movie.guid] ||
            movie

          // Persist: user responses is the source of truth, everything else derives from it
          upsertRoomUser(this.roomCode, user)
          await saveState(persistedState).catch(err =>
            log.warn(`Failed to save state on response: ${err}`)
          )
          if (wantsToWatch) {
            checkForNewFriendMatch(user, this.roomCode, movieObj, this.users.get(user))
          }
          maybeAutoSyncPlex(this.roomCode, user.name, 'watchlist')
          maybeAutoSyncPlex(this.roomCode, user.name, 'seen')
          maybeAutoSyncTrakt(this.roomCode, user.name, 'watchlist')
          maybeAutoSyncTrakt(this.roomCode, user.name, 'seen')
          break
        }
        case 'unrespond': {
          const { guid } = decodedMessage.payload
          assert(typeof guid === 'string', 'unrespond message missing guid')
          log.info(`[unrespond] ${user.name} removing response for guid=${guid}`)

          const before = user.responses.length
          user.responses = user.responses.filter(r => r.guid !== guid)

          if (user.responses.length !== before) {
            upsertRoomUser(this.roomCode, user)
            await saveState(persistedState).catch(err =>
              log.warn(`Failed to save state on unrespond: ${err}`)
            )
            maybeAutoSyncPlex(this.roomCode, user.name, 'watchlist')
            maybeAutoSyncPlex(this.roomCode, user.name, 'seen')
            maybeAutoSyncTrakt(this.roomCode, user.name, 'watchlist')
            maybeAutoSyncTrakt(this.roomCode, user.name, 'seen')
          }
          break
        }
      }
    } catch (err) {
      log.error(err, JSON.stringify(msg))
    }
  }

  async sendNextBatch(
    filters?: {
      yearMin?: number
      yearMax?: number
      genres?: string[]
      streamingServices?: string[]
      showPlexOnly?: boolean
      availability?: {
        anywhere?: boolean
        roomPersonalMedia?: boolean
        paidSubscriptions?: boolean
        freeStreaming?: boolean
        freeStreamingServices?: string[]
        subscriptionServices?: string[]
      }
      contentRatings?: string[]
      certificationCountry?: string
      tmdbRating?: number
      tmdbRatingMax?: number
      languages?: string[]
      countries?: string[]
      directors?: Array<{ id: number; name: string }>
      actors?: Array<{ id: number; name: string }>
      runtimeMin?: number
      runtimeMax?: number
      voteCount?: number
      sortBy?: string
    },
    options?: {
      suppressBroadcast?: boolean
      softTimeoutMs?: number
      hardTimeoutMs?: number
      stopAfterFirstMovie?: boolean
    },
    requester?: User
  ) {
    // Per-user personal media sources (own connected server + friends' shared servers) — see
    // personal-media-sources.ts. Deliberately independent of the instance-wide admin
    // Plex/Emby/Jellyfin config below, which stays untouched for the legacy web/Docker flow.
    // Every personal room is `U<userId>` by construction (see roomCodeForUser in
    // routes/compare.ts), so the numeric id is always recoverable from the room code.
    const personalRoomMatch = this.roomCode.match(/^U(\d+)$/)
    const personalRoomUserId = personalRoomMatch
      ? parseInt(personalRoomMatch[1], 10)
      : null
    const myPersonalSources: PersonalSourceDescriptor[] =
      personalRoomUserId != null
        ? resolvePersonalSourcesForUser(personalRoomUserId)
        : []

    // Per-user paid/free streaming subscriptions (Profile screen) — independent of the
    // instance-wide admin PAID_STREAMING_SERVICES setting below, which stays as a fallback for
    // the legacy web/Docker flow when a user hasn't configured their own.
    const userStreamingPrefs: UserStreamingPrefs =
      personalRoomUserId != null
        ? parseUserStreamingPrefs(getUserSettings(personalRoomUserId)?.subscriptions)
        : { paid: [], includeFree: false }

    const configuredPaidServices = getPaidStreamingServices()
    const configuredPersonalSources =
      requester?.hasServerAccess === false ? [] : getPersonalMediaSources()
    const requestedServices = (filters?.streamingServices || [])
      .map(service => service.trim())
      .filter(Boolean)

    const requestedAvailability = filters?.availability
    // True once the client has ever sent an explicit availability choice (including "anywhere"
    // — FilterSheet always sends a fully-formed availability object once applied, even if the
    // user didn't change anything). Only undefined on the very first batch a client asks for
    // (e.g. right after login, before FilterSheet has ever been touched) — that's the one case
    // where it's safe to auto-apply the user's own saved subscriptions as the baseline, below.
    const explicitAvailabilityProvided = requestedAvailability !== undefined
    const normalizedAvailability = {
      anywhere: Boolean(requestedAvailability?.anywhere),
      roomPersonalMedia: Boolean(requestedAvailability?.roomPersonalMedia),
      paidSubscriptions: Boolean(requestedAvailability?.paidSubscriptions),
      freeStreaming: Boolean(requestedAvailability?.freeStreaming),
      freeStreamingServices: Array.isArray(
        requestedAvailability?.freeStreamingServices
      )
        ? requestedAvailability.freeStreamingServices
            .map(service => String(service).trim())
            .filter(Boolean)
        : [],
    }

    if (
      !normalizedAvailability.anywhere &&
      !normalizedAvailability.roomPersonalMedia &&
      !normalizedAvailability.paidSubscriptions &&
      !normalizedAvailability.freeStreaming
    ) {
      normalizedAvailability.anywhere = true
    }

    if (normalizedAvailability.anywhere) {
      normalizedAvailability.roomPersonalMedia = false
      normalizedAvailability.paidSubscriptions = false
      normalizedAvailability.freeStreaming = false
      normalizedAvailability.freeStreamingServices = []
    }

    if (!normalizedAvailability.freeStreaming) {
      normalizedAvailability.freeStreamingServices = []
    }

    // Auto-apply the user's saved subscriptions as the baseline only when the client hasn't
    // expressed any availability preference yet (see explicitAvailabilityProvided above) — once
    // they've touched FilterSheet, its explicit choice always wins, including "Anywhere".
    const autoApplyUserSubscriptions =
      !explicitAvailabilityProvided &&
      (userStreamingPrefs.paid.length > 0 || userStreamingPrefs.includeFree)

    const wantsRoomPersonalMedia =
      normalizedAvailability.roomPersonalMedia &&
      configuredPersonalSources.length > 0
    const wantsPaidSubscriptions =
      (normalizedAvailability.paidSubscriptions &&
        (configuredPaidServices.length > 0 || userStreamingPrefs.paid.length > 0)) ||
      (autoApplyUserSubscriptions && userStreamingPrefs.paid.length > 0)
    const wantsFreeStreaming = normalizedAvailability.freeStreaming

    // Determine which specific personal media sources are requested
    const requestedPersonalSources = (
      filters?.availability?.subscriptionServices || []
    )
      .map(s => String(s).trim().toLowerCase())
      .filter(s => configuredPersonalSources.includes(s))

    const wantsPlexSource =
      requestedPersonalSources.length === 0 ||
      requestedPersonalSources.includes('plex')
    const wantsEmbySource = requestedPersonalSources.includes('emby')
    const wantsJellyfinSource = requestedPersonalSources.includes('jellyfin')

    const isPersonalMediaOnly =
      wantsRoomPersonalMedia && !wantsPaidSubscriptions && !wantsFreeStreaming

    // Only trigger Plex-only mode when Plex is actually the selected personal source
    let effectiveShowMyPlexOnly =
      filters?.showPlexOnly ?? (isPersonalMediaOnly && wantsPlexSource)

    // Emby-only and Jellyfin-only modes
    const effectiveShowEmbyOnly =
      isPersonalMediaOnly && wantsEmbySource && !wantsPlexSource
    const effectiveShowJellyfinOnly =
      isPersonalMediaOnly &&
      wantsJellyfinSource &&
      !wantsPlexSource &&
      !wantsEmbySource

    // If only Emby or Jellyfin is selected, don't trigger Plex-only mode
    if (effectiveShowEmbyOnly || effectiveShowJellyfinOnly) {
      effectiveShowMyPlexOnly = false
    }

    let effectiveStreamingServices = [...requestedServices]
    if (effectiveStreamingServices.length === 0 && wantsPaidSubscriptions) {
      effectiveStreamingServices =
        userStreamingPrefs.paid.length > 0
          ? [...userStreamingPrefs.paid]
          : [...configuredPaidServices]
    }

    const effectiveIncludeFreeStreaming =
      (wantsPaidSubscriptions || autoApplyUserSubscriptions) &&
      userStreamingPrefs.includeFree

    const shouldBlendPlexInAvailability =
      wantsRoomPersonalMedia &&
      !effectiveShowMyPlexOnly &&
      !effectiveShowEmbyOnly &&
      !effectiveShowJellyfinOnly

    const tmdbConfigured = Boolean(getTmdbApiKey())

    if (
      !tmdbConfigured &&
      !effectiveShowMyPlexOnly &&
      !effectiveShowEmbyOnly &&
      !effectiveShowJellyfinOnly
    ) {
      log.warn(
        'TMDb API key is missing; falling back to Plex library movies for swipe results.'
      )
    }

    try {
      // Increase batch size to account for movies we'll skip
      const attemptBatchSize = Math.min(
        effectiveShowMyPlexOnly
          ? (await getAllMovies()).length
          : effectiveShowEmbyOnly
          ? Math.max(getAllEmbyMovies().length, 40)
          : effectiveShowJellyfinOnly
          ? Math.max(getAllJellyfinMovies().length, 40)
          : 40,
        Number(getMovieBatchSize()) * 2 // Double the normal batch size
      )

      const validMovies: MediaItem[] = []
      const roomUsers = Array.from(this.users.keys())
      const roomUserCount = roomUsers.length

      const ratedGuidCounts = new Map<string, number>()
      const ratedTmdbCounts = new Map<number, number>()

      for (const user of roomUsers) {
        for (const response of user.responses) {
          ratedGuidCounts.set(
            response.guid,
            (ratedGuidCounts.get(response.guid) ?? 0) + 1
          )
          const tmdbId = response.tmdbId ?? this.tmdbIdForGuid(response.guid)
          if (tmdbId != null) {
            ratedTmdbCounts.set(tmdbId, (ratedTmdbCounts.get(tmdbId) ?? 0) + 1)
          }
        }
      }

      const seenGuids = new Set<string>()
      const seenTmdbIds = new Set<number>()

      for (const movie of this.movieList) {
        seenGuids.add(movie.guid)
        if (movie.tmdbId != null) {
          seenTmdbIds.add(movie.tmdbId)
        }
      }

      const isFullyRatedInRoom = (
        guid: string,
        tmdbId: number | null | undefined
      ) => {
        if (roomUserCount === 0) return false

        if ((ratedGuidCounts.get(guid) ?? 0) >= roomUserCount) {
          return true
        }

        if (
          tmdbId != null &&
          (ratedTmdbCounts.get(tmdbId) ?? 0) >= roomUserCount
        ) {
          return true
        }

        return false
      }

      const maxAttempts = attemptBatchSize
      let attempts = 0
      const batchBuildStartedAt = Date.now()

      let hasPersonFilters =
        tmdbConfigured &&
        (filters?.directors?.length || 0) + (filters?.actors?.length || 0) > 0
      let personMovies: any[] = []
      let person: { id: number; name: string } | undefined

      if (hasPersonFilters && !effectiveShowMyPlexOnly) {
        person = filters?.directors?.[0] || filters?.actors?.[0]
        if (person) {
          log.info(`🎭 Getting all movies for ${person.name}`)

          try {
            const response = await tmdbFetch(
              `/person/${person.id}/movie_credits`,
              getTmdbApiKey()
            )

            if (response.ok) {
              const data = await response.json()
              const movies = filters?.directors?.[0]
                ? data.crew?.filter((m: any) => m.job === 'Director')
                : data.cast

              personMovies = movies?.sort(() => Math.random() - 0.5) || []
              log.info(
                `🎬 Found ${personMovies.length} movies for ${person.name}`
              )
            }
          } catch (e) {
            log.error(
              `Failed to get movies for ${person?.name ?? 'unknown person'}:`,
              e
            )
            hasPersonFilters = false
          }
        } else {
          hasPersonFilters = false
        }
      }

      type PendingCandidate = { promise: Promise<any>; attemptNumber: number }
      let pendingCandidate: PendingCandidate | null = null

      const fetchCandidate = async (attemptNumber: number): Promise<any> => {
        const fetchPlexCandidate = async () =>
          await getFilteredRandomMovie({
            yearMin: filters?.yearMin,
            yearMax: filters?.yearMax,
            genres: filters?.genres,
          })

        const fetchEmbyCandidate = async () => {
          const embyMovies = getAllEmbyMovies()
          if (embyMovies.length === 0) {
            throw new NoMoreMoviesError(
              'Emby cache is empty — check Emby connection'
            )
          }
          const entry =
            embyMovies[Math.floor(Math.random() * embyMovies.length)]
          return this.formatTMDbMovie({
            id: entry.tmdbId,
            title: entry.title,
            release_date: entry.year ? `${entry.year}-01-01` : null,
          })
        }

        const fetchJellyfinCandidate = async () => {
          const jellyfinMovies = getAllJellyfinMovies()
          if (jellyfinMovies.length === 0) {
            throw new NoMoreMoviesError(
              'Jellyfin cache is empty — check Jellyfin connection'
            )
          }
          const entry =
            jellyfinMovies[Math.floor(Math.random() * jellyfinMovies.length)]
          return this.formatTMDbMovie({
            id: entry.tmdbId,
            title: entry.title,
            release_date: entry.year ? `${entry.year}-01-01` : null,
          })
        }

        const fetchPersonalSourceCandidate = async (
          source: PersonalSourceDescriptor
        ): Promise<any> => {
          const tag = {
            type: source.owner.type,
            provider: source.provider,
            ...(source.owner.type === 'friend'
              ? { friendName: source.owner.friendName }
              : {}),
          }

          if (source.provider === 'plex') {
            const movies = await getPersonalPlexLibrary(
              source.url,
              source.token,
              source.libraryName || undefined
            )
            if (movies.length === 0) {
              throw new NoMoreMoviesError('Personal Plex library is empty')
            }
            const entry = movies[Math.floor(Math.random() * movies.length)]
            ;(entry as any).personalSource = tag
            return entry
          }

          const providerLabel = source.provider === 'emby' ? 'Emby' : 'Jellyfin'
          const movies = await getPersonalMediaServerLibrary(
            providerLabel,
            source.url,
            source.token
          )
          if (movies.length === 0) {
            throw new NoMoreMoviesError(`Personal ${providerLabel} library is empty`)
          }
          const entry = movies[Math.floor(Math.random() * movies.length)]
          const formatted = await this.formatTMDbMovie({
            id: entry.tmdbId,
            title: entry.title,
            release_date: entry.year ? `${entry.year}-01-01` : null,
          })
          ;(formatted as any).personalSource = tag
          return formatted
        }

        // Give personal sources (own + friends' shared servers) a rotating slot in the
        // attempt cycle, generalizing the existing single-Plex "blend" pattern below to N
        // sources. With zero personal sources configured this is a no-op and every attempt
        // falls through to the existing instance-wide/TMDb logic unchanged.
        if (myPersonalSources.length > 0) {
          const slot = attemptNumber % (myPersonalSources.length + 1)
          if (slot !== 0) {
            const source = myPersonalSources[slot - 1]
            try {
              return await fetchPersonalSourceCandidate(source)
            } catch (err) {
              if (err instanceof NoMoreMoviesError) {
                log.debug(
                  `Personal source (${source.provider}, ${source.owner.type}) exhausted for this attempt; falling through.`
                )
              } else {
                log.warn(
                  `Personal source fetch failed (${source.provider}, ${source.owner.type}): ${err}`
                )
              }
              // fall through to the existing logic below for this attempt
            }
          }
        }

        // Check Emby/Jellyfin-only modes before the TMDb-not-configured fallback
        if (effectiveShowEmbyOnly) {
          return await fetchEmbyCandidate()
        }

        if (effectiveShowJellyfinOnly) {
          return await fetchJellyfinCandidate()
        }

        if (effectiveShowMyPlexOnly || !tmdbConfigured) {
          return await fetchPlexCandidate()
        }

        if (shouldBlendPlexInAvailability && attemptNumber % 2 === 1) {
          try {
            return await fetchPlexCandidate()
          } catch (err) {
            if (err instanceof NoMoreMoviesError) {
              log.debug(
                'No more room library candidates for blended availability; falling back to TMDb discovery.'
              )
            } else {
              throw err
            }
          }
        }

        if (hasPersonFilters && personMovies.length > 0 && person) {
          const movieIndex = (attemptNumber - 1) % personMovies.length
          const tmdbMovie = personMovies[movieIndex]
          log.info(
            `🎬 Using ${person.name} movie ${movieIndex + 1}/${
              personMovies.length
            }: ${tmdbMovie.title}`
          )
          return await this.formatTMDbMovie(tmdbMovie)
        }

        try {
          return await this.getTMDbMovie(attemptNumber - 1, {
            yearMin: filters?.yearMin,
            yearMax: filters?.yearMax,
            genres: filters?.genres,
            tmdbRating: filters?.tmdbRating,
            tmdbRatingMax: filters?.tmdbRatingMax,
            languages: filters?.languages,
            countries: filters?.countries,
            runtimeMin: filters?.runtimeMin,
            runtimeMax: filters?.runtimeMax,
            voteCount: filters?.voteCount,
            sortBy: filters?.sortBy,
            streamingServices: effectiveStreamingServices,
            includeFreeStreaming: effectiveIncludeFreeStreaming,
            contentRatings: filters?.contentRatings,
            certificationCountry: filters?.certificationCountry,
          })
        } catch (err) {
          log.warn(
            `TMDb candidate fetch failed at attempt ${attemptNumber}; trying room library fallback: ${err}`
          )
          try {
            return await fetchPlexCandidate()
          } catch (fallbackErr) {
            // TMDb genuinely has no more movies matching these filters (not a transient
            // failure) and the room's own library has nothing either — there's nothing left
            // to find. Surface this as NoMoreMoviesError so the batch loop below stops
            // immediately instead of retrying the same dead end up to maxAttempts times.
            if (err instanceof Error && err.message === 'No TMDb movie found') {
              throw new NoMoreMoviesError('No more movies match the current filters')
            }
            throw fallbackErr
          }
        }
      }

      const queueNextCandidate = () => {
        if (attempts >= maxAttempts) {
          pendingCandidate = null
          return
        }

        const attemptNumber = attempts + 1
        const candidatePromise = fetchCandidate(attemptNumber)
        // This candidate is fetched eagerly (queueNextCandidate() is called for attempt N+1
        // before attempt N has been processed) — if the batch loop below exits for any reason
        // (batch full, soft/hard timeout, or a NoMoreMoviesError from a *different* attempt)
        // before ever awaiting this promise, an unhandled rejection here would crash the whole
        // process. The real error handling still happens wherever this promise IS awaited —
        // this is just a safety net against it being abandoned unawaited.
        candidatePromise.catch(() => {})
        pendingCandidate = {
          promise: candidatePromise,
          attemptNumber,
        }
        attempts = attemptNumber
      }

      queueNextCandidate()

      const isInitialRoomBatch = this.movieList.length === 0
      const effectiveSoftTimeoutMs =
        options?.softTimeoutMs ?? SEND_BATCH_SOFT_TIMEOUT_MS
      const effectiveHardTimeoutMs =
        options?.hardTimeoutMs ??
        (isInitialRoomBatch
          ? INITIAL_BATCH_HARD_TIMEOUT_MS
          : SEND_BATCH_HARD_TIMEOUT_MS)
      const stopAfterFirstMovie = options?.stopAfterFirstMovie ?? false

      while (
        validMovies.length < Number(getMovieBatchSize()) &&
        pendingCandidate
      ) {
        const elapsedMs = Date.now() - batchBuildStartedAt
        if (validMovies.length > 0 && elapsedMs >= effectiveSoftTimeoutMs) {
          log.info(
            `⏱️ Soft timeout reached after ${elapsedMs}ms; sending ${validMovies.length} movie(s) early to reduce first-load latency.`
          )
          break
        }
        if (elapsedMs >= effectiveHardTimeoutMs) {
          log.warn(
            `⏱️ Hard timeout reached after ${elapsedMs}ms; ending batch generation with ${validMovies.length} movie(s).`
          )
          break
        }

        const { promise, attemptNumber } = pendingCandidate
        let plexMovie: any | null = null

        try {
          plexMovie = await promise
        } catch (err) {
          if (err instanceof NoMoreMoviesError) {
            log.info('No more movies available')
            pendingCandidate = null
            break
          }

          log.error(`Error fetching movie attempt ${attemptNumber}:`, err)
          if (hasPersonFilters && personMovies.length > 0) {
            log.warn('Person movie fetch failed, falling back to discovery')
            hasPersonFilters = false
          }
          queueNextCandidate()
          continue
        }

        queueNextCandidate()

        if (!plexMovie) {
          continue
        }

        log.debug(`Movie attempt ${attemptNumber} - Got: ${plexMovie.title}`)

        // Extract IMDB ID from Plex Guid array if available (for Plex-only filter)
        if (!plexMovie.imdbId) {
          const extractedImdbId = extractImdbIdFromMovie(plexMovie)
          if (extractedImdbId) {
            plexMovie.imdbId = extractedImdbId
            log.debug(
              `📋 Extracted IMDB ID ${extractedImdbId} for ${plexMovie.title}`
            )
          }
        }

        try {
          if (seenGuids.has(plexMovie.guid)) {
            log.debug(
              `⭐️  Skipping ${plexMovie.title} - already in this room's history`
            )
            continue
          }

          const tmdbIdFromGuid = extractTmdbIdFromGuid(plexMovie.guid)
          if (isFullyRatedInRoom(plexMovie.guid, tmdbIdFromGuid)) {
            log.debug(
              `⭐️  Skipping ${plexMovie.title} - everyone in this room already responded`
            )
            continue
          }
          if (tmdbIdFromGuid != null && seenTmdbIds.has(tmdbIdFromGuid)) {
            log.debug(
              `⭐️  Skipping ${plexMovie.title} - TMDb ID ${tmdbIdFromGuid} already in this room's history`
            )
            continue
          }

          let extra: EnrichmentPayload | undefined

          try {
            extra = await Promise.race([
              this.getEnrichmentData(plexMovie),
              new Promise<undefined>(resolve =>
                setTimeout(() => resolve(undefined), ENRICHMENT_TIMEOUT_MS)
              ),
            ])

            if (!extra) {
              log.debug(
                `⏱️ Enrichment timed out for ${plexMovie.title} after ${ENRICHMENT_TIMEOUT_MS}ms; using base metadata.`
              )

              const shouldForceMetadataForInitialCard =
                isInitialRoomBatch && validMovies.length < 2

              if (shouldForceMetadataForInitialCard) {
                try {
                  extra = await Promise.race([
                    this.getEnrichmentData(plexMovie),
                    new Promise<undefined>(resolve =>
                      setTimeout(() => resolve(undefined), 10000)
                    ),
                  ])

                  if (extra) {
                    log.info(
                      `✅ Recovered enrichment for initial card ${plexMovie.title} in forced metadata pass.`
                    )
                  }
                } catch (retryErr) {
                  log.warn(
                    `Forced enrichment retry failed for ${plexMovie.title}: ${retryErr}`
                  )
                }
              }
            }
          } catch (e) {
            log.warn(`Enrichment failed for ${plexMovie.title}: ${e}`)
          }

          const candidateTmdbId = extra?.tmdbId ?? tmdbIdFromGuid
          if (
            candidateTmdbId != null &&
            candidateTmdbId !== tmdbIdFromGuid &&
            seenTmdbIds.has(candidateTmdbId)
          ) {
            log.debug(
              `⭐️  Skipping ${plexMovie.title} - TMDb ID ${candidateTmdbId} already in this room's history`
            )
            continue
          }
          if (isFullyRatedInRoom(plexMovie.guid, candidateTmdbId ?? null)) {
            log.debug(
              `⭐️  Skipping ${plexMovie.title} - everyone in this room already responded`
            )
            continue
          }

          const posterPath = await getBestPosterPath(plexMovie, extra)

          if (!isMovieValid(plexMovie, posterPath)) {
            log.debug(
              `🚫 Skipping ${plexMovie.title} - invalid movie or no poster`
            )
            continue
          }

          const parts: string[] = []
          const basePath = getRootPath() || ''

          if (extra?.rating_comparr != null) {
            parts.push(
              `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> <span class="rating-value">${extra.rating_comparr}</span>`
            )
          }
          if (extra?.rating_tmdb != null) {
            parts.push(
              `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> <span class="rating-value">${extra.rating_tmdb}</span>`
            )
          }
          const ratingStr =
            parts.length > 0 ? parts.join(' ') : plexMovie.rating ?? ''

          const summaryStr =
            (extra?.plot && String(extra.plot)) ||
            (plexMovie.summary && String(plexMovie.summary)) ||
            ''

          if (filters?.yearMin || filters?.yearMax) {
            const movieYear =
              typeof plexMovie.year === 'number'
                ? plexMovie.year
                : Number(plexMovie.year)
            if (filters.yearMin && movieYear < filters.yearMin) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - year ${movieYear} below minimum ${filters.yearMin}`
              )
              continue
            }
            if (filters.yearMax && movieYear > filters.yearMax) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - year ${movieYear} above maximum ${filters.yearMax}`
              )
              continue
            }
          }

          if (filters?.genres && filters.genres.length > 0 && extra?.genres) {
            const filterGenreNames = genreIdsToNames(filters.genres).map(g =>
              g.toLowerCase()
            )
            const movieGenres = extra.genres.map(g => g.toLowerCase())
            const hasMatchingGenre = filterGenreNames.some(filterGenre =>
              movieGenres.includes(filterGenre)
            )
            if (!hasMatchingGenre) {
              log.debug(`⛔️ Skipping ${plexMovie.title} - no matching genres`)
              continue
            }
          }

          // Prefer the enriched rating, but fall back to the rating TMDb's own discover
          // response already carried on plexMovie — for TMDb-sourced candidates, TMDb already
          // enforced vote_average.gte/.lte server-side to produce this candidate in the first
          // place, so that value is always known even when the separate enrichment call times
          // out (see ENRICHMENT_TIMEOUT_MS above). Treating an enrichment timeout as "fails the
          // rating filter" was wrongly rejecting movies that TMDb had already confirmed match.
          const knownRating = extra?.rating_tmdb ?? plexMovie.vote_average ?? null

          if (filters?.tmdbRating && filters.tmdbRating > 0) {
            if (knownRating == null || knownRating < filters.tmdbRating) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - TMDb rating ${
                  knownRating ?? 'N/A'
                } below minimum ${filters.tmdbRating}`
              )
              continue
            }
          }

          if (filters?.tmdbRatingMax && filters.tmdbRatingMax > 0) {
            if (knownRating != null && knownRating > filters.tmdbRatingMax) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - TMDb rating ${knownRating} above maximum ${filters.tmdbRatingMax}`
              )
              continue
            }
          }

          if (filters?.runtimeMin || filters?.runtimeMax) {
            const runtime = extra?.runtime || plexMovie.runtime
            if (runtime) {
              if (filters.runtimeMin && runtime < filters.runtimeMin) {
                log.debug(
                  `⛔️ Skipping ${plexMovie.title} - runtime ${runtime}min below minimum ${filters.runtimeMin}min`
                )
                continue
              }
              if (filters.runtimeMax && runtime > filters.runtimeMax) {
                log.debug(
                  `⛔️ Skipping ${plexMovie.title} - runtime ${runtime}min above maximum ${filters.runtimeMax}min`
                )
                continue
              }
            }
          }

          if (filters?.voteCount && filters.voteCount > 0) {
            const voteCount =
              extra?.voteCount ??
              plexMovie.vote_count ??
              plexMovie.voteCount ??
              0
            if (voteCount < filters.voteCount) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - vote count ${voteCount} below minimum ${filters.voteCount}`
              )
              continue
            }
          }

          if (filters?.contentRatings && filters.contentRatings.length > 0) {
            const movieRating = extra?.contentRating || plexMovie.contentRating
            if (movieRating && !filters.contentRatings.includes(movieRating)) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - content rating ${movieRating} not in filter`
              )
              continue
            }
          }

          if (filters?.languages && filters.languages.length > 0) {
            const movieLanguage = plexMovie.original_language
            if (movieLanguage && !filters.languages.includes(movieLanguage)) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - language ${movieLanguage} not in filter`
              )
              continue
            }
          }

          if (filters?.countries && filters.countries.length > 0) {
            // formatTMDbMovie() sets `countries` (ISO codes), not `production_countries` — that
            // raw TMDb field only exists on the /movie/{id} details response, never on the
            // formatted candidate object flowing through this loop.
            const movieCountries = plexMovie.countries || []
            const hasMatchingCountry = filters.countries.some(filterCountry =>
              movieCountries.includes(filterCountry)
            )
            if (!hasMatchingCountry && movieCountries.length > 0) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - no matching countries`
              )
              continue
            }
          }

          let streamingServices = extra?.streamingServices || {
            subscription: [],
            free: [],
          }

          if (wantsFreeStreaming && streamingServices.free.length === 0) {
            log.debug(
              `⛔️ Skipping ${plexMovie.title} - missing free streaming availability`
            )
            continue
          }

          if (
            wantsFreeStreaming &&
            normalizedAvailability.freeStreamingServices.length > 0
          ) {
            const freeServiceSet = new Set(
              streamingServices.free
                .map(service =>
                  String(service?.name || '')
                    .trim()
                    .toLowerCase()
                )
                .filter(Boolean)
            )
            const hasRequestedFreeService = normalizedAvailability.freeStreamingServices.some(
              service => {
                const normalized = service.toLowerCase()
                if (normalized === 'pluto-tv') {
                  return (
                    freeServiceSet.has('pluto tv') ||
                    freeServiceSet.has('pluto-tv')
                  )
                }
                if (normalized === 'roku-channel') {
                  return (
                    freeServiceSet.has('roku channel') ||
                    freeServiceSet.has('the roku channel') ||
                    freeServiceSet.has('roku-channel')
                  )
                }
                return (
                  freeServiceSet.has(normalized) ||
                  freeServiceSet.has(normalized.replace(/-/g, ' '))
                )
              }
            )

            if (!hasRequestedFreeService) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - missing selected free streaming services`
              )
              continue
            }
          }

          if (plexMovie.guid?.startsWith('plex://')) {
            log.debug(
              `✅ Movie ${plexMovie.title} is from Plex library (plex:// guid) - adding AllVids badge`
            )
            streamingServices = {
              subscription: [
                ...streamingServices.subscription,
                {
                  id: 0,
                  name: getPlexLibraryName(),
                  logo_path: '/assets/logos/allvids.svg',
                  type: 'subscription',
                },
              ],
              free: streamingServices.free,
            }
          } else if (plexMovie.guid?.startsWith('tmdb://')) {
            const tmdbId = parseInt(plexMovie.guid.replace('tmdb://', ''))
            if (isMovieInRadarr(tmdbId)) {
              log.debug(
                `✅ Movie ${plexMovie.title} found in Radarr - adding AllVids badge`
              )
              streamingServices = {
                subscription: [
                  ...streamingServices.subscription,
                  {
                    id: 0,
                    name: getPlexLibraryName(),
                    logo_path: '/assets/logos/allvids.svg',
                    type: 'subscription',
                  },
                ],
                free: streamingServices.free,
              }
            }
          }

          prefetchPoster(posterPath!, 'tmdb')

          const movie: MediaItem = {
            title: plexMovie.title,
            art: getBestPosterUrl(posterPath!, 'tmdb'),
            guid: plexMovie.guid,
            key: plexMovie.key,
            summary: summaryStr,
            year: String(plexMovie.year),
            director:
              extra?.director ||
              (plexMovie.Director ?? [{ tag: undefined }])[0].tag,
            cast: extra?.cast || [],
            castMembers: extra?.castMembers || [],
            writers: extra?.writers || [],
            genres: extra?.genres || [],
            contentRating: extra?.contentRating || undefined,
            runtime: extra?.runtime || plexMovie.runtime || undefined,
            rating: String(ratingStr),
            rating_tmdb: extra?.rating_tmdb ?? null,
            type: plexMovie.type,
            streamingServices: streamingServices,
            streamingLink: extra?.streamingLink || undefined,
            tmdbId: extra?.tmdbId || null,
            genre_ids: plexMovie.genre_ids || [],
            vote_count: extra?.voteCount || plexMovie.vote_count || 0,
            original_language:
              extra?.original_language ||
              extra?.originalLanguage ||
              plexMovie.original_language ||
              null,
            // formatTMDbMovie() already sets `countries` as plain ISO codes; `production_countries`
            // (TMDb's raw {iso_3166_1, name} shape) is kept as a fallback in case a candidate ever
            // carries that field directly instead.
            countries: Array.isArray(plexMovie.countries)
              ? plexMovie.countries.filter(
                  (code: unknown): code is string => typeof code === 'string' && Boolean(code)
                )
              : Array.isArray(plexMovie.production_countries)
              ? plexMovie.production_countries
                  .map((c: any) => (typeof c === 'string' ? c : c?.iso_3166_1))
                  .filter((code: unknown): code is string => Boolean(code))
              : [],
            trailerKey: extra?.trailerKey || null,
            personalSource: (plexMovie as any).personalSource,
          }

          validMovies.push(movie)
          seenGuids.add(movie.guid)
          if (stopAfterFirstMovie && validMovies.length === 1) {
            log.info(
              '🚀 Initial batch fast-path: stopping after first valid movie to unblock client render.'
            )
            break
          }
          if (movie.tmdbId != null) {
            seenTmdbIds.add(movie.tmdbId)
          }
          log.debug(
            `✅ Added valid movie: ${movie.title} (${
              validMovies.length
            }/${getMovieBatchSize()})`
          )
        } catch (err) {
          if (err instanceof NoMoreMoviesError) {
            log.info('No more movies available')
            pendingCandidate = null
            break
          }
          log.error(`Error processing movie attempt ${attemptNumber}:`, err)
          log.error(`Error details:`, errorMessage(err))

          if (hasPersonFilters && personMovies.length > 0) {
            log.warn(
              'Person movie failed, falling back to discovery for remaining movies'
            )
            hasPersonFilters = false
          }
          continue
        }
      }

      log.info(
        `Ã°Å¸â€œÂ¦ Generated batch: ${validMovies.length} valid movies from ${attempts} attempts`
      )

      // Keep for current session
      this.movieList.push(...validMovies)

      // Add to global movie index
      addMoviesToIndex(validMovies)
      await saveState(persistedState).catch(err =>
        log.warn(`Failed to save state after batch: ${err}`)
      )

      // Send only unseen movies to each user
      let tmdbMappingsPersisted = false
      for (const [user, ws] of this.users.entries()) {
        if (ws && !ws.isClosed) {
          // Create Sets for both GUID formats
          const ratedGuidSet = new Set(user.responses.map(_ => _.guid))

          // Build Set of rated TMDb IDs from the stored movie data
          const ratedTmdbIds = new Set<number>()
          let updatedTmdbForUser = false
          for (const response of user.responses) {
            const tmdbId = response.tmdbId ?? this.tmdbIdForGuid(response.guid)
            if (tmdbId != null) {
              ratedTmdbIds.add(tmdbId)
              if (response.tmdbId == null) {
                response.tmdbId = tmdbId
                updatedTmdbForUser = true
              }
            }
          }
          if (updatedTmdbForUser) {
            upsertRoomUser(this.roomCode, user)
            tmdbMappingsPersisted = true
          }

          const filteredBatch = validMovies.filter(movie => {
            // Check exact GUID match
            if (ratedGuidSet.has(movie.guid)) {
              return false
            }

            // Check if movie's TMDb ID has been rated (handles Plex GUID vs TMDb GUID mismatch)
            const candidateTmdbId =
              movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)
            if (candidateTmdbId && ratedTmdbIds.has(candidateTmdbId)) {
              log.debug(
                `Filtering ${movie.title} - TMDb ID ${candidateTmdbId} already rated`
              )
              return false
            }

            return true
          })

          let prioritizedBatch = filteredBatch
          if (filteredBatch.length > 1) {
            const likedByOtherGuids = new Set<string>()
            const likedByOtherTmdbIds = new Set<number>()
            const seenByOtherGuids = new Set<string>()
            const seenByOtherTmdbIds = new Set<number>()

            // 1. Roommates sharing the same room code
            for (const otherUser of roomUsers) {
              if (otherUser === user) continue
              for (const response of otherUser.responses) {
                const tmdbId =
                  response.tmdbId ??
                  this.tmdbIdForGuid(response.guid) ??
                  extractTmdbIdFromGuid(response.guid)
                if (response.wantsToWatch === true) {
                  likedByOtherGuids.add(response.guid)
                  if (tmdbId != null) likedByOtherTmdbIds.add(tmdbId)
                  continue
                }
                if (response.wantsToWatch !== null) continue
                seenByOtherGuids.add(response.guid)
                if (tmdbId != null) seenByOtherTmdbIds.add(tmdbId)
              }
            }

            // 2. Accepted friends (each in their own personal room)
            const personalRoomMatch = this.roomCode.match(/^U(\d+)$/)
            if (personalRoomMatch) {
              const myUserId = parseInt(personalRoomMatch[1], 10)
              const friendConnections = getFriendConnections(myUserId)
              for (const fc of friendConnections) {
                if (fc.status !== 'accepted') continue
                const friendRoomCode = `U${String(fc.friendUserId).padStart(3, '0')}`
                const friendRoom = persistedState.rooms[friendRoomCode]
                if (!friendRoom) continue
                for (const friendUser of friendRoom.users) {
                  for (const response of friendUser.responses) {
                    if (response.wantsToWatch !== true) continue
                    likedByOtherGuids.add(response.guid)
                    const tmdbId =
                      response.tmdbId ??
                      extractTmdbIdFromGuid(response.guid)
                    if (tmdbId != null) likedByOtherTmdbIds.add(tmdbId)
                  }
                }
              }
            }

            if (
              likedByOtherGuids.size > 0 ||
              likedByOtherTmdbIds.size > 0 ||
              seenByOtherGuids.size > 0 ||
              seenByOtherTmdbIds.size > 0
            ) {
              const matchesLikedByOthers: MediaItem[] = []
              const matchesSeenByOthers: MediaItem[] = []
              const remaining: MediaItem[] = []

              for (const movie of filteredBatch) {
                const candidateTmdbId =
                  movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)
                const isLikedByOthers =
                  likedByOtherGuids.has(movie.guid) ||
                  (candidateTmdbId != null &&
                    likedByOtherTmdbIds.has(candidateTmdbId))
                const isSeenByOthers =
                  seenByOtherGuids.has(movie.guid) ||
                  (candidateTmdbId != null &&
                    seenByOtherTmdbIds.has(candidateTmdbId))

                if (isLikedByOthers) {
                  matchesLikedByOthers.push(movie)
                } else if (isSeenByOthers) {
                  matchesSeenByOthers.push(movie)
                } else {
                  remaining.push(movie)
                }
              }

              prioritizedBatch = [
                ...matchesLikedByOthers,
                ...matchesSeenByOthers,
                ...remaining,
              ]

              if (
                matchesLikedByOthers.length > 0 ||
                matchesSeenByOthers.length > 0
              ) {
                log.info(
                  `🎯 Prioritized ${matchesLikedByOthers.length} movies liked by friends/roommates and ${matchesSeenByOthers.length} seen by roommates for ${user.name} (filters preserved)`
                )
              }
            }
          }

          // Enhanced logging to track filtering effectiveness
          const filteredCount = validMovies.length - filteredBatch.length
          if (filteredCount > 0) {
            log.info(
              `🎤 Sending ${prioritizedBatch.length} movies to user ${user.name} (filtered out ${filteredCount} already rated)`
            )
          } else {
            log.info(
              `🎤 Sending ${prioritizedBatch.length} movies to user ${user.name}`
            )
          }

          // === Normalize poster paths and strip Plex thumb IDs before sending ===

          // Detect raw Plex thumb IDs like "/74101/thumb/1760426051"
          const isPlexThumbCore = (u?: string) =>
            !!u && /^\/\d+\/thumb\/\d+/.test(u)

          // Remove known prefixes so we can inspect the core path
          const stripPrefix = (u?: string) => {
            if (!u) return u
            if (u.startsWith('/tmdb-poster/'))
              return u.slice('/tmdb-poster'.length)
            if (u.startsWith('/poster/')) return u.slice('/poster'.length)
            return u
          }

          // Prefer any TMDB-style poster field on the movie as a fallback
          const pickTmdbPoster = (m: any): string | undefined =>
            m.tmdbPosterPath ||
            m.posterPath ||
            m.poster_path ||
            m.tmdbPoster ||
            undefined

          // Map each movie’s art/thumb to a safe URL
          const norm = (m: any, u?: string) => {
            const core = stripPrefix(u)
            if (!core || isPlexThumbCore(core)) {
              const fallback = pickTmdbPoster(m)
              if (fallback) {
                prefetchPoster(fallback, 'tmdb')
                return getBestPosterUrl(fallback, 'tmdb')
              }
              return ''
            }
            if (u) {
              prefetchPoster(u, 'tmdb')
            }
            return getBestPosterUrl(u!, 'tmdb')
          }

          // Build the sanitized batch
          const normalizedBatch = prioritizedBatch.map((m: any) => ({
            ...m,
            art: norm(m, m.art),
            thumb: norm(m, m.thumb),
          }))

          // Send the sanitized batch to the client unless this call is preloading for login.
          if (!options?.suppressBroadcast) {
            ws.send(
              JSON.stringify({
                type: 'batch',
                payload: normalizedBatch,
              })
            )
          }
        }
      }

      if (tmdbMappingsPersisted) {
        await saveState(persistedState).catch(err =>
          log.warn(`Failed to save state after backfilling TMDb IDs: ${err}`)
        )
      }
    } catch (err) {
      log.error('Error in sendNextBatch:', err)
      // Send empty batch on error
      if (!options?.suppressBroadcast) {
        for (const ws of this.users.values()) {
          if (ws && !ws.isClosed) {
            ws.send(JSON.stringify({ type: 'batch', payload: [] }))
          }
        }
      }
    }
  }

  private async getTMDbMovie(
    index: number,
    filters?: {
      yearMin?: number
      yearMax?: number
      genres?: string[]
      tmdbRating?: number
      tmdbRatingMax?: number
      languages?: string[]
      countries?: string[]
      directors?: Array<{ id: number; name: string }>
      actors?: Array<{ id: number; name: string }>
      runtimeMin?: number
      runtimeMax?: number
      voteCount?: number
      sortBy?: string
      streamingServices?: string[]
      includeFreeStreaming?: boolean
      contentRatings?: string[]
      certificationCountry?: string
    }
  ): Promise<any> {
    // If person filters are applied, use a more targeted approach
    const hasPersonFilters =
      (filters?.directors?.length || 0) + (filters?.actors?.length || 0) > 0

    if (hasPersonFilters) {
      return this.getPersonMovie(index, filters)
    }

    const discoverFilters: DiscoverFilters = {
      yearMin: filters?.yearMin,
      yearMax: filters?.yearMax,
      genres: filters?.genres,
      tmdbRating: filters?.tmdbRating,
      tmdbRatingMax: filters?.tmdbRatingMax,
      languages: filters?.languages,
      countries: filters?.countries,
      runtimeMin: filters?.runtimeMin,
      runtimeMax: filters?.runtimeMax,
      voteCount: filters?.voteCount,
      sortBy: filters?.sortBy,
      streamingServices: filters?.streamingServices,
      includeFreeStreaming: filters?.includeFreeStreaming,
      contentRatings: filters?.contentRatings,
      certificationCountry: filters?.certificationCountry,
    }

    const { queue } = this.resolveDiscoverQueue(discoverFilters)
    await this.ensureDiscoverBuffer(queue, discoverFilters)

    if (!queue.buffer.length) {
      throw new Error('No TMDb movie found')
    }

    const tmdbMovie = queue.buffer.shift()

    if (!tmdbMovie) {
      throw new Error('No TMDb movie found')
    }

    if (queue.buffer.length < 5) {
      this.prefetchDiscoverPage(queue, discoverFilters)
    }

    return this.formatTMDbMovie(tmdbMovie)
  }

  private async getPersonMovie(index: number, filters: any): Promise<any> {
    // Get all movies for the first person (director or actor)
    const person = filters.directors?.[0] || filters.actors?.[0]
    if (!person) throw new Error('No person found')

    const page = Math.floor(index / 20) + 1 // Get different pages based on index
    const response = await tmdbFetch(
      `/person/${person.id}/movie_credits`,
      getTmdbApiKey()
    )

    if (!response.ok) throw new Error('Failed to get person movies')

    const data = await response.json()
    const movies = filters.directors?.[0]
      ? data.crew?.filter((m: any) => m.job === 'Director')
      : data.cast

    if (!movies?.length) throw new Error('No movies found for person')

    // Random selection from person's movies
    const randomMovie = movies[Math.floor(Math.random() * movies.length)]

    return this.formatTMDbMovie(randomMovie)
  }

  private async formatTMDbMovie(tmdbMovie: any): Promise<any> {
    const tmdbId = tmdbMovie.id
    if (tmdbId && this.tmdbFormatCache.has(tmdbId)) {
      return this.tmdbFormatCache.get(tmdbId)
    }
    if (tmdbId && this.tmdbFormatInFlight.has(tmdbId)) {
      return await this.tmdbFormatInFlight.get(tmdbId)!
    }

    const task = (async () => {
      // Get IMDb ID from TMDb for more reliable enrichment. This same /movie/{id} call also
      // carries origin_country — TMDb's /discover/movie results (tmdbMovie here) never include
      // that field, only the full details endpoint does — so grab it here too instead of firing
      // a second request for it. We use origin_country (TMDb's curated "this movie is from"
      // tag) rather than production_countries (every country tied to any production company,
      // which over-broadens co-productions) — same field the with_origin_country discover
      // filter uses, so Discover and Lists country filtering stay consistent.
      let imdbId = null
      let countries: string[] = []
      try {
        const detailsResponse = await tmdbFetch(
          `/movie/${tmdbId}`,
          getTmdbApiKey(),
          { append_to_response: 'external_ids' }
        )
        if (detailsResponse.ok) {
          const details = await detailsResponse.json()
          imdbId = details.external_ids?.imdb_id
          countries = Array.isArray(details.origin_country)
            ? details.origin_country.filter(
                (code: unknown): code is string => typeof code === 'string' && Boolean(code)
              )
            : []
          log.debug(`Got IMDb ID ${imdbId} for TMDb movie ${tmdbMovie.title}`)
        }
      } catch (e) {
        log.debug(`Failed to get IMDb ID for ${tmdbMovie.title}: ${e}`)
      }

      // Convert TMDb format to Plex-like format
      const thumbUrl = tmdbMovie.poster_path
        ? `/tmdb-poster${tmdbMovie.poster_path}`
        : ''
      log.debug(`getTMDbMovie thumb: ${thumbUrl}`)

      const formatted = {
        title: tmdbMovie.title,
        year: new Date(tmdbMovie.release_date || '').getFullYear() || null,
        summary: tmdbMovie.overview,
        guid: `tmdb://${tmdbMovie.id}`,
        key: `/tmdb/${tmdbMovie.id}`,
        thumb: tmdbMovie.poster_path
          ? `/tmdb-poster${tmdbMovie.poster_path}`
          : '',
        type: 'movie',
        rating: '',
        Director: [{ tag: undefined }],
        imdbId: imdbId,
        poster_path: tmdbMovie.poster_path,
        tmdbPosterPath: tmdbMovie.poster_path,
        genre_ids: tmdbMovie.genre_ids || [],
        vote_count: tmdbMovie.vote_count || 0,
        original_language: tmdbMovie.original_language || null,
        countries,
        tmdbId: tmdbMovie.id,
      }

      if (tmdbId) {
        this.tmdbFormatCache.set(tmdbId, formatted)
      }

      return formatted
    })()

    if (tmdbId) {
      this.tmdbFormatInFlight.set(tmdbId, task)
    }

    try {
      const formatted = await task
      if (tmdbId) {
        this.tmdbFormatCache.set(tmdbId, formatted)
        this.tmdbFormatInFlight.delete(tmdbId)
      }
      return formatted
    } catch (err) {
      if (tmdbId) {
        this.tmdbFormatInFlight.delete(tmdbId)
      }
      throw err
    }
  }

  private async getEnrichmentData(plexMovie: any) {
    const cacheKey =
      plexMovie.guid ||
      plexMovie.key ||
      (plexMovie.tmdbId ? `tmdb://${plexMovie.tmdbId}` : null)

    if (!cacheKey) {
      return enrich({
        title: plexMovie.title,
        year:
          typeof plexMovie.year === 'number'
            ? plexMovie.year
            : Number(plexMovie.year) || null,
        plexGuid: plexMovie.guid,
        imdbId: plexMovie.imdbId,
        tmdbId: plexMovie.tmdbId,
      })
    }

    let task = this.enrichmentCache.get(cacheKey)
    if (!task) {
      task = enrich({
        title: plexMovie.title,
        year:
          typeof plexMovie.year === 'number'
            ? plexMovie.year
            : Number(plexMovie.year) || null,
        plexGuid: plexMovie.guid,
        imdbId: plexMovie.imdbId,
        tmdbId: plexMovie.tmdbId,
      }).catch(err => {
        this.enrichmentCache.delete(cacheKey)
        throw err
      })
      this.enrichmentCache.set(cacheKey, task)
    }
    return task
  }

  destroy() {
    log.info(`Session ${this.roomCode} has no users and has been removed.`)
    activeSessions.delete(this.roomCode)
    // We do NOT delete persisted data here so rooms survive restarts
  }
}

// -------------------------
// Session registry
// -------------------------
export const activeSessions: Map<string, Session> = new Map()

const ROOM_CODE_LENGTH = 4

export function normalizeRoomCode(roomCode: string): string {
  return String(roomCode || '')
    .trim()
    .toUpperCase()
}

export function isValidRoomCode(roomCode: string): boolean {
  return new RegExp(`^[0-9A-Z]{${ROOM_CODE_LENGTH}}$`).test(
    normalizeRoomCode(roomCode)
  )
}


let plexHydrationPromise: Promise<void> | null = null

async function hydratePersistedMoviesWithPlexAvailability(): Promise<number> {
  const updatedGuids: string[] = []

  for (const [guid, movie] of Object.entries(persistedState.movieIndex)) {
    if (!movie || typeof movie !== 'object') continue

    const normalized = normalizeStreamingServices(movie as MediaItem)
    let changed = normalized.changed

    const tmdbId = extractTmdbIdFromMovie(movie as MediaItem)
    const imdbId = extractImdbIdFromMovie(movie as MediaItem)
    const year = parseYear((movie as MediaItem).year as any)

    const movieParams = {
      tmdbId: tmdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      title: (movie as MediaItem).title,
      year: year ?? undefined,
    }

    const libraryName = isMovieInPlex(movieParams)
      ? getPlexLibraryName() || 'Plex'
      : isMovieInEmby(movieParams)
      ? getEmbyLibraryName() || 'Emby'
      : isMovieInJellyfin(movieParams)
      ? getJellyfinLibraryName() || 'Jellyfin'
      : null

    if (libraryName) {
      const alreadyTagged = normalized.subscription.some(
        service => service?.name === libraryName
      )
      if (!alreadyTagged) {
        normalized.subscription.unshift({
          id: 0,
          name: libraryName,
          logo_path: '/assets/logos/allvids.svg',
          type: 'subscription',
        })
        changed = true
      }
    }

    if (tmdbId != null && (movie as MediaItem).tmdbId !== tmdbId) {
      ;(movie as MediaItem).tmdbId = tmdbId
      changed = true
    }

    if (changed) {
      ;(movie as MediaItem).streamingServices = {
        subscription: normalized.subscription,
        free: normalized.free,
      }

      if (imdbId && !(movie as any).imdbId) {
        ;(movie as any).imdbId = imdbId
      }

      updateMovieIndexEntry(movie as MediaItem)
      updatedGuids.push(guid)
    }
  }

  if (updatedGuids.length > 0) {
    await saveState(persistedState).catch(err =>
      log.warn(`Failed to persist Plex availability backfill: ${err}`)
    )
  }

  return updatedGuids.length
}

export function ensurePlexHydrationReady(): Promise<void> {
  if (!plexHydrationPromise) {
    plexHydrationPromise = (async () => {
      const start = Date.now()
      await waitForPlexCacheReady()
      const updated = await hydratePersistedMoviesWithPlexAvailability()
      const duration = Date.now() - start
      log.info(
        `Watch list hydration ready (updated ${updated} persisted movie(s) in ${duration}ms)`
      )
    })().catch(err => {
      plexHydrationPromise = null
      log.error(
        `Failed to hydrate persisted movies with Plex availability: ${
          err?.message || err
        }`
      )
      throw err
    })
  }

  return plexHydrationPromise
}

export const getSession = (roomCode: string, ws: WebSocket): Session => {
  const normalizedCode = normalizeRoomCode(roomCode)
  if (activeSessions.has(normalizedCode))
    return activeSessions.get(normalizedCode)!
  const session = new Session(normalizedCode)
  activeSessions.set(normalizedCode, session)
  log.debug(
    `New session created. Active session ids are: ${[
      ...activeSessions.keys(),
    ].join(', ')}`
  )
  return session
}

// -------------------------
// Login flow
// -------------------------
export const handleLogin = (
  ws: WebSocket,
  clientIp = 'unknown',
  cookieAccessPassword = '',
  userHasServerAccess = true
): Promise<User> => {
  return new Promise(resolve => {
    const handler = async (msg: string) => {
      let data: WebSocketMessage
      try {
        data = JSON.parse(msg)
      } catch (err) {
        log.warn(`Failed to parse login message JSON: ${errorMessage(err)}`)
        const response: WebSocketLoginResponseMessage = {
          type: 'loginResponse',
          payload: {
            success: false,
            message: 'Invalid message format.',
          },
        }
        ws.send(JSON.stringify(response))
        ws.close(1003, 'Invalid login message format')
        return
      }

      try {
        if (data.type === 'login') {
          log.info(`Got a login attempt from ${data.payload.name}`)

          if (!loginRateLimiter.check(clientIp)) {
            const response: WebSocketLoginResponseMessage = {
              type: 'loginResponse',
              payload: {
                success: false,
                message: 'Too many login attempts. Please wait.',
              },
            }
            ws.send(JSON.stringify(response))
            return
          }

          // Check access credential — accepts either:
          //   • a session token from the cookie (browser path, post-login)
          //   • a raw password from the WS message payload (API/native clients)
          const accessPassword = getAccessPassword()
          const candidateToken =
            data.payload.accessPassword || cookieAccessPassword
          if (accessPassword) {
            const sessionOk = validateAccessSession(candidateToken)
            const passwordOk =
              !sessionOk &&
              (await verifyPassword(candidateToken, accessPassword))
            if (!sessionOk && !passwordOk) {
              log.warn(`Invalid access credential from ${data.payload.name}`)
              const response: WebSocketLoginResponseMessage = {
                type: 'loginResponse',
                payload: {
                  success: false,
                  message: 'Incorrect access password. Please try again.',
                },
              }
              ws.send(JSON.stringify(response))
              return
            }
          }

          log.info(`Valid login from ${data.payload.name}`)
          const roomCode = normalizeRoomCode(data.payload.roomCode)

          if (!isValidRoomCode(roomCode)) {
            const response: WebSocketLoginResponseMessage = {
              type: 'loginResponse',
              payload: {
                success: false,
                message: `Room code must be exactly ${ROOM_CODE_LENGTH} characters (A-Z or 0-9).`,
              },
            }
            ws.send(JSON.stringify(response))
            return
          }

          const session = getSession(roomCode, ws)

          const activeUsersWithSameName = [...session.users.entries()].filter(
            ([sessionUser, sessionSocket]) =>
              sessionUser.name === data.payload.name &&
              sessionSocket &&
              !sessionSocket.isClosed
          )

          const existingUser = [...session.users.keys()].find(
            ({ name }) => name === data.payload.name
          )

          if (activeUsersWithSameName.length > 0) {
            if (!data.payload.forceTakeover) {
              log.info(
                `${data.payload.name} already has an active session in ${roomCode}`
              )
              const response: WebSocketLoginResponseMessage = {
                type: 'loginResponse',
                payload: {
                  success: false,
                  code: 'ACTIVE_SESSION_EXISTS',
                  message: `${data.payload.name} is already logged in. Try another name!`,
                },
              }
              ws.send(JSON.stringify(response))
              return
            }

            for (const [
              sessionUser,
              sessionSocket,
            ] of activeUsersWithSameName) {
              log.info(
                `Force logout for ${sessionUser.name} in room ${roomCode} due to takeover request`
              )
              sessionSocket?.close(
                4001,
                'Logged out because another session continued login'
              )
            }
          }

          ensurePlexHydrationReady().catch(err => {
            log.warn(
              `Continuing login for ${
                data.payload.name
              } while Plex hydration finishes in background: ${
                err?.message || err
              }`
            )
          })

          const user: User = existingUser ?? {
            name: data.payload.name,
            responses: [],
          }
          // Re-resolve hasServerAccess from the live session store so first-time
          // logins (WS opened before Plex auth completed) get the correct value.
          const personalRoomMatch = roomCode.match(/^U(\d+)$/)
          if (personalRoomMatch) {
            const userId = parseInt(personalRoomMatch[1], 10)
            const liveSession = findSessionByUserId(userId)
            user.hasServerAccess = liveSession?.hasServerAccess !== false
          } else {
            user.hasServerAccess = userHasServerAccess
          }

          log.debug(
            `${existingUser ? 'Existing user' : 'New user'} ${
              user.name
            } logged in`
          )

          ws.removeListener('message', handler)
          session.add(user, ws)

          const hasUnratedMoviesForUser = session.movieList.some(movie => {
            if (user.responses.some(response => response.guid === movie.guid)) {
              return false
            }
            const movieTmdbId =
              movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)
            if (movieTmdbId == null) {
              return true
            }
            return !user.responses.some(response => {
              const ratedTmdbId =
                response.tmdbId ?? extractTmdbIdFromGuid(response.guid)
              return ratedTmdbId === movieTmdbId
            })
          })

          if (!hasUnratedMoviesForUser) {
            await session.sendNextBatch(
              undefined,
              {
                suppressBroadcast: true,
                softTimeoutMs: LOGIN_PREFETCH_SOFT_TIMEOUT_MS,
                hardTimeoutMs: LOGIN_PREFETCH_HARD_TIMEOUT_MS,
              },
              user
            )
          }

          let responsesMutated = dedupeUserResponses(user, session)

          const ratedItems: RatedPayloadItem[] = []
          const ratedGuidSet = new Set<string>()
          const ratedTmdbIdSet = new Set<number>()
          const tmdbIdsInItems = new Set<number>()

          for (const responseItem of user.responses) {
            const resolvedGuid =
              typeof responseItem.guid === 'string' ? responseItem.guid : ''
            const tmdbId =
              responseItem.tmdbId ??
              extractTmdbIdFromGuid(resolvedGuid) ??
              session.movieForGuid(resolvedGuid)?.tmdbId ??
              null

            if (tmdbId != null && responseItem.tmdbId == null) {
              responseItem.tmdbId = tmdbId
              responsesMutated = true
            }

            let movie = session.movieForGuid(resolvedGuid)
            if (!movie && tmdbId != null) {
              const fallbackMovie = findMovieByTmdbId(tmdbId)
              if (fallbackMovie) {
                movie = fallbackMovie
                if (fallbackMovie.guid !== resolvedGuid) {
                  responseItem.guid = fallbackMovie.guid
                  responsesMutated = true
                }
              }
            }

            const effectiveGuid = responseItem.guid
            const alreadySeenGuid = ratedGuidSet.has(effectiveGuid)
            const alreadySeenTmdb = tmdbId != null && tmdbIdsInItems.has(tmdbId)

            ratedGuidSet.add(effectiveGuid)
            if (tmdbId != null) {
              ratedTmdbIdSet.add(tmdbId)
            }

            if (!movie) {
              continue
            }

            if (alreadySeenGuid || alreadySeenTmdb) {
              continue
            }

            if (tmdbId != null) {
              tmdbIdsInItems.add(tmdbId)
            }

            if (responseItem.wantsToWatch === null) {
              // Seen items: send only identifiers — full movie data is fetched
              // lazily via /api/seen-movies when the user opens the Seen tab.
              // This keeps the loginResponse payload small even with 1000s of
              // seen movies.
              ratedItems.push({
                guid: effectiveGuid,
                wantsToWatch: null,
                tmdbId: tmdbId ?? null,
              })
            } else {
              // Watch / Pass items: send full movie data (these lists stay small).
              ensureComparrScore(movie)
              ratedItems.push({
                guid: effectiveGuid,
                wantsToWatch: responseItem.wantsToWatch,
                movie,
              })
            }
          }

          // Persist (make sure this user is in the room set)
          upsertRoomUser(session.roomCode, user)
          saveState(persistedState).catch(err =>
            log.warn(`Failed to save state on login: ${err}`)
          )
          if (responsesMutated) {
            log.debug(
              `Normalized stored responses for ${user.name} during login`
            )
          }

          // Re-send any unseen movies from this session — matches themselves are fetched
          // separately via /api/matches/connections (friend comparison), not pushed at login.
          const unseenMovies = session.movieList.filter(movie => {
            if (ratedGuidSet.has(movie.guid)) {
              return false
            }

            const movieTmdbId =
              movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)
            if (movieTmdbId && ratedTmdbIdSet.has(movieTmdbId)) {
              return false
            }

            return true
          })
          const memberNames = [...session.users.keys()].map(u => u.name)
          const response: WebSocketLoginResponseMessage = {
            type: 'loginResponse',
            payload: {
              success: true,
              hasServerAccess: user.hasServerAccess !== false,
              movies: unseenMovies,
              rated: ratedItems,
              members: memberNames,
            },
          }
          log.debug(
            `Login response sending ${unseenMovies.length} movies to ${user.name} (${ratedItems.length} rated)`
          )

          ws.send(JSON.stringify(response))

          return resolve(user)
        }
      } catch (err) {
        log.error(`Failed to process login message: ${errorMessage(err)}`)
      }
    }
    ws.addListener('message', handler)
  })
}

// -------------------------
// Bulk IMDb import
// -------------------------
export interface ImportedMovie {
  guid: string
  title: string
  year: string
  summary: string
  art: string
  rating: string
  key: string
  type: 'movie'
  tmdbId: number | null
  imdbId?: string
  genres?: string[]
  runtime?: number
  contentRating?: string
  streamingServices?: { subscription: any[]; free: any[] }
  watchProviders?: any[]
  streamingLink?: string | null
  trailerKey?: string | null
}

/**
 * Bulk-import movies as "seen" (wantsToWatch=null) for a user in a room.
 * Creates the room/user if they don't exist. Returns the list of newly
 * imported movies (skips duplicates).
 */
export async function bulkImportSeen(
  roomCode: string,
  userName: string,
  movies: ImportedMovie[]
): Promise<{ imported: number; skipped: number; movies: ImportedMovie[] }> {
  // Ensure room exists in persisted state
  const room = (persistedState.rooms[roomCode] ??= { users: [] })

  // Find or create user
  let userEntry = room.users.find(u => u.name === userName)
  if (!userEntry) {
    userEntry = { name: userName, responses: [] }
    room.users.push(userEntry)
  }

  // Build sets of existing responses for fast duplicate detection
  const existingGuids = new Set<string>()
  const existingTmdbIds = new Set<number>()

  for (const r of userEntry.responses) {
    if (r.guid) existingGuids.add(r.guid)
    if (r.tmdbId != null) existingTmdbIds.add(r.tmdbId)
    const tmdbFromGuid = extractTmdbIdFromGuid(r.guid)
    if (tmdbFromGuid != null) existingTmdbIds.add(tmdbFromGuid)
  }

  let imported = 0
  let skipped = 0
  const importedMovies: ImportedMovie[] = []

  for (const movie of movies) {
    const tmdbId = movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)

    // Skip if already rated
    if (existingGuids.has(movie.guid)) {
      skipped++
      continue
    }
    if (tmdbId != null && existingTmdbIds.has(tmdbId)) {
      skipped++
      continue
    }

    // Add response
    userEntry.responses.push({
      guid: movie.guid,
      wantsToWatch: null, // seen
      tmdbId: tmdbId ?? null,
    })

    // Track for dedup
    existingGuids.add(movie.guid)
    if (tmdbId != null) existingTmdbIds.add(tmdbId)

    // Add to movie index
    const mediaItem: MediaItem = {
      guid: movie.guid,
      title: movie.title,
      summary: movie.summary,
      year: movie.year,
      art: movie.art,
      rating: movie.rating,
      rating_tmdb: (movie as any).rating_tmdb ?? null,
      key: movie.key,
      type: 'movie',
      tmdbId: tmdbId ?? null,
      genres: movie.genres,
      runtime: movie.runtime,
      contentRating: movie.contentRating,
      streamingServices: movie.streamingServices ?? {
        subscription: [],
        free: [],
      },
      watchProviders: movie.watchProviders ?? [],
      streamingLink: movie.streamingLink ?? null,
      trailerKey: movie.trailerKey ?? null,
    }

    // Store imdbId as ad-hoc property (used by enrich/refresh lookups)
    if (movie.imdbId) {
      ;(mediaItem as any).imdbId = movie.imdbId
    }

    updateMovieIndexEntry(mediaItem)

    imported++
    importedMovies.push(movie)
  }

  // Save state
  await saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after IMDb import: ${err}`)
  )

  log.info(
    `IMDb import: ${imported} imported, ${skipped} skipped for ${userName} in room ${roomCode}`
  )
  return { imported, skipped, movies: importedMovies }
}

// -------------------------
// Background IMDb Import with WebSocket Updates
// -------------------------
export interface ImdbImportJob {
  roomCode: string
  userName: string
  imdbRows: Array<{ imdbId: string; title: string; year: number | null }>
  importHistoryId?: string
}

// Track active import cancellation requests keyed by "roomCode:userName"
const cancelledImports = new Set<string>()

export function cancelImdbImport(roomCode: string, userName: string): void {
  cancelledImports.add(`${roomCode}:${userName}`)
}

/**
 * Remove a set of movies (by guid) from a user's response list and the movie index.
 * Used to roll back a cancelled import.
 */
export async function rollbackImdbImport(
  roomCode: string,
  userName: string,
  guids: string[]
): Promise<{ removed: number }> {
  if (!guids.length) return { removed: 0 }

  const guidSet = new Set(guids)
  const room = persistedState.rooms[roomCode]
  if (!room) return { removed: 0 }

  const userEntry = room.users.find(u => u.name === userName)
  if (!userEntry) return { removed: 0 }

  const before = userEntry.responses.length
  userEntry.responses = userEntry.responses.filter(r => !guidSet.has(r.guid))
  const removed = before - userEntry.responses.length

  // Remove from movie index only if no other user in any room references the guid
  for (const guid of guidSet) {
    let stillReferenced = false
    outer: for (const r of Object.values(persistedState.rooms)) {
      for (const u of r.users) {
        if (u.responses.some(resp => resp.guid === guid)) {
          stillReferenced = true
          break outer
        }
      }
    }
    if (!stillReferenced) {
      delete persistedState.movieIndex[guid]
    }
  }

  await saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after import rollback: ${err}`)
  )

  return { removed }
}

/**
 * Return full movie objects for a user's Seen list.
 * Used by GET /api/seen-movies so the client can lazily load Seen list data
 * without it bloating the initial loginResponse payload.
 */
export function getUserSeenMovies(
  roomCode: string,
  userName: string
): MediaItem[] {
  const room = persistedState.rooms[roomCode]
  if (!room) return []

  const userEntry = room.users.find(u => u.name === userName)
  if (!userEntry) return []

  const movies: MediaItem[] = []
  const seen = new Set<string>()

  for (const r of userEntry.responses) {
    if (r.wantsToWatch !== null) continue
    if (seen.has(r.guid)) continue
    seen.add(r.guid)

    const movie = persistedState.movieIndex[r.guid]
    if (!movie) continue

    ensureComparrScore(movie)
    movies.push(movie)
  }

  return movies
}

/**
 * Find the WebSocket for a user in a room.
 */
function findUserWebSocket(
  roomCode: string,
  userName: string
): WebSocket | null {
  const session = activeSessions.get(roomCode)
  if (!session) return null

  for (const [user, ws] of session.users.entries()) {
    if (user.name === userName && ws) {
      return ws
    }
  }
  return null
}

/**
 * Send a message to a specific user via WebSocket.
 */
function sendToUser(roomCode: string, userName: string, message: any): boolean {
  const ws = findUserWebSocket(roomCode, userName)
  if (!ws) return false

  try {
    ws.send(JSON.stringify(message))
    return true
  } catch (err) {
    log.warn(`Failed to send WS message to ${userName}: ${err}`)
    return false
  }
}

export function sendImdbImportProgressUpdate(
  roomCode: string,
  userName: string,
  payload: {
    status: 'started' | 'processing' | 'completed' | 'cancelled'
    total: number
    processed: number
    imported: number
    skipped: number
    notFoundOnTmdb?: number
    duplicates?: number
    apiErrors?: number
    stage?: string
  }
): boolean {
  return sendToUser(roomCode, userName, {
    type: 'imdbImportProgress',
    payload,
  })
}

/**
 * Process IMDb import in background with rate limiting and full enrichment.
 * Sends each movie to the user via WebSocket as it's processed.
 */
export async function processImdbImportBackground(
  job: ImdbImportJob
): Promise<void> {
  const { roomCode, userName, imdbRows, importHistoryId } = job
  const total = imdbRows.length

  log.info(
    `[IMDb Import] Starting background import of ${total} movies for ${userName} in ${roomCode}`
  )

  // Build existing response sets for dedup
  const room = persistedState.rooms[roomCode] ?? { users: [] }
  let userEntry = room.users.find(u => u.name === userName)
  if (!userEntry) {
    userEntry = { name: userName, responses: [] }
    room.users.push(userEntry)
    persistedState.rooms[roomCode] = room
  }

  const existingGuids = new Set<string>()
  const existingTmdbIds = new Set<number>()
  for (const r of userEntry.responses) {
    if (r.guid) existingGuids.add(r.guid)
    if (r.tmdbId != null) existingTmdbIds.add(r.tmdbId)
    const tmdbFromGuid = extractTmdbIdFromGuid(r.guid)
    if (tmdbFromGuid != null) existingTmdbIds.add(tmdbFromGuid)
  }

  let processed = 0
  let imported = 0
  let skipped = 0
  let notFoundOnTmdb = 0
  let duplicates = 0
  let apiErrors = 0

  const emitProcessingProgress = (stage?: string) =>
    sendImdbImportProgressUpdate(roomCode, userName, {
      status: 'processing',
      total,
      processed,
      imported,
      skipped,
      notFoundOnTmdb,
      duplicates,
      apiErrors,
      stage,
    })

  const TMDB_KEY = getTmdbApiKey()
  const cancelKey = `${roomCode}:${userName}`

  for (const row of imdbRows) {
    // Check for cancellation before processing each movie
    if (cancelledImports.has(cancelKey)) {
      cancelledImports.delete(cancelKey)
      log.info(
        `[IMDb Import] Cancelled for ${userName} in ${roomCode} after ${processed} movies`
      )
      await saveState(persistedState).catch(err =>
        log.warn(`Failed to save state on cancel: ${err}`)
      )
      if (importHistoryId) {
        finalizeImdbImportHistory(roomCode, userName, importHistoryId, 'failed')
        await saveState(persistedState).catch(err =>
          log.warn(`Failed to save import history on cancel: ${err}`)
        )
      }
      sendToUser(roomCode, userName, {
        type: 'imdbImportProgress',
        payload: {
          status: 'cancelled',
          total,
          processed,
          imported,
          skipped,
          notFoundOnTmdb,
          duplicates,
          apiErrors,
        },
      })
      return
    }

    processed++

    // Emit an immediate heartbeat before waiting on rate limits / network so
    // long first-lookups still show visible movement in the UI.
    emitProcessingProgress('looking_up_tmdb')

    // Rate limit: wait for token before making API calls
    await tmdbRateLimiter.acquire()

    try {
      // 1. Look up movie by IMDb ID via TMDb find endpoint
      const findResp = await tmdbFetch(`/find/${row.imdbId}`, TMDB_KEY, {
        external_source: 'imdb_id',
      })

      if (!findResp.ok) {
        log.debug(
          `[IMDb Import] TMDb find failed for ${row.imdbId}: HTTP ${findResp.status}`
        )
        apiErrors++
        skipped++
        emitProcessingProgress()
        continue
      }

      const findData = await findResp.json()
      const tmdbMovie = findData.movie_results?.[0]

      if (!tmdbMovie) {
        log.debug(
          `[IMDb Import] No TMDb result for ${row.imdbId} (${row.title})`
        )
        notFoundOnTmdb++
        skipped++
        emitProcessingProgress()
        continue
      }

      const tmdbId = tmdbMovie.id
      const guid = `tmdb://${tmdbId}`

      // Check for duplicates
      if (existingGuids.has(guid) || existingTmdbIds.has(tmdbId)) {
        duplicates++
        skipped++
        emitProcessingProgress()
        continue
      }

      // 2. Build movie object from /find/ data only — no enrich() call.
      // enrich() makes 2-3 extra unrate-limited TMDb calls per movie which
      // starves the swipe screen's discovery requests. Basic data from /find/
      // is sufficient to mark movies as seen; enrichment happens lazily later.
      const posterPath = tmdbMovie.poster_path
      const artUrl = posterPath ? getBestPosterUrl(posterPath, 'tmdb') : ''

      if (posterPath) {
        prefetchPoster(posterPath, 'tmdb')
      }

      const tmdbRating = tmdbMovie.vote_average
        ? tmdbMovie.vote_average.toFixed(1)
        : null
      const ratingStr = tmdbRating ? `TMDb: ${tmdbRating}` : ''

      const movie: ImportedMovie = {
        guid,
        title: tmdbMovie.title,
        year: tmdbMovie.release_date
          ? String(new Date(tmdbMovie.release_date).getFullYear())
          : '',
        summary: tmdbMovie.overview || '',
        art: artUrl,
        rating: ratingStr,
        key: `/tmdb/${tmdbId}`,
        type: 'movie',
        tmdbId,
        imdbId: row.imdbId,
        genres: [],
        runtime: undefined,
        contentRating: undefined,
        streamingServices: { subscription: [], free: [] },
        watchProviders: [],
        streamingLink: null,
      }

      // Also include fields needed by frontend filtering
      const movieWithExtras = {
        ...movie,
        genre_ids: tmdbMovie.genre_ids || [],
        vote_count: tmdbMovie.vote_count || 0,
        original_language: tmdbMovie.original_language || null,
        director: null,
        cast: [],
        castMembers: [],
        writers: [],
        rating_tmdb: tmdbRating,
        rating_comparr: null,
      }

      // 4. Add response to user (persisted layer + live in-memory session user).
      // The import operates on persistedState directly, so we must also update
      // the active in-memory Session user to prevent a subsequent swipe from
      // calling upsertRoomUser with a stale copy that erases these responses.
      const newResponse = { guid, wantsToWatch: null as null, tmdbId }
      userEntry.responses.push(newResponse)
      const activeSession = activeSessions.get(roomCode)
      const activeSessionUser = activeSession
        ? [...activeSession.users.keys()].find((u: User) => u.name === userName)
        : undefined
      if (activeSessionUser) {
        activeSessionUser.responses.push(newResponse)
      }
      existingGuids.add(guid)
      existingTmdbIds.add(tmdbId)

      // 5. Add to movie index
      const mediaItem: MediaItem = {
        guid,
        title: movie.title,
        summary: movie.summary,
        year: movie.year,
        art: movie.art,
        rating: movie.rating,
        rating_tmdb: tmdbMovie.vote_average ?? null,
        key: movie.key,
        type: 'movie',
        tmdbId,
        genres: movie.genres,
        runtime: movie.runtime ?? undefined,
        contentRating: movie.contentRating ?? undefined,
        streamingServices: movie.streamingServices,
        watchProviders: movie.watchProviders ?? [],
        streamingLink: movie.streamingLink,
      }
      if (row.imdbId) {
        ;(mediaItem as any).imdbId = row.imdbId
      }
      updateMovieIndexEntry(mediaItem)

      imported++

      // 6. Send movie to user via WebSocket
      sendToUser(roomCode, userName, {
        type: 'imdbImportMovie',
        payload: {
          movie: movieWithExtras,
          progress: {
            total,
            processed,
            imported,
            skipped,
            notFoundOnTmdb,
            duplicates,
            apiErrors,
          },
        },
      })

      // Save state periodically (every 25 movies)
      if (imported % 25 === 0) {
        await saveState(persistedState).catch(err =>
          log.warn(`Failed to save state during import: ${err}`)
        )
      }
    } catch (err) {
      log.warn(
        `[IMDb Import] Failed to process ${row.imdbId}: ${errorMessage(err)}`
      )
      apiErrors++
      skipped++
    }

    // Send progress update after each processed movie.
    emitProcessingProgress()

    // Yield to the event loop so WebSocket handlers and other requests
    // (e.g. swipe screen discovery) are not starved during long imports.
    await new Promise(resolve => setTimeout(resolve, 0))
  }

  // Final save
  await saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after import: ${err}`)
  )

  if (importHistoryId) {
    finalizeImdbImportHistory(roomCode, userName, importHistoryId, 'successful')
    await saveState(persistedState).catch(err =>
      log.warn(`Failed to save import history state: ${err}`)
    )
  }

  // Send completion message
  sendToUser(roomCode, userName, {
    type: 'imdbImportProgress',
    payload: {
      status: 'completed',
      total,
      processed,
      imported,
      skipped,
      notFoundOnTmdb,
      duplicates,
      apiErrors,
    },
  })

  log.info(
    `[IMDb Import] Completed: ${imported} imported, ${skipped} skipped (${notFoundOnTmdb} not found, ${duplicates} duplicates, ${apiErrors} errors) for ${userName} in ${roomCode}`
  )
}

// -------------------------
// Admin helpers — read/clear live persistedState
// -------------------------

export function getAllRooms(): Record<
  string,
  { users: Record<string, unknown> }
> {
  const result: Record<string, { users: Record<string, unknown> }> = {}
  for (const [roomCode, room] of Object.entries(persistedState.rooms)) {
    const users: Record<string, unknown> = {}
    for (const user of room.users) {
      users[user.name] = { responses: user.responses }
    }
    result[roomCode] = { users }
  }
  return result
}

export function clearAllRooms(): void {
  persistedState.rooms = {}
  // Close all active WebSocket connections and destroy sessions so that a
  // reconnecting login cannot call upsertRoomUser and re-persist the cleared data.
  for (const [code, session] of activeSessions.entries()) {
    for (const ws of session.users.values()) {
      try {
        ws?.close(1001, 'Room cleared by admin')
      } catch {
        /* no-op */
      }
    }
    activeSessions.delete(code)
  }
  saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after clearAllRooms: ${err}`)
  )
}

export function clearRooms(roomCodes: string[]): void {
  for (const code of roomCodes) {
    delete persistedState.rooms[code]
    // Close WebSocket connections and remove the session so login cannot
    // re-persist the room via upsertRoomUser.
    const session = activeSessions.get(code)
    if (session) {
      for (const ws of session.users.values()) {
        try {
          ws?.close(1001, 'Room cleared by admin')
        } catch {
          /* no-op */
        }
      }
      activeSessions.delete(code)
    }
  }
  saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after clearRooms: ${err}`)
  )
}

export function clearUsersFromRoom(
  roomCode: string,
  userNames: string[]
): void {
  const room = persistedState.rooms[roomCode]
  if (room) {
    room.users = room.users.filter(u => !userNames.includes(u.name))
    if (room.users.length === 0) {
      delete persistedState.rooms[roomCode]
    }
  }
  // Close WebSocket connections for cleared users and remove them from the
  // live session so login cannot re-persist their data via upsertRoomUser.
  const session = activeSessions.get(roomCode)
  if (session) {
    for (const [user, ws] of session.users.entries()) {
      if (userNames.includes(user.name)) {
        try {
          ws?.close(1001, 'User history cleared by admin')
        } catch {
          /* no-op */
        }
        session.users.delete(user)
      }
    }
  }
  saveState(persistedState).catch(err =>
    log.warn(`Failed to save state after clearUsersFromRoom: ${err}`)
  )
}

export function clearUsersFromAllRooms(userNames: string[]): void {
  if (!Array.isArray(userNames) || userNames.length === 0) return
  const targetNames = Array.from(
    new Set(userNames.map(name => String(name || '').trim()).filter(Boolean))
  )
  if (targetNames.length === 0) return
  for (const roomCode of Object.keys(persistedState.rooms)) {
    clearUsersFromRoom(roomCode, targetNames)
  }
}

/**
 * Cross-reference two users' liked movies and return the shared subset.
 * Used by the Compare feature — works across any two room codes so users
 * from different rooms (or different auth providers) can compare picks.
 */
export function getCompareMatches(
  roomCodeA: string,
  nameA: string,
  roomCodeB: string,
  nameB: string
): MediaItem[] {
  const roomA = persistedState.rooms[roomCodeA]
  const roomB = persistedState.rooms[roomCodeB]

  const userA = roomA?.users.find(u => u.name === nameA)
  const userB = roomB?.users.find(u => u.name === nameB)

  if (!userA || !userB) return []

  // Build both GUID and TMDb ID sets for A's likes so cross-source matches
  // (e.g. A liked via Plex, B liked via TMDb discovery) are detected.
  const likedByAGuids = new Set<string>()
  const likedByATmdbIds = new Set<number>()
  for (const r of userA.responses) {
    if (r.wantsToWatch !== true) continue
    likedByAGuids.add(r.guid)
    const tmdbId = r.tmdbId ?? extractTmdbIdFromGuid(r.guid)
    if (tmdbId != null) likedByATmdbIds.add(tmdbId)
  }

  const seen = new Set<string>() // deduplicate by guid
  const results: MediaItem[] = []

  for (const r of userB.responses) {
    if (r.wantsToWatch !== true) continue

    const guidMatch = likedByAGuids.has(r.guid)
    const tmdbId = r.tmdbId ?? extractTmdbIdFromGuid(r.guid)
    const tmdbMatch = tmdbId != null && likedByATmdbIds.has(tmdbId)

    if (!guidMatch && !tmdbMatch) continue
    if (seen.has(r.guid)) continue
    seen.add(r.guid)

    // Prefer movie data from the index; fall back to the other user's index entry
    const movie =
      persistedState.movieIndex[r.guid] ??
      (tmdbId != null
        ? Object.values(persistedState.movieIndex).find(
            m => (m.tmdbId ?? extractTmdbIdFromGuid(m.guid)) === tmdbId
          )
        : undefined)

    if (movie) results.push(movie)
  }

  return results
}

// ── Plex Watchlist / Seen Sync ────────────────────────────────────────────

export interface PlexSyncProgressPayload {
  syncType: 'watchlist' | 'seen'
  status: 'started' | 'processing' | 'completed' | 'error'
  total: number
  processed: number
  synced: number
  removed: number
  alreadySynced: number
  skipped: number
  errors: number
  // Only populated in the 'completed' event
  syncedItems?: string[]
  removedItems?: string[]
  alreadySyncedItems?: string[]
  skippedItems?: string[]
  errorItems?: string[]
}

export function sendPlexSyncProgressUpdate(
  roomCode: string,
  userName: string,
  payload: PlexSyncProgressPayload
): boolean {
  return sendToUser(roomCode, userName, { type: 'plexSyncProgress', payload })
}

/**
 * Return full movie objects for a user's Watchlist (wantsToWatch === true).
 */
export function getUserWatchlistMovies(
  roomCode: string,
  userName: string
): MediaItem[] {
  const room = persistedState.rooms[roomCode]
  if (!room) return []

  const userEntry = room.users.find(u => u.name === userName)
  if (!userEntry) return []

  const movies: MediaItem[] = []
  const seen = new Set<string>()

  for (const r of userEntry.responses) {
    if (r.wantsToWatch !== true) continue
    if (seen.has(r.guid)) continue
    seen.add(r.guid)

    const movie = persistedState.movieIndex[r.guid]
    if (!movie) continue

    movies.push(movie)
  }

  return movies
}

export interface PlexSyncJob {
  roomCode: string
  userName: string
  userId: number
  userPlexToken: string
  serverUrl: string
}

interface PlexSyncState {
  [guid: string]: { metadataKey?: string; ratingKey?: string; syncedAt: string; title?: string }
}

/**
 * After a Like, check whether it just completed a match with any accepted friend, using the same
 * friend-comparison logic the Friends tab uses (getCompareMatches) — not the old session-scoped
 * same-room match detection, which is dead: no client (mobile or web) ever puts two real users in
 * the same room anymore, every login connects to its own personal room.
 *
 * Fires a 'match' WS event to the swiping user's own socket only, the moment their own Like
 * completes the match — the friend isn't notified in real time, they'll see it next time their
 * own Friends/Matches list refreshes (same as any other friend-match). Stops at the first
 * matching friend even if there are several — one celebration per Like is enough.
 */
function checkForNewFriendMatch(
  user: User,
  roomCode: string,
  movie: MediaItem,
  ws: WebSocket | null | undefined
): void {
  if (!ws || ws.isClosed) return
  const personalRoomMatch = roomCode.match(/^U(\d+)$/)
  const userId = personalRoomMatch ? parseInt(personalRoomMatch[1], 10) : null
  if (userId == null) return

  const friends = getFriendConnections(userId).filter(f => f.status === 'accepted')
  for (const friend of friends) {
    const friendRoomCode = `U${String(friend.friendUserId).padStart(3, '0')}`
    const matches = getCompareMatches(roomCode, user.name, friendRoomCode, friend.friendUsername)
    if (matches.some(m => m.guid === movie.guid)) {
      const message: WebSocketMatchMessage = {
        type: 'match',
        payload: { movie, users: [user.name, friend.friendUsername], createdAt: Date.now() },
      }
      ws.send(JSON.stringify(message))
      return
    }
  }
}

/**
 * Fires the same reconciliation job the manual /api/plex-sync route uses (still needed by the
 * legacy web app's Sync buttons), but automatically after every swipe/rate — gated by the
 * mobile-only autoSyncPlexWatchlist/autoSyncPlexSeen display preferences. Every personal room is
 * `U<userId>` by construction (see roomCodeForUser in routes/compare.ts), so userId is always
 * recoverable from the room code without a session->account lookup table.
 *
 * The two sync types depend on genuinely different things, and must not be conflated:
 *  - Watchlist sync needs a Plex ACCOUNT authorized (plex.tv account token) — either from
 *    signing into Comparr via Plex, or from connecting a Plex account separately without that
 *    being the login method (see routes/plex-account-connect.ts). It's a cloud-only action
 *    against Plex's Discover catalog, no server involved.
 *  - Seen sync needs a Plex SERVER CONNECTION (Profile → Advanced Settings → Plex, independent
 *    of how the user logged into Comparr) — scrobbling only makes sense for a movie that exists
 *    in that specific library. A user could have either, both, or neither.
 */
function maybeAutoSyncPlex(roomCode: string, userName: string, kind: 'watchlist' | 'seen'): void {
  const personalRoomMatch = roomCode.match(/^U(\d+)$/)
  const userId = personalRoomMatch ? parseInt(personalRoomMatch[1], 10) : null
  if (userId == null) return

  const settings = getUserSettings(userId)
  if (!settings) return

  let preferences: Record<string, unknown> = {}
  try {
    preferences = JSON.parse(settings.displayPreferences || '{}')
  } catch {
    return
  }

  if (kind === 'watchlist') {
    if (preferences.autoSyncPlexWatchlist !== true) return
    // Either source works: signed in with Plex (login-derived token) or connected a Plex
    // account separately without that being the login method (settings.plexAccountToken).
    const userPlexToken = getUserPlexAuthToken(userId) || settings.plexAccountToken
    if (!userPlexToken) return // no Plex account authorized either way — nothing to sync against
    const job: PlexSyncJob = { roomCode, userName, userId, userPlexToken, serverUrl: '' }
    processPlexWatchlistSyncBackground(job).catch(err =>
      log.error(`[plex-sync] auto watchlist sync failed for ${userName}: ${err?.message || err}`)
    )
    return
  }

  if (preferences.autoSyncPlexSeen !== true) return
  if (!settings.plexUrl || !settings.plexToken) return // no personal Plex server connected
  const job: PlexSyncJob = {
    roomCode,
    userName,
    userId,
    userPlexToken: settings.plexToken,
    serverUrl: settings.plexUrl,
  }
  processPlexSeenSyncBackground(job).catch(err =>
    log.error(`[plex-sync] auto seen sync failed for ${userName}: ${err?.message || err}`)
  )
}

/**
 * Trakt auto-sync — unlike Plex, one-way push of both Watchlist and Seen (Trakt calls it
 * "history") only ever needs an authorized Trakt account (login or manual connection), no
 * server. Trakt's /sync endpoints accept a batch per call and already key by TMDb id, so this
 * is a plain tmdbId set diff — no per-movie search/matching needed like Plex's Watchlist sync.
 */
function maybeAutoSyncTrakt(roomCode: string, userName: string, kind: 'watchlist' | 'seen'): void {
  const personalRoomMatch = roomCode.match(/^U(\d+)$/)
  const userId = personalRoomMatch ? parseInt(personalRoomMatch[1], 10) : null
  if (userId == null) return

  const settings = getUserSettings(userId)
  if (!settings) return

  let preferences: Record<string, unknown> = {}
  try {
    preferences = JSON.parse(settings.displayPreferences || '{}')
  } catch {
    return
  }

  const enabled =
    kind === 'watchlist' ? preferences.autoSyncTraktWatchlist === true : preferences.autoSyncTraktSeen === true
  if (!enabled) return

  processTraktSync(userId, roomCode, userName, kind).catch(err =>
    log.error(`[trakt-sync] auto ${kind} sync failed for ${userName}: ${err?.message || err}`)
  )
}

async function getValidTraktAccessToken(
  userId: number,
  settings: UserSettings
): Promise<string | null> {
  const login = getUserTraktLoginTokens(userId)
  const isLoginToken = Boolean(login.accessToken)
  const accessToken = login.accessToken || settings.traktAccessToken
  const refreshToken = login.refreshToken || settings.traktRefreshToken
  const expiresAt = isLoginToken ? login.expiresAt : settings.traktTokenExpiresAt
  if (!accessToken) return null

  // Refresh a bit before actual expiry to avoid a request racing the exact expiry instant.
  const expiresSoon = expiresAt ? Date.parse(expiresAt) < Date.now() + 5 * 60 * 1000 : false
  if (!expiresSoon) return accessToken

  if (!refreshToken) return accessToken // no way to refresh — try the possibly-stale token anyway
  const refreshed = await refreshTraktToken(refreshToken)
  if (!refreshed) return accessToken // refresh failed — try the possibly-stale token anyway

  if (isLoginToken) {
    setUserTraktLoginTokens(userId, refreshed)
  } else {
    upsertUserSettings(userId, {
      traktAccessToken: refreshed.accessToken,
      traktRefreshToken: refreshed.refreshToken,
      traktTokenExpiresAt: refreshed.expiresAt,
    })
  }
  return refreshed.accessToken
}

async function processTraktSync(
  userId: number,
  roomCode: string,
  userName: string,
  kind: 'watchlist' | 'seen'
): Promise<void> {
  const settings = getUserSettings(userId)
  if (!settings) return

  const accessToken = await getValidTraktAccessToken(userId, settings)
  if (!accessToken) return

  const currentMovies =
    kind === 'watchlist' ? getUserWatchlistMovies(roomCode, userName) : getUserSeenMovies(roomCode, userName)
  const currentTmdbIds = new Set(
    currentMovies.map(m => m.tmdbId).filter((id): id is number => id != null)
  )

  const syncStateRaw = kind === 'watchlist' ? settings.traktWatchlistSynced : settings.traktSeenSynced
  const syncState: Record<string, true> = (() => {
    try {
      return JSON.parse(syncStateRaw || '{}')
    } catch {
      return {}
    }
  })()
  const syncedTmdbIds = new Set(Object.keys(syncState).map(Number))

  const toAdd = [...currentTmdbIds].filter(id => !syncedTmdbIds.has(id))
  const toRemove = [...syncedTmdbIds].filter(id => !currentTmdbIds.has(id))
  if (toAdd.length === 0 && toRemove.length === 0) return

  const addFn = kind === 'watchlist' ? addToTraktWatchlist : addToTraktHistory
  const removeFn = kind === 'watchlist' ? removeFromTraktWatchlist : removeFromTraktHistory

  const addOk = toAdd.length === 0 || (await addFn(accessToken, toAdd))
  const removeOk = toRemove.length === 0 || (await removeFn(accessToken, toRemove))

  if (addOk) for (const id of toAdd) syncState[String(id)] = true
  if (removeOk) for (const id of toRemove) delete syncState[String(id)]

  upsertUserSettings(userId, {
    [kind === 'watchlist' ? 'traktWatchlistSynced' : 'traktSeenSynced']: JSON.stringify(syncState),
  })

  log.info(
    `[trakt-sync] ${kind} sync for ${userName}: added=${addOk ? toAdd.length : 0} removed=${removeOk ? toRemove.length : 0}`
  )
}

export async function processPlexWatchlistSyncBackground(
  job: PlexSyncJob
): Promise<void> {
  const { roomCode, userName, userId, userPlexToken } = job

  const currentMovies = getUserWatchlistMovies(roomCode, userName)
  const total = currentMovies.length

  const emit = (
    status: PlexSyncProgressPayload['status'],
    counters: Omit<PlexSyncProgressPayload, 'syncType' | 'status' | 'total'>
  ) =>
    sendPlexSyncProgressUpdate(roomCode, userName, {
      syncType: 'watchlist',
      status,
      total,
      ...counters,
    })

  emit('started', { processed: 0, synced: 0, removed: 0, alreadySynced: 0, skipped: 0, errors: 0 })

  // Load existing sync state
  const settings = getUserSettings(userId)
  const syncState: PlexSyncState = (() => {
    try { return JSON.parse(settings?.plexWatchlistSynced ?? '{}') } catch { return {} }
  })()

  const currentGuids = new Set(currentMovies.map(m => m.guid))
  const previousGuids = new Set(Object.keys(syncState))

  let processed = 0
  let synced = 0
  let removed = 0
  let alreadySynced = 0
  let skipped = 0
  let errors = 0
  const syncedItems: string[] = []
  const removedItems: string[] = []
  const alreadySyncedItems: string[] = []
  const skippedItems: string[] = []
  const errorItems: string[] = []

  const movieTitle = (m: MediaItem) => m.year ? `${m.title} (${m.year})` : m.title

  // Add movies newly on watchlist
  for (const movie of currentMovies) {
    processed++
    // Check already-synced state first — this reconciliation now runs on every swipe (not just
    // a manual button press), so skipping resolution entirely for movies already synced avoids
    // redoing an expensive Discover search + verification round-trip for the whole watchlist on
    // every single swipe.
    if (syncState[movie.guid]) {
      alreadySynced++
      alreadySyncedItems.push(movieTitle(movie))
      emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
      continue
    }
    // Try direct extraction first; if the stored guid isn't plex://movie/ format
    // (e.g. imdb:// from an IMDb import), fall back to the Plex cache (movies the user already
    // owns in their own library), then to a live Plex Discover catalog lookup by TMDb id — a
    // Watchlist is meant to hold movies the user *doesn't* have yet, so most entries only
    // resolve via this last step.
    let metadataKey = extractPlexMetadataKey(movie.guid)
    if (!metadataKey) {
      const plexEntry = getPlexEntryForSync({
        plexGuid: movie.guid,
        tmdbId: movie.tmdbId ?? undefined,
        title: movie.title,
        year: movie.year ? Number(movie.year) : undefined,
      })
      if (plexEntry) metadataKey = extractPlexMetadataKey(plexEntry.guid)
    }
    if (!metadataKey && movie.tmdbId != null) {
      const parsedYear = parseInt(movie.year, 10)
      metadataKey = await resolvePlexDiscoverRatingKey(
        userPlexToken,
        movie.tmdbId,
        movie.title,
        Number.isFinite(parsedYear) ? parsedYear : null
      )
    }
    if (!metadataKey) {
      skipped++
      skippedItems.push(movieTitle(movie))
      emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
      continue
    }
    const ok = await addToPlexWatchlist(userPlexToken, metadataKey)
    if (ok) {
      syncState[movie.guid] = { metadataKey, syncedAt: new Date().toISOString(), title: movieTitle(movie) }
      synced++
      syncedItems.push(movieTitle(movie))
    } else {
      errors++
      errorItems.push(movieTitle(movie))
    }
    emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
  }

  // Remove movies no longer on watchlist
  for (const guid of previousGuids) {
    if (currentGuids.has(guid)) continue
    const entry = syncState[guid]
    const metadataKey = entry?.metadataKey ?? extractPlexMetadataKey(guid)
    if (metadataKey) {
      const ok = await removeFromPlexWatchlist(userPlexToken, metadataKey)
      if (ok) {
        removed++
        removedItems.push(entry?.title ?? guid)
      } else {
        errors++
        errorItems.push(entry?.title ?? guid)
      }
    }
    delete syncState[guid]
  }

  upsertUserSettings(userId, { plexWatchlistSynced: JSON.stringify(syncState) })

  emit('completed', { processed, synced, removed, alreadySynced, skipped, errors, syncedItems, removedItems, alreadySyncedItems, skippedItems, errorItems })

  log.info(
    `[plex-sync] Watchlist sync done for ${userName}: synced=${synced} removed=${removed} skipped=${skipped} errors=${errors}`
  )
}

export async function processPlexSeenSyncBackground(
  job: PlexSyncJob
): Promise<void> {
  // Unlike Watchlist sync (Plex-login/Discover, cloud-only), Seen sync scrobbles against an
  // actual server, so userPlexToken/serverUrl here are the user's own personal Plex server
  // connection (user_settings.plexToken/plexUrl) — a movie has to exist in that specific library
  // to be markable as watched at all.
  const { roomCode, userName, userId, userPlexToken, serverUrl } = job

  const personalLibrary = await getPersonalPlexLibrary(serverUrl, userPlexToken).catch(err => {
    log.warn(`[plex-sync] Failed to fetch personal Plex library for ${userName}: ${err}`)
    return [] as Awaited<ReturnType<typeof getPersonalPlexLibrary>>
  })

  const currentMovies = getUserSeenMovies(roomCode, userName)
  const total = currentMovies.length

  const emit = (
    status: PlexSyncProgressPayload['status'],
    counters: Omit<PlexSyncProgressPayload, 'syncType' | 'status' | 'total'>
  ) =>
    sendPlexSyncProgressUpdate(roomCode, userName, {
      syncType: 'seen',
      status,
      total,
      ...counters,
    })

  emit('started', { processed: 0, synced: 0, removed: 0, alreadySynced: 0, skipped: 0, errors: 0 })

  const settings = getUserSettings(userId)
  const syncState: PlexSyncState = (() => {
    try { return JSON.parse(settings?.plexSeenSynced ?? '{}') } catch { return {} }
  })()

  const currentGuids = new Set(currentMovies.map(m => m.guid))
  const previousGuids = new Set(Object.keys(syncState))

  let processed = 0
  let synced = 0
  let removed = 0
  let alreadySynced = 0
  let skipped = 0
  let errors = 0
  const syncedItems: string[] = []
  const removedItems: string[] = []
  const alreadySyncedItems: string[] = []
  const skippedItems: string[] = []
  const errorItems: string[] = []

  const movieTitle = (m: MediaItem) => m.year ? `${m.title} (${m.year})` : m.title

  for (const movie of currentMovies) {
    processed++
    if (syncState[movie.guid]) {
      alreadySynced++
      alreadySyncedItems.push(movieTitle(movie))
      emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
      continue
    }
    const plexEntry = findInPersonalPlexLibrary(
      personalLibrary,
      movie.tmdbId ?? null,
      movie.title,
      movie.year ? Number(movie.year) : null
    )
    if (!plexEntry) {
      skipped++
      skippedItems.push(movieTitle(movie))
      log.warn(`[plex-sync] skip "${movie.title}" guid=${movie.guid} tmdbId=${movie.tmdbId ?? 'null'}`)
      emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
      continue
    }
    const ok = await scrobbleOnServer(serverUrl, userPlexToken, plexEntry.ratingKey)
    if (ok) {
      syncState[movie.guid] = { ratingKey: plexEntry.ratingKey, syncedAt: new Date().toISOString(), title: movieTitle(movie) }
      synced++
      syncedItems.push(movieTitle(movie))
    } else {
      errors++
      errorItems.push(movieTitle(movie))
    }
    emit('processing', { processed, synced, removed, alreadySynced, skipped, errors })
  }

  for (const guid of previousGuids) {
    if (currentGuids.has(guid)) continue
    const entry = syncState[guid]
    if (entry?.ratingKey) {
      const ok = await unscrobbleOnServer(serverUrl, userPlexToken, entry.ratingKey)
      if (ok) {
        removed++
        removedItems.push(entry?.title ?? guid)
      } else {
        errors++
        errorItems.push(entry?.title ?? guid)
      }
    }
    delete syncState[guid]
  }

  upsertUserSettings(userId, { plexSeenSynced: JSON.stringify(syncState) })

  emit('completed', { processed, synced, removed, alreadySynced, skipped, errors, syncedItems, removedItems, alreadySyncedItems, skippedItems, errorItems })

  log.info(
    `[plex-sync] Seen sync done for ${userName}: synced=${synced} removed=${removed} skipped=${skipped} errors=${errors}`
  )
}
