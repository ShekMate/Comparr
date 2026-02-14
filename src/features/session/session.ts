// deno-lint-ignore-file
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { assert } from 'https://deno.land/std@0.79.0/_util/assert.ts'
import {
  getAllMovies,
  getRandomMovie,
  getFilteredRandomMovie,
  NoMoreMoviesError,
} from '../../api/plex.ts'
import { WebSocket } from '../../infra/ws/websocketServer.ts'
import { enrich } from '../catalog/enrich.ts'
import { discoverMovies } from '../catalog/discover.ts'
import { isMovieInRadarr } from '../../api/radarr.ts'
import {
  isMovieInPlex,
  waitForPlexCacheReady,
} from '../../integrations/plex/cache.ts'
import {
  getAccessPassword,
  getMovieBatchSize,
  getPaidStreamingServices,
  getPersonalMediaSources,
  getPlexLibraryName,
  getRootPath,
  getStreamingProfileMode,
  getTmdbApiKey,
} from '../../core/config.ts'
import {
  validateTMDbPoster,
  getBestPosterPath,
  isMovieValid,
} from '../media/poster-validation.ts'
import {
  getBestPosterUrl,
  prefetchPoster,
} from '../../services/cache/poster-cache.ts'
import { tmdbRateLimiter, omdbRateLimiter } from '../../core/rate-limiter.ts'

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
    const hasImdb = typeof movie.rating_imdb === 'number'
    const hasRt = typeof movie.rating_rt === 'number'
    const hasTmdb = typeof movie.rating_tmdb === 'number'

    if (!hasImdb && !hasRt && !hasTmdb) {
      return
    }

    /*
    // Calculate Comparr score if missing (requires at least 2 ratings)
    const ratings = [];
    if (hasImdb) ratings.push(movie.rating_imdb);
    if (hasTmdb) ratings.push(movie.rating_tmdb);
    if (hasRt) ratings.push(movie.rating_rt / 10);

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
        `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> ${movie.rating_comparr}`
      )
      if (movie.rating_imdb != null) {
        parts.push(
          `<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> ${movie.rating_imdb}`
        )
      }
      if (movie.rating_rt != null) {
        parts.push(
          `<img src="${basePath}/assets/logos/rottentomatoes.svg" alt="RT" class="rating-logo"> ${movie.rating_rt}%`
        )
      }
      if (movie.rating_tmdb != null) {
        parts.push(
          `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${movie.rating_tmdb}`
        )
      }

      if (parts.length > 0) {
        movie.rating = parts.join(
          ' <span class="rating-separator">&bull;</span> '
        )
      }
    }
  } catch (err) {
    log.error(`ensureComparrScore failed for movie: ${err?.message || err}`)
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
}

interface MediaItem {
  guid: string
  title: string
  summary: string
  year: string
  art: string
  director?: string
  cast?: string[]
  writers?: string[]
  genres?: string[]
  contentRating?: string
  runtime?: number
  rating: string
  key: string
  type: 'movie' | 'artist' | 'photo' | 'show'
  streamingServices?: { subscription: any[]; free: any[] }
  streamingLink?: string | null
  tmdbId?: number | null
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
  languages?: string[]
  countries?: string[]
  runtimeMin?: number
  runtimeMax?: number
  voteCount?: number
  sortBy?: string
  imdbRating?: number
  rtRating?: number
  streamingServices?: string[]
}

function extractTmdbIdFromGuid(guid?: string | null): number | null {
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

const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const DEFAULT_FILTERS_KEY = stableFiltersKey(undefined)
const DEFAULT_DISCOVER_PREFETCH_PAGES = Number(
  Deno.env.get('DISCOVER_CACHE_DEFAULT_PAGES') ?? '10'
)
const FILTERED_DISCOVER_PREFETCH_PAGES = Number(
  Deno.env.get('DISCOVER_CACHE_FILTERED_PAGES') ?? '2'
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
    languages: filters?.languages,
    countries: filters?.countries,
    runtimeMin: filters?.runtimeMin,
    runtimeMax: filters?.runtimeMax,
    voteCount: filters?.voteCount,
    sortBy: filters?.sortBy,
    rtRating: filters?.rtRating,
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
  payload: { name: string; roomCode: string; accessPassword: string }
}

interface WebSocketMatchMessage {
  type: 'match'
  payload: { movie: MediaItem; users: string[]; createdAt: number }
}

interface WebSocketLoginResponseMessage {
  type: 'loginResponse'
  payload:
    | { success: false }
    | {
        success: true
        matches: Array<WebSocketMatchMessage['payload']>
        movies: MediaItem[]
        rated: RatedPayloadItem[]
      }
}

interface WebSocketResponseMessage {
  type: 'response'
  payload: Response
}

interface WebSocketNextBatchMessage {
  type: 'nextBatch'
  payload?: {
    yearMin?: number
    yearMax?: number
    genres?: string[]
    streamingServices?: string[]
    showPlexOnly?: boolean
    contentRatings?: string[]
    imdbRating?: number
    tmdbRating?: number
    languages?: string[]
    countries?: string[]
    directors?: Array<{ id: number; name: string }>
    actors?: Array<{ id: number; name: string }>
    runtimeMin?: number
    runtimeMax?: number
    voteCount?: number
    sortBy?: string
    imdbRating?: number
    rtRating?: number
  }
}

// Items to send back to the client on login so it can hydrate Watch/Pass
interface RatedPayloadItem {
  guid: string
  wantsToWatch: boolean | null // true = like, false = dislike, null = seen
  movie: MediaItem
}

type WebSocketMessage =
  | WebSocketLoginMessage
  | WebSocketResponseMessage
  | WebSocketNextBatchMessage

// -------------------------
// Persistence (rooms + movie index) - ENHANCED VERSION
// -------------------------
type PersistedRooms = Record<
  string,
  {
    users: { name: string; responses: Response[] }[]
  }
>

interface PersistedState {
  rooms: PersistedRooms
  movieIndex: Record<string, MediaItem> // guid -> MediaItem (for rebuilding matches)
}

const DATA_DIR = Deno.env.get('DATA_DIR') || '/data'
const STATE_FILE = `${DATA_DIR}/session-state.json`
const BACKUP_FILE = `${DATA_DIR}/session-state.backup.json`

async function ensureDataDir() {
  try {
    await Deno.mkdir(DATA_DIR, { recursive: true })

    // Test write permissions
    const testFile = `${DATA_DIR}/.write-test`
    await Deno.writeTextFile(testFile, 'test')
    await Deno.remove(testFile)

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
    const parsed: any = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('bad state')

    // Accept both shapes:
    // - new: rooms[code].users = Array<{name,responses}>
    // - old: rooms[code].users = Record<name, {responses}>
    const roomsIn: any = parsed.rooms || {}
    const roomsOut: PersistedRooms = {}

    for (const roomCode in roomsIn) {
      const roomVal: any = roomsIn[roomCode] || {}
      const usersRaw: any = roomVal.users

      let usersArr: { name: string; responses: Response[] }[] = []
      if (Array.isArray(usersRaw)) {
        usersArr = usersRaw as { name: string; responses: Response[] }[]
      } else if (usersRaw && typeof usersRaw === 'object') {
        usersArr = []
        for (const name in usersRaw) {
          const val: any = usersRaw[name]
          const responses: Response[] = Array.isArray(val?.responses)
            ? val.responses
                .filter(r => typeof r?.guid === 'string' && r.guid.length > 0)
                .map(r => ({
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
          usersArr.push({ name, responses })
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
  if (idx >= 0) room.users[idx] = { name: user.name, responses: user.responses }
  else room.users.push({ name: user.name, responses: user.responses })
}

function removeRoomUser(roomCode: string, userName: string) {
  const room = persistedState.rooms[roomCode]
  if (!room) return
  room.users = room.users.filter(u => u.name !== userName)
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

  // Matches keyed by movie (object identity). We'll keep guid->movie lookup to unify objects.
  likedMovies: Map<MediaItem, User[]> = new Map()
  matches: { movie: MediaItem; users: string[]; createdAt: number }[] = []

  private discoverQueues: Map<string, DiscoverQueue> = new Map()
  private tmdbFormatCache: Map<number, any> = new Map()
  private tmdbFormatInFlight: Map<number, Promise<any>> = new Map()
  private enrichmentCache: Map<string, Promise<any | undefined>> = new Map()

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
      // Rebuild likedMovies for this room from persisted responses
      this.rebuildLikedFromPersisted()
    }
  }
  removeMatch(guid: string, userName: string, action: 'seen' | 'pass'): number {
    // Find the acting user and update their response
    const actingUser = [...this.users.keys()].find(u => u.name === userName)
    if (actingUser) {
      const wantsToWatch = action === 'seen' ? null : false
      const existingIdx = actingUser.responses.findIndex(r => r.guid === guid)
      if (existingIdx >= 0) {
        actingUser.responses[existingIdx].wantsToWatch = wantsToWatch
      } else {
        actingUser.responses.push({ guid, wantsToWatch, tmdbId: null })
      }

      // Remove the acting user from likedMovies for this movie
      for (const [movie, users] of this.likedMovies.entries()) {
        if (movie.guid === guid) {
          const nextUsers = users.filter(u => u !== actingUser)
          if (nextUsers.length > 0) {
            this.likedMovies.set(movie, nextUsers)
          } else {
            this.likedMovies.delete(movie)
          }
          break
        }
      }

      // Persist the response change
      upsertRoomUser(this.roomCode, actingUser)
      saveState(persistedState).catch(err =>
        log.warning(`Failed to save state on match removal: ${err}`)
      )
    }

    let removedCount = 0

    // Check if the match still has 2+ users in likedMovies
    let stillMatched = false
    for (const [movie, users] of this.likedMovies.entries()) {
      if (movie.guid === guid && users.length > 1) {
        stillMatched = true
        // Update the match record with remaining users
        const existingMatch = this.matches.find(m => m.movie.guid === guid)
        if (existingMatch) {
          existingMatch.users = users.map(u => u.name)
        }
        break
      }
    }

    if (!stillMatched) {
      // Remove the match record entirely
      const matchIdx = this.matches.findIndex(m => m.movie.guid === guid)
      if (matchIdx > -1) {
        this.matches.splice(matchIdx, 1)
        removedCount++
      }
    }

    // Notify all connected users about the change
    for (const [user, ws] of this.users.entries()) {
      if (ws && !ws.isClosed) {
        ws.send(
          JSON.stringify({
            type: 'matchRemoved',
            payload: { guid },
          })
        )
      }
    }

    return removedCount
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

    const { results, exhausted } = await ensureCachedDiscoverPage(filters, page)

    if (!results.length) {
      queue.exhausted = true
      return
    }

    const shuffled = results.slice().sort(() => Math.random() - 0.5)
    queue.buffer.push(...shuffled)

    if (exhausted) {
      queue.exhausted = true
    }
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

  private rebuildLikedFromPersisted() {
    this.likedMovies.clear()

    // Build a guid -> usersWhoLiked[] list first
    const likedByGuid = new Map<string, User[]>()

    for (const [user] of this.users.entries()) {
      for (const r of user.responses) {
        if (r.wantsToWatch) {
          const arr = likedByGuid.get(r.guid) ?? []
          arr.push(user)
          likedByGuid.set(r.guid, arr)
        }
      }
    }

    // Now turn those into likedMovies keyed by MediaItem
    for (const [guid, users] of likedByGuid.entries()) {
      const movie = this.movieForGuid(guid)
      if (movie) {
        this.likedMovies.set(movie, users)
      }
    }
  }

  add = (user: User, ws: WebSocket) => {
    this.users.set(user, ws)

    ws.addListener('message', msg => this.handleMessage(user, msg))
    ws.addListener('close', () => this.remove(user, ws))

    // persist presence (even if ws is null now)
    upsertRoomUser(this.roomCode, user)
    saveState(persistedState).catch(err =>
      log.warning(`Failed to save state on add(): ${err}`)
    )
  }

  remove = (user: User, ws: WebSocket) => {
    log.debug(`User ${user?.name} was removed`)
    ws.removeAllListeners()
    this.users.set(user, null)

    const activeUsers = [...this.users.values()].filter(ws => !ws?.isClosed)
    if (activeUsers.length === 0) {
      this.destroy()
    }
  }

  handleMessage = async (user: User, msg: string) => {
    try {
      const decodedMessage: WebSocketMessage = JSON.parse(msg)
      log.debug(
        `Received WebSocket message from ${user.name}: type=${decodedMessage.type}`
      )
      switch (decodedMessage.type) {
        case 'nextBatch': {
          const filters = decodedMessage.payload || {}
          log.debug(
            `${user.name} asked for the next batch of movies with filters:`,
            filters
          )
          await this.sendNextBatch(filters)
          break
        }
        case 'response': {
          const { guid, wantsToWatch } = decodedMessage.payload
          assert(
            typeof guid === 'string' &&
              (typeof wantsToWatch === 'boolean' || wantsToWatch === null),
            'Response message was empty'
          )

          const movie = this.movieForGuid(guid)
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
            break
          }

          // Look up the canonical movie object for this guid
          const movieObj =
            this.movieList.find(m => m.guid === movie.guid) ||
            persistedState.movieIndex[movie.guid] ||
            movie

          // Look up likedMovies by guid (not object identity) to avoid
          // stale Map keys after movieIndex objects are replaced
          let existingUsers: User[] = []
          let existingMovieKey: MediaItem | undefined
          for (const [m, users] of this.likedMovies.entries()) {
            if (m.guid === movieObj.guid) {
              existingUsers = users
              existingMovieKey = m
              break
            }
          }

          if (wantsToWatch) {
            // User likes this movie - add them if not already in the list
            if (!existingUsers.includes(user)) {
              const nextUsers = [...existingUsers, user]
              // Remove stale key if the object reference changed
              if (existingMovieKey && existingMovieKey !== movieObj) {
                this.likedMovies.delete(existingMovieKey)
              }
              this.likedMovies.set(movieObj, nextUsers)

              // If multiple users like it, broadcast a match
              if (nextUsers.length > 1) {
                this.handleMatch(movieObj, nextUsers)
              }
            }
          } else {
            // User doesn't like this movie (pass or seen) - remove them
            if (existingUsers.includes(user)) {
              const nextUsers = existingUsers.filter(u => u !== user)
              // Always remove old key first
              if (existingMovieKey) {
                this.likedMovies.delete(existingMovieKey)
              }
              if (nextUsers.length > 0) {
                this.likedMovies.set(movieObj, nextUsers)
              }
            }
          }

          // Persist: user responses + (optionally) liked state can be derived, so we just save users + movieIndex
          upsertRoomUser(this.roomCode, user)
          await saveState(persistedState).catch(err =>
            log.warning(`Failed to save state on response: ${err}`)
          )
          break
        }
      }
    } catch (err) {
      log.error(err, JSON.stringify(msg))
    }
  }

  async sendNextBatch(filters?: {
    yearMin?: number
    yearMax?: number
    genres?: string[]
    streamingServices?: string[]
    showPlexOnly?: boolean
    contentRatings?: string[]
    imdbRating?: number
    tmdbRating?: number
    languages?: string[]
    countries?: string[]
    directors?: Array<{ id: number; name: string }>
    actors?: Array<{ id: number; name: string }>
    runtimeMin?: number
    runtimeMax?: number
    voteCount?: number
    sortBy?: string
    imdbRating?: number
    rtRating?: number
  }) {
    const profileMode = getStreamingProfileMode()
    const configuredPaidServices = getPaidStreamingServices()
    const configuredPersonalSources = getPersonalMediaSources()
    const requestedServices = (filters?.streamingServices || [])
      .map(service => service.trim())
      .filter(Boolean)

    let effectiveShowMyPlexOnly = filters?.showPlexOnly ?? false
    let effectiveStreamingServices = [...requestedServices]

    if (profileMode === 'my_libraries') {
      effectiveShowMyPlexOnly = true
    } else if (
      (profileMode === 'my_subscriptions' ||
        profileMode === 'my_availability') &&
      effectiveStreamingServices.length === 0
    ) {
      effectiveStreamingServices = [...configuredPaidServices]
    }

    const shouldBlendPlexInAvailability =
      profileMode === 'my_availability' &&
      configuredPersonalSources.includes('plex') &&
      !effectiveShowMyPlexOnly

    const tmdbConfigured = Boolean(getTmdbApiKey())

    if (!tmdbConfigured && !effectiveShowMyPlexOnly) {
      log.warning(
        'TMDb API key is missing; falling back to Plex library movies for swipe results.'
      )
    }

    try {
      // Increase batch size to account for movies we'll skip
      const attemptBatchSize = Math.min(
        effectiveShowMyPlexOnly ? (await getAllMovies()).length : 40, // Try more movies to get enough valid ones
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
            const response = await fetch(
              `https://api.themoviedb.org/3/person/${
                person.id
              }/movie_credits?api_key=${getTmdbApiKey()}`
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

        if (effectiveShowMyPlexOnly || !tmdbConfigured) {
          return await fetchPlexCandidate()
        }

        if (shouldBlendPlexInAvailability && attemptNumber % 2 === 1) {
          try {
            return await fetchPlexCandidate()
          } catch (err) {
            if (err instanceof NoMoreMoviesError) {
              log.debug(
                'No more Plex candidates for my_availability blend; falling back to TMDb discovery.'
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

        return await this.getTMDbMovie(attemptNumber - 1, {
          yearMin: filters?.yearMin,
          yearMax: filters?.yearMax,
          genres: filters?.genres,
          tmdbRating: filters?.tmdbRating,
          languages: filters?.languages,
          countries: filters?.countries,
          runtimeMin: filters?.runtimeMin,
          runtimeMax: filters?.runtimeMax,
          voteCount: filters?.voteCount,
          sortBy: filters?.sortBy,
          streamingServices: effectiveStreamingServices,
        })
      }

      const queueNextCandidate = () => {
        if (attempts >= maxAttempts) {
          pendingCandidate = null
          return
        }

        const attemptNumber = attempts + 1
        pendingCandidate = {
          promise: fetchCandidate(attemptNumber),
          attemptNumber,
        }
        attempts = attemptNumber
      }

      queueNextCandidate()

      while (
        validMovies.length < Number(getMovieBatchSize()) &&
        pendingCandidate
      ) {
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
            log.warning('Person movie fetch failed, falling back to discovery')
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

          let extra:
            | {
                plot: string | null
                imdbId: string | null
                rating_imdb: number | null
                rating_rt: number | null
                rating_tmdb: number | null
                tmdbPosterPath?: string | null
                genres?: string[]
                streamingServices?: { subscription: any[]; free: any[] }
                streamingLink?: string | null
                cast?: string[]
                writers?: string[]
                director?: string | null
                runtime?: number | null
                contentRating?: string | null
                voteCount?: number | null
                tmdbId?: number | null
              }
            | undefined

          try {
            extra = await this.getEnrichmentData(plexMovie)
          } catch (e) {
            log.warning(`Enrichment failed for ${plexMovie.title}: ${e}`)
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
              `<img src="${basePath}/assets/logos/comparr.svg" alt="Comparr" class="rating-logo"> ${extra.rating_comparr}`
            )
          }
          if (extra?.rating_imdb != null) {
            parts.push(
              `<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> ${extra.rating_imdb}`
            )
          }
          if (extra?.rating_rt != null) {
            parts.push(
              `<img src="${basePath}/assets/logos/rottentomatoes.svg" alt="RT" class="rating-logo"> ${extra.rating_rt}%`
            )
          }
          if (extra?.rating_tmdb != null) {
            parts.push(
              `<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${extra.rating_tmdb}`
            )
          }
          const ratingStr =
            parts.length > 0
              ? parts.join(' <span class="rating-separator">&bull;</span> ')
              : plexMovie.rating ?? ''

          const summaryStr =
            (extra?.plot && String(extra.plot)) ||
            (plexMovie.summary && String(plexMovie.summary)) ||
            ''

          if (filters?.imdbRating && filters.imdbRating > 0) {
            if (!extra?.rating_imdb || extra.rating_imdb < filters.imdbRating) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - IMDb rating ${
                  extra?.rating_imdb || 'N/A'
                } below minimum ${filters.imdbRating}`
              )
              continue
            }
          }

          if (filters?.rtRating && filters.rtRating > 0) {
            if (!extra?.rating_rt || extra.rating_rt < filters.rtRating) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - RT rating ${
                  extra?.rating_rt || 'N/A'
                } below minimum ${filters.rtRating}`
              )
              continue
            }
          }

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

          if (filters?.tmdbRating && filters.tmdbRating > 0) {
            if (!extra?.rating_tmdb || extra.rating_tmdb < filters.tmdbRating) {
              log.debug(
                `⛔️ Skipping ${plexMovie.title} - TMDb rating ${
                  extra?.rating_tmdb || 'N/A'
                } below minimum ${filters.tmdbRating}`
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
            const voteCount = extra?.voteCount || 0
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
            const movieCountries = plexMovie.production_countries || []
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
            writers: extra?.writers || [],
            genres: extra?.genres || [],
            contentRating: extra?.contentRating || undefined,
            runtime: extra?.runtime || plexMovie.runtime || undefined,
            rating: String(ratingStr),
            type: plexMovie.type,
            streamingServices: streamingServices,
            streamingLink: extra?.streamingLink || undefined,
            tmdbId: extra?.tmdbId || null,
            genre_ids: plexMovie.genre_ids || [],
            vote_count: extra?.voteCount || plexMovie.vote_count || 0,
            original_language: plexMovie.original_language || null,
            production_countries: plexMovie.production_countries || [],
          }

          validMovies.push(movie)
          seenGuids.add(movie.guid)
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
          log.error(`Error details:`, err.message)

          if (hasPersonFilters && personMovies.length > 0) {
            log.warning(
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
        log.warning(`Failed to save state after batch: ${err}`)
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
          if (roomUserCount > 1 && filteredBatch.length > 1) {
            const likedByOtherGuids = new Set<string>()
            const likedByOtherTmdbIds = new Set<number>()
            const seenByOtherGuids = new Set<string>()
            const seenByOtherTmdbIds = new Set<number>()

            for (const otherUser of roomUsers) {
              if (otherUser === user) continue
              for (const response of otherUser.responses) {
                const tmdbId =
                  response.tmdbId ??
                  this.tmdbIdForGuid(response.guid) ??
                  extractTmdbIdFromGuid(response.guid)
                if (response.wantsToWatch === true) {
                  likedByOtherGuids.add(response.guid)
                  if (tmdbId != null) {
                    likedByOtherTmdbIds.add(tmdbId)
                  }
                  continue
                }
                if (response.wantsToWatch !== null) continue
                seenByOtherGuids.add(response.guid)
                if (tmdbId != null) {
                  seenByOtherTmdbIds.add(tmdbId)
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
                  `🎯 Prioritized ${matchesLikedByOthers.length} movies liked by other users and ${matchesSeenByOthers.length} seen by other users for ${user.name} (filters preserved)`
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
              return undefined
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

          // Send the sanitized batch to the client
          ws.send(
            JSON.stringify({
              type: 'batch',
              payload: normalizedBatch,
            })
          )
        }
      }

      if (tmdbMappingsPersisted) {
        await saveState(persistedState).catch(err =>
          log.warning(`Failed to save state after backfilling TMDb IDs: ${err}`)
        )
      }
    } catch (err) {
      log.error('Error in sendNextBatch:', err)
      // Send empty batch on error
      for (const ws of this.users.values()) {
        if (ws && !ws.isClosed) {
          ws.send(JSON.stringify({ type: 'batch', payload: [] }))
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
      languages?: string[]
      countries?: string[]
      directors?: Array<{ id: number; name: string }>
      actors?: Array<{ id: number; name: string }>
      runtimeMin?: number
      runtimeMax?: number
      voteCount?: number
      sortBy?: string
      imdbRating?: number
      rtRating?: number
      streamingServices?: string[]
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
      languages: filters?.languages,
      countries: filters?.countries,
      runtimeMin: filters?.runtimeMin,
      runtimeMax: filters?.runtimeMax,
      voteCount: filters?.voteCount,
      sortBy: filters?.sortBy,
      rtRating: filters?.rtRating,
      streamingServices: filters?.streamingServices,
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
    const response = await fetch(
      `https://api.themoviedb.org/3/person/${
        person.id
      }/movie_credits?api_key=${getTmdbApiKey()}`
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
      // Get IMDb ID from TMDb for more reliable enrichment
      let imdbId = null
      try {
        const detailsResponse = await fetch(
          `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${getTmdbApiKey()}&append_to_response=external_ids`
        )
        if (detailsResponse.ok) {
          const details = await detailsResponse.json()
          imdbId = details.external_ids?.imdb_id
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
        production_countries: tmdbMovie.production_countries || [],
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
      }).catch(err => {
        this.enrichmentCache.delete(cacheKey)
        throw err
      })
      this.enrichmentCache.set(cacheKey, task)
    }
    return task
  }

  handleMatch(movie: MediaItem, users: User[]) {
    // Ensure movie has Comparr score calculated (backfill for existing movies)
    ensureComparrScore(movie)

    const { matchUsers, createdAt } = this.upsertMatchRecord(movie, users)

    for (const ws of this.users.values()) {
      const match: WebSocketMatchMessage = {
        type: 'match',
        payload: {
          movie,
          users: matchUsers,
          createdAt,
        },
      }
      if (ws && !ws.isClosed) {
        ws.send(JSON.stringify(match))
      }
    }
  }

  private upsertMatchRecord(movie: MediaItem, users: User[]) {
    const existingMatch = this.matches.find(
      match => match.movie.guid === movie.guid
    )
    const createdAt = existingMatch?.createdAt ?? Date.now()
    const matchUsers = users.map(_ => _.name)

    if (existingMatch) {
      existingMatch.users = matchUsers
    } else {
      this.matches.push({ movie, users: matchUsers, createdAt })
    }

    return { matchUsers, createdAt }
  }

  getExistingMatches(user: User) {
    // Derives matches from likedMovies; returns any movie liked by user + at least one other
    const matches = [...this.likedMovies.entries()]
      .filter(([, users]) => users.includes(user) && users.length > 1)
      .map(([movie, users]) => {
        // Ensure movie has Comparr score calculated (backfill for existing movies)
        ensureComparrScore(movie)
        // Ensure a match record exists (backfills for restored sessions)
        const { matchUsers, createdAt } = this.upsertMatchRecord(movie, users)
        return {
          movie,
          users: matchUsers,
          createdAt,
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)

    return matches
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
const activeSessions: Map<string, Session> = new Map()

export function getMatchesForUser(roomCode: string, userName: string) {
  const session = activeSessions.get(roomCode)
  if (!session) return null

  const user = [...session.users.keys()].find(u => u.name === userName)
  if (!user) return []

  return session.getExistingMatches(user)
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

    const inPlex = isMovieInPlex({
      tmdbId: tmdbId ?? undefined,
      imdbId: imdbId ?? undefined,
      title: (movie as MediaItem).title,
      year: year ?? undefined,
    })

    if (inPlex) {
      const alreadyTagged = normalized.subscription.some(
        service => service?.name === getPlexLibraryName()
      )
      if (!alreadyTagged) {
        normalized.subscription.unshift({
          id: 0,
          name: getPlexLibraryName(),
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
      log.warning(`Failed to persist Plex availability backfill: ${err}`)
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
  if (activeSessions.has(roomCode)) return activeSessions.get(roomCode)!
  const session = new Session(roomCode)
  activeSessions.set(roomCode, session)
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
export const handleLogin = (ws: WebSocket): Promise<User> => {
  return new Promise(resolve => {
    const handler = async (msg: string) => {
      try {
        const data: WebSocketMessage = JSON.parse(msg)

        if (data.type === 'login') {
          log.info(`Got a login attempt from ${data.payload.name}`)

          // Check access password
          const accessPassword = getAccessPassword()
          if (
            !accessPassword ||
            data.payload.accessPassword !== accessPassword
          ) {
            log.warning(`Invalid access password from ${data.payload.name}`)
            const response: WebSocketLoginResponseMessage = {
              type: 'loginResponse',
              payload: { success: false },
            }
            ws.send(JSON.stringify(response))
            return
          }

          log.info(`Valid login from ${data.payload.name}`)
          const session = getSession(data.payload.roomCode, ws)

          const existingUser = [...session.users.keys()].find(
            ({ name }) => name === data.payload.name
          )

          if (
            existingUser &&
            session.users.get(existingUser) &&
            !session.users.get(existingUser)?.isClosed
          ) {
            log.info(
              `${existingUser.name} is already logged in. Try another name!`
            )
            const response: WebSocketLoginResponseMessage = {
              type: 'loginResponse',
              payload: { success: false },
            }
            ws.send(JSON.stringify(response))
            return
          }

          try {
            await ensurePlexHydrationReady()
          } catch (err) {
            log.error(
              `Delaying login for ${data.payload.name}: Plex cache not ready (${
                err?.message || err
              })`
            )
            const response: WebSocketLoginResponseMessage = {
              type: 'loginResponse',
              payload: { success: false },
            }
            ws.send(JSON.stringify(response))
            return
          }

          const user: User = existingUser ?? {
            name: data.payload.name,
            responses: [],
          }

          log.debug(
            `${existingUser ? 'Existing user' : 'New user'} ${
              user.name
            } logged in`
          )

          ws.removeListener('message', handler)
          session.add(user, ws)

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

            // Ensure movie has Comparr score calculated (backfill for existing movies)
            ensureComparrScore(movie)

            ratedItems.push({
              guid: effectiveGuid,
              wantsToWatch: responseItem.wantsToWatch,
              movie,
            })
          }

          // Persist (make sure this user is in the room set)
          upsertRoomUser(session.roomCode, user)
          saveState(persistedState).catch(err =>
            log.warning(`Failed to save state on login: ${err}`)
          )
          if (responsesMutated) {
            log.debug(
              `Normalized stored responses for ${user.name} during login`
            )
          }

          // Re-send any unseen movies (from this session) and existing matches
          const response: WebSocketLoginResponseMessage = {
            type: 'loginResponse',
            payload: {
              success: true,
              matches: session.getExistingMatches(user),
              movies: session.movieList.filter(movie => {
                if (ratedGuidSet.has(movie.guid)) {
                  return false
                }

                const movieTmdbId =
                  movie.tmdbId ?? extractTmdbIdFromGuid(movie.guid)
                if (movieTmdbId && ratedTmdbIdSet.has(movieTmdbId)) {
                  return false
                }

                return true
              }),
              rated: ratedItems,
            },
          }
          log.debug(
            `Login response sending ${response.payload.movies.length} movies to ${user.name} (${ratedItems.length} rated)`
          )

          ws.send(JSON.stringify(response))

          return resolve(user)
        }
      } catch (err) {
        log.error(`Failed to process login message: ${err?.message || err}`)
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
  streamingLink?: string | null
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
      streamingLink: movie.streamingLink ?? null,
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
    log.warning(`Failed to save state after IMDb import: ${err}`)
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
    log.warning(`Failed to send WS message to ${userName}: ${err}`)
    return false
  }
}

/**
 * Process IMDb import in background with rate limiting and full enrichment.
 * Sends each movie to the user via WebSocket as it's processed.
 */
