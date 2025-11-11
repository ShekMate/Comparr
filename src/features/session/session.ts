// deno-lint-ignore-file
import * as log from 'https://deno.land/std@0.79.0/log/mod.ts'
import { assert } from 'https://deno.land/std@0.79.0/_util/assert.ts'
import { allMovies, getRandomMovie, getFilteredRandomMovie, NoMoreMoviesError } from '../../api/plex.ts'
import { WebSocket } from '../../infra/ws/websocketServer.ts'
import { enrich } from '../catalog/enrich.ts'
import { discoverMovies } from '../catalog/discover.ts'
import { isMovieInRadarr } from '../../api/radarr.ts'
import { MOVIE_BATCH_SIZE, ACCESS_PASSWORD } from '../../core/config.ts'
import { validateTMDbPoster, getBestPosterPath, isMovieValid } from '../media/poster-validation.ts'
import { getBestPosterUrl } from '../../services/cache/poster-cache.ts';

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
  37: 'Western'
};

// Helper function to convert genre IDs to names
function genreIdsToNames(genreIds: (number | string)[]): string[] {
  return genreIds.map(id => {
    if (typeof id === 'string') return id;
    return GENRE_MAP[id] || String(id);
  });
}

// -------------------------
// Types
// -------------------------
interface Response {
  guid: string
  wantsToWatch: boolean | null  // true = like, false = dislike, null = seen
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
  streamingServices?: { subscription: any[], free: any[] }
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
  rtRating?: number
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

interface WebSocketLoginMessage {
  type: 'login'
  payload: { name: string; roomCode: string; accessPassword: string }
}

interface WebSocketMatchMessage {
  type: 'match'
  payload: { movie: MediaItem; users: string[] }
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
    directors?: Array<{id: number, name: string}>
    actors?: Array<{id: number, name: string}>
    runtimeMin?: number
    runtimeMax?: number
    voteCount?: number
    sortBy?: string
    rtRating?: number
  }
}

// Items to send back to the client on login so it can hydrate Watch/Pass
interface RatedPayloadItem {
  guid: string
  wantsToWatch: boolean | null  // true = like, false = dislike, null = seen
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
const PLEX_LIBRARY_NAME = Deno.env.get('PLEX_LIBRARY_NAME') || 'My Plex Library'

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
          const responses: Response[] = Array.isArray(val?.responses) ? val.responses : []
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
    