export async function processImdbImportBackground(
  job: ImdbImportJob
): Promise<void> {
  const { roomCode, userName, imdbRows } = job
  const total = imdbRows.length

  log.info(
    `[IMDb Import] Starting background import of ${total} movies for ${userName} in ${roomCode}`
  )

  // Send start message
  sendToUser(roomCode, userName, {
    type: 'imdbImportProgress',
    payload: {
      status: 'started',
      total,
      processed: 0,
      imported: 0,
      skipped: 0,
    },
  })

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

  const TMDB_KEY = getTmdbApiKey()

  for (const row of imdbRows) {
    processed++

    // Rate limit: wait for token before making API calls
    await tmdbRateLimiter.acquire()

    try {
      // 1. Look up movie by IMDb ID via TMDb find endpoint
      const findResp = await fetch(
        `https://api.themoviedb.org/3/find/${row.imdbId}?api_key=${TMDB_KEY}&external_source=imdb_id`
      )

      if (!findResp.ok) {
        log.debug(
          `[IMDb Import] TMDb find failed for ${row.imdbId}: HTTP ${findResp.status}`
        )
        skipped++
        continue
      }

      const findData = await findResp.json()
      const tmdbMovie = findData.movie_results?.[0]

      if (!tmdbMovie) {
        log.debug(
          `[IMDb Import] No TMDb result for ${row.imdbId} (${row.title})`
        )
        skipped++
        continue
      }

      const tmdbId = tmdbMovie.id
      const guid = `tmdb://${tmdbId}`

      // Check for duplicates
      if (existingGuids.has(guid) || existingTmdbIds.has(tmdbId)) {
        skipped++
        // Send progress update periodically
        if (processed % 10 === 0) {
          sendToUser(roomCode, userName, {
            type: 'imdbImportProgress',
            payload: {
              status: 'processing',
              total,
              processed,
              imported,
              skipped,
            },
          })
        }
        continue
      }

      // 2. Full enrichment using existing pipeline (this respects rate limits internally via caching)
      await omdbRateLimiter.acquire()
      const enriched = await enrich({
        title: tmdbMovie.title,
        year: tmdbMovie.release_date
          ? new Date(tmdbMovie.release_date).getFullYear()
          : null,
        imdbId: row.imdbId,
      })

      // 3. Build the full movie object
      const posterPath = enriched?.tmdbPosterPath || tmdbMovie.poster_path
      const artUrl = posterPath ? getBestPosterUrl(posterPath, 'tmdb') : ''

      if (posterPath) {
        prefetchPoster(posterPath, 'tmdb')
      }

      // Build rating string like the discovery flow does
      let ratingStr = ''
      const ratingParts: string[] = []
      if (enriched?.rating_imdb)
        ratingParts.push(`IMDb: ${enriched.rating_imdb}`)
      if (enriched?.rating_rt) ratingParts.push(`RT: ${enriched.rating_rt}%`)
      if (enriched?.rating_tmdb)
        ratingParts.push(`TMDb: ${enriched.rating_tmdb}`)
      if (ratingParts.length > 0) ratingStr = ratingParts.join(' | ')

      const movie: ImportedMovie = {
        guid,
        title: tmdbMovie.title,
        year: tmdbMovie.release_date
          ? String(new Date(tmdbMovie.release_date).getFullYear())
          : '',
        summary: enriched?.plot || tmdbMovie.overview || '',
        art: artUrl,
        rating: ratingStr,
        key: `/tmdb/${tmdbId}`,
        type: 'movie',
        tmdbId,
        imdbId: row.imdbId,
        genres: enriched?.genres || [],
        runtime: enriched?.runtime ?? null,
        contentRating: enriched?.contentRating ?? null,
        streamingServices: enriched?.streamingServices ?? {
          subscription: [],
          free: [],
        },
        streamingLink: enriched?.streamingLink ?? null,
      }

      // Also include fields needed by frontend filtering
      const movieWithExtras = {
        ...movie,
        genre_ids: tmdbMovie.genre_ids || [],
        vote_count: enriched?.voteCount || tmdbMovie.vote_count || 0,
        original_language: tmdbMovie.original_language || null,
        director: enriched?.director || null,
        cast: enriched?.cast || [],
        writers: enriched?.writers || [],
        rating_imdb: enriched?.rating_imdb || null,
        rating_rt: enriched?.rating_rt || null,
        rating_tmdb: enriched?.rating_tmdb || null,
        rating_comparr: enriched?.rating_comparr || null,
      }

      // 4. Add response to user
      userEntry.responses.push({
        guid,
        wantsToWatch: null, // seen
        tmdbId,
      })
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
        key: movie.key,
        type: 'movie',
        tmdbId,
        genres: movie.genres,
        runtime: movie.runtime ?? undefined,
        contentRating: movie.contentRating ?? undefined,
        streamingServices: movie.streamingServices,
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
          progress: { total, processed, imported, skipped },
        },
      })

      // Save state periodically (every 25 movies)
      if (imported % 25 === 0) {
        await saveState(persistedState).catch(err =>
          log.warning(`Failed to save state during import: ${err}`)
        )
      }
    } catch (err) {
      log.warning(
        `[IMDb Import] Failed to process ${row.imdbId}: ${err?.message || err}`
      )
      skipped++
    }

    // Send progress update every 10 movies
    if (processed % 10 === 0) {
      sendToUser(roomCode, userName, {
        type: 'imdbImportProgress',
        payload: { status: 'processing', total, processed, imported, skipped },
      })
    }
  }

  // Final save
  await saveState(persistedState).catch(err =>
    log.warning(`Failed to save state after import: ${err}`)
  )

  // Send completion message
  sendToUser(roomCode, userName, {
    type: 'imdbImportProgress',
    payload: { status: 'completed', total, processed, imported, skipped },
  })

  log.info(
    `[IMDb Import] Completed: ${imported} imported, ${skipped} skipped for ${userName} in ${roomCode}`
  )
}