    log.info(`State saved successfully: ${Object.keys(state.rooms).length} rooms, ${Object.keys(state.movieIndex).length} movies`)
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
    persistedState.movieIndex[m.guid] = m
  }
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
        this.users.set({ name: u.name, responses: [...u.responses] }, null)
      }
      // Rebuild likedMovies for this room from persisted responses
      this.rebuildLikedFromPersisted()
    }
  }
  removeMatch(guid: string): number {
    let removedCount = 0
  
    // Find all matches for this movie guid
    const matchesToRemove = this.matches.filter(match => 
      match.movie.guid === guid
    )
  
    // Remove each match
    for (const match of matchesToRemove) {
      const index = this.matches.indexOf(match)
      if (index > -1) {
        this.matches.splice(index, 1)
        removedCount++
      
        // Notify all users in the match that it was removed
        for (const userName of match.users) {
          const user = [...this.users.keys()].find(u => u.name === userName)
          if (user) {
            const ws = this.users.get(user)
            if (ws && !ws.isClosed) {
              ws.send(JSON.stringify({
                type: 'matchRemoved',
                payload: { guid }
              }))
            }
          }
        }
      }
    }
  
    return removedCount
  }

  private resolveDiscoverQueue(filters?: DiscoverFilters) {
    const key = stableFiltersKey(filters)
    let queue = this.discoverQueues.get(key)
    if (!queue) {
      const startPage = Math.max(1, Math.floor(Math.random() * 5) + 1)
      queue = { currentPage: startPage, buffer: [], exhausted: false }
      this.discoverQueues.set(key, queue)
    }
    return { key, queue }
  }

  private async loadDiscoverPage(queue: DiscoverQueue, filters?: DiscoverFilters) {
    if (queue.exhausted) return

    const page = queue.currentPage
    queue.currentPage += 1

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
      sortBy: filters?.sortBy
    })

    const results = discovered.results ?? []
    if (!results.length) {
      queue.exhausted = true
      return
    }

    const shuffled = results.slice().sort(() => Math.random() - 0.5)
    queue.buffer.push(...shuffled)
  }

  private async ensureDiscoverBuffer(queue: DiscoverQueue, filters?: DiscoverFilters) {
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

  private prefetchDiscoverPage(queue: DiscoverQueue, filters?: DiscoverFilters) {
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
	  log.info(`DEBUG: Received WebSocket message from ${user.name}: type=${decodedMessage.type}, payload=${JSON.stringify(decodedMessage.payload)}`)
      switch (decodedMessage.type) {
        case 'nextBatch': {
          const filters = decodedMessage.payload || {}
          log.debug(`${user.name} asked for the next batch of movies with filters:`, filters)
          await this.sendNextBatch(filters)
          break
        }
        case 'response': {
		  const { guid, wantsToWatch } = decodedMessage.payload
		  assert(
			typeof guid === 'string' && (typeof wantsToWatch === 'boolean' || wantsToWatch === null),
			'Response message was empty'
		  )
		  
		  // Find existing response
		  const existingIndex = user.responses.findIndex(_ => _.guid === guid)
		  
		  if (existingIndex >= 0) {
			// Update existing response instead of rejecting
			const oldValue = user.responses[existingIndex].wantsToWatch
			log.debug(`${user.name} is updating rating for ${guid} from ${oldValue} to ${wantsToWatch}`)
			user.responses[existingIndex].wantsToWatch = wantsToWatch
		  } else {
			// Add new response
			const action = wantsToWatch === true ? 'likes' : wantsToWatch === false ? 'dislikes' : 'marked as seen'
			log.debug(`${user.name} ${action} ${guid}`)
			user.responses.push({ guid, wantsToWatch })
		  }

		  // DEBUG: Log the user's current responses
		  log.info(`DEBUG: User ${user.name} now has ${user.responses.length} responses`)
		  log.info(`DEBUG: Latest response: ${JSON.stringify({ guid, wantsToWatch })}`)
		  
		  // persist immediately so we never lose it
		  upsertRoomUser(this.roomCode, user)
		  await saveState(persistedState).catch(err =>
			log.warning(`Failed to save state on response: ${err}`)
		  )

		  // Update likedMovies map
		  const movie = this.movieList.find(_ => _.guid === guid) || 
			persistedState.movieIndex[guid]

		  if (!movie) {
			log.error(`${user.name} rated a movie we can't resolve by guid: ${guid}`)
			break
		  }

		  // Look up existing entry *by object identity*
		  let movieObj = this.movieList.find(m => m.guid === movie.guid) || 
			persistedState.movieIndex[movie.guid] || 
			movie

		  const existingUsers = this.likedMovies.get(movieObj) ?? []

		  if (wantsToWatch) {
			// User likes this movie - add them if not already in the list
			if (!existingUsers.includes(user)) {
			  const nextUsers = [...existingUsers, user]
			  this.likedMovies.set(movieObj, nextUsers)
			  
			  // If multiple users like it, broadcast a match
			  if (nextUsers.length > 1) {
				this.handleMatch(movieObj, nextUsers)
			  }
			}
		  } else {
			// User doesn't like this movie (pass or seen) - remove them if they were in the list
			if (existingUsers.includes(user)) {
			  const nextUsers = existingUsers.filter(u => u !== user)
			  if (nextUsers.length > 0) {
				this.likedMovies.set(movieObj, nextUsers)
			  } else {
				this.likedMovies.delete(movieObj)
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
    yearMin?: number; 
    yearMax?: number; 
    genres?: string[]; 
    streamingServices?: string[]; 
    showPlexOnly?: boolean;
    contentRatings?: string[]; 
    imdbRating?: number; 
    tmdbRating?: number; 
    languages?: string[]; 
    countries?: string[]; 
    directors?: Array<{id: number, name: string}>; 
    actors?: Array<{id: number, name: string}>; 
    runtimeMin?: number; 
    runtimeMax?: number; 
    voteCount?: number; 
    sortBy?: string; 
    rtRating?: number 
  }) {
	  
  const showMyPlexOnly = filters?.showPlexOnly ?? false;
  
  try {
    // Increase batch size to account for movies we'll skip
    const attemptBatchSize = Math.min(
      showMyPlexOnly ? (await allMovies).length : 40, // Try more movies to get enough valid ones
      Number(MOVIE_BATCH_SIZE) * 2 // Double the normal batch size
    );

    const validMovies: MediaItem[] = [];
    const maxAttempts = attemptBatchSize;
    let attempts = 0;

    // Special handling for person filters - get all movies upfront
    const hasPersonFilters = (filters?.directors?.length || 0) + (filters?.actors?.length || 0) > 0;
    let personMovies: any[] = [];
    
    if (hasPersonFilters && !showMyPlexOnly) {
      const person = filters?.directors?.[0] || filters?.actors?.[0];
      log.info(`Ã°Å¸Å½Â­ Getting all movies for ${person.name}`);
      
      try {
        const response = await fetch(
          `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${Deno.env.get('TMDB_API_KEY')}`
        );
        
        if (response.ok) {
          const data = await response.json();
          const movies = filters?.directors?.[0] ? 
            data.crew?.filter((m: any) => m.job === 'Director') : 
            data.cast;
          
          // Shuffle the movies for variety
          personMovies = movies?.sort(() => Math.random() - 0.5) || [];
          log.info(`Ã°Å¸Å½Â¬ Found ${personMovies.length} movies for ${person.name}`);
        }
      } catch (e) {
        log.error(`Failed to get movies for ${person.name}:`, e);
      }
    }

    while (validMovies.length < Number(MOVIE_BATCH_SIZE) && attempts < maxAttempts) {
      try {
        attempts++;
        log.debug(`Movie attempt ${attempts}/${maxAttempts} - Fetching`);
        
        let plexMovie;
        
        if (showMyPlexOnly) {
          // Use filtered random selection to avoid repeatedly showing the same movies
          plexMovie = await getFilteredRandomMovie({
            yearMin: filters?.yearMin,
            yearMax: filters?.yearMax,
            genres: filters?.genres
          });
        } else if (hasPersonFilters && personMovies.length > 0) {
          // Use person's movies directly
          const movieIndex = (attempts - 1) % personMovies.length;
          const tmdbMovie = personMovies[movieIndex];
          log.info(`Ã°Å¸Å½Â¬ Using ${person.name} movie ${movieIndex + 1}/${personMovies.length}: ${tmdbMovie.title}`);
          plexMovie = await this.formatTMDbMovie(tmdbMovie);
        } else {
          // Regular discovery
          plexMovie = await this.getTMDbMovie(attempts - 1, {
              yearMin: filters?.yearMin,
              yearMax: filters?.yearMax,
              genres: filters?.genres,
              tmdbRating: filters?.tmdbRating,
              languages: filters?.languages,
              countries: filters?.countries,
              runtimeMin: filters?.runtimeMin,
              runtimeMax: filters?.runtimeMax,
              voteCount: filters?.voteCount,
              sortBy: filters?.sortBy
            });
        }
        
        log.debug(`Movie attempt ${attempts} - Got: ${plexMovie.title}`);

        // FIX: Check if ANY user in the session has already rated this movie
        // This prevents wasting time enriching movies that will be filtered anyway
        const isAlreadyRated = Array.from(this.users.keys()).some(
          user => user.responses.some(r => r.guid === plexMovie.guid)
        );
        
        if (isAlreadyRated) {
          log.debug(`â­ï¸  Skipping ${plexMovie.title} - already rated by a user in this session`);
          continue;
        }

        // Enrich (OMDb/TMDb)
        let extra: {
          plot: string | null
          imdbId: string | null
          rating_imdb: number | null
          rating_rt: number | null
          rating_tmdb: number | null
          tmdbPosterPath?: string | null
          genres?: string[]
          streamingServices?: { subscription: any[], free: any[] }
          streamingLink?: string | null
          cast?: string[]
          writers?: string[]
          director?: string | null
          runtime?: number | null
          contentRating?: string | null
          voteCount?: number | null
          tmdbId?: number | null
        } | undefined;

        try {
          extra = await this.getEnrichmentData(plexMovie);
        } catch (e) {
          log.warning(`Enrichment failed for ${plexMovie.title}: ${e}`);
        }

        // Get the best available poster path and validate it
        const posterPath = await getBestPosterPath(plexMovie, extra);
        
        // Skip this movie if it doesn't meet our criteria
        if (!isMovieValid(plexMovie, posterPath)) {
          log.debug(`Ã¢ÂÂ­Ã¯Â¸Â  Skipping ${plexMovie.title} - invalid movie or no poster`);
          continue;
        }

        // Build rating string with logos
        const parts: string[] = [];
        const basePath = Deno.env.get('ROOT_PATH') || '';
        
        if (extra?.rating_imdb != null) {
          parts.push(`<img src="${basePath}/assets/logos/imdb.svg" alt="IMDb" class="rating-logo"> ${extra.rating_imdb}`);
        }
        if (extra?.rating_rt != null) {
          parts.push(`<img src="${basePath}/assets/logos/rottentomatoes.svg" alt="RT" class="rating-logo"> ${extra.rating_rt}%`);
        }
        if (extra?.rating_tmdb != null) {
          parts.push(`<img src="${basePath}/assets/logos/tmdb.svg" alt="TMDb" class="rating-logo"> ${extra.rating_tmdb}`);
        }
        const ratingStr = parts.length > 0 ? parts.join(' <span class="rating-separator">&bull;</span> ') : (plexMovie.rating ?? '');

        const summaryStr = (extra?.plot && String(extra.plot)) || (plexMovie.summary && String(plexMovie.summary)) || '';

        // NEW: Apply RT rating filter if specified
        if (filters?.rtRating && filters.rtRating > 0) {
          if (!extra?.rating_rt || extra.rating_rt < filters.rtRating) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - RT rating ${extra?.rating_rt || 'N/A'} below minimum ${filters.rtRating}`);
            continue;
          }
        }

        // Apply year range filter
        if (filters?.yearMin || filters?.yearMax) {
          const movieYear = typeof plexMovie.year === 'number' ? plexMovie.year : Number(plexMovie.year);
          if (filters.yearMin && movieYear < filters.yearMin) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - year ${movieYear} below minimum ${filters.yearMin}`);
            continue;
          }
          if (filters.yearMax && movieYear > filters.yearMax) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - year ${movieYear} above maximum ${filters.yearMax}`);
            continue;
          }
        }

        // Apply genre filter
        if (filters?.genres && filters.genres.length > 0 && extra?.genres) {
          const filterGenreNames = genreIdsToNames(filters.genres).map(g => g.toLowerCase());
          const movieGenres = extra.genres.map(g => g.toLowerCase());
          const hasMatchingGenre = filterGenreNames.some(filterGenre => 
            movieGenres.includes(filterGenre)
          );
          if (!hasMatchingGenre) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - no matching genres`);
            continue;
          }
        }

        // Apply TMDb rating filter
        if (filters?.tmdbRating && filters.tmdbRating > 0) {
          if (!extra?.rating_tmdb || extra.rating_tmdb < filters.tmdbRating) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - TMDb rating ${extra?.rating_tmdb || 'N/A'} below minimum ${filters.tmdbRating}`);
            continue;
          }
        }

        // Apply runtime filter
        if (filters?.runtimeMin || filters?.runtimeMax) {
          const runtime = extra?.runtime || plexMovie.runtime;
          if (runtime) {
            if (filters.runtimeMin && runtime < filters.runtimeMin) {
              log.debug(`â›”ï¸ Skipping ${plexMovie.title} - runtime ${runtime}min below minimum ${filters.runtimeMin}min`);
              continue;
            }
            if (filters.runtimeMax && runtime > filters.runtimeMax) {
              log.debug(`â›”ï¸ Skipping ${plexMovie.title} - runtime ${runtime}min above maximum ${filters.runtimeMax}min`);
              continue;
            }
          }
        }

        // Apply vote count filter
        if (filters?.voteCount && filters.voteCount > 0) {
          const voteCount = extra?.voteCount || 0;
          if (voteCount < filters.voteCount) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - vote count ${voteCount} below minimum ${filters.voteCount}`);
            continue;
          }
        }

        // Apply content rating filter
        if (filters?.contentRatings && filters.contentRatings.length > 0) {
          const movieRating = extra?.contentRating || plexMovie.contentRating;
          if (movieRating && !filters.contentRatings.includes(movieRating)) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - content rating ${movieRating} not in filter`);
            continue;
          }
        }

        // Apply language filter
        if (filters?.languages && filters.languages.length > 0) {
          const movieLanguage = plexMovie.original_language;
          if (movieLanguage && !filters.languages.includes(movieLanguage)) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - language ${movieLanguage} not in filter`);
            continue;
          }
        }

        // Apply country filter
        if (filters?.countries && filters.countries.length > 0) {
          const movieCountries = plexMovie.production_countries || [];
          const hasMatchingCountry = filters.countries.some(filterCountry => 
            movieCountries.includes(filterCountry)
          );
          if (!hasMatchingCountry && movieCountries.length > 0) {
            log.debug(`â›”ï¸ Skipping ${plexMovie.title} - no matching countries`);
            continue;
          }
        }

        // Check if movie exists in Radarr/Plex library
        let streamingServices = extra?.streamingServices || { subscription: [], free: [] };
        
        // For movies from Plex (plex:// guid), they're already in Plex by definition
        if (plexMovie.guid?.startsWith('plex://')) {
          log.debug(`âœ… Movie ${plexMovie.title} is from Plex library (plex:// guid) - adding AllVids badge`);
          streamingServices = {
            subscription: [
              ...streamingServices.subscription,
              { id: 0, name: PLEX_LIBRARY_NAME, logo_path: '/assets/logos/allvids.svg', type: 'subscription' }
            ],
            free: streamingServices.free
          };
        } 
        // For TMDb movies, check if they're in Radarr
        else if (plexMovie.guid?.startsWith('tmdb://')) {
          const tmdbId = parseInt(plexMovie.guid.replace('tmdb://', ''));
          if (isMovieInRadarr(tmdbId)) {
            log.debug(`âœ… Movie ${plexMovie.title} found in Radarr - adding AllVids badge`);
            // Add Plex library to subscription services
            streamingServices = {
              subscription: [
                ...streamingServices.subscription,
                { id: 0, name: PLEX_LIBRARY_NAME, logo_path: '/assets/logos/allvids.svg', type: 'subscription' }
              ],
              free: streamingServices.free
            };
          }
        }

        const movie: MediaItem = {
          title: plexMovie.title,
          art: getBestPosterUrl(posterPath!, 'tmdb'),
          guid: plexMovie.guid,
          key: plexMovie.key,
          summary: summaryStr,
          year: String(plexMovie.year),
          director: extra?.director || (plexMovie.Director ?? [{ tag: undefined }])[0].tag,
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
          production_countries: plexMovie.production_countries || []
        };

        validMovies.push(movie);
        log.debug(`Ã¢Å“â€¦ Added valid movie: ${movie.title} (${validMovies.length}/${MOVIE_BATCH_SIZE})`);

      } catch (err) {
        if (err instanceof NoMoreMoviesError) {
          log.info('No more movies available');
          break;
        }
        log.error(`Error processing movie attempt ${attempts}:`, err);
        log.error(`Error details:`, err.message);
        
        // If person movies are failing, fall back to discovery for remaining slots
        if (hasPersonFilters && personMovies.length > 0) {
          log.warning(`Person movie failed, falling back to discovery for remaining movies`);
          hasPersonFilters = false; // Switch to discovery mode
        }
        continue;
      }
    }

    log.info(`Ã°Å¸â€œÂ¦ Generated batch: ${validMovies.length} valid movies from ${attempts} attempts`);

    // Keep for current session
    this.movieList.push(...validMovies);

    // Add to global movie index
    addMoviesToIndex(validMovies);
    await saveState(persistedState).catch(err =>
      log.warning(`Failed to save state after batch: ${err}`)
    );

    // Send only unseen movies to each user
    for (const [user, ws] of this.users.entries()) {
      if (ws && !ws.isClosed) {
        // Create Sets for both GUID formats
        const ratedGuidSet = new Set(user.responses.map(_ => _.guid));
        
        // Build Set of rated TMDb IDs from the stored movie data
        const ratedTmdbIds = new Set<number>();
        for (const response of user.responses) {
          const ratedMovie = this.movieForGuid(response.guid);
          if (ratedMovie?.tmdbId) {
            ratedTmdbIds.add(ratedMovie.tmdbId);
          }
        }
        
        const filteredBatch = validMovies.filter(movie => {
          // Check exact GUID match
          if (ratedGuidSet.has(movie.guid)) {
            return false;
          }
          
          // Check if movie's TMDb ID has been rated (handles Plex GUID vs TMDb GUID mismatch)
          if (movie.tmdbId && ratedTmdbIds.has(movie.tmdbId)) {
            log.debug(`Filtering ${movie.title} - TMDb ID ${movie.tmdbId} already rated`);
            return false;
          }
          
          return true;
        });
        
        // Enhanced logging to track filtering effectiveness
        const filteredCount = validMovies.length - filteredBatch.length;
        if (filteredCount > 0) {
          log.info(`🎤 Sending ${filteredBatch.length} movies to user ${user.name} (filtered out ${filteredCount} already rated)`);
        } else {
          log.info(`🎤 Sending ${filteredBatch.length} movies to user ${user.name}`);
        }
        
        // === Normalize poster paths and strip Plex thumb IDs before sending ===

		// Detect raw Plex thumb IDs like "/74101/thumb/1760426051"
		const isPlexThumbCore = (u?: string) => !!u && /^\/\d+\/thumb\/\d+/.test(u);

		// Remove known prefixes so we can inspect the core path
		const stripPrefix = (u?: string) => {
		  if (!u) return u;
		  if (u.startsWith('/tmdb-poster/')) return u.slice('/tmdb-poster'.length);
		  if (u.startsWith('/poster/'))      return u.slice('/poster'.length);
		  return u;
		};

		// Prefer any TMDB-style poster field on the movie as a fallback
		const pickTmdbPoster = (m: any): string | undefined =>
		  m.tmdbPosterPath || m.posterPath || m.poster_path || m.tmdbPoster || undefined;

		// Map each movie’s art/thumb to a safe URL
		const norm = (m: any, u?: string) => {
		  const core = stripPrefix(u);
		  if (!core || isPlexThumbCore(core)) {
			const fallback = pickTmdbPoster(m);
			return fallback ? getBestPosterUrl(fallback, 'tmdb') : undefined;
		  }
		  return getBestPosterUrl(u!, 'tmdb');
		};

		// Build the sanitized batch
		const normalizedBatch = filteredBatch.map((m: any) => ({
		  ...m,
		  art:   norm(m, m.art),
		  thumb: norm(m, m.thumb),
		}));

		// Send the sanitized batch to the client
		ws.send(
		  JSON.stringify({
			type: 'batch',
			payload: normalizedBatch,
		  })
		);
      }
    }

  } catch (err) {
    log.error('Error in sendNextBatch:', err);
    // Send empty batch on error
    for (const ws of this.users.values()) {
      if (ws && !ws.isClosed) {
        ws.send(JSON.stringify({ type: 'batch', payload: [] }));
      }
    }
  }
}

  private async getTMDbMovie(index: number, filters?: {
    yearMin?: number;
    yearMax?: number;
    genres?: string[];
    tmdbRating?: number;
    languages?: string[];
    countries?: string[];
    directors?: Array<{id: number, name: string}>;
    actors?: Array<{id: number, name: string}>;
    runtimeMin?: number;
    runtimeMax?: number;
    voteCount?: number;
    sortBy?: string;
    rtRating?: number;
  }): Promise<any> {

    // If person filters are applied, use a more targeted approach
    const hasPersonFilters = (filters?.directors?.length || 0) + (filters?.actors?.length || 0) > 0;

    if (hasPersonFilters) {
      return this.getPersonMovie(index, filters);
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
      rtRating: filters?.rtRating
    }

    const { queue } = this.resolveDiscoverQueue(discoverFilters)
    await this.ensureDiscoverBuffer(queue, discoverFilters)

    if (!queue.buffer.length) {
      throw new Error("No TMDb movie found");
    }

    const tmdbMovie = queue.buffer.shift();

    if (!tmdbMovie) {
      throw new Error("No TMDb movie found");
    }

    if (queue.buffer.length < 5) {
      this.prefetchDiscoverPage(queue, discoverFilters)
    }

    return this.formatTMDbMovie(tmdbMovie);
  }

  private async getPersonMovie(index: number, filters: any): Promise<any> {
    // Get all movies for the first person (director or actor)
    const person = filters.directors?.[0] || filters.actors?.[0];
    if (!person) throw new Error("No person found");
    
    const page = Math.floor(index / 20) + 1; // Get different pages based on index
    const response = await fetch(
      `https://api.themoviedb.org/3/person/${person.id}/movie_credits?api_key=${Deno.env.get('TMDB_API_KEY')}`
    );
    
    if (!response.ok) throw new Error("Failed to get person movies");
    
    const data = await response.json();
    const movies = filters.directors?.[0] ? data.crew?.filter((m: any) => m.job === 'Director') : data.cast;
    
    if (!movies?.length) throw new Error("No movies found for person");
    
    // Random selection from person's movies
    const randomMovie = movies[Math.floor(Math.random() * movies.length)];
    
    return this.formatTMDbMovie(randomMovie);
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
      let imdbId = null;
      try {
        const detailsResponse = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${Deno.env.get('TMDB_API_KEY')}&append_to_response=external_ids`);
        if (detailsResponse.ok) {
          const details = await detailsResponse.json();
          imdbId = details.external_ids?.imdb_id;
          console.log(`DEBUG: Got IMDb ID ${imdbId} for TMDb movie ${tmdbMovie.title}`);
        }
      } catch (e) {
        console.log(`DEBUG: Failed to get IMDb ID for ${tmdbMovie.title}: ${e}`);
      }

      // Convert TMDb format to Plex-like format
      const thumbUrl = tmdbMovie.poster_path ? `/tmdb-poster${tmdbMovie.poster_path}` : '';
      console.log('DEBUG getTMDbMovie thumb:', thumbUrl);

      const formatted = {
        title: tmdbMovie.title,
        year: new Date(tmdbMovie.release_date || '').getFullYear() || null,
        summary: tmdbMovie.overview,
        guid: `tmdb://${tmdbMovie.id}`,
        key: `/tmdb/${tmdbMovie.id}`,
        thumb: tmdbMovie.poster_path ? `/tmdb-poster${tmdbMovie.poster_path}` : '',
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
        tmdbId: tmdbMovie.id
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
    const cacheKey = plexMovie.guid || plexMovie.key || (plexMovie.tmdbId ? `tmdb://${plexMovie.tmdbId}` : null)

    if (!cacheKey) {
      return enrich({
        title: plexMovie.title,
        year: typeof plexMovie.year === 'number' ? plexMovie.year : Number(plexMovie.year) || null,
        plexGuid: plexMovie.guid,
        imdbId: plexMovie.imdbId,
      })
    }

    let task = this.enrichmentCache.get(cacheKey)
    if (!task) {
      task = enrich({
        title: plexMovie.title,
        year: typeof plexMovie.year === 'number' ? plexMovie.year : Number(plexMovie.year) || null,
        plexGuid: plexMovie.guid,
        imdbId: plexMovie.imdbId,
      })
        .catch(err => {
          this.enrichmentCache.delete(cacheKey)
          throw err
        })
      this.enrichmentCache.set(cacheKey, task)
    }
    return task
  }
  
  handleMatch(movie: MediaItem, users: User[]) {
    for (const ws of this.users.values()) {
      const match: WebSocketMatchMessage = {
        type: 'match',
        payload: {
          movie,
          users: users.map(_ => _.name),
        },
      }
      if (ws && !ws.isClosed) {
        ws.send(JSON.stringify(match))
      }
    }
  }

  getExistingMatches(user: User) {
    // now uses rebuilt likedMovies; returns any movie liked by user + at least one other
    return [...this.likedMovies.entries()]
      .filter(([, users]) => users.includes(user) && users.length > 1)
      .map(([movie, users]) => ({ movie, users: users.map(_ => _.name) }))
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

export const getSession = (roomCode: string, ws: WebSocket): Session => {
  if (activeSessions.has(roomCode)) return activeSessions.get(roomCode)!
  const session = new Session(roomCode)
  activeSessions.set(roomCode, session)
  log.debug(
    `New session created. Active session ids are: ${[...activeSessions.keys()].join(', ')}`
  )
  return session
}

// -------------------------
// Login flow
// -------------------------
export const handleLogin = (ws: WebSocket): Promise<User> => {
  return new Promise(resolve => {
    const handler = (msg: string) => {
      const data: WebSocketMessage = JSON.parse(msg)

      if (data.type === 'login') {
        log.info(`Got a login attempt from ${data.payload.name}`)
        
        // Check access password
        if (!ACCESS_PASSWORD || data.payload.accessPassword !== ACCESS_PASSWORD) {
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
          log.info(`${existingUser.name} is already logged in. Try another name!`)
          const response: WebSocketLoginResponseMessage = {
            type: 'loginResponse',
            payload: { success: false },
          }
          ws.send(JSON.stringify(response))
          return
        }

        const user: User = existingUser ?? { name: data.payload.name, responses: [] }

        log.debug(`${existingUser ? 'Existing user' : 'New user'} ${user.name} logged in`)

        ws.removeListener('message', handler)
        session.add(user, ws)

        // Persist (make sure this user is in the room set)
        upsertRoomUser(session.roomCode, user)
        saveState(persistedState).catch(err =>
          log.warning(`Failed to save state on login: ${err}`)
        )

        // Create rated items for the user
        const ratedItems: RatedPayloadItem[] = user.responses.map(response => {
          const movie = session.movieForGuid(response.guid);
          
          if (!movie) return null;
          
          return {
            guid: response.guid,
            wantsToWatch: response.wantsToWatch,
            movie: movie
          };
        }).filter((item): item is RatedPayloadItem => item !== null);

        // FIX: Create Set for efficient filtering
        const ratedGuidSet = new Set(user.responses.map(_ => _.guid));
        
        // Re-send any unseen movies (from this session) and existing matches
        const response: WebSocketLoginResponseMessage = {
          type: 'loginResponse',
          payload: {
            success: true,
            matches: session.getExistingMatches(user),
            movies: session.movieList.filter(
              movie => !ratedGuidSet.has(movie.guid)
            ),
            rated: ratedItems
          },
        }
		log.info(`DEBUG: Login response sending ${response.payload.movies.length} movies from session.movieList (total session movies: ${session.movieList.length})`)
		log.info(`DEBUG: Sending ${ratedItems.length} rated items to ${user.name}`)

        ws.send(JSON.stringify(response))

        return resolve(user)
      }
    }
    ws.addListener('message', handler)
  })
}